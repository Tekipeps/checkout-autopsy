import { test } from 'node:test';
import assert from 'node:assert/strict';
import { event, hiddenTrials, trainingTrials } from '../shared/fixtures';
import { expectedShipments, validateSuite } from '../server/validator';
import type { RawTrial, Trial } from '../shared/types';

function correctEvidence(trials: Trial[]): RawTrial[] {
  return trials.map(trial => { const seen: ReturnType<typeof event>[] = [];
    return { id: trial.id, steps: trial.batches.map(batch => { seen.push(...batch);
      return { eventIds: batch.map(e => e.id), exitCodes: batch.map(() => 0), stdout: batch.map(() => ''), stderr: batch.map(() => ''), shipments: [...expectedShipments(seen)].map(([sessionId, value]) => ({ sessionId, ...value })) };
    }) };
  });
}
test('accepts correct durable shipment evidence for all incident and holdout cases', () => {
  for (const id of ['duplicate', 'semantic', 'async']) {
    const suite = [...trainingTrials(id), ...hiddenTrials(42)];
    assert.equal(validateSuite(suite, correctEvidence(suite)).passed, suite.length);
  }
});
test('rejects duplicate shipment despite every handler process exiting successfully', () => {
  const trials = trainingTrials('duplicate'); const raw = correctEvidence(trials);
  raw[0].steps[1].shipments.push({ ...raw[0].steps[1].shipments[0] });
  assert.equal(validateSuite(trials, raw).checks[0].passed, false);
});
test('checks intermediate state, so later cleanup cannot hide early unpaid fulfillment', () => {
  const trials = trainingTrials('async'); const raw = correctEvidence(trials);
  raw[0].steps[0].shipments.push({ sessionId: 'cs_demo_1042', amount: 8900, currency: 'usd' });
  assert.equal(validateSuite(trials, raw).checks[0].passed, false);
});
test('rejects missing, substituted, crashed, and incorrect-amount evidence', () => {
  const trials = trainingTrials('duplicate');
  assert.equal(validateSuite(trials, []).passed, 0);
  for (const mutation of [
    (raw: RawTrial[]) => { raw[0].steps[0].eventIds[0] = 'substituted'; },
    (raw: RawTrial[]) => { raw[0].steps[0].exitCodes[0] = 1; },
    (raw: RawTrial[]) => { raw[0].steps[0].shipments[0].amount = 1; },
    (raw: RawTrial[]) => { raw[0].steps.pop(); },
  ]) { const raw = correctEvidence(trials); mutation(raw); assert.equal(validateSuite(trials, raw).checks[0].passed, false); }
});
test('preserves order independence and separate checkout identities', () => {
  const completed = event('evt_1'); const settled = event('evt_2', undefined, 'checkout.session.async_payment_succeeded');
  assert.equal(expectedShipments([settled, completed, completed]).size, 1);
  assert.equal(expectedShipments([completed, event('evt_3', 'cs_second')]).size, 2);
  assert.equal(expectedShipments([event('evt_unpaid', undefined, undefined, false)]).size, 0);
});
test('holdouts change IDs with the recorded seed and include a concurrent batch', () => {
  assert.deepEqual(hiddenTrials(10), hiddenTrials(10));
  assert.notDeepEqual(hiddenTrials(10), hiddenTrials(11));
  assert.equal(hiddenTrials(10).find(t => t.id === 'hidden-concurrent')?.batches[0].length, 4);
});
test('a wrong-currency failure carries an exact replayable counterexample', () => {
  const trials = trainingTrials('duplicate'); const raw = correctEvidence(trials);
  raw[0].steps[0].shipments[0].currency = 'gbp';
  const check = validateSuite(trials, raw).checks[0];
  assert.equal(check.passed, false);
  assert.match(check.details, /expected 8900 USD, found 8900 GBP/);
  assert.equal(check.counterexample?.step, 1);
  assert.equal(check.counterexample?.delivered[0].id, 'evt_checkout_01');
  assert.equal(check.counterexample?.expected[0].currency, 'usd');
  assert.equal(check.counterexample?.observed[0].currency, 'gbp');
});
