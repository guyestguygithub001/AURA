const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Default to development if not specified
const envMode = process.env.NODE_ENV || 'development';
const envFile = envMode === 'production' ? '.env.production' : '.env.development';
const envPath = path.resolve(__dirname, '..', envFile);

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log(`[Config] Loaded environment configurations from ${envFile}`);
} else {
  console.warn(`[Config] Warning: ${envFile} not found at ${envPath}. Falling back to system environment variables.`);
}

module.exports = {
  port: process.env.PORT || 8082,
  nodeEnv: envMode,
  apiVersion: process.env.API_VERSION || 'v1',
  dbPath: path.resolve(__dirname, '..', process.env.DB_PATH || './data.json'),
  logLevel: process.env.LOG_LEVEL || 'debug',
  escrowTimeoutMs: parseInt(process.env.ESCROW_TIMEOUT_MS || '600000', 10)
};
