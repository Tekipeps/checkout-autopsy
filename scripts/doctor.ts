import { createClient } from '@nodeops-createos/sandbox';

const apiKey = process.env.CREATEOS_SANDBOX_API_KEY || process.env.CREATEOS_API_KEY || process.env.CREATEOS_PROJECT_API_KEY || process.env.CREATEOS_PLAN_API_KEY;
if (!apiKey) {
  console.error('CreateOS key missing. Configure CREATEOS_SANDBOX_API_KEY in .env.local.');
  process.exitCode = 1;
} else {
  // Native fetch avoids retaining an SDK HTTP/2 session in this one-shot CLI.
  const client = createClient({ apiKey, fetch: globalThis.fetch, timeoutMs: 15_000, retry: false });
  try {
    const { stats } = await client.whoami();
    console.log(JSON.stringify({
      createos: 'authenticated',
      endpoint: process.env.CREATEOS_SANDBOX_BASE_URL ?? 'https://api.sb.createos.sh',
      sandboxes: stats,
      note: 'Read-only check. No sandbox created or paid plan selected.',
    }, null, 2));
  } catch (error) {
    // SDK errors can contain request context. Keep credentials and raw headers out of logs.
    const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
    console.error(JSON.stringify({ createos: 'unavailable', status }));
    process.exitCode = 1;
  }
}
