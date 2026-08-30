import { Sequelize } from 'sequelize-typescript';
import dotenv from 'dotenv';
import { Vendor } from '../models/vendor.model';
import { Menu } from '../models/menu.model';
import { LineItem } from '../models/lineItem.model';
import { Event } from '../models/event.model';
import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { QrLinkMapping } from '../models/qrLinkMapping.model';
import { QrTemplate } from '../models/qrTemplate.model';
import { VendorPricingConfig } from '../models/vendorPricingConfig.model';
import { AnalyticsEvent } from '../models/analyticsEvent.model';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL
  || (process.env.LOCAL_DEMO_MODE === 'true' ? 'postgres://demo:demo@127.0.0.1:5432/peshkash_demo' : undefined);

if (!databaseUrl) throw new Error('DATABASE_URL is required (or run npm run dev:studio for the database-free QR Studio demo)');

export const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
  dialectOptions: {
    family: 4, // Ensure IPv4 preference
  },
  models: [
    Vendor,
    Menu,
    LineItem,
    Event,
    EventMenuMapping,
    QrLinkMapping,
    QrTemplate,
    VendorPricingConfig,
    AnalyticsEvent,
  ],
  logging: false,
});
