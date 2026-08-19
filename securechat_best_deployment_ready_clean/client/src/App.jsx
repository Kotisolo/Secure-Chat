import React, { useEffect, useRef, useState } from 'react';
import {
  Phone, Video, VideoOff, Send, Search, LogOut, User, Paperclip, Image,
  Smile, Mic, MicOff, PhoneOff, Minimize2, ArrowLeft, X, Lock, MessageCircle,
  KeyRound, Copy, Camera, Trash2, Volume2, VolumeX, Reply, Star, Pencil, Square,
  Archive, BellOff, CalendarClock, Languages, History, Bell,
  Shield, Ban, Flag, Users, UserPlus, Plus, Settings, Eye, EyeOff, MapPin, Navigation, BarChart3, MoreVertical,
  MonitorUp, Hand, Info, Mail, Clapperboard, ChevronDown, Forward, MailOpen, Pin, PinOff, Bookmark, Play, Check
} from 'lucide-react';
import {
  api, uploadFile, setSession, getStoredUser, getToken, clearSession, resolveFileUrl, ensureFileToken, API_URL
} from './api';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import { Room, RoomEvent, Track, createLocalAudioTrack, createLocalVideoTrack } from 'livekit-client';
import QRCode from 'qrcode';
import { BRAND } from './branding';
import {
  E2EE_ENABLED, ensureE2EEIdentity, encryptMessage, decryptMessage,
  encryptAttachment, decryptAttachment, encryptGroupMessage, decryptGroupMessage
} from './e2ee';

