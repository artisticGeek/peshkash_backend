import express from 'express';
import cors from 'cors';
import router from './routes/router';
import onboardingRouter from './routes/onboardingRouter';
import adminRouter from './routes/adminRouter';
import analyticsRouter from './routes/analyticsRouter';
import authRouter from './routes/authRouter';
import { authMiddleware } from './middleware/authMiddleware';
import { sequelize } from './config/sequelize';
import { AnalyticsQueue } from './services/AnalyticsQueue';

const app = express();

app.disable('x-powered-by');
app.use((_req, res, next) => { res.setHeader('X-App', 'Peshkash'); next(); });
app.use(cors());
app.use(express.json());

// Auth middleware — attaches req.user from Bearer token on every request (non-blocking)
app.use(authMiddleware);

app.use('/api/auth',     authRouter);
app.use('/api', router);
app.use('/api/onboard/:vendorName', onboardingRouter);
app.use('/api/admin', adminRouter);
app.use('/api/analytics', analyticsRouter);

app.get('/', (_req, res) => {
  res.send('✅ Peshkash backend is alive!');
});

app.get('/health', async (_req, res) => {
  const queueDepth = await AnalyticsQueue.depth();
  res.json({
    status: 'ok',
    redis: AnalyticsQueue.isRedisConnected ? 'connected' : 'fallback-mode',
    analyticsQueueDepth: queueDepth,
  });
});

app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

/**
 * runMigrations — idempotent column additions executed BEFORE the server
 * starts accepting traffic. Every statement uses IF NOT EXISTS / ON CONFLICT
 * so it is safe to replay on every boot.
 *
 * WHY HERE (not in server.ts):
 *   app.ts is imported by both server.ts (production) and any test harness.
 *   Keeping migrations next to the route setup makes it obvious that the
 *   schema is ready by the time routes execute.
 *
 * NOTE: server.ts must await this before calling app.listen() so that
 *   Render's health-check probe never hits a request with missing columns.
 */
export async function runMigrations(): Promise<void> {
  await sequelize.authenticate();
  console.log('✅ Connected to PostgreSQL via Sequelize');

  // analytics_event — columns added progressively after initial schema
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS page_url      TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS menu_id       BIGINT`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS item_id       BIGINT`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS user_agent    TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS referrer      TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS device_type   VARCHAR(20)`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS qr_type       VARCHAR(50)`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS qr_status     VARCHAR(50)`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS resolved      BOOLEAN`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS resolved_url  TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS phone         VARCHAR(20)`).catch(() => {});

  // line_item — rich-content columns added after initial schema
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS display_name  TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS ingredients   TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS image         TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS enum_type     VARCHAR(100)`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS sort_order    INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS price         TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS tags          TEXT[] NOT NULL DEFAULT '{}'::text[]`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS allergens     TEXT[] NOT NULL DEFAULT '{}'::text[]`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS is_veg         BOOLEAN`).catch(() => {});
  await sequelize.query(`ALTER TABLE line_item ADD COLUMN IF NOT EXISTS spice_level    INTEGER`).catch(() => {});

  // menu — editorial presentation settings used by public item pages
  await sequelize.query(`ALTER TABLE menu ADD COLUMN IF NOT EXISTS item_story_heading VARCHAR(80) NOT NULL DEFAULT 'The backstory'`).catch(() => {});

  // vendor — auth and contact-page columns
  await sequelize.query(`ALTER TABLE vendor ADD COLUMN IF NOT EXISTS logo_url      TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE vendor ADD COLUMN IF NOT EXISTS phone         VARCHAR(20) UNIQUE`).catch(() => {});
  await sequelize.query(`ALTER TABLE vendor ADD COLUMN IF NOT EXISTS require_login BOOLEAN NOT NULL DEFAULT false`).catch(() => {});

  // event experience — menu-independent public pages and phone registrations
  // These are required by the event workflow. Do not swallow failures: serving an older schema
  // makes the API appear to save successfully while silently losing the public-page settings.
  await sequelize.query(`ALTER TABLE event ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'`);
  await sequelize.query(`ALTER TABLE event ADD COLUMN IF NOT EXISTS experience_config JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS event_registration (
      id             BIGSERIAL PRIMARY KEY,
      event_id       BIGINT NOT NULL REFERENCES event(id) ON DELETE CASCADE,
      phone          VARCHAR(20) NOT NULL,
      registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_id, phone)
    )
  `);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_event_registration_event_id ON event_registration(event_id)`);

  // QR Studio — manifest-backed designs. Legacy element arrays remain readable.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS qr_templates (
      id                  BIGSERIAL PRIMARY KEY,
      name                TEXT NOT NULL,
      width_mm            DOUBLE PRECISION NOT NULL DEFAULT 85,
      height_mm           DOUBLE PRECISION NOT NULL DEFAULT 54,
      elements            JSONB NOT NULL DEFAULT '[]'::jsonb,
      library_template_id TEXT,
      manifest_version    TEXT NOT NULL DEFAULT '3.1.0',
      qr_style             TEXT NOT NULL DEFAULT 'obsidian-ring',
      theme                TEXT NOT NULL DEFAULT 'light',
      settings             JSONB NOT NULL DEFAULT '{}'::jsonb,
      schema_version       TEXT NOT NULL DEFAULT '1.0.0',
      document             JSONB,
      revision             INTEGER NOT NULL DEFAULT 1,
      preview_thumbnail    TEXT,
      vendor_id            BIGINT REFERENCES vendor(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS library_template_id TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS manifest_version TEXT NOT NULL DEFAULT '3.1.0'`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS qr_style TEXT NOT NULL DEFAULT 'obsidian-ring'`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'light'`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS schema_version TEXT NOT NULL DEFAULT '1.0.0'`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS document JSONB`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS preview_thumbnail TEXT`).catch(() => {});
  await sequelize.query(`ALTER TABLE qr_templates ADD COLUMN IF NOT EXISTS vendor_id BIGINT REFERENCES vendor(id) ON DELETE SET NULL`).catch(() => {});
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_qr_templates_vendor_id ON qr_templates(vendor_id)`).catch(() => {});

  // admin_user table — source of truth for who is an admin
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS admin_user (
      id         SERIAL PRIMARY KEY,
      phone      VARCHAR(20) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  // One-time seed: if INITIAL_ADMIN_PHONE is set, insert it (idempotent)
  const seedPhone = process.env.INITIAL_ADMIN_PHONE;
  if (seedPhone) {
    await sequelize.query(
      `INSERT INTO admin_user (phone) VALUES (:phone) ON CONFLICT (phone) DO NOTHING`,
      { replacements: { phone: seedPhone } }
    ).catch(() => {});
  }

  // Session invalidation — force-logout specific phones or all users
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS session_invalidation (
      phone             VARCHAR(50) PRIMARY KEY,
      invalidate_before TIMESTAMPTZ NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  // App config table — runtime settings editable directly in the DB
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      key        VARCHAR(100) PRIMARY KEY,
      value      TEXT        NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  await sequelize.query(`
    INSERT INTO app_config (key, value) VALUES ('sms_provider', '2factor')
    ON CONFLICT (key) DO NOTHING
  `).catch(() => {});

  console.log('✅ Migrations complete');
}

export default app;
