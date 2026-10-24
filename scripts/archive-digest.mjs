#!/usr/bin/env node
/**
 * archive-digest.mjs — 把一份归档快照渲染成人可读的 Markdown（不需要模型）。
 *
 * 用法：
 *   node scripts/archive-digest.mjs --date=2026-10-24                       # 输出到 stdout
 *   node scripts/archive-digest.mjs --date=2026-10-24 --out=reports/_data/digest/2026-10-24.md
 *   node scripts/archive-digest.mjs --file=reports/_data/archive/2026-10-24.json
 *   node scripts/archive-digest.mjs --date=2026-10-24 --max=6 --window=all  # 不按日期过滤，列出全部
 *
 * 目的是让「不开机也能看」：GitHub Actions 每天生成 digest/YYYY-MM-DD.md，
 * 手机上打开仓库就能读；D 日之后再让模型成稿时，也有现成素材。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const BJ = 8 * 3600_000;
const fmt = t => new Date(t + BJ).toISOString().slice(0, 10);
const today = fmt(Date.now());
const date = args.date ?? today;
const max = Math.max(1, Number(args.max ?? 8));
const windowMode = String(args.window ?? 'day'); // day | all
const file = args.file ?? `reports/_data/archive/${date}.json`;

if (!fs.existsSync(file)) {
  process.stderr.write(`[archive-digest] 找不到快照：${file}\n`);
  process.exit(2);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = (Array.isArray(data.allItems) && data.allItems.length)
  ? data.allItems
  : (Array.isArray(data.uniqueItems) && data.uniqueItems.length)
    ? data.uniqueItems
    : (Array.isArray(data.items) ? data.items : []);

const BOARD_RULES = [
  ['国内 AI', /(月之暗面|Kimi|DeepSeek|百度|阿里|通义|千问|字节|豆包|腾讯|混元|智谱|MiniMax|商汤|科大讯飞|文心|阶跃|零一万物|百川|面壁|智元|宇树|模型|大模型|智能体|AIGC)/i],
  ['国际 AI', /(OpenAI|ChatGPT|GPT-|Anthropic|Claude|Gemini|Google|Meta|Llama|Mistral|xAI|Grok|Copilot|Perplexity|Nvidia\s+AI|Hugging Face|LLM)/i],
  ['芯片半导体', /(芯片|半导体|晶圆|台积电|TSMC|英特尔|Intel|AMD|英伟达|NVIDIA|高通|联发科|三星|SK\s*海力士|美光|ASML|光刻|封装|DRAM|NAND|HBM|麒麟|玄戒|RISC-V|ARM)/i],
  ['国内手机', /(华为|小米|荣耀|OPPO|vivo|一加|realme|Redmi|iQOO|魅族|折叠屏|Mate\s*\d|Pura|iPhone|苹果|手机|平板|耳机|手表|鸿蒙|HarmonyOS)/i],
  ['国内车型', /(比亚迪|小米汽车|蔚来|小鹏|理想|问界|智界|享界|尊界|极氪|零跑|哪吒|岚图|阿维塔|埃安|腾势|长城|吉利|奇瑞|长安|上汽|广汽|宁德时代|电池|充电|智驾|新能源车)/i],
  ['国际车型', /(Tesla|特斯拉|Rivian|Lucid|Ford|GM|通用|Toyota|丰田|VW|Volkswagen|大众|BMW|宝马|Mercedes|奔驰|Hyundai|现代|Kia|起亚|Stellantis|Cybertruck|FSD|EV|electric vehicle|battery)/i],
  ['航天与科学', /(NASA|SpaceX|星舰|火箭|卫星|探测器|望远镜|航天|登月|空间站|嫦娥|天问|量子|核聚变|超导|Nature|Science|论文|火星|月球|发射)/i],
  ['网络安全', /(漏洞|CVE|勒索|黑客|攻击|数据泄露|安全|木马|钓鱼|越权|0day|补丁)/i],
  ['产业政策', /(政策|监管|备案|工信部|网信办|反垄断|关税|法规|白皮书|国家标准|行业标准|国补|补贴)/i],
];

const cut = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function atOf(it) {
  const raw = String(it.at ?? '');
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(raw);
  return m ? { day: m[1], hm: m[2], raw } : { day: raw.slice(0, 10), hm: raw.slice(11, 16), raw };
}

const pool = windowMode === 'all' ? items : items.filter(it => atOf(it).day === date);
const seen = new Set();
const uniq = [];
for (const it of pool) {
  if (!it?.url || seen.has(it.url)) continue;
  seen.add(it.url);
  uniq.push(it);
}
uniq.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));

const buckets = new Map(BOARD_RULES.map(([name]) => [name, []]));
const others = [];
for (const it of uniq) {
  const hay = `${it.title ?? ''} ${it.desc ?? ''}`;
  const hit = BOARD_RULES.find(([, re]) => re.test(hay));
  if (hit) buckets.get(hit[0]).push(it);
  else others.push(it);
}

const lines = [];
const win = data.window && typeof data.window === 'object' ? data.window : null;
lines.push(`# ${win ? '科技周报素材｜' + win.from + ' ~ ' + win.to : '科技日报素材｜' + date}${windowMode === 'all' ? `（全部 ${uniq.length} 条）` : ''}`, '');
lines.push(`> 脚本自动生成，未经过人工/模型筛选：按关键词归类，仅供快速浏览与后续成稿。共 ${uniq.length} 条。`, '');
lines.push(`- 快照时间：${data.generatedAt ?? '未知'}`);
lines.push(`- 快照文件：\`${path.basename(file)}\``);
lines.push(`- 源：14 个 RSS（见 README）`);
lines.push('');

let shown = 0;
for (const [name, list] of buckets) {
  if (!list.length) continue;
  const take = list.slice(0, max);
  shown += take.length;
  lines.push(`## ${name}（${list.length}）`, '');
  lines.push('| 时间 | 标题 | 链接 |');
  lines.push('| --- | --- | --- |');
  for (const it of take) {
    const { day, hm } = atOf(it);
    const t = windowMode === 'all' ? `${day.slice(5)} ${hm}` : hm;
    const title = cut(it.title).replace(/\|/g, '｜').slice(0, 80);
    lines.push(`| ${t} | ${title} | [原文](${it.url}) |`);
  }
  lines.push('');
}
if (others.length) {
  lines.push(`## 未归类（${others.length}）`, '');
  for (const it of others.slice(0, Math.min(max, 6))) {
    lines.push(`- ${cut(it.title).slice(0, 80)} — ${it.url}`);
  }
  lines.push('');
}

const md = lines.join('\n');
if (args.out) {
  fs.mkdirSync(String(args.out).replace(/[\\/][^\\/]+$/, ''), { recursive: true });
  fs.writeFileSync(String(args.out), md);
  process.stderr.write(`[archive-digest] 写入 ${args.out}（${uniq.length} 条，展示 ${shown} 条）\n`);
} else {
  process.stdout.write(md);
}
