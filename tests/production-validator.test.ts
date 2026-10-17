import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionTrials, type OrderRow, type ProductionRaw, type ProductionStep, type ProductionTrial } from '../shared/production';
import { expectedOrder, validateProductionSuite } from '../server/production-validator';
import { productionMutants } from '../server/production-run';
import { readFile } from 'node:fs/promises';

const event = productionTrials(42)[0].actions[0];
assert(event.kind === 'http');
const checkout = event.events[0]; const order = expectedOrder(checkout)!;
const outbox = { ...order, id: 'stable-queue-id', payload: order, status: 'pending' as const };
const empty = (): ProductionStep => ({ responses: [], processes: [], orders: [], outbox: [], effects: [], deliveries: [] });
const raw = (input: ProductionTrial, steps: ProductionStep[]): ProductionRaw => ({ runtime: { node: 'test', postgres: 'test', stripe: 'test', express: 'test', pg: 'test' }, trials: [{ id: input.id, steps }] });
const paid: ProductionTrial = { id: 'paid', name: 'Signed HTTP → durable queue → effect', actions: [{ kind: 'http', events: [checkout] }, { kind: 'dispatch', count: 1 }] };
function correct() {
  const queued: ProductionStep = { ...empty(), responses: [{ status: 200, elapsedMs: 4 }], orders: [order], outbox: [outbox] };
  const delivered: ProductionStep = { ...empty(), orders: [order], outbox: [{ ...outbox, status: 'delivered' }], effects: [{ ...order, key: outbox.id }], deliveries: [{ key: outbox.id, payload: order, status: 200 }], processes: [{ phase: 'worker', signal: null, code: 0 }] };
  return raw(paid, [queued, delivered]);
}
test('production oracle accepts matching HTTP, PostgreSQL, outbox and external-effect evidence', () => {
  assert.equal(validateProductionSuite([paid], correct()).passed, 1);
});
test('successful HTTP status cannot hide a missing outbox, wrong currency, or early delivery acknowledgment', () => {
  for (const mutation of [
    (evidence: ProductionRaw) => { evidence.trials[0].steps[0].outbox = []; },
    (evidence: ProductionRaw) => { evidence.trials[0].steps[0].orders[0].currency = 'xxx'; },
    (evidence: ProductionRaw) => { evidence.trials[0].steps[0].outbox[0].status = 'delivered'; },
    (evidence: ProductionRaw) => { evidence.trials[0].steps[1].effects.push({ ...order, key: 'new-key' }); },
  ]) { const evidence = structuredClone(correct()); mutation(evidence); assert.equal(validateProductionSuite([paid], evidence).passed, 0); }
});
test('a forged request must be rejected even if it caused no database writes', () => {
  const input: ProductionTrial = { id: 'forged', name: 'Forged signature', actions: [{ kind: 'http', events: [checkout], signature: 'forged' }] };
  const step = { ...empty(), responses: [{ status: 200, elapsedMs: 2 }] };
  assert.equal(validateProductionSuite([input], raw(input, [step])).passed, 0);
  step.responses[0].status = 400;
  assert.equal(validateProductionSuite([input], raw(input, [step])).passed, 1);
});
test('post-commit crash requires real kill evidence, lost acknowledgment, and both durable records', () => {
  const input: ProductionTrial = { id: 'crash', name: 'Crash after commit', actions: [{ kind: 'crash', event: checkout, point: 'after-commit' }] };
  const step: ProductionStep = { ...empty(), responses: [{ status: 0, elapsedMs: 2 }], processes: [{ phase: 'service', code: null, signal: 'SIGKILL' }], orders: [order], outbox: [outbox] };
  assert.equal(validateProductionSuite([input], raw(input, [step])).passed, 1);
  const absent = structuredClone(step); absent.outbox = [];
  assert.equal(validateProductionSuite([input], raw(input, [absent])).passed, 0);
  const acknowledged = structuredClone(step); acknowledged.responses[0].status = 200;
  assert.equal(validateProductionSuite([input], raw(input, [acknowledged])).passed, 0);
});
test('missing, duplicated or substituted trial evidence cannot verify a module', () => {
  const evidence = correct(); evidence.trials[0].id = 'substituted';
  assert.equal(validateProductionSuite([paid], evidence).passed, 0);
  const duplicate = correct(); duplicate.trials.push(structuredClone(duplicate.trials[0]));
  assert.equal(validateProductionSuite([paid], duplicate).passed, 0);
});
test('production audit is reproducible and changes inputs only after receiving a new seed', () => {
  const first = productionTrials(10, true);
  assert.deepEqual(first, productionTrials(10, true));
  assert.notDeepEqual(first, productionTrials(11, true));
  assert(first.some(t => t.actions.some(a => a.kind === 'http' && a.events.length === 16)));
  assert(first.some(t => t.actions.some(a => a.kind === 'dispatch' && a.crashAfterDelivery)));
  assert(first.every(t => t.id.startsWith('audit-')));
  const secondAccount = structuredClone(checkout); secondAccount.account = 'acct_second';
  assert.notDeepEqual(expectedOrder(secondAccount), order);
});
test('one-time zero-total checkout is fulfilled while subscription and setup sessions are excluded', () => {
  const zero = structuredClone(checkout); zero.data.object.payment_status = 'no_payment_required'; zero.data.object.amount_total = 0;
  assert.equal(expectedOrder(zero)?.amount, 0);
  for (const mode of ['subscription', 'setup'] as const) { const other = structuredClone(zero); other.data.object.mode = mode; assert.equal(expectedOrder(other), undefined); }
  zero.data.object.amount_total = 1;
  assert.equal(expectedOrder(zero), undefined);
});
test('mutation controls change only the intended failure mechanisms', async () => {
  const source = await readFile(new URL('../sandbox/production/reference.mjs', import.meta.url), 'utf8');
  const controls = productionMutants(source);
  assert.equal(controls.length, 3);
  assert(controls.every(control => control.source !== source));
  assert(controls[0].source.includes('JSON.parse(req.body'));
  assert(controls[1].source.includes('// No atomic commit.'));
  assert(controls[2].source.includes('String(Date.now()) + Math.random()'));
});
