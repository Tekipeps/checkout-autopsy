/** Recheck saved evidence without executing candidates, contacting models or creating VMs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { productionTrials, type ProductionReport, type ProductionSuite } from '../shared/production';
import { validateProductionSuite } from '../server/production-validator';
import { applyExactEdits } from '../server/production-model';

const path = process.argv[2] ?? 'artifacts/production-latest.json';
const contents = await readFile(path, 'utf8');
const report = JSON.parse(contents) as ProductionReport;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
assert.equal(report.kind, 'node-postgres-validation');
assert.deepEqual(report.inputs, productionTrials(report.seed));
function compare(saved: ProductionSuite, checked: ProductionSuite) {
  assert.equal(saved.passed, checked.passed);
  assert.equal(saved.total, checked.total);
  assert.deepEqual(saved.checks, checked.checks);
}
compare(report.referenceControl, validateProductionSuite(report.inputs, report.referenceControl.evidence));
assert.equal(report.referenceControl.passed, report.referenceControl.total);
const modules = report.cases.map(entry => {
  assert.equal(entry.originalHash, hash(entry.original));
  compare(entry.baseline, validateProductionSuite(report.inputs, entry.baseline.evidence));
  let retained = entry.original; let score = entry.baseline.passed;
  for (const attempt of entry.attempts) {
    assert.equal(attempt.hash, hash(attempt.source));
    compare(attempt.suite, validateProductionSuite(report.inputs, attempt.suite.evidence));
    if (attempt.edits) assert.equal(applyExactEdits(retained, attempt.edits), attempt.source);
    if (attempt.suite.passed >= score) { retained = attempt.source; score = attempt.suite.passed; }
  }
  assert.equal(entry.patch, retained);
  assert.equal(entry.patchHash, hash(entry.patch));
  compare(entry.repaired, validateProductionSuite(report.inputs, entry.repaired.evidence));
  if (entry.audit) {
    assert.equal(entry.audit.candidateHash, entry.patchHash);
    assert.equal(entry.audit.feedbackToModel, false);
    assert.deepEqual(entry.audit.inputs, productionTrials(entry.audit.seed, true));
    compare(entry.audit.baseline, validateProductionSuite(entry.audit.inputs, entry.audit.baseline.evidence));
    compare(entry.audit.candidate, validateProductionSuite(entry.audit.inputs, entry.audit.candidate.evidence));
  }
  const verified = entry.repaired.passed === entry.repaired.total && Boolean(entry.audit && entry.audit.candidate.passed === entry.audit.candidate.total);
  assert.equal(entry.verified, verified);
  return {
    id: entry.id, name: entry.name, originalSHA256: entry.originalHash, candidateSHA256: entry.patchHash,
    original: `${entry.baseline.passed}/${entry.baseline.total}`,
    repairs: entry.attempts.map(attempt => ({ number: attempt.number, model: attempt.model, tokens: attempt.tokens, exactEdits: attempt.edits?.length, passed: attempt.suite.passed, total: attempt.suite.total, sourceSHA256: attempt.hash })),
    audit: entry.audit ? { seed: entry.audit.seed, original: `${entry.audit.baseline.passed}/${entry.audit.baseline.total}`, candidate: `${entry.audit.candidate.passed}/${entry.audit.candidate.total}`, feedbackToModel: entry.audit.feedbackToModel, checks: entry.audit.candidate.checks } : null,
    verified,
  };
});
assert.equal(report.verified, modules.every(entry => entry.verified));
const summary = {
  kind: 'recorded-node-postgres-validation-summary', reportId: report.id,
  startedAt: report.startedAt, finishedAt: report.finishedAt, runtime: report.runtime,
  verified: report.verified, cleanupConfirmed: report.cleanup, sandboxId: report.sandboxId,
  referenceControl: `${report.referenceControl.passed}/${report.referenceControl.total}`,
  repairChecks: { passed: report.cases.reduce((sum, entry) => sum + entry.repaired.passed, 0), total: report.cases.reduce((sum, entry) => sum + entry.repaired.total, 0) },
  frozenAuditChecks: { passed: report.cases.reduce((sum, entry) => sum + (entry.audit?.candidate.passed ?? 0), 0), total: report.cases.reduce((sum, entry) => sum + (entry.audit?.candidate.total ?? 0), 0) },
  modules, fullReportSHA256: hash(contents), runtimeArchiveSHA256: report.harnessHash,
  evidenceRechecked: 'All reported checks recomputed; source hashes, exact edit application, audit seeds and frozen candidate bindings verified. No candidate code executed on the host.',
  limitations: report.limitations,
};
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/node-postgres.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ verified: summary.verified, cleanupConfirmed: summary.cleanupConfirmed, reference: summary.referenceControl, repair: summary.repairChecks, audit: summary.frozenAuditChecks, modules: modules.map(entry => ({ id: entry.id, modelCalls: entry.repairs.length, audit: entry.audit?.candidate })) }, null, 2));
