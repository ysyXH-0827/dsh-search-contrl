#!/usr/bin/env node
/**
 * Offline checks for lib/archive-store.js (daily-collect --from-archive reads
 * the snapshots that --archive writes).
 *
 * The store is pure file reading, so the suite builds its own snapshots in a
 * temp dir (node:fs mkdtemp) and never touches the real reports/_data/archive.
 * It pins the three load rules that a silent regression would only show up as
 * a re-run quietly losing a day: allItems wins over uniqueItems, a snapshot is
 * usable only when its topic matches, and unreadable snapshots are skipped
 * with a reason instead of throwing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archiveTopicMatches, loadArchiveDay, loadArchiveWindow } from '../lib/archive-store.js';

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-store-'));
try {
  const snap = (day, data) => fs.writeFileSync(path.join(tmp, `${day}.json`), JSON.stringify(data));
  const tech = { label: '科技', preset: 'tech', keywords: ['科技'] };
  const item = (n, at = '2026-11-06 10:00') => ({ title: `标题 ${n}`, url: `https://example.com/${n}`, desc: '', at, source: 'ithome' });

  check('snapshot load happy path returns day, items and topic', () => {
    snap('2026-11-06', { generatedAt: '2026-11-07T00:00:00Z', targetDate: '2026-11-06', topic: tech, uniqueItems: [item(1)], allItems: [item(1), item(2, '2026-11-05 22:00')] });
    const got = loadArchiveDay(tmp, '2026-11-06');
    assert.equal(got.day, '2026-11-06');
    assert.equal(got.items.length, 2);
    assert.equal(got.topic.preset, 'tech');
  });

  check('missing dir and missing file both return null', () => {
    assert.equal(loadArchiveDay(path.join(tmp, 'no-such-dir'), '2026-11-06'), null);
    assert.equal(loadArchiveDay(tmp, '2026-11-07'), null);
  });

  check('unparsable JSON returns null instead of throwing', () => {
    fs.writeFileSync(path.join(tmp, '2026-11-08.json'), '{not json');
    assert.equal(loadArchiveDay(tmp, '2026-11-08'), null);
  });

  check('allItems wins over uniqueItems; uniqueItems is the fallback', () => {
    snap('2026-11-09', { topic: tech, uniqueItems: [item(1)], allItems: [item(1), item(2), item(3)] });
    assert.equal(loadArchiveDay(tmp, '2026-11-09').items.length, 3);
    snap('2026-11-10', { topic: tech, uniqueItems: [item(1), item(2)] });
    assert.equal(loadArchiveDay(tmp, '2026-11-10').items.length, 2);
    snap('2026-11-11', { topic: tech, boards: { 国内AI: [item(1)] }, others: [item(2)] });
    assert.equal(loadArchiveDay(tmp, '2026-11-11').items.length, 2);
    snap('2026-11-12', { topic: tech, allItems: [] });
    assert.equal(loadArchiveDay(tmp, '2026-11-12'), null);
    snap('2026-11-13', { topic: tech });
    assert.equal(loadArchiveDay(tmp, '2026-11-13'), null);
  });

  check('topic match: same preset passes, other preset fails', () => {
    assert.equal(archiveTopicMatches({ label: '科技', preset: 'tech' }, { label: '科技', preset: 'tech' }), true);
    assert.equal(archiveTopicMatches({ label: '财经', preset: 'finance' }, { label: '科技', preset: 'tech' }), false);
    assert.equal(archiveTopicMatches({ label: '科技', preset: 'tech' }, { label: '科技', preset: null }), false);
    assert.equal(archiveTopicMatches({ label: '科技' }, { label: '科技', preset: 'tech' }), false);
  });

  check('topic match without presets falls back to the label', () => {
    assert.equal(archiveTopicMatches({ label: '光伏' }, { label: '光伏', preset: null }), true);
    assert.equal(archiveTopicMatches({ label: '光伏' }, { label: '储能', preset: null }), false);
    assert.equal(archiveTopicMatches(null, { label: '科技', preset: 'tech' }), false);
    assert.equal(archiveTopicMatches({ label: '科技', preset: 'tech' }, null), false);
    assert.equal(archiveTopicMatches(undefined, { label: '科技', preset: 'tech' }), false);
  });

  check('window load covers matching days and skips the rest with reasons', () => {
    snap('2026-11-14', { topic: tech, allItems: [item(1), item(2)] });
    snap('2026-11-15', { topic: { label: '财经', preset: 'finance' }, allItems: [item(3)] });
    const win = loadArchiveWindow(tmp, ['2026-11-14', '2026-11-15', '2026-11-16'], { label: '科技', preset: 'tech' });
    assert.deepEqual(win.covered, ['2026-11-14']);
    assert.equal(win.items.length, 2);
    assert.deepEqual(win.skipped, [
      { day: '2026-11-15', reason: 'topic-mismatch' },
      { day: '2026-11-16', reason: 'missing' },
    ]);
  });

  check('window load dedups URLs shared by overlapping snapshots', () => {
    snap('2026-11-17', { topic: tech, allItems: [item(1), item(2)] });
    snap('2026-11-18', { topic: tech, allItems: [item(2), item(3)] });
    const win = loadArchiveWindow(tmp, ['2026-11-17', '2026-11-18'], { label: '科技', preset: 'tech' });
    assert.deepEqual(win.covered, ['2026-11-17', '2026-11-18']);
    assert.deepEqual(win.items.map(i => i.url), ['https://example.com/1', 'https://example.com/2', 'https://example.com/3']);
    assert.deepEqual(win.skipped, []);
  });

  check('a snapshot without a topic field is skipped as topic-mismatch, never mixed in', () => {
    snap('2026-11-19', { allItems: [item(9)] });
    const win = loadArchiveWindow(tmp, ['2026-11-19'], { label: '科技', preset: 'tech' });
    assert.deepEqual(win.covered, []);
    assert.equal(win.items.length, 0);
    assert.deepEqual(win.skipped, [{ day: '2026-11-19', reason: 'topic-mismatch' }]);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (failures.length > 0) {
  console.log(failures.length + ' failed, ' + passed + ' passed');
  for (const item of failures) console.log('  ' + item.name + '\n    ' + (item.error && item.error.stack));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
