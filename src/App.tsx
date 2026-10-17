import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, Code2, Copy, Download, FileCode2, Fingerprint, FlaskConical, Layers3, LoaderCircle, LockKeyhole, Package, Play, Plus, RotateCcw, ShieldCheck, Shuffle, SquareTerminal, X, Zap } from 'lucide-react';
import { ProductionValidation } from './ProductionValidation';
import { incidents } from '../shared/fixtures';
import { investigationRequestSchema } from '../shared/types';
import type { AppConfig, CheckResult, Incident, PaymentEvent, RawTrial, RunEvent, RunResult, SuiteResult } from '../shared/types';

type Tab = 'investigation' | 'handler' | 'evidence' | 'production';
const customIncident: Incident = { id: 'custom', title: 'Bring your own handler', subtitle: 'Your code. Your delivery order.', tag: 'OPEN CHALLENGE', description: 'Paste a Python handler and synthetic event JSON. The agent repairs from evidence, then faces fresh tests after its patch is frozen.', events: [] };
const money = (cents: number, currency = 'usd') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
const time = (value: string) => new Date(value).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
function download(name: string, contents: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Icon({ children }: { children: React.ReactNode }) { return <span aria-hidden="true" className="icon">{children}</span>; }
function CodeView({ code }: { code: string }) {
  return <pre className="code-view" tabIndex={0} aria-label="Python source code">{code.split('\n').map((line, i) => <span className="code-line" key={i}><span className="line-number" aria-hidden="true">{i + 1}</span><code className={line.trim().startsWith('#') || line.trim().startsWith('"""') ? 'comment' : /def |return |if |with /.test(line) ? 'keyword-line' : ''}>{line || ' '}</code></span>)}</pre>;
}

export function App() {
  const [config, setConfig] = useState<AppConfig>({ sandboxConfigured: false, modelConfigured: false, model: null });
  const [loaded, setLoaded] = useState(false);
  const [incident, setIncident] = useState(incidents[0]);
  const [sequence, setSequence] = useState(incidents[0].events);
  const [original, setOriginal] = useState('');
  const [source, setSource] = useState('');
  const [tab, setTab] = useState<Tab>(() => window.location.hash === '#production' ? 'production' : 'investigation');
  const [mode, setMode] = useState<'sandbox' | 'agent'>('sandbox');
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [baseline, setBaseline] = useState<SuiteResult>();
  const [result, setResult] = useState<RunResult>();
  const [candidate, setCandidate] = useState('');
  const [showAfter, setShowAfter] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [replayText, setReplayText] = useState('');
  const [replayError, setReplayError] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function refreshConfig() {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Could not reach the API server. Start it with npm run dev.');
    const next = await response.json() as AppConfig;
    setConfig(next); return next;
  }
  useEffect(() => {
    let active = true;
    Promise.all([fetch('/api/config'), fetch('/api/fixtures')]).then(async ([c, f]) => {
      if (!c.ok || !f.ok) throw new Error('The API server is unavailable. Start the app with npm run dev.');
      const conf = await c.json() as AppConfig;
      const fixture = await f.json() as { source: string };
      if (!active) return;
      setConfig(conf); setOriginal(fixture.source); setSource(fixture.source); setLoaded(true);
      if (conf.modelConfigured) setMode('agent');
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [events, tab]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { window.history.replaceState(null, '', tab === 'production' ? '#production' : window.location.pathname + window.location.search); }, [tab]);

  function clearEvidence() { setResult(undefined); setBaseline(undefined); setCandidate(''); setEvents([]); setError(''); setShowAfter(false); }
  function chooseIncident(next: Incident) {
    if (running) return;
    setIncident(next); setReplayError(''); setSequence(next.events); setSelectedEvent(null); clearEvidence();
  }
  function chooseCustom() {
    if (running) return;
    setIncident({ ...customIncident, events: sequence });
    setReplayText(JSON.stringify(sequence, null, 2)); setReplayError(''); setSelectedEvent(null); clearEvidence(); setTab('handler');
  }
  function editReplay(value: string) {
    setReplayText(value); clearEvidence(); setSelectedEvent(null);
    try {
      const parsed = investigationRequestSchema.safeParse({ incidentId: 'custom', mode, source: 'def handle(event, db): pass', sequence: JSON.parse(value) });
      if (!parsed.success) { setReplayError(parsed.error.issues[0]?.message || 'Use 1–12 valid synthetic events.'); return; }
      setReplayError(''); setSequence(parsed.data.sequence!);
    } catch { setReplayError('Enter a valid JSON array of 1–12 synthetic events.'); }
  }
  function updateSequence(next: PaymentEvent[]) { setSequence(next); if (incident.id === 'custom') { setReplayText(JSON.stringify(next, null, 2)); setReplayError(''); } setSelectedEvent(null); clearEvidence(); }
  async function start() {
    if (running) return;
    clearEvidence(); setRunning(true); setTab('investigation');
    const controller = new AbortController(); abortRef.current = controller;
    try {
      const response = await fetch('/api/investigate', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incidentId: incident.id, mode, sequence, source }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || `Request failed (${response.status})`); }
      if (!response.body) throw new Error('The browser could not open the evidence stream.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let finished = false; let failed = false;
      const receive = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as RunEvent;
        setEvents(old => [...old, event]);
        if (event.type === 'baseline') setBaseline(event.data as SuiteResult);
        if (event.type === 'source') setCandidate((event.data as { source: string }).source);
        if (event.type === 'result') { setResult(event.data as RunResult); setShowAfter(true); finished = true; }
        if (event.type === 'error') { setError(event.message); failed = true; }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) { receive(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
      }
      buffer += decoder.decode(); if (buffer.trim()) receive(buffer);
      if (!finished && !failed) throw new Error('The evidence stream ended before the investigation finished.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Investigation failed.'); }
    finally { setRunning(false); abortRef.current = null; }
  }
  const currentSuite = showAfter && result ? result.repaired : baseline;
  const replay = currentSuite?.trials.find(t => t.id === 'incident');
  const visibleStep = selectedEvent === null ? replay?.steps.at(-1) : replay?.steps[selectedEvent];
  const shipments = visibleStep?.shipments ?? [];
  const paidSessions = new Set(sequence.filter(e => e.data.object.payment_status === 'paid' && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(e.type)).map(e => e.data.object.id)).size;
  const expectedAtStep = (index: number) => new Set(sequence.slice(0, index + 1).filter(e => e.data.object.payment_status === 'paid' && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(e.type)).map(e => e.data.object.id)).size;
  const visiblePaidSessions = selectedEvent === null ? paidSessions : expectedAtStep(selectedEvent);
  const excess = baseline ? Math.max(0, ...((baseline.trials.find(t => t.id === 'incident')?.steps ?? []).map((step, index) => step.shipments.length - expectedAtStep(index)))) : null;
  const selected = selectedEvent === null ? undefined : sequence[selectedEvent];
  const canRun = loaded && !replayError && source.length >= 10 && source.length <= 20_000 && config.sandboxConfigured && (mode === 'sandbox' || config.modelConfigured);
  const originalPassed = Boolean(result && result.baseline.passed === result.baseline.total);
  const verifiedPassed = (result?.repaired.passed ?? 0) + (result?.audit?.candidate.passed ?? 0);
  const verifiedTotal = (result?.repaired.total ?? 0) + (result?.audit?.candidate.total ?? 0);
  const status = running ? 'Investigation running' : result?.verified ? originalPassed ? 'Original verified' : 'Repair verified' : result ? 'Repair incomplete' : error ? 'Needs attention' : baseline ? 'Failure reproduced' : 'Ready to investigate';
  const report = () => { if (result) download(`checkout-autopsy-${result.id}.json`, JSON.stringify(result, null, 2), 'application/json'); };

  return <div className="app-shell">
    <a href="#main" className="skip-link">Skip to investigation</a>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Checkout Autopsy home"><span className="brand-mark"><Activity size={23} strokeWidth={2.2} aria-hidden="true" /></span><span>checkout<span className="brand-slash">/</span><strong>autopsy</strong><span className="beta">LAB</span></span></a>
      <span className="topbar-rule" /><span className="topbar-caption">Every event leaves evidence.</span>
      <div className="topbar-right"><span className="connection"><span className={config.sandboxConfigured ? 'dot green' : 'dot'} />{config.sandboxConfigured ? 'CreateOS configured' : 'CreateOS not configured'}</span><button className="icon-button" aria-label="Connection setup" onClick={() => setSetup(!setup)} aria-expanded={setup}><CircleHelp size={19} /></button><span className="avatar" aria-label="Local workspace">CA</span></div>
    </header>
    <div className="body-layout">
      <nav className="rail" aria-label="Workspace navigation">
        <div className="rail-top">{([{ id: 'investigation', icon: <FlaskConical size={21} />, label: 'Investigation' }, { id: 'handler', icon: <Code2 size={21} />, label: 'Handler source' }, { id: 'evidence', icon: <ShieldCheck size={21} />, label: 'Verification evidence' }, { id: 'production', icon: <Layers3 size={21} />, label: 'Node and PostgreSQL validation' }] as const).map(item => <button key={item.id} className={`rail-button ${tab === item.id ? 'active' : ''}`} aria-label={item.label} aria-current={tab === item.id ? 'page' : undefined} title={item.label} onClick={() => setTab(item.id)}>{item.icon}</button>)}</div>
        <span className="rail-bottom"><LockKeyhole size={17} aria-hidden="true" /><span>LOCAL</span></span>
      </nav>
      <main id="main" className="main-content">
        {setup && <section className="setup-panel" aria-label="Connection setup"><div><h2>Connect the lab</h2><p>CreateOS: <strong>{config.sandboxConfigured ? 'configured' : 'missing'}</strong> · Model: <strong>{config.modelConfigured ? config.model : 'not connected'}</strong></p><p>Add <code>OPENROUTER_API_KEY</code> to <code>.env.local</code> and restart the server for live AI. The default model is <code>cohere/north-mini-code:free</code>, with a free Gemma fallback. Use <code>MODEL_NAME</code> to choose another model.</p><p>Guided mode runs the published reference repair in a real sandbox. It does not use AI.</p></div><div className="setup-actions"><button className="secondary small" onClick={() => refreshConfig().catch(e => setError(e.message))}>Refresh status</button><button className="icon-button" onClick={() => setSetup(false)} aria-label="Close connection setup"><X size={18} /></button></div></section>}
        {tab === 'production' ? <section className="masthead"><div className="masthead-copy"><div className="eyebrow">EXPANDED INTEGRATION VALIDATION</div><h1>Real HTTP.<br /><span>Durable state.</span></h1><p>Verify signatures. Commit work atomically.<br />Recover after the process dies.</p><div className="context-tags"><span>Node + Express + Stripe SDK + PostgreSQL</span><span>Disposable test infrastructure</span></div></div><button className="secondary" onClick={() => setTab('investigation')}>Back to Python lab<ArrowRight size={15} /></button></section> : <section className="masthead">
          <div className="masthead-copy"><div className="eyebrow"><span className="tiny-cross">+</span> PAYMENT RELIABILITY LAB <span className="eyebrow-divider">/</span> {incident.id === 'custom' ? 'OPEN CHALLENGE' : `CASE 00${incidents.indexOf(incident) + 1}`} </div><h1>{result?.verified ? originalPassed ? <>No failing case found.<br /><span>Checks verified.</span></> : <>Failure reproduced.<br /><span>Repair verified.</span></> : <>A successful response.<br /><span>A broken checkout.</span></>}</h1><p>Reproduce the failure. Inspect the repair.<br className="mobile-break" /> Trust the evidence, not the status code.</p><div className="context-tags"><span><span className="square-dot" />Synthetic test store</span><span><LockKeyhole size={12} aria-hidden="true" />No real charges</span></div></div>
          <div className="run-control"><div className="mode-control" role="group" aria-label="Investigation mode"><button disabled={running} className={mode === 'sandbox' ? 'selected' : ''} aria-pressed={mode === 'sandbox'} onClick={() => { setMode('sandbox'); clearEvidence(); }}><FlaskConical size={14} aria-hidden="true" />Guided sandbox</button><button disabled={running} className={mode === 'agent' ? 'selected' : ''} aria-pressed={mode === 'agent'} onClick={() => { setMode('agent'); clearEvidence(); }}><Zap size={14} aria-hidden="true" />Live agent{!config.modelConfigured && <span className="mode-dot" />}</button></div><button className="primary run-button" disabled={running || !canRun} onClick={start}>{running ? <LoaderCircle size={18} className="spin" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}{running ? 'Investigating…' : result ? 'Run another autopsy' : 'Start autopsy'}{!running && <span className="button-shortcut"><ArrowRight size={15} aria-hidden="true" /></span>}</button><p className="mode-explanation">{mode === 'sandbox' ? 'Real sandbox execution · reference repair' : config.modelConfigured ? `${config.model} · up to 3 repair attempts` : <>Model not connected. <button className="text-button" onClick={() => setSetup(true)}>Set up AI access <ArrowUpRight size={12} /></button></>}</p></div>
        </section>}

        {tab !== 'production' && <section className="metrics" aria-label="Investigation metrics">
          <Metric label="QUEUED DELIVERIES" value={String(sequence.length).padStart(2, '0')} note="Retries included" icon={<Layers3 size={16} />} />
          <Metric label="PAID CHECKOUTS" value={String(paidSessions).padStart(2, '0')} note="Unique checkout sessions" icon={<Fingerprint size={17} />} />
          <Metric label="EXCESS SHIPMENTS" value={excess === null ? '—' : String(excess).padStart(2, '0')} note={baseline ? 'Peak observed in the original replay' : 'Measured after replay'} icon={<Package size={17} />} tone={excess ? 'danger' : undefined} />
          <Metric label="VERIFICATION CHECKS" value={result ? `${verifiedPassed}/${verifiedTotal}` : baseline ? `${baseline.passed}/${baseline.total}` : '—/24'} note={result?.audit ? `${result.audit.candidate.passed}/12 fresh audit checks · patch frozen` : '12 repair checks + 12 final audit checks'} icon={<ShieldCheck size={17} />} tone={result?.verified ? 'success' : undefined} />
        </section>}

        {error && <div className="error-banner" role="alert"><span><strong>Investigation needs attention.</strong> {error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}

        <div className={`workspace ${tab === 'production' ? 'production-mode' : ''}`}>
          <aside hidden={tab === 'production'} className="incident-sidebar" aria-label="Incident cases">
            <div className="section-label">CASE FILES <span>03</span></div>
            <div className="case-list">{incidents.map((item, index) => <button disabled={running} onClick={() => chooseIncident(item)} key={item.id} className={`case-card ${item.id === incident.id ? 'active' : ''}`}><span className="case-number">0{index + 1}</span><span><strong>{item.title}</strong><small>{item.tag}</small></span><ChevronRight size={15} aria-hidden="true" /></button>)}</div>
            <button className={`secondary custom-case ${incident.id === 'custom' ? 'selected' : ''}`} disabled={running} onClick={chooseCustom}><FileCode2 size={16} aria-hidden="true" />Bring your own handler<ArrowUpRight size={14} aria-hidden="true" /></button>
            <div className="sidebar-divider" />
            <div className="section-label">REPLAY QUEUE <span>{sequence.length.toString().padStart(2, '0')}</span></div>
            <div className="queue-list">{sequence.map((e, i) => <button key={`${e.id}-${i}`} className={`queue-event ${selectedEvent === i ? 'selected' : ''}`} onClick={() => setSelectedEvent(selectedEvent === i ? null : i)} aria-expanded={selectedEvent === i}><span className="queue-index">{String(i + 1).padStart(2, '0')}</span><span><strong>{e.type.replace('checkout.session.', '').replace('customer.', '')}</strong><small>{e.id}</small></span>{i > 0 && sequence.slice(0, i).some(p => p.id === e.id) ? <span className="retry-label">RETRY</span> : <span className={`payment-dot ${e.data.object.payment_status === 'paid' ? 'paid' : ''}`} />}</button>)}</div>
            {selected && <pre className="payload" aria-label="Selected event payload">{JSON.stringify(selected, null, 2)}</pre>}
            <div className="queue-controls"><button disabled={running || sequence.length >= 12} className="secondary small" onClick={() => updateSequence([...sequence, sequence.at(-1)!])}><Plus size={14} aria-hidden="true" />Add retry</button><button disabled={running} className="icon-button" aria-label="Shuffle delivery order" title="Shuffle delivery order" onClick={() => { const next = [...sequence]; for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; } updateSequence(next); }}><Shuffle size={15} /></button><button disabled={running} className="icon-button" aria-label="Reset replay queue" title="Reset replay queue" onClick={() => updateSequence(incident.events)}><RotateCcw size={15} /></button></div>
            <div className="lab-note"><FlaskConical size={18} aria-hidden="true" /><strong>A controlled failure.</strong><p>Python + SQLite contract. Synthetic fixtures. Repair, freeze the patch, then audit fresh sequences without model feedback.</p></div>
          </aside>

          <section className="investigation-panel" aria-label="Investigation workspace">
            <div className="panel-toolbar"><div className="tabs" role="tablist" aria-label="Investigation views">{(['investigation', 'handler', 'evidence', 'production'] as Tab[]).map(t => <button role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls="workspace-content" tabIndex={tab === t ? 0 : -1} key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)} onKeyDown={e => { const tabs: Tab[] = ['investigation', 'handler', 'evidence', 'production']; if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = tabs[(tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : 3)) % 4]; setTab(next); document.getElementById(`tab-${next}`)?.focus(); } }}>{t === 'investigation' ? 'Investigation' : t === 'handler' ? 'Handler' : t === 'production' ? 'Production support' : 'Evidence'}{t === 'evidence' && result && <span>{verifiedTotal}</span>}</button>)}</div>{tab !== 'production' && <button className="export-button" disabled={!result} onClick={report}><Download size={14} aria-hidden="true" /><span>Export report</span></button>}</div>
            <div id="workspace-content" role="tabpanel" aria-labelledby={`tab-${tab}`}>
              <div hidden={tab !== 'production'}><ProductionValidation config={config} /></div>
              {tab === 'investigation' && <>
                <div className="case-heading"><div><span className="incident-tag">{incident.tag}</span><h2>{incident.subtitle}</h2><p>{incident.description}</p></div><span className={`status-pill ${running ? 'working' : result?.verified ? 'verified' : ''}`}><span className={`dot ${running ? 'pulse' : result?.verified ? 'green' : ''}`} />{status}</span></div>
                <div className="replay-view">
                  <div className="replay-heading"><span className="section-label">FOLLOW THE SIDE EFFECT</span><div className="comparison-switch" role="group" aria-label="Compare handler results"><button aria-pressed={!showAfter} className={!showAfter ? 'selected' : ''} onClick={() => setShowAfter(false)}>Original</button><button disabled={!result} aria-pressed={showAfter} className={showAfter ? 'selected' : ''} onClick={() => setShowAfter(true)}>Repaired</button></div></div>
                  <div className="replay-position"><span>{selectedEvent === null ? "Full replay · final committed state" : `State after delivery ${String(selectedEvent + 1).padStart(2, "0")}`}</span>{selectedEvent !== null ? <button className="text-button" onClick={() => setSelectedEvent(null)}>Show full replay <ArrowRight size={12} aria-hidden="true" /></button> : <span>Select a queued delivery to inspect its side effect</span>}</div><div className="flow-columns"><span>INCOMING EVENTS</span><span>HANDLER</span><span>SHIPMENT LEDGER</span></div>
                  <div className={`flow-visual ${running ? 'running' : ''}`}>
                    <div className="flow-events">{sequence.slice(0, 4).map((e, i) => <div className={`flow-event ${selectedEvent === i ? "selected" : ""}`} key={i}><span className="event-glyph"><Zap size={13} aria-hidden="true" /></span><span>{e.type.endsWith('async_payment_succeeded') ? 'payment_succeeded' : e.type.split('.').at(-1)}<small>delivery {String(i + 1).padStart(2, '0')}</small></span><span className="connector" /></div>)}{sequence.length > 4 && <span className="more-events">+ {sequence.length - 4} more deliveries</span>}</div>
                    <div className="handler-node"><div className={`handler-symbol ${showAfter && result?.verified ? 'fixed' : ''}`}><FileCode2 size={27} aria-hidden="true" /></div><strong>handle(event, db)</strong><span>{showAfter && result ? 'repaired_handler.py' : 'webhook_handler.py'}</span><div className={`handler-response ${replay ? 'observed' : ''}`}>{replay ? <>exit {replay.steps.every(s => s.exitCodes.every(c => c === 0)) ? '0' : '1'} <span>·</span> {replay.steps.length} delivery steps</> : <>Awaiting replay</>}</div></div>
                    <div className={`ledger ${replay && shipments.length > visiblePaidSessions ? 'has-duplicates' : ''}`}><div className="ledger-title"><Package size={15} aria-hidden="true" /><span>{replay ? `${shipments.length} shipment${shipments.length === 1 ? '' : 's'} recorded` : 'No evidence yet'}</span></div>{replay ? shipments.length ? shipments.slice(0, 4).map((s, i) => <div className={`shipment-row ${i >= visiblePaidSessions ? 'duplicate' : ''}`} key={i}><Package size={15} aria-hidden="true" /><span><strong>SHIP-{String(i + 1).padStart(3, '0')}</strong><small>{s.sessionId.replace('cs_demo_', '#')}</small></span><span>{i >= visiblePaidSessions ? 'EXCESS' : money(s.amount, s.currency)}</span></div>) : <div className="ledger-empty">No shipments recorded.</div> : <div className="ledger-empty"><span className="skeleton-line" /><span className="skeleton-line short" /><p>Database observations<br />appear after execution.</p></div>}{shipments.length > 4 && <div className="more-events">+ {shipments.length - 4} more rows</div>}</div>
                  </div>
                  <div className={`finding-strip ${replay ? showAfter && result?.verified ? 'success' : 'danger' : ''}`}><Icon>{replay ? showAfter && result?.verified ? <CheckCheck size={17} /> : <Activity size={17} /> : <Fingerprint size={17} />}</Icon><p>{replay ? showAfter && result?.verified ? <><strong>Shipment invariants verified.</strong> {result.repaired.passed}/{result.repaired.total} repair checks and {result.audit?.candidate.passed}/{result.audit?.candidate.total} fresh audit checks passed.</> : showAfter && result ? <><strong>Verification withheld: {verifiedPassed}/{verifiedTotal} checks passed.</strong> {[...result.repaired.checks, ...(result.audit?.candidate.checks ?? [])].find(c => !c.passed)?.name}: {[...result.repaired.checks, ...(result.audit?.candidate.checks ?? [])].find(c => !c.passed)?.details}</> : <><strong>{baseline?.checks.find(c => c.id === 'incident')?.passed ? 'This sequence passed.' : 'Business invariant violated.'}</strong> {baseline?.checks.find(c => c.id === 'incident')?.details}</> : <><strong>A response code is only half the story.</strong> We inspect the database after every delivery.</>}</p></div>
                </div>
                <div className="bottom-panels"><section className="execution-panel"><div className="mini-toolbar"><span><SquareTerminal size={15} aria-hidden="true" />EXECUTION FEED</span><span className="mono muted">{events.length ? `${events.length} entries` : 'WAITING'}</span></div><div ref={feed} className="execution-feed" role="log" aria-label="Execution feed" aria-live="polite">{events.length ? events.map((e, i) => <div className={`log-line ${e.type}`} key={i}><time>{time(e.time)}</time><span>{e.type === 'result' ? <Check size={13} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}</span><p>{e.message}</p></div>) : <div className="feed-empty"><span className="terminal-cursor" /><p>The lab is ready.<br /><span>Start an autopsy to capture real execution evidence.</span></p></div>}{running && <div className="feed-running"><LoaderCircle size={13} className="spin" aria-hidden="true" />Waiting for the next observation…</div>}</div></section><section className="protocol-panel"><div className="mini-toolbar"><span><ShieldCheck size={15} aria-hidden="true" />THE VERIFICATION CONTRACT</span></div><ol><li><span>01</span><div><strong>Reproduce</strong><p>Replay events against the original handler.</p></div>{baseline && <Check size={15} className="green-text" />}</li><li><span>02</span><div><strong>{mode === 'agent' ? 'Generate & repair' : 'Apply reference repair'}</strong><p>{mode === 'agent' ? 'Write Python from the observed failures.' : 'Run the published repair in CreateOS.'}</p></div>{candidate && <Check size={15} className="green-text" />}</li><li><span>03</span><div><strong>Verify independently</strong><p>Freeze the patch, then audit unseen sequences.</p></div>{result?.verified && <Check size={15} className="green-text" />}</li></ol><div className="protocol-footnote"><LockKeyhole size={12} aria-hidden="true" />Assertions run outside agent-editable code.</div></section></div>
              </>}
              {tab === 'handler' && <div className="handler-tab"><div className="tab-intro"><span className="incident-tag">SOURCE INSPECTION</span><h2>Inspect the cause. Keep the repair.</h2><p>Edit the original Python handler and challenge the agent with your own implementation. Code executes only in CreateOS. Use synthetic inputs, with no customer data or secrets.</p></div><details className="input-contract"><summary>Python + SQLite input contract</summary><p>Define <code>handle(event, db)</code> using the Python standard library. Each delivery starts a fresh process. The SQLite connection persists state across deliveries.</p><pre>{`shipments(id INTEGER PRIMARY KEY AUTOINCREMENT,\n  session_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL)\nprocessed_events(event_id TEXT PRIMARY KEY)`}</pre><p>Fulfill only paid <code>checkout.session.completed</code> and <code>checkout.session.async_payment_succeeded</code> events. Persist one shipment per checkout session, with its exact amount and currency. Do not alter the schema. No network, packages or external side effects.</p></details>{incident.id === 'custom' && <section className="custom-replay"><label htmlFor="replay-json">YOUR SYNTHETIC DELIVERY SEQUENCE</label><p>Paste a JSON array of 1–12 Stripe-shaped events. Array order is delivery order; duplicate an entry to retry it. The final audit generates additional concurrent and reordered cases.</p><textarea id="replay-json" spellCheck={false} disabled={running} value={replayText} onChange={e => editReplay(e.target.value)} aria-invalid={Boolean(replayError)} aria-describedby="replay-validation" /><p id="replay-validation" className={replayError ? 'danger-text' : 'green-text'} role={replayError ? 'alert' : undefined}>{replayError || `${sequence.length} valid deliveries ready. Keep each checkout’s amount and currency consistent.`}</p></section>}<div className="source-grid"><section><div className="mini-toolbar"><span><FileCode2 size={15} aria-hidden="true" />ORIGINAL HANDLER</span><button className="text-button" disabled={running} onClick={() => { setSource(original); clearEvidence(); }}>Reset</button></div><textarea spellCheck={false} aria-label="Original Python handler" className="source-editor" value={source} disabled={running} onChange={e => { setSource(e.target.value); clearEvidence(); }} /></section><section><div className="mini-toolbar"><span><Code2 size={15} aria-hidden="true" />{mode === 'agent' ? 'AGENT CANDIDATE' : 'REFERENCE REPAIR'}</span><button disabled={!candidate} className="text-button" onClick={() => download('repaired_handler.py', candidate)}><ArrowDownToLine size={13} aria-hidden="true" />Download</button></div>{candidate ? <CodeView code={candidate} /> : <div className="candidate-empty"><Code2 size={30} aria-hidden="true" /><strong>The repair will appear here.</strong><p>{mode === 'agent' ? 'Generated from the actual replay evidence.' : 'Guided mode uses a transparent reference patch.'}</p></div>}</section></div></div>}
              {tab === 'evidence' && <div className="evidence-tab"><div className="tab-intro"><span className="incident-tag">SHOW YOUR WORK</span><h2>{result ? `${verifiedPassed}/${verifiedTotal} checks passed. Every result inspectable.` : 'Claims need receipts.'}</h2><p>The repair suite may provide failure feedback. The final audit is generated after the patch freezes; audit inputs and outcomes never go back to the model.</p></div>{baseline ? <><CounterexampleView check={baseline.checks.find(c => !c.passed && c.counterexample)} /><div className="checks-table-wrap"><table className="checks-table"><thead><tr><th>REPAIR SUITE CHECK</th><th>ORIGINAL</th><th>REPAIRED</th><th>EVIDENCE</th></tr></thead><tbody>{baseline.checks.map((check, i) => { const next = result?.repaired.checks[i]; return <tr key={check.id}><td><strong>{check.name}</strong><small>{check.hidden ? 'INITIAL HOLDOUT · MAY BECOME FEEDBACK' : 'VISIBLE CASE'}</small></td><td><CheckBadge passed={check.passed} /></td><td>{next ? <CheckBadge passed={next.passed} /> : <span className="muted">Pending</span>}</td><td>{next?.details ?? check.details}</td></tr>; })}</tbody></table></div>{result && <><AuditEvidence result={result} /><div className="evidence-meta"><div><span>EXECUTION</span><strong>CreateOS Sandbox</strong><code>{result.sandboxId}</code></div><div><span>GENERATION</span><strong>{originalPassed ? 'No repair needed' : result.mode === 'agent' ? result.model : 'Published reference repair'}</strong><small>{result.mode === 'agent' && result.attempts.length ? `${result.attempts.length} model attempt(s)` : 'No model call made'}</small></div><div><span>CLEANUP</span><strong className={result.cleanup ? 'green-text' : 'danger-text'}>{result.cleanup ? 'Sandbox destroyed' : 'Manual cleanup required'}</strong><small>{(result.execMs / 1000).toFixed(2)}s total replay execution</small></div></div><details className="raw-evidence"><summary><SquareTerminal size={15} aria-hidden="true" />Raw replay evidence <ChevronRight size={14} aria-hidden="true" /></summary><pre>{JSON.stringify({ before: result.baseline.trials.find(t => t.id === 'incident'), after: result.repaired.trials.find(t => t.id === 'incident'), candidateSHA256: result.attempts.at(-1)?.hash }, null, 2)}</pre></details><div className="report-actions"><button className="secondary" onClick={report}><Download size={15} aria-hidden="true" />Download evidence bundle</button><button className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(result.patch); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setError('Clipboard access unavailable. Use Download in the Handler tab.'); } }}><Copy size={15} aria-hidden="true" />{copied ? 'Copied' : 'Copy repaired handler'}</button></div><p className="limitations">{result.limitation}</p></>}</> : <div className="evidence-empty"><ShieldCheck size={38} aria-hidden="true" /><h3>Nothing verified yet.</h3><p>Run an autopsy to collect real stdout, process exit codes,<br />database snapshots, and before/after checks.</p><button className="secondary" onClick={() => setTab('investigation')}>Back to investigation<ArrowRight size={15} aria-hidden="true" /></button></div>}</div>}
            </div>
          </section>
        </div>
        <footer className="footer"><span><span className="dot green" />CREATEOS × STRIPE PROJECTS <span className="footer-divider">/</span> HACKATHON BUILD</span><a href="https://docs.stripe.com/webhooks#handle-duplicate-events" target="_blank" rel="noreferrer">Why retries matter <ArrowUpRight size={12} aria-hidden="true" /></a></footer>
      </main>
    </div>
  </div>;
}
function Metric({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: React.ReactNode; tone?: 'danger' | 'success' }) {
  return <div className={`metric ${tone ?? ''}`}><div className="metric-label">{label}<Icon>{icon}</Icon></div><strong>{value}</strong><p>{note}</p></div>;
}
function CheckBadge({ passed }: { passed: boolean }) { return <span className={`check-badge ${passed ? 'pass' : 'fail'}`}>{passed ? <Check size={12} aria-hidden="true" /> : <X size={12} aria-hidden="true" />}{passed ? 'PASS' : 'FAIL'}</span>; }

