/**
 * Starts the HTTP layer without PostgreSQL for local QR Studio development.
 * Production boot remains strict and always runs migrations before listening.
 */
process.env.LOCAL_DEMO_MODE = 'true';
process.env.PORT = process.env.PORT || '4000';

require('./server');
