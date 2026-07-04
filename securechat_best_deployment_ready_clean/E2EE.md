# End-to-end encryption development status

The E2EE foundation is experimental and disabled by default:

```env
VITE_E2EE_ENABLED=false
```

The current production application is unchanged.

## Implemented on the development branch

- Non-extractable browser ECDH private keys stored in IndexedDB
- Public device-key registration on the server
- AES-256-GCM encrypted text-message envelopes
- HKDF key derivation scoped to each conversation
- Trust-on-first-use fingerprint pinning and key-change detection
- Backward-compatible handling of existing plaintext messages
- Server storage of ciphertext rather than encrypted-message plaintext

## Required before production

- Replace the beta static ECDH session with a reviewed asynchronous ratchet protocol
- Add forward secrecy and post-compromise recovery
- Add QR/safety-number identity verification
- Add secure multi-device fan-out and device revocation
- Add encrypted attachment upload/download
- Add encrypted key backup and device-loss recovery
- Add replay protection and formal message-envelope versioning
- Migrate or clearly separate existing plaintext history
- Obtain an independent cryptographic security review

## Current limitations

- Only text messages use the experimental encrypted path
- Attachments are blocked while the flag is enabled
- Existing messages remain in their original format
- Losing browser storage loses access to encrypted history
- First-contact key exchange still relies on the server
- The beta does not yet provide Signal-style forward secrecy

Do not advertise this beta as Signal-equivalent or production-ready E2EE.
