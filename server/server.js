const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const { globalErrorHandler, AppError } = require('./errors');
const apiV1Router = require('./routes/api_v1');

const app = express();

// Enable Cross-Origin Resource Sharing
app.use(cors());

// HTTP request logging (Morgan logger)
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Parse incoming request payloads
app.use(express.json());

// Serve sleek client static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API version 1 endpoints
app.use('/api/v1', apiV1Router);

// Catch-all 404 handler for unmatched routes
app.all('*', (req, res, next) => {
  next(new AppError(`Cannot find path [${req.method}] ${req.originalUrl} on this server.`, 404));
});

// Attach universal error handler middleware
app.use(globalErrorHandler);

// Start HTTP instance
const server = app.listen(config.port, () => {
  console.log(`================================================================`);
  console.log(` AURA Marketplace Core API Running in [${config.nodeEnv}] Mode`);
  console.log(` Port: ${config.port} | API Version: /api/${config.apiVersion}`);
  console.log(` Local Sandbox URL: http://localhost:${config.port}`);
  console.log(`================================================================`);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('[CRITICAL] Unhandled Rejection detected:', err.message, err.stack);
  server.close(() => {
    process.exit(1);
  });
});

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception detected:', err.message, err.stack);
  server.close(() => {
    process.exit(1);
  });
});
