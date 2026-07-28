---
from: spa-ss19
to: scrml (PA)
date: 2026-06-25
subject: ss19 (adopter-b) — Group A 7/7 LANDED on spa/ss19; Group B parked on ss17 dep; #13 reply
needs: action
status: unread
---

sPA ss19 (the adopter Adopter-B external-adopter battery, GH #5–#14) ran autonomously.
**All 7 Group-A findings LANDED on `spa/ss19`.** Group B (2) is PARKED on a real
dependency (your re-integration of ss17). #13 is reply-only (draft below). I did NOT
advance main / did NOT push.

## Branch
- **Branch:** `spa/ss19` · **tip SHA:** `1d317e26` · **base:** `23601835` (local main at boot; = origin/main `26ffea4e` + 2 S220 ingest commits).
- Dev-agents based on `26ffea4e` (origin/main); every compiler-source file-delta was base-verified (the touched files are identical at 26ffea4e and the spa/ss19 base) — **all landings are clean file-delta** (no cherry-pick was needed; #8's root was emit-control-flow, not route-inference, so it does NOT conflict with A1).
- Local main has since advanced to `683ef691` (your/sibling activity) — re-integrate base-agnostically via file-delta.

## Group A — LANDED (7/7)
| GH | finding | commit (spa/ss19) | agent | notes |
|----|---------|-------------------|-------|-------|
| #6+#7 | auth-precedence (the login wall) | `aac7b0f2` | a2b2b0e2 | protect= no longer overrides explicit `<page auth=optional>`; getExplicitAuthDeclaration reads program+page; trucking 20 false W-AUTH-001→0 (coupled baseline) |
| #5 | stdlib-import-leaks-client | `cae60c25` | abf1985d | GITI-003 prune extended; server-only stdlib stripped from client bundle |
| #6b | schema-raw-ddl-silent-noop | `cae60c25` | a4c8c71b | raw CREATE TABLE in `<schema>` now harvested (preferred path) |
| #8 | pure-fn-rpc-async-unawaited | `9b3eb130` | a96be53d | peer-await threading completed through if/for/while; `(await peer()).field`; S215 gate passed |
| #9 | db-src-compile-vs-runtime-path | `9b3eb130` | a96be53d | sqlite: path re-relativized to project root for subdir files |
| #12 | sql-in-arrow-body-invalid-js | `9b3eb130` | a96be53d | **DIAGNOSED only** — E-SQL-009 + migration hint (full ?{}-in-arrow lowering needs the unimplemented structured-lambda-block-body feature; see residuals) |
| #14 | generate-auth-redirect-mismatch | `9c188151` | afd1a645 | generator scaffolds `pages/login.scrml` (matches §52.13 default /login + §47.9.2) |

Verification: each agent full-suite green (17747–25082/0 across runs); sPA independent R26 on each (auth_check 2→0 + W-AUTH-001 gone; client stdlib leak gone; raw-DDL compiles; `await tag(name)` in if-condition; E-SQL-009). Browser/TodoMVC green on every landing.

## GH issue close guidance (AFTER you re-integrate spa/ss19 → main + push)
- Close #5, #6, #7, #8, #9, #14 with the landing SHA (comment the merged-to-main SHA).
- #12: comment "diagnosed — E-SQL-009 now fires with a migration hint; full ?{}-in-arrow lowering deferred behind structured-lambda-block-body" and keep open OR convert to the residual below.
- #6b: PA-found, no GH issue (or file+close).
- #10, #11: keep OPEN (parked — see below).
- #13: post the draft reply below (user sign-off), close as working-as-intended.

## Group B — PARKED (blocked, not done)
- **#10 g-compound-bind-value-not-two-way** (HIGH, emit-bindings.ts:513-520) + **#11 g-if-guard-inner-effect-not-gated** (HIGH, emit-html.ts).
- **Why parked:** the list's own coordination rule — Group B is render-codegen overlapping ss17's emit-each/emit-html, and **`spa/ss17` is NOT yet re-integrated** (it's waiting in this inbox — `spa/ss17` @ `1c4dcef6`, prior re-integration message). Dispatching Group B now would collide with ss17's unmerged render-codegen changes.
- **Additional hazard:** a SIBLING SESSION's agent **`a11b257ef2e6184c2`** is ACTIVELY editing the same render-codegen (binding-registry.ts / emit-event-wiring.ts / emit-html.ts). Group B (#11 = emit-html) directly collides. **You must serialize: re-integrate ss17 → reconcile a11b257 → THEN dispatch Group B** (the #11 fix builds on the merged emit-html). #11 is ALSO the same family as flogence finding #1/#3 (each/markup-body reactive-effect gaps) — consider one consolidated render-codegen pass.

## New findings filed (in spa-lists/ss19.progress.md on the branch)
1. **g-ecg001-protect-invariant-overfire** (from A1+#8 agents + sPA): E-CG-001 "Protected field `label` in client JS" fires though `label` is NOT in the final client.js (emit-client.ts L2191-2203 scans a stale pre-transform snapshot). Check-ordering false-positive, NOT a real leak. Independent of A1.
2. **g-peer-call-in-raw-template-unawaited** (#8-adjacent): inline `${peer()}` in a template literal / SQL `?{...${peer()}...}` param / `${@cell}` in a server-fn template bypass structured emit → unawaited peer / unrewritten `@cell` → invalid JS. Needs template/SQL-param structural emission.
3. **g-arrow-expr-body-sql-parser-truncate** (#12-adjacent): expression-body arrow `(x) => ?{...}` truncates at the PARSER (`?{}` destroyed pre-codegen); ternary-object arrow mis-emits. Parser/lambda-body issue — this + structured-lambda-block-body gate #12's full fix.
4. stdlib runtime-chunk dead-weight (client-safe module used only server-side ships an unused chunk) — runtime-minimality, no correctness impact.
5. **trucking-dispatch-smoke `chunks.json manifest` flakes under full-suite concurrency** (passes isolated + in the gate) — integration-suite stability item.

## ⚠ CROSS-SESSION HAZARD (PA must reconcile — NOT an ss19 agent)
The #14 agent (afd1a645) hit a SHARED `refs/stash` collision (S94 class): sibling-session agent **`a11b257ef2e6184c2`** concurrently `git stash pop`-ed afd1a645's stash → mutual contamination. afd1a645 FULLY recovered (sPA re-verified its branch = exactly the 6 #14 files, zero codegen contamination). **a11b257 needs reconciliation:** its working tree has #14's ss19 changes wrongly applied (`git checkout HEAD -- ` the 6 files); its OWN codegen WIP (binding-registry/emit-event-wiring/emit-html +149/-20) is recoverable from DANGLING commit `14106c341e98563969a072d0f3412234405a49be` (gc grace — recover promptly). **LESSON: never `git stash` in this shared-worktree env (refs/stash is repo-global).**

## Environment note
The full-suite pre-commit hook OOM-SIGKILLs / runs slow (~6-7min) under concurrent load (sibling flogence session + parallel agents on a 15GB box). Both sPA commits and dev-agents hit it; all recovered by waiting for a memory window. NOT test failures, never `--no-verify`. Keep agent concurrency ≤2 here.

## ──────────────────────────────────────────────
## DRAFT reply for GH #13 (g-const-collides-state) — USER SIGN-OFF before posting; verify §6.1.3 citation
> **Working as intended.** `E-NAME-COLLIDES-STATE` is the V5-strict shadow ban (§6.1.3): within a `${}` block a local binding may not reuse a `<state>` cell name declared in that block. The diagnostic IS the feature.
>
> Rationale — scrml's co-location-of-behaviour model: within one block a name like `batches` must have exactly ONE referent whether it appears in markup (`@batches`) or logic (`const batches`). Allowing a local to shadow the cell creates two referents for one name in the same scope — the ambiguity V5-strict exists to eliminate. The ban is intentionally scope-wide (not render-only), because a server fn in the same `${}` block shares that block's namespace; scoping it to render context only would re-introduce the dual-referent ambiguity inside server fns.
>
> Idiomatic resolution: a suffix — `const batchRows = ?{...}.all()`. We'll consider adding that hint to the error text as a small DX improvement (tracked separately), but the rule stands. Closing as working-as-intended — thanks for the careful report.

## Close
End-state: Group A dispositioned (7 landed) · Group B parked (ss17 dep) · #13 reply-drafted. Branch + `spa-lists/ss19.progress.md` + this message are the handoff. The user closes the instance.
