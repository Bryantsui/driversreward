import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici';
import { logger } from '../config/logger.js';
import { type ProxyConfig, proxyToUrl } from './proxy-manager.js';

const FEED_PATH = 'https://drivers.uber.com/earnings/api/getWebActivityFeed?localeCode=en';
const TRIP_PATH = 'https://drivers.uber.com/earnings/api/getTrip?localeCode=en';
const WEEKS_TO_FETCH = 12;

export interface UberSessionData {
  cookies: string;
  csrfToken: string;
  userAgent: string;
}

export interface ScrapeResult {
  activityFeeds: string[];
  tripResponses: Array<{ rawBody: string; tripUuid: string }>;
  tripsFound: number;
  tripsFetched: number;
  errors: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return sleep(ms);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildHeaders(session: UberSessionData): Record<string, string> {
  return {
    'accept': 'application/json',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/json',
    'x-csrf-token': session.csrfToken,
    'cookie': session.cookies,
    'user-agent': session.userAgent,
    'referer': 'https://drivers.uber.com/earnings',
    'origin': 'https://drivers.uber.com',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
}

async function fetchWithProxy(
  url: string,
  options: UndiciRequestInit,
  proxy: ProxyConfig | null,
): Promise<import('undici').Response> {
  if (proxy) {
    const proxyUrl = proxyToUrl(proxy);
    const dispatcher = new ProxyAgent(proxyUrl);
    return undiciFetch(url, { ...options, dispatcher });
  }

  return undiciFetch(url, options);
}

async function fetchActivityFeedWeek(
  session: UberSessionData,
  proxy: ProxyConfig | null,
  startDate: Date,
  endDate: Date,
): Promise<{ trips: Array<{ uuid: string }>; rawResponses: string[] }> {
  const headers = buildHeaders(session);
  const trips: Array<{ uuid: string }> = [];
  const rawResponses: string[] = [];
  let hasMore = true;
  let paginationOption: any = {};
  let pageNum = 0;

  while (hasMore) {
    pageNum++;
    const body = JSON.stringify({
      startDateIso: fmtDate(startDate),
      endDateIso: fmtDate(endDate),
      paginationOption: pageNum === 1 ? {} : paginationOption,
    });

    try {
      const res = await fetchWithProxy(FEED_PATH, {
        method: 'POST',
        headers,
        body,
      }, proxy);

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error(`SESSION_EXPIRED: ${res.status}`);
        }
        logger.warn({ status: res.status, week: fmtDate(startDate) }, 'Activity feed request failed');
        break;
      }

      const text = await res.text();
      rawResponses.push(text);

      const parsed = JSON.parse(text);
      if (parsed.status !== 'success') break;

      const activities = parsed.data?.activities || [];
      const feedTrips = activities.filter((a: any) => a.uuid);
      trips.push(...feedTrips);

      if (parsed.data?.paginationOption?.hasMore) {
        paginationOption = parsed.data.paginationOption;
        await randomDelay(800, 2000);
      } else {
        hasMore = false;
      }
    } catch (e: any) {
      if (e.message?.startsWith('SESSION_EXPIRED')) throw e;
      logger.error({ err: e, week: fmtDate(startDate) }, 'Activity feed fetch error');
      hasMore = false;
    }
  }

  return { trips, rawResponses };
}

/**
 * Scrape a driver's Uber trip data using stored session credentials.
 * Mirrors the client-side interceptor-main.js logic but runs server-side through a proxy.
 */
export async function scrapeDriverTrips(
  session: UberSessionData,
  proxy: ProxyConfig | null,
): Promise<ScrapeResult> {
  const result: ScrapeResult = {
    activityFeeds: [],
    tripResponses: [],
    tripsFound: 0,
    tripsFetched: 0,
    errors: [],
  };

  const headers = buildHeaders(session);
  const allTrips: Array<{ uuid: string }> = [];

  // Phase 1: Fetch activity feed for the last N weeks
  for (let w = 0; w < WEEKS_TO_FETCH; w++) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - w * 7);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);
    const endPlusOne = new Date(endDate);
    endPlusOne.setDate(endPlusOne.getDate() + 1);

    logger.debug({ week: w + 1, start: fmtDate(startDate), end: fmtDate(endPlusOne) }, 'Fetching activity feed week');

    try {
      const { trips, rawResponses } = await fetchActivityFeedWeek(session, proxy, startDate, endPlusOne);
      allTrips.push(...trips);
      result.activityFeeds.push(...rawResponses);
    } catch (e: any) {
      if (e.message?.startsWith('SESSION_EXPIRED')) {
        result.errors.push('SESSION_EXPIRED');
        return result;
      }
      result.errors.push(`Week ${w + 1} error: ${e.message}`);
    }

    // Anti-detection: random delay between weeks (2-6 seconds)
    await randomDelay(2000, 6000);

    // Occasional longer pause every 3-4 weeks
    if (w > 0 && w % 3 === 0) {
      await randomDelay(10000, 20000);
    }
  }

  // Deduplicate by UUID
  const seen = new Set<string>();
  const uniqueTrips = allTrips.filter((t) => {
    if (seen.has(t.uuid)) return false;
    seen.add(t.uuid);
    return true;
  });

  result.tripsFound = uniqueTrips.length;
  logger.info({ tripsFound: uniqueTrips.length }, 'Activity feed scan complete, fetching trip details');

  // Phase 2: Fetch individual trip details
  for (const trip of uniqueTrips) {
    await randomDelay(500, 3000);

    try {
      const res = await fetchWithProxy(TRIP_PATH, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripUUID: trip.uuid }),
      }, proxy);

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          result.errors.push('SESSION_EXPIRED');
          return result;
        }
        result.errors.push(`Trip ${trip.uuid}: HTTP ${res.status}`);
        continue;
      }

      const text = await res.text();
      result.tripResponses.push({ rawBody: text, tripUuid: trip.uuid });
      result.tripsFetched++;
    } catch (e: any) {
      if (e.message?.startsWith('SESSION_EXPIRED')) {
        result.errors.push('SESSION_EXPIRED');
        return result;
      }
      result.errors.push(`Trip ${trip.uuid}: ${e.message}`);
    }

    // Occasional longer pause
    if (result.tripsFetched > 0 && result.tripsFetched % 10 === 0) {
      await randomDelay(5000, 15000);
    }
  }

  logger.info(
    { tripsFound: result.tripsFound, tripsFetched: result.tripsFetched, errors: result.errors.length },
    'Scrape complete',
  );

  return result;
}
