// dotenv/config must be loaded via -r flag in the start command
// so process.env is populated before ANY module-level code runs.
// See package.json scripts.
import app, { runMigrations } from './app';
import { startDrainLoop } from './workers/analyticsWorker';
import { QrLinkMappingService } from './services/QrLinkMappingService';

const PORT = process.env.PORT || 4000;
const localDemoMode = process.env.LOCAL_DEMO_MODE === 'true';

// ── Boot sequence ─────────────────────────────────────────────────────────────
// Run migrations to completion BEFORE accepting traffic so that Render's
// health-check probe and the very first real requests never hit missing columns.
const prepare = localDemoMode
  ? Promise.resolve().then(() => console.log('◌ Local demo mode: database migrations and workers are paused'))
  : runMigrations().then(async () => {
      await QrLinkMappingService.backfillVendorIds();
      startDrainLoop();
    });

prepare
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      if (localDemoMode) console.log('◌ QR Studio uses browser-local draft storage in this mode');
    });
  })
  .catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
