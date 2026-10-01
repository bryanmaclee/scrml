change-id: s447-protect-egress-r7

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Any failure: STOP, report, exit.
2. `bun install` then `bun run pretest` (plainly from the worktree CWD).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash` (shared across worktrees) — base/build flips by file copy. NEVER bare `pkill -f`/`killall` — kill by captured PID.
4. First commit: this prompt verbatim → docs/changes/s447-protect-egress-r7/BRIEF.md, message `WIP(s447-protect-egress-r7): start at $(pwd)`.
5. Commit after each meaningful change; docs/changes/s447-protect-egress-r7/progress.md append-only timestamped. Code + tests = one commit. Never --no-verify; never touch core.hooksPath.

MAPS — REQUIRED FIRST READ: /home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md (stamp 464c9ab4d; post-map landings: #1201 program role by ancestor). Report whether load-bearing.

## Context
SPEC §14.8.9 (server→client confidentiality; protect=) — read it IN FULL first (grep -n "14.8.9" compiler/SPEC.md). Rounds 1-6e history + the open residual entry: docs/known-gaps.md — read `g-protect-egress-round-6-residuals` (resolved; the round notes describe the current MECHANISM: per-column registry-Symbol markers read by presence, the sink owns serialization via `_scrml_protect_redact` plain-data snapshot, author toJSON/getters invoked with `this` = a marker-stripped copy, compile-time removal rule) and `g-protect-egress-round-7-residuals` (open — your scope). Prior round's change dir: docs/changes/s443-protect-egress-r6/. Reviewer HTTP harness (read-only, reuse): /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/777e6bc5-4a13-4cb4-b3a0-497aaeb21665/scratchpad/rev-protect-work/ (probe.mjs, a1-a16 — served probe: compile, seed SQLite with `SECRET-HASH-123` / pin `4321`, serve emitted routes with Bun.serve, POST, scan body + headers).
Policy: impl#1 (TS compiler) changes are allowed for SECURITY (S435). This is security.

## Scope (round 7)
1. **HIGH — writes through `this`:** `u.stash = function () { this.x = this.passwordHash }; u.stash(); return u` and `const o = { h: "" }; o.set = function (r) { this.h = r.passwordHash }; o.set(u); return o` ship the hash. Fix direction (locus PA-located-verify: compiler/src/codegen/protect-flow.ts, ThisExpression handling): model `this.p = v` inside a function stored on an object as a write INTO that object (join v into the object's provenance, as `o.p = v` is) WITHOUT unifying alias classes — the 6e attempt that unified aliases false-fired E-PROTECT-006 on examples/23 login (the compiler's own session object). examples/23 MUST stay clean.
2. **HIGH — implicit invocation:** tagged-template tag (`` tag`${h}` ``, tag via method), coercion hooks `toString` / `valueOf` / `Symbol.toPrimitive` (`` `${o}` ``, `o + 0`), `[Symbol.iterator]` generators consumed by spread / for…of / destructuring. Fix direction: an object holding a function under those keys (and any template tag) is treated as invoked wherever the language would invoke it; fail closed when unknown.
3. **MED — `./_scrml/auth.js` posing as stdlib:** `isStdlibDeriver` matches the path shape; make it match only the compiler's own stdlib bundle identity.
4. **MED — `scrml dev` echoes `err.message`:** compiler/src/commands/dev.js route-handler catch returns `{detail: err.message}` (the SQLite message can carry a protected value). Under protect= (or always — justify) return a generic 500 and log server-side, matching the prod entry.
OUT of scope (leave filed): G2 global-rooted method results, performance.mark, `import.meta.env` miscompile, hmac-key LOWs, Postgres/rowid/view carried items.

**STOP CONDITION (S445 durable lesson — read it):** rounds 6-6e each found a new runtime shape of the same class; what ended the loops was changing the MECHANISM, not adding a recognizer. If your fix for 1 or 2 is a list of recognized shapes, stop and look for the mechanism (e.g. any function value reachable from a row-bearing object is treated as possibly invoked with that object as `this`). Prefer the fail-closed over-approximation; measure its false-positive cost.

## Verification (mandatory)
- Reproduce every in-scope item over HTTP on origin/main FIRST (record), then after fix (body + headers clean / E-PROTECT-006 as appropriate). All three sinks: fn response, `/__mountHydrate`, SSR state script.
- Direction-of-change: new E-PROTECT-006 fires are newly-rejecting → MEASURE migration: compile examples/ samples/ conformance/cases/ docs/readme-snippets/ stdlib/ before and after; report counts of new E-PROTECT-006 and new strip tags (must be 0, or list each with justification). examples/23 login specifically clean.
- Performance: the g2 deep-chain shape must not regress beyond round 6e (record timings).
- Suite: `bun test compiler/tests/{unit,integration,conformance}` + every top-level compiler/tests/*.test.js touching protect + compiler/tests/commands/ for dev.js.
- Update the known-gaps entry: a ROUND 7 note on `g-protect-egress-round-7-residuals` (what closed, by what mechanism, evidence), leave out-of-scope items open (or file a round-8 residual entry with locus=/prov=). Amend SPEC §14.8.9 only if a SHALL sentence was false and you made it true — quote it.

Final report: worktree path, FINAL_SHA, files touched, per-item before/after evidence, migration counts, perf, test counts, path-discipline incidents, and an honest list of shapes you suspect still leak.
