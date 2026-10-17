// Trusted HTTP/SQL observer. All handler execution happens in child processes.
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import Stripe from 'stripe';

const root = fileURLToPath(new URL('./', import.meta.url));
const inputs = JSON.parse(await readFile(process.argv[3], 'utf8'));
const modulePath = new URL(process.argv[2], 'file:///').href;
let credentials;
try { credentials = JSON.parse(await readFile(`${root}database-config.json`, 'utf8')); }
catch {
  credentials = { admin: randomBytes(24).toString('hex'), app: randomBytes(24).toString('hex') };
  await writeFile(`${root}database-config.json`, JSON.stringify(credentials), { mode: 0o600 });
}
const postgres = new EmbeddedPostgres({ databaseDir: `${root}database`, port: 55439, user: 'postgres', password: credentials.admin, authMethod: 'scram-sha-256', persistent: true, createPostgresUser: true, onLog: () => {}, onError: () => {}, postgresFlags: ['-h', '127.0.0.1', '-c', 'shared_buffers=32MB', '-c', 'max_connections=32', '-c', 'work_mem=1MB', '-c', 'max_wal_size=64MB', '-c', 'min_wal_size=32MB'] });
const admin = new pg.Pool({ host: '127.0.0.1', port: 55439, user: 'postgres', password: credentials.admin, database: 'postgres', max: 2 });
const database = { host: '127.0.0.1', port: 55439, user: 'autopsy_app', password: credentials.app, database: 'postgres' };
const servicePath = `${root}service.mjs`;
const schema = await readFile(`${root}schema.sql`, 'utf8');
const children = new Set();

function spawnChild(config, phase) {
  const child = fork(servicePath, [], { env: { PATH: process.env.PATH, LANG: 'C.UTF-8', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.add(child);
  let stderr = ''; let error = '';
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-1000); });
  // Drain stdout so candidate logging cannot block the driver.
  child.stdout.on('data', () => {});
  const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { clearTimeout(timer); children.delete(child); resolve({ code, signal, phase }); }));
  const ready = new Promise((resolve, reject) => {
    child.on('message', message => { if (message.ready) resolve(message.port); if (message.error) { error = message.error; reject(new Error(error)); } });
    child.once('exit', () => reject(new Error(error || stderr || 'Candidate service exited before listening.')));
  });
  // Workers do not listen; prevent their intentionally unused ready rejection.
  ready.catch(() => {});
  child.send({ ...config, database, module: modulePath });
  return { child, ready, exited, stop: async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); return exited; } };
}

async function replay(input) {
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.query(schema);
  await admin.query('GRANT USAGE ON SCHEMA public TO autopsy_app; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO autopsy_app;');
  const signingSecret = randomBytes(32).toString('hex');
  const effects = new Map(); const deliveries = []; let failures = 0;
  const sink = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    let payload; try { payload = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
    const idempotencyKey = String(req.headers['idempotency-key'] ?? '');
    let status = 200;
    if (failures > 0) { failures--; status = 503; }
    else if (effects.has(idempotencyKey) && JSON.stringify(effects.get(idempotencyKey).payload) !== JSON.stringify(payload)) status = 409;
    else {
      // Missing keys deliberately create a distinct observable effect per call.
      const storageKey = idempotencyKey || `unkeyed-${deliveries.length}`;
      if (!effects.has(storageKey)) effects.set(storageKey, { key: storageKey, payload });
    }
    deliveries.push({ key: idempotencyKey, status, payload });
    res.writeHead(status).end();
  });
  sink.listen(0, '127.0.0.1'); await once(sink, 'listening');
  const sinkUrl = `http://127.0.0.1:${sink.address().port}/fulfill`;
  let server;
  const getServer = async fault => {
    if (server) await server.stop();
    server = spawnChild({ mode: 'service', signingSecret, fault }, 'service');
    return server.ready;
  };
  const request = async (port, event, variant = 'valid') => {
    let payload = JSON.stringify(event);
    if (variant === 'malformed') payload = '{"broken":';
    if (variant === 'oversized') payload = JSON.stringify({ ...event, padding: 'x'.repeat(280_000) });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: variant === 'forged' ? randomBytes(32).toString('hex') : signingSecret, timestamp: Math.floor(Date.now() / 1000) - (variant === 'stale' ? 1000 : 0) });
    if (variant === 'tampered') payload += ' ';
    const started = performance.now();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(variant === 'missing' ? {} : { 'Stripe-Signature': header }) }, body: payload, signal: AbortSignal.timeout(4500) });
      await response.body?.cancel();
      return { status: response.status, elapsedMs: performance.now() - started };
    } catch { return { status: 0, elapsedMs: performance.now() - started }; }
  };
  const snapshot = async (responses, processes) => {
    const orders = (await admin.query('SELECT account_id AS "accountId",session_id AS "sessionId",amount::int,currency FROM orders ORDER BY account_id,session_id')).rows;
    const outbox = (await admin.query('SELECT id,account_id AS "accountId",session_id AS "sessionId",amount::int,currency,payload,status FROM outbox ORDER BY account_id,session_id')).rows;
    return { responses, processes, orders, outbox, effects: [...effects.values()].map(effect => ({ key: effect.key, ...effect.payload })), deliveries: structuredClone(deliveries) };
  };
  const steps = [];
  try {
    let port = await getServer();
    for (const action of input.actions) {
      let responses = []; let processes = [];
      if (action.kind === 'http') responses = await Promise.all(action.events.map(event => request(port, event, action.signature)));
      else if (action.kind === 'restart') { processes.push(await server.stop()); server = undefined; port = await getServer(); }
      else if (action.kind === 'crash') {
        port = await getServer(action.point);
        responses.push(await request(port, action.event));
        processes.push(await server.stop()); server = undefined;
        // Snapshot must be observed after termination releases transaction locks.
        steps.push(await snapshot(responses, processes));
        port = await getServer();
        continue;
      } else {
        failures = action.failures ?? 0;
        const workers = Array.from({ length: action.count }, () => spawnChild({ mode: 'worker', sink: sinkUrl, crashAfterDelivery: action.crashAfterDelivery }, 'worker'));
        processes = await Promise.all(workers.map(worker => worker.exited));
      }
      steps.push(await snapshot(responses, processes));
    }
    return { id: input.id, steps };
  } catch (error) {
    return { id: input.id, steps, error: String(error?.message ?? error).slice(0, 1000) };
  } finally {
    if (server) await server.stop();
    sink.closeAllConnections(); await new Promise(resolve => sink.close(resolve));
  }
}

try {
  try { await access(`${root}database/PG_VERSION`); } catch { await postgres.initialise(); }
  await postgres.start();
  if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='autopsy_app'")).rowCount) await admin.query(`CREATE ROLE autopsy_app LOGIN PASSWORD '${credentials.app}'`);
  const pkg = async name => JSON.parse(await readFile(`${root}node_modules/${name}/package.json`, 'utf8')).version;
  const runtime = { node: process.version, postgres: (await admin.query('SHOW server_version')).rows[0].server_version, stripe: await pkg('stripe'), express: await pkg('express'), pg: await pkg('pg') };
  const trials = [];
  for (const input of inputs) trials.push(await replay(input));
  console.log(JSON.stringify({ runtime, trials }));
} finally {
  for (const child of children) child.kill('SIGKILL');
  await admin.end().catch(() => {});
  await postgres.stop().catch(() => {});
}
