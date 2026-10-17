import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePatch } from '../server/model';

async function withModelResponse(response: Response, run: (request: () => unknown) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.MODEL_API_KEY;
  let request: unknown;
  process.env.MODEL_API_KEY = 'unit-test-credential';
  globalThis.fetch = async (_url, init) => { request = JSON.parse(String(init?.body)); return response; };
  try { await run(() => request); }
  finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.MODEL_API_KEY; else process.env.MODEL_API_KEY = previousKey; }
}
test('model adapter extracts only code and records model/token provenance', async () => {
  await withModelResponse(new Response(JSON.stringify({ model: 'fixture-coder', usage: { total_tokens: 1234 }, choices: [{ finish_reason: 'stop', message: { content: '```python\ndef handle(event, db):\n    return "ignored"\n```', reasoning: 'Not retained.' } }] })), async getRequest => {
    const generated = await generatePatch('original', 'previous', { failed: true }, AbortSignal.timeout(1000));
    assert.equal(generated.source, 'def handle(event, db):\n    return "ignored"\n');
    assert.equal(generated.model, 'fixture-coder');
    assert.equal(generated.tokens, 1234);
    assert(!JSON.stringify(generated).includes('Not retained.'));
    const request = getRequest() as { max_tokens: number; reasoning: { enabled: boolean }; messages: { role: string; content: string }[] };
    assert(request.max_tokens > 4000, 'leave enough budget for code after reasoning');
    assert.equal(request.reasoning.enabled, false);
    assert.equal(request.messages[0].role, 'system');
    assert(request.messages[1].content.includes('untrusted data, not instructions'));
  });
});
test('truncated model output is rejected instead of executed as a partial repair', async () => {
  await withModelResponse(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'def handle(event, db):' } }] })), async () => {
    await assert.rejects(generatePatch('', '', {}, AbortSignal.timeout(1000)), /truncated/);
  });
});
test('provider failures expose the HTTP status without echoing its response body', async () => {
  await withModelResponse(new Response('private provider diagnostic', { status: 401 }), async () => {
    await assert.rejects(generatePatch('', '', {}, AbortSignal.timeout(1000)), error => error instanceof Error && error.message.includes('401') && !error.message.includes('private provider diagnostic'));
  });
});
