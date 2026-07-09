require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Pool } = require('pg');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');

const PORT = process.env.PORT || 8080;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'local-development-secret-change-me-12345');
const REDIS_URL = process.env.REDIS_URL || '';
const METERED_API_KEY = (process.env.METERED_API_KEY || '').trim();
const METERED_DOMAIN = (process.env.METERED_DOMAIN || '').trim();
const METERED_TURN_API_URL = (process.env.METERED_TURN_API_URL || process.env.METERED_TURN_CREDENTIALS_URL || '').trim();
const STATIC_TURN_URLS = (
  process.env.TURN_URLS ||
  process.env.VITE_TURN_URLS ||
  ''
)
  .split(',')
  .map(url => url.trim())
  .filter(Boolean)
  .filter(url => /^(turns?|stun):/i.test(url));
const STATIC_TURN_USERNAME = (process.env.TURN_USERNAME || process.env.VITE_TURN_USERNAME || '').trim();
const STATIC_TURN_CREDENTIAL = (process.env.TURN_CREDENTIAL || process.env.VITE_TURN_CREDENTIAL || '').trim();
const DEFAULT_METERED_TURN_URLS = [
  'stun:stun.relay.metered.ca:80',
  'turn:standard.relay.metered.ca:80',
  'turn:standard.relay.metered.ca:80?transport=tcp',
  'turn:standard.relay.metered.ca:443',
  'turns:standard.relay.metered.ca:443?transport=tcp'
];
const ONLINE_TTL_SECONDS = 180;
const CLIENT_ORIGINS = (
  process.env.CLIENT_ORIGIN ||
  process.env.CLIENT_URL ||
  'http://localhost:5173'
)
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const app = express();
const server = http.createServer(app);

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters.');
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

fs.mkdirSync(path.join(__dirname, '..', 'uploads'), { recursive: true });

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || CLIENT_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '20mb' }));

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (r, f, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
    filename: (r, f, cb) => {
      const extension = path.extname(f.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      cb(null, crypto.randomUUID() + extension);
    }
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set([
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav',
      'video/mp4', 'video/webm', 'video/quicktime',
      'application/octet-stream',
      'application/pdf', 'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]);
    cb(allowed.has(file.mimetype) ? null : new Error('Unsupported file type.'), allowed.has(file.mimetype));
  }
});

const online = new Map();
const groupCallParticipants = new Map();
const { Server } = require('socket.io');

const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000,
  maxHttpBufferSize: 25e6
});

let redisPresence = null;
let cachedTurnCredentials = null;
let cachedTurnCredentialsUntil = 0;

function onlineKey(userId) {
  return `securechat:online:${String(userId)}`;
}

function createRedisClient() {
  const redisUrl = REDIS_URL.trim();
  const needsTls = /^rediss:\/\//i.test(redisUrl) ||
    /\.upstash\.io(?::\d+)?/i.test(redisUrl) ||
    process.env.REDIS_TLS === 'true';

  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(needsTls ? { tls: {} } : {})
  });
}

async function setupRealtimeScaling() {
  if (!REDIS_URL) {
    console.log('Socket.IO Redis adapter disabled: REDIS_URL is not configured.');
    return;
  }

  const pubClient = createRedisClient();
  const subClient = pubClient.duplicate();
  redisPresence = pubClient.duplicate();

  pubClient.on('error', error => console.error('Redis pub error', error.message));
  subClient.on('error', error => console.error('Redis sub error', error.message));
  redisPresence.on('error', error => console.error('Redis presence error', error.message));

  await Promise.all([
    new Promise((resolve, reject) => pubClient.once('ready', resolve).once('error', reject)),
    new Promise((resolve, reject) => subClient.once('ready', resolve).once('error', reject)),
    new Promise((resolve, reject) => redisPresence.once('ready', resolve).once('error', reject))
  ]);

  io.adapter(createAdapter(pubClient, subClient));
  console.log('Socket.IO Redis adapter enabled.');
}

async function markUserOnline(userId, socketId) {
  if (!redisPresence) return;
  const key = onlineKey(userId);
  await redisPresence.sadd(key, socketId).catch(error => console.error('presence add', error.message));
  await redisPresence.expire(key, ONLINE_TTL_SECONDS).catch(() => {});
}

async function markUserOffline(userId, socketId) {
  if (!redisPresence) return;
  const key = onlineKey(userId);
  await redisPresence.srem(key, socketId).catch(error => console.error('presence remove', error.message));
  const remaining = await redisPresence.scard(key).catch(() => 0);
  if (!remaining) await redisPresence.del(key).catch(() => {});
}

async function refreshOnlinePresence() {
  if (!redisPresence) return;
  const tasks = [];
  for (const [userId, socketIds] of online.entries()) {
    if (!socketIds?.size) continue;
    tasks.push(redisPresence.expire(onlineKey(userId), ONLINE_TTL_SECONDS));
  }
  await Promise.all(tasks).catch(error => console.error('presence refresh', error.message));
}

function clean(v) {
  return typeof v === 'string' ? v.trim().replace(/[<>]/g, '') : '';
}

function generateRecoveryCode() {
  return crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
}

function isOnline(userId) {
  return (online.get(String(userId))?.size || 0) > 0;
}

async function isUserOnline(userId) {
  if (isOnline(userId)) return true;
  if (!redisPresence) return false;
  const count = await redisPresence.scard(onlineKey(userId)).catch(() => 0);
  return count > 0;
}

function userRoom(userId) {
  return 'user:' + String(userId);
}

function groupRoom(groupId) {
  return 'group:' + String(groupId);
}

function groupCallRoom(groupId) {
  return 'group-call:' + String(groupId);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
}

function callNetworkSummary(network = {}) {
  return {
    type: clean(network.type || 'unknown').slice(0, 24),
    effectiveType: clean(network.effectiveType || 'unknown').slice(0, 24),
    saveData: Boolean(network.saveData),
    downlink: typeof network.downlink === 'number' ? network.downlink : null,
    rtt: typeof network.rtt === 'number' ? network.rtt : null
  };
}

function logCallEvent(event, details = {}) {
  console.log(JSON.stringify({
    event,
    at: new Date().toISOString(),
    ...details
  }));
}

function meteredTurnCredentialsUrl() {
  if (METERED_TURN_API_URL) return METERED_TURN_API_URL;
  if (!METERED_API_KEY || !METERED_DOMAIN) return '';
  const host = METERED_DOMAIN.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return `https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(METERED_API_KEY)}`;
}

function staticTurnCredentials() {
  if (!STATIC_TURN_USERNAME || !STATIC_TURN_CREDENTIAL) return null;
  const urls = STATIC_TURN_URLS.length ? STATIC_TURN_URLS : DEFAULT_METERED_TURN_URLS;
  const iceServers = urls.map(url => ({
    urls: url,
    ...(/^(turns?):/i.test(url)
      ? {
          username: STATIC_TURN_USERNAME,
          credential: STATIC_TURN_CREDENTIAL,
          credentialType: 'password'
        }
      : {})
  }));

  return { iceServers };
}

function turnCredentialsConfigured() {
  return Boolean(meteredTurnCredentialsUrl() || staticTurnCredentials());
}

