import { useEffect, useRef, useState } from 'react';
import { Database, Download, FileCode2, LoaderCircle, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AppConfig, RunEvent } from '../shared/types';
import type { ProductionCaseResult, ProductionReport } from '../shared/production';

function save(name: string, value: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ProductionValidation({ config, evidenceUrl = '/api/production', readOnly = false }: { config: AppConfig; evidenceUrl?: string; readOnly?: boolean }) {
  const [report, setReport] = useState<ProductionReport | null>(null);
  const [running, setRunning] = useState(false); const [logs, setLogs] = useState<RunEvent[]>([]);
  const [source, setSource] = useState(''); const [custom, setCustom] = useState(false);
  const [error, setError] = useState(''); const abort = useRef<AbortController | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  async function refresh() {
    const response = await fetch(evidenceUrl);
    if (!response.ok) throw new Error('Could not load saved production evidence.');
    const data = await response.json(); setReport(data.report ?? data);
  }
  useEffect(() => { refresh().catch(e => setError(e.message)); return () => abort.current?.abort(); }, []);
  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [logs]);
  async function start() {
    if (running) return;
    setRunning(true); setError(''); setLogs([]); setReport(null);
    const controller = new AbortController(); abort.current = controller;
    try {
      const response = await fetch('/api/production/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(custom ? { source } : {}), signal: controller.signal });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? `Validation HTTP ${response.status}`); }
      if (!response.body) throw new Error('Evidence stream unavailable.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let completed = false;
      const receive = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as RunEvent; setLogs(old => [...old, event]);
        if (event.type === 'result') { setReport(event.data as ProductionReport); completed = true; }
        if (event.type === 'error') throw new Error(event.message);
      };
      for (;;) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let index; while ((index = buffer.indexOf('\n')) !== -1) { receive(buffer.slice(0, index)); buffer = buffer.slice(index + 1); } }
      buffer += decoder.decode(); if (buffer.trim()) receive(buffer);
      if (!completed) throw new Error('Validation stream ended without a final report.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Validation failed.'); }
    finally { setRunning(false); abort.current = null; }
  }
  const repaired = report?.cases.reduce((sum, entry) => sum + entry.repaired.passed, 0) ?? 0;
  const auditPassed = report?.cases.reduce((sum, entry) => sum + (entry.audit?.candidate.passed ?? 0), 0) ?? 0;
  const auditTotal = report?.cases.reduce((sum, entry) => sum + (entry.audit?.candidate.total ?? 0), 0) ?? 0;
  return <div className="production-validation">
    <div className="tab-intro"><span className="incident-tag">NODE / EXPRESS / STRIPE SDK / POSTGRESQL</span><h2>Test the boundary. Keep the evidence.</h2><p>Real HTTP requests, a real PostgreSQL server, separate service and worker processes, and forced crashes. Recorded results establish the cases below; they do not certify arbitrary production systems.</p></div>
    <div className="production-actions"><button className="secondary" disabled={running} onClick={() => refresh().catch(e => setError(e.message))}><RefreshCw size={15} />Refresh saved evidence</button>{report && <button className="secondary" onClick={() => save(`production-validation-${report.id}.json`, JSON.stringify(report, null, 2))}><Download size={15} />Download full evidence</button>}</div>
    {error && <p className="production-error" role="alert">{error}</p>}
    {report ? <>
      <p className={`production-verdict ${report.verified && report.cleanup ? 'passed' : 'failed'}`} role="status">{report.verified ? report.cleanup ? 'All recorded module audits passed. Sandbox destruction confirmed.' : 'Audits passed; sandbox destruction is not yet confirmed.' : 'Verification withheld: one or more module checks failed.'}</p>
      <div className="production-metrics"><div><span>AUTHORED REFERENCE CONTROL</span><strong>{report.referenceControl.passed}/{report.referenceControl.total}</strong><small>Confirms the harness; no AI claim</small></div><div><span>AI REPAIR CHECKS</span><strong>{repaired}/{report.cases.reduce((sum, entry) => sum + entry.repaired.total, 0)}</strong><small>{report.cases.length} explicitly identified modules</small></div><div><span>FROZEN AUDIT CHECKS</span><strong>{auditTotal ? `${auditPassed}/${auditTotal}` : 'Not run'}</strong><small>Fresh inputs; no model feedback</small></div><div><span>CLEANUP</span><strong>{report.cleanup ? 'Destroyed' : 'Unconfirmed'}</strong><small>{report.sandboxId}</small></div></div>
      <p className="production-provenance">Recorded {new Date(report.finishedAt).toLocaleString()} · Node {report.runtime.node} · Express {report.runtime.express} · Stripe SDK {report.runtime.stripe} · PostgreSQL {report.runtime.postgres} · pg {report.runtime.pg}</p>
      {report.cases.map(entry => <CaseEvidence key={entry.id} entry={entry} />)}
      <details className="production-limits" open><summary>What this evidence establishes—and what remains untested</summary><ul>{report.limitations.map(limit => <li key={limit}>{limit}</li>)}</ul><p>Runtime archive SHA-256: <code>{report.harnessHash}</code></p></details>
    </> : !running && <div className="evidence-empty"><Database size={36} /><h3>No recorded Node/PostgreSQL campaign yet.</h3><p>Run the corpus or import a module using the contract below.</p></div>}
    {!readOnly && <section className="production-run-controls"><h3>Run a new validation</h3><p>One CreateOS sandbox per campaign. Default corpus: three deliberately introduced fault mutations. A custom import validates one module. A fresh run uses provider quota and real model calls.</p><label className="production-custom-toggle"><input type="checkbox" checked={custom} disabled={running} onChange={e => setCustom(e.target.checked)} />Import my Node/Express module</label>
      <details><summary>Supported module contract</summary><p>Export <code>createApp({'{pool, signingSecret, expectedLivemode}'})</code> and <code>dispatchOne({'{pool, deliver}'})</code>. The app handles <code>POST /webhook</code> with raw-body signature verification. Use the supplied PostgreSQL pool and fixed <code>orders</code>, <code>outbox</code>, <code>processed_events</code> schema. Call <code>deliver(payload, stableIdempotencyKey)</code> from the worker. The test recipient supports idempotency.</p><p>Only one-time payment-mode Checkout snapshots are in scope. Paid and zero-total no-payment-required sessions need fulfillment; subscription/setup workflows are excluded. No production keys, customer data, external repositories, or arbitrary dependencies.</p><pre className="production-schema">{`orders(account_id TEXT, session_id TEXT, amount BIGINT, currency TEXT)\n  PRIMARY KEY(account_id, session_id)\noutbox(id TEXT PRIMARY KEY, account_id TEXT, session_id TEXT,\n  amount BIGINT, currency TEXT, payload JSONB, status TEXT DEFAULT 'pending')\n  UNIQUE(account_id, session_id), FOREIGN KEY → orders\nprocessed_events(account_id TEXT, event_id TEXT)\n  PRIMARY KEY(account_id, event_id)\npayload = {accountId, sessionId, amount, currency}\nstatus = 'pending' | 'delivered'`}</pre><p>All listed columns are NOT NULL. Use one checked-out client for each transaction and release it afterward. Full contract: <code>server/production-contract.ts</code>.</p></details>
      {custom && <><label htmlFor="node-source">Your JavaScript ESM module</label><textarea id="node-source" className="source-editor" spellCheck={false} value={source} disabled={running} maxLength={30000} onChange={e => setSource(e.target.value)} aria-describedby="node-source-help" /><p id="node-source-help">30–30,000 characters. Candidate code runs only in CreateOS.</p></>}
      <button className="primary" disabled={running || !config.sandboxConfigured || !config.modelConfigured || (custom && source.length < 30)} onClick={start}>{running ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}{running ? 'Validation running…' : custom ? 'Validate imported Node module' : 'Run three-module validation'}</button>
      {logs.length > 0 && <div ref={feed} className="production-feed" role="log" aria-live="polite" aria-label="Production validation execution feed">{logs.map((event, i) => <p key={i}><time>{new Date(event.time).toLocaleTimeString()}</time>{event.message}</p>)}</div>}
    </section>}
  </div>;
}
function CaseEvidence({ entry }: { entry: ProductionCaseResult }) {
  return <section className="production-case"><div className="production-case-heading"><div><span className="incident-tag">{entry.id === 'custom-node' ? 'IMPORTED MODULE' : 'AUTHORED FAULT MUTATION'}</span><h3>{entry.name}</h3></div><span className={`check-badge ${entry.verified ? 'pass' : 'fail'}`}>{entry.verified ? <ShieldCheck size={14} /> : <FileCode2 size={14} />}{entry.verified ? 'AUDIT PASSED' : 'VERIFICATION WITHHELD'}</span></div><p>{entry.attempts.length} real model call(s){entry.attempts.length ? ` · ${entry.attempts.map(a => a.model).join(', ')}` : ' · original retained'}. Original {entry.baseline.passed}/{entry.baseline.total}; repair {entry.repaired.passed}/{entry.repaired.total}; frozen audit {entry.audit ? `${entry.audit.candidate.passed}/${entry.audit.candidate.total}` : 'not run'}.</p><code className="production-hash">{entry.audit ? 'Frozen' : 'Retained'} candidate SHA-256: {entry.patchHash}</code><div className="production-actions"><button className="secondary small" onClick={() => save(`repaired-${entry.id}.mjs`, entry.patch, 'text/javascript')}><Download size={14} />Download repair</button></div>{entry.attempts.some(attempt => attempt.edits?.length) && <details className="production-edit-details"><summary>Inspect exact AI edits</summary>{entry.attempts.map(attempt => attempt.edits?.map((edit, i) => <div className="production-edit" key={`${attempt.number}-${i}`}><p>Attempt {attempt.number}, edit {i + 1} · {attempt.suite.passed}/{attempt.suite.total} repair checks</p><strong>Original</strong><pre>{edit.old}</pre><strong>Replacement</strong><pre>{edit.new}</pre></div>))}</details>}<details><summary>Inspect {entry.repaired.total} repair checks and {entry.audit?.candidate.total ?? 0} fresh audit checks</summary><div className="checks-table-wrap"><table className="checks-table"><thead><tr><th>CHECK</th><th>ORIGINAL</th><th>PATCH</th><th>RESULT</th></tr></thead><tbody>{entry.repaired.checks.map((check, i) => <tr key={check.id}><td>{check.name}<small>REPAIR SUITE · FAILURE FEEDBACK ALLOWED</small></td><td>{entry.baseline.checks[i].passed ? 'PASS' : 'FAIL'}</td><td className={check.passed ? 'green-text' : 'danger-text'}>{check.passed ? 'PASS' : 'FAIL'}</td><td>{check.details}</td></tr>)}{entry.audit?.candidate.checks.map((check, i) => <tr key={check.id}><td>{check.name}<small>FRESH AUDIT · NEVER MODEL FEEDBACK</small></td><td>{entry.audit!.baseline.checks[i].passed ? 'PASS' : 'FAIL'}</td><td className={check.passed ? 'green-text' : 'danger-text'}>{check.passed ? 'PASS' : 'FAIL'}</td><td>{check.details}</td></tr>)}</tbody></table></div></details></section>;
}
