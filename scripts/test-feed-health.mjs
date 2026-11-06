#!/usr/bin/env node
/**
 * Offline checks for lib/feed-health.js: the feed circuit breaker.
 *
 * Pure functions plus a throwaway health file in the OS temp dir — no
 * network, no repo cache touched. Pins the contract daily-collect relies
 * on: a feed that keeps failing is skipped instead of burning the timeout
 * again, and it comes back on its own after the cooldown.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BREAKER_COOLDOWN_MS,
  BREAKER_TRIP_FAILS,
  FEED_CACHE_TTL_MS,
  FEED_TIMEOUT_MS,
  createHealth,
  isExtraTier,
  isTripped,
  loadHealthFile,
  recordFeedFailure,
  recordFeedSuccess,
  saveHealthFile,
} from '../lib/feed-health.js';
import { listTopicPresets } from '../lib/topic-presets.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('ok   ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.log('FAIL ' + name + ': ' + (error && error.message));
  }
}

check('constants match the measured budget', () => {
  assert.equal(FEED_TIMEOUT_MS, 5000);
  assert.equal(BREAKER_TRIP_FAILS, 2);
  assert.equal(BREAKER_COOLDOWN_MS, 24 * 3600_000);
  assert.equal(FEED_CACHE_TTL_MS, 2 * 3600_000);
});

check('a fresh feed is never tripped', () => {
  const health = createHealth();
  assert.equal(isTripped(health, 'ithome'), false);
  assert.equal(isTripped(health, 'ithome', Date.now()), false);
  assert.equal(isTripped(null, 'ithome'), false);
  assert.equal(isTripped(undefined, 'ithome'), false);
});

check('one failure does not trip, two in a row do', () => {
  const health = createHealth();
  const now = Date.now();
  recordFeedFailure(health, 'leiphone', now);
  assert.equal(health.leiphone.fails, 1);
  assert.equal(isTripped(health, 'leiphone', now), false);
  recordFeedFailure(health, 'leiphone', now + 1000);
  assert.equal(health.leiphone.fails, 2);
  assert.equal(isTripped(health, 'leiphone', now + 1000), true);
  assert.equal(isTripped(health, 'ithome', now + 1000), false);
});

check('a success resets the failure count', () => {
  const health = createHealth();
  const now = Date.now();
  recordFeedFailure(health, 'leiphone', now);
  recordFeedFailure(health, 'leiphone', now + 1000);
  assert.equal(isTripped(health, 'leiphone', now + 1000), true);
  recordFeedSuccess(health, 'leiphone', 1200, now + 2000);
  assert.equal(health.leiphone.fails, 0);
  assert.equal(health.leiphone.lastMs, 1200);
  assert.equal(isTripped(health, 'leiphone', now + 2000), false);
});

check('a tripped feed is retried after the cooldown', () => {
  const health = createHealth();
  const now = Date.now();
  recordFeedFailure(health, 'insideevs', now);
  recordFeedFailure(health, 'insideevs', now + 1000);
  // The cooldown runs from the last failure, not the first one.
  const trippedAt = now + 1000;
  assert.equal(isTripped(health, 'insideevs', trippedAt + BREAKER_COOLDOWN_MS - 1), true);
  assert.equal(isTripped(health, 'insideevs', trippedAt + BREAKER_COOLDOWN_MS + 1), false);
});

check('only leiphone and insideevs are extra-tier feeds', () => {
  const feeds = listTopicPresets().flatMap(p => p.feeds);
  assert.deepEqual(feeds.filter(isExtraTier).map(f => f.id).sort(), ['insideevs', 'leiphone']);
  assert.equal(isExtraTier({ id: 'ithome' }), false);
  assert.equal(isExtraTier({ id: 'x', tier: 'core' }), false);
  assert.equal(isExtraTier(null), false);
  assert.equal(isExtraTier(undefined), false);
});

check('the health file round-trips and forgives garbage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-health-'));
  const file = path.join(dir, '_health.json');
  assert.deepEqual(loadHealthFile(file), {});
  fs.writeFileSync(file, 'not json{');
  assert.deepEqual(loadHealthFile(file), {});
  fs.writeFileSync(file, JSON.stringify({ leiphone: { fails: 2, lastFail: 123 } }));
  assert.deepEqual(loadHealthFile(file), { leiphone: { fails: 2, lastFail: 123 } });
  const health = createHealth();
  recordFeedFailure(health, 'ithome', 1000);
  saveHealthFile(file, health);
  assert.equal(loadHealthFile(file).ithome.fails, 1);
  saveHealthFile(path.join(dir, 'missing', 'deep', '_health.json'), health);
  assert.equal(loadHealthFile(path.join(dir, 'missing', 'deep', '_health.json')).ithome.fails, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log('');
if (failures.length > 0) {
  console.log(failures.length + ' failed, ' + passed + ' passed');
  for (const item of failures) console.log('  ' + item.name + '\n    ' + (item.error && item.error.stack));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
