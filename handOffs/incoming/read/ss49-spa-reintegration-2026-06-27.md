# sPA re-integration — ss49 (server codegen: SQL placement + endpoint arm)

**From:** sPA (list `ss49-server-codegen-sql-endpoint.md`) · **Date:** 2026-06-27
**Disposition:** BOTH items FIXED + committed — but landed on `main`, NOT cleanly on `spa/ss49`.
**⚠️ ENVIRONMENT INCIDENT: isolation:worktree did not isolate; ≥3 sessions shared one checkout.**

## Both fixes (verified self-contained by inspection; full-suite green per agents)

| item | gap | SHA | files | where it landed |
|---|---|---|---|---|
| 1 | g-sql-in-nested-function-client-leak (MED) | `b731fda2` | `route-inference.ts` (+43), `emit-logic.ts` (+27) | tip of `spa/ss49` **and** in `main` history |
| 2 | g-endpoint-at-led-arm-trailing-expr-dropped (MED) | `3957f38e` | `expression-parser.ts` (+15), `endpoint-multi-statement-arm.test.js` (+67), `expression-parser.test.js` (+51) | tip of `main` (one commit above `spa/ss49`) |

**Local main topology:** `origin/main(2310b53a)` → `9be8010c` → `bf7da16d` (PA s225 RATIFY) → `b731fda2` (item1) → `3957f38e` (item2). `spa/ss49` = `b731fda2`. Both ss49 fixes are already in local `main`; **`origin/main` is unpushed at `2310b53a`.**

### Item 1 — `b731fda2` (sound)
Root cause (agent-found, footprint corrected from the brief's `type-system.ts` to `route-inference.ts`): `collectFunctions` does not recurse into nested function bodies, so a nested `function ins(x){ ?{…} }` never participates in §12 server-placement → its `?{}` is treated client-side → E-CG-006. Fix: a recursive `walkBodyForTriggers` re-runs the server-trigger detection over nested decls and escalates the ENCLOSING fn. Diff is coherent; agent report (verify-first evidence / adversarial matrix / full-suite) was still pending at the time of this write — **PA: confirm the agent's final report.**

### Item 2 — `3957f38e` (sound, with a Rule-4 SPEC-over-brief correction)
The agent's report (complete): full suite 25613 pass / 0 fail. **SPEC-faithful direction correction** — the brief said "mirror the brace-body arm that already works," but the agent verified the brace-body multi-statement form does NOT work either (it fires `E-ENDPOINT-MULTI-STATEMENT-ARM`), and §61.9/§61.10 make multi-statement arm-body *lowering* a deferred future wave (LIMIT-PRIMITIVES boundary). So the fix CLOSES the escape — the `@`-led case now fires the same diagnostic instead of silently dropping the trailing expr — rather than lowering it. Root cause was upstream in `expression-parser.ts` `rewriteServerReactiveRefsAST` (silently ignored `trailingContent`), not `emit-server.ts`. Deferred: the CLIENT twin `rewriteReactiveRefsAST` has the same latent drop (no witnessed harm); a pre-existing trailing-comment over-fire wart.
**known-gaps.md `@gap id=g-endpoint-at-led-arm-trailing-expr-dropped` still status=open** — agent did NOT flip it (shared-ledger race). Recommended annotation: RESOLVED ss49 (`3957f38e`); multi-statement lowering stays the §61.10 future wave.

## ⚠️ THE INCIDENT (PA action required)

1. **isolation:worktree did NOT take effect.** Both dispatched agents (`a8cf77d61fc8146c4`, `af36c3b3961da4d27`) ran in the SHARED main checkout, not isolated worktrees (their commits appear in the shared HEAD reflog; `git worktree list` shows no matching worktree). Root-cause this before the next dispatch wave — every parallel-dispatch safety assumption depends on it.
2. **≥3 concurrent sessions in ONE working tree:** this ss49 sPA, a PA (s225 RATIFY commits), and a concurrent **ss52 sPA** (the ss48-(c) gap). My `git checkout -b spa/ss49` switched the shared checkout out from under the PA (reflog 27 min ago); a foreign switch-back to main followed.
3. **A large FOREIGN staged changeset is in the index right now** (ss52's `emit-*.ts`, `SPEC.md`, `nonreactive-local-map-set-ss52.test.js` + brief/progress). **I did NOT commit** — any `git commit` would have hijacked the ss52 session's in-flight commit. The sPA froze all git mutation.

## Recommended reconciliation (PA-owned)

- Both ss49 fixes are already in local `main` (`b731fda2`, `3957f38e`) — no cherry-pick needed; pushing `main` ships them. `spa/ss49` is redundant + tangled (carries the PA s225 commits beneath item1) → **discard `spa/ss49`** rather than reconcile it.
- Let the concurrent **ss52 session finish its staged commit FIRST** (don't disturb the index).
- Flip `known-gaps.md` for both gaps to RESOLVED (item1 `b731fda2`, item2 `3957f38e`) once confirmed.
- Confirm item-1 agent's final report (was pending at write time).

## sPA tracking files (untracked / unstaged — NOT committed, index frozen)
`spa-lists/ss49-server-codegen-sql-endpoint.md` (statuses), `spa-lists/ss49.progress.md`,
`docs/changes/g-sql-nested-fn-escalation-2026-06-27/BRIEF.md`,
`docs/changes/g-endpoint-at-led-arm-trailing-2026-06-27/BRIEF.md`, this message.