async function fetchMeteredTurnCredentials() {
  const url = meteredTurnCredentialsUrl();
  const fallback = staticTurnCredentials();
  if (!url) {
    if (fallback) return fallback;
    const error = new Error('TURN credentials are not configured.');
    error.statusCode = 503;
    throw error;
  }

  if (cachedTurnCredentials && cachedTurnCredentialsUntil > Date.now()) {
    return cachedTurnCredentials;
  }

  let response;
  try {
    response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Metered TURN credentials request failed with ${response.status}`);
    }
  } catch (error) {
    if (fallback) {
      console.warn(`Metered dynamic TURN failed; using static TURN fallback: ${error.message}`);
      return fallback;
    }
    throw error;
  }

  const iceServers = await response.json();
  if (!Array.isArray(iceServers)) {
    throw new Error('Metered TURN credentials response was not valid.');
  }

  const safeIceServers = iceServers
    .filter(server => server && (typeof server.urls === 'string' || Array.isArray(server.urls)))
    .map(server => ({
      urls: server.urls,
      ...(server.username ? { username: String(server.username) } : {}),
      ...(server.credential ? { credential: String(server.credential) } : {})
    }));

  cachedTurnCredentials = { iceServers: safeIceServers };
  cachedTurnCredentialsUntil = Date.now() + 5 * 60 * 1000;
  return cachedTurnCredentials;
}

function rateLimit({ windowMs, max }) {
  const attempts = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const current = attempts.get(key);

    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    next();
  };
}

const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const uploadRateLimit = rateLimit({ windowMs: 60 * 1000, max: 20 });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cid(a, b) {
  return [String(a), String(b)].sort().join('-');
}

async function usersBlocked(a, b) {
  const result = await pool.query(
    `SELECT 1 FROM user_blocks
     WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1`,
    [a, b]
  );
  return Boolean(result.rows.length);
}

function sign(u) {
  return jwt.sign(
    {
      id: String(u.id),
      username: u.username,
      sv: Number(u.sessionVersion ?? u.session_version ?? 0),
      sid: u.sessionId || undefined
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

async function createSession(req, userId) {
  const deviceName = clean(req.body.deviceName || req.get('user-agent') || 'Unknown device').slice(0, 160);
  const result = await pool.query(
    'INSERT INTO user_sessions(user_id,device_name,ip_address) VALUES($1,$2,$3) RETURNING id',
    [userId, deviceName, req.ip || null]
  );
  return String(result.rows[0].id);
}

async function auth(req, res, next) {
  const h = req.headers.authorization || '';

  if (!h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(h.slice(7), JWT_SECRET);
    const result = await pool.query('SELECT session_version FROM users WHERE id=$1', [decoded.id]);
    if (!result.rows.length || Number(decoded.sv || 0) !== Number(result.rows[0].session_version || 0)) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.user = decoded;
    req.user.id = String(decoded.id);
    if (decoded.sid) {
      const session = await pool.query(
        'UPDATE user_sessions SET last_seen=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id',
        [decoded.sid, decoded.id]
      );
      if (!session.rows.length) return res.status(401).json({ error: 'This device session was logged out.' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session.' });
  }
}

function user(u) {
  const hideProfile = u.profile_visibility === 'nobody';
  const hideAbout = u.about_visibility === 'nobody';
  const hidePresence = u.last_seen_visibility === 'nobody';
  return {
    id: String(u.id),
    username: u.username,
    phone: u.phone,
    about: hideAbout ? '' : (u.about || ''),
    avatarUrl: hideProfile ? null : (u.avatar_url || null),
    online: hidePresence ? false : isOnline(u.id),
    lastSeen: hidePresence ? null : u.last_seen
  };
}

function msg(m) {
  return {
    id: String(m.id),
    conversationId: m.conversation_id,
    senderId: String(m.sender_id),
    recipientId: String(m.recipient_id),
    body: m.body,
    kind: m.kind,
    fileUrl: m.file_url,
    fileName: m.file_name,
    fileMime: m.file_mime,
    fileEncryption: m.file_encryption || null,
    ciphertext: m.ciphertext || null,
    encryptionVersion: m.encryption_version || null,
    senderDeviceId: m.sender_device_id || null,
    replyToId: m.reply_to_id ? String(m.reply_to_id) : null,
    editedAt: m.edited_at || null,
    scheduledAt: m.scheduled_at || null,
    sentAt: m.sent_at || null,
    expiresAt: m.expires_at || null,
    starred: Boolean(m.starred),
    reactions: Array.isArray(m.reactions) ? m.reactions : [],
    deliveredAt: m.delivered_at,
    readAt: m.read_at,
    createdAt: m.created_at
  };
}

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    realtime: {
      redisConfigured: Boolean(REDIS_URL),
      redisConnected: Boolean(redisPresence && redisPresence.status === 'ready')
    },
    turn: {
      meteredConfigured: Boolean(meteredTurnCredentialsUrl()),
      staticConfigured: Boolean(staticTurnCredentials()),
      configured: turnCredentialsConfigured()
    }
  });
});

app.get('/api/turn/credentials', auth, asyncRoute(async (req, res) => {
  res.json(await fetchMeteredTurnCredentials());
}));

app.get('/api/turn/health', asyncRoute(async (req, res) => {
  const configured = turnCredentialsConfigured();
  if (!configured) {
    return res.json({
      configured: false,
      credentialFetchOk: false,
      relayUrlsFound: false,
      relayWithCredentialsFound: false
    });
  }

  try {
    const result = await fetchMeteredTurnCredentials();
    const iceServers = result.iceServers || [];
    const urls = iceServers.flatMap(server => Array.isArray(server.urls) ? server.urls : [server.urls]).filter(Boolean);
    const relayServers = iceServers.filter(server => {
      const serverUrls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return serverUrls.some(url => /^turns?:/i.test(String(url)));
    });

    return res.json({
      configured: true,
      credentialFetchOk: true,
      iceServerCount: iceServers.length,
      relayUrlCount: urls.filter(url => /^turns?:/i.test(String(url))).length,
      relayUrlsFound: urls.some(url => /^turns?:/i.test(String(url))),
      relayWithCredentialsFound: relayServers.some(server => server.username && server.credential),
      hasTlsRelay: urls.some(url => /^turns:/i.test(String(url)) || /transport=tcp/i.test(String(url))),
      cacheSecondsRemaining: Math.max(0, Math.round((cachedTurnCredentialsUntil - Date.now()) / 1000))
    });
  } catch (error) {
    return res.json({
      configured: true,
      credentialFetchOk: false,
      relayUrlsFound: false,
      relayWithCredentialsFound: false,
      reason: error.message
    });
  }
}));

app.post('/api/auth/register', authRateLimit, async (req, res) => {
  const username = clean(req.body.username);
  const phone = clean(req.body.phone);
  const password = String(req.body.password || '');

  if (username.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
  if (phone.length < 6) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  try {
    if ((await pool.query('SELECT id FROM users WHERE phone=$1', [phone])).rows.length) {
      return res.status(409).json({ error: 'Phone already registered.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, 12);

    const r = await pool.query(
      `INSERT INTO users(username,phone,password_hash,recovery_code_hash,recovery_code_created_at)
       VALUES($1,$2,$3,$4,NOW())
       RETURNING id,username,phone,about,avatar_url,last_seen,session_version`,
      [username, phone, hash, recoveryCodeHash]
    );

    const u = user(r.rows[0]);
    const sessionId = await createSession(req, u.id);
    res.status(201).json({
      token: sign({ ...u, sessionVersion: r.rows[0].session_version, sessionId }),
      user: u,
      recoveryCode
    });
  } catch (e) {
    console.error('register', e.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const phone = clean(req.body.phone);
  const password = String(req.body.password || '');
  const twoStepPin = String(req.body.twoStepPin || '');

  try {
    const r = await pool.query('SELECT * FROM users WHERE phone=$1', [phone]);
    const u = r.rows[0];

    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ error: 'Invalid phone or password.' });
    }
    if (u.two_step_pin_hash && !(await bcrypt.compare(twoStepPin, u.two_step_pin_hash))) {
      return res.status(401).json({
        error: twoStepPin ? 'Incorrect two-step verification PIN.' : 'Two-step verification PIN required.',
        twoStepRequired: true
      });
    }

    await pool.query('UPDATE users SET last_seen=NOW() WHERE id=$1', [u.id]);

    const out = user(u);
    const sessionId = await createSession(req, u.id);
    io.to(userRoom(u.id)).emit('security:new-login', {
      deviceName: clean(req.body.deviceName || req.get('user-agent') || 'Unknown device').slice(0, 160),
      time: new Date().toISOString()
    });
    res.json({
      token: sign({ ...out, sessionVersion: u.session_version, sessionId }),
      user: out
    });
  } catch (e) {
    console.error('login', e.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/auth/reset-password', authRateLimit, asyncRoute(async (req, res) => {
  const phone = clean(req.body.phone);
  const recoveryCode = clean(req.body.recoveryCode).toUpperCase();
  const password = String(req.body.password || '');

  if (phone.length < 6 || !recoveryCode) {
    return res.status(400).json({ error: 'Phone number and recovery code are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const result = await pool.query(
    'SELECT id,recovery_code_hash FROM users WHERE phone=$1',
    [phone]
  );
  const account = result.rows[0];
  const valid = account?.recovery_code_hash
    ? await bcrypt.compare(recoveryCode, account.recovery_code_hash)
    : false;

  if (!valid) {
    return res.status(400).json({ error: 'Invalid phone number or recovery code.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `UPDATE users
     SET password_hash=$1,recovery_code_hash=NULL,recovery_code_created_at=NULL,
         session_version=session_version+1
     WHERE id=$2`,
    [passwordHash, account.id]
  );

  res.json({ ok: true });
}));

app.post('/api/auth/recovery-code', auth, asyncRoute(async (req, res) => {
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await bcrypt.hash(recoveryCode, 12);
  await pool.query(
    'UPDATE users SET recovery_code_hash=$1,recovery_code_created_at=NOW() WHERE id=$2',
    [recoveryCodeHash, req.user.id]
  );
  res.json({ recoveryCode });
}));

app.get('/api/users', auth, asyncRoute(async (req, res) => {
  const q = clean(req.query.q || '');

  if (q.length < 2) return res.json([]);

  const r = await pool.query(
    `SELECT u.id,u.username,u.phone,u.about,u.avatar_url,u.last_seen,
      p.last_seen_visibility,p.profile_visibility,p.about_visibility
     FROM users u LEFT JOIN user_privacy p ON p.user_id=u.id
     WHERE u.id<>$1 AND (LOWER(u.username) LIKE LOWER($2) OR u.phone LIKE $2)
     ORDER BY u.username LIMIT 30`,
    [req.user.id, '%' + q + '%']
  );

  res.json(r.rows.map(user));
}));

app.get('/api/privacy', auth, asyncRoute(async (req, res) => {
  await pool.query('INSERT INTO user_privacy(user_id) VALUES($1) ON CONFLICT DO NOTHING', [req.user.id]);
  const result = await pool.query('SELECT * FROM user_privacy WHERE user_id=$1', [req.user.id]);
  const blocked = await pool.query(
    `SELECT u.id,u.username FROM user_blocks b JOIN users u ON u.id=b.blocked_id
     WHERE b.blocker_id=$1 ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  const p = result.rows[0];
  res.json({
    lastSeenVisibility: p.last_seen_visibility,
    profileVisibility: p.profile_visibility,
    aboutVisibility: p.about_visibility,
    readReceipts: p.read_receipts,
    silenceUnknownCalls: p.silence_unknown_calls,
    blockedUsers: blocked.rows.map(row => ({ id: String(row.id), username: row.username }))
  });
}));

app.patch('/api/privacy', auth, asyncRoute(async (req, res) => {
  const allowed = new Set(['everyone', 'nobody']);
  const lastSeen = allowed.has(req.body.lastSeenVisibility) ? req.body.lastSeenVisibility : 'everyone';
  const profile = allowed.has(req.body.profileVisibility) ? req.body.profileVisibility : 'everyone';
  const about = allowed.has(req.body.aboutVisibility) ? req.body.aboutVisibility : 'everyone';
  await pool.query(
    `INSERT INTO user_privacy(user_id,last_seen_visibility,profile_visibility,about_visibility,read_receipts,silence_unknown_calls)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET
       last_seen_visibility=$2,profile_visibility=$3,about_visibility=$4,
       read_receipts=$5,silence_unknown_calls=$6,updated_at=NOW()`,
    [req.user.id, lastSeen, profile, about, req.body.readReceipts !== false, Boolean(req.body.silenceUnknownCalls)]
  );
  res.json({ ok: true });
}));

