import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditTrials, event, trainingTrials } from '../shared/fixtures';
import { investigationRequestSchema, paymentEventSchema } from '../shared/types';
import { expectedShipments } from '../server/validator';

test('custom handlers require a valid sequence and reject ambiguous checkout prices', () => {
  const valid = { incidentId: 'custom', mode: 'agent', source: 'def handle(event, db): pass', sequence: [event('evt_1')] };
  assert(investigationRequestSchema.safeParse(valid).success);
  assert(!investigationRequestSchema.safeParse({ ...valid, sequence: undefined }).success);
  assert(!investigationRequestSchema.safeParse({ ...valid, source: undefined }).success);
  assert(!investigationRequestSchema.safeParse({ ...valid, sequence: [event('evt_1'), event('evt_2', undefined, undefined, true, 1)] }).success);
  assert(!investigationRequestSchema.safeParse({ ...valid, sequence: Array(13).fill(event('evt_1')) }).success);
  assert.equal(trainingTrials('custom', valid.sequence)[0].batches[0][0].id, 'evt_1');
});
test('fresh audit varies prices, currencies, order and concurrency while preserving coherent snapshots', () => {
  assert.deepEqual(auditTrials(10), auditTrials(10));
  assert.notDeepEqual(auditTrials(10), auditTrials(11));
  for (let seed = 1; seed <= 20; seed++) {
    const suite = auditTrials(seed);
    const all = suite.flatMap(t => t.batches.flat());
    assert.equal(suite.length, 12);
    assert(suite.some(t => t.batches.some(b => b.length === 4)));
    assert(all.some(e => e.data.object.amount_total === 0));
    assert.equal(new Set(all.map(e => e.data.object.currency)).size, 4);
    for (const trial of suite) {
      trial.batches.flat().forEach(e => paymentEventSchema.parse(e));
      const prices = new Map<string, string>();
      for (const e of trial.batches.flat()) {
        const id = e.data.object.id; const price = `${e.data.object.amount_total}:${e.data.object.currency}`;
        if (prices.has(id)) assert.equal(price, prices.get(id));
        prices.set(id, price);
      }
      const expected = expectedShipments(trial.batches.flat());
      assert.equal(expected.size, trial.name.startsWith('Unpaid') ? 0 : 2);
    }
  }
});
