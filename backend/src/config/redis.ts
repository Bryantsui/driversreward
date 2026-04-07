import IORedis from 'ioredis';
import { env } from './env.js';

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});
