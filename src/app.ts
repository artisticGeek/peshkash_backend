import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import router from './routes/router';
import onboardingRouter from './routes/onboardingRouter';
import adminRouter from './routes/adminRouter';
import analyticsRouter from './routes/analyticsRouter';
import { sequelize } from './config/sequelize';
import { startDrainLoop } from './workers/analyticsWorker';
import { AnalyticsQueue } from './services/AnalyticsQueue';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

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
    ).catch(() => {/* table may not exist yet on first deploy */});
    startDrainLoop();
  })
  .catch((err) => {
    console.error('❌ Failed to connect to the database:', err);
  });

export default app;