app.get('/api/security', auth, asyncRoute(async (req, res) => {
  const sessions = await pool.query(
    `SELECT id,device_name,ip_address,created_at,last_seen FROM user_sessions
     WHERE user_id=$1 AND revoked_at IS NULL ORDER BY last_seen DESC`,
    [req.user.id]
  );
  const account = await pool.query('SELECT two_step_pin_hash FROM users WHERE id=$1', [req.user.id]);
  res.json({
    twoStepEnabled: Boolean(account.rows[0]?.two_step_pin_hash),
    sessions: sessions.rows.map(row => ({
      id: String(row.id),
      deviceName: row.device_name,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      lastSeen: row.last_seen,
      current: String(row.id) === String(req.user.sid)
    }))
  });
}));

app.delete('/api/security/sessions/:sessionId', auth, asyncRoute(async (req, res) => {
  await pool.query(
    'UPDATE user_sessions SET revoked_at=NOW() WHERE id=$1 AND user_id=$2',
    [req.params.sessionId, req.user.id]
  );
  res.json({ ok: true });
}));

app.delete('/api/security/sessions', auth, asyncRoute(async (req, res) => {
  await pool.query(
    'UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',
    [req.user.id, req.user.sid]
  );
  res.json({ ok: true });
}));

app.post('/api/security/two-step', auth, asyncRoute(async (req, res) => {
  const pin = String(req.body.pin || '');
  const password = String(req.body.password || '');
  if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'PIN must contain exactly 6 digits.' });
  const account = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!await bcrypt.compare(password, account.rows[0].password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  await pool.query('UPDATE users SET two_step_pin_hash=$1 WHERE id=$2', [await bcrypt.hash(pin, 12), req.user.id]);
  res.json({ enabled: true });
}));

app.delete('/api/security/two-step', auth, asyncRoute(async (req, res) => {
  const password = String(req.body.password || '');
  const account = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!await bcrypt.compare(password, account.rows[0].password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  await pool.query('UPDATE users SET two_step_pin_hash=NULL WHERE id=$1', [req.user.id]);
  res.json({ enabled: false });
}));

app.post('/api/security/change-password', auth, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const account = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!await bcrypt.compare(currentPassword, account.rows[0].password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(newPassword, 12), req.user.id]);
  await pool.query(
    'UPDATE user_sessions SET revoked_at=NOW() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',
    [req.user.id, req.user.sid]
  );
  res.json({ ok: true });
}));

app.get('/api/account/export', auth, asyncRoute(async (req, res) => {
  const [account, messages, calls] = await Promise.all([
    pool.query('SELECT id,username,phone,about,avatar_url,created_at,last_seen FROM users WHERE id=$1', [req.user.id]),
    pool.query(
      `SELECT id,conversation_id,sender_id,recipient_id,body,kind,file_url,file_name,file_mime,
        ciphertext,encryption_version,sender_device_id,file_encryption,
        delivered_at,read_at,created_at,edited_at,scheduled_at,expires_at
       FROM messages WHERE sender_id=$1 OR recipient_id=$1 ORDER BY created_at`,
      [req.user.id]
    ),
    pool.query(
      'SELECT id,caller_id,recipient_id,call_type,status,started_at,answered_at,ended_at FROM call_history WHERE caller_id=$1 OR recipient_id=$1 ORDER BY started_at',
      [req.user.id]
    )
  ]);
  res.json({
    exportedAt: new Date().toISOString(),
    account: account.rows[0],
    messages: messages.rows,
    calls: calls.rows
  });
}));

app.delete('/api/account', auth, asyncRoute(async (req, res) => {
  const password = String(req.body.password || '');
  const account = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!await bcrypt.compare(password, account.rows[0].password_hash)) {
    return res.status(401).json({ error: 'Password is incorrect.' });
  }
  await pool.query('DELETE FROM users WHERE id=$1', [req.user.id]);
  res.json({ deleted: true });
}));

app.post('/api/users/:userId/block', auth, asyncRoute(async (req, res) => {
  const target = req.params.userId;
  if (!validUuid(target) || target === String(req.user.id)) return res.status(400).json({ error: 'Invalid user.' });
  await pool.query('INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, target]);
  res.json({ blocked: true });
}));

app.delete('/api/users/:userId/block', auth, asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2', [req.user.id, req.params.userId]);
  res.json({ blocked: false });
}));

app.post('/api/users/:userId/report', auth, asyncRoute(async (req, res) => {
  const reason = clean(req.body.reason);
  if (!validUuid(req.params.userId) || reason.length < 3) return res.status(400).json({ error: 'Add a report reason.' });
  await pool.query(
    'INSERT INTO user_reports(reporter_id,reported_id,message_id,reason) VALUES($1,$2,$3,$4)',
    [req.user.id, req.params.userId, validUuid(req.body.messageId) ? req.body.messageId : null, reason.slice(0, 500)]
  );
  res.json({ ok: true });
}));

app.get('/api/status', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT s.id,s.user_id,u.username,u.avatar_url,s.kind,s.created_at,s.expires_at,
      s.encrypted_payloads ->> $1::text payload,
      (SELECT COUNT(*)::int FROM status_views v WHERE v.status_id=s.id) view_count,
      EXISTS(SELECT 1 FROM status_views v WHERE v.status_id=s.id AND v.viewer_id=$1) viewed,
      EXISTS(SELECT 1 FROM status_mutes sm WHERE sm.user_id=$1 AND sm.muted_user_id=s.user_id) muted
     FROM status_updates s JOIN users u ON u.id=s.user_id
     WHERE s.deleted_at IS NULL AND s.expires_at>NOW()
       AND (s.user_id=$1 OR s.encrypted_payloads ? $1::text)
     ORDER BY s.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows.map(row => ({
    id: String(row.id), userId: String(row.user_id), username: row.username,
    avatarUrl: row.avatar_url, kind: row.kind, createdAt: row.created_at,
    expiresAt: row.expires_at, payload: row.payload,
    viewCount: row.view_count, viewed: row.viewed, muted: row.muted
  })));
}));

app.post('/api/status', auth, asyncRoute(async (req, res) => {
  const id = clean(req.body.id);
  const payloads = req.body.payloads;
  const kind = clean(req.body.kind || 'text');
  if (!validUuid(id) || !payloads || typeof payloads !== 'object' || Array.isArray(payloads)) {
    return res.status(400).json({ error: 'Invalid encrypted status.' });
  }
  const entries = Object.entries(payloads).slice(0, 500);
  if (!entries.length || entries.some(([userId, payload]) => !validUuid(userId) || typeof payload !== 'string' || payload.length > 30000)) {
    return res.status(400).json({ error: 'Invalid status audience.' });
  }
  await pool.query(
    `INSERT INTO status_updates(id,user_id,encrypted_payloads,kind)
     VALUES($1,$2,$3,$4)`,
    [id, req.user.id, Object.fromEntries(entries), kind]
  );
  res.status(201).json({ id, createdAt: new Date().toISOString() });
}));

app.post('/api/status/:statusId/view', auth, asyncRoute(async (req, res) => {
  const status = await pool.query(
    `SELECT user_id FROM status_updates
     WHERE id=$1 AND deleted_at IS NULL AND expires_at>NOW() AND encrypted_payloads ? $2`,
    [req.params.statusId, req.user.id]
  );
  if (!status.rows.length) return res.status(404).json({ error: 'Status is unavailable.' });
  await pool.query(
    `INSERT INTO status_views(status_id,viewer_id,viewed_at,reaction) VALUES($1,$2,NOW(),$3)
     ON CONFLICT(status_id,viewer_id) DO UPDATE SET viewed_at=NOW(),
       reaction=COALESCE(EXCLUDED.reaction,status_views.reaction)`,
    [req.params.statusId, req.user.id, clean(req.body.reaction) || null]
  );
  res.json({ ok: true });
}));

app.delete('/api/status/:statusId', auth, asyncRoute(async (req, res) => {
  await pool.query('UPDATE status_updates SET deleted_at=NOW() WHERE id=$1 AND user_id=$2', [req.params.statusId, req.user.id]);
  res.json({ ok: true });
}));

