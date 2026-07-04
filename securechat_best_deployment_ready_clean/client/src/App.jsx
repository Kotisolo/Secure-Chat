import React, { useEffect, useRef, useState } from 'react';
import {
  Phone, Video, VideoOff, Send, Search, LogOut, User, Paperclip, Image,
  Smile, Mic, MicOff, PhoneOff, Minimize2, ArrowLeft, X, Lock, MessageCircle
} from 'lucide-react';
import { api, uploadFile, setSession, getStoredUser, clearSession, API_URL } from './api';
import { connectSocket, disconnectSocket, getSocket } from './socket';

const emojis = '😀 😃 😄 😁 😆 😅 😂 🙂 😊 😍 😘 😎 😢 😭 😡 👍 👎 🙏 🔥 ❤️ 🎉 ✅ 💯'.split(' ');

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...(import.meta.env.VITE_TURN_URL
      ? [{
          urls: import.meta.env.VITE_TURN_URL,
          username: import.meta.env.VITE_TURN_USERNAME || '',
          credential: import.meta.env.VITE_TURN_CREDENTIAL || ''
        }]
      : [])
  ],
  iceCandidatePoolSize: 10
};

const initials = n => (n || '?').slice(0, 2).toUpperCase();
const cid = (a, b) => [String(a), String(b)].sort().join('-');
const t = v => {
  try {
    return new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};
const updateReceipt = (state, conversationId, field, value) => {
  const rows = state[conversationId];
  if (!Array.isArray(rows)) return state;
  return {
    ...state,
    [conversationId]: rows.map(message => ({ ...message, [field]: message[field] || value }))
  };
};
const receipt = message => {
  if (message.local) return 'sending…';
  if (message.readAt) return '✓✓';
  if (message.deliveredAt) return '✓✓';
  return '✓';
};
const mediaErrorMessage = (error, type) => {
  const denied = error?.name === 'NotAllowedError' || /permission denied|not allowed/i.test(error?.message || '');
  if (denied) {
    return `Microphone${type === 'video' ? ' and camera' : ''} access is blocked. Click the lock or crossed-out microphone icon beside the website address, choose Allow, then try the call again.`;
  }
  if (error?.name === 'NotFoundError') {
    return `No ${type === 'video' ? 'camera or microphone' : 'microphone'} was found on this device.`;
  }
  return 'The call could not start. Check your device permissions and connection, then try again.';
};

export default function App() {
  const storedUser = getStoredUser();

  const [screen, setScreen] = useState(storedUser && storedUser.id ? 'app' : 'welcome');
  const [authMode, setAuthMode] = useState('login');
  const [err, setErr] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [form, setForm] = useState({
    username: '',
    phone: '',
    password: ''
  });

  const [me, setMe] = useState(storedUser && storedUser.id ? storedUser : null);
  const [ready, setReady] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState({});
  const [active, setActive] = useState(null);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [profile, setProfile] = useState(null);

  const [call, setCall] = useState({
    active: false,
    minimized: false,
    type: 'audio',
    title: '',
    status: '',
    seconds: 0
  });

  // Incoming call waiting for the user to accept/decline (non-blocking)
  const [incoming, setIncoming] = useState(null);
  const [callError, setCallError] = useState('');

  // Media states shown on the call buttons
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const pc = useRef(null);
  const localStream = useRef(null);
  const callPeer = useRef(null);
  const timer = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const remoteAudio = useRef(null);
  const endRef = useRef(null);
  const typingTimer = useRef(null);
  const socketReady = useRef(false);
  const activeRef = useRef(null);
  const pendingIce = useRef([]);

  useEffect(() => {
    const stored = getStoredUser();

    if (stored && stored.id) {
      setMe(stored);
      setScreen('app');
      setTimeout(() => enterApp(), 0);
    } else {
      clearSession();
      setMe(null);
      setScreen('welcome');
    }

    return () => {
      disconnectSocket();
      cleanupPeer();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, active]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function register(e) {
    e.preventDefault();
    setErr('');
    setAuthLoading(true);

    try {
      const d = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username,
          phone: form.phone,
          password: form.password
        })
      });

      setSession(d.token, d.user);
      setMe(d.user);
      setScreen('app');
      setTimeout(() => enterApp(), 0);
    } catch (x) {
      setErr(x.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function login(e) {
    e.preventDefault();
    setErr('');
    setAuthLoading(true);

    try {
      const d = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          phone: form.phone,
          password: form.password
        })
      });

      setSession(d.token, d.user);
      setMe(d.user);
      setScreen('app');
      setTimeout(() => enterApp(), 0);
    } catch (x) {
      setErr(x.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function enterApp() {
    if (socketReady.current) return;
    socketReady.current = true;

    const s = connectSocket();

    s.on('connect', () => setReady(true));
    s.on('disconnect', () => setReady(false));
    s.on('connect_error', error => {
      setReady(false);
      if (/token|auth/i.test(error.message || '')) logout();
    });

    s.on('message:new', m => {
      const u = getStoredUser();
      if (!u || !u.id) return;

      const other = String(m.senderId) === String(u.id) ? m.recipientId : m.senderId;
      const c = cid(u.id, other);

      setMessages(p => {
        const current = p[c] || [];
        if (current.some(existing => existing.id === m.id)) return p;
        return { ...p, [c]: [...current, m] };
      });

      loadChats();

      if (String(activeRef.current?.id) === String(other)) {
        api('/api/messages/' + encodeURIComponent(c) + '/read', {
          method: 'POST',
          body: '{}'
        }).catch(() => {});
      }
    });

    s.on('typing:start', d => {
      if (String(activeRef.current?.id) === String(d.userId)) setTyping(true);
    });

    s.on('typing:stop', d => {
      if (String(activeRef.current?.id) === String(d.userId)) setTyping(false);
    });

    s.on('message:delivered', d => {
      setMessages(p => updateReceipt(p, d.conversationId, 'deliveredAt', d.deliveredAt));
    });

    s.on('message:read', d => {
      setMessages(p => updateReceipt(p, d.conversationId, 'readAt', d.readAt));
    });

    s.on('user:online', loadChats);
    s.on('user:offline', loadChats);

    // Incoming call: show a non-blocking card instead of a popup
    s.on('call:incoming', d => setIncoming(d));

    s.on('call:answer', async ({ answer }) => {
      if (!pc.current) return;
      await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingIce();
      setCall(p => ({ ...p, status: 'Connected' }));
      startTimer();
    });

    s.on('call:ice-candidate', async ({ candidate }) => {
      if (!candidate) return;

      if (!pc.current || !pc.current.remoteDescription) {
        pendingIce.current.push(candidate);
        return;
      }

      try {
        await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn(e);
      }
    });

    s.on('call:ended', () => {
      setIncoming(null);
      endCall(true);
    });

    s.on('call:unavailable', () => {
      setCall(c => ({ ...c, status: 'User is not online' }));
      setTimeout(() => endCall(true), 1500);
    });

    loadChats();
  }

  async function loadChats() {
    try {
      const d = await api('/api/chats');

      setContacts(d.map(x => x.contact));

      setMessages(p => {
        const c = { ...p };

        d.forEach(ch => {
          c[ch.conversationId] = c[ch.conversationId] || [];
          c[ch.conversationId].preview = ch.lastMessage;
        });

        return c;
      });
    } catch {
      setContacts([]);
    }
  }

  async function search(q) {
    if (q.trim().length < 2) {
      return loadChats();
    }

    try {
      const d = await api('/api/users?q=' + encodeURIComponent(q.trim()));
      setContacts(d);
    } catch (e) {
      console.error(e);
    }
  }

  async function openChat(u) {
    if (!u || !u.id || !me || !me.id) return;

    setActive(u);
    setTyping(false);
    setEmoji(false);

    const c = cid(me.id, u.id);

    try {
      const history = await api('/api/messages/' + encodeURIComponent(c));

      setMessages(p => ({
        ...p,
        [c]: Array.isArray(history) ? history : []
      }));

      api('/api/messages/' + encodeURIComponent(c) + '/read', {
        method: 'POST',
        body: '{}'
      }).catch(() => {});
    } catch (e) {
      console.error(e);
      alert('Could not load chat: ' + e.message);
    }
  }

  async function send(payload = {}) {
    if (!active || !me || !me.id || !active.id) return;

    const body = payload.body ?? text.trim();

    if (!body && !payload.fileUrl) return;

    const c = cid(me.id, active.id);

    const tmp = {
      id: 'tmp' + Date.now(),
      senderId: me.id,
      recipientId: active.id,
      body: body || payload.fileName || 'File',
      kind: payload.kind || 'text',
      fileUrl: payload.fileUrl,
      fileName: payload.fileName,
      fileMime: payload.fileMime,
      createdAt: new Date().toISOString(),
      local: true
    };

    setMessages(p => ({
      ...p,
      [c]: [...(p[c] || []), tmp]
    }));

    setText('');

    try {
      const saved = await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipientId: active.id,
          body: tmp.body,
          kind: tmp.kind,
          fileUrl: tmp.fileUrl,
          fileName: tmp.fileName,
          fileMime: tmp.fileMime
        })
      });

      setMessages(p => ({
        ...p,
        [c]: (p[c] || []).map(m => (m.id === tmp.id ? saved : m))
      }));

      loadChats();
    } catch (e) {
      setMessages(p => ({
        ...p,
        [c]: (p[c] || []).filter(message => message.id !== tmp.id)
      }));
      if (tmp.kind === 'text') setText(tmp.body);
      alert('Message failed: ' + e.message);
    }
  }

  async function file(e, kind) {
    const fl = e.target.files?.[0];
    e.target.value = '';

    if (!fl || !active) return;

    try {
      const up = await uploadFile(fl);

      send({
        body: kind === 'image' ? 'Photo' : up.name,
        kind: kind || (fl.type.startsWith('image/') ? 'image' : 'file'),
        fileUrl: up.url,
        fileName: up.name,
        fileMime: up.mime
      });
    } catch (e) {
      alert('Upload failed: ' + e.message);
    }
  }

  function emitTyping() {
    const s = getSocket();

    if (!s || !active || !me) return;

    s.emit('typing:start', {
      recipientId: active.id,
      conversationId: cid(me.id, active.id)
    });

    clearTimeout(typingTimer.current);

    typingTimer.current = setTimeout(() => {
      s.emit('typing:stop', { recipientId: active.id });
    }, 900);
  }

  async function createPeer(type, peerId, preserveIce = false) {
    const queuedIce = preserveIce ? [...pendingIce.current] : [];
    cleanupPeer();
    if (preserveIce) pendingIce.current = queuedIce;

    callPeer.current = peerId;

    const p = new RTCPeerConnection(rtcConfig);
    pc.current = p;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: type === 'video'
    });

    localStream.current = stream;
    setMicOn(true);
    setCamOn(type === 'video');

    stream.getTracks().forEach(tr => p.addTrack(tr, stream));

    p.ontrack = e => {
      const rs = e.streams[0];

      if (remoteAudio.current) {
        remoteAudio.current.srcObject = rs;
        remoteAudio.current.play().catch(() => {});
      }

      if (remoteVideo.current) {
        remoteVideo.current.srcObject = rs;
        remoteVideo.current.play().catch(() => {});
      }
    };

    p.onicecandidate = e => {
      if (e.candidate && callPeer.current) {
        getSocket()?.emit('call:ice-candidate', {
          recipientId: callPeer.current,
          candidate: e.candidate
        });
      }
    };

    p.onconnectionstatechange = () => {
      if (p.connectionState === 'connected') {
        setCall(c => ({ ...c, status: 'Connected' }));
        startTimer();
      }

      if (p.connectionState === 'failed') {
        setCall(c => ({ ...c, status: 'Connection failed' }));
      }
    };

    setTimeout(() => {
      if (localVideo.current) localVideo.current.srcObject = stream;
    }, 100);

    return p;
  }

  async function flushPendingIce() {
    if (!pc.current?.remoteDescription) return;
    const queued = pendingIce.current.splice(0);
    for (const candidate of queued) {
      try {
        await pc.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.warn('Could not add ICE candidate', error);
      }
    }
  }

  async function startCall(type) {
    if (!active) return;
    setCallError('');

    setCall({
      active: true,
      minimized: false,
      type,
      title: (type === 'video' ? 'Video' : 'Voice') + ' call with ' + active.username,
      status: 'Calling...',
      seconds: 0
    });

    try {
      const p = await createPeer(type, active.id);
      const offer = await p.createOffer();

      await p.setLocalDescription(offer);

      getSocket()?.emit('call:offer', {
        recipientId: active.id,
        offer,
        callType: type
      });
    } catch (e) {
      endCall(true);
      setCallError(mediaErrorMessage(e, type));
    }
  }

  // Accept the pending incoming call (from the non-blocking card)
  async function acceptCall() {
    const d = incoming;
    if (!d) return;

    setIncoming(null);

    setCall({
      active: true,
      minimized: false,
      type: d.callType,
      title: (d.callType === 'video' ? 'Video' : 'Voice') + ' call with ' + d.callerName,
      status: 'Connecting...',
      seconds: 0
    });

    try {
      const p = await createPeer(d.callType, d.callerId, true);

      await p.setRemoteDescription(new RTCSessionDescription(d.offer));
      await flushPendingIce();

      const answer = await p.createAnswer();

      await p.setLocalDescription(answer);

      getSocket()?.emit('call:answer', {
        callerId: d.callerId,
        answer
      });
    } catch (e) {
      endCall(true);
      setCallError(mediaErrorMessage(e, d.callType));
    }
  }

  // Decline the pending incoming call
  function declineCall() {
    const d = incoming;
    if (!d) return;

    setIncoming(null);
    getSocket()?.emit('call:end', { recipientId: d.callerId });
  }

  function startTimer() {
    clearInterval(timer.current);

    timer.current = setInterval(() => {
      setCall(c => (c.active ? { ...c, seconds: c.seconds + 1 } : c));
    }, 1000);
  }

  function cleanupPeer() {
    clearInterval(timer.current);
    pendingIce.current = [];

    if (pc.current) {
      pc.current.close();
      pc.current = null;
    }

    if (localStream.current) {
      localStream.current.getTracks().forEach(t => t.stop());
      localStream.current = null;
    }

    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
  }

  function endCall(skip = false) {
    if (!skip && callPeer.current) {
      getSocket()?.emit('call:end', { recipientId: callPeer.current });
    }

    cleanupPeer();

    callPeer.current = null;
    setMicOn(true);
    setCamOn(true);

    setCall({
      active: false,
      minimized: false,
      type: 'audio',
      title: '',
      status: '',
      seconds: 0
    });
  }

  // Toggle microphone on/off (button reflects the state)
  function toggleMic() {
    const tracks = localStream.current?.getAudioTracks() || [];
    if (!tracks.length) return;

    const next = !micOn;
    tracks.forEach(x => {
      x.enabled = next;
    });
    setMicOn(next);
  }

  // Toggle camera on/off during a video call
  function toggleCamera() {
    const tracks = localStream.current?.getVideoTracks() || [];
    if (!tracks.length) return;

    const next = !camOn;
    tracks.forEach(x => {
      x.enabled = next;
    });
    setCamOn(next);
  }

  function logout() {
    endCall(true);
    disconnectSocket();
    socketReady.current = false;
    clearSession();
    setMe(null);
    setActive(null);
    setContacts([]);
    setMessages({});
    setIncoming(null);
    setScreen('welcome');
  }

  const rows =
    active && me && active.id && me.id
      ? messages[cid(me.id, active.id)] || []
      : [];

  if (screen !== 'app') {
    return (
      <div className="auth">
        <div className="card">
          <div className="badge"><MessageCircle /></div>
          <h1>SecureChat</h1>
          <p>Private messaging with realtime chat and calls.</p>

          {screen === 'welcome' ? (
            <button className="primary" onClick={() => setScreen('auth')}>
              Get Started
            </button>
          ) : (
            <>
              <div className="tabs">
                <button type="button" className={authMode === 'login' ? 'on' : ''} onClick={() => setAuthMode('login')}>
                  Login
                </button>
                <button type="button" className={authMode === 'register' ? 'on' : ''} onClick={() => setAuthMode('register')}>
                  Register
                </button>
              </div>

              {err && <div className="err" role="alert">{err}</div>}

              {authMode === 'login' && (
                <form onSubmit={login}>
                  <input placeholder="Phone number" value={form.phone} onChange={e => f('phone', e.target.value)} />
                  <input placeholder="Password" type="password" value={form.password} onChange={e => f('password', e.target.value)} />
                  <button className="primary" disabled={authLoading}>
                    {authLoading ? 'Signing in…' : 'Login'}
                  </button>
                </form>
              )}

              {authMode === 'register' && (
                <form onSubmit={register}>
                  <input placeholder="Full name" value={form.username} onChange={e => f('username', e.target.value)} />
                  <input placeholder="Phone number" value={form.phone} onChange={e => f('phone', e.target.value)} />
                  <input placeholder="Password" type="password" value={form.password} onChange={e => f('password', e.target.value)} />
                  <button className="primary" disabled={authLoading}>
                    {authLoading ? 'Creating account…' : 'Create Account'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className={active ? 'side hide' : 'side'}>
        <div className="me">
          <div className="avatar">{initials(me?.username)}</div>
          <div>
            <b>{me?.username}</b>
            <small>{ready ? 'Online' : 'Offline'}</small>
          </div>
          <button className="icon" onClick={logout}><LogOut /></button>
        </div>

        <div className="search">
          <Search />
          <input placeholder="Search name or phone" onChange={e => search(e.target.value)} />
        </div>

        <div className="list">
          {contacts.length === 0 && <p className="empty">Search a user to start chatting.</p>}

          {contacts.map(u => {
            const c = me && u && u.id ? cid(me.id, u.id) : '';
            const p = messages[c]?.slice?.(-1)?.[0] || messages[c]?.preview || {};

            return (
              <button className="chat" key={u.id} onClick={() => openChat(u)}>
                <div className="avatar">{initials(u.username)}</div>
                <div>
                  <b>{u.username}</b>
                  <span>{p.body || u.phone}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main className={active ? 'panel open' : 'panel'}>
        {!active ? (
          <div className="emptyChat">
            <Lock />
            <h2>Select a chat</h2>
            <p>Search a user or open a recent conversation.</p>
          </div>
        ) : (
          <>
            <header className="head">
              <button className="icon mobile" onClick={() => setActive(null)}>
                <ArrowLeft />
              </button>

              <div className="avatar">{initials(active.username)}</div>

              <div className="title">
                <b>{active.username}</b>
                <small>{typing ? 'typing...' : active.online ? 'Online' : 'Private conversation'}</small>
              </div>

              <button className="icon" onClick={() => startCall('audio')}><Phone /></button>
              <button className="icon" onClick={() => startCall('video')}><Video /></button>
              <button className="icon" onClick={() => setProfile(active)}><User /></button>
            </header>

            <section className="msgs">
              {rows.map(m => (
                <div key={m.id} className={'bubble ' + (String(m.senderId) === String(me.id) ? 'mine' : 'theirs')}>
                  {m.kind === 'image' && m.fileUrl ? (
                    <img src={API_URL + m.fileUrl} alt={m.fileName || 'Photo'} />
                  ) : m.kind === 'file' && m.fileUrl ? (
                    <a href={API_URL + m.fileUrl} target="_blank" rel="noreferrer">
                      📎 {m.fileName || m.body}
                    </a>
                  ) : (
                    <span>{m.body}</span>
                  )}

                  <small>
                    {t(m.createdAt)} {String(m.senderId) === String(me.id) ? receipt(m) : ''}
                  </small>
                </div>
              ))}
              <div ref={endRef} />
            </section>

            <footer className="compose">
              <button className="icon" onClick={() => setEmoji(!emoji)}><Smile /></button>

              <label className="icon">
                <Image />
                <input hidden type="file" accept="image/*" onChange={e => file(e, 'image')} />
              </label>

              <label className="icon">
                <Paperclip />
                <input hidden type="file" onChange={e => file(e)} />
              </label>

              <input
                value={text}
                onChange={e => {
                  setText(e.target.value);
                  emitTyping();
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') send();
                }}
                placeholder="Message"
              />

              <button className="send" onClick={() => send()}><Send /></button>
            </footer>

            {emoji && (
              <div className="emoji">
                {emojis.map(e => (
                  <button key={e} onClick={() => setText(x => x + e)}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {incoming && !call.active && (
        <div className="incoming">
          <div className="avatar big">{initials(incoming.callerName)}</div>
          <div className="who">
            <b>{incoming.callerName}</b>
            <small>Incoming {incoming.callType === 'video' ? 'video' : 'voice'} call...</small>
          </div>
          <div className="incomingBtns">
            <button className="accept" onClick={acceptCall}>
              {incoming.callType === 'video' ? <Video /> : <Phone />}
            </button>
            <button className="danger" onClick={declineCall}><PhoneOff /></button>
          </div>
        </div>
      )}

      {call.active && !call.minimized && (
        <div className="call">
          <h2>{call.title}</h2>
          <p>
            {call.status}{' '}
            {call.seconds
              ? `• ${String(Math.floor(call.seconds / 60)).padStart(2, '0')}:${String(call.seconds % 60).padStart(2, '0')}`
              : ''}
          </p>

          {call.type === 'video' && (
            <div className="videoStage">
              <video ref={remoteVideo} autoPlay playsInline />
              <video ref={localVideo} autoPlay muted playsInline className="local" />
            </div>
          )}

          <audio ref={remoteAudio} autoPlay />

          <div className="callBtns">
            <button onClick={() => setCall(c => ({ ...c, minimized: true }))} title="Minimize">
              <Minimize2 />
            </button>

            <button
              className={micOn ? '' : 'off'}
              onClick={toggleMic}
              title={micOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              {micOn ? <Mic /> : <MicOff />}
            </button>

            {call.type === 'video' && (
              <button
                className={camOn ? '' : 'off'}
                onClick={toggleCamera}
                title={camOn ? 'Turn camera off' : 'Turn camera on'}
              >
                {camOn ? <Video /> : <VideoOff />}
              </button>
            )}

            <button className="danger" onClick={() => endCall()} title="End call">
              <PhoneOff />
            </button>
          </div>
        </div>
      )}

      {call.active && call.minimized && (
        <div className="mini" onClick={() => setCall(c => ({ ...c, minimized: false }))}>
          <Phone />
          <div>
            <b>{call.title}</b>
            <small>
              {String(Math.floor(call.seconds / 60)).padStart(2, '0')}:{String(call.seconds % 60).padStart(2, '0')}
            </small>
          </div>
          <button
            className="danger"
            onClick={e => {
              e.stopPropagation();
              endCall();
            }}
          >
            <PhoneOff />
          </button>
        </div>
      )}

      {profile && (
        <div className="modal">
          <div className="profile">
            <button onClick={() => setProfile(null)}><X /></button>
            <div className="avatar big">{initials(profile.username)}</div>
            <h2>{profile.username}</h2>
            <p>{profile.phone}</p>
            <small>{profile.about}</small>
          </div>
        </div>
      )}

      {callError && (
        <div className="modal">
          <div className="permissionCard" role="alert">
            <div className="badge small"><MicOff /></div>
            <h2>Call permission needed</h2>
            <p>{callError}</p>
            <button className="primary" onClick={() => setCallError('')}>Got it</button>
          </div>
        </div>
      )}
    </div>
  );
}
