---
status: current
last-reviewed: 2026-08-06
---

# mangler-three-defects — progress

Base main `13edcfbf`. Worktree branch `worktree-agent-ace0633a143596f3d`.
Append-only. Newest entries at the bottom.

## Scope

Three defects in `post-fn-name-mangle` (`compiler/src/codegen/emit-client.ts`), filed
by the S325 population count (`docs/changes/limb2-mangler-retirement/SCOPING.md`).
NOT retiring the pass — it is ordering-blocked at 871 live sites.

1. `g-embed-runtime-ships-mangled-runtime-identifiers` (HIGH)
2. `g-mangler-empty-name-whole-buffer-insertion` (MED)
3. `g-mangler-scope-blind-shorthand-key-rename` (MED)

## Log

- **2026-08-06 T0** — startup verified: worktree root == `git rev-parse --show-toplevel`,
  clean, `bun install`, `bun run pretest`. Baseline pre-commit gate: **28553 tests / 0 fail /
  1223 files**.
- **T1** — read `.claude/maps/primary.map.md` (Task-Shape Routing row for
  `compiler/src/codegen/` = the standing `scripts/corpus-emit-differential.ts` pre-land gate,
  invariant 41), `.claude/maps/dependencies.map.md` (only one mangler mention, row §13.2 client
  server-fn call-site await — the pass's lookahead is a documented API of the emit contract),
  and `docs/changes/limb2-mangler-retirement/SCOPING.md` via
  `git show origin/fix/s325-mangler-defects:...`.
- **T2** — base corpus capture taken BEFORE any edit, from a pristine clone of `13edcfbf`
  in the scratchpad: 1878 sources / 1207 compiled OK / 7254 artifacts / 66 syntax-failing.
- **T3 — DEFECT 1 REPRODUCED.** `bun compiler/src/cli.js compile
  samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-do-while-064.scrml
  --embed-runtime` emits `function _scrml_replay(name, _scrml_log_1, endIdx)` with the body's
  `log.length` reads untouched. Hypothesis HELD: locus is `emit-client.ts` the
  `lines[runtimeInsertIndex] = runtimeSource` splice happening BEFORE the mangle.
- **T4 — DEFECT 1 FIXED by region exclusion.** New exported helper
  `joinAroundRuntimeSlot(lines, runtimeSlotIndex, runtimeSource, rewrite)`: the rewrite is
  applied to the client body BEFORE and AFTER the slot, and the runtime is spliced in
  afterwards, so the fenced region is never part of the rewrite input. With `rewrite` as
  identity the helper is byte-for-byte the old `lines.join("\n")`. Default-mode output verified
  byte-identical against the base clone (`diff -r`).
- **T5 — DEFECT 2 MEASURED.** Instrumented the throwaway base clone; corpus census over
  1878 sources: **2332 total mangle rewrites, of which 781 (33.5%) are zero-width empty-key
  injections in a SINGLE source** — `stdlib/cron/index.scrml`, which fails compile. Exactly
  ONE source corpus-wide carries an empty `fnNameMap` key.
- **T6 — DEFECT 3 MEASURED.** Same census, classified by enclosing group: **10 sites in
  exactly ONE source** (`stdlib/http/index.scrml`, fails compile) are object-shorthand
  brace groups. ZERO in cleanly-compiling sources. The 80 `, … ,` sites a naive
  prev/next-char heuristic flags are PARAMETER lists
  (`_scrml_replay(name, log, endIdx)`), i.e. defect 1, not defect 3.
- **T7** — landed defect 1 + `compiler/tests/unit/mangler-region-fencing.test.js` §1
  (7 tests, one of them EXECUTES `_scrml_replay` lifted out of the shipped bundle).
- **T8 — HARNESS STALL, not a work failure.** The session hit the 600s stream watchdog
  right after the defect-1 commit landed (`90c937da`). Tree was clean; nothing lost.
  PA confirmed and also reported `progress.md` missing — it is NOT missing, it is at
  `docs/changes/mangler-three-defects/progress.md` and was in `90c937da` (55 lines).
- **T9 — DEFECT 2 FIXED.** `emit-functions.ts`: all four `fnNameMap.set` sites now route
  through one `registerFnName(sourceName, generatedName)` guard that refuses a non-string /
  empty key. CLASSIFICATION: **(a) an empty key is ALWAYS an upstream bug** — §48/§13 admit
  no anonymous top-level declaration, a nameless fn has no call site that could name it (so
  no consumer of the map could ever look the entry up), and the census found the shape in
  1 of 1878 sources, which does not compile. The guard is therefore a DATA-VALIDITY guard on
  the map's contract, not tolerance of the upstream defect. What is deliberately NOT done
  here: raising a declaration-site diagnostic. The only §34 code that fits
  (`E-CODEGEN-INVALID-LOGIC`) has exactly ONE fire site, `validate-emit.ts`, whose contract
  is "the emitted artifact does not parse, here is the byte offset"; a declaration-site fire
  needs a NEW §34 row = a SPEC amendment. SURFACED to PA, not smuggled in.
  Post-fix `stdlib/cron` still fails E-CODEGEN-INVALID-LOGIC but now points at the real
  malformation (`function _scrml_v_1() { } 15 * * * * "`) instead of injection #1 of 781.
- **T10 — BITE PROOFS (both landed defects).** Defect 1: replacing
  `parts.push(runtimeSource)` with `parts.push(rewrite(runtimeSource))` turns §1 RED on 3
  tests (incl. the EXECUTED one); restored → 10/10 green. Defect 2: deleting the one guard
  line turns §3 RED on 2 tests (the direct `emitFunctions` map assertion AND the stdlib/cron
  end-to-end); restored → 10/10 green.
- **T11 — SECOND HARNESS STALL.** Same 600s stream watchdog, mid-edit on defect 3. Nothing
  lost. NOTE FOR THE PA: `progress.md` is NOT missing — on branch
  `worktree-agent-ace0633a143596f3d`, `git ls-tree -r HEAD --name-only | grep
  mangler-three-defects` returns `docs/changes/mangler-three-defects/progress.md`. It first
  landed in `90c937da` and was updated in `c2171130`. It is absent from `main` only because
  nothing from this branch has landed yet.
- **T12 — DEFECT 3 IN PROGRESS (this WIP commit).** `code-segments.ts` gains a SECOND region
  class beside the lexical one: `findObjectShorthandRegions` + `classifyBraceGroup` +
  `ObjectShorthandRegion`. A `{ident, ident, …}` group (entire content = bare identifiers) is
  classified `object-literal` / `binding-pattern` / `unknown`. `emit-client.ts`'s mangle
  consumes it: object-literal → EXPAND `n` to `n: <encoded>` (keeps the object's public shape
  AND resolves to the real fn); binding-pattern → verbatim; unknown → today's behaviour
  unchanged. NOT yet verified — WIP.
- **T13 — DEFECT 3 REPRODUCED ON A CLEANLY-COMPILING SOURCE.** Constructed my own, since
  both known corpus instances fail compile upstream:

      ${ function get(u) {…}  function post(u) {…}  const api = { get, post } }
      <button onclick=${ @out = api.get("x") }>go</button>

  base `13edcfbf` emits `const api = {_scrml_get_3, _scrml_post_4};` → `api.get` is
  `undefined`, silent, no diagnostic. **This CORRECTS the S325 scoping note's implication
  that the defect only appears in sources that fail compile — that is a property of the
  corpus, not of the defect.** Post-fix: `const api = {get: _scrml_get_3, post: _scrml_post_4};`
- **T14 — NEGATIVE DEPENDENCY ASSERTED, not assumed.** Two-file compile (importer + lib):
  base-vs-head `diff -r` over the whole emitted tree shows **exactly ONE differing line**,
  the intended `const bundle = {…}` expansion. The registry footer
  `_scrml_modules["lib.client.js"] = { get: _scrml_get_3, post: _scrml_post_4 };` and the
  importer's `const { get, post } = _scrml_modules["lib.client.js"];` are byte-identical.
  Asserted directly by §2c.
- **T15 — DEFECT 3 BITE PROOF.** `continue`-ing out of the region loop turns §2 RED on 3
  tests (the expansion assertion, the EXECUTED one, and the cross-file one); restored →
  20/20 green.

## FINAL MEASUREMENT — corpus-wide mangle census, base `13edcfbf` vs head `54ab479a`

Same instrument on both sides (a throwaway clone of each revision, patched to count
rewrites in the mangle replacer), same 1878 sources, 1207 compiling OK.

| | base | head |
|---|---|---|
| total mangle rewrites | **2332** | **1413** |
| empty-key ZERO-WIDTH injections (defect 2) | 781 | **0** |
| runtime-slot collisions (defect 1) | 138 | **0** |
| genuine user call sites | 1413 | 1413 |
| — of which object-shorthand, KEY-renamed (defect 3) | 10 | 0 |
| — of which object-shorthand, EXPANDED `k: v` | 0 | **10** |
| shorthand groups FENCED (coverage REMOVED) | — | **0** |
| shorthand groups left UNKNOWN (behaviour unchanged) | — | **0** |
| sources with an empty `fnNameMap` key | 1 | **0** |

`2332 − 1413 = 919 = 781 + 138`, exactly. Both defect populations are eliminated
corpus-wide and the genuine-user-site figure is untouched — and 1413 / 2332 / 781 / 138
reproduce the S325 headline to the unit, independently measured.

**COVERAGE-REMOVAL ANSWER (pa-base §8):** the number of sites the pass STOPS INSPECTING
with a possibly-desirable outcome is **ZERO**.
  - defect 1 — 138 rewrites no longer made, all 138 inside compiler-owned runtime text.
    The population of DESIRABLE rewrites in the runtime slot is zero by construction: the
    slot contains no user code.
  - defect 2 — 781 insertions no longer made; an empty key can express no rewrite at all.
  - defect 3 — the `binding-pattern` branch is the only one that suppresses a rewrite, and
    its measured population is **0**. The 10 object-literal sites are still rewritten,
    just correctly (as the property VALUE instead of the KEY).

## VERIFICATION

- **pre-commit gate** (unit+integration+conformance): 28486 pass / 86 skip / **0 fail**,
  28573 tests / 1224 files.
- **`bun run test`** (adds browser/lsp/commands/self-host): head 29732 pass / 216 skip /
  49 fail. Base `13edcfbf`, same command, same machine: 29711 / 216 / **51** fail.
  Failure NAME SET delta (invariant 8): **0 NEW in head**, 2 "fixed" which are an
  environment artifact (the base clone's `benchmarks/todomvc/dist/` was unpopulated).
- **`bun scripts/corpus-emit-differential.ts`** base-vs-head, 1878 sources / 7254
  artifacts. Exit **1** (differences found — a VALID comparison, not exit 2). Exactly TWO
  differences, both by design:
  1. `stdlib/http/index.scrml` → `index.client.js`, 6031 → 6087 bytes (+56 = the 10
     shorthand expansions: `get`+5, `post`+6, `put`+5, `del`+5, `patch`+7, twice).
  2. `stdlib/cron/index.scrml` — diagnostic TEXT-only change, same code set.
  Everything else zero: 0 newly failing/passing compiles, 0 diagnostic-CODE changes,
  0 artifact set delta, 0 syntax delta under BOTH goggles, bare server-fn sites 142 → 142.
- **`--embed-runtime` differential** (the standing gate does not cover this mode): 1189
  bundles with a runtime region on both sides; **68 regions differ**, **107 mangle
  rewrites removed** from emitted runtime text, 9 distinct user names (`log` ×54,
  `fn` ×33, `label` ×10, `tick` ×8, `handle` ×2). HEAD residual: **0**. (107 < 138 because
  31 of the 138 occur in sources that never write a `.client.js`.)
- **EXECUTED, not grepped.** `--embed-runtime` bundle from a `fn log()` program, loaded in
  happy-dom: base LOAD ok / `_scrml_replay()` **THREW ReferenceError: log is not defined**;
  head LOAD ok / `_scrml_replay()` **RAN ok**. The corruption is latent, not load-time,
  which is exactly why an emit-string assertion would have missed it.
- **R26 empirical.** `examples/*.scrml` + `../scrml-support/docs/gauntlets/gauntlet-r25/
  dev-*.scrml` (36 sources) recompiled via `compiler/bin/scrml.js compile --output-dir` on
  both revisions: 31 ok / 5 fail on BOTH, 174 artifacts **byte-identical**, and zero
  instances of any of the three symptoms on either side — this slice carries no instance
  of any of the three defects.
- **S325 probe branch** `worktree-agent-a991f86dc83d4aebf` @ `c352e966` IS reachable. Its
  1413 / 138 / 781 / 2332 split is reproduced exactly by an independent instrument. The
  871 deletion-residual figure is NOT re-measured — nothing here changes the number of
  genuine user call sites (still 1413), so it cannot have moved; re-running the deletion
  experiment was not worth the budget for a figure the census already constrains.

## DEFERRED / SURFACED

- **A declaration-site diagnostic for a nameless fn needs a NEW §34 row.** Guarded here,
  not diagnosed. `E-CODEGEN-INVALID-LOGIC` is the only fitting existing code and it has
  exactly ONE fire site (`validate-emit.ts`) with a specific message contract.
- **`stdlib/cron/index.scrml` has an unrelated upstream defect** — a doc comment containing
  cron patterns and quotes escapes the block splitter, so a nameless `function` node reaches
  codegen and doc-comment text is emitted as code. Out of scope; still fails, now legibly.
- **`stdlib/http/index.scrml` also fails compile upstream**, for an unrelated reason.
- **The shadowed-parameter half of `g-mangler-scope-blind-shorthand-key-rename` is OPEN.**
  A parameter or local that shadows a top-level fn is still renamed scope-blindly. Needs
  real scope analysis; explicitly out of scope per the brief.
- Three narrower shorthand residuals, each with measured incidence ZERO: a `{` whose left
  context is `:`; a formal parameter list not headed by `function` or tailed by `=>`; a
  brace group split across a comment.

## S239 ADVERSARIAL REVIEW — fix round on `5cfc342e`

Two independent reviewers, both LAND-WITH-FOLLOWUP, both converging on the same primary
finding. Defects 1 and 2 confirmed sound by both lenses.

- **F1 — the `binding-pattern` fence was a HALF-REPAIR. FIXED by removing it.**
  Reproduced and EXECUTED before changing anything:

      function get(u) { return "G" + u }
      function post(u) { return "P" + u }
      function run() {
          const src = { get: (x) => "src-get" + x, post: (x) => "src-post" + x }
          const { get, post } = src
          return get(1) + "|" + post(2)
      }

  Correct answer `"src-get1|src-post2"`. Base `13edcfbf` emits
  `const { _scrml_get_3, _scrml_post_4 } = src;` → **THREW TypeError**, loud.
  `5cfc342e` emitted `const { get, post } = src;` with the call sites STILL mangled →
  **returned `"G1|P2"` silently**. Dead bindings, calls resolving to the module-level fns.
  Not a new bug in working code — an OBSERVABILITY REGRESSION on an already-broken shape,
  into precisely the silent-wrong class the object-literal half exists to remove.
  FIX: the consumer now acts on `object-literal` ONLY (`region.kind !== "object-literal"
  → continue`). The classifier KEEPS the ability to recognise a binding pattern; the
  consumer keeps its hands off. Post-fix the reproducer THREW TypeError again, matching
  base. A real binding-pattern fence needs a scope model = the mangler-RETIREMENT arc.
  Bite proof: restoring the half-repair turns §2d RED; restored → 22/22 green.
- **F2 — `__proto__` must not be expanded. FIXED.** ECMA-262 B.3.1: only
  `PropertyName : AssignmentExpression` with the name `__proto__` sets `[[Prototype]]`;
  the SHORTHAND form creates an ordinary own property. Reproduced on a clean-compiling
  source (`function __proto__(u)` + `const o = { __proto__, get }`) and EXECUTED:
  base `"2|undefined"` (2 own keys, `o.call` absent) → `5cfc342e` `"1|function"` — the own
  key vanished and the object began inheriting `call`/`apply`/`bind` from the function.
  NEW IN HEAD. FIX: skip the WHOLE REGION when it contains `__proto__`, not just that one
  name. Skipping only the name would strand a bare `__proto__` shorthand beside expanded
  siblings, and a free `__proto__` is ENGINE-DEPENDENT — measured: node silently binds the
  global object's prototype and returns `["__proto__","get"]`, bun throws a TypeError.
  Skipping the region reproduces the pre-fix emission byte-for-byte, the only option that
  adds no new shape. Post-fix: `"2|undefined"`, identical to base.
  Bite proof: deleting the guard turns §2e RED; restored → 23/23 green.
- **F3 — the `registerFnName` rationale was FALSE. REWORDED.** The old comment claimed an
  empty entry is "inexpressible — no consumer could ever look it up". Verified verbatim
  that this is wrong: `emit-event-wiring.ts:311 buildServerFnNames` iterates map ENTRIES
  and puts the raw KEY into `serverFnNames`; `:380 exprUsesServerFn` compiles each as
  `(?<![.\w$])<name>\s*\(`. With an empty name that is a WILDCARD — measured:
  `"@a + (b * 2)"` → true, `"foo (1)"` → true, `"(1)"` → true (and a real name is
  selective: `loadRows` → false on the same input). PRECISION the finding did not state,
  added because it bounds the claim: that path needs the nameless fn to be a SERVER fn,
  since `buildServerFnNames` admits a key only when its GENERATED name matches
  `^_scrml_(fetch|cps)_` — which the fetch-stub and CPS-wrapper registration sites both
  produce. Two further passes (`emit-client.ts:3076`, `:3325`) iterate map VALUES and never
  key-look-up. New rationale: an empty key is not a dead entry, it is a wildcard that
  silently matches arbitrary expressions in at least one consumer.
- **F4 — guard tightened from non-emptiness to IDENTIFIER SHAPE.**
  `/^[A-Za-z_$][A-Za-z0-9_$]*$/`. Closes the class rather than the witnessed instance.
  MEASURED which non-identifier keys actually arm the alternation, because the obvious
  answer is wrong: empty → **13** matches over three short buffers; whitespace-only `" "` →
  **0** (the relayed claim is incorrect for this alternation: `\b( )\b` needs word chars
  on both sides, but the lookahead then demands punctuation immediately after — a
  contradiction); interior-space `"a b"` → **2**. The guard deliberately does not depend on
  which shapes are hazardous under today's lookaround; that lookaround has been patched
  five times. The (a) ruling is unaffected.
  Bite proofs: F3's wildcard test and F4's class test both go RED against the old
  non-emptiness guard / old rationale; restored → 25/25 green.
- **F5 — RESIDUAL MAP, MEASURED not relayed.** Compiled one cleanly-compiling source
  carrying every named shape on both refs. **Two of the five relayed residuals were
  wrong**, which is why they were measured:

  | shape | base `13edcfbf` | head | status |
  |---|---|---|---|
  | nested `{api: {get, post}}` | `{api: {_scrml_get_2, _scrml_post_3}}` | identical | **STILL BROKEN** — inner group's left context is `:`, deliberately excluded |
  | spread `{...base, get, post}` | `{...base, _scrml_get_2, …}` | identical | **STILL BROKEN** — not an all-bare-identifier group, so not a region |
  | mixed `{get, post, n: 1}` | `{_scrml_get_2, _scrml_post_3, n: 1}` | identical | **STILL BROKEN** — same reason |
  | ternary CONSEQUENT `flag ? {get, post}` | broken | `{get: _scrml_get_2, post: _scrml_post_3}` | **FIXED** (left context `?`) |
  | ternary ALTERNATE `: {get, post}` | broken | identical | **STILL BROKEN** — left context `:`. The ASYMMETRY is real and worth stating: the same source expression compiles correctly on one branch and incorrectly on the other |
  | interior comment `{get, /* c */ post}` | `{_scrml_get_2, _scrml_post_3}` | `{get: _scrml_get_2, post: _scrml_post_3}` | **FIXED — the relayed residual is WRONG.** A source-level comment does not survive into the emitted object literal, so the group is contiguous. The comment-split hazard is a property of the mechanism, not a shape reachable from scrml source |
  | group with NO left context (interpolation-leading) | n/a | `kind: "unknown"` | **STILL BROKEN by design** — `rewriteCodeSegments` recurses into a `${…}` interior as a fresh string, so a group at interior offset 0 has nothing to classify against. Asserted directly at unit level |

  Plus the **binding-pattern residual from F1**: recognised by the classifier, deliberately
  NOT acted on, pending a scope model (the mangler-RETIREMENT arc).
  Plus the **`?? "anon"` residual**: `anon` is a valid identifier so it passes the F4 guard;
  N nameless fns would collide on one key, last-write-wins, N−1 pointing at the wrong
  generated name. Untouched — it is the same class one step out, and not in this brief.

  All of the above are pinned by §2f, so the boundary of this fix is a MEASURED ARTIFACT in
  the test suite rather than a claim in a report.
