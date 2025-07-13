import { Sequelize } from 'sequelize-typescript';
import dotenv from 'dotenv';
import { Vendor } from '../models/vendor.model';
import { Menu } from '../models/menu.model';
import { LineItem } from '../models/lineItem.model';
import { Event } from '../models/event.model';
import { EventMenuMapping } from '../models/eventMenuMapping.model';
import { QrLinkMapping } from '../models/qrLinkMapping.model';

dotenv.config();

export const sequelize = new Sequelize({
  dialect: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
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
