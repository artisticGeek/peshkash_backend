import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import router from './routes/router';
import onboardingRouter from './routes/onboardingRouter';
import adminRouter from './routes/adminRouter';
import { sequelize } from './config/sequelize';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', router);
app.use('/api/onboard/:vendorName', onboardingRouter);
app.use('/api/admin', adminRouter);

app.get('/', (_req, res) => {
  res.send('✅ Peshkash backend is alive!');
});

app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Connect to DB
sequelize.authenticate()
  .then(() => {
    console.log('✅ Connected to PostgreSQL via Sequelize');
  })
  .catch((err) => {
    console.error('❌ Failed to connect to the database:', err);
  });

export default app;
