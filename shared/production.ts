import { z } from 'zod';

export interface CheckoutSnapshot {
  id: string; object: 'event'; type: string; created: number; livemode: boolean;
  api_version: string; account?: string;
  data: { object: { id: string; object: 'checkout.session'; mode: 'payment' | 'subscription' | 'setup'; payment_status: string; amount_total: number; currency: string } };
}
export type SignatureVariant = 'valid' | 'missing' | 'forged' | 'stale' | 'tampered' | 'malformed' | 'oversized';
export type ProductionAction =
  | { kind: 'http'; events: CheckoutSnapshot[]; signature?: SignatureVariant }
  | { kind: 'restart' }
  | { kind: 'crash'; event: CheckoutSnapshot; point: 'after-order' | 'after-commit' }
  | { kind: 'dispatch'; count: number; failures?: number; crashAfterDelivery?: boolean };
export interface ProductionTrial { id: string; name: string; actions: ProductionAction[] }

export const orderRowSchema = z.object({ accountId: z.string().max(150), sessionId: z.string().max(150), amount: z.number().int(), currency: z.string().max(10) });
export type OrderRow = z.infer<typeof orderRowSchema>;
export const productionStepSchema = z.object({
  responses: z.array(z.object({ status: z.number().int(), elapsedMs: z.number().nonnegative() })).max(40),
  processes: z.array(z.object({ code: z.number().int().nullable(), signal: z.string().nullable(), phase: z.enum(['service', 'worker']) })).max(10),
  orders: z.array(orderRowSchema).max(50),
  outbox: z.array(orderRowSchema.extend({ id: z.string().max(300), status: z.enum(['pending', 'delivered']), payload: orderRowSchema })).max(50),
  effects: z.array(orderRowSchema.extend({ key: z.string().max(300) })).max(100),
  deliveries: z.array(z.object({ key: z.string().max(300), status: z.number().int(), payload: orderRowSchema })).max(100),
});
export const productionRawSchema = z.object({
  runtime: z.object({ node: z.string(), postgres: z.string(), stripe: z.string(), express: z.string(), pg: z.string() }),
  trials: z.array(z.object({ id: z.string(), steps: z.array(productionStepSchema).max(30), error: z.string().max(2000).optional() })).max(40),
});
export type ProductionRaw = z.infer<typeof productionRawSchema>;
export type ProductionStep = z.infer<typeof productionStepSchema>;
export interface ProductionCheck { id: string; name: string; passed: boolean; details: string; failedStep?: number }
export interface ProductionSuite { checks: ProductionCheck[]; passed: number; total: number; evidence: ProductionRaw }
export interface ProductionAttempt { number: number; source: string; hash: string; model: string; tokens?: number; edits?: { old: string; new: string }[]; suite: ProductionSuite }
export interface ProductionCaseResult {
  id: string; name: string; original: string; originalHash: string; baseline: ProductionSuite;
  patch: string; patchHash: string; attempts: ProductionAttempt[]; repaired: ProductionSuite;
  audit?: { seed: number; inputs: ProductionTrial[]; baseline: ProductionSuite; candidate: ProductionSuite; candidateHash: string; feedbackToModel: false };
  pendingAudit?: { seed: number; inputs: ProductionTrial[]; candidateHash: string };
  verified: boolean;
}
export interface ProductionReport {
  kind: 'node-postgres-validation'; id: string; startedAt: string; finishedAt: string;
  sandboxId: string; cleanup: boolean; seed: number; inputs: ProductionTrial[];
  referenceControl: ProductionSuite; cases: ProductionCaseResult[];
  runtime: ProductionRaw['runtime']; harnessHash: string; verified: boolean;
  limitations: string[];
}
export const productionRequestSchema = z.object({ source: z.string().min(30).max(30_000).optional() });

