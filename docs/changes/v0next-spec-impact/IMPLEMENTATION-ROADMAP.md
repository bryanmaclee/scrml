# v0.next Implementation Roadmap — Phase A1+ (compiler + cross-cutting)

**Status:** DRAFT (S57, 2026-05-04) — **SUPERSEDED by `master-list.md` §0 live dashboard + `docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md`. Read for historical context only.**

> **S66 amendment:** Whatever is below about self-host migration / B4 self-host bootstrap / fixed-point regression / "self-host catches up at next bootstrap regen" — IGNORE. Self-hosting is DEFERRED to post-v1.0.0 (Bryan S66 user-decision). When it eventually happens, the **entire self-host scrml compiler** (NOT just bootstrap) is **human-authored scrml source**, processed through scrmlTS. NOT compiler-emitted-from-TS. The TS implementation is the engineering target through v1.0.0 ship. See user-voice-scrmlTS.md S66 entries (initial + clarification).

**Scope:** Post-Stage-0b roadmap. What happens AFTER the SPEC.md rewrite finishes. Brings the compiler, examples, samples, ~~self-host,~~ stdlib, editors, and tutorial into compliance with the new spec. (Self-host crossed-out per S66 deferral.)
**Companions:**
- `IMPACT-ASSESSMENT.md` — Stage 0a (impact mapping) + Stage 0b (spec rewrite plan)
- `DISPATCH-{1,2,3,4}-BRIEF-*.md` — Stage 0b execution
- This doc — Phase A1 onward

**Authorization:** drafted under S57 standing scope. Phase-launches need their own session-scoped authorization at dispatch time.

---

## §0 Frame

### §0.1 What this document is

The deliberation arc (S52-S56) produced 20 locks (L1-L20) + 20 moves (M1-M20). Stage 0a maps those into the SPEC.md surface (`IMPACT-ASSESSMENT.md`). Stage 0b rewrites SPEC.md across 4 dispatches (`DISPATCH-{1..4}-BRIEF-*.md`).

**Stage 0b produces a spec the compiler does NOT yet implement.** Many tests fail at end of Stage 0b. That is expected.

**Phase A1+ is the work to make the compiler honor the new spec.** Plus the parallel-track docs/examples/samples/self-host/stdlib/editor work the user enumerated at S55.

### §0.2 Operating assumptions (locked from prior sessions)

-1. **Phase A1 storage model = source-canonical** (S57 lock — file-as-truth, simplest). Hash-keyed cache deferred until felt pain. Other living-compiler axes (hot-reload, content-addressing, version-coexistence) defer cleanly past v0.2.0 and don't force A1 choices.
0. **Release version = v0.2.0** (S57 user statement). When all v0.next changes are live, the release ships as scrml v0.2.0. The "v0.next" codename retires at that release.
1. **Parallel tracks** (S56 user verbatim "parallel. this is the clean break"). Compiler track + docs track run concurrently from day one. Not compiler-first.
2. **No migration story.** No `scrml migrate`, no v0.compat, no file pragmas (S55 user verbatim — no production adopters exist).
3. **Test posture is hybrid** (S56 user verbatim "hybrid on tests"). Keep parser/typer/codegen-mechanic tests that exercise non-syntax-level invariants. Rewrite/throwaway syntax-level tests that bake in pre-v0.next access patterns.
4. **Kickstarter v2 is the user-ratified anchor.** Compiler track validates against it; docs track derives from it.
5. **Each phase is one or more dispatches via `scrml-dev-pipeline`** with the worktree-isolated discipline from pa.md F4.
6. **Crash-recovery discipline** per pa.md global rules: commit each meaningful change, append to `progress-<dispatch>.md`, never bypass pre-commit hook.
7. **Destructive ops require user prompts** per S56 directive. Read-only/additive writes can be pre-allowed.

### §0.3 What this doc does NOT cover

