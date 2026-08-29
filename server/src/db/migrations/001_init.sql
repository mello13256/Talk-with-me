-- =============================================================================
-- Talk with me — initial schema
--
-- Design notes
-- ------------
-- * Every conversation is strictly 1:1 between exactly one client and the
--   administrator. `conversations.client_id` is UNIQUE, which makes that a
--   database-level guarantee rather than an application convention.
-- * Because a conversation has exactly one recipient per message, read state
--   lives directly on `messages.read_at` instead of a receipts join table.
-- * Ownership columns exist on every child table so that authorization can be
--   expressed inside the SQL WHERE clause, not only in application code.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('client', 'admin');
CREATE TYPE conversation_status AS ENUM ('open', 'resolved');
CREATE TYPE message_kind AS ENUM ('text', 'file', 'system');
CREATE TYPE attachment_purpose AS ENUM ('message', 'avatar');
CREATE TYPE notification_type AS ENUM (
  'message',
  'conversation_resolved',
  'conversation_reopened',
  'account_blocked',
  'account_unblocked'
);

-- -----------------------------------------------------------------------------
-- Shared trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- users — clients and administrators share one table, separated by `role`.
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                citext NOT NULL UNIQUE,
  password_hash        text   NOT NULL,
  name                 text   NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  role                 user_role NOT NULL DEFAULT 'client',
  avatar_attachment_id uuid,
  phone                text CHECK (phone IS NULL OR char_length(phone) <= 40),
  company              text CHECK (company IS NULL OR char_length(company) <= 160),
  -- Internal CRM notes. Administrator-only: never serialized to a client.
  notes                text CHECK (notes IS NULL OR char_length(notes) <= 4000),
  is_blocked           boolean NOT NULL DEFAULT false,
  blocked_at           timestamptz,
  blocked_reason       text CHECK (blocked_reason IS NULL OR char_length(blocked_reason) <= 500),
  is_online            boolean NOT NULL DEFAULT false,
  last_seen_at         timestamptz,
  password_changed_at  timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_length CHECK (char_length(email::text) <= 254)
);

CREATE INDEX users_role_created_idx ON users (role, created_at DESC);
CREATE INDEX users_name_trgm_idx ON users (lower(name));
CREATE INDEX users_online_idx ON users (is_online) WHERE is_online;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- sessions — opaque server-side sessions. Only the SHA-256 digest of the token
-- is stored, so a database leak does not hand out live sessions.
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  user_agent   text,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- password_reset_tokens — single-use, short-lived, digest-only.
-- -----------------------------------------------------------------------------
CREATE TABLE password_reset_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  requested_ip inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- conversations — exactly one per client (UNIQUE client_id).
-- -----------------------------------------------------------------------------
CREATE TABLE conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  status          conversation_status NOT NULL DEFAULT 'open',
  subject         text CHECK (subject IS NULL OR char_length(subject) <= 160),
  last_message_at timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_activity_idx
  ON conversations (last_message_at DESC NULLS LAST, created_at DESC);
CREATE INDEX conversations_status_idx ON conversations (status);

CREATE TRIGGER conversations_set_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  kind            message_kind NOT NULL DEFAULT 'text',
  body            text NOT NULL DEFAULT '' CHECK (char_length(body) <= 8000),
  reply_to_id     uuid REFERENCES messages (id) ON DELETE SET NULL,
  -- Client-generated idempotency key: retrying a send never duplicates a message.
  client_nonce    text CHECK (client_nonce IS NULL OR char_length(client_nonce) <= 64),
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  search_vector   tsvector GENERATED ALWAYS AS
                    (to_tsvector('portuguese', coalesce(body, ''))) STORED,
  CONSTRAINT messages_system_has_no_sender CHECK (kind <> 'system' OR sender_id IS NULL)
);

CREATE INDEX messages_conversation_idx
  ON messages (conversation_id, created_at DESC, id DESC);

