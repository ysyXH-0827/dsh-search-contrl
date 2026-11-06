/**
 * Feed health + circuit breaker: stop one slow feed from setting the floor
 * for the whole collection.
 *
 * Measured 2026-11-07 (14 feeds, concurrency 5): 12 feeds answered in
 * under 3.4s, but leiphone and insideevs each burned the full 10s timeout
 * and 36kr failed outright — so a cold run cost 10s for 12 feeds' worth of
 * news. The fix is not a bigger timeout: it is a shorter one, plus a memory
 * of which feeds keep failing.
 *
 * Rules (all pure except the file helpers at the bottom):
 * - a feed gets FEED_TIMEOUT_MS to answer; slower than that is a failure.
 * - a feed that failed BREAKER_TRIP_FAILS runs in a row is tripped: the
 *   collector skips the network fetch and falls back to its stale cache
 *   (24h) instead of paying the timeout again.
 * - a trip cools down after BREAKER_COOLDOWN_MS: the next run retries the
 *   feed, so a recovered feed comes back on its own. A success resets the
 *   failure count to zero.
 * - feeds marked tier 'extra' are supplementary sources: a 1-day run reads
 *   them from cache only and never pays a live fetch for them; longer
 *   windows still fetch them live (still under the breaker).
 */

import fs from 'node:fs';

/** Single-feed timeout: healthy feeds answer in <3.4s; 5s leaves headroom. */
export const FEED_TIMEOUT_MS = 5000;

/** Consecutive failures that trip the breaker. */
export const BREAKER_TRIP_FAILS = 2;

/** A tripped feed is retried after this long (one daily cycle). */
export const BREAKER_COOLDOWN_MS = 24 * 3600_000;

/** How long a feed cache entry counts as fresh (Bing keeps its own 10 min). */
export const FEED_CACHE_TTL_MS = 2 * 3600_000;

/** How old a cache entry may be to serve as a stale fallback. */
export const FEED_STALE_MS = 24 * 3600_000;

/** A feed with tier 'extra' is a supplementary source, not a core one. */
export function isExtraTier(feed) {
  return feed != null && feed.tier === 'extra';
}

/** @returns {Record<string, { fails: number, lastFail: number | null, lastOk: number | null, lastMs: number | null }>} */
export function createHealth() {
  return {};
}

/**
 * True when the feed tripped the breaker and is still inside its cooldown:
 * skip the live fetch this run and use the stale cache instead.
 */
export function isTripped(health, feedId, now = Date.now()) {
  const entry = health != null ? health[feedId] : undefined;
  if (entry == null || typeof entry.fails !== 'number' || entry.fails < BREAKER_TRIP_FAILS) return false;
  if (typeof entry.lastFail !== 'number') return false;
  return now - entry.lastFail < BREAKER_COOLDOWN_MS;
}

export function recordFeedSuccess(health, feedId, ms, now = Date.now()) {
  const prev = health[feedId] ?? {};
  health[feedId] = {
    fails: 0,
    lastOk: now,
    lastMs: typeof ms === 'number' ? ms : null,
    lastFail: typeof prev.lastFail === 'number' ? prev.lastFail : null,
  };
  return health;
}

export function recordFeedFailure(health, feedId, now = Date.now()) {
  const prev = health[feedId] ?? {};
  health[feedId] = {
    fails: (typeof prev.fails === 'number' ? prev.fails : 0) + 1,
    lastFail: now,
    lastOk: typeof prev.lastOk === 'number' ? prev.lastOk : null,
    lastMs: typeof prev.lastMs === 'number' ? prev.lastMs : null,
  };
  return health;
}

/** Read the health file; anything unreadable or malformed means "no history". */
export function loadHealthFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const health = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry != null && typeof entry === 'object' && typeof entry.fails === 'number') health[id] = entry;
    }
    return health;
  } catch {
    return {};
  }
}

/** Persist the health file. A failure here must never break the collection. */
export function saveHealthFile(file, health) {
  try {
    fs.mkdirSync(file.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(health, null, 1));
  } catch { /* health is advisory; a lost write only loses the memory */ }
}
