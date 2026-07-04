# SecureChat React + Node

SecureChat is a WhatsApp-style starter app using React, Node.js, Express, Socket.IO, and PostgreSQL.

## Features

- Register/login
- Search users
- Recent chats
- Realtime Socket.IO messages
- Image/file upload
- Emoji picker
- Online/typing status
- WebRTC call signaling
- Voice/video call UI

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Realtime: Socket.IO
- Database: PostgreSQL
- Deployment: Render backend + Neon PostgreSQL + Vercel frontend

## Local setup

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

See `DEPLOYMENT.md` for GitHub, Render, Neon, and Vercel deployment steps.

Experimental encryption work is documented in `E2EE.md`. It is disabled in production.

## Password recovery

SecureChat uses free one-time recovery codes instead of insecure phone-only resets:

- New users receive a recovery code after registration.
- Existing users create one from the key button after logging in.
- The server stores only a bcrypt hash of the code.
- A successful reset consumes the code and revokes existing sessions.

Users must save the displayed code privately.
