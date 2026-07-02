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
- Deployment: Railway backend/database + Vercel frontend

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

See `DEPLOYMENT.md` for GitHub, Railway, and Vercel deployment steps.
