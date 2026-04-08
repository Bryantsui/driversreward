import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ADMIN_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-fA-F]+$/, 'Must be a 64-character hex string'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  ALLOWED_ORIGINS: z.string().transform((s) => s.split(',')),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  GIFT_CARD_API_URL: z.string().url().optional(),
  GIFT_CARD_API_KEY: z.string().optional(),
  PROXY_HK_URL: z.string().optional(),
  PROXY_BR_URL: z.string().optional(),
  SCRAPE_CONCURRENCY: z.coerce.number().default(2),
  SCRAPE_ENABLED: z.string().default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