app.patch('/api/status/mute/:userId', auth, asyncRoute(async (req, res) => {
  if (req.body.muted === false) {
    await pool.query('DELETE FROM status_mutes WHERE user_id=$1 AND muted_user_id=$2', [req.user.id, req.params.userId]);
  } else {
    await pool.query('INSERT INTO status_mutes(user_id,muted_user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.params.userId]);
  }
  res.json({ muted: req.body.muted !== false });
}));

app.get('/api/channels', auth, asyncRoute(async (req, res) => {
  const query = clean(req.query.q || '');
  const result = await pool.query(
    `SELECT c.*,u.username owner_name,
      EXISTS(SELECT 1 FROM channel_followers f WHERE f.channel_id=c.id AND f.user_id=$1) following,
      (SELECT COUNT(*)::int FROM channel_followers f WHERE f.channel_id=c.id) follower_count
     FROM channels c JOIN users u ON u.id=c.owner_id
     WHERE $2='' OR LOWER(c.name) LIKE LOWER($3)
     ORDER BY follower_count DESC,c.created_at DESC LIMIT 100`,
    [req.user.id, query, `%${query}%`]
  );
  res.json(result.rows.map(row => ({
    id: String(row.id), name: row.name, description: row.description,
    avatarUrl: row.avatar_url, ownerId: String(row.owner_id), ownerName: row.owner_name,
    following: row.following, followerCount: row.follower_count
  })));
}));

app.post('/api/channels', auth, asyncRoute(async (req, res) => {
  const name = clean(req.body.name);
  if (name.length < 2) return res.status(400).json({ error: 'Channel name must be at least 2 characters.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const channel = await client.query(
      'INSERT INTO channels(name,description,owner_id) VALUES($1,$2,$3) RETURNING id',
      [name.slice(0, 120), clean(req.body.description).slice(0, 500), req.user.id]
    );
    await client.query('INSERT INTO channel_followers(channel_id,user_id) VALUES($1,$2)', [channel.rows[0].id, req.user.id]);
    await client.query('COMMIT');
    res.status(201).json({ id: String(channel.rows[0].id), name });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.post('/api/channels/:channelId/follow', auth, asyncRoute(async (req, res) => {
  await pool.query('INSERT INTO channel_followers(channel_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.params.channelId, req.user.id]);
  res.json({ following: true });
}));

app.delete('/api/channels/:channelId/follow', auth, asyncRoute(async (req, res) => {
  await pool.query('DELETE FROM channel_followers WHERE channel_id=$1 AND user_id=$2', [req.params.channelId, req.user.id]);
  res.json({ following: false });
}));

app.get('/api/channels/:channelId/posts', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT p.*,u.username author_name,
      COALESCE((SELECT json_agg(json_build_object('userId',r.user_id::text,'emoji',r.emoji))
        FROM channel_reactions r WHERE r.post_id=p.id),'[]'::json) reactions
     FROM channel_posts p JOIN users u ON u.id=p.author_id
     WHERE p.channel_id=$1 AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 200`,
    [req.params.channelId]
  );
  res.json(result.rows.map(row => ({
    id: String(row.id), channelId: String(row.channel_id), authorId: String(row.author_id),
    authorName: row.author_name, body: row.body, kind: row.kind,
    fileUrl: row.file_url, fileName: row.file_name, fileMime: row.file_mime,
    createdAt: row.created_at, reactions: row.reactions
  })));
}));

app.post('/api/channels/:channelId/posts', auth, asyncRoute(async (req, res) => {
  const body = String(req.body.body || '').trim();
  const fileUrl = req.body.fileUrl || null;
  const owner = await pool.query('SELECT 1 FROM channels WHERE id=$1 AND owner_id=$2', [req.params.channelId, req.user.id]);
  if (!owner.rows.length) return res.status(403).json({ error: 'Only the channel owner can publish.' });
  if (!body && !fileUrl) return res.status(400).json({ error: 'Channel update cannot be empty.' });
  if (fileUrl && (!String(fileUrl).startsWith('/uploads/') || !req.body.fileName)) {
    return res.status(400).json({ error: 'Invalid channel attachment.' });
  }
  const result = await pool.query(
    `INSERT INTO channel_posts(channel_id,author_id,body,kind,file_url,file_name,file_mime)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.channelId, req.user.id, body, clean(req.body.kind || 'text'),
      fileUrl, req.body.fileName || null, req.body.fileMime || null]
  );
  const followers = await pool.query(
    'SELECT user_id FROM channel_followers WHERE channel_id=$1 AND user_id<>$2 AND notifications=TRUE',
    [req.params.channelId, req.user.id]
  );
  const channel = await pool.query('SELECT name FROM channels WHERE id=$1', [req.params.channelId]);
  const event = {
    id: String(result.rows[0].id), channelId: req.params.channelId,
    channelName: channel.rows[0]?.name, body, kind: clean(req.body.kind || 'text'),
    fileUrl, fileName: req.body.fileName || null, fileMime: req.body.fileMime || null,
    createdAt: result.rows[0].created_at
  };
  followers.rows.forEach(row => io.to(userRoom(row.user_id)).emit('channel:post', event));
  res.status(201).json(event);
}));

app.post('/api/channels/:channelId/posts/:postId/reaction', auth, asyncRoute(async (req, res) => {
  const emoji = clean(req.body.emoji);
  if (!emoji || emoji.length > 16) return res.status(400).json({ error: 'Invalid reaction.' });
  await pool.query(
    `INSERT INTO channel_reactions(post_id,user_id,emoji) VALUES($1,$2,$3)
     ON CONFLICT(post_id,user_id) DO UPDATE SET emoji=$3,created_at=NOW()`,
    [req.params.postId, req.user.id, emoji]
  );
  res.json({ userId: String(req.user.id), emoji });
}));

app.get('/api/groups', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT g.*,gm.role,rs.muted_until,
      (SELECT COUNT(*)::int FROM group_messages unread
       WHERE unread.group_id=g.id AND unread.sender_id<>$1 AND unread.deleted_at IS NULL
         AND unread.created_at>COALESCE(rs.last_read_at,gm.joined_at)) unread_count,
      (SELECT json_agg(json_build_object('id',u.id::text,'username',u.username,'role',members.role))
       FROM group_members members JOIN users u ON u.id=members.user_id WHERE members.group_id=g.id) members
     FROM chat_groups g JOIN group_members gm ON gm.group_id=g.id
     LEFT JOIN group_read_states rs ON rs.group_id=g.id AND rs.user_id=$1
     WHERE gm.user_id=$1 ORDER BY g.updated_at DESC`,
    [req.user.id]
  );
  res.json(result.rows.map(row => ({
    id: String(row.id), name: row.name, description: row.description,
    avatarUrl: row.avatar_url, role: row.role, members: row.members || [],
    createdAt: row.created_at, unreadCount: row.unread_count, mutedUntil: row.muted_until
  })));
}));

app.post('/api/groups', auth, asyncRoute(async (req, res) => {
  const name = clean(req.body.name);
  const memberIds = [...new Set((Array.isArray(req.body.memberIds) ? req.body.memberIds : [])
    .filter(validUuid).filter(id => id !== String(req.user.id)))].slice(0, 255);
  if (name.length < 2) return res.status(400).json({ error: 'Group name must be at least 2 characters.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const group = await client.query(
      'INSERT INTO chat_groups(name,description,created_by) VALUES($1,$2,$3) RETURNING *',
      [name.slice(0, 120), clean(req.body.description).slice(0, 500), req.user.id]
    );
    const groupId = group.rows[0].id;
    await client.query('INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)', [groupId, req.user.id, 'admin']);
    for (const memberId of memberIds) {
      await client.query('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [groupId, memberId]);
    }
    await client.query('COMMIT');
    res.status(201).json({ id: String(groupId), name, role: 'admin' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

app.patch('/api/groups/:groupId', auth, asyncRoute(async (req, res) => {
  const admin = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [req.params.groupId, req.user.id, 'admin']);
  if (!admin.rows.length) return res.status(403).json({ error: 'Only group admins can edit the group.' });
  const name = clean(req.body.name);
  if (name.length < 2) return res.status(400).json({ error: 'Group name must be at least 2 characters.' });
  await pool.query('UPDATE chat_groups SET name=$1,description=$2,updated_at=NOW() WHERE id=$3', [name.slice(0, 120), clean(req.body.description).slice(0, 500), req.params.groupId]);
  res.json({ ok: true });
}));

app.patch('/api/groups/:groupId/members/:userId/role', auth, asyncRoute(async (req, res) => {
  const admin = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [req.params.groupId, req.user.id, 'admin']);
  if (!admin.rows.length) return res.status(403).json({ error: 'Only group admins can change roles.' });
  const role = req.body.role === 'admin' ? 'admin' : 'member';
  await pool.query('UPDATE group_members SET role=$1 WHERE group_id=$2 AND user_id=$3', [role, req.params.groupId, req.params.userId]);
  res.json({ role });
}));

app.post('/api/groups/:groupId/invite', auth, asyncRoute(async (req, res) => {
  const admin = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [req.params.groupId, req.user.id, 'admin']);
  if (!admin.rows.length) return res.status(403).json({ error: 'Only group admins can manage invite links.' });
  const token = crypto.randomBytes(24).toString('base64url');
  await pool.query('UPDATE chat_groups SET invite_token=$1,invite_enabled=TRUE WHERE id=$2', [token, req.params.groupId]);
  res.json({ token });
}));

app.delete('/api/groups/:groupId/invite', auth, asyncRoute(async (req, res) => {
  const admin = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [req.params.groupId, req.user.id, 'admin']);
  if (!admin.rows.length) return res.status(403).json({ error: 'Only group admins can revoke invite links.' });
  await pool.query('UPDATE chat_groups SET invite_token=NULL,invite_enabled=FALSE WHERE id=$1', [req.params.groupId]);
  res.json({ ok: true });
}));

app.post('/api/groups/join/:token', auth, asyncRoute(async (req, res) => {
  const group = await pool.query('SELECT id FROM chat_groups WHERE invite_token=$1 AND invite_enabled=TRUE', [req.params.token]);
  if (!group.rows.length) return res.status(404).json({ error: 'Invite link is invalid or expired.' });
  await pool.query('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [group.rows[0].id, req.user.id]);
  res.json({ groupId: String(group.rows[0].id) });
}));

app.post('/api/groups/:groupId/members', auth, asyncRoute(async (req, res) => {
  const groupId = req.params.groupId;
  const userId = clean(req.body.userId);
  const admin = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [groupId, req.user.id, 'admin']);
  if (!admin.rows.length) return res.status(403).json({ error: 'Only group admins can add members.' });
  if (!validUuid(userId)) return res.status(400).json({ error: 'Invalid user.' });
  await pool.query('INSERT INTO group_members(group_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [groupId, userId]);
  res.json({ ok: true });
}));

app.delete('/api/groups/:groupId/members/:userId', auth, asyncRoute(async (req, res) => {
  const ownLeave = String(req.params.userId) === String(req.user.id);
  if (!ownLeave) {
    const admin = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND role=$3', [req.params.groupId, req.user.id, 'admin']);
    if (!admin.rows.length) return res.status(403).json({ error: 'Only group admins can remove members.' });
  }
  await pool.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [req.params.groupId, req.params.userId]);
  res.json({ ok: true });
}));

app.get('/api/groups/:groupId/messages', auth, asyncRoute(async (req, res) => {
  const membership = await pool.query(
    'SELECT joined_at FROM group_members WHERE group_id=$1 AND user_id=$2',
    [req.params.groupId, req.user.id]
  );
  if (!membership.rows.length) return res.status(403).json({ error: 'You are not a member of this group.' });
  const result = await pool.query(
    `SELECT m.id,m.group_id,m.sender_id,u.username sender_name,m.kind,m.reply_to_id,
      m.created_at,m.edited_at,m.encrypted_payloads->$2 payload,
      COALESCE((SELECT json_agg(json_build_object('userId',r.user_id::text,'emoji',r.emoji))
        FROM group_message_reactions r WHERE r.message_id=m.id),'[]'::json) reactions
     FROM group_messages m JOIN users u ON u.id=m.sender_id
     WHERE m.group_id=$1 AND m.deleted_at IS NULL AND m.created_at>= $3
     ORDER BY m.created_at ASC LIMIT 500`,
    [req.params.groupId, req.user.id, membership.rows[0].joined_at]
  );
  res.json(result.rows.map(row => ({
    id: String(row.id), groupId: String(row.group_id), senderId: String(row.sender_id),
    senderName: row.sender_name, kind: row.kind, replyToId: row.reply_to_id,
    createdAt: row.created_at, editedAt: row.edited_at, payload: row.payload,
    reactions: row.reactions
  })));
}));

app.post('/api/groups/:groupId/read', auth, asyncRoute(async (req, res) => {
  const member = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [req.params.groupId, req.user.id]);
  if (!member.rows.length) return res.status(403).json({ error: 'Not a group member.' });
  await pool.query(
    `INSERT INTO group_read_states(group_id,user_id,last_read_at) VALUES($1,$2,NOW())
     ON CONFLICT(group_id,user_id) DO UPDATE SET last_read_at=NOW()`,
    [req.params.groupId, req.user.id]
  );
  io.to(groupRoom(req.params.groupId)).emit('group:read', {
    groupId: req.params.groupId, userId: String(req.user.id), readAt: new Date().toISOString()
  });
  res.json({ ok: true });
}));

app.patch('/api/groups/:groupId/mute', auth, asyncRoute(async (req, res) => {
  const mutedUntil = req.body.mutedUntil ? new Date(req.body.mutedUntil) : null;
  await pool.query(
    `INSERT INTO group_read_states(group_id,user_id,muted_until) VALUES($1,$2,$3)
     ON CONFLICT(group_id,user_id) DO UPDATE SET muted_until=$3`,
    [req.params.groupId, req.user.id, mutedUntil]
  );
  res.json({ mutedUntil });
}));

app.post('/api/groups/:groupId/messages', auth, asyncRoute(async (req, res) => {
  const payloads = req.body.payloads;
  if (!payloads || typeof payloads !== 'object' || Array.isArray(payloads)) {
    return res.status(400).json({ error: 'Encrypted member payloads are required.' });
  }
  const members = await pool.query('SELECT user_id FROM group_members WHERE group_id=$1', [req.params.groupId]);
  if (!members.rows.some(row => String(row.user_id) === String(req.user.id))) {
    return res.status(403).json({ error: 'You are not a member of this group.' });
  }
  for (const member of members.rows) {
    const payload = payloads[String(member.user_id)];
    if (typeof payload !== 'string' || payload.length > 30000) {
      return res.status(400).json({ error: 'Every group member requires a valid encrypted payload.' });
    }
  }
  const cleanPayloads = Object.fromEntries(members.rows.map(row => [String(row.user_id), payloads[String(row.user_id)]]));
  const result = await pool.query(
    `INSERT INTO group_messages(group_id,sender_id,encrypted_payloads,kind)
     VALUES($1,$2,$3,$4) RETURNING id,created_at`,
    [req.params.groupId, req.user.id, cleanPayloads, clean(req.body.kind || 'text')]
  );
  const event = {
    id: String(result.rows[0].id), groupId: req.params.groupId,
    senderId: String(req.user.id), senderName: req.user.username,
    kind: clean(req.body.kind || 'text'), createdAt: result.rows[0].created_at
  };
  members.rows.forEach(member => {
    io.to(userRoom(member.user_id)).emit('group:message', {
      ...event,
      payload: cleanPayloads[String(member.user_id)]
    });
  });
  res.status(201).json({ ...event, payload: cleanPayloads[String(req.user.id)] });
}));

app.delete('/api/groups/:groupId/messages/:messageId', auth, asyncRoute(async (req, res) => {
  const allowed = await pool.query(
    `SELECT 1 FROM group_messages m JOIN group_members gm ON gm.group_id=m.group_id
     WHERE m.id=$1 AND m.group_id=$2 AND gm.user_id=$3
       AND (m.sender_id=$3 OR gm.role='admin')`,
    [req.params.messageId, req.params.groupId, req.user.id]
  );
  if (!allowed.rows.length) return res.status(403).json({ error: 'You cannot delete this message.' });
  await pool.query('UPDATE group_messages SET deleted_at=NOW() WHERE id=$1', [req.params.messageId]);
  io.to(groupRoom(req.params.groupId)).emit('group:message-deleted', {
    groupId: req.params.groupId, messageId: req.params.messageId
  });
  res.json({ ok: true });
}));

app.post('/api/groups/:groupId/messages/:messageId/reaction', auth, asyncRoute(async (req, res) => {
  const emoji = clean(req.body.emoji);
  const member = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [req.params.groupId, req.user.id]);
  if (!member.rows.length || !emoji || emoji.length > 16) return res.status(400).json({ error: 'Invalid reaction.' });
  await pool.query(
    `INSERT INTO group_message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3)
     ON CONFLICT(message_id,user_id) DO UPDATE SET emoji=$3,created_at=NOW()`,
    [req.params.messageId, req.user.id, emoji]
  );
  const event = { groupId: req.params.groupId, messageId: req.params.messageId, userId: String(req.user.id), emoji };
  io.to(groupRoom(req.params.groupId)).emit('group:reaction', event);
  res.json(event);
}));

app.get('/api/chats', auth, asyncRoute(async (req, res) => {
  const r = await pool.query(
    `SELECT DISTINCT ON(m.conversation_id) 
      m.*, 
      CASE WHEN m.sender_id=$1 THEN ru.id ELSE su.id END contact_id,
      CASE WHEN m.sender_id=$1 THEN ru.username ELSE su.username END contact_username,
      CASE WHEN m.sender_id=$1 THEN ru.phone ELSE su.phone END contact_phone,
      CASE WHEN m.sender_id=$1 THEN ru.about ELSE su.about END contact_about,
      CASE WHEN m.sender_id=$1 THEN ru.avatar_url ELSE su.avatar_url END contact_avatar_url,
      CASE WHEN m.sender_id=$1 THEN ru.last_seen ELSE su.last_seen END contact_last_seen,
      COALESCE(cp.pinned,FALSE) pinned,
      COALESCE(cp.archived,FALSE) archived,
      cp.muted_until,
      COALESCE(cp.disappearing_seconds,0) disappearing_seconds,
      (SELECT COUNT(*)::int FROM messages unread
       WHERE unread.conversation_id=m.conversation_id
         AND unread.recipient_id=$1 AND unread.read_at IS NULL
         AND unread.deleted_at IS NULL) unread_count
    FROM messages m
    JOIN users su ON su.id=m.sender_id
    JOIN users ru ON ru.id=m.recipient_id
    LEFT JOIN chat_preferences cp ON cp.user_id=$1 AND cp.conversation_id=m.conversation_id
    WHERE (m.sender_id=$1 OR m.recipient_id=$1) AND m.deleted_at IS NULL
      AND m.sent_at IS NOT NULL AND (m.expires_at IS NULL OR m.expires_at>NOW())
      AND NOT EXISTS (
        SELECT 1 FROM message_deletions md
        WHERE md.user_id=$1 AND md.message_id=m.id)
    ORDER BY m.conversation_id,m.created_at DESC`,
    [req.user.id]
  );

  res.json(
    r.rows
      .map(x => ({
        conversationId: x.conversation_id,
        contact: user({
          id: x.contact_id,
          username: x.contact_username,
          phone: x.contact_phone,
          about: x.contact_about,
          avatar_url: x.contact_avatar_url,
          last_seen: x.contact_last_seen
        }),
        lastMessage: msg(x),
        pinned: x.pinned,
        archived: x.archived,
        mutedUntil: x.muted_until,
        disappearingSeconds: x.disappearing_seconds,
        unreadCount: x.unread_count
      }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
        new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt))
  );
}));

app.get('/api/calls', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `SELECT c.*,
      CASE WHEN c.caller_id=$1 THEN recipient.id ELSE caller.id END contact_id,
      CASE WHEN c.caller_id=$1 THEN recipient.username ELSE caller.username END contact_name,
      CASE WHEN c.caller_id=$1 THEN recipient.avatar_url ELSE caller.avatar_url END contact_avatar
     FROM call_history c
     JOIN users caller ON caller.id=c.caller_id
     JOIN users recipient ON recipient.id=c.recipient_id
     WHERE c.caller_id=$1 OR c.recipient_id=$1
     ORDER BY c.started_at DESC LIMIT 100`,
    [req.user.id]
  );
  res.json(result.rows.map(row => ({
    id: String(row.id),
    direction: String(row.caller_id) === String(req.user.id) ? 'outgoing' : 'incoming',
    contactId: String(row.contact_id),
    contactName: row.contact_name,
    contactAvatar: row.contact_avatar,
    type: row.call_type,
    status: row.status,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at
  })));
}));

app.delete('/api/calls/:callId', auth, asyncRoute(async (req, res) => {
  const result = await pool.query(
    `DELETE FROM call_history
     WHERE id=$1 AND (caller_id=$2 OR recipient_id=$2)
     RETURNING id`,
    [req.params.callId, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Call log not found.' });
  res.json({ ok: true });
}));

app.patch('/api/chats/:conversationId/preferences', auth, asyncRoute(async (req, res) => {
  const c = req.params.conversationId;
  const conv = await pool.query('SELECT user_a,user_b FROM conversations WHERE id=$1', [c]);
  if (!conv.rows.length) return res.status(404).json({ error: 'Chat not found.' });
  const row = conv.rows[0];
  if (String(row.user_a) !== String(req.user.id) && String(row.user_b) !== String(req.user.id)) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  const pinned = Boolean(req.body.pinned);
  const archived = Boolean(req.body.archived);
  const mutedUntil = req.body.mutedUntil ? new Date(req.body.mutedUntil) : null;
  const disappearingSeconds = [0, 86400, 604800, 7776000].includes(Number(req.body.disappearingSeconds))
    ? Number(req.body.disappearingSeconds)
    : 0;
  if (mutedUntil && Number.isNaN(mutedUntil.getTime())) {
    return res.status(400).json({ error: 'Invalid mute time.' });
  }
  const result = await pool.query(
    `INSERT INTO chat_preferences(user_id,conversation_id,pinned,archived,muted_until,disappearing_seconds)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(user_id,conversation_id) DO UPDATE
     SET pinned=EXCLUDED.pinned,archived=EXCLUDED.archived,
         muted_until=EXCLUDED.muted_until,disappearing_seconds=EXCLUDED.disappearing_seconds,updated_at=NOW()
     RETURNING pinned,archived,muted_until,disappearing_seconds`,
    [req.user.id, c, pinned, archived, mutedUntil, disappearingSeconds]
  );
  res.json({
    pinned: result.rows[0].pinned,
    archived: result.rows[0].archived,
    mutedUntil: result.rows[0].muted_until,
    disappearingSeconds: result.rows[0].disappearing_seconds
  });
}));

app.delete('/api/chats/:conversationId', auth, asyncRoute(async (req, res) => {
  const c = req.params.conversationId;
  const conv = await pool.query('SELECT user_a,user_b FROM conversations WHERE id=$1', [c]);
  if (!conv.rows.length) return res.status(404).json({ error: 'Chat not found.' });
  const row = conv.rows[0];
  if (String(row.user_a) !== String(req.user.id) && String(row.user_b) !== String(req.user.id)) {
    return res.status(403).json({ error: 'Access denied.' });
  }
  await pool.query(
    `INSERT INTO message_deletions(user_id,message_id)
     SELECT $1,id FROM messages WHERE conversation_id=$2
     ON CONFLICT(user_id,message_id) DO NOTHING`,
    [req.user.id, c]
  );
  await pool.query(
    `UPDATE chat_preferences SET archived=FALSE,updated_at=NOW()
     WHERE user_id=$1 AND conversation_id=$2`,
    [req.user.id, c]
  );
  res.json({ ok: true });
}));

app.post('/api/e2ee/devices', auth, asyncRoute(async (req, res) => {
  const deviceId = clean(req.body.deviceId);
  const fingerprint = clean(req.body.fingerprint);
  const publicKeyJwk = req.body.publicKeyJwk;

  if (!deviceId || deviceId.length > 100) return res.status(400).json({ error: 'Invalid device ID.' });
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) return res.status(400).json({ error: 'Invalid key fingerprint.' });
  if (!publicKeyJwk || publicKeyJwk.kty !== 'EC' || publicKeyJwk.crv !== 'P-256' || !publicKeyJwk.x || !publicKeyJwk.y) {
    return res.status(400).json({ error: 'Invalid public key.' });
  }

  await pool.query(
    `INSERT INTO user_devices(user_id,device_id,public_key_jwk,key_fingerprint,last_seen)
     VALUES($1,$2,$3,$4,NOW())
     ON CONFLICT(user_id,device_id) DO UPDATE
     SET public_key_jwk=EXCLUDED.public_key_jwk,
         key_fingerprint=EXCLUDED.key_fingerprint,
         last_seen=NOW(),
         revoked_at=NULL`,
    [req.user.id, deviceId, publicKeyJwk, fingerprint]
  );

  res.json({ ok: true, deviceId, fingerprint });
}));

app.get('/api/e2ee/users/:userId/devices', auth, asyncRoute(async (req, res) => {
  const targetId = req.params.userId;
  if (!validUuid(targetId)) return res.status(400).json({ error: 'Invalid user.' });

  const result = await pool.query(
    `SELECT device_id,public_key_jwk,key_fingerprint,last_seen
     FROM user_devices
     WHERE user_id=$1 AND revoked_at IS NULL
     ORDER BY last_seen DESC
     LIMIT 10`,
    [targetId]
  );

  res.json(result.rows.map(row => ({
    deviceId: row.device_id,
    publicKeyJwk: row.public_key_jwk,
    fingerprint: row.key_fingerprint,
    lastSeen: row.last_seen
  })));
}));

app.get('/api/messages/:conversationId', auth, async (req, res) => {
  const c = req.params.conversationId;

  try {
    const conv = await pool.query(
      'SELECT user_a, user_b FROM conversations WHERE id=$1',
      [c]
    );

    if (!conv.rows.length) {
      return res.json([]);
    }

    const row = conv.rows[0];

    if (
      String(row.user_a) !== String(req.user.id) &&
      String(row.user_b) !== String(req.user.id)
    ) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const r = await pool.query(
      `SELECT m.*,
         EXISTS(SELECT 1 FROM message_stars ms WHERE ms.user_id=$2 AND ms.message_id=m.id) starred,
         COALESCE((SELECT json_agg(json_build_object(
           'userId',mr.user_id::text,'emoji',mr.emoji))
           FROM message_reactions mr WHERE mr.message_id=m.id),'[]'::json) reactions
       FROM messages m
       WHERE m.conversation_id=$1 AND m.deleted_at IS NULL
         AND (m.expires_at IS NULL OR m.expires_at>NOW())
         AND (m.sent_at IS NOT NULL OR m.sender_id=$2)
         AND NOT EXISTS (
           SELECT 1 FROM message_deletions md
           WHERE md.user_id=$2 AND md.message_id=m.id)
       ORDER BY m.created_at ASC LIMIT 500`,
      [c, req.user.id]
    );

    res.json(r.rows.map(msg));
  } catch (e) {
    console.error('messages history', e.message);
    res.status(500).json({ error: 'Could not load messages.' });
  }
});

app.post('/api/messages', auth, async (req, res) => {
  const recipientId = clean(req.body.recipientId);
  const body = String(req.body.body || '');
  const kind = clean(req.body.kind || 'text');
  const fileUrl = req.body.fileUrl || null;
  const fileName = req.body.fileName || null;
  const fileMime = req.body.fileMime || null;
  const ciphertext = typeof req.body.ciphertext === 'string' ? req.body.ciphertext : null;
  const encryptionVersion = Number(req.body.encryptionVersion || 0) || null;
  const senderDeviceId = clean(req.body.senderDeviceId);
  const replyToId = clean(req.body.replyToId);
  const fileEncryption = typeof req.body.fileEncryption === 'string' ? req.body.fileEncryption : null;
  const requestedSchedule = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null;

  if (!recipientId) return res.status(400).json({ error: 'Recipient required.' });
  if (!validUuid(recipientId)) return res.status(400).json({ error: 'Invalid recipient.' });
  if (recipientId === String(req.user.id)) return res.status(400).json({ error: 'You cannot message yourself.' });
  if (!body.trim() && !fileUrl) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 10000) return res.status(400).json({ error: 'Message is too long.' });
  if (!['text', 'image', 'file', 'audio', 'sticker'].includes(kind)) return res.status(400).json({ error: 'Invalid message type.' });
  if (ciphertext) {
    if (encryptionVersion !== 1 || !senderDeviceId || ciphertext.length > 30000) {
      return res.status(400).json({ error: 'Invalid encrypted message.' });
    }
  }
  if (fileUrl && (!String(fileUrl).startsWith('/uploads/') || !fileName)) {
    return res.status(400).json({ error: 'Invalid file attachment.' });
  }
  if (fileEncryption && (fileEncryption.length > 1000 || !senderDeviceId)) {
    return res.status(400).json({ error: 'Invalid encrypted attachment.' });
  }
  if (replyToId && !validUuid(replyToId)) return res.status(400).json({ error: 'Invalid reply.' });
  if (requestedSchedule && (Number.isNaN(requestedSchedule.getTime()) || requestedSchedule <= new Date())) {
    return res.status(400).json({ error: 'Choose a future delivery time.' });
  }

  const c = cid(req.user.id, recipientId);

  try {
    if (await usersBlocked(req.user.id, recipientId)) {
      return res.status(403).json({ error: 'Messaging is unavailable for this user.' });
    }
    await pool.query(
      'INSERT INTO conversations(id,user_a,user_b,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(id) DO UPDATE SET updated_at=NOW()',
      [c, req.user.id, recipientId]
    );

    const recipient = await pool.query('SELECT id FROM users WHERE id=$1', [recipientId]);
    if (!recipient.rows.length) return res.status(404).json({ error: 'Recipient not found.' });

    const scheduledAt = requestedSchedule || null;
    const sentAt = scheduledAt ? null : new Date();
    const delivered = !scheduledAt && isOnline(recipientId) ? new Date() : null;
    const preference = await pool.query(
      'SELECT disappearing_seconds FROM chat_preferences WHERE user_id=$1 AND conversation_id=$2',
      [req.user.id, c]
    );
    const disappearingSeconds = kind === 'text'
      ? Number(preference.rows[0]?.disappearing_seconds || 0)
      : 0;
    const expiresAt = disappearingSeconds
      ? new Date((scheduledAt || new Date()).getTime() + disappearingSeconds * 1000)
      : null;

    const r = await pool.query(
      `INSERT INTO messages(
        conversation_id,sender_id,recipient_id,body,kind,file_url,file_name,file_mime,delivered_at,
        ciphertext,encryption_version,sender_device_id,reply_to_id,scheduled_at,sent_at,expires_at,file_encryption
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        c, req.user.id, recipientId, ciphertext ? '[Encrypted message]' : (body || fileName || kind),
        kind, fileUrl, fileName, fileMime, delivered, ciphertext, encryptionVersion,
        senderDeviceId || null, replyToId || null, scheduledAt, sentAt, expiresAt, fileEncryption
      ]
    );

    const m = msg(r.rows[0]);
    if (!scheduledAt && isOnline(recipientId)) io.to(userRoom(recipientId)).emit('message:new', m);

    res.status(201).json(m);
  } catch (e) {
    console.error('message', e.message);
    res.status(500).json({ error: 'Could not send message: ' + e.message });
  }
});

