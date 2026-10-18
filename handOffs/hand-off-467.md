# scrml — Session 467 (bryan · XPS) — WRAP

> Rotated: S464's hand-off (which also carries S465 AUTO, S462 and earlier) → `handOffs/hand-off-464.md`. **S466 (ASUS) never wrapped — the ASUS session died and the ASUS machine may be dead** (bryan, S467: *"the asus session is dead. The Asus might be dead."*). S467 adopted every S466 carry-over. Board: `scrml-support/handOffs/active-sessions/S467-bryan.md` (S466 marked DEAD). Rulings: `scrml-support/user-voice-scrml.md` §S467.

## ⏭ NEXT-SESSION PICKUP (ordered)

### 0. Land the two open P0 PRs (both reviewed; both were mid-merge with main at wrap)
| PR | branch | reviewed state | at wrap | next |
|---|---|---|---|---|
| **#1434 await P0** (wrong password accepted — r8–r10; **impl#1 enforces F4**) | `s467-await-r10` | r10 frozen 19458af1e: **no wrong-password accept** (551 pack + 89 adversarial shapes). One finding: false refusal when a param/local of the enclosing fn shares a name with a file-scope async fn (`mayHoldWaitingFn` shadows only init-internal params) — decided land-now, fix as follow-up | an agent was merging origin/main (#1431/#1432/#1433) + fixing the shadowing false refusal with negative tests (the fix NARROWS a security check — the brief requires proof real async bindings stay refused); told to checkpoint+push at wrap | read `docs/changes/s465-await-imported-server-fn/progress.md` "PAUSED (S467 wrap)" on the branch; if merged+green → if the shadow fix touched the judge, a short re-review of just that delta (frozen tree), then merge; update the §34 E-ASYNC-FN row to "enforced" (in that agent's brief) |
| **#1435 CPS P0** (server logic/values to the client; forged role/INSERT — rounds 1–5) | `s467-cps-r5` | r5 frozen 06bfb5380: **CLEAN** (allow-list admission; timers/closures-in-cells/getters/toJSON/Proxy/generators all refused) | conflicts with #1433 (both touch route-inference.ts / emit-server.ts) — an agent was merging and re-running the CPS probes + param identity cases + pack; told to checkpoint+push | read `docs/changes/s462-p0-cps-server-logic-to-client/progress.md` "PAUSED (S467 wrap)"; merged tree must re-pass the probes (`~/.cache/scrml-review-s467-cps-r4/h/harness.mjs`, XPS) → CI → merge |
If an agent left a patch instead of a commit: `~/.cache/scrml-agent-tmp/s467-{cps-land,await-r10-land}/wrap.patch` (XPS). Landing order: whichever is green first; the other then needs main merged again (strict protection).

### 1. Decisions waiting on bryan (none block landing)
- **§19.9.9.8 wording** — the CPS allow-list rule (a later batch admits a local from the request only if provably browser-only) has no SPEC sentence; and **is a cell written from a server result a server value?** (`g-cps-server-half-trusts-client-held-cell-s467`).
- **"async-colored" and caller-placed helpers** — #1434 does not count a sync helper placed on the server only by its callers as async (keeps conformance `server-db/first-class-fn-ref-server-helper-rt`); the SPEC definition doesn't settle it. Reviewer found no hole.
- **S466 owner Qs 1–3, 5** — `handOffs/s466-owner-questions.md` (exhaustiveness over built-in error types; `scrml fix` on §66-dialect files; language-wide param-default narrowing; placement-only helper newly-accepting fix). Q4 ruled S467.
- **RediLedger** — the F4 migration is unmeasured there (repo not on the XPS).

