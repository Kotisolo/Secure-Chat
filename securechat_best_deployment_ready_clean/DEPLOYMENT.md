# SecureChat Deployment Guide

Recommended production setup:

- GitHub: source code
- Railway: Node.js backend + PostgreSQL
- Vercel: React frontend

## 1. Local test

Backend:

```bash
cd server
npm install
cp .env.example .env
npm start
```

Frontend:

```bash
cd client
npm install
cp .env.example .env
npm run dev
```

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Initial SecureChat deployment-ready version"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

## 3. Railway backend

Create a Railway project and add PostgreSQL. Deploy the `server` folder as the backend service.

Railway backend variables:

```env
DATABASE_URL=Railway PostgreSQL connection string
JWT_SECRET=use_a_long_random_secret_at_least_32_characters
CLIENT_ORIGIN=https://your-vercel-app.vercel.app
NODE_ENV=production
```

Railway will provide `PORT` automatically.

Health check URL:

```text
https://your-railway-backend.up.railway.app/api/health
```

## 4. Vercel frontend

Deploy the `client` folder.

Vercel frontend variable:

```env
VITE_API_URL=https://your-railway-backend.up.railway.app
```

## 5. Future updates

Use this safe flow:

```text
Make changes locally
Test locally
Commit to GitHub
Push to main
Railway/Vercel auto-deploy
Check production
```

## Important notes

- Do not commit real `.env` files.
- Enable Railway PostgreSQL backups before real users.
- File uploads stored inside the server may be lost on redeploy depending on host storage. For production, move uploads to S3, Cloudinary, or similar object storage.
- For reliable voice/video calls across different networks, add a TURN server.
- Current password reset is simple phone-based reset. For production, add OTP or email verification.
