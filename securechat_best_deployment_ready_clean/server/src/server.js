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

const PORT = process.env.PORT || 8080;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION ? '' : 'local-development-secret-change-me-12345');
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

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
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
      'application/pdf', 'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]);
    cb(allowed.has(file.mimetype) ? null : new Error('Unsupported file type.'), allowed.has(file.mimetype));
  }
});

const online = new Map();
const { Server } = require('socket.io');

const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000,
  maxHttpBufferSize: 25e6
});

function clean(v) {
  return typeof v === 'string' ? v.trim().replace(/[<>]/g, '') : '';
}

function isOnline(userId) {
  return (online.get(String(userId))?.size || 0) > 0;
}

function userRoom(userId) {
  return 'user:' + String(userId);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
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

function sign(u) {
  return jwt.sign(
    { id: String(u.id), username: u.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';

  if (!h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    req.user.id = String(req.user.id);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid session.' });
  }
}

function user(u) {
  return {
    id: String(u.id),
    username: u.username,
    phone: u.phone,
    about: u.about || '',
    avatarUrl: u.avatar_url || null,
    online: isOnline(u.id),
    lastSeen: u.last_seen
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
    deliveredAt: m.delivered_at,
    readAt: m.read_at,
    createdAt: m.created_at
  };
}

async function init() {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

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

    const r = await pool.query(
      'INSERT INTO users(username,phone,password_hash) VALUES($1,$2,$3) RETURNING id,username,phone,about,avatar_url,last_seen',
      [username, phone, hash]
    );

    const u = user(r.rows[0]);
    res.status(201).json({ token: sign(u), user: u });
  } catch (e) {
    console.error('register', e.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', authRateLimit, async (req, res) => {
  const phone = clean(req.body.phone);
  const password = String(req.body.password || '');

  try {
    const r = await pool.query('SELECT * FROM users WHERE phone=$1', [phone]);
    const u = r.rows[0];

    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ error: 'Invalid phone or password.' });
    }

    await pool.query('UPDATE users SET last_seen=NOW() WHERE id=$1', [u.id]);

    const out = user(u);
    res.json({ token: sign(out), user: out });
  } catch (e) {
    console.error('login', e.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/auth/reset-password', authRateLimit, (req, res) => {
  res.status(501).json({
    error: 'Password reset is temporarily unavailable until phone or email verification is configured.'
  });
});

app.get('/api/users', auth, asyncRoute(async (req, res) => {
  const q = clean(req.query.q || '');

  if (q.length < 2) return res.json([]);

  const r = await pool.query(
    'SELECT id,username,phone,about,avatar_url,last_seen FROM users WHERE id<>$1 AND (LOWER(username) LIKE LOWER($2) OR phone LIKE $2) ORDER BY username LIMIT 30',
    [req.user.id, '%' + q + '%']
  );

  res.json(r.rows.map(user));
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
      CASE WHEN m.sender_id=$1 THEN ru.last_seen ELSE su.last_seen END contact_last_seen
    FROM messages m
    JOIN users su ON su.id=m.sender_id
    JOIN users ru ON ru.id=m.recipient_id
    WHERE (m.sender_id=$1 OR m.recipient_id=$1) AND m.deleted_at IS NULL
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
        lastMessage: msg(x)
      }))
      .sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt))
  );
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
      'SELECT * FROM messages WHERE conversation_id=$1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 500',
      [c]
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

  if (!recipientId) return res.status(400).json({ error: 'Recipient required.' });
  if (!validUuid(recipientId)) return res.status(400).json({ error: 'Invalid recipient.' });
  if (recipientId === String(req.user.id)) return res.status(400).json({ error: 'You cannot message yourself.' });
  if (!body.trim() && !fileUrl) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 10000) return res.status(400).json({ error: 'Message is too long.' });
  if (!['text', 'image', 'file'].includes(kind)) return res.status(400).json({ error: 'Invalid message type.' });
  if (fileUrl && (!String(fileUrl).startsWith('/uploads/') || !fileName)) {
    return res.status(400).json({ error: 'Invalid file attachment.' });
  }

  const c = cid(req.user.id, recipientId);

  try {
    await pool.query(
      'INSERT INTO conversations(id,user_a,user_b,updated_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(id) DO UPDATE SET updated_at=NOW()',
      [c, req.user.id, recipientId]
    );

    const recipient = await pool.query('SELECT id FROM users WHERE id=$1', [recipientId]);
    if (!recipient.rows.length) return res.status(404).json({ error: 'Recipient not found.' });

    const delivered = isOnline(recipientId) ? new Date() : null;

    const r = await pool.query(
      'INSERT INTO messages(conversation_id,sender_id,recipient_id,body,kind,file_url,file_name,file_mime,delivered_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [c, req.user.id, recipientId, body || fileName || kind, kind, fileUrl, fileName, fileMime, delivered]
    );

    const m = msg(r.rows[0]);
    if (isOnline(recipientId)) io.to(userRoom(recipientId)).emit('message:new', m);

    res.status(201).json(m);
  } catch (e) {
    console.error('message', e.message);
    res.status(500).json({ error: 'Could not send message: ' + e.message });
  }
});

app.post('/api/messages/:conversationId/read', auth, async (req, res) => {
  const c = req.params.conversationId;

  try {
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

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) return next(new Error('Auth required'));

    socket.user = jwt.verify(token, JWT_SECRET);
    socket.user.id = String(socket.user.id);

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
  socket.join(userRoom(userId));

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

  socket.on('call:offer', ({ recipientId, offer, callType } = {}) => {
    if (!validUuid(recipientId) || !offer || !['audio', 'video'].includes(callType)) return;
    if (!isOnline(recipientId)) return socket.emit('call:unavailable');

    io.to(userRoom(recipientId)).emit('call:incoming', {
      callerId: userId,
      callerName: socket.user.username,
      offer,
      callType
    });
  });

  socket.on('call:answer', ({ callerId, answer } = {}) => {
    if (!validUuid(callerId) || !answer) return;
    io.to(userRoom(callerId)).emit('call:answer', { answer, peerId: userId });
  });

  socket.on('call:ice-candidate', ({ recipientId, candidate } = {}) => {
    if (!validUuid(recipientId) || !candidate) return;
    io.to(userRoom(recipientId)).emit('call:ice-candidate', { candidate, peerId: userId });
  });

  socket.on('call:end', ({ recipientId } = {}) => {
    if (!validUuid(recipientId)) return;
    io.to(userRoom(recipientId)).emit('call:ended', { peerId: userId });
  });

  socket.on('disconnect', async () => {
    const current = online.get(userId);
    current?.delete(socket.id);

    if (!current?.size) {
      online.delete(userId);

      await pool.query('UPDATE users SET last_seen=NOW() WHERE id=$1', [userId]).catch(() => {});

      socket.broadcast.emit('user:offline', { userId });
    }
  });
});

init()
  .then(() => {
    server.listen(PORT, () => {
      console.log('SecureChat server running on ' + PORT);
    });
  })
  .catch(e => {
    console.error('DB init failed', e);
    process.exit(1);
  });
