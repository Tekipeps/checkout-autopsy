import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Sandbox } from '@nodeops-createos/sandbox';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { productionTrials, type ProductionCaseResult, type ProductionReport, type ProductionSuite, type ProductionTrial } from '../shared/production';
import type { RunEvent } from '../shared/types';
import { openSandbox, readAsset } from './executor';
import { modelConfig } from './model';
import { generateNodeEdits } from './production-model';
import { validateProductionSuite } from './production-validator';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (source: string | Uint8Array) => createHash('sha256').update(source).digest('hex');
const newSeed = () => randomBytes(4).readUInt32BE();
const exec = promisify(execFile);
interface Progress { startedAt: string; seed: number; sandboxId: string; harnessHash?: string; cases: ProductionCaseResult[]; complete: false }
export function productionMutants(reference: string) {
  const [http, worker] = reference.split('export async function dispatchOne');
  const mutants = [
    { id: 'missing-signature', name: 'Mutation control: signature verification bypass', source: reference.replace("Stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], signingSecret)", "JSON.parse(req.body.toString('utf8'))") },
    { id: 'split-transaction', name: 'Mutation control: order and outbox commit separately', source: http.replace("await client.query('BEGIN');", '// Unsafe: order and outbox are separate autocommit writes.').replace("await client.query('COMMIT');", '// No atomic commit.') + 'export async function dispatchOne' + worker },
    { id: 'unstable-delivery-key', name: 'Mutation control: new fulfillment key on every retry', source: reference.replace('await deliver(row.payload, row.id);', 'await deliver(row.payload, String(Date.now()) + Math.random());') },
  ];
  if (mutants.some(m => m.source === reference)) throw new Error('A production mutation did not change the reference source.');
  return mutants;
}

