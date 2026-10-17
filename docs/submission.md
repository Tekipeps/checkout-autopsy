# Checkout Autopsy — submission packet

## Project

**Tagline:** A successful response. A broken checkout.

**Description:** Checkout Autopsy is an AI payment-handler repair lab. It reproduces silent fulfillment failures inside disposable CreateOS micro-VMs, proposes evidence-driven repairs, then freezes each patch's SHA-256 before generating fresh audit inputs. It checks durable business state and external effects rather than trusting HTTP 200. Stripe Projects provisions CreateOS, OpenRouter and Netlify.

**Demo:** https://gleeful-baklava-f89941.netlify.app

The hosted application is an interactive explorer of completed real runs. New AI executions run from the local app or CLI with the operator's own provider credentials. The public demo has no code execution endpoint or provider secrets.

**Public repository:** https://github.com/Tekipeps/checkout-autopsy

**Stack share link:** https://projects.dev/s#v1:createos~project,OpenRouter~api,Netlify~project

**Event code:** `CreateOS-2026` (organizer email).

**Evidence:** Real Node/Express + official Stripe SDK + native PostgreSQL; three authored fault mutations repaired by a real model. Repair checks 66/66, fresh frozen audits 69/69, sandbox destruction confirmed. Separate imported Python handler: 12/12 repair + 12/12 fresh audit. This is a supported integration profile and synthetic corpus, not independent customer repositories or live Stripe-delivered traffic.

## Required before judging

Organizer instructions sent October 17 say submissions lock at **5:30 PM Pacific / October 18, 1:30 AM Lagos**. A later checklist says submit by 6 PM Pacific; use the earlier cutoff.

- Public GitHub repository with README.
- YouTube demo, 2–3 minutes, with at least one team member on camera.
- Public X/LinkedIn post tagging @createosai / CreateOS.
- Team and project details in the organizer form.
- Stripe Projects leaderboard entry using event code `CreateOS-2026`.

The form link in the organizer's 12-hour email currently resolves to the Google Forms root and displays “Invalid Dynamic Link.” Obtain a working organizer form URL. Do not claim submission until the form and leaderboard show confirmation.

## 2–3 minute demo script

**0:00–0:20 — Camera on.** “I'm Tekena, and this is Checkout Autopsy. A checkout webhook can return 200 and still ship twice, lose a paid order, or accept a forged event. Our agent repairs the handler, but has to earn verification with durable evidence.”

**0:20–0:45 — Show the public demo.** “Stripe Projects provisioned our CreateOS sandbox and OpenRouter access. Generated repair code runs in a disposable micro-VM. Our verifier checks committed database state after deliveries and crashes.”

**0:45–1:35 — Node/PostgreSQL evidence.** Show 66/66 repair, 69/69 audit, Destroyed. Expand signature-bypass exact edits and test rows. “These are three deliberately introduced faults in a Node/Express integration with the official Stripe SDK and a real PostgreSQL server: signature bypass, a split order/outbox transaction, and an unstable fulfillment key. Each received one real model repair. We kill service and worker processes, retry HTTP requests, and verify external effects.”

**1:35–2:00 — Fresh audit.** Show frozen hash and audit rows. “After a repair passes, we freeze its hash and generate fresh IDs, prices, currencies and delivery orders. Those audit results never go back to the model. A failure withholds verification; a successful response alone never passes.”

**2:00–2:20 — Imported Python handler.** Switch profile and inspect original/repair. “A different synthetic handler truncated session IDs and hardcoded USD. The import workflow caught it, repaired it and passed twelve fresh audit cases.”

**2:20–2:40 — Scope and close, camera visible.** “This demonstrates the documented profiles, not arbitrary production applications or live Stripe traffic. Every input, exact edit, hash and observation can be downloaded. The value is a reviewable repair with evidence—and an agent willing to say verification failed.”

## Ready-to-post text

Built Checkout Autopsy for the @createosai × Stripe Projects hackathon: an AI agent that reproduces payment-handler failures in disposable VMs, repairs them, then faces fresh tests after its patch freezes. Real Node + Stripe SDK + PostgreSQL; 69/69 audit checks across three authored fault mutations. Evidence + source: https://gleeful-baklava-f89941.netlify.app

For LinkedIn replace @createosai with the platform's actual CreateOS mention. Attach the demo or a screenshot. Posting is not complete until its public URL is available.

## Public stack manifest

The leaderboard requires `.projects/state.json`. The user approved publishing only a minimal schema containing provider names and resource/service names. It is staged from reviewed public metadata; CLI-managed state on this workstation is left untouched and marked skip-worktree. The pre-commit hook rejects extra fields or any other `.projects/` file. Local/account state, credentials, environment values and vaults are not published.
