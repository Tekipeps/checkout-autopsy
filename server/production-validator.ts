import { productionRawSchema, type CheckoutSnapshot, type OrderRow, type ProductionStep, type ProductionSuite, type ProductionTrial } from '../shared/production';

const key = (row: OrderRow) => JSON.stringify([row.accountId, row.sessionId]);
const normalized = (rows: OrderRow[]) => rows.map(row => ({ accountId: row.accountId, sessionId: row.sessionId, amount: row.amount, currency: row.currency })).sort((a, b) => key(a).localeCompare(key(b)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const supported = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
export function acceptedSnapshot(event: CheckoutSnapshot) {
  if (event.livemode !== false) return false;
  if (!supported.has(event.type)) return true;
  const o = event.data.object;
  if (o?.mode !== 'payment') return true;
  return Boolean(o && typeof o.id === 'string' && o.id.length && Number.isSafeInteger(o.amount_total) && o.amount_total >= 0 && /^[a-z]{3}$/.test(o.currency) && ['paid', 'unpaid', 'no_payment_required'].includes(o.payment_status) && (o.payment_status !== 'no_payment_required' || o.amount_total === 0));
}
export function expectedOrder(event: CheckoutSnapshot): OrderRow | undefined {
  if (!acceptedSnapshot(event) || !supported.has(event.type) || event.data.object.mode !== 'payment' || !['paid', 'no_payment_required'].includes(event.data.object.payment_status)) return;
  return { accountId: event.account ?? 'platform', sessionId: event.data.object.id, amount: event.data.object.amount_total, currency: event.data.object.currency };
}
function checkState(step: ProductionStep, orders: Map<string, OrderRow>, delivered: Set<string>, effects: Map<string, OrderRow>): string | undefined {
  const wanted = normalized([...orders.values()]);
  if (!same(normalized(step.orders), wanted)) return 'Persisted orders differ from the expected paid checkout identities, amounts or currencies.';
  if (!same(normalized(step.outbox), wanted)) return 'Outbox is missing work, contains duplicates, or is not atomic with orders.';
  for (const row of step.outbox) {
    const wantedRow = orders.get(key(row));
    if (!wantedRow || !same(normalized([row.payload]), normalized([wantedRow]))) return 'Outbox payload differs from the committed checkout.';
    if (row.status !== (delivered.has(key(row)) ? 'delivered' : 'pending')) return 'Outbox delivery state lost retryable work or acknowledged delivery too early.';
  }
  if (!same(normalized(step.effects), normalized([...effects.values()]))) return 'External fulfillment sink observed lost, duplicated, cross-account or incorrect effects.';
  if (new Set(step.effects.map(row => row.key)).size !== step.effects.length || step.effects.some(row => !row.key)) return 'Fulfillment idempotency keys are missing or inconsistent.';
}
export function validateProductionSuite(inputs: ProductionTrial[], raw: unknown): ProductionSuite {
  const evidence = productionRawSchema.parse(raw);
  const checks = inputs.map(input => {
    const matches = evidence.trials.filter(trial => trial.id === input.id);
    let details = 'HTTP acceptance, durable order/outbox state and external effects match the contract.';
    let failedStep: number | undefined;
    const fail = (message: string, index?: number) => { details = message; failedStep = index === undefined ? undefined : index + 1; };
    const observed = matches[0];
    if (matches.length !== 1) fail('Missing or duplicated trial evidence.');
    else if (observed.error) fail(`Runner could not complete the case: ${observed.error}`);
    else if (observed.steps.length !== input.actions.length) fail('Incomplete action evidence.');
    else {
      const orders = new Map<string, OrderRow>(); const delivered = new Set<string>(); const effects = new Map<string, OrderRow>();
      const ingest = (event: CheckoutSnapshot) => { const row = expectedOrder(event); if (row && !orders.has(key(row))) orders.set(key(row), row); };
      for (let index = 0; index < input.actions.length; index++) {
        const action = input.actions[index]; const step = observed.steps[index];
        if (action.kind === 'http') {
          if (step.responses.length !== action.events.length) { fail('Missing HTTP response evidence.', index); break; }
          for (let i = 0; i < action.events.length; i++) {
            const signature = action.signature ?? 'valid';
            const wanted = signature === 'oversized' ? 413 : signature !== 'valid' || !acceptedSnapshot(action.events[i]) ? 400 : 200;
            const response = step.responses[i];
            if (wanted === 200 ? response.status < 200 || response.status >= 300 : response.status !== wanted) {
              fail(`Delivery ${i + 1}: expected ${wanted === 200 ? '2xx' : wanted}, received ${response.status}.`, index); break;
            }
            if (response.elapsedMs > 4000) { fail('Webhook acknowledgment exceeded the four-second test budget.', index); break; }
            if (wanted === 200) ingest(action.events[i]);
          }
          if (failedStep) break;
        } else if (action.kind === 'crash') {
          if (!step.processes.some(p => p.phase === 'service' && p.signal === 'SIGKILL') || step.responses[0]?.status !== 0) { fail('The planned hard process kill did not interrupt acknowledgment.', index); break; }
          if (action.point === 'after-commit') ingest(action.event);
        } else if (action.kind === 'restart') {
          if (!step.processes.some(p => p.phase === 'service' && p.signal === 'SIGKILL')) { fail('Hard restart evidence is missing.', index); break; }
        } else {
          if (action.crashAfterDelivery) {
            if (!step.processes.some(p => p.phase === 'worker' && p.signal === 'SIGKILL')) { fail('The worker was not killed after external acceptance.', index); break; }
            const pending = [...orders].find(([id]) => !delivered.has(id));
            if (pending) effects.set(pending[0], pending[1]);
          } else if (!action.failures) {
            // Plans always provide enough dispatch attempts to drain all work.
            for (const [id, row] of orders) { delivered.add(id); effects.set(id, row); }
            if (step.processes.some(p => p.phase === 'worker' && p.code !== 0)) { fail('Outbox worker crashed or reported a failure.', index); break; }
          } else if (!step.deliveries.some(d => d.status === 503)) {
            fail('The planned fulfillment HTTP failure was not exercised.', index); break;
          }
        }
        const stateFailure = checkState(step, orders, delivered, effects);
        if (stateFailure) { fail(stateFailure, index); break; }
      }
    }
    return { id: input.id, name: input.name, passed: details === 'HTTP acceptance, durable order/outbox state and external effects match the contract.', details, ...(failedStep ? { failedStep } : {}) };
  });
  if (evidence.trials.length !== inputs.length && checks.length) checks[0] = { ...checks[0], passed: false, details: 'Unexpected trial evidence.' };
  return { checks, passed: checks.filter(check => check.passed).length, total: checks.length, evidence };
}
