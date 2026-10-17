import { investigate } from '../server/investigate';
const result = await investigate({ incidentId: 'duplicate', mode: 'sandbox' }, e => {
  console.log(`${e.type}: ${e.message}`);
}, AbortSignal.timeout(180_000));
if (!result.verified || !result.cleanup || result.baseline.passed === result.baseline.total) process.exitCode = 1;
console.log(JSON.stringify({ id: result.id, baseline: `${result.baseline.passed}/${result.baseline.total}`, repaired: `${result.repaired.passed}/${result.repaired.total}`, cleanup: result.cleanup }, null, 2));
