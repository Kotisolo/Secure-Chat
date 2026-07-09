# SecureChat deployment

Production services:

- Vercel: `client`
- Render: `server`
- Neon: PostgreSQL

## Render backend

Use `securechat_best_deployment_ready_clean/server` as the root directory.

Build command:

```text
npm ci
```

Start command:

```text
npm start
```

Environment variables:

```env
DATABASE_URL=your_neon_pooled_connection_string
JWT_SECRET=a_random_secret_at_least_32_characters
CLIENT_ORIGIN=https://your-vercel-domain.vercel.app
NODE_ENV=production
# Optional now, required when running more than one backend instance:
REDIS_URL=your_private_redis_connection_string
```

Health check: `/api/health`

## Vercel frontend

Use `securechat_best_deployment_ready_clean/client` as the root directory.

Environment variables:

```env
VITE_API_URL=https://your-render-service.onrender.com
VITE_TURN_URLS=turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:80?transport=tcp,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-credential
VITE_ICE_TRANSPORT_POLICY=all
```

Redeploy after changing any `VITE_` variable.

`VITE_TURN_URLS` must contain only `turn:` or `turns:` URLs. Do not paste the
Metered dashboard page URL.

For carrier-to-Wi-Fi testing, use all TURN URLs supplied by the provider. Secure
TURN over TCP port 443 is especially important on mobile and restricted
networks. Set `VITE_ICE_TRANSPORT_POLICY=relay` for one test deployment to prove
the relay works, then change it back to `all` so direct connections remain
available.

## Production notes

- Render's local filesystem is temporary. Move uploads to Cloudinary, S3, or another persistent object-storage service before relying on attachments.
- A TURN service is required for reliable voice/video calls across mobile and restricted networks.
- `REDIS_URL` enables the Socket.IO Redis adapter and shared online presence for calls. Use it before scaling the backend to multiple instances.
- When traffic grows, keep Socket.IO signaling on always-on backend instances and use Redis so call offers, answers, ICE candidates, and online status reach users connected to different instances.
- For large public video traffic, add an SFU/media provider such as LiveKit, Metered SFU, Agora, Daily, or Twilio. Keep Socket.IO for signaling and app events; let the SFU carry heavy voice/video media.
- Password recovery uses one-time recovery codes without SMS cost. Users must save their code securely.
- Store secrets only in Render, Neon, and Vercel environment settings. Never commit `.env` files.
