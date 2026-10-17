import type { Incident, PaymentEvent, Trial } from './types';

export function event(id: string, session = 'cs_demo_1042', type = 'checkout.session.completed', paid = true, amount = 8900): PaymentEvent {
  return { id, type, data: { object: { id: session, payment_status: paid ? 'paid' : 'unpaid', amount_total: amount, currency: 'usd' } } };
}
const paid = event('evt_checkout_01');
export const incidents: Incident[] = [
  { id: 'duplicate', title: 'The duplicate delivery', subtitle: 'One checkout. Three deliveries.', tag: 'RETRY STORM',
    description: 'A successful checkout is delivered three times. Every handler call succeeds, but the store ships the same order three times.',
    events: [paid, paid, paid] },
  { id: 'semantic', title: 'Different event. Same order.', subtitle: 'Event IDs are not order IDs.', tag: 'SEMANTIC DUPLICATE',
    description: 'Two distinct paid events refer to the same checkout. Deduplicating only by event ID still produces duplicate fulfillment.',
    events: [paid, event('evt_async_02', undefined, 'checkout.session.async_payment_succeeded'), event('evt_paid_03')] },
  { id: 'async', title: 'The payment that wasn’t paid', subtitle: 'Completed doesn’t always mean paid.', tag: 'DELAYED PAYMENT',
    description: 'A checkout completes before its delayed payment settles. The handler must wait for payment, then fulfill exactly once despite retries.',
    events: [event('evt_pending_01', undefined, undefined, false), event('evt_settled_02', undefined, 'checkout.session.async_payment_succeeded'), event('evt_settled_02', undefined, 'checkout.session.async_payment_succeeded')] },
];
export function incidentTrial(incidentId: string, sequence?: PaymentEvent[]): Trial {
  if (incidentId === 'custom' && sequence?.length) return { id: 'incident', name: 'Your imported delivery sequence', batches: sequence.map(e => [e]) };
  const incident = incidents.find(i => i.id === incidentId);
  if (!incident) throw new Error('Unknown incident');
  return { id: 'incident', name: incident.title, batches: (sequence ?? incident.events).map(e => [e]) };
}

// Generated only after repair stops. No audit inputs or outcomes go to the model.
// Seeded variations cover combinations, not just renamed canned incidents.
export function auditTrials(seed: number): Trial[] {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state; };
  const key = () => next().toString(36);
  const shuffle = <T,>(items: T[]) => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) { const j = next() % (i + 1); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  };
  return Array.from({ length: 12 }, (_, i) => {
    const currency = ['eur', 'gbp', 'usd', 'jpy'][i % 4];
    const amount = i === 0 ? 0 : 1 + next() % 99_999;
    const session = `cs_audit_${key()}`;
    const make = (type = 'checkout.session.completed', paid = true) => {
      const value = event(`evt_audit_${key()}`, session, type, paid, amount);
      value.data.object.currency = currency; return value;
    };
    const p = make(); const a = make('checkout.session.async_payment_succeeded'); const u = make(undefined, false);
    const other = make(); other.data.object.id = `cs_audit_${key()}`;
    other.data.object.amount_total = 1 + next() % 99_999;
    other.data.object.currency = ['gbp', 'jpy', 'eur', 'usd'][i % 4];
    const irrelevant = make('customer.created');
    const noPayment = make(); noPayment.data.object.id = `cs_audit_${key()}`; noPayment.data.object.payment_status = 'no_payment_required';
    const patterns = [
      { name: 'Mixed sessions · permuted deliveries', batches: shuffle([p, a, p, other, other, u, irrelevant, noPayment]).map(e => [e]) },
      { name: 'Concurrent retries · two sessions', batches: [shuffle([p, a, p, other]), shuffle([u, irrelevant, noPayment]), [other]] },
      { name: 'Delayed and reordered · two sessions', batches: [[u], [other], [a], [p], [a], [noPayment], [irrelevant]] },
      { name: 'Unpaid and irrelevant · zero fulfillment', batches: shuffle([u, u, noPayment, irrelevant]).map(e => [e]) },
    ];
    return { id: `audit-${i + 1}`, name: `${patterns[i % 4].name} · ${currency.toUpperCase()}`, batches: patterns[i % 4].batches };
  });
}
export function trainingTrials(incidentId: string, sequence?: PaymentEvent[]): Trial[] {
  return [incidentTrial(incidentId, sequence),
    { id: 'paid', name: 'A paid checkout is fulfilled', batches: [[event('evt_paid')]] },
    { id: 'unpaid', name: 'An unpaid checkout stays unfulfilled', batches: [[event('evt_unpaid', 'cs_waiting', undefined, false)]] },
    { id: 'irrelevant', name: 'Unrelated events have no side effects', batches: [[event('evt_customer', 'cs_unrelated', 'customer.created')]] },
  ];
}
export function hiddenTrials(seed: number): Trial[] {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state; };
  const key = () => next().toString(36);
  const sid = `cs_holdout_${key()}`;
  const p = event(`evt_${key()}`, sid);
  const a = event(`evt_${key()}`, sid, 'checkout.session.async_payment_succeeded');
  const u = event(`evt_${key()}`, sid, undefined, false);
  const other = event(`evt_${key()}`, `cs_holdout_${key()}`, undefined, true, 12900);
  const tests: Trial[] = [
    { id: 'hidden-retry', name: 'Repeated delivery · fresh IDs', batches: [[p], [p], [p], [p]] },
    { id: 'hidden-semantic', name: 'Distinct events · same checkout', batches: [[p], [a]] },
    { id: 'hidden-delayed', name: 'Pending → settled → retry', batches: [[u], [a], [a]] },
    { id: 'hidden-reordered', name: 'Settled arrives before completed', batches: [[a], [u], [p]] },
    { id: 'hidden-multiple', name: 'Two checkouts stay independent', batches: [[p], [other], [a], [other]] },
    { id: 'hidden-concurrent', name: 'Four simultaneous deliveries', batches: [[p, a, p, event(`evt_${key()}`, sid)]] },
    { id: 'hidden-noop', name: 'Empty replay creates no shipments', batches: [] },
    { id: 'hidden-only-unpaid', name: 'Repeated unpaid notifications', batches: [[u], [u]] },
  ];
  return tests;
}
