import { sequelize } from '../config/sequelize';

/**
 * Peshkash 5.0 — configurable event registration. Additive and idempotent: existing one-tap
 * rows get defaults that mean exactly what they meant before (registered, party of one).
 * Mirrors migrations/2026-10-12-event-registration-5.sql.
 */
export const REGISTRATION_SCHEMA_SQL = [
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'registered'`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS party_size INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS form_version INTEGER`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS guest_name TEXT`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS waitlist_rank DOUBLE PRECISION`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS pass_nonce TEXT`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS pass_token_hash TEXT`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS pass_code VARCHAR(16)`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS checked_in_by VARCHAR(20)`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS check_in_method VARCHAR(10)`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20)`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'one_tap'`,
  `ALTER TABLE event_registration ADD COLUMN IF NOT EXISTS invite_id BIGINT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_event_registration_pass_hash ON event_registration(pass_token_hash) WHERE pass_token_hash IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_event_registration_status ON event_registration(event_id, status)`,
  `CREATE TABLE IF NOT EXISTS event_registration_settings (
     event_id   BIGINT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
     settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
     updated_by VARCHAR(20),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS event_form (
     event_id    BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
     kind        VARCHAR(20) NOT NULL CHECK (kind IN ('registration','feedback')),
     title       TEXT NOT NULL DEFAULT '',
     description TEXT NOT NULL DEFAULT '',
     questions   JSONB NOT NULL DEFAULT '[]'::jsonb,
     version     INTEGER NOT NULL DEFAULT 1,
     updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (event_id, kind)
   )`,
  `CREATE TABLE IF NOT EXISTS event_check_in_log (
     id              BIGSERIAL PRIMARY KEY,
     event_id        BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
     registration_id BIGINT REFERENCES event_registration(id) ON DELETE SET NULL,
     scanned_by      VARCHAR(20) NOT NULL,
     method          VARCHAR(10) NOT NULL,
     result          VARCHAR(20) NOT NULL,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_event_check_in_log_event ON event_check_in_log(event_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS event_invite (
     id         BIGSERIAL PRIMARY KEY,
     event_id   BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
     phone      VARCHAR(20) NOT NULL,
     nonce      TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     created_by VARCHAR(20) NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     used_at    TIMESTAMPTZ,
     revoked_at TIMESTAMPTZ,
     UNIQUE(event_id, phone)
   )`,
  `CREATE TABLE IF NOT EXISTS event_feedback (
     id              BIGSERIAL PRIMARY KEY,
     event_id        BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
     phone           VARCHAR(20) NOT NULL,
     registration_id BIGINT REFERENCES event_registration(id) ON DELETE SET NULL,
     answers         JSONB NOT NULL DEFAULT '{}'::jsonb,
     form_version    INTEGER,
     submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE(event_id, phone)
   )`,
  `CREATE TABLE IF NOT EXISTS event_feedback_dispatch (
     event_id   BIGINT PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
     sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     sent_by    VARCHAR(20) NOT NULL,
     channel    VARCHAR(20) NOT NULL,
     recipients INTEGER NOT NULL DEFAULT 0,
     delivered  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS event_registration_view (
     event_id   BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
     phone      VARCHAR(20) NOT NULL,
     config     JSONB NOT NULL DEFAULT '{}'::jsonb,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (event_id, phone)
   )`,
];

export async function runRegistrationMigrations(): Promise<void> {
  // Required by the 5.0 registration endpoints: a failure must stop boot rather than let the
  // endpoints run against a partial schema.
  for (const statement of REGISTRATION_SCHEMA_SQL) await sequelize.query(statement);
}
