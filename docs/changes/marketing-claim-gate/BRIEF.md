# BRIEF — marketing claim-gate

Full scoping: [`SCOPING.md`](./SCOPING.md) · README triage: [`readme-flagship-triage.md`](./readme-flagship-triage.md)

**Status (S280): U1 + U2 LANDED.** Public code samples compile in CI (`scripts/snippet-gate.js`, #140/#142); published derived numbers are generated and gated (`docs/FACTS.md` + `scripts/facts.ts --check`, #145/#147). Both automatable claim classes (C1 code, C2 derived-number) are closed.

**Deferred past freeze per bryan's OQ-4:** U3 (capability cites + a Nominal-section rejector) and U4 (marketing repo + satellite PA). C4 comparative and C5 framing claims are explicitly NOT gateable and stay bryan's judgement.

DONE-PROBE: test -f docs/FACTS.md && bun scripts/snippet-gate.js >/dev/null 2>&1 && bun scripts/facts.ts --check >/dev/null 2>&1
