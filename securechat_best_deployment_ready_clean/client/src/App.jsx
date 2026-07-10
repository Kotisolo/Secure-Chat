import React, { useEffect, useRef, useState } from 'react';
import {
  Phone, Video, VideoOff, Send, Search, LogOut, User, Paperclip, Image,
  Smile, Mic, MicOff, PhoneOff, Minimize2, ArrowLeft, X, Lock, MessageCircle,
  KeyRound, Copy, Camera, Trash2, Volume2, VolumeX, Reply, Star, Pencil, Square,
  Archive, BellOff, CalendarClock, Languages, History, Bell,
  Shield, Ban, Flag, Users, Plus, Settings, Eye, EyeOff
} from 'lucide-react';
import {
  api, uploadFile, setSession, getStoredUser, getToken, clearSession, resolveFileUrl
} from './api';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } from 'livekit-client';
import QRCode from 'qrcode';
import { BRAND } from './branding';
import {
  E2EE_ENABLED, ensureE2EEIdentity, encryptMessage, decryptMessage,
  encryptAttachment, decryptAttachment, encryptGroupMessage, decryptGroupMessage
} from './e2ee';

const emojis = '😀 😃 😄 😁 😆 😅 😂 🙂 😊 😍 😘 😎 😢 😭 😡 👍 👎 🙏 🔥 ❤️ 🎉 ✅ 💯'.split(' ');

const stickers = ['😀', '😂', '😍', '🥳', '😎', '😭', '😡', '👍', '🙏', '❤️', '🔥', '🎉'];

const defaultMeteredTurnUrls = [
  'stun:stun.relay.metered.ca:80',
  'turn:standard.relay.metered.ca:80',
  'turn:standard.relay.metered.ca:80?transport=tcp',
  'turn:standard.relay.metered.ca:443',
  'turns:standard.relay.metered.ca:443?transport=tcp'
];
const configuredTurnUrls = String(import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || '')
  .split(',')
  .map(url => url.trim())
  .filter(Boolean)
  .filter(url => /^(turns?|stun):/i.test(url));
const turnUsername = import.meta.env.VITE_TURN_USERNAME || '';
const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL || '';
const meteredFallbackUrls = configuredTurnUrls.length ? [] : defaultMeteredTurnUrls;
const turnUrls = [
  ...new Set([
    ...configuredTurnUrls,
    ...(turnUsername && turnCredential ? meteredFallbackUrls : [])
  ])
];
const hasTurnServer = turnUrls.some(url => /^turns?:/i.test(url)) && Boolean(turnUsername && turnCredential);
const staticTurnIceServers = hasTurnServer
  ? turnUrls.map(url => ({
      urls: url,
      ...(/^(turns?):/i.test(url)
        ? {
            username: turnUsername,
            credential: turnCredential,
            credentialType: 'password'
          }
        : {})
    }))
  : [];
const buildRtcConfig = (dynamicIceServers = []) => ({
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ...iceServersForNetwork(Array.isArray(dynamicIceServers) && dynamicIceServers.length ? dynamicIceServers : staticTurnIceServers)
  ],
  iceCandidatePoolSize: isLowDataNetwork() ? 2 : 10,
  iceTransportPolicy: 'all'
});
const lowDataNetworkTypes = new Set(['slow-2g', '2g', '3g']);
const isLowDataNetwork = () => {
  const connection = typeof navigator !== 'undefined' ? navigator.connection || navigator.mozConnection || navigator.webkitConnection : null;
  return Boolean(
    connection?.saveData ||
    connection?.type === 'cellular' ||
    lowDataNetworkTypes.has(String(connection?.effectiveType || '').toLowerCase())
  );
};
const isTcpOrTlsTurnUrl = url => /^(stun):/i.test(url) ||
  (/^turns:/i.test(url)) ||
  (/^turn:/i.test(url) && /transport=tcp/i.test(url)) ||
  (/^turn:[^?]+:443($|\?)/i.test(url));
const iceServersForNetwork = servers => {
  if (!isLowDataNetwork()) return servers;
  return servers
    .map(server => {
      if (!server?.urls) return null;
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      const safeUrls = urls.filter(url => isTcpOrTlsTurnUrl(String(url)));
      if (!safeUrls.length) return null;
      return { ...server, urls: Array.isArray(server.urls) ? safeUrls : safeUrls[0] };
    })
    .filter(Boolean);
};
const standardVideoCallConstraints = {
  width: { ideal: 426, max: 640 },
  height: { ideal: 240, max: 360 },
  frameRate: { ideal: 12, max: 15 },
  facingMode: 'user',
  resizeMode: 'crop-and-scale'
};
const mobileDataVideoCallConstraints = {
  width: { ideal: 320, max: 426 },
  height: { ideal: 180, max: 240 },
  frameRate: { ideal: 8, max: 10 },
  facingMode: 'user',
  resizeMode: 'crop-and-scale'
};
const videoConstraintsForNetwork = () => (
  isLowDataNetwork() ? mobileDataVideoCallConstraints : standardVideoCallConstraints
);
const callNetworkInfo = () => {
  const connection = typeof navigator !== 'undefined' ? navigator.connection || navigator.mozConnection || navigator.webkitConnection : null;
  return {
    type: connection?.type || 'unknown',
    effectiveType: connection?.effectiveType || 'unknown',
    saveData: Boolean(connection?.saveData),
    downlink: typeof connection?.downlink === 'number' ? connection.downlink : null,
    rtt: typeof connection?.rtt === 'number' ? connection.rtt : null
  };
};
const tuneMobileVideoSender = async (peer, lowData = isLowDataNetwork()) => {
  const sender = peer.getSenders?.().find(item => item.track?.kind === 'video');
  if (!sender?.getParameters || !sender?.setParameters) return;
  const params = sender.getParameters();
  params.encodings = params.encodings?.length ? params.encodings : [{}];
  params.encodings[0] = {
    ...params.encodings[0],
    maxBitrate: lowData ? 160000 : 280000,
    maxFramerate: lowData ? 10 : 15,
    scaleResolutionDownBy: Math.max(params.encodings[0].scaleResolutionDownBy || 1, lowData ? 1.5 : 1)
  };
  params.degradationPreference = 'maintain-framerate';
  try {
    await sender.setParameters(params);
  } catch (error) {
    console.warn('Could not tune video bitrate', error);
  }
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
const StreamVideo = ({ stream, muted = false }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} />;
};
const StreamAudio = ({ stream }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
};
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
  const deviceLabel = type === 'video' ? 'camera and microphone' : 'microphone';
  const denied = error?.name === 'NotAllowedError' || /permission denied|not allowed/i.test(error?.message || '');
  if (denied) {
    return `${deviceLabel} access is blocked by the browser or Windows. Allow Camera/Microphone in Chrome site settings and Windows Privacy settings, then reload the page.`;
  }
  if (error?.name === 'NotFoundError') {
    return `No ${deviceLabel} was found on this device. Connect a device or choose the correct input in Chrome settings.`;
  }
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return `Chrome can see your ${deviceLabel}, but cannot start it. Close other apps using it, such as Teams, Zoom, Camera, or another browser tab, then reload.`;
  }
  if (error?.name === 'OverconstrainedError') {
    return `The selected ${deviceLabel} does not support the requested call settings. Try another camera/microphone in Chrome settings.`;
  }
  if (error?.name === 'SecurityError') {
    return `${deviceLabel} is blocked by browser security settings. Make sure you are using HTTPS and allow the device for this site.`;
  }
  return `The call could not start: ${error?.name || 'Unknown error'}${error?.message ? ` - ${error.message}` : ''}`;
};

