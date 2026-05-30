import express from 'express';
import cors from 'cors';
import router from './routes/router';
import onboardingRouter from './routes/onboardingRouter';
import adminRouter from './routes/adminRouter';
import analyticsRouter from './routes/analyticsRouter';
import authRouter from './routes/authRouter';
import { authMiddleware } from './middleware/authMiddleware';
import { sequelize } from './config/sequelize';
import { startDrainLoop } from './workers/analyticsWorker';
import { AnalyticsQueue } from './services/AnalyticsQueue';

const app = express();

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

// Connect to DB then run lightweight column migrations and start drain loop
sequelize.authenticate()
  .then(async () => {
    console.log('✅ Connected to PostgreSQL via Sequelize');
    // Idempotent column additions — safe to run on every boot
    await sequelize.query(
      `ALTER TABLE analytics_event ADD COLUMN IF NOT EXISTS page_url TEXT`
    ).catch(() => {});
    // Auth columns on vendor table
    await sequelize.query(
      `ALTER TABLE vendor ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE`
    ).catch(() => {});
    await sequelize.query(
      `ALTER TABLE vendor ADD COLUMN IF NOT EXISTS require_login BOOLEAN NOT NULL DEFAULT false`
    ).catch(() => {});
    // Admin phone table — source of truth for who is an admin
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
    startDrainLoop();
  })
  .catch((err) => {
    console.error('❌ Failed to connect to the database:', err);
  });

export default app;
