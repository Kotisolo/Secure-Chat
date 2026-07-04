CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS users(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), username VARCHAR(80) NOT NULL, phone VARCHAR(40) UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, about TEXT DEFAULT 'Hey there! I am using SecureChat.', avatar_url TEXT,
 created_at TIMESTAMPTZ DEFAULT NOW(), last_seen TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_created_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS conversations(
 id TEXT PRIMARY KEY, user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE IF NOT EXISTS messages(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL, kind VARCHAR(20) DEFAULT 'text', file_url TEXT, file_name TEXT, file_mime TEXT,
 delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ciphertext TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encryption_version SMALLINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_device_id TEXT;
CREATE TABLE IF NOT EXISTS user_devices(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 device_id TEXT NOT NULL,
 public_key_jwk JSONB NOT NULL,
 key_fingerprint VARCHAR(128) NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 last_seen TIMESTAMPTZ DEFAULT NOW(),
 revoked_at TIMESTAMPTZ,
 UNIQUE(user_id,device_id));
CREATE TABLE IF NOT EXISTS message_deletions(
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id,message_id));
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_delivery ON messages(recipient_id,delivered_at) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_recipient_read ON messages(recipient_id,read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_devices_active ON user_devices(user_id,last_seen DESC) WHERE revoked_at IS NULL;