-- Powers the unread badge: partial index keeps it tiny regardless of history size.
CREATE INDEX messages_unread_idx
  ON messages (conversation_id, sender_id)
  WHERE read_at IS NULL AND deleted_at IS NULL;

CREATE INDEX messages_search_idx ON messages USING GIN (search_vector);

CREATE UNIQUE INDEX messages_nonce_idx
  ON messages (conversation_id, sender_id, client_nonce)
  WHERE client_nonce IS NOT NULL;

-- Keep conversations.last_message_at in sync from the database itself.
CREATE OR REPLACE FUNCTION bump_conversation_activity() RETURNS trigger AS $$
BEGIN
  UPDATE conversations
     SET last_message_at = NEW.created_at,
         updated_at      = now()
   WHERE id = NEW.conversation_id
     AND (last_message_at IS NULL OR last_message_at < NEW.created_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER messages_bump_conversation
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION bump_conversation_activity();

-- -----------------------------------------------------------------------------
-- attachments — binary lives in object storage; this table holds the metadata
-- plus the ownership columns needed to authorize a download.
-- -----------------------------------------------------------------------------
CREATE TABLE attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose         attachment_purpose NOT NULL DEFAULT 'message',
  conversation_id uuid REFERENCES conversations (id) ON DELETE CASCADE,
  message_id      uuid REFERENCES messages (id) ON DELETE CASCADE,
  uploader_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key     text NOT NULL UNIQUE,
  original_name   text NOT NULL CHECK (char_length(original_name) <= 260),
  mime_type       text NOT NULL CHECK (char_length(mime_type) <= 160),
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  width           int CHECK (width IS NULL OR width > 0),
  height          int CHECK (height IS NULL OR height > 0),
  checksum_sha256 text CHECK (checksum_sha256 IS NULL OR char_length(checksum_sha256) = 64),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachments_message_requires_conversation
    CHECK (purpose <> 'message' OR conversation_id IS NOT NULL)
);

CREATE INDEX attachments_message_idx ON attachments (message_id);
CREATE INDEX attachments_conversation_idx ON attachments (conversation_id, created_at DESC);
CREATE INDEX attachments_uploader_idx ON attachments (uploader_id);
-- Orphan sweeper: uploads that were never attached to a message.
CREATE INDEX attachments_orphan_idx ON attachments (created_at) WHERE message_id IS NULL;

ALTER TABLE users
  ADD CONSTRAINT users_avatar_fk
  FOREIGN KEY (avatar_attachment_id) REFERENCES attachments (id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- notifications — in-app notification centre (per user).
-- -----------------------------------------------------------------------------
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type            notification_type NOT NULL,
  title           text NOT NULL CHECK (char_length(title) <= 200),
  body            text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  conversation_id uuid REFERENCES conversations (id) ON DELETE CASCADE,
  message_id      uuid REFERENCES messages (id) ON DELETE CASCADE,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- -----------------------------------------------------------------------------
-- push_subscriptions — Web Push (VAPID) endpoints per device.
-- -----------------------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  failure_count int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- -----------------------------------------------------------------------------
-- login_attempts — survives restarts, so throttling is not purely in-memory.
-- -----------------------------------------------------------------------------
CREATE TABLE login_attempts (
  id         bigserial PRIMARY KEY,
  email      citext,
  ip         inet,
  success    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_email_idx ON login_attempts (email, created_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, created_at DESC);

-- -----------------------------------------------------------------------------
-- audit_log — every privileged administrator action is recorded.
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   uuid,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at DESC);
CREATE INDEX audit_log_target_idx ON audit_log (target_type, target_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- app_settings — single-row table for operator-configurable copy.
-- -----------------------------------------------------------------------------
CREATE TABLE app_settings (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  brand_name      text NOT NULL DEFAULT 'Talk with me',
  welcome_message text NOT NULL DEFAULT
    'Olá! Este é o seu canal privado. Escreva sua mensagem e eu respondo por aqui.',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TRIGGER app_settings_set_updated_at
  BEFORE UPDATE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
