// dotenv/config must be loaded via -r flag in the start command
// so process.env is populated before ANY module-level code runs.
// See package.json scripts.
import app, { runMigrations } from './app';
import { startDrainLoop } from './workers/analyticsWorker';

const PORT = process.env.PORT || 4000;

// ── Boot sequence ─────────────────────────────────────────────────────────────
// Run migrations to completion BEFORE accepting traffic so that Render's
// health-check probe and the very first real requests never hit missing columns.
runMigrations()
  .then(() => {
    startDrainLoop();
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  });