export async function runProductionValidation(options: { source?: string }, emit: (event: RunEvent) => void, signal: AbortSignal, leasedSandbox?: Sandbox): Promise<ProductionReport> {
  if (!modelConfig().key) throw new Error('Live model credentials are required for Node/PostgreSQL repair.');
  const log = (message: string) => emit({ type: 'log', time: new Date().toISOString(), message });
  let checkpoint: Progress | undefined;
  if (leasedSandbox) {
    try { const prior = JSON.parse(await readFile(`${root}artifacts/production-progress.json`, 'utf8')) as Progress; if (prior.sandboxId === leasedSandbox.id) checkpoint = prior; }
    catch { /* A new development session has no checkpoint. */ }
  }
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString(); const seed = checkpoint?.seed ?? newSeed();
  const inputs = productionTrials(seed);
  const reference = await readAsset('sandbox/production/reference.mjs');
  try { await access(`${root}sandbox/production/node_modules/@embedded-postgres/linux-x64/native/bin/postgres`); }
  catch { throw new Error('Pinned Linux/x64 production runtime is missing. Run npm ci --prefix sandbox/production --ignore-scripts on a Linux/x64 host before validation.'); }
  const corpus = options.source ? [{ id: 'custom-node', name: 'Imported Node/Express/PostgreSQL module', source: options.source }] : productionMutants(reference);
  await mkdir(`${root}artifacts`, { recursive: true });
  log('Packaging the pinned Node/Stripe/PostgreSQL runtime. No credentials are included.');
  const archive = `${root}artifacts/production-runtime.tgz`;
  await exec('tar', ['--exclude=database', '--exclude=database-config.json', '-czf', archive, '-C', `${root}sandbox/production`, '.'], { timeout: 60_000, maxBuffer: 2000 });
  const assets = await readFile(archive);
  const harnessHash = hash(assets);
  if (checkpoint?.harnessHash && checkpoint.harnessHash !== harnessHash) throw new Error('Cannot resume a validation after changing its runtime archive. Start a separate campaign.');
  log(`Creating one private CreateOS sandbox for ${corpus.length} module(s), ${inputs.length} repair checks each, plus independent frozen audits.`);
  const sandbox = leasedSandbox ?? await openSandbox(signal);
  log(`Production validation sandbox ${sandbox.id}. No Stripe or model credential enters the VM.`);
  const cases: ProductionCaseResult[] = [];
  const saveProgress = () => writeFile(`${root}artifacts/production-progress.json`, JSON.stringify({ startedAt, seed, sandboxId: sandbox.id, harnessHash, cases, complete: false }, null, 2), { mode: 0o600 });
  let report: ProductionReport | undefined;
  try {
    // Fixed-path writes are idempotent; retry only transient transfer failures.
    const upload = async (path: string, data: string | Blob) => {
      for (let attempt = 1; ; attempt++) {
        try { await sandbox.files.upload(path, data, { signal, timeoutMs: 120_000 }); return; }
        catch (error) { if (attempt >= 3 || signal.aborted || !(error instanceof Error) || !/network|timeout|fetch failed/i.test(error.message)) throw error; log(`Retrying interrupted file transfer ${attempt}/2.`); }
      }
    };
    await upload('/tmp/production-runtime.tgz', new Blob([new Uint8Array(assets)]));
    const setup = await sandbox.runCommand('sh', ['-c', 'mkdir -p /tmp/autopsy-production && tar -xzf /tmp/production-runtime.tgz -C /tmp/autopsy-production && cd /tmp/autopsy-production/node_modules/@embedded-postgres/linux-x64 && node scripts/hydrate-symlinks.js'], { signal, timeoutMs: 30_000 });
    if (setup.result.exit_code !== 0) throw new Error('Production runtime extraction failed.');
    const execute = async (source: string, plan: ProductionTrial[]): Promise<ProductionSuite> => {
      await upload('/tmp/autopsy-production/candidate.mjs', source);
      await upload('/tmp/autopsy-production/inputs.json', JSON.stringify(plan));
      const execution = await sandbox.runCommand('timeout', ['150s', 'node', '/tmp/autopsy-production/runner.mjs', '/tmp/autopsy-production/candidate.mjs', '/tmp/autopsy-production/inputs.json'], { signal, timeoutMs: 165_000 });
      if (execution.result.exit_code !== 0) throw new Error(`Node/PostgreSQL driver exited ${execution.result.exit_code}: ${execution.result.stderr.slice(-1000)}`);
      if (execution.result.stdout.length > 900_000) throw new Error('Production evidence exceeded the output budget.');
      return validateProductionSuite(plan, JSON.parse(execution.result.stdout));
    };
    log('Running the authored reference as a harness control. This is not an AI-generated repair.');
    const referenceControl = await execute(reference, inputs);
    log(`Reference control: ${referenceControl.passed}/${referenceControl.total}.`);
    if (referenceControl.passed !== referenceControl.total) {
      await writeFile(`${root}artifacts/production-control-failed.json`, JSON.stringify({ seed, inputs, source: reference, suite: referenceControl }, null, 2), { mode: 0o600 });
      throw new Error('Production harness control failed; no model results will be claimed. See artifacts/production-control-failed.json.');
    }
    for (const entry of corpus) {
      signal.throwIfAborted();
      const saved = checkpoint?.cases.find(result => result.id === entry.id);
      if (saved && (saved.original !== entry.source || saved.originalHash !== hash(entry.source) || saved.patchHash !== hash(saved.patch))) throw new Error('Cannot resume a checkpoint whose source or hash has changed.');
      log(saved ? `${entry.id}: resuming preserved source and evidence without another model call.` : `${entry.name}: replaying the original module over HTTP and PostgreSQL.`);
      const baseline = saved ? validateProductionSuite(inputs, saved.baseline.evidence) : await execute(entry.source, inputs);
      log(`Original: ${baseline.passed}/${baseline.total}.`);
      const result: ProductionCaseResult = saved ? structuredClone(saved) : { id: entry.id, name: entry.name, original: entry.source, originalHash: hash(entry.source), baseline, patch: entry.source, patchHash: hash(entry.source), attempts: [], repaired: baseline, verified: false };
      if (saved) result.repaired = validateProductionSuite(inputs, saved.repaired.evidence);
      cases.push(result);
      if (result.audit) {
        if (result.audit.candidateHash !== result.patchHash || JSON.stringify(result.audit.inputs) !== JSON.stringify(productionTrials(result.audit.seed, true))) throw new Error('Saved audit source or inputs do not match the checkpoint.');
        result.audit.candidate = validateProductionSuite(result.audit.inputs, result.audit.candidate.evidence);
        result.verified = result.audit.candidate.passed === result.audit.candidate.total;
        log(`${entry.id}: retaining its completed ${result.audit.candidate.passed}/${result.audit.candidate.total} frozen audit. No reroll or model call.`);
        await saveProgress();
        continue;
      }
      let feedback: unknown = failureFeedback(inputs, baseline);
      for (let number = result.attempts.length + 1; result.repaired.passed !== result.repaired.total && number <= 3; number++) {
        const retainedSource = result.patch; const retainedSuite = result.repaired;
        log(`${entry.id}: real AI generation ${number}/3 from observed failures.`);
        const generated = await generateNodeEdits(entry.source, result.patch, feedback, signal);
        result.patch = generated.source; result.patchHash = hash(result.patch);
        const suite = await execute(result.patch, inputs);
        result.attempts.push({ number, source: result.patch, hash: result.patchHash, model: generated.model, tokens: generated.tokens, edits: generated.edits, suite });
        result.repaired = suite;
        log(`${entry.id}: candidate ${number} passed ${suite.passed}/${suite.total}.`);
        if (suite.passed < retainedSuite.passed) {
          log(`${entry.id}: regression rejected; retaining the earlier ${retainedSuite.passed}/${retainedSuite.total} source.`);
          result.patch = retainedSource; result.patchHash = hash(retainedSource); result.repaired = retainedSuite;
          feedback = { ...failureFeedback(inputs, retainedSuite), rejectedRegression: { checks: suite.checks.filter(check => !check.passed), instruction: 'The last edits regressed previously passing behavior and were rejected. Edit the retained previous module.' } };
        } else feedback = failureFeedback(inputs, suite);
        await saveProgress();
      }
      if (result.repaired.passed === result.repaired.total) {
        log(`${entry.id}: patch frozen ${result.patchHash.slice(0, 12)}. Generating final audit; no further model feedback.`);
        if (result.pendingAudit && result.pendingAudit.candidateHash !== result.patchHash) throw new Error('Pending audit is bound to a different candidate.');
        const auditSeed = result.pendingAudit?.seed ?? newSeed(); const auditInputs = result.pendingAudit?.inputs ?? productionTrials(auditSeed, true);
        if (JSON.stringify(auditInputs) !== JSON.stringify(productionTrials(auditSeed, true))) throw new Error('Pending audit inputs do not match their recorded seed.');
        result.pendingAudit = { seed: auditSeed, inputs: auditInputs, candidateHash: result.patchHash };
        await saveProgress();
        const before = await execute(entry.source, auditInputs);
        const after = await execute(result.patch, auditInputs);
        result.audit = { seed: auditSeed, inputs: auditInputs, baseline: before, candidate: after, candidateHash: result.patchHash, feedbackToModel: false };
        delete result.pendingAudit;
        result.verified = after.passed === after.total;
        log(`${entry.id}: frozen audit ${after.passed}/${after.total}. ${result.verified ? 'Verified for these cases.' : 'Verification withheld.'}`);
      }
      // Preserve each completed result even if a later module or provider fails.
      await saveProgress();
    }
    report = {
      kind: 'node-postgres-validation', id: randomUUID(), startedAt, finishedAt: new Date().toISOString(), sandboxId: sandbox.id,
      cleanup: false, seed, inputs, referenceControl, cases, runtime: referenceControl.evidence.runtime, harnessHash,
      verified: cases.every(entry => entry.verified),
      limitations: [
        'Pre-production integration evidence in one disposable Linux VM; not a production certification or universal handler guarantee.',
        'Default corpus consists of three explicitly authored mutations, not independent real-world customer repositories.',
        'Real Express HTTP, official Stripe SDK signature verification, PostgreSQL transactions and separate processes; signed payloads are generated locally with the SDK test helper, not delivered from Stripe infrastructure.',
        'External fulfillment is a real HTTP test recipient that honors stable idempotency keys. Exactly-once effects depend on that recipient contract.',
        'Covers snapshot Checkout events under the supplied schema and module contract. Thin events, arbitrary ORMs, subscription/refund workflows, external API retrieval, multiple hosts and sustained production load are not established.',
        'Model receives failed repair cases; final audit inputs are generated after each patch freezes and never returned to the model.',
        'Candidate code is isolated from the host; the in-VM grader is not adversarially tamper-proof.',
      ],
    };
  } finally {
    if (leasedSandbox) log('The enclosing validation session owns sandbox cleanup; destruction is not yet confirmed.');
    else {
      log('Destroying the Node/PostgreSQL validation sandbox.');
      try { await sandbox.destroy({ timeoutMs: 20_000 }); await sandbox.waitUntilDestroyed({ timeoutMs: 20_000 }); if (report) report.cleanup = true; log('Sandbox destruction confirmed.'); }
      catch { log(`Cleanup needs attention: ${sandbox.id}.`); }
    }
  }
  if (!report) throw new Error('Production validation did not complete.');
  report.finishedAt = new Date().toISOString();
  await writeFile(`${root}artifacts/production-${report.id}.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(`${root}artifacts/production-latest.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  emit({ type: 'result', time: new Date().toISOString(), message: report.verified ? 'All Node/PostgreSQL module audits passed.' : 'Some production-shaped checks failed; inspect the report.', data: report });
  return report;
}

function failureFeedback(inputs: ProductionTrial[], suite: ProductionSuite) {
  return { failures: suite.checks.filter(check => !check.passed).map(check => ({
    check, input: inputs.find(input => input.id === check.id),
    observed: suite.evidence.trials.find(trial => trial.id === check.id),
  })) };
}
