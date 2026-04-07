import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './api/middleware/error-handler.js';
import { healthRouter } from './api/routes/health.js';
import { authRouter } from './api/routes/auth.js';
import { ingestionRouter } from './api/routes/ingestion.js';
import { rewardsRouter } from './api/routes/rewards.js';
import { driverRouter } from './api/routes/driver.js';
import { adminRouter } from './api/routes/admin.js';
import { sessionRouter } from './api/routes/session.js';

const app = express();

// Security headers — allow Tailwind CDN for the admin dashboard
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }),
);

// CORS — supports exact origins and chrome-extension://* wildcard
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = env.ALLOWED_ORIGINS.some((o) =>
        o === 'chrome-extension://*'
          ? origin.startsWith('chrome-extension://')
          : o === origin,
      );
      if (!allowed && env.NODE_ENV === 'development') {
        callback(null, true);
      } else {
        callback(allowed ? null : new Error('CORS not allowed'), allowed);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  }),
);

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
  }),
);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later', code: 'RATE_LIMITED' },
});
app.use('/api', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts', code: 'AUTH_RATE_LIMITED' },
});

// Routes
app.use('/', healthRouter);
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/ingest', ingestionRouter);
app.use('/api/rewards', rewardsRouter);
app.use('/api/driver', driverRouter);
app.use('/api/admin', adminRouter);
app.use('/api/session', sessionRouter);

// Admin dashboard — serves the single-page HTML app
// In dev: src/admin-ui/dashboard.html, in built output: dist/admin-ui/dashboard.html
const dashboardPath = path.resolve(process.cwd(), 'src', 'admin-ui', 'dashboard.html');
app.get('/admin', (_req, res) => { res.sendFile(dashboardPath); });
app.get('/admin/*', (_req, res) => { res.sendFile(dashboardPath); });

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
});

// Global error handler
app.use(errorHandler);

// Only bind the port when running directly (not during tests via supertest)
const server = env.NODE_ENV !== 'test'
  ? app.listen(env.PORT, () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
    })
  : null;

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');
  server?.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
