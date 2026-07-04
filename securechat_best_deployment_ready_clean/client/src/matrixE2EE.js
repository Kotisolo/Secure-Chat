export const MATRIX_E2EE_POC_ENABLED =
  import.meta.env.VITE_MATRIX_E2EE_POC_ENABLED === 'true';

let matrixClient = null;

function requireValue(value, label) {
  if (!value) throw new Error(`${label} is required for the Matrix E2EE proof of concept.`);
  return value;
}

export async function startMatrixE2EE({
  accessToken,
  userId,
  deviceId,
  homeserverUrl = import.meta.env.VITE_MATRIX_HOMESERVER_URL
}) {
  if (!MATRIX_E2EE_POC_ENABLED) {
    throw new Error('Matrix E2EE proof of concept is disabled.');
  }
  if (matrixClient) return matrixClient;

  const sdk = await import('matrix-js-sdk');
  const client = sdk.createClient({
    baseUrl: requireValue(homeserverUrl, 'Matrix homeserver URL'),
    accessToken: requireValue(accessToken, 'Matrix access token'),
    userId: requireValue(userId, 'Matrix user ID'),
    deviceId: requireValue(deviceId, 'Matrix device ID'),
    timelineSupport: true
  });

  // Matrix Rust Crypto stores device keys and ratchet state in browser IndexedDB.
  await client.initRustCrypto();
  await client.startClient({ initialSyncLimit: 20 });
  matrixClient = client;
  return client;
}

export function getMatrixE2EEClient() {
  return matrixClient;
}

export function stopMatrixE2EE() {
  matrixClient?.stopClient();
  matrixClient = null;
}