app.post('/api/messages/:conversationId/read', auth, async (req, res) => {
  const c = req.params.conversationId;

  try {
    const privacy = await pool.query('SELECT read_receipts FROM user_privacy WHERE user_id=$1', [req.user.id]);
    if (privacy.rows[0]?.read_receipts === false) return res.json({ ok: true });
    const conv = await pool.query(
      'SELECT user_a, user_b FROM conversations WHERE id=$1',
      [c]
    );

    if (!conv.rows.length) {
      return res.json({ ok: true });
    }

    const row = conv.rows[0];

    if (
      String(row.user_a) !== String(req.user.id) &&
      String(row.user_b) !== String(req.user.id)
    ) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const updated = await pool.query(
      'UPDATE messages SET read_at=NOW() WHERE conversation_id=$1 AND recipient_id=$2 AND read_at IS NULL RETURNING sender_id',
      [c, req.user.id]
    );

    const senders = [...new Set(updated.rows.map(x => String(x.sender_id)))];
    senders.forEach(senderId => {
      io.to(userRoom(senderId)).emit('message:read', {
        conversationId: c,
        readerId: String(req.user.id),
        readAt: new Date().toISOString()
      });
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('read messages', e.message);
    res.status(500).json({ error: 'Could not mark messages as read.' });
  }
});

app.delete('/api/messages/:messageId', auth, asyncRoute(async (req, res) => {
  const messageId = req.params.messageId;
  if (!validUuid(messageId)) return res.status(400).json({ error: 'Invalid message.' });
  const result = await pool.query(
    'SELECT id,sender_id,recipient_id,conversation_id FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)',
    [messageId, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Message not found.' });
  const message = result.rows[0];
  if (req.query.scope === 'everyone') {
    if (String(message.sender_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the sender can delete for everyone.' });
    }
    await pool.query('UPDATE messages SET deleted_at=NOW() WHERE id=$1', [messageId]);
    io.to(userRoom(message.recipient_id)).emit('message:deleted', {
      messageId,
      conversationId: message.conversation_id
    });
    return res.json({ ok: true });
  }
  await pool.query(
    `INSERT INTO message_deletions(user_id,message_id)
     VALUES($1,$2) ON CONFLICT(user_id,message_id) DO NOTHING`,
    [req.user.id, messageId]
  );
  res.json({ ok: true });
}));

app.patch('/api/messages/:messageId', auth, asyncRoute(async (req, res) => {
  const messageId = req.params.messageId;
  const body = String(req.body.body || '').trim();
  const ciphertext = typeof req.body.ciphertext === 'string' ? req.body.ciphertext : null;
  const encryptionVersion = Number(req.body.encryptionVersion || 0) || null;
  const senderDeviceId = clean(req.body.senderDeviceId);
  if (!validUuid(messageId) || !body || body.length > 10000 || ciphertext?.length > 30000) {
    return res.status(400).json({ error: 'Enter a valid message.' });
  }
  const result = await pool.query(
    `UPDATE messages SET body=$1,ciphertext=$2,encryption_version=$3,sender_device_id=$4,edited_at=NOW()
     WHERE id=$5 AND sender_id=$6 AND kind='text' AND deleted_at IS NULL
     RETURNING *`,
    [
      ciphertext ? '[Encrypted message]' : body,
      ciphertext, encryptionVersion, senderDeviceId || null, messageId, req.user.id
    ]
  );
  if (!result.rows.length) {
    return res.status(400).json({ error: 'This message cannot be edited.' });
  }
  const updated = msg(result.rows[0]);
  io.to(userRoom(updated.recipientId)).emit('message:updated', updated);
  res.json(updated);
}));

app.post('/api/messages/:messageId/star', auth, asyncRoute(async (req, res) => {
  const messageId = req.params.messageId;
  const found = await pool.query(
    'SELECT id FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)',
    [messageId, req.user.id]
  );
  if (!found.rows.length) return res.status(404).json({ error: 'Message not found.' });
  const existing = await pool.query(
    'DELETE FROM message_stars WHERE user_id=$1 AND message_id=$2 RETURNING message_id',
    [req.user.id, messageId]
  );
  const starred = !existing.rows.length;
  if (starred) {
    await pool.query(
      'INSERT INTO message_stars(user_id,message_id) VALUES($1,$2)',
      [req.user.id, messageId]
    );
  }
  res.json({ starred });
}));

app.post('/api/messages/:messageId/reaction', auth, asyncRoute(async (req, res) => {
  const messageId = req.params.messageId;
  const emoji = clean(req.body.emoji);
  if (!validUuid(messageId) || !emoji || emoji.length > 16) {
    return res.status(400).json({ error: 'Invalid reaction.' });
  }
  const found = await pool.query(
    'SELECT sender_id,recipient_id,conversation_id FROM messages WHERE id=$1 AND (sender_id=$2 OR recipient_id=$2)',
    [messageId, req.user.id]
  );
  if (!found.rows.length) return res.status(404).json({ error: 'Message not found.' });
  await pool.query(
    `INSERT INTO message_reactions(user_id,message_id,emoji) VALUES($1,$2,$3)
     ON CONFLICT(user_id,message_id) DO UPDATE SET emoji=EXCLUDED.emoji,created_at=NOW()`,
    [req.user.id, messageId, emoji]
  );
  const message = found.rows[0];
  const peerId = String(message.sender_id) === String(req.user.id)
    ? message.recipient_id
    : message.sender_id;
  const payload = {
    messageId,
    conversationId: message.conversation_id,
    userId: String(req.user.id),
    emoji
  };
  io.to(userRoom(peerId)).emit('message:reaction', payload);
  res.json(payload);
}));

app.post('/api/profile/avatar', auth, uploadRateLimit, upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file || !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Choose a valid image.' });
  }
  if (req.file.size > 2 * 1024 * 1024) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Profile picture must be smaller than 2 MB.' });
  }
  const avatarBuffer = await fs.promises.readFile(req.file.path);
  fs.unlink(req.file.path, () => {});
  const avatarUrl = `data:${req.file.mimetype};base64,${avatarBuffer.toString('base64')}`;
  const result = await pool.query(
    `UPDATE users SET avatar_url=$1 WHERE id=$2
     RETURNING id,username,phone,about,avatar_url,last_seen`,
    [avatarUrl, req.user.id]
  );
  const updatedUser = user(result.rows[0]);
  io.emit('user:profile-updated', updatedUser);
  res.json(updatedUser);
}));

app.post('/api/upload', auth, uploadRateLimit, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required.' });

  res.json({
    url: '/uploads/' + req.file.filename,
    name: req.file.originalname,
    mime: req.file.mimetype,
    size: req.file.size
  });
});

