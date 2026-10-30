/**
 * Smoke test for the settings GUI bundle.
 *
 * The bundle is a Web client: plain CommonJS behind window.__ModuleLoader__.
 * React is supplied by the Host page, not by the package, so this test injects a
 * minimal React stand-in that keeps hook order and returns the initial state.
 * That is enough to prove the two things a broken client card fails on without a
 * browser: the module loads and registers the plugins.row.config slot under the
 * right key, and the card renders a real element tree without throwing.
 *
 * Run with: node scripts/test-client.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(here, '..', 'lib', 'client.js');

const reactStub = {
  Fragment: Symbol.for('tdr.fragment'),
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial;
    return [value, () => {}];
  },
  useCallback(fn) {
    return fn;
  },
  useEffect() {},
  useMemo(fn) {
    return fn();
  },
  useRef(initial) {
    return { current: initial };
  },
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };
  },
};

const jsxRuntimeStub = {
  jsx(type, props) {
    return { type, props: props ?? {} };
  },
  jsxs(type, props) {
    return { type, props: props ?? {} };
  },
  Fragment: reactStub.Fragment,
};

const browserRequire = name => {
  if (name === 'react') return reactStub;
  if (name === 'react/jsx-runtime') return jsxRuntimeStub;
  if (name === 'react-dom') return {};
  throw new Error(`unexpected require: ${name}`);
};

let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load(config) {
      loaded = config;
    },
  },
};

const source = fs.readFileSync(bundlePath, 'utf8');
// eslint-disable-next-line no-new-func
new Function('window', source)(globalThis.window);

assert.ok(loaded, 'the bundle must call window.__ModuleLoader__.load');
assert.equal(loaded.id, 'dsh-search-contrl', 'the module id must match the package name');

const exports = loaded.factory(browserRequire);
assert.equal(typeof exports.apply, 'function', 'the client must export apply');
assert.deepEqual(exports.inject, ['slots'], 'the client must declare the slots service');
assert.equal(typeof exports.SettingsCard, 'function', 'the card component must be exported for smoke tests');

const injected = [];
const registrations = [];
const ctx = {
  slots: {
    inject(name, callback) {
      injected.push(name);
      return callback();
    },
    register(meta, render) {
      registrations.push({ meta, render });
      return render;
    },
  },
};
exports.apply(ctx);
assert.deepEqual(injected, ['settings.section', 'plugins.row.config'], 'apply() must inject both slots');

const section = registrations.find(item => item.meta.name === 'settings.section');
assert.ok(section, 'the first-level settings section「搜索控制」must be registered');
assert.equal(section.meta.id, 'search-contrl-settings');
assert.equal(section.meta.label, '搜索控制');
assert.equal(typeof section.meta.order, 'number', 'the section needs a numeric nav order');
assert.ok(section.meta.order > 151, 'the section must sit after the bundled plugin sections (100–151)');

const row = registrations.find(item => item.meta.name === 'plugins.row.config');
assert.ok(row, 'apply() must keep registering the plugin row config page');
assert.equal(row.meta.key, 'dsh-search-contrl#search-contrl');

const summary = row.render({ view: 'summary' });
assert.equal(typeof summary, 'string', 'the summary view must be plain text');
assert.match(summary, /DSH-Search-Contrl/, 'the row summary must name the plugin');

const sectionCard = section.render();
assert.ok(sectionCard && typeof sectionCard === 'object', 'the settings section must render an element');
assert.equal(sectionCard.type, exports.SettingsCard, 'the section renders the full settings card, not a summary');

/** Expand function components and collect every string child. */
function textOf(element, depth = 0) {
  assert.ok(depth < 60, 'component tree must not recurse forever');
  if (element === null || element === undefined || element === false) return '';
  if (typeof element === 'string' || typeof element === 'number') return String(element);
  if (Array.isArray(element)) return element.map(item => textOf(item, depth + 1)).join('\n');
  if (typeof element.type === 'function') return textOf(element.type(element.props), depth + 1);
  const children = element.props?.children;
  const own = typeof children === 'string' || typeof children === 'number' ? String(children) : '';
  return [own, textOf(children, depth + 1)].filter(Boolean).join('\n');
}

const card = exports.SettingsCard({ page: true });
assert.ok(card && typeof card === 'object', 'the card must render an element');
assert.equal(card.type, 'div');
assert.match(String(card.props.className), /tdr-card/);

const text = textOf(card);
for (const expected of [
  'DSH-Search-Contrl',
  '未配置自定义项，报告先问主题再检索。',
  '正在读取设置…',
  '报告标题',
  '搜索源',
  '主题',
  '博主',
  '历史版本',
  '登录 Cookie',
  '报告输出方式',
  '只给文件',
  '只在聊天中呈现',
  '文件 + 聊天',
  '已保存',
  '清空自定义项',
]) {
  assert.ok(text.includes(expected), `the rendered card must contain "${expected}"`);
}

assert.equal(typeof exports.CookiePanel, 'function', 'the cookie panel must be exported');

const link = exports.describeLink('https://space.bilibili.com/123456');
assert.equal(link.domain, 'bilibili.com');
assert.equal(link.platform, 'B站');
assert.equal(exports.describeLink('not a url'), null);
assert.equal(exports.describeLink('https://example.com/x'), null);

assert.ok(
  source.includes('features?.delivery !== true'),
  'the card must detect a Host that is still running a pre-2.2.0 plugin'
);
assert.ok(
  source.includes('被正在运行的旧版服务端丢弃了'),
  'the card must explain a delivery save that the old Host dropped, not snap back silently'
);
assert.ok(
  source.includes('当前 DSH 进程里加载的仍是 2.2.0 之前的插件'),
  'the delivery panel must warn while the Host is stale'
);

console.log('ok   settings.section「搜索控制」registers in the settings sidebar');
console.log('ok   module loads and registers plugins.row.config under the patch row id');
console.log('ok   the settings card renders rows, status and the save bar');
console.log('ok   the card offers the three report delivery modes');
console.log('ok   a stale Host is reported instead of silently reverting the delivery mode');
console.log('ok   creator links map to a platform and domain');
console.log('\nall client checks passed');
