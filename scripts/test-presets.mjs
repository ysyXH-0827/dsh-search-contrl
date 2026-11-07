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
  assert.equal(byId('finance').feeds.length, 1);
  assert.equal(byId('sports').feeds.length, 2);
  assert.equal(byId('entertainment').feeds.length, 2);
  assert.equal(byId('health').feeds.length, 2);
  assert.equal(byId('game').feeds.length, 1);
  assert.equal(byId('energy').feeds.length, 2);
  assert.equal(byId('policy').feeds.length, 0, 'no verified policy feed yet; it must search instead');
  const urls = presets.flatMap(item => item.feeds.map(feed => feed.url));
  assert.equal(urls.length, 24);
  // Electrek is deliberately shared between the auto and energy presets
  // (one feed, two topics), so unique URLs are one fewer than entries.
  assert.equal(new Set(urls).size, 23);
  assert.equal(
    byId('energy').feeds.find(feed => feed.id === 'electrek').url,
    byId('auto').feeds.find(feed => feed.id === 'electrek').url,
    'energy reuses the auto preset electrek feed object, it does not duplicate it',
  );
  assert.equal(byId('tech').feeds.find(feed => feed.id === 'ithome').url, 'https://www.ithome.com/rss/');
  assert.equal(Object.keys(byId('tech').boards).length, 13);
  assert.deepEqual(Object.keys(byId('tech').boards).slice(9), ['软件与系统', '互联网公司', '消费电子', '游戏电竞']);
});

check('tech boards classify the titles the old rules dropped to others', () => {
  // 2026-11-07 实跑：旧规则 48/97 未归类，新规则 7/97。归类按标题优先、
  // 摘要兜底的两段式（与 daily-collect / archive-digest 的实现一致），
  // 不能只拼 title + desc——摘要里的词会把标题已点明的板抢走。
  const boards = boardsForPreset(listTopicPresets().find(item => item.id === 'tech'));
  const byHay = hay => Object.entries(boards).find(([, res]) => res.some(re => re.test(hay)))?.[0];
  const classify = (title, desc = '') => byHay(title) ?? byHay(`${title} ${desc}`) ?? 'others';
  assert.equal(classify('AI 编程进入“通话时代”：Cursor 智能体可实时语音协作'), '国内AI');
  assert.equal(classify('All the latest updates on AI data centers'), '国际AI');
  assert.equal(classify('50系突然疯涨，买不起显卡，年轻人又挤进网吧包夜了'), '芯片半导体');
  assert.equal(classify('理想 Mega 新版本 MPV 谍照疑曝光，车头缩短、前三角窗加大'), '国内车型');
  assert.equal(classify('中国第 43 次南极考察起航，“雪龙”号等三船共同保障'), '航天与科学');
  assert.equal(classify('微软发布 Win11 多预览版：改进 Windows Hello 登录体验'), '软件与系统');
  assert.equal(classify('腾讯旗下搜狗问问今日正式停运，曾拥有过亿用户'), '互联网公司');
  assert.equal(classify('索尼官宣因生产问题延迟发售 PULSE Elevate 音箱'), '消费电子');
  assert.equal(classify('卫冕冠军 T1 3:1 战胜 KC 跻身《英雄联盟》S16 四强'), '游戏电竞');
  assert.equal(classify('何立峰与美国财政部长贝森特、贸易代表格里尔举行视频通话'), '产业政策');
  assert.equal(classify('Hundreds of Artex AI hacking tools found publicly exposed to the web'), '国际AI');
  // 英文里的 video 不能把条目吸进软件与系统：IDE 只认独立单词。
  assert.equal(classify('Amazon is now making a Melania Trump TV series'), 'others');
  // 标题优先：摘要里的词不能抢走标题已点明的板（2026-11-07 实跑的
  // 5 条错归回放；算力已从国内 AI 拿掉，量子故事不再被它偷走）。
  assert.equal(classify('刷新算力巅峰：IBM 在美国芝加哥揭幕其最强量子计算机', '已在芝加哥海德公园实验室投运 IBM Quantum System Two 量子计算机'), '航天与科学');
  assert.equal(classify('谷歌发布新一代视频生成模型', '谷歌宣布推出AI视频生成模型Gemini Omni 1.2 Flash，支持原生生成最长15秒的视频'), '国际AI');
  assert.equal(classify('“史上最大 IPO”遇挑战：Anthropic 上市估值存分歧，1.5 万亿美元仍被嫌贵', '报道称 AI 公司 Anthropic 的首次公开募股（IPO）计划面临投资者估值质疑'), '国际AI');
  assert.equal(classify('Anthropic拟于下周启动IPO路演', '投资者对亚马逊和谷歌公布的巨额AI支出计划，以及民主党在中期选举中的压倒性胜利作出了反应'), '国际AI');
  assert.equal(classify('OpenAI完成110亿美元新融资，估值1.25万亿美元，软银、红杉资本等参投', '在推迟了首次公开募股（IPO）计划后，这家AI开发商已就一轮大额融资洽谈了一个多月'), '国际AI');
  assert.equal(classify('OpenAI：将继续推进其美国数据中心扩张计划', '尽管本周民主党中期选举引发了对AI基础设施进行更严格审查的担忧，但公司将继续推进其美国数据中心扩张计划'), '国际AI');
});

check('slow feeds are marked extra-tier so a daily run never pays their timeout', () => {
  const presets = listTopicPresets();
  const byId = id => presets.find(item => item.id === id);
  assert.equal(byId('tech').feeds.find(feed => feed.id === 'leiphone').tier, 'extra');
  assert.equal(byId('auto').feeds.find(feed => feed.id === 'insideevs').tier, 'extra');
  const extras = presets.flatMap(item => item.feeds).filter(feed => feed.tier === 'extra');
  assert.deepEqual(extras.map(feed => feed.id).sort(), ['insideevs', 'leiphone']);
  for (const feed of presets.flatMap(item => item.feeds)) {
    assert.ok(feed.tier === undefined || feed.tier === 'core' || feed.tier === 'extra', feed.id + ' has an unknown tier');
  }
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
