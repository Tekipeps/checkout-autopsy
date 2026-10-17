import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';

const all = process.argv.includes('--all');
const files = execFileSync('git', all ? ['ls-files', '--cached', '--others', '--exclude-standard', '-z'] : ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const blocked = [];
const credential = /\b(?:skp_[A-Za-z0-9_-]{20,}|[sr]k_(?:test|live)_[A-Za-z0-9]{16,}|sk-or-v1-[A-Za-z0-9_-]{16,}|whsec_[A-Za-z0-9]{16,})\b/;
for (const file of files) {
  if ((/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) || file.startsWith('.projects/')) {
    blocked.push(file); continue;
  }
  const contents = (all ? lstatSync(file).isSymbolicLink() ? readlinkSync(file) : readFileSync(file) : execFileSync('git', ['show', `:${file}`], { maxBuffer: 20 * 1024 * 1024 })).toString('utf8');
  if (credential.test(contents)) blocked.push(file);
}
if (blocked.length) {
  console.error('Commit blocked: credential-like content or local secret files found in:');
  for (const file of blocked) console.error(`  ${file}`);
  console.error('Remove the credentials from staged content. Secret values were not printed.');
  process.exitCode = 1;
}
