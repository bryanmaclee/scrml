# progress — s462-p0-cps-server-logic-to-client

- [start] base a9aa81eff (origin/main). Brief archived.
- [repro] CONFIRMED on emit AND in happy-dom against the real server module:
  wrong password renders "WELCOME bob"; the response carries the argon2id hash;
  `_scrml_stdlib.auth` ships.

## Root causes (measured)
1. CPS tier classifier (`analyzeCPSEligibility` → `isServerTriggerStatement`)
   is not the escalation walker. It missed: aliased server-only imports (keys
   on imported `names`, not the local), any server-only reference in a control-
   flow HEAD (`condExpr`/`iterExpr`/… — incl. the `sql-ref` in
   `for (r of ?{}.all())`), and the `sqlNode` on `const x = ?{}…`.
2. A server batch could not carry cell writes: nested `@x = v` lowered to
   `_scrml_reactive_set` IN THE SERVER MODULE (ReferenceError); a second
   top-level write likewise; the §19.9.9.7 R7 read of a just-written cell read
   the CLIENT-SENT `_scrml_body[x]` (client-controlled: a forged `out` could
   steer the password check); `_scrml_cps_return` returned only when the decl
   was the LAST server statement.
3. `stdlib-auth` / `stdlib-crypto` carried client chunks contrary to the
   §12.2 Trigger-3 derivation documented in runtime-chunks.ts.
4. Legacy client wrapper: a client write to the return cell before the server
   call (`@msg = "start"`) was rewritten to `reactive_set(msg,
   _scrml_server_result)` ahead of that const (TDZ); multi-batch dropped it.

## Implemented
- A (RI): `buildCpsStatementServerProbe` — escalation walker + Trigger-3 local
  binding scan applied per statement; server-tier if it fires. Mixed bare-expr
  (write + server work) → server tier. Nested writes in server statements count
  as reactive. Server-local propagation fixpoint (a statement reading a local a
  server statement declared runs on the server — data minimisation by
  placement). `findReactiveAssignment` sees compound/update/field/array-
  mutation writes and ExprNode-field writes (match arms); `@session` /
  `@currentUser` excluded (ambient, §6.6.9).
- B (codegen): `codegen/cps-cell-writes.ts` — per-batch plan (legacy bare
  return kept byte-identical for its exact shape; otherwise "cells"). Cells
  batch: one local per written cell (`_scrml_cell_<x>`, seeded from the
  marshalled value), writes recorded in `_scrml_written`, response
  `{ __scrml_cells: { <written>: <final> } }` built as one literal. Flag
  `serverCellWrites` threaded emit-logic/emit-expr/emit-control-flow (incl.
  match ctx and the raw-text arm path). Fail-closed backstop E-CG-006 on an
  unrecorded write, an unplanned mark, or `_scrml_reactive_set` in the batch.
  Client single + multi-batch apply. RI refusal E-RI-002 (precise text) for
  writes a batch cannot carry (field write / in-place array mutation / closure
  write / `return` inside a cells batch).
- C: auth/crypto client chunks removed → a surviving client reference is
  E-STDLIB-CLIENT-CHUNK-MISSING.
