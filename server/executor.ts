import { createClient, type Sandbox } from '@nodeops-createos/sandbox';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Trial } from '../shared/types';

const root = fileURLToPath(new URL('../', import.meta.url));
export const readAsset = (path: string) => readFile(`${root}${path}`, 'utf8');
export function sandboxKey() { return process.env.CREATEOS_SANDBOX_API_KEY || process.env.CREATEOS_API_KEY || process.env.CREATEOS_PROJECT_API_KEY || process.env.CREATEOS_PLAN_API_KEY; }
export async function openSandbox(signal: AbortSignal): Promise<Sandbox> {
  const apiKey = sandboxKey();
  if (!apiKey) throw new Error('CreateOS credential missing. Configure CREATEOS_SANDBOX_API_KEY.');
  const client = createClient({ apiKey, fetch: globalThis.fetch, timeoutMs: 60_000, retry: false });
  // A nonempty allowlist permits only this reserved documentation address.
  // Empty egress would allow the entire internet. No model or Stripe key enters the VM.
  const sandbox = await client.createSandbox({
    shape: 's-1vcpu-1gb', rootfs: 'devbox:1',
    name: `autopsy-${Date.now().toString(36)}`,
    egress: ['192.0.2.1'], ingress_enabled: false, auto_pause_after_seconds: 120,
  }, { signal, timeoutMs: 60_000 });
  try {
    const setup = await sandbox.runCommand('mkdir', ['-p', '/tmp/autopsy'], { signal, timeoutMs: 15_000 });
    if (setup.result.exit_code !== 0) throw new Error('Could not prepare the sandbox workspace.');
    await sandbox.files.upload('/tmp/autopsy/runner.py', await readAsset('sandbox/runner.py'), { signal });
    await sandbox.files.upload('/tmp/autopsy/worker.py', await readAsset('sandbox/worker.py'), { signal });
    return sandbox;
  } catch (error) {
    try { await sandbox.destroy({ timeoutMs: 20_000 }); }
    catch { throw new Error(`Sandbox preparation failed and cleanup could not be confirmed. Remove sandbox ${sandbox.id} with the CreateOS CLI.`); }
    throw error;
  }
}
export async function executeSuite(sandbox: Sandbox, source: string, trials: Trial[], signal: AbortSignal) {
  await sandbox.files.upload('/tmp/autopsy/handler.py', source, { signal });
  await sandbox.files.upload('/tmp/autopsy/trials.json', JSON.stringify(trials), { signal });
  const response = await sandbox.runCommand('timeout', ['50s', 'python3', '-I', '/tmp/autopsy/runner.py', '/tmp/autopsy/handler.py', '/tmp/autopsy/trials.json'], { signal, timeoutMs: 60_000 });
  if (response.result.exit_code !== 0) throw new Error(`Replay driver exited ${response.result.exit_code}. Candidate exceeded limits or damaged the replay environment.`);
  if (response.result.stdout.length > 500_000) throw new Error('Replay evidence exceeded the output limit.');
  try { return { raw: JSON.parse(response.result.stdout) as unknown, execMs: response.exec_ms, exitCode: response.result.exit_code }; }
  catch { throw new Error('Replay driver did not return valid evidence.'); }
}
