# BRIEF — Conformance coverage for scrml auth (§52 authority + §40.1.1 auth-graph, E-AUTH family)

Dispatch: Deepen conformance coverage for scrml auth (§52 session/@currentUser + auth flows + the
E-AUTH codes). Isolated worktree — do NOT land to main; commit per-item on branch; the PA reviews +
integrates. Mirror the landed realtime/endpoint/capability conformance pattern
(`conformance/cases/{channel,endpoint,capability}/`).

## VERIFY FIRST (verify ground truth, not the docs)
1. `ls conformance/cases/auth/` + read the existing cases (last check: only `auth-003-pos`/
   `auth-003-neg` — E-AUTH-003 covered; the rest of the E-AUTH family is UNCOVERED). Read them so
   you match their shape + don't duplicate.
2. `grep -oE 'E-AUTH-[A-Z0-9-]+' compiler/SPEC.md | sort -u` — the full code surface
   (E-AUTH-001..005 + E-AUTH-GRAPH-001..004). `bun conformance/run.ts` baseline (currently 279).
   Author cases for the UNCOVERED E-AUTH codes + auth surface — do NOT re-author E-AUTH-003.

## Rule 4 — read the auth SPEC IN FULL
Find + read the auth SPEC section(s): grep for the `E-AUTH-*` fire-sites + the auth model —
`@currentUser`, `<auth role=>`, `protect=`, session, and the auth flows (magic-link / email-verify
/ password-reset, JWKS RS256 — landed S242). Read the subsections that define each uncovered
E-AUTH / E-AUTH-GRAPH code. Author to the SPEC.

## Scope + method
Author codes + compile-shape for the uncovered E-AUTH-001/002/004/005 + E-AUTH-GRAPH-001..004
(whatever they actually gate — read the SPEC to learn each). Positive (code fires) + negative
(clean) cases. The auth RUNTIME (actual login/session/JWKS verification) is likely
server-side/harness-gated like protect/SSR — author the CODES + compile-shape half; FLAG runtime
cases that need a driver the adapter lacks (do NOT fake-test with a stub). Check whether the
existing server-side adapter seam (`runServer`/`evalServerModule`, used by protect/SSR cases) can
soundly drive any auth runtime — if yes author it, if no flag it.

`conformance/README.md` contract: each case = `{case.scrml, expected.json}` asserting (a) codes +
(b) runtime effect; message/emitted-JS = impl-freedom. Put cases under the existing `auth`
category. Use CANONICAL shapes (existing auth-003 cases + real samples — don't invent).
**EMPIRICAL-FIRST + Rule 4:** probe impl#1 AND read the SPEC subsection before each expected.json;
author to SPEC + ESCALATE any impl-vs-SPEC divergence (don't bless impl, don't decide).

## Verify + land (branch only)
`bun conformance/run.ts` all green + `bun test compiler/tests/conformance/corpus-bridge.test.js`.
Commit per-item/sub-feature on your branch; do NOT push/advance main.

## Deliverables
- S136: this `BRIEF.md` + `progress.md`.
- Return: existing auth coverage found; case-ids authored (which E-AUTH codes); which auth runtime
  FLAGGED as harness-gated; oracle before→after; any impl-vs-SPEC auth divergence (escalated);
  branch tip SHA. Do NOT claim done without the `bun conformance/run.ts` output. Do NOT land.
