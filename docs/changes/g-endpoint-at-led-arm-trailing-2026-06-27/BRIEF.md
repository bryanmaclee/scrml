# BRIEF — ss49 item 2: g-endpoint-at-led-arm-trailing-expr-dropped (MED)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Base:** origin/main `2310b53a` (sPA lands on `spa/ss49`) · **VERIFY-FIRST + S215 adversarial**

## The gap (docs/known-gaps.md:2533, `@gap id=g-endpoint-at-led-arm-trailing-expr-dropped`)

An `@`-led bare-body `<endpoint>` arm silently DROPS its trailing value-expr — the arm's
return value never emits. Surfaced by ss34. (Adjacent precedent: ss34 §61.10
E-ENDPOINT-MULTI-STATEMENT-ARM, commit `f76f9fd0`.)

## VERIFY-FIRST (S138 R26-reverse — BEFORE any fix)

Reproduce on REAL source at baseline `2310b53a`. Construct an `<endpoint>` with an `@`-led
bare-body arm whose trailing expr is the intended return value; compile; inspect the emitted
`.server.js` handler and confirm the trailing value-expr is MISSING from the response
envelope (vs a brace-body arm which emits it). If it does NOT reproduce → NOT-REPRODUCED +
PARK with evidence. Read the full known-gaps entry first.

## Fix

The arm-body envelope emit is `emitEndpointArmEnvelope` (`emit-server.ts:2385`, reads
`arm.bodyRaw`). The §61.4 dispatch + §61.5 JSON success-envelope are noted at
`emit-server.ts:819–832`. Make the `@`-led bare-body form CAPTURE + EMIT the trailing
value-expr (mirror how the brace-body arm captures its return value). PRESERVE the §61.5
success-envelope (direct-serialize) shape — do not change the envelope contract, only ensure
the `@`-led bare-body's value flows into it.

## S215 adversarial (arm-form matrix)

Construct and verify each emits its return value correctly (or is correctly unchanged):
- **brace-body** arm `{ … return v }` — unchanged (the reference that already works). ✓
- **`@`-led bare-body** arm — NOW emits the trailing value-expr (the fix). ✓
- **`:`-shorthand** arm (`<Variant : expr>`) — verify still correct. ✓
- **self-closing `<Variant/>`** (204 No-Content) — unchanged (no body, no value). ✓
- wildcard / catch-all arm if present — verify trailing-expr handling matches.

## Verify
- R26: compile the repro, `node --check` the emitted server JS, confirm the handler's
  response envelope now contains the arm's value.
- FULL `bun run test` (NOT the pre-commit subset). If you touch ANY shared codegen
  golden/within-node-parity baseline, FLAG it in your return (do not silently rebaseline; a
  sibling ss49 agent shares the server-emit surface).

## Footprint & commit discipline
`emit-server.ts` endpoint arm emit (§61.5 envelope). Commit incrementally in your worktree;
coupled code+test = one commit; NEVER `--no-verify`; NEVER write outside your worktree.
Return: branch tip SHA, files changed, VERIFY-FIRST repro evidence, the arm-form matrix
results, full-suite result, any shared-baseline flag.
