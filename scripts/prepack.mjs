/**
 * Runs before `npm pack` / `npm publish`. Publishing is the one moment where a
 * broken entry point becomes everybody's broken install, so it is worth a
 * node --check sweep and a client-bundle contract check here.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = fs.readdirSync('lib').filter(name => name.endsWith('.js'));
for (const name of files) {
  execFileSync(process.execPath, ['--check', `lib/${name}`], { stdio: 'inherit' });
}

const client = fs.readFileSync('lib/client.js', 'utf8');
const missing = [];
if (!client.includes('__ModuleLoader__')) missing.push('window.__ModuleLoader__ entry');
if (!client.includes('settings.section')) missing.push('settings.section registration');
if (!fs.existsSync('cordis.patch.yml')) missing.push('cordis.patch.yml');
if (!fs.existsSync('lib/index.js')) missing.push('lib/index.js');
if (missing.length > 0) {
  console.error(`prepack failed, missing: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`prepack ok: ${files.length} lib files, client bundle and cordis patch present`);
