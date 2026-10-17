import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';

const all = process.argv.includes('--all');
const files = execFileSync('git', all ? ['ls-files', '--cached', '--others', '--exclude-standard', '-z'] : ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const blocked = [];
const credential = /\b(?:skp_[A-Za-z0-9_-]{20,}|[sr]k_(?:test|live)_[A-Za-z0-9]{16,}|sk-or-v1-[A-Za-z0-9_-]{16,}|whsec_[A-Za-z0-9]{16,})\b/;
function publicManifestOnly(contents) {
  try {
    const value = JSON.parse(contents);
    const record = x => x && typeof x === 'object' && !Array.isArray(x);
    const keys = (x, allowed) => record(x) && Object.keys(x).every(k => allowed.includes(k));
    const name = x => typeof x === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(x);
    if (!keys(value, ['version', 'providers', 'resources']) || value.version !== 1 || !record(value.providers) || !record(value.resources)) return false;
    const providers = Object.entries(value.providers);
    const resources = Object.entries(value.resources);
    if (!providers.length || providers.length > 20 || !resources.length || resources.length > 50) return false;
    if (!providers.every(([key, p]) => name(key) && keys(p, ['name']) && name(p.name))) return false;
    const known = new Set(providers.map(([, p]) => p.name));
    return resources.every(([key, r]) => name(key) && keys(r, ['name', 'providerName', 'serviceId']) && r.name === key && name(r.serviceId) && known.has(r.providerName));
  } catch { return false; }
}
for (const file of files) {
  const publicManifest = file === '.projects/state.json';
  if ((/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) || (file.startsWith('.projects/') && !publicManifest)) {
    blocked.push(file); continue;
  }
  // The public manifest is staged separately; never read CLI-managed local state.
  const contents = (all && !publicManifest ? lstatSync(file).isSymbolicLink() ? readlinkSync(file) : readFileSync(file) : execFileSync('git', ['show', `:${file}`], { maxBuffer: 20 * 1024 * 1024 })).toString('utf8');
  if (credential.test(contents) || (publicManifest && !publicManifestOnly(contents))) blocked.push(file);
}
if (blocked.length) {
  console.error('Commit blocked: credential-like content or local secret files found in:');
  for (const file of blocked) console.error(`  ${file}`);
  console.error('Remove the credentials from staged content. Secret values were not printed.');
  process.exitCode = 1;
}