- Conformance: `server-fn-writes-reactive-cell-pos` retargeted (SPEC §6.6.9:
  a function with a reactive assignment is CPS-split; the old E-RI-002 was an
  impl#1 mis-tiering artifact, already recorded at S451). New:
  `cps-login-check-stays-server` (codes-only — the bridge's server harness
  cannot load a stdlib shim; runtime proof in impl#1 tests),
  `cps-batch-field-write-refused`.

## SEPARATE P0 FOUND (not fixed here — different blast radius)
- SQL chain truncation: `?{…}.get().name` lowers to the whole row; the AST
  records `.name` as chainedCalls {method:"name"} and the lowering honours only
  calls[0]. `return ?{SELECT name, pw …}.get().name` from a plain server fn
  returns the full row incl. the hash. Measured on this worktree (SQL lowering
  untouched by this dispatch).

## Commits
- 36446dfc8 — A + B + C + tests + conformance.
- 46df8bc52 — `lin`/`~` decl tiering (found by the corpus diff: examples/
  19-lin-token `login`); §6.6.19 message + SPEC rewrite (the SPEC's own
  "SHALL be rewritten" clause); regenerated SPEC-INDEX / FACTS / bootstrap-
  conformance / TYPES-BASELINE.
- e0be779aa — multi-batch: the last batch returned the split's FIRST cell
  (returnVarName) and the client set it to `undefined` after batch 1.

- 11e7540c1 — merge origin/main (Q20 #1401, Q21 #1402): code auto-merged;
  generated-doc hunks → main's side, regenerated.
- 47d9c233e — integration test hands handlers a duck-typed request
  (happy-dom globals from an earlier file drop `Cookie`).
- 719e49616 — merge origin/main (<md> phase 1 #1403): chunk set = +md
  −auth −crypto (42); count pins + template interpolation resolved by hand.
  Gates re-run on this tree: all green incl. browser-baseline --check PASS.

## Corpus differential (final, head = e0be779aa vs base a9aa81eff)
2919 sources (samples, examples, conformance, stdlib, benchmarks,
scrml-support gauntlet-r25, ../giti, ../flogence). 20 server functions changed
in 7 sources; 0 in giti (28 server fns), flogence (243), gauntlet-r25,
benchmarks; examples: 1 (19-lin-token `login`, broken on base, now correct).
Newly refused real programs: 0. Harness note: stdlib/ rows differ only
because stdlib exemptions key on the compiler's own stdlib path.

## Gates
pre-commit ×3 green; types-gate (re-recorded rename); host-global-scan;
facts (regen); spec-index (regen); s34-census --check-new; bootstrap-
conformance (regen; FAIL 55→55); severity; snippet-gate 128/128; corpus-
compile-floor; lsp+commands 723/0; root-level 2239/0; e2e-render-map 259/0;
browser tier 48 failures == baseline name set (script refused twice with
PARSER DISAGREES 48 vs 47 — the documented flake; verified by direct
name-set comparison).

## FIX ROUND 1 (resumed)

You are a dispatched dev agent on the scrml repo (impl#1, compiler/src). PA session S462. P0 SECURITY. You are CONTINUING a crashed agent's fix round (its context overflowed). Its committed work is on the LOCAL branch `worktree-agent-aaf433dac5f8224df` (HEAD a466175f9, which already merges main 1c1e9eee5). Its UNCOMMITTED round-1 work-in-progress is saved as a patch: /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/ded336eb-40b5-403c-94d8-1f930fdf45e5/scratchpad/cps-round1-wip.patch (17 files, +934/-91).

FIRST:
1. In your worktree, run `git merge --ff-only worktree-agent-aaf433dac5f8224df` (or a plain merge if you're not on its base), then `git fetch origin && git merge origin/main`.
2. `git apply` the patch. If hunks conflict, resolve them, and say so.
3. Read docs/changes/s462-p0-cps-server-logic-to-client/{BRIEF,progress}.md for the original design: the per-statement server probe, the `__scrml_cells` batch return, E-RI-002 / E-CG-006, and the removed auth/crypto chunks.
4. Append this prompt verbatim to that progress.md as "FIX ROUND 1 (resumed)".
5. Commit the applied WIP immediately as a checkpoint, so the work isn't lost again. If the pre-commit hook fails because the WIP is incomplete, do NOT bypass it; instead keep the patch file as the anchor and continue.

Commit rules:
- Commit incrementally.
- Never use --no-verify, and never disable hooks.
- Gate each commit on free memory above 6GB and load average below 15, foreground, timeout 600000.
- Use your own scratch subdir.

CONTEXT DISCIPLINE: the previous agent died from context overflow. Keep tool outputs small:
- run tests with `--bail` and with filtered output (`| tail -30`);
- grep instead of reading whole files;
- don't print large diffs.

The last thing it was doing: a types-gate regression in `compiler/src/runtime-template.d.ts`, whose export list must match runtime-template.js.

THE ROUND-1 TASK. These are the S239 review findings on 533609165. Reproduce each with real routes (bun:sqlite + happy-dom; seed bob with an argon2 hash).

H1 HIGH (also on base): a check through a helper is a full bypass. `function check(p,h){ return vp(p,h) }` plus `if (!check(pass, @out.pw))` in a server function shows WELCOME bob for a wrong password. `check` escalates to its own route; the login route returns the whole row; the client posts the hash; the un-awaited Promise passes the check.

H2 HIGH: `const hash = @out.pw` (or destructuring `const {pw,name} = @out`), then `vp(pass, hash)`. This produces 2 batches: the row with the hash goes to the client and comes back, and batch 1 returns 500.

H3 HIGH (also on base): cross-batch trust. With `@row = ?{SELECT name, role…}.get(); @busy = true; if (@row.role == "admin") { ?{DELETE FROM secrets}.run() … }`, a forged `{"row":{"role":"admin"}}` makes the DELETE run.

H4 MED: `const rows = ?{…}.all(); @out = "REJECTED"; for (const u of rows) { if (vp(pass, u.pw)) … }` used to be E-RI-002. It now compiles, batch 1 500s, and the correct password renders REJECTED.

RULE TO IMPLEMENT (fail-closed):
(1) Any statement that reads a cell its own function's server batch wrote, or a local derived from one (transitively, through locals and destructuring), is server-tier. A call to a function that itself escalates is server-tier at the call site, so the result is computed and awaited on the server. This closes H1 and H2.
(2) A server-originated value (a server-written cell, a server local, or anything derived from them) must NEVER round-trip through the client into a later batch as trusted input.
   - Cell writes like `@busy = true` can be computed on the server and returned in `__scrml_cells`, so they don't by themselves force a split.
   - Statements BEFORE the first server statement stay client-side. This is the spinner pattern: `@busy = true` must render before the request.
   - If a later batch would need a server-originated value, merge by moving intervening pure-computation or cell-write statements to the server.
   - If they genuinely need the client (DOM, client-only APIs, lift), REFUSE with E-RI-002. The message must name the value that would cross.
   This closes H3 and H4.
(3) Execute the spinner, optimistic-update and form-submit shapes, and verify their UX semantics are kept.

M1: restore a crypto client chunk limited to the functions the shim labels [browser-safe] (generateUUID, hash, safeCompare, generateToken, hmac — read the labels). Keep auth fully server-only. Non-browser-safe crypto used on the client stays E-STDLIB-CLIENT-CHUNK-MISSING. Corpus impact must stay 0.

known-gaps:
- F3 (Trigger 3 through a local re-export): mark resolved if (1) closes it; otherwise add an entry.
- Add a LOW entry: `@out = "kept " + ?{…}.get().n` → E-CODEGEN-INVALID-LOGIC (already on base, fails closed).
- SQL chain truncation is being fixed on another branch. Don't touch it.

TESTS: every H-shape as an end-to-end route test that fails on base or on 533609165. Required outcomes:
- a wrong password gives REJECTED, and the correct one gives WELCOME;
- no hash appears in any request or response body, in either direction;
- the forged H3 cell does NOT run the DELETE.

GATES:
- pre-commit, tracking tiers (after pretest), browser-baseline --check (re-run on PARSER DISAGREES), `s34-census --check-new`, host-global-scan, facts / spec-index / bootstrap-conformance / severity --check, types-gate --check, snippet-gate, corpus-compile-floor;
- a corpus differential including ../giti and ../flogence (read-only). Report every newly refused site.

Resolve generated-doc conflicts by hunk, then regenerate. Restore master-list.md from origin/main. Write only inside your worktree.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, per-H results, the design, M1, newly refused sites, and the gates table. Do NOT push.

### Resume log
- [resume] ff to a466175f9; origin/main already merged (1c1e9eee5); WIP patch applied cleanly (no conflicts).
- [checkpoint] 0d182364a — WIP applied + committed (pre-commit green, 741s). New H tests verified FAILING on both 533609165 (12 fail) and a9aa81eff (34 fail) via git-archive trees in scratch.
- [adversarial probes on the WIP] H1 plain-escalated, helper-returns-row, lift/DOM between, pure copy between, spinner, local→vp: all correct. TWO holes found:
  (I) `@row = ?{}; @x = localStorage.getItem(@row.role) ?? @row.role; if (@x == "admin") DELETE` — the browser stmt stayed client (reads a server CELL — allowed), its output `@x` round-tripped into batch 2, and a forged `x` ran the DELETE (measured: secrets 1 → 0).
  (O) `@n = setTimeout(…)` between producer and consumer was silently moved to the server (deny-list `clientOnlyReason` only knew browser globals).
- [563a4f1e1] rule (d) taint-through-browser pass (refuse at the browser stmt, naming the server value) + fail-closed ALLOW-LIST half of clientOnlyReason (cells, fn own names, file declared/imported names, isomorphic globals). Unit tests added.
- [corpus diff head 563a4f1e1 vs origin/main 1c1e9eee5] 2875 files (samples 310, examples 71, conformance 1799, benchmarks 7, gauntlet-r25 4 + samples/gauntlet-*, giti 83, flogence 31; per-file standalone compile). Newly refused: 1 = the branch's own negative fixture `cps-batch-field-write-refused`. Newly compiling: 1 (`server-fn-writes-reactive-cell-pos`, retargeted). Code-set changes on already-refused files: 4 (2 e-derived negative cases gain E-STDLIB-CLIENT-CHUNK-MISSING; gauntlet-r10-bun-admin + htmx-forms swap E-RI-002/E-REACTIVE-003 for E-CPS-NONIDEM-NO-STORAGE). Artifact changes (both compile): 5 — 3 defer CPS cases (client), the branch's cps-login fixture, examples/19-lin-token. giti / flogence: 0 changes.
- [SPEC] §19.9.9.8 added (placement rule; narrowing; provenance = this brief) + §19.9.9.7 bullet 1 amended (it normatively described the H3 round trip). SPEC-INDEX/FACTS regenerated.
- NOTE (out of scope, pre-existing): a NON-split escalated function (no cell write) containing `localStorage.setItem` runs it on the server (ReferenceError → 500). By design per the S263 CLIENT_ONLY_GLOBAL_ROOTS minimal set (document/window only). Not a CPS round-trip.

## FIX ROUND 2 (S465)

- 2026-10-11 brief (+ PA change of plan) archived as BRIEF-fix-round-2-S465.md. Finding 1 done first on a separate branch from origin/main (auto/s465-await-imported-server-fn @ f8309fd64); merged here next.
- merged auto/s465-await-imported-server-fn (f8309fd64). Conflicts: emit-functions.ts CPS client-statement
  emission (kept this branch's no-skip / no-rewrite form, wrapped with the continuation auto-await) and
  docs/FACTS.md (regenerated). The S465 CPS test is retargeted: under §19.9.9.8 the imported `check` runs IN
  the server batch (route test: wrong → `__scrml_cells.seen` REJECTED, right → "WELCOME bob", no `$argon2` in
  the response). On d5910316d 9/17 of the S465 tests FAIL. Gate on the merge tree: 33023 tests, 10 fail — the
  environmental/flake set recorded on the await branch (dev ×5, bind-host, read-only-as-root, tenant ×3 load).
- FINDING 2 (o1) REPRODUCED on d5910316d: `const n = @clicks + 1; @clicks = n; ?{INSERT … ${n}}.run()` — both
  earlier statements in the server batch (`const n = _scrml_cell_clicks + 1; _scrml_cell_clicks = n`), the
  client only applies `__scrml_cells.clicks` after the response. Root: analyzeCPSEligibility's "a client-declared
  local the server statement reads moves to the server with it" pulled from k = 0, ignoring rule 4 ("Statements
  before the function's first server statement are never moved"); the pull of `const n` then made `@clicks = n`
  a reader of a server local (rule 1 pull).
  FIX: `firstServer` (fixed by the initial tiering; no later pull can precede it) bounds that pull; a pre-first
  local read by server work is CLIENT data → `CPSResult.carriedLocals` / `CPSSplit.carriedLocals`, sent after the
  function's params in every stub's argument list (emit-functions: stub signature + body, single and multi-batch
  wrapper calls) and bound `const <n> = _scrml_body["<n>"]` in the batch handler (emit-server paramNames).
  Shapes that cannot be carried are REFUSED (E-RI-002, kind "client-local"), never moved:
  (i) a nested `function` declared pre-first that server work calls (a function is not request data);
  (ii) a pre-first local the server half REASSIGNS (`let n = 1 … n = ?{…}` — the copies would diverge).
  A browser-only local declared AFTER the first server statement and read by later server work stays refused (it
  cannot join the request already in flight) — now with the accurate message.
- FINDING 3 (d1): compiles clean now (statement stays client, `draft` carried). The client-local refusals get
  their own E-RI-002 text ("A browser value reaches the server only as part of the request … statements before
  the function's first server statement stay in the browser (§19.9.9.8 rule 4)") with a per-shape Fix — never
  the server-value "sending `x` to the browser and trusting …" text.
- Tests: integration/s465-cps-pre-first-stays-client.test.js (9; d5910316d: 8 FAIL) — o1 executed in happy-dom
  with the request held open (`@clicks` shows 1 DURING the request, request carries n = 1) + route stores the
  carried value; d1 spinner shows during the request, request carries localStorage draft, route stores it; the
  three refusal shapes with message assertions. unit/cps-split-server-tier-s462: the test that pinned the
  rule-4-violating pull is retargeted (pre-first local stays client + carried) and a post-first pull test added.
- NOT CHANGED (per brief): control-dependence g1/g4 (§19.9.9.8 rule 3 last sentence — owner's call); a1/g5
  fail-closed 500s — KNOWN LOW, left as they are. No SPEC edit: rule 4 is implemented as written; how a
  pre-first value reaches the server (as request data, like a parameter) and the two refused shapes are
  implementation consequences the owner may want stated in §19.9.9.8.
- Gate (rule-4 tree): 33033 tests, 11 fail — the recorded env/flake set + validate-emit-gate trucking-dispatch (35 s timeout under load; passes alone, 3/0).
- REVISED after the corpus differential (head vs d5910316d: samples/gauntlet-r13/htmx-forms `validateForm`
  gained an E-RI-002 for its nested helper `checkRequired` — refusing every pre-first nested helper would have
  been a regression for a common shape): a nested `function` declared before the first server statement that
  server work calls now STAYS in the browser and is ALSO declared at the top of every batch handler
  (`carriedFunctionIndices`; a declaration has no effect). Admitted only if it touches no cell and needs
  nothing browser-only (`clientOnlyReason` allow-list); the pre-first locals it closes over are carried with
  it (fixpoint); refused (E-RI-002 client-local) if it needs the browser / touches a cell, or reassigns a
  pre-first local. Executed: `function fmt(x) { return x + "!" }` pre-first → `@v` shows "saving" during the
  request and the route stores "saving!". htmx-forms back to its d5910316d code set.
