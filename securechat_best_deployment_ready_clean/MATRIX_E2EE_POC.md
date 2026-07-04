# Matrix E2EE proof of concept

This branch tests a production-grade browser encryption direction without changing the live app.

## Why Matrix

- Browser-supported JavaScript SDK
- Maintained Rust/WASM cryptography
- IndexedDB crypto-state storage
- Device verification, cross-signing, encrypted key backup, and encrypted media support
- Apache-2.0 license

The official Signal JavaScript package is Node-native rather than browser-native and is AGPL-3.0-only. It is not a safe drop-in dependency for this Vite web client.

## Safety

The proof of concept is disabled by default:

```env
VITE_MATRIX_E2EE_POC_ENABLED=false
VITE_MATRIX_HOMESERVER_URL=
```

Nothing imports, initializes, or connects to Matrix at runtime while the flag remains disabled.

## Work required before integration

1. Deploy or select a Matrix homeserver.
2. Design a secure account bridge between SecureChat users and Matrix users/devices.
3. Replace custom message persistence with encrypted Matrix rooms.
4. Migrate Socket.IO typing, presence, and receipts to Matrix events.
5. Move encrypted attachments to Matrix authenticated media.
6. Add device verification, cross-signing, and encrypted key backup UI.
7. Define message-history migration and deletion behavior.
8. Test multi-device, offline, key-change, recovery, and compromised-device scenarios.
9. Complete an independent security review.

## Current status

`client/src/matrixE2EE.js` provides a disabled bootstrap adapter that dynamically loads the SDK, initializes Rust Crypto, and uses its browser IndexedDB crypto store. It is not connected to the existing application UI or authentication flow.

The forced browser compatibility build passes with Vite. The Rust crypto chunk is approximately 7.7 MB uncompressed and 2.64 MB compressed, so production integration must keep it lazy-loaded.

Dependency audit result: zero known vulnerabilities at the time of this proof of concept.
