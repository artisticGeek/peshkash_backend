import { Sequelize } from 'sequelize-typescript';
import dotenv from 'dotenv';
import { Vendor } from '../models/vendor.model';
import { Menu } from '../models/menu.model';
import { LineItem } from '../models/lineItem.model';
import { Event } from '../models/event.model';
import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { QrLinkMapping } from '../models/qrLinkMapping.model';

dotenv.config();

export const sequelize = new Sequelize(process.env.DATABASE_URL as string, {
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
    QrLinkMapping
  ],
  logging: false,
});