const emojiSections = [
  {
    id: 'recent',
    title: 'Frequently Used',
    icon: '◷',
    values: ['😂', '❤️', '😍', '👍', '🔥', '🎉', '😀', '🙏', '✅', '💯', '😎', '😭']
  },
  {
    id: 'smileys',
    title: 'Smileys & People',
    icon: '☺',
    values: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🙂', '😊', '😉', '😍', '😘', '😗', '😚', '😋', '😜', '🤪', '🤨', '🧐', '😎', '🥹', '😢', '😭', '😡', '😴', '😇', '🥳', '🤔', '🤗', '👍', '👌', '👏', '👋', '🙏', '💪', '👈', '👉', '☝️', '✌️', '🤝']
  },
  {
    id: 'animals',
    title: 'Animals & Nature',
    icon: '🐻',
    values: ['🐶', '🐱', '🐰', '🐭', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦋', '🌸', '🌹', '🌻', '🌺', '🌷', '🌍', '🌈', '🌙', '☀️', '💧', '🌊', '🌲', '🌴', '🍀']
  },
  {
    id: 'food',
    title: 'Food & Drink',
    icon: '🍎',
    values: ['🍎', '🍌', '🍇', '🍓', '🍉', '🍊', '🍋', '🍒', '🥭', '🥝', '🥕', '🌽', '🍕', '🍔', '🍟', '🌭', '🍗', '🍰', '🍦', '🍩', '🍪', '🍫', '☕', '🥤', '🍽️', '🍜', '🍛', '🍯']
  },
  {
    id: 'activities',
    title: 'Activities',
    icon: '⚽',
    values: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏆', '🥇', '🎮', '🎲', '🎤', '🎧', '🎸', '🎹', '🎬', '🎯', '🎨', '🚴', '🏃', '🏋️', '🎁', '🎉', '🎊', '🧩']
  },
  {
    id: 'travel',
    title: 'Travel & Places',
    icon: '🚗',
    values: ['🚗', '🚕', '🚌', '🏎️', '🚓', '🚑', '🚒', '✈️', '🚀', '🚁', '⛵', '🚢', '🏠', '🏢', '🏥', '🏫', '⛪', '🕌', '🗽', '🗺️', '📍', '🌆', '🌃', '🏖️']
  },
  {
    id: 'symbols',
    title: 'Symbols',
    icon: '♡',
    values: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🤎', '💕', '💞', '💔', '✅', '☑️', '✔️', '❌', '⚠️', '❗', '❓', '‼️', '💲', '©️', '™️', '🔒', '🔔', '⭐', '💬']
  }
];

const readOAuthPayload = () => {
  if (typeof window === 'undefined' || !window.location.hash.startsWith('#oauth=')) return null;
  try {
    const encoded = decodeURIComponent(window.location.hash.slice('#oauth='.length));
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
    return JSON.parse(decodeURIComponent(escape(window.atob(padded))));
  } catch {
    return { ok: false, error: 'Social login response could not be read.' };
  }
};

const defaultMeteredTurnUrls = [
  'stun:stun.relay.metered.ca:80',
  'turn:standard.relay.metered.ca:80',
  'turn:standard.relay.metered.ca:80?transport=tcp',
  'turn:standard.relay.metered.ca:443',
  'turns:standard.relay.metered.ca:443?transport=tcp'
];

const NORMAL_CALL_VOLUME = 0.35;
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
const displayName = u => u?.nickname || u?.username || '';
const Avatar = ({ user, big = false, className = '', ...props }) => (
  <div
    className={`avatar${big ? ' big' : ''}${className ? ` ${className}` : ''}`}
    style={user?.avatarUrl ? { backgroundImage: `url("${resolveFileUrl(user.avatarUrl)}")` } : undefined}
    {...props}
  >
    {!user?.avatarUrl && initials(displayName(user))}
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
const formatAudioTime = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};
const VoiceMessage = ({ src, mine = false, onClick }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const progress = duration ? Math.min(1, current / duration) : 0;
  const bars = [18, 30, 22, 40, 56, 34, 48, 26, 38, 58, 32, 46, 24, 36, 20, 30];

  useEffect(() => {
    setPlaying(false);
    setDuration(0);
    setCurrent(0);
  }, [src]);

  const toggle = event => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  return (
    <div className={mine ? 'voiceBubble mineVoice' : 'voiceBubble'} onClick={onClick}>
      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={event => setCurrent(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={event => {
          event.currentTarget.currentTime = 0;
          setCurrent(0);
          setPlaying(false);
        }}
      />
      <button type="button" onClick={toggle} aria-label={playing ? 'Pause voice message' : 'Play voice message'}>
        {playing ? <Square /> : <span />}
      </button>
      <div className="voiceWave" aria-hidden="true">
        {bars.map((height, index) => (
          <i
            key={index}
            style={{
              height: `${height}%`,
              opacity: index / bars.length <= progress ? 1 : .48
            }}
          />
        ))}
      </div>
      <time>{formatAudioTime(duration || current)}</time>
    </div>
  );
};
const cid = (a, b) => [String(a), String(b)].sort().join('-');
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
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
    email: '',
    password: '',
    confirmPassword: '',
    twoStepPin: '',
    resetPhone: '',
    resetOtp: '',
    resetPassword: '',
    loginOtp: '',
    loginPassword: '',
    loginNewEmail: ''
  });
  const [resetStep, setResetStep] = useState('phone');
  const [loginStep, setLoginStep] = useState('phone');
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
  const [emojiCategory, setEmojiCategory] = useState('recent');
  const [emojiSearch, setEmojiSearch] = useState('');
  const [showComposerTools, setShowComposerTools] = useState(false);
  const [showLocationShare, setShowLocationShare] = useState(false);
  const [locationDuration, setLocationDuration] = useState(60);
  const [locationBusy, setLocationBusy] = useState(false);
  const [liveLocationSession, setLiveLocationSession] = useState(null);
  const [activeLocationView, setActiveLocationView] = useState(null);
  const [stopLocationPrompt, setStopLocationPrompt] = useState(null);
  const [profile, setProfile] = useState(null);
  const [zoomedPhotoUser, setZoomedPhotoUser] = useState(null);
  const [mediaViewer, setMediaViewer] = useState(null);
  const [profileMode, setProfileMode] = useState('quick');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [chatMenu, setChatMenu] = useState(null);
  const [chatHeaderMenu, setChatHeaderMenu] = useState(null);
  const [showChatMedia, setShowChatMedia] = useState(false);
  const [showStarredMessages, setShowStarredMessages] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [messageSearch, setMessageSearch] = useState('');
  const [searchingMessages, setSearchingMessages] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchLoaded, setGlobalSearchLoaded] = useState(false);
  const [chatTheme, setChatTheme] = useState(() => localStorage.getItem('sc_chat_theme') || 'opal');
  const [showScheduler, setShowScheduler] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [translations, setTranslations] = useState({});
  const [translateChatLanguages, setTranslateChatLanguages] = useState(() => {
    const map = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('sc_translate_chat_')) {
        const value = localStorage.getItem(key);
        if (value && value !== 'enabled') map[key.slice('sc_translate_chat_'.length)] = value;
      }
    }
    return map;
  });
  const [attachmentUrls, setAttachmentUrls] = useState({});
  const [callHistory, setCallHistory] = useState([]);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [callFilter, setCallFilter] = useState('all');
  const [selectedCallLog, setSelectedCallLog] = useState(null);
  const [privacy, setPrivacy] = useState(null);
  const [security, setSecurity] = useState(null);
  const [appLockEnabled, setAppLockEnabled] = useState(() => localStorage.getItem('naad_app_lock_enabled') === '1');
  const [appLocked, setAppLocked] = useState(() => localStorage.getItem('naad_app_lock_enabled') === '1');
  const [appLockPinInput, setAppLockPinInput] = useState('');
  const [appLockError, setAppLockError] = useState('');
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [groupStickersOpen, setGroupStickersOpen] = useState(false);
  const [groupAttachOpen, setGroupAttachOpen] = useState(false);
  const [groupAddMemberOpen, setGroupAddMemberOpen] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [groupMessages, setGroupMessages] = useState({});
  const [groupText, setGroupText] = useState('');
  const [flicks, setFlicks] = useState([]);
  const [flicksLoading, setFlicksLoading] = useState(false);
  const [flicksCursor, setFlicksCursor] = useState(null);
  const [flicksHasMore, setFlicksHasMore] = useState(true);
  const [flicksConfigured, setFlicksConfigured] = useState(true);
  const [flickUploading, setFlickUploading] = useState(false);
  const [flickAudience, setFlickAudience] = useState('contacts');
  const [activeFlickId, setActiveFlickId] = useState(null);
  const flickVideoRefs = useRef({});
  const [groupInvite, setGroupInvite] = useState(null);
  const [selectedGroupMessage, setSelectedGroupMessage] = useState(null);
  const [groupRecording, setGroupRecording] = useState(false);
  const [groupTyping, setGroupTyping] = useState({});
  const [groupCall, setGroupCall] = useState(null);
  const [groupRemoteStreams, setGroupRemoteStreams] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [showStatuses, setShowStatuses] = useState(false);
  const [echoComposerOpen, setEchoComposerOpen] = useState(false);
  // Small in-app chooser used wherever the old code asked users to TYPE a
  // choice into a browser prompt: { title, options: [{label, value}], onPick }.
  const [optionPicker, setOptionPicker] = useState(null);
  // Small in-app form used wherever the old code chained browser prompt()
  // calls to collect a name + description: { title, fields: [{key,label,
  // placeholder,defaultValue}], submitLabel, onSubmit(values) }.
  const [textFormPrompt, setTextFormPrompt] = useState(null);
  const [textFormValues, setTextFormValues] = useState({});
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
  const [speakerVolume, setSpeakerVolume] = useState(NORMAL_CALL_VOLUME);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voicePreview, setVoicePreview] = useState(null);
  const [miniCallPosition, setMiniCallPosition] = useState(null);
  const [localVideoPosition, setLocalVideoPosition] = useState(null);
  const [callOptionsOpen, setCallOptionsOpen] = useState(null);
  const [showCallInvite, setShowCallInvite] = useState(false);
  const [noiseCancellation, setNoiseCancellation] = useState(true);
  const [cameraFacingMode, setCameraFacingMode] = useState('user');

  const ringtoneCtx = useRef(null);
  const ringtoneTimer = useRef(null);
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
  const localVideoDrag = useRef({ dragging: false });
  const endRef = useRef(null);
  const typingTimer = useRef(null);
  const turnCredentialCache = useRef({ iceServers: null, expiresAt: 0 });
  const socketReady = useRef(false);
  const fileTokenRefresh = useRef(null);
  const searchInputRef = useRef(null);
  const activeRef = useRef(null);
  const pendingIce = useRef([]);
  const mediaRecorder = useRef(null);
  const recordingStream = useRef(null);
  const recordingChunks = useRef([]);
  const recordingTimer = useRef(null);
  const recordingSecondsRef = useRef(0);
  const discardRecording = useRef(false);
  const liveLocationWatch = useRef(null);
  const liveLocationState = useRef(null);

  useEffect(() => {
    if (profile) setProfileMode('quick');
  }, [profile?.id]);

  useEffect(() => {
    if (!appLockEnabled) return undefined;
    let wasHidden = false;
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
      } else if (document.visibilityState === 'visible' && wasHidden) {
        wasHidden = false;
        setAppLocked(true);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [appLockEnabled]);

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
    navigator.serviceWorker.register('/sw.js').catch(error => {
      console.error('Service worker registration failed', error);
    });
  }, []);

  useEffect(() => () => {
    if (liveLocationWatch.current !== null && navigator.geolocation?.clearWatch) {
      navigator.geolocation.clearWatch(liveLocationWatch.current);
    }
  }, []);

  useEffect(() => {
    const oauth = readOAuthPayload();
    if (oauth) {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      if (oauth.ok && oauth.token && oauth.user) {
        setSession(oauth.token, oauth.user);
        setMe(oauth.user);
        setScreen('app');
        setTimeout(() => enterApp(), 0);
      } else {
        clearSession();
        setMe(null);
        setErr(oauth.error || 'Social login failed.');
        setAuthMode('login');
        setScreen('auth');
      }
      return () => {
        disconnectSocket();
        cleanupPeer();
      };
    }

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
          email: form.email,
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

  async function requestLoginOtp(e) {
    e.preventDefault();
    setErr('');
    setAuthLoading(true);
    try {
      await api('/api/auth/request-login-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: form.phone })
      });
      setLoginStep('otp');
      setErr('If that phone is registered, a login code was emailed to you.');
    } catch (x) {
      if (x.noEmail) {
        setLoginStep('add-email');
        setErr('');
      } else {
        setErr(x.message);
      }
    } finally {
      setAuthLoading(false);
    }
  }

  async function addLoginEmail(e) {
    e.preventDefault();
    setErr('');
    setAuthLoading(true);
    try {
      await api('/api/auth/add-login-email', {
        method: 'POST',
        body: JSON.stringify({
          phone: form.phone,
          password: form.loginPassword,
          email: form.loginNewEmail
        })
      });
      try {
        await api('/api/auth/request-login-otp', {
          method: 'POST',
          body: JSON.stringify({ phone: form.phone })
        });
        setLoginStep('otp');
        setErr('Email added. A login code was emailed to you.');
      } catch (otpError) {
        setErr(`Email saved to your account. ${otpError.message}`);
      }
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
      const d = await api('/api/auth/login-otp', {
        method: 'POST',
        body: JSON.stringify({
          phone: form.phone,
          otp: form.loginOtp,
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

  async function loginWithPassword(e) {
    e.preventDefault();
    setErr('');
    setAuthLoading(true);

    try {
      const d = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          phone: form.phone,
          password: form.loginPassword,
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

  async function requestReset(e) {
    e.preventDefault();
    setErr('');
    setAuthLoading(true);
    try {
      await api('/api/auth/request-reset', {
        method: 'POST',
        body: JSON.stringify({ phone: form.resetPhone })
      });
      setResetStep('otp');
      setErr('If that phone is registered, a code was emailed to you.');
    } catch (error) {
      setErr(error.message);
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
          otp: form.resetOtp,
          password: form.resetPassword
        })
      });
      setAuthMode('login');
      setResetStep('phone');
      setForm(current => ({
        ...current,
        password: '',
        resetPassword: '',
        resetOtp: ''
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

  async function subscribeToPush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
      }
      if (Notification.permission !== 'granted') return;

      const { publicKey } = await api('/api/push/vapid-public-key').catch(() => ({}));
      if (!publicKey) return;

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }

      await api('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription.toJSON())
      });
    } catch (error) {
      console.error('Push subscription failed', error.message);
    }
  }

  async function enterApp() {
    if (socketReady.current) return;
    socketReady.current = true;

    ensureFileToken();
    if (!fileTokenRefresh.current) {
      fileTokenRefresh.current = setInterval(() => ensureFileToken(), 10 * 60 * 1000);
    }

    subscribeToPush();

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
        showNotification('New Naad message', displayMessage.kind === 'text' ? displayMessage.body : `New ${displayMessage.kind}`);
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

    s.on('message:pinned', d => {
      setMessages(current => ({
        ...current,
        [d.conversationId]: (current[d.conversationId] || []).map(message => (
          message.id === d.messageId ? { ...message, pinned: d.pinned } : message
        ))
      }));
    });

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
      showNotification('New Naad login', d.deviceName);
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

  function createChannel() {
    setTextFormValues({ name: '', description: '' });
    setTextFormPrompt({
      title: 'Create a Circle',
      fields: [
        { key: 'name', label: 'Circle name', placeholder: 'e.g. Weekend hikers' },
        { key: 'description', label: 'Description (optional)', placeholder: 'What is this Circle about?' }
      ],
      submitLabel: 'Create',
      onSubmit: values => submitCreateChannel(values.name.trim(), values.description.trim())
    });
  }

  async function submitCreateChannel(name, description) {
    if (!name) return;
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
    const body = prompt('Share with your Circle:');
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
      alert('Circle media failed: ' + error.message);
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
    const body = prompt('Write an Echo:');
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
        const uploaded = await uploadFile(encrypted?.file || file);
        const content = JSON.stringify({
          body: kind === 'image' ? 'Photo Status' : kind === 'video' ? 'Video Status' : 'Voice Status',
          kind, fileUrl: uploaded.url, fileName: file.name, fileMime: file.type,
          fileEncryption: encrypted?.fileEncryption, senderDeviceId: encrypted?.senderDeviceId
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
        body: encrypted.ciphertext ? '[Encrypted message]' : body,
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

  function createGroup() {
    setTextFormValues({ name: '', description: '' });
    setTextFormPrompt({
      title: 'Create a group',
      fields: [
        { key: 'name', label: 'Group name', placeholder: 'e.g. 308 Lenox st' },
        { key: 'description', label: 'Description (optional)', placeholder: 'What is this group for?' }
      ],
      submitLabel: 'Create',
      onSubmit: values => submitCreateGroup(values.name.trim(), values.description.trim())
    });
  }

  async function submitCreateGroup(name, description) {
    if (!name) return;
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
      // decodeGroupMessage never throws - a message that fails to decrypt is
      // shown inline as "Unable to decrypt this message" instead of blocking
      // the rest of the conversation from loading.
      const decrypted = await Promise.all(history.map(message => decodeGroupMessage(message, group.id)));
      setGroupMessages(current => ({ ...current, [group.id]: decrypted }));
      await api(`/api/groups/${group.id}/read`, { method: 'POST', body: '{}' });
      loadGroups();
    } catch (error) {
      alert('Could not load this group: ' + error.message);
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

  function addGroupMember() {
    if (!selectedGroup) return;
    setGroupAddMemberOpen(true);
  }

  async function confirmAddGroupMember(userId) {
    if (!selectedGroup) return;
    setGroupAddMemberOpen(false);
    try {
      await api(`/api/groups/${selectedGroup.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId })
      });
      await loadGroups();
      setSelectedGroup((await api('/api/groups')).find(group => group.id === selectedGroup.id));
    } catch (error) {
      alert('Could not add that person: ' + error.message);
    }
  }

  async function decodeGroupMessage(message, groupId) {
    let plaintext;
    try {
      plaintext = await decryptGroupMessage(message.senderId, groupId, message.payload);
    } catch (error) {
      console.error('Group message decrypt failed', message.id, error.message);
      return { ...message, body: 'Unable to decrypt this message.', decryptionFailed: true };
    }
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

  async function loadFlicks(reset = false) {
    if (flicksLoading) return;
    setFlicksLoading(true);
    try {
      const cursor = reset ? null : flicksCursor;
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const data = await api('/api/flicks' + query);
      setFlicks(current => reset ? data.items : [...current, ...data.items]);
      setFlicksCursor(data.nextCursor);
      setFlicksHasMore(Boolean(data.nextCursor));
      setFlicksConfigured(true);
    } catch (error) {
      if (String(error.message || '').toLowerCase().includes('not configured')) {
        setFlicksConfigured(false);
      }
    } finally {
      setFlicksLoading(false);
    }
  }

  async function uploadFlick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFlickUploading(true);
    try {
      const form = new FormData();
      form.append('video', file);
      form.append('caption', '');
      form.append('audience', flickAudience);
      const flick = await api('/api/flicks', { method: 'POST', body: form, headers: {} });
      setFlicks(current => [flick, ...current]);
    } catch (error) {
      alert('Could not upload video: ' + error.message);
    } finally {
      setFlickUploading(false);
    }
  }

  async function toggleFlickLike(flick) {
    setFlicks(current => current.map(f => f.id === flick.id
      ? { ...f, liked: !f.liked, likeCount: f.likeCount + (f.liked ? -1 : 1) }
      : f));
    try {
      await api(`/api/flicks/${flick.id}/like`, { method: flick.liked ? 'DELETE' : 'POST' });
    } catch {
      setFlicks(current => current.map(f => f.id === flick.id
        ? { ...f, liked: flick.liked, likeCount: flick.likeCount }
        : f));
    }
  }

  async function deleteFlick(id) {
    if (!confirm('Delete this video?')) return;
    try {
      await api(`/api/flicks/${id}`, { method: 'DELETE' });
      setFlicks(current => current.filter(f => f.id !== id));
    } catch (error) {
      alert('Could not delete video: ' + error.message);
    }
  }

  useEffect(() => {
    if (mobileTab !== 'ai' || flicks.length || !me) return;
    loadFlicks(true);
  }, [mobileTab, me]);

  useEffect(() => {
    const observers = [];
    Object.entries(flickVideoRefs.current).forEach(([id, video]) => {
      if (!video) return;
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            setActiveFlickId(id);
            video.play().catch(() => {});
            api(`/api/flicks/${id}/view`, { method: 'POST' }).catch(() => {});
          } else {
            video.pause();
          }
        });
      }, { threshold: [0, 0.6, 1] });
      observer.observe(video);
      observers.push(observer);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [flicks]);

  async function toggleGroupMute() {
    const muted = selectedGroup.mutedUntil && new Date(selectedGroup.mutedUntil) > new Date();
    const mutedUntil = muted ? null : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
    await api(`/api/groups/${selectedGroup.id}/mute`, {
      method: 'PATCH', body: JSON.stringify({ mutedUntil })
    });
    setSelectedGroup(current => ({ ...current, mutedUntil }));
    loadGroups();
  }

  async function updateGroupPermission(key, value) {
    if (!selectedGroup || selectedGroup.role !== 'admin') return;
    try {
      const result = await api(`/api/groups/${selectedGroup.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({
          sendMessagesPolicy: selectedGroup.sendMessagesPolicy,
          editInfoPolicy: selectedGroup.editInfoPolicy,
          addMembersPolicy: selectedGroup.addMembersPolicy,
          [key]: value
        })
      });
      setSelectedGroup(current => ({ ...current, ...result }));
      loadGroups();
    } catch (error) {
      alert('Could not update group permissions: ' + error.message);
    }
  }

  async function sendGroupFile(event, kind) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || !selectedGroup) return;

    for (const file of files) {
      try {
        const entries = await Promise.all(selectedGroup.members.map(async member => {
          const encrypted = await encryptAttachment(member.id, `group:${selectedGroup.id}`, file);
          const uploaded = await uploadFile(encrypted?.file || file);
          const content = JSON.stringify({
            body: kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : file.name,
            kind, fileUrl: uploaded.url, fileName: file.name, fileMime: file.type,
            fileEncryption: encrypted?.fileEncryption, senderDeviceId: encrypted?.senderDeviceId
          });
          return [member.id, await encryptGroupMessage(member.id, selectedGroup.id, content)];
        }));
        await api(`/api/groups/${selectedGroup.id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ kind, payloads: Object.fromEntries(entries) })
        });
      } catch (error) {
        alert(`Encrypted group attachment failed for ${file.name}: ` + error.message);
      }
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
            const uploaded = await uploadFile(encrypted?.file || voice);
            const content = JSON.stringify({
              body: 'Voice message', kind: 'audio', fileUrl: uploaded.url,
              fileName: voice.name, fileMime: voice.type,
              fileEncryption: encrypted?.fileEncryption, senderDeviceId: encrypted?.senderDeviceId
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
      recorder.start();
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

  function editGroup() {
    setTextFormValues({ name: selectedGroup.name, description: selectedGroup.description || '' });
    setTextFormPrompt({
      title: 'Edit group',
      fields: [
        { key: 'name', label: 'Group name', placeholder: 'Group name' },
        { key: 'description', label: 'Description', placeholder: 'What is this group for?' }
      ],
      submitLabel: 'Save',
      onSubmit: values => submitEditGroup(values.name.trim(), values.description.trim())
    });
  }

  async function submitEditGroup(name, description) {
    if (!name) return;
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
    const value = prompt('Paste a Naad group invite link or token:');
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

  async function openGlobalSearch() {
    setGlobalSearchOpen(true);
    setGlobalSearchQuery('');
    if (globalSearchLoaded || !me) return;
    setGlobalSearchLoading(true);
    try {
      await Promise.all(contacts.map(async contact => {
        const c = cid(me.id, contact.id);
        if (messages[c]?.length) return;
        try {
          const history = await api('/api/messages/' + encodeURIComponent(c));
          const displayHistory = E2EE_ENABLED
            ? await Promise.all((Array.isArray(history) ? history : []).map(async message => {
                if (!message.ciphertext) return message;
                try {
                  return await decryptMessage(message, c);
                } catch {
                  return { ...message, body: '', decryptionFailed: true };
                }
              }))
            : history;
          setMessages(p => (p[c]?.length ? p : { ...p, [c]: Array.isArray(displayHistory) ? displayHistory : [] }));
        } catch (error) {
          console.error('Global search: could not load history for', contact.username, error.message);
        }
      }));
      setGlobalSearchLoaded(true);
    } finally {
      setGlobalSearchLoading(false);
    }
  }

  function globalSearchResults() {
    const q = globalSearchQuery.trim().toLowerCase();
    if (q.length < 2 || !me) return { contactMatches: [], groupMatches: [], messageMatches: [] };

    const contactMatches = contacts.filter(u =>
      u.username?.toLowerCase().includes(q) || u.phone?.includes(q) || u.nickname?.toLowerCase().includes(q)
    );
    const groupMatches = groups.filter(g => g.name?.toLowerCase().includes(q));

    const messageMatches = [];
    contacts.forEach(contact => {
      const c = cid(me.id, contact.id);
      (messages[c] || []).forEach(message => {
        if (message.kind === 'text' && message.body && message.body.toLowerCase().includes(q)) {
          messageMatches.push({ contact, message });
        }
      });
    });
    messageMatches.sort((a, b) => new Date(b.message.createdAt) - new Date(a.message.createdAt));

    return { contactMatches, groupMatches, messageMatches: messageMatches.slice(0, 50) };
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
      const encryptedPayload = E2EE_ENABLED && ['text', 'sticker'].includes(tmp.kind) && String(active.id) !== String(me.id)
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
      return { ...saved, body: tmp.body, encrypted: Boolean(encryptedPayload.ciphertext) };
    } catch (e) {
      setMessages(p => ({
        ...p,
        [c]: (p[c] || []).filter(message => message.id !== tmp.id)
      }));
      if (tmp.kind === 'text') setText(tmp.body);
      alert('Message failed: ' + e.message);
      return null;
    }
  }

  async function file(e, kind) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    if (!files.length || !active) return;

    for (const fl of files) {
      try {
        const conversationId = cid(me.id, active.id);
        const encrypted = E2EE_ENABLED
          ? await encryptAttachment(active.id, conversationId, fl)
          : null;
        const up = await uploadFile(encrypted?.file || fl);

        await send({
          body: kind === 'image' ? 'Photo' : kind === 'video' ? 'Video' : fl.name,
          kind: kind || (fl.type.startsWith('image/') ? 'image' : fl.type.startsWith('video/') ? 'video' : 'file'),
          fileUrl: up.url,
          fileName: fl.name,
          fileMime: fl.type,
          fileEncryption: encrypted?.fileEncryption,
          senderDeviceId: encrypted?.senderDeviceId
        });
      } catch (error) {
        alert(`Upload failed for ${fl.name}: ` + error.message);
      }
    }
  }

  function parseLocationMessage(message) {
    try {
      const data = JSON.parse(message.body || '{}');
      if (typeof data.lat !== 'number' || typeof data.lng !== 'number') return null;
      return data;
    } catch {
      return null;
    }
  }

  function isLiveLocationActive(data) {
    if (!data?.liveMinutes || data.stoppedAt) return false;
    return !data.expiresAt || new Date(data.expiresAt).getTime() > Date.now();
  }

  function locationMapUrl(data) {
    return `https://www.google.com/maps?q=${data.lat},${data.lng}`;
  }

  function locationTimeLabel(value) {
    if (!value) return 'just now';
    try {
      return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'just now';
    }
  }

  function updateLocationInState(messageId, body) {
    setMessages(current => {
      const next = { ...current };
      Object.keys(next).forEach(conversationId => {
        next[conversationId] = (next[conversationId] || []).map(message => (
          message.id === messageId ? { ...message, body, editedAt: new Date().toISOString() } : message
        ));
      });
      return next;
    });
  }

  function requestCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Location is not supported on this device.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000
      });
    });
  }

  async function saveLiveLocationUpdate(messageId, payload) {
    const body = JSON.stringify(payload);
    updateLocationInState(messageId, body);
    const updated = await api(`/api/messages/${messageId}/location`, {
      method: 'PATCH',
      body: JSON.stringify({ body })
    });
    setMessages(current => ({
      ...current,
      [updated.conversationId]: (current[updated.conversationId] || []).map(message => (
        message.id === updated.id ? { ...message, ...updated, body } : message
      ))
    }));
    loadChats();
    return updated;
  }

  function beginLiveLocationUpdates(message, payload) {
    if (!message?.id || !payload.liveMinutes || !navigator.geolocation?.watchPosition) return;

    if (liveLocationWatch.current !== null) {
      navigator.geolocation.clearWatch(liveLocationWatch.current);
    }

    const session = {
      messageId: message.id,
      conversationId: message.conversationId,
      recipientName: active?.username || 'this chat',
      payload,
      lastSentAt: 0
    };
    liveLocationState.current = session;
    setLiveLocationSession({
      messageId: message.id,
      recipientName: session.recipientName,
      expiresAt: payload.expiresAt,
      updatedAt: payload.updatedAt
    });

    liveLocationWatch.current = navigator.geolocation.watchPosition(position => {
      const current = liveLocationState.current;
      if (!current || current.messageId !== message.id) return;

      if (current.payload.expiresAt && new Date(current.payload.expiresAt).getTime() <= Date.now()) {
        stopLiveLocation(true);
        return;
      }

      const now = Date.now();
      if (now - current.lastSentAt < 10000) return;

      const nextPayload = {
        ...current.payload,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        updatedAt: new Date(now).toISOString()
      };
      current.payload = nextPayload;
      current.lastSentAt = now;
      setLiveLocationSession(sessionState => sessionState?.messageId === message.id
        ? { ...sessionState, updatedAt: nextPayload.updatedAt }
        : sessionState);
      saveLiveLocationUpdate(message.id, nextPayload).catch(error => {
        console.warn('Live location update failed', error.message);
      });
    }, error => {
      alert('Live location paused: ' + (error.message || 'Location permission or signal was lost.'));
      stopLiveLocation(false);
    }, {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 8000
    });
  }

  async function stopLiveLocation(silent = false, messageId = liveLocationState.current?.messageId) {
    if (liveLocationWatch.current !== null && navigator.geolocation?.clearWatch) {
      navigator.geolocation.clearWatch(liveLocationWatch.current);
      liveLocationWatch.current = null;
    }

    const current = liveLocationState.current;
    liveLocationState.current = null;
    setLiveLocationSession(null);
    setStopLocationPrompt(null);

    const sourcePayload = current?.payload || stopLocationPrompt?.data;
    if (!messageId || !sourcePayload) return;

    const stoppedPayload = {
      ...sourcePayload,
      stoppedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await saveLiveLocationUpdate(messageId, stoppedPayload);
    } catch (error) {
      if (!silent) alert('Could not stop live location: ' + error.message);
    }
  }

  async function shareLocation() {
    if (!active) return;
    setLocationBusy(true);
    try {
      const position = await requestCurrentPosition();
      const now = new Date();
      const liveMinutes = Number(locationDuration || 0);
      const payload = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        liveMinutes,
        label: liveMinutes ? `Live for ${liveMinutes === 60 ? '1 hour' : liveMinutes >= 60 ? `${liveMinutes / 60} hours` : `${liveMinutes} minutes`}` : 'Current Location',
        place: 'Shared location',
        updatedAt: now.toISOString(),
        expiresAt: liveMinutes ? new Date(now.getTime() + liveMinutes * 60000).toISOString() : null
      };
      const saved = await send({
        body: JSON.stringify(payload),
        kind: 'location'
      });
      if (saved && liveMinutes) beginLiveLocationUpdates(saved, payload);
      setShowLocationShare(false);
      setShowComposerTools(false);
    } catch (error) {
      alert('Location sharing failed: ' + (error.message || 'Please allow location permission and try again.'));
    } finally {
      setLocationBusy(false);
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

  function editMyProfile() {
    setTextFormValues({
      username: me?.username || '',
      about: me?.about || '',
      languages: me?.languages || ''
    });
    setTextFormPrompt({
      title: 'Edit profile',
      fields: [
        { key: 'username', label: 'Username', placeholder: 'Your name', maxLength: 80 },
        { key: 'about', label: 'About', placeholder: 'Hey there! I am using Naad.', maxLength: 200, multiline: true },
        { key: 'languages', label: 'Languages', placeholder: 'e.g. English, Hindi', maxLength: 200 }
      ],
      submitLabel: 'Save',
      onSubmit: async values => {
        try {
          const updated = await api('/api/profile', {
            method: 'PATCH',
            body: JSON.stringify({
              username: values.username.trim(),
              about: values.about.trim(),
              languages: values.languages.trim()
            })
          });
          setMe(updated);
          setProfile(updated);
          setSession(getToken(), updated);
        } catch (error) {
          alert('Could not save profile: ' + error.message);
        }
      }
    });
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

  async function deleteAccount() {
    if (!confirm('Permanently delete your account, messages and call history? This cannot be undone.')) return;
    const password = prompt('Enter your password to permanently delete the account:');
    if (!password) return;
    await api('/api/account', { method: 'DELETE', body: JSON.stringify({ password }) });
    setSecurity(null);
    logout();
  }

  async function hashAppLockPin(pin) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function openAppLockSetup() {
    setTextFormValues({ pin: '', confirmPin: '' });
    setTextFormPrompt({
      title: 'Set an app lock PIN',
      fields: [
        { key: 'pin', label: 'PIN (4-8 digits)', placeholder: '••••', type: 'password', inputMode: 'numeric', maxLength: 8 },
        { key: 'confirmPin', label: 'Confirm PIN', placeholder: '••••', type: 'password', inputMode: 'numeric', maxLength: 8 }
      ],
      submitLabel: 'Turn on',
      onSubmit: async values => {
        const pin = (values.pin || '').trim();
        const confirmPin = (values.confirmPin || '').trim();
        if (!/^\d{4,8}$/.test(pin)) return alert('PIN must be 4-8 digits.');
        if (pin !== confirmPin) return alert('PINs did not match.');
        const hash = await hashAppLockPin(pin);
        localStorage.setItem('naad_app_lock_hash', hash);
        localStorage.setItem('naad_app_lock_enabled', '1');
        setAppLockEnabled(true);
      }
    });
  }

  function disableAppLock() {
    if (!confirm('Turn off app lock?')) return;
    localStorage.removeItem('naad_app_lock_hash');
    localStorage.removeItem('naad_app_lock_enabled');
    setAppLockEnabled(false);
    setAppLocked(false);
  }

  async function attemptUnlock(pin) {
    const hash = await hashAppLockPin(pin);
    const stored = localStorage.getItem('naad_app_lock_hash');
    if (stored && hash === stored) {
      setAppLocked(false);
      setAppLockPinInput('');
      setAppLockError('');
    } else {
      setAppLockError('Incorrect PIN');
      setAppLockPinInput('');
    }
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

  function openProfileConversation(target = profile) {
    if (!target) return;
    setActive(target);
    setMobileTab('chats');
    setProfile(null);
  }

  function callProfile(type) {
    if (!profile) return;
    const target = profile;
    setActive(target);
    setMobileTab('chats');
    setProfile(null);
    startCall(type, target);
  }

  function shareProfileLocation() {
    if (!profile) return;
    setActive(profile);
    setMobileTab('chats');
    setProfile(null);
    setShowLocationShare(true);
  }

  function openProfileMedia() {
    if (!profile) return;
    setActive(profile);
    setMobileTab('chats');
    setProfile(null);
    setShowChatMedia(true);
  }

  function openProfileStarred() {
    if (!profile) return;
    setActive(profile);
    setMobileTab('chats');
    setProfile(null);
    setShowStarredMessages(true);
  }

  async function unstarMessageDirect(messageId) {
    if (!active || !me) return;
    try {
      const result = await api(`/api/messages/${encodeURIComponent(messageId)}/star`, { method: 'POST', body: '{}' });
      const c = cid(me.id, active.id);
      setMessages(current => ({
        ...current,
        [c]: (current[c] || []).map(message => (message.id === messageId ? { ...message, starred: result.starred } : message))
      }));
    } catch (error) {
      alert('Could not update star: ' + error.message);
    }
  }

  function editContactNickname() {
    if (!profile || !me) return;
    setTextFormValues({ nickname: profile.nickname || '' });
    setTextFormPrompt({
      title: `Nickname for ${profile.username}`,
      fields: [
        { key: 'nickname', label: 'Nickname (only visible to you)', placeholder: profile.username, maxLength: 80, required: false }
      ],
      submitLabel: 'Save',
      onSubmit: async values => {
        const nickname = values.nickname.trim();
        try {
          await api(`/api/contacts/${profile.id}/nickname`, {
            method: 'PATCH',
            body: JSON.stringify({ nickname })
          });
          setProfile(current => (current ? { ...current, nickname: nickname || null } : current));
          setContacts(current => current.map(contact => (
            String(contact.id) === String(profile.id) ? { ...contact, nickname: nickname || null } : contact
          )));
          setActive(current => (
            current && String(current.id) === String(profile.id) ? { ...current, nickname: nickname || null } : current
          ));
        } catch (error) {
          alert('Could not save nickname: ' + error.message);
        }
      }
    });
  }

  function toggleProfileTranslation() {
    if (!profile || !me) return;
    const c = cid(me.id, profile.id);
    if (translateChatLanguages[c]) {
      localStorage.removeItem(`sc_translate_chat_${c}`);
      setTranslateChatLanguages(current => {
        const next = { ...current };
        delete next[c];
        return next;
      });
      setActive(profile);
      setMobileTab('chats');
      setProfile(null);
      return;
    }
    if (!globalThis.LanguageDetector || !globalThis.Translator) {
      alert('Private on-device translation is available in supported desktop Chrome versions. It is not available in this browser yet.');
      return;
    }
    setOptionPicker({
      title: 'Translate chat to',
      options: [
        { label: 'English', value: 'en' },
        { label: 'हिन्दी (Hindi)', value: 'hi' },
        { label: 'తెలుగు (Telugu)', value: 'te' },
        { label: 'Español (Spanish)', value: 'es' },
        { label: 'Français (French)', value: 'fr' }
      ],
      onPick: targetLanguage => {
        // Called synchronously from the click so the on-device model
        // download (first use only) has the required user-gesture context -
        // without it Chrome silently refuses to start. Not awaited: the
        // download can take a while and shouldn't block navigating away.
        globalThis.LanguageDetector.create().catch(error => {
          console.error('Translate chat: could not prepare language detector', error.message);
        });
        localStorage.setItem(`sc_translate_chat_${c}`, targetLanguage);
        setTranslateChatLanguages(current => ({ ...current, [c]: targetLanguage }));
        setActive(profile);
        setMobileTab('chats');
        setProfile(null);
      }
    });
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
          forceUnread: Boolean(current.forceUnread),
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

  function closeChatHeaderMenu() {
    setChatHeaderMenu(null);
  }

  function activeConversationRows() {
    if (!active || !me) return [];
    return messages[cid(me.id, active.id)] || [];
  }

  async function reportActiveChat() {
    if (!active) return;
    closeChatHeaderMenu();
    const reason = prompt(`Why are you reporting ${active.username}?`);
    if (!reason) return;
    try {
      await api(`/api/users/${active.id}/report`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      alert('Report submitted.');
    } catch (error) {
      alert('Report failed: ' + error.message);
    }
  }

  async function blockActiveChat() {
    if (!active || !confirm(`Block ${active.username}? They will not be able to message or call you.`)) return;
    closeChatHeaderMenu();
    try {
      await api(`/api/users/${active.id}/block`, { method: 'POST', body: '{}' });
      setActive(null);
      loadChats();
    } catch (error) {
      alert('Block failed: ' + error.message);
    }
  }

  async function clearActiveChat() {
    if (!active) return;
    closeChatHeaderMenu();
    await deleteChatForMe(active);
  }

  function exportActiveChat() {
    if (!active || !me) return;
    closeChatHeaderMenu();
    const rows = activeConversationRows();
    const lines = rows.map(message => {
      const sender = String(message.senderId) === String(me.id) ? me.username : active.username;
      const body = message.kind === 'audio' ? '[Voice message]'
        : message.kind === 'image' ? `[Photo] ${message.fileName || ''}`
          : message.kind === 'file' ? `[File] ${message.fileName || message.body || ''}`
            : message.kind === 'location' ? '[Location]'
              : message.body || '';
      return `[${new Date(message.createdAt).toLocaleString()}] ${sender}: ${body}`;
    });
    const blob = new Blob([lines.join('\n') || 'No messages to export.'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chat-with-${active.username || 'user'}-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function toggleActiveMute() {
    if (!active) return;
    const current = contacts.find(contact => String(contact.id) === String(active.id)) || active;
    const muted = current.chat?.mutedUntil && new Date(current.chat.mutedUntil) > new Date();
    closeChatHeaderMenu();
    await updateChatPreference(current, {
      mutedUntil: muted ? null : new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    });
  }

  function setActiveDisappearingMessages() {
    if (!active) return;
    closeChatHeaderMenu();
    const current = contacts.find(contact => String(contact.id) === String(active.id)) || active;
    setOptionPicker({
      title: 'Disappearing messages',
      options: [
        { label: 'Off', value: 0 },
        { label: '24 hours', value: 86400 },
        { label: '7 days', value: 604800 },
        { label: '90 days', value: 7776000 }
      ],
      onPick: async seconds => {
        await updateChatPreference(current, { disappearingSeconds: seconds });
        alert(seconds === 0
          ? 'Disappearing messages turned off.'
          : `New messages in this chat will disappear after ${seconds === 86400 ? '24 hours' : seconds === 604800 ? '7 days' : '90 days'}.`);
      }
    });
  }

  function openActiveMediaPanel() {
    closeChatHeaderMenu();
    setShowChatMedia(true);
  }

  const activeChatEntry = active ? (contacts.find(contact => String(contact.id) === String(active.id)) || active) : null;
  const activeChatMuted = Boolean(activeChatEntry?.chat?.mutedUntil && new Date(activeChatEntry.chat.mutedUntil) > new Date());
  const activeChatPinned = Boolean(activeChatEntry?.chat?.pinned);

  // Header subtitle names who's in the room ("Bobby, Katam, Kiran +2") rather
  // than printing a bare member count.
  function groupMemberSummary(group) {
    const names = (group.members || []).map(member => member.username).filter(Boolean);
    if (!names.length) return 'No members yet';
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
  }

  function toggleActivePin() {
    if (!activeChatEntry) return;
    closeChatHeaderMenu();
    updateChatPreference(activeChatEntry, { pinned: !activeChatPinned });
  }

  function changeActiveChatTheme() {
    closeChatHeaderMenu();
    setOptionPicker({
      title: 'Chat theme',
      options: [
        { label: 'Opal', value: 'opal' },
        { label: 'Light', value: 'light' },
        { label: 'Sky', value: 'sky' },
        { label: 'Dark', value: 'dark' }
      ],
      onPick: theme => {
        localStorage.setItem('sc_chat_theme', theme);
        setChatTheme(theme);
        alert(`Theme "${theme.charAt(0).toUpperCase()}${theme.slice(1)}" applied. Open any chat to see the new background.`);
      }
    });
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
      recorder.onstop = () => {
        clearInterval(recordingTimer.current);
        stream.getTracks().forEach(track => track.stop());
        recordingStream.current = null;
        setRecording(false);
        const wasDiscarded = discardRecording.current;
        discardRecording.current = false;
        const type = recorder.mimeType || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const blob = new Blob(recordingChunks.current, { type });
        const seconds = recordingSecondsRef.current;
        recordingChunks.current = [];
        if (wasDiscarded || !blob.size) return;
        setVoicePreview({ url: URL.createObjectURL(blob), blob, mimeType: type, extension, seconds });
      };
      recorder.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
      recordingTimer.current = setInterval(() => {
        setRecordingSeconds(value => {
          recordingSecondsRef.current = value + 1;
          return value + 1;
        });
      }, 1000);
    } catch (error) {
      alert(mediaErrorMessage(error, 'audio'));
    }
  }

  function stopVoiceRecording() {
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    mediaRecorder.current = null;
    setRecordingSeconds(0);
  }

  function cancelVoiceRecording() {
    discardRecording.current = true;
    if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop();
    mediaRecorder.current = null;
    setRecordingSeconds(0);
  }

  function discardVoicePreview() {
    if (voicePreview) URL.revokeObjectURL(voicePreview.url);
    setVoicePreview(null);
  }

  async function sendVoicePreview() {
    if (!voicePreview || !active || !me) return;
    const preview = voicePreview;
    URL.revokeObjectURL(preview.url);
    setVoicePreview(null);
    try {
      const voiceFile = new File([preview.blob], `voice-${Date.now()}.${preview.extension}`, { type: preview.mimeType });
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
  }

  function beginReply() {
    setReplyTo(selectedMessage);
    setSelectedMessage(null);
  }

  function beginForward() {
    setForwardingMessage(selectedMessage);
    setSelectedMessage(null);
  }

  async function confirmForward(contact) {
    const message = forwardingMessage;
    setForwardingMessage(null);
    if (!message || !contact || !me) return;

    const conversationId = cid(me.id, contact.id);
    try {
      let fileUrl = message.fileUrl;
      let fileName = message.fileName;
      let fileMime = message.fileMime;
      let fileEncryption;
      let senderDeviceId;

      if (fileUrl && ['image', 'file', 'audio'].includes(message.kind)) {
        // Re-upload rather than reuse the original URL: the original's
        // /uploads authorization is scoped to the sender/recipient of the
        // message it was first attached to, which the forward's new
        // recipient isn't part of.
        const sourceUrl = attachmentUrls[message.id] || resolveFileUrl(message.fileUrl);
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error('Could not read the original attachment.');
        const blob = await response.blob();
        const file = new File([blob], fileName || 'forwarded', { type: fileMime || blob.type });
        const encrypted = E2EE_ENABLED ? await encryptAttachment(contact.id, conversationId, file) : null;
        const uploaded = await uploadFile(encrypted?.file || file);
        fileUrl = uploaded.url;
        fileName = fileName || uploaded.name;
        fileMime = fileMime || uploaded.mime;
        fileEncryption = encrypted?.fileEncryption;
        senderDeviceId = encrypted?.senderDeviceId;
      }

      const encryptedPayload = E2EE_ENABLED && ['text', 'sticker'].includes(message.kind)
        ? await encryptMessage(contact.id, conversationId, message.body)
        : {};

      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          recipientId: contact.id,
          body: encryptedPayload.ciphertext ? '[Encrypted message]' : message.body,
          kind: message.kind,
          fileUrl, fileName, fileMime,
          fileEncryption: fileEncryption ?? message.fileEncryption,
          senderDeviceId: encryptedPayload.senderDeviceId || senderDeviceId,
          ...encryptedPayload
        })
      });
      alert(`Forwarded to ${contact.username}.`);
    } catch (error) {
      alert('Could not forward: ' + error.message);
    }
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

  async function toggleMessagePin() {
    if (!selectedMessage || String(selectedMessage.id).startsWith('tmp')) return;
    try {
      const result = await api(`/api/messages/${encodeURIComponent(selectedMessage.id)}/pin`, {
        method: 'POST',
        body: '{}'
      });
      const c = cid(me.id, active.id);
      setMessages(current => ({
        ...current,
        [c]: (current[c] || []).map(message => (
          message.id === selectedMessage.id ? { ...message, pinned: result.pinned } : message
        ))
      }));
      setSelectedMessage(null);
    } catch (error) {
      alert('Could not pin message: ' + error.message);
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

  function translateSelectedMessage() {
    if (!selectedMessage?.body) return;
    if (!globalThis.LanguageDetector || !globalThis.Translator) {
      alert('Private on-device translation is available in supported desktop Chrome versions. It is not available in this browser yet.');
      return;
    }
    const message = selectedMessage;
    setOptionPicker({
      title: 'Translate to',
      options: [
        { label: 'English', value: 'en' },
        { label: 'हिन्दी (Hindi)', value: 'hi' },
        { label: 'తెలుగు (Telugu)', value: 'te' },
        { label: 'Español (Spanish)', value: 'es' },
        { label: 'Français (French)', value: 'fr' }
      ],
      onPick: async targetLanguage => {
        try {
          const detector = await globalThis.LanguageDetector.create();
          const detected = await detector.detect(message.body);
          const sourceLanguage = detected[0]?.detectedLanguage;
          if (!sourceLanguage) throw new Error('Language could not be detected.');
          if (sourceLanguage === targetLanguage) {
            setTranslations(current => ({ ...current, [message.id]: message.body }));
          } else {
            const translator = await globalThis.Translator.create({ sourceLanguage, targetLanguage });
            const translated = await translator.translate(message.body);
            setTranslations(current => ({ ...current, [message.id]: translated }));
          }
          setSelectedMessage(null);
        } catch (error) {
          alert('Translation failed: ' + error.message);
        }
      }
    });
  }

  async function saveEdit() {
    if (!editingMessage || !text.trim()) return;
    const c = cid(me.id, active.id);
    try {
      const encryptedPayload = E2EE_ENABLED && String(active.id) !== String(me.id)
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
    const callRoomId = createCallRoomId();

    setCall({
      active: true,
      minimized: false,
      type,
      videoCapable: type === 'video',
      title: (type === 'video' ? 'Video' : 'Voice') + ' call with ' + callContact.username,
      status: 'Calling...',
      seconds: 0,
      roomId: callRoomId
    });

    try {
      await connectLiveKitCall(callContact.id, type, callRoomId);

      const ack = await emitWithAck(getSocket(), 'call:offer', {
        recipientId: callContact.id,
        offer: { livekit: true },
        callType: type,
        videoIntent: type === 'video',
        callRoomId,
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
      seconds: 0,
      roomId: d.callRoomId || createCallRoomId()
    });

    try {
      await connectLiveKitCall(d.callerId, callType, d.callRoomId || '');

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

  function createCallRoomId() {
    return globalThis.crypto?.randomUUID?.() || '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, value =>
      (Number(value) ^ Math.random() * 16 >> Number(value) / 4).toString(16)
    );
  }

  async function connectLiveKitCall(peerId, type, callRoomId = '') {
    await disconnectLiveKit();
    callPeer.current = peerId;
    const credentials = await api('/api/calls/livekit-token', {
      method: 'POST',
      body: JSON.stringify({ peerId, callRoomId })
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

  // The stylesheet positions .local with !important (several legacy layers do),
  // which beats plain inline styles - so the drag position must be applied as
  // inline !important via setProperty, not through React's style prop.
  useEffect(() => {
    const el = localVideo.current;
    if (!el) return;
    if (!localVideoPosition) {
      ['left', 'top', 'right', 'bottom'].forEach(p => el.style.removeProperty(p));
      return;
    }
    el.style.setProperty('left', localVideoPosition.x + 'px', 'important');
    el.style.setProperty('top', localVideoPosition.y + 'px', 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
  }, [localVideoPosition, call.active, call.type, call.minimized]);

  function startLocalVideoDrag(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    localVideoDrag.current = {
      dragging: true,
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveLocalVideoDrag(event) {
    const drag = localVideoDrag.current;
    if (!drag.dragging || drag.pointerId !== event.pointerId) return;
    const maxX = Math.max(8, window.innerWidth - drag.width - 8);
    const maxY = Math.max(8, window.innerHeight - drag.height - 8);
    setLocalVideoPosition({
      x: Math.min(Math.max(8, event.clientX - drag.offsetX), maxX),
      y: Math.min(Math.max(8, event.clientY - drag.offsetY), maxY)
    });
  }

  function endLocalVideoDrag(event) {
    if (localVideoDrag.current.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      localVideoDrag.current = { dragging: false };
    }
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

  // Synthesized rather than an audio file: no external asset to license or
  // download, and it plays instantly with zero network dependency.
  function startRingtone() {
    if (ringtoneTimer.current) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!ringtoneCtx.current) ringtoneCtx.current = new Ctx();
      const ctx = ringtoneCtx.current;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});

      const playChime = () => {
        const now = ctx.currentTime;
        [0, 0.2].forEach((offset, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = i === 0 ? 587.33 : 880;
          gain.gain.setValueAtTime(0, now + offset);
          gain.gain.linearRampToValueAtTime(0.2, now + offset + 0.02);
          gain.gain.linearRampToValueAtTime(0, now + offset + 0.34);
          osc.connect(gain).connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.36);
        });
      };
      playChime();
      ringtoneTimer.current = setInterval(playChime, 1900);
    } catch {}
  }

  function stopRingtone() {
    if (ringtoneTimer.current) {
      clearInterval(ringtoneTimer.current);
      ringtoneTimer.current = null;
    }
  }

  useEffect(() => {
    if (incoming) startRingtone();
    else stopRingtone();
    return stopRingtone;
  }, [incoming]);

  function endCall(skip = false) {
    if (!skip && callPeer.current) {
      getSocket()?.emit('call:end', { recipientId: callPeer.current });
    }

    cleanupPeer();

    callPeer.current = null;
    setMicOn(true);
    setCamOn(true);
    setLocalVideoPosition(null);

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
    setLocalVideoPosition(null);
    setCallOptionsOpen(null);
    setShowCallInvite(false);
    setSpeakerMuted(false);
    setSpeakerVolume(NORMAL_CALL_VOLUME);
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

  async function flipCamera() {
    const nextFacing = cameraFacingMode === 'user' ? 'environment' : 'user';
    try {
      const constraints = { ...videoConstraintsForNetwork(), facingMode: { ideal: nextFacing } };

      if (liveKitRoom.current) {
        // Stop the current camera BEFORE opening the other one - many Android
        // devices refuse to open a second camera while the first is still live.
        const oldTrack = liveKitLocalTracks.current.find(track => track.kind === Track.Kind.Video);
        if (oldTrack) {
          liveKitRoom.current.localParticipant.unpublishTrack?.(oldTrack.mediaStreamTrack);
          oldTrack.stop?.();
          liveKitLocalTracks.current = liveKitLocalTracks.current.filter(track => track !== oldTrack);
        }
        const nextTrack = await createLocalVideoTrack(constraints);
        liveKitLocalTracks.current.push(nextTrack);
        await liveKitRoom.current.localParticipant.publishTrack(nextTrack);
        setCameraFacingMode(nextFacing);
        setCamOn(true);
        setCall(current => ({ ...current, type: 'video', videoCapable: true }));
        rebuildLiveKitStreams();
        return;
      }

      if (!pc.current || !localStream.current) return;
      // Same ordering rule as above: release the current camera first, or the
      // getUserMedia call for the other camera fails on many Android devices.
      localStream.current.getVideoTracks().forEach(track => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
      const nextTrack = stream.getVideoTracks()[0];
      const sender = pc.current.getSenders?.().find(item => item.track?.kind === 'video');
      if (sender) await sender.replaceTrack(nextTrack);
      else pc.current.addTrack(nextTrack, localStream.current);
      localStream.current = new MediaStream([
        ...localStream.current.getAudioTracks(),
        nextTrack
      ]);
      setCameraFacingMode(nextFacing);
      setCamOn(true);
      setCall(current => ({ ...current, type: 'video', videoCapable: true }));
      attachCallMedia();
      await tuneMobileVideoSender(pc.current);
      await renegotiateCall('Camera flipped');
    } catch (error) {
      setCallError('Could not switch camera. This device or browser may only expose one camera.');
    }
  }

  async function shareScreenInCall() {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) return;

      if (liveKitRoom.current) {
        await liveKitRoom.current.localParticipant.publishTrack(screenTrack);
        liveKitLocalTracks.current.push({
          kind: Track.Kind.Video,
          mediaStreamTrack: screenTrack,
          stop: () => screenTrack.stop()
        });
        screenTrack.onended = () => rebuildLiveKitStreams();
        setCall(current => ({ ...current, type: 'video', videoCapable: true, status: 'Screen sharing' }));
        rebuildLiveKitStreams();
        setCallOptionsOpen(null);
        return;
      }

      if (!pc.current || !localStream.current) return;
      const sender = pc.current.getSenders?.().find(item => item.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screenTrack);
      else pc.current.addTrack(screenTrack, localStream.current);
      localStream.current.getVideoTracks().forEach(track => track.stop());
      localStream.current = new MediaStream([
        ...localStream.current.getAudioTracks(),
        screenTrack
      ]);
      screenTrack.onended = () => setCall(current => ({ ...current, status: 'Connected' }));
      setCamOn(true);
      setCall(current => ({ ...current, type: 'video', videoCapable: true, status: 'Screen sharing' }));
      attachCallMedia();
      await renegotiateCall('Screen sharing');
      setCallOptionsOpen(null);
    } catch (error) {
      if (error?.name !== 'NotAllowedError') setCallError('Screen sharing could not start on this device.');
    }
  }

  async function invitePersonToCall(contact) {
    if (!contact || !call.active) return;
    if (String(contact.id) === String(me?.id) || String(contact.id) === String(callPeer.current)) {
      alert('This person is already in this call.');
      return;
    }
    const callRoomId = call.roomId || createCallRoomId();
    setCall(current => ({
      ...current,
      roomId: callRoomId,
      status: `Inviting ${contact.username}...`
    }));

    try {
      const ack = await emitWithAck(getSocket(), 'call:offer', {
        recipientId: contact.id,
        offer: { livekit: true },
        callType: call.type,
        videoIntent: call.type === 'video' || call.videoCapable,
        callRoomId,
        network: callNetworkInfo()
      });
      if (ack && ack.ok === false) throw new Error(ack.message || 'Could not invite this person.');
      setShowCallInvite(false);
      setCallOptionsOpen(null);
      setCall(current => ({
        ...current,
        roomId: callRoomId,
        title: current.title.includes('Group call') ? current.title : `Group call with ${callContactName}`,
        status: `${contact.username} invited`
      }));
    } catch (error) {
      setCall(current => ({ ...current, status: 'Connected' }));
      alert('Could not add this person: ' + (error.message || 'Please try again.'));
    }
  }

  async function toggleNoiseCancellation() {
    const next = !noiseCancellation;
    setNoiseCancellation(next);
    const tracks = localStream.current?.getAudioTracks?.() || [];
    await Promise.all(tracks.map(track => track.applyConstraints?.({
      echoCancellation: next,
      noiseSuppression: next,
      autoGainControl: next
    }).catch(() => {})));
  }

  function sendMessageDuringCall() {
    setCallOptionsOpen(null);
    setCall(current => ({ ...current, minimized: true }));
  }

  function logout() {
    endCall(true);
    disconnectSocket();
    socketReady.current = false;
    if (fileTokenRefresh.current) {
      clearInterval(fileTokenRefresh.current);
      fileTokenRefresh.current = null;
    }
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
  const profileRows = profile && me && String(profile.id) !== String(me.id)
    ? messages[cid(me.id, profile.id)] || []
    : [];
  const profileMediaCount = profileRows.filter(message =>
    ['image', 'file', 'audio', 'location'].includes(message.kind) || /^https?:\/\//i.test(message.body || '')
  ).length;
  const profileStarredCount = profileRows.filter(message => message.starred).length;
  const profileIsMe = profile && String(profile.id) === String(me?.id);
  const profileOnlineText = profile?.online ? 'Online' : 'Offline';
  const profileLastSeenText = profile?.online ? 'Last active now' : 'Last active recently';
  const profileMemberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleString(undefined, { month: 'long', year: 'numeric' })
    : 'Recently';
  const filteredCalls = callHistory.filter(item => {
    if (callFilter === 'all') return true;
    if (callFilter === 'missed') return ['missed', 'declined', 'failed'].includes(item.status);
    return item.direction === callFilter;
  });
  const callContactName = call.title.split(' with ').pop() || call.title;
  const callDurationText = `${String(Math.floor(call.seconds / 60)).padStart(2, '0')}:${String(call.seconds % 60).padStart(2, '0')}`;
  const callCanUseVideo = call.type === 'video' || call.videoCapable;
  const visibleContacts = contacts.filter(user => {
    if (Boolean(user.chat?.archived) !== showArchived) return false;
    if (chatListFilter === 'unread') return Number(user.chat?.unreadCount || 0) > 0;
    if (chatListFilter !== 'all') return false;
    return true;
  });
  const mobileTitle = {
    chats: 'Naad',
    calls: 'Calls',
    ai: 'Naad',
    status: 'Echoes',
    settings: 'Settings'
  }[mobileTab] || 'Naad';
  const settingsHandle = `@${String(me?.username || 'user').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'user'}`;
  const settingsSections = [
    {
      title: 'Account & Settings',
      rows: [
        {
          label: 'Account',
          detail: 'Manage your profile, username and phone',
          icon: <User />,
          action: () => setProfile(me)
        },
        {
          label: 'Privacy',
          detail: 'Control your privacy and security',
          icon: <Lock />,
          action: openPrivacy
        },
        {
          label: 'Notifications',
          detail: 'Message, call and app notifications',
          icon: <Bell />,
          action: requestNotifications
        },
        {
          label: 'Chat theme',
          detail: 'Opal, Light, Sky, or Dark',
          icon: <Settings />,
          action: changeActiveChatTheme
        },
        {
          label: 'Security',
          detail: 'Password, two-step verification, linked devices',
          icon: <Shield />,
          action: openSecurity
        },
        {
          label: 'Flicks audience',
          detail: flickAudience === 'everyone' ? 'New Flicks visible to everyone' : 'New Flicks visible to your contacts',
          icon: <Video />,
          action: () => setOptionPicker({
            title: 'Who sees your new Flicks?',
            options: [
              { label: 'My contacts', value: 'contacts' },
              { label: 'Everyone on Naad', value: 'everyone' }
            ],
            onPick: audience => {
              setFlickAudience(audience);
              alert(audience === 'everyone'
                ? 'New Flicks you share will be visible to everyone on Naad.'
                : 'New Flicks you share will be visible only to your contacts.');
            }
          })
        }
      ]
    },
    {
      title: 'Support',
      rows: [
        {
          label: 'About Naad',
          detail: 'App version 1.0.0',
          icon: <Info />,
          action: () => alert('Naad version 1.0.0')
        }
      ]
    }
  ];
  const emojiQuery = emojiSearch.trim().toLowerCase();
  const visibleEmojiSections = emojiQuery
    ? emojiSections
        .map(section => ({
          ...section,
          values: section.values.filter(value => value.includes(emojiQuery) || section.title.toLowerCase().includes(emojiQuery))
        }))
        .filter(section => section.values.length)
    : emojiCategory === 'recent'
      ? emojiSections.slice(0, 2)
      : emojiSections.filter(section => section.id === emojiCategory);

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

  useEffect(() => {
    if (!active || !me) return;
    const conversationId = cid(me.id, active.id);
    const targetLanguage = translateChatLanguages[conversationId];
    if (!targetLanguage || !globalThis.LanguageDetector || !globalThis.Translator) return;
    const pending = rows.filter(message =>
      message.kind === 'text' && message.body && !translations[message.id] && String(message.senderId) !== String(me.id)
    );
    if (!pending.length) return;
    (async () => {
      try {
        const detector = await globalThis.LanguageDetector.create();
        for (const message of pending) {
          try {
            const detected = await detector.detect(message.body);
            const sourceLanguage = detected[0]?.detectedLanguage;
            if (!sourceLanguage || sourceLanguage === targetLanguage) continue;
            const translator = await globalThis.Translator.create({ sourceLanguage, targetLanguage });
            const translated = await translator.translate(message.body);
            setTranslations(current => ({ ...current, [message.id]: translated }));
          } catch (error) {
            console.error('Auto-translate failed for message', message.id, error.message);
          }
        }
      } catch (error) {
        console.error('Translate chat: could not start language detector', error.message);
      }
    })();
  }, [active, rows, me, translateChatLanguages, translations]);

  if (screen !== 'app') {
    return (
      <div className={`auth opalAuth ${screen === 'welcome' ? 'welcomeMode' : 'formMode'}`}>
        <div className="opalBrandPane" aria-hidden="true">
          <div className="opalBrandMark">
            <div className="opalLogo badge"><MessageCircle /></div>
            <h1><em>Naad</em></h1>
          </div>
          <p className="opalTagline">Communicate without barriers.</p>
          <small className="opalSubtag">Talk to anyone, in any language.</small>
          <div className="authFeatures opalFeatureGrid">
            <span><Clapperboard /> <b>Flicks</b><small>Share and watch short videos with your contacts.</small></span>
            <span><Shield /> <b>Secure Messaging</b><small>Private chats with strong protection.</small></span>
            <span><Video /> <b>Voice & Video Calls</b><small>High quality calls with anyone.</small></span>
            <span><Settings /> <b>Smart Features</b><small>AI assistant, weather, and more.</small></span>
          </div>
        </div>
        <div className="opalPhoneShell">
          <div className="card opalCard">
            <div className="opalLogo badge"><MessageCircle /></div>

            {screen === 'welcome' ? (
              <>
                <h1><em>Naad</em></h1>
                <p className="opalTagline">Communicate without barriers.</p>
                <small className="opalSubtag">Talk to anyone, in any language.</small>

                <div className="authFeatures opalFeatureGrid">
                  <span><Clapperboard /> <b>Flicks</b><small>Share and watch short videos with your contacts.</small></span>
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
                  <p>{authMode === 'register' ? "Let's get you started!" : authMode === 'reset' ? (resetStep === 'phone' ? "We'll email you a reset code." : 'Enter the code we emailed you.') : authMode === 'login' ? (loginStep === 'phone' ? "We'll email you a login code." : loginStep === 'password' ? 'Enter your phone number and password.' : loginStep === 'add-email' ? 'Add an email to receive login codes.' : 'Enter the code we emailed you.') : 'Glad to see you again!'}</p>
                </div>

                {authMode !== 'reset' && (
                  <div className="tabs opalTabs">
                    <button type="button" className={authMode === 'login' ? 'on' : ''} onClick={() => { setErr(''); setLoginStep('phone'); setAuthMode('login'); }}>
                      Login
                    </button>
                    <button type="button" className={authMode === 'register' ? 'on' : ''} onClick={() => setAuthMode('register')}>
                      Register
                    </button>
                  </div>
                )}

                {err && <div className="err" role="alert">{err}</div>}

                {authMode === 'login' && loginStep === 'phone' && (
                  <form onSubmit={requestLoginOtp} className="opalForm">
                    <label className="opalInput"><Phone /><input placeholder="Phone number" value={form.phone} onChange={e => f('phone', e.target.value)} required /></label>
                    <div className="authOptions">
                      <label><input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} /> Remember me</label>
                    </div>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Sending code...' : 'Send Login Code'}
                    </button>
                    <p className="authSwitch"><button type="button" onClick={() => { setErr(''); setLoginStep('password'); }}>Use your password instead</button></p>
                    <p className="authSwitch">Don't have an account? <button type="button" onClick={() => setAuthMode('register')}>Register</button></p>
                  </form>
                )}

                {authMode === 'login' && loginStep === 'password' && (
                  <form onSubmit={loginWithPassword} className="opalForm">
                    <label className="opalInput"><Phone /><input placeholder="Phone number" value={form.phone} onChange={e => f('phone', e.target.value)} required /></label>
                    <label className="opalInput"><Lock /><input placeholder="Password" type={showPassword ? 'text' : 'password'} value={form.loginPassword} onChange={e => f('loginPassword', e.target.value)} required /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></label>
                    <label className="opalInput"><KeyRound /><input placeholder="6-digit PIN (if enabled)" inputMode="numeric" maxLength="6" value={form.twoStepPin} onChange={e => f('twoStepPin', e.target.value.replace(/\D/g, ''))} /></label>
                    <div className="authOptions">
                      <label><input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} /> Remember me</label>
                      <button type="button" className="link" onClick={() => { setErr(''); setLoginStep('phone'); }}>Use a login code instead</button>
                    </div>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Signing in...' : 'Log In'}
                    </button>
                    <p className="authSwitch">Forgot your password? <button type="button" onClick={() => { setErr(''); setAuthMode('reset'); setResetStep('phone'); }}>Reset it</button></p>
                    <p className="authSwitch">Don't have an account? <button type="button" onClick={() => setAuthMode('register')}>Register</button></p>
                  </form>
                )}

                {authMode === 'login' && loginStep === 'otp' && (
                  <form onSubmit={login} className="opalForm">
                    <label className="opalInput"><KeyRound /><input placeholder="6-digit code from email" inputMode="numeric" maxLength="6" value={form.loginOtp} onChange={e => f('loginOtp', e.target.value.replace(/\D/g, ''))} required /></label>
                    <label className="opalInput"><Lock /><input placeholder="6-digit PIN (if enabled)" inputMode="numeric" maxLength="6" value={form.twoStepPin} onChange={e => f('twoStepPin', e.target.value.replace(/\D/g, ''))} /></label>
                    <div className="authOptions">
                      <label><input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} /> Remember me</label>
                      <button type="button" className="link" onClick={() => setLoginStep('phone')}>Use a different phone</button>
                    </div>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Signing in...' : 'Log In'}
                    </button>
                    <p className="authSwitch">Don't have an account? <button type="button" onClick={() => setAuthMode('register')}>Register</button></p>
                  </form>
                )}

                {authMode === 'login' && loginStep === 'add-email' && (
                  <form onSubmit={addLoginEmail} className="opalForm">
                    <p style={{ margin: '0 0 4px', color: 'var(--muted)', fontSize: 13 }}>
                      This account doesn't have an email on file yet. Verify your password and add one to receive login codes.
                    </p>
                    <label className="opalInput"><Lock /><input placeholder="Current password" type={showPassword ? 'text' : 'password'} value={form.loginPassword} onChange={e => f('loginPassword', e.target.value)} required /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></label>
                    <label className="opalInput"><Mail /><input placeholder="Email address" type="email" value={form.loginNewEmail} onChange={e => f('loginNewEmail', e.target.value)} required /></label>
                    <div className="authOptions">
                      <button type="button" className="link" onClick={() => setLoginStep('phone')}>Use a different phone</button>
                    </div>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Saving...' : 'Add Email & Send Code'}
                    </button>
                    <p className="authSwitch">Don't have an account? <button type="button" onClick={() => setAuthMode('register')}>Register</button></p>
                  </form>
                )}

                {authMode === 'reset' && resetStep === 'phone' && (
                  <form onSubmit={requestReset} className="opalForm">
                    <label className="opalInput"><Phone /><input placeholder="Registered phone number" value={form.resetPhone} onChange={e => f('resetPhone', e.target.value)} required /></label>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Sending code...' : 'Send Reset Code'}
                    </button>
                    <p className="authSwitch">Remembered it? <button type="button" onClick={() => {
                      setErr('');
                      setAuthMode('login');
                    }}>Back to login</button></p>
                  </form>
                )}

                {authMode === 'reset' && resetStep === 'otp' && (
                  <form onSubmit={resetPassword} className="opalForm">
                    <label className="opalInput"><KeyRound /><input placeholder="6-digit code from email" inputMode="numeric" maxLength="6" value={form.resetOtp} onChange={e => f('resetOtp', e.target.value.replace(/\D/g, ''))} required /></label>
                    <label className="opalInput"><Lock /><input placeholder="New password" type={showPassword ? 'text' : 'password'} value={form.resetPassword} onChange={e => f('resetPassword', e.target.value)} minLength={8} required /><button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button></label>
                    <button className="primary opalPrimary" disabled={authLoading}>
                      {authLoading ? 'Changing password...' : 'Reset Password'}
                    </button>
                    <p className="authSwitch"><button type="button" onClick={() => setResetStep('phone')}>Use a different phone</button></p>
                  </form>
                )}

                {authMode === 'register' && (
                  <form onSubmit={register} className="opalForm">
                    <label className="opalInput"><User /><input placeholder="Full name" value={form.username} onChange={e => f('username', e.target.value)} /></label>
                    <label className="opalInput"><Phone /><input placeholder="Phone number" value={form.phone} onChange={e => f('phone', e.target.value)} /></label>
                    <label className="opalInput"><Mail /><input placeholder="Email address" type="email" value={form.email} onChange={e => f('email', e.target.value)} /></label>
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
  if (appLocked) {
    return (
      <div className="appLockGate">
        <div className="appLockCard">
          <div className="brandMark"><Lock /></div>
          <h2>Naad is locked</h2>
          <p>Enter your PIN to continue</p>
          <form onSubmit={e => { e.preventDefault(); attemptUnlock(appLockPinInput); }}>
            <input
              autoFocus
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={appLockPinInput}
              onChange={e => { setAppLockPinInput(e.target.value); setAppLockError(''); }}
              placeholder="PIN"
            />
            {appLockError && <small className="appLockError">{appLockError}</small>}
            <button type="submit" className="primary">Unlock</button>
          </form>
        </div>
      </div>
    );
  }
  return (
    <div className="app">
      <aside className={`${active ? 'side hide' : 'side'} tab-${mobileTab}`}>
        <div className="desktopNavRail">
          <div className="appTitle">
            <div className="brandMark"><MessageCircle /></div>
            <div><b className="desktopBrand"><em>Naad</em></b><b className="mobileBrand">{mobileTitle}</b><small>{BRAND.tagline}</small></div>
          </div>
          <button className="newChatButton" onClick={() => {
            setMobileTab('chats');
            setChatListFilter('all');
            setActive(null);
            searchInputRef.current?.focus();
          }}><Plus /> New Chat</button>
          <div className="railMenu">
            <button className={mobileTab === 'chats' ? 'active' : ''} onClick={() => { setMobileTab('chats'); setChatListFilter('all'); }}><MessageCircle /> Chats <span>{contacts.reduce((total, user) => total + Number(user.chat?.unreadCount || 0), 0) || ''}</span></button>
            <button onClick={() => { setMobileTab('chats'); openChat(me); }}><Bookmark /> Saved Messages</button>
            <button onClick={loadStatuses}><History /> Echoes</button>
            <button onClick={loadCallHistory}><Phone /> Calls</button>
            <button className={mobileTab === 'ai' ? 'active' : ''} onClick={() => setMobileTab('ai')}><Video /> Flicks</button>
          </div>
          <div className="railFooter">
            <button className={mobileTab === 'settings' ? 'active' : ''} onClick={() => { setMobileTab('settings'); setActive(null); }}><Settings /> Settings</button>
          </div>
          <div className="me">
            <Avatar user={me} className="avatarButton" onClick={() => setProfile(me)} title="Change profile photo" />
            <div>
              <b>{me?.username}</b>
              <small>{ready ? 'Online' : 'Offline'}</small>
            </div>
            <button className="icon" onClick={logout} title="Log out"><LogOut /></button>
            <button className="icon" onClick={openSecurity} title="Account security"><Lock /></button>
          </div>
        </div>

        <div className="chatListPane">
        {mobileTab === 'settings' && (
          <div className="settingsPage profileSettingsPage">
            <div className="settingsHero">
              <h1>Settings</h1>
            </div>

            <div className="settingsProfileHero">
              <div className="profileAvatarWrap">
                <Avatar user={me} big />
                <span className={ready ? 'profilePresence online' : 'profilePresence'} />
              </div>
              <h2>{me?.username || 'User'}</h2>
              <p>{settingsHandle}</p>
              <small><span className={ready ? 'dot online' : 'dot'} /> {ready ? 'Online' : 'Offline'} • Naad profile</small>
              <label className="profilePhoto profilePhotoModern">
                <Camera />
                Change profile photo
                <input hidden type="file" accept="image/*" onChange={uploadAvatar} />
              </label>
              <button className="settingsProfileOpen" type="button" onClick={() => {
                setProfileMode('full');
                setProfile(me);
              }}>
                <User /> View full profile <strong>›</strong>
              </button>
            </div>

            {settingsSections.map(section => (
              <section className="opalMenuSection" key={section.title}>
                <h3>{section.title}</h3>
                <div>
                  {section.rows.map(row => (
                    <button className="settingsRow" type="button" key={row.label} onClick={row.action}>
                      <i>{row.icon}</i>
                      <span>
                        <b>{row.label}</b>
                        <small>{row.detail}</small>
                      </span>
                      <strong>›</strong>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <button className="settingsLogout opalMenuLogout" type="button" onClick={logout}>
              <i><LogOut /></i>
              <span>Log Out</span>
              <strong>›</strong>
            </button>
          </div>
        )}

        <div className="search">
          <Search />
          <input ref={searchInputRef} placeholder="Search name or phone" onChange={e => search(e.target.value)} />
          <button type="button" className="globalSearchTrigger" onClick={openGlobalSearch} title="Search all chats and messages">All chats</button>
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
          }}>Circles</button>
        </div>
        <div className="flicksPanel">
          {!flicksConfigured ? (
            <div className="flicksEmpty">
              <Video />
              <h2>Flicks</h2>
              <p>The video feed isn't set up yet. Check back soon.</p>
            </div>
          ) : (
            <>
              <div className="flicksHeader">
                <h2>Flicks</h2>
                <div className="flicksAudienceToggle">
                  <button type="button" className={flickAudience === 'contacts' ? 'active' : ''} onClick={() => setFlickAudience('contacts')} title="Only your contacts will see new Flicks you share">Contacts</button>
                  <button type="button" className={flickAudience === 'everyone' ? 'active' : ''} onClick={() => setFlickAudience('everyone')} title="Anyone using the app will see new Flicks you share">Everyone</button>
                </div>
                <label className="flicksUpload">
                  {flickUploading ? 'Uploading...' : <><Plus /> New</>}
                  <input hidden type="file" accept="video/mp4,video/webm,video/quicktime" disabled={flickUploading} onChange={uploadFlick} />
                </label>
              </div>
              <div
                className="flicksFeed"
                onScroll={e => {
                  const el = e.target;
                  if (flicksHasMore && !flicksLoading && el.scrollTop + el.clientHeight > el.scrollHeight - el.clientHeight) {
                    loadFlicks(false);
                  }
                }}
              >
                {flicks.length === 0 && !flicksLoading && (
                  <div className="flicksEmpty">
                    <Video />
                    <h2>No Flicks yet</h2>
                    <p>Be the first to share a short video.</p>
                  </div>
                )}
                {flicks.map(flick => (
                  <div className="flickItem" key={flick.id}>
                    <video
                      ref={el => { flickVideoRefs.current[flick.id] = el; }}
                      src={flick.videoUrl}
                      className="flickVideo"
                      loop
                      muted
                      playsInline
                      onClick={e => {
                        const el = e.currentTarget;
                        el.paused ? el.play().catch(() => {}) : el.pause();
                      }}
                    />
                    <div className="flickOverlay">
                      <div className="flickAuthor">
                        <Avatar user={flick.author} />
                        <b>{flick.author.username}</b>
                      </div>
                      {flick.caption && <p className="flickCaption">{flick.caption}</p>}
                    </div>
                    <div className="flickActions">
                      <button className={flick.liked ? 'flickLike liked' : 'flickLike'} onClick={() => toggleFlickLike(flick)}>
                        <Star />
                        <span>{flick.likeCount || ''}</span>
                      </button>
                      {String(flick.author.id) === String(me?.id) && (
                        <button className="flickDelete" onClick={() => deleteFlick(flick.id)}>
                          <Trash2 />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {flicksLoading && <p className="empty">Loading...</p>}
              </div>
            </>
          )}
        </div>
        {['all', 'unread'].includes(chatListFilter) && (showArchived || contacts.some(user => user.chat?.archived)) && <button className="archiveToggle" onClick={() => setShowArchived(value => !value)}>
          <Archive /> <span>{showArchived ? 'Back to chats' : 'Archived chats'}</span> {!showArchived && <b>{contacts.filter(user => user.chat?.archived).length} chats</b>}
        </button>}
        {chatListFilter === 'channels' && <div className="channelHeader">
          <button onClick={() => loadChannels()}><MessageCircle /> Circles</button>
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
          {chatListFilter === 'all' && !showArchived && !visibleContacts.some(u => String(u.id) === String(me?.id)) && (
            <button className="chatMain savedMessagesEntry" onClick={() => openChat(me)}>
              <span className="avatar savedMessagesAvatar"><Bookmark /></span>
              <div>
                <b>Saved Messages</b>
                <span>Only visible to you</span>
              </div>
            </button>
          )}
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
                  <b>{u.chat?.pinned ? '📌 ' : ''}{String(u.id) === String(me.id) ? 'Saved Messages' : displayName(u)}</b>
                  <span>{p.body || (String(u.id) === String(me.id) ? 'Only visible to you' : u.phone)}</span>
                </div>
                {p.createdAt && <time>{t(p.createdAt)}</time>}
                {u.chat?.unreadCount > 0 && <strong className="unreadBadge">{u.chat.unreadCount}</strong>}
                </button>
                {chatMenu?.id === u.id && (
                  <div className="chatMenu">
                    <button onClick={() => { updateChatPreference(u, { forceUnread: true }); setChatMenu(null); }}>
                      <MailOpen /> Mark as unread
                    </button>
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
          <button onClick={loadStatuses}><History /><span>Echoes</span></button>
          <button onClick={loadCallHistory}><Phone /><span>Calls</span></button>
          <button className={mobileTab === 'ai' ? 'active' : ''} onClick={() => setMobileTab('ai')}><Video /><span>Flicks</span></button>
          <button className={mobileTab === 'settings' ? 'active' : ''} onClick={() => { setMobileTab('settings'); setActive(null); }}><Settings /><span>Settings</span></button>
        </nav>
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
                <b>{String(active.id) === String(me.id) ? 'Saved Messages' : displayName(active)}</b>
                <small>
                  {String(active.id) === String(me.id)
                    ? 'Only visible to you'
                    : typing
                      ? 'typing...'
                      : E2EE_ENABLED
                        ? encryptionReady ? 'End-to-end encrypted beta' : 'Preparing encryption...'
                        : active.online ? 'Online' : 'Private conversation'}
                </small>
              </div>

              {String(active.id) !== String(me.id) && (
                <>
                  <button className="icon" onClick={() => startCall('audio')}><Phone /></button>
                  <button className="icon" onClick={() => startCall('video')}><Video /></button>
                </>
              )}
              <button className="icon" onClick={() => setChatHeaderMenu(value => value === 'main' ? null : 'main')}><MoreVertical /></button>
            </header>

            {chatHeaderMenu && (
              <div className="chatHeaderMenuBackdrop" onClick={closeChatHeaderMenu}>
                <div className="chatHeaderMenu" onClick={e => e.stopPropagation()}>
                  {chatHeaderMenu === 'main' ? (
                    <>
                      <button onClick={() => { closeChatHeaderMenu(); setProfile(active); }}><User /> View profile</button>
                      <button onClick={() => { closeChatHeaderMenu(); setSearchingMessages(true); }}><Search /> Search</button>
                      <button onClick={openActiveMediaPanel}><Image /> Media, links, and docs</button>
                      <button onClick={toggleActiveMute}><BellOff /> {activeChatMuted ? 'Unmute notifications' : 'Mute notifications'}</button>
                      <button onClick={toggleActivePin}><Star /> {activeChatPinned ? 'Unpin chat' : 'Pin chat'}</button>
                      <button onClick={setActiveDisappearingMessages}><History /> Disappearing messages</button>
                      <button className="menuMoreButton" onClick={() => setChatHeaderMenu('more')}>More <span>›</span></button>
                    </>
                  ) : (
                    <>
                      <button onClick={exportActiveChat}><Archive /> Export chat</button>
                      <button onClick={clearActiveChat}><Trash2 /> Clear chat</button>
                      {String(active.id) !== String(me.id) && (
                        <>
                          <button onClick={reportActiveChat}><Flag /> Report</button>
                          <button onClick={blockActiveChat}><Ban /> Block</button>
                        </>
                      )}
                      <button className="menuMoreButton" onClick={() => setChatHeaderMenu('main')}>‹ Back</button>
                    </>
                  )}
                </div>
              </div>
            )}

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

            {showChatMedia && (
              <div className="modal" onClick={() => setShowChatMedia(false)}>
                <div className="chatMediaPanel" onClick={e => e.stopPropagation()}>
                  <button className="historyClose" onClick={() => setShowChatMedia(false)}><X /></button>
                  <h2>Media, links, and docs</h2>
                  <p>{active?.username}</p>
                  <div className="chatMediaList">
                    {activeConversationRows()
                      .filter(message => ['image', 'file', 'audio', 'location'].includes(message.kind) || /^https?:\/\//i.test(message.body || ''))
                      .map(message => {
                        const url = attachmentUrls[message.id] || (message.fileUrl ? resolveFileUrl(message.fileUrl) : '');
                        return (
                          <a
                            key={message.id}
                            href={message.kind === 'location' && parseLocationMessage(message)
                              ? locationMapUrl(parseLocationMessage(message))
                              : url || message.body || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <b>{message.kind === 'image' ? 'Photo' : message.kind === 'audio' ? 'Voice message' : message.kind === 'location' ? 'Location' : message.kind === 'file' ? 'Document' : 'Link'}</b>
                            <span>{message.fileName || message.body || new Date(message.createdAt).toLocaleString()}</span>
                          </a>
                        );
                      })}
                    {activeConversationRows().filter(message => ['image', 'file', 'audio', 'location'].includes(message.kind) || /^https?:\/\//i.test(message.body || '')).length === 0 && (
                      <small>No media, links, or docs yet.</small>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showStarredMessages && (
              <div className="modal" onClick={() => setShowStarredMessages(false)}>
                <div className="chatMediaPanel" onClick={e => e.stopPropagation()}>
                  <button className="historyClose" onClick={() => setShowStarredMessages(false)}><X /></button>
                  <h2>Starred messages</h2>
                  <p>{active?.username}</p>
                  <div className="chatMediaList">
                    {activeConversationRows()
                      .filter(message => message.starred)
                      .map(message => {
                        const url = attachmentUrls[message.id] || (message.fileUrl ? resolveFileUrl(message.fileUrl) : '');
                        const isMedia = ['image', 'file', 'audio', 'location'].includes(message.kind);
                        return (
                          <div key={message.id} className="starredRow">
                            {isMedia ? (
                              <a
                                href={message.kind === 'location' && parseLocationMessage(message)
                                  ? locationMapUrl(parseLocationMessage(message))
                                  : url || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <b>{message.kind === 'image' ? 'Photo' : message.kind === 'audio' ? 'Voice message' : message.kind === 'location' ? 'Location' : 'Document'}</b>
                                <span>{message.fileName || new Date(message.createdAt).toLocaleString()}</span>
                              </a>
                            ) : (
                              <div className="starredText">
                                <span>{message.body}</span>
                                <small>{new Date(message.createdAt).toLocaleString()}</small>
                              </div>
                            )}
                            <button className="starredUnstar" title="Unstar" onClick={() => unstarMessageDirect(message.id)}><Star /></button>
                          </div>
                        );
                      })}
                    {activeConversationRows().filter(message => message.starred).length === 0 && (
                      <small>No starred messages yet.</small>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeConversationRows().filter(message => message.pinned).length > 0 && (
              <div className="pinnedBanner" onClick={() => setSelectedMessage(activeConversationRows().filter(message => message.pinned).slice(-1)[0])}>
                <Pin />
                <span>{activeConversationRows().filter(message => message.pinned).slice(-1)[0]?.body || 'Pinned attachment'}</span>
              </div>
            )}

            <section className={`msgs chatTheme-${chatTheme}`}>
              <div className="dayChip">Today</div>
              {displayRows.map(m => {
                const repliedMessage = m.replyToId
                  ? rows.find(row => row.id === m.replyToId)
                  : null;
                const locationData = m.kind === 'location' ? parseLocationMessage(m) : null;
                const locationActive = isLiveLocationActive(locationData);
                return (
                <div
                  key={m.id}
                  className={'bubble messagePress ' + (String(m.senderId) === String(me.id) ? 'mine' : 'theirs')}
                  onClick={() => setSelectedMessage(m)}
                  title="Press to select this message"
                >
                  {repliedMessage && (
                    <div className="replyPreview">
                      <b>{String(repliedMessage.senderId) === String(me.id) ? 'You' : displayName(active)}</b>
                      <span>{repliedMessage.body}</span>
                    </div>
                  )}
                  {m.kind === 'image' && m.fileUrl ? (
                    <img
                      src={attachmentUrls[m.id] || (m.fileEncryption ? '' : resolveFileUrl(m.fileUrl))}
                      alt={m.fileName || 'Photo'}
                      onClick={e => {
                        e.stopPropagation();
                        const url = attachmentUrls[m.id] || (m.fileEncryption ? '' : resolveFileUrl(m.fileUrl));
                        if (url) setMediaViewer({ url, kind: 'image', fileName: m.fileName });
                      }}
                    />
                  ) : m.kind === 'video' && m.fileUrl ? (
                    <div
                      className="videoBubblePreview"
                      onClick={e => {
                        e.stopPropagation();
                        const url = attachmentUrls[m.id] || (m.fileEncryption ? '' : resolveFileUrl(m.fileUrl));
                        if (url) setMediaViewer({ url, kind: 'video', fileName: m.fileName });
                      }}
                    >
                      <video src={attachmentUrls[m.id] || (m.fileEncryption ? '' : resolveFileUrl(m.fileUrl))} preload="metadata" muted />
                      <span className="videoBubblePlay"><Play /></span>
                    </div>
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
                    <VoiceMessage
                      src={attachmentUrls[m.id] || (m.fileEncryption ? '' : resolveFileUrl(m.fileUrl))}
                      mine={String(m.senderId) === String(me.id)}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : locationData ? (
                    <div className="locationMessage" onClick={e => e.stopPropagation()}>
                      <div className="locationCopy">
                        <b><MapPin /> {locationData.liveMinutes ? 'Live Location' : 'Location'}</b>
                        <strong>{String(m.senderId) === String(me.id) ? me.username : displayName(active)}</strong>
                        <span>{locationData.place || 'Shared location'}</span>
                        {locationData.liveMinutes ? (
                          <small>Moving · Updated {new Date(locationData.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                        ) : (
                          <small>Accuracy {Math.round(locationData.accuracy || 0)} m</small>
                        )}
                        <a
                          href={`https://www.google.com/maps?q=${locationData.lat},${locationData.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View on Map
                        </a>
                        <button
                          className="locationOpenButton"
                          onClick={() => setActiveLocationView({
                            message: m,
                            data: locationData,
                            senderName: String(m.senderId) === String(me.id) ? me.username : displayName(active)
                          })}
                        >
                          {locationData.liveMinutes ? 'View Live Location' : 'Open Preview'}
                        </button>
                        {String(m.senderId) === String(me.id) && locationActive && (
                          <button
                            className="locationStopInline"
                            onClick={() => setStopLocationPrompt({ message: m, data: locationData })}
                          >
                            Stop Sharing
                          </button>
                        )}
                      </div>
                      <a
                        className="locationMiniMap"
                        href={`https://www.google.com/maps?q=${locationData.lat},${locationData.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open shared location map"
                      >
                        <MapPin />
                      </a>
                    </div>
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
                  <b>{editingMessage ? 'Editing message' : `Replying to ${String(replyTo?.senderId) === String(me.id) ? 'yourself' : displayName(active)}`}</b>
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
                <label className="toolCamera"><Camera /><span>Camera</span><input hidden type="file" accept="image/*" capture="environment" onChange={e => file(e, 'image')} /></label>
                <label className="toolGallery"><Image /><span>Gallery</span><input hidden type="file" accept="image/*" multiple onChange={e => file(e, 'image')} /></label>
                <label className="toolVideo"><Video /><span>Video</span><input hidden type="file" accept="video/*" onChange={e => file(e, 'video')} /></label>
                <label className="toolFile"><Paperclip /><span>File</span><input hidden type="file" onChange={e => file(e)} /></label>
                <button className="toolLocation" onClick={() => { setShowLocationShare(true); setShowComposerTools(false); }}><MapPin /><span>Location</span></button>
                <button className="toolVoice" onClick={() => { setShowComposerTools(false); startVoiceRecording(); }}><Mic /><span>Voice Note</span></button>
                <button className="toolSchedule" onClick={() => { setShowScheduler(value => !value); setShowComposerTools(false); }}><CalendarClock /><span>Schedule</span></button>
                <button className="toolCancel" onClick={() => setShowComposerTools(false)}>Cancel</button>
              </div>
            )}

            {showLocationShare && (
              <div className="locationSheet">
                <div className="locationSheetHeader">
                  <b>Share Live Location</b>
                  <button onClick={() => setShowLocationShare(false)}><X /></button>
                </div>
                {[
                  [0, 'Current Location', 'Share your current location once'],
                  [15, 'Live for 15 minutes', 'Updated in real time'],
                  [60, 'Live for 1 hour', 'Updated in real time'],
                  [480, 'Live for 8 hours', 'Updated in real time']
                ].map(([minutes, label, detail]) => (
                  <button
                    key={minutes}
                    className={locationDuration === minutes ? 'locationDuration active' : 'locationDuration'}
                    onClick={() => setLocationDuration(minutes)}
                  >
                    <span>{minutes === 0 ? <Navigation /> : <MapPin />}</span>
                    <div><b>{label}</b><small>{detail}</small></div>
                    <i />
                  </button>
                ))}
                <button className="shareLocationButton" onClick={shareLocation} disabled={locationBusy}>
                  {locationBusy ? 'Getting location...' : 'Share Location'}
                </button>
              </div>
            )}

            {liveLocationSession && (
              <div className="liveLocationBar">
                <div>
                  <b><MapPin /> Sharing live location</b>
                  <span>With {liveLocationSession.recipientName} · Updated {locationTimeLabel(liveLocationSession.updatedAt)}</span>
                </div>
                <button onClick={() => setStopLocationPrompt({ message: { id: liveLocationSession.messageId }, data: liveLocationState.current?.payload })}>
                  Stop
                </button>
              </div>
            )}

            {activeLocationView && (
              <div className="locationViewerOverlay" onClick={() => setActiveLocationView(null)}>
                <div className="locationViewer" onClick={e => e.stopPropagation()}>
                  <div className="locationViewerHead">
                    <button onClick={() => setActiveLocationView(null)}><ArrowLeft /></button>
                    <div>
                      <b>{activeLocationView.senderName}'s {activeLocationView.data.liveMinutes ? 'Live Location' : 'Location'}</b>
                      <small>
                        {activeLocationView.data.liveMinutes
                          ? `${isLiveLocationActive(activeLocationView.data) ? 'Live' : activeLocationView.data.stoppedAt ? 'Stopped' : 'Expired'} · Updated ${locationTimeLabel(activeLocationView.data.updatedAt)}`
                          : `Accuracy ${Math.round(activeLocationView.data.accuracy || 0)} m`}
                      </small>
                    </div>
                    <button onClick={() => window.open(locationMapUrl(activeLocationView.data), '_blank', 'noopener,noreferrer')}><Navigation /></button>
                  </div>

                  <div className="liveMapCanvas">
                    <div className="mapRoad one" />
                    <div className="mapRoad two" />
                    <div className="mapRoad three" />
                    <div className="mapWater" />
                    <div className="mapPulse" />
                    <div className="mapUserPin">
                      <Avatar user={String(activeLocationView.message.senderId) === String(me.id) ? me : active} />
                    </div>
                    <MapPin className="mapDestinationPin" />
                    <span className="mapCityLabel">Shared location</span>
                  </div>

                  <div className="locationViewerCard">
                    <b>{activeLocationView.data.liveMinutes ? 'Live tracking' : 'Shared location'}</b>
                    <span>{activeLocationView.data.place || 'Current location'} · {Math.round(activeLocationView.data.accuracy || 0)} m accuracy</span>
                    {activeLocationView.data.expiresAt && !activeLocationView.data.stoppedAt && (
                      <small>Ends {locationTimeLabel(activeLocationView.data.expiresAt)}</small>
                    )}
                    <button onClick={() => window.open(locationMapUrl(activeLocationView.data), '_blank', 'noopener,noreferrer')}>
                      Open in Google Maps
                    </button>
                  </div>
                </div>
              </div>
            )}

            {stopLocationPrompt && (
              <div className="locationViewerOverlay" onClick={() => setStopLocationPrompt(null)}>
                <div className="stopLocationDialog" onClick={e => e.stopPropagation()}>
                  <button className="dialogClose" onClick={() => setStopLocationPrompt(null)}><X /></button>
                  <div className="stopLocationIcon"><MapPin /></div>
                  <h3>Stop Sharing Location?</h3>
                  <p>{active?.username || 'This user'} will no longer see your live location updates.</p>
                  <button className="dangerStop" onClick={() => stopLiveLocation(false, stopLocationPrompt.message.id)}>Stop Sharing</button>
                  <button className="softCancel" onClick={() => setStopLocationPrompt(null)}>Cancel</button>
                </div>
              </div>
            )}

            {voicePreview ? (
              <footer className="compose voicePreviewBar">
                <button className="icon voicePreviewDiscard" onClick={discardVoicePreview} title="Discard recording"><Trash2 /></button>
                <audio className="voicePreviewPlayer" controls src={voicePreview.url} />
                <span className="voicePreviewDuration">
                  {String(Math.floor(voicePreview.seconds / 60)).padStart(2, '0')}:{String(voicePreview.seconds % 60).padStart(2, '0')}
                </span>
                <button className="send" onClick={sendVoicePreview} title="Send voice message"><Send /></button>
              </footer>
            ) : (
              <footer className="compose">
                <button className="icon composePlus" onClick={() => setShowComposerTools(value => !value)} title="More message tools">
                  {showComposerTools ? <X /> : <Plus />}
                </button>

                {recording ? (
                  <div className="recordingStatus">
                    <button className="recordingCancel" onClick={cancelVoiceRecording} title="Cancel recording"><Trash2 /></button>
                    <span className="recordingDot" />
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

                {!recording && (
                  <button
                    className={emoji ? 'icon composeEmoji active' : 'icon composeEmoji'}
                    onClick={() => {
                      setEmoji(value => !value);
                      setShowComposerTools(false);
                    }}
                    title="Emoji"
                    type="button"
                  >
                    <Smile />
                  </button>
                )}

                {!recording && (
                  <label className="icon composeCamera" title="Take photo">
                    <Camera />
                    <input hidden type="file" accept="image/*" capture="environment" onChange={e => file(e, 'image')} />
                  </label>
                )}

                <button
                  className={recording ? 'send recordingStop' : 'send'}
                  onClick={recording
                    ? stopVoiceRecording
                    : text.trim() || editingMessage
                      ? editingMessage ? saveEdit : () => send()
                      : startVoiceRecording}
                  title={recording ? 'Stop recording' : text.trim() || editingMessage ? 'Send message' : 'Record voice message'}
                >
                  {recording ? <Check /> : text.trim() || editingMessage ? <Send /> : <Mic />}
                </button>
              </footer>
            )}

            {emoji && (
              <div className="emoji">
                <div className="emojiSearch">
                  <Search />
                  <input
                    value={emojiSearch}
                    onChange={e => setEmojiSearch(e.target.value)}
                    placeholder="Search emoji"
                    autoFocus
                  />
                  <Smile />
                </div>
                <div className="emojiScroll">
                  {visibleEmojiSections.length === 0 && <p className="empty">No emoji found.</p>}
                  {visibleEmojiSections.map(section => (
                    <section className="emojiSection" key={section.id}>
                      <h4>{section.title}</h4>
                      <div className="emojiGrid">
                        {section.values.map((value, index) => (
                          <button
                            key={`${section.id}-${value}-${index}`}
                            type="button"
                            onClick={() => setText(current => current + value)}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                <div className="emojiCategoryBar">
                  {emojiSections.map(section => (
                    <button
                      type="button"
                      key={section.id}
                      className={emojiCategory === section.id && !emojiSearch.trim() ? 'active' : ''}
                      onClick={() => {
                        setEmojiCategory(section.id);
                        setEmojiSearch('');
                      }}
                      title={section.title}
                    >
                      {section.icon}
                    </button>
                  ))}
                  <button type="button" onClick={() => setEmoji(false)} title="Close emoji picker"><X /></button>
                </div>
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
          <div className="callTopBar">
            <button onClick={() => setCall(c => ({ ...c, minimized: true }))} title="Minimize call">
              <Minimize2 />
            </button>
            <div>
              <b>{callContactName}</b>
              <small><Lock /> End-to-end encrypted</small>
              <span>{callDurationText}</span>
            </div>
            <div className="callTopActions">
              <button onClick={() => setShowCallInvite(value => !value)} title="Add participant">
                <UserPlus />
              </button>
            </div>
          </div>

          {call.type === 'video' && (
            <div className="videoStage">
              <video ref={remoteVideo} autoPlay muted playsInline />
              <video
                ref={localVideo}
                autoPlay
                muted
                playsInline
                className="local"
                onPointerDown={startLocalVideoDrag}
                onPointerMove={moveLocalVideoDrag}
                onPointerUp={endLocalVideoDrag}
                onPointerCancel={endLocalVideoDrag}
                title="Drag to move your video"
              />
            </div>
          )}

          <div className="callInfo">
            {call.type !== 'video' && (
              <div className="callAvatar">{initials(callContactName)}</div>
            )}
            <h2>{call.title}</h2>
            <p>{call.status || 'Connected securely...'}</p>
          </div>

          {callOptionsOpen && (
            <div className="callOptionsSheet">
              <i />
              {navigator.mediaDevices?.getDisplayMedia ? (
                <button type="button" onClick={shareScreenInCall}>
                  <span><MonitorUp /></span>
                  <b>Share screen</b>
                  <small>Share your entire screen or an app</small>
                  <em>›</em>
                </button>
              ) : (
                <button type="button" disabled style={{ opacity: 0.55 }}>
                  <span><MonitorUp /></span>
                  <b>Share screen</b>
                  <small>This browser can't share the screen - open Naad in Chrome to use it</small>
                </button>
              )}
              <button type="button" onClick={sendMessageDuringCall}>
                <span><MessageCircle /></span>
                <b>Send message</b>
                <small>Send a quick message</small>
                <em>›</em>
              </button>
              <button type="button" onClick={toggleNoiseCancellation}>
                <span><Volume2 /></span>
                <b>Noise cancellation</b>
                <small>Reduce background noise</small>
                <em className={noiseCancellation ? 'toggle on' : 'toggle'} />
              </button>
              <button type="button" className="callOptionsClose" onClick={() => setCallOptionsOpen(null)}>Close</button>
            </div>
          )}

          {showCallInvite && (
            <div className="callInviteSheet">
              <i />
              <div className="callInviteHead">
                <b>Add person</b>
                <button onClick={() => setShowCallInvite(false)}><X /></button>
              </div>
              <div className="callInviteList">
                {contacts
                  .filter(contact =>
                    String(contact.id) !== String(me?.id) &&
                    String(contact.id) !== String(callPeer.current)
                  )
                  .slice(0, 12)
                  .map(contact => (
                    <button key={contact.id} type="button" onClick={() => invitePersonToCall(contact)}>
                      <Avatar user={contact} />
                      <span>
                        <b>{contact.username}</b>
                        <small>{contact.online ? 'Online' : 'Offline'}</small>
                      </span>
                      <UserPlus />
                    </button>
                  ))}
                {contacts.filter(contact => String(contact.id) !== String(me?.id) && String(contact.id) !== String(callPeer.current)).length === 0 && (
                  <p>No other contacts available to add.</p>
                )}
              </div>
            </div>
          )}

          <div className="callBtns">
            <button
              className={micOn ? '' : 'off'}
              onClick={toggleMic}
              title={micOn ? 'Mute microphone' : 'Unmute microphone'}
            >
              {micOn ? <Mic /> : <MicOff />}
              <span>Mute</span>
            </button>

            {callCanUseVideo && (
              <button
                className={camOn ? '' : 'off'}
                onClick={toggleCamera}
                title={camOn ? 'Turn camera off' : 'Turn camera on after call connects'}
              >
                {camOn ? <Video /> : <VideoOff />}
                <span>Camera</span>
              </button>
            )}

            {call.type === 'video' && (
              <button onClick={flipCamera} title="Switch camera">
                <Camera />
                <span>Flip</span>
              </button>
            )}

            <button onClick={() => setCallOptionsOpen(value => value ? null : 'quick')} title="More options">
              <MoreVertical />
              <span>More</span>
            </button>

            <button className="danger" onClick={() => endCall()} title="End call">
              <PhoneOff />
              <span>End</span>
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
              <button onClick={beginForward}><Forward /> Forward</button>
              <button onClick={copyMessage}><Copy /> Copy</button>
              <button onClick={toggleStar}><Star /> {selectedMessage.starred ? 'Unstar' : 'Star'}</button>
              <button onClick={toggleMessagePin}>{selectedMessage.pinned ? <PinOff /> : <Pin />} {selectedMessage.pinned ? 'Unpin' : 'Pin'}</button>
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

      {forwardingMessage && (
        <div className="groupInfoBackdrop" onClick={() => setForwardingMessage(null)}>
          <div className="groupAddMemberSheet" onClick={e => e.stopPropagation()}>
            <div className="groupInfoHead">
              <b>Forward to</b>
              <button className="groupInfoClose" onClick={() => setForwardingMessage(null)} title="Close"><X /></button>
            </div>
            <div className="groupAddMemberList">
              {contacts.map(contact => (
                <button key={contact.id} className="groupMemberRow groupMemberPickable" onClick={() => confirmForward(contact)}>
                  <span className="groupMemberAvatar">{initials(contact.username)}</span>
                  <span className="groupMemberName">{contact.username}</span>
                  <Forward />
                </button>
              ))}
              {contacts.length === 0 && <p className="empty">No contacts to forward to yet.</p>}
            </div>
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
              <button onClick={editMyProfile}>Edit profile</button>
            </div>
            <h3>Privacy</h3>
            {[
              ['Last seen and online', 'lastSeenVisibility'],
              ['Profile photo', 'profileVisibility'],
              ['About', 'aboutVisibility']
            ].map(([label, key]) => (
              <button
                type="button"
                className="privacyRow privacyRowButton"
                key={key}
                onClick={() => setOptionPicker({
                  title: label,
                  options: [
                    { label: 'Everyone', value: 'everyone' },
                    { label: 'My Contacts', value: 'contacts' },
                    { label: 'Nobody', value: 'nobody' }
                  ],
                  onPick: value => savePrivacy({ ...privacy, [key]: value })
                })}
              >
                <span>{label}</span>
                <em>
                  {privacy[key] === 'nobody' ? 'Nobody' : privacy[key] === 'contacts' ? 'My Contacts' : 'Everyone'}
                  {' '}<ChevronDown />
                </em>
              </button>
            ))}
            <label className="privacyRow">
              <span>Read receipts</span>
              <input type="checkbox" className="sr-only" checked={privacy.readReceipts} onChange={e => savePrivacy({ ...privacy, readReceipts: e.target.checked })} />
              <em className={privacy.readReceipts ? 'toggle on' : 'toggle'} />
            </label>
            <label className="privacyRow">
              <span>Silence unknown calls</span>
              <input type="checkbox" className="sr-only" checked={privacy.silenceUnknownCalls} onChange={e => savePrivacy({ ...privacy, silenceUnknownCalls: e.target.checked })} />
              <em className={privacy.silenceUnknownCalls ? 'toggle on' : 'toggle'} />
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
            <button className="twoStepButton" onClick={() => appLockEnabled ? disableAppLock() : openAppLockSetup()}>
              <Lock /> App lock (PIN): {appLockEnabled ? 'On' : 'Off'}
            </button>
            <div className="accountActions">
              <button onClick={changePassword}>Change password</button>
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
        <div className="modal" onClick={() => { setSelectedGroup(null); setGroupInfoOpen(false); setGroupStickersOpen(false); setGroupAttachOpen(false); }}>
          <div className="groupCard" onClick={e => e.stopPropagation()}>
            <div className="groupChatHeader">
              <button className="groupBack" onClick={() => setSelectedGroup(null)} title="Back"><ArrowLeft /></button>
              <button className="groupHeaderIdentity" onClick={() => setGroupInfoOpen(true)} title="Group info">
                <span className="groupHeaderAvatar"><Users /></span>
                <span className="groupHeaderText">
                  <b>{selectedGroup.name}</b>
                  <small>{groupMemberSummary(selectedGroup)}</small>
                </span>
              </button>
              <button onClick={() => startGroupCall('audio')} title="Voice call"><Phone /></button>
              <button onClick={() => startGroupCall('video')} title="Video call"><Video /></button>
              <button onClick={() => setGroupInfoOpen(true)} title="Group info"><MoreVertical /></button>
            </div>
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
                      <img
                        src={message.mediaUrl}
                        alt={message.fileName || 'Group photo'}
                        onClick={e => { e.stopPropagation(); setMediaViewer({ url: message.mediaUrl, kind: 'image', fileName: message.fileName }); }}
                      />
                    ) : message.kind === 'video' && message.mediaUrl ? (
                      <div
                        className="videoBubblePreview"
                        onClick={e => { e.stopPropagation(); setMediaViewer({ url: message.mediaUrl, kind: 'video', fileName: message.fileName }); }}
                      >
                        <video src={message.mediaUrl} preload="metadata" muted />
                        <span className="videoBubblePlay"><Play /></span>
                      </div>
                    ) : message.kind === 'file' && message.mediaUrl ? (
                      <a href={message.mediaUrl} download={message.fileName} onClick={e => e.stopPropagation()}>
                        📎 {message.fileName}
                      </a>
                    ) : message.kind === 'audio' && message.mediaUrl ? (
                      <audio
                        controls
                        preload="auto"
                        src={message.mediaUrl}
                        onClick={e => e.stopPropagation()}
                        onEnded={e => {
                          e.currentTarget.currentTime = 0;
                        }}
                      />
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
              {groupTyping[selectedGroup.id] && <div className="groupTyping">{groupTyping[selectedGroup.id]} is typing…</div>}
              {groupStickersOpen && (
                <div className="groupStickers">
                  {['😂', '❤️', '👍', '🔥', '🎉', '😍', '🙏', '💯'].map(value => (
                    <button key={value} onClick={() => { sendGroupMessage(value, 'sticker'); setGroupStickersOpen(false); }}>{value}</button>
                  ))}
                </div>
              )}
              {groupAttachOpen && (
                <div className="groupAttachRow">
                  <label title="Photo"><Image /> Photo<input hidden type="file" accept="image/*" multiple onChange={e => { sendGroupFile(e, 'image'); setGroupAttachOpen(false); }} /></label>
                  <label title="Video"><Video /> Video<input hidden type="file" accept="video/*" onChange={e => { sendGroupFile(e, 'video'); setGroupAttachOpen(false); }} /></label>
                  <label title="File"><Paperclip /> File<input hidden type="file" onChange={e => { sendGroupFile(e, 'file'); setGroupAttachOpen(false); }} /></label>
                </div>
              )}
              {selectedGroup.role !== 'admin' && selectedGroup.sendMessagesPolicy === 'admins' ? (
                <div className="groupComposeLocked">
                  <Lock /> Only admins can send messages in this group.
                </div>
              ) : (
                <div className="groupCompose">
                  <button
                    className="groupComposeIcon"
                    onClick={() => { setGroupAttachOpen(value => !value); setGroupStickersOpen(false); }}
                    title="Attach"
                  >
                    {groupAttachOpen ? <X /> : <Plus />}
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
                    placeholder="Message"
                  />
                  <button
                    className="groupComposeIcon"
                    onClick={() => { setGroupStickersOpen(value => !value); setGroupAttachOpen(false); }}
                    title="Emoji"
                  >
                    <Smile />
                  </button>
                  <button
                    className={groupRecording ? 'groupComposeIcon groupRecord active' : 'groupComposeIcon groupRecord'}
                    onClick={groupRecording ? stopGroupVoiceRecording : startGroupVoiceRecording}
                    title={groupRecording ? 'Stop and send voice message' : 'Record voice message'}
                  >
                    {groupRecording ? <Square /> : <Mic />}
                  </button>
                  <button className="groupSend" onClick={sendGroupMessage} title="Send"><Send /></button>
                </div>
              )}
            </div>
          </div>

          {groupInfoOpen && (
            <div className="groupInfoBackdrop" onClick={e => { e.stopPropagation(); setGroupInfoOpen(false); }}>
              <div className="groupInfoSheet" onClick={e => e.stopPropagation()}>
                <div className="groupInfoHead">
                  <span className="groupInfoAvatar"><Users /></span>
                  <b>{selectedGroup.name}</b>
                  <small>{selectedGroup.members.length} {selectedGroup.members.length === 1 ? 'member' : 'members'}</small>
                  {selectedGroup.description && <p>{selectedGroup.description}</p>}
                  <button className="groupInfoClose" onClick={() => setGroupInfoOpen(false)} title="Close"><X /></button>
                </div>

                <div className="groupInfoRows">
                  <button onClick={toggleGroupMute}>
                    <BellOff /> {selectedGroup.mutedUntil && new Date(selectedGroup.mutedUntil) > new Date() ? 'Unmute group' : 'Mute for 8 hours'}
                  </button>
                  {selectedGroup.role === 'admin' && <button onClick={createGroupInvite}><Copy /> Invite link</button>}
                  {(selectedGroup.role === 'admin' || selectedGroup.editInfoPolicy === 'everyone') && <button onClick={editGroup}><Pencil /> Edit group</button>}
                </div>

                {selectedGroup.role === 'admin' && (
                  <div className="groupInfoRows groupPermissions">
                    <h4>Group permissions</h4>
                    <button onClick={() => updateGroupPermission('sendMessagesPolicy', selectedGroup.sendMessagesPolicy === 'everyone' ? 'admins' : 'everyone')}>
                      <MessageCircle /> Who can send messages
                      <b>{selectedGroup.sendMessagesPolicy === 'admins' ? 'Only admins' : 'Everyone'}</b>
                    </button>
                    <button onClick={() => updateGroupPermission('editInfoPolicy', selectedGroup.editInfoPolicy === 'everyone' ? 'admins' : 'everyone')}>
                      <Pencil /> Who can edit group info
                      <b>{selectedGroup.editInfoPolicy === 'everyone' ? 'Everyone' : 'Only admins'}</b>
                    </button>
                    <button onClick={() => updateGroupPermission('addMembersPolicy', selectedGroup.addMembersPolicy === 'everyone' ? 'admins' : 'everyone')}>
                      <UserPlus /> Who can add members
                      <b>{selectedGroup.addMembersPolicy === 'everyone' ? 'Everyone' : 'Only admins'}</b>
                    </button>
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

                <div className="groupInfoMembers">
                  <h4>Members</h4>
                  {(selectedGroup.role === 'admin' || selectedGroup.addMembersPolicy === 'everyone') && (
                    <button className="groupAddMember" onClick={addGroupMember}><UserPlus /> Add member</button>
                  )}
                  {selectedGroup.members.map(member => (
                    <div className="groupMemberRow" key={member.id}>
                      <span className="groupMemberAvatar">{initials(member.username)}</span>
                      <span className="groupMemberName">{member.username}</span>
                      {member.role === 'admin' && <em>admin</em>}
                      {selectedGroup.role === 'admin' && member.id !== me.id && (
                        <span className="groupMemberActions">
                          <button onClick={() => changeGroupRole(member)}>{member.role === 'admin' ? 'Demote' : 'Promote'}</button>
                          <button onClick={() => removeGroupMember(member.id)}>Remove</button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <button className="groupLeaveRow" onClick={() => removeGroupMember(me.id)}>
                  <LogOut /> Leave group
                </button>
              </div>
            </div>
          )}

          {groupAddMemberOpen && (
            <div className="groupInfoBackdrop" onClick={e => { e.stopPropagation(); setGroupAddMemberOpen(false); }}>
              <div className="groupAddMemberSheet" onClick={e => e.stopPropagation()}>
                <div className="groupInfoHead">
                  <b>Add member</b>
                  <button className="groupInfoClose" onClick={() => setGroupAddMemberOpen(false)} title="Close"><X /></button>
                </div>
                <div className="groupAddMemberList">
                  {contacts.filter(contact => !selectedGroup.members.some(member => String(member.id) === String(contact.id))).map(contact => (
                    <button key={contact.id} className="groupMemberRow groupMemberPickable" onClick={() => confirmAddGroupMember(contact.id)}>
                      <span className="groupMemberAvatar">{initials(contact.username)}</span>
                      <span className="groupMemberName">{contact.username}</span>
                      <UserPlus />
                    </button>
                  ))}
                  {contacts.filter(contact => !selectedGroup.members.some(member => String(member.id) === String(contact.id))).length === 0 && (
                    <p className="empty">All your contacts are already in this group.</p>
                  )}
                </div>
              </div>
            </div>
          )}
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

      {optionPicker && (
        <div className="modal" onClick={() => setOptionPicker(null)}>
          <div className="optionPickerCard" onClick={e => e.stopPropagation()}>
            <h3>{optionPicker.title}</h3>
            {optionPicker.options.map(option => (
              <button key={String(option.value)} type="button" onClick={() => {
                const pick = optionPicker.onPick;
                setOptionPicker(null);
                pick(option.value);
              }}>{option.label}</button>
            ))}
            <button type="button" className="optionPickerCancel" onClick={() => setOptionPicker(null)}>Cancel</button>
          </div>
        </div>
      )}

      {textFormPrompt && (
        <div className="modal" onClick={() => setTextFormPrompt(null)}>
          <form
            className="textFormCard"
            onClick={e => e.stopPropagation()}
            onSubmit={e => {
              e.preventDefault();
              const submit = textFormPrompt.onSubmit;
              setTextFormPrompt(null);
              submit(textFormValues);
            }}
          >
            <h3>{textFormPrompt.title}</h3>
            {textFormPrompt.fields.map((field, index) => (
              <label className="textFormField" key={field.key}>
                <span>{field.label}</span>
                {field.multiline ? (
                  <textarea
                    autoFocus={index === 0}
                    value={textFormValues[field.key] || ''}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    rows={3}
                    onChange={e => setTextFormValues(current => ({ ...current, [field.key]: e.target.value }))}
                    required={field.required !== false && index === 0}
                  />
                ) : (
                  <input
                    autoFocus={index === 0}
                    type={field.type || 'text'}
                    inputMode={field.inputMode}
                    value={textFormValues[field.key] || ''}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    onChange={e => setTextFormValues(current => ({ ...current, [field.key]: e.target.value }))}
                    required={field.required !== false && index === 0}
                  />
                )}
              </label>
            ))}
            <div className="textFormActions">
              <button type="button" className="optionPickerCancel" onClick={() => setTextFormPrompt(null)}>Cancel</button>
              <button type="submit" className="primary">{textFormPrompt.submitLabel || 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      {showStatuses && (
        <div className="modal" onClick={() => setShowStatuses(false)}>
          <div className="statusCard" onClick={e => e.stopPropagation()}>
            <button className="historyClose" onClick={() => setShowStatuses(false)}><X /></button>
            <div className="statusHero">
              <div className="statusHeroIcon"><History /></div>
              <div>
                <h2>Echoes</h2>
                <p>Pass along a passing thought. It fades in 24 hours.</p>
              </div>
            </div>
            <div className="statusList">
              {statuses.length === 0 && <p className="empty">When your contacts share Echoes, they'll appear here.</p>}
              {statuses.map(status => (
                <div className={(status.viewed ? 'statusItem viewed' : 'statusItem') + (status.muted ? ' muted' : '')} key={status.id} onClick={() => viewStatus(status)}>
                  <Avatar user={{ username: status.username, avatarUrl: status.avatarUrl }} />
                  <div>
                    <b>{status.userId === me.id ? 'My Echoes' : status.username}</b>
                    {status.kind === 'image' && status.mediaUrl ? (
                      <img className="statusMedia" src={status.mediaUrl} alt="Echo" />
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
                        <button title={status.muted ? 'Unmute Echoes' : 'Mute Echoes'} onClick={e => {
                          e.stopPropagation();
                          toggleStatusMute(status);
                        }}><BellOff /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button className="createStatus" onClick={() => setEchoComposerOpen(value => !value)}>
              <Plus /> {echoComposerOpen ? 'Close' : 'Share an Echo'}
            </button>
            {echoComposerOpen && (
              <div className="echoComposer">
                <div className="statusMediaButtons">
                  <button type="button" onClick={createTextStatus}><Pencil /> Text</button>
                  <label><Image /> Photo<input hidden type="file" accept="image/*" onChange={e => createMediaStatus(e, 'image')} /></label>
                  <label><Video /> Video<input hidden type="file" accept="video/*" onChange={e => createMediaStatus(e, 'video')} /></label>
                </div>
                <details className="statusPrivacy">
                  <summary>Who will see it · {contacts.length - statusExcluded.length} contacts</summary>
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
              </div>
            )}
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
                    <h2>Circles</h2>
                    <p>Join topic-based communities and see what they're sharing.</p>
                  </div>
                </div>
                <div className="channelSearch">
                  <Search />
                  <input placeholder="Discover Circles" onChange={e => loadChannels(e.target.value)} />
                  <button onClick={createChannel}><Plus /> Create</button>
                </div>
                <div className="channelList">
                  {channels.map(channel => (
                    <div key={channel.id}>
                      <div className="avatar"><MessageCircle /></div>
                      <button className="channelName" onClick={() => openChannel(channel)}>
                        <b>{channel.name}</b>
                        <small>{channel.followerCount} members · {channel.description}</small>
                      </button>
                      <button onClick={() => toggleChannelFollow(channel)}>
                        {channel.following ? 'Joined' : 'Join'}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <button className="channelBack" onClick={() => setSelectedChannel(null)}><ArrowLeft /> Circles</button>
                <div className="selectedChannelHero">
                  <div className="avatar"><MessageCircle /></div>
                  <div>
                    <h2>{selectedChannel.name}</h2>
                    <p>{selectedChannel.description}</p>
                  </div>
                  <button onClick={() => toggleChannelFollow(selectedChannel)}>
                    {selectedChannel.following ? 'Leave' : 'Join'}
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
                        <img src={resolveFileUrl(post.fileUrl)} alt={post.fileName || 'Circle photo'} />
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
        <div className="modal profileModal">
          {profileMode === 'full' ? (
            <div className="profile profileFull">
              <div className="profileFullTop">
                <button onClick={() => setProfileMode('quick')}><ArrowLeft /></button>
                <b>Full Profile</b>
                <button onClick={() => setProfile(null)}><MoreVertical /></button>
              </div>
              <div className="profileCover" />
              <div
                className={profile.avatarUrl ? 'profileAvatarWrap full zoomable' : 'profileAvatarWrap full'}
                onClick={() => profile.avatarUrl && setZoomedPhotoUser(profile)}
                title={profile.avatarUrl ? 'View photo' : undefined}
              >
                <Avatar user={profile} big />
                <span className={profile.online ? 'profilePresence online' : 'profilePresence'} />
              </div>
              <h2>{profile.username}</h2>
              <p>{profile.phone}</p>
              <small><span className={profile.online ? 'dot online' : 'dot'} /> {profileOnlineText} • {profileLastSeenText}</small>
              <div className="profileInfoList">
                <div><span><MessageCircle /></span><b>About</b><p>{profile.about || 'Hey there! I am using Naad.'}</p></div>
                <div><span><Languages /></span><b>Languages</b><p>{profile.languages || 'English'}</p></div>
                <div><span><CalendarClock /></span><b>Member Since</b><p>{profileMemberSince}</p></div>
              </div>
              <div className="profileRows">
                <button onClick={openProfileMedia}><span><Image /></span> Media, Links & Docs <b>{profileMediaCount}</b></button>
                <button onClick={openProfileStarred}><span><Star /></span> Starred Messages <b>{profileStarredCount}</b></button>
              </div>
            </div>
          ) : (
            <div className="profile profileCompact">
              <button className="profileClose" onClick={() => setProfile(null)}><X /></button>
              <div
                className={profile.avatarUrl ? 'profileAvatarWrap zoomable' : 'profileAvatarWrap'}
                onClick={() => profile.avatarUrl && setZoomedPhotoUser(profile)}
                title={profile.avatarUrl ? 'View photo' : undefined}
              >
                <Avatar user={profile} big />
                <span className={profile.online ? 'profilePresence online' : 'profilePresence'} />
              </div>
              <h2>{displayName(profile)}</h2>
              {profile.nickname && <p className="profileRealName">{profile.username}</p>}
              <p>{profile.phone}</p>
              <small><span className={profile.online ? 'dot online' : 'dot'} /> {profileOnlineText} • {profileLastSeenText}</small>

              {!profileIsMe && (
                <div className="profileActionGrid">
                  <button onClick={() => openProfileConversation(profile)}><MessageCircle /><span>Message</span></button>
                  <button onClick={() => callProfile('audio')}><Phone /><span>Voice Call</span></button>
                  <button onClick={() => callProfile('video')}><Video /><span>Video Call</span></button>
                  <button onClick={shareProfileLocation}><MapPin /><span>Share Live Location</span></button>
                </div>
              )}

              {profileIsMe && (
                <div className="profileSelfActions">
                  <label className="profilePhoto profilePhotoModern">
                    <Camera />
                    Change profile photo
                    <input hidden type="file" accept="image/*" onChange={uploadAvatar} />
                  </label>
                  <button type="button" className="profilePhoto profilePhotoModern" onClick={editMyProfile}>
                    <Pencil />
                    Edit profile
                  </button>
                </div>
              )}

              <div className="profileRows">
                <button onClick={() => setProfileMode('full')}><span><User /></span> View Full Profile <b>›</b></button>
                {!profileIsMe && (
                  <button onClick={editContactNickname}>
                    <span><Pencil /></span> Nickname
                    <b>{profile.nickname || 'Not set'}</b>
                  </button>
                )}
                {!profileIsMe && (
                  <button onClick={toggleProfileTranslation}>
                    <span><Languages /></span> Translate Chat
                    <b>{translateChatLanguages[cid(me.id, profile.id)] ? 'On' : 'Off'}</b>
                  </button>
                )}
              </div>

              {!profileIsMe && (
                <div className="profileSafety profileSafetyModern">
                  <button onClick={reportProfile}><Flag /> Report</button>
                  <button className="danger" onClick={blockProfile}><Ban /> Block</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {zoomedPhotoUser && (
        <div className="photoZoomOverlay" onClick={() => setZoomedPhotoUser(null)}>
          <button className="photoZoomClose" onClick={() => setZoomedPhotoUser(null)} title="Close"><X /></button>
          <img src={resolveFileUrl(zoomedPhotoUser.avatarUrl)} alt={`${zoomedPhotoUser.username}'s profile photo`} onClick={e => e.stopPropagation()} />
        </div>
      )}

      {mediaViewer && (
        <div className="photoZoomOverlay" onClick={() => setMediaViewer(null)}>
          <button className="photoZoomClose" onClick={() => setMediaViewer(null)} title="Close"><X /></button>
          {mediaViewer.kind === 'video' ? (
            <video src={mediaViewer.url} controls autoPlay onClick={e => e.stopPropagation()} />
          ) : (
            <img src={mediaViewer.url} alt={mediaViewer.fileName || 'Photo'} onClick={e => e.stopPropagation()} />
          )}
          <a
            className="photoZoomDownload"
            href={mediaViewer.url}
            download={mediaViewer.fileName || true}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            title="Save"
          >
            <Archive /> Save
          </a>
        </div>
      )}

      {globalSearchOpen && (() => {
        const { contactMatches, groupMatches, messageMatches } = globalSearchResults();
        const hasQuery = globalSearchQuery.trim().length >= 2;
        const hasResults = contactMatches.length || groupMatches.length || messageMatches.length;
        return (
          <div className="globalSearchOverlay">
            <div className="globalSearchHeader">
              <input
                autoFocus
                value={globalSearchQuery}
                onChange={e => setGlobalSearchQuery(e.target.value)}
                placeholder={globalSearchLoading ? 'Loading your chats…' : 'Search chats, contacts, and messages'}
              />
              <button onClick={() => setGlobalSearchOpen(false)} title="Close"><X /></button>
            </div>
            <div className="globalSearchBody">
              {!hasQuery && (
                <p className="globalSearchEmpty">
                  {globalSearchLoading ? 'Loading your chat history to search…' : 'Type at least 2 characters to search everything.'}
                </p>
              )}
              {hasQuery && !hasResults && <p className="globalSearchEmpty">No matches for "{globalSearchQuery.trim()}".</p>}
              {hasQuery && contactMatches.length > 0 && (
                <div className="globalSearchSection">
                  <h4>Contacts</h4>
                  {contactMatches.map(contact => (
                    <button key={contact.id} className="globalSearchRow" onClick={() => { setGlobalSearchOpen(false); openChat(contact); }}>
                      <Avatar user={contact} />
                      <div><b>{displayName(contact)}</b><span>{contact.phone}</span></div>
                    </button>
                  ))}
                </div>
              )}
              {hasQuery && groupMatches.length > 0 && (
                <div className="globalSearchSection">
                  <h4>Groups</h4>
                  {groupMatches.map(group => (
                    <button key={group.id} className="globalSearchRow" onClick={() => { setGlobalSearchOpen(false); openGroup(group); }}>
                      <span className="avatar"><Users /></span>
                      <div><b>{group.name}</b><span>{group.members.length} members</span></div>
                    </button>
                  ))}
                </div>
              )}
              {hasQuery && messageMatches.length > 0 && (
                <div className="globalSearchSection">
                  <h4>Messages</h4>
                  {messageMatches.map(({ contact, message }) => (
                    <button key={message.id} className="globalSearchRow" onClick={() => { setGlobalSearchOpen(false); openChat(contact); }}>
                      <Avatar user={contact} />
                      <div><b>{displayName(contact)}</b><span>{message.body}</span></div>
                      <time>{new Date(message.createdAt).toLocaleDateString()}</time>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
