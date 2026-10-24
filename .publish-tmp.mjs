// 发布脚本：只把本地改动文件写成远端 blob，基于远端 main 的 tree 重建，再更新 ref。
// 为什么不用 git push：本机到 github.com:443 长期被阻断。
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const REPO = 'ysyXH-0827/dsh-search-contrl';
const BRANCH = 'main';
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const TAG = `v${VERSION}`;

function gh(args, input) {
  const out = execFileSync('gh', args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.trim();
}
function api(route, method = 'GET', body) {
  const args = ['api', '-X', method, route];
  if (body !== undefined) {
    args.push('--input', '-');
    return JSON.parse(gh(args, JSON.stringify(body)));
  }
  return JSON.parse(gh(args));
}
function blobSha(content) {
  const buf = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);
const changes = status.map((line) => {
  const code = line.slice(0, 2).trim();
  const path = line.slice(3).trim().replace(/^"|"$/g, '');
  return { code, path };
});

const head = api(`repos/${REPO}/git/ref/heads/${BRANCH}`);
const headSha = head.object.sha;
const headCommit = api(`repos/${REPO}/git/commits/${headSha}`);
console.log('remote head', headSha.slice(0, 8), 'base tree', headCommit.tree.sha.slice(0, 8));

const remotePaths = new Set(api(`repos/${REPO}/git/trees/${headCommit.tree.sha}?recursive=1`).tree.filter((e) => e.type === 'blob').map((e) => e.path));
const tree = [];
const report = [];
for (const { code, path } of changes) {
  if (code === 'D') {
    if (!remotePaths.has(path)) { report.push(`${path}: already absent remotely`); continue; }
    tree.push({ path, mode: '100644', type: 'blob', sha: null });
    report.push(`${path}: deleted`);
    continue;
  }
  if (!existsSync(path)) continue;
  const raw = readFileSync(path, 'utf8');
  const normalized = raw.replace(/\r\n/g, '\n');
  if (normalized !== raw) writeFileSync(path, normalized);
  const local = blobSha(normalized);
  const blob = api(`repos/${REPO}/git/blobs`, 'POST', { content: normalized, encoding: 'utf8' });
  if (blob.sha !== local) throw new Error(`blob mismatch for ${path}: ${blob.sha} != ${local}`);
  tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  report.push(`${path}: ${blob.sha.slice(0, 8)}`);
}

const newTree = api(`repos/${REPO}/git/trees`, 'POST', { base_tree: headCommit.tree.sha, tree });
const message = `Release ${VERSION}: verify-links counts a link reachable when GET succeeds after a HEAD 403`;
const commit = api(`repos/${REPO}/git/commits`, 'POST', {
  message,
  tree: newTree.sha,
  parents: [headSha],
});
api(`repos/${REPO}/git/refs/heads/${BRANCH}`, 'PATCH', { sha: commit.sha, force: false });

const tagBody = api(`repos/${REPO}/git/tags`, 'POST', {
  tag: TAG,
  message: `Release ${VERSION}`,
  object: commit.sha,
  type: 'commit',
});
try {
  api(`repos/${REPO}/git/refs`, 'POST', { ref: `refs/tags/${TAG}`, sha: tagBody.sha });
} catch {
  api(`repos/${REPO}/git/refs/tags/${TAG}`, 'PATCH', { sha: tagBody.sha, force: true });
}

console.log('files:', report.length);
report.forEach((r) => console.log('  ' + r));
console.log('tree', newTree.sha.slice(0, 8), 'commit', commit.sha, 'tag', TAG);
