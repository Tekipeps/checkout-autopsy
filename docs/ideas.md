# Product decision — Checkout Autopsy selected

These are design judgments, not published judging criteria or predictions of winning.
Evaluate a clear user problem, essential generated-code execution, a visible failure-to-recovery demo, independent verification, and a small reliable scope.

| Idea | Generated code | Demo reveal | Main risk |
| --- | --- | --- | --- |
| Checkout Autopsy | Event replay experiments and a patched webhook handler | Duplicate/out-of-order events cause duplicate fulfillment; patched handler survives an unseen replay | Needs real state assertions, not merely HTTP 200 |
| SchemaShift | Adapter between two changing API payloads | Rename/restructure fields live; agent repairs the integration and passes external contract tests | A simple rename can look trivial; include units and nullable fields |
| Cutover | Database migration and rollback scripts | Proposed migration loses records; agent repairs it, preserves invariants, and proves rollback | Scope one small SQLite schema; avoid production claims |
| ClaimCheck | Data-analysis scripts and counterexample searches | A plausible dashboard claim fails when segment composition is checked | Must distinguish descriptive evidence from causal claims |
| QuerySprint | SQL rewrites and benchmark experiments | Identical answers, visibly fewer scanned rows or lower measured runtime | Timing noise; require exact result equivalence and repeated runs |
| PowerShift | Battery/load scheduling simulation | Grid outage arrives; generated schedule preserves selected shop operations within physical constraints | Synthetic assumptions must be explicit; no real electrical control |
| Reroute | Route allocation and scheduling simulation | Driver breakdown, replanning, and externally verified route metrics | Simulated map can feel decorative; optimization scope grows quickly |

The user selected Checkout Autopsy. The initial implementation focuses on duplicate and premature fulfillment, real CreateOS execution, model repair with feedback, and independent database-state checks. The other ideas are retained as research history.

For every option, keep the independent checker outside the agent-editable files, show actual stdout/exit code, retain generated source, and run a previously unseen input before claiming success.
