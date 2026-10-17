import express from 'express';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { investigationRequestSchema } from '../shared/types';
import { incidents } from '../shared/fixtures';
import { investigate } from './investigate';
import { readAsset, sandboxKey } from './executor';
import { modelConfig } from './model';
import { productionRequestSchema } from '../shared/production';
import { runProductionValidation } from './production-run';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
let busy = false;
let activeJob: AbortController | null = null;
app.get('/api/config', (_req, res) => res.json({ sandboxConfigured: Boolean(sandboxKey()), modelConfigured: Boolean(modelConfig().key), model: modelConfig().key ? modelConfig().model : null }));
app.get('/api/fixtures', async (_req, res) => res.json({ incidents, source: await readAsset('fixtures/buggy_handler.py') }));
app.get('/api/production', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try { res.json({ report: JSON.parse(await readFile(new URL('../artifacts/production-latest.json', import.meta.url), 'utf8')) }); }
  catch { res.json({ report: null }); }
});
app.post('/api/production/run', async (req, res) => {
  const origin = req.get('origin');
  if (origin) {
    const allowed = new Set([process.env.APP_ORIGIN || 'http://127.0.0.1:5173', 'http://localhost:5173', `http://127.0.0.1:${process.env.PORT || 3001}`]);
    try { if (!allowed.has(new URL(origin).origin)) { res.status(403).json({ error: 'Cross-origin validation is not allowed.' }); return; } }
    catch { res.status(403).json({ error: 'Invalid origin.' }); return; }
  }
  const parsed = productionRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'A custom Node module must contain 30–30,000 characters.' }); return; }
  if (busy) { res.status(409).json({ error: 'A validation is already running.' }); return; }
  if (!sandboxKey() || !modelConfig().key) { res.status(503).json({ error: 'CreateOS and model credentials are required.' }); return; }
  busy = true; const controller = new AbortController(); activeJob = controller;
  const timer = setTimeout(() => controller.abort(new Error('Validation exceeded fifteen minutes.')), 900_000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  res.status(200).set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  const emit = (event: unknown) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
  try { await runProductionValidation(parsed.data, emit, controller.signal); }
  catch (error) {
    const message = error instanceof Error && !/skp_|Bearer |api.key|authorization/i.test(error.message) ? error.message : 'Validation failed. Check quota or provider access.';
    emit({ type: 'error', time: new Date().toISOString(), message: message.slice(0, 500) });
  } finally { clearTimeout(timer); busy = false; activeJob = null; res.end(); }
});
app.post('/api/investigate', async (req, res) => {
  // Loopback-only service; Origin check also rejects cross-site browser requests.
  const origin = req.get('origin');
  if (origin) {
    const allowedOrigins = new Set([process.env.APP_ORIGIN || 'http://127.0.0.1:5173', 'http://localhost:5173', `http://127.0.0.1:${process.env.PORT || 3001}`]);
    try { if (!allowedOrigins.has(new URL(origin).origin)) { res.status(403).json({ error: 'Cross-origin investigations are not allowed.' }); return; } }
    catch { res.status(403).json({ error: 'Invalid origin.' }); return; }
  }
  const parsed = investigationRequestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid incident, replay sequence, or handler source.' }); return; }
  if (busy) { res.status(409).json({ error: 'An investigation is already running. Wait for it to finish.' }); return; }
  if (!sandboxKey()) { res.status(503).json({ error: 'CreateOS key missing. Configure the server and restart it.' }); return; }
  if (parsed.data.mode === 'agent' && !modelConfig().key) { res.status(503).json({ error: 'Model credential missing. Use guided sandbox mode or configure a model key.' }); return; }
  busy = true;
  const controller = new AbortController();
  activeJob = controller;
  const timer = setTimeout(() => controller.abort(new Error('Investigation exceeded its five minute budget.')), 300_000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  res.status(200).set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const emit = (event: unknown) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
  try { await investigate(parsed.data, emit, controller.signal); }
  catch (error) {
    // Never serialize SDK/provider error objects or request headers containing keys.
    const known = error instanceof Error && !/skp_|Bearer |api.key|authorization/i.test(error.message) ? error.message : 'Investigation failed. Check credentials, quota, or network connectivity.';
    emit({ type: 'error', time: new Date().toISOString(), message: known.slice(0, 500) });
  } finally { clearTimeout(timer); busy = false; activeJob = null; res.end(); }
});
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (req, res) => { if (req.path.startsWith('/api/')) res.status(404).json({ error: 'Unknown API route.' }); else res.sendFile(`${dist}index.html`); });
}
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const tooLarge = error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large';
  res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Request exceeds the size limit.' : 'Invalid request.' });
});
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '127.0.0.1', () => console.log(`Checkout Autopsy API: http://127.0.0.1:${port}`));
server.requestTimeout = 930_000;
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  activeJob?.abort(new Error('Server shutting down; cleaning up the sandbox.'));
  server.close(() => process.exit(0));
  // Leave enough time for the independent destroy and terminal-state check.
  setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 50_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
