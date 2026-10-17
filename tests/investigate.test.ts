import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { investigate } from '../server/investigate';
import { expectedShipments } from '../server/validator';
import type { PaymentEvent, RawTrial, RunEvent, Trial } from '../shared/types';
import type { openSandbox } from '../server/executor';

// All model/VM/report I/O is replaced. No candidate code executes in these tests.
process.env.MODEL_API_KEY = 'unit-test-placeholder';
function evidence(trials: Trial[], fail: boolean): RawTrial[] {
  const raw = trials.map(trial => {
    const seen: PaymentEvent[] = [];
    return { id: trial.id, steps: trial.batches.map(batch => {
      seen.push(...batch);
      return { eventIds: batch.map(e => e.id), exitCodes: batch.map(() => 0), stdout: batch.map(() => ''), stderr: batch.map(() => ''), shipments: [...expectedShipments(seen)].map(([sessionId, value]) => ({ sessionId, ...value })) };
    }) };
  });
  if (fail) raw.find(t => t.steps.length)!.steps[0].shipments.push({ sessionId: 'cs_unexpected', amount: 1, currency: 'usd' });
  return raw;
}
async function runCase({ auditFails = false, repairFails = false, originalCorrect = false } = {}) {
  let modelCalls = 0; let seedCalls = 0; let destroyed = false; let cleanupConfirmed = false;
  const order: string[] = []; const feedback: unknown[] = []; const emitted: RunEvent[] = [];
  const original = '# custom source\ndef handle(event, db): return "original"\n';
  const candidate = '# generated source\ndef handle(event, db): return "candidate"\n';
  const sandbox = { id: 'unit-vm', destroy: async () => { destroyed = true; }, waitUntilDestroyed: async () => { cleanupConfirmed = true; } } as unknown as Awaited<ReturnType<typeof openSandbox>>;
  const result = await investigate({ incidentId: 'duplicate', mode: 'agent', source: original }, e => emitted.push(e), new AbortController().signal, {
    openSandbox: async () => sandbox,
    newSeed: () => { order.push('seed'); return ++seedCalls; },
    generatePatch: async (_original, _previous, data) => { modelCalls++; feedback.push(data); order.push('model'); return { source: candidate, model: 'mock-no-live-ai' }; },
    executeSuite: async (_sandbox, source, inputs) => {
      const audit = inputs[0].id.startsWith('audit-');
      order.push(audit ? 'audit' : 'repair');
      return { raw: evidence(inputs, audit ? source === candidate && auditFails : (source === original && !originalCorrect) || repairFails), execMs: 1, exitCode: 0 };
    },
    saveReport: async () => { order.push('saved'); },
  });
  return { result, order, modelCalls, seedCalls, destroyed, cleanupConfirmed, feedback, emitted, candidate, original };
}
test('freezes a generated patch before a fresh audit, binds its hash and withholds audit feedback', async () => {
  const run = await runCase();
  assert.equal(run.result.verified, true);
  assert.equal(run.modelCalls, 1);
  assert.equal(run.seedCalls, 2);
  assert.deepEqual(run.order, ['seed', 'repair', 'model', 'repair', 'seed', 'audit', 'audit', 'saved']);
  assert.equal(run.result.audit?.candidateHash, createHash('sha256').update(run.candidate).digest('hex'));
  assert.equal(run.result.audit?.feedbackToModel, false);
  assert.equal(run.result.audit?.candidate.passed, 12);
  assert(!JSON.stringify(run.feedback).includes('cs_audit_'));
  assert(run.destroyed && run.cleanupConfirmed && run.result.cleanup);
});
test('a failed frozen audit withholds verification without another model call or patch change', async () => {
  const run = await runCase({ auditFails: true });
  assert.equal(run.result.repaired.passed, 12);
  assert.equal(run.result.audit?.candidate.passed, 11);
  assert.equal(run.result.verified, false);
  assert.equal(run.modelCalls, 1);
  assert.equal(run.result.patch, run.candidate);
  assert.equal(run.result.attempts.length, 1);
  assert(run.result.cleanup);
});
test('an incomplete repair cannot skip ahead to an audit or a verified claim', async () => {
  const run = await runCase({ repairFails: true });
  assert.equal(run.modelCalls, 3);
  assert.equal(run.seedCalls, 1);
  assert.equal(run.result.audit, undefined);
  assert.equal(run.result.verified, false);
  assert(run.result.cleanup);
});
test('an already passing original is audited without a model call', async () => {
  const run = await runCase({ originalCorrect: true });
  assert.equal(run.modelCalls, 0);
  assert.equal(run.result.patch, run.original);
  assert.equal(run.result.verified, true);
  assert.equal(run.result.audit?.candidateHash, createHash('sha256').update(run.original).digest('hex'));
});
