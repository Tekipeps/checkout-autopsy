# Three-minute demo

**Opening line:** “Your webhook returned success. Did your business state survive the retry?”

1. **0:00–0:30 — Challenge the input.** Choose **Bring your own handler**. Paste the new implementation and seven deliveries from [the challenge](challenges/README.md), or let a judge supply a different implementation within the shown Python/SQLite contract. Point out two distinct checkouts and GBP/EUR prices. This is synthetic data; no charges are made.
2. **0:30–1:00 — Reproduce.** Select **Live agent** and start. Show the actual CreateOS sandbox ID. Inspect the first committed state where the original diverges. HTTP success cannot tell you whether the correct orders were fulfilled.
3. **1:00–1:45 — Repair from evidence.** Show the generated source and live execution feed. The model sees failures and can retry up to three times. Explain that repair-suite holdouts may become feedback, so passing that suite alone is insufficient.
4. **1:45–2:30 — Freeze, then audit.** Show the SHA-256 freeze entry and separate twelve-case final audit. Fresh inputs are generated after freezing: new prices, currencies, IDs, permutations and concurrent deliveries. The model never sees those inputs or results. A failed audit withholds verification, with no additional model attempt.
5. **2:30–3:00 — Show the receipts.** Open Evidence. Compare original/candidate rows in both phases, confirm sandbox destruction, and download the patch and JSON evidence bundle. State the actual outcome—even when the audit fails.

**Pitch:** “Checkout Autopsy turns a payment-handler bug into an executable counterexample, a proposed patch, and a fresh audit that the model cannot learn from during the run.”

The three presets remain a quick introduction. The stronger demo uses a supplied implementation and altered deliveries. Each run uses fresh repair/audit seeds and consumes one sandbox creation; prepare inputs before running and allow for model latency. If the model is unavailable, **Guided sandbox** is an explicit reference-repair demonstration, not a live AI result.

Say **“passes these replay checks”**, not “guaranteed correct.” The side effect proven here is a persisted SQLite shipment record, not a real parcel shipped.

## Showing the broader integration evidence

Open **Production support** for the Node/Express/Stripe SDK/PostgreSQL profile. Identify the report as a **recorded campaign**, with its timestamp and observed runtime versions. Show the reference control separately from AI repair results. The default three modules are deliberately introduced fault mutations, not three customer applications.

Inspect one exact AI edit and the paired repair/audit rows. The crash cases use real SIGKILL against service/worker processes; the observer reads real PostgreSQL state and an HTTP test recipient's accepted effects. Signature tests use locally signed SDK test payloads. Show the stable candidate hash and confirmed sandbox destruction.

For a live audience challenge, import a different JavaScript ESM module within the displayed contract and run it when quota permits. A campaign takes several minutes; do not present saved results as a fresh live run. The support matrix and exclusions are in [production-support.md](production-support.md).

## Submission items

- Public source repository, with credentials and `artifacts/` excluded.
- Hosted app or published package, as required by the participant guide.
- Stripe Projects share link and account information requested by the form.
- Event-specific hackathon code from organizers.
- Live AI-backed run and concise demonstration video.
- Confirm the submission lock time. Publishing and submitting are separate steps from this local build.
