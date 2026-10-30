#!/usr/bin/env node
/**
 * Offline checks for the two modules the 3.0 settings schema is built on:
 * lib/report-title.js (title templates) and lib/topic-presets.js (topic -> sources).
 *
 * Both are pure functions with no I/O, so this suite runs without a Host and without
 * the network. It also pins the settings round-trip for "reportTitle" and the topic
 * "preset" pin, because a silent drop there would only show up as a wrong report
 * headline much later.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_REPORT_TITLE,
  MAX_TITLE_LENGTH,
  TITLE_TOKENS,
  describeTemplate,
  kindForDays,
  normalizeTitleTemplate,
  renderTitle,
} from '../lib/report-title.js';
import {
  boardsForPreset,
  feedsForPreset,
  listTopicPresets,
  matchPreset,
  presetCatalog,
  presetForTopic,
} from '../lib/topic-presets.js';
import { emptySettings, normalizeSettings } from '../lib/settings-store.js';

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

check('report kind follows the window length', () => {
  assert.equal(kindForDays(1), '日报');
  assert.equal(kindForDays(0), '日报');
  assert.equal(kindForDays(undefined), '日报');
  assert.equal(kindForDays(Number.NaN), '日报');
  assert.equal(kindForDays(3), '周报');
  assert.equal(kindForDays(7), '周报');
  assert.equal(kindForDays(8), '月报');
  assert.equal(kindForDays(30), '月报');
});

check('a blank template falls back to the default instead of a bare date', () => {
  assert.equal(normalizeTitleTemplate(''), DEFAULT_REPORT_TITLE);
  assert.equal(normalizeTitleTemplate('   '), DEFAULT_REPORT_TITLE);
  assert.equal(normalizeTitleTemplate(null), DEFAULT_REPORT_TITLE);
  assert.equal(normalizeTitleTemplate(42), DEFAULT_REPORT_TITLE);
  assert.equal(normalizeTitleTemplate('  {主题}   {日期} '), '{主题} {日期}');
  assert.equal(MAX_TITLE_LENGTH, 120);
  assert.ok(normalizeTitleTemplate('x'.repeat(500)).length <= MAX_TITLE_LENGTH);
});

check('the default template renders topic + kind + date', () => {
  assert.equal(
    renderTitle(DEFAULT_REPORT_TITLE, { topic: 'AI', date: '2026-10-30', days: 1 }),
    'AI日报｜2026-10-30',
  );
  assert.equal(renderTitle(DEFAULT_REPORT_TITLE, { date: '2026-10-30', days: 7 }), '周报｜2026-10-30');
});

check('an empty topic leaves no dangling separator', () => {
  assert.equal(
    renderTitle('{主题}｜{类型}｜{日期}', { topic: '', date: '2026-10-30', days: 7 }),
    '周报｜2026-10-30',
  );
  assert.equal(renderTitle('{主题} 周报 {日期}', { topic: '', date: '2026-10-30' }), '周报 2026-10-30');
  assert.equal(renderTitle('{主题}', { topic: '', date: '2026-10-31' }), '2026-10-31');
  assert.equal(renderTitle('{主题}', { topic: '', date: '', days: 3 }), '周报');
});

check('describeTemplate reports the placeholders actually used', () => {
  assert.deepEqual(describeTemplate('{日期}｜{主题}'), ['{主题}', '{日期}']);
  assert.deepEqual(describeTemplate('财报'), []);
  assert.deepEqual(describeTemplate(''), ['{主题}', '{类型}', '{日期}']);
  assert.equal(TITLE_TOKENS.length, 3);
});

check('every preset label resolves back to that preset', () => {
  const presets = listTopicPresets();
  assert.equal(presets.length, 10);
  assert.equal(new Set(presets.map(item => item.id)).size, 10, 'preset ids must be unique');
  assert.equal(new Set(presets.map(item => item.label)).size, 10, 'preset labels must be unique');
  for (const preset of presets) {
    assert.equal(presetForTopic({ label: preset.label }).id, preset.id);
    assert.equal(matchPreset(preset.label).id, preset.id);
    assert.ok(preset.aliases instanceof RegExp, preset.id + ' needs an aliases RegExp');
    assert.ok(Array.isArray(preset.keywords) && preset.keywords.length > 0, preset.id + ' needs keywords');
    assert.ok(Array.isArray(preset.domains), preset.id + ' needs a domains array');
    assert.ok(Array.isArray(preset.queries), preset.id + ' needs query seeds');
    for (const feed of preset.feeds) {
      assert.ok(/^https?:\/\//.test(feed.url), preset.id + ' feed ' + feed.id + ' needs an http url');
      assert.equal(typeof feed.lang, 'string');
      assert.equal(typeof feed.note, 'string');
    }
    for (const [board, rules] of Object.entries(preset.boards || {})) {
      assert.ok(Array.isArray(rules) && rules.length > 0, preset.id + '/' + board + ' needs rules');
      for (const rule of rules) assert.ok(rule instanceof RegExp, preset.id + '/' + board + ' must hold RegExps');
    }
  }
});

check('the former technology feeds live inside presets, not in the default path', () => {
  const presets = listTopicPresets();
  const byId = id => presets.find(item => item.id === id);
  assert.equal(byId('tech').feeds.length, 10);
  assert.equal(byId('auto').feeds.length, 2);
  assert.equal(byId('science').feeds.length, 2);
  assert.equal(byId('finance').feeds.length, 0, 'no built-in finance feed yet; it must search instead');
  const urls = presets.flatMap(item => item.feeds.map(feed => feed.url));
  assert.equal(urls.length, 14);
  assert.equal(new Set(urls).size, 14, 'a feed may belong to one preset only');
  assert.equal(byId('tech').feeds.find(feed => feed.id === 'ithome').url, 'https://www.ithome.com/rss/');
  assert.equal(Object.keys(byId('tech').boards).length, 9);
});

check('an unknown topic matches nothing and gets no sources', () => {
  assert.equal(matchPreset('完全不存在的主题xyz'), null);
  assert.equal(matchPreset(''), null);
  assert.equal(matchPreset(null), null);
  assert.equal(presetForTopic(null), null);
  assert.equal(presetForTopic({}), null);
  assert.deepEqual(feedsForPreset(null), []);
  assert.deepEqual(feedsForPreset(undefined), []);
  assert.deepEqual(boardsForPreset(null), {});
});

check('a pinned preset wins, then keywords, then domains', () => {
  assert.equal(presetForTopic({ label: '我不认识', preset: 'finance' }).id, 'finance');
  assert.equal(presetForTopic({ label: '我不认识', preset: 'nope' }), null);
  assert.equal(presetForTopic({ keywords: ['A股'] }).id, 'finance');
  assert.equal(presetForTopic({ domains: ['electrek.co'] }).id, 'auto');
});

check('the GUI catalog is compact but complete', () => {
  const catalog = presetCatalog();
  assert.equal(catalog.length, 10);
  for (const entry of catalog) {
    assert.equal(typeof entry.id, 'string');
    assert.equal(typeof entry.label, 'string');
    assert.ok(Array.isArray(entry.keywords));
    assert.ok(Array.isArray(entry.domains));
    assert.equal(typeof entry.feeds, 'number');
    assert.ok(entry.keywords.length <= 6);
    assert.ok(entry.domains.length <= 6);
  }
  assert.equal(catalog.find(entry => entry.id === 'tech').feeds, 10);
});

check('the settings store keeps the title template and the topic preset pin', () => {
  assert.equal(emptySettings().reportTitle, DEFAULT_REPORT_TITLE);
  assert.equal(normalizeSettings({}).reportTitle, DEFAULT_REPORT_TITLE);
  assert.equal(normalizeSettings({ reportTitle: '  ' }).reportTitle, DEFAULT_REPORT_TITLE);
  assert.equal(normalizeSettings({ reportTitle: '{主题} 财报 {日期}' }).reportTitle, '{主题} 财报 {日期}');
  const topics = normalizeSettings({ topics: [{ label: '财经', keywords: ['股票'], preset: 'finance' }] }).topics;
  assert.equal(topics.length, 1);
  assert.equal(topics[0].preset, 'finance');
});

console.log('');
if (failures.length > 0) {
  console.log(failures.length + ' failed, ' + passed + ' passed');
  for (const item of failures) console.log('  ' + item.name + '\n    ' + (item.error && item.error.stack));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
