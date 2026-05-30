// dotenv/config must be loaded via -r flag in the start command
// so process.env is populated before ANY module-level code runs.
// See package.json scripts.
import app from './app';

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
