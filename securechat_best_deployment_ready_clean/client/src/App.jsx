import React, { useEffect, useRef, useState } from 'react';
import {
  Phone, Video, VideoOff, Send, Search, LogOut, User, Paperclip, Image,
  Smile, Mic, MicOff, PhoneOff, Minimize2, ArrowLeft, X, Lock, MessageCircle,
  KeyRound, Copy, Camera, Trash2, Volume2, VolumeX, Reply, Star, Pencil, Square,
  MoreVertical, Pin, Archive, BellOff, CalendarClock, Timer, Languages, History, Bell,
  Shield, Ban, Flag, Users, Plus, Settings
} from 'lucide-react';
import {
  api, uploadFile, setSession, getStoredUser, getToken, clearSession, resolveFileUrl
} from './api';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import QRCode from 'qrcode';
import { BRAND } from './branding';
import {
  E2EE_ENABLED, ensureE2EEIdentity, encryptMessage, decryptMessage,
  encryptAttachment, decryptAttachment, encryptGroupMessage, decryptGroupMessage
} from './e2ee';

const emojis = '😀 😃 😄 😁 😆 😅 😂 🙂 😊 😍 😘 😎 😢 😭 😡 👍 👎 🙏 🔥 ❤️ 🎉 ✅ 💯'.split(' ');

const stickers = ['😀', '😂', '😍', '🥳', '😎', '😭', '😡', '👍', '🙏', '❤️', '🔥', '🎉'];

const turnUrls = String(import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || '')
  .split(',')
  .map(url => url.trim())
  .filter(Boolean);
const hasTurnServer = turnUrls.length > 0;
const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ...(hasTurnServer
      ? [{
          urls: turnUrls,
          username: import.meta.env.VITE_TURN_USERNAME || '',
          credential: import.meta.env.VITE_TURN_CREDENTIAL || ''
        }]
      : [])
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: import.meta.env.VITE_ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all'
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
    twoStepPin: '',
    resetPhone: '',
    recoveryCode: '',
    resetPassword: ''
  });

  const [me, setMe] = useState(storedUser && storedUser.id ? storedUser : null);
  const [ready, setReady] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [messages, setMessages] = useState({});
  const [active, setActive] = useState(null);
  const [mobileTab, setMobileTab] = useState('chats');
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
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
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
      showNotification(`Incoming ${d.callType} call`, d.callerName);
    });

    s.on('security:new-login', d => {
      showNotification('New SecureChat login', d.deviceName);
      alert(`New login detected: ${d.deviceName}`);
    });

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
      const decrypted = await Promise.all(rows.map(decodeStatus));
      setStatuses(decrypted);
      setShowStatuses(true);
    } catch (error) {
      alert('Could not load Status: ' + error.message);
    }
  }

  async function loadChannels(query = '') {
    try {
      setChannels(await api('/api/channels?q=' + encodeURIComponent(query)));
      setShowChannels(true);
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
        audio: true, video: type === 'video'
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
    const peer = new RTCPeerConnection(rtcConfig);
    groupCallStream.current?.getTracks().forEach(track => peer.addTrack(track, groupCallStream.current));
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

    p.onicecandidateerror = event => {
      console.warn('ICE server error', event.errorCode, event.errorText);
      if (event.url?.startsWith('turn')) {
        setCall(c => ({ ...c, status: 'Relay server unavailable' }));
      }
    };

    p.oniceconnectionstatechange = () => {
      if (p.iceConnectionState === 'checking') {
        setCall(c => ({ ...c, status: 'Connecting securely…' }));
      }
      if (p.iceConnectionState === 'failed') {
        setCall(c => ({
          ...c,
          status: hasTurnServer
            ? 'Network relay failed. Please try again.'
            : 'A TURN relay is required for this mobile network.'
        }));
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
      <div className="auth">
        <div className="card">
          <div className="badge"><MessageCircle /></div>
          <h1>{BRAND.name}</h1>
          <p>{BRAND.tagline}</p>

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
                  <input placeholder="6-digit PIN (if enabled)" inputMode="numeric" maxLength="6" value={form.twoStepPin} onChange={e => f('twoStepPin', e.target.value.replace(/\D/g, ''))} />
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
      <aside className={`${active ? 'side hide' : 'side'} tab-${mobileTab}`}>
        <div className="appTitle">
          <div className="brandMark"><MessageCircle /></div>
          <div><b className="desktopBrand">{BRAND.name}</b><b className="mobileBrand">Chats</b><small>{BRAND.tagline}</small></div>
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
        <div className="contactStories">
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
        </div>
        <button className="archiveToggle" onClick={() => setShowArchived(value => !value)}>
          <Archive /> {showArchived ? 'Back to chats' : 'Archived chats'}
        </button>
        <div className="statusHeader">
          <button onClick={loadStatuses}><div className="statusRing"><Avatar user={me} /></div> Status</button>
          <button onClick={createTextStatus} title="Create Status"><Plus /></button>
        </div>
        <div className="channelHeader">
          <button onClick={() => loadChannels()}><MessageCircle /> Channels</button>
          <button onClick={createChannel}><Plus /></button>
        </div>
        <div className="groupHeader">
          <b><Users /> Groups</b>
          <div>
            <button onClick={joinGroup} title="Join group">Join</button>
            <button onClick={createGroup} title="Create group"><Plus /></button>
          </div>
        </div>
        {groups.map(group => (
          <button className="groupRow" key={group.id} onClick={() => openGroup(group)}>
            <div className="avatar"><Users /></div>
            <div><b>{group.name}</b><small>{group.members.length} members</small></div>
            {group.unreadCount > 0 && <strong className="unreadBadge">{group.unreadCount}</strong>}
          </button>
        ))}

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
                {p.createdAt && <time>{t(p.createdAt)}</time>}
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
        <nav className="bottomNav" aria-label="Primary navigation">
          <button className={mobileTab === 'chats' ? 'active' : ''} onClick={() => { setMobileTab('chats'); setActive(null); }}><MessageCircle /><span>Chats</span></button>
          <button className={mobileTab === 'calls' ? 'active' : ''} onClick={() => { setMobileTab('calls'); loadCallHistory(); }}><Phone /><span>Calls</span></button>
          <button className={mobileTab === 'discover' ? 'active' : ''} onClick={() => { setMobileTab('discover'); loadChannels(); }}><Users /><span>Discover</span></button>
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
            <h2>Call history</h2>
            <div className="historyList">
              {callHistory.length === 0 && <p className="empty">No calls yet.</p>}
              {callHistory.map(item => (
                <div className="historyItem" key={item.id}>
                  <div className="avatar">{initials(item.contactName)}</div>
                  <div>
                    <b>{item.contactName}</b>
                    <small>{item.direction} · {item.type} · {item.status}</small>
                    <small>{new Date(item.startedAt).toLocaleString()}</small>
                  </div>
                  {item.type === 'video' ? <Video /> : <Phone />}
                </div>
              ))}
            </div>
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
            <h2>Status</h2>
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
                <h2>Channels</h2>
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
                <h2>{selectedChannel.name}</h2>
                <p>{selectedChannel.description}</p>
                <button onClick={() => toggleChannelFollow(selectedChannel)}>
                  {selectedChannel.following ? 'Unfollow' : 'Follow'}
                </button>
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