- Stage 0a content (in IMPACT-ASSESSMENT.md)
- Stage 0b dispatch detail (in the four BRIEF-*.md files)
- Specific SPEC section content (those are Stage 0b's job)
- Long-term language evolution past v0.next (out of scope)

---

## §1 Phase boundaries — top-level shape

| Phase | Scope | Output | Est. dispatches |
|---|---|---|---|
| Stage 0b (in flight) | SPEC + PIPELINE + INDEX rewrite | spec frozen as engineering target | 4 (D1 in flight, D2-D4 pre-written) |
| **A1** | Compiler foundation — lex/parse/resolve V5-strict + RHS shapes + compound state + render-by-tag + hoisting + pinned + new error codes | parser+resolver pass kickstarter v2 §3 examples | 1-2 |
| **A2** | Engines + Match + Validators + Substates + Control flow | engines instantiate; match exhaustiveness; validity surface auto-synthesizes | 2-3 |
| **A3** | Channels + Schema + Predicates + `not` keyword | channel decls, refinement-type predicates fire, schema vocab unified | 1-2 |
| **A4** | Cleanup, codegen tightening, error message polish, cross-ref scrub | compiler emits clean for all 21 examples + trucking-dispatch | 1 |
| **B1** | Examples rewrite (21 examples + trucking-dispatch) | every example compiles, runs, marked verified by user | parallel with A1-A4 |
| **B2** | Samples curate (`samples/compilation-tests/` 275 files) | partition into keep/rewrite/drop; surviving set passes | parallel with A1-A4 |
| **B3** | Stdlib review (13 modules) | each module audited under V5-strict + reset-keyword reservation + new shapes | parallel with A2-A4 |
| **B4** | Self-host bootstrap (`../scrml/` ~12,048 LOC) | self-host parses + emits identical-or-equivalent output | parallel with A2-A4 |
| **B5** | Editor support (LSP, VSCode ext, neovim) | tokenizer + completion + error mapping aligned | parallel with A3-A4 |
| **C1** | Tutorial rewrite | 0-to-running app walkthrough | after A2 stable |
| **C2** | Articles triage | deprecate / rewrite / "describes pre-S55-redesign" headers | parallel, low priority |

A* = compiler tracks (sequential). B* = parallel tracks (run alongside A*). C* = doc tracks (sequenced per A* readiness).

---

## §2 Phase A — Compiler tracks (sequential, dependency-ordered)

### §2.1 Phase A1 — Foundation

**Depends on:** Stage 0b Dispatch 1 landed.

**Spec authority:** SPEC §1 (pillars), §3 (context model), §6 (V5-strict + RHS shapes + compound + render-by-tag + default/reset + hoisting/pinned), §11 (folded), §34 (+9 codes from D1).

**Compiler subsystems touched:**
- **Lexer** — tokenize `<ident>` (structural form) vs `@ident` (canonical) cleanly; reserve `reset` keyword; recognize `not` keyword; `default=`, `pinned`, `req` as known attribute names where applicable.
- **Parser** — three RHS shapes (literal-or-expr / bindable-markup / `const`-derived); compound state Variant C structural-children body; `<x>` render-by-tag in markup; in-compound `const <x>` derived form.
- **Resolver / scope analysis** — V5-strict access model: bare names are LOCALS; `@x` is canonical state read; structural form on decl/render. State-name → local shadowing detection. Hoisting model with topo-sort initialization. `pinned` opt-out detection.
- **Typer / shape inference** — markup-as-first-class-value type extension; markup-typed derived cells; the "render-spec must be bindable for writable cells" check.
- **Codegen** — render-by-tag expansion; bind:value/checked/files dispatch by render-spec shape; reset() lowering with default-or-reinit semantics; markup-typed derived cell recomputation wiring.
- **Error reporter** — emit the 9 new codes with good messages and source mappings.

**Test posture (hybrid):**
- KEEP: tokenizer mechanic tests (token stream shapes), AST-shape tests that don't pin specific access syntax, codegen-output mechanic tests at the lower level.
- REWRITE: parser tests that hard-code old-shape declarations; resolver tests that exercise old-shadowing rules; render-by-tag absence tests.
- ADD: tests for each of the 9 new error codes (one or more positive trigger + one negative-no-trigger per code); kickstarter v2 §3 every example as a smoke test (compile-only, no runtime); render-by-tag dispatch table coverage; hoisting topo-sort cases including cycles → E-CYCLE; pinned-forward-ref triggering.
- DROP: any test that asserts pre-v0.next access patterns as ground truth (e.g., bare-name reactive reads).

**Validation gates (definition-of-done):**
1. `bun test` shows the rewritten test set green; intentional drops accounted for in CHANGELOG.
2. Every `docs/articles/llm-kickstarter-v2-2026-05-04.md` §3 example compiles without error.
3. Every new error code has at least one positive trigger test green.
4. `compiler/SPEC.md` cross-refs from §6 to compiler-internal modules verified (resolver, typer, codegen lower-level docs if any).
5. No bypass of pre-commit hook in any commit on the dispatch branch.

**Suggested dispatch shape:** ONE dispatch (per S56 user verbatim "phase A1 as one dispatch"). Crash-recovery via incremental commits + `progress-phase-a1.md`. Wall-time est: 25-50 hours focused work. Worktree-isolated.

**Risks:**
- Hoisting model + topo-sort init is the trickiest piece. The TDZ-1 model from SPEC §6.9 needs careful implementation; cycle detection needs the dependency graph (cross-ref §31).
- Render-by-tag dispatch table for `bind:value/checked/files` may surface gaps in current bind: implementation.
- E-CELL-RENDER-SPEC-NOT-BINDABLE (Shape 2 with non-input markup) needs a "bindable" classifier on markup elements; currently absent.

### §2.2 Phase A2 — Engines + Match + Validators + Substates + Control flow

**Depends on:** A1 landed (V5-strict + new error codes available); Dispatch 2 spec landed.

**Spec authority:** §51 (engines), §18 (match), §55 NEW (validators + auto-synthesized validity surface), substates section, control-flow section.

**Compiler subsystems touched:**
- Parser — `<engine for=Type initial=...>` shape; `<match for=Type [on=expr]>` block + JS-style `match expr {...}`; `<onTransition>` engine-only element; `effect=` engine-only attribute; `<errors of=expr/>` first-class element.
- Resolver — engine-as-singleton-decl rules; auto-declared engine variable; engine state-children as variant matching; rules-inert in match; rules-active in engine.
- Typer — exhaustiveness check on match (structural) + engine (full); cross-cell predicate args (L14); auto-synthesized validity surface (`@x.isValid`, `@x.errors`, `@x.touched`, `@x.submitted`) + per-field versions; ValidationError enum tags (NOT strings).
- Codegen — engine state machine wiring; match output (block-form expands to component-like; JS-form expands to value); validator predicate firing; transition handler wiring; `<errors>` rendering with `all` toggle.
- Error reporter — new codes from D2; `W-MATCH-RULE-INERT` lint.

**Test posture (hybrid):**
- KEEP: existing engine state-machine tests at the IR level if shape-compatible.
- REWRITE: most engine syntax tests; all match tests (shape changes); validator tests (vocabulary unification).
- ADD: exhaustiveness tests for match + engine; rule-inert lint test for match; validator-on-compound auto-synthesizes-validity tests; `<errors>` rendering tests; cross-field predicate tests (L14); error-message 4-level resolution chain tests (L12).
- DROP: any test asserting `loose` flag (L9 dropped); pre-S55 engine syntax.

**Validation gates:**
1. Every kickstarter v2 §6 (validators) recipe compiles + runs.
2. Engine + match exhaustiveness produces correct E-codes on counterexamples; produces no error on exhaustive cases.
3. Auto-synthesized validity surface read-only tests green (E-SYNTHESIZED-WRITE).
4. Tier-promotion path mechanical: a hand-written Tier 1 `<match>` → swap to `<engine initial=>` → add `<onTransition>` blocks works without other edits. Verified via test or sample.

**~~Open Q to resolve here~~ RESOLVED 2026-05-05 (S59 lock L21, commit `1217b41`):** `E-DERIVED-VALUE-MUTATE` is FORBIDDEN. Spec landed at SPEC.md §6.6.18 + §34. Implementation in this phase: AST check on `MemberCall` / `MemberAssignment` / `UnaryDelete` whose receiver chain begins at a `const <name>` cell reference. Same pass that already runs E-DERIVED-WRITE (the reassignment form, §6.6.8 — also renamed from `E-REACTIVE-002` in S59).

**Suggested dispatch shape:** 2-3 dispatches probably — engines is large, validators is large, match is medium. Could split: A2a engines + match; A2b validators + auto-synth validity; A2c substates + control-flow polish. Decide at A1-close based on context-density.

**Risks:**
- Auto-synthesized validity surface bumps into reactivity infrastructure (`@x.isValid` must recompute on every contributing-field change). Performance review needed.
- Cross-field predicate args (L14) — circular dep detection needs care (must catch `<a eq(@b)>` + `<b eq(@a)>` at compile time).
- ValidationError enum is project-wide, but message resolution has 4 levels (L12). Implementation precedence is non-trivial.

### §2.3 Phase A3 — Channels + Schema + Predicates + `not`

**Depends on:** A2 landed; Dispatch 3 spec landed.

**Spec authority:** §38 (channels), §39 (schema), §53 (predicates), `not` keyword.

**Compiler subsystems touched:**
- Lexer — `not` keyword handling.
- Parser — file-level channel decls (no `<program>` wrap); `@shared` modifier dropped; channel body uses V5-strict state decls (Move 19); schema vocabulary unification (with SQL-mirror exception).
- Resolver — channel auto-declares its variable per Move 16 first-run-of-name rule; schema reads / refinement-type predicates.
- Typer — universal-core predicates (`req`, `length`, `pattern`, `min`, `max`, `gte`, `lte`) with cross-cell expression args; `is some` / `is not` existence primitives; refinement-type predicate inference.
- Codegen — channel emit; schema DDL preservation (SQL passthrough INVIOLABLE per S56 user verbatim); predicate firing per locus.

**Test posture (hybrid):**
- KEEP: SQL passthrough tests (inviolable); existing channel runtime / WS protocol tests.
- REWRITE: channel-syntax tests (file-level shape); schema-vocab tests under unification.
- ADD: `is some` / `is not` predicate tests; cross-loci predicate composition tests; `not` keyword tests; channel auto-declaration tests.

**Validation gates:**
1. All kickstarter v2 §11 channel recipes compile + run.
2. Schema emits unchanged SQL DDL — diff against pre-rewrite emitted SQL must be zero except for vocabulary-translated source.
3. Refinement-type predicates fire as compile errors at expected positions.

**Suggested dispatch shape:** 1-2 dispatches. Smaller than A2.

**Risks:**
- SQL passthrough is inviolable but emitted SQL must match. Test thoroughly with diff.
- Channel auto-declaration interacts with M16 first-run-of-name rule — same code path as engine auto-declare; verify no conflict.

### §2.4 Phase A4 — Cleanup, codegen tightening, error polish, cross-ref scrub

**Depends on:** A1-A3 landed; Dispatch 4 spec landed.

**Compiler subsystems touched:**
- Error reporter — message quality pass on all v0.next codes; verify source mapping precision; ensure each error has a fix-suggestion line.
- Codegen — emitted JS readability check; runtime library audit (any dead paths from dropped features); generated module structure consistency.
- Resolver — verify all 20 locks have at least one resolver test covering the lock.
- Cross-ref scrub — every `@x` mention in error messages, examples, internal docs aligns with V5-strict naming.

**Test posture:**
- ADD: regression tests for every fix landed during A1-A3 that doesn't yet have one.
- ADD: an end-to-end "compile every example, run smoke check" CI gate.

**Validation gates:**
1. All 21 examples + trucking-dispatch app compile + run + verified by user.
2. All 20 locks have ≥1 dedicated test.
3. Self-host bootstrap (B4) round-trips identically to TS-host emit (or equivalent — see B4).
4. `bun test` green.

**Suggested dispatch shape:** 1 dispatch. Mostly cleanup + audit + cross-ref + final polish.

---

### §2.5 Phase A5 — S67 ratified engine + temporal extensions (Insight 23 + Item C + Item G)

**Added 2026-05-07 (S67).** Spec target extension via `scrml-support/design-insights.md` Insight 23 (DD-Harel) + Item C audit (`docs/audits/item-c-temporal-engine-rule-migration-rule4-audit-2026-05-07.md`) + master-PA capability-gap audit Item G (S67-1327 inbox). Master-PA debate verdict ratified; user verbatim S67: *"pick engine, that feels right"* (OQ-Harel-8 resolved); *"we shoud start planning out and adding these features"* (scope expansion authorized).

**Total est: ~50-80h.** Class A throughout (compile-time desugar; tree-shakeable runtime cost per S67 user-direction signal #2). Sub-step decomposition:

**A5-1 — SPEC §51 amendments (~3-5h, no compiler work):**
- Add §51.0.M for `<onTimeout>` structural element (per Item C audit Candidate C — recommended scrml-way fit; Pillar-5-compliant; symmetric with §51.0.H `<onTransition>`).
- Add §51.0.N (or sub-section) for `history` attribute on composite state-children (per Insight 23 grammar decision #2). Synthesized reactive cell `@_<parent>History` semantics; tree-shakeable.
- Add §51.0.O for `internal:rule` prefix (per Insight 23 grammar decision #4). Internal vs external transition distinction.
- Add §51.0.P for `parallel` attribute on file-scope `<engine>` (per Insight 23 grammar decision #5). Naming sugar over §51.4 multi-engine; no joint lifecycle semantics.
- Footnote on §51.0.K (Machine Cohesion) per S67 sharpening — singleton invariant explicit; nested `<engine>` permitted inside outer engine state-child body. Format parallel to §6.6.8/§6.6.10 footnote precedents.
- Cross-ref §51.12 (legacy `<machine>` temporal) → §51.0.M (`<engine>` temporal via `<onTimeout>`).

**A5-2 — Parser support (~6-9h):**
- Nested `<engine for=SubType initial=.X>` inside composite state-child body (per OQ-Harel-8 resolution).
- `history` attribute on composite state-children.
- `internal:rule="..."` attribute prefix (alongside canonical `rule=`).
- `parallel` attribute on file-scope `<engine>`.
- `<onTimeout after=N{ms,s,m,h} to=.Variant/>` element. Optional `${expr}` form for computed delay.

**A5-3 — Type-system + symbol-table walker (~5-8h):**
- Nested-engine variant-validation across hierarchy (each composite state-child's child-engine `for=` enum binding type-checks).
- History-attribute legality (only on composite state-children with non-self-closing body containing inner engine).
- `internal:rule` legality (composite state-children only; same variant-target validation as canonical `rule=`).
- `<onTimeout to=.Variant/>` `to=` variant validation against engine's variant set + legal-target check vs surrounding state-child's `rule=`.
- `<onTimeout>` placement validation: engine state-child only (not match arms; not component bodies; reuse E-STRUCTURAL-ELEMENT-MISPLACED).
- Computed-delay expression-typing: must produce non-negative number.

**A5-4 — Codegen extension (~10-15h):**
- Hierarchy desugar: composite state-child with inner engine generates outer-dispatch function checking inner-rules-first → outer-cascade → outer-other-variant; if/else chain at compile time, ~0 bytes net runtime.
- History-cell synthesis: per-composite synthesized reactive cell `@_<parent>History`; written on outer-exit, read on outer-re-entry. Tree-shakeable (only emitted when ≥1 engine declares `history`). ~30-80 bytes per history-bearing parent.
- `internal:rule` codegen: skip outer-state-child re-entry + inner-engine re-init on internal transitions.
- `parallel` attribute: lowering identical to §51.4 multi-engine; the attribute is naming-only.
- `<onTimeout>` lowering: rides existing `_scrml_machine_arm_timer`/`_scrml_machine_clear_timer` runtime (already in `compiler/src/runtime-template.js:66-146`; per Item C audit §1.3 reuse story). Computed-delay form emits per-arm runtime computation. **<onTimeout> codegen SHIPPED at S77 2026-05-10** (engine state-child timer-config table + arm/clear wiring + initial-arm + tree-shake; ~9h actual). Hierarchy desugar / history-cell / internal:rule / parallel STILL DEFERRED as separate sub-steps.

**A5-5 — Computed-delay relaxation (~1.5-2.5h):**
- Lift literal-only constraint on `after Ns` durations. Static literal cases retain constant-folded path; non-constant `${expr}` cases emit runtime computation feeding the existing runtime API. **A5-5 codegen SHIPPED at S77 2026-05-10** for the engine `<onTimeout>` surface (msExpr arrow-fn in timer-config table; runtime applies clamp + Math.round). **A5-5b SHIPPED S77** closing the legacy-machine surface — the body-parser bug at ast-builder.js (spurious `\n` between children fragmenting `${...}` substrings) was a one-line fix; both surfaces now end-to-end with bit-identical runtime semantics. Computed-form rules opt out of JSON-encoded chained auto-rearm per SPEC §51.12.4 S77 amendment (single-step computed transitions arm via per-rule inline arms at module-init; multi-step computed→computed chains require user-driven writes).

**A5-6 — Item G B-shakeable timer extensions (~5-10h, optional follow-on):**
- Event-timeout watchdog (no-event-for-N-ms) — per-machine last-event-timestamp tracker; only loads when an engine declares an event-timeout.
- Named multi-timer-per-state (gen_statem-style) — `Map<Name, Handle>` only loads when an engine declares named multi-timers.
- Both ride alongside the §51.12 codegen + runtime per Item G inbox classification (B-shakeable, OK per S67 user-direction signal #2).

**A5-7 — Tests + samples (~12-18h):**
- ~80-120 new unit tests covering: nested engine declaration + dispatch priority + lifecycle coupling; history attribute synth-cell + tree-shake invariant; internal vs external transition variants; parallel attribute as §51.4 sugar; `<onTimeout>` per literal/computed/multiple-per-state/reset-on-reentry forms; Item G timer extensions.
- New samples in `samples/compilation-tests/` exercising hierarchy + temporal.
- Update at least one example (e.g., loading-with-timeout demo) using `<onTimeout>`.

**OQ-Harel-1 through OQ-Harel-7 spec authoring** (per Insight 23) interleaved across A5-1 / A5-3 / A5-4 as the questions become live.

**Validation gates:**
1. All four DD-Harel grammar decisions parse + type-check + codegen on representative samples.
2. History tree-shake confirmed: when no engine declares `history`, the synth-cell infrastructure is absent from emitted output.
3. `<onTimeout>` reset-on-reentry semantics match XState `after` (already true for `<machine>` form via §51.12.4; verify same for `<engine>` form).
4. Machine Cohesion sharpening landed in spec; no regression on `E-COMPONENT-ENGINE-SCOPE` (engines still forbidden in component bodies).
5. `bun test` green; no regressions; ~+80-120 tests added.

**Suggested dispatch shape:** 3 dispatches typical, possibly 4. A5-1 (spec amendments) is PA-direct or single agent. A5-2/A5-3/A5-4 (parser+typer+codegen) is the bulk; could split parser→typer→codegen across 2-3 dispatches. A5-7 (tests+samples) bundles. A5-5 (computed-delay) and A5-6 (Item G) are small follow-ons.

---

### §2.6 Phase A6 — test-bind (Insight 22, effects-as-data middle path)

**Added 2026-05-07 (S67).** Spec target extension via `scrml-support/design-insights.md` Insight 22 (`test-bind`). Master-PA debate verdict ratified; closes OQ-8 partially (server-function mockability); re-files OQ-8b (`<onTransition>` body effects beyond server-fn calls).

**Total est: ~6-12h.** Class A (compile-time conditional + dead-code elimination; 0 production runtime cost).

**Sub-step decomposition:**

**A6-1 — SPEC amendment (~30-60min, no compiler work):**
- New §54.X (or §47.X — wherever `~{}` test-block grammar lives) introducing `test-bind <serverFnName> = <handler>` declaration.
- L12 Edge F equivalent: static-string-only enforcement on the literal-handler form? (Phase-0 survey verifies; if computed handlers are legal, no edge-case constraint needed.)
- Cross-ref §47 (server-function call site) for the dispatch hook.
- Note Position B (effect-record schemas) NOT ADOPTED at this time; structurally extensible later (no flip-condition gating per S67 methodology rule).

**A6-2 — Parser (~1-2h):**
- `test-bind <name> = <handler>` declaration form inside `~{}` blocks.
- Multiple declarations per block legal.

**A6-3 — Type-system (~1-2h):**
- Scope-local table of bindings within the `~{}` block.
- Key validation: each `<name>` must be a §47-encoded server-function name resolvable in scope.
- Handler-typing matches the server-function's signature (or a structural-subset for partial mocks).

**A6-4 — Codegen (~2-3h):**
- Compile-time conditional dispatch at server-function call sites in test mode.
- Dispatch table consulted at call site; if active binding for the encoded name, call the handler instead of the server fn; if no active binding in test mode and engine context expects bound, fail-fast.
- Production binary unchanged: dead-code-eliminated via the test-mode flag.

**A6-5 — Tests (~1.5-2.5h):**
- ~30-40 unit tests covering: simple bind + handler invocation; multiple binds in one block; unbound-server-fn-in-active-test-bind-context fail-fast; test-mode vs release-mode dispatch divergence; OQ-test-bind-concurrency invariant if implemented.
- Integration test exercising "test engine reaches `.Success` given synthetic HTTP" (the canonical OQ-8 use case).

**A6-6 — `scrml:test` API alignment (~30-60min, optional):**
- Surface convenience helpers if the bare-syntax form is awkward for common patterns.

**Validation gates:**
1. Server-fn mockability test from Insight 22 passes (`test engine reaches .Success given synthetic HTTP, no real network`).
2. E-TEST-004 unchanged (no outer-scope ref; `test-bind` is scope-local declaration).
3. E-FN-004 unchanged (denial-via-`fn` for coeffects stands).
4. Insight 21 unchanged (no effect rows on `fn` types).
5. Production binary byte-identical to release with NO `test-bind` (verifying dead-code elimination).
6. `bun test` green; ~+30-40 tests added.

**Suggested dispatch shape:** 1-2 dispatches. Could be a single agent dispatch given the small scope; or split spec-amendment from impl if Phase-0 survey reveals integration concerns.

---

## §3 Phase B — Parallel tracks (run alongside A1-A4)

### §3.1 B1 — Examples rewrite (21 examples + trucking-dispatch)

**Trigger:** A1 lands → start. Each example rewritten under v0.next when its required compiler features are ready.

**Per-example workflow:**
1. PA reviews current example file.
2. Determine which v0.next features it needs (V5-strict basic / engines / channels / etc.).
3. Wait for dependent compiler phase to land (A1 / A2 / A3).
4. Rewrite to align with kickstarter v2 idioms.
5. Compile + run + verify behavior matches old example (or improved per spec).
6. User runs end-to-end and marks verified in `examples/VERIFIED.md` with current HEAD SHA.

**Validation gate per example:** compile clean + manual user verification + entry in `examples/VERIFIED.md`.

**Aggregate gate:** all 21 examples + trucking-dispatch verified before A4 closes.

### §3.2 B2 — Samples curate (`samples/compilation-tests/` 275 files)

**Trigger:** A1 stable → start partitioning.

**Process:**
1. Auto-classify each sample by: (a) still-compiles green, (b) compiles with new spec edits, (c) tests an obsolete shape and should be DROPPED, (d) tests a new shape and should be REWRITTEN.
2. PA review of classification with user input on ambiguous cases.
3. Drops require user authorization (destructive op).
4. Surviving set passes `bun test` cleanly.

**Validation gate:** classification doc + curated set + drop list approved.

### §3.3 B3 — Stdlib review (12 user-facing modules)

**Note:** pa.md's "13 modules" count includes `stdlib/compiler/` which is the self-host compiler source, NOT user-facing stdlib. **Actual user-facing stdlib = 12 modules.** Correct pa.md at audit time.

**Trigger:** A2 lands → review modules that touch validators/engines first.

**Modules + v0.next collision priority (S57 lock):**

| # | Module | Collision | Priority |
|---|---|---|---|
| 1 | data (validate) | Direct overlap with L11 auto-synth validity surface | **HIGH — load-bearing** |
| 2 | auth (jwt+password) | Login/signup forms = L11 use case; wants synth surface, not duplicate | HIGH |
| 3 | test | V5-strict in test bodies; existing tests need rewrite | MEDIUM |
| 4 | store (kv) | Move 19 channel shape change interaction | MEDIUM |
| 5 | router | L1 markup-as-first-class strengthens "routes return markup" model | LOW |
| 6 | format | Markup-typed formatter opportunity under L1 | LOW |
| 7-12 | crypto, fs, http, path, process, time | Thin state-free wrappers | NONE/LOW |

**Per-module audit checklist:**
- V5-strict access form usage correct
- No local `function reset() {...}` (reserved keyword per L18)
- Compound state uses Variant C
- Match / engine usage aligned with Tier 0/1/2 ladder
- Validator vocabulary aligned (universal-core where applicable)
- Render-by-tag usage if applicable

**Load-bearing decision (S57 lock — data/validate fate = γ):** data/validate is REWRITTEN (not deprecated, not kept old-shape) to use the universal-core predicate vocabulary (`req`, `length`, `pattern`, `min`, `max`, `gte`, `lte`). One vocabulary, two firing sites: compiler auto-synthesizes on state per L11; explicit `validate(value, predicates)` call for plain JS values (e.g., API responses before they touch state). Closes the gap that "deprecate entirely" would leave.

**Vocabulary alignment task (S57 lock, B3 sub-task — flagged from kickstarter↔stdlib cross-check):** today `scrml:data` exports predicate-builder names (`required`, `minLength`, `maxLength`, `email`, `pattern`, `min`, `max`, `numeric`, `integer`, `oneOf`, `url`, `custom`) that diverge from the compile-site universal-core vocabulary (`req`, `length`, `pattern`, `min`, `max`, `gte`, `lte`, etc.). Under the γ rewrite, **rename data exports to the universal-core names** so the same word works at compile site and runtime call site. Specifically:
- `required` → `req`
- `minLength` / `maxLength` / `exactLength` → unify under `length` with relational arg shape (`length(>=2)`, etc.)
- Other predicates (`pattern`, `min`, `max`, `numeric`, `integer`, etc.) review for alignment
- Existing `email`, `url`, `oneOf`, `custom`, etc. — keep as-is unless universal-core adopts a different name
This is a B3 sub-task scheduled with the data/validate γ rewrite. Affects every existing call site of data validators in stdlib (auth, samples) and examples — sweep at B3 time.

**Distribution model (S57 lock):** bundled-with-compiler, single-version, stdlib-version = compiler-version, no registry, no separate semver. Future v0.3.0+ may separate.

**"Kills npm reach" honesty fix (S57 lock):** real claim in kickstarter v2 §3 is "kills ~80% of typical-app npm needs," not 100%. Stdlib lacks date-formatting, locale-aware number formatting, advanced regex, OAuth providers, advanced HTTP middleware. Tighten the kickstarter §3 framing during C1/C2 polish.

**Pre-B3 cross-check (open task):** kickstarter v2 §3 stdlib catalog vs actual stdlib contents. If catalog promises a function that doesn't exist (or vice versa), that's a kill-test for the docs. Run before B3 audit launches.

**Validation gate:** all 12 modules pass audit + green tests + kickstarter↔stdlib cross-check resolved.

### §3.4 B4 — Self-host bootstrap (`../scrml/` ~12,048 LOC)

**Trigger:** A2 lands. Largest B-track risk.

**Process:**
1. Inventory current self-host shape against v0.next.
2. Per-pass migration: each compiler pass (lex/parse/resolve/type/codegen) rewritten in scrml under v0.next idioms.
3. Round-trip parity check: TS-host compiles X, self-host compiles X, output diff must be zero or equivalent.
4. Two-stage verification: stage1 = TS-host compiles self-host; stage2 = self-host compiles self-host (fixed-point).

**Validation gate:** stage1 + stage2 fixed-point reached.

**Risk:** large surface, many edge cases. Probably needs its own session(s) to focus.

### §3.5 B5 — Editor support (LSP, VSCode, neovim)

**Trigger:** A3 lands (most syntax stable by then).

**Per-editor work:**
- LSP: tokenizer alignment with new lexer; completion lists updated; error mapping reflects new codes.
- VSCode ext: syntax highlighting via tokens + treesitter (if used) updated.
- Neovim: syntax + treesitter grammars updated.

**Validation gate:** editor opens kickstarter v2 examples with correct highlighting + completions + error squiggles.

---

## §4 Phase C — Docs tracks

### §4.1 C1 — Tutorial rewrite

**Trigger:** A2 stable (engines/match/validators implemented).

**Scope:**
- Zero-to-running-app walkthrough using v0.next idioms exclusively.
- Cross-reference kickstarter v2 for canonical recipes.
- Replace any pre-S55 examples.

**Validation gate:** new contributor reads tutorial start-to-finish, builds the example app from scratch with no PA assistance.

### §4.2 C2 — Articles triage

**Trigger:** can run any time; low priority.

**Process:**
- Per article: deprecate / rewrite / add "describes pre-S55-redesign" header.
- Kickstarter v0/v1: deprecate (v2 supersedes).

**Validation gate:** every published article either reflects v0.next OR has a clear pre-S55 header.

---

## §5 Cross-cutting concerns

### §5.1 Test count posture across phases

Baseline at S57 open: ~7,851 pass / 30 skip / 0 fail / 398 files (pre-commit, no browser).

Expected trajectory:
- After Stage 0b complete: many tests fail (spec drift). Fail count may briefly explode. **0 fails is no longer an entry condition for Phase A1.**
- During A1: failures decrease as features land; new tests added per the hybrid posture.
- After A1: green again with new test set; some old tests dropped per hybrid plan.
- Same green → temporary-red → green pattern repeats per phase.

Each phase's wrap MUST record:
- Tests added
- Tests dropped (with justification)
- Tests rewritten (count)
- Final pass/fail/skip count
- Justification for any non-zero failures (only acceptable if explicitly carried forward to next phase)

### §5.2 Kickstarter v2 as continuous validation anchor

Every phase has a "kickstarter v2 §X examples compile" gate. Kickstarter is the user-ratified spec-by-example; if a kickstarter recipe stops compiling AND the recipe is correct, the compiler is wrong (not the kickstarter).

If during implementation a kickstarter recipe is found to need correction, surface to user. Do NOT silently drift the kickstarter to match a partial implementation.

### §5.3 Push cadence

Per phase: push once at phase wrap (after user verification). Intermediate WIP commits stay on the dispatch branch until the phase clears its validation gate. Push to main only after gate cleared + user authorizes.

### §5.4 Authorization rhythm

Each phase needs its own session-scoped authorization at dispatch time. "no holds barred" does NOT carry across phases — it expires at session close.

Destructive ops (drops, rm, force push, reset --hard) ALWAYS prompt regardless of standing authorization.

### §5.5 Cross-machine sync (per pa.md)

All phases follow pa.md cross-machine sync hygiene. Fetch-pull at session start; push or surface push-pending at session close.

---

## §6 Risk register (top items)

| Risk | Phase | Severity | Mitigation |
|---|---|---|---|
| Hoisting topo-sort cycle detection corner cases | A1 | M | Test matrix of cycle cases including diamond + indirect via derived |
| Auto-synth validity surface reactivity perf | A2 | M | Profile early; consider memoization at compound level |
| Self-host fixed-point regression | B4 | H | Stage gates; small-step migrations per pass; preserve TS-host as parity oracle |
| Sample drop authorization friction | B2 | L | Batch drop proposals to user; one auth covers a list |
| Editor support drifts mid-phase | B5 | L | Pin editor work to A3-stable; refresh once per phase only |
| Kickstarter v2 contradictions surface mid-spec-rewrite | Stage 0b | M | Surface to user; align spec to kickstarter (kickstarter is the ratified anchor) |
| ~~`E-DERIVED-VALUE-MUTATE` decision drifts~~ RESOLVED S59 (L21) | ~~A2~~ | ~~L~~ | ~~Force decision at A2 entry; document in spec~~ Spec landed §6.6.18 + §34 |

---

## §7 Open questions for the implementation phase

1. ~~**`E-DERIVED-VALUE-MUTATE`** — `@filteredItems.push(x)` on a `const`-derived array: error or allowed? PA leans forbidden. Resolve at A2 entry.~~ **RESOLVED 2026-05-05 (S59 lock L21, commit `1217b41`)** — FORBIDDEN; covers array mutating methods, object property writes / compound-assignment / `delete`, in-compound derived sub-cells. SPEC.md §6.6.18 + §34. E-DERIVED-WRITE (§6.6.8, formerly E-REACTIVE-002) renamed in the same edit.
2. **Components props/slots/lifecycle internals** — designed AS components are implemented (sub-thread under Move 20). Probably surfaces during B1 examples rewrite or a dedicated mid-phase deliberation.
3. **Self-host stage2 fixed-point definition** — exact-byte equality or AST-equivalence? Decide at B4 start.
4. **Drop list for samples curate** — one batch decision or per-sample? Suggest batch with categorized drop reasons.
5. **Tutorial scope** — single tutorial or beginner+intermediate split? Decide at C1 start.
6. **"v0.next" naming drop** — confirmed: retires at v0.2.0 release. Internal references can drop the qualifier earlier (codename → "scrml" once Phase A1 lands meaningfully). Public-docs C-track work uses "v0.2.0" or just "scrml" — never "v0.next".
7. **Tagline refresh thread** — open since S55, deferred (post-implementation polish, not blocking). Three artifacts on the table:
   - **S54 verbatim (locked, htmx-mirror):** *"htmx says 'html as the engine of application states', scrml says state engines are the engine of application state."*
   - **PA-drafted (unratified, partly stale framing — references pre-S55 `<name of=Type>` compression that S56 re-shaped):** *"everything is state. some state has display. some state has transitions. some state has wires. one shape."*
   - **Identified gap (S55):** neither sharply captures the north-star UI-IS-the-engine claim (§1.5 / L1.5 in spec rewrite).
   Decision points: (a) keep S54 line as-is, retire PA-drafted; (b) ratify a new line that captures north-star; (c) elevate both as facets-of-identity. Resolve when public-positioning surface (README, kickstarter v2 frontmatter, v0.2.0 announcement) needs the call.

---

## §8 Sequencing summary (best-case timeline assuming context permits)

| Milestone | Approx wall-time (focused) |
|---|---|
| Stage 0b D1 (in flight S57) | 14-27h |
| Stage 0b D2 | 29-50h |
| Stage 0b D3 | 9-17h |
| Stage 0b D4 | 18-33h |
| **Stage 0b total** | 70-127h |
| Phase A1 | 25-50h |
| Phase A2 | 40-80h |
| Phase A3 | 15-30h |
| Phase A4 | 10-20h |
| **Phase A total** | 90-180h |
| B1 examples | 20-40h (parallel) |
| B2 samples | 10-20h (parallel) |
| B3 stdlib | 10-20h (parallel) |
| B4 self-host | 40-80h (largest B) |
| B5 editors | 10-20h (parallel) |
| C1 tutorial | 10-20h |
| C2 articles | 5-10h |
| **B+C total** | 105-210h (much in parallel) |

**Aggregate:** 265-517 hours of focused dispatch work. Distributed across many sessions with parallelism reducing wall-time meaningfully.

---

## §8.5 Post-v0.2.0 candidates (Bun-runtime piggybacks)

Surfaced from S57 Bun audit (Bun 1.3.0 → 1.3.13 release notes). Not v0.2.0 scope; flagged for v0.3.0+ consideration.

### Bun-audit findings (S57 — locked baselines)

- **SQL: ✅ already on Bun.SQL.** `compiler/src/codegen/db-driver.ts` resolves `<program db="...">` to a driver kind (sqlite/postgres ready, mysql queued Phase 3) and passes the connection string directly to `Bun.SQL`. No A1+ architectural change needed. Documentation opportunity captured in kickstarter §11.6.
- **Channels: single-instance Bun WS pub/sub.** `emit-channel.ts` emits `Bun.serve()` `websocket:` block with `ws.subscribe/publish`. In-process pub/sub on ONE Bun.serve(). Multi-instance fan-out NOT supported. Fine for v0.2.0 single-instance; a real ceiling for production multi-instance.
- **Routing: custom layer on top of Bun.serve() fetch handler.** scrml's compile-time route inference + `_scrml_route_*` exports + manual fetch dispatch. Bun's built-in `routes:` map (1.2.3+) could simplify the dispatch loop but inference layer stays. Modest cleanup, not load-bearing.

### Candidates for v0.3.0+

| Candidate | Bun primitive | Scope | Trigger |
|---|---|---|---|
| **Cross-instance channel fan-out** | `Bun.redis` (1.3) pub/sub | Channels gain a redis-backed mode for multi-replica deployments. Single-instance default unchanged. No npm dep added. | When production multi-instance becomes a felt need. |
| **`<cron>` primitive** | `Bun.cron()` (1.3.12) | New language primitive for scheduled jobs. e.g. `<cron pattern="0 0 * * *">{...}</>`. Compile-time validation of cron pattern; runtime backed by Bun.cron. | When scheduled-job use cases accumulate. |
| **`scrml:store` redis-mode** | `Bun.redis` | createStore/createSessionStore/createCounter gain transparent redis backing when configured. | Concurrent with cross-instance channel fan-out (same Bun.redis dependency). |
| **Bun routes: dispatch** | `Bun.serve({ routes })` (1.2.3) | Replace manual fetch-handler dispatch with Bun's built-in routes map. Inference layer stays. | A4 polish or v0.3.0 cleanup pass. |
| **MySQL driver** | `Bun.SQL` mysql:// | Phase 3 SQL driver — Bun.SQL already supports it; flip the E-SQL-005 check + add tests. | When user demand surfaces. |
| **CI: parallel + sharded tests** | `bun test --parallel --shard --changed --isolate` (1.3.13) | Test posture for ~7,851+ tests across A1+ rewrite. Parallel + shard = real CI speedup; `--changed` for iterative dev. | Phase A1 entry — switch CI config when test count growth makes it pay. |
| **Headless browser testing** | `Bun.WebView` (1.3.12) | Replace Puppeteer in CI for rendered-output testing. Drops a heavy npm dep. | Stretch — Puppeteer works today; only swap if Bun.WebView covers the matrix. |

### `scrml:oauth` extensions — v0.3.0+ candidates (S58)

Surfaced from S58 `scrml:oauth` dispatch. The module shipped without these on principle — both are surface-area enlargers that need their own scope to ship safely. Ship-decision was "decode-only + caller-injected storage now; harden later when felt need surfaces."

| Candidate | What it adds | Trigger |
|---|---|---|
| **JWKS signature verification** for `parseGoogleIdToken` | Currently decode-only — caller must NOT use for security-critical claim trust without out-of-band verification. v0.3.0 adds JWKS endpoint fetching + signature verification + key rotation cache. Likely extends to `parseIdToken(provider, token)` for any OIDC provider. | When app authors hit "I want to trust the ID token claims directly" demand — especially for serverless contexts where session lookup is expensive. |
| **OIDC discovery (RFC 8414)** | Currently provider configs (google/github/microsoft/discord) are statically encoded. RFC 8414 well-known discovery endpoint (`/.well-known/openid-configuration`) lets a provider config be derived at runtime. Useful for Auth0 / Okta / Keycloak / self-hosted IDPs without writing a preset. | When third-party IDP support (beyond the 4 hard-coded presets) becomes a felt need. |

Both deferrals are documented inline in `stdlib/oauth/index.scrml` source comments at the relevant API surface so consumers don't get surprised.

### SPEC.md split (per-section files + concat build) — v0.3.0+ candidate

**Surfaced from S57 D2.6 halt** (agent `a6846bf3ea56e0ad8`). SPEC.md is now ~22,288 lines / ~380k tokens after the §6 V5-strict major rewrite (D1.5). At this size:

- Reading the file requires ~16 chunked Read calls (Read tool caps at 25k tokens/call)
- Full-file Write-back is infeasible (380k tokens per call exceeds single-turn output budgets)
- Future Edit-tool stress as the file approaches 30k+ lines after D2/D3/D4
- IDE responsiveness on the file is degrading (LSP indexing, scrolling, search latency)

**Proposed v0.3.0+ shape:** split SPEC.md into per-section files under `compiler/spec/` (e.g., `01-overview.md`, `03-context.md`, `06-reactivity.md`, `34-error-codes.md`, etc.) with a concat build script `scripts/build-spec.sh` that emits a unified `compiler/SPEC.md` for grep / browse / publication. SPEC-INDEX.md regen would key off the per-section files directly.

**Trade-offs:**
- (+) Each section file is small enough for any tool path
- (+) Per-section editing has clean diff scope
- (+) Index regeneration becomes mechanical (file-per-section maps cleanly to TOC)
- (-) One-time migration cost for existing SPEC.md cross-refs
- (-) Build step needed for the canonical unified view
- (-) Authors must be aware of the split (or treat the unified file as canonical and split as cache)

**Defer until v0.3.0+** unless Stage 0b D3 or D4 also hit the size wall (likely: D3 adds §38 + §39 + §53; D4 cleanup grows further). If they do, prioritize earlier — possibly after Phase A1 stabilizes.

### Bun version pin

`package.json` engines pinned to `bun >=1.3.13` (S57). Captures the perf wins (5.5× gzip via zlib-ng, structuredClone 25× faster on arrays, 2.3× faster URLPattern, range request support in Bun.serve) and unlocks the candidates above.

---

## §8.6 Stage 0b follow-ups (S58 close — small standalone dispatches)

Surfaced from D4 final report (S58). Both are spec-side cleanups, not Phase A1+ implementation work. Should ship in their own small dispatches before or alongside Phase A1.

### Follow-up #1 — §6 Shape 3 `const @x` → `const <x>` sweep — ✅ DONE (S58)

**Source:** D4 final finding #1.

D1 landed §6 with 99 instances of the older `const @x = ...` form for derived cells, vs only 27 instances of the canonical structural form `const <x> = ...`. Per L15 + S56 alignment the structural form (declaration-site uses `<>` syntax) is canonical. D4 brief explicitly forbade modifying §6 (Dispatch 1 territory), so the inconsistency was preserved rather than fixed mid-flight.

**Resolution (S58):** Two-phase cleanup landed.
- **Phase 1 — §6 sweep** (worktree dispatch, branch `changes/s6-const-sweep`, summary commit `c905b2b`): 62 edits inside §6 itself.
- **Phase 2 — cross-section follow-up** (PA direct edits + 5 fixes that landed via worktree path-leak that were correct on inspection): 13 additional edits across §11, §12, §22, §23, §34, §52.

**Final state:** SPEC.md has zero `const @x` declaration-form instances. Read-site `@x` access remains canonical. PIPELINE.md and kickstarter v2 verified clean as part of the spot-check.

**Side-finding:** the Phase 2 worktree dispatch surfaced a subtle F4 path-discipline gap — relative paths in dispatched-agent Edit calls can resolve against the harness's `Additional working directories` list rather than worktree cwd, leaking writes to main. Documented in `pa.md` F4 addendum (S58).

### Follow-up #2 — PIPELINE.md prose pass — ✅ DONE (S75 / C23, 2026-05-09)

**Source:** D4 final finding #2.

D4's PIPELINE.md rewrite landed at 22.6% (1,941 → 2,380 lines), under the brief's 30-40% target. Agent chose addendum-style additions to each affected stage rather than rewriting unchanged-stage prose. Engineering content was complete (every v0.next-affected stage had its addendum), but the prose was stitched-on rather than re-flowed.

**Original status:** Engineering substance complete. Prose cohesion: stitched, not re-flowed.

**Resolution (S75 / A1c step C23):** Worktree dispatch `agent-a2402592dfd975619`. All seven `### Stage N v0.next addendum` sections (TAB / NR / MOD / UVB / TS / DG / CG) re-flowed into their parent stage's narrative. Three companion deliveries:
- **Lock Enforcement Map** added as a top-level table after the Stage Index — maps L1-L22 to firing stage(s).
- **Stage 6.7 (Validity Surface Synthesis)** surfaced as a new sub-stage between META and DG, consolidating the B11/B12/B17/C8 validity-surface narrative previously fragmented across Stage 6 / 7 / 8 addenda.
- **IFMC** reordered by detection-stage; 6 new failure modes added (E-DERIVED-VALUE-MUTATE, E-PARSEVARIANT-001, B14 path-shape, etc.).

Final PIPELINE.md size: 2,608 lines (after prose pass; up from 2,380; +228 / +9.6%). Engineering content unchanged; readability substantially improved.

---

## §9 Cross-references

- **Master plan (Stage 0a):** `IMPACT-ASSESSMENT.md`
- **Stage 0b briefs:** `DISPATCH-{1,2,3,4}-BRIEF-*.md`
- **Kickstarter v2 (anchor):** `../articles/llm-kickstarter-v2-2026-05-04.md`
- **S56 outcomes ledger (L1-L20):** `../../../scrml-support/docs/deep-dives/v0next-s56-deliberation-outcomes-2026-05-04.md`
- **S55 outcomes ledger (M1-M20):** `../../../scrml-support/docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md`
- **S54 synthesis:** `../../../scrml-support/docs/deep-dives/state-as-primitive-redesign-synthesis-2026-05-03.md`
- **PA directives:** `../../../pa.md`
- **Anti-patterns brief:** `../../../../scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`

---

## §10 Tags

#implementation-roadmap #phase-a1-plus #compiler-tracks #parallel-tracks #docs-tracks #v0next #stage-0b-companion #s57-draft
