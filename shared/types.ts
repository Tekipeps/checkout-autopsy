import { z } from 'zod';

export const paymentEventSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(120),
  data: z.object({ object: z.object({
    id: z.string().min(1).max(100),
    payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
    amount_total: z.number().int().nonnegative().max(100_000_000),
    currency: z.string().regex(/^[a-z]{3}$/),
  }) }),
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;
export const replaySequenceSchema = z.array(paymentEventSchema).min(1).max(12);
export const investigationRequestSchema = z.object({
  incidentId: z.enum(['duplicate', 'semantic', 'async', 'custom']),
  mode: z.enum(['sandbox', 'agent']),
  sequence: replaySequenceSchema.optional(),
  source: z.string().min(10).max(20_000).optional(),
}).superRefine((value, ctx) => {
  if (value.incidentId === 'custom' && (!value.sequence || !value.source)) {
    ctx.addIssue({ code: 'custom', message: 'Custom investigations require a handler and replay events.' });
  }
  // One checkout snapshot has a stable price/currency; contradictory fixtures
  // would make concurrent first-writer expectations ambiguous.
  const snapshots = new Map<string, string>();
  for (const event of value.sequence ?? []) {
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) continue;
    const checkout = event.data.object;
    const price = `${checkout.amount_total}:${checkout.currency}`;
    if (snapshots.has(checkout.id) && snapshots.get(checkout.id) !== price) {
      ctx.addIssue({ code: 'custom', message: 'A checkout must keep the same amount and currency across deliveries.' });
    }
    snapshots.set(checkout.id, price);
  }
});
export type InvestigationRequest = z.infer<typeof investigationRequestSchema>;
export interface Trial { id: string; name: string; batches: PaymentEvent[][] }
export interface Incident {
  id: string; title: string; subtitle: string; tag: string; description: string;
  events: PaymentEvent[];
}
const shipmentSchema = z.object({ sessionId: z.string(), amount: z.number().int(), currency: z.string() });
export const rawTrialSchema = z.object({
  id: z.string(),
  steps: z.array(z.object({
    eventIds: z.array(z.string()),
    exitCodes: z.array(z.number().int()),
    stdout: z.array(z.string().max(10_000)),
    stderr: z.array(z.string().max(10_000)),
    shipments: z.array(shipmentSchema).max(100),
  })).max(40),
});
export type Shipment = z.infer<typeof shipmentSchema>;
export type RawTrial = z.infer<typeof rawTrialSchema>;
export interface CheckResult {
  id: string; name: string; passed: boolean; details: string; hidden: boolean;
  counterexample?: { step: number; delivered: PaymentEvent[]; expected: Shipment[]; observed: Shipment[]; exitCodes: number[] };
}
export interface SuiteResult { checks: CheckResult[]; passed: number; total: number; trials: RawTrial[] }
export interface RunEvent { type: 'log' | 'baseline' | 'source' | 'attempt' | 'result' | 'error'; time: string; message: string; data?: unknown }
export interface Attempt { number: number; source: string; hash: string; checks: CheckResult[]; execMs: number; exitCode: number; model?: string | null; tokens?: number }
export interface FrozenAudit {
  seed: number; candidateHash: string; inputs: Trial[];
  baseline: SuiteResult; candidate: SuiteResult;
  feedbackToModel: false;
}
export interface RunResult {
  id: string; mode: 'sandbox' | 'agent'; incidentId: string; startedAt: string; finishedAt: string;
  sandboxId: string; model: string | null; seed: number;
  baseline: SuiteResult; repaired: SuiteResult; original: string; patch: string; attempts: Attempt[];
  verified: boolean; cleanup: boolean; execMs: number;
  inputs: Trial[];
  audit?: FrozenAudit;
  limitation: string;
}
export interface AppConfig { sandboxConfigured: boolean; modelConfigured: boolean; model: string | null }
