import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { auditTrials, hiddenTrials, trainingTrials } from '../shared/fixtures';
import type { InvestigationRequest, RunEvent, RunResult, SuiteResult } from '../shared/types';
import { executeSuite, openSandbox, readAsset } from './executor';
import { generatePatch, modelConfig } from './model';
import { validateSuite } from './validator';

async function saveReport(result: RunResult) {
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL(`../artifacts/${result.id}.json`, import.meta.url), JSON.stringify(result, null, 2), { mode: 0o600 });
}
interface Dependencies {
  openSandbox: typeof openSandbox;
  executeSuite: typeof executeSuite;
  generatePatch: typeof generatePatch;
  saveReport: typeof saveReport;
  newSeed: () => number;
}
export async function investigate(
  options: InvestigationRequest,
  emit: (event: RunEvent) => void,
  signal: AbortSignal,
  overrides: Partial<Dependencies> = {},
): Promise<RunResult> {
  const deps: Dependencies = { openSandbox, executeSuite, generatePatch, saveReport, newSeed: () => randomBytes(4).readUInt32BE(), ...overrides };
  const startedAt = new Date().toISOString();
  const log = (message: string) => emit({ type: 'log', time: new Date().toISOString(), message });
  if (options.mode === 'agent' && !modelConfig().key) throw new Error('Live agent needs a model credential. Guided sandbox mode uses the reference repair.');
  const original = options.source ?? await readAsset('fixtures/buggy_handler.py');
  const train = trainingTrials(options.incidentId, options.sequence);
  const seed = deps.newSeed();
  // These fixtures are not included in the initial repair prompt.
  const hidden = hiddenTrials(seed);
  const all = [...train, ...hidden];
  log('Preparing a disposable CreateOS micro-VM · Python 3 · private ingress.');
  const sandbox = await deps.openSandbox(signal);
  log(`Sandbox ${sandbox.id} ready. Model credentials stay on the server.`);
  let result: RunResult | undefined;
  try {
    log(`Replaying the original handler against ${all.length} checks, including simultaneous delivery.`);
    const first = await deps.executeSuite(sandbox, original, all, signal);
    const baseline = validateSuite(all, first.raw);
    baseline.checks = baseline.checks.map(c => ({ ...c, hidden: c.id.startsWith('hidden-') }));
    emit({ type: 'baseline', time: new Date().toISOString(), message: `${baseline.total - baseline.passed} business-invariant checks failed.`, data: baseline });
    let feedback: unknown = {
      checks: baseline.checks.filter(c => !c.hidden),
      cases: train.map(input => ({ input, observed: baseline.trials.find(t => t.id === input.id) })),
    };
    let previous = original;
    let repaired: SuiteResult = baseline;
    const attempts: RunResult['attempts'] = [];
    let execMs = first.execMs;
    const alreadyPasses = baseline.passed === baseline.total;
    if (alreadyPasses) {
      log('The original handler passes this suite. No repair or model call is needed.');
      emit({ type: 'source', time: new Date().toISOString(), message: 'Original handler retained unchanged.', data: { source: original, number: 0, hash: createHash('sha256').update(original).digest('hex') } });
    }
    for (let number = 1; number <= (alreadyPasses ? 0 : options.mode === 'agent' ? 3 : 1); number++) {
      signal.throwIfAborted();
      log(options.mode === 'agent' ? `Agent writing repair ${number}/3 from observed database evidence…` : 'Guided mode: loading the published reference repair. No AI generation is claimed.');
      const generated = options.mode === 'agent'
        ? await deps.generatePatch(original, previous, feedback, signal)
        : { source: await readAsset('fixtures/reference_patch.py'), model: null, tokens: undefined };
      const { source } = generated;
      const hash = createHash('sha256').update(source).digest('hex');
      emit({ type: 'source', time: new Date().toISOString(), message: `Candidate ${number} · SHA-256 ${hash.slice(0, 12)}`, data: { source, number, hash } });
      log('Running the candidate in CreateOS. The server checks every committed database snapshot.');
      const execution = await deps.executeSuite(sandbox, source, all, signal);
      repaired = validateSuite(all, execution.raw);
      repaired.checks = repaired.checks.map(c => ({ ...c, hidden: c.id.startsWith('hidden-') }));
      execMs += execution.execMs;
      const attempt = { number, source, hash, checks: repaired.checks, execMs: execution.execMs, exitCode: execution.exitCode, model: generated.model, tokens: generated.tokens };
      attempts.push(attempt);
      emit({ type: 'attempt', time: new Date().toISOString(), message: `Repair ${number}: ${repaired.passed}/${repaired.total} checks passed.`, data: attempt });
      previous = source;
      if (repaired.passed === repaired.total) break;
      // On failure, the next attempt sees actual failing evidence, including holdouts.
      // They are no longer unseen on that subsequent attempt; report this honestly.
      const failed = repaired.checks.filter(c => !c.passed);
      const failedIds = new Set(failed.map(c => c.id));
      feedback = {
        checks: failed,
        cases: all.filter(t => failedIds.has(t.id)).map(input => ({ input, observed: repaired.trials.find(t => t.id === input.id) })),
        runtimeFacts: failedIds.has('hidden-concurrent') ? [
          'The connection uses sqlite3 LEGACY_TRANSACTION_CONTROL with isolation_level DEFERRED.',
          'Entering with db does not open a transaction. In this mode SELECT does not start an implicit write transaction.',
          'shipments.session_id has no UNIQUE constraint. Catching IntegrityError cannot deduplicate sessions.',
          'Concurrent tests add 60ms SELECT latency to expose check-then-write races. Serialize the whole read/check/write operation before reading shipment state.',
        ] : [],
      };
    }
    let audit: RunResult['audit'];
    if (repaired.passed === repaired.total) {
      const candidateHash = createHash('sha256').update(previous).digest('hex');
      log(`Patch frozen · SHA-256 ${candidateHash.slice(0, 12)}. Generating a fresh audit; no results will go back to the model.`);
      const auditSeed = deps.newSeed();
      const inputs = auditTrials(auditSeed);
      const before = await deps.executeSuite(sandbox, original, inputs, signal);
      const after = await deps.executeSuite(sandbox, previous, inputs, signal);
      execMs += before.execMs + after.execMs;
      audit = { seed: auditSeed, candidateHash, inputs, baseline: validateSuite(inputs, before.raw, true), candidate: validateSuite(inputs, after.raw, true), feedbackToModel: false };
      log(`Frozen-patch audit: ${audit.candidate.passed}/${audit.candidate.total} passed. ${audit.candidate.passed === audit.candidate.total ? 'Fresh sequences verified.' : 'Audit failed; the patch stays frozen and verification is withheld.'}`);
    } else {
      log('Repair suite incomplete. Final audit skipped; verification withheld.');
    }
    result = {
      id: randomUUID(), mode: options.mode, incidentId: options.incidentId, startedAt,
      finishedAt: new Date().toISOString(), sandboxId: sandbox.id,
      model: options.mode === 'agent' && attempts.length ? attempts.at(-1)?.model ?? modelConfig().model : null, seed,
      baseline, repaired, original, patch: previous, attempts,
      verified: repaired.passed === repaired.total && audit?.candidate.passed === audit?.candidate.total && Boolean(audit), cleanup: false, execMs, inputs: all, audit,
      limitation: 'Synthetic, already-authenticated checkout fixtures under the documented Python/SQLite contract. Verifies persisted shipment records for these cases; not proof of production correctness or physical exactly-once shipping. Real signature verification, external fulfillment and production outbox delivery are outside this lab. Repair holdouts are unseen only on the first model attempt. Final audit inputs are generated after the patch freezes and never returned to the model; a failed audit withholds verification. The in-VM driver is not an adversarially tamper-proof grader.',
    };
  } finally {
    log('Destroying the disposable sandbox.');
    try {
      await sandbox.destroy({ timeoutMs: 20_000 });
      await sandbox.waitUntilDestroyed({ timeoutMs: 20_000 });
      if (result) result.cleanup = true;
      log('Sandbox destroyed. No compute left running.');
    } catch {
      log(`Cleanup needs attention: sandbox ${sandbox.id} could not be confirmed destroyed. Remove it with the CreateOS CLI.`);
    }
  }
  if (!result) throw new Error('Investigation did not produce a result.');
  result.finishedAt = new Date().toISOString();
  await deps.saveReport(result);
  emit({ type: 'result', time: new Date().toISOString(), message: result.verified ? 'Repair and frozen-patch audit both passed.' : 'Verification withheld: repair or final audit did not pass.', data: result });
  return result;
}
