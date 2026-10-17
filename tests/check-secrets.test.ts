import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
const checker = resolve('scripts/check-secrets.mjs');
const valid = { version: 1, providers: { createos: { name: 'createos' } }, resources: { sandbox: { name: 'sandbox', providerName: 'createos', serviceId: 'project' } } };
function check(value: unknown, path = '.projects/state.json', all = false) {
  const root = mkdtempSync(join(tmpdir(), 'autopsy-secret-check-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, '.projects'));
    writeFileSync(join(root, path), JSON.stringify(value));
    execFileSync('git', ['add', '-f', path], { cwd: root });
    return spawnSync(process.execPath, [checker, ...(all ? ['--all'] : [])], { cwd: root, encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('secret check accepts only the reviewed public manifest in staged and all modes', () => {
  assert.equal(check(valid).status, 0); assert.equal(check(valid, undefined, true).status, 0);
});
test('public manifest rejects account/backend fields, environment variables and credentials without echoing them', () => {
  for (const value of [{ ...valid, accountId: 'acct_private' }, { ...valid, variables: {} }, { ...valid, resources: { sandbox: { ...valid.resources.sandbox, backendId: 'private-id' } } }]) assert.equal(check(value).status, 1);
  const secret = 'skp_' + 'x'.repeat(30);
  const result = check({ ...valid, providers: { createos: { name: secret } } });
  assert.equal(result.status, 1); assert.equal(result.stderr.includes(secret), false);
});
test('all other Projects state stays blocked even when it has harmless-looking content', () => {
  assert.equal(check(valid, '.projects/state.local.json').status, 1);
});