### 2. Queued builds (ruled)
- dpa-023 Phase 2: the pending-cell surface (§13.9) lives in the **bootstrap** (F5: impl#1 stays retrofit-only) — U1c server half has a design gate now (`scrml-support/docs/deep-dives/bootstrap-u1-server-boundary-design-2026-10-03.md` §13).
- S464 queue still open: HIGH server-only helper `function`s get public routes (`g-trigger5-…`); MED `==` emitted as `===` outside typed fn bodies; Q23 braces-required migration; small ruled builds (for-header comma lists; enum-cell inference follow-ups).
- New S467 gaps (all in `docs/known-gaps.md`): **HIGH** `g-block-bodied-bang-arm-drops-value-s467` (wrong password via a block-bodied `!{}` arm — codegen), **HIGH** `g-errorboundary-runtime-does-not-catch-returned-error-value-s467`, **HIGH** `g-cps-split-local-from-session-unbound-on-server-s467`; MED `g-failable-alias-through-operator-or-returned-fn-s467`, `g-cps-server-half-trusts-client-held-cell-s467`, `g-server-fn-calls-cps-split-fn-unbound-s467`, `g-match-failable-subject-through-operator-miscompiled-s467`; LOW others.

## What landed (S467)
#1426 S466 gap list + review backfill · #1429 s461 test unregisters happy-dom (unblocked every commit on the XPS) · #1427 server param defaults (**auto-merged at round 5 before its re-review cleared** — S466 had left auto-merge on) · **#1430** SPEC §13.8 one rule for waiting values + §13.9 pending cells (dpa-023 F1–F7) · **#1431** security: an unhandled failable call used as a value is E-ERROR-002 (wrong password via `const ok = check(p)`) · **#1432** SPEC §34 rows for §13.8/§13.9 · **#1433** param-default identity follows every reference + reach set (closes the #1427 runtime-crash regression).

## Rulings this session (verbatim in user-voice §S467)
dpa-023 **F1 (a)** opt-in `(not to T)` marker · **F3 (a)** cells only, no render-position pending · **F2 (a)** the lifecycle type is the marker · **F4 (b)** a waiting function is bound only by a `function` declaration (migration measured: 0 real sites) · **F5 (a)** no impl#1 rebuild · **F6 (a)** keep stale while reloading · **F7 (a)** failure handled at the declaration · **impl#1 enforces F4** · three §13.9 details (no derived pending cell; no hidden-request controls; a waiting write keeps the current value) · the four E-PARAM-DEFAULT-* names · docs-only PRs keep merging.

## 🔭 DURABLE
- **A dead machine takes every unpushed commit with it.** S466's `s466-error-002-decl` existed only on the ASUS and was lost. Every brief now says: push after every commit.
- **Inherited PRs can carry auto-merge.** #1427 merged itself the moment CI went green, while its review said FIX. Check `auto_merge` on every inherited open PR at boot (`gh api 'repos/bryanmaclee/scrml/pulls?state=open' --jq '.[]|{number,auto:(.auto_merge!=null)}'`).
- **Position-by-position fixes did not converge — twice, again.** The await P0 took 10 rounds and CPS 5. Both closed only when the rule flipped from "find what is dangerous" to "admit only what is provably safe" (F4 refusal; the CPS allow-list). When round 3 of a security fix finds a new position, change the boundary, not the list.
- **The XPS pre-commit hook takes ~20 min** and fails on load timeouts with several agents running (load avg 8–17). The local hook used to fail outright: Node 21 (fixed — bryan upgraded to v26) and an order-dependent happy-dom leak (#1429).
- **Agents report `push ok` while my final `git rev-parse A B` errors** — the "failed exit 128" notices this session were my own two-argument rev-parse, not failed pushes.

## ⚑ MISSES (mine)
1. I wrote a wrong "PA reading" into a §13.9.6 brief (§13.2 refuses waiting lambdas to any callback) — the SPEC agent caught it; fixed before landing.
2. I didn't check inherited PRs for auto-merge; #1427 landed with a known FIX open.
3. `git checkout --ours` on known-gaps.md once dropped six of main's entries during a merge — caught by the gap-id union check before committing. Resolve only the count hunk.

## Worktrees + /tmp (6b / 6b′)
Removed: all `rev-s467-*` review trees + 15 finished agent worktrees; local branches of merged/superseded work deleted (remotes kept). **Retained (5):** `agent-a721f30252e4cfd0b` (#1435 landing merge, in flight), `agent-a623c11b5be0558b1` (#1434 landing merge + shadow fix, in flight), and three pre-S467 XPS trees not touched this session (`agent-a5679023ec80f2155`, `agent-a5a49f48b76659e43`, `agent-a680b319fba879f81` — for bryan; dry-run before removing). 6b′: /tmp top-level entries newer than boot = **32**; `/tmp/claude-1000` = **963** files (low — the XPS was rebooted / cleaned since the S448 measurement). Reviewer harnesses live under `~/.cache/scrml-review-s467-*` and `~/.cache/scrml-agent-tmp/` (XPS). Maps (`.claude/maps/`) NOT refreshed this session — stamp 41af4153a is now ~25 PRs stale; refresh owed (wrap 6c skipped: no time under the load).
