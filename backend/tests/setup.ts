import { beforeAll, afterAll, beforeEach } from 'vitest';

// Set test environment variables before any imports
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://rewards:rewards_secret@localhost:5432/driversreward_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_minimum_32_characters_long_enough';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_minimum_32_characters_long_enough';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.ALLOWED_ORIGINS = 'http://localhost:3001';
process.env.LOG_LEVEL = 'error';
