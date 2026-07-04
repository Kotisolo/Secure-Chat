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
```

Health check: `/api/health`

## Vercel frontend

Use `securechat_best_deployment_ready_clean/client` as the root directory.

Environment variables:

```env
VITE_API_URL=https://your-render-service.onrender.com
VITE_TURN_URL=turn:your-turn-server:3478
VITE_TURN_USERNAME=your-turn-username
VITE_TURN_CREDENTIAL=your-turn-credential
```

Redeploy after changing any `VITE_` variable.

## Production notes

- Render's local filesystem is temporary. Move uploads to Cloudinary, S3, or another persistent object-storage service before relying on attachments.
- A TURN service is required for reliable voice/video calls across mobile and restricted networks.
- Password recovery uses one-time recovery codes without SMS cost. Users must save their code securely.
- Store secrets only in Render, Neon, and Vercel environment settings. Never commit `.env` files.
