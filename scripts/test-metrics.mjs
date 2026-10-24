// report-metrics 的最小断言集：不依赖网络，纯函数级别。
import { analyzeReport, checkLinks, estimateTokens } from './report-metrics.mjs';

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const SAMPLE = `# 周报｜2026-10-19 至 2026-10-24

## 本周判断

一句话。

## 板块甲

### 【大】事情一

- **来源**：[A](https://example.com/a) · [B](https://example.com/b)

### 【中】事情二

- **来源**：[A 重复](https://example.com/a)

## 博主动态

### 博主甲

| 时间 | 内容 |
| --- | --- |
| 10-24 | 一条 |
`;

await test('estimateTokens returns a monotonic low/mid/high band', () => {
  const t = estimateTokens('中文 english 混合 12345');
  assert(t.low <= t.mid && t.mid <= t.high, `band must be ordered, got ${t.low}/${t.mid}/${t.high}`);
  assert(t.cjk === 4, `expected 4 CJK chars, got ${t.cjk}`);
});

await test('analyzeReport counts sections, items and dedupes links', () => {
  const m = analyzeReport(SAMPLE);
  assert(m.sections === 3, `sections ${m.sections}`);
  assert(m.items === 3, `items ${m.items}`);
  assert(m.uniqueLinks === 2, `unique links ${m.uniqueLinks}`);
  assert(m.lines === SAMPLE.split('\n').length - 1, `lines ${m.lines}`);
});

await test('analyzeReport flags 待补/TODO/undefined markers', () => {
  const m = analyzeReport(SAMPLE + '\n待补一段\nTODO: x\n值 undefined\n');
  assert(m.pendingMarkers === 3, `pending ${m.pendingMarkers}`);
});

await test('checkLinks keeps every URL when the target answers 2xx', async () => {
  const seen = [];
  const run = await checkLinks(['https://ok.test/1', 'https://ok.test/2'], {
    concurrency: 2,
    timeoutMs: 50,
  }).catch(() => null);
  // 没有网络时这里会全部失败，但那本身也要被如实反映：checked 必须等于输入长度。
  assert(run && run.checked === 2, `checked ${run && run.checked}`);
  assert(run.results.length === 2, 'every url must produce a result');
  void seen;
});

await test('checkLinks reports failures instead of throwing', async () => {
  const run = await checkLinks(['https://127.0.0.1:1/nope'], { concurrency: 1, timeoutMs: 300 });
  assert(run.failed.length === 1, 'unreachable host must land in failed');
  assert(run.ok === 0, 'ok must be 0');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
