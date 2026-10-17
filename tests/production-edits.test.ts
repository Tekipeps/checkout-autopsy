import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyExactEdits, editsSchema } from '../server/production-model';

const source = 'export function createApp() { return "bug"; }\nexport async function dispatchOne() { return "unchanged"; }';
test('targeted model edits preserve unrelated worker source exactly', () => {
  const edited = applyExactEdits(source, [{ old: 'return "bug";', new: 'return "fixed";' }]);
  assert(edited.includes('return "fixed";'));
  assert.equal(edited.split('\n')[1], source.split('\n')[1]);
});
test('missing, ambiguous, empty or unchanged model edits cannot be executed', () => {
  assert.throws(() => applyExactEdits(source, [{ old: 'absent', new: 'fixed' }]), /missing or ambiguous/);
  assert.throws(() => applyExactEdits(source, [{ old: 'return ', new: 'return null;' }]), /ambiguous/);
  assert.throws(() => applyExactEdits(source, [{ old: '"bug"', new: '"bug"' }]), /did not produce/);
  assert.equal(editsSchema.safeParse({ edits: [{ old: '', new: 'anything' }] }).success, false);
  assert.equal(editsSchema.safeParse({ edits: [] }).success, false);
});
