# raw-egress-r9 — fix round (append-only)

Branch: `raw-egress-r9-work`, cut from `raw-egress-r8-work` @ 41b4dc1a1a29cd7ed09b183f82c862e5684e6ad0.
Scope: two surgical fixes from the adversarial DO-NOT-LAND review. No redesign.

- FINDING 1 (BLOCKING): `emit-server.ts:4037` `Response` passthrough emitted BEFORE `_egressRedact` in the
  baseline-CSRF arm. Remediation: gate on `!_protectActive && !_tenantActive`.
- FINDING 2 (MED): `protect-egress.ts:501` `ESCAPE_HATCH_SQL_RE = /\?\s*\{/` is a text test on source;
  a ternary with object-literal branches spells `? {`. Rule 7 violation. Remediation: structural route.

## Log

- 2026-08-23 start. worktree=/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae306b9274202cb14 HEAD=41b4dc1a1a29cd7ed09b183f82c862e5684e6ad0