function AuditEvidence({ result }: { result: RunResult }) {
  const audit = result.audit;
  if (!audit) return <div className="audit-summary"><strong>Final audit not run.</strong><p>The repair suite must pass before the patch can be frozen. Verification is withheld.</p></div>;
  return <section aria-label="Frozen-patch audit"><div className={`audit-summary ${audit.candidate.passed === audit.candidate.total ? 'passed' : 'failed'}`}><span className="incident-tag">FROZEN-PATCH AUDIT · NO MODEL FEEDBACK</span><h3>{audit.candidate.passed}/{audit.candidate.total} fresh checks passed.</h3><p>Inputs generated after the patch froze: new identifiers, amounts, currencies, delivery permutations and concurrent batches. A failed audit cannot trigger another repair in this run.</p><code>SHA-256 {audit.candidateHash}</code></div><div className="checks-table-wrap"><table className="checks-table"><thead><tr><th>FRESH AUDIT CHECK</th><th>ORIGINAL</th><th>FROZEN PATCH</th><th>EVIDENCE</th></tr></thead><tbody>{audit.candidate.checks.map((check, i) => <tr key={check.id}><td><strong>{check.name}</strong><small>NEVER SHARED WITH MODEL</small></td><td><CheckBadge passed={audit.baseline.checks[i].passed} /></td><td><CheckBadge passed={check.passed} /></td><td>{check.details}</td></tr>)}</tbody></table></div></section>;
}

function CounterexampleView({ check }: { check?: CheckResult }) {
  const evidence = check?.counterexample;
  if (!evidence) return null;
  return <section className="counterexample-view" aria-label="Original handler counterexample"><span className="incident-tag">ORIGINAL HANDLER · FIRST DIVERGENT STATE IN THIS REPLAY</span><h3>Delivery {evidence.step} breaks the contract.</h3><p>{check?.details}</p><div className="counterexample-columns">{([{ label: 'EXPECTED SHIPMENTS', rows: evidence.expected }, { label: 'OBSERVED SHIPMENTS', rows: evidence.observed }]).map(group => <div key={group.label}><strong>{group.label}</strong>{group.rows.length ? group.rows.map((row, i) => <p key={i}><code>{row.sessionId}</code><span>{money(row.amount, row.currency)}</span></p>) : <p>No shipments</p>}</div>)}</div><details><summary>Inspect the delivered event{evidence.delivered.length === 1 ? '' : ' batch'}</summary><pre>{JSON.stringify(evidence.delivered, null, 2)}</pre></details></section>;
}
