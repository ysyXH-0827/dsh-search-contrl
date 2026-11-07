#!/usr/bin/env node
/**
 * Offline checks for the skill registration in lib/index.js.
 *
 * lib/index.js cannot be imported here: it pulls in lib/config.js, which
 * imports the @deepseek-ai/schemastery peer dependency that is only installed
 * in CI / on the DSH host. So this suite reads the file as text and asserts
 * on the `skill` literal instead — the same source-level style test-client
 * already uses for lib/client.js.
 *
 * The case this pins: DSH's skill registry requires SkillDefinition.source to
 * be a string (origin bucket; 'runtime' is the bucket for runtime-embedded
 * skills registered via ctx.skills.register()). Without it the model-facing
 * `skill` tool fails at load time with
 * `loaded skill "dsh-search-contrl" source must be a string` (seen in a
 * 2026-11-07 run) and the agent falls back to reading lib/index.js by hand.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');

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

// The skill literal ends at the first `\n};` after its opening line; the body
// is a template literal full of `{...}` placeholders, so brace-counting would
// miscount — anchor on the closing line instead.
function skillBlock() {
  const start = source.indexOf('const skill = {');
  assert.notEqual(start, -1, 'const skill = { not found in lib/index.js');
  const end = source.indexOf('\n};', start);
  assert.notEqual(end, -1, 'closing of the skill literal not found');
  return source.slice(start, end);
}

const SKILL_SOURCES = [
  'project-dsh',
  'project-agents',
  'project-codex',
  'project-claude',
  'runtime',
  'user-dsh',
  'user-agents',
  'custom',
  'bundled',
];

check('the skill literal is registered with ctx.skills.register', () => {
  assert.ok(source.includes('ctx.skills.register(skill)'));
  skillBlock();
});

check('the skill has a kebab-case name matching the package', () => {
  const block = skillBlock();
  assert.match(block, /name: 'dsh-search-contrl',/);
});

check('the skill has a non-empty description', () => {
  const block = skillBlock();
  const match = block.match(/description: '([^']+)'/);
  assert.ok(match && match[1].length > 10, 'description must be a non-empty string');
});

check('the skill allows both model and user invocation', () => {
  const block = skillBlock();
  assert.ok(block.includes('modelInvocable: true'));
  assert.ok(block.includes('userInvocable: true'));
});

check('the skill carries a string source so the skill tool can load it', () => {
  const block = skillBlock();
  const match = block.match(/source: '([^']+)'/);
  assert.ok(match, "skill literal must set source: '<bucket>' (DSH requires a string source)");
  assert.ok(
    SKILL_SOURCES.includes(match[1]),
    'source must be a documented SkillSource bucket, got ' + match[1],
  );
});

check('a runtime-embedded skill reports the runtime origin bucket', () => {
  const block = skillBlock();
  assert.ok(block.includes("source: 'runtime'"));
});

check('the skill body is an inline markdown template, not a file reference', () => {
  const block = skillBlock();
  assert.match(block, /content: `# DSH-Search-Contrl/);
  assert.ok(block.includes('第 0 步：先读设置'));
});

console.log('');
if (failures.length > 0) {
  console.log(failures.length + ' failed, ' + passed + ' passed');
  for (const item of failures) console.log('  ' + item.name + '\n    ' + (item.error && item.error.stack));
  process.exit(1);
}
console.log(passed + ' passed, 0 failed');
