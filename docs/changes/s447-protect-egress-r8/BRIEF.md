change-id: s447-protect-egress-r8

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind after fetch: `git merge --ff-only origin/main`). Any other failure: STOP.
2. `bun install`; `bun run pretest` (plainly from the worktree CWD).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash` — base/build flips by FILE COPY. NEVER a bare `pkill -f` — kill only PIDs you captured.
4. First commit: this prompt verbatim → docs/changes/s447-protect-egress-r8/BRIEF.md (`WIP(s447-protect-egress-r8): start at $(pwd)`). Commit after each change; progress.md append-only. Code + tests = one commit. Never --no-verify.

MAPS — REQUIRED FIRST READ: /home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md (treat as hypothesis; protect-flow.ts is the locus). Report whether load-bearing.

## Context
SPEC §14.8.9 IN FULL (server→client confidentiality, protect=). Read docs/changes/s447-protect-egress-r7/{BRIEF.md,progress.md} (round 7's mechanism: `this` = receiver from every supply route; implicit invocation of functions at protocol/accessor/computed keys; thenables; tags; instanceof; precision narrowings that keep examples/23 clean) and docs/known-gaps.md `g-protect-egress-round-8-residuals` (your scope, every repro listed). Reviewer HTTP harness (read-only, reuse): /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/777e6bc5-4a13-4cb4-b3a0-497aaeb21665/scratchpad/rev-protect-work/ and the r7 reviewer probes /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/17c3ea11-5d17-485a-8214-b313dd20b818/scratchpad/rev-protect-r7/ (atk*.mjs). Security is in impl#1 policy (S435).

## Scope — the three HIGHs share TWO roots; fix the roots, not the shapes
1. **A row held in an object field is not tracked as a row.** `const t = { h: u }; return t.h.passwordHash`, the destructured form, `JSON.stringify(t.h)` (full row incl. pin), `Object.values(t.h)`, `{ rs }` → `t.rs.map(r => r.passwordHash)`, nested `t.a.b.pin`, a getter/method reading `this.h.passwordHash`. (A row in a Map IS rejected; `[u][0].passwordHash` IS caught — find why those work and the field case doesn't.)
2. **Aliased GLOBAL receivers/hooks are not resolved.** (a) `globalThis.box17 = { h: "", set: function (r) { this.h = r.passwordHash } }; const g = globalThis.box17; g.set(u); return g` → serves the hash when the method name matches a modelled built-in (`set`) — suspected: the stored-fn invoke is skipped for global receivers and `globalFnsFor(["set"])` is empty, so the call is modelled as a Map write. (b) `instanceof` through an aliased global (`const { C14 } = globalThis`, `const C = globalThis.C10`, `const P = process; u instanceof P.C24`) — no hook applied when the global path can't be named, and no fail-closed fallback.
3. **LOW (introduced r7): the performance cliff** — 240-object `toString`-hook chain 13.7 s vs base 0.47 s; a shared `this`-writing method on N receivers ~N^2.7 (1.1/6.1/40.5 s at N=60/120/240). Bring it back near base without losing precision.
4. **LOW (fails closed): per-function `this`** — `a.w("ok"); b.w(u.passwordHash); return a` → E-PROTECT-006. Fix only if the mechanism change for 1/2 makes it cheap; otherwise leave filed.

**STOP CONDITION (the S445 durable):** if your fix for 1 or 2 is a list of recognized shapes, stop and find the mechanism. Candidate directions (evaluate, don't assume): field-sensitive points-to where an object field holding a row-bearing value makes the container row-bearing for every projection/serialization; an alias-class for the global heap such that any binding read from `globalThis`/`process`/a global namespace resolves to the same abstract object as its named path (and when it can't be named, FAIL CLOSED — the unknown-call rule — rather than drop the hook).

## Verification (mandatory)
- Reproduce every in-scope item over HTTP on origin/main FIRST (all three sinks: fn response, `/__mountHydrate`, SSR state script), then after.
- Migration: compile examples/ samples/ conformance/cases/ docs/readme-snippets/ stdlib/ before/after — report new/removed E-PROTECT-006 + strip-tag changes (must be 0 or each justified); examples/23 login identical over HTTP.
- Perf table: the cliff shapes + g2-deep N=8/32/128 + examples/23 build time, base vs r7 vs yours.
- Suite: `bun test compiler/tests/{unit,integration,conformance}` + protect tests + `compiler/tests/commands/`.
- known-gaps: a ROUND 8 note on the residuals entry (what closed, by what mechanism, evidence); file a round-9 entry for anything still open (locus=, prov=). Amend §14.8.9 to remove the two ⚑ known-residual notes only if you truly closed them — quote the sentence.
- Do NOT open a PR. Push: `git push origin HEAD:refs/heads/wip/s447-protect-egress-r8`.

Final report: worktree path, FINAL_SHA, files touched, per-item before/after, the mechanism in ≤8 lines, migration counts, perf table, test counts, honest list of suspected remaining leaks, path-discipline incidents.
