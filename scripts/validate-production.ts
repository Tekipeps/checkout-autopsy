import { readFile } from 'node:fs/promises';
import { runProductionValidation } from '../server/production-run';

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error('Production validation exceeded fifteen minutes.')), 900_000);
process.once('SIGINT', () => controller.abort(new Error('Interrupted; cleaning up the sandbox.')));
process.once('SIGTERM', () => controller.abort(new Error('Terminated; cleaning up the sandbox.')));
try {
  const path = process.argv[2];
  const source = path ? await readFile(path, 'utf8') : undefined;
  if (source && (source.length < 30 || source.length > 30_000)) throw new Error('Node module must contain 30–30,000 characters.');
  const report = await runProductionValidation({ source }, event => console.log(`${event.time} ${event.type}: ${event.message}`), controller.signal);
  if (!report.verified || !report.cleanup) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Production validation failed.';
  console.error(/skp_|Bearer |authorization|api.key/i.test(message) ? 'Validation failed; check provider access or quota.' : message.slice(0, 1500));
  process.exitCode = 1;
} finally { clearTimeout(timer); }
