import { api, getStoredUser, resolveFileUrl } from './api';

export const E2EE_ENABLED = import.meta.env.VITE_E2EE_ENABLED === 'true';

const DB_NAME = 'securechat-crypto';
const STORE_NAME = 'identity';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let identityPromise;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIdentity() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get('primary');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeIdentity(identity) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(identity, 'primary');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function toBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function createIdentity() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const fingerprint = await sha256Hex(`${publicKeyJwk.crv}|${publicKeyJwk.x}|${publicKeyJwk.y}`);
  const identity = {
    deviceId: crypto.randomUUID(),
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk,
    fingerprint
  };
  await writeIdentity(identity);
  return identity;
}

export async function ensureE2EEIdentity() {
  if (!E2EE_ENABLED) return null;
  if (!identityPromise) {
    identityPromise = (async () => {
      const identity = (await readIdentity()) || (await createIdentity());
      await api('/api/e2ee/devices', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: identity.deviceId,
          publicKeyJwk: identity.publicKeyJwk,
          fingerprint: identity.fingerprint
        })
      });
      return identity;
    })();
  }
  return identityPromise;
}

function rememberPeerKey(userId, device) {
  const storageKey = `sc_e2ee_peer_${userId}_${device.deviceId}`;
  const known = localStorage.getItem(storageKey);
  if (known && known !== device.fingerprint) {
    throw new Error('This contact’s encryption key changed. Verify their identity before sending messages.');
  }
  if (!known) localStorage.setItem(storageKey, device.fingerprint);
}

async function getPeerDevice(userId, deviceId) {
  const devices = await api(`/api/e2ee/users/${encodeURIComponent(userId)}/devices`);
  const device = deviceId
    ? devices.find(item => item.deviceId === deviceId)
    : devices[0];
  if (!device) throw new Error('This contact has not enabled encrypted messaging on a device.');
  rememberPeerKey(userId, device);
  return device;
}

async function deriveMessageKey(identity, peerDevice, conversationId) {
  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    peerDevice.publicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    identity.privateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(conversationId),
      info: encoder.encode('SecureChat E2EE beta v1')
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(recipientId, conversationId, plaintext) {
  const identity = await ensureE2EEIdentity();
  const peerDevice = await getPeerDevice(recipientId);
  const key = await deriveMessageKey(identity, peerDevice, conversationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(conversationId) },
    key,
    encoder.encode(plaintext)
  );
  return {
    ciphertext: JSON.stringify({ iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) }),
    encryptionVersion: 1,
    senderDeviceId: identity.deviceId
  };
}

export async function decryptMessage(message, conversationId) {
  if (!message?.ciphertext || message.encryptionVersion !== 1) return message;
  const me = getStoredUser();
  if (!me?.id) throw new Error('Encrypted session is unavailable.');
  const identity = await ensureE2EEIdentity();
  const sentByMe = String(message.senderId) === String(me.id);
  const peerId = sentByMe ? message.recipientId : message.senderId;
  const peerDevice = await getPeerDevice(peerId, sentByMe ? null : message.senderDeviceId);
  const key = await deriveMessageKey(identity, peerDevice, conversationId);
  const envelope = JSON.parse(message.ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encoder.encode(conversationId)
    },
    key,
    fromBase64(envelope.data)
  );
  return { ...message, body: decoder.decode(plaintext), encrypted: true };
}

export async function encryptAttachment(recipientId, conversationId, file) {
  const identity = await ensureE2EEIdentity();
  const peerDevice = await getPeerDevice(recipientId);
  const key = await deriveMessageKey(identity, peerDevice, conversationId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(`${conversationId}:attachment`) },
    key,
    await file.arrayBuffer()
  );
  return {
    file: new File([encrypted], `${file.name}.encrypted`, { type: 'application/octet-stream' }),
    fileEncryption: JSON.stringify({ iv: toBase64(iv) }),
    senderDeviceId: identity.deviceId
  };
}

export async function decryptAttachment(message, conversationId) {
  if (!message?.fileEncryption) return resolveFileUrl(message?.fileUrl);
  const me = getStoredUser();
  const identity = await ensureE2EEIdentity();
  const sentByMe = String(message.senderId) === String(me?.id);
  const peerId = sentByMe ? message.recipientId : message.senderId;
  const peerDevice = await getPeerDevice(peerId, sentByMe ? null : message.senderDeviceId);
  const key = await deriveMessageKey(identity, peerDevice, conversationId);
  const response = await fetch(resolveFileUrl(message.fileUrl));
  if (!response.ok) throw new Error('Encrypted attachment could not be downloaded.');
  const envelope = JSON.parse(message.fileEncryption);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64(envelope.iv),
      additionalData: encoder.encode(`${conversationId}:attachment`)
    },
    key,
    await response.arrayBuffer()
  );
  return URL.createObjectURL(new Blob([decrypted], { type: message.fileMime || 'application/octet-stream' }));
}
