import { z } from 'zod';
import { rawTrialSchema, type CheckResult, type PaymentEvent, type RawTrial, type SuiteResult, type Trial } from '../shared/types';

const fulfillable = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
export function expectedShipments(events: PaymentEvent[]) {
  const orders = new Map<string, { amount: number; currency: string }>();
  for (const e of events) if (fulfillable.has(e.type) && e.data.object.payment_status === 'paid') {
    const o = e.data.object;
    if (!orders.has(o.id)) orders.set(o.id, { amount: o.amount_total, currency: o.currency });
  }
  return orders;
}
export function validateSuite(input: Trial[], raw: unknown, hidden = false): SuiteResult {
  const trials = z.array(rawTrialSchema).max(30).parse(raw);
  const checks = input.map(trial => {
    const output = trials.filter(t => t.id === trial.id);
    let details = 'Exactly one shipment per paid checkout; no unpaid fulfillment.';
    const fail = (why: string) => { details = why; return false; };
    let passed = true;
    let counterexample: CheckResult['counterexample'];
    if (output.length !== 1) passed = fail('Missing or duplicate trial evidence.');
    const observed = output[0];
    if (passed && observed.steps.length !== trial.batches.length) passed = fail('Incomplete replay evidence.');
    const seen: PaymentEvent[] = [];
    if (passed) for (let index = 0; index < trial.batches.length; index++) {
      const batch = trial.batches[index];
      const step = observed.steps[index];
      seen.push(...batch);
      counterexample = { step: index + 1, delivered: batch, expected: [...expectedShipments(seen)].map(([sessionId, value]) => ({ sessionId, ...value })), observed: step.shipments, exitCodes: step.exitCodes };
      if (JSON.stringify(step.eventIds) !== JSON.stringify(batch.map(e => e.id)) || step.exitCodes.length !== batch.length) {
        passed = fail(`Step ${index + 1}: evidence does not match the requested delivery.`); break;
      }
      if (step.exitCodes.some(code => code !== 0)) { passed = fail(`Step ${index + 1}: handler crashed or timed out.`); break; }
      const expected = expectedShipments(seen);
      if (step.shipments.length !== expected.size) {
        passed = fail(`Step ${index + 1}: expected ${expected.size} shipment${expected.size === 1 ? '' : 's'}, found ${step.shipments.length}.`); break;
      }
      const ids = new Set<string>();
      for (const row of step.shipments) {
        const wanted = expected.get(row.sessionId);
        if (!wanted) { passed = fail(`Step ${index + 1}: unexpected shipment for ${row.sessionId}.`); break; }
        if (ids.has(row.sessionId)) { passed = fail(`Step ${index + 1}: duplicate shipment for ${row.sessionId}.`); break; }
        if (wanted.amount !== row.amount || wanted.currency !== row.currency) {
          passed = fail(`Step ${index + 1}: ${row.sessionId} expected ${wanted.amount} ${wanted.currency.toUpperCase()}, found ${row.amount} ${row.currency.toUpperCase()}.`); break;
        }
        ids.add(row.sessionId);
      }
      if (!passed) break;
    }
    return { id: trial.id, name: trial.name, passed, details, hidden, ...(!passed && counterexample ? { counterexample } : {}) };
  });
  // Extra output cannot substitute for a missing requested trial.
  if (trials.length !== input.length && checks.length) checks[0] = { ...checks[0], passed: false, details: 'Unexpected trial evidence.' };
  return { checks, passed: checks.filter(c => c.passed).length, total: checks.length, trials };
}
export function finalShipments(trial: RawTrial | undefined) { return trial?.steps.at(-1)?.shipments ?? []; }
