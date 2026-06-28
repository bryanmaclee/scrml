# BRIEF — g-markup-session-read-2026-06-28 (dispatched S229)

Agent: scrml-js-codegen-engineer · isolation:worktree · opus · background · id a99de72af2cf374cc
Gap: g-markup-session-read-undeclared (LOW, gate-1-ruled-markup-legal S228) → resolved

---

# TASK — g-markup-session-read-undeclared (LOW, change-id: g-markup-session-read-2026-06-28)

A `@session` read in **markup context** fires `E-STATE-UNDECLARED`, even though a `@session` read in **logic context** resolves fine. After the S224 Ryan #15 fix window-anchored the `@session` projection to a singleton, markup lost the ability to read it. **The user RULED (S228) that markup IS a legal read locus for `@session`** (consistent with the §51.0.A engine-singleton ambient-read precedent: a component reads an engine auto-cell via `@cellName` in markup; `@session` is the same shape). Wire `@session` into markup symbol-resolution so the markup read resolves and emits correctly.

## THE FIRE SITE (confirmed by PA)
`compiler/src/type-system.ts` ~lines 6473-6510 — the read-side `E-STATE-UNDECLARED` walker (S192 "bug-12-vkill, post-CE relocation"). Strips `@` → `atBase`; exempts `@.`/`@_`/`typeRegistry`/`knownFnNames`; resolves via `scopeChain.lookup(@name) ?? scopeChain.lookup(atBase)`; a miss fires `E-STATE-UNDECLARED` at ~6501. `@session` misses (not a registered cell/loop-local/import). The §51.0.A engine auto-cell does NOT fire because it IS registered in the scopeChain as a StateCellRecord; `@session` (a window-scoped projection) was never given equivalent ambient recognition.

## PHASE 0 — SURVEY FIRST
Nuance: `route-inference.ts:450-451` documents `session` as a **server-only resource (§20.5)**, but the gap concerns a separate **client-visible window-scoped `@session` projection** (S224 Ryan #15 singleton). Survey + report:
1. Reproduce the asymmetry (markup fires / logic resolves); find the EXACT path that resolves a LOGIC `@session` read today (the path markup must mirror).
2. Locate the S224 Ryan #15 `@session` window-scoped projection; understand what session fields it exposes to the client.
3. SECURITY GUARD (STOP condition): confirm the window-scoped projection markup would read is CLIENT-SAFE, not the server-only `session` object. If wiring markup `@session` would leak server-only data into client markup/HTML, STOP and report — do not suppress the error (would regress the protect=/server-only guarantee; needs a design ruling despite gate-1).

## THE FIX (if Phase 0 clean)
Make the read-side walker (+ sibling markup-read resolution) recognize `@session` as an ambient read, mirroring §51.0.A. Preferred: register `@session` (window-scoped projection) as an ambient scopeChain entry so lookup resolves it everywhere (logic + markup), composing for future projections. Minimal fallback: a small named ambient-projection exemption alongside the `@_`/`typeRegistry`/`knownFnNames` guards, tightly scoped. **Wire the READ, don't just silence the error** — confirm markup `@session` emits the same projection-access codegen as the logic read.

## VERIFICATION (mandatory)
1. Markup `@session` no longer fires E-STATE-UNDECLARED + emits a correct read.
2. A genuinely-undeclared `@typoCell` markup read STILL fires E-STATE-UNDECLARED (negative test — do not over-suppress).
3. Logic `@session` still works.
4. R26 — compile + inspect emitted JS for a markup `@session` read (accesses the projection, node --check clean; RUN if synthesizable).
5. No server-only leak (tie to Phase 0 §3).
6. Full `bun run test` → 0 fail; within-node re-baseline in-same-landing if any fixture shifts.
7. New tests (markup-resolves + typo-fires + logic-works).
8. Flip the @gap token open→resolved (do NOT run state.ts --write — PA-owned at landing).

(F4 startup-verification + path-discipline + commit-discipline + maps + final-report blocks per the standing dispatch template — included verbatim in the dispatched prompt.)