export function productionTrials(seed: number, audit = false): ProductionTrial[] {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state; };
  const prefix = audit ? 'audit' : 'repair';
  const make = (session?: string, account?: string): CheckoutSnapshot => ({
    id: `evt_${prefix}_${next().toString(36)}`, object: 'event', created: 1_792_240_000,
    livemode: false, api_version: '2026-09-30.endive', ...(account ? { account } : {}),
    type: 'checkout.session.completed',
    data: { object: { id: session ?? `cs_${prefix}_${next().toString(36)}`, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: audit ? next() % 100_000 : 1599, currency: audit ? ['eur', 'gbp', 'usd', 'jpy'][next() % 4] : 'gbp' } },
  });
  const clone = (value: CheckoutSnapshot) => structuredClone(value);
  const deliver = (...events: CheckoutSnapshot[]): ProductionAction => ({ kind: 'http', events });
  const drain = (count = 4): ProductionAction => ({ kind: 'dispatch', count });
  const trial = (id: string, name: string, actions: ProductionAction[]): ProductionTrial => ({ id: `${prefix}-${id}`, name, actions });
  const p = make(); const a = clone(p); a.id = `evt_${prefix}_${next().toString(36)}`; a.type = 'checkout.session.async_payment_succeeded';
  const unpaid = clone(p); unpaid.id = `evt_${prefix}_${next().toString(36)}`; unpaid.data.object.payment_status = 'unpaid';
  const other = make(); other.data.object.amount_total = audit ? next() % 100_000 : 4200; other.data.object.currency = 'eur';
  const ignored = make(); ignored.type = 'customer.created';
  const failed = make(); failed.type = 'checkout.session.async_payment_failed';
  const noPayment = make(); noPayment.data.object.payment_status = 'no_payment_required'; noPayment.data.object.amount_total = 0;
  const subscription = make(); subscription.data.object.mode = 'subscription';
  const setup = make(); setup.data.object.mode = 'setup';
  const wrongMode = make(); wrongMode.livemode = true;
  const malformed = make(); malformed.data.object.amount_total = -1;
  const scoped1 = make(`cs_${prefix}_shared`, `acct_${prefix}_north`); const scoped2 = clone(scoped1); scoped2.account = `acct_${prefix}_south`; scoped2.id = `evt_${prefix}_${next().toString(36)}`;
  const trials: ProductionTrial[] = [
    trial('paid', 'Signed paid checkout → durable outbox → HTTP fulfillment', [deliver(p), drain()]),
    ...(['missing', 'forged', 'stale', 'tampered', 'malformed', 'oversized'] as SignatureVariant[]).map(signature => trial(signature, `Reject ${signature} webhook without side effects`, [{ kind: 'http', events: [p], signature }, drain()])),
    trial('invalid-fields', 'Reject invalid checkout values', [deliver(malformed), drain()]),
    trial('negative', 'Unpaid, failed, unrelated, subscription and setup events stay inert', [deliver(unpaid, ignored, failed, subscription, setup), drain()]),
    trial('zero-checkout', 'Zero-total no-payment-required Checkout is fulfilled exactly once', [deliver(noPayment), deliver(noPayment), drain()]),
    trial('mode', 'Test endpoint rejects a signed live-mode payload', [deliver(wrongMode), drain()]),
    trial('semantic', 'Retries and distinct event IDs fulfill one session once', [deliver(p), deliver(a), deliver(p), drain()]),
    trial('delayed', 'Delayed settlement and reordering preserve one fulfillment', [deliver(unpaid), deliver(a), deliver(p), drain()]),
    trial('multiple', 'Multiple orders preserve exact amounts and currencies', [deliver(p, other), drain()]),
    trial('accounts', 'Account context is part of the durable identity', [deliver(scoped1, scoped2), drain()]),
    trial('concurrent', 'Sixteen simultaneous deliveries share one durable order', [deliver(...Array.from({ length: 16 }, (_, i) => i % 2 ? a : p)), drain()]),
    trial('restart', 'A hard service restart preserves deduplication', [deliver(p), { kind: 'restart' }, deliver(a), drain()]),
    trial('before-commit', 'SIGKILL after order write rolls back the whole transaction', [{ kind: 'crash', event: p, point: 'after-order' }, deliver(p), drain()]),
    trial('after-commit', 'SIGKILL after commit before acknowledgment survives retry', [{ kind: 'crash', event: p, point: 'after-commit' }, deliver(p), drain()]),
    trial('delivery-retry', 'Fulfillment HTTP 503 leaves durable work for retry', [deliver(p), { kind: 'dispatch', count: 1, failures: 1 }, drain()]),
    trial('delivery-crash', 'SIGKILL after external acceptance uses the same idempotency key', [deliver(p), { kind: 'dispatch', count: 1, crashAfterDelivery: true }, drain()]),
    trial('workers', 'Four worker processes safely compete for one outbox row', [deliver(p), drain(4)]),
  ];
  // Audit uses the same documented invariants with fresh values and new delivery
  // combinations. Inputs do not exist until generation has stopped.
  if (audit) {
    const zero = make(); zero.data.object.amount_total = 0; zero.data.object.currency = 'jpy';
    trials.push(trial('fresh-mixed', 'Fresh reordered batches, retries, zero amount and multiple currencies', [deliver(a, zero, other), deliver(unpaid, p), { kind: 'restart' }, deliver(a, other), drain(8)]));
    for (let i = trials.length - 1; i > 0; i--) { const j = next() % (i + 1); [trials[i], trials[j]] = [trials[j], trials[i]]; }
  }
  return trials;
}
