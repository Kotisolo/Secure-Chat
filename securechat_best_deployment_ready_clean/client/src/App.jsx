import React, { useEffect, useRef, useState } from 'react';
import {
  Phone, Video, VideoOff, Send, Search, LogOut, User, Paperclip, Image,
  Smile, Mic, MicOff, PhoneOff, Minimize2, ArrowLeft, X, Lock, MessageCircle,
  KeyRound, Copy, Camera, Trash2, Volume2, VolumeX, Reply, Star, Pencil, Square,
  MoreVertical, Pin, Archive, BellOff, CalendarClock, Timer
} from 'lucide-react';
import {
  api, uploadFile, setSession, getStoredUser, getToken, clearSession, resolveFileUrl
} from './api';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import {
  E2EE_ENABLED, ensureE2EEIdentity, encryptMessage, decryptMessage
} from './e2ee';

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
const Avatar = ({ user, big = false, className = '', ...props }) => (
  <div
    className={`avatar${big ? ' big' : ''}${className ? ` ${className}` : ''}`}
    style={user?.avatarUrl ? { backgroundImage: `url("${resolveFileUrl(user.avatarUrl)}")` } : undefined}
    {...props}
  >
    {!user?.avatarUrl && initials(user?.username)}
  </div>
);
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
    password: '',
    resetPhone: '',
    recoveryCode: '',
    resetPassword: ''
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
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [chatMenu, setChatMenu] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');

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
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');

  // Media states shown on the call buttons
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [speakerVolume, setSpeakerVolume] = useState(0.7);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const pc = useRef(null);
  const localStream = useRef(null);
  const callPeer = useRef(null);
  const timer = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const remoteAudio = useRef(null);
  const remoteStream = useRef(null);
  const miniLocalVideo = useRef(null);
  const miniRemoteVideo = useRef(null);
  const endRef = useRef(null);
  const typingTimer = useRef(null);
  const socketReady = useRef(false);
  const activeRef = useRef(null);
  const pendingIce = useRef([]);
  const mediaRecorder = useRef(null);
  const recordingStream = useRef(null);
  const recordingChunks = useRef([]);
  const recordingTimer = useRef(null);

  useEffect(() => {
    if (!call.active) return undefined;

    const frame = requestAnimationFrame(attachCallMedia);
    return () => cancelAnimationFrame(frame);
  }, [call.active, call.minimized, call.type]);

  useEffect(() => {
    if (remoteAudio.current) {
      remoteAudio.current.volume = speakerMuted ? 0 : speakerVolume;
    }
  }, [speakerMuted, speakerVolume, call.active]);

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
      setRecoveryCode(d.recoveryCode || '');
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

  async function resetPassword(e) {
    e.preventDefault();
    setErr('');
    setAuthLoading(true);

    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          phone: form.resetPhone,
          recoveryCode: form.recoveryCode,
          password: form.resetPassword
        })
      });
      setAuthMode('login');
      setForm(current => ({
        ...current,
        password: '',
        resetPassword: '',
        recoveryCode: ''
      }));
      setErr('Password changed. Please log in with your new password.');
    } catch (error) {
      setErr(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function createRecoveryCode() {
    try {
      const result = await api('/api/auth/recovery-code', { method: 'POST', body: '{}' });
      setRecoveryCode(result.recoveryCode);
    } catch (error) {
      alert('Could not create recovery code: ' + error.message);
    }
  }

  async function enterApp() {
    if (socketReady.current) return;
    socketReady.current = true;

    const s = connectSocket();

    s.on('connect', () => {
      setReady(true);
      if (E2EE_ENABLED) {
        ensureE2EEIdentity()
          .then(() => setEncryptionReady(true))
          .catch(error => {
            console.error('E2EE initialization failed', error);
            setEncryptionReady(false);
          });
      }
    });
    s.on('disconnect', () => setReady(false));
    s.on('connect_error', error => {
      setReady(false);
      if (/token|auth/i.test(error.message || '')) logout();
    });

    s.on('message:new', async m => {
      const u = getStoredUser();
      if (!u || !u.id) return;

      const other = String(m.senderId) === String(u.id) ? m.recipientId : m.senderId;
      const c = cid(u.id, other);
      let displayMessage = m;
      if (E2EE_ENABLED && m.ciphertext) {
        try {
          displayMessage = await decryptMessage(m, c);
        } catch (error) {
          console.error('Could not decrypt message', error);
          displayMessage = { ...m, body: 'Unable to decrypt this message.', decryptionFailed: true };
        }
      }

      setMessages(p => {
        const current = p[c] || [];
        if (current.some(existing => existing.id === displayMessage.id)) return p;
        return { ...p, [c]: [...current, displayMessage] };
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

    s.on('message:deleted', d => {
      setMessages(current => ({
        ...current,
        [d.conversationId]: (current[d.conversationId] || []).filter(message => message.id !== d.messageId)
      }));
    });

    s.on('message:reaction', applyReaction);

    s.on('message:updated', async message => {
      let displayMessage = message;
      if (E2EE_ENABLED && message.ciphertext) {
        try {
          displayMessage = await decryptMessage(message, message.conversationId);
        } catch {
          displayMessage = { ...message, body: 'Unable to decrypt this edited message.' };
        }
      }
      setMessages(current => ({
        ...current,
        [message.conversationId]: (current[message.conversationId] || []).map(existing => (
          existing.id === message.id ? { ...existing, ...displayMessage } : existing
        ))
      }));
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

      setContacts(d.map(x => ({
        ...x.contact,
        chat: {
          pinned: x.pinned,
          archived: x.archived,
          mutedUntil: x.mutedUntil,
          unreadCount: x.unreadCount,
          disappearingSeconds: x.disappearingSeconds
        }
      })));

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
      const displayHistory = E2EE_ENABLED
        ? await Promise.all((Array.isArray(history) ? history : []).map(async message => {
            if (!message.ciphertext) return message;
            try {
              return await decryptMessage(message, c);
            } catch (error) {
              console.error('Could not decrypt history message', error);
              return { ...message, body: 'Unable to decrypt this message.', decryptionFailed: true };
            }
          }))
        : history;

      setMessages(p => ({
        ...p,
        [c]: Array.isArray(displayHistory) ? displayHistory : []
      }));

      api('/api/messages/' + encodeURIComponent(c) + '/read', {
        method: 'POST',
        body: '{}'
      }).then(loadChats).catch(() => {});
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
      replyToId: payload.replyToId || replyTo?.id || null,
      scheduledAt: payload.scheduledAt || (scheduledAt ? new Date(scheduledAt).toISOString() : null),
      createdAt: new Date().toISOString(),
      local: true
    };

    setMessages(p => ({
      ...p,
      [c]: [...(p[c] || []), tmp]
    }));

    setText('');
    setReplyTo(null);
    setScheduledAt('');
    setShowScheduler(false);

    try {
      const encryptedPayload = E2EE_ENABLED && tmp.kind === 'text'
        ? await encryptMessage(active.id, c, tmp.body)
        : {};
      const saved = await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipientId: active.id,
          body: encryptedPayload.ciphertext ? '[Encrypted message]' : tmp.body,
          kind: tmp.kind,
          fileUrl: tmp.fileUrl,
          fileName: tmp.fileName,
          fileMime: tmp.fileMime,
          replyToId: tmp.replyToId,
          scheduledAt: tmp.scheduledAt,
          ...encryptedPayload
        })
      });

      setMessages(p => ({
        ...p,
        [c]: (p[c] || []).map(m => (
          m.id === tmp.id
            ? { ...saved, body: tmp.body, encrypted: Boolean(encryptedPayload.ciphertext) }
            : m
        ))
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
    if (E2EE_ENABLED) {
      alert('Encrypted attachments are not enabled in this beta yet. Send text only.');
      return;
    }

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

  async function uploadAvatar(e) {
    const image = e.target.files?.[0];
    e.target.value = '';
    if (!image) return;

    try {
      const formData = new FormData();
      formData.append('file', image);
      const updated = await api('/api/profile/avatar', { method: 'POST', body: formData });
      setMe(updated);
      setProfile(updated);
      setSession(getToken(), updated);
    } catch (error) {
      alert('Profile photo failed: ' + error.message);
    }
  }

  async function deleteMessage(scope = 'me') {
    if (!selectedMessage || !active || !me) return;
    const conversationId = cid(me.id, active.id);
    const messageId = selectedMessage.id;
    try {
      if (!String(messageId).startsWith('tmp')) {
        await api(
          '/api/messages/' + encodeURIComponent(messageId) + (scope === 'everyone' ? '?scope=everyone' : ''),
          { method: 'DELETE' }
        );
      }
      setMessages(current => ({
        ...current,
        [conversationId]: (current[conversationId] || []).filter(message => message.id !== messageId)
      }));
      setSelectedMessage(null);
      loadChats();
    } catch (error) {
      alert('Could not delete message: ' + error.message);
    }
  }

  async function updateChatPreference(contact, changes) {
    const conversationId = cid(me.id, contact.id);
    const current = contact.chat || {};
    try {
      await api(`/api/chats/${encodeURIComponent(conversationId)}/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
          pinned: Boolean(current.pinned),
          archived: Boolean(current.archived),
          mutedUntil: current.mutedUntil || null,
          disappearingSeconds: current.disappearingSeconds || 0,
          ...changes
        })
      });
      setChatMenu(null);
      await loadChats();
    } catch (error) {
      alert('Could not update chat: ' + error.message);
    }
  }

  async function startVoiceRecording() {
    if (!active || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      alert('Voice recording is not supported by this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      const preferredTypes = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingStream.current = stream;
      recordingChunks.current = [];
      mediaRecorder.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size) recordingChunks.current.push(event.data);
      };
      recorder.onstop = async () => {
        clearInterval(recordingTimer.current);
        stream.getTracks().forEach(track => track.stop());
        const type = recorder.mimeType || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(recordingChunks.current, { type });
        recordingChunks.current = [];
        recordingStream.current = null;
        if (!blob.size) return;
        try {
          const voiceFile = new File([blob], `voice-${Date.now()}.${extension}`, { type });
          const uploaded = await uploadFile(voiceFile);
          await send({
            body: 'Voice message',
            kind: 'audio',
            fileUrl: uploaded.url,
            fileName: uploaded.name,
            fileMime: uploaded.mime
          });
        } catch (error) {
          alert('Voice message failed: ' + error.message);
        }
      };
      recorder.start(250);
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimer.current = setInterval(() => setRecordingSeconds(value => value + 1), 1000);
    } catch (error) {
      alert(mediaErrorMessage(error, 'audio'));
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    mediaRecorder.current = null;
    setRecording(false);
    setRecordingSeconds(0);
  }

  function beginReply() {
    setReplyTo(selectedMessage);
    setSelectedMessage(null);
  }

  async function copyMessage() {
    await navigator.clipboard.writeText(selectedMessage?.body || '');
    setSelectedMessage(null);
  }

  async function toggleStar() {
    if (!selectedMessage || String(selectedMessage.id).startsWith('tmp')) return;
    try {
      const result = await api(`/api/messages/${encodeURIComponent(selectedMessage.id)}/star`, {
        method: 'POST',
        body: '{}'
      });
      const c = cid(me.id, active.id);
      setMessages(current => ({
        ...current,
        [c]: (current[c] || []).map(message => (
          message.id === selectedMessage.id ? { ...message, starred: result.starred } : message
        ))
      }));
      setSelectedMessage(null);
    } catch (error) {
      alert('Could not star message: ' + error.message);
    }
  }

  async function reactToMessage(emojiValue) {
    if (!selectedMessage || String(selectedMessage.id).startsWith('tmp')) return;
    try {
      const result = await api(`/api/messages/${encodeURIComponent(selectedMessage.id)}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ emoji: emojiValue })
      });
      applyReaction(result);
      setSelectedMessage(null);
    } catch (error) {
      alert('Could not add reaction: ' + error.message);
    }
  }

  function applyReaction({ conversationId, messageId, userId, emoji: emojiValue }) {
    setMessages(current => ({
      ...current,
      [conversationId]: (current[conversationId] || []).map(message => {
        if (message.id !== messageId) return message;
        const reactions = (message.reactions || []).filter(reaction => String(reaction.userId) !== String(userId));
        return { ...message, reactions: [...reactions, { userId, emoji: emojiValue }] };
      })
    }));
  }

  function beginEdit() {
    setEditingMessage(selectedMessage);
    setText(selectedMessage.body || '');
    setSelectedMessage(null);
  }

  async function saveEdit() {
    if (!editingMessage || !text.trim()) return;
    const c = cid(me.id, active.id);
    try {
      const encryptedPayload = E2EE_ENABLED
        ? await encryptMessage(active.id, c, text.trim())
        : {};
      const updated = await api(`/api/messages/${encodeURIComponent(editingMessage.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          body: text.trim(),
          ...encryptedPayload
        })
      });
      setMessages(current => ({
        ...current,
        [c]: (current[c] || []).map(message => (
          message.id === editingMessage.id
            ? { ...message, ...updated, body: text.trim() }
            : message
        ))
      }));
      setEditingMessage(null);
      setText('');
    } catch (error) {
      alert('Could not edit message: ' + error.message);
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
    attachCallMedia();

    stream.getTracks().forEach(tr => p.addTrack(tr, stream));

    p.ontrack = e => {
      const rs = e.streams[0];
      remoteStream.current = rs;
      attachCallMedia();
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

    setTimeout(attachCallMedia, 100);

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
    setRecoveryCode('');

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

    remoteStream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    if (miniLocalVideo.current) miniLocalVideo.current.srcObject = null;
    if (miniRemoteVideo.current) miniRemoteVideo.current.srcObject = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
  }

  function attachCallMedia() {
    const attach = (element, stream) => {
      if (!element || !stream) return;
      if (element.srcObject !== stream) element.srcObject = stream;
      element.play?.().catch(() => {});
    };

    attach(localVideo.current, localStream.current);
    attach(miniLocalVideo.current, localStream.current);
    attach(remoteVideo.current, remoteStream.current);
    attach(miniRemoteVideo.current, remoteStream.current);
    attach(remoteAudio.current, remoteStream.current);
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
  const displayRows = messageSearch.trim()
    ? rows.filter(message => (message.body || '').toLowerCase().includes(messageSearch.trim().toLowerCase()))
    : rows;

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
                  <button type="button" className="link" onClick={() => {
                    setErr('');
                    setAuthMode('reset');
                  }}>
                    Forgot password?
                  </button>
                </form>
              )}

              {authMode === 'reset' && (
                <form onSubmit={resetPassword}>
                  <input
                    placeholder="Registered phone number"
                    value={form.resetPhone}
                    onChange={e => f('resetPhone', e.target.value)}
                    required
                  />
                  <input
                    placeholder="Recovery code"
                    value={form.recoveryCode}
                    onChange={e => f('recoveryCode', e.target.value.toUpperCase())}
                    required
                  />
                  <input
                    placeholder="New password"
                    type="password"
                    value={form.resetPassword}
                    onChange={e => f('resetPassword', e.target.value)}
                    minLength={8}
                    required
                  />
                  <button className="primary" disabled={authLoading}>
                    {authLoading ? 'Changing password…' : 'Reset Password'}
                  </button>
                  <button type="button" className="link" onClick={() => {
                    setErr('');
                    setAuthMode('login');
                  }}>
                    Back to login
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
          <Avatar user={me} className="avatarButton" onClick={() => setProfile(me)} title="Change profile photo" />
          <div>
            <b>{me?.username}</b>
            <small>{ready ? 'Online' : 'Offline'}</small>
          </div>
          <button className="icon" onClick={logout}><LogOut /></button>
          <button className="icon" onClick={createRecoveryCode} title="Create recovery code"><KeyRound /></button>
        </div>

        <div className="search">
          <Search />
          <input placeholder="Search name or phone" onChange={e => search(e.target.value)} />
        </div>
        <button className="archiveToggle" onClick={() => setShowArchived(value => !value)}>
          <Archive /> {showArchived ? 'Back to chats' : 'Archived chats'}
        </button>

        <div className="list">
          {contacts.length === 0 && <p className="empty">Search a user to start chatting.</p>}

          {contacts.filter(u => Boolean(u.chat?.archived) === showArchived).map(u => {
            const c = me && u && u.id ? cid(me.id, u.id) : '';
            const p = messages[c]?.slice?.(-1)?.[0] || messages[c]?.preview || {};

            return (
              <div className="chat" key={u.id}>
                <button className="chatMain" onClick={() => openChat(u)}>
                <Avatar user={u} />
                <div>
                  <b>{u.chat?.pinned ? '📌 ' : ''}{u.username}</b>
                  <span>{p.body || u.phone}</span>
                </div>
                {u.chat?.unreadCount > 0 && <strong className="unreadBadge">{u.chat.unreadCount}</strong>}
                </button>
                <button className="chatMore" onClick={() => setChatMenu(chatMenu?.id === u.id ? null : u)}>
                  <MoreVertical />
                </button>
                {chatMenu?.id === u.id && (
                  <div className="chatMenu">
                    <button onClick={() => updateChatPreference(u, { pinned: !u.chat?.pinned })}>
                      <Pin /> {u.chat?.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button onClick={() => updateChatPreference(u, { archived: !u.chat?.archived })}>
                      <Archive /> {u.chat?.archived ? 'Unarchive' : 'Archive'}
                    </button>
                    <button onClick={() => updateChatPreference(u, {
                      mutedUntil: u.chat?.mutedUntil && new Date(u.chat.mutedUntil) > new Date()
                        ? null
                        : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
                    })}>
                      <BellOff /> {u.chat?.mutedUntil && new Date(u.chat.mutedUntil) > new Date() ? 'Unmute' : 'Mute 8 hours'}
                    </button>
                    <button onClick={() => updateChatPreference(u, {
                      disappearingSeconds: u.chat?.disappearingSeconds ? 0 : 86400
                    })}>
                      <Timer /> {u.chat?.disappearingSeconds ? 'Turn off disappearing' : 'Disappear after 24h'}
                    </button>
                  </div>
                )}
              </div>
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

              <Avatar user={active} />

              <div className="title">
                <b>{active.username}</b>
                <small>
                  {typing
                    ? 'typing...'
                    : E2EE_ENABLED
                      ? encryptionReady ? 'End-to-end encrypted beta' : 'Preparing encryption...'
                      : active.online ? 'Online' : 'Private conversation'}
                </small>
              </div>

              <button className="icon" onClick={() => startCall('audio')}><Phone /></button>
              <button className="icon" onClick={() => startCall('video')}><Video /></button>
              <button className="icon" onClick={() => setSearchingMessages(value => !value)}><Search /></button>
              <button className="icon" onClick={() => setProfile(active)}><User /></button>
            </header>

            {searchingMessages && (
              <div className="messageSearch">
                <Search />
                <input autoFocus value={messageSearch} onChange={e => setMessageSearch(e.target.value)} placeholder="Search this chat" />
                <button onClick={() => {
                  setSearchingMessages(false);
                  setMessageSearch('');
                }}><X /></button>
              </div>
            )}

            <section className="msgs">
              {displayRows.map(m => {
                const repliedMessage = m.replyToId
                  ? rows.find(row => row.id === m.replyToId)
                  : null;
                return (
                <div
                  key={m.id}
                  className={'bubble messagePress ' + (String(m.senderId) === String(me.id) ? 'mine' : 'theirs')}
                  onClick={() => setSelectedMessage(m)}
                  title="Press to select this message"
                >
                  {repliedMessage && (
                    <div className="replyPreview">
                      <b>{String(repliedMessage.senderId) === String(me.id) ? 'You' : active.username}</b>
                      <span>{repliedMessage.body}</span>
                    </div>
                  )}
                  {m.kind === 'image' && m.fileUrl ? (
                    <img src={resolveFileUrl(m.fileUrl)} alt={m.fileName || 'Photo'} />
                  ) : m.kind === 'file' && m.fileUrl ? (
                    <a href={resolveFileUrl(m.fileUrl)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                      📎 {m.fileName || m.body}
                    </a>
                  ) : m.kind === 'audio' && m.fileUrl ? (
                    <audio
                      className="voiceMessage"
                      src={resolveFileUrl(m.fileUrl)}
                      controls
                      preload="metadata"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span>{m.body}</span>
                  )}

                  <small>
                    {m.starred ? '★ ' : ''}{m.editedAt ? 'edited · ' : ''}
                    {m.scheduledAt && !m.sentAt ? `scheduled ${new Date(m.scheduledAt).toLocaleString()} · ` : ''}
                    {m.expiresAt ? 'disappearing · ' : ''}
                    {t(m.createdAt)} {String(m.senderId) === String(me.id) ? receipt(m) : ''}
                  </small>
                  {m.reactions?.length > 0 && (
                    <div className="reactionRow">
                      {m.reactions.map((reaction, index) => (
                        <span key={`${reaction.userId}-${index}`}>{reaction.emoji}</span>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
              <div ref={endRef} />
            </section>

            {(replyTo || editingMessage) && (
              <div className="composeContext">
                <div>
                  <b>{editingMessage ? 'Editing message' : `Replying to ${String(replyTo?.senderId) === String(me.id) ? 'yourself' : active.username}`}</b>
                  <span>{editingMessage?.body || replyTo?.body}</span>
                </div>
                <button onClick={() => {
                  setReplyTo(null);
                  setEditingMessage(null);
                  if (editingMessage) setText('');
                }}><X /></button>
              </div>
            )}

            {showScheduler && (
              <div className="scheduleBar">
                <CalendarClock />
                <input
                  type="datetime-local"
                  min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                />
                <button onClick={() => {
                  setShowScheduler(false);
                  setScheduledAt('');
                }}><X /></button>
              </div>
            )}

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

              <label className="icon" title="Take photo">
                <Camera />
                <input hidden type="file" accept="image/*" capture="environment" onChange={e => file(e, 'image')} />
              </label>

              <button className="icon" onClick={() => setShowScheduler(value => !value)} title="Schedule message">
                <CalendarClock />
              </button>

              {recording ? (
                <div className="recordingStatus">
                  <span />
                  Recording {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
                </div>
              ) : <input
                value={text}
                onChange={e => {
                  setText(e.target.value);
                  emitTyping();
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') editingMessage ? saveEdit() : send();
                }}
                placeholder={editingMessage ? 'Edit message' : 'Message'}
              />}

              <button
                className={recording ? 'send recordingStop' : 'send'}
                onClick={recording
                  ? stopVoiceRecording
                  : text.trim() || editingMessage
                    ? editingMessage ? saveEdit : () => send()
                    : startVoiceRecording}
                title={recording ? 'Stop and send recording' : text.trim() || editingMessage ? 'Send message' : 'Record voice message'}
              >
                {recording ? <Square /> : text.trim() || editingMessage ? <Send /> : <Mic />}
              </button>
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
          <Avatar user={{ username: incoming.callerName }} big />
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
          <div className="callInfo">
            <h2>{call.title}</h2>
            <p>
              {call.status}{' '}
              {call.seconds
                ? `• ${String(Math.floor(call.seconds / 60)).padStart(2, '0')}:${String(call.seconds % 60).padStart(2, '0')}`
                : ''}
            </p>
          </div>

          {call.type === 'video' && (
            <div className="videoStage">
              <video ref={remoteVideo} autoPlay muted playsInline />
              <video ref={localVideo} autoPlay muted playsInline className="local" />
            </div>
          )}

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

            <div className="speakerControl">
              <button
                className={speakerMuted ? 'off' : ''}
                onClick={() => setSpeakerMuted(value => !value)}
                title={speakerMuted ? 'Turn speaker on' : 'Mute speaker'}
              >
                {speakerMuted ? <VolumeX /> : <Volume2 />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={speakerVolume}
                aria-label="Speaker volume"
                onChange={e => {
                  setSpeakerVolume(Number(e.target.value));
                  setSpeakerMuted(false);
                }}
              />
            </div>

            <button className="danger" onClick={() => endCall()} title="End call">
              <PhoneOff />
            </button>
          </div>
        </div>
      )}

      {call.active && <audio ref={remoteAudio} autoPlay className="callAudio" />}

      {call.active && call.minimized && (
        call.type === 'video' ? (
          <div className="mini videoMini" onClick={() => setCall(c => ({ ...c, minimized: false }))}>
            <video ref={miniRemoteVideo} autoPlay muted playsInline />
            <video ref={miniLocalVideo} autoPlay muted playsInline className="miniLocalVideo" />
            <div className="miniOverlay">
              <b>{call.title}</b>
              <small>
                {String(Math.floor(call.seconds / 60)).padStart(2, '0')}:{String(call.seconds % 60).padStart(2, '0')}
              </small>
            </div>
            <button
              className="danger miniEnd"
              onClick={e => {
                e.stopPropagation();
                endCall();
              }}
              title="End call"
            >
              <PhoneOff />
            </button>
          </div>
        ) : (
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
        )
      )}

      {selectedMessage && (
        <div className="modal" onClick={() => setSelectedMessage(null)}>
          <div className="messageMenu" onClick={e => e.stopPropagation()}>
            <h3>Message actions</h3>
            <div className="reactionPicker">
              {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(value => (
                <button key={value} onClick={() => reactToMessage(value)}>{value}</button>
              ))}
            </div>
            <div className="messageActionGrid">
              <button onClick={beginReply}><Reply /> Reply</button>
              <button onClick={copyMessage}><Copy /> Copy</button>
              <button onClick={toggleStar}><Star /> {selectedMessage.starred ? 'Unstar' : 'Star'}</button>
              {String(selectedMessage.senderId) === String(me?.id) && selectedMessage.kind === 'text' && (
                <button onClick={beginEdit}><Pencil /> Edit</button>
              )}
              <button className="danger" onClick={() => deleteMessage('me')}><Trash2 /> Delete for me</button>
              {String(selectedMessage.senderId) === String(me?.id) && (
                <button className="danger" onClick={() => deleteMessage('everyone')}><Trash2 /> Delete for everyone</button>
              )}
            </div>
            <button className="menuCancel" onClick={() => setSelectedMessage(null)}>Cancel</button>
          </div>
        </div>
      )}

      {profile && (
        <div className="modal">
          <div className="profile">
            <button onClick={() => setProfile(null)}><X /></button>
            <Avatar user={profile} big />
            <h2>{profile.username}</h2>
            <p>{profile.phone}</p>
            <small>{profile.about}</small>
            {String(profile.id) === String(me?.id) && (
              <label className="profilePhoto">
                <Camera />
                Change profile photo
                <input hidden type="file" accept="image/*" onChange={uploadAvatar} />
              </label>
            )}
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

      {recoveryCode && (
        <div className="modal">
          <div className="permissionCard recoveryCard" role="dialog" aria-modal="true">
            <div className="badge small"><KeyRound /></div>
            <h2>Save your recovery code</h2>
            <p>This code is shown only now. Keep it private—you will need it if you forget your password.</p>
            <code>{recoveryCode}</code>
            <button className="copyRecovery" onClick={() => navigator.clipboard.writeText(recoveryCode)}>
              <Copy /> Copy code
            </button>
            <button className="primary" onClick={() => setRecoveryCode('')}>I saved it</button>
          </div>
        </div>
      )}
    </div>
  );
}
