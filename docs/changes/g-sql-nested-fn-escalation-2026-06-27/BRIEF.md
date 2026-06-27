# BRIEF — ss49 item 1: g-sql-in-nested-function-client-leak (MED)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Base:** origin/main `2310b53a` (sPA lands on `spa/ss49`) · **VERIFY-FIRST + S215 adversarial**

## The gap (docs/known-gaps.md:2625, `@gap id=g-sql-in-nested-function-client-leak`)

A nested `function ins(x){ ?{…} }` declared INSIDE another function does NOT participate in
§12 server-placement inference. Its `?{}` SQL is treated client-side → the loud `E-CG-006`
fires (the server `_scrml_sql` leak is CAUGHT, not silently emitted). Hoisting the same fn
to a sibling TOP-LEVEL decl escalates cleanly and compiles. So a *legal* nested-fn-with-SQL
is wrongly rejected. Loud diagnostic — no silent data leak.

## VERIFY-FIRST (S138 R26-reverse — do this BEFORE any fix)

Reproduce on REAL source at the current baseline (`2310b53a`). Construct a nested-fn-with-SQL
program; compile it; confirm `E-CG-006` actually fires; confirm the top-level-hoist sibling
compiles clean. If the symptom does NOT reproduce, classify NOT-REPRODUCED and PARK with the
evidence — do not fix a phantom. Read the full known-gaps entry first.

## Fix

Extend server-placement inference (§12.2 Trigger 1 region is ~`type-system.ts:6946–7021`;
the escalation walk) to **recurse into nested function declarations**: escalate the enclosing
fn to server when a nested fn touches a server-only resource (`?{}` SQL / other server-only
node). The E-CG-006 fire sites are `scheduling.ts:455/684/720` + `emit-functions.ts:368` —
once the enclosing fn is correctly server-placed, the nested `?{}` is no longer in a
client-boundary body and E-CG-006 should not fire.

## S215 adversarial (the server/client partition is LOAD-BEARING)

Do NOT widen escalation so far it pulls genuinely-client code server-side. Construct and
verify each:
- A nested fn with `?{}` → enclosing fn escalates, compiles, SQL emits server-side. ✓
- A nested fn that is GENUINELY client (no server-only resource) → enclosing fn must NOT be
  escalated (partition still holds). ✓
- Deeper nesting (fn in fn in fn) with `?{}` at the innermost → still escalates the outermost
  needed. ✓
- A nested fn with `?{}` alongside a sibling client-only nested fn → escalate correctly
  without dragging the client sibling server-side.
- Arrow-body `?{}` (ss47 #12 adjacency) — confirm your change doesn't regress or double-fix it.

## Verify
- R26: compile the repro, `node --check` the emitted server JS, confirm the SQL lands in
  `.server.js` and NOT in client bundle.
- FULL `bun run test` (NOT the pre-commit subset). Re-baseline within-node parity only if a
  fixture legitimately shifts — and if you touch ANY shared codegen golden/parity baseline,
  FLAG it in your return (do not silently rebaseline; a sibling ss49 agent may share it).

## Footprint & commit discipline
`type-system.ts` server-escalation walk + the E-CG-006 fire-site interaction. Commit
incrementally in your worktree; coupled code+test = one commit; NEVER `--no-verify`; NEVER
write outside your worktree. Return: branch tip SHA, files changed, VERIFY-FIRST repro
evidence, adversarial-case results, full-suite result, any shared-baseline flag.
