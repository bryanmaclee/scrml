# Known gaps — spec-vs-implementation drift

> **Honest current state.** The README describes the nominal language at the time of any version release ("does not describe what the compiler is perfectly capable of doing"). This document is the running ledger of the largest places where the compiler does NOT yet match the nominal spec. Entries are added as gaps surface (e.g., during dogfood passes, adopter bug reports, audit passes), and removed when the gap closes via a landed implementation arc.
>
> **Severity legend:** HIGH = adopter-visible breakage on a documented pillar feature or silent-wrong-output class. MED = silent acceptance + missing safety guarantees, or working-but-incomplete surface. LOW = ergonomic / cosmetic drift.
>
> **Per-gap status:** `spec'd` = SPEC normative + compiler does nothing · `partial-impl` = some sub-units shipped, others pending · `scoping` = SCOPING.md authored, OQs open · `in-impl` = implementation arc actively in flight · `deferred` = ratified to defer pending a precondition · `blocked` = waiting on something else · `nominal` = SPEC-only Nominal section (deliberately spec-ahead-of-implementation per author)
>
> Updated 2026-05-27 (S137 — R25 HIGH cluster mostly CLOSED + **R26 verification surfaced NEW Bug 49 (BS-level upstream gap)**. **Bug 38** `!{}` arm-body codegen broader case RESOLVED `933d1ad3` (codegen-reachable cases CLOSED; +18 tests) — but R26 verification re-ran all 4 R25 devs on the post-cluster baseline `1a06f739` and found that the `const X = call() !{...}` value-binding shape (6 instances across dev-1 + dev-2) still drops arm content at BS layer BEFORE codegen sees it. Distinct upstream root; filed as **Bug 49** (HIGH; NEW). **Bug 41** `<schema>` HTML body-text leak RESOLVED `ebeba766` (verified CLEAN end-to-end on dev-2 R26); **Bug 40** `:`-shorthand inside `<each>` item body RESOLVED `50d38095` (verified all 4 devs all factories populated 7+6+6+5 R26); **Bug 37** `<each in=@x.filter(c=>...)>` arrow truncation RESOLVED `1ce963d0` (verified `node --check` clean on all 4 devs R26). Also S137: within-node allowlist rebump `050e20e8` (absorbed S136 parser-shape drift). Net HIGH count 7 → 4 (3 cluster-closures - 1 new R26-discovery; remaining: compiler-managed-async + 6nz-V class:NAME + R24-BUG-4 `<match>` `</>` Phase 5 + Bug 49). **R26 methodology lesson banked:** unit-test regression suites that synthesize AST and run codegen MISS upstream BS-level bugs. Empirical-reproducer verification (re-compile real .scrml source) is necessary alongside unit tests. Canary-metric-class lesson (S124 `feedback_canary_metric_class_lesson.md`) in compiler-fix shape: regression-tests-passing ≠ empirical-reproducer-passing. Methodology lesson banked TWICE this session: brief-hypothesis-vs-grep — R25-Bug-38 hypothesis correct, R25-Bug-41 hypothesis over-broad (narrowed to 2 of 9 structural elements), R25-Bug-40 hypothesis upstream of actual root (BS, not codegen), R25-Bug-37 hypothesis downstream of actual root (ast-builder, not BS). Grep + AST-trace consistently beat brief speculation. Same-shape latent sibling-finder bug class surfaced by Bug 37 agent (D37a/b — `_findMatchOpenerEnd` x2 + `_findOpenerEnd`) filed as Bug 48 LOW. PRIOR S136 — R25-Bug-36 RESOLVED `e1269844` + Bug 39 RESOLVED-AS-SIDE-EFFECT + Bug 38 root-cause CONFIRMED-DISTINCT from Bug 36 via agent's dispatch investigation. Bug 36 was actually a `! ErrorType` bare-form (SPEC §41.14) parse-gap, NOT `?{}`-related as PA brief hypothesized — SQL correlation was incidental (all R25-affected functions just contained SQL). Brief-hypothesis-correction banked. Pending followups: SPEC §19.4.1 grammar amendment for bare-form ratification; new deferred-item triage for `?{}` non-lowering at default-logic top-level (may overlap Bug 42 OR be separate).

---

## §0 At-a-glance — open-gap inventory (counts)

| Severity | Open | Closed-this-arc | Notes |
|---|---|---|---|
| HIGH | 4 | E-TYPE-001 lifecycle fire (S130 Landing 1 SHIPPED) · §29 vanilla-interop framing-corrected (S132) · **E-FN-003 (RESOLVED S133 `dbef4f4d`)** · **Bug 17 E-META-001 runtime-meta (RESOLVED S134 `6c6c0073`)** · **§6.6.18 alias-escape A4 LANDED S134 `b719a3d2`** · **Bug 19 Shape 1 lifecycle tracker LANDED S134 `fd58893e` (B-prereq)** · **§6.8.3 reset × lifecycle impl LANDED S135 `2ffe4f6a` (Q6-narrow; SPEC-ahead-of-impl bullet CLOSED)** · **Structural-in-logic-body silent-swallow class CLOSED S135 `ab0d13a3` (E-STRUCTURAL-ELEMENT-MISPLACED fires for `<schema>`/`<engine>`/`<channel>`/`<page>`/`<auth>`/`<errors>`/`<onTransition>`/`<onTimeout>`/`<onIdle>` in `${...}` bodies; +19 tests)** · **Bug 28 `or`/`and` codegen lowering RESOLVED S136 `89008e97` (R24-BUG-1; 2-site fix + 42-test regression; HELD 4/4 R25)** · **Bug 29 narrow `{ return }` arm RESOLVED S136 `c7e81962` (R24-BUG-2; +18 regression tests; broader case Bug 38 RESOLVED S137 `933d1ad3`)** · **Bug 36 `! ErrorType` bare-form parse-gap RESOLVED S136 `e1269844` (was CRITICAL R25; 3-site fix ast-builder + native-parser + 12-test regression; spec §41.14 bare-form ratification)** · **Bug 39 phantom enum→textContent wiring RESOLVED-AS-SIDE-EFFECT-OF-BUG-36 S136 `e1269844` (was HIGH R25; was a symptom of Bug 36's orphan-IDENT)** · **Bug 37 `<each in=@x.filter(c=>...)>` arrow truncation RESOLVED S137 `1ce963d0` (R25; ast-builder `_findEachOpenerEnd` paren/bracket-aware; +12 tests; Shape A — accept inline arrow)** · **Bug 38 `!{}` arm body codegen broader case RESOLVED S137 `933d1ad3` (R25; emit-logic.ts `emitArmAssign` extended with multi-stmt + single-stmt-side-effect branches; +18 tests; closes R24-Bug-29-family deeper shapes; R26 partial — see Bug 49 for the BS-level upstream gap surfaced)** · **Bug 40 `:`-shorthand inside `<each>` item body RESOLVED S137 `50d38095` (R25; SPEC §4.14 BS-level compliance gap; three-file fix block-splitter + ast-builder + emit-each; `<empty :>` sub-case closed same-root; +20 tests)** · **Bug 41 `<schema>` HTML body-text leak RESOLVED S137 `ebeba766` (R25; emit-html.ts `SERVER_ONLY_STATE_TYPES` exclusion for `schema`+`seeds`; +18 tests; sibling structural-elements verified clean upstream)** | compiler-managed-async (deferred A9-class) · 6nz-V class:NAME on for-lift (GENUINE) · R24-BUG-4 `<match>` `</>` Phase 5 (cross-ref escalation, SCOPING-tracked) · **Bug 49 BS-level stmt-boundary drops `const X = call() !{...}` arm content (NEW S137 R26; UPSTREAM of Bug 38 codegen fix; 6/6 R25 instances dev-1+dev-2 still residual; canon-shown shape per primer §6 + kickstarter)** |
| MED | 13 | Bug 15 `~snapshot` codegen leak (S131 SHIPPED) · E-SCHEMA-003 enforcement (S133 SHIPPED `afbcb47a`) | Bug 1 Tailwind residuals · V-kill READ-side fire · MCP V0 partial-impl deferrals · Generator policy · L19 multi-statement-handler · **A5 refinement-type freeze extension (DEFERRED with adoption-watch trigger, S134)** · **Bug 30 linter scans HTML comments (NEW S136 R24; R25 confirmed via Bug 43 cross-ref)** · **Bug 31 if-as-expression in !{} result binding (NEW S136 R24)** · **Bug 32 `@.` not lowered inside tableFor column slot (NEW S136 R24)** · **Bug 35 rewriteIsPredicates space-padded-dot AST-path gap (NEW S136 R24-BUG-1 triage)** · **Bug 42 `?{}` SQL in `server function*` not lowered (NEW S136 R25; E-CG-006 misclassified for server-context)** · **Bug 44 W-LINT-007 false-positive on `fallback={<markup/>}` SPEC §19.6 canonical errorBoundary shape (NEW S136 R25; composes with R24 step-3b)** |
| LOW | 16 | (rotate out below) | Bug 4 bare-`/` · GITI-015 · §11-folded-citation sweep · `bun scrml promote --engine` Tier-1→2 deferred · **Bug 21 Q6-narrow deep multi-level reset heuristic (S135)** · **Bug 22 Q6-narrow cross-cell `default=` classification heuristic (S135)** · **Bug 23 W-LIFECYCLE-LEGACY-ARROW Shape 1 emission gap (S135)** · **Bug 24 qualified-form discrim regex tolerance (S135)** · **Bug 25 transition() deeper-expression regex tolerance (S135)** · **Bug 26 `${...}` inside `function` body E-SCOPE-001 (S135)** · **Bug 27 tryParseStructuralDecl extra lookahead cleanup (S135)** · **Bug 33 W-LINT-011 false positive on `:let=` (NEW S136 R24)** · **Bug 34 Shape-2 compound markup-init missing 2nd arg (NEW S136 R24)** · **Bug 45 `int` ghost type → asIs fallthrough → confusing E-SCHEMAFOR-NO-SQL-MAPPING (NEW S136 R25; 4/4 devs reached from canon)** · **Bug 46 tableFor `sortable=`/`selectable=` not implemented (NEW S136 R25; W-ATTR-001 forwarded as plain HTML)** · **Bug 48 latent paren/bracket-depth gap in sibling `<match>`/`<machine>`/`<engine>` opener finders (NEW S137; surfaced by Bug 37 fix; not adopter-fired today)** |
| Nominal (spec-ahead-of-impl) | 7 | — | Build Story §58 · `import:host` §21.3.1 · Quoted-text §4.18 compiler fire · `_{}` foreign code · WASM call-char sigils · Sidecar process decls · RemoteData enum |

---

## §1 HIGH — adopter-visible / silent-wrong-output

### Bug 19 — Shape 1 plain reactive cell per-access lifecycle tracker — `RESOLVED S134 (commit fd58893e)` (was HIGH; Q6 prerequisite — now closed)

**Fix (S134 `fd58893e`):** Option α per PA lean — extended `collectStructBindings` to recognize `state-decl` AST nodes (Sub-Pass 2.a; struct-typed Shape 1 case) + authored a NEW cell-value-typed tracker reusing the existing `checkLifecycleBindingAccess` from S131 HU-2 via two additive optional params (`initialStates: Map<string, "pre"|"post">` + `bindingSourceLabel: string`) (Sub-Pass 2.b; cell-value-typed Shape 1 case). Discrimination semantics (Sub-Pass 2.d) fully reused — `given X => {}` / `if (X is not) return` / `match X` / `transition(X)` all apply uniformly. Engine-cell carve-out (Sub-Pass 2.c) preserved — both new collectors skip `engineCellNames`. Two material walker changes: synthetic `{kind:"logic"}` block recursion → block-transparent (state-decl writes visible to subsequent siblings per §6.9 hoisting); `reactive-nested-assign` write node recognized as transition write. Tests: NEW `compiler/tests/unit/lifecycle-shape1-tracker.test.js` (+621L, 25 tests). Baseline 21,676 → 21,701 (+25, 0 fail). Pre-commit gate green on all 7 agent commits + the PA-authored landing.

**Composition with §6.8.3 — Q6-narrow LANDED S135 `2ffe4f6a`.** The tracker observed writes uniformly; Q6-narrow's reset-awareness extended the walker to recognize `reset(@cell)` and `reset(@cell.field)` calls and route through `classifyWriteAgainstSpec` to revert/maintain per-access state per §6.8.3 ratified semantic. Tracker 1 (cell-value Shape 1) + Tracker 2 (struct-typed Shape 1 field lifecycle) both implemented. +25 tests in `compiler/tests/unit/lifecycle-shape1-reset.test.js`; baseline 21,701 → 21,726; zero regressions. Two new heuristic limitations filed as LOW (see §3): deep multi-level reset on nested compound uses `fieldPath[0]`; cross-cell `default=@otherCell` classification is heuristic.

**Deferred items surfaced by B-prereq (NOT regressions; orthogonal limitations):**

1. **Parser tokenizer collapses whitespace around `.` tokens in lifecycle annotations** — `(.Draft to .Published)` becomes `(.Draft to.Published)` at AST level, defeating `findTopLevelArrow`'s space-bounded `to` detection. End-to-end variant-progression on Shape 1 cells with bare-dot annotations therefore goes unrecognized from source form (direct-AST tests work fine — mirrors existing fn-return test pattern). Fix paths: tokenizer-side whitespace preservation OR relax `findTopLevelArrow` to accept one-sided whitespace boundary.
2. **Top-level `let-decl` inside `${...}` blocks doesn't fire** — existing `collectStructBindings` only matches `let-decl` at FN-BODY scope. Pre-existing gap orthogonal to B-prereq; state-decls hoist (closed S134 by this dispatch); let-decls don't.
3. **Qualified-enum form `(Article.Draft to Article.Published)`** — variant-name stripping in `parseLifecycleReturnAnnotation` only removes the leading dot, leaving `Article.Draft` in `preVariantName`. Affects both fn-return and cell-value variant trackers symmetrically.

All three filed in `docs/changes/b-prereq-shape1-lifecycle-tracker-2026-05-26/progress.md` as known follow-ups. None gates Q6-narrow.

---

### Bug 19 (ORIGINAL ENTRY — S134 surfacing, preserved for forensic) — Shape 1 plain reactive cell per-access lifecycle tracker — `NEW S134; HIGH; impl missing` (Q6 prerequisite)

**Surfaced S134 Q6 dispatch Phase-0 STOP** (`docs/changes/q6-reset-lifecycle-2026-05-26/progress.md`). SPEC §14.12.3 + §14.12.10 (bullet 1) normatively promise per-access lifecycle transition tracking on **Shape 1 plain reactive cells** (`<state>: (not to User) = not`-style decls). The impl tracker today (`compiler/src/type-system.ts` `checkLifecycleFieldAccess`) covers struct-field positions (`User.passwordHash`-style) and fn-return positions (per §14.12.6 hybrid) only — `state-decl` (Shape 1 reactive cell decl) AST nodes are NOT in the tracker's scope.

**Empirically verified by Q6 Phase-0 reproducer:**

```scrml
<state>: (not to User) = not
@state.name   // SHOULD fire E-TYPE-001 per §14.12.10 normative bullet 1; ACTUAL: no fire
```

- **Severity rationale:** HIGH. SPEC §14.12 promises a tracker that doesn't exist for one of the six normatively-supported positions. Adopters writing `<state>: (not to T) = not` get the type-resolution + carve-out (correct) but no pre-transition access enforcement (silently wrong). Exactly the spec-vs-impl drift class Rule 4 is built to catch.
- **Workaround:** wrap state in a single-field struct: `type Holder:struct = { val: (not to User) }; <state>: Holder = { val: not }`. The struct-field tracker DOES fire correctly. Verbose but functional.
- **Reproducer (1-liner):** any `<x>: (A to B) = pre-typed-value` decl followed by `@x.field` access — should fire `E-TYPE-001`, doesn't.
- **Resolution path — B-prereq dispatch (queued S134; pre-Q6-impl):**
  - **Scope:** extend `collectStructBindings` (`type-system.ts:13698`) to recognize `state-decl` AST nodes — OR — author a parallel `state-decl` lifecycle tracker pass. Must cover BOTH the struct-typed Shape 1 case (`<u>: User = ...` with lifecycle on `User.passwordHash`) AND the cell-value-typed Shape 1 case (`<state>: (not to User) = not`) — Q6 Phase-0 verified `collectStructBindings`-extension alone won't cover both.
  - **Estimate:** ~20-30h compiler-source via `scrml-js-codegen-engineer` (isolation:worktree). Unblocks Q6-narrow impl (~10-20h).
  - **Tests:** +N regression-guard covering the 1-liner reproducer + sibling cases (assigning to pre-type satisfies; assigning to post-type triggers).
- **Composition:** §6.8.3 (the symmetric-reset interaction landed S134 SPEC-only) DEPENDS on this tracker — `reset(@cell)` can't revert per-access state on a tracker that doesn't observe per-access state for Shape 1. §6.8.3 stands as the design contract; impl waits for B-prereq.
- **Cross-refs:** SPEC §14.12.3 (extension scope table — Shape 1 listed YES), §14.12.10 (normative statement promising the fire), §6.8.3 (the dependent reset semantic landed S134), Q6 Phase-0 progress.md at `docs/changes/q6-reset-lifecycle-2026-05-26/progress.md`. Authority: const-deep-freeze HU/DD/debate arc S134.

---

### Bug 17 — E-META-001 only fires in compile-time meta blocks; runtime blocks silently accept JS-host globals — `RESOLVED S134 (commit 6c6c0073)` (was HIGH)

**Surfaced S133 Step A** (commit `80b168e6`) — after closing the META_BUILTINS membership divergence, the Step A agent surfaced a second-order architectural gap. SPEC §22.12 line 14687 reads as **categorical**:

> "JS-host ambient globals (`bun`, `process`, `setInterval`, `fetch`, etc.) are NOT in the META_BUILTINS set and trigger `E-META-001`."

But pre-S134 meta-checker fired E-META-001 only inside **compile-time** meta blocks (`bodyUsesCompileTimeApis === true` from `reflect` / `emit` / `emit.raw` API references). A pure **runtime** meta block — `^{ const x = bun.eval(...); /* no reflect/emit */ }` — got early-returned in `checkMetaBlock` without consulting META_BUILTINS membership. The block emitted unchanged into the generated `_scrml_meta_effect` body. At JS runtime: `bun` is not a Bun-runtime global (only `Bun` capital-B is), so the call **silently failed with ReferenceError** at runtime.

- **Fix (S134 `6c6c0073`):** Approach A — new exported `checkMetaBlockForJsHostGlobals` walker (`compiler/src/meta-checker.ts` +160L) that runs UNCONDITIONALLY on every `^{}` body (compile-time AND runtime), parallel to `checkMetaBlock`. Scans against a new `JS_HOST_FORBIDDEN` Set (9 idents: `bun` / `Bun` / `process` / `console` / `setInterval` / `setTimeout` / `clearInterval` / `clearTimeout` / `fetch`). Respects local-decl shadowing, JS keywords, META_BUILTINS membership; recurses into nested `^{}`. Per-identifier hint messages (timer idents → `meta.interval`/`meta.timeout`; `fetch` → server-fn boundary; rest → generic 'not available'). Wired in `runMetaChecker` between `checkMetaBlock` and `checkReflectCalls` — preserves S133 Step A compile-time semantics verbatim. SPEC §22.11 catalog row broadened to enumerate the three E-META-001 fire conditions (disposition I; closes S114-introduced catalog drift). Regression tests at `compiler/tests/unit/meta-checker-bug17.test.js` (NEW, 33 tests = 1 set composition + 8 idents × runtime-fire + 2 bare-expr + 4 negative controls + 4 diagnostic-message + 1 reproducer end-to-end). Tests: 21,585 → 21,618 (+33, 0 fail). Full-suite gate green.
- **Corpus migration silent under prior gate:** 25 pre-existing tests in `meta-integration.test.js` (13 sites) + `runtime-meta-integration.test.js` (19 sites) used `console.log(...)` inside runtime `^{}` bodies as a "force runtime classification + observe pipeline emission" pattern. Post-fix, these correctly fire E-META-001. Migrated cleanly to `meta.emit(...)` (canonical scrml-native surface per §22.5.1) — semantically equivalent for the codegen-shape assertions these tests carry. Same migration shape adopters with similar test/sample code would need.
- **Open follow-ups (NOT regressions; separate concerns):**
  1. `meta.runtime=false` diagnostic at `meta-checker.ts:~1622` still uses pre-S134 phrasing — broaden for §22.5/§22.11 consistency. Polish.
  2. BS-path: `${ ^{} }` inside `<program>` markup interpolation produces only a `text` node (no meta block enters the pipeline). Latent issue separate from this fix. The canonical V5-strict shape (`p "test"\n^{ ... }\n`) surfaces the meta block correctly.
  3. `compileScrml({source, filePath})` vs `({inputFiles:[filePath]})` API surface divergence — the `source` path may take a shortcut bypassing the meta-checker pipeline. Surfaced for awareness.
- **Self-host parity DEFERRED** post-v1.0 per pa.md — `stdlib/compiler/meta-checker.scrml` + `compiler/self-host/meta-checker.scrml` mirrors carry pre-S134 META_BUILTINS as DATA only (no walker structure).
- **Original brief shape (preserved for forensic):**
  - Move the META_BUILTINS check OUTSIDE the `bodyUsesCompileTimeApis` early-return in `checkMetaBlock` (`compiler/src/meta-checker.ts`) — make it fire E-META-001 for runtime meta blocks too.
    - OR: add a sub-walker that runs unconditionally on every `^{...}` body and checks against META_BUILTINS / known-runtime-meta-API set.
    - Add regression-guard tests covering all 4 removed builtins × runtime context: `process` / `fetch` / `setInterval` / `setTimeout` / `Bun` / `console` (6 cases) inside `^{ ... }` with NO `reflect`/`emit`/`emit.raw` → assert E-META-001 fires.
    - Verify existing 14,566 baseline holds + add new tests (+6-8 logical assertions).
    - Per `feedback_restate_prerequisites_not_conclusions` — restate this entry's pre-dispatch sweep findings in the brief (corpus is empirically clean; no fallout expected).
  - **(c) / (d) REJECTED in deliberation:** (c) had no use case (the `meta.*` API covers runtime needs); (d) is a half-measure that doesn't close the silent-crash class.
- **Cross-refs:** Step A commit `80b168e6` agent report `OPEN follow-ups #1`; SPEC §22.12 line 14687 (the categorical statement); §22.5 + §22.5.1 (runtime meta surface); `compiler/src/meta-checker.ts` `checkMetaBlock` + early-return condition.
- **Not blocking adopters today** — pre-S133 adopters didn't write `bun.eval(...)` (the user-facing surface retired S130); post-S133 they're more likely to hit it via reflex. Watch adopter bug reports for first sighting; treat as load-bearing trigger if it shows up.

### Bug 9 — Compiler-managed async transitive coloring (A9-class) — `deferred`

When a client function calls a server function, the client function should be auto-async-and-awaited (per the "compiler owns the async wiring" pillar). Today the compiler doesn't fully thread this: `scheduling.ts::hasServerCallees` reads `route.functionName` (which is phantom — set in only some pipeline paths). The result: `serverFnNames` is sometimes empty; transitive client functions calling server functions never get `async`/`await` added, and the runtime silently runs the call as sync — returns a `Promise` where the call site expects the resolved value.

- **Workaround:** explicit `async`/`await` in client functions that call server functions (the very thing the language is supposed to do for you). Inelegant; the compiler IS supposed to handle this.
- **Reproducer:** the dashboard cluster (per S126 diagnostic). Any client function in a fn-body that calls a server-classified function.
- **Status:** DEFERRED to A9-class compiler-managed-async work per pa.md Rule 3 (3-layer fix; L3 = NEW transitive async-coloring subsystem; not blind-patched). Filed S126 + carried forward S127-S130. Not in any current implementation arc; queued for v0.7+ post-M6.

---

### Bug 10 — §29 vanilla-interop — SPEC vs implementation drift — `Nominal / framing-corrected S132`

**Originally (S110):** SPEC §2.1 + §29 asserted in the present tense that plain `.js`/`.html`/`.css` files "are valid alongside `.scrml` files; the compiler processes `.scrml` files and integrates or passes through the rest." Verified S110 the compiler did NOT do this — a pure-vanilla file is rejected (`Cannot find file or directory`); a mixed-project build compiles the `.scrml` and silently DROPS the vanilla files (not copied to dist). The bug was the FALSE present-tense CLAIM, not a missing feature.

- **Workaround:** keep all source in `.scrml`; for vanilla CSS use `#{}` blocks; for vanilla JS use `${}` blocks or `import` from `.js` modules (which IS live + load-bearing per §21).
- **Reproducer:** any project with a `.js` or `.html` file alongside `.scrml`.
- **Status:** **Nominal / framing-corrected S132.** Ratified option (c): the §2.1 false present-tense pass-through claim is REMOVED (reframed to explicit Nominal-future + S132 amendment note), and §29 is MARKED Nominal/spec-ahead-of-implementation (KEPT in SPEC, NOT retired — reaffirms S131 Q-W3-4 defer; re-trigger ≥2 adopter friction reports). NOT "RESOLVED-by-implementation": the feature is still NOT implemented; the spec now honestly says so. Vanilla-JS interop today is via §21 import (live + distinct from §29). The spec no longer makes a false claim, so this is no longer a spec-vs-impl drift — it is correctly-framed-as-Nominal.

---

### Bug 11 — 6nz-V `class:NAME` on for-lift reused DOM nodes — `confirmed GENUINE`

When a `for...of` loop with `lift` produces DOM nodes that get reused across renders, the `class:NAME` reactive class binding is not re-evaluated against the new iteration item — the original binding's evaluated class state persists on the reused node. Codegen IS correctly per-item-scoped; the gap is in the runtime lift/reconcile path.

- **Workaround:** use static class strings inside for-lift bodies; bind reactive classes outside the loop or via a per-item wrapper component that gets full re-mount.
- **Reproducer:** filed by 6nz S126; `class:active=@item.selected` inside `for (let item of @items) { lift <li class:active=...>...</li> }`.
- **Status:** GENUINE; runtime bug (lift/reconcile path), not codegen. Queued MED; not currently in implementation. Filed S126.

---

### Bug 12 — E-FN-003 false-positive on attributed-markup-return inside `fn` — `RESOLVED S133 (commit dbef4f4d)` (was HIGH)

A `fn` that returned (or `let`-bound) markup carrying ANY attribute (`class`, `id`, `href`, …) false-fired `E-FN-003: fn body writes to '<attr>'`. The fn-purity write-check `checkOuterScopeMutation` (`compiler/src/type-system.ts` ~12780-12813) ran a text-heuristic `ASSIGN_RE` regex over the SERIALIZED statement text (`nodeText` → `emitStringFromTree`, which re-serializes returned markup including attributes); markup `name="…"` / `name={…}` was indistinguishable from an assignment LHS to that regex. Blocked the canonical "fn returns markup" idiom (PRIMER §6.4 sub-shape 4 / kickstarter §11.11).

- **Fix (S133 `dbef4f4d`):** skip the text heuristic when the statement's serialized text starts with `<` (markup-shaped — `kind:"escape-hatch"` raw markup per `shouldSkipExprParse` at `ast-builder.js:122`). The structured assignment-kind path (`type-system.ts:12785-12798`) and the `@cell`-mutation path (`13013-13064`) are untouched — real purity enforcement preserved. Approach B (predicate-based skip) chosen over Approach A (excise serialized markup substrings) because markup-in-expression-position is stored as escape-hatch raw text, not as structured `kind:"markup"` AST. Regression tests (`compiler/tests/unit/fn-constraints.test.js` §8b — 4 tests incl. negative control asserting `counter = counter + 1` alongside attributed markup STILL fires on `counter`, not `class`). Tests: 21,584 → 21,588 (+4, 0 fail).
- **Known structural gap (separate enhancement):** outer-scope writes embedded inside markup interpolations (e.g. `<a href={counter = counter + 1}>`) are not detected pre- or post-fix; the markup escape-hatch isn't structurally parsed. Pre-fix, the regex's first match captured the attribute name (false-attributing the write); post-fix, the heuristic is skipped on markup-shaped statements. The reactive `@-cell` write path at `13013-13064` similarly doesn't reach into markup interpolations. To close this, the markup escape-hatch ExprNode would need structural parsing — separate enhancement, NOT a regression from this fix.

---

### Bug 28 — `or` / `and` boolean operators not lowered to `||` / `&&` in derived-cell codegen — `RESOLVED S136 (commit 89008e97)` (was HIGH; R24)

**Fix (S136 `89008e97`):** two-site landing per agent triage finding (a76e86b1c2b94ea00). The bug surface was two-sided:
- **AST path** (`compiler/src/expression-parser.ts:preprocessForAcorn` +35L) — acorn doesn't know `or`/`and` are operators; without rewrite, the AST emission path produced no `BinaryExpr` for word-form. Added `or`→`||` / `and`→`&&` rewrite, fenced via `rewriteCodeSegments` (matches the `rewriteNotKeyword` precedent above it).
- **String-rewrite fallback path** (`compiler/src/codegen/rewrite.ts` +47L) — when `rewriteReactiveRefsAST` bails (any expression containing `is` / `match` / `?{` / `::`), the regex-based passes in codegen/rewrite.ts run. There was NO pass for `or`/`and` lowering — they leaked verbatim into emitted JS. New `rewriteBooleanKeywords()` registered as Pass 2.5 in BOTH `clientPasses` and `serverPasses` after `rewriteNotKeyword`.

Pattern: lookbehind `(?<![A-Za-z0-9_$@.])`, lookahead `(?![A-Za-z0-9_$])` — excludes identifier-substring matches (`orange`/`xor`/`vendor`/`andrew`), member-access (`obj.or`), sigil-prefixed (`@or`).

Regression test: `compiler/tests/unit/boolean-keywords-lowering.test.js` (NEW; +372L; 42 tests covering single-op, mixed-precedence, filter-callback shape from R24 reproducer, + negative controls). Reproducer verified: dev-1-react.scrml `or`/`and` raw before → 0 raw after; 27 properly lowered `||`/`&&` sites in compiled client.js.

Tests: 14,743 → 14,785 pre-commit (+42, 0 fail, 88 skip, 1 todo) · 21,762 → 21,804 full suite (+42, 0 fail, 170 skip, 1 todo).

**Spec status (R24-BUG-1 Rule-4 finding — RESOLVED in S136 SPEC amendment):** the brief asserted SPEC §45 + §7 canonicalize word-form `or`/`and`; agent's cross-check found SPEC was actually SILENT on word-form (SPEC §45 covers `==`/`!=` only; `BinaryExpr.op` AST union lists `||`/`&&` only; SPEC code blocks use `&&`/`||` exclusively; `or`/`and` appear ~1076× in SPEC but all English prose). User direction (S136 — option (i)): RATIFY word-form as canonical alongside `||`/`&&`. SPEC + PRIMER + kickstarter normative text added in the follow-up commit. Adopter signal (2/4 R24 devs reached for word-form instinctively) + zero-friction fix (matches `not` rewrite precedent) drove the ratification.

**Cross-refs:** R24-BUG-1 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md` § "Compiler bugs surfaced"; agent dispatch brief at `docs/changes/r24-bug-1-or-and-codegen-lowering-2026-05-27/BRIEF.md` (S136 DD-Rec-14 archival).

**Known limitations (accepted trade-offs):**
- `obj . or` (whitespace-separated property access) would still rewrite — same accepted trade-off as the `not` precedent (`obj . not` also breaks). Not commonly written; matches accepted precedent.
- `let and = 5` / `let or = 5` (valid JS identifier renamed to operator-keyword) would break — same accepted trade-off as the `not` precedent. Zero usages in current corpus.

These can be hardened later with extended lookbehind if adopters report; not warranted preemptively.

---

### Bug 29 — `!{}` handler `{ return }` arm codegen emits `_result = return;` (invalid JS) — `RESOLVED S136 (commit c7e81962); broader case Bug 38 RESOLVED S137 (commit 933d1ad3)` (was HIGH; R24)

**S136 partial fix (commit `c7e81962`):** terminating-statement detection added to `compiler/src/codegen/emit-logic.ts` `emitArmAssign` closure (case `"guarded-expr":`, lines 2479-2491). Two local helpers: `splitTopLevelStmts` (depth-tracked `;`-split mirroring `rewriteBlockBody`'s separator pass) + `isTerminatorStmt` (regex `/^(?:return|throw|break|continue)(?:[\s;]|$)/`). When arm body's last statement matches a terminator, emit each statement directly (no `_result = ...` wrap). Side-effect + terminator bodies (`{ @x = "y"; return }`) emit both as a sequence — reactive_set fires BEFORE return. +18 regression tests in `compiler/tests/unit/error-handler-terminator-arms.test.js`. Tests 21,762 → 21,780.

**R25 finding — BROADER CASE STILL OPEN as Bug 38:** R25 confirmed via 4/4 dev exposure + overseer verification that the `!{}` arm-body codegen failure is DEEPER than the bare-`return` shape Bug 29 narrowly addressed. Multi-line arm bodies with reactive writes and no-op-return tail STILL fail to produce arm codegen even after S136 fix. The `const r = call() !{...}` workaround pattern suppresses E-ERROR-002 but per overseer-2 + overseer-3 does NOT produce arm codegen. Single-line collapse `!{ | .X -> @y = "z" }` ALSO fails per overseer-3 fresh compile. The deeper bug appears to be parser-vs-codegen split: the `!{` token kicks the parser into "statement boundary not detected" mode regardless of arm-body shape. See Bug 38.

**Bug 29's narrow case is FIXED;** the broader R24-Bug-29-family is filed as Bug 38 for separate dispatch.

- **Reproducer (Bug 29 narrow):** `function load() { fetchItems() !{ | .Network msg -> { return } } }` — pre-S136 emitted `let _result = return;`; post-S136 `c7e81962` emits the body directly.
- **Reproducer (Bug 38 broader):** see Bug 38 entry below for R25 4/4-dev cross-confirmed scope.
- **Spec reference:** SPEC §19.4 (inline handler contract); SPEC §19.5 (call-site `!{}`).
- **Cross-refs:** R24-BUG-2 (scrml-support/docs/gauntlets/gauntlet-r24-report.md) → fix landing `c7e81962`; R25-Bug-38 (scrml-support/docs/gauntlets/gauntlet-r25-report.md § "Compiler bugs surfaced" → Bug 38) → broader case OPEN.

---

### Bug 36 — `! ErrorType` bare-form parse-gap (SPEC §41.14) caused server-fn body silent drop — `RESOLVED S136 (commit e1269844)` (was CRITICAL; R25; 3/4 devs)

**Fix (S136 `e1269844`):** three-site parser fix. Root cause was NOT `?{}` SQL as the brief hypothesized — the SQL correlation was incidental (all R25-affected functions just happened to contain SQL). Actual root: the parser only recognized `! -> ErrorType` arrow form (SPEC §19.4.1 normative grammar); the bare `! ErrorType` form (SPEC §41.14 normative examples; 4/4 R25 dev instinct from canon) was unrecognized → parser fall-through → body-collection failure → BS "statement boundary not detected" warning → silent body drop → empty server-fn handlers.

THREE-SITE FIX:
- `compiler/src/ast-builder.js` function-decl handler (~L8552, +37/-4): post-`!`, accept bare `IDENT/KEYWORD` + function-decl-head continuation (`{` body / `route` / `method` / `.idempotent` / `:` / `->` / `;` / EOF) as errorType
- `compiler/src/ast-builder.js` fn-shorthand handler (~L8775): same fix mirrored
- `compiler/native-parser/parse-stmt.js` `parseScrmlFunctionDecl` (~L1842, +24/-2): parity fix

Disambiguation guard refined from "IDENT then LBrace only" (too strict — broke `! ErrorType route="/api" {body}`) to the broader continuation-set check.

REGRESSION TEST — `compiler/tests/unit/r25-bug-36-bare-error-type.test.js` +358L (NEW; 12 tests across 8 §-sections): bare `! ErrorType` server-fn / fn-shorthand / with route= / with method= / with .idempotent / arrow-form regression-guard / mixed bare-and-arrow / disambiguation cases.

REPRODUCER VERIFICATION:
- dev-1-react server-fn handlers (createCard/moveCard/archiveCard): empty BEFORE → populated AFTER (SQL queries + if + fail + run + broadcast + return all present)
- R25 statement-boundary warnings: dev-1 7→4, dev-2 ?→3 (residual = Bug 38 distinct), dev-3 4→0 FULLY CLOSED, dev-4 ?→0 FULLY CLOSED

Tests: 14,746 pass / 9 fail (pre-fix; 9 = my new regression test's pre-fix expects) → 14,755 pass / 0 fail (post-fix). 0 regressions in broader suite.

**SIDE EFFECT — Bug 39 also RESOLVED.** The orphan `CreateError` / `MoveError` / `ArchiveError` IDENTs from the failed parse were being treated as reactive-display expressions on a `_scrml_logic_N` slot (the phantom `el.textContent = CreateError` wiring). With Bug 36 fixed, the IDENTs are properly absorbed as errorType annotations and the phantom wiring vanishes. All 4 R25 devs: 0 phantom wirings post-fix.

**SPEC self-inconsistency surfaced (DEFERRED follow-up):** §19.4.1 grammar `'!' ('-> error-type)? block` is incomplete vs §41.14 normative `! ErrorType` examples. Recommend §19.4.1 grammar amendment: `'!' ('-> error-type | error-type)? block` to ratify the bare form. Spec-only follow-up.

**PA brief hypothesis correction:** the brief named `?{}` as suspected root cause and `emit-server.ts` / `emit-logic.ts` as suspect files. Agent's grep-driven triage ("statement boundary not detected" string → expression-parser.ts:1975 emit site → debug trace through safeParseExprToNode → parseLogicBody → orphan IDENT as bare-expr) found the bug in the PARSER, not codegen. Same shape as R24-BUG-2 dispatch's correction — brief heuristics drift; grep on smoking-gun strings is the load-bearing tool. Banking.

- **Cross-refs:** Bug 36 in `scrml-support/docs/gauntlets/gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-36-server-fn-body-drop-2026-05-27/BRIEF.md`; SPEC §41.14 bare-form examples; SPEC §19.4.1 grammar (needs amendment).

---

### Bug 37 — arrow function in `<each in=...>` attribute truncates at codegen — `RESOLVED S137 (commit 1ce963d0)` (was HIGH; R25; minimally reproduced)

Inline arrow-function predicate inside an `<each>` `in=` attribute was severed at codegen. `<each in=@x.filter(c => c.foo == 1)>` emitted `_scrml_reactive_get("x").filter(c =;` — the `=>` was severed, predicate body dropped, closing paren replaced with `;`. Compile exited 0 (silent miscompile); `node --check` FAILED with `SyntaxError: Unexpected token ';'`. Minimally reproduced by overseer-4 in R25.

**Fix (S137 `1ce963d0`):** Shape A (accept inline arrow). Root cause was NOT in block-splitter (PA brief hypothesized BS-level; BS `scanAttributes` already correctly tracked paren+bracket depth — pre-S136 parenDepth + S137 Bug 40 bracketDepth). Bug was downstream in `ast-builder.js` `_findEachOpenerEnd` (line 11119), which tracked ONLY brace+quote depth (NOT paren/bracket). The `>` inside `=>` sat at depth-0 (braces); the finder returned its index; opener was sliced at `<each in=@items.filter(c =`. Fix: extend `_findEachOpenerEnd` with `parenDepth` + `bracketDepth` tracking; opener `>` returned only when ALL FOUR depth counters are zero. +19/-2L single-file change.

**Latent sibling-finder bug class** surfaced by agent (filed as Bug 48): `_findMatchOpenerEnd` x2 (lines 10953 + 11871) + `_findOpenerEnd` (line 11562, machine/engine) all have same braces+quotes-only tracking. Not currently fired by adopter patterns (canonical `<match>`/`<engine>` openers don't carry inline arrows today).

**Regression test:** `compiler/tests/unit/each-in-arrow-r25-bug-37.test.js` +392L (NEW; 12 tests across 12 sections): minimal repro · multi-line arrow body · chained .filter().map() · `<each of=N.reduce(...)>` · workaround derived-cell still works · sibling `<button onclick={...}>` braced position works · composition with Bug 40 `:`-shorthand · array-index method-chain · nested parens. Tests: subset baseline 14,871 → 14,883 (+12, 0 fail).

- **Reproducer verification:**
  - BEFORE (HEAD `50d38095`): `const _items = _scrml_reactive_get("items").filter(c =;` — `node --check`: `SyntaxError`
  - AFTER (HEAD `1ce963d0`): `const _items = _scrml_reactive_get("items").filter(c => c.foo == 1);` — `node --check`: PASS
  - W-EACH-KEY-001 lint message also flipped from embedding the truncated opener to the full opener.
- **Spec reference:** SPEC §17.7 `<each in=expr>` — attribute-position expression now parses + emits per ordinary expression rules.
- **Cross-refs:** Bug 37 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-37-each-arrow-truncation-2026-05-27/BRIEF.md`; Bug 40 `50d38095` (adjacent BS-level fix touching `scanAttributes` — DIFFERENT function); Bug 48 latent sibling-finder class.

---

### Bug 38 — `!{}` arm body codegen failure (R24 Bug 29 family, DEEPER; distinct from Bug 36) — `RESOLVED S137 (commit 933d1ad3)` (was HIGH; R25; 4/4 devs)

Bug 29's narrow `{ return }` case was RESOLVED in S136 commit `c7e81962`. Bug 36 (RESOLVED S136 `e1269844`) was investigated for shared root by the R25-Bug-36 dispatch agent and CONFIRMED DISTINCT — Bug 36 was a function-decl-head parse-gap; Bug 38 was the call-site `!{}` handler emission gap in codegen. Different code path; not closed as Bug 36 side-effect.

R25 confirmed via 4/4 dev exposure + overseer verification: multi-line arm bodies, single-line collapsed arm bodies, and the `const r = call() !{...}` "workaround" all FAILED to produce arm codegen.

**Fix (S137 `933d1ad3`):** PA brief hypothesis confirmed correct (`emit-logic.ts` case `"guarded-expr"` `emitArmAssign` closure was the load-bearing site). The R24-BUG-2 (S136 `c7e81962`) extension closed the terminator-tail narrow case but didn't generalize — `emitArmAssign`'s "multi-line vs single-line" discriminator (`trimmed.includes("\n")`) was the right CONCEPT but wrong PROXY for "statement-shape vs value-shape" arm bodies. `rewriteBlockBody` joins multi-statement reactive-write bodies with `"; "` (no newline), so `{ @x = "v"; @y = 0 }` arm bodies arrived at `emitArmAssign` as a single-line string of two `;`-separated `_scrml_reactive_set(...)` calls and fell into the wrong wrap branch.

Two new branches added to `emitArmAssign`, ordered after R24-BUG-2's terminator-tail branch:
1. `stmts.length > 1` (multi-statement body): emit each stmt as bare indented statement; no `_result =` wrap.
2. `stmts.length === 1 && isStatementShapeStmt(stmts[0])` (single-stmt side-effect call): emit bare. NEW helper `isStatementShapeStmt` detects six known statement-emitting prefixes (`_scrml_reactive_set(`, `_scrml_engine_*(`, `_scrml_navigate(`, `_scrml_register_cleanup(`, `_scrml_effect(`, `_scrml_init_set(`).

Negative-control (value-producing arm bodies like `| _ -> "fallback"` / `| _ -> computeFallback(e)`) STILL wraps via the existing final `${resultVar} = ${bare};` fallthrough — verified by existing R24-BUG-2 §8 negative-control tests.

**Regression test:** `compiler/tests/unit/error-handler-arm-body-emission.test.js` +490L (NEW; 18 tests across §1-§12). R24-BUG-2 §7 expectations INVERTED — the pre-fix §7 tests were locking the BUG SHAPE (asserting the corrupt wrap); inverted to assert ABSENCE of corrupt wrap + PRESENCE of bare statements. Strictly stronger assertions. R24-BUG-2 §1-§6 + §8-§11 unchanged + still green.

**Reproducer verification (3 shapes):**
- Multi-line `{ @x = "missing"; @y = 0 }`: BEFORE `_scrml_result_5 = _scrml_reactive_set(...); _scrml_reactive_set(...);` → AFTER two clean indented stmts, no wrap. `node --check` EXIT=0; statement-boundary warning count = 0.
- Single-line `| ::Variant -> @x = 1`: BEFORE `_scrml_result_N = _scrml_reactive_set("x", 1);` → AFTER `_scrml_reactive_set("x", 1);`.
- `let r = ... !{...}` workaround: arm body emits clean bare stmts; trailing `var r = _result_N;` still emits + `r` binds to the original call's tagged-object.

- **Spec reference:** SPEC §19.5 call-site `!{}`; PRIMER §6 canonical multi-line shape.
- **Cross-refs:** Bug 38 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-38-guarded-expr-arm-body-2026-05-27/BRIEF.md`; R24 Bug 29 narrow RESOLVED `c7e81962`; Bug 36 RESOLVED `e1269844` (distinct root, confirmed); R24-BUG-2 dispatch BRIEF.md.

---

### Bug 39 — phantom enum-object → `el.textContent` wiring (no source backing) — `RESOLVED-AS-SIDE-EFFECT-OF-BUG-36 S136 (commit e1269844)` (was HIGH; R25; 2/4 devs independent)

**RESOLVED via Bug 36 fix.** The phantom `el.textContent = CreateError; el.textContent = MoveError; el.textContent = ArchiveError;` wiring was a SIDE EFFECT of Bug 36's parse failure — when the `! ErrorType` bare form failed to parse, the IDENT (`CreateError` etc.) was orphaned and collected as a bare-expr by `parseRecursiveBody`. The bare-expr was then auto-wired as a reactive-display expression on a `_scrml_logic_N` slot. With Bug 36 fixed, the IDENTs are properly absorbed as errorType annotations and the phantom wiring vanishes by construction.

**Reproducer-verification:** all 4 R25 devs: 0 phantom `el.textContent = <EnumType>` wirings in post-fix compiled output. Confirmed via grep on /tmp/r25-bug-36-verify/*.client.js.

- **Original symptom:** emitted client.js contained `el.textContent = CreateError; el.textContent = MoveError; el.textContent = ArchiveError;` on a `_scrml_logic_N` slot. Last-write-wins → DOM showed `[object Object]`.
- **Original cross-dev evidence:** dev-1-react + dev-2-elixir, independent sources, same compiler pattern (first 3 declared error-enum types).
- **Fix path:** Bug 36 RESOLVED → orphan-IDENT-as-bare-expr no longer occurs → phantom wiring no longer emitted.
- **Cross-refs:** Bug 39 in `gauntlet-r25-report.md`; resolution commit `e1269844` (Bug 36 fix); resolution surfaced in the R25-Bug-36 dispatch agent's final report (sister-finding to Bug 36 root-cause analysis).

---

### Bug 40 — `:`-shorthand inside `<each>` item body silently emits empty fragment — `RESOLVED S137 (commit 50d38095)` (was HIGH; R25)

`<each in=@list><span : @.field><empty>...</></each>` emitted an item factory that returned an empty `documentFragment.firstChild` (always `null`). No `span` element, no text content. Confirmed for `<empty : "string literal">` (Svelte dev-3, overseer-3). Affected dev-1's "all 7 `<each>` item factory bodies empty" finding (dev-1 also used `<li class="card" : @.title>` `:`-shorthand).

**Fix (S137 `50d38095`):** ROOT CAUSE WAS UPSTREAM OF EXPECTED. PA brief hypothesized a codegen bug in `emit-each.ts`; actual bug was a SPEC §4.14 BS-level compliance gap in `block-splitter.js` `scanAttributes` — the post-attribute `:` token was not recognized, so `<li : @.name>` was treated as an unclosed `<li>` opener; E-CTX-003 fired; opener was silently dropped per the existing `_subErrors`-discard convention in ast-builder.js:11307-11312. emit-each.ts then walked empty templateChildren and emitted an empty per-item factory body — the visible codegen failure was a downstream symptom, not the cause.

Three-file fix coupled with regression tests:
- `compiler/src/block-splitter.js` +168/-2L: NEW SPEC §4.14 BS-level `:`-shorthand body recognition in `scanAttributes`. Two emit-stamps (markup-shorthand + state-shorthand) + bracketDepth tracking + predecessor whitespace requirement (so `<Tag:expr>` no-space form correctly rejects). Caller paths (markup + state) emit leaf blocks with `closerForm:"shorthand"` + `shorthandBodyRaw` carrying the body text past the `:`.
- `compiler/src/ast-builder.js` +42/-2L: markup dispatch slices `block.raw` at the introducer for `tokenizeAttributes`; captures `shorthandBodyRaw` on the AST node.
- `compiler/src/codegen/emit-each.ts` +40/-3L: `renderTemplateChildToJs` prefers AST `shorthandBodyRaw` over the (now-empty) templateChildren walk. `renderEmptyChildToJs` handles `<empty : "literal">` shorthand by wiring the body as a textNode directly (no createElement — `<empty>` is a structural sub-element).
- `compiler/tests/unit/p3-follow-no-isComponent-routing.test.js` +1/-1L: block-splitter.js code-budget rebump 23 → 26 (3 new write-side stamps; in-file comment updated).

**`<empty : "literal">` sub-case** (overseer-3's separately-filed sub-finding) was the SAME root cause and SAME fix — BS-level recognition closes it by construction. 1 dedicated test (§8); existing each-block.test.js §5 empty-state coverage continues green.

**Regression test:** `compiler/tests/unit/each-colon-shorthand-r25-bug-40.test.js` +551L (NEW; 20 tests across 14 sections): minimal repro · `:`-shorthand with attribute (dev-1 `<li class="card" : @.title>` shape) · `<each of=N>` count form · multi-element bodies · positive controls (bare-body `${...}` regression-guard, `<empty>` bare-body) · `<empty : "literal">` fix · `as name` alias compose · `key=` inference compose. Tests: subset baseline 14,851 → 14,871 (+20, 0 fail).

**Reproducer verification:**
- BEFORE (HEAD `ebeba766`): item factory `(_scrml_each_item, _scrml_each_idx) => { const _itemFrag = ...; return _itemFrag.firstChild; }` (returns null — empty fragment)
- AFTER (HEAD `50d38095`): `... const _scrml_el_1 = document.createElement("li"); _scrml_el_1.textContent = String(_scrml_each_item.name); _itemFrag.appendChild(_scrml_el_1); return _itemFrag.firstChild;`
- `node --check` on emitted JS: PARSE OK.

**Pre-existing diagnostic-class drift (deferred):** `<Tag:expr>` (no whitespace before `:`) currently fires E-CTX-003 rather than the SPEC-prescribed E-PARSE-001 (§4.14). Out-of-scope; small-future ticket if friction surfaces.

- **Spec reference:** SPEC §4.14 `:`-shorthand body grammar (BS-level recognition was the gap); SPEC §17.7 iteration; PRIMER §6.3 canonical `<each>` shapes.
- **Cross-refs:** Bug 40 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-40-each-colon-shorthand-2026-05-27/BRIEF.md`.

---

### Bug 41 — `<schema>` block content leaks into HTML body as raw visible text — `RESOLVED S137 (commit ebeba766)` (was HIGH; R25)

dev-2-elixir's HTML output contained the raw text content of the `<schema>` block (`cards { ... } activity_log { ... }`) as visible body content. Schema content belongs to the DDL / migration artifact path (schemaFor walker, migration diff); NEVER the HTML render-tree.

**Fix (S137 `ebeba766`):** Agent's grep-driven triage (S136 banked methodology) NARROWED the brief's hypothesis. Brief speculated "exclude <schema> (and probably <channel>, <auth>, etc. — full structural-element registry exclusion)"; actual fix is surgical TWO-element exclusion. Sibling structural-elements cross-verified:

| Element | Status |
|---|---|
| `<schema>` | LEAKING — FIXED this dispatch |
| `<seeds>` | same state-block path; pre-emptively excluded (defense-in-depth; no live repro) |
| `<engine>` | CLEAN — routes to engine-decl AST kind upstream |
| `<machine>` | CLEAN — normalized to engine before state-kind branch |
| `<db>` | CLEAN — body is canonically `${...}` logic context |
| `<channel>` | CLEAN — explicit tag handler at emit-html.ts:1078 |
| `<auth>` | CLEAN — sub-page role-gate; composite emission |
| `<errors>` | CLEAN — explicit tag handler at emit-html.ts:750 |
| `<onTransition>`/`<onTimeout>`/`<onIdle>` | engine state-children — not document-root structural at HTML emit time |

Brief's broader-list speculation would have been over-fix. Banked: trust grep over hypothesis (S136 lesson held).

`compiler/src/codegen/emit-html.ts` +28L: NEW constant `SERVER_ONLY_STATE_TYPES = new Set(["schema", "seeds"])` + early-return guard in `node.kind === "state"` branch reading `node.stateType`. Without the guard, the state-kind branch unconditionally walked children → text-kind branch dumped raw DDL identifiers into rendered HTML. Comment block above the constant enumerates why `<db>`/`<engine>`/`<machine>` are NOT in the set (route through other AST kinds before this branch).

**Regression test:** `compiler/tests/unit/schema-html-leak-r25-bug-41.test.js` +451L (NEW; 18 tests across §1-§8): minimal repro (DDL identifiers absent from emitted HTML) · multi-table schema · positional invariants (`<schema>` before vs after `<page>`) · multi-page exclusion · positive controls (`<page>` body text PRESENT — regression-guard against accidental over-exclusion) · sibling-element controls (`<engine>` / `<db>` still handled via their own paths) · `<seeds>` defense-in-depth.

**Reproducer verification:**
- BEFORE (HEAD `933d1ad3`): emitted HTML body contains `cards { id: integer primary key, title: text not null }` as visible prose alongside `<h1>Hello World</h1>`.
- AFTER (HEAD `ebeba766`): emitted HTML body contains ONLY `<h1>Hello World</h1>`.
- Grep on DDL identifiers (`primary key`, `text not null`, `cards {`) — ZERO matches in HTML AND zero in client.js. Schema DDL emission via schemaFor / migration path unaffected.

- **Spec reference:** SPEC §11 schema declarations; SPEC §39 schema + migrations.
- **Cross-refs:** Bug 41 in `gauntlet-r25-report.md`; agent dispatch BRIEF.md at `docs/changes/r25-bug-41-schema-html-leak-2026-05-27/BRIEF.md`.

---

### R24-BUG-4 (cross-ref) — `<match>` block-form `</>` closer rejected with E-CTX-001 — `Phase 5 SCOPING-tracked; HIGH adopter impact`

dev-3-svelte (R24) wrote fully spec-compliant source per SPEC §4.4.2 (`</>` SHALL close innermost open tag — no exceptions) for the `<match for=Type on=val>...</>` block-form. Compiler rejected with `E-CTX-001: Unclosed <match> structural element. Expected explicit close tag '</match>'. The '</>' unambiguous-closer form is not yet supported for <match> at Phase 2 baseline.` PRIMER §6.2 + worked examples use `</>`; the gap is compiler-side, not source-side. dev-3 was the best-case adopter in R24 and got killed by this gap alone.

- **Tracker:** `docs/changes/match-block-form-scoping/SCOPING.md` Phase 5 (already filed; not a new bug entry).
- **R24 escalation:** elevate to HIGH adopter-impact priority — the canon-correct closer was rejected on the cleanest dev's first attempt. Land the Phase 5 work OR update PRIMER §6.2 to show `</match>` as the canon closer until Phase 5 ships.
- **Cross-refs:** R24-BUG-4 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`.

---

### Bug 49 — BS-level statement-boundary detection silently drops `const X = call() !{...}` arm content — `HIGH` (S137 R26 verification surfaced; UPSTREAM of Bug 38 codegen fix)

**R26 verification round (S137)** re-ran all 4 R25 dev .scrml sources on the post-cluster baseline `1a06f739` to verify the Bug 38/40/41/37 closures held empirically. Bug 41 / Bug 40 / Bug 37 verified CLEAN end-to-end (Bug 41: dev-2 HTML 0 DDL identifiers; Bug 40: all 4 devs all `<each>` factories populated 7+6+6+5; Bug 37: `node --check` clean on all 4 devs). **Bug 38 partially held — codegen-reachable cases CLOSED, but a DISTINCT UPSTREAM BS-level gap surfaced that drops the `const X = call() !{...}` workaround form's arm content before AST construction.**

The Bug 38 dispatch's regression tests synthesized the AST directly + ran codegen — verifying the `emitArmAssign` extension on Reproducer 3 (`let r = ...` value-binding form). That worked at codegen level. But empirically, the BS layer (block-splitter / statement-boundary detection) does NOT correctly handle the `const X = call() !{...}` shape — it emits `[scrml] warning: statement boundary not detected — trailing content would be silently dropped` and the arm bodies never reach the AST, never reach codegen, and never get emitted. The emitted JS for `const created = createCard(...) !{ | ::DbError(msg) -> { @searchTerm = msg } | ::Validation -> { @searchTerm = "validation" } }` is just `const created = _scrml_fetch_createCard(...)`. with NO arm handlers.

R26 reproducer counts (post-cluster baseline `1a06f739`):
- dev-1-react: **3** residual `const X = call() !{...}` sites (createCard / moveCard / archiveCard handlers — all the `const X = ... !{...}` form)
- dev-2-elixir: **3** residual same shape (moveCard ×2 / archiveCard with `const r = ...` form)
- dev-3-svelte: 0 (didn't use `const X = ... !{...}` form)
- dev-4-pascal: 0 (didn't use)

Both dev-1 + dev-2 used the SAME idiomatic shape:
```scrml
function handleCreate(values) {
    const created = createCard(values.title, ..., values.priority) !{
        | ::DbError(msg) -> { @searchTerm = msg }
        | ::Validation   -> { @searchTerm = "validation" }
    }
    @cards = [...@cards, created]
}
```

The `const r = call() !{...}` shape IS shown in PRIMER §6 + kickstarter — it's not just an obscure adopter reach. dev-2-elixir noted in their R25 report (line 347): *"primer §6 shows `let result = call() !{ | ::E -> ... }` — kickstarter shows `const rows = call() !{ ... }` — both BIND the result."* Canon-confirmed shape.

**Methodology lesson banked (R26 finding):** unit-test regression suites that synthesize AST and run codegen will MISS upstream BS-level bugs. Empirical-reproducer verification (recompile real .scrml source files + check output) is necessary, not sufficient-by-unit-tests-alone. This is the canary-metric-class lesson (`feedback_canary_metric_class_lesson.md`, S124) in compiler-fix shape: regression-tests passing ≠ empirical-reproducer passing. R26 is the empirical-canary that catches what unit tests miss.

- **Reproducer (minimal):**
  ```scrml
  type ErrType:enum = { NetworkError, Validation }

  server function risky() ! ErrType {
      fail ErrType::NetworkError
  }

  function caller() {
      const r = risky() !{
          | ::NetworkError -> { @msg = "net" }
          | ::Validation   -> { @msg = "validation" }
      }
  }
  ```
  Pre-fix: BS warns `statement boundary not detected`; emitted JS has `const r = _scrml_fetch_risky_N();` with NO arm bodies.

- **Workaround:** use bare-call shape WITHOUT `const X =` binding when arm bodies don't need the result-value:
  ```scrml
  risky() !{
      | ::NetworkError -> { @msg = "net" }
      | ::Validation   -> { @msg = "validation" }
  }
  ```
  Per Bug 38 fix `933d1ad3`, this shape emits arm bodies correctly (BS recognizes the bare-call-as-statement form). The PROBLEM is specifically the `const X = ...` value-binding form.

- **Spec reference:** SPEC §19.5 call-site `!{}`; PRIMER §6 canonical multi-line + value-binding shape; kickstarter §error-handling.

- **Root cause hypothesis (verify):** the BS statement-boundary detector reads `const r = call()` as a complete statement and treats the following `!{...}` as orphaned content that gets silently dropped. The BS layer needs to recognize `const X = ANY_EXPR !{...}` as ONE statement where `!{...}` is part of the right-hand-side expression. May involve BS's `scanStatement` / `scanExpression` lookahead being unaware that `!{` extends an expression rather than terminating it.

- **Suggested fix scope:** BS-layer statement-boundary detector — make the `!{...}` token NOT terminate a `const X = ...` initializer expression. Same site has been touched by Bug 36 fix (function-decl-head bare-form) and Bug 40 fix (`:`-shorthand recognition); this is a sibling fix in the same BS region.

- **Cross-refs:** Bug 38 codegen fix RESOLVED `933d1ad3` (closes call-reachable arm-body cases); Bug 36 RESOLVED `e1269844` (sibling parser-side bare-form fix); Bug 40 RESOLVED `50d38095` (sibling BS-level §4.14 fix); R25 gauntlet report dev-2-elixir lines 343-347 ("`!{}` after assignment doesn't compile" — explicit canon-cited reach); R26 verification artifacts at `/tmp/r26-verify/` (this session).

---

## §2 MED — silent acceptance / incomplete surfaces

### A5 refinement-type freeze extension — `DEFERRED with adoption-watch trigger` (S134)

The `const <state>` deep-freeze debate (S134) ratified a **sequenced** verdict: A4 (close the L21 walker alias-escape gap) lands NOW; A5 (refinement-type `object(frozen(deep))` extension that emits `Object.freeze` at the JS-host boundary) DEFERS until adopter friction confirms the boundary-zone enforcement is needed.

- **Reproducer (theoretical, not yet adopter-reported):** a scrml object handed across a JS-host boundary (`_{}` foreign code, Web Worker `postMessage`, MCP tool output) can be mutated by the receiving JS code; scrml's L21 compile-time check doesn't survive the boundary because the receiver is JS and doesn't run the scrml compiler.
- **Workaround:** adopters who need defense-in-depth at the JS-host boundary can manually `Object.freeze(...)` before passing values across; the stdlib could expose a `deepFreeze` utility if friction surfaces.
- **Watch trigger:** **≥2 adopter reports of JS-host boundary mutation post-A4** re-opens the A5 dispatch. On trigger, the design approach is the DD's A5 specification (refinement-type predicate extension; emits `Object.freeze` only at the boundary zone; reuses existing §53 three-zone enforcement).
- **What does NOT trigger A5:** internal alias-escape (closed by A4). A3 (Vue-style cell-decl modifier) is permanently rejected per the debate — zero expert votes; creates a parallel classification path beside §53 that the design rule explicitly rejects.
- **Authority:** debate insight at `~/.claude/design-insights.md` ("const <state> deep-freeze — roc-expert vs clojure-expert vs simplicity-defender vs security-expert — 2026-05-26"). HU at `docs/heads-up/const-deep-freeze-2026-05-26.md` (status: ratified). DD at `scrml-support/docs/deep-dives/const-deep-freeze-2026-05-26.md` (1296L).

---


### Bug 1 — Tailwind arbitrary-value classes — `partial-impl` (remaining: ring-offset + gradient + safelist + string-shaped)

Major families shipped S108-S109: grid / flex / aspect / transition / timing / individual transforms + shorthand + directional / outline / ring (length/color/var/keyword). The `W-TAILWIND-UNRECOGNIZED-CLASS` floor lint catches typos + unsupported arbitrary-values today.

**Still open:**
- **`ring-offset-*`** + **`bg-gradient-*` / `from-*` / `to-*` / `via-*`** — require Tailwind's preflight `*, ::before, ::after` custom-property layer (`--tw-ring-offset-shadow` / `--tw-ring-shadow` / `--tw-gradient-stops`). scrml has no preflight CSS emission infrastructure.
- **String-shaped arbitrary values** — `content-["text"]` + `font-[Inter]` need bracket-parser extension.
- **Safelist / `@apply`** — to distinguish custom user-defined classes from typos so the lint is precise on mixed Tailwind+custom-CSS codebases.

- **Workaround:** drop a `#{}` CSS shim block with the rules written by hand.
- **Status:** preflight blocker is the load-bearing piece; ring-offset + gradient unblock together when preflight infrastructure lands. Filed S108-S109; queued.

---

### Bug 12 — V-kill READ-side fire — `deferred`

S123 V-kill landed write-side enforcement (`@x = expr` at default-logic body-top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`). The READ-side fire (rejecting bare `@x` reads against undeclared cells inside `${...}` bodies) is deferred — the engine var-name canonicalization machinery is the unblocker.

- **Workaround:** declare all cells structurally with `<x> = init` before reading via `@x` in `${...}` bodies (which is the canonical V5-strict pattern anyway; the workaround IS the correct usage).
- **Status:** deferred S123; engine var-name canonicalization unblocks. Not adopter-visible if V5-strict patterns are followed; only surfaces if adopter typos `@x` against a name that doesn't have a `<x>` decl.

---

### Bug 13 — E-SCHEMA-003 enforcement — `spec'd` (no fire site)

S130 HU-2 Q7 ratified `<schema>` placement as immediate child of `<program>` (per F-019). SPEC §34 E-SCHEMA-003 catalog row updated S130. The compiler currently has NO fire site for E-SCHEMA-003 — a misplaced `<schema>` block compiles clean and emits unexpected SQL/runtime behavior instead of the loud compile error the SPEC promises.

- **Workaround:** verify `<schema>` is an immediate child of `<program>` at write-time; if you see runtime SQL anomalies in mixed-placement projects, check schema placement first.
- **Status:** flagged at S130 HU-2 Q7 as Phase 2 implementation follow-on. Filed; not yet dispatched.

---

### Bug 14 — MCP V0 partial-impl + deferred items — `partial-impl`

MCP V0 sub-units A+B+C+D shipped S125-S130. V0.E (E2E + adopter docs + fixture multi-page app) pending. V0.D (this session S130) has 3 deferred items that limit current capability:

1. **Runtime-helper registration on globalThis** — today's boot reads `globalThis._scrml_reactive_get` which is never set (runtime is module-scoped per generated `.server.js`). Tool resolvers gracefully degrade for V0 (descriptor sidecars carry topology data; runtime cell reads return undefined).
2. **`scrml dev` (in-process Bun.serve)** gets NO MCP wiring — boot lives only in build-time `_server.js`. Use `scrml build` + run the server entry to get MCP working in dev.
3. **"dev-only" semantics use RUNTIME NODE_ENV gate** (not compile-time) — no §58 Build Story hook exists yet; revisit when §58 implementation lands.

- **Workaround:** for V0.E specifically, no workaround — the adopter setup doc + E2E examples don't exist. For deferred items: use `<program mcp="always">` to override the dev-only gate; build via `scrml build` not `scrml dev`.
- **Status:** V0.E queued (~10-12h per SCOPING §3.E). Deferred items revisit at §58 land.

---

### Bug 16 — Generator policy — `open` (S114)

`yield` / `yield*` / `function*` are NOT covered by the S114 "no async/await" rule (preserved in the JS-subset bound at M4.3 per S114). Semantic policy is open: do generators belong in scrml, and if so under what discipline (compiler-managed iteration vs user-authored protocol)?

- **Workaround:** use generators if needed; they parse. Compiler doesn't generate diagnostic surface around them either way.
- **Status:** open. Filed S114; not dispatched.

---

### Bug 17 — L19 multi-statement-handler relaxation — `queued for HU`

L19 forbids multi-statement event handlers (`onclick=` must be a single expression, not a multi-statement block). The rule was ratified pre-engines; engines + body-split CPS may have changed the design constraints. Carry-forward question: should L19 relax under modern scrml composition?

- **Workaround:** wrap multi-statement handlers in a named function (`function handle() { ... }; <button onclick=handle()>`).
- **Status:** open HU follow-on; small enough to fold into iteration HU or its own sub-session.

---

### Bug 30 — Linter scans content inside `<!-- -->` HTML comment blocks — `MED` (S136 R24)

The lint pass fires `W-LINT-001` / `W-LINT-005` / `W-LINT-007` / `W-LINT-011` / `W-LINT-014` / `W-LINT-022` on text appearing inside HTML comment blocks (`<!-- ... -->`). Surfaced by dev-2, dev-3, dev-4 overseers in R24 — every dev's friction-report comment block (which contains anti-pattern words like `===`, `<style>`, `.map()`, `{#if}` for comparison purposes) tripped multiple lints.

- **Reproducer:** any `.scrml` file containing `<!-- comment with === or .map() text -->`; lints fire on the comment-internal content.
- **Spec reference:** SPEC §27 — comment content is opaque to all stages.
- **Current behavior:** linter walks text without comment-region awareness.
- **Expected behavior:** skip lint scanning inside `<!-- -->` regions.
- **Suggested fix scope:** linter — add comment-region awareness to the lint scanner. Single-file fix in lint pass.
- **Cross-refs:** R24-BUG-3 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`.

---

### Bug 31 — `if`-statement-as-expression in `!{}` result binding produces invalid JS — `MED` (S136 R24)

A function body containing `if (cond) return` immediately followed by a `failableCall() !{...}` causes codegen to bind the entire sequence as `let _result = if (cond) { return fn(); }` — an `if` statement in expression position, which is a JS SyntaxError. Narrow but adopter-encounterable.

- **Reproducer:** dev-1-react's `function load() { if (!@searchTerm) return; const r = fetchItems() !{ ... }; }` surfaces this.
- **Spec reference:** SPEC §19.4 (failable function + handler contract) + §17 (control flow).
- **Current behavior:** codegen wraps the early-return `if` into the `_result` binding.
- **Expected behavior:** treat the early-return `if` as a separate statement; the `_result` binding scope begins AFTER it.
- **Suggested fix scope:** codegen — result-binding scope semantics in failable-handler-result lowering.
- **Cross-refs:** R24-BUG-5 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`.

---

### Bug 32 — `@.` iteration sigil not lowered inside `<tableFor>` column slot body — `MED` (S136 R24)

A `<column field="status" :let={(row) => <span>${@.status}...}/>` inside a `<tableFor for=T rows=@cell>` block emits `@ . status` unlowered into the client JS — the iteration-scope binding doesn't reach into the L22 column slot. Surfaced by dev-1-react overseer.

- **Reproducer:** dev-1-react's `tableFor` column slot uses `${@.}` to access the per-row binding; emitted JS contains literal `@` token.
- **Spec reference:** SPEC §17 (`@.` iteration semantics) + §41.16.3 (`tableFor` column slot grammar).
- **Current behavior:** iteration-scope binding pass doesn't recognize the L22 column slot as an iteration locus.
- **Expected behavior:** `@.` inside `<column :let={(row) => ...}>` lowers to the iteration-bound row.
- **Suggested fix scope:** codegen — iteration-scope binding inside L22 column slot context.
- **Cross-refs:** R24-BUG-6 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`.

---

### Bug 35 — `rewriteIsPredicates` in `preprocessForAcorn` fails on BS-tokenizer space-padded dots — `MED` (S136 R24-BUG-1 triage finding)

When the BS tokenizer space-pads dot tokens (`@x is . All` vs the canonical `@x is .All`), `rewriteIsPredicates` in `compiler/src/expression-parser.ts:preprocessForAcorn` FAILS to recognize the `is`-predicate. This forces the entire expression through the string-rewrite fallback path (which is the only reason R24-BUG-1 was visible in dev-1-react.scrml's filter callback). Surfaced as a deferred item during the R24-BUG-1 dispatch agent triage (a76e86b1c2b94ea00).

- **Reproducer (direct AST probe):**
  - `parseExprToNode("@x is . All", "test.scrml", 0)` returns `{kind: "ident"}` (only `@x` parsed; `is . All` lost)
  - `parseExprToNode("@x is .All", ...)` returns `{kind: "binary", op: "is"}` (correctly parsed)
- **Asymmetric behavior:** `rewriteIsOperator` STRING pass at `compiler/src/codegen/rewrite.ts:561-562` DOES handle the `\s*` between `.` and variant via tolerant regex — only the `preprocessForAcorn` AST-path is broken.
- **Spec reference:** SPEC §3 + §4.4 — whitespace inside `is .Variant` predicate forms should be tolerated symmetrically across both pipeline paths (AST-emit + string-rewrite).
- **Current behavior:** AST-emit path silently drops `is .Variant` predicate when dot is space-padded; codegen falls through to string-rewrite (which works) — so adopters see correct emitted JS BUT pay a perf cost from the path switch + lose AST-side optimization opportunities.
- **Expected behavior:** `rewriteIsPredicates` regex should tolerate `\s*` between `.` and variant identifier (mirroring the string-rewrite pass).
- **Suggested fix scope:** single-file regex tweak in `compiler/src/expression-parser.ts` `rewriteIsPredicates`. Likely <10 lines.
- **Adopter impact:** none observable (correct JS still emits via fallback); compiler-internal performance + AST-path completeness gap only.
- **Cross-refs:** surfaced by agent dispatch `a76e86b1c2b94ea00` (R24-BUG-1 landing); recorded in dispatch's final-report DEFERRED_ITEMS #2.

---

### Bug 42 — `?{}` SQL in `server function*` SSE generator body not lowered (E-CG-006 misclassified) — `MED` (S136 R25)

The compiler treats `server function*` (SSE generator) body as client-side context for `?{}` lowering. dev-1 + dev-2 emit raw `? { \`SELECT...\` } . all ( )` tokens (tokenized but not lowered). dev-4 emits `null` with the comment `// SQL-init for x — client cannot evaluate _scrml_sql (E-CG-006); use a server function`. The classification is wrong — SSE generator body runs server-side (it IS a `server function*`), so `?{}` should lower per server-fn semantics.

- **Reproducer:** `server function* watchActivity() { while (true) { yield ?{`SELECT * FROM activity_log WHERE id > ${@cursor}`}.all() } }` — emits raw `?{...}` tokens or `null` + E-CG-006.
- **Spec reference:** SPEC §37 SSE / `server function*`; SPEC §13 `?{}` query expressions.
- **Current behavior:** SSE generator body treated as client context; `?{}` either un-lowered or rejected with E-CG-006.
- **Expected behavior:** `server function*` body shares server-context lowering with `server function`; `?{}` lowers to runtime SQL invocation.
- **Suggested fix scope:** server-context classification — `server function*` should join `server function` in the server-context set for codegen passes.
- **Cross-refs:** Bug 42 in `gauntlet-r25-report.md`.

---

### Bug 43 — Linter scans HTML comment content — `DUPLICATE OF BUG 30 (S136 R24)` — `MED`

R25 surfaced this independently (dev-3 / overseer-3). Already filed as Bug 30 in S136 R24 intake. No new entry needed; cross-reference for the R25 confirming evidence:

- **R25 confirming evidence:** dev-3-svelte's friction report — 14 W-TAILWIND-UNRECOGNIZED-CLASS / W-LINT-007 / W-LINT-004 / W-LINT-014 fires were all on text inside `<!-- FRICTION REPORT -->` comment block; dev's "remove class attributes" workaround was a response to false signal.
- **Cross-refs:** Bug 30 (S136 R24 entry; primary record); Bug 43 in `gauntlet-r25-report.md` (R25 confirming cross-dev evidence).

---

### Bug 44 — W-LINT-007 false-positive on `fallback={<markup/>}` (SPEC §19.6 canonical errorBoundary shape) — `MED` (S136 R25)

SPEC §19.6.2 specifies `<errorBoundary fallback={<markup/>}>` as canonical (braces required for markup-valued attribute). W-LINT-007 ghost-pattern lint fires on this shape claiming "scrml uses `<Comp prop=val>`" — treating it as a JSX `{val}` braces-in-attribute pattern. The only-working `<errorBoundary>` shape is lint-flagged as an anti-pattern. Confirmed by dev-3-svelte, dev-4-pascal, and overseer-4.

- **Reproducer:** `<errorBoundary fallback={<div>Something went wrong/}><Inner/></errorBoundary>` — fires W-LINT-007.
- **Spec reference:** SPEC §19.6.2 (`<errorBoundary fallback={<markup/>}>` canonical form).
- **Composition with R24 step-3b (deferred):** the canon-drift between PRIMER §6.8 `renders=.Fallback` + sibling and SPEC §19.6 `fallback={<markup/>}` is STILL UNRESOLVED. R25 confirmed that PRIMER form errors at attribute parse AND SPEC form fires W-LINT-007 false-positive — the only-working shape is lint-flagged as anti-pattern.
- **Suggested fix scope:** narrow the `:`-prefixed-binding / `{val}`-in-attribute ghost-pattern lint to exclude SPEC-canonical markup-valued attributes. Linter pass file.
- **Cross-refs:** Bug 44 in `gauntlet-r25-report.md`; R24 step-3b deferred direction call (PRIMER vs SPEC errorBoundary shape) — recommend resolving direction = SPEC form WITH Bug 44 fixed so it doesn't lint-flag the canonical shape.

---

## §3 LOW — ergonomic / cosmetic

### Bug 4 — Bare `/` in markup-text body parses as element closer — `spec'd`

The `?{` half closed S108 via Approach C-narrow (markup-text-mode locus gate per SPEC §3.1 + §8.1). Bare `/` half remains open. Writing scrml-about-scrml prose where `/` appears in text (e.g., "`""` / `0` / `[]` are all defined values") can still confuse the BS-layer's `looksLikeCloser` heuristic in edge cases.

- **Workaround:** entity-encode (`&#47;`) when `/` appears at scrml-content-as-data positions in prose.
- **Status:** Q-BUG4-OPEN-5 in deep-dive `scrml-support/docs/deep-dives/bug-4-docs-mode-escape-2026-05-19.md`; broad-C extension if friction surfaces beyond the single dogfood citation.

---

### Bug 18 — GITI-015 — `queued`

LOW-severity adopter bug filed by giti per S124 carry-forward. Details in `handOffs/incoming/read/`. Queued; not currently in implementation.

---

### Bug 19 — §11-folded-citation sweep — `cosmetic`

5 dev.to articles cite SPEC `§11` for `<db>` / `protect=` / state-authority content. §11 is folded (content distributed to §6.12 + §52 per SPEC-INDEX row 44). The E-codes those articles cite are correct; only the bare section number is stale. Lowest-priority cleanup item.

- **Workaround:** none needed; the articles' E-code citations still resolve.
- **Status:** filed S115 article-truthfulness audit §3.4; safe to fold into any future article edit pass; not dispatched separately.

---

### Bug 20 — `bun scrml promote --engine` (Tier-1→2 sibling) — `deferred`

The `bun scrml promote --match` CLI shipped S66 (Tier-0→1 lift mechanical). The companion `--engine` flag (Tier-1→2 lift) is deferred — it pairs with `W-MATCH-TRANSITIONS-ACCRUING`, a sibling lint that needs its own §34 catalog + implementation groundwork. The CLI flag stays registered but prints a clear "deferred" message until that lands.

- **Workaround:** manual conversion from `<match for=Type>` block-form to `<engine for=Type initial=.Variant>` — state-children carry forward verbatim; add `initial=` + per-arm `rule=`.
- **Status:** deferred; queued post-W-MATCH-TRANSITIONS-ACCRUING.

---

### Bug 21 — Q6-narrow heuristic: deep multi-level reset on nested compound — `heuristic` (S135)

`reset(@a.b.c)` where `b` is itself a compound state with its own lifecycle-annotated fields: Q6-narrow's `applyResetToCellField` walker conservatively uses `fieldPath[0]` — the first hop after the cell root — for tracker classification. The §6.8.2 B22 ratification supports deeper compound-nav targets, but the canonical scrml idiom is one hop deep (per the §6.8.2 worked examples). Deeper nesting works at runtime via the existing `_scrml_reset` codegen; only the per-access tracker's state revert is shallow.

- **Workaround:** none needed for canonical idiom; if deeper resets are exercised, the tracker may miss a lifecycle revert on the deeper field but the runtime behavior is correct.
- **Status:** filed S135 in Q6-narrow progress.md follow-ups; extend on real adopter friction.
- **Cross-refs:** SPEC §6.8.2 (multi-level compound-nav, B22 ratification); SPEC §6.8.3 (Q6-narrow impl); `docs/changes/q6-narrow-reset-lifecycle-2026-05-26/progress.md`.

---

### Bug 22 — Q6-narrow heuristic: cross-cell `default=@otherCell` reset value classification — `heuristic` (S135)

`<state default=@otherCell>: (not to User) = not` — when `reset(@state)` evaluates `@otherCell` as the reset value, `classifyResetValueAgainstSpec` heuristically treats any non-`not` text as post-type for presence-progression. If `@otherCell` is itself in a pre-state at the reset moment, the heuristic misclassifies. The actual cross-cell type-check happens at the assignment site (`@state = @otherCell` would route through `classifyWriteAgainstSpec` properly); the heuristic only affects whether the per-access tracker reverts vs maintains state immediately after the reset.

- **Workaround:** none needed in practice; the cross-cell scenario is uncommon and the type-check at the assignment site catches real type errors.
- **Status:** filed S135 in Q6-narrow progress.md follow-ups; extend when adopters exercise cross-cell defaults under lifecycle annotations.
- **Cross-refs:** SPEC §6.8.1 (`default=` attribute); SPEC §6.8.3 (Q6-narrow impl); `docs/changes/q6-narrow-reset-lifecycle-2026-05-26/progress.md`.

---

### Bug 23 — Lifecycle source-form follow-up: W-LIFECYCLE-LEGACY-ARROW not emitted for Shape 1 cells — `heuristic` (S135)

The legacy-arrow lint (`W-LIFECYCLE-LEGACY-ARROW`, advising migration from `->` to `to` glyph in lifecycle annotations) fires today only on struct-field positions where the legacy glyph appears in struct-body lifecycle declarations. Shape 1 cell-typed lifecycle annotations (`<phase>: (.Draft -> .Published) = ...`) parse via `findTopLevelArrow` but do not emit the lint when the legacy glyph is used. The S135 source-form follow-ups landing (`a7167b6b` Fix #1) added whitespace tolerance to `findTopLevelArrow` but didn't extend lint-emission to the Shape 1 site.

- **Workaround:** prefer the canonical `to` glyph from the start; if you have a legacy `->` in a Shape 1 lifecycle annotation, the tracker still recognizes it (per `findTopLevelArrow`) but you won't get the migration nudge.
- **Status:** filed S135 in lifecycle-source-form-followups progress.md; extend on real adopter friction.
- **Cross-refs:** SPEC §14.12.4 (`(A to B)` glyph; `->` is legacy with W-LIFECYCLE-LEGACY-ARROW); `docs/changes/lifecycle-source-form-followups-2026-05-26/progress.md`.

---

### Bug 24 — Lifecycle source-form follow-up: qualified-form discrim regex tolerance — `heuristic` (S135)

The discrimination walker (`checkLifecycleBindingAccess`) recognizes bare-dot variant form `if (X is .Variant)` for advancing per-access state to "post." It does NOT recognize the qualified form `if (X is Article.Draft)` — the regex matches only `.Variant` patterns. Adopters using the qualified form for discrimination won't get the tracker's "post" advance and will see spurious E-TYPE-001 fires after the discrimination branch.

- **Workaround:** use bare-dot form in discrimination expressions (`if (@phase is .Draft)`) — equivalent to qualified per §14.10 bare-variant inference (M9).
- **Status:** filed S135 in lifecycle-source-form-followups progress.md; close on real adopter friction.
- **Cross-refs:** SPEC §14.10 (bare-variant inference); SPEC §14.12.6 (discrimination forms); `docs/changes/lifecycle-source-form-followups-2026-05-26/progress.md`.

---

### Bug 25 — Lifecycle source-form follow-up: `transition()` with deeper expressions — `heuristic` (S135)

`TRANSITION_CALL_RE` matches single-identifier arguments only — `transition(phase)`, `transition(@phase)` (S135 fix). It does NOT match deeper expressions like `transition(@u.field)` or `transition(items[0])`. Adopters using compound-nav target expressions in transition calls won't get the tracker's state advance.

- **Workaround:** factor the target into a local binding first: `let p = @u.field; transition(p)` (caveat: this changes semantics depending on the surrounding scope; works in many cases but not all).
- **Status:** filed S135 in lifecycle-source-form-followups progress.md; extend on real adopter friction. Canonical scrml usage today is single-identifier transition targets.
- **Cross-refs:** SPEC §14.12.6 (transition forms); `docs/changes/lifecycle-source-form-followups-2026-05-26/progress.md`.

---

### Bug 26 — `${...}` inside `function probe() { ... }` body emits E-SCOPE-001 for `$` — `LOW` (S135)

A `${...}` block placed inside a bare `function name() { ... }` body emits an unexpected `E-SCOPE-001` diagnostic for the leading `$` character. The `${` token gets preprocessed differently inside function bodies vs at structural positions. Unrelated to the silent-swallow class that S135 structural-in-logic landing closed — surfaced as a Phase 0 probe side-finding.

- **Workaround:** don't nest `${...}` inside a bare `function` body — use `${...}` at structural positions (inside `<program>`, `<page>`, etc.), or use bare statements inside the function body (no `${...}` wrapper needed since the function body is already in code-context).
- **Status:** filed S135 in structural-in-logic progress.md; orthogonal to silent-swallow class. Extend on real adopter friction.
- **Cross-refs:** `docs/changes/structural-in-logic-body-2026-05-26/progress.md`.

---

### Bug 27 — `tryParseStructuralDecl` extra lookahead on structural-element compound forms — `cleanup` (S135)

`tryParseStructuralDecl` enters the compound-state-decl branch when it sees `<schema><users>...` (treating it as a potential compound state-decl with field `users`), then rewinds when the child `<users>` doesn't have an `=` RHS. Works correctly (the rewind handles it; the parent eventually emits `E-STRUCTURAL-ELEMENT-MISPLACED` per the S135 structural-in-logic fix) but does extra lookahead work that could be short-circuited by checking the leading-tag name against the structural-element registry FIRST.

- **Workaround:** none needed — current behavior is correct; only the lookahead cost is wasted.
- **Status:** filed S135 in structural-in-logic progress.md as a cleanup opportunity. Not a bug. Extend on parser-performance signal.
- **Cross-refs:** `docs/changes/structural-in-logic-body-2026-05-26/progress.md`.

---

### Bug 33 — W-LINT-011 false positive on `:let={}` slot-binding shape — `LOW` (S136 R24)

`W-LINT-011` flags `:let={(row) => ...}` (the canonical `<column>` slot-binding shape per SPEC §41.16.3 + §16.6) as Vue-style `:`-prefixed binding. The pattern-matcher distinguishes `:let=` insufficiently from `:disabled=` / `:value=` etc.

- **Workaround:** none — lint is noise; valid syntax.
- **Status:** lint noise only; doesn't block compile.
- **Spec reference:** SPEC §41.16.3 + §16.6 (`tableFor` column slot grammar with `:let=` row binding).
- **Suggested fix scope:** linter — narrow the `:VAR=` Vue-shape pattern to exclude `:let=` (and any other reserved scrml `:`-prefixed slot-binding forms).
- **Cross-refs:** R24-BUG-7 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`.

---

### Bug 34 — Shape-2 compound markup-init emits empty 2nd arg to `_scrml_reactive_set` — `LOW` (S136 R24)

A Shape-2 compound state cell like `<form><title>= <input type="text"/></form>` (compound with markup init on a field) emits `_scrml_reactive_set("newTicketForm.title", )` — the 2nd argument is empty. Surfaced by dev-4-pascal overseer.

- **Reproducer:** in dev-4-pascal.scrml — Shape-2 compound `<newTicketForm>` with markup-init fields.
- **Spec reference:** SPEC §6.2 Shape 2 (decl-coupled-with-render-spec) — the init value should be the bind-source for the input.
- **Current behavior:** Shape-2 compound init handler doesn't pass the render-spec init value through.
- **Expected behavior:** the markup init value is the bind-source; emit `_scrml_reactive_set("newTicketForm.title", "")` (or the appropriate init).
- **Suggested fix scope:** codegen — Shape-2 compound init handler.
- **Cross-refs:** R24-BUG-8 in `scrml-support/docs/gauntlets/gauntlet-r24-report.md`.

---

### Bug 45 — `int` ghost type silently resolves to `asIs` (causes downstream `E-SCHEMAFOR-NO-SQL-MAPPING`) — `LOW` (S136 R25; 4/4 devs)

`int` is used in struct field type position by kickstarter §6.1 examples (`age: int(>=18)`), PRIMER §6.5 example (`id: int`), AND the R25 BRIEF. ALL 4 R25 devs reached for `int`. Compiler's `BUILTIN_TYPES` only has `integer` and `number` — `int` falls through to `asIs` (any-type) silently, then `schemaFor(StructType)` breaks with a confusing downstream `E-SCHEMAFOR-NO-SQL-MAPPING: ... declared type (asIs) has no v1.0 SQL mapping`. The actual root cause ("unknown type name `int`") is not surfaced at the struct-field-type declaration site.

The canon is wrong about `int`, OR the compiler should alias it to `integer`. Adopter signal is strong: 4/4 devs reached for it from canon-derived expectation.

- **Reproducer:** `type Foo:struct = { id: int, count: int }` + `schemaFor(Foo)` → confusing E-SCHEMAFOR-NO-SQL-MAPPING.
- **Spec reference:** SPEC §14 type-system primitives + §39 schema DDL mapping.
- **Suggested fix scope (two options):**
  - **(a)** Register `int` as alias for `integer` in `BUILTIN_TYPES` — matches canon's adopter-facing usage; minimal change.
  - **(b)** Emit `E-UNKNOWN-TYPE-NAME` at struct-field-type position (fail fast) AND fix kickstarter + PRIMER + BRIEF to use `integer` consistently — pin canon, reject ambiguous shorthand.
  - **PA-lean:** (a) — canon already uses `int`, adopter signal is 4/4 reach; aligning compiler to canon is the right answer per Rule 3.
- **Cross-refs:** Bug 45 in `gauntlet-r25-report.md`.

---

### Bug 46 — `tableFor` attributes `sortable=` / `selectable=` not implemented (W-ATTR-001 forwarded as plain HTML) — `LOW` (S136 R25; 4/4 devs)

The R25 BRIEF feature 8 references `<tableFor for=Card rows=@cards pick=[...] sortable= selectable=@selectedIds/>`. The `sortable=` and `selectable=` attributes fire `W-ATTR-001` ("not recognized on `<tableFor>`, forwarded as plain HTML attribute") — no semantic effect. The BRIEF specifies these attributes per SPEC §41.16 (tableFor spec), but the compiler hasn't shipped the wiring.

- **Reproducer:** any `<tableFor for=T rows=@cells sortable=true selectable=@selected/>` — W-ATTR-001 ×2.
- **Spec reference:** SPEC §41.16 (tableFor — sortable + selectable attribute surface).
- **Suggested fix scope (two options):**
  - **(a)** Ship the attributes (Landing N) — implement sort header rendering + selectable checkbox column + auto-synth `@<varName>.sortedBy` / `@<varName>.selected` cells.
  - **(b)** Remove from BRIEF/SPEC examples until implemented.
  - **PA-lean:** (a) — these are SPEC-specified flagship features for the L22 family; not shipping them is a real gap. ~v1.0 priority.
- **Cross-refs:** Bug 46 in `gauntlet-r25-report.md`; SPEC §41.16.7 (sort), §41.16.8 (selection).

---

### Bug 48 — Latent paren/bracket-depth gap in sibling `<match>` / `<machine>` / `<engine>` opener finders — `LOW; latent` (S137 — surfaced by Bug 37 agent investigation)

Same-shape bug class surfaced by the R25-Bug-37 dispatch agent (`1ce963d0`). Bug 37 fixed `_findEachOpenerEnd` in `compiler/src/ast-builder.js` by adding `parenDepth` + `bracketDepth` tracking alongside the existing braces+quotes tracking. THREE sibling finders in the same file have the same braces+quotes-only shape and would fail the same way under an inline-arrow-in-attribute-value adopter pattern:

- `_findMatchOpenerEnd` instance 1 (line 10953, `<match>` block-form opener)
- `_findMatchOpenerEnd` instance 2 (line 11871, `<match>` other dispatch)
- `_findOpenerEnd` (line 11562, `<machine>` / `<engine>` openers)

**Not currently fired by adopter patterns.** Canonical `<match for=Type on=expr>` and `<engine for=Type initial=.Variant>` openers don't typically carry paren-wrapped inline arrows in their attribute values (the canonical shapes route arrows through brace-bodies — `derived=match @x { .V1 => .V2 }` keeps arrows INSIDE braces, depth > 0 via existing brace tracking, so braces-only suffices). Latent class, not adopter-visible today.

- **Reproducer (hypothetical):** `<match for=Filter on=@items.filter(c => c.foo == 1)>` OR `<engine for=Phase initial=.Loading data=@items.filter(c => ...)>` — would trigger the same truncation as Bug 37 if exercised.
- **Workaround:** hoist the inline-arrow expression to a derived cell first (same as Bug 37 workaround) — but the canonical scrml shapes don't require this for these structural openers.
- **Suggested fix scope:** mechanical — extend each of the three sibling finders with the same `parenDepth`+`bracketDepth` tracking pattern Bug 37 applied to `_findEachOpenerEnd`. ~30L total across three sites + a few regression tests.
- **Trigger to elevate:** ≥1 adopter friction report exercising inline-arrow attribute values on `<match>` / `<machine>` / `<engine>` openers OR any audit that demonstrates the shape is canonical (would re-elevate to MED).
- **Cross-refs:** Bug 37 RESOLVED S137 `1ce963d0`; agent dispatch BRIEF.md + progress.md at `docs/changes/r25-bug-37-each-arrow-truncation-2026-05-27/`.

---

## §4 Nominal — SPEC sections deliberately spec-ahead-of-implementation

These are SPEC-only surfaces — designed, normatively documented, NOT yet implemented in the compiler. The author has explicitly ratified them as "spec-ahead-of-implementation" (Nominal sections). Adopters should treat as roadmap, not present capability.

### Nominal-1 — Build Story §58 — `nominal`

S118 landed SPEC §58 "Build Story" as a Nominal section. Compilation as a pure function `compile(source, buildStory) → artifact`; content-addressed Merkle closure (Approach B); `[story]` manifest table; per-`<program>` `story=` attribute; `build-story.lock` sidecar; cryptographic SHA-256 closure hash. **No compiler implementation exists.** Includes a §58.12 determinism-gap analysis flagging the `*`-marked claims.

- **Status:** Nominal. Implementation arc estimated ~90-200h (per S124 build-story-research-roughing); M6-gated (M6 cutover precedes substantive build-story work).

### Nominal-2 — `import:host` §21.3.1 — `nominal`

S114 ratified `import:host` declaration form as the manifest-gated self-host bootstrap bridge (Approach C carve-out). **Zero references in `compiler/native-parser/` or `compiler/src/`** per S129 D8b finding — the syntax is SPEC-only.

- **Status:** Nominal. Implementation arc is part of the self-host bootstrap migration (post-v1.0 — see master-list).

### Nominal-3 — Quoted-text model §4.18 compiler fire — `nominal`

SPEC §4.18 landed Wave 1 S111 — the code-default body mode + `"..."` display-text literal + `E-UNQUOTED-DISPLAY-TEXT` error code. The compiler fire is spec-ahead-of-implementation; Waves 2+ ship with the native parser (v0.4.x → v0.5).

- **Status:** Nominal until native parser default-flip + quoted-text BS-retrofit / native-implementation lands. The examples in dev.to articles + samples that show bare display prose inside engine/match arm bodies are NOT wrong against today's compiler.

### Nominal-4 — `_{}` foreign code — `nominal`

§23 — embed non-JS code inline with level-marked braces (`_{}`/`_={...}=`). Enables inline Rust, Python, SQL extensions. Specced, not yet implemented.

### Nominal-5 — WASM call-char sigils — `nominal`

§23.3 — single-character sigils (`r{}`, `c{}`, `z{}`) for invoking compiled WASM functions from Rust, C, Zig. Specced, not yet implemented.

### Nominal-6 — Sidecar process declarations — `nominal`

§23.4 — `use foreign:name { fn }` for declaring server-side sidecar processes (HTTP/socket services). Specced, not yet implemented.

### Nominal-7 — `RemoteData` enum — `nominal`

§13.5 — built-in `Loading / Loaded(T) / Failed(Error)` enum for modeling async fetch state. Pattern-matchable with exhaustive checking. Specced, not yet implemented.

---

## §5 Lifecycle annotation surface — DOC arc closed; IMPL has a remaining gap (S134 finding)

S130 lifecycle DD + HU-1 ratified `(A to B)` extension scope to non-engine cells (Approach C); 4 landings shipped, ONE prerequisite-impl gap surfaced S134:

| Landing | Scope | Status |
|---|---|---|
| 1 | E-TYPE-001 fire (per-access transition-state tracking for **struct fields**) | **SHIPPED S130** (`1feaedc9`) — see §7 rotation |
| 2 | Approach C SPEC extension to fn params + fn return + schema fields + channel cells + Shape 1 + `->` → `to` glyph migration + new §14.12 subsection + `E-TYPE-LIFECYCLE-ON-ENGINE-CELL` engine-cell rejection | **SPEC SHIPPED S130** (§14.12 normative; engine-cell carve-out + `W-LIFECYCLE-LEGACY-ARROW` + §34 catalog rows). ⚠️ **Shape 1 per-access tracker NOT implemented** — surfaced S134 Q6 Phase-0 STOP; filed as Bug 19 in §1 HIGH. |
| 2.5 | S131 HU-2 fn-return hybrid mechanism (presence-progression discrimination-IS-transition + variant-progression explicit `transition()`); SPEC §14.12.6 + §14.12.6.1–6.4; `E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED` | **SHIPPED S131** |
| 3 | PRIMER + kickstarter flagship section (per F-023) — `(A to B)` canon-corroboration | **SHIPPED S134** — PRIMER §6.5 + kickstarter §3.2 + §7 anti-pattern table rows (1 engine-cell, 1 legacy-glyph, 1 over-applied-`transition()`) |
| 4 (S134 const-deep-freeze Q6 ratification) | SPEC §6.8.3 — `reset(@cell)` × lifecycle interaction (symmetric reset reverts per-access transition state per pre-type membership) + §14.12.10 cross-ref bullet | **SPEC SHIPPED S134** · **Impl SHIPPED S135 `2ffe4f6a`** via Q6-narrow (see below). |
| **B-prereq (S134)** | Shape 1 per-access lifecycle tracker — covers `state-decl` AST nodes (both struct-typed Shape 1 with lifecycle in struct-field, and cell-value-typed Shape 1 with lifecycle in cell type) | **SHIPPED S134** (`fd58893e`) — Option α architecture; `collectStructBindings` extension + NEW cell-value-typed tracker via reused `checkLifecycleBindingAccess` with additive params. +25 tests. Closes Bug 19 HIGH. Unblocks Q6-narrow. |
| **Q6-narrow (S135)** | `reset(@cell)` × lifecycle interaction impl — type-system tracker observes reset-path writes + routes through `classifyWriteAgainstSpec` to revert per-access state per §6.8.3 SPEC. Tracker 1 (cell-value Shape 1) + Tracker 2 (struct-typed Shape 1 field lifecycle) | **SHIPPED S135** (`2ffe4f6a`) — Option α additive: `RESET_CALL_RE` regex + new Pass in `processStatementText` mirroring transition handling; +355/-10 type-system.ts; NEW `lifecycle-shape1-reset.test.js` 25 tests. Baseline 21,701 → 21,726; zero regressions. Closes §6.8.3 SPEC-ahead-of-impl bullet. Two heuristic limitations filed as LOW. |
| **Source-form follow-ups (S135)** | `findTopLevelArrow` whitespace tolerance + `parseLifecycleReturnAnnotation` qualified-enum stripping + diagnostic preLabel + `TRANSITION_CALL_RE` `@` prefix tolerance — closes the source-form gap for Shape 1 variant-progression lifecycle annotations (`(.Draft to .Published)` + `(Article.Draft to Article.Published)` forms both work end-to-end from source now) | **SHIPPED S135** (`a7167b6b` + `fefecb1b` + `a5feca4b` + `1f6cc614`) — three surgical fixes + 17 new source-form tests in `compiler/tests/unit/lifecycle-shape1-source-form.test.js`. Baseline 21,726 → 21,743; zero regressions. Three new heuristic limitations filed as LOW (Bug 23/24/25). |

Authority: lifecycle DD at `scrml-support/docs/deep-dives/lifecycle-annotation-extension-and-flagship-scope-2026-05-25.md`; HU-1 at `docs/heads-up/lifecycle-annotation-extension-2026-05-25.md`; const-deep-freeze HU at `docs/heads-up/const-deep-freeze-2026-05-26.md` (Q6 ratification + Bug 19 surfacing); SPEC §14.12 + §6.8.3 normative spec.

---

## §6 Adopter bugs queued (filed but not yet fixed)

- **6nz-V** — `class:NAME` on for-lift reused DOM nodes — see Bug 11 (HIGH). Confirmed GENUINE S126.
- **6nz-U** — filed S126; queued. (Details in `handOffs/incoming/read/`.)
- **6nz-L / 6nz-T** — filed S126; M6-deferred. (Details in `handOffs/incoming/read/`.)
- **GITI-015** — filed S124; LOW. (See Bug 18.)

---

## §7 Closed in S110-S131 (rotation; will rotate out next refresh)

**S131:**
- **Bug 15 (MED) — `~snapshot` raw-sigil codegen leak** — SHIPPED per HU-5 Q-W35-1 (a) ratification. Two-part defensive codegen fix: (1) `emit-logic.ts:bare-expr` skips the spurious orphan `~` bare-expr the live parser peels off `~snapshot = {...}` leads; (2) `emit-expr.ts:emitIdent` adds a defensive marker `null /* ~ orphaned — codegen-fallback */` for any nested-expression orphan that bypasses the bare-expr branch. Regression test `compiler/tests/integration/tilde-snapshot-codegen-fix.test.js` (3 tests, all pass). SPEC §32 unchanged per pa.md Rule 4 — `~snapshot` is NOT a new language form; the native parser already handles the unified `~ IDENT = expr` lead, mirroring that in the live parser surfaceable as a separate follow-up. Closes the S125 Wave 14 DD-surfaced silent-correctness class for the tilde-decl reactive-deps path.

**S130:**
- **Bug 8 (HIGH) — E-TYPE-001 lifecycle access-before-transition fire** — Landing 1 SHIPPED (`1feaedc9`). Per-access transition-state tracking implemented in `compiler/src/type-system.ts` (+666 LOC + design pick β symbol-table side-table mirroring `checkFunctionBodyStateCompleteness` precedent). +33 new tests (27 unit / 6 integration) / +50 expect() calls. Closes the ~6+ week SPEC §14.3 line 7106 spec-vs-impl gap that the mutability-contracts article publish-twin's status banner had been acknowledging. Diagnostic message names binding + field name + struct type + pre-state type + post-state type + resolution path + SPEC anchor. Landing 2 (extension to non-engine cell positions + `->` → `to` glyph migration + engine-cell rejection diagnostic) queued.
- **Phase 2 Cluster A — V-kill SPEC sweep** — A1-A6 all 6 amendments landed (`b0244869`). Grammar production relocated to §6.1.5; §52.4.1 grammar folds in; ~90 worked-example sites migrated SPEC-wide. Closes F-001 / F-008 / F-009 / F-016 (1a/1b LB).
- **Phase 2 Cluster B-code — Approach C source-cascade** — 9 of 10 sites cleaned (`35262911`). Site 1 (`rewriteBunEval` function retirement) DEFERRED pending three prerequisite sub-tasks (META_BUILTINS purge → 5 meta-eval call drops → Pass 4 drop + test retire). Agent's Phase-0 root-cause confirmation caught the brief's "zero callers" assumption was wrong (7 active callers); banked-rule earning its keep. Closes F-002 / F-003 / F-009 (1a) / F-010 (compiler half).
- **F-021 PIPELINE `deriveEngineVarName`** — PIPELINE doc-only fix per HU-2 Q6 ratification. Compiler already aligned with SPEC §51.0.C.
- **F-019 `<schema>` placement** — SPEC §39 prose rewrite per HU-2 Q7 ratification (no longer documents "alongside not inside"; immediate child of `<program>`). E-SCHEMA-003 catalog row updated. (Compiler-side enforcement still open — see Bug 13.)
- **F-018 §55.5 validity surface predictability** — SPEC + PIPELINE prose alignment per HU-2 Q8. Compiler already implements unconditional synthesis.
- **F-003 Approach C SPEC subsumption** — §22.4 + §30 + §7.2 + §22.12 + §34 amendments per HU-2 Q4 ratification. `bun.eval()` retires as user-facing surface. (Compiler-source cleanup of 8 sites in flight S130 Cluster B-code dispatch.)
- **MCP V0.D** — `<program mcp>` attribute wiring + auto-install per SCOPING §3.D. (V0.E still pending — see Bug 14.)
- **Lifecycle annotation HU-1** — 7 ratifications closed; Phase 2 amendment scope crystallized (3 landings).

**S129:**
- **HU-2 batch (6 questions + lifecycle thread)** — F-001 / F-008 / F-009 / F-016 V-kill cluster ratifications; F-023 + F-024 lifecycle annotation flagship + `(A to B)` syntax.
- **D8a-i function `-> ReturnType` annotation** — native parser fix; 4 corpus files closed; +21 tests.

**S128:**
- **D3 `:>`-arm separator** — native parseMatchArm now accepts `:>` per live-parity.
- **D6 string-literal import specifier** — `import { "kebab" as alias }` per SPEC §38.12.5.
- **D7 `given` presence-guard** — `given ident => { body }` per §42.2.3.

**S126:**
- **Bug W (CRITICAL)** — precedence-aware `emitBinary`; `(2+3)*4` no longer silently drops grouping parens.
- **GITI-017 (CRITICAL silent-corruption class)** — `not` keyword no longer corrupts regex literals; lowering pass now skips regex bodies + comments + string interiors.
- **6nz-P** — runtime chunker tree-shake gap; declarative `CHUNK_DEPENDENCIES` table with `scope → [timers, animation]` edge.
- **GITI-019** — lift-loop coalesce parens before `?? ""`.
- **GITI-018** — multi-`scrml:` library-mode imports now all rewrite.
- **6nz-S** — `return not` statement-glue at both lowering sites.

**S123:**
- **Bug Q (V-kill / Unit CC)** — silent runtime → loud compile error. Bare `@x = expr` at default-logic body-top fires `E-WRITE-NOT-IN-LOGIC-CONTEXT`.

**S110-S122:**
- Native parser arc M1-M3 + MK1-MK3 (compiler-internal; opaque to adopters except as parse-completeness wins)
- v0.4.0 / v0.5.0 / v0.6.0 release cuts (S114/S115/S118)
- L22 family — formFor (S102-103) + schemaFor (S104) + tableFor (S105)
- Match block-form Phase 3+4+5 codegen
- Tailwind arbitrary-value families (grid / flex / aspect / transition / transforms / outline / ring length/color/var/keyword) — Bug 1 partial-impl per §2

---

## §8 Where this list comes from

- **Dogfood bug reports** filed when the user/PA hits friction on real adopter-shaped work — see `handOffs/incoming/read/` for archived reports.
- **Spec-vs-impl audit passes** when sweeping a SPEC section (e.g., the S107 §18.0 surface audit that discovered the match block-form gap; the S129 grammar-consolidation Phase 1a/1b/1c audits).
- **Adopter bug reports** (6nz + giti to date; queued in `handOffs/incoming/read/`).
- **PA self-discovery** during implementation work when a planned fix surfaces a deeper gap (e.g., the W-MATCH-RULE-INERT lint attempt surfacing the broader §18.0.1 unparsed state; S130 lifecycle DD surfacing the E-TYPE-001 unimplemented fire).
- **Deep-dive critical findings** (e.g., S130 lifecycle DD's `type-system.ts:1444` per-access transition-state gap).

## §9 Where to discuss / report

- **New gaps in adopter code:** file a GitHub Issue at https://github.com/bryanmaclee/scrmlTS
- **Cross-reference with phase status:** [`master-list.md`](../master-list.md) §0 LIVE DASHBOARD
- **Per-gap implementation arcs:** [`docs/changes/`](./changes/) — each gap with an active impl arc has a SCOPING.md + progress.md there
- **Per-session landings:** [`docs/changelog.md`](./changelog.md)
- **Audit + deep-dive doc inventory:** [`docs/audits/`](./audits/) + `scrml-support/docs/deep-dives/`
