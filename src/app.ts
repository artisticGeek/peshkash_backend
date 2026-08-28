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

  // vendor — auth and contact-page columns
  await sequelize.query(`ALTER TABLE vendor ADD COLUMN IF NOT EXISTS phone         VARCHAR(20) UNIQUE`).catch(() => {});
  await sequelize.query(`ALTER TABLE vendor ADD COLUMN IF NOT EXISTS require_login BOOLEAN NOT NULL DEFAULT false`).catch(() => {});

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