const emitWithAck = (socket, eventName, payload, timeout = 15000) => new Promise((resolve, reject) => {
  if (!socket?.connected) {
    reject(new Error('Chat server is not connected. Please refresh the app and try again.'));
    return;
  }

  if (typeof socket.timeout === 'function') {
    socket.timeout(timeout).emit(eventName, payload, (error, response) => {
      if (error) {
        console.warn(`${eventName} confirmation timed out; continuing because the signal may still be delivered.`);
        resolve({ ok: true, timedOut: true });
      }
      else resolve(response || { ok: true });
    });
    return;
  }

  socket.emit(eventName, payload);
  resolve({ ok: true });
});

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
    confirmPassword: '',
    twoStepPin: '',
    resetPhone: '',
    recoveryCode: '',
    resetPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(true);

  const [me, setMe] = useState(storedUser && storedUser.id ? storedUser : null);
  const [ready, setReady] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState({});
  const [active, setActive] = useState(null);
  const [mobileTab, setMobileTab] = useState('chats');
  const [chatListFilter, setChatListFilter] = useState('all');
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [showComposerTools, setShowComposerTools] = useState(false);
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
  const [translations, setTranslations] = useState({});
  const [attachmentUrls, setAttachmentUrls] = useState({});
  const [callHistory, setCallHistory] = useState([]);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [callFilter, setCallFilter] = useState('all');
  const [selectedCallLog, setSelectedCallLog] = useState(null);
  const [privacy, setPrivacy] = useState(null);
  const [security, setSecurity] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMessages, setGroupMessages] = useState({});
  const [groupText, setGroupText] = useState('');
  const [groupInvite, setGroupInvite] = useState(null);
  const [selectedGroupMessage, setSelectedGroupMessage] = useState(null);
  const [groupRecording, setGroupRecording] = useState(false);
  const [groupTyping, setGroupTyping] = useState({});
  const [groupCall, setGroupCall] = useState(null);
  const [groupRemoteStreams, setGroupRemoteStreams] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [showStatuses, setShowStatuses] = useState(false);
  const [statusExcluded, setStatusExcluded] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [channelPosts, setChannelPosts] = useState([]);
  const [showChannels, setShowChannels] = useState(false);
  const chatPressTimer = useRef(null);
  const chatPressTriggered = useRef(false);
  const selectedChannelRef = useRef(null);
  const groupTypingTimer = useRef(null);
  const groupCallStream = useRef(null);
  const groupPeers = useRef(new Map());
  const selectedGroupRef = useRef(null);
  const groupsRef = useRef([]);

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
  const [miniCallPosition, setMiniCallPosition] = useState(null);

  const pc = useRef(null);
  const liveKitRoom = useRef(null);
  const liveKitLocalTracks = useRef([]);
  const localStream = useRef(null);
  const callPeer = useRef(null);
  const timer = useRef(null);
  const callTimeout = useRef(null);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const remoteAudio = useRef(null);
  const remoteStream = useRef(null);
  const remoteAudioStream = useRef(null);
  const miniLocalVideo = useRef(null);
  const miniRemoteVideo = useRef(null);
  const miniDrag = useRef({ dragging: false, moved: false });
  const endRef = useRef(null);
  const typingTimer = useRef(null);
  const turnCredentialCache = useRef({ iceServers: null, expiresAt: 0 });
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
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.getRegistrations?.()
      .then(registrations => registrations.forEach(registration => registration.unregister()))
      .catch(() => {});

    window.caches?.keys?.()
      .then(keys => Promise.all(keys.map(key => window.caches.delete(key))))
      .catch(() => {});
  }, []);

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

  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
  }, [selectedGroup]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  async function register(e) {
    e.preventDefault();
    setErr('');

    if (form.password !== form.confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }

    if (!termsAccepted) {
      setErr('Please agree to the Terms of Service and Privacy Policy.');
      return;
    }

    setAuthLoading(true);

    try {
      const d = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username,
          phone: form.phone,
          password: form.password,
          deviceName: navigator.userAgent
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
          password: form.password,
          twoStepPin: form.twoStepPin,
          deviceName: navigator.userAgent
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
      if (document.hidden || String(activeRef.current?.id) !== String(other)) {
        showNotification('New SecureChat message', displayMessage.kind === 'text' ? displayMessage.body : `New ${displayMessage.kind}`);
      }

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

    s.on('user:profile-updated', updatedUser => {
      setContacts(current => current.map(contact => (
        String(contact.id) === String(updatedUser.id) ? { ...contact, ...updatedUser } : contact
      )));
      setActive(current => (
        String(current?.id) === String(updatedUser.id) ? { ...current, ...updatedUser } : current
      ));
      setProfile(current => (
        String(current?.id) === String(updatedUser.id) ? { ...current, ...updatedUser } : current
      ));
      loadChats();
    });

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
    s.on('call:incoming', d => {
      setIncoming(d);
      showNotification(`Incoming ${d.videoIntent ? 'video' : d.callType} call`, d.callerName);
    });

    s.on('security:new-login', d => {
      showNotification('New SecureChat login', d.deviceName);
      alert(`New login detected: ${d.deviceName}`);
    });

    s.on('call:answer', async ({ answer }) => {
      if (answer?.livekit) {
        clearTimeout(callTimeout.current);
        setCall(p => ({ ...p, status: 'Connecting media...' }));
        return;
      }
      if (!pc.current) return;
      clearTimeout(callTimeout.current);
      await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
      await flushPendingIce();
      setCall(p => ({ ...p, status: 'Connecting securely...' }));
    });

    s.on('call:renegotiate-offer', async ({ offer, peerId }) => {
      if (!pc.current || !offer || !peerId) return;
      try {
        callPeer.current = peerId;
        await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingIce();
        const answer = await pc.current.createAnswer();
        await pc.current.setLocalDescription(answer);
        await emitWithAck(getSocket(), 'call:renegotiate-answer', {
          recipientId: peerId,
          answer
        });
        setCall(current => ({ ...current, status: 'Video updated' }));
      } catch (error) {
        console.warn('Could not accept call video update', error);
      }
    });

    s.on('call:renegotiate-answer', async ({ answer }) => {
      if (!pc.current || !answer) return;
      try {
        await pc.current.setRemoteDescription(new RTCSessionDescription(answer));
        setCall(current => ({ ...current, status: 'Video updated' }));
      } catch (error) {
        console.warn('Could not finish call video update', error);
      }
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
    loadGroups();
  }

  async function loadGroups() {
    try {
      setGroups(await api('/api/groups'));
    } catch {
      setGroups([]);
    }
  }

  async function loadStatuses() {
    try {
      const rows = await api('/api/status');
      const decrypted = (await Promise.all(rows.map(async status => {
        try {
          return await decodeStatus(status);
        } catch (error) {
          console.warn('Could not decode status', error);
          return { ...status, body: 'Unable to load this Status update.' };
        }
      }))).filter(Boolean);
      setStatuses(decrypted);
      setShowStatuses(true);
    } catch (error) {
      alert('Could not load Status: ' + error.message);
    }
  }

  async function loadChannels(query = '', openModal = true) {
    try {
      setChannels(await api('/api/channels?q=' + encodeURIComponent(query)));
      if (openModal) setShowChannels(true);
    } catch (error) {
      alert('Could not load Channels: ' + error.message);
    }
  }

  async function createChannel() {
    const name = prompt('Channel name:');
    if (!name) return;
    const description = prompt('Channel description (optional):') || '';
    await api('/api/channels', {
      method: 'POST', body: JSON.stringify({ name, description })
    });

    s.on('channel:post', event => {
      showNotification(`New update from ${event.channelName}`, event.body || `New ${event.kind}`);
      if (String(selectedChannelRef.current?.id) === String(event.channelId)) {
        setChannelPosts(current => current.some(post => post.id === event.id)
          ? current
          : [{ ...event, reactions: [] }, ...current]);
      }
    });
    await loadChannels();
  }

  async function openChannel(channel) {
    setSelectedChannel(channel);
    setChannelPosts(await api(`/api/channels/${channel.id}/posts`));
    setShowChannels(true);
  }

  async function toggleChannelFollow(channel) {
    await api(`/api/channels/${channel.id}/follow`, {
      method: channel.following ? 'DELETE' : 'POST',
      body: channel.following ? undefined : '{}'
    });
    setChannels(current => current.map(item => item.id === channel.id
      ? { ...item, following: !item.following, followerCount: item.followerCount + (item.following ? -1 : 1) }
      : item));
    setSelectedChannel(current => current?.id === channel.id ? { ...current, following: !current.following } : current);
  }

  async function publishChannelPost() {
    const body = prompt('Write a channel update:');
    if (!body || !selectedChannel) return;
    await api(`/api/channels/${selectedChannel.id}/posts`, {
      method: 'POST', body: JSON.stringify({ body, kind: 'text' })
    });
    setChannelPosts(await api(`/api/channels/${selectedChannel.id}/posts`));
  }

  async function publishChannelMedia(event, kind) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedChannel) return;
    try {
      const uploaded = await uploadFile(file);
      await api(`/api/channels/${selectedChannel.id}/posts`, {
        method: 'POST',
        body: JSON.stringify({
          body: kind === 'image' ? 'Photo update' : kind === 'video' ? 'Video update' : file.name,
          kind, fileUrl: uploaded.url, fileName: file.name, fileMime: file.type
        })
      });
      setChannelPosts(await api(`/api/channels/${selectedChannel.id}/posts`));
    } catch (error) {
      alert('Channel media failed: ' + error.message);
    }
  }

  async function reactChannelPost(post, emoji) {
    const reaction = await api(`/api/channels/${selectedChannel.id}/posts/${post.id}/reaction`, {
      method: 'POST', body: JSON.stringify({ emoji })
    });
    setChannelPosts(current => current.map(item => item.id !== post.id ? item : {
      ...item,
      reactions: [...(item.reactions || []).filter(value => value.userId !== reaction.userId), reaction]
    }));
  }

  async function decodeStatus(status) {
    if (!status.payload) return { ...status, body: 'Status update is unavailable.' };
    const plaintext = await decryptGroupMessage(status.userId, `status:${status.id}`, status.payload);
    try {
      const content = JSON.parse(plaintext);
      if (!content.fileUrl) return { ...status, body: plaintext };
      const mediaUrl = await decryptAttachment({
        ...content,
        senderId: status.userId,
        recipientId: me.id
      }, `status:${status.id}`);
      return { ...status, ...content, mediaUrl };
    } catch {
      return { ...status, body: plaintext };
    }
  }

  async function createTextStatus() {
    const body = prompt('Write a Status update:');
    if (!body) return;
    const id = crypto.randomUUID();
    const audience = statusAudience();
    try {
      const entries = await Promise.all(audience.map(async user => [
        user.id, await encryptGroupMessage(user.id, `status:${id}`, body)
      ]));
      await api('/api/status', {
        method: 'POST',
        body: JSON.stringify({ id, kind: 'text', payloads: Object.fromEntries(entries) })
      });
      await loadStatuses();
    } catch (error) {
      alert('Status failed: ' + error.message);
    }
  }

  function statusAudience() {
    return [...new Map([me, ...contacts]
      .filter(user => user?.id && (user.id === me.id || !statusExcluded.includes(user.id)))
      .map(user => [user.id, user])).values()];
  }

  async function createMediaStatus(event, kind) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const id = crypto.randomUUID();
    const audience = statusAudience();
    try {
      const entries = await Promise.all(audience.map(async user => {
        const encrypted = await encryptAttachment(user.id, `status:${id}`, file);
        const uploaded = await uploadFile(encrypted.file);
        const content = JSON.stringify({
          body: kind === 'image' ? 'Photo Status' : kind === 'video' ? 'Video Status' : 'Voice Status',
          kind, fileUrl: uploaded.url, fileName: file.name, fileMime: file.type,
          fileEncryption: encrypted.fileEncryption, senderDeviceId: encrypted.senderDeviceId
        });
        return [user.id, await encryptGroupMessage(user.id, `status:${id}`, content)];
      }));
      await api('/api/status', {
        method: 'POST',
        body: JSON.stringify({ id, kind, payloads: Object.fromEntries(entries) })
      });
      await loadStatuses();
    } catch (error) {
      alert('Media Status failed: ' + error.message);
    }
  }

  async function viewStatus(status, reaction) {
    await api(`/api/status/${status.id}/view`, {
      method: 'POST', body: JSON.stringify({ reaction: reaction || null })
    });
    setStatuses(current => current.map(item => item.id === status.id ? { ...item, viewed: true } : item));
  }

  async function deleteStatus(statusId) {
    await api(`/api/status/${statusId}`, { method: 'DELETE' });
    setStatuses(current => current.filter(status => status.id !== statusId));
  }

  async function replyToStatus(status) {
    const body = prompt(`Reply privately to ${status.username}:`);
    if (!body) return;
    const conversationId = cid(me.id, status.userId);
    const encrypted = await encryptMessage(status.userId, conversationId, body);
    await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        recipientId: status.userId,
        body: '[Encrypted message]',
        kind: 'text',
        ...encrypted
      })
    });
    await viewStatus(status);
    alert('Private encrypted reply sent.');
  }

  async function toggleStatusMute(status) {
    const muted = !status.muted;
    await api(`/api/status/mute/${status.userId}`, {
      method: 'PATCH', body: JSON.stringify({ muted })
    });
    setStatuses(current => current.map(item => item.userId === status.userId ? { ...item, muted } : item));
  }

  async function createGroup() {
    const name = prompt('Group name:');
    if (!name) return;
    const description = prompt('Group description (optional):') || '';
    await api('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description, memberIds: [] })
    });

    s.on('group:message', async message => {
      try {
        const display = await decodeGroupMessage(message, message.groupId);
        display.mentioned = display.body?.toLowerCase().includes(`@${getStoredUser()?.username?.toLowerCase()}`);
        setGroupMessages(current => {
          const rows = current[message.groupId] || [];
          if (rows.some(row => row.id === message.id)) return current;
          return { ...current, [message.groupId]: [...rows, display] };
        });
        if (String(selectedGroupRef.current?.id) !== String(message.groupId)) {
          const group = groupsRef.current.find(item => String(item.id) === String(message.groupId));
          const muted = group?.mutedUntil && new Date(group.mutedUntil) > new Date();
          if (!muted || display.mentioned) {
            showNotification(display.mentioned ? `You were mentioned in ${group?.name || 'a group'}` : `New message in ${group?.name || 'a group'}`, display.body);
          }
          loadGroups();
        }
      } catch (error) {
        console.error('Group message decryption failed', error);
      }
    });
    await loadGroups();
  }

  async function openGroup(group) {
    setSelectedGroup(group);
    try {
      const history = await api(`/api/groups/${group.id}/messages`);
      const decrypted = await Promise.all(history.map(message => decodeGroupMessage(message, group.id)));
      setGroupMessages(current => ({ ...current, [group.id]: decrypted }));
      await api(`/api/groups/${group.id}/read`, { method: 'POST', body: '{}' });
      loadGroups();
    } catch (error) {
      alert('Could not open encrypted group chat: ' + error.message);
    }
  }

  async function sendGroupMessage(messageBody, kind = 'text') {
    const body = typeof messageBody === 'string' ? messageBody : groupText.trim();
    const group = selectedGroup;
    if (!body || !group) return;
    try {
      const entries = await Promise.all(group.members.map(async member => [
        member.id,
        await encryptGroupMessage(member.id, group.id, body)
      ]));
      const saved = await api(`/api/groups/${group.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ kind, payloads: Object.fromEntries(entries) })
      });
      setGroupMessages(current => {
        const rows = current[group.id] || [];
        return rows.some(row => row.id === saved.id)
          ? current
          : { ...current, [group.id]: [...rows, { ...saved, body, kind }] };
      });
      setGroupText('');
    } catch (error) {
      alert('Group message failed: ' + error.message);
    }
  }

  async function addGroupMember() {
    const userId = prompt('Enter the user ID to add:');
    if (!userId || !selectedGroup) return;
    await api(`/api/groups/${selectedGroup.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    await loadGroups();
    setSelectedGroup((await api('/api/groups')).find(group => group.id === selectedGroup.id));
  }

  async function decodeGroupMessage(message, groupId) {
    const plaintext = await decryptGroupMessage(message.senderId, groupId, message.payload);
    try {
      const content = JSON.parse(plaintext);
      if (!content.fileUrl) return { ...message, body: plaintext };
      const mediaUrl = await decryptAttachment({
        ...content,
        senderId: message.senderId,
        recipientId: me.id
      }, `group:${groupId}`);
      return { ...message, ...content, body: content.body, mediaUrl };
    } catch {
      return { ...message, body: plaintext };
    }
  }

  function emitGroupTyping() {
    if (!selectedGroup) return;
    getSocket()?.emit('group:typing', { groupId: selectedGroup.id, typing: true });
    clearTimeout(groupTypingTimer.current);
    groupTypingTimer.current = setTimeout(() => {
      getSocket()?.emit('group:typing', { groupId: selectedGroup.id, typing: false });
    }, 900);
  }

  async function toggleGroupMute() {
    const muted = selectedGroup.mutedUntil && new Date(selectedGroup.mutedUntil) > new Date();
    const mutedUntil = muted ? null : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await api(`/api/groups/${selectedGroup.id}/mute`, {
      method: 'PATCH', body: JSON.stringify({ mutedUntil })
    });
    setSelectedGroup(current => ({ ...current, mutedUntil }));
    loadGroups();
  }

  async function sendGroupFile(event, kind) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedGroup) return;
    try {
      const entries = await Promise.all(selectedGroup.members.map(async member => {
        const encrypted = await encryptAttachment(member.id, `group:${selectedGroup.id}`, file);
        const uploaded = await uploadFile(encrypted.file);
        const content = JSON.stringify({
          body: kind === 'image' ? 'Photo' : file.name,
          kind, fileUrl: uploaded.url, fileName: file.name, fileMime: file.type,
          fileEncryption: encrypted.fileEncryption, senderDeviceId: encrypted.senderDeviceId
        });
        return [member.id, await encryptGroupMessage(member.id, selectedGroup.id, content)];
      }));
      await api(`/api/groups/${selectedGroup.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ kind, payloads: Object.fromEntries(entries) })
      });
    } catch (error) {
      alert('Encrypted group attachment failed: ' + error.message);
    }
  }

  async function startGroupVoiceRecording() {
    if (groupRecording || !selectedGroup) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks = [];
      mediaRecorder.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setGroupRecording(false);
        const voice = new File([new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })],
          `group-voice-${Date.now()}.webm`, { type: recorder.mimeType || 'audio/webm' });
        try {
          const entries = await Promise.all(selectedGroup.members.map(async member => {
            const encrypted = await encryptAttachment(member.id, `group:${selectedGroup.id}`, voice);
            const uploaded = await uploadFile(encrypted.file);
            const content = JSON.stringify({
              body: 'Voice message', kind: 'audio', fileUrl: uploaded.url,
              fileName: voice.name, fileMime: voice.type,
              fileEncryption: encrypted.fileEncryption, senderDeviceId: encrypted.senderDeviceId
            });
            return [member.id, await encryptGroupMessage(member.id, selectedGroup.id, content)];
          }));
          await api(`/api/groups/${selectedGroup.id}/messages`, {
            method: 'POST', body: JSON.stringify({ kind: 'audio', payloads: Object.fromEntries(entries) })
          });
        } catch (error) {
          alert('Group voice message failed: ' + error.message);
        }
      };
      recorder.start(250);
      setGroupRecording(true);
    } catch (error) {
      alert(mediaErrorMessage(error, 'audio'));
    }
  }

  function stopGroupVoiceRecording() {
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    mediaRecorder.current = null;
  }

  async function startGroupCall(type) {
    if (!selectedGroup || groupCall) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        },
        video: type === 'video' ? videoConstraintsForNetwork() : false
      });
      groupCallStream.current = stream;
      setGroupRemoteStreams({});
      setGroupCall({
        groupId: selectedGroup.id, title: selectedGroup.name,
        type, micOn: true, camOn: type === 'video'
      });
      getSocket()?.emit('group-call:join', { groupId: selectedGroup.id, callType: type });
    } catch (error) {
      alert(mediaErrorMessage(error, type));
    }
  }

  function createGroupPeer(userId, makeOffer) {
    if (groupPeers.current.has(userId)) return groupPeers.current.get(userId);
    const peer = new RTCPeerConnection(buildRtcConfig());
    groupCallStream.current?.getTracks().forEach(track => peer.addTrack(track, groupCallStream.current));
    if (groupCallStream.current?.getVideoTracks?.().length) tuneMobileVideoSender(peer);
    peer.onicecandidate = event => {
      if (event.candidate) getSocket()?.emit('group-call:ice', {
        groupId: groupCall?.groupId || selectedGroupRef.current?.id,
        targetUserId: userId, data: event.candidate
      });
    };
    peer.ontrack = event => {
      setGroupRemoteStreams(current => ({ ...current, [userId]: event.streams[0] }));
    };
    groupPeers.current.set(userId, peer);
    if (makeOffer) {
      (async () => {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        getSocket()?.emit('group-call:offer', {
          groupId: groupCall?.groupId || selectedGroupRef.current?.id,
          targetUserId: userId, data: offer
        });
      })();
    }
    return peer;
  }

  function removeGroupPeer(userId) {
    groupPeers.current.get(userId)?.close();
    groupPeers.current.delete(userId);
    setGroupRemoteStreams(current => {
      const next = { ...current };
      delete next[userId];
      return next;
    });
  }

  function leaveGroupCall() {
    const groupId = groupCall?.groupId;
    if (groupId) getSocket()?.emit('group-call:leave', { groupId });
    groupPeers.current.forEach(peer => peer.close());
    groupPeers.current.clear();
    groupCallStream.current?.getTracks().forEach(track => track.stop());
    groupCallStream.current = null;
    setGroupRemoteStreams({});
    setGroupCall(null);
  }

  function toggleGroupCallMic() {
    const track = groupCallStream.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setGroupCall(current => ({ ...current, micOn: track.enabled }));
  }

  function toggleGroupCallCamera() {
    const track = groupCallStream.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setGroupCall(current => ({ ...current, camOn: track.enabled }));
  }

  async function reactGroupMessage(emoji) {
    await api(`/api/groups/${selectedGroup.id}/messages/${selectedGroupMessage.id}/reaction`, {
      method: 'POST', body: JSON.stringify({ emoji })
    });
    setSelectedGroupMessage(null);
  }

  async function deleteGroupMessage() {
    await api(`/api/groups/${selectedGroup.id}/messages/${selectedGroupMessage.id}`, { method: 'DELETE' });
    setSelectedGroupMessage(null);
  }

  async function editGroup() {
    const name = prompt('Group name:', selectedGroup.name);
    if (!name) return;
    const description = prompt('Group description:', selectedGroup.description || '') || '';
    await api(`/api/groups/${selectedGroup.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, description })
    });
    s.on('group:message-deleted', event => {
      setGroupMessages(current => ({
        ...current,
        [event.groupId]: (current[event.groupId] || []).filter(message => message.id !== event.messageId)
      }));
    });
    s.on('group:reaction', event => {
      setGroupMessages(current => ({
        ...current,
        [event.groupId]: (current[event.groupId] || []).map(message => message.id !== event.messageId ? message : {
          ...message,
          reactions: [...(message.reactions || []).filter(reaction => reaction.userId !== event.userId), {
            userId: event.userId, emoji: event.emoji
          }]
        })
      }));
    });
    s.on('group:typing', event => {
      setGroupTyping(current => ({ ...current, [event.groupId]: event.typing ? event.username : '' }));
    });

    s.on('group-call:participant-joined', participant => {
      createGroupPeer(participant.userId, true);
    });
    s.on('group-call:offer', async event => {
      const peer = createGroupPeer(event.fromUserId, false);
      await peer.setRemoteDescription(new RTCSessionDescription(event.data));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      getSocket()?.emit('group-call:answer', {
        groupId: event.groupId, targetUserId: event.fromUserId, data: answer
      });
    });
    s.on('group-call:answer', async event => {
      await groupPeers.current.get(event.fromUserId)?.setRemoteDescription(new RTCSessionDescription(event.data));
    });
    s.on('group-call:ice', async event => {
      try {
        await groupPeers.current.get(event.fromUserId)?.addIceCandidate(new RTCIceCandidate(event.data));
      } catch {}
    });
    s.on('group-call:participant-left', event => removeGroupPeer(event.userId));
    s.on('group-call:error', event => {
      alert(event.message);
      leaveGroupCall();
    });
    await loadGroups();
    setSelectedGroup(current => ({ ...current, name, description }));
  }

  async function changeGroupRole(member) {
    const role = member.role === 'admin' ? 'member' : 'admin';
    await api(`/api/groups/${selectedGroup.id}/members/${member.id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });
    const refreshed = await api('/api/groups');
    setGroups(refreshed);
    setSelectedGroup(refreshed.find(group => group.id === selectedGroup.id));
  }

  async function createGroupInvite() {
    const result = await api(`/api/groups/${selectedGroup.id}/invite`, { method: 'POST', body: '{}' });
    const url = `${location.origin}/?groupInvite=${encodeURIComponent(result.token)}`;
    setGroupInvite({ url, qr: await QRCode.toDataURL(url, { width: 220, margin: 1 }) });
  }

  async function revokeGroupInvite() {
    await api(`/api/groups/${selectedGroup.id}/invite`, { method: 'DELETE' });
    setGroupInvite(null);
  }

  async function joinGroup() {
    const value = prompt('Paste a SecureChat group invite link or token:');
    if (!value) return;
    const token = value.includes('groupInvite=')
      ? new URL(value).searchParams.get('groupInvite')
      : value.trim();
    await api(`/api/groups/join/${encodeURIComponent(token)}`, { method: 'POST', body: '{}' });
    await loadGroups();
  }

  async function removeGroupMember(userId) {
    await api(`/api/groups/${selectedGroup.id}/members/${userId}`, { method: 'DELETE' });
    const refreshed = await api('/api/groups');
    setGroups(refreshed);
    setSelectedGroup(refreshed.find(group => group.id === selectedGroup.id) || null);
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
      fileEncryption: payload.fileEncryption,
      senderDeviceId: payload.senderDeviceId,
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
      const encryptedPayload = E2EE_ENABLED && ['text', 'sticker'].includes(tmp.kind)
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
          fileEncryption: tmp.fileEncryption,
          replyToId: tmp.replyToId,
          scheduledAt: tmp.scheduledAt,
          senderDeviceId: encryptedPayload.senderDeviceId || tmp.senderDeviceId,
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

    try {
      const conversationId = cid(me.id, active.id);
      const encrypted = E2EE_ENABLED
        ? await encryptAttachment(active.id, conversationId, fl)
        : null;
      const up = await uploadFile(encrypted?.file || fl);

      send({
        body: kind === 'image' ? 'Photo' : fl.name,
        kind: kind || (fl.type.startsWith('image/') ? 'image' : 'file'),
        fileUrl: up.url,
        fileName: fl.name,
        fileMime: fl.type,
        fileEncryption: encrypted?.fileEncryption,
        senderDeviceId: encrypted?.senderDeviceId
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

  async function requestNotifications() {
    if (!('Notification' in window)) return alert('Notifications are not supported by this browser.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') alert('Notifications remain disabled. You can enable them from the browser site settings.');
  }

  async function loadCallHistory() {
    try {
      setCallHistory(await api('/api/calls'));
      setShowCallHistory(true);
    } catch (error) {
      alert('Could not load call history: ' + error.message);
    }
  }

  async function callBackFromLog(type = selectedCallLog?.type || 'audio') {
    if (!selectedCallLog) return;
    const contact = contacts.find(item => String(item.id) === String(selectedCallLog.contactId)) || {
      id: selectedCallLog.contactId,
      username: selectedCallLog.contactName,
      avatarUrl: selectedCallLog.contactAvatar
    };
    setSelectedCallLog(null);
    setShowCallHistory(false);
    setActive(contact);
    await startCall(type, contact);
  }

  async function deleteCallLog() {
    if (!selectedCallLog) return;
    try {
      await api(`/api/calls/${encodeURIComponent(selectedCallLog.id)}`, { method: 'DELETE' });
      setCallHistory(current => current.filter(item => item.id !== selectedCallLog.id));
      setSelectedCallLog(null);
    } catch (error) {
      alert('Could not delete call log: ' + error.message);
    }
  }

  async function openPrivacy() {
    try {
      setPrivacy(await api('/api/privacy'));
    } catch (error) {
      alert('Could not load privacy settings: ' + error.message);
    }
  }

  async function openSecurity() {
    try {
      setSecurity(await api('/api/security'));
    } catch (error) {
      alert('Could not load account security: ' + error.message);
    }
  }

  async function revokeSession(sessionId) {
    await api(`/api/security/sessions/${sessionId}`, { method: 'DELETE' });
    setSecurity(current => ({
      ...current,
      sessions: current.sessions.filter(session => session.id !== sessionId)
    }));
  }

  async function revokeOtherSessions() {
    await api('/api/security/sessions', { method: 'DELETE' });
    setSecurity(current => ({
      ...current,
      sessions: current.sessions.filter(session => session.current)
    }));
  }

  async function toggleTwoStep() {
    const password = prompt('Enter your current account password:');
    if (!password) return;
    if (security.twoStepEnabled) {
      await api('/api/security/two-step', {
        method: 'DELETE',
        body: JSON.stringify({ password })
      });
      setSecurity(current => ({ ...current, twoStepEnabled: false }));
      return;
    }
    const pin = prompt('Choose a 6-digit two-step verification PIN:');
    if (!/^\d{6}$/.test(pin || '')) return alert('PIN must contain exactly 6 digits.');
    await api('/api/security/two-step', {
      method: 'POST',
      body: JSON.stringify({ password, pin })
    });
    setSecurity(current => ({ ...current, twoStepEnabled: true }));
  }

  async function changePassword() {
    const currentPassword = prompt('Enter your current password:');
    if (!currentPassword) return;
    const newPassword = prompt('Enter a new password (at least 8 characters):');
    if (!newPassword) return;
    await api('/api/security/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    alert('Password changed. Other devices were logged out.');
    openSecurity();
  }

  async function downloadAccountData() {
    const data = await api('/api/account/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `securechat-data-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteAccount() {
    if (!confirm('Permanently delete your account, messages and call history? This cannot be undone.')) return;
    const password = prompt('Enter your password to permanently delete the account:');
    if (!password) return;
    await api('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) });
    setSecurity(null);
    logout();
  }

  async function savePrivacy(next) {
    setPrivacy(next);
    try {
      await api('/api/privacy', { method: 'PATCH', body: JSON.stringify(next) });
    } catch (error) {
      alert('Could not save privacy settings: ' + error.message);
    }
  }

  async function blockProfile() {
    if (!profile || !confirm(`Block ${profile.username}? They will not be able to message or call you.`)) return;
    await api(`/api/users/${profile.id}/block`, { method: 'POST', body: '{}' });
    setProfile(null);
    setActive(null);
    loadChats();
  }

  async function reportProfile() {
    if (!profile) return;
    const reason = prompt('Why are you reporting this user?');
    if (!reason) return;
    await api(`/api/users/${profile.id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
    alert('Report submitted.');
  }

  async function unblockUser(userId) {
    await api(`/api/users/${userId}/block`, { method: 'DELETE' });
    setPrivacy(current => ({
      ...current,
      blockedUsers: (current.blockedUsers || []).filter(user => user.id !== userId)
    }));
  }

  function showNotification(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    navigator.serviceWorker?.ready
      .then(registration => registration.showNotification(title, {
        body,
        tag: title
      }))
      .catch(() => new Notification(title, { body }));
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

  async function deleteChatForMe(contact) {
    if (!me || !contact) return;
    if (!confirm(`Delete chat with ${contact.username}? This only removes it from your chat list.`)) return;
    const conversationId = cid(me.id, contact.id);
    try {
      await api(`/api/chats/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
      setChatMenu(null);
      if (active?.id === contact.id) setActive(null);
      setMessages(current => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      await loadChats();
    } catch (error) {
      alert('Could not delete chat: ' + error.message);
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
          const conversationId = cid(me.id, active.id);
          const encrypted = E2EE_ENABLED
            ? await encryptAttachment(active.id, conversationId, voiceFile)
            : null;
          const uploaded = await uploadFile(encrypted?.file || voiceFile);
          await send({
            body: 'Voice message',
            kind: 'audio',
            fileUrl: uploaded.url,
            fileName: voiceFile.name,
            fileMime: voiceFile.type,
            fileEncryption: encrypted?.fileEncryption,
            senderDeviceId: encrypted?.senderDeviceId
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

  async function translateSelectedMessage() {
    if (!selectedMessage?.body) return;
    if (!globalThis.LanguageDetector || !globalThis.Translator) {
      alert('Private on-device translation is available in supported desktop Chrome versions. It is not available in this browser yet.');
      return;
    }
    const targetLanguage = prompt(
      'Translate to language code (for example: en, es, hi, te, fr):',
      (navigator.language || 'en').split('-')[0]
    );
    if (!targetLanguage) return;
    try {
      const detector = await globalThis.LanguageDetector.create();
      const detected = await detector.detect(selectedMessage.body);
      const sourceLanguage = detected[0]?.detectedLanguage;
      if (!sourceLanguage) throw new Error('Language could not be detected.');
      if (sourceLanguage === targetLanguage) {
        setTranslations(current => ({ ...current, [selectedMessage.id]: selectedMessage.body }));
      } else {
        const translator = await globalThis.Translator.create({ sourceLanguage, targetLanguage });
        const translated = await translator.translate(selectedMessage.body);
        setTranslations(current => ({ ...current, [selectedMessage.id]: translated }));
      }
      setSelectedMessage(null);
    } catch (error) {
      alert('Translation failed: ' + error.message);
    }
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

  async function loadRtcConfig() {
    if (turnCredentialCache.current.iceServers && turnCredentialCache.current.expiresAt > Date.now()) {
      return buildRtcConfig(turnCredentialCache.current.iceServers);
    }

    try {
      const result = await api('/api/turn/credentials');
      const iceServers = Array.isArray(result?.iceServers) ? result.iceServers : [];
      if (iceServers.length) {
        turnCredentialCache.current = {
          iceServers,
          expiresAt: Date.now() + 4 * 60 * 1000
        };
        return buildRtcConfig(iceServers);
      }
    } catch (error) {
      console.warn('Could not load dynamic TURN credentials; using fallback TURN settings.', error);
    }

    return buildRtcConfig();
  }

  async function createPeer(type, peerId, preserveIce = false) {
    const queuedIce = preserveIce ? [...pendingIce.current] : [];
    cleanupPeer();
    if (preserveIce) pendingIce.current = queuedIce;

    callPeer.current = peerId;

    const p = new RTCPeerConnection(await loadRtcConfig());
    pc.current = p;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: type === 'video' ? videoConstraintsForNetwork() : false
    });

    localStream.current = stream;
    setMicOn(true);
    setCamOn(type === 'video');
    attachCallMedia();

    stream.getTracks().forEach(tr => p.addTrack(tr, stream));
    if (type === 'video') await tuneMobileVideoSender(p);

    p.ontrack = e => {
      const incomingStream = e.streams?.[0];
      const nextStream = remoteStream.current || new MediaStream();
      const incomingTracks = incomingStream?.getTracks?.().length
        ? incomingStream.getTracks()
        : [e.track].filter(Boolean);

      incomingTracks.forEach(track => {
        if (!nextStream.getTracks().some(existing => existing.id === track.id)) {
          nextStream.addTrack(track);
        }
      });

      remoteStream.current = nextStream;
      if (nextStream.getVideoTracks?.().length) {
        setCall(current => ({ ...current, type: 'video', videoCapable: true }));
      }
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

    p.onicecandidateerror = event => {
      console.warn('ICE server error', event.errorCode, event.errorText);
      if (event.url?.startsWith('turn') && !hasTurnServer) {
        setCall(c => ({ ...c, status: 'TURN relay is not configured' }));
      }
    };

    p.oniceconnectionstatechange = () => {
      if (p.iceConnectionState === 'checking') {
        setCall(c => ({ ...c, status: 'Connecting securely...' }));
      }
      if (p.iceConnectionState === 'failed') {
        setCall(c => ({
          ...c,
          status: hasTurnServer
            ? 'TURN relay connection failed. Check the relay settings and try again.'
            : 'A TURN relay is required for this mobile network.'
        }));
      }
    };

    p.onconnectionstatechange = () => {
      if (p.connectionState === 'connected') {
        clearTimeout(callTimeout.current);
        setCall(c => ({
          ...c,
          status: c.type === 'video' && !(localStream.current?.getVideoTracks?.().length)
            ? 'Connected - tap camera to start video'
            : 'Connected'
        }));
        startTimer();
      }

      if (p.connectionState === 'failed') {
        clearTimeout(callTimeout.current);
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

  async function startCall(type, contactOverride = null) {
    const callContact = contactOverride || active;
    if (!callContact) return;
    setCallError('');
    clearTimeout(callTimeout.current);

    setCall({
      active: true,
      minimized: false,
      type,
      videoCapable: type === 'video',
      title: (type === 'video' ? 'Video' : 'Voice') + ' call with ' + callContact.username,
      status: 'Calling...',
      seconds: 0
    });

    try {
      await connectLiveKitCall(callContact.id, type);

      const ack = await emitWithAck(getSocket(), 'call:offer', {
        recipientId: callContact.id,
        offer: { livekit: true },
        callType: type,
        videoIntent: type === 'video',
        network: callNetworkInfo()
      });

      if (ack && ack.ok === false) throw new Error(ack.message || 'Could not start the call.');

      setCall(current => ({ ...current, status: 'Ringing...' }));
      callTimeout.current = setTimeout(() => {
        if (!remoteStream.current?.getTracks?.().length && !liveKitRoom.current?.remoteParticipants?.size) {
          setCall(current => ({ ...current, status: 'Call did not connect.' }));
          setCallError('The call did not connect. Make sure both users are online, keep the app open on both phones, allow microphone/camera, and try again.');
          endCall(true);
        }
      }, 70000);
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
    clearTimeout(callTimeout.current);
    const callType = d.videoIntent ? 'video' : d.callType;

    setCall({
      active: true,
      minimized: false,
      type: callType,
      videoCapable: callType === 'video',
      title: (callType === 'video' ? 'Video' : 'Voice') + ' call with ' + d.callerName,
      status: 'Connecting...',
      seconds: 0
    });

    try {
      await connectLiveKitCall(d.callerId, callType);

      const ack = await emitWithAck(getSocket(), 'call:answer', {
        callerId: d.callerId,
        answer: { livekit: true },
        network: callNetworkInfo()
      });

      if (ack && ack.ok === false) throw new Error(ack.message || 'Could not answer the call.');

      setCall(current => ({ ...current, status: 'Connecting media...' }));
      callTimeout.current = setTimeout(() => {
        if (!remoteStream.current?.getTracks?.().length && !liveKitRoom.current?.remoteParticipants?.size) {
          setCall(current => ({ ...current, status: 'Network blocked the call.' }));
          setCallError('The call answer was sent, but the devices could not connect. Please try again with both users online and permissions allowed.');
          endCall(true);
        }
      }, 70000);
    } catch (e) {
      endCall(true);
      setCallError(mediaErrorMessage(e, callType));
    }
  }

  // Decline the pending incoming call
  function declineCall() {
    const d = incoming;
    if (!d) return;

    setIncoming(null);
    getSocket()?.emit('call:decline', { callerId: d.callerId });
  }

  function startTimer() {
    clearInterval(timer.current);

    timer.current = setInterval(() => {
      setCall(c => (c.active ? { ...c, seconds: c.seconds + 1 } : c));
    }, 1000);
  }

  function cleanupPeer() {
    clearInterval(timer.current);
    clearTimeout(callTimeout.current);
    pendingIce.current = [];

    if (pc.current) {
      pc.current.close();
      pc.current = null;
    }
    void disconnectLiveKit();

    if (localStream.current) {
      localStream.current.getTracks().forEach(t => t.stop());
      localStream.current = null;
    }

    remoteStream.current = null;
    remoteAudioStream.current = null;
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

    const audioTracks = remoteStream.current?.getAudioTracks?.() || [];
    if (audioTracks.length) {
      const currentTracks = remoteAudioStream.current?.getTracks?.() || [];
      const sameTracks = currentTracks.length === audioTracks.length &&
        currentTracks.every(track => audioTracks.some(nextTrack => nextTrack.id === track.id));

      if (!sameTracks) {
        remoteAudioStream.current = new MediaStream(audioTracks);
      }
    }

    attach(localVideo.current, localStream.current);
    attach(miniLocalVideo.current, localStream.current);
    attach(remoteVideo.current, remoteStream.current);
    attach(miniRemoteVideo.current, remoteStream.current);
    attach(remoteAudio.current, remoteAudioStream.current || remoteStream.current);
  }

  async function disconnectLiveKit() {
    liveKitLocalTracks.current.forEach(track => {
      try { track.stop(); } catch {}
    });
    liveKitLocalTracks.current = [];
    if (liveKitRoom.current) {
      const room = liveKitRoom.current;
      liveKitRoom.current = null;
      try { room.disconnect(); } catch {}
    }
  }

  function rebuildLiveKitStreams() {
    const room = liveKitRoom.current;
    if (!room) return;

    const localTracks = liveKitLocalTracks.current.map(track => track.mediaStreamTrack).filter(Boolean);
    localStream.current = localTracks.length ? new MediaStream(localTracks) : null;

    const remoteTracks = [];
    room.remoteParticipants.forEach(participant => {
      participant.trackPublications.forEach(publication => {
        const track = publication.track;
        if (track?.mediaStreamTrack) remoteTracks.push(track.mediaStreamTrack);
      });
    });

    remoteStream.current = remoteTracks.length ? new MediaStream(remoteTracks) : null;
    remoteAudioStream.current = null;

    if (remoteTracks.length || room.remoteParticipants.size) {
      clearTimeout(callTimeout.current);
      setCall(current => ({ ...current, status: 'Connected' }));
      startTimer();
    }

    if (remoteStream.current?.getVideoTracks?.().length) {
      setCall(current => ({ ...current, type: 'video', videoCapable: true }));
    }

    attachCallMedia();
  }

  async function connectLiveKitCall(peerId, type) {
    await disconnectLiveKit();
    callPeer.current = peerId;
    const credentials = await api('/api/calls/livekit-token', {
      method: 'POST',
      body: JSON.stringify({ peerId })
    });

    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    });
    liveKitRoom.current = room;

    room
      .on(RoomEvent.TrackSubscribed, rebuildLiveKitStreams)
      .on(RoomEvent.TrackUnsubscribed, rebuildLiveKitStreams)
      .on(RoomEvent.ParticipantConnected, rebuildLiveKitStreams)
      .on(RoomEvent.ParticipantDisconnected, rebuildLiveKitStreams)
      .on(RoomEvent.Disconnected, () => {
        if (liveKitRoom.current === room) endCall(true);
      });

    await room.connect(credentials.url, credentials.token);

    const audioTrack = await createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    });
    liveKitLocalTracks.current = [audioTrack];
    await room.localParticipant.publishTrack(audioTrack);

    if (type === 'video') {
      const videoTrack = await createLocalVideoTrack(videoConstraintsForNetwork());
      liveKitLocalTracks.current.push(videoTrack);
      await room.localParticipant.publishTrack(videoTrack);
    }

    setMicOn(true);
    setCamOn(type === 'video');
    rebuildLiveKitStreams();
  }

  function miniCallStyle() {
    if (!miniCallPosition) return undefined;
    return {
      left: miniCallPosition.x,
      top: miniCallPosition.y,
      right: 'auto',
      bottom: 'auto'
    };
  }

  function startMiniCallDrag(event) {
    if (event.target.closest('button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    miniDrag.current = {
      dragging: true,
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveMiniCallDrag(event) {
    const drag = miniDrag.current;
    if (!drag.dragging || drag.pointerId !== event.pointerId) return;
    const moved = Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4;
    const maxX = Math.max(8, window.innerWidth - drag.width - 8);
    const maxY = Math.max(8, window.innerHeight - drag.height - 8);
    miniDrag.current = { ...drag, moved: drag.moved || moved };
    setMiniCallPosition({
      x: Math.min(Math.max(8, event.clientX - drag.offsetX), maxX),
      y: Math.min(Math.max(8, event.clientY - drag.offsetY), maxY)
    });
  }

  function endMiniCallDrag(event) {
    if (miniDrag.current.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      miniDrag.current = { ...miniDrag.current, dragging: false };
    }
  }

  function restoreMinimizedCall() {
    if (miniDrag.current.moved) {
      miniDrag.current = { dragging: false, moved: false };
      return;
    }
    setCall(c => ({ ...c, minimized: false }));
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
      videoCapable: false,
      title: '',
      status: '',
      seconds: 0
    });
    setMiniCallPosition(null);
  }

  // Toggle microphone on/off (button reflects the state)
  function toggleMic() {
    const tracks = localStream.current?.getAudioTracks() || [];
    if (!tracks.length) return;

    const next = !micOn;
    tracks.forEach(x => {
      x.enabled = next;
    });
    liveKitLocalTracks.current
      .filter(track => track.kind === Track.Kind.Audio)
      .forEach(track => {
        if (next) track.unmute?.();
        else track.mute?.();
      });
    setMicOn(next);
  }

  async function renegotiateCall(status = 'Updating video...') {
    if (!pc.current || !callPeer.current) return;
    setCall(current => ({ ...current, status }));
    const offer = await pc.current.createOffer();
    await pc.current.setLocalDescription(offer);
    const ack = await emitWithAck(getSocket(), 'call:renegotiate-offer', {
      recipientId: callPeer.current,
      offer
    });
    if (ack && ack.ok === false) throw new Error(ack.message || 'Could not update the call.');
  }

  async function startCameraInCall() {
    if (liveKitRoom.current) {
      const existingLiveKitVideo = liveKitLocalTracks.current.find(track => track.kind === Track.Kind.Video);
      if (existingLiveKitVideo) {
        existingLiveKitVideo.mediaStreamTrack.enabled = true;
        existingLiveKitVideo.unmute?.();
        setCamOn(true);
        setCall(current => ({ ...current, type: 'video', videoCapable: true }));
        rebuildLiveKitStreams();
        return;
      }

      const videoTrack = await createLocalVideoTrack(videoConstraintsForNetwork());
      liveKitLocalTracks.current.push(videoTrack);
      await liveKitRoom.current.localParticipant.publishTrack(videoTrack);
      setCamOn(true);
      setCall(current => ({ ...current, type: 'video', videoCapable: true }));
      rebuildLiveKitStreams();
      return;
    }

    if (!pc.current || !localStream.current) return;
    const existing = localStream.current.getVideoTracks()[0];
    if (existing) {
      existing.enabled = true;
      setCamOn(true);
      return;
    }

    const cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraintsForNetwork()
    });
    const track = cameraStream.getVideoTracks()[0];
    if (!track) throw new Error('Camera did not start.');
    localStream.current.addTrack(track);
    pc.current.addTrack(track, localStream.current);
    setCamOn(true);
    setCall(current => ({ ...current, type: 'video', videoCapable: true }));
    attachCallMedia();
    await tuneMobileVideoSender(pc.current);
    await renegotiateCall('Starting camera...');
  }

  async function stopCameraInCall() {
    if (liveKitRoom.current) {
      const videoTracks = liveKitLocalTracks.current.filter(track => track.kind === Track.Kind.Video);
      videoTracks.forEach(track => {
        try { liveKitRoom.current.localParticipant.unpublishTrack(track); } catch {}
        try { track.stop(); } catch {}
      });
      liveKitLocalTracks.current = liveKitLocalTracks.current.filter(track => track.kind !== Track.Kind.Video);
      setCamOn(false);
      setCall(current => ({ ...current, type: 'video', videoCapable: true }));
      rebuildLiveKitStreams();
      return;
    }

    if (!pc.current || !localStream.current) return;
    const tracks = localStream.current.getVideoTracks();
    tracks.forEach(track => {
      track.stop();
      localStream.current.removeTrack(track);
    });
    pc.current.getSenders?.()
      .filter(sender => sender.track?.kind === 'video')
      .forEach(sender => pc.current.removeTrack(sender));
    setCamOn(false);
    setCall(current => ({ ...current, type: current.videoCapable ? 'audio' : current.type }));
    attachCallMedia();
    await renegotiateCall('Camera off');
  }

  // Toggle camera on/off during a video call
  async function toggleCamera() {
    const tracks = localStream.current?.getVideoTracks() || [];
    try {
      if (!tracks.length || !camOn) {
        await startCameraInCall();
      } else {
        await stopCameraInCall();
      }
    } catch (error) {
      setCallError(mediaErrorMessage(error, 'video'));
    }
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
  const filteredCalls = callHistory.filter(item => {
    if (callFilter === 'all') return true;
    if (callFilter === 'missed') return ['missed', 'declined', 'failed'].includes(item.status);
    return item.direction === callFilter;
  });
  const callContactName = call.title.split(' with ').pop() || call.title;
  const callCanUseVideo = call.type === 'video' || call.videoCapable;
  const visibleContacts = contacts.filter(user => {
    if (Boolean(user.chat?.archived) !== showArchived) return false;
    if (chatListFilter === 'unread') return Number(user.chat?.unreadCount || 0) > 0;
    if (chatListFilter !== 'all') return false;
    return true;
  });
  const mobileTitle = {
    chats: 'Chats',
    calls: 'Calls',
    ai: 'AI Opal',
    status: 'Status',
    settings: 'Settings'
  }[mobileTab] || 'Chats';

  useEffect(() => {
    if (!active || !me) return;
    const conversationId = cid(me.id, active.id);
    rows.filter(message => message.fileEncryption && !attachmentUrls[message.id]).forEach(async message => {
      try {
        const url = await decryptAttachment(message, conversationId);
        setAttachmentUrls(current => ({ ...current, [message.id]: url }));
      } catch (error) {
        console.error('Attachment decryption failed', error);
      }
    });
  }, [active, rows, me]);

  if (screen !== 'app') {
    return (
      <div className={`auth opalAuth ${screen === 'welcome' ? 'welcomeMode' : 'formMode'}`}>
        <div className="opalPhoneShell">
          <div className="opalStatusBar"><span>9:41</span><span>5G</span></div>
          <div className="card opalCard">
            <div className="opalLogo badge"><MessageCircle /></div>

            {screen === 'welcome' ? (
              <>
                <h1><span>Chat</span> <em>Opal</em></h1>
                <p className="opalTagline">Communicate without barriers.</p>
                <small className="opalSubtag">Talk to anyone, in any language.</small>

                <div className="authFeatures opalFeatureGrid">
                  <span><Languages /> <b>AI Translation</b><small>Real-time translation in any language.</small></span>
                  <span><Shield /> <b>Secure Messaging</b><small>Private chats with strong protection.</small></span>
                  <span><Video /> <b>Voice & Video Calls</b><small>High quality calls with anyone.</small></span>
                  <span><Settings /> <b>Smart Features</b><small>AI assistant, weather, and more.</small></span>
                </div>

                <button className="primary opalPrimary" onClick={() => {
                  setScreen('auth');
                  setAuthMode('login');
                }}>
                  Get Started
                </button>
                <button className="ghostLogin opalGhost" onClick={() => {
                  setScreen('auth');
                  setAuthMode('login');
                }}>
                  Log In
                </button>
              </>
            ) : (
              <>
                <button type="button" className="authBack" onClick={() => {
                  setScreen('welcome');
                  setErr('');
                }}>
                  <ArrowLeft />
                </button>

                <div className="authHeading">
                  <h1>{authMode === 'register' ? 'Create Account' : authMode === 'reset' ? 'Reset Password' : 'Welcome Back'}</h1>
                  <p>{authMode === 'register' ? "Let's get you started!" : authMode === 'reset' ? 'Use your recovery code to set a new password.' : 'Glad to see you again!'}</p>
                </div>

                {authMode !== 'reset' && (
                  <div className="tabs opalTabs">
                    <button type="button" className={authMode === 'login' ? 'on' : ''} onClick={() => setAuthMode('login')}>
                      Login
                    </button>
                    <button type="button" className={authMode === 'register' ? 'on' : ''} onClick={() => setAuthMode('register')}>
                      Register
                    </button>
                  </div>
                )}

                {err && <div className="err" role="alert">{err}</div>}

                {authMode === 'login' && (
                  <form onSubmit={login} className="opalForm">
                    <label className="opalInput"><Phone /><input placeholder="Phone number" value={form.phone} onChange={e => f('phone', e.target.value)} /></label>
                    <label className="opalInput"><Lock /><input placeholder="Password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => f('password', e.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></label>
                    <label className="opalInput"><KeyRound /><input placeholder="6-digit PIN (if enabled)" inputMode="numeric" maxLength="6" value={form.twoStepPin} onChange={e => f('twoStepPin', e.target.value.replace(/\D/g, ''))} /></label>
                    <div className="authOptions">
                      <label><input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} /> Remember me</label>
                      <button type="button" className="link" onClick={() => {
                        setErr('');
                        setAuthMode('reset');
                      }}>
                        Forgot password?
                      </button>
                    </div>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Signing in...' : 'Log In'}
                    </button>
                    <div className="socialDivider"><span />or continue with<span /></div>
                    <div className="socialLoginRow">
                      <button type="button"><b>G</b> Google</button>
                      <button type="button"><b>A</b> Apple</button>
                    </div>
                    <p className="authSwitch">Don't have an account? <button type="button" onClick={() => setAuthMode('register')}>Register</button></p>
                  </form>
                )}

                {authMode === 'reset' && (
                  <form onSubmit={resetPassword} className="opalForm">
                    <label className="opalInput"><Phone /><input placeholder="Registered phone number" value={form.resetPhone} onChange={e => f('resetPhone', e.target.value)} required /></label>
                    <label className="opalInput"><KeyRound /><input placeholder="Recovery code" value={form.recoveryCode} onChange={e => f('recoveryCode', e.target.value.toUpperCase())} required /></label>
                    <label className="opalInput"><Lock /><input placeholder="New password" type={showPassword ? 'text' : 'password'} value={form.resetPassword} onChange={e => f('resetPassword', e.target.value)} minLength={8} required /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></label>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Changing password...' : 'Reset Password'}
                    </button>
                    <p className="authSwitch">Remembered it? <button type="button" onClick={() => {
                      setErr('');
                      setAuthMode('login');
                    }}>Back to login</button></p>
                  </form>
                )}

                {authMode === 'register' && (
                  <form onSubmit={register} className="opalForm">
                    <label className="opalInput"><User /><input placeholder="Full name" value={form.username} onChange={e => f('username', e.target.value)} /></label>
                    <label className="opalInput"><Phone /><input placeholder="Phone number" value={form.phone} onChange={e => f('phone', e.target.value)} /></label>
                    <label className="opalInput"><Lock /><input placeholder="Password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={e => f('password', e.target.value)} /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></label>
                    <label className="opalInput"><Lock /><input placeholder="Confirm password" type={showConfirmPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={e => f('confirmPassword', e.target.value)} /><button type="button" onClick={() => setShowConfirmPassword(value => !value)}>{showConfirmPassword ? <EyeOff /> : <Eye />}</button></label>
                    <label className="termsRow"><input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)} /> I agree to the <span>Terms of Service</span> and <span>Privacy Policy</span></label>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Creating account...' : 'Create Account'}
                    </button>
                    <p className="authSwitch">Already have an account? <button type="button" onClick={() => setAuthMode('login')}>Login</button></p>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="app">
      <aside className={`${active ? 'side hide' : 'side'} tab-${mobileTab}`}>
        <div className="appTitle">
          <div className="brandMark"><MessageCircle /></div>
          <div><b className="desktopBrand">{BRAND.name}</b><b className="mobileBrand">{mobileTitle}</b><small>{BRAND.tagline}</small></div>
          <button className="mobileTitleAction" onClick={() => setProfile(me)} title="Open profile"><Avatar user={me} /></button>
        </div>
        <div className="me">
          <Avatar user={me} className="avatarButton" onClick={() => setProfile(me)} title="Change profile photo" />
          <div>
            <b>{me?.username}</b>
            <small>{ready ? 'Online' : 'Offline'}</small>
          </div>
          <button className="icon" onClick={logout}><LogOut /></button>
          <button className="icon" onClick={createRecoveryCode} title="Create recovery code"><KeyRound /></button>
          <button className="icon" onClick={requestNotifications} title="Enable notifications"><Bell /></button>
          <button className="icon" onClick={loadCallHistory} title="Call history"><History /></button>
          <button className="icon" onClick={openPrivacy} title="Privacy"><Shield /></button>
          <button className="icon" onClick={openSecurity} title="Account security"><Lock /></button>
        </div>

        <div className="search">
          <Search />
          <input placeholder="Search name or phone" onChange={e => search(e.target.value)} />
        </div>
        <div className="chatFilterChips">
          <button className={chatListFilter === 'all' ? 'active' : ''} onClick={() => setChatListFilter('all')}>
            All
          </button>
          <button className={chatListFilter === 'unread' ? 'active' : ''} onClick={() => setChatListFilter('unread')}>
            Unread
            {contacts.some(user => Number(user.chat?.unreadCount || 0) > 0) && (
              <span>{contacts.reduce((total, user) => total + Number(user.chat?.unreadCount || 0), 0)}</span>
            )}
          </button>
          <button className={chatListFilter === 'groups' ? 'active' : ''} onClick={() => setChatListFilter('groups')}>Groups</button>
          <button className={chatListFilter === 'channels' ? 'active' : ''} onClick={() => {
            setChatListFilter('channels');
            loadChannels('', false);
          }}>Channels</button>
        </div>
        {['all', 'unread'].includes(chatListFilter) && <div className="contactStories">
          <button onClick={() => setProfile(me)}>
            <span className="storyAvatar"><Avatar user={me} /><Plus /></span>
            <small>Your story</small>
          </button>
          {contacts.slice(0, 6).map(contact => (
            <button key={`story-${contact.id}`} onClick={() => openChat(contact)}>
              <span className="storyAvatar"><Avatar user={contact} /></span>
              <small>{contact.username}</small>
            </button>
          ))}
        </div>}
        <div className="aiOpalPanel">
          <div className="aiOrb"><Languages /></div>
          <h2>AI Opal</h2>
          <p>AI language tools are planned for the next phase. Your chat, calls, files, and settings stay available while this screen is prepared.</p>
          <div className="aiActionGrid">
            <button onClick={() => alert('AI translation will be connected after go-live.')}><Languages /><span>Translate messages</span></button>
            <button onClick={() => alert('Chat summary will be connected after go-live.')}><MessageCircle /><span>Summarize chats</span></button>
            <button onClick={() => alert('AI writing help will be connected after go-live.')}><Pencil /><span>Write a message</span></button>
            <button onClick={() => alert('Smart tools will be connected after go-live.')}><Settings /><span>Smart tools</span></button>
          </div>
        </div>
        {['all', 'unread'].includes(chatListFilter) && <button className="archiveToggle" onClick={() => setShowArchived(value => !value)}>
          <Archive /> {showArchived ? 'Back to chats' : 'Archived chats'}
        </button>}
        {['all', 'unread'].includes(chatListFilter) && <div className="statusHeader">
          <button onClick={loadStatuses}><div className="statusRing"><Avatar user={me} /></div> Status</button>
          <button onClick={createTextStatus} title="Create Status"><Plus /></button>
        </div>}
        {chatListFilter === 'channels' && <div className="channelHeader">
          <button onClick={() => loadChannels()}><MessageCircle /> Channels</button>
          <button onClick={createChannel}><Plus /></button>
        </div>}
        {chatListFilter === 'groups' && <div className="groupHeader">
          <b><Users /> Groups</b>
          <div>
            <button onClick={joinGroup} title="Join group">Join</button>
            <button onClick={createGroup} title="Create group"><Plus /></button>
          </div>
        </div>}
        {chatListFilter === 'groups' && groups.map(group => (
          <button className="groupRow" key={group.id} onClick={() => openGroup(group)}>
            <div className="avatar"><Users /></div>
            <div><b>{group.name}</b><small>{group.members.length} members</small></div>
            {group.unreadCount > 0 && <strong className="unreadBadge">{group.unreadCount}</strong>}
          </button>
        ))}
        {chatListFilter === 'channels' && (
          <div className="channelMiniList">
            {channels.length === 0 && <p className="empty">No channels yet. Create or search channels.</p>}
            {channels.map(channel => (
              <button key={channel.id} onClick={() => openChannel(channel)}>
                <div className="avatar"><MessageCircle /></div>
                <div>
                  <b>{channel.name}</b>
                  <small>{channel.followerCount} followers</small>
                </div>
                <span>{channel.following ? 'Following' : 'Open'}</span>
              </button>
            ))}
          </div>
        )}

        {['all', 'unread'].includes(chatListFilter) && <div className="list">
          {contacts.length === 0 && <p className="empty">Search a user to start chatting.</p>}
          {contacts.length > 0 && visibleContacts.length === 0 && (
            <p className="empty">{showArchived ? 'No archived chats yet.' : 'No chats in this view.'}</p>
          )}

          {visibleContacts.map(u => {
            const c = me && u && u.id ? cid(me.id, u.id) : '';
            const p = messages[c]?.slice?.(-1)?.[0] || messages[c]?.preview || {};

            return (
              <div className="chat" key={u.id}>
                <button
                  className="chatMain"
                  onClick={() => {
                    if (chatPressTriggered.current) {
                      chatPressTriggered.current = false;
                      return;
                    }
                    openChat(u);
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    setChatMenu(u);
                  }}
                  onPointerDown={() => {
                    clearTimeout(chatPressTimer.current);
                    chatPressTriggered.current = false;
                    chatPressTimer.current = setTimeout(() => {
                      chatPressTriggered.current = true;
                      setChatMenu(u);
                    }, 550);
                  }}
                  onPointerUp={() => clearTimeout(chatPressTimer.current)}
                  onPointerLeave={() => clearTimeout(chatPressTimer.current)}
                >
                <Avatar user={u} />
                <div>
                  <b>{u.chat?.pinned ? '📌 ' : ''}{u.username}</b>
                  <span>{p.body || u.phone}</span>
                </div>
                {p.createdAt && <time>{t(p.createdAt)}</time>}
                {u.chat?.unreadCount > 0 && <strong className="unreadBadge">{u.chat.unreadCount}</strong>}
                </button>
                {chatMenu?.id === u.id && (
                  <div className="chatMenu">
                    <button onClick={() => updateChatPreference(u, { archived: !u.chat?.archived })}>
                      <Archive /> {u.chat?.archived ? 'Unarchive' : 'Archive'}
                    </button>
                    <button className="danger" onClick={() => deleteChatForMe(u)}>
                      <Trash2 /> Delete chat
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>}
        <nav className="bottomNav" aria-label="Primary navigation">
          <button className={mobileTab === 'chats' ? 'active' : ''} onClick={() => { setMobileTab('chats'); setActive(null); }}><MessageCircle /><span>Chats</span></button>
          <button className={mobileTab === 'calls' ? 'active' : ''} onClick={() => { setMobileTab('calls'); loadCallHistory(); }}><Phone /><span>Calls</span></button>
          <button className={mobileTab === 'ai' ? 'active' : ''} onClick={() => setMobileTab('ai')}><Languages /><span>AI Opal</span></button>
          <button className={mobileTab === 'status' ? 'active' : ''} onClick={() => { setMobileTab('status'); loadStatuses(); }}><History /><span>Status</span></button>
          <button className={mobileTab === 'settings' ? 'active' : ''} onClick={() => { setMobileTab('settings'); openPrivacy(); }}><Settings /><span>Settings</span></button>
        </nav>
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
                    <img src={attachmentUrls[m.id] || (m.fileEncryption ? '' : resolveFileUrl(m.fileUrl))} alt={m.fileName || 'Photo'} />
                  ) : m.kind === 'file' && m.fileUrl ? (
                    <a
                      href={attachmentUrls[m.id] || (m.fileEncryption ? undefined : resolveFileUrl(m.fileUrl))}
                      download={m.fileName}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                    >
                      📎 {m.fileName || m.body}
                    </a>
                  ) : m.kind === 'audio' && m.fileUrl ? (
                    <audio
                      className="voiceMessage"
                      src={attachmentUrls[m.id] || (m.fileEncryption ? '' : resolveFileUrl(m.fileUrl))}
                      controls
                      preload="metadata"
                      onClick={e => e.stopPropagation()}
                    />
                  ) : m.kind === 'sticker' ? (
                    <span className="stickerMessage">{m.body}</span>
                  ) : (
                    <span>{m.body}</span>
                  )}
                  {translations[m.id] && <div className="translationText"><Languages /> {translations[m.id]}</div>}

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

            {showComposerTools && (
              <div className="composerTools">
                <button onClick={() => { setEmoji(!emoji); setShowComposerTools(false); }}><Smile /><span>Emoji</span></button>
                <label><Image /><span>Photo</span><input hidden type="file" accept="image/*" onChange={e => file(e, 'image')} /></label>
                <label><Paperclip /><span>File</span><input hidden type="file" onChange={e => file(e)} /></label>
                <label><Camera /><span>Camera</span><input hidden type="file" accept="image/*" capture="environment" onChange={e => file(e, 'image')} /></label>
                <button onClick={() => { setShowScheduler(value => !value); setShowComposerTools(false); }}><CalendarClock /><span>Schedule</span></button>
              </div>
            )}

            <footer className="compose">
              <button className="icon composePlus" onClick={() => setShowComposerTools(value => !value)} title="More message tools">
                {showComposerTools ? <X /> : <Plus />}
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

              <label className="icon composeCamera" title="Take photo">
                <Camera />
                <input hidden type="file" accept="image/*" capture="environment" onChange={e => file(e, 'image')} />
              </label>

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
                <div className="stickerDivider">Stickers</div>
                {stickers.map(value => (
                  <button
                    className="stickerChoice"
                    key={'sticker-' + value}
                    onClick={() => {
                      send({ body: value, kind: 'sticker' });
                      setEmoji(false);
                    }}
                  >
                    {value}
                  </button>
                ))}
                <label className="gifUpload">
                  GIF
                  <input hidden type="file" accept="image/gif" onChange={e => file(e, 'image')} />
                </label>
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
            <small>Incoming {incoming.videoIntent || incoming.callType === 'video' ? 'video' : 'voice'} call...</small>
          </div>
          <div className="incomingBtns">
            <button className="accept" onClick={acceptCall}>
              {incoming.videoIntent || incoming.callType === 'video' ? <Video /> : <Phone />}
            </button>
            <button className="danger" onClick={declineCall}><PhoneOff /></button>
          </div>
        </div>
      )}

      {call.active && !call.minimized && (
        <div className={`call ${call.type === 'video' ? 'videoCall' : 'audioCall'}`}>
          <div className="callInfo">
            {call.type !== 'video' && (
              <div className="callAvatar">{initials(callContactName)}</div>
            )}
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

            {callCanUseVideo && (
              <button
                className={camOn ? '' : 'off'}
                onClick={toggleCamera}
                title={camOn ? 'Turn camera off' : 'Turn camera on after call connects'}
              >
                {camOn ? <Video /> : <VideoOff />}
              </button>
            )}

            <button
              className={speakerMuted ? 'off' : ''}
              onClick={() => setSpeakerMuted(value => !value)}
              title={speakerMuted ? 'Turn speaker on' : 'Mute speaker'}
            >
              {speakerMuted ? <VolumeX /> : <Volume2 />}
            </button>

            <button className="danger" onClick={() => endCall()} title="End call">
              <PhoneOff />
            </button>
          </div>
        </div>
      )}

      {call.active && <audio ref={remoteAudio} autoPlay className="callAudio" />}

      {call.active && call.minimized && (
        call.type === 'video' ? (
          <div
            className="mini videoMini draggableMini"
            style={miniCallStyle()}
            onClick={restoreMinimizedCall}
            onPointerDown={startMiniCallDrag}
            onPointerMove={moveMiniCallDrag}
            onPointerUp={endMiniCallDrag}
            onPointerCancel={endMiniCallDrag}
          >
            <video ref={miniRemoteVideo} autoPlay muted playsInline className="miniRemoteVideo" />
            <video ref={miniLocalVideo} autoPlay muted playsInline className="miniLocalVideo" />
            <div className="miniOverlay">
              <b>{call.title}</b>
              <small>
                {String(Math.floor(call.seconds / 60)).padStart(2, '0')}:{String(call.seconds % 60).padStart(2, '0')}
              </small>
            </div>
            <div className="miniVideoControls">
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
          </div>
        ) : (
          <div
            className="mini draggableMini"
            style={miniCallStyle()}
            onClick={restoreMinimizedCall}
            onPointerDown={startMiniCallDrag}
            onPointerMove={moveMiniCallDrag}
            onPointerUp={endMiniCallDrag}
            onPointerCancel={endMiniCallDrag}
          >
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
              {selectedMessage.kind === 'text' && (
                <button onClick={translateSelectedMessage}><Languages /> Translate</button>
              )}
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

      {showCallHistory && (
        <div className="modal" onClick={() => setShowCallHistory(false)}>
          <div className="historyCard" onClick={e => e.stopPropagation()}>
            <button className="historyClose" onClick={() => setShowCallHistory(false)}><X /></button>
            <div className="callsHero">
              <div className="callsHeroIcon"><Phone /></div>
              <div>
                <h2>Calls</h2>
                <p>Voice and video activity</p>
              </div>
            </div>
            <div className="callFilters">
              {[
                ['all', 'All'],
                ['missed', 'Missed'],
                ['incoming', 'Incoming'],
                ['outgoing', 'Outgoing']
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={callFilter === value ? 'active' : ''}
                  onClick={() => setCallFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="historyList">
              {filteredCalls.length === 0 && <p className="empty">No calls here yet.</p>}
              {filteredCalls.map(item => (
                <button className="historyItem" key={item.id} onClick={() => setSelectedCallLog(item)}>
                  <Avatar user={{ username: item.contactName, avatarUrl: item.contactAvatar }} />
                  <div className="callMeta">
                    <b>{item.contactName}</b>
                    <small>{item.direction} · {item.type} · {item.status}</small>
                    <small>{new Date(item.startedAt).toLocaleString()}</small>
                  </div>
                  <div className="callTypeIcon">
                    {item.type === 'video' ? <Video /> : <Phone />}
                  </div>
                </button>
              ))}
            </div>
            {selectedCallLog && (
              <div className="callLogActions">
                <div>
                  <b>{selectedCallLog.contactName}</b>
                  <small>{selectedCallLog.type} call · {selectedCallLog.status}</small>
                </div>
                <button onClick={() => callBackFromLog(selectedCallLog.type)}>
                  {selectedCallLog.type === 'video' ? <Video /> : <Phone />} Call back
                </button>
                <button className="danger" onClick={deleteCallLog}>
                  <Trash2 /> Delete
                </button>
                <button onClick={() => setSelectedCallLog(null)}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

      {privacy && (
        <div className="modal" onClick={() => setPrivacy(null)}>
          <div className="privacyCard settingsCard" onClick={e => e.stopPropagation()}>
            <button className="historyClose" onClick={() => setPrivacy(null)}><X /></button>
            <div className="settingsProfile">
              <Avatar user={me} />
              <div><h2>{me?.username}</h2><small>{me?.phone}</small></div>
              <button onClick={() => setProfile(me)}>Edit profile</button>
            </div>
            <div className="settingsShortcuts">
              <button onClick={() => { setPrivacy(null); openSecurity(); }}><Lock /><span>Account & security</span></button>
              <button onClick={requestNotifications}><Bell /><span>Notifications</span></button>
              <button onClick={createRecoveryCode}><KeyRound /><span>Recovery code</span></button>
              <button className="danger" onClick={logout}><LogOut /><span>Log out</span></button>
            </div>
            <h3>Privacy</h3>
            {[ 
              ['Last seen and online', 'lastSeenVisibility'],
              ['Profile photo', 'profileVisibility'],
              ['About', 'aboutVisibility']
            ].map(([label, key]) => (
              <label className="privacyRow" key={key}>
                <span>{label}</span>
                <select value={privacy[key]} onChange={e => savePrivacy({ ...privacy, [key]: e.target.value })}>
                  <option value="everyone">Everyone</option>
                  <option value="nobody">Nobody</option>
                </select>
              </label>
            ))}
            <label className="privacyRow">
              <span>Read receipts</span>
              <input type="checkbox" checked={privacy.readReceipts} onChange={e => savePrivacy({ ...privacy, readReceipts: e.target.checked })} />
            </label>
            <label className="privacyRow">
              <span>Silence unknown calls</span>
              <input type="checkbox" checked={privacy.silenceUnknownCalls} onChange={e => savePrivacy({ ...privacy, silenceUnknownCalls: e.target.checked })} />
            </label>
            {(privacy.blockedUsers || []).length > 0 && (
              <div className="blockedList">
                <b>Blocked users</b>
                {privacy.blockedUsers.map(user => (
                  <div key={user.id}>
                    <span>{user.username}</span>
                    <button onClick={() => unblockUser(user.id)}>Unblock</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {security && (
        <div className="modal" onClick={() => setSecurity(null)}>
          <div className="securityCard" onClick={e => e.stopPropagation()}>
            <button className="historyClose" onClick={() => setSecurity(null)}><X /></button>
            <h2>Account security</h2>
            <button className="twoStepButton" onClick={toggleTwoStep}>
              <Lock /> Two-step verification: {security.twoStepEnabled ? 'On' : 'Off'}
            </button>
            <div className="accountActions">
              <button onClick={changePassword}>Change password</button>
              <button onClick={downloadAccountData}>Download my data</button>
              <button className="danger" onClick={deleteAccount}>Delete account</button>
            </div>
            <div className="sessionHeader">
              <b>Logged-in devices</b>
              <button onClick={revokeOtherSessions}>Log out others</button>
            </div>
            <div className="sessionList">
              {security.sessions.map(session => (
                <div key={session.id}>
                  <div>
                    <b>{session.current ? 'This device' : session.deviceName}</b>
                    <small>{new Date(session.lastSeen).toLocaleString()} · {session.ipAddress || 'Unknown IP'}</small>
                  </div>
                  {!session.current && <button onClick={() => revokeSession(session.id)}>Log out</button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedGroup && (
        <div className="modal" onClick={() => setSelectedGroup(null)}>
          <div className="groupCard" onClick={e => e.stopPropagation()}>
            <button className="historyClose" onClick={() => setSelectedGroup(null)}><X /></button>
            <div className="avatar big"><Users /></div>
            <h2>{selectedGroup.name}</h2>
            <p>{selectedGroup.description}</p>
            <div className="groupCallLaunch">
              <button onClick={() => startGroupCall('audio')}><Phone /> Voice call</button>
              <button onClick={() => startGroupCall('video')}><Video /> Video call</button>
            </div>
            <button className="groupMute" onClick={toggleGroupMute}>
              <BellOff /> {selectedGroup.mutedUntil && new Date(selectedGroup.mutedUntil) > new Date() ? 'Unmute group' : 'Mute 8 hours'}
            </button>
            {selectedGroup.role === 'admin' && (
              <div className="groupAdminActions">
                <button onClick={editGroup}>Edit group</button>
                <button onClick={createGroupInvite}>Invite link</button>
              </div>
            )}
            {groupInvite && (
              <div className="inviteCard">
                <img src={groupInvite.qr} alt="Group invite QR code" />
                <input readOnly value={groupInvite.url} />
                <button onClick={() => navigator.clipboard.writeText(groupInvite.url)}>Copy link</button>
                <button className="danger" onClick={revokeGroupInvite}>Revoke</button>
              </div>
            )}
            <div className="groupConversation">
              <div className="groupMessageList">
                {(groupMessages[selectedGroup.id] || []).map(message => (
                  <div
                    className={'groupBubble ' + (String(message.senderId) === String(me.id) ? 'mine' : 'theirs') +
                      (message.body?.toLowerCase().includes(`@${me.username?.toLowerCase()}`) ? ' mentioned' : '')}
                    key={message.id}
                    onClick={() => setSelectedGroupMessage(message)}
                  >
                    <b>{String(message.senderId) === String(me.id) ? 'You' : message.senderName}</b>
                    {message.kind === 'image' && message.mediaUrl ? (
                      <img src={message.mediaUrl} alt={message.fileName || 'Group photo'} />
                    ) : message.kind === 'file' && message.mediaUrl ? (
                      <a href={message.mediaUrl} download={message.fileName} onClick={e => e.stopPropagation()}>
                        📎 {message.fileName}
                      </a>
                    ) : message.kind === 'audio' && message.mediaUrl ? (
                      <audio controls src={message.mediaUrl} onClick={e => e.stopPropagation()} />
                    ) : message.kind === 'sticker' ? (
                      <span className="stickerMessage">{message.body}</span>
                    ) : <span>{message.body}</span>}
                    <small>{t(message.createdAt)}</small>
                    {message.reactions?.length > 0 && <span>{message.reactions.map(reaction => reaction.emoji).join(' ')}</span>}
                  </div>
                ))}
                {(groupMessages[selectedGroup.id] || []).length === 0 && (
                  <p className="empty">No group messages yet.</p>
                )}
              </div>
              <div className="groupCompose">
                <label title="Photo"><Image /><input hidden type="file" accept="image/*" onChange={e => sendGroupFile(e, 'image')} /></label>
                <label title="GIF"><b>GIF</b><input hidden type="file" accept="image/gif" onChange={e => sendGroupFile(e, 'image')} /></label>
                <label title="File"><Paperclip /><input hidden type="file" onChange={e => sendGroupFile(e, 'file')} /></label>
                <button
                  className={groupRecording ? 'groupRecord active' : 'groupRecord'}
                  onClick={groupRecording ? stopGroupVoiceRecording : startGroupVoiceRecording}
                  title={groupRecording ? 'Stop and send voice message' : 'Record voice message'}
                >
                  {groupRecording ? <Square /> : <Mic />}
                </button>
                <input
                  value={groupText}
                  onChange={e => {
                    setGroupText(e.target.value);
                    emitGroupTyping();
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') sendGroupMessage();
                  }}
                  placeholder="Encrypted group message"
                />
                <button onClick={sendGroupMessage}><Send /></button>
              </div>
              {groupTyping[selectedGroup.id] && <div className="groupTyping">{groupTyping[selectedGroup.id]} is typing…</div>}
              <div className="groupStickers">
                {stickers.slice(0, 8).map(value => (
                  <button key={value} onClick={() => sendGroupMessage(value, 'sticker')}>{value}</button>
                ))}
              </div>
            </div>
            {selectedGroup.role === 'admin' && <button className="addMember" onClick={addGroupMember}><Plus /> Add member</button>}
            <div className="memberList">
              {selectedGroup.members.map(member => (
                <div key={member.id}>
                  <span>{member.username} · {member.role}</span>
                  {selectedGroup.role === 'admin' && member.id !== me.id && (
                    <div>
                      <button onClick={() => changeGroupRole(member)}>{member.role === 'admin' ? 'Demote' : 'Promote'}</button>
                      <button onClick={() => removeGroupMember(member.id)}>Remove</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <button className="danger leaveGroup" onClick={() => removeGroupMember(me.id)}>Leave group</button>
          </div>
        </div>
      )}

      {selectedGroupMessage && (
        <div className="modal" onClick={() => setSelectedGroupMessage(null)}>
          <div className="messageMenu" onClick={e => e.stopPropagation()}>
            <h3>Group message actions</h3>
            <div className="reactionPicker">
              {['👍', '❤️', '😂', '😮', '😢', '🙏'].map(emoji => (
                <button key={emoji} onClick={() => reactGroupMessage(emoji)}>{emoji}</button>
              ))}
            </div>
            {(selectedGroup.role === 'admin' || selectedGroupMessage.senderId === me.id) && (
              <button className="danger menuCancel" onClick={deleteGroupMessage}><Trash2 /> Delete message</button>
            )}
            <button className="menuCancel" onClick={() => setSelectedGroupMessage(null)}>Cancel</button>
          </div>
        </div>
      )}

      {groupCall && (
        <div className="groupCallScreen">
          <h2>{groupCall.type === 'video' ? 'Video' : 'Voice'} call · {groupCall.title}</h2>
          <div className="groupCallGrid">
            <div className="groupCallTile">
              {groupCall.type === 'video' ? <StreamVideo stream={groupCallStream.current} muted /> : <Avatar user={me} big />}
              <b>You</b>
            </div>
            {Object.entries(groupRemoteStreams).map(([userId, stream]) => (
              <div className="groupCallTile" key={userId}>
                {groupCall.type === 'video' ? <StreamVideo stream={stream} /> : (
                  <><div className="avatar big"><User /></div><StreamAudio stream={stream} /></>
                )}
                <b>Participant</b>
              </div>
            ))}
          </div>
          <div className="groupCallControls">
            <button className={groupCall.micOn ? '' : 'off'} onClick={toggleGroupCallMic}>
              {groupCall.micOn ? <Mic /> : <MicOff />}
            </button>
            {groupCall.type === 'video' && (
              <button className={groupCall.camOn ? '' : 'off'} onClick={toggleGroupCallCamera}>
                {groupCall.camOn ? <Video /> : <VideoOff />}
              </button>
            )}
            <button className="danger" onClick={leaveGroupCall}><PhoneOff /></button>
          </div>
        </div>
      )}

      {showStatuses && (
        <div className="modal" onClick={() => setShowStatuses(false)}>
          <div className="statusCard" onClick={e => e.stopPropagation()}>
            <button className="historyClose" onClick={() => setShowStatuses(false)}><X /></button>
            <div className="statusHero">
              <div className="statusHeroIcon"><History /></div>
              <div>
                <h2>Status</h2>
                <p>Share moments that disappear after 24 hours.</p>
              </div>
            </div>
            <button className="createStatus" onClick={createTextStatus}><Plus /> Add text Status</button>
            <div className="statusMediaButtons">
              <label><Image /> Photo<input hidden type="file" accept="image/*" capture="environment" onChange={e => createMediaStatus(e, 'image')} /></label>
              <label><Video /> Video<input hidden type="file" accept="video/*" capture="environment" onChange={e => createMediaStatus(e, 'video')} /></label>
              <label><Mic /> Voice<input hidden type="file" accept="audio/*" capture onChange={e => createMediaStatus(e, 'audio')} /></label>
            </div>
            <details className="statusPrivacy">
              <summary>Status audience · {contacts.length - statusExcluded.length} contacts</summary>
              {contacts.map(contact => (
                <label key={contact.id}>
                  <input
                    type="checkbox"
                    checked={!statusExcluded.includes(contact.id)}
                    onChange={e => setStatusExcluded(current => e.target.checked
                      ? current.filter(id => id !== contact.id)
                      : [...current, contact.id])}
                  />
                  {contact.username}
                </label>
              ))}
            </details>
            <div className="statusList">
              {statuses.length === 0 && <p className="empty">No active Status updates.</p>}
              {statuses.map(status => (
                <div className={(status.viewed ? 'statusItem viewed' : 'statusItem') + (status.muted ? ' muted' : '')} key={status.id} onClick={() => viewStatus(status)}>
                  <Avatar user={{ username: status.username, avatarUrl: status.avatarUrl }} />
                  <div>
                    <b>{status.userId === me.id ? 'My Status' : status.username}</b>
                    {status.kind === 'image' && status.mediaUrl ? (
                      <img className="statusMedia" src={status.mediaUrl} alt="Status" />
                    ) : status.kind === 'video' && status.mediaUrl ? (
                      <video className="statusMedia" src={status.mediaUrl} controls onClick={e => e.stopPropagation()} />
                    ) : status.kind === 'audio' && status.mediaUrl ? (
                      <audio src={status.mediaUrl} controls onClick={e => e.stopPropagation()} />
                    ) : <p>{status.body}</p>}
                    <small>{new Date(status.createdAt).toLocaleString()} · expires in 24h</small>
                    {status.userId === me.id && <small>{status.viewCount} views</small>}
                  </div>
                  <div className="statusActions">
                    {status.userId === me.id ? (
                      <button className="danger" onClick={e => {
                        e.stopPropagation();
                        deleteStatus(status.id);
                      }}><Trash2 /></button>
                    ) : ['❤️', '👍'].map(reaction => (
                      <button key={reaction} onClick={e => {
                        e.stopPropagation();
                        viewStatus(status, reaction);
                      }}>{reaction}</button>
                    ))}
                    {status.userId !== me.id && (
                      <>
                        <button title="Reply privately" onClick={e => {
                          e.stopPropagation();
                          replyToStatus(status);
                        }}><Reply /></button>
                        <button title={status.muted ? 'Unmute Status' : 'Mute Status'} onClick={e => {
                          e.stopPropagation();
                          toggleStatusMute(status);
                        }}><BellOff /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showChannels && (
        <div className="modal" onClick={() => {
          setShowChannels(false);
          setSelectedChannel(null);
        }}>
          <div className="channelCard" onClick={e => e.stopPropagation()}>
            <button className="historyClose" onClick={() => {
              setShowChannels(false);
              setSelectedChannel(null);
            }}><X /></button>
            {!selectedChannel ? (
              <>
                <div className="channelHero">
                  <div className="channelHeroIcon"><MessageCircle /></div>
                  <div>
                    <h2>Channels</h2>
                    <p>Discover updates from people and communities.</p>
                  </div>
                </div>
                <div className="channelSearch">
                  <Search />
                  <input placeholder="Discover channels" onChange={e => loadChannels(e.target.value)} />
                  <button onClick={createChannel}><Plus /> Create</button>
                </div>
                <div className="channelList">
                  {channels.map(channel => (
                    <div key={channel.id}>
                      <div className="avatar"><MessageCircle /></div>
                      <button className="channelName" onClick={() => openChannel(channel)}>
                        <b>{channel.name}</b>
                        <small>{channel.followerCount} followers · {channel.description}</small>
                      </button>
                      <button onClick={() => toggleChannelFollow(channel)}>
                        {channel.following ? 'Following' : 'Follow'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button className="channelBack" onClick={() => setSelectedChannel(null)}><ArrowLeft /> Channels</button>
                <div className="selectedChannelHero">
                  <div className="avatar"><MessageCircle /></div>
                  <div>
                    <h2>{selectedChannel.name}</h2>
                    <p>{selectedChannel.description}</p>
                  </div>
                  <button onClick={() => toggleChannelFollow(selectedChannel)}>
                    {selectedChannel.following ? 'Unfollow' : 'Follow'}
                  </button>
                </div>
                {selectedChannel.ownerId === me.id && (
                  <div className="channelPublish">
                    <button className="publishChannel" onClick={publishChannelPost}><Plus /> Text</button>
                    <label><Image /> Photo<input hidden type="file" accept="image/*" onChange={e => publishChannelMedia(e, 'image')} /></label>
                    <label><Video /> Video<input hidden type="file" accept="video/*" onChange={e => publishChannelMedia(e, 'video')} /></label>
                    <label><Paperclip /> File<input hidden type="file" onChange={e => publishChannelMedia(e, 'file')} /></label>
                  </div>
                )}
                <div className="channelFeed">
                  {channelPosts.length === 0 && <p className="empty">No updates yet.</p>}
                  {channelPosts.map(post => (
                    <article key={post.id}>
                      {post.kind === 'image' && post.fileUrl && (
                        <img src={resolveFileUrl(post.fileUrl)} alt={post.fileName || 'Channel photo'} />
                      )}
                      {post.kind === 'video' && post.fileUrl && (
                        <video src={resolveFileUrl(post.fileUrl)} controls />
                      )}
                      {post.kind === 'file' && post.fileUrl && (
                        <a href={resolveFileUrl(post.fileUrl)} target="_blank" rel="noopener noreferrer">📎 {post.fileName}</a>
                      )}
                      <p>{post.body}</p>
                      <small>{new Date(post.createdAt).toLocaleString()}</small>
                      <div>
                        {['❤️', '👍', '😂'].map(emoji => (
                          <button key={emoji} onClick={() => reactChannelPost(post, emoji)}>{emoji}</button>
                        ))}
                        <span>{(post.reactions || []).map(value => value.emoji).join(' ')}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
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
            {String(profile.id) !== String(me?.id) && (
              <div className="profileSafety">
                <button onClick={reportProfile}><Flag /> Report</button>
                <button className="danger" onClick={blockProfile}><Ban /> Block</button>
              </div>
            )}
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
