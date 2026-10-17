# Bring-your-own-handler challenge

This is a new, hand-written synthetic implementation, separate from the three original incident presets. It is a smoke test of generalization within the documented Python/SQLite contract, not an independently collected production example or a benchmark of arbitrary Stripe applications.

To reproduce in the interface:

1. Choose **Bring your own handler**.
2. Paste [imported_handler.py](imported_handler.py) into **Original handler**.
3. Paste [deliveries.json](deliveries.json) into **Your synthetic delivery sequence**.
4. Select **Live agent** and start the autopsy. Each run consumes one CreateOS sandbox creation and uses the configured model.
5. Inspect the original state, generated candidate, repair suite, and separate **Frozen-patch audit**. Download the evidence bundle.

The input contains two distinct checkout session IDs with the same six-character suffix, delayed payment, distinct notifications, retries, and an irrelevant event. The two prices are £15.99 and €42.00. The supplied handler truncates session identity when constructing its durable fulfillment marker and hard-codes USD. The repair must preserve full checkout identity and exact price/currency.

The repair loop sees source and observed failures, but never the reference patch. After a candidate passes the repair suite, its SHA-256 is frozen. Only then does the server generate twelve fresh audit cases with varied IDs, amounts, currencies, delivery permutations, concurrent batches and negative cases. Those inputs and outcomes never become model feedback. An audit failure withholds verification; the run cannot repair again.

For a judge-led challenge, paste a different standard-library Python implementation and coherent synthetic event sequence. No source or fixture edits elsewhere in the app are required. Supported inputs are described in the interface; this is not an importer for arbitrary repositories, production credentials, Stripe SDK applications, or external fulfillment systems.

## Observed live results

Two development runs used the exact same imported source and seven deliveries on October 17, 2026, with Cohere North Mini Code through OpenRouter and real CreateOS execution.

| Run | Original repair suite | AI repair attempts | Final frozen audit | Outcome |
| --- | --- | --- | --- | --- |
| Initial | 11/12 | 7/12 → 7/12 → 11/12 | Skipped | Verification withheld; concurrency remained broken |
| After feedback improvements | 11/12 | 12/12 in one attempt | Original 3/12; patch 12/12 | Verified for these cases |

Between runs, the initial prompt gained explicit schema/transaction facts and actual visible inputs. Failure feedback gained exact expected/observed counterexamples. The test rules and imported implementation were unchanged. This is development evidence on one new implementation, **not an untouched external benchmark** or a model success-rate estimate. Both sandbox destructions were confirmed.

Verified candidate SHA-256: `c7a93fe2969a9fe530bbe9c3632f24b827560f5efd0898c74a82b316eade798c`.

Local evidence is retained in ignored `artifacts/checkout-autopsy-challenge-verified.json`, `artifacts/checkout-autopsy-challenge-failed.json`, and `artifacts/checkout-autopsy-challenge-summary.json`. The summary verifies identical imported source/deliveries across runs and hash consistency. Keep both outcomes when presenting the result.