app.use((err, req, res, next) => {
  console.error('request error', err.message);
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : err.message });
  }
  res.status(err.message === 'Unsupported file type.' ? 400 : 500).json({
    error: err.message === 'Unsupported file type.' ? err.message : 'Request failed.'
  });
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error('Auth required'));

    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT session_version FROM users WHERE id=$1', [decoded.id]);
    if (!result.rows.length || Number(decoded.sv || 0) !== Number(result.rows[0].session_version || 0)) {
      return next(new Error('Session expired'));
    }
    if (decoded.sid) {
      const session = await pool.query(
        'SELECT id FROM user_sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [decoded.sid, decoded.id]
      );
      if (!session.rows.length) return next(new Error('Device session expired'));
    }
    socket.user = decoded;
    socket.user.id = String(decoded.id);

    next();
  } catch {
    return next(new Error('Invalid token'));
  }
});

io.on('connection', async socket => {
  const userId = String(socket.user.id);

  const wasOffline = !isOnline(userId);
  const sockets = online.get(userId) || new Set();
  sockets.add(socket.id);
  online.set(userId, sockets);
  await markUserOnline(userId, socket.id);
  socket.join(userRoom(userId));
  const groupRooms = await pool.query('SELECT group_id FROM group_members WHERE user_id=$1', [userId]).catch(() => ({ rows: [] }));
  groupRooms.rows.forEach(row => socket.join(groupRoom(row.group_id)));

  await pool.query('UPDATE users SET last_seen=NOW() WHERE id=$1', [userId]).catch(() => {});

  if (wasOffline) socket.broadcast.emit('user:online', { userId });

  const delivered = await pool.query(
    'UPDATE messages SET delivered_at=NOW() WHERE recipient_id=$1 AND delivered_at IS NULL RETURNING sender_id,conversation_id',
    [userId]
  ).catch(() => ({ rows: [] }));

  delivered.rows.forEach(row => {
    io.to(userRoom(row.sender_id)).emit('message:delivered', {
      conversationId: row.conversation_id,
      recipientId: userId,
      deliveredAt: new Date().toISOString()
    });
  });

  socket.on('typing:start', ({ recipientId, conversationId } = {}) => {
    if (!validUuid(recipientId)) return;
    io.to(userRoom(recipientId)).emit('typing:start', { userId, conversationId: clean(conversationId) });
  });

  socket.on('typing:stop', ({ recipientId } = {}) => {
    if (!validUuid(recipientId)) return;
    io.to(userRoom(recipientId)).emit('typing:stop', { userId });
  });

  socket.on('group:typing', async ({ groupId, typing } = {}) => {
    if (!validUuid(groupId)) return;
    const member = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
    if (!member.rows.length) return;
    socket.to(groupRoom(groupId)).emit('group:typing', {
      groupId, userId, username: socket.user.username, typing: Boolean(typing)
    });
  });

  socket.on('call:offer', async ({ recipientId, offer, callType, videoIntent, network } = {}, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    if (!validUuid(recipientId) || !offer || !['audio', 'video'].includes(callType)) {
      return reply({ ok: false, message: 'Invalid call request.' });
    }
    if (await usersBlocked(userId, recipientId)) {
      socket.emit('call:unavailable');
      return reply({ ok: false, message: 'This user cannot receive your call.' });
    }
    const privacy = await pool.query(
      `SELECT p.silence_unknown_calls,
        EXISTS(SELECT 1 FROM conversations c WHERE c.id=$2) known
       FROM user_privacy p WHERE p.user_id=$1`,
      [recipientId, cid(userId, recipientId)]
    ).catch(() => ({ rows: [] }));
    if (privacy.rows[0]?.silence_unknown_calls && !privacy.rows[0]?.known) {
      socket.emit('call:unavailable');
      return reply({ ok: false, message: 'This user is not accepting unknown calls.' });
    }
    const available = await isUserOnline(recipientId);
    logCallEvent('call.offer', {
      callerId: userId,
      recipientId,
      callType,
      videoIntent: Boolean(videoIntent),
      recipientOnline: available,
      network: callNetworkSummary(network)
    });
    await pool.query(
      `INSERT INTO call_history(caller_id,recipient_id,call_type,status,ended_at)
       VALUES($1,$2,$3,$4,$5)`,
      [userId, recipientId, videoIntent ? 'video' : callType, available ? 'ringing' : 'missed', available ? null : new Date()]
    ).catch(() => {});
    if (!available) {
      socket.emit('call:unavailable');
      return reply({ ok: false, message: 'User is not online.' });
    }

    io.to(userRoom(recipientId)).emit('call:incoming', {
      callerId: userId,
      callerName: socket.user.username,
      offer,
      callType,
      videoIntent: Boolean(videoIntent)
    });
    return reply({ ok: true });
  });

  socket.on('call:answer', async ({ callerId, answer, network } = {}, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    if (!validUuid(callerId) || !answer) return reply({ ok: false, message: 'Invalid call answer.' });
    await pool.query(
      `UPDATE call_history SET status='answered',answered_at=NOW()
       WHERE id=(SELECT id FROM call_history WHERE caller_id=$1 AND recipient_id=$2 AND status='ringing' ORDER BY started_at DESC LIMIT 1)`,
      [callerId, userId]
    ).catch(() => {});
    const callerOnline = await isUserOnline(callerId);
    logCallEvent('call.answer', {
      callerId,
      recipientId: userId,
      callerOnline,
      network: callNetworkSummary(network)
    });
    if (!callerOnline) return reply({ ok: false, message: 'Caller is no longer online.' });
    io.to(userRoom(callerId)).emit('call:answer', { answer, peerId: userId });
    return reply({ ok: true });
  });

  socket.on('call:ice-candidate', ({ recipientId, candidate } = {}) => {
    if (!validUuid(recipientId) || !candidate) return;
    io.to(userRoom(recipientId)).emit('call:ice-candidate', { candidate, peerId: userId });
  });

  socket.on('call:renegotiate-offer', async ({ recipientId, offer } = {}, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    if (!validUuid(recipientId) || !offer) return reply({ ok: false, message: 'Invalid call update.' });
    if (!(await isUserOnline(recipientId))) return reply({ ok: false, message: 'User is no longer online.' });
    logCallEvent('call.renegotiate_offer', { fromUserId: userId, recipientId });
    io.to(userRoom(recipientId)).emit('call:renegotiate-offer', { offer, peerId: userId });
    return reply({ ok: true });
  });

  socket.on('call:renegotiate-answer', async ({ recipientId, answer } = {}, callback) => {
    const reply = typeof callback === 'function' ? callback : () => {};
    if (!validUuid(recipientId) || !answer) return reply({ ok: false, message: 'Invalid call update answer.' });
    if (!(await isUserOnline(recipientId))) return reply({ ok: false, message: 'User is no longer online.' });
    logCallEvent('call.renegotiate_answer', { fromUserId: userId, recipientId });
    io.to(userRoom(recipientId)).emit('call:renegotiate-answer', { answer, peerId: userId });
    return reply({ ok: true });
  });

  socket.on('call:end', async ({ recipientId } = {}) => {
    if (!validUuid(recipientId)) return;
    await pool.query(
      `UPDATE call_history SET status=CASE WHEN status='ringing' THEN 'missed' ELSE 'completed' END,ended_at=NOW()
       WHERE id=(SELECT id FROM call_history
         WHERE ((caller_id=$1 AND recipient_id=$2) OR (caller_id=$2 AND recipient_id=$1))
           AND status IN('ringing','answered') ORDER BY started_at DESC LIMIT 1)`,
      [userId, recipientId]
    ).catch(() => {});
    io.to(userRoom(recipientId)).emit('call:ended', { peerId: userId });
  });

  socket.on('call:decline', async ({ callerId } = {}) => {
    if (!validUuid(callerId)) return;
    await pool.query(
      `UPDATE call_history SET status='declined',ended_at=NOW()
       WHERE id=(SELECT id FROM call_history WHERE caller_id=$1 AND recipient_id=$2 AND status='ringing' ORDER BY started_at DESC LIMIT 1)`,
      [callerId, userId]
    ).catch(() => {});
    io.to(userRoom(callerId)).emit('call:ended', { peerId: userId });
  });

  socket.on('group-call:join', async ({ groupId, callType } = {}) => {
    if (!validUuid(groupId) || !['audio', 'video'].includes(callType)) return;
    const member = await pool.query('SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
    if (!member.rows.length) return socket.emit('group-call:error', { message: 'You are not a group member.' });
    const participants = groupCallParticipants.get(groupId) || new Map();
    if (!participants.has(userId) && participants.size >= 8) {
      return socket.emit('group-call:error', { message: 'This group call is full.' });
    }
    const existing = [...participants.entries()].map(([id, value]) => ({
      userId: id, username: value.username, callType: value.callType
    }));
    participants.set(userId, { socketId: socket.id, username: socket.user.username, callType });
    groupCallParticipants.set(groupId, participants);
    socket.join(groupCallRoom(groupId));
    socket.emit('group-call:participants', { groupId, participants: existing });
    socket.to(groupCallRoom(groupId)).emit('group-call:participant-joined', {
      groupId, userId, username: socket.user.username, callType
    });
  });

  for (const eventName of ['group-call:offer', 'group-call:answer', 'group-call:ice']) {
    socket.on(eventName, ({ groupId, targetUserId, data } = {}) => {
      const participants = groupCallParticipants.get(groupId);
      if (!participants?.has(userId)) return;
      const target = participants.get(String(targetUserId));
      if (!target || !data) return;
      io.to(target.socketId).emit(eventName, {
        groupId, fromUserId: userId, fromUsername: socket.user.username, data
      });
    });
  }

  socket.on('group-call:leave', ({ groupId } = {}) => {
    const participants = groupCallParticipants.get(groupId);
    participants?.delete(userId);
    if (!participants?.size) groupCallParticipants.delete(groupId);
    socket.leave(groupCallRoom(groupId));
    socket.to(groupCallRoom(groupId)).emit('group-call:participant-left', { groupId, userId });
  });

  socket.on('disconnect', async () => {
    for (const [groupId, participants] of groupCallParticipants.entries()) {
      if (participants.get(userId)?.socketId === socket.id) {
        participants.delete(userId);
        socket.to(groupCallRoom(groupId)).emit('group-call:participant-left', { groupId, userId });
        if (!participants.size) groupCallParticipants.delete(groupId);
      }
    }
    const current = online.get(userId);
    current?.delete(socket.id);
    await markUserOffline(userId, socket.id);

    if (!current?.size) {
      online.delete(userId);

      await pool.query('UPDATE users SET last_seen=NOW() WHERE id=$1', [userId]).catch(() => {});

      socket.broadcast.emit('user:offline', { userId });
    }
  });
});

async function deliverScheduledMessages() {
  const due = await pool.query(
    `UPDATE messages SET sent_at=NOW()
     WHERE id IN (
       SELECT id FROM messages WHERE scheduled_at<=NOW() AND sent_at IS NULL AND deleted_at IS NULL
       ORDER BY scheduled_at LIMIT 100 FOR UPDATE SKIP LOCKED)
     RETURNING *`
  );
  due.rows.forEach(row => {
    io.to(userRoom(row.recipient_id)).emit('message:new', msg(row));
  });
}

init()
  .then(() => setupRealtimeScaling().catch(error => {
    redisPresence = null;
    console.error('Socket.IO Redis adapter disabled:', error.message);
  }))
  .then(() => {
    server.listen(PORT, () => {
      console.log('SecureChat server running on ' + PORT);
    });
    setInterval(() => deliverScheduledMessages().catch(error => {
      console.error('scheduled delivery', error.message);
    }), 15000);
    setInterval(() => refreshOnlinePresence(), 60000);
  })
  .catch(e => {
    console.error('DB init failed', e);
    process.exit(1);
  });
