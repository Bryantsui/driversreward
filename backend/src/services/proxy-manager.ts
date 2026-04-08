import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { Region } from '@prisma/client';

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'https';
}

const REGION_PROXY_ENV: Record<Region, string> = {
  HK: 'PROXY_HK_URL',
  BR: 'PROXY_BR_URL',
};

/**
 * Parse a proxy URL like http://user:pass@gate.proxy.com:7777
 * into a structured ProxyConfig.
 */
function parseProxyUrl(url: string): ProxyConfig {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || (parsed.protocol === 'https:' ? 443 : 80),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    protocol: parsed.protocol === 'https:' ? 'https' : 'http',
  };
}

/**
 * Get a proxy configuration for the given region.
 * Supports sticky sessions via an optional sessionId parameter
 * (most residential proxy providers accept this as a username suffix).
 */
export function getProxy(region: Region, sessionId?: string): ProxyConfig | null {
  const envKey = REGION_PROXY_ENV[region];
  const proxyUrl = (env as any)[envKey];

  if (!proxyUrl) {
    logger.warn({ region, envKey }, 'No proxy configured for region');
    return null;
  }

  const config = parseProxyUrl(proxyUrl);

  // Sticky session: append session ID to username for most proxy providers
  // e.g., Bright Data: user-session-abc123, SmartProxy: user-sessid-abc123
  if (sessionId && config.username) {
    config.username = `${config.username}-session-${sessionId}`;
  }

  return config;
}

/**
 * Build a proxy URL string from a ProxyConfig (for use with http agents).
 */
export function proxyToUrl(config: ProxyConfig): string {
  const auth = config.username
    ? `${encodeURIComponent(config.username)}${config.password ? ':' + encodeURIComponent(config.password) : ''}@`
    : '';
  return `${config.protocol}://${auth}${config.host}:${config.port}`;
}

/**
 * Check if proxy is configured for a given region.
 */
export function isProxyConfigured(region: Region): boolean {
  const envKey = REGION_PROXY_ENV[region];
  return !!(env as any)[envKey];
}
