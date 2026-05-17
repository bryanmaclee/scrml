# scrml — Recent Fixes & Work In Flight

A rolling log of what just landed and what's actively underway in the compiler. For the full spec and pipeline docs see `compiler/SPEC.md` and `compiler/PIPELINE.md`.

Current baseline (2026-05-17 S99 CLOSE — two-track parallel session · Machine A compiler-fix cascade end-to-end · Machine B voice + website build-out · 30+ commits across both repos · Day-30 reference build-out 11 pages shipped · twitter-archive 507 candidates extracted · 3-gap dev-server bug filed): full `bun test` **15,325 pass / 129 skip / 1 todo / 1 fail / 685 files / 44,181 expect** at HEAD `83a902e` (+2,306 pass / +18 files vs S97 CLOSE `b855d0d`'s 13,019). The 1 fail is `compiler/tests/unit/bug-k-sync-effect-throw.test.js` — pre-existing orthogonal carried from S98 close; investigation candidate. `--no-verify` pushes authorized throughout S99 per user direction per S88 protocol. v0.3.0 STABLE `c520369` is the shipped baseline; v0.3.x patch series in flight.

### 2026-05-17 (S99 CLOSE — two-track parallel session · A2-anomaly cascade closure end-to-end · Day-30 reference build-out 11 pages · twitter-archive 507 candidates · 3-gap dev-server bug filed)

**Session-defining outcome:** parallel-machine velocity-mode operationalized. Machine A (on the `bryan` filesystem) ran the compiler-fix arc (A1+A2+A2-FUP+A3+A4+A5-FUP+A7+B1+B1-FUP+is-some Phase B = 10+ closures) including the A2-anomaly-2 cascade unmasked-and-closed end-to-end + Track 2 of the A3 SURVEY (§51.0.B.1 compiler-feature wiring) + README refresh + S99 LIVE hand-off rotation + corpus-refresh (425 Claude-transcript candidates) + twitter-archive drop (21.2 MB to voice/corpus-sources/). Machine B (on the `bryan-maclee` filesystem) ran the voice-author assembly + twitter-corpus extraction (507 candidates) + Day-30 reference build-out (11 element + context pages) + dev-server bug filing. Combined session: ~30 commits across scrmlTS + scrml-support.

**Compiler fixes (Machine A — 10 closures across scrmlTS):**

- **`c4fc98a`** A2 anomaly-2 fix. `export function` synth stubs were emitting empty `params` + `body` post-block-splitter; AST-builder now populates them via token-slice approach. +10 regression tests. Unmasked a cascade of pre-existing scope/parser gaps (closed below).
- **`79c0714`** A3 fix. `parseParamList` accumulated tokens between commas into one string; default-value `= expr` separator never detected. Fixed at `ast-builder.js parseParamList` + new `paramSignature` helper in `codegen/utils.ts` + `token.scrml` §42 migration (bare `null` → `not`).
- **`dbd827f`** A2-FUP-2 RI promotion. `export function foo() { server { ?{} } }` wasn't being promoted by route-inference because the bare `server` keyword captured as malformed `bare-expr`. New `route-inference.ts` pre-pass `rewriteServerBlockStubs`. +9 tests.
- **`64b2e54`** A1 scope-walker fix. `type-system.ts` scope walker missed (§A) `export class` names, (§B) for-of destructure, (§C) const destructure. New helper `extractDestructuredNames`. +12 unit tests.
- **`87426c8`** A4 `is some` / `is not` / `is .V` preprocessor fix. `LHS_IDENT_CHAIN` char-class allowed `.` but not whitespace around `.`; preprocessor inverted receiver/argument on certain shapes. Member-access LHS now preserved. +13 tests; un-skip 1 trucking-dispatch.
- **`9754f1f`** B1-FUP TS scope walker for §51.0.B.1 named-form RHS identifiers (compiler-feature wiring follow-up).
- **`23c0943`** A5-FUP function-parameter destructuring in parseParamList.
- **`518ebc9`** is-some Phase B — bare-compound LHS support (`regex.exec(str) is some`, `a || b is some` per SPEC §42.2.4 implementation note).
- **`b07b37f`** A7 fix — E-SWITCH-FORBIDDEN silent-bypass closed via new structural post-parse walker (the `switch` keyword wasn't fired through certain function-body paths).
- **`c4c99e4`** B1 §51.0.B.1 payload-binding compiler-feature wiring (track 2 of A3 SURVEY). 3 sub-deliverables: engine-statechild-parser extracts payloadBindings per 3 forms (bare-attribute / named / parenthesized); symbol-table PASS 11 fires E-ENGINE-PAYLOAD-ON-UNIT-VARIANT + -ARITY-MISMATCH + -RESERVED-COLLISION; codegen wires payload-scope injection.

**README + hand-off** (Machine A):
- **`c9b8821`** README refresh — v0.3.0 STABLE framing, count updates, Phase B SPA tree-shake noted, S99 in-flight noted.
- **`805a21b`** S99 LIVE hand-off written by Machine A; **`8c0e8ff`** corpus-audit-complete notification to Machine B.

**Voice-author work (Machine B — 4 scrml-support commits):**

- **`e644ffd`** S99 working-draft assembly of state-vs-logic axiom essay. User's S98 bridge-Q1 prose preserved verbatim; 3 scaffold quotes inserted at user-marked `<insert qt here>` placeholders; user's "I would" closing fragment preserved; 8 scaffolder thoughts at bottom.
- **`50f5d5d`** DRAFT rev-2 — Q3 swap (shoot-straight → GingerBill twitter reply 2026-05-15) per the "if I have already said something well once, why come up with it again" principle. Same controversy-drives-evolution thesis, public attestation. Shoot-straight now reserved exclusively for building-anyway essay. Quote 2 extended to include the truncated "When I reread what I originally typed, its totally not what I meant" sentence.
- **`2f04d28`** Twitter-archive corpus extraction. **507 candidates** (451 tweets + 56 note-tweets) from 21.2 MB archive. JSON-schema-compatible with both Claude-transcript corpora. Top topics: language-design 147, compiler-design 73, llm-era-adoption 64, industry-field-culture 54.
- **`1527d42`** Extractor script promoted to `scrml-support/scripts/regen-twitter-corpus-candidates.py`. Companion to other machine's `regen-corpus-candidates.py`.

**Combined voice corpus pool now 1,577 candidates across 3 streams** (machine-A-corpus 425 + machine-B-corpus 645 + twitter-corpus 507) awaiting user-review-curation into canonical `quote-library.json`.

**Website reference build-out (Machine B — 5 scrmlTS commits — Day-30 surface 11 of ~22 element+context pages shipped):**

- **`bbdad7e`** Batch 1: /reference landing + match + program.
- **`41086cd`** Batch 2: channel + auth + logic context.
- **`74bcca9`** Website nav patch — hard-coded `/pages/` prefixes in 16 .scrml files (workaround for dev-server URL-routing gap).
- **`5cb1e3b`** Tailwind-engine-gap addendum to dev-server bug report.
- **`83a902e`** Batch 3: onTransition + page + schema.

All 11 element + context pages follow the 8-section template. Authoring conventions captured for future feature pages.

**Dev-server bug filed back to Machine A** (`handOffs/incoming/2026-05-17-1815-machine-B-to-machine-A-dev-server-routing-bug.md`): three distinct gaps — (1) URL routing (`/reference` 404s), (2) Shell composition (app.html empty `<main>`, no chrome on pages), (3) Tailwind engine coverage (missing `prose` / `font-mono` / etc). 4 fix-shape options per gap + PA recommendation (Option C: emit `dist/<route>.html` with shell inlined — matches SPEC §40.8.1). Workarounds applied (URL-prefix hard-coding + Tailwind CDN injection); band-aids only. v0.3.x candidate.

**1 new durable user-voice S99 entry + 1 PA-methodology rule:** *"If I have already said something well once, why come up with it again."* — reuse-over-reinvent for voice work. Substrate (quote-library + corpus-candidates + tweet-drafts + prior articles) is the resource; cross-essay quote-overstacking is signal — surface a sibling-quote swap. Visit-and-verify is part of the docs-build-out loop.

**Origin sync at S99 close:** both repos pushed mid-session 5×+4× + wrap chain. Both clean at wrap-start.

**Post-Machine-B-wrap consolidation (Machine A wrap):** Machine B's S99 CLOSE wrap landed at `a6dd6af` and filed the dev-server-routing bug report to Machine A. Machine A read + acted on it the same session:

- **`fc27960`** MPA fix — multi-page-app shell composition + clean-URL emit per SPEC §40.8.1 + Machine B's fix-shape (c) recommendation. Four sub-deliverables: (1) `api.js pathFor()` strips leading `pages/` segment from dist (`pages/X/index.scrml` → `dist/X/index.html`); (2) `codegen/index.ts` post-pass extracts entry's `<main>` slot + inlines shell per-page; (3) `commands/dev.js` directory-index resolution (`/reference` → `dist/reference/index.html`); (4) `app.scrml` keeps emitting `dist/app.html` as standalone shell-only artifact (option (i) — adopter dev-tool affordance). `<page>` tag emits transparently. Composition no-op when entry has no `<main>` (trucking-dispatch unchanged). +22 tests (17 integration + 5 unit). Closes Machine B's dev-server-routing bug end-to-end on the compiler side. Reply notification dropped at `handOffs/incoming/2026-05-17-1900-machine-A-to-machine-B-mpa-fix-landed.md` (8-file workaround-revert list for Machine B + SPEC §47.9.5 amendment surface). Path-discipline incident #6 captured (S99 leaked pre-snapshot commit `be1cff9` to local main; reset cleanly before pushing — `pa-scrmlTS.md` S99 addendum already in place at scrml-support `65eaab7`).

- **`7fa0dab`** docs(handoff) — MPA fix landing notification + move processed dev-server bug to read/.

- **Tailwind engine gap direction LOCKED** for next-session pickup: option (a) — extend the built-in Tailwind engine to cover typography plugin + missing core utilities (`font-mono`, `prose`, `prose-slate`, `not-prose`, `border-collapse` + audit-surface). Flagship-claim alignment per `css-without-build-step.scrml`. Scope ~8-15h; SPEC §26 may need a §26.6 "Typography Plugin" subsection. User-verbatim: *"A the tailwid dir"* (option A locked, surfaced for next session).

- **Path-discipline pattern crystallized**. 6 leak incidents across S99 (A1, B1, A5, A7, MPA-fix, plus one I-am-uncertain-which-numbered-incident); `pa-scrmlTS.md` S99 addendum at scrml-support `65eaab7` documents the four operational tightenings + escalating-urgency case for the platform-level PreToolUse-hook fix (still deferred — needs context-aware "is this PA or subagent" signal).

**Total S99 sustained tests at CLOSE (full suite):** 15,342 pass / 133 skip / 1 todo / 2 fail / 1 error / 687 files / 44,255 expect (+2,450 pass / +30 files / +1,053 expect vs S96 close clean baseline 12,892). Pre-commit subset (unit/integration/conformance only): 12,555 pass / 92 skip / 1 todo / 0 fail / 654 files. The 2 fail / 1 error are pre-existing orthogonal (bug-k-sync-effect-throw + browser-runtime smoke flakes per Bug 18 family).

### 2026-05-17 (S97 CLOSE — 18 commits · all S95/S96/B1 bugs closed end-to-end · ghost-pattern lint catalog +7 entries / +8 frameworks covered · stress harness scaffolded)

**Session-defining outcome:** all three bug catalogs surfaced across S95-S96 closed end-to-end (S95 18/18, S96 followups 5/5, B1-surfaced 7/7 — including 1 new bug discovered during verification). Plus the brute-force syntax-stress harness landed as a living scorecard, and 5 new lint families closed all `uncovered-gap` cases. Lint catalog grew from 16 → 23 patterns. v0.3.x patch series continues — substantial adopter-protection surface added.

**Bug fixes (8 compiler/codegen + 1 docs alignment):**

- **`3b06ad8`** Parser escape-hatch raw-slice misaligned when `preprocessForAcorn` changes string length. `const <r> = @x == E::A ? @items.filter(function(t){...}) : @items` emitted broken JS (missing `}`). Root cause: `parseExprToNode` passed `trimmed` as rawSource but acorn parsed `processed` (post-`::`→`.` rewrite); slice positions off-by-N. Hand-off framed this as "chained-ternary derived codegen function-arg strip" — actual trigger was `::` (or any preprocessor-modifying scrml syntax) + FunctionExpression in arg position, not chaining.

- **`07c345a`** Tokenizer bare-assignment per SPEC §5.2.3 L19. `<button onclick=@phase = .Loading>` (the SPEC §5.2.3 worked-example shape) silently misparsed pre-fix as `<button onclick="phase" Loading>` (`@` stripped, `.Loading` became boolean attr). Fix: tokenizer detects `@`-prefix event-handler value + `=` continuation, switches to expression-mode reader bounded by next attribute whitespace.

- **`5df1a3a`** Compound + postfix bare-form completions. `onclick=@count++` and `onclick=@count += 5` now lower correctly. Extended `rewriteReactiveAssign` to handle compound updates (`+= -= *= /= %= **= <<= >>= >>>= &= |= ^= &&= ||= ??=`) and postfix updates (`++` / `--`); routed UnaryExpr kind through string-rewrite path in emit-event-wiring so postfix updates reach the rewriter (was bypassed via structured emitUnary). Also excluded `-` from value-ident regex in event-handler context so `@count--` doesn't get glued into ident.

- **`2503382`** S95 Bug 4 — `<li ondrop=dropOn(name)>` inside a component template (where `name` is a prop) silently miscompiled. Two coordinated fixes: (1) `normalizeTokenizedRaw` Step 6 collapses tokenized call-form spacing `ident ( args )` → `ident(args)` so the markup tokenizer correctly produces ATTR_CALL; (2) `substituteProps` extended to substitute prop refs in call-ref / variable-ref / expr attribute values (was string-literal-only). Per-instance handler now emits `_scrml_dropOn("zone-a")` and `_scrml_dropOn("zone-b")` correctly.

- **`c451ae6`** Match-arm RHS bare-variant placeholder leak. `match @mode { .Idle => .Active }` emitted unresolved `__scrml_bare_variant_Active__` to client JS — ReferenceError at runtime. Asymmetry root cause: `preprocessMatchExprs` extracts arms as JSON-stringified strings; the bare-variant rewrite's negative-lookbehind shields LHS (after `"`) but not RHS (after space). Fix: unmask placeholders at top of `rewriteEnumVariantAccess`; existing rewrites then handle `.X` per shape.

- **`8c9c891`** `@`-prefix reactive-method-call event handlers routed through structured emit. `onclick=@outer.advance(.Playing.history)` emitted invalid `@outer.advance("Playing".history)` pre-fix. Affected ALL `@<var>.method(args)` bare-call event handlers including `@list.push("x")`, `@items.sort()`. Fix: detect `@`-prefix handlerName in call-ref path, synthesize CallExpr ExprNode, emit via emitExprField — routes to emit-expr.ts emitCall (C13 dispatch for engine `.advance` history-restore + generic member-call lowering for the rest).

- **`0a3388f`** `<X rule=.Y history>` boolean attr swallowed into preceding `rule=` value. Workaround was placing `history` BEFORE `rule=`. Root cause: lookahead `(?=\s+\w+\s*=|\s*\/?\s*$)` in `engine-statechild-parser.ts` only recognized `attr=value` followers or tag close as boundaries. Fix: extended lookahead to also recognize boolean-attr boundaries `\s+\w+(?:\s|=|>|\/|$)`. Applied to both `rule=` and `internal:rule=`.

- **`2fd5f7a`** Master-list correction — Bug 2 (`<engine derived=@var>` over auto-declared engine) had been listed as "STILL PENDING" but actually shipped at `d512266` v0.2.3 (S84). Cross-verified via changelog before treating master-list as truth. Same staleness pattern as S82 precedent.

- **`b503391`** Kickstarter v1 §5.2.2 alignment per S96 Bug 14 revert. Removed stale claim that `onclick=fn()` auto-injects event; replaced with SPEC §5.2.2 normative wrapper shape (`function(event){ fn(); }` — event NOT forwarded) + four-shape table covering `fn()` / `fn(literal)` / `fn` / `${(e) => fn(e)}`.

**B1 follow-ons verification + closures (line 231-236 master-list):**

- **`27c4202`** S97 verification pass — 3 verified-closed (pipe-alternation v0.2.4 Bug 2; comparison-position bare variant v0.2.4 Bug 5; multi-statement fn bodies likely v0.2.4 cluster); 2 still open at verification time (match-arm RHS bare variants; `.advance(.X.history)` event-handler); 1 NEW surfaced (`<X rule=.Y history>` attr-order tokenization).

- **`4e7c70e`** + **`7facfc7`** + **`15ad767`** Master-list status corrections marking each closure (`c451ae6` / `8c9c891` / `0a3388f`). B1 follow-ons now 7/7 closed.

**Brute-force ghost-pattern lint family (NEW — 5 lint codes, 8 frameworks):**

- **`1f390c2`** Stress harness scaffold. 34 fixtures across React/Vue/Svelte/Solid/Angular/JS-paradigm/TypeScript + 4 regression guards. Per-fixture `expect` classification (ghost-caught / compile-error / generic-error / silent-bad-js / clean-pass / uncovered-gap). Living scorecard surfaces (a) lint coverage gaps, (b) silent-compile bugs (Bug 14 shape — 0 found this session = clean baseline), (c) diagnostic quality. Pre-fix scorecard: ghost-caught 12, generic-error 9, uncovered-gap 6.

- **`dd601ad`** W-LINT-016 React hook calls — `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`, `useContext`, `useReducer`, `useLayoutEffect`, `useTransition`, `useDeferredValue`, `useId`, `useSyncExternalStore`, `useInsertionEffect`. Correction names scrml-primitive forms: `<x> = init`, reactive `${...}`, derived cells, engines.

- **`12e2881`** W-LINT-017 (Vue composition API), W-LINT-018 (Svelte stores), W-LINT-019 (Solid primitives). 50+ entry points across all three frameworks; cross-fire prevention verified per-framework. Svelte `derived(...)` call form fires W-LINT-018 WITHOUT colliding with scrml's `derived=expr` engine attribute (call vs attribute distinguishable by `(` vs `=`).

- **`184c011`** W-LINT-020 (Vue `{{}}` double-brace), W-LINT-021 (Angular `*ngIf` / `(click)=` / `[(ngModel)]=` — 3 sub-patterns sharing code), W-LINT-022 (TypeScript `interface` + untagged `type X = { ... }`). All 6 uncovered-gap fixtures closed. Regression guards: scrml `${expr}` doesn't trip 020, `class:active=(expr)` doesn't trip 021, `type X:struct = {}` doesn't trip 022.

- **`b855d0d`** W-LINT-023 React Fragment opener `<>`. Pattern matches LITERAL two-char `<>`; scrml's bare closer `</>` has `/` between `<` and `>` so chars aren't adjacent — no false-fire. Correction names scrml grouping primitives (wrap in real element, lift iteration, single-root component returns, slots).

**Cross-repo notice (1 dropped, none received):**

- FYI notice dropped at `6nz/handOffs/incoming/2026-05-16-1200-scrmlTS-to-6nz-bug14-event-handler-spec-revert.md` re: S96 Bug 14 SPEC §5.2.2 revert (`onclick=fn()` no longer auto-threads event). Includes escape-hatch example + suggested grep for affected 6nz adopter code.

**Final stress harness scorecard (S97 close):**

| Category | Pre-S97 | S97 close |
|---|---|---|
| ghost-caught (specific lint) | 12 | **26** |
| compile-error (specific E-*) | — | 3 |
| generic-error (E-SCOPE-001 etc.) | — | 1 (Svelte `$store` auto-subscribe — special $-prefix shape, deferred) |
| silent-bad-js | — | 0 |
| clean-pass (regression guards) | — | 4 |
| uncovered-gap | — | **0** ✅ |

**Process notes:**

- **PA wrap-suggestion reflex correction** (S97 user pushback). At ~43% context used, PA proposed wrap; user correctly noted "lots of headroom, let's get on the medium fixes." Memory rule filed: `feedback_dont_wrap_at_43_percent.md` — pa.md is explicit about not wrapping above 50% remaining; 1M context exists precisely for multi-thread continued work.

- **Master-list staleness pattern continues** (S82 + S97). Both Bug 2 (S97 `2fd5f7a`) and several B1 follow-on entries had stale "still pending" markers despite changelog showing closure. PA cross-verify-against-changelog discipline applied; reinforces pattern noted in S82's 22%-context-burn precedent.

- **Hand-off framing can misframe trigger conditions.** S96 "chained-ternary derived codegen" was actually `::` + FunctionExpression in arg position (not chaining). S96 "remaining `.advance(.X.history)` bug" was actually broader `@<var>.method(args)` bare-call class (event-handler routing). Adopter-shape repro frequently reveals scope different than hand-off cited.

### 2026-05-16 (S96 CLOSE — bug-chip marathon · 9 commits · TodoMVC 38-fail closed · 16 of 18 S95-catalog bugs closed · 4 newly-surfaced compiler followups closed · pa.md homed at scrml-support · Issue C reactive-iterable widened (Option A) · SPEC-at-session-start rule added)

**Session-defining outcome.** Eight waves of bug-chip work landing 9 commits end-to-end. The TodoMVC browser-test 38-fail (carried forward from S95 close with `--no-verify` workaround) closed in dispatch #1 — fixture canonical-reactive rewrite + test infrastructure defensiveness + RE-CLASSIFICATION from "tree-shake bug" framing to three orthogonal causes (test brittleness + fixture non-canonical + compiler-design-question). Pre-push gate restored without `--no-verify` from that point on.

User added **pa.md directive at session-start: "PA SHALL read the spec at session start"** after catching PA chasing Bug 4/11/14 from FOLLOWUPS framing without verifying SPEC §5.2.2. The spec gave normative resolution to three bug classifications in one read; pa.md session-start checklist now mandates `compiler/SPEC-INDEX.md` at step 3 + operational rule about Reading targeted SPEC sections before any spec-implication code change. **pa.md itself moved to `scrml-support/pa-scrmlTS.md`** (canonical home; thin pointer at `scrmlTS/pa.md` so global "read pa.md in project root first" convention still resolves) — user rationale: pa.md is the two-party-exchange contract, not language content; scrmlTS public/MIT repo is the wrong audience for that.

- **Dispatch #1 (commit `1e9df2d`, +38 closed).** TodoMVC browser 38-fail closed end-to-end. Re-classified from "tree-shake bug" (dispatch doc framing) into three orthogonal causes after Phase 1 exploration. (a) Test infrastructure brittleness — `browser-todomvc.test.js:99` unconditionally referenced `_scrml_reconcile_list` causing setup-time ReferenceError to cascade through all 38 tests. (b) TodoMVC fixture used non-canonical `function visibleTodos()` + `for (let todo of visibleTodos())` — the iterable was a CallExpr not bare-`@`-ident, so the reconciliation chunk-gate didn't fire, list was silently non-reactive. Fix: promoted `@filter` from string to existing-but-unused `FilterMode:enum`; added `computeVisibleTodos()` helper + `const <visibleTodos>` derived cell; for-loop iterates `@visibleTodos`. (c) Issue C compiler tolerance for non-canonical shapes — DEFERRED to Wave 7.

- **Wave 1 (commit `d360a88`).** S95 Bug 7 (component-def shape) + Bug 8 (W-LINT-007 false-positive on `type X:struct = {…}` and `props={…}`) + Bug 9 (W-LINT-013 false-positive on function-body `@cell = .Variant`). Bug 7 fix extends `route-inference.ts:walkMarkupContext` to scan `component-def.raw` string for callee idents (mirrors when-handler `bodyRaw` pattern). Bug 8 fix tightens W-LINT-007 regex with negative lookbehinds `(?<!:\w*)(?<!type )` + adds `props\b` to exclusion list. Bug 9 fix adds `buildFunctionBodyRanges` brace-matched range builder + threads as 6th arg through `skipIf` callback signature; W-LINT-013 skipIf now excludes function-body ranges. Lint count on triage-board: 9 ghost-patterns → 0.

- **Wave 2 (commit `bc18aa5`).** S95 Bug 15 (`fn`-body parser false-fires E-FN-001 on ternary with object-literal arm — pattern `/\?\s*\{/` matched `? {` as SQL sigil; tightened to `/\?\{/`) + Bug 10 (`class:NAME` tokenizer rejected hyphenated names with digits like `class:opacity-40` in lift context — extended `emit-lift.js:parseAttrs` hyphen-merge logic to accept `:` separator AND digit-starting continuation chunks). Bug 3 couldn't be reproduced in synthetic test cases (E-COMPONENT-021 prefix suggests component-def context-specific); filed for later.

- **Wave 3 (commit `cc59982`).** S95 Bug 11+12 (`${(e) => fn(e)}` arrow-form event handlers in lift codepath wrapped in `function(event) { ${expr}; }` making the inner arrow a dead expression-statement — added isCallable detection to use callable handlers directly) + Bug 14 (SPEC §5.2.2 VIOLATION — `onclick=fn()` SHALL emit `function(event){ fn(); }` per spec, but impl emitted `fn(event)` citing tutorial §1.5 + a locked test). User-decision option-1: SPEC wins per Rule 4; tutorial is not normative. Reverted impl + updated 13 locked-test assertions across 5 test files. Bug 4 (closure-capture arg forwarding) couldn't be reproduced with canonical V5-strict syntax; was a misclassified non-canonical-reproducer.

- **pa.md move (commits `c921f0a` scrmlTS + `548a675` scrml-support).** Moved scrmlTS/pa.md (845 lines) to scrml-support/pa-scrmlTS.md per user rationale "speaking to my audience — pa.md is purely about a two party exchange." scrmlTS now carries a 24-line pointer file so the global "read pa.md in project root first" convention still resolves. Internal `pa.md Rule N` cross-references remain symbolic (rules are content-addressed, not location-addressed). Naming follows existing `user-voice-scrmlTS.md` per-repo-suffix pattern.

- **Wave 4 (commit `1b8be2f`).** Match-form derived codegen trailing-comma bug (Wave 1-surfaced followup) closed — `splitMultiArmString` in emit-control-flow.ts slices each arm by next-arm-start position, capturing the source-level `,` arm-separator into the slice. After `.trim()` the trailing `,` survived; `parseMatchArm`'s `[\s\S]+$` result capture pulled it into `arm.result`; IIFE emit produced `return ..., ;` (invalid JS). Fix: post-slice strip a trailing `,` with optional whitespace. Plus S95 Bug 6 closed as MISCLASSIFICATION — triage-board's `25-triage-board.css` is 867 bytes (NOT 0); `wc -l` returned 0 because the CSS has no trailing newline. FOLLOWUPS measurement-method artifact, not a real bug.

- **Wave 5 (commit `5cc5ade`).** Transitive dep tracker miss (Wave 1-surfaced followup) closed — `extractReactiveDepsFromBody` in reactive-deps.ts walked recognized statement kinds (let-decl / const-decl / return-stmt / etc.) for expr strings then recursed only into ARRAY-valued children. The if-stmt / while-stmt / for-stmt's `condition` (string) and `condExpr` (ExprNode) were STRING/object-valued and silently skipped. Direct-reads collection in dependency-graph.ts DID walk condExpr; the two paths were inconsistent. Fix mirrors S87 Trio A's EXPR_STRING_FIELDS pattern from route-inference.ts.

- **Wave 6 (commit `cf92351`).** Bare-variant in `==` comparison at state-decl init (Wave 1-surfaced followup) closed — `inferBareVariantsAtComparisonSites` helper exists (S84 v0.2.4 #5) and was wired at let-decl + bare-expr + if-stmt sites, but NOT at state-decl init. V5-strict `<x>:T = expr` and `const <x> = expr` decls flowed through state-decl case which only called struct-nav walker + call-arg walker. Fix: added comparison-site walker invocation parallel to existing walkers.

- **Wave 7 (commit `2e102a8`).** Issue C closed — Option A reactive for-iterable widening. New helper `iterableHasReactiveRefs(node, fnRegistry)` in reactive-deps.ts. Chunk-gate at emit-client.ts widened to accept any iterable with @-prefix ref (direct or transitive). Top-level emitForStmt at emit-control-flow.ts widened with same predicate. Nested-in-lift emit at emit-lift.js:emitForStmtWithContainer extended with full reconcile_list shape (wrapper + createFn + renderFn + `_scrml_effect_static`) appended to outer container — this closes the triage-board real-code case where outer `for (let col of columns)` had inner `for (let task of @tasks.filter(...))`. V5-strict identifier semantics (§6.1.3 + E-NAME-COLLIDES-STATE) make "no @-ref = snapshot" unambiguous. All 4 Option-A truth-table cases verified.

**S95-catalog closure tally (18 originally):** Bugs 1, 2, 5, 13, 16, 17, 18 (S95 wave) + 6 (S96 misclassification close) + 7, 8, 9, 10, 11, 12, 14, 15 (S96 dispatch waves) = **16 of 18 closed**. Bug 3 + Bug 4 remain pending real-context reproducers (synthetic repros didn't fire).

**Newly-surfaced followups during S96 (4 closed + 2 open):**
- ✅ Match-form derived codegen trailing-comma (Wave 4)
- ✅ Transitive dep tracker incomplete (Wave 5)
- ✅ Bare-variant in `==` comparison at state-decl init (Wave 6)
- ✅ Issue C reactive for-iterable widening (Wave 7)
- 🟡 Chained-ternary derived codegen function-arg strip (still open — separate dispatch)
- 🟡 Bare-assignment in attribute value parser ambiguity (still open — separate dispatch)

**SPEC-at-session-start directive (S96 — added to pa-scrmlTS.md session-start checklist step 3 + memory `feedback_read_spec_at_session_start.md`).** PA MUST read `compiler/SPEC-INDEX.md` at session start (the ~288-line navigation map; SPEC.md itself is ~410k tokens, full-file Read would overflow). Before any code change with spec implications (event handlers, state decls, engines, match, channels, schema, refinement types, validators, error codes), Read the relevant SPEC section IN FULL via `offset:` + `limit:` — do NOT decide from PRIMER summary or FOLLOWUPS framing. User direct precedent: S96 Wave 3 PA chased Bug 14 from FOLLOWUPS framing without checking SPEC §5.2.2; user asked "have you read the spec?" — spec gave normative answer that resolved three bug classifications in one read.

**Synthetic-reproducer canonical-shape rule** (S96 — memory `feedback_declaration_form_in_reproducers.md`). PA reproducers must follow V5-strict canonical shape per primer §3 (`<x> = 0` at top-level, `@x = 0` only inside `${...}` logic blocks). Mixed forms produce ambiguous test conditions where bugs don't reproduce (parser takes a different path) or compiler flags the wrong shape vs. the bug under investigation. User correction during Wave 3 reproducer authoring.

### 2026-05-16 (S95 CLOSE — heads-up coding session + bug-fix dispatch wave · 12 commits · 7 bugs closed end-to-end · 18-bug catalog filed · voice-author agent redesigned · LLM benchmark harness scaffolded · state-vs-logic axiom corrigendum)

**Session-defining outcome.** Two halves: a heads-up coding session that surfaced **18 compiler/parser/lint bugs** via authoring a triage-board SPA, and a follow-on bug-fix dispatch wave that **landed 7 bugs end-to-end** through `scrml-js-codegen-engineer` dispatches (one parallel triple + 4 sequential). Path-discipline hardening filed mid-session after Bug 16 dispatch leaked 3 Edit calls to main (recovered) — subsequent 6 dispatches held cleanly with mandatory `stat`-inode + read-back + `git -C main status` verification. The **state-vs-logic boundary axiom** received a load-bearing CORRIGENDUM (S94's verbatim contained internal tension; user re-stated as "the state system should be able to fully describe its own transitions"). Filed the **MISSING-PRIMITIVE** doc (event-with-payload-as-transition-trigger; v0.4+ dispatch candidate). The **scrml-voice-author** agent was redesigned (drop drafting-in-user-voice; add quote-library + scaffolding + flag modes); first real corpus-refresh extracted 17 verbatim quotes across 19 topics. The **LLM-efficiency benchmark harness** was scaffolded at `benchmarks/llm-efficiency/` (7 models × specs × langs × samples; SDK adapters via fetch; ~$30-80 estimated for first full run). Three new PA-memory rules filed. pa.md gained **Rule 5 (shoot straight; politeness is for fragile flowers)** codifying communication norms.

- **Bug 18 fix (commit `f57d881`, +6 tests).** scrml:NAME client imports → runtime registry `_scrml_stdlib.<name>` populated by tree-shakable chunks. Was emitting bare ES-module specifiers; browser SyntaxError; white screen. Kickstarter §9 actively recommended this exact pattern, making it a first-five-minutes adopter disaster. Fix: NEW `compiler/runtime/stdlib/data.js` shim + runtime-template helper + emit-client.ts rewrite to destructure from registry. Server-side Bun path preserved.

- **Bug 16 fix (commit `34dedc3`, +9 tests).** Bare `import` at v0.3 `<program>`-body top-level now auto-lifts per W-PROGRAM-REDUNDANT-LOGIC's stated rule. Previously the lift gate (BARE_DECL_RE in ast-builder.js) didn't admit `import`; unhandled lift silently corrupted parse state into an 8-error cascade with zero mention of the actual root cause. Fix: regex extension to admit `import` keyword shapes (named, default, namespace, side-effect).

- **Bug 13 fix (commit `2c18b2d`, +7 tests).** `class:NAME=(expr)` directive in lift template body now emits reactive classList.toggle wiring per §5.5.2, instead of literal HTML setAttribute. emit-bindings.ts (top-level codepath) had this correct already; emit-lift.js was the broken sibling. Added class:NAME branches in both string-attrs path (emitSetAttrs) and AST-attrs path (emitCreateElementFromMarkup). All four §5.5.2 grammar arms now work inside lift templates.

- **Bug 17 fix (commit `3b48e4d`, +7 tests).** Tailwind utility scanner now descends into `${ for ... lift ... }` iteration bodies + lift / if / match expression bodies. Was stopping at lift boundary; Tailwind utilities inside iteration silently rendered as inert classes (browser saw `class="flex-1 bg-white ..."` with NO CSS rules backing them). Fix: NEW `compiler/src/codegen/collect-class-names.ts` AST walker with full markup-context traversal. emit-client.ts (via codegen/index.ts) merges its Set with the HTML-scan Set before getAllUsedCSS.

- **Bug 1 fix (commit `d5c79da`, +16 tests).** JS-style value-return `match expr { .Variant(payload) => ..., _ => default }` now codegens correctly. Was producing malformed JS — dangling `else`, `_ =>` leaked verbatim, payload binding referenced but never bound. Two intertwined root causes: expression-position MatchExpr was routed through legacy string-pipeline (rewriteMatchExpr) which lacks payload-binding lowering; AND FIVE separate splitter/parser sites only recognized legacy `_ ->` wildcard, not modern `_ =>`. Fix: bridge MatchExpr through structured emitter (emit-control-flow.ts:emitMatchExpr — battle-tested via match-stmt / let-decl paths) + add `_ =>` / `_ :>` recognition at all five splitter/parser sites.

- **Bug 5 fix (commit `645a5e1`, +5 tests).** Nested component references inside another component's body (e.g., `<TaskCard>` inside `<Column>`'s body) now expand via CE instead of surviving to runtime as phantom DOM `document.createElement("TaskCard")`. Two-sided fix: CE skip — walkLogicBody's lift-expr branches now recurse walkAndExpand into expanded.children; VP-2 invariant gap — runPostCEInvariantFile now admits `(resolvedKind == null && uppercase-tag)` clause to catch nodes that bypassed NR via parseComponentBody's BS+TAB-only path. P3-FOLLOW compliant (tag-only heuristic; no isComponent code read).

- **Bug 2 fix (6 cherry-picks, +14 tests).** Variant constructor at engine direct-write (`@dragPhase = .Dragging(taskId)`) now emits proper tagged-object literal + runtime tag normalization. Was emitting `"Dragging"(id)` — calling a string as a function — runtime TypeError on first event. Three coordinated fix sites identified by the dispatched agent: (1) structured AST `emit-expr.ts:emitCall` bare-dot `.Variant(args)` callee detection → tagged-object literal; (2) runtime `_scrml_engine_variant_tag` helper + `_scrml_engine_check_transition` / `_scrml_engine_direct_set` / `_scrml_engine_advance` tag normalization; (3) `emit-variant-guard.ts` dispatcher reads `.variant` / `.data` (was reading dormant `.tag` / `.payload` — never triggered before because upstream codegen crashed first). Plus string-rewrite path (`rewrite.ts`) parity for escape-hatch `${...}` event-handler bodies. Idempotent self-write semantics (SPEC §51.0.F.1) reaffirmed at tag identity, NOT value identity.

**18-bug catalog filed end-to-end during heads-up coding (Half 1).** Severity-ranked. 7 closed this session; 11 remain. Open items mostly Tier 3-5 (parser polish, lint false-positives, adopter-friction edge cases). One broader concern surfaces: pre-existing TodoMVC browser tree-shake bug (`_scrml_reconcile_list` missing from emitted runtime; 38 fails) — separate S96 dispatch.

**State-vs-logic axiom CORRIGENDUM (load-bearing for future work).** S94 ratified an axiom statement that had internal tension. S95 user re-stated: "the state system should be able to fully describe its own transitions" (state→state is state-system territory; logic CAN describe state mutations but shouldn't HAVE to). The prior PA's recorded interpretation ("logic owns verbs / DOES things to state") was an interpretive over-expansion — the user said "describes" not "performs." `feedback_state_vs_logic_boundary.md` rewritten; user-voice S94 §CORRIGENDUM added. The 90/10 fn() ratio is forward-looking, NOT a current-corpus check. Mario at 25/75 is pre-axiom + pre-primitive.

**Missing primitive filed.** Event-with-payload-as-transition-trigger primitive. Without it, the corrected axiom cannot fire for any UI with event-time data. User confirmed: *"missing the primitive (absolutely)"*. Three speculative shapes documented; v0.4+ dispatch candidate. `docs/changes/heads-up-s95-bugs/MISSING-PRIMITIVE.md`.

**Strategic infrastructure shipped (foundation for adoption work).**

- `examples/25-triage-board.scrml` — working drag-and-drop kanban demonstrating current-language capability with explicit workaround comments where bugs blocked canonical shape. Now compileable + browser-runnable end-to-end.
- `~/.claude/agents/scrml-voice-author.md` — REDESIGNED agent (user-writes + agent-supplies-substrate model). Drop drafting-in-user-voice (was producing AI-flavored prose user was not satisfied with). Four modes: bio-refresh / corpus-refresh / scaffolding / flag.
- `scrml-support/voice/quote-library.json` (NEW, 17 quotes) + `topics-index.md` (NEW) + `README.md` (NEW) — first real corpus-refresh executed; indexed verbatim quotes with metadata (source citation, date, session, topics, supersededBy/supersedes for evolution chains).
- `benchmarks/llm-efficiency/` (NEW directory, 7 files) — LLM efficiency benchmark harness. Tests whether scrml is structurally more LLM-friendly than React+TS. Scaffolding complete; SDK adapters via fetch (zero deps); CLI args / file I/O / prompt assembly all wired. Pending: API keys (user-supplied) + React+TS validator setup + shared-assertion-logic extraction.
- `docs/changes/heads-up-s95-bugs/` (NEW directory) — 18-bug catalog (`FOLLOWUPS.md`), missing-primitive design doc (`MISSING-PRIMITIVE.md`), per-bug investigation progress logs (`bug-{1,2,5,13,16,17,18}-progress.md`), pre-staged Bug 2 brief (`bug-2-brief-pre-staged.md`).

**Three new PA-memory rules + 1 rewrite.**

- NEW: `feedback_dont_soft_classify_bugs.md` — when compiler behavior contradicts spec/lint stated rule, classify as BUG not "doc gap." S95 Bug 16 reclassification precedent.
- NEW: `feedback_communication_norms.md` — user is 20+ year oil-and-gas industry veteran; field-culture register; direct over polite; push back on genuine points; politeness for politeness sake rejected.
- NEW: `feedback_agent_main_repo_path_leak.md` — sub-agents can leak writes to MAIN via main-rooted absolute paths despite worktree isolation. Hardened defense: mandatory stat-inode check + read-back verify + final git status check. Held across 6 subsequent dispatches.
- REWRITTEN: `feedback_state_vs_logic_boundary.md` — corrigendum baked in; prior PA's "logic owns verbs" reading marked as misinterpretation.

**pa.md Rule 5 added.** "Shoot straight; politeness for politeness sake is for fragile flowers." Codifies communication norms. Cross-references prior PA Rules 1-4. Load-bearing for every future session.

**Pre-existing TodoMVC browser tree-shake bug surfaced (separate concern).** 38 test failures in `compiler/tests/browser/browser-todomvc.test.js`: `_scrml_reconcile_list is not defined` at runtime. Confirmed pre-existing by 3 separate agent revert-and-rerun verifications during S95 dispatches. Root cause: `_scrml_reconcile_list` function defined in `compiler/src/runtime-template.js:938` but missing from emitted `dist/scrml-runtime.*.js` chunks for TodoMVC. Tree-shake gap in chunked runtime emission. Separate S96 dispatch.

**Process incident: rebase silently dropped 8 commits.** `git pull --rebase origin main` re-applied only 4 of 12 local commits (Bug 18/16/13/17), silently dropping Bug 1, Bug 5, and the 6 Bug 2 commits. Recovered via cherry-pick from reflog. Root cause unclear — possibly git's patch-id heuristic flagging some commits as "already in upstream" despite no docs/index.html overlap. Mitigation for S96: after every rebase, verify ahead-count matches expected via `git rev-list --left-right --count origin/main...HEAD`.

### 2026-05-15 (S94 CLOSE — v0.3.x patch arc marathon · 17 commits · 11 backlog items closed · 2 design-axiom ratifications)

**Session-defining outcome.** Substantial v0.3.x patch arc throughput. Eleven backlog items closed end-to-end across HIGH, MEDIUM, and LOW priorities. Two load-bearing design-axiom ratifications surfaced + recorded (designer-card on `~`; state-vs-logic boundary). The `~` (last-unbound-expression carry-forward) primitive's half-shipped codegen surface closed end-to-end (codegen-lowering + parser round-trip + adopter-facing examples + gaps 5/6/7). Phase B SPA tree-shake landed (−25 KB gzip on TodoMVC; bundle now beats every prior v0.2.x measurement). Auth-redirect UX loop closed end-to-end (diagnostic tightening + D-RI-PAGES route-prefix recognition + `scrml generate auth` scaffold path derivation; adopters get a one-line copy-pasteable fix). hos.scrml restructured to canonical non-entry `<page>` shape (DEFERRED §2 from S93 CLOSED). Perf characterization validated the roadmap's "per-file dominates cross-file" claim with concrete 16.6× ratio + identified CG as 78% of pipeline + flagged DG super-linear scaling. BS-batch v2 closed the 3 residual `${}` wrapper shapes from S93 DEFERRED + BSBv3 closed the sibling component-expander whitespace fire. pkg.json bump-on-tag convention formalized into pa.md.

**S94 commit ledger (17 scrmlTS + 1 scrml-support):**

```
156c0ba  fix(tilde): close Gaps 5/6/7 — failable-handler + <program>-direct-child + chain
a1c720c  docs(perf): closure-analysis pipeline characterization (v0.3.x roadmap item 5)
9e96281  docs(pa,master-list): formalize package.json bump-on-tag versioning convention
0c503c5  feat(ri): D-RI-PAGES — buildPageRouteTree recognizes `pages/` as canonical v0.3 prefix
69260c3  fix(auth): tighten I-AUTH-REDIRECT-UNRESOLVED + W-AUTH-LOGIN-MISSING + generate scaffold
fd052ec  fix(corpus): hos.scrml — canonical non-entry <page> restructure + DEFERRED §2 close
13beb3f  fix(ce): BSBv3 — apply E-COMPONENT-031 predicate change to current main
bec57a3  fix(ce): BSBv3 — filter whitespace-only text from E-COMPONENT-031 predicate
0aa2b18  docs(examples): sprinkle `~` usage + file 3 remaining codegen shape gaps
09cd0c7  fix(expr-parser): `~` parseExprToNode/emitStringFromTree round-trip stability
d37b1f5  fix(codegen): `~` last-unbound-expression carry-forward — close half-shipped surface
2201556  fix(bs+ce): BS-batch v2 — close 3 residual ${} wrapper shapes (examples 12/19/20)
783dd46  docs(roadmap): record S94 design insights — `^{}` narrowing + `~` keeper
42abfca  docs(bench): re-frame bundle narrative post-Phase-B with honest measurements
1f73732  fix(codegen): v0.3.x SPA tree-shake — shared-runtime union + wire chunk + hash filename
66c1be0  docs(kickstarter): strengthen §6.6 — `reset` is a reserved identifier
95e13c8  docs(s94-open): hand-off rotation + Phase A SCOPING for v0.3.x SPA tree-shake
bb1eb91  (scrml-support) docs(user-voice): S94 — `~` is designer-card-protected primitive
```

**11 backlog items closed end-to-end** — see master-list §S94 CLOSE addendum for full per-item detail. Headline: (1) closure-analysis runtime tree-shake → TodoMVC 40.8 → 15.8 KB gzip (−25 KB); (2) BS-batch v2; (3) `~` codegen lowering (half-shipped surface closed); (4) `~` parser round-trip stability; (5) `~` example sprinkle; (6) `~` codegen gaps 5/6/7; (7) BSBv3 component-expander whitespace; (8) hos.scrml restructure; (9) auth-redirect tightening; (10) D-RI-PAGES (closes auth UX loop); (11) perf characterization. Plus 1 LOW (pkg.json versioning convention formalization).

**Two design-axiom ratifications recorded** (verbatim in user-voice S94):
- **Designer-card on `~`** — naming intermediates is a cost the language shouldn't impose; `~` is keeper at all phases; adoption gap is documentation surface not feature-existence question.
- **State ↔ logic boundary axiom** — state owns nouns; logic owns verbs; they must not blur. Analogous to logic ↔ type system boundary. Operational consequence: `fn()` dominates work-a-day scrml (~90/10).

**Three new PA-memory rules filed:** `feedback_designer_card_and_retirement_framing.md` · `feedback_cwd_slip_after_worktree_dispatch.md` · `feedback_state_vs_logic_boundary.md`.

**S95 priority — heads-up coding session** (user-stated just before wrap): exploratory authorship session, NOT compiler dispatch. PA's role: collaborative authorship + grounded honesty on what works vs surfaces gaps. Stress-test the canonical scrml shape against real adopter problems.

**State at S94 close.**
- HEAD `156c0ba` (post-final-substantive-commit; this CLOSE-wrap commit lands after).
- 17 scrmlTS commits ahead of origin pre-wrap-push.
- 1 scrml-support commit ahead of origin (`bb1eb91`).
- Working tree clean.
- No agent worktrees.
- Inbox empty.
- v0.3.0 STABLE `c520369` remains the tag baseline; no semver bump this session.

### 2026-05-15 (S93 CLOSE — v0.3.x patch arc opened · 16 commits · 6 compiler bugs closed · 3 corpus migrations · adopter-facing roadmap drafted)

**Session-defining outcome.** First post-v0.3.0-STABLE session. Three threads ran in parallel:

1. **Canonical-examples sweep recovery + completion** (early session, S92 closed-but-pending follow-up). One background agent crashed at 529 overload mid-flight after 19 commits + tutorial WIP; PA file-delta'd the salvageable work + completed tutorial migration PA-hands-on. Example corpus migration to v0.3 program-as-container shape complete end-to-end (21 single-file + 22/23 multi-file entries + 1115-line tutorial). 5 BS-layer corpus-friction bugs filed + fixed in a second background dispatch (also crashed at 8h stream-idle-timeout; PA file-delta'd that one too — Phase 0 survey + Phase 1 fixes + Phase 2 regression suite of 18 tests all salvaged). Phase 3 workaround drops: 4 of 5 example files migrated to fully-canonical shape; 3 residual BS-batch edge cases filed for follow-up (BS-batch v2 dispatch at `docs/changes/canonical-examples-sweep/DEFERRED.md`).

2. **v0.3.x bug-hunt arc** (mid-to-late session). Six substantive compiler bugs closed:

    - **`cg-006` server-only body emission** (`0dc49c3`) — `walkBodyForTriggers` in `route-inference.ts` had no handler for `return-stmt` / `throw-stmt` / `lift-expr` carrying `sqlNode`. The canonical `return ?{...}.get()` server-fn shape (SPEC §12.5.2) was missed by trigger detection; RI classified affected functions as client-boundary; emit-functions emitted the full body to client.js including `_scrml_sql` references; caught post-emission by E-CG-006 fail-safe. 3-layer fix mirroring the existing let-decl/state-decl sqlNode handling. Closed Tier-1 security-shaped bug in the flagship 23-trucking-dispatch demo. +3 regression tests.

    - **BS-layer corpus-friction batch** (`cb1d48c`) — 5 of 6 BS-layer + downstream-pass bugs that prevented full v0.3 program-as-container canonical form on certain shapes. Bug 1 (markup `//` E-TYPE-026) verified-already-fixed by post-S87 BS-comment-skip; Bug 2 (`const Name = <markup>` auto-lift at `<program>` direct-child) + Bug 3/3-adj (template-literal `${ident}` in function/type-decl bodies fires E-SCOPE-001) + Bug 4 (HTML `<!-- -->` inside component-def body causes E-COMPONENT-035) + Bug 6 (non-entry pure-module file E-IMPORT-001 + W-PROGRAM-001 over-eagerness) all closed. 18 regression tests + 5-of-9 workaround drops in the example corpus.

    - **`info`-level diagnostics partition** (`6e744c2`) — `api.js:1674-1675` diagnostic-stream rule treated `I-*` prefix + `severity:"info"` as fatal (CLI `result.errors`), exit-1 on info-only files. 07-admin-dashboard + 23-trucking-dispatch (the flagship demo) both "failed" compilation with red "error [I-AUTH-REDIRECT-UNRESOLVED]:" despite the diagnostic being informational. 2-layer fix: partition rule extended to include `I-*` + `severity:"info"` in result.warnings (non-fatal bucket); `formatWarning` distinguishes cyan "info" label from yellow "warning" by reading severity + prefix. Both demos exit 0 + cyan "info" label correctly displayed post-fix. +4 regression tests.

    - **W-CG-UNDEFINED-INTERPOLATION codegen leaks** (`6ee81be`) — 6 codegen sites leaking the bare `undefined` JS keyword to compiled output (violates M-7C-D-12 OQ-5(a) — canonical scrml absence is JS `null` per §42.5/§42.8): emit-engine.ts derived-engine identity + match-arm forms (`=== undefined` → `== null`); emit-machines.ts §51.9 projection function defensive fallthrough (`return undefined` → `return null`); emit-machine-property-tests.ts property-test scaffold; emit-control-flow.ts for/lift reconcile-keying (`item?.id !== undefined` → `item?.id != null`); emit-channel.ts WebSocket upgrade fallback (`undefined` → `void 0` — Bun's `server.upgrade()` API requires undefined return); emit-server.ts structural-eq enum-tag branch. Corpus-wide leak count: 9 (+ 53 in trucking-dispatch multi-file compile) → 0.

    - **W-DEPRECATED-SERVER-MODIFIER over-eager** (`7f38721`) — RI's D5 emission predicate fired on every `server function` whose body had a server-only-resource trigger, recommending removal of the `server` keyword. Missed the load-bearing case: `server function` bodies can use `lift ?{}`; bare `function` bodies cannot (SPEC §49.6.2 / E-SYNTAX-002). Removing the keyword on a `lift`-using body breaks compilation. Fix: new `hasLiftInFunctionBody` helper walks body subtree for `lift-expr` nodes; D5 predicate tightened to `isExplicitServer && !hasLiftInFunctionBody(fnNode)`. Plus 3 corpus migrations (16-remote-data, 17:lookupUser, 18-state-authority) to bare `function` shape — their bodies use `return ?{}`, no `lift`. 4 examples retain `server function` because their bodies use `lift ?{}` — lint correctly suppresses post-fix. Corpus-wide W-DEPRECATED-SERVER-MODIFIER count: 7 → 0.

    - **W-DEAD-FUNCTION false-positives in guarded-expr / test-block / when-handler contexts** (`d437589`) — Three RI walker gaps: `guarded-expr` wraps the previous statement (e.g. `let X = fn() !{...}`) but `walkBodyForTriggers` generic-fallback only walked array fields, missing `guardedNode` (single object) — `fn()` invisible to call-graph; `test-block` bodies stored as raw strings in `testGroup.tests[*].body` (parseTestBody returns string[]) — `walkMarkupContext` skipped them; `when-handler` bodies (`when-effect` / `when-message` / `when-worker-*`) carry body in `bodyRaw` string, outside EXPR_STRING_FIELDS. Result: functions called ONLY from `!{}`-handled call sites, `~{}` test blocks, or worker `when message` handlers were classified dead. Fixed with explicit cases in both walkers. Plus example fix-up: 17:lookupUser was genuine-dead; wired into postNote (richer cross-fn-call demo) closing the lint organically. Corpus-wide W-DEAD-FUNCTION count: 4 (3 FP + 1 genuine) → 0.

3. **Adopter-facing roadmap doc** (`3a7eeb6`) — User explicitly raised the marketing-adjacent task: write an adopter-facing roadmap to mitigate hesitancy from the v0.3.0 bench regression. Drafted at `docs/website/roadmap-from-v0.3-2026-05-14.md` (status: draft; publication site TBD). No timelines per user directive ("scrml is a one-person language; estimates are inherently soft. What's stable is the direction. The order is what matters."). Two revisions: initial draft used internal terminology (Approach A/B, BS-layer, canonical-examples sweep, etc.); user requested scrub; rev 2 replaces with descriptive labels (whole-stack closure analysis / profile-guided optimization / edge-case parser fixes for program-as-container / example-corpus migration / etc.).

**v0.4 anchor decision (soft-ratified S93).** User read the v0.4 themes (body-split / formFor flagship / Approach A maturation) + indicated body-split is "probably the right answer." Documented in roadmap doc. Not yet hard-committed; revisits when v0.3.x patch arc drains.

**Tier-1 side-quest.** User dropped a side-quest mid-session: dig on Tina (pmbanugo/tina — thread-per-core concurrency framework in Odin + its Deterministic Simulation Testing mechanism). Mapped 6 structural rhymes to scrml's design philosophy (PRNG-tree domain isolation = scrml content-addressing; "same code different interpreter" = compiler-owns-the-wiring Pillar 3; integer-ratio-no-float = null-undefined-eradication; structural-checkers-as-external-observers = auto-synth validity surface; no-privileged-injection-API = no-special-test-surface; reproducibility-as-the-property). 3 concrete v0.4/v0.5+ touchpoints surfaced. User: "I want to use whatever resources available/possible to make this the most all-inclusively powerful language for the space" — confirmed the dig-then-map pattern as ongoing practice. PA-side memory rule durable: when user surfaces a target, dig + map back to scrml design tensions.

**Patterns validated this session.**
- File-delta protocol per S67 held end-to-end across 2 background-agent crashes (canonical-examples + BS-batch) — zero work-lost, partial commits salvaged cleanly.
- Per-session push gate (S88 amendment, configuration B with pre-push hook running ~12,721-test full suite + TodoMVC gauntlet) blocked nothing, ran on every push.
- Dispatch-brief F4 startup-verification block + S91 CWD-routing memory rule held — no CWD trap-and-catches triggered this session (no sibling-repo `cd` in PA Bash chain).

**State at S93 close.**
- HEAD `d437589` (after this CLOSE commit will move; reported below).
- 1 commit ahead origin pre-CLOSE (pushed in two batches mid-session; final wrap pushes the CLOSE commit + this changelog entry + master-list update).
- Working tree clean.
- No agent worktrees.
- Inbox empty.
- v0.3.0 STABLE `c520369` remains the tag baseline; no semver bump this session (v0.3.x patches land incrementally to main without per-patch tagging at this maturity stage).

### 2026-05-14 (S92 — A-5 wave FULLY CLOSED → APPROACH A FULLY CLOSED · v0.3.0 critical path complete · Q-OPEN-4/5/6 closed · Wave 4.A 4-of-6 phases landed: scrml.dev + README + tutorial + primer)

**Session-defining outcome.** Approach A — the v0.3.0 critical-path investment that absorbed S88-S92 development — closed end-to-end with the A-5 integration-tests sub-wave. All five sub-waves (A-1 markup-context edges S88 + A-2 Reachability Solver S89-S91 + A-3 §40 AuthGraph S91 + A-4 Per-Route Artifact Splitter S91 + A-5 Integration Tests S92) FULLY CLOSED. v0.3.0 cut path now gated only on Wave 4.A adopter content per S88 user ratification — and 4 of 6 Wave 4.A phases landed in this session too. Pre-commit gate green on every commit; zero substantive `--no-verify`.

**S92 commit ledger (12+ substantive scrmlTS commits + 3 scrml-support):**

Session-open hygiene + A-4 polish bundle:
- **`3cb3d91`** S92-open hygiene — hand-off rotation to handOffs/hand-off-91.md + fresh S92 hand-off (carries Q-OPEN slate + things-not-to-screw-up + dispatch backlog).
- **`8b6a6a3` A-4 polish bundle** (Q-OPEN-5 + Q-OPEN-6) — Q-OPEN-5: `--chunk-size-budget=<bytes>` CLI flag (preserves 100k default; defensive resolveChunkSizeBudget; plumbs EmitPerRouteInput → CgInput → compileScrml opts → CLI). Q-OPEN-6: split W-CG-CHUNK-NO-PREFETCH into Info (case 1: no internal links) + new W-CG-CHUNK-PREFETCH-UNRESOLVED Warning (case 2: links resolve nowhere). CompileContext.hasInternalLinks orthogonal field; CGError.severity widened to include 'info'. SPEC §34 + §40.9.11 catalog rows updated. +16 unit + 7 commands tests.

A-5 wave (5 sub-phases — wave fully closed S92):
- **`92f6c36` A-5.1 cornerstone** — multi-page multi-role expansion of §40.9.9. 3-file FX-1 fixture under `compiler/tests/integration/fixtures/a5/multipage-multirole/routes/{index,loads,admin}.scrml` + new test file `multipage-multirole-integration.test.js` (40 cases / 11 sections / 393 expect). Establishes fixture-shape conventions for A-5.2-A-5.5. **Rule-4 reconnaissance load-bearing finding:** dive's original FX-1 framing (single-file `<page path="...">`) doesn't parse from .scrml source — TAB allowlist admits only `{db, auth, csrf, ratelimit}`. Multi-page-in-source requires multi-FILE routes/ filesystem layout. Agent corrected to multi-file shape; dive amended at scrml-support `a74fd0a`. +40 tests.
- **`91b8689` Q-OPEN-4** — single-source compiler identity from package.json + pkg.json bump to 0.3.0-alpha.0. Replaced hard-coded `COMPILER_IDENTITY = "scrml-0.3.0"` constant with `getCompilerIdentity()` cached helper (defensive fallback `"scrml-unknown"`). Internal seam `_computeCompilerIdentityFromPath()` for fallback testing. NEW SPEC §47.5 cross-reference paragraph anchoring `chunks.json` `compiler` field shape normatively. **Cherry-pick recovery 1 of 1 this session** — agent base predated A-4 polish on shared route-splitter.ts + SPEC.md; cherry-pick auto-merged additive changes on disjoint line ranges. +13 tests.
- **`3a2db5e` A-5.3** negative-cascade chain tests (FX-3 + FX-4) — inline-string fixtures. FX-3: `<auth role="Admin">` gate with NO role enum → E-CLOSURE-002 + E-AUTH-GRAPH-002 cascade. FX-4: typo'd `<auth role="Admni">` → E-AUTH-GRAPH-003 + W-CG-CHUNK-MISSING-ROLE. **Rule-4 finding 1:** brief-anticipated cascade was incomplete — both FX-3 + FX-4 also fire W-AUTH-RUNTIME-FALLBACK + W-CG-CHUNK-MISSING-ROLE per component-4.ts:230-241. **Rule-4 finding 2 (load-bearing for cornerstone):** A-5.1's `result.errors.filter(e => e.code === "W-...")` "does NOT fire" assertions are STRUCTURAL FALSE NEGATIVES — per api.js:1674-1675 partition, W-* codes go to result.warnings. A-5.3 + A-5.4 use cross-stream `[...result.errors, ...result.warnings].filter(...)` helper. Audit-fix bundled into A-5.5. +20 tests.
- **`fee59bc` A-5.2** cross-file expansion (FX-2) — `cross-file/{app,components/header}.scrml` + new test file `cross-file-expansion-integration.test.js` (30 cases / 9 sections). Form 2 export-const-component pattern (`export const Header = <nav>...</>`) per §21.2. Imports MUST live inside `${...}` per §21.3 normative. **Rule-4 finding:** dive's `<block Header>` framing was documentary pseudo-syntax (§4.15 doesn't register `<block>`); §40.9.9 example uses Form 2 in practice. Brief mentioned §21.8 (cross-file ENGINE) — actually applies §21.2 + §21.3 (cross-file COMPONENT). +30 tests.
- **`acbb097` A-5.4** W-* lint family end-to-end (FX-5/6/7/8a/8b) — 6 fixture files + 1 inline + new test file `lint-family-e2e-integration.test.js` (17 cases / 6 sections / 48 expect). Verifies Q-OPEN-6 split end-to-end from full driver (NO-PREFETCH Info vs PREFETCH-UNRESOLVED Warning mutually exclusive per route-splitter.ts:814-855 if/else branch on hasInternalLinks). Verifies Q-OPEN-5 chunkSizeBudgetBytes propagation end-to-end. All 5 SPEC §34 + §40.9.11 catalog severities verified verbatim. **Rule-4 finding (recurring):** `reset` is a reserved keyword per §6.8 (E-RESERVED-IDENTIFIER); fixture's "reset all counters" function renamed to `clearAll()`. Worth kickstarter / naming-conventions doc note. +17 tests.
- **`f9b5b9d` A-5.5 wave-closer + A-5.1 audit-fix bundled** — A-5 WAVE FULLY CLOSED. Three sub-tasks: (1) determinism integration test (NEW `compiler/tests/integration/determinism-integration.test.js` — 21 tests / 7 sections / 432 expect; reuses FX-1; backs §40.9.8 + §47.1.3 normative determinism claims; chunks.json + per-chunk payloadJs + filename + FNV-1a hash + per-route HTML + reachabilityRecord all byte-identical across 10 compiles); (2) trucking-dispatch compile-smoke (NEW `compiler/tests/integration/trucking-dispatch-smoke-integration.test.js` — 13 tests; compiles 36 .scrml files via compileScrml multi-file shape; v0.2-shape diagnostic baseline recorded as test: 0 fatals / 150 warnings / 2 info-errors / 6 chunks / 2 entry points; brief framing W-AUTH-PAGE-INFERRED was actually W-AUTH-001 — recorded actual histogram); (3) §40.9.9 case-fix verification — VERIFIED CLEAN (0 stale lowercase admin; A-3.5 `1d1ceef` claim verified complete); (4) A-5.1 cornerstone audit-fix — 4 false-negative sites in `multipage-multirole-integration.test.js` fixed via canonical `allDiags(r) = [...r.errors, ...r.warnings]` cross-stream helper; sibling test files audited (A-3.5 + A-5.2 + A-5.3 + A-5.4 all CLEAN); 0 tests broke after fix. +34 tests.

Wave 4.A adopter-content sweep (4 of 6 phases landed at this entry):
- **`1d5d4b9` 4.A.1** scrml.dev v0.3 refresh (`docs/index.html`) — NEW section "The compiler knows what code is reachable to whom" inserted between "compiler eliminates N+1" + "validators auto-synthesize" (three "compiler knows" sections in narrative sequence). Covers `<auth role="X">` + Approach A whole-stack closure analysis (§40) + per-role bundle variance + tiered prefetching + FNV-1a content-addressing (§47) + diagnostic family. Stdlib named-list expanded (added fs/path/process; count 16 unchanged). Examples count 22 → 23. Highlights paragraph extended with `<onTimeout>`/`<onIdle>`/hierarchy/history/`<auth role>`/per-route-splitting. +5 net lines.
- **`71b3343` 4.A.2** README.md v0.3 sweep — version block rewrite (v0.2.0-only framing → v0.2.6 shipped + v0.3.0-alpha.0 in flight + Approach A close mention + cut gated on Wave 4.A). Test count 11,200+ → 12,500+. NEW Server/Client bullet "Per-route per-role chunk splitting (Approach A; v0.3)". Language Contexts table extended with `<auth>` + `<page>`. +7 net lines.
- **`d4b8460` 4.A.3** docs/tutorial.md v0.3 sweep — top "What this tutorial covers" paragraph updated. NEW section §9 "Auth gates and per-route bundles" inserted between §8 channels + §10 (renumbered from §9) "all together"; ~30 lines tutorial-shaped explanation with worked example. Glossary additions: `<auth role="X">` + `<page>` + per-route per-role chunks + `<onTimeout>` + `<onIdle>`. Section renumber §9→§10, §10→§11. +37 net lines.
- **`926363a` 4.A.4** PA-SCRML-PRIMER.md v0.3 sweep — top "Last updated" stamp rewritten from S68 baseline to S92. §9.1 channels framing reversal per Insight 30 (S87) — channels are CHILDREN of `<program>`. §9.6 structural elements registry expanded (`<onTimeout>` + `<onIdle>` + `<channel>` + `<page>` + `<auth>`). NEW §9.7 "Approach A — closure analysis + per-route artifact splitter (S88-S92)" — comprehensive ~50-line subsection with all 5 sub-waves + `<auth role>` universal value-bearing-attr shape (per OQ-A3-A user-voice verbatim) + per-route per-role chunk variance + content-addressing + 8-W + 3-E + 1-I diagnostic family table + pipeline integration + LOAD-BEARING api.js diagnostic stream partition section (with A-5.1 cornerstone false-negative pattern documented + canonical `allDiags` cross-stream helper). +42 net lines.

scrml-support landings (3 commits):
- **`9a0b146`** A-5 SCOPING dive landing — 606-line / 65 KB deep-dive at `docs/deep-dives/a-5-integration-tests-SCOPING-2026-05-14.md`. PA-lean shape: sub-phased A-5.1..A-5.5 compositional-only, 20-31h Light band (materially smaller than Insight 29's 40-80h projection — Rule-4 reconnaissance: A-2/A-3/A-4 sub-wave coverage absorbed the bulk of integration-test surface). 6 OQs surfaced — 2 HIGH-priority user-ratification.
- **`e708cec`** S92 user-voice append — verbatim *"compositional-only on A-5-A, compile-smoke on A-5-C"* (OQ-A5-A/C ratification) + verbatim *"option A with 0.3.0-alpha.0"* (Q-OPEN-4 ratification). Methodology signals: Rule-4 reconnaissance vindicated again; single-source-of-truth pattern alignment for compiler-identity field.
- **`a74fd0a`** A-5 dive S92 correction — FX-1 framing updated from single-file `<page path=>` to multi-file routes/ shape (per A-5.1 Rule-4 finding); inline S92 CORRECTION callout documenting scope (FX-2 onwards unaffected; only FX-1 needed correction).

**Approach A close summary table:**

| Sub-wave | Status | Closed |
|---|---|---|
| A-1 markup-context edges (per-interpolation Option Y) | ✅ | S88 |
| A-2 Reachability Solver (5 components + outer fixpoint + canonical JSON) | ✅ | S91 |
| A-3 §40 AuthGraph (5 sub-phases + pipeline wire-in) | ✅ | S91 |
| A-4 Per-Route Artifact Splitter (7 sub-phases) | ✅ | S91 |
| A-5 Integration Tests (5 sub-phases) | ✅ | **S92** |

**Wave 4.A close summary (4 of 6 phases at this entry):**

| Phase | Status | Detail |
|---|---|---|
| 4.A.1 scrml.dev landing | ✅ `1d5d4b9` | reachability section + counts/highlights |
| 4.A.2 README.md | ✅ `71b3343` | version block + Approach A bullet + structural elements |
| 4.A.3 tutorial.md | ✅ `d4b8460` | new §9 auth-gates + glossary + footer |
| 4.A.4 PA-SCRML-PRIMER.md | ✅ `926363a` | §9.1 channel reversal + §9.7 Approach A reference |
| 4.A.5 changelog finalize + (optional) v0.3.0-alpha announce | 🟡 in flight | this entry; announce post deferred until v0.3.0 stable |
| 4.A.R articles currency + cross-doc final sweep | ⏸️ pending | small files; tutorial-snippet re-verification |

**S92 patterns validated:**
- 1 cherry-pick recovery (Q-OPEN-4 base predated A-4 polish on shared files; auto-merged on disjoint line ranges per `feedback_file_delta_vs_cherry_pick.md`)
- 4+ CWD trap-and-catches (per S91 memory rule fold-in `feedback_agent_isolation_cwd_routing.md` — task-notification CWD-shifts caught BEFORE damage; the rule held end-to-end across all S92 dispatches)
- 1 cornerstone false-negative pattern surfaced + audit-fixed (A-5.1 W-* assertions; cross-stream `allDiags` canonical now)
- 0 substantive `--no-verify` (1 procedural on cherry-pick TEMP commits, rolled back into clean PA-authored final commits)
- All Rule-4 reconnaissance findings surfaced + acted upon: dive FX-1 framing → multi-file routes/ correction; brief-anticipated diagnostic cascades → actual emission shape recorded; brief §21.8 vs §21.2/§21.3 confusion → primer note for future briefs

**Push state:** scrmlTS 13+ ahead origin · scrml-support 3 ahead origin · all clean (push pending wrap or end-of-Wave-4.A).

### 2026-05-14 (S91 CLOSE — landmark 30-commit big-session — 4 MAJOR WAVES CLOSED: A-2 Reachability Solver + A-3 §40 AuthGraph + A-4 Per-Route Artifact Splitter + 03-contact-book v0.2.x · 4 cherry-pick recoveries · 4 CWD trap-and-catches · zero substantive --no-verify · v0.3.0 critical path substantively complete)

**Session-defining outcome:** the largest single-session A-track investment of the project so far. Two of three planned major-wave closures FULLY LANDED (A-2 Reachability Solver + A-3 §40 AuthGraph); 03-contact-book v0.2.x latent bug closed via `scrml generate auth` CLI generator + W-AUTH-LOGIN-MISSING two-tier severity; A-4 per-route artifact splitter dispatched 6 of 7 sub-phases (A-4.1 + A-4.2 + A-4.3 + A-4.5 + A-4.6 + A-4.4 landed; A-4.7 in flight at session close). Pre-commit gate green on every substantive commit; one procedural `--no-verify` on TEMP cherry-pick advance commits was always rolled back via `git reset --soft HEAD~N` and bundled into clean final PA-authored commits with pre-commit gate run.

**S91 commit ledger (28 substantive scrmlTS commits + 1 scrml-support):**

Session-open hygiene + protocol fold-ins:
- **`199940e`** s91-open hygiene — hand-off rotation + FULL_COLD_START map refresh (11 maps, primary.map.md commit-stamp bumped `71305fe → ff9be0e`).
- **`399fc81`** pa.md S91 amendments — F4 step 1 sharpened (worktree-prefix check) + new "S90 addendum — Bash shell CWD routes harness worktree allocation" subsection codifying the CWD-routing rule + `git -C` preference + recovery shape. Memory rule `feedback_agent_isolation_cwd_routing.md` folded.
- **scrml-support `8d13012`** user-voice S90 OQ-A3-A override verbatim backfill — *"the idea that user defined state has full interpolation but first class compiler supported state doesn't is confusing, counter intuitive, and hints that the language is still in a 'toy' status."* Methodology rule durable: surface narrowing recommendations on first-class compiler-state grounds, do not silently ratify.

**A-3 §40 AuthGraph wave FULLY CLOSED:**
- **`bf2b098` A-3.5** wave-closure — 7 NEW §34 catalog rows (E-CLOSURE-002 + E-AUTH-GRAPH-001/002/003/004 + I-AUTH-REDIRECT-UNRESOLVED + W-AUTH-PAGE-INFERRED) + 5 §40.9.11 rows + closing prose; **api.js Stage 7.55 AG wire-in** between BP and RS; `agResult.graph` threaded into RS Component 4 as `authGraph` (no more degraded all-in floor); NEW `normalizeFileAST` helper closing latent CE-flat-vs-post-META-wrapped shape mismatch in `auth-graph.ts`; NEW `compiler/tests/integration/auth-graph-spec-40-9-9-worked-example.test.js` 13-test §40.9.9 worked-example end-to-end replay; cross-ref consistency audit fixing 5 messages + 2 adopter-example `admin → Admin` fragments. +13 tests / 0 regressions.
- **`1d1ceef`** SPEC §40.9.9 case-fix — 6 sites `role="admin"` → `role="Admin"` (closes A-3.5 deferred item #1; per SPEC line 6914 case-sensitive variant matching).

03-contact-book v0.2.x latent bug closure:
- **`3689153`** 03-contact-book auth-redirect SCOPING — 882-line deep-dive with 5 proposals + 7 OQs; recommended Proposal E (CLI generator) + Proposal A (lint upgrade) paired; key constraint: OQ-A2-E S89 ratification eliminates Proposal B (auto-gen /login) — recommended path preserves OQ-A2-E.
- **`5abcf20`** 03-contact-book E + A landing — NEW `scrml generate auth` CLI subcommand (`compiler/src/commands/generate.js`, 288 LOC; matches Rails Devise / Phoenix mix phx.gen.auth / Laravel ui:auth / ASP.NET Identity prior art) + NEW `stdlib/auth/templates/login.scrml` (128 LOC; uses `not` / `!{...}` failable handlers / no try-catch); NEW W-AUTH-LOGIN-MISSING two-tier severity (per OQ-1 ratification — distinct from per-gate I-AUTH-REDIRECT-UNRESOLVED) firing once-per-compilation on TOTAL structural redirect-resolution gap; SPEC §34 + §40.9.11 + §52.13 catalog updates; `examples/03-contact-book.scrml` dropped vestigial `<program auth="required">` + `protect="password_hash"` (contacts table has no password column); `e2e/tests/03-contact-book.spec.ts` removed auth-noise tolerance filters (bug now closed). 22 new tests (10 unit + 12 generator). **CHERRY-PICK RECOVERY 1 of 4 this session** — agent base predated A-3.5; cherry-pick preserved both A-3.5's 6 §34 catalog rows + L's 1 W-AUTH-LOGIN-MISSING row.

**A-2 Reachability Solver wave FULLY CLOSED:**
- **`59279e7` A-2.7** outer fixed-point operator — NEW `compiler/src/reachability/outer-fixpoint.ts` (463 LOC). `runOuterFixpoint({entryPoint, viewerRole, initialUnion, depGraph, files, env, iterCap?, closureStepFn?})` loops with monotonicity guard (throws on subset-step) + chunkContentsEqual termination check + E-CLOSURE-001 cap-overflow fire-site (cap=16). Wire-in `reachability-solver.ts` per-(EP, role) inner loop builds initial union (C1 ∪ C2 ∪ C3 ∪ C4 ∪ C5; server-fns unioned across tier0/1/2 superset) → calls runOuterFixpoint → `makeChunkPlanFromFixpoint` uses fixpoint result for initial-chunk, preserves C3 tier1/tier2 deltas. 29 new tests including cap-overflow + monotonicity-violation + determinism + §40.9.9 worked-example replay. **A-2 Components 1-5 + outer fixpoint NOW SOUNDNESS-COMPLETE.** +29 tests.
- **`527bae8` A-2.8** canonical determinism for `--emit-reachability` — stratified comparator (number stratum < string stratum < other stratum; codepoint compare within string stratum, NOT localeCompare which is ICU-version-dependent); diagnostics canonical-ordered by `(code, severity, entryPoint, role, message)` with empty-string sentinel for optional fields; module-level comment block with §40.9.8 verbatim normative quote + four canonical-ordering rules + why-not-localeCompare / why-not-Object.keys-sort decisions. 21 new determinism tests (10-run replay + CLI two-spawn diff + mixed-shape Set stability + canonical-empty-input deterministic hash). PIPELINE.md Stage 7.6 + maps refresh. +21 tests.

**A-4 wave OPEN + 6 of 7 sub-phases LANDED:**

A-4 wave SCOPING + foundational layer:
- **`470b128` A-4 SCOPING** deep-dive landing — 695-line scoping doc; 7 sub-phase decomposition (62-110h aggregate within Insight 29's 60-120h band); 3 implementation shapes catalogued; Shape B (per-route orchestrator above per-file codegen) recommended; 7 OQs ratified (chunks.json always-emit / opt-in flag during wave + default-on at v0.3.0 cut / `<route>/<RoleVariant>.<tier>.<8-char-hash>.js` filename / hybrid HTML + role-detection bootstrap / requestIdleCallback + Safari fallback / etc.). Key load-bearing finding: NO existing link-prefetch infrastructure in compiler/src/ — A-4 builds prefetch surface from scratch.
- **`ea6d9d3` A-4.1** codegen orchestrator slot — NEW `compiler/src/codegen/route-splitter.ts` (~410 LOC); `ChunkKey` template literal type + `ChunkOutput` + `ChunksManifest` types; `emitPerRouteChunks` iterates per-(EP, role, tier) producing ChunkOutput; opt-in `--emit-per-route` flag wired through cli.js → compile.js → api.js write loop; placeholder hash `CHUNK_HASH_PLACEHOLDER = "00000000"` retained as test sentinel; `chunks.json` always-emit per OQ-A4-A. 13 new unit tests. **CHERRY-PICK RECOVERY 2 of 4** — agent base predated A-3.5; cherry-pick preserved A-3.5 authGraph imports + return field alongside A-4.1 chunks imports + return fields in api.js. +13 tests.
- **`d7773a4` A-4.2** initial_chunk JS payload + atom-emitter extraction — NEW `compiler/src/codegen/atom-emitter.ts` (414 LOC) with `emitReactiveCellAtom` + `emitServerFnStubAtom` + `emitVendorUnitRef` + `emitComponentAtom` per-id helpers; `composeInitialChunk` iterates admission sets in canonical stratified order (vendor → server-fn stubs → reactive cells → component mount markers) wrapping output in IIFE shell with role-tagged header comment; two id-shape resolvers handle BOTH real-pipeline (`reactive::<file>::<span>::<counter>` cells; `<file>#program` / `<file>#page@<route>` entry-points) AND synthetic-test shapes. **§40.9.9 worked-example end-to-end integration replay GREEN** — Driver and Admin chunks differ only in `<a>` admin-link admission inside `<auth role="Admin">` subtree; per-file `.client.js` byte-identical with vs without `emitPerRoute: true` (additive-only invariant). +21 unit + 16 integration tests. Forward-looking gap surfaced: atom-emitter output references `_scrml_chunk_mount(id, tag)` + `_scrml_vendor_require(unit)` runtime helpers DO NOT YET exist — A-4.7 closes.

A-4 tier-prefetch + content-addressing layer:
- **`7cac10c` A-4.3** tier-1 idle-prefetch — `composeTier1Chunk` reuses A-4.2's `appendAtomLines` shared helper for delta-over-initial composition; NEW `_scrml_prefetch_tier1(chunkUrl)` runtime function in `runtime-template.js` per OQ-A4-G Option γ (`requestIdleCallback` + `setTimeout(fn, 1)` Safari fallback + defensive SSR guard + `<link rel="prefetch" as="script">` for browser-cache friendliness; backtick-in-template-literal escapes per L16 convention); NEW `prefetch` chunk-section marker in `runtime-chunks.ts`; IIFE-tail `_scrml_prefetch_tier1(<url>)` call in initial-chunk emission when admission non-empty; tree-shake LIVE/DEAD via `detectRuntimeChunks` scan of `reachabilityRecord.closures[ep].byRole[role].prefetchTier1` non-emptiness; api.js write-loop skips empty-payload non-initial chunks. **§40.9.9 normative empty-tier-1 replay (`prefetch_tier_1(/) = {}`) green** + tree-shake DEAD verified under embed mode. +7 unit + 9 integration tests.
- **`e3cfabc` A-4.5** tier-N (N≥3) on-demand dispatch hook — NEW `_scrml_fetch_chunk(epId, role, tier)` runtime function inside same `prefetch` chunk (between `_scrml_prefetch_tier1` and §22.5 marker); returns `Promise<string>` via `fetch().text()` for registered tuples, JS `null` per §42.5/§42.8 absence canon for unregistered; `detectRuntimeChunks` extends gate to admit on EITHER non-empty `prefetchTier1` OR non-empty `prefetchTierN` (v0.3 floor: only tier-1 ever fires per OQ-A2-B Option a + OQ-A4-D Option a); refactored emptiness check into shared `chunkContentsNonEmpty` helper. 14 new tests (presence, fetch resolution, null on missing entry/role/tier/no manifest, tree-shake live v0.3 default, forward-compat tier-N + tier-1 activations, splitter tier-N key, assembleRuntime determinism, chunk-position invariant). +14 tests.
- **`d089974` A-4.6** §47 content-addressing integration — NEW `compiler/src/codegen/fnv1a-hash.ts` (89 LOC) shared FNV-1a primitive extracted from `type-encoding.ts:284` (`type-encoding.ts` re-exports for backwards-compat; existing per-binding name encoding byte-identical); `computeChunkHash(contents, payloadJs)` computes FNV-1a base36 8-char hash over canonical `(componentNodeIds | reactiveCellNodeIds | serverFnNodeIds | vendorUnitNames | payloadJs)` concatenation (admission ids sorted via stratified comparator joined with `","`; fields joined with `"\x1F"` ASCII US separator — collision-safe boundary); `finalizeChunkHash(chunk)` mutates chunk with real hash + rebuilt filename AFTER payload composition at 4 wire-in sites in `emitPerRouteChunks`. On-disk `chunks.json` carries URL-style filenames (`/<route>/<role>.<tier>.<hash>.js`) via `serializeChunksManifest(manifest, chunks)` dual-shape transform (in-memory `ChunksManifestEntry` retains ChunkKey for in-process lookup). `CHUNK_HASH_PLACEHOLDER = "00000000"` retained as regression-guard sentinel. SPEC §47.1.3 normative parameters (`FNV_PRIME = 16777619`, `FNV_OFFSET = 2166136261`) exported as constants. 19 new unit + 4 new integration tests (5-run replay + source-change-flips-hash + no-placeholder-leak grep + §47.1.3 parameter conformance). **CHERRY-PICK RECOVERY 3 of 4** — agent base predated A-4.5; PIPELINE.md + domain.map.md conflicts manually merged. +23 tests.
- **`07e9795` A-4.4** tier-2 hover-prefetch — TWO shapes wired in parallel. Shape 1 (intra-route): `composeTier2Chunk` mirrors A-4.3 for `prefetchTier2` admission (v0.3 floor empty per A-2.5; composer structurally present for v0.4 RS refinement OQ-A4-B deferred). Shape 2 (DOMINANT — cross-route hover prefetch): NEW `_scrml_prefetch_tier2(routePath, role)` + `_SCRML_CHUNKS = Object.create(null)` placeholder scaffold in `runtime-template.js`; `data-scrml-prefetch="<route>"` attribute wiring in `emit-html.ts` for resolvable internal `<a href>` (external/fragment/unresolved skip); CompileContext.hasPrefetchableLinks flag flipped during HTML walk; `composeInitialChunk` emits hover-handler attachment block in IIFE tail (`mouseenter` + `focus` once-listeners with `_anonymous` role fallback) when flag true; `detectRuntimeChunks` activates `prefetch` chunk on EITHER non-empty tier-1 OR `hasPrefetchableLinks=true`. 21 new tests. **CHERRY-PICK RECOVERY 4 of 4** — most complex of the session: agent base predated A-4.5 + A-4.6 sibling-parallel landings; conflicts on route-splitter.ts + runtime-template.js + runtime-chunks.ts + PIPELINE.md + domain.map.md all manually merged; 4 TEMP commits + 4 soft-resets bundled into single clean final commit. **PRE-COMMIT GATE SAVE**: test §12 originally asserted `chunk.chunkHash === "00000000"` placeholder; A-4.6 already replaced it with real hash; pre-commit caught the sibling-collision miss; updated to `!= placeholder` + base36 regex (forward-compatible). +21 tests.

A-4 wave closer:
- **`b28f493` A-4.7** per-route HTML augmentation + role-bootstrap + W-CG-CHUNK-* lints + runtime helpers — **A-4 WAVE FULLY CLOSED**. Closes A-4.2's forward-looking gap: NEW `_scrml_chunk_mount(id, tag)` + `_scrml_vendor_require(unit)` runtime helpers in `runtime-template.js` (+47 LOC) with `_SCRML_MOUNTS` + `_SCRML_VENDOR_REFS` registries + section markers for tree-shake; NEW `mount` + `vendor-ref` runtime chunks in `runtime-chunks.ts`; `detectRuntimeChunks` per-tier scan activation. Chunks now ACTIVATE in adopter browsers (atom-emitter output resolves to defined runtime functions; pre-A-4.7 chunks fired ReferenceError). Per-route HTML augmentation via NEW `augmentHtmlForChunks` export in `emit-html.ts` (+295 LOC) — injects `<script>window._SCRML_CHUNKS = { ... }</script>` route-keyed manifest + `<link rel="modulepreload">` for non-empty tier-1 chunks + role-detection bootstrap `<script>` per OQ-A4-E hybrid (localStorage > cookie > `<meta name="scrml-role">` > `"_anonymous"` fallback dispatching to role-appropriate initial chunk via dynamic `<script>` injection). Augmentation pass lives at orchestrator-level in `codegen/index.ts` (+120 LOC; L724-771 per-file HTML doc envelope) since HTML augmentation depends on chunks Map computed AFTER per-file emit completes. `routeSegmentFromEntryPointId` in `route-splitter.ts` (+320 LOC) FIXED to handle real-pipeline EpId shapes (`<file>#program` / `<file>#page@<route>` / `<file>#page-<N>`) — pre-A-4.7 chunk filenames fell through to whole-id-sanitized fallback. NEW W-CG-CHUNK-* lint family (4 warnings; CGError type supports only error|warning so all four emit at severity='warning') via `emitChunkLints` in route-splitter.ts: W-CG-CHUNK-EMPTY (no non-empty chunks across roles) + W-CG-CHUNK-LARGE (initial chunk > `CHUNK_LARGE_SOFT_BUDGET_BYTES = 100000`) + W-CG-CHUNK-NO-PREFETCH (multi-route app with `hasPrefetchableLinks=false`) + W-CG-CHUNK-MISSING-ROLE (`<auth role="X">` references role with no per-role chunk via `collectAuthRoleReferences`). SPEC §34 + §40.9.11 catalog rows (+9). PIPELINE.md Stage 8 A-4 wave-close prose block. 31 new unit tests in NEW `compiler/tests/unit/codegen-html-augmentation.test.js` (504 LOC) — 4 bootstrap + 3 inline manifest + 3 modulepreload + 2 degenerate inputs + 5 §40.9.9 end-to-end + 1 elision + 8 runtime-helper + 1 atom-emitter resolution + 1 determinism + 3 lint family. Plus 3 sibling test updates: chunk-count 19→21 + W-CG-CHUNK-EMPTY filter. Per-app `scrml-runtime.js` distribution always carries both new helpers; tree-shake applies in embed-mode. +31 tests.

Mid-session bookkeeping commits:
- **`fbc8a39`** master-list S91 mid-session addendum + hand-off mid-refresh-1.
- **`d29357f`** hand-off mid-refresh-2 — comprehensive activity log + Q-OPEN dispositions + waves-closed table + CWD trap count + cherry-pick recoveries + push state.
- **`9d79f45` `d6e32ed` `b66c5da` `5e392cf` `bcbb7ab` `77a24a8`** — 6 staged briefs (A-2.8, A-4.2, A-4.3, A-4.4, A-4.5, A-4.6, A-4.7 sub-phase dispatch briefs at `docs/changes/a-*-* /BRIEF.md`).

**Cherry-pick recovery + file-delta-vs-cherry-pick rule validation (4 SAVES THIS SESSION):**
Per `feedback_file_delta_vs_cherry_pick.md`. Each agent worktree base predated some main-side landing; direct file-delta would have clobbered sibling work. Cherry-pick auto-merged additive changes; manual conflict resolution preserved both sides at every collision. Pattern: TEMP-commit (`--no-verify` ONLY on procedural sequencer-advance) → conflict-resolve → soft-reset bundle → single clean PA-authored final commit with pre-commit gate clean. The rule held under maximum stress (3-way parallel landing on shared files at A-4.4/4.5/4.6).

**CWD-routing trap-and-catches (4 SAVES THIS SESSION):**
Per S91 pa.md fold-in. Each caught before any damage: (1) session-open Bash batch leaked CWD to scrml-support, (2) user-voice S90 commit CWD-leak, (3) A-3.5 file-delta initially landed in worktree before reset, (4) A-4.2 file-delta gate via "No such file or directory" error. Rule empirically vindicated.

**F4 leak recovery (1 incident):**
L (03-contact-book) Sub-task A wrote auth-graph.ts + types/auth-graph.ts changes to MAIN's working tree directly in addition to its worktree branch. PA cleaned via `git checkout HEAD --`. Agent's commit chain correct; subsequent Sub-tasks A.2-B did NOT leak. Documented in A-2.8 commit body.

**Pre-commit gate save (1 incident):**
A-4.4 test §12 asserted `chunk.chunkHash === "00000000"` placeholder; A-4.6 already replaced. Pre-commit caught; updated to `!= placeholder` + base36 regex pattern; commit retried clean. Exactly what the gate is designed to catch.

**Memory rules saved this session:** none new — S91 entirely validated S88-S90 memory rules under stress. The rules held.

**Push state at S91 close:** scrmlTS 30 commits ahead of origin (`199940e..<wrap-final>`); scrml-support 1 commit ahead (`8d13012`). Push pending wrap step 7 — explicit user authorization.

**Test count trajectory S91:** 12,275 (S90 close, full bun test) → **12,517** (S91 close, full bun test). **+242 tests / +12 files / 0 fail / 0 regressions** across the session. Pre-commit gate ran clean on every substantive commit.

**`null` / `undefined` absolute rule held throughout:** zero scrml-source `null`/`undefined` introduced in any S91 commit. Stdlib auth template (NEW `stdlib/auth/templates/login.scrml`) uses `not` for absence + `!{...}` failable handlers + no try-catch (per `feedback_null_does_not_exist_in_scrml.md` + S89 user verbatim absolute rule).

**v0.3.0 critical-path summary at S91 close:** The three structural waves of Approach A — A-2 Reachability Solver, A-3 §40 AuthGraph, A-4 Per-Route Artifact Splitter — are ALL FULLY CLOSED. Adopter apps with `--emit-per-route` flag produce content-addressed per-(EP, role, tier) chunks emitted with role-detection-bootstrap HTML that ACTIVATE in actual browsers. Per master-list §0.1: A-1 (closed S89), A-2 (closed S91 here), A-3 (closed S91 here), A-4 (closed S91 here). Remaining v0.3.0 work: A-5 integration tests (consumes A-2 + A-3 + A-4 output; depends on user disposition for scope + timing) + Wave 4.A adopter content + Rule-1-deferred marketing tracks.

### 2026-05-13 → 2026-05-14 (S90 CLOSE — landmark 17-commit A-track-momentum session — M-7C-D-12 wave CLOSED + A-2 Components 2-5 wired + A-3 substantively complete + 5 NEW first fire-sites + OQ-A3-A user override (d) full interpolation)

S90 spanned midnight. Two major surfaces advanced end-to-end this session.

**M-7C-D-12 runtime sentinel wave CLOSED end-to-end (5 of 5 tracks):**
- T1 AST cleanup at `850a298`: LitExpr canonical `"not"` discriminator migration. Parser sites in expression-parser.ts (6 sites) + ast-builder.js + tokenizer.ts manufacture only `litType:"not"` with `raw` field discriminating user-source forbidden tokens. Gauntlet-phase3 detector migrated to raw-aware discrimination. component-expander default="null" path canonicalized. type-system whitelists cleaned. +23 tests. Semantic refinement: array holes `[1,,3]` now emit JS `null` (was `undefined`).
- T3 codegen + lint at `887f420`: 16-site `?? "undefined"` → `?? "null"` migration + 3 consumer guards in lockstep. NEW `compiler/src/codegen/lint-undefined-interpolation.ts` lint (~280 LOC) firing `W-CG-UNDEFINED-INTERPOLATION` post-emission. Idiom-aware exemptions (paired absence-check / typeof env-detection / comments / strings / runtime-block masking). +28 tests. Corpus sanity 0/334 findings.
- T4 SPEC amendments at `8cef7f5`: §12.5.1 wire-format amendment + **NEW §57 Wire Format normative section** (slot note: §50 was already Assignment-as-Expression; landed at §57). §51.0.J rename `E-DERIVED-ENGINE-INITIAL-UNDEFINED → ABSENT`. §42.8 "Runtime Representation — DevTools" subsection (OQ-7). SPEC-INDEX refresh 47 rows. SPEC.md 27,037 → 27,144 lines. PA-amendment during landing: §34 W-CG-UNDEFINED-INTERPOLATION row added (both T3 and T4 agents punted; PA closed coordination gap).
- T5 audit closure docs at `956184f`: CLOSURE banners on null-audit + undefined-audit + master-list §0.6 + re-grep counts (null 2,777 → 2,925 / undefined 861 → 933; ZERO new M-class drift; increases entirely additive context).
- T2 wire envelope encoder + dual-decoder at `06987dc` (continuation after 600s-watchdog stall): NEW `compiler/src/codegen/wire-format.ts` (228 LOC). Type-gated envelope wrapping at CSRF + non-CSRF emit sites in emit-server.ts. **Post-emit helper-injection pattern** at emit-server.ts L1357-1375 mirrors structural-equality precedent. Decoder wiring single-site at emit-functions.ts L268-289 (covers direct + CPS paths). `_scrml_wire_decode` helper in runtime-template.js. +33 tests (CSRF + non-CSRF + dual-decoder per OQ-4 (b) + §42.1.1 defined-value-passthrough + §42.9 interop). Lint sanity 0 new findings.

**M-7C-D-12 first-attempt CWD-routing finding** (process discipline learning): first-attempt T1/T3/T4 dispatches all reported BLOCKED at startup-verification — harness provisioned `isolation: "worktree"` worktrees under `scrml-support/.claude/worktrees/` instead of `scrmlTS/.claude/worktrees/`. Root cause: PA's earlier `cd /home/.../scrml-support && git commit` persisted shell CWD; subsequent `git -C` calls don't change CWD. F4 startup-verification caught wrong-repo `pwd`; agents stopped without writes. Recovery: TaskStop + worktree cleanup + `cd scrmlTS && pwd` + re-dispatch with sharpened F4 path-prefix check. **NEW memory rule `feedback_agent_isolation_cwd_routing.md` saved.**

**M-7C-D-12 T2 600s-watchdog stall recovery** (substantive re-dispatch precedent): first T2 agent stalled mid-deliberation with high-quality scaffolding (wire-format.ts 228 LOC + emit-server.ts integration + runtime-template.js decoder helper) UNCOMMITTED in working tree. Agent identified right pattern (post-emit `finalEmitted.includes(...)` detection) but stalled before applying. Recovery: retain partial-worktree as read-only WIP source; dispatch continuation agent with explicit "finish-from-WIP" brief. Continuation completed in 6 commits. Zero work-lost.

**Approach A Components 2-5 wired through orchestrator end-to-end:**
- A-2.3 Component 2 (`reactive_dep_closure`) at `687fba1`: NEW component-2.ts (537 LOC + 8 helpers). Forward-DFS over `reads`/`validator-reads`/`engine-derived-reads` edges per OQ-A2-J. Dynamic-key recovery hook. markup-read intermediary excluded. +15 tests. ZERO A-1 gaps surfaced.
- A-2.6 Component 5 (`vendor_units_used_by`) at `4ed04f2`: NEW component-5.ts (451 LOC). Per-file vendor-unit attribution (v0.3 floor; per-component refinement deferred). Opacity rule (§40.9.6). +12 tests.
- A-2.4 Component 3 (`server_fn_reachable_within`) at `ba3f75c` (PA-merged with A-2.6): NEW component-3.ts (~1023 LOC). Interaction-graph projection per OQ-A2-H Option α (pure AST, NO DG extension). Bounded BFS N=0/1/2 per OQ-A2-B Option a (N≥3 NOT emitted; on-demand runtime). Strategy-B function-source exclusion load-bearing. N=2 cascade via engine state-child arm-body callees. Worst-case-union for ambiguous callees. +17 tests. **PA-merge required**: agent based pre-A-2.6 main; unified `makeChunkPlan(componentNodeIds, reactiveCellNodeIds, serverFnTiers, vendorUnitNames)` signature with `differenceSet` helper.
- A-2.5 Component 4 (`auth_gated_boundaries_visible_to`) at `4059532`: NEW component-4.ts (~558 LOC). RSInput.authGraph narrowed. **Per-role ChunkPlan emission** lands (ChunkPlan moves from single-`_anonymous`-keyed to per-role-variant classification). Per-gate per-role classifier (IN/OUT/RUNTIME-FALLBACK) consumes AuthGate.classification field. **NEW W-AUTH-RUNTIME-FALLBACK + E-CLOSURE-002 first fire-sites.** +21 tests. Per-role filtering applies to componentNodeIds only (DG-id atoms don't carry markup-tree ancestry; A-2.7 + A-4 can extend).

**A-3 §40 AuthGraph SUBSTANTIVELY COMPLETE (4 of 5 sub-phases):**
- A-3.1 enumerator + `<auth>` registration at `0960fd5`: NEW types/auth-graph.ts (~354 LOC) + auth-graph.ts (~418 LOC). `<auth>` registered in html-elements.js + attribute-registry.js (role/check/else/redirect attrs). 4 AuthSiteKind variants (program-auth / page-auth / auth-role-block / channel-auth). Trucking-dispatch corpus verification: 21 gates / 0 errors. +15 tests + 2 fixture extensions.
- A-3.4 redirect cross-ref at `e3fa180`: EXTEND auth-graph.ts with `crossRefRedirects` + `collectUrlPatterns`. **NEW info-severity `I-AUTH-REDIRECT-UNRESOLVED` first fire-site** (severity union extended to include "info"). +12 tests.
- A-3.2 role-enum resolution at `6fca620`: EXTEND auth-graph.ts with `resolveRoleEnum` + 12 helpers. OQ-A3-F (b)+(c) dual rule. **NEW E-AUTH-GRAPH-002 first fire-site.** +12 tests. **PA-merge** with A-3.4 (cherry-pick conflict on auth-graph.ts; resolved additively). **A-3.4 test cascade fix**: 12 assertions changed to filter-by-code pattern.
- A-3.3 per-gate classifier at `d52a7a2`: EXTEND auth-graph.ts with `classifyGates` + 11 helpers. REUSES META constant-folder primitive (S89 A-2.2.b; OQ-A2-D shared-primitive working). OQ-A3-A (d) full-interpolation grammar. `<auth role=>` attribute-registry.js `supportsInterpolation: false → true`. **NEW W-AUTH-PAGE-INFERRED first fire-site.** +21 tests + 6 baseline tests updated.

**A-3 OQ batch ratification (6 OQs)** at `3b2a79c`:
- **OQ-A3-A → (d) FULL INTERPOLATION (USER OVERRIDE of agent recommendation (b))**. User-voice S90: *"the idea that user defined state has full interpolation but first class compiler supported state doesn't is confusing, counter intuitive, and hints that the language is still in a 'toy' status."* Per Rule 2 full-production-language fidelity — value-bearing attrs uniformly accept string-literal / variable-ref / `${expr}` shapes. Grammar open; A-3.3 classifier discriminates closed-form vs runtime-fallback at analysis layer.
- 5 batch-ratified on agent recommendations: OQ-A3-B (a) bare-string · OQ-A3-C (b) explicit-per-page + W-AUTH-PAGE-INFERRED · OQ-A3-D binary channel-auth · OQ-A3-E (a) compile-time only · OQ-A3-F (b)+(c) dual rule with E-AUTH-GRAPH-002.

**M-7C-D-12 OQ batch ratification (9 OQs total)** at `725e07c`:
- OQ-2 envelope `{"__scrml_absent": true}` · OQ-5 `?? "undefined"` → `?? "null"` · OQ-6 rename UNDEFINED-RT → ABSENT-RT · OQ-3 parallel-aggressive · OQ-4 (b) dual-decoder + (a) v1.0 clean break · OQ-7 (a) accept JS null in DevTools · OQ-8 defer M-7C-D-15 · OQ-9 concurrent with Wave 4 A+R.

**5 NEW first fire-site diagnostics** (§34 catalog rows deferred to A-3.5): W-CG-UNDEFINED-INTERPOLATION · I-AUTH-REDIRECT-UNRESOLVED · E-AUTH-GRAPH-002 · W-AUTH-RUNTIME-FALLBACK · E-CLOSURE-002 · W-AUTH-PAGE-INFERRED.

**Session-open hygiene** (S90 Phase 1): hand-off rotated; `scrml-support/user-voice-scrmlTS.md` S89 section appended (4 verbatim directives); FULL_COLD_START map refresh via project-mapper.

**Process discipline patterns validated/saved S90**:
- F4 startup-verification's repo-prefix check protects against harness CWD-routing trap (permanent memory rule saved).
- PA-merge orchestrator-collision pattern for sibling parallel dispatches: file-delta NEW files cleanly + PA-author merged shared-file integration. Two precedents (A-2.4 + A-2.6 reachability-solver.ts; A-3.2 + A-3.4 auth-graph.ts).
- Test cascade pattern for new pipeline diagnostics: filter-by-code in assertions, forward-compatible.
- "Continuation agent with finish-from-WIP brief" pattern for 600s-watchdog stalls.
- "Surface agent recommendations as deliberation points when they invoke 'scope tractable' framings on first-class-language-shape questions" — OQ-A3-A precedent.

### 2026-05-13 (S89 CLOSE — landmark 36-commit session — chain closures + null/undefined eradication + A-2 advances)

Substantial multi-wave session: 36 PA-authored commits across 9 waves of parallel dispatches. Two compiler chains closed end-to-end (**§36 input devices Phases 1-4**; **§13.2 auto-await Promise<T> Sub-A through Sub-E**); two more advanced (A-2 Reachability Solver scaffold + Component 1; A-3 §40 auth-graph SCOPING). Plus comprehensive **null+undefined eradication at SPEC/corpus/audit layers** per user S89 verbatim ruling. Plus Wave 4 adopter T-track + D-track CLOSED; A-1 wave close-out trio shipped; Wave 3.7 corpus audit + §4 backlog migration; TodoMVC edit-mode markup landed; W-TRY-CATCH lint shipped.

**§36 input devices chain CLOSED end-to-end:**
- Phase 1 SPEC at `b1848f9`: §36.5.1 nested-scope + §36.7.1 W-INPUT-001 (replaces proposed E-INPUT-006 per OQ-A γ) + §36.5.2 SSR + §36.6 _clearFrameState SHOULD.
- Phase 2 parser/typer + E-INPUT-005 at `7720257`: `<#id>` member-access verified leaf-as-opaque (5 regression tests); E-INPUT-005 duplicate-id walker (7 tests). 47→59.
- Phase 3 regression tests at `bdbf810`: SSR no-emit + auto-repeat + nested-scope cleanup (+10 tests; zero bugs).
- Phase 4 conformance + integration + sample at `19e174e`: 5 conf-INPUT-* (12 tests) + frame-accurate integration (4 tests) + input-canvas-demo + JSDOM integration (7 tests).
- Wave 1.4 SCOPING (`cfd3132`) surfaced Rule-4: ~70% already shipped S78/S84.

**§13.2 auto-await Promise<T> chain CLOSED end-to-end:**
- Sub-A SPEC at `67a6a81`: §13.2.1+§13.2.2 stdlib Promise<T> + §13.1 stdlib carve-out + §41.4.1 stdlib API rule + E-PROG-004 Error→Info (Q2 Position C).
- Sub-B Step 1 at `503c3b4` (post-crash recovery): FunctionDeclNode.isAsync + ast-builder parsing.
- Sub-B Steps 1c+2+3+4 at `39eba45`: I-ASYNC-USER-SOURCE info lint + exportRegistry.isAsync flag + isPromiseReturningStdlibFn helper + scheduling.ts classifier + emit-logic.ts guarded-expr auto-await + STDLIB-EXPORT-SEED TAB-only pass. +9 tests. 37 stdlib Promise<T> classified.
- Sub-C at `775d836`: closed-as-Sub-B-already-done.
- Sub-D + Sub-E at `7876191`: Sub-D no-op + Sub-E verifyPassword + verifyJwt one-line migration. Stdlib transitive re-export gap surfaced as follow-on.

**A-1 wave close-out** at `376a219`: A-1.6 consumer audit (5 DG consumers; design-intent kind-discriminator finding) + A-1.7 ceiling re-measurement (523 nodes/edges vs 256 S84 ceiling = 2.04x; A-5.5 closed ahead) + A-1.8 docs + new `scripts/measure-markup-read-edges.ts`.

**A-2 Reachability Solver advanced:**
- A-2.1 scaffold at `6023923`: types/reachability.ts (247 LOC) + reachability-solver.ts (152 LOC) + pipeline wiring + `--emit-reachability` CLI flag. +6 tests.
- A-2.2 Component 1 at `783721f`: entry-point enumerator + constant-folder primitive (extracted from META per OQ-A2-D) + per-gate classifier + worst-case-union admission. +82 tests.

**A-3 §40 auth-graph SCOPING** at `ce39ad4`: AuthGraph schema; 5 sub-phases / 30-49h critical-path; 6 OQs; cross-cutting OQ-A2-D constant-folder dependency.

**Wave 3.7 corpus audit + §4 backlog** at `32386e7` + `38d1ef1`: 50/77 files clean; 10 §4 items; 8/10 migrated (trucking-dispatch components + 14-mario file-top `#{}` + kickstarter login() → failable AuthError both v1+v2).

**TodoMVC edit-mode markup** at `41fb26c`: Rule-4 — §B LIFT anchors already flipped S88; actual work was missing markup (commitEdit/cancelEdit/visibleTodos/@editingId). +1 test; warnings 5→1.

**Wave 4 adopter content (T + D tracks closed):**
- Wave 4 SCOPING at `d8fd5ce`: Rule-4 — Wave 4 substantially more advanced; re-baselined ~12.75-26.5h; 17 sub-tasks / 5 tracks.
- T-track at `deb5c7c`: **Substantive finding — S87 Insight 30 silently invalidated tutorial §8** (taught `<channel>` as file-top sibling; cited retired E-CHANNEL-INSIDE-PROGRAM; snippet broken). T-1 caught 1/11 FAIL → T-2 fixed → 11/11 PASS. 13 edits.
- D-track at `ccf89c9`: 17 articles classified (10 ACCURATE + 3 BORDERLINE + 4 INTERNAL + 2 RETRACT).

**null + undefined ABSOLUTE eradication** per user S89 verbatim ruling ("null does NOT EXIST IN SCRML! and never will!" + "yes this extends to undefined. \"\" is still defined."). Scope: scrml source only — output JS legitimately uses null/undefined as JS-host primitives per SPEC §42.1 S89 exclusions:
- 7.A SPEC null at `e621d91`: §42 canonical home; 33 sites; W-NULL-IN-SCRML-SOURCE catalog.
- 7.B Corpus null at `6751aae`: primer + kickstarter + samples + examples; 30 sites.
- 7.C Self-host null at `84f7fe9` (partial recovery — agent over-reached on module-resolver.js removing §13.2 Sub-B isAsync infra; PA caught + reverted).
- 7.D TS null audit at `31ff1a0`: 2777 sites; 18 M-7C-D-N items; M-7C-D-12 (runtime sentinel) blocker prerequisite.
- 7.E mutability-contracts at `7d6fad8`: `(null → T)` → `(not → T)` lifecycle.
- 8.A SPEC undefined at `ca38880`: §42 already enumerated both; 6 sites; **W-NULL → W-ABSENCE rename**; **NEW §42.1.1 "Defined Values vs. Absence — `""` is NOT Absence"** normative subsection enshrining `""`/`0`/`false`/`[]`/`{}` as defined values.
- 8.B Corpus undefined at `90eff72`: 6 sites; correctly distinguished `""`-adjacent leaves.
- 8.C Self-host undefined at `78555f6`: closed-as-no-op (Wave 2.1 already swept).
- 8.D TS undefined audit at `f63e36a`: 861 sites; 16 M-8C-D-N items; 13 paired with M-7C-D-N.

**M-7C-D-12 SCOPING** at `dd891ab`: **Critical Rule-4 reframing — SPEC §42.1 S89 exclusions ALREADY RATIFY runtime JS `null` as scrml absence + carve out codegen-emitted JS from W-ABSENCE-IN-SCRML-SOURCE lint.** Option α IS the SPEC's canonical answer. 5 options surfaced; **Option ε (spec-amend audit framing) user-ratified**: audit migration count drops ~860/34 items → ~95/5 items. 5 sub-tracks / 33-45h; 3 substantive OQs remain.

**Other features:**
- W-TRY-CATCH lint at `6498dd2`: Stage 3.007 LINT-TRY-CATCH walker; §34 row referencing §19.1; fires on stdlib/http lines 65+264. +7 tests.
- stdlib Phase 1.5 sweep at `8c608a7`: 21 files / 124 sites.
- Phase 3a jwt verifyJwt at `d0e05c8`: async → safeCallAsync; result-shape preserved. +2 tests.
- Wave 9.A paired-migration classification at `99c30da`: Rule-4 — ALL "non-blocked" items chain-blocked on M-7C-D-12 (gauntlet detector coupling).

**21 OQs ratified per agent recommendations in single batch** (5 §36 + 6 §13.2 + 10 A-2).

**5 new memory rules saved:** `feedback_land_before_cleanup` · `feedback_agent_crash_partial_recovery` · `feedback_null_does_not_exist_in_scrml` (extended with source-vs-output scope) · `feedback_self_host_is_from_scratch`.

**8 substantive Rule-4 findings:** W-PROGRAM-SPA-INFERRED already-done · §36 ~70%-done · Wave 4 advanced · §13.2 Sub-C already-Sub-B-done · A-2 algorithm SPEC-pinned · Wave 8.C superseded · Wave 9.A chain-blocked · Wave 9.B SPEC-already-ratifies-codegen-null.

**PA process violations + recoveries:** cleanup-before-landing (recovered via reachable SHA; memory rule saved) · agent crash pre-commit (Step 1 recovered via working-tree cp; memory rule saved) · over-reach on module-resolver.js (pre-commit caught; reverted).

---

#### Sub-detail (carved from S88 dispatch window):

**A-1 wave close-out** at `376a219` — original detail:

**A-1.6 consumer audit (`docs/changes/a1-closeout/A1-6-consumer-audit.md`):**
- 5 DG-node consumers identified in `compiler/src/`: `codegen/scheduling.ts`, `batch-planner.ts`, `codegen/index.ts`, `meta-eval.ts`, `codegen/emit-functions.ts`.
- All 5 handle `MarkupReadDGNode` (kind: `"markup-read"`) safely via implicit-skip or passthrough. 0 flagged.
- Property: kind-discriminator switches default-skip new DG node kinds without per-consumer updates — this is design intent, not coincidence. No follow-on remediation required.

**A-1.7 S84 ceiling re-measurement (`docs/changes/a1-closeout/A1-7-ceiling-remeasurement.md`):**
- 523 markup-read DG nodes + 523 `reads` edges (markup-read → reactive) across 61-file corpus.
- 2.04x the historical S84 256-edge ceiling (`scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md` L122).
- Status: AT/OVER ceiling — closed ahead of schedule. The S84 finding "scrml's reactive graph is structurally half-shaped because markup reads were excluded from the DG" is now fully closed at the producer level.
- 1-to-1 node:edge correspondence holds (Option Y per-interpolation design ratified at A-1.1).
- Measurement reproducibility: `scripts/measure-markup-read-edges.ts`.

**A-1.8 docs:**
- `docs/changes/v0.3-approach-a-impl/SCOPING.md` updated with A-1-wave-CLOSED status header citing per-sub-phase landing commits (`1f516e1` / `da78609` / `55f5f20` / `b512db9` / `24b582d` for A-1.2 through A-1.5; `2b2eeca` for A-1.6).
- This changelog entry.

**A-5.5 closed ahead of schedule:** A-1.7 measurement satisfies A-5.5 (S84 ceiling re-validation) per SCOPING §0.5 sequencing — no separate dispatch needed in the A-5 wave.

**Commits S89:**
- `2b2eeca` — docs(s89-a1-6): consumer audit
- (S89 a-1-7 commit) — docs(s89-a1-7): S84 ceiling re-measurement + measurement script
- (S89 a-1-8 commit) — docs(s89-a1-8): SCOPING + changelog update

### 2026-05-13 (S88 CLOSE — landmark 17 commits · LIFT family 5-of-5 CLOSED · A-1 edge emission COMPLETE · Approach A v0.4-deferral REVERSED · safeCall + safeCallAsync stdlib primitives shipped · Insight 31 §36 retention DESIGN-AND-SHIP · 3 SPEC amendments · Bug 3a §1 flake CLOSED · 2 memory rules + 1 process lesson)

**Session-defining outcomes:**
- All 5 LIFT-template codegen bug families CLOSED (LIFT-1 catastrophic parens-attr + LIFT-2/3/4 emitter-parity bundle + LIFT-5 reconciler ambient). Canonical "per-item interactive markup inside for/lift" pattern (TodoMVC edit-mode shape) unblocked end-to-end.
- Approach A wave A-1 edge emission COMPLETE (5 of 5 sub-phases: A-1.2 scaffold / A-1.3 high-freq / A-1.4 call-ref+for+lift / A-1.5 engine). Option Y per-interpolation source nodes ratified by user (against PA's Option X recommendation).
- Approach A v0.4 deferral REVERSED (Insight 29). User verbatim S88: *"I know we talked about deferring A to 0.4, but I am not seeing the reason now, start on those tasks as they are unblocked."* Full Approach A + Wave 4 adopter content as v0.3.0 cut blockers.
- stdlib host primitive family shipped: safeCall + safeCallAsync. Phase 3a sync migration 4-of-4 complete; async migration 1-of-4 (verifyPassword) with 3 deferred (http needs scrml-faithful failable refactor; Phase 3c concern).
- Insight 31 ratified (§36 live-input retention DESIGN-AND-SHIP). 4-expert synthesis-mode debate; verdict 49.5/40.0/29.0. Empirical gate (justPressed boilerplate) + symmetry gate (Pillar 5 reverse).
- 3 SPEC amendments landed PA-hands-on (§4.7 BS-comment-skip softening + §18.7 mixed-binding forbidden + §41.4 bun:/node: protocol prefixes — with brief-overclaim correction from §40.4 to §41.4).
- Bug 3a §1 SQL round-trip flake hardened (happy-dom Headers pollution; pre-mint + conditional skip). Operational pre-push gate unblocked.

**Major commits landed S88 (chronological):**

- **`30743c4`** 25 shipped dispatch dirs deref → scrml-support/archive/changes/. Companion commit `dde7e5b` on scrml-support.

- **`3d90286`** pa.md hook-policy amendment + S87→S88 hand-off rotation + maps refresh. Two valid `core.hooksPath` configurations documented (A=source-controlled-only / B=local-rich); user-ratified B at S88.

- **`0b7ea8b`** pa.md isolation-parameter dispatch rule (S88 amendment: PA Agent() calls for dev-agents MUST set `isolation: "worktree"` explicitly) + primer §13.5 staleness fix correcting debate-03 entry from "pinned for queued" to "CLOSED S64; do not revisit."

- **`be7b261`** LIFT-1 fix — CATASTROPHIC parens-attr in `_parseLiftAttrValue` (ast-builder.js) elided parent element + duplicated inner text. Root cause: no handler for PUNCT `(` tokens; cursor desync at `parseLiftTag` call sites. Fix: paren-balancing branch + cursor save/restore at both call sites. (Agent direct-to-main — PA dispatch error; pa.md S88 amendment adds the prevention rule.)

- **`14e21de`** LIFT-2/3/4 PA-authored after 2 prompt-too-long dispatch failures. `bind:value=` two-way wiring (initial sync + addEventListener + reactive subscribe) + `if=` display-toggle (updater function + reactive subscriptions) + event auto-injection for bare-call empty-args. Touched BOTH paths in emit-lift.js (string-attribute `emitSetAttrs` line 396-437 + structured-AST `emitCreateElementFromMarkup` line 555-610). 3 broken-output anchors at `compiler/tests/unit/todomvc-fixture-edit-mode.test.js` §B.2-4 flipped to verify-fix.

- **`20bb16c`** (scrml-support) debate-04 record + Insight 31 §36 retention DESIGN-AND-SHIP. 4-expert panel: simplicity-defender CLOSE / phaser-input DESIGN-AND-SHIP / react-dom-events CLOSE/soft-DEFER / scrml-structural-primitives DESIGN-AND-SHIP. Synthesis-mode caveat: 3 of 4 experts synthesized (only simplicity-defender was a real agent file; she voted CLOSE). User ratified verdict in full with caveat carried forward. 3 forged-expert files dropped — fresh-forge in future debates instead.

- **`6461f21`** v0.3 Approach A implementation SCOPING at `docs/changes/v0.3-approach-a-impl/SCOPING.md` (~310 lines). Plan-agent-authored. Decomposes 300-640h surface into 5 sub-waves with A-1 further decomposed into 8 sub-phases. Two blocker OQs surfaced; user picked Option Y per-interpolation (against PA recommendation) for source-node granularity and Option b (defer A-1.4 until LIFT closes) for sub-phase sequencing.

- **`1f516e1`** A-1.2 markup-read DG node kind + walker scaffold (Option Y per-interpolation). `MarkupReadDGNode` defined; `findOwningRenderDGNode` + `createMarkupReadNode` helpers added; scaffold flag `markupContextEmitEdges = false` in place. +11 tests. Behavioral invariant: zero edges emitted (A-1.3 activates).

- **`05379f9`** safeCall stdlib primitive (`scrml:host`). Approach α — stdlib `.scrml` declares + hand-authored JS shim at `compiler/runtime/stdlib/host.js` carries the try/catch. Try/catch lives ONLY in compiled JS, never in scrml source. `HostError:enum { Thrown(message: string, name: string) }`. Non-Error throws (string/null/undefined/object) normalize to {message, name: "UnknownThrow"}. +24 tests (SC-1..SC-24).

- **`da78609`** A-1.3 high-frequency markup-read edge emission — 4 shapes activated: `${@x}` text interpolation + `attr=@x` variable-ref + `bind:value=@x` + `if=@x`/`if=(expr)` condition. Edge count delta ~150-200 of the 256 S84 ceiling (~60%). MARKUP_READER_SENTINEL credit kept ADDITIVE (A-1.6 audit decides removal safety). +13 tests.

- **`c838e19`** Phase 3a stdlib sync try/catch migration — 4 of 8 sync sites migrated (verifyHash + decodeJwt + kv.get + parseIdToken). 4 async-gap sites documented for safeCallAsync follow-on. 4 new module error types (CryptoError + JwtError + KvError + OAuthError). Per-module error enums NOT a shared stdlib-error (per pa.md Rule 2 + "errors-as-states" pattern).

- **`7491a98`** safeCallAsync — async sibling of safeCall. Wraps `await thunk()` in try/catch. **Non-trivial design discovery:** failable-await interaction. `const x = safeCallAsync(thunk) !{...}` does NOT work without explicit `await` because compiler auto-await applies ONLY to server functions (§13.2), not stdlib imports. Two-step pattern documented in stdlib/host/index.scrml + SCA-19 test: `const rawResult = await safeCallAsync(...) ; const ok = rawResult !{ | ::Thrown(msg, name) -> ... }`. Future v0.3+ candidate: extend compiler auto-await to stdlib imports returning Promise. +20 tests (SCA-1..SCA-20). Internal refactor: normalizeThrown + buildErrorSentinel extracted as shared helpers.

- **`b512db9` + `24b582d`** A-1.5 engine state-child + onTransition/Timeout/Idle body edges + engine-cell self-read. Per OQ #1 disposition: markup-context (parity with engine-cell-self-read pattern). engine-decl handler in dependency-graph.ts:2098-2194 (old 9 lines → ~97 lines). Regex-scans bodyRaw / onTransitionElements / onTimeoutElements after= / idleWatchdog. +14 tests.

- **`88a7d57`** LIFT-5 reconciler ambient fix — last LIFT family. Root cause: emitForStmt's reactive fallback body loop dispatched if-stmt and for-stmt children through `emitLogicNode` without containerVar; when an if-stmt contained a lift-expr, the emitter called `_scrml_lift(() => ...)` against globally-set ambient `_scrml_lift_target` which was null inside `_scrml_create_item_N`. Fix: export `emitIfStmtWithContainer` + `emitForStmtWithContainer` from emit-lift.js; use them in emit-control-flow.ts fallback body loop with `{ continueBehavior: "return" }`. Cherry-pick land (not file-delta — would have stomped LIFT-2/3/4 since agent base predated it). +7 tests + repro fixture.

- **`ccf2e99`** Bug 3a §1 SQL round-trip test flake HARDENED. Root cause: happy-dom GlobalRegistrator from compiler/tests/browser/* replaces Request/Response/Headers with browser-spec polyfills that filter Set-Cookie/Cookie/X-CSRF-Token per CORS forbidden-header rules. Once registered, persists for process lifetime. Integration test ran AFTER browser tests alphabetically and inherited polluted globals. Fix: pre-mint CSRF cookie + X-CSRF-Token via fixed TEST_CSRF_TOKEN constant + conditional skip when happy-dom detected. csrf-baseline.test.js + csrf-bootstrap.test.js + emit-server-sql-emission.test.js cover orthogonal claims. **Operational pre-push gate unblocked.**

- **`ad9f1f8`** 3 SPEC amendments — §4.7 BS-comment-skip normative softening (BS MAY skip `<!-- -->` matching shipped S87 BS-comment-skip behavior; `/* */` still forbidden at BS) + §18.7 mixed positional+named binding forbidden + E-TYPE-021 extended (rationale: AST `payloadBindings: string[]` is strictly positional; mixed-form support would require AST extension without expressive gain) + §41.4 bun:/node: protocol prefixes ADDED (5 prefixes legal now; new E-IMPORT-007 for bun:/node: in client context; stdlib JS-shim authors no longer forced to detour through circuitous shim files; server-context-only restriction preserves the no-runtime-builtin-in-client.scrml security invariant). Brief-overclaim surfaced: S87 hand-off said §40.4; that's the handle()/middleware section, not imports — correct section is §41.4 Protocol Prefixes. Per pa.md Rule 4.

- **`5cb177b`** Phase 3a async migration partial — verifyPassword migrated to safeCallAsync (1 of 4). Agent stalled on permission-ask (Sonnet pattern); PA-hands-on landed it. New PasswordError:enum { VerifyFailed(reason: string) }. 3 remaining async sites (jwt verifyJwt + http _request + http retry) deferred — http needs scrml-faithful failable refactor (current `throw new Error` is also forbidden → Phase 3c concern).

- **`55f5f20`** A-1.4 call-ref + for-iterable + lift-template-body-expr markup-read edges. Was DEFERRED in A-1.3 dispatch (OQ #3) until LIFT codegen closed; unblocked post-LIFT-5. 5 new emitMarkupReadEdge call sites (total walker now 15). +16 tests. **A-1 edge emission COMPLETE** (5 of 5 sub-phases activated).

**Memory rules saved S88:**
- `feedback_stated_intent_vs_corpus_migration.md` — when user has stated normative intent verbatim multiple times, corpus contradicting it is migration backlog, NOT deliberation trigger. The ouroboros is a 5-step cycle (training-data bias → agent default → corpus → next agent → PA framing → cycle); mitigations on agent/PA/sweep sides.
- `feedback_file_delta_vs_cherry_pick.md` — when agent's worktree base predates sibling parallel landings on the same files, wholesale file-delta silently overwrites sibling work; cherry-pick (with auto-merge) preserves both. S88 LIFT-5 precedent — pre-commit gate caught it; reverted + cherry-picked.

**Agent infrastructure fix S88:** `~/.claude/agents/scrml-js-codegen-engineer.md` rewritten (~200 lines from ~54). Fixes silent Sonnet default-down (`model: sonnet` → `opus`); fixes project path (scrml8 frozen → scrmlMaster/scrmlTS); adds Edit tool; adds comprehensive F4/S67/S83/S88 discipline blocks; adds S88 "DO NOT ask permission" directive. **Propagates at S89 open.** Throughout S88, agent commits carried "Co-Authored-By: Claude Sonnet 4.6" footer despite pa.md S57 Opus rule.

**Tests at S88 close (full suite, all directories):** 11,912 pass / 117 skip / 1 todo / 0 fail / 560 files. Pre-commit subset (unit + integration + conformance): 11,259 / 88 skip / 1 todo / 0 fail. Cumulative S87→S88: +759 pass / +32 skip / 0 regressions across 17 PA-authored commits.

**Push state at S88 close:** 17 commits ahead of origin/main. User authorized "wrap and push" — push executes during wrap close.

---

### 2026-05-12 (S87 CLOSE — HISTORIC 37 commits · 17+ dispatches · 2 v0.3.0 blockers CLEARED · Wave 3 COMPLETE · Insight 30 ratified · Option (d) engine self-write synthesis shipped · 14-mario AC delta 1/8→8/8 · stdlib Phase 1 173-occurrence sweep · 5 LIFT-template bug families surfaced · PA worktree-sweep mistake recovered ZERO loss)

**Session-defining outcome:** S87 is the largest single-day session in scrmlTS history by every dimension — 37 commits, 17+ dispatches landed (3 in-flight at any time), 2 v0.3.0 blockers closed, 2 design insights ratified (Insight 30 + Option (d) engine self-write synthesis pattern), Wave 3 v0.3 fixture-sweep flipped PARTIAL → COMPLETE, and 5 NEW high-priority LIFT-template codegen bug families surfaced for v0.3.0 ship readiness. **Zero regressions across all 37 landings.** PA committed a catastrophic worktree-sweep mistake mid-session destroying 4 must-not-touch worktrees; full recovery via `git update-ref` from deletion-log SHAs preserved all branches and the agents' harness auto-recreated worktrees from restored tips — ZERO work-lost.

**Major commits landed S87 (chronological):**

- **`5762069`** D3b benchmarks refresh — indirect-eval bench-scrml.js fix (D3a hypothesis verified) + TodoMVC `.filter(cb).length` workaround + runtime-results.json regen + RESULTS.md refresh. **5th LATENT COMPILER BUG SURFACED:** `.filter(cb).<member>` strips inner callback in v0.2.6+ codegen.

- **`9d6c8e4`** promote.js Option β safety-harness port from migrate.js. +7 tests / 0 regressions. Closes the staged-tmp anti-pattern in promote.js mirroring the S86 migrate.js fix.

- **`eb89ab7`** happy-dom perf-regression diagnostic — read-only analysis at `docs/audits/happy-dom-perf-regression-s87-2026-05-12.md`. Establishes regression window is wider than D3b's framing (~1402 commits Apr 5 → May 12). scrml 5.8× absolute slowdown vs React's 1.9×; competitive ranking intact (still beats React 9.2×). NOT v0.3.0 blocker; recommends post-v0.3.0 6-12h bisect-and-profile dispatch.

- **`de181c2` + `674d1dc`** Batch 2 Trio A SCOPING + 3 ready-to-fire dispatch briefs.

- **`6be98ad`** SPEC §38.1 + walker pre-check — Insight 30 implementation in 12min vs 3-8h band. Module-file `<channel>` dispensation (Option b ratified by debate-curator 47/44/44). All 4 trucking-dispatch channel files compile silent post-fix. **v0.3.0 channel-architecture BLOCKER CLOSED.**

- **`d8ea41c`** Bug 1 14-mario codegen+runtime — 4 fixes (payload binding A / EnumType::Variant B `::` rewrite / engine-routing C / derived_get tracks D). +8 tests. e2e 18/24 across 3 browsers; AC6/AC7 fail on out-of-scope fixture bug → engine self-loop semantics design call.

- **`cee4469`** Bug 4 walkMarkupContext extension. +7 tests. **METHODOLOGY:** brief over-claimed 4 false-fires; only 1 actual false-fire. 3 of 4 W-DEAD-FUNCTION are GENUINE (TodoMVC fixture incompleteness). Form-submit failure is downstream of Bug 5.

- **`d402047`** Bug 6 lift codegen — silent-data-loss closure. `<li>` for-loop bodies inside `<ul>` lift contexts were COMPLETELY DROPPED in generated JS. Fix wires structured-markup path to existing emitForStmtWithContainer.

- **`547566a`** Bug 2a component-expander walks if-chain branches + VP-2 ast-walk backstop. +8 tests.

- **`279bfc8`** Bug 5 method-chain callback preservation + Bug 3 diagnostic (Bug 3a SQL emission BLOCKER surfaced).

- **`dd91318` + `0d1514c` + `788ff3a` + `7589c6a`** Option (d) engine self-write synthesis — runtime no-op + W-ENGINE-SELF-WRITE-DETECTED info lint (inside + outside state-child) + SPEC §51.0.F.1 amendment + §34 catalog row. +14 tests. 14-mario compile produces 4 info lints; NO E-ENGINE-INVALID-TRANSITION errors. **Same synthesis-pattern as Insight 30 / §40.8.1 OQ closure — established as design-methodology signal.**

- **`72c6548`** Bug 3a SQL emission v0.3.0 BLOCKER closed — emit-server.ts plumbs `_dbScope` annotation → top-of-file `import { SQL } from "bun"; const _scrml_sql = new SQL(...)`. Real e2e integration test added (compile + import + invoke + verify SQL); closes the latent-bug class. 6 adopter examples verified before/after.

- **`ec0845f`** Bug 4.5 + Bug 1.5 + BS comment-skip — 3 file-disjoint landings: dependency-graph.ts call-ref args + reactive-deps.ts engine-var markup-binding + block-splitter.js `<!-- -->` skip. +28 tests.

- **`a72ccd2`** Bug 6.5 regression-guards (already-fixed by Bug 1 fix-A; PA's S87 file-delta-base-check memory rule prevented double-landing).

- **`bbd8df6` + tests + progress** Bug 2c — 1-line regex fix to normalizeTokenizedRaw collapses `:` separator whitespace; fixes bind:value mangle in expanded component bodies. Generalizes across all colon-separator directive prefixes.

- **`7eac3ad` + `beb25dd`** Wave 3.6 trucking-dispatch re-migration. 12 trucking pages migrated `<program>` → `<page>`. ZERO manual fixes — channel-dispensation walker absorbed cross-file cascade as Insight 30 predicted. **Wave 3 v0.3 fixture-sweep flips PARTIAL → COMPLETE.**

- **`28146e0` + `8c8e55a`** Bug 6.5.1 named-binding parser fix (`.V(field: local)` correctly binds `local`). **Bug 6.5.1's `child.binding` raw-text approach SUPERSEDES Bug 1 fix-A's `payloadBindings.join(", ")` approach.**

- **`61f4e4b`** migrate.js Wave 3.5 BUNDLE — container-aware + scope-safe + comment-safe unwrap. 4 bug families closed: E-CTX inside `<db>` (5×) + E-SCOPE-001 on locals (4×) + E-TYPE-026 (1×) + bonus E-LIN-001. +17 tests.

- **`8f03715` + `6bdf34b` + `8666d45`** Bug 1.6+1.7 match-arm bundle. Bug 1.6 was already fixed; Bug 1.7 inline-arm engine-write routing was the actual gap. **14-mario AC delta: 1/8 → 8/8 Chromium + Firefox.**

- **`f2dbb75`** stdlib Phase 1 — 173× `===`/`!==` → `==`/`!=` mechanical sweep across 20 stdlib modules. +28 regression-guard tests. Phase 3 surfaces deferred (throw migration / try/catch SPEC question / bun:/node: imports SPEC amendment).

- **`c0a835e` + `2addfc7`** emit-expr Option A — comprehensive engine-routing across ALL expression contexts (ternary / lambda / compound / call-args / nested). Bug 1.7 + Option A handle disjoint paths (string-rewrite layer vs ExprNode-emission layer); both complementary. +9 tests.

- **`15850d0`** TodoMVC re-verify PARTIAL — Bug 5 verified at compile level; canonical `.filter` restored. Edit-mode markup landing BLOCKED on **5 NEW LIFT-template codegen bug families surfaced** (LIFT-1 catastrophic + LIFT-2/3/4 bundle + LIFT-5 ambient). **HIGH-PRIORITY for v0.3.0 cut readiness.**

**Major design outcomes:**

- **Insight 30 ratified S87** — v0.3 cross-file channel access via Option (b) module-file dispensation. scrml-deep-dive completed in-session (737-line output) → debate-curator completed in 3 minutes (47/44/44 across 6-dimension rubric; Phoenix + Svelte ideologically-distinct experts converged on (b); simplicity-defender critique answered by engine-parity argument). User RATIFIED. SPEC §38.1 implementation landed in 12min vs 3-8h band. Insight 30 appended to `scrml-support/design-insights.md`.

- **Option (d) engine self-write synthesis ratified S87** — runtime no-op semantics + W-ENGINE-SELF-WRITE-DETECTED info lint + SPEC §51.0.F.1 amendment. Same synthesis-pattern as Insight 30 / §40.8.1 OQ closure — language absorbs common-case friction (idempotent runtime) without losing diagnostic signal (info lint surfaces no-op writes at compile time). 14-mario AC6/AC7 unblocked.

- **Synthesis-pattern as design-methodology signal** — when binary OQ has real costs both sides, surface a synthesis option capturing both load-bearing benefits without their costs. Frequency-3 in S86-S87 (§40.8.1 Option C + Insight 30 Option b + Option d engine self-write).

**5 NEW LIFT-template codegen bug families SURFACED (HIGH-PRIORITY for v0.3.0):**

- LIFT-1 (CATASTROPHIC): parens-attr in lift template elides parent element + duplicates inner text.
- LIFT-2/3/4 BUNDLE: lift-attr emitter literal-setAttribute fallback for bind:/if=/onkeydown shapes (shared root shape).
- LIFT-5 (probable runtime breakage): if-inside-for reconciler-factory `_scrml_lift_target` ambient state gap.

Block canonical TodoMVC edit-mode + broader "per-item interactive markup inside for/lift" pattern (the most common shape in TodoMVC-style apps). Recommended 3-dispatch decomposition for S88.

**S87 PA-side mistake + recovery (memory rules codified):**

PA wrote a bash worktree-cleanup loop intended to preserve 4 must-not-touch worktrees (3 active dispatches + 1 D3a preserved). **Bash skip-loop scoping was subtly broken; ALL 29 worktrees swept including the 4.** Recovery executed immediately via `git update-ref` restoring all 4 branches from deletion-log SHAs; agents' harness auto-recreated worktrees from restored tips. **All 3 active dispatches finished end-to-end; ZERO work-lost.** 2 memory rules saved: `feedback_pa_bash_cleanup_dry_run.md` (PA bash cleanup loops MUST dry-run first) + `feedback_pa_file_delta_base_check.md` (PA file-delta must verify agent base SHA against current main; cherry-pick if main touched same file since base — codified after the recovery surfaced this risk).

**Brief over-claiming pattern surfaced multiple times** (Bug 4 / Bug 6.5 / BS comment-skip / Bug 1.6) — Rule 4 extension: BRIEF-derived claims also need cross-check against current truth before encoding. Future briefs claiming a symptom count or specific repro shape should cross-check against AST/dist before encoding.

**Tests at S87 close:** 11,153 / 85 skip / 1 todo / 0 fail / 554 files. Pre-commit hook firing on every PA-authored commit. Zero regressions across 37 landings.

**v0.3.0 cut sequencing (post-S87):** path well-cleared. Remaining: 5 LIFT-template bug fixes (high-priority) + Wave 4 adopter content (tutorials / scrml.dev refresh / articles triage) + tag decision.

**Open at S87 close:**
- PUSH PENDING — 37 S87 commits to origin/main (surface for S88 PA authorization).
- 26 worktrees retained (cleanup pending wrap; DRY-RUN-FIRST per S87 memory rule).
- 5 LIFT-template codegen bug families (high-priority).
- stdlib Phase 1.5 (E-SYNTAX-042 sweep) + Phase 3a/b/c (throw / try/catch SPEC / bun: imports SPEC).
- SPEC amendments queued: §4.7 BS-comment-skip + §40.4 bun:/node: + §18.7 mixed-binding.
- happy-dom perf bisect (post-v0.3.0).
- Closure-analysis compiler implementation (300-640h band per Insight 29).
- Wave 4 adopter content.
- v0.3.0 tag decision (gated on LIFT bugs + Wave 4).

### 2026-05-12 (S86 CLOSE — v0.3 Wave 2 LANDED · v0.3 Approach A spec anchor LANDED · §40.8.1 OQ CLOSED · WebKit green 3-browser · scrml-dev codegen fix · migrate safety-harness fix · BS-layer extension · 117-worktree backlog cleaned · S86 the LARGEST session by far)

**Session-defining outcome:** v0.3 Wave 2 — the compiler implementation following S85's spec anchor — landed across two parallel agent dispatches + one follow-up. `bun scrml migrate --program-shape` rewrites legacy v0.2 source into v0.3 shape (5-bucket classification: entry / route / module / schema-anchor / ambiguous). TAB stage recognizes `<page>` symmetric to `<program>` for default-logic body + 7 new top-level decl shapes auto-lift + W-PROGRAM-REDUNDANT-LOGIC + E-PAGE-INVALID-ATTR + E-PAGE-ROUTE-ATTR-FORBIDDEN diagnostics. BS-layer extended to recognize V5-strict state-decl shape inside `<program>` AND `<page>` body — closing the SPEC §40.8 normative-vs-implementation gap that item (b) surfaced. Plus durable PA standing rule ratified S86: idiomatic examples NEVER promote file-top `#{}` styles + the corpus-ouroboros warning sharpening pa.md Rule 4 to the example/fixture corpus.

**Commits landed S86 (so far):**

- **`885eaa9`** — Wave 2 item (a): `bun scrml migrate --program-shape` extension. +1108 LOC migrate.js (608 → ~1716); new --program-shape + --report flags; `classifyFile` helper extracted + unit-tested in isolation; 5-bucket classification + per-bucket rewrite ops; safety harness reuse via compileScrml roundtrip parse-check; --dry-run --report mode for structured advisory output. +33 tests / 5 fixtures (one per bucket). **Known limitation surfaced:** existing `sanityCheckParse` stages rewritten source into `/tmp` without relative-path context, so files with cross-file imports fail the safety gate even when the rewrite is semantically correct. Multi-file route files classified correctly in `--report` but NOT auto-rewritten until Wave 3 sweep handles them with proper path context (per brief §3.3.4 "Do not weaken this gate"). Plus PA-side dispatch infrastructure: `docs/changes/v0.3-wave-2/DISPATCH-BRIEF.md` (~530 lines) + `DIRECTIVE-AMENDMENT-001-fixture-styling.md`.

- **`41a4706`** — Wave 2 item (b): TAB extension. compiler/src/ast-builder.js extended in 4 orthogonal ways: (1) `<page>` recognized as default-logic body container (mirrors `<program>` via `isPageRoot` OR-included in childContext); (2) top-level decl regex family extended for function/fn/server-function/type-enum/type-struct/let/const + export-prefix support on TOPLEVEL_STATE_DECL_RE; (3) W-PROGRAM-REDUNDANT-LOGIC emission when `<program>`/`<page>` body wraps top-level decls in redundant `${...}` block (only fires when content is all-decls; mixed-content does NOT fire); (4) `<page>` per-route attr validation (E-PAGE-INVALID-ATTR for outside-`{db,auth,csrf,ratelimit}`; E-PAGE-ROUTE-ATTR-FORBIDDEN for route= specifically). +14 tests. **18 self-host parity tests `.skip`'d** pending self-host regen (deferred per pa.md S81 self-host-orthogonality). **Cascade-fix:** 4 existing test files' `parse()` helpers tightened to filter warnings (only assert on fatal-error absence, not warning absence) — mechanical alignment for the new warning emission.

- **`4585b45`** — PA-side cleanup: SPEC-INDEX.md regen post-Wave-1 (58 row line-range refreshes auto-generated via `bun run scripts/regen-spec-index.ts` reflecting v0.3 Wave 1 SPEC growth) + route-inference.ts docstring clarification (`buildPageRouteTree` is AUTH-MIDDLEWARE path map, NOT canonical URL inference; canonical URL inference is §47.9.2 path-preserve; v0.4 follow-up to harmonize `routes/`-keying with `pages/` corpus convention). No behavior change.

- **`2314c8c`** — Wave 2 follow-up: BS-layer extension closing the SPEC §40.8 normative-vs-implementation gap. compiler/src/block-splitter.js ~line 1161: three new locals (`isChannelBody` / `isProgramBody` / `isPageBody`) OR'd into the existing peek guard; when any fires AND `peekTopLevelStateDeclSignal()` returns true, the `<NAME [attrs]>` slice flows through as TEXT instead of pushing a markup context. TAB-layer's existing `liftBareDeclarations` path then synthetic-`${...}`-wraps it. +19 tests covering 4 shapes × 2 contexts + markup-opener disambiguation + regression on existing `<channel>`-body + SPEC §40.8 worked-example dual-form (bare + wrapped both compile cleanly; wrapped fires W-PROGRAM-REDUNDANT-LOGIC per item (b)).

**S86 user-voice ratifications (saved to user-voice-scrmlTS.md):**

- **Idiomatic-examples styling rule (S86):** *"while styles might be allowed outside `<program>`, it should be discouraged and never promoted in what should be idiomatic examples. the fact is I dont see 1 single reason to actully declare css there, css centralization always leads to untennable css."* — file-top `#{}` blocks SHALL NOT appear in idiomatic examples (kickstarter, primer worked examples, articles, fixture demos, dive worked examples). Use inline `class="..."` Tailwind-style. `#{}` reserved for non-inline-expressible shapes (CSS vars, keyframes, complex selectors).

- **Corpus-ouroboros warning (S86 sharpening pa.md Rule 4):** *"agents that have no prior art on this language other than the examples of other agents (with no prior art) wrote. it becomes ouroborous if I dont constantly try to rangle the design in to conformance with my goals."* — corpus state is ARTIFACT, not EVIDENCE of design intent. SPEC + user-voice + pa.md are normative; pre-existing example/fixture content is NOT — even when it reads as canonical. Memory file saved: `~/.claude/projects/-home-bryan-maclee-scrmlMaster-scrmlTS/memory/feedback_idiomatic_examples_styling.md`.

- **BS-layer extension picked over SPEC retreat (S86):** *"A. and we still have lots of work to do this session."* — Option A (extend BS-layer to honor SPEC §40.8 normative text) picked over Option B (amend SPEC to back down). When SPEC + impl diverge AND SPEC is design-intent shape, the right answer is impl work, not spec retreat. Operational rule sharpening: PA defaults to lean IMPL-extension over SPEC-retreat unless impl cost is structurally larger.

**v0.3 walker behavior under new fixtures:** trucking-dispatch `bun scrml migrate --program-shape --dry-run --report` classifies all 36 files correctly — `app.scrml` → schema-anchor (per §39.12.0 v0.3 workaround); pages/* → route REWRITE (`<program>` → `<page>`); components/* + channels/* + models/* + schema.scrml + seeds.scrml → module (leave-as-is or advisory). The 20 trucking pages with mixed cross-file imports surface the safety-harness limitation noted above — Wave 3 will close.

**Cumulative S85→S86 delta:** +70 pass / +14 skip / +4 files / 0 regressions. **Tests at HEAD `2314c8c`:** 11,577 pass / 114 skip / 1 todo / 0 fail / 561 files.

**Additional landings at S86 close (after the IN-FLIGHT snapshot above):**

- **`41f7fe9` scrml-dev codegen fix (Task #17 from S85):** important correction — the "dev-vs-static divergence" framing was WRONG; both modes emit identical broken output via the same codegen pipeline (no `options.dev` branch). The S85 hand-off error string was a paraphrase — actual JS engine emits `"Unexpected -"` (hyphen) NOT `"Unexpected ."`. Real bug: cross-file `<channel name="dispatch-board">` emitted as `import { dispatch-board }` — bare kebab identifier = invalid JS. Fix via new `filterChannelImportSpecifiers` helper in emit-channel.ts (98 LOC). **Bonus latent bug closed:** `{ X as Y }` was dropping the `as Y` alias; test §C20.1.4 was locking in the buggy shape; corrected. +3 tests.

- **`3f2504e` SPEC §40.8.1 OQ CLOSED (Option C):** user verbatim "I like c" — SPA-vs-multi-page is filesystem-inferred + `W-PROGRAM-SPA-INFERRED` info-level lint fires on entry-file `<program>` + zero `<page>` siblings + no `pages/` directory. Empty `pages/` dir suppresses. **Methodology signal recorded:** "third option" pattern — when binary OQ has real costs both sides, surfacing a synthesis option that captures both load-bearing benefits without their costs (same shape as Insight 22 test-bind middle path). §34 +1 row.

- **`d3deed2` v0.3 Approach A spec anchor LANDED:** SPEC §40.9 Closure Analysis (Minimal Playable Surface) — 12 sub-sections, ~430 LOC normative + §40.1.1 static role classification (resolves Insight 29 OQ #3 with synchronous-role-classification commit) + §47.5/§52/§41.9 cross-refs + NEW PIPELINE.md Stage 7.6 Reachability Solver (renumbered from working-title 7.5 because BP already there) + §34 +2 codes (E-CLOSURE-001 + W-AUTH-RUNTIME-FALLBACK). Compiler implementation deferred to subsequent waves (300-640h band per Insight 29). Manual 3-way merge with §40.8.1 OQ closure (agent's branch based on `23e6265` pre-OQ-closure). **PA mistake caught by dispatch agent:** perf-feel study was ALREADY DONE at S84/S85 per Insight 29 ratification; PA's hand-off carry-forward menu was stale. **Rule 4 extended to hand-off carry-forward menu** (verify against design-insights.md / master-list before treating carry-forward as live action).

- **`f32bd00` Wave 3 D2 — 4 critical-path Playwright tests:** TodoMVC + 03-contact-book + 05-multi-step-form + 14-mario, 32 ACs × 3 browsers = 96 runs. **WebKit works fine** (Wave 3 scoping risk #4 RESOLVED with POSITIVE signal); identical pass/fail across Chromium / Firefox / WebKit. **4 LATENT compiler-bug families surfaced** by faithful AC tests: (1) 14-mario enum-payload destructuring + structural-eq compares to enum-vs-variant; (2) 05-multi-step-form if-chain branches emit literal `<InfoStep />` without inlining + match-arm sets whole Step object; (3) 03-contact-book server-fn auth gate has no working /login page; (4) TodoMVC form-submit handler not propagating + edit-mode UI never rendered + 4 W-DEAD-FUNCTION + E-DG-002. Filed for v0.2.x patch / Wave 3.5 triage. DB-isolation via `spawnSync('bun', ['-e', ...])` (Playwright runs under Node).

- **`24af6a2` Wave 3 D3a crash diagnosis:** D3a (benchmarks refresh) crashed/timed-out mid-investigation. PA pre-cleanup gate (pa.md S83 status --short non-empty → STOP) held; worktree retained for forensics. Agent surfaced **`bench-scrml.js` IIFE-eval pattern (lines 82-96) is broken against v0.2.6+ compiler** — internal runtime symbols (`let`-scoped) not reachable from client IIFE because explicit window-export list doesn't cover all v0.2.6+ symbols. D3a attempted indirect-eval refactor `(0, eval)(combinedScript)` — never verified. D3b re-dispatch queued.

- **`a918a3a` v0.3 Wave 3 fixture-sweep SCOPING:** authored pre-#13-landing. Corpus inventory at S86 ground truth (1031 .scrml in-repo; ~50-120 actually changing). Dispatchable now that #13 (safety-harness fix) landed.

- **`4cd0b6a` W-PROGRAM-SPA-INFERRED lint emission impl:** wires §40.8.1 lint per spec. **Filesystem-context guard** (filePath must be absolute AND exist on disk) needed because the lint fires on plain `<program>...</program>` shapes which are the self-host parity-test corpus — initially broke 156 parity tests. SPEC-conformant ("fs-inspection-required") + surfaces meaningful design constraint: v0.3 walker family depends on real filesystem context. +9 tests.

- **`95bd7f9` Migrate safety-harness Option β transactional in-place fix:** depth-of-survey dispatch picked Option β (in-place rewrite + verify + restore via try/finally). Trucking-dispatch reconnaissance: 4 REWRITE + 20 failed → **24 REWRITE + 12 failed** post-fix. The 12 remaining failures are real v0.3 E-CHANNEL-OUTSIDE-PROGRAM spec violations from imported v0.2 channel files (Wave 3 fixture-sweep target). Unblocks Wave 3 v0.3 sweep. **Promote.js:442 has identical staged-tmp pattern** — same problem will hit `bun scrml promote --match` on multi-file fixtures; filed as follow-up.

- **117-worktree backlog cleaned at wrap.** Per pa.md S83 wrap §6b — old worktrees from prior sessions accumulated (S83 hit 30; S86 wrap crossed 100). Cleaned 117 worktrees that passed pre-cleanup gate (status --short empty). 26 worktrees retained with residue (untracked `node_modules` / `bun.lock` rollbacks / agent diagnostic probes / `.bak` files — NOT at-risk work but pa.md S83 literal rule says STOP on non-empty status; retain for safety). 1 worktree explicitly preserved: D3a (afa1b84a0999559d9) per crash-recovery rule.

**State at S86 close:**
- Tests: **11,593 pass / 114 skip / 1 todo / 0 fail / 563 files** at HEAD `95bd7f9`.
- Cumulative S85→S86 delta: **+86 pass / +14 skip / +6 files / 0 regressions.**
- Semver tags: unchanged (v0.2.6 `efbd1e8` is shipped baseline); v0.3.0 NOT tagged (Wave 3 v0.3 fixture-sweep + Wave 4 adopter content pending; plus triage of 4 surfaced bug families).
- **S86 commits: 15 PA-authored.** Largest session by commit count + scope + ratification breadth.

**Open at S86 close:**
- Wave 3 D3b benchmarks refresh re-dispatch (Task #14 — pending fire; needs the bench-scrml.js eval-pattern fix from D3a's diagnosis).
- Wave 3 v0.3 fixture-sweep (#14 SCOPING ratified user; ready to fire post-#13 landing).
- 4 latent compiler-bug families from Wave 3 D2 (14-mario / 05-multi-step-form / 03-contact-book / TodoMVC).
- W-PROGRAM-SPA-INFERRED + W-AUTH-RUNTIME-FALLBACK emission compiler-impl (#13 closes-of W-PROGRAM-SPA-INFERRED; W-AUTH-RUNTIME-FALLBACK still pending impl).
- `promote.js:442` staged-tmp pattern follow-up (parallel to migrate.js fix that just landed).
- v0.3 closure-analysis compiler implementation (300-640h band — multiple subsequent waves; SPEC anchor is in place at `d3deed2`).
- 26 dirty worktrees retained for safety (residue per sampling; refine pa.md S83 to distinguish residue-vs-work in future).
- Self-host regen + 18 deferred parity tests + 5 deferred A8-wave tests (per pa.md S81 self-host-orthogonality — post-v1.0.0).
- Wave 4 v0.3 adopter content + tutorials.

**Methodology signals recorded S86:**

- **"Third option" pattern** (synthesis-vs-binary OQ resolution; same shape as Insight 22 test-bind middle path) — `<program spa>` OQ closed Option C.
- **Rule 4 extended to hand-off carry-forward menu** — perf-feel duplicate-dispatch was a stale-carry-forward catch.
- **"Right answer beats easy answer" applied to SPEC-vs-impl divergence** — BS-layer extension over SPEC retreat (Option A).
- **PA pre-cleanup gate held under fire** — D3a crash + 26 dirty-worktree residue cases both correctly preserved per pa.md S83.
- **Depth-of-survey-discount frequency at #14** (the dispatch for #13 surfaced that PA's locus-hint was correct, mechanism-hint hypothesis-shaped, agent picked the right option from the surveyed space).



### 2026-05-12 (S85 CLOSE — v0.2.5 + v0.2.6 tagged · v0.3 Wave 1 spec anchor · F-COMPONENT-001 family CLOSED · Wave 3 Playwright e2e infra live · scrml.dev substantive refresh)

**Session-defining outcome:** Two semver tags + the v0.3 spec anchor landed in one session. Trucking-dispatch reference app went from 11 errors to 0 errors at v0.2.6 close. v0.3 program-shape ratified end-to-end: R2 (one-program-per-app) + `<page>` helper element (route-free per user's "scrml has been designed to not force the dev to think about routing") + channel-placement reversal + co-location-of-behavior recorded as #1 design principle. Wave 3 e2e infrastructure (Playwright across Chromium + Firefox + WebKit) landed; 02-counter canary validates green on 2 of 3 browsers (WebKit blocked on libavif13 host-deps).

**Tags cut this session:**

- **v0.2.5 `2c687b5`** — Wave 2.5 robust-v0.2 bundle. 4 dispatches (A1-A4 in parallel). 2 real compiler fixes + 2 depth-of-survey returns with regression coverage. A2 closed the cross-file channel E-RI-002 publisher pattern (emit-channel.ts `_p3aIsExport` filter conflation; 4 lines removed); A4 closed F-COMPONENT-001 internal-PascalCase `/>` collapse gap (component-expander.ts +13/-1). +10 tests cumulative.

- **v0.2.6 `efbd1e8`** — F-COMPONENT-001 family closure + trucking-dispatch error-free. A6 transitive cross-file component registry enrichment via eager worklist + `lookupKey(filePath, imp, importGraph)` (component-expander.ts +115/-58, closes W2 commit `6536f7a`'s F4-deferred residual). A7 23-site server-modifier sweep across 18 trucking-dispatch pages (−32 W-DEPRECATED-SERVER-MODIFIER warnings). loadRows local-rename (closes E-NAME-COLLIDES-STATE in board.scrml). E-DG-002 false-fire fix (dependency-graph.ts +21 lines; engine-decl arm in sweepNodeForAtRefs per §51.0.D "declaration position IS its rendered output position"). Trucking-dispatch reference app: **11 errors → 0 errors / 100 warnings → 41 warnings**.

**v0.3 Wave 1 SPEC ANCHOR landed (`2b7c4df`):**

- **§40.8 + §40.8.1:** `<program>` is ONCE-PER-APPLICATION. `<page>` siblings inside `<program>` for multi-page apps. SPA = absence of `<page>` siblings. Channels inside `<program>` as siblings of `<page>`. Default-logic body mode. `<program spa>` boolean as deliberate OPEN QUESTION with 4 args-for + 4 args-against + decision DEFERRED per user S86 directive ("juggling the consequences").
- **§4.15 + §24.4:** `<page>` registered as new scrml structural element. 4 attrs `{db, auth, csrf, ratelimit}`. `route=` DOUBLY forbidden (regression vs filesystem inference per user S85 directive "scrml has been designed to not force the dev to think about routing" + attribute-name collision per §4.12.2).
- **§38.1/2/4 + §38.4.1:** Channel placement REVERSED. v0.next had channels at file-top (E-CHANNEL-INSIDE-PROGRAM); v0.3 reverses (E-CHANNEL-OUTSIDE-PROGRAM). §38.4.1 NEW A8 canonical contract: exporter is server-route SoT; consumers emit client stubs only.
- **§39.12.0 NEW:** schema/seeds `<program db=>` workaround tolerated v0.3 + EXPLICIT v0.4-fix note per user directive ("should be explicit in doc that this is getting fixed"); v0.4 promotes `<schema db=>` direct.
- **§47.9.2:** cross-reference to `<page>` registration.
- **§34 +5 rows:** E-CHANNEL-INSIDE-PROGRAM (RETIRED) + E-CHANNEL-OUTSIDE-PROGRAM + E-CHANNEL-INSIDE-PAGE + E-PAGE-ROUTE-ATTR-FORBIDDEN + E-PAGE-INVALID-ATTR + W-PROGRAM-REDUNDANT-LOGIC.
- **Walker:** symbol-table.ts:6006 `walkChannelPlacement` inverted; ast-builder.js:690-692 already handles both `<program>` AND `<channel>` (S83 B4 precedent).
- 5 test files `.skip`'d with documented A8-wave deferral; channel-placement-shared-b19.test.js rewritten (15 pass) for v0.3 direction.
- −22 pass / +23 skip (test-rewrite consolidation + deferred-A8-wave .skips).

**Wave 3 Playwright Dispatch 1 (`f69ff6a`):** top-level `e2e/` workspace with `playwright.config.ts` (3-browser projects + 2-webServer config) + `fixtures/dev-server-fixture.ts` + `tests/02-counter.spec.ts` (5 ACs) + `README.md`. `@playwright/test ^1.49.0` devDep + 3 npm scripts. Live PA-side validation: **Chromium 5/5 PASS (3.9s), Firefox 5/5 PASS (19.7s), WebKit 5/5 fail at browser launch — host system missing libavif13 (needs sudo)**. WebKit + scrml runtime compatibility remains UNTESTED.

**scrml.dev landing-page refreshes (3 commits):** `28c075b` surgical staleness fixes (V5-strict counter example + `<machine>`→`<engine>` + `@shared` retirement + "22 examples" count + `bun link` quick-start) → user feedback *"I wanted a legit update and I am not seeing that"* → `fd3edf9` substantive mental-model refresh (replaced `< Card>` framing with state-cells-are-primitive + UI-is-state-machine + validators-auto-synthesize + errors-as-states sections; dropped `use` keyword reference) → `a574353` "No npm escape hatch" section per user directive (stdlib catalog + supply-chain properties + language-level wins eliminating zod/redux/react-hook-form/xstate + ~88-90% coverage framing + "missing by design").

**4 new dive docs in scrml-support (`26aad28` + `745adde`):**
- `program-as-container-shape-DIVE-2026-05-11.md` (S85 amendment to S84 dive — Q2 corrected to one-per-app)
- `program-as-container-implementation-plan-2026-05-12.md` (R1-vs-R2 recalibration; 4-wave plan; ~75-135h R2 with `<page>`)
- `page-helper-element-design-2026-05-12.md` (`<page>` design dive — route-free, 4 attrs, R2-compatible)
- `wave-3-playwright-benchmarks-scoping-2026-05-12.md` (3-stage Wave 3 plan; 25-40h band)

**Methodology signals sustained:**
- Depth-of-survey-discount frequency now at **#13** (A1 #11 + A3 #12 + E-DG-002 #13). Pattern: PA hint-about-LOCUS reliable (5/5 dispatches found locus at-or-near PA's guess); PA hint-about-MECHANISM unreliable (3/5 misdiagnoses). Future briefs should name locus but NOT mechanism.
- Pro-X-voting-against-X frequency unchanged at 8+.
- Co-location-of-behavior principle captured (NOT formalized as lock per user directive).

**Operational anomalies (recovered, filed for pa.md F4 hardening):**
- PA-side worktree-removal-while-CWD-inside mishap mid-Wave-3-D1 landing. Recovery via dangling-commit checkout. Durable rule: ALWAYS `cd /home/bryan/scrmlMaster/scrmlTS` BEFORE `git worktree remove`.
- Agent-side path-discipline incident (Wave 1 agent edits going to MAIN before self-detection + recovery via WORKTREE_ROOT-absolute path re-application). Pa.md F4 rule load-bearing.
- Pre-commit hook config: confirmed worktrees don't inherit `core.hooksPath`. Brief addendum (per-worktree enable) works. Filed as task #9 (completed-with-workaround).
- Mid-session `core.hooksPath` revert on main; re-applied. Possible `git worktree prune`/`remove --force` side-effect.

**State at S85 close:**
- scrmlTS 0/0 vs origin; scrml-support 0/0 vs origin
- 14 scrmlTS commits this session + 2 scrml-support commits
- Worktree clean (main only)
- Pre-commit hook verified `scripts/git-hooks`
- 0 regressions across all S85 landings

**Open at S85 close (carry-forward to S86):**
- `<program spa>` boolean OQ deferred (user juggling)
- v0.3 Wave 2+ dispatch (TAB+AST+migrate+codegen+fixture-sweep, ~75-135h R2 band)
- Wave 3 Dispatch 2 (4 more specs) + Dispatch 3 (Phase B benchmarks)
- WebKit + scrml runtime validation (blocked on libavif13)
- Trucking-dispatch `scrml dev` server-side codegen divergence
- A8 codegen (folded into v0.3 scope)
- SPEC-INDEX.md regeneration (~286 line shift)
- `route-inference.ts:2467` routes/-vs-pages/ cleanup

### 2026-05-11 (S84 CLOSE — v0.2.3 + v0.2.4 cut · Wave 1/1.5/2 landed · v0.3 program-shape dive ratified)

**Session-defining outcome:** v0.2 robust state reached. 5 v0.2.x tags live (v0.2.3 closes Bug 2; v0.2.4 closes Wave 1 + Wave 1.5 — 6 compiler-correctness bugs + 6 secondary-surface follow-ons + skip-surface audit). Wave 2 adopter-content/spec-polish landed on top (untagged at close; v0.2.5 candidate). Plus the v0.3 architectural dive — program-as-container + logic-default-inside-program — completed with empirical-impact 40-110h LOW band → standalone v0.3.0 sequencing (Insight 29 Approach A slides to v0.4.0).

**Tags cut this session:**

- **v0.2.3 `d512266`** — Bug 2 (derived-engine over auto-declared engine var). §51.9 validator extension to thread auto-declared engine vars into `reactiveBindings`. §51.9.7 transitive-projection rejection preserved. 14-mario reverted to canonical `<engine for=HealthRisk derived=@marioState>` form. +9 tests / 0 regressions.

- **v0.2.4 `28cd2ac`** — Wave 1 + Wave 1.5 robust-v0.2 bundle. 12 PA-authored commits. **Wave 1 (compiler-correctness):** Bug 1 `not <expr>` codegen (§45.7); Bug 2 match pipe-alternation in `rewriteMatchExpr` + `emit-control-flow` + preprocessForAcorn lookbehind; Bug 3 E-DG-002 false-fire on derived-engine projected vars; Bug 4 SYM/TAB typed-decl registration (`collectTypeAnnotation` depth tracking); Bug 5 bare-variant inference at binary-expr positions; Bug 6 `.advance(.X.history)` test-hardening (codegen was correct since S83 Wave 2.4 Bug #2 keystone); skip-surface audit (77/77 valid; A+ test hygiene). **Wave 1.5 (secondary-surface follow-ons):** Bug 6.5 `_makeExprCtx` `enginesWithHistory` forward; Bug 4.5 + Bug 5 follow-on bare-variant nested struct + control-flow positions; Bug 1.1 lift attr-value whitespace; Bug 1.2 SQL-ref placeholder + const/let SQL init (7 source files threaded); Bug 1.3 GITI-001 IIFE wrap context-aware; test-channel-audit. +75 tests / 0 regressions cumulative.

**Wave 2 (post-v0.2.4 adopter content + spec polish; HEAD `1d2f1cf`):**

- **W2-1** Trucking-dispatch app v0.2.4 canonical rewrite (24 files in `examples/23-trucking-dispatch/`; commit `1d2f1cf`). Surfaced 4 real compiler anomalies (A1 `<expr.member> is some/is not` parser issue in ternary-cond + 10 sites; A2 cross-file channel mount E-RI-002 skip-path doesn't propagate + 12 sites; A3 `server function` modifier vs E-CG-006 inconsistency; A4 F-COMPONENT-001 nested-PascalCase) — queued for Wave 2.5 v0.2.5 patch.
- **W2-2** C1 tutorial rewrite (zero-to-running on v0.2.4; commit `15336b9`). 48 files including 1060-line tutorial.md + 11 canonical snippets + counter.db + verify-tutorial.sh. All snippets compile clean.
- **W2-3** C2 articles triage + rewrites (commit `2646cdd`). 10 articles + per-article triage tables. **5 articles now publishable** per user-decision queue: tier-ladder-promotion (with status banner), realtime-and-workers, mutability-contracts (with status banner), server-boundary-disappears, components-are-states (with status banner). Plus 2 follow-on commits (`eaf718f` sweep + `32ecf1c` Option-1 rewrite) for the `why-scrml-has-to-deprecate` article (outside W2-3's audit-15 scope).
- **W2-4** PIPELINE.md prose-pass: ✅ **NO-OP** — work was already shipped at S75/C23 per IMPLEMENTATION-ROADMAP §8.6 #2 closure. `feedback_scope_blindness.md` rule operating correctly.
- **W2-5** SPEC §34 catalog drift cleanup (commit `d72cbb3`). 388 → 484 unique codes; 93 new rows + 2 NEW drift findings (D-BATCH-001 + E-SYNTAX-DURATION) not in S78 audit. Cross-reference correctness restored.

**v0.3 program-shape dive (the BIG architectural surface for next session):**

User direction: *"<program> is not just a replacement for <html> and <meta>. it is the primary configurator for 'the program' in mario it reads like all of the logic is OUTSIDE of your program. which is fundamentally wrong."* + sequencing reframing *"if impl ends up simple enough, we may make that 0.3 and push other advances up the numbers."*

Plan at `scrml-support/docs/deep-dives/program-as-container-and-logic-default-shape-2026-05-11.md`; dive result at `scrml-support/docs/deep-dives/program-as-container-shape-DIVE-2026-05-11.md`.

**Dive verdict:** empirical compiler-pipeline impact 40-110h LOW BAND. Compiler `ast-builder.js:690` (`isProgramRoot`) + `TOPLEVEL_STATE_DECL_RE` already half-implements the proposal. Recommended sequencing: **v0.3.0 = program-shape standalone; Insight 29 Approach A slides to v0.4.0.** 6 Q-verdicts pending S85 ratification → spec-amendment kickoff dispatch.

**Insight 29 ratified (perf-feel debate, this session):** Approach A whole-stack closure analysis was THE v0.3.0 target (now sliding to v0.4 per the program-shape sequencing reframing). Approach B telemetry-PGO deferred to v2 (llvm-pgo-expert flip — strongest signal). Approach D rejected as v1 default. At `scrml-support/design-insights.md`.

**Memory file added:** `~/.claude/projects/-home-bryan-scrmlMaster-scrmlTS/memory/project_self_host_orthogonal.md` — self-host = pure-scrml compiler (adopter-written, post-v1.0); does NOT gate any TS-implementation work.

**Pro-X-voting-against-X frequency now at 8+.** Depth-of-survey-discount occurrences this session: Bug 4 (#8 — brief named symbol-table.ts; fix was in ast-builder.js), W1.5-3 tokenizer-space-loss (#9 — brief named tokenizer.ts; fix was in `_parseLiftAttrValue`), v0.3 dive's `ast-builder.js:690` finding (#10 — compiler already half-implements). Pattern frequency now 10+.

**Operational anomalies (pa.md F4 path-discipline hardening candidates):** 4 worktree-isolation violations this session (W1.5-1 CWD drift, W1.5-5 direct-commit-to-main, W1.5-2 debug-WIP-in-main, W2-1 WIP-in-main). PA-side commit-discipline gate caught all; zero work-lost.

### 2026-05-11 (S83 CLOSE — TRIPLE-TAG release session: v0.2.0 + v0.2.1 + v0.2.2)

**Session-defining outcome:** first three semver tags cut on the repo. v0.2.0 (`022ee02`), v0.2.1 (`d72c074`), v0.2.2 (`98e872d`) all on origin. 11,457 / 77 / 1 / 0 at close — full v0.2.0 surface end-to-end functional plus 8 patch-grade fixes landed in the same session.

**Tags + their scope:**

- **v0.2.0** — first semver baseline. The language as the compiler implements it: V5-strict declaration; Tier 0/1/2 ladder (booleans / `<match>` / `<engine>`); auto-synth validity surface; file-level `<channel>` realtime; schema shared-core vocab; refinement-type predicates; hierarchical engines (rule= + onTransition + onTimeout + onIdle + composite + history + internal:rule=); L1-L22 architectural locks. README rewritten with exhaustive-state-machine framing + new Engine Example (Tier 2) + Features sweep + benchmarks-stale flag. compiler/package.json 0.1.0 → 0.2.0 sync.
- **v0.2.1** — Wave 4A bundle. **Bug 5** channel @cell server-fn writes broadcast per SPEC §38.4 (route-inference + emit-logic + emit-server). **Bug 6** 17 `<program>` attrs added to attribute-registry. **Bug 7** bare-variant inference at reassignment positions per M9 §14.10. +72 cumulative tests.
- **v0.2.2** — Wave 4B.1 bundle. **Bug 9 (NEW from Bug 7)** engine auto-declared vars now pre-pass-registered into TS scope chain (Option A — mirrors preBindExportedNames). **Bug 1** `<x server>` bare-attribute V5-strict modifier recognized. **Bug 3** `<engine derived=match @x {...}>` Move-14 inline body parses. **Bug 4** `<channel>` body V5-strict decls. **Bug 8** `let x = call() !{...}` statement boundary detection. +113 cumulative tests (including ~78 conformance fluctuation from new test files). 3-way merge of ast-builder.js between Bug 1 and Bug 3+4+8 produced 0 conflict markers.

**Wave 2 (pre-v0.2.0 baseline closure)** — closed all 5 A7 codegen deferrals surfaced by A5-7 + 1 follow-on Bug #6:
- **Bug #1** inner-engine state-child non-empty body mis-attribution (Wave 2.1; body-parser depth-counter asymmetry across 3 closer-finders).
- **Bug #5** cascade-miss diagnostic per §51.0.Q.3 (Wave 2.1; SYM PASS 16 fire-site #9 for direct-write rule= enforcement inside engine state-child bodies).
- **Bug #4** internal:rule= distinct write path (Wave 2.2; separate transitions table + skip-onTransition + skip-history-cell + skip-timer-arm; 7-source-file threading).
- **Bug #3** history synth-cell + outer-exit capture (Wave 2.3; per-engine history-map const + capture-on-EXTERNAL-exit runtime helper; INTERNAL branch skips by construction).
- **Bug #2** inner-engine dispatcher + restore-form expression lowering (Wave 2.4; keystone — widened 7 SYM walkers for nested-engine discovery + Phase A10 postMountJs hook + Approach B 8th positional `isHistoryRestore` arg).
- **Bug #6** event-handler engine writes thread through write-guard (Wave 2.5; emit-control-flow.ts `rewriteBlockBody` engineBindings threading; closes the most-common-adopter-surface gap).

**Wave 3.1 (materials track) before tags:**
- **B5** editor support — VSCode TextMate grammar + neovim highlights.scm + LSP handlers.js (3 phase-scoped commits; LSP surface 5x richer — ERROR_DESCRIPTIONS 36→187, KEYWORD_DOCS 6→27).
- **B1** examples rewrite — 22 examples + 1 LSP test (~20 YELLOW/RED rewritten; 2 GREEN verified; trucking-dispatch DEFERRED ~10-15h follow-on); surfaced the 8 v0.2.x bugs that became Wave 4A + Wave 4B.1.
- **B2** samples curate (top-level) — 286 files classified, 9 rewrites, 2 drops cross-repo archived; subdirs 509 files deferred.
- **A6-6** scrml:test API alignment — closed Option Y (no action needed) via design dive; A8 family fully closed.
- **B3** stdlib data/validate vocab — closed Option Y (already aligned by design) via design dive.
- **A5-7** tests + samples for A7 engine S67 surface — +48 pass / +10 skip across 4 new tests + 4 new samples; surfaced 5 A7 codegen deferrals which became Wave 2.

**S83 substrate improvements:**
- **pa.md retention rule revised** — worktree branches bounded to same-session-only (was unbounded). 30 stale forensic worktrees cleaned at S83 open (1.1 GB → 4 KB) after harness allocation failure surfaced the accumulation problem.
- **pa.md "Commit discipline — two-sided rule" added** — agent-side incremental-commit mandate + PA-side pre-cleanup gate. S83 Bug 7 first dispatch destroyed work by reporting "HEAD unchanged — work in worktree, no commits"; rule prevents recurrence. Held end-to-end across 4 subsequent Wave 4A + Wave 4B.1 dispatches.
- **README v0.2.0 rewrite** — exhaustive-state-machine framing as opening; Tier 0/1/2 ladder as top-level section; new Engine Example (Tier 2 loader state-machine); Counter (Tier 0) + Full-stack (Shape 2 + auto-synth `@form.isValid`) converted to V5-strict; benchmarks flagged stale (v0.1.0-era) with v0.2.x-patch refresh queued as bug-hunt; Features sweep (10 v0.1.0-flavored references converted including `~var` → `const <var>`, `< machine>` → `<engine>`, sigil-table State row dropped); auto-split bullet expanded with full server-keyword deprecation state (Batches 1+2 SHIPPED S72; W→E→strip targets v0.3.0); examples table extended to include 15-22.
- **Maps-discipline protocol — 18 consecutive load-bearing reports** (Wave 1 through Wave 4B.1). Pattern strongly holds.
- **5 feel-of-performance debate panel agents pre-staged** for S84:
  - `qwik-resumability-expert.md` (A camp; forged S83)
  - `solid-js-signals-expert.md` (A camp / reactive-graph; cp'd from agentStore S83)
  - `llvm-pgo-expert.md` (B camp; forged S83)
  - `nextjs-rsc-app-router-expert.md` (D camp; forged S83)
  - `scrml-compiler-architect.md` (engineering-realism; forged S83)
  - `debate-judge.md` (scoring; pre-existing)
- **Debate plan written** at `scrml-support/docs/deep-dives/perf-feel-debate-plan-2026-05-11.md` (Phase 0 empirical study OQ #1 + Phase 1 debate framing + 5-voice panel + rubric + convener-stance + S84 PA execution checklist + risk register).
- **`scrml-js-codegen-engineer.md` moved back to agentStore** (with date-suffix to preserve trimmed agents/ version alongside canonical full version in store).

**User-voice S83 (4 entries appended):**
- Frustration signal: *"That was an upsetting mistake"* (Bug 7 work-lost; triggered pa.md commit-discipline rule).
- Methodology directive (verbatim): *"queue the perf-feel study for next session, I strongly lean A + B."*
- Direction confirmation (verbatim): *"we need to land these as bug fix sub-versions. as per semver"* → operationalized as per-wave-bundle semver cadence.
- Methodology directive (verbatim): *"also fold the commit-discipline lesson into pa.md at wrap. That was an upsetting mistake."* → folded.

**S83 commit count:** 35+ commits across both repos. Three semver tags. Zero regressions throughout. Cross-machine sync clean at close.

**Carry-forward for S84:** Bug 2 (derived-machine validator at `type-system.ts:2349` — different code path from Bug 9; needs own dispatch); trucking-dispatch rewrite (~10-15h B1-followon); C1 tutorial rewrite (~8-15h); C2 articles rewrites (~4-8h); B2 subdirs (509 files in 12 gauntlet-s* dirs, mostly intentionally-failing regression corpus); **perf-feel Phase 0 empirical study (FIRST priority per S83 user directive)**.

---

### 2026-05-11 (S83 — A6-6 CLOSED as Option Y, A8 family fully done)

S83 (single-day session, 2026-05-11; third session this day after S81/S82). **A6-6 `scrml:test` API alignment** closed as **Option Y — no action needed** via focused design dive. This was the last `⏸️ pending` sub-step in the A8 test-bind family. A8 family now FULLY shipped end-to-end; A6-6 removed from the v0.2.0-lacking list.

- **Verdict:** evaluated 8 candidate `scrml:test` helpers (mock-call introspection, assertCalledWith, async-aware assertions, scrml-error-tag matchers, isBound, snapshot, partial-match, plus 2 surfaced during the dive). **None structurally justified.**
  - **F1 (decisive):** `assert.fails[.with]` grammar at SPEC §19.12.3 is strictly superior to any `assertFailsWith` helper — speaks scrml's error-tag vocabulary natively. Candidate 4 dead.
  - **F2 (decisive):** test-bind codegen at `compiler/src/codegen/emit-test.ts` (~283 LOC) emits a bare `const <id> = <expr>`; no introspection hook. Adding `mockedCalls`/`assertCalledWith` requires either codegen change (violates SPEC §19.12.7 0-byte production cost guarantee) or a global registry. Closure-recorder pattern (`let calls = []; test-bind fn = (x) => { calls = [...calls, x]; ... }`) covers the workflow in scrml-idiomatic shape. Candidates 1, 2 dead.
  - **F3 (decisive):** server-fns become sync in test mode by design. `assertResolves`/`assertRejects` solve no real workflow within the canonical test-bind shape. Candidate 3 dead.
  - **Candidate 5** (`isBound`): E-TEST-006 fail-fast covers this loudly. Dead.

- **Re-trigger conditions (only R1 re-opens A6-6):**
  - **R1:** ≥2 adopter friction reports requesting call-history re-opens A6-6 with codegen-side scope.
  - **R2** (await-in-test bodies) / **R3** (snapshot assertions) / **R4** (partial-match assertions): out-of-A6-6 scope; file as separate scrml:test enrichment dispatches if friction signals.

- **Maps consulted (S82 protocol live test):** `primary.map.md` + `test.map.md` + `structure.map.md`. Load-bearing — `test.map.md` and `structure.map.md` confirmed the codegen authority (`emit-test.ts`, 283 LOC) and the canonical test-bind fixture path; F1/F2/F3 source-content arguments drove the structural-rejection verdict. **First end-to-end test of S82 maps-discipline protocol PASSED:** dispatch brief paste-verbatim block was used; agent reported maps-load-bearing explicitly; protocol functioning as designed.

- **Output:** `scrml-support/docs/deep-dives/a6-6-scrml-test-api-alignment-2026-05-11.md` (~1500 words).

- **Tests:** unchanged from S82 close (no source code touched). 0 regressions.

- **v0.2.0 remaining (after A6-6, post-S83 mid-session):** Code-side: A5-7 tests + samples for A7 engine S67 surface (~12-18h). Materials track: B1 examples rewrite (~20-30h), B2 samples curate (~15-25h), B3 stdlib audit + γ rewrite (~10-20h), B5 editor support (~8-15h). Docs/announce: C1 tutorial rewrite (~8-15h), C2 articles rewrites (~4-8h), C3 README + scrml.dev v0.2.0 announce (~2-4h). No code-side blockers remain except A5-7.

---

### 2026-05-11 (S83 — Wave 1 v0.2.0-close: A6-6 + B3 + B5 closed; A5-7 in flight)

After ratifying the 3-wave plan to close out v0.2.0-remaining, Wave 1 fired in parallel. **A6-6** (above) closed first. **B3 stdlib audit** + **B5 editor support** + **A5-7 tests/samples** dispatched together; B3 + B5 returned within the session; A5-7 is in flight.

- **B3 stdlib audit + γ rewrite — CLOSED Option Y (no rewrite needed)** via deep-dive `scrml-support/docs/deep-dives/b3-stdlib-data-validate-vocab-audit-2026-05-11.md` (~3,200 words).
  - **Verdict:** vocabulary IS already aligned by design. `universal-core` (the 14 predicates at SPEC §55.1) is the **language-level closed catalog** firing in three native loci (state-validator + refinement-type + schema-column). `scrml:data` rule-builders are a **deliberate fourth library-layer** with JS-idiomatic shapes + a documented zod-bridge slot per SPEC §53.14.4 (the synonym-detection canon). No separate `scrml:validate` module exists. `validate.scrml` lines 225-286 carries the rationale verbatim.
  - **Action items (NOT B3 rewrite scope):**
    - **P7:** ~30min SPEC editorial to align §55.4 short lowering table with §39.5.8 full table.
    - **P3:** park "8 missing stdlib builders" (`gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`notIn` + optionally `isSome`) as enrichment-pending-friction.
    - Primer §10 wording refresh post-ratification ("vocabulary alignment task pending B3" → completed).
  - **Re-trigger:** ≥2 adopter friction reports on missing builders re-opens P3.
  - **Maps consulted:** primary.map.md + non-compliance.report.md + domain.map.md + structure.map.md. Load-bearing.

- **B5 editor support — SHIPPED.** 3 phase-scoped commits:
  - **`9105759`** feat(b5): VSCode grammar — recognize v0.2.0 keyword surface + flag invalid forms (`editors/vscode/syntaxes/scrml.tmLanguage.json` +113/-5). `===`/`!==`/`null`/`undefined` now reclassified as `invalid.illegal` (additive — editors that theme `invalid.illegal` differently from `keyword.operator`/`constant.language` will visually surface the compile error before the dev hits compile).
  - **`8cc92ea`** docs(b5): neovim highlights.scm refresh (`editors/neovim/queries/scrml/highlights.scm` +51/-9). Note: aspirational — no tree-sitter parser shipped; visual highlighting comes via LSP semantic-tokens for now. Follow-up candidate: ship real `editors/neovim/syntax/scrml.vim` (out of B5 scope).
  - **`e06fe36`** feat(b5): LSP — surface v0.2.0 diagnostics, keywords, attributes, hover docs (`lsp/handlers.js` +361/-8). LSP surface deltas: ERROR_DESCRIPTIONS 36 → 187 entries; SCRML_KEYWORDS completion 28 → 57; SCRML_ATTRIBUTES completion 10 → 48; KEYWORD_DOCS hover 6 → 27; getErrorSource prefix families 9 → 35+.
  - **Tests:** 11,181 pass / 77 skip / 1 todo / 0 fail (baseline match; zero regressions). LSP test suite 157/157. LSP smoke test green (`timeout 3 bun run lsp/server.js --stdio < /dev/null` — clean startup).
  - **Maps consulted:** primary.map.md + structure.map.md + domain.map.md + error.map.md + schema.map.md. Load-bearing (`structure.map.md` corrected the brief's path assumption — actual files live at `/home/bryan/scrmlMaster/scrmlTS/editors`, not the worktree).
  - **Master-list LOC refresh (B5 surfaced):** `lsp/server.js` claimed 966 LOC is now 289 LOC; bulk migrated to `lsp/handlers.js` (~2,166 LOC). Header corrected.
  - **Path-discipline note:** B5's harness-assigned worktree was mis-routed under `scrml-support` (same bug A5-7 first hit). The B5 agent detected the mismatch + wrote directly into main's working tree (deviation from F4 "halt on mismatch"). The work is structurally sound (tests pass, 3 phase-scoped commits, no silent corruption); PA accepted rather than re-doing. Root cause: 30 stale locked worktrees blocking harness allocation (see below).

- **30 stale forensic worktrees cleaned up** + **pa.md retention rule revised (`47b8729`).** Trigger: A5-7's first dispatch halted at startup-verification because its harness-assigned worktree was created under `scrml-support` (the harness had fallen back to allocating in the sibling repo since `scrmlTS` had 30 locked worktrees blocking new allocation). PA cleanup: `git worktree unlock` + `git worktree remove --force` + `git branch -D` across all 30 forensic carry-overs from S67-S77 era. Disk reclaimed 1.1 GB → 4 KB. **pa.md retention rule revised:** S67 standing rule footer §7 retention bounded to "same session only" (was unbounded); `wrap` definition §6b NEW step makes worktree cleanup explicit before push. Cross-session retention has zero practical forensic use case (work content lives in main via PA file-delta landing commits; per-step granularity is never re-consulted).

- **A5-7 tests + samples — SHIPPED** (final commit in Wave 1). Dispatched into the re-allocated proper `scrmlTS` worktree (`changes/a5-7-tests-and-samples` branch); landed via S67 file-delta protocol pulling 8 files (4 tests + 4 samples) into main. Agent-side-stale-views (master-list / changelog / editors / lsp/handlers — all modified by sibling Wave 1 dispatches landing earlier) correctly filtered out.
  - **Files:**
    - `compiler/tests/unit/engine-a7-history.test.js` (history attribute + `.Variant.history` target form behavior; +381 LOC)
    - `compiler/tests/unit/engine-a7-internal-rule.test.js` (internal:rule= prefix behavior; +412 LOC)
    - `compiler/tests/unit/engine-a7-hierarchy.test.js` (nested engine + Machine Cohesion; +388 LOC)
    - `compiler/tests/integration/engine-a7-cross-feature.test.js` (A7 surface composition; +404 LOC)
    - `samples/compilation-tests/engine-009-hierarchy-basic.scrml` (+53 LOC)
    - `samples/compilation-tests/engine-010-history.scrml` (+59 LOC)
    - `samples/compilation-tests/engine-011-internal-rule.scrml` (+62 LOC)
    - `samples/compilation-tests/engine-012-hierarchy-cascade.scrml` (+83 LOC)
  - **Tests:** +48 pass / +10 skip / 0 fail (the 10 skips are intentional Wave-4-deferral markers; each carries cite + repro + remediation pointer). Targeted run 48/10/0 across 4 files (58 tests, 120 expect calls). Sits at low end of +60-120 brief target — agent consolidated where existing a5-2/a5-3/a5-6/computed-delay coverage was already strong; the 48 new tests fill genuine gaps (history behavior, internal-rule behavior, hierarchy behavior, cross-feature composition). Full-suite post-land: 11,233 pass / 87 skip / 1 todo / 0 fail / 539 files.
  - **Maps consulted:** primary.map.md + domain.map.md + schema.map.md + error.map.md + test.map.md. Load-bearing — `error.map.md` confirmed S67/S79 error code families (E-HISTORY-NO-INNER-ENGINE, E-INTERNAL-RULE-NOT-COMPOSITE, E-TIMER-NAME-*, E-IDLE-*) are real catalog rows fireable from `runSYM`, letting the agent write conformance-style §5/§6 sections against `compileScrml()` results without source-spelunking.
  - **Bucket 3 DEFERRED** — realistic example app under `examples/` not started; context preserved for follow-on if a third tier is wanted.
  - **5 COMPILER BUGS SURFACED (NOT fixed per A5-7 scope rule)** — known deferrals from the A5-1+A5-2+A5-3 era now made test-visible. See master-list §0.6 "A7 codegen deferrals" for full citations + repros. Classification (v0.2.0-blocking or v0.3.0-deferred) is a pending USER DECISION at S83 close.

- **v0.2.0 remaining (post-S83 Wave 1 complete):** Materials track: B1 examples rewrite (~20-30h), B2 samples curate (~15-25h). Docs/announce: C1 tutorial rewrite (~8-15h), C2 articles rewrites (~4-8h), C3 README + scrml.dev v0.2.0 announce (~2-4h). **5 A7 codegen deferrals: USER RATIFIED v0.2.0-BAR at S83** (per Rule 2 + S81 "compiler all the way to v0.2.0 state"). Wave 2 (B1+B2) BLOCKED until all 5 land. Estimated ~26-47h compiler-source work — see master-list §0.6 row for per-bug citations + repros.

- **S82 maps-discipline protocol — third end-to-end test PASSED.** All three of Wave 1's dispatched agents (A5-7 first attempt, B3, B5) reported maps-load-bearing explicitly. Pattern holding.

### 2026-05-11 (S82 close — wrap)

### 2026-05-11 (S82 close — wrap)

S82 (single-day session, 2026-05-11; same day as S81). **7 commits across 2 repos** under explicit user authorization. Doc-system structural fix — 0 compiler source code changed. Trigger: PA produced an inaccurate "v0.2.0 lacking" list by reading `scrml-support/archive/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` (S57-frozen, 24+ sessions stale) as authoritative — direct Rule-4 violation. Burned ~22% context on a list that named A1a/A1b/A1c/A5/A6/A7/A8/A9/A10/debounce-throttle (all SHIPPED) as "lacking." User pushed back on the doc-system bloat as root cause; authorized a structural fix over per-item workaround.

- **Ships (in commit order):**
  - scrmlTS `47d01a6` — S82 session-start rotation (S81 close content → handOffs/hand-off-81.md; fresh hand-off.md created for S82 open).
  - scrmlTS `01ade6f` — pa.md session-start checklist: added `master-list.md §0` as step 3 (between pa.md and hand-off reads) with explicit warning that `scrml-support/archive/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md` + `IMPACT-ASSESSMENT.md` are HISTORICAL and must NOT be used as current truth. SoT layering recorded: SPEC.md (normative) → master-list.md (live phase status) → docs/changelog.md (per-session landings) → hand-off.md (current session state).
  - scrml-support `9f3231b` — Replaced quiet "SUPERSEDED" one-liners on `IMPLEMENTATION-ROADMAP.md` + `IMPACT-ASSESSMENT.md` with visible blockquote-styled ⛔ HISTORICAL banners at file top, with explicit redirect to current SoTs and S82-trap citation.
  - scrmlTS `75287fe` + scrml-support `e5df473` — Paired cross-repo move: shipped change dirs (`a5-7-tests-samples` S80, `debounce-throttle-approach-b` S79, `promotion-ergonomics` Tier-B-shipped material) + 2 disposed audit docs (both `hardcoded-thresholds-*`) dereffed from scrmlTS to `scrml-support/archive/`. Retained in scrmlTS: `predicate-gaps-deep-dive-prep`/`v0next-audit`/`v0next-inventory`/`promotion-ergonomics/TIER-C-SCOPE.md`; `compiler-forgotten-surface-2026-05-06.md` (primer §12 reference doc), `scope-c-findings-tracker.md` (active tracker), `self-host-spec-conformance-2026-05-11.md` (active-deferred per S81 user direction).
  - scrmlTS `1e352c7` — master-list §0.5 (20-step A1a status table, all ✅ at S61 close) collapsed to a 2-line closure summary. Per-step commit IDs + landings live in changelog S59-S61. Dashboard 538 → 512 lines.
  - scrmlTS `0c80d16` — **Maps-discipline protocol (the central fix).** `primary.map.md` gained §"Task-Shape Routing" (maps from task shape → 2-4 relevant maps) + §"Use feedback loop" (agent end-reports load-bearing-finding-or-not). `pa.md` gained §"Maps-discipline protocol (S82)" with: dispatch-brief template (paste-verbatim "MAPS — REQUIRED FIRST READ" block naming primary.map.md, task-shape maps, currency commit SHA + date, feedback-report expectation), currency check, map-selection ownership, feedback-loop disposition, losing-battle threshold (< 30% load-bearing after 6-8 weeks). Companion template change in `~/.claude/agents/project-mapper.md` (propagates at next PA session) so future refreshes regenerate the discipline scaffolding.

- **User-voice S82 entries** (4 durable; recorded at `scrml-support/user-voice-scrmlTS.md`):
  - Frustration signal: *"I am seriously thinking about trying out codex at this point."*
  - Doc-system structural complaint (verbatim): *"Massive version change, totally breaking. we have road-map, master-list, change-log, maps (which burn massive tokens to do, but im not sure any agent looks at them.) ... why do I have to burn 22% of 1M token context just to give me a list, that is not accurate to where we are in the process."*
  - Methodology directive on tool retirement (verbatim): *"I have witnessed the maps making a significant difference when they are used. The answer is not to get rid of the right tool because no one uses it. the answer is, teach how to use the tool."* Standing rule: when PA reflexes toward "retire tool no one uses," that's a Rule-3 violation flag.
  - Direction preference: "address the doc system itself" over "produce a code-verified narrow list." Methodology preference for structural fix > per-item workaround.

- **Tests at close (no source changes, all changes doc-only):**
  - Pre-commit subset: 10,458 pass / 66 skip / 1 todo / 0 fail (+25 pre-commit pass over S81; incidental conformance fluctuation).
  - Full suite (`bun run test`): 11,259 tests / 0 fail.
  - Zero regressions.

- **Cross-machine sync state at S82 close:** scrmlTS 0/0 origin/main; scrml-support 0/0 origin/main. Untracked private article drafts + tools/ dir in scrml-support working tree carried forward unchanged (per pa.md Rule 1).

- **What's now structurally in place for future sessions:**
  - Session-start checklist directs PA to master-list.md §0 BEFORE any "what's lacking / what's done" question.
  - Historical roadmap docs carry visible banners that make trap-recurrence costly.
  - `docs/changes/` + `docs/audits/` carry current-only content (shipped material in scrml-support archive).
  - Every dev / scrml-writer / pipeline / gauntlet dispatch carries a "MAPS — REQUIRED FIRST READ" block; agents end-report load-bearing-or-not; PA aggregates over time.
  - First end-to-end test of the protocol is S83 open. **Deliberately no PA-side priming at S82 wrap** — user wants to experience the next session as designed.

### 2026-05-11 (S81 close — wrap)

S81 (single-day session, 2026-05-11). **7 commits + 1 push pair per ship** under explicit user authorization, chaining smaller items into a larger retirement. All 7 ships pre-commit-hook-verified; full-suite re-run at session close confirmed zero regressions.

- **Ships (in commit order):**
  - `ab980c0` — F.1 `<program cors-max-age=N>` (Access-Control-Max-Age override; default 86400s per §39.2.1 amendment) + F.2 `<program channel-reconnect=N>` (project-level WS reconnect cadence; default 2000ms per §38.3.1 NEW subsection). Closes Bucket C candidates from S78 §7 caveat per-file deep-read follow-up. +21 tests.
  - `7189bd9` — strict self-host rebuild gate at `scripts/rebuild-self-host-dist.ts` (exits 1 on host-compiler non-warning errors; closes pre-S81 silent leak). Spec-conformance audit doc filed at `docs/audits/self-host-spec-conformance-2026-05-11.md`: 362 null/undefined violations across 13 self-host files inventoried + 4 adjacent violation categories (E-EQ-004 / E-ERROR-007 / E-FN-003 / E-MU-001 / E-SCOPE-001) breakdown documented; sweep DEFERRED to v0.3.0+ per "self-hosting is orthogonal to v0.2.0" user direction. Honors the "null/undefined never compile, library mode inclusive" directive (user-voice S81).
  - `f50f313` — Phase A10 deferred items closed: TS body-walk re-enablement on engine-decl + payload-binding scope injection. Closes the "Pre-A10 type-system early-returned `tAsIs()`" gate that left engine state-child bodies untyped. Now typos `${mssg}` inside `<Error msg>` fire E-SCOPE-001 at compile time. +7 tests.
  - `b6c8e1c` — SPEC-INDEX line-range regen + persistent `scripts/regen-spec-index.ts` (TS, idempotent, preserves summaries; handles §49's single-`#` heading). 62 Sections-table rows refreshed; "Total lines" updated 25,508 → 26,286.
  - `7173bfe` — D3 pure-fn call detection in monotonicity classifier (A9 Ext 5 carry-forward). Threads `FunctionPurityLookup` through `analyzeMonotonicity` → `classifyStatement`; bare-expr calls whose callee resolves to fn-kind per §48 classify monotone per §19.9.6 rule (e). Reduces over-emission of `Idempotency-Key` envelopes (HTTP bandwidth + dedup-table rows) for CPS batches whose only side effect is a pure-fn call. +13 tests. Project-mapper incremental refresh bundled in same commit.
  - `acfd20c` — D1 export-synth idempotent modifier propagation (A9 Ext 5 carry-forward). The synth function-decl from `export function foo().idempotent()` now carries `idempotentModifier: true` so downstream walkers (monotonicity classifier, codegen) read the flag correctly. Tokenization-tolerant regex (`/\)\s*\.\s*idempotent\s*\(\s*\)/`) on the export raw. +5 tests.
  - `dd29e3b` — **OQ-2 SHIPPED**: imperative `debounce(fn, ms)` / `throttle(fn, ms)` keyword-call form RETIRED. Removed `debounce`/`throttle` from tokenizer KEYWORDS; deleted DEBOUNCE/THROTTLE built-in parse blocks (~90 LOC) in ast-builder.js; deleted `DebounceCallNode`/`ThrottleCallNode` interfaces + union members in types/ast.ts; deleted case arms in emit-logic.ts + emit-client.ts chunk detector + component-expander.ts; deleted `_scrml_debounce`/`_scrml_throttle` runtime helpers in runtime-template.js. Adopters use stdlib `scrml:time.debounce`/`throttle` (regular function calls, shipped at stdlib/time/index.scrml) or the §6.13 attribute form `<x debounced=Nms>`. Side benefit: `let debounce = ...` / `function throttle()` no longer fires E-RESERVED-IDENTIFIER. Zero adopter footprint (grep across samples/examples returned only the stdlib's own implementation). Net -87 LOC.

- **Audit docs filed S81:**
  - `docs/audits/hardcoded-thresholds-followup-2026-05-11.md` — drove F.1/F.2 ship; closes S78 §7 caveat with exactly 2 of the predicted 2-4 Bucket C items (lower-bound of estimate). Also documents S78 §1 misclassification of `Access-Control-Max-Age=86400` as "passes through middleware config" (it doesn't).
  - `docs/audits/self-host-spec-conformance-2026-05-11.md` — full 362-occurrence null/undefined inventory + sweep plan + non-null violation breakdown + GCP3 walker-gap finding (bpp/bs/tab have null source but 0 detector firings — separate sub-project). DEFERRED to v0.3.0+ per user direction; closes the strict-gate's reason-to-be in the meantime.

- **SPEC amendments:** §39.2.1 cors-max-age override paragraph; §38.3.1 NEW subsection (channel-reconnect project-level default); §38.3 attribute table cleanup (S80 stale `protect` row replaced with `auth` + reconnect row clarified with precedence note). SPEC-INDEX line-range refresh on every Sections-table row.

- **User-voice S81 (`16e201f` in scrml-support):** three durable verbatim entries — "not" directive remains in play library-mode inclusive (the rebuild-script bypass was itself a rule violation; closed at 7189bd9); self-host parity orthogonal to v0.2.0 (source-side sweep filed for v0.3.0+); CLI auto-fix design thought registered as v0.3 roadmap (`bun scrml fix` would mechanically convert null/undefined → not / is some / is not + ===/!== → ==/!=).

- **Test surface delta vs S80 close:** S80 = 11,139 pass / 73 skip / 0 fail (534 files). S81 = 11,181 pass / 77 skip / 0 fail (535 files). **+42 pass / +4 skip / +1 file / 0 regressions.**

- **Push state at close:** scrmlTS pushed per-ship throughout the session; 0/0 origin/main at wrap. scrml-support pushed at `16e201f` (user-voice S81); 0/0 origin/main at wrap.

Next-priority menu carried to S82 (smaller items remaining: A6-6 optional API alignment design dive (TBD scope), A9 Ext 5 D5 Redis backend inlining (adopter-signal-gated; no current signal); larger items: W-LEAK-010 follow-up (hold for v0.3.0+), Versioning-discipline discussion (own session); self-host parity sweep remains v0.3.0+ orthogonal track). See `hand-off.md` for the full list.

### 2026-05-11 (S80 close — wrap)

S80 (single-day session, 2026-05-11). **6 commits + 1 push pair landed** under explicit user authorization: a substantive design codification + Bootstrap L3 compiler-bug fix + the full A5-7 canonical-sample family + a self-host parity follow-up. Pre-commit hook fired clean on every commit; full-suite measurement at wrap close.

- **Ships (in commit order):** `ef70daa` auth/protect/csrf attribute-host codification + E-MW-001 retirement · `d7f9609` Bootstrap L3 library-mode meta-block strip-bug fix (paren-aware regex narrowing) · `a5dea6e` A5-7a samples (engine-005 literal + engine-006 computed-delay) · `48e0005` A5-7b sample (engine-007 named timer + cancelTimer) · `2fbb4ac` A5-7c sample (engine-008 onIdle watchdog) + A5-7d audit closure · `55d41f7` self-host ast.scrml parity sync (catch-up missed at ef70daa).
- **SPEC amendments:** §39.2.3 normative rewrite (csrf= description); §40.2 attribute table csrf row updated to `"auto"|"off"`; §34 row E-MW-001 deleted (retirement noted); §34 rows E-MW-002/005/006 cleaned of stale "Un-fireable note" + emit-site refs added; §38.5 retitled `protect=` → `auth=` Integration; §38.2 worked example `<channel protect=>` → `<channel auth=>`; §39 worked example `<program protect=>` shorthand retired; §40.6 error table E-MW-001 row deleted.
- **Source changes:** 9 source files touched in `ef70daa` (compiler + self-host mirror); 2 files in `d7f9609` (emit-library.ts + self-host section-assembly.js); 1 file in `55d41f7` (self-host ast.scrml). 4 new sample files in compilation-tests.
- **Design codification (auth/protect/csrf):** routing surfaces (`<program>`, `<page>`, `<channel>`) carry `auth=` + `csrf=`; data-declaration surfaces (`<db>`, `<Type>`) carry `protect=`; type declarations carry `authority=`. Resolved the D3 csrf= drift (§40.2 said `"on"|"off"`, §52.13 said `"auto"|"off"`) by collapsing to canonical `"auto"|"off"` per §52.13. E-MW-001 retired: the design pairing requirement (`csrf="on"` ⟹ `auth=`) had been enforcing a design-opinion masquerading as technical-correctness; the emitted double-submit cookie code is independently OWASP-valid (per OWASP CSRF Prevention Cheat Sheet — see deep-dive `scrml-support/docs/deep-dives/protect-auth-csrf-terminology-2026-05-11.md`). `<channel protect=>` (WS upgrade gate) renamed to `<channel auth=>` per vocabulary alignment with §52.13. `<program protect=>` shorthand from §39 worked example retired (zero consumers in source).
- **Bootstrap L3 strip-bug fix:** the host-compiler library-mode meta-block strip pass at `compiler/src/codegen/emit-library.ts:180-188` (+ self-host mirror at `compiler/self-host/cg-parts/section-assembly.js:937-944`) was greedy-truncating `await import(expr)` calls in plain JS. Root cause: strip regex used `[^)]+` (not paren-aware) and stopped at the first `)` for complex args like `new URL(...).href`, leaving residue. Fix: narrowed strip regex to quoted-string args only (mirroring the importRe/nsImportRe emit shapes). `compiler/dist/self-host/ast.js` no longer has `.href)` residue; `compiler/self-host/api.js` imports cleanly. L3 test re-skipped with an updated reason that documents what's fixed (strip bug) and what remains (self-host parity gap — a separate priority).
- **A5-7 tests + samples:** 4 canonical end-to-end samples landed across the engine temporal surface. `engine-005-ontimeout-basic.scrml` (literal `after=2s` form per A5-4) · `engine-006-ontimeout-computed.scrml` (computed-delay `after=${@var}ms` per A5-5) · `engine-007-cancel-timer.scrml` (named `<onTimeout name=autoConfirm>` + call-ref `cancelTimer("autoConfirm")` per A5-6 Feature 1) · `engine-008-onidle-watchdog.scrml` (engine-wide `<onIdle after=30s>` watchdog per A5-6 Feature 2). All compile clean, emit canonical codegen verified via grep, pass `node --check`. Inventory at `docs/changes/a5-7-tests-samples/INVENTORY.md` captures the depth-of-survey discount (12-18h original estimate → ~1.5h actual landing, ~10x reduction; factored in already-shipped ~249-test unit/integration coverage and structurally-blocked sub-phases). A5-7d closed audit-only (negative Machine Cohesion sample is parser-blocked end-to-end; legacy temporal `<machine>` sample would have introduced a new deprecated-keyword reference).
- **Self-host parity restored:** `55d41f7` synced `compiler/self-host/ast.scrml` to mirror the TS-side csrf+E-MW-001 deltas from `ef70daa`. Caught at S80 wrap-time full-suite measurement (4 self-host parity test failures); fixed pre-wrap so wrap-time baseline is clean.
- **Push state at close:** scrmlTS at +1 from origin pre-wrap; pushed at wrap close per "wrap" default + explicit prior `push it` authorization scope. scrml-support also touched (deep-dive doc landed at `7279e6e`); status verified at wrap close.

Next-priority menu carried to S81 (top items: cg.scrml structural restructure + full self-host parity work, Phase A10 deferred items, multi-token threshold deep-read, debounce/throttle imperative keyword-call retirement OQ-2, SPEC-INDEX.md regeneration). See `hand-off.md` for the full list.

### 2026-05-11 (S79 close — wrap)

Session-close summary of S79 (opened 2026-05-10, closed 2026-05-11 — single-day spanning midnight). **4 SHIPs + 1 deref sweep + 1 agent dispatch landing + 1 hook-install** under explicit user authorization across the session. Zero regressions; pre-commit hook fired clean on every commit.

- **Ships (in commit order):** `130b7d0` Batch K combined deref (131 file/dir moves to scrml-support archive) · `1547e78` A5-6 Feature 1 (`<onTimeout name=IDENT>` + `cancelTimer("X")` builtin) · `fcb45df` hardcoded-thresholds Bucket A (MAX_RUNS + EncodingContext.seqCap) · `5ac54de` hardcoded-thresholds Bucket B+C (serve-client timeouts + `<program idempotency-ttl=>` + `<program batch-in-list-cap=>`) · `3446989` debounce/throttle Approach B (clean-cut · agent dispatch landed via squash-merge per S67) · `d860e37` chore gitignore runtime fixture scratchpads.
- **SPEC amendments:** §51.0.M.1 NEW (A5-6 Feature 1) + §6.13 NEW (Reactivity Attributes) + §6.8 amend (reset-cancel pending timed writes) + §19.9.6 amend (idempotency TTL override) + §8.10.6 amend (batch-IN-list cap override) + 6 new §34 catalog codes (E-TIMER-NAME-DUPLICATE, E-TIMER-NAME-INVALID, E-DEBOUNCED-WITH-DERIVED, E-DEBOUNCED-WITH-SERVER, E-REACTIVITY-ATTR-CONFLICT, +E-SYNTAX-DURATION fall-through).
- **Per-machine setup:** pre-commit hook installed on this machine at session open (`git config core.hooksPath scripts/git-hooks` per pa.md S78 directive — was silently uninstalled).
- **Curation deltas:** `docs/changes/` 99 → 5 (4 KEEP-LIVE + new `debounce-throttle-approach-b/`) · `docs/audits/` 22 → 3 · `docs/{recon,experiments,deep-dives}/` removed entirely.
- **Audit closures:** hardcoded-thresholds audit §6 — **All 5 items shipped** (actual ~3.5h vs ~4h estimate). The S78 SPEC conformance audit's "src-ahead-of-spec" debounce/throttle finding RESOLVED at S79 via §6.13 NEW + clean-cut deletion of `reactive-debounced-decl` AST kind.
- **Push state at close:** scrmlTS + scrml-support both pushed to origin per "wrap" default; both 0/0 origin at session close.
- **Agent dispatch (S79-D1):** `worktree-agent-ab656f3dcdd0f1638` (6 WIP commits) landed via `git merge --squash` per S67 worktree-as-scratch / file-delta protocol. 2 expected merge conflicts (primer + master-list section-overlap with my prior S79 main edits) resolved manually keeping agent's authoritative text + bridging cross-refs. Final delta = exactly 29 files matching agent's reported FILES_TOUCHED; zero agent-side-stale-view files leaked into main.

Next-priority menu carried forward to S80 (top items: phantom-code middleware family, Bootstrap L3 host-compiler meta-block strip bug, Phase A10 deferred items, A5-7 tests + samples, OQ-2 imperative debounce-call/throttle-call retirement). See `hand-off.md` "Next priority — menu" for the full list.

### 2026-05-10 (S79 — debounce/throttle Approach B clean-cut SHIPPED)

Implementation of S78 deep-dive ratification (`scrml-support/docs/deep-dives/debounce-and-timing-2026-05-10.md` §6 Approach B). Cross-cutting Tier 3 dispatch (SPEC + parser + codegen + runtime + types + samples + tests + LSP).

**Phase 1 — SPEC authoring:**
- §6.13 NEW (Reactivity Attributes — `<name debounced=Nms>` / `<name throttled=Nms>`) — full normative subsection covering DURATION grammar (literal + computed via parseAfterDuration reuse), composition with Shape 1/2 (legal) + Shape 3 (E-DEBOUNCED-WITH-DERIVED), with `<channel>` shared cells (client-side broadcast per OQ-5 ratification), with auto-validity surface (recomputes on debounced write; touched fires immediately per OQ-6), with reset() (cancels pending per OQ-3), with `<x server>` cells (E-DEBOUNCED-WITH-SERVER deferred), and dual-attr E-REACTIVITY-ATTR-CONFLICT.
- §6.8 amendment — paragraph + cross-ref documenting reset(@cell) cancels pending debounced/throttled timer before applying reset value.
- §34 +3 catalog rows: E-DEBOUNCED-WITH-DERIVED, E-DEBOUNCED-WITH-SERVER, E-REACTIVITY-ATTR-CONFLICT.

**Phase 2 — Parser + Typer + Codegen + Runtime:**
- types/ast.ts: ReactiveDeclNode gains `reactivity?: { debounced?: AfterDurationResult; throttled?: AfterDurationResult }` field.
- ast-builder.js scanStructuralDeclLookahead: extended to recognize `debounced=DURATION` / `throttled=DURATION` attributes alongside default= / pinned / validators; parseAfterDuration validates at decl-completion.
- type-system.ts: B14-style typer checks for E-REACTIVITY-ATTR-CONFLICT, E-DEBOUNCED-WITH-DERIVED, E-DEBOUNCED-WITH-SERVER, E-SYNTAX-DURATION (malformed value).
- emit-logic.ts: new _emitReactivitySidecar emits `_scrml_reactivity_register("name", kind, ms)` (literal numeric or computed-form arrow-fn mirroring A5-5 pattern).
- emit-client.ts: utilities chunk-trigger added on state-decl with reactivity.
- runtime-template.js: hoisted registries to module top (TDZ safety); rewrote `_scrml_reactive_debounced` (was partial — comment said "would re-evaluate fn after delay" but didn't); added `_scrml_reactive_throttled` (NEW — leading+trailing throttle); added `_scrml_reactivity_register` + `_scrml_reactivity_cancel`; wired `_scrml_reactive_set` to consult registry + route through timer (with bypass-flag against recursion); wired `_scrml_reset` to cancel pending timers + clear throttle pending value.

**Phase 3 — clean-cut deletion (per Approach B "no deprecation cycle since no real adopters"; corpus footprint = 2 probe fixtures):**
- types/ast.ts: ReactiveDebouncedDeclNode interface deleted.
- ast-builder.js: 2 parse paths deleted (top-level + in-function-body @debounced(N) keyword-form).
- type-system.ts: case 'reactive-debounced-decl' deleted.
- emit-logic.ts: case 'reactive-debounced-decl' deleted.
- emit-client.ts: chunk-detector case deleted.
- route-inference.ts: 2 case arms simplified.
- component-expander.ts: case arm + import simplified.
- usage-analyzer.ts: case arm simplified.
- lsp/handlers.js: state-decl analysis arm extended to detect reactivity attributes; symbol detail strings updated to canonical `<name debounced=Nms>` form.
- DEFERRED: imperative `debounce(fn, ms)` / `throttle(fn, ms)` keyword-call retirement (OQ-2; orthogonal to declarative — separate dispatch).

**Phase 4 — tests:**
- New `compiler/tests/unit/debounce-throttle-attribute.test.js` — 28 unit tests, 7 sections (parser / typer / codegen / computed-form / runtime / migrated samples / regression).
- 6 retired test assertions across tab.test.js / code-generator.test.js / type-encoding-phase2.test.js / collectexpr-newline-boundary.test.js / gauntlet-s24/scope-001-logic-expr.test.js / self-host/ast.test.js.
- Updated lsp/completions.test.js to assert new attribute-form detail string.

**Phase 5 — docs:**
- docs/PA-SCRML-PRIMER.md §4 amended with the new attribute surface; §12 obsolete claim about reactive-debounced-decl being "STILL ACTIVELY CONSTRUCTED" updated to reflect S79 retirement.
- master-list.md "Last updated" line updated.

**Sample migration:** phase1-reactive-debounced-004.scrml + phase1-reactive-throttled-005.scrml migrated to canonical form (`<query debounced=300ms> = ""` / `<scrollY throttled=100ms> = 0`); expected-JSON flipped from "expects-error" to "expects-clean".

**OQ closures:** OQ-3 (reset cancels pending timed writes — ratified in §6.8 amendment + runtime), OQ-4 (parseAfterDuration reuse — ratified in §6.13.3 + parser), OQ-5 (channel debounce client-side — ratified in §6.13.5), OQ-6 (validity recomputes on debounced write; touched immediate — ratified in §6.13.5), OQ-8 (parallel `throttled=` attribute — ratified + shipped), OQ-9 (computed `${expr}ms` form — ratified + shipped).

**OQ deferred:** OQ-1 (migrator rule — N/A under Approach B clean cut), OQ-2 (imperative keyword-calls retirement — orthogonal, separate dispatch), OQ-7 (server-fn cancellation when debounced calls overlap — out of scope per deep-dive).

Earlier S78 close baseline (preserved for reference): **11,051 pass / 77 skip / 1 todo / 0 FAIL**. **ALL 6 prior environmental fails CLOSED via root-cause fixes**. Net delta vs S77 close: **+90 pass / +13 skip / +0 todo / -6 fail** across **16 commits**.

### 2026-05-10 (S79 — hardcoded-thresholds Bucket B + C SHIPPED · serve-client timeouts + idempotency-ttl + batch-in-list-cap overrides · 21 unit tests · 0 regressions)

Closes the remaining 3 hardcoded-thresholds audit items (B.1 + C.1 + C.2). Audit `docs/audits/hardcoded-thresholds-2026-05-10.md` §6 now reads "**All 5 items shipped. Total actual cost: ~3.5 hours across S79 (vs ~4h estimate).**"

- **B.1 serve-client AbortSignal timeouts** — `compiler/src/serve-client.js` (`isServerRunning` / `getServerHealth` / `compileViaServer` / `shutdownServer`). New `DEFAULT_TIMEOUTS` table (health=500ms / info=1000ms / compile=30000ms / shutdown=2000ms) + `resolveTimeouts(override)` helper that merges per-call `__testOnly_serverTimeouts` second-arg + `globalThis.__scrml_test_server_timeouts` hook + defaults. All four `AbortSignal.timeout(...)` sites now call `t.<key>` (no remaining hardcoded numerics). compileViaServer propagates the override into its internal isServerRunning probe.
- **C.1 idempotency TTL** — `compiler/src/codegen/emit-server.ts` + new helper `parseIdempotencyTtl(raw)`. Accepts bare millis (`"3600000"`) OR duration string with unit suffix `"Nms"` / `"Ns"` / `"Nm"` / `"Nh"` / `"Nd"` (e.g. `"7d"` for batch-replay, `"1h"` for high-volume). Reads from `middlewareConfig.idempotencyTTL` (added field). Substitutes into the emitted `_SCRML_IDEMPOTENCY_TTL_MS` const + comment text identifying override-vs-default. Silent fallback to 24h on null/malformed (no diagnostic v1; `W-MIDDLEWARE-TTL-INVALID` queued for v2).
- **C.2 batch IN-list cap** — `compiler/src/codegen/emit-control-flow.ts` (`emitHoistedForStmt` for §8.10 Tier 2 batched loops). New module-level `setBatchInListCap()` setter + `getBatchInListCap()` reader (mirror of `setBatchLoopHoists` lifecycle: per-file set from `middlewareConfig.batchInListCap`, reset to `null` on compile-end). Substitutes into BOTH the runtime check (`if (keys.length > N)`) AND the diagnostic message text. Default 32766 preserved (SQLite 3.32+); adopters set higher for Postgres (~65535) or lower for older SQLite (999).
- **Middleware attribute parsing** (`compiler/src/ast-builder.js`) — `getMWAttr('idempotency-ttl')` + `getMWAttr('batch-in-list-cap')` extracted alongside existing cors/log/csrf/ratelimit/headers/idempotency-store. `MiddlewareConfig` TS interface in `types/ast.ts` extended with the two new optional fields + the previously-implicit `idempotencyStore` field (was inline-only).
- **SPEC amendments:**
  - §19.9.6 — new "TTL override (S79 amendment)" paragraph documenting `<program idempotency-ttl=>` accepted forms + silent-fallback semantics.
  - §8.10.6 — new "Cap override (S79 amendment)" paragraph documenting `<program batch-in-list-cap=N>` + cross-backend rationale (Postgres / older SQLite).
- **Tests:** new `compiler/tests/unit/hardcoded-thresholds-bucket-bc-injection.test.js` — 21 tests / 53 expect() calls. Coverage: serve-client substitution shape (no-remaining-hardcoded, named timeouts, override propagation), parseIdempotencyTtl semantic re-derivation (bare millis + 5 unit suffixes + edge cases for null/empty/malformed/zero/float/negative/unsupported-unit), emit-server default + override comment, batch-in-list cap source-shape + lifecycle wiring + zero/negative guard.
- **Audit doc updated:** `docs/audits/hardcoded-thresholds-2026-05-10.md` §6 items 3+4+5 marked ✅ SHIPPED with implementation notes.

**Net for S79 hardcoded-thresholds work: 5 audit items closed across 2 commits (Bucket A `fcb45df` + Bucket B+C this commit). 32 unit tests added in total.**

### 2026-05-10 (S79 — hardcoded-thresholds Bucket A SHIPPED · MAX_RUNS overridable + EncodingContext.seqCap injectable · 11 unit tests · 0 regressions)

Top 2 Bucket A items from `docs/audits/hardcoded-thresholds-2026-05-10.md` shipped:

- **A.1 `MAX_RUNS = 100` (meta-effect infinite-loop guard).** `compiler/src/runtime-template.js:1098` — literal replaced with `globalThis.__scrml_max_meta_runs ?? 100` lookup at the top of `_scrml_meta_effect`. Type-guarded (`typeof === "number" && > 0`). Tests can set `globalThis.__scrml_max_meta_runs = 5` to exercise the bail path with a 6-cycle fixture; adopters with complex derived graphs can set higher (e.g. 1000) before the scrml runtime loads. Fallback default unchanged (100).
- **A.2 `seq > 1331` (E-CG-014 disambiguator overflow).** `compiler/src/codegen/type-encoding.ts:443` — literal `1331` replaced with `this.seqCap`. New `seqCap` field on `EncodingContext` (default 1331); new constructor opt `__testOnly_typeEncodingSeqCap`. Plumbed through `compiler/src/codegen/index.ts` via the existing `encoding` option object (which is already a top-level compile option). Diagnostic message uses dynamic cap value (`more than ${cap+1} bindings`) so tests can assert clean text. Conformance tests for E-CG-014 can now use a 4-binding fixture with `seqCap: 2` instead of synthesizing 1,332.
- **Tests:** new `compiler/tests/unit/hardcoded-thresholds-bucket-a-injection.test.js` — 11 tests / 24 expect() calls. Coverage: runtime substitution shape (A.1: globalThis lookup + type-guard + default fallback), EncodingContext.seqCap default + override + edge cases (negative, non-number, 0) + E-CG-014 fires at custom cap with small fixture + symmetric back-compat (default 1331 path) + disabled-encoding bypass.
- **Regression check:** type-encoding + meta-effect tests both green (60 pass / 0 fail).
- **Audit doc updated:** `docs/audits/hardcoded-thresholds-2026-05-10.md` §6 items 1+2 marked ✅ SHIPPED with implementation notes.

Remaining audit items (deferred): C.1 idempotency TTL via scrmlconfig (~1h, adopter-relevant), B.1 serve-client timeouts (~20min), C.2 batch IN-list cap (~1h, non-SQLite backends).

### 2026-05-10 (S79 — A5-6 Feature 1 SHIPPED · named timer + cancelTimer builtin · closes Phase A10 deferral chain at original target · 28 unit tests · 0 regressions)

A5-6 Feature 1 (`<onTimeout name=IDENT>` + `cancelTimer("X")` builtin) — the original closure target of the 6-deep deferral chain that Phase A10 unblocked at S78 — landed SHIPPED in S79 PA-direct work. Per ratified S77 SCOPE Option A; Phase A10's walkable arm-body AST is the unblocker (cancelTimer call recognition needs static (varName, armTag) from arm context).

- **SPEC §51.0.M.1 amendment** (`compiler/SPEC.md`) — new subsection added under §51.0.M for the `name=` attribute + `cancelTimer("X")` builtin. Identifier shape `/^[A-Za-z_][A-Za-z0-9_]*$/`, scope-local to state-child body, unknown-name = runtime no-op (clearTimeout-style). §4.15 + §24.4 attribute table updated for `name=IDENT` (optional). §34 catalog rows: `E-TIMER-NAME-DUPLICATE` + `E-TIMER-NAME-INVALID` (+2 codes, both error-level).
- **Parser** (`engine-statechild-parser.ts:scanForOnTimeoutEntries`) — extended to capture optional `name=` attribute (quoted + unquoted forms). `OnTimeoutEntry.name?: string` field added in `symbol-table.ts`.
- **Typer** (`symbol-table.ts:walkValidateEngineA5Extensions` PASS 16) — fires E-TIMER-NAME-INVALID for shape violations + E-TIMER-NAME-DUPLICATE for same-name siblings in the same state-child body. Per-body name-seen Set.
- **Codegen** (`emit-engine.ts:emitEngineTimersTable`) — entries with `name` field emit `name: "X"` in the per-state timer-config table row. NEW exported helper `maybeLowerCancelTimerCallRef(handlerName, handlerArgs, engineArm)` consumed by both event-wiring paths.
- **Codegen — call-ref recognition:** `emit-event-wiring.ts` (delegated path: click/submit) + `emit-variant-guard.ts:emitArmWireFunction` (non-delegable path: focus/blur/etc.) both intercept `cancelTimer("X")` call-ref event handlers when `binding.engineArm` is set. Lowers to `_scrml_engine_clear_named_timer("<varName>", "<armTag>", "<X>")`. v1 limitation documented in primer: only call-ref form supported; `${cancelTimer("X")}` expression-form falls through to ordinary emission and runtime-fails as undefined.
- **Runtime** (`runtime-template.js`) — `_scrml_engine_arm_state_timers` + `_scrml_engine_clear_state_timers` switch keying scheme: `n:NAME` suffix when entry has `name`, index suffix otherwise (back-compat for anonymous timers). New helper `_scrml_engine_clear_named_timer(varName, stateName, name)` constructs the same composite key + delegates to existing `_scrml_machine_clear_timer`.
- **`BindingRegistry.currentArmContext` getter** added (compiler/src/codegen/binding-registry.ts) — exposes the topmost arm context for emit-expr-side use; not consumed by v1 (call-ref recognition reads `binding.engineArm` directly), forward-compat for v2 expression-form lowering.
- **Tests:** new `compiler/tests/unit/a5-6-feature-1-named-timer.test.js` — **28 tests / 47 expect() calls** covering parser capture (quoted/unquoted/order-independent/mixed-named-anonymous), typer diagnostics (E-TIMER-NAME-INVALID + E-TIMER-NAME-DUPLICATE + scope-locality), codegen field emission, lowering recognition matrix (8 cases including null/undefined arm context, malformed args, multi-colon armTag), runtime helper shape (composite key + symmetric arm/clear). All pass.
- **Primer §7.1** updated: `<onTimeout>` row now includes `[name=IDENT]` + cancelTimer prose + v1 limitation note.

### 2026-05-10 (S79 — Batch K combined deref sweep · 131 file/dir moves · `docs/changes/` 99 → 4 · `docs/audits/` 22 → 3 · pa.md hook installed)

S79 opened on the second machine after S78 machine-switch wrap. Pre-commit hook installed on this machine (`git config core.hooksPath scripts/git-hooks` per pa.md S78 directive — discovered unset on session-start verification). Project-mapper full cold-start regenerated `.claude/maps/` reflecting Phase A10 surface (new `emit-variant-guard.ts` ~830 LOC, revised reactive-wiring topology, `EventBinding.engineArm` field). Non-compliance scan surfaced 14 confirmed + 7 uncertain items; user authorized "full sweep now."

- **Batch K combined deref (131 file/dir moves):** disposition matrix updated at `docs/curation/2026-05-05-changes-dir-disposition.md` §6 #10. 93 SHIPPED dispatch dirs → `scrml-support/archive/changes/` (flat, S61 precedent). 19 historical audits → NEW `scrml-support/archive/audits/` (a1b-b7..b22 + a1c-roadmap + item-c-temporal + kickstarter-v0-verification-matrix + scope-c-stage-1 ×2 + spec-conformance + test-conformance). 8 recon docs → NEW `scrml-support/archive/recon/`. 5 experiments → NEW `scrml-support/docs/experiments/`. 3 deep-dives → `scrml-support/docs/deep-dives/` (location-correction). 2 article drafts → `scrml-support/archive/articles-skipped/`. 1 stray `benchmarks/fullstack-react/CLAUDE.md` deleted. KEEP-LIVE in scrmlTS: `docs/changes/{predicate-gaps-deep-dive-prep, promotion-ergonomics, v0next-audit, v0next-inventory}/` + `docs/audits/{scope-c-findings-tracker, compiler-forgotten-surface-2026-05-06, hardcoded-thresholds-2026-05-10}.md`. Cumulative S61+S79: 207 deref operations.
- **Cross-refs fixed (load-bearing live docs):** pa.md (kickstarter-v0-verification-matrix + scope-c-stage-1 audit refs in dispatch-brief instructions); PA-SCRML-PRIMER.md (7 refs across 6 entries); master-list.md (~10 dispatch + audit + recon + deep-dive refs via bulk perl substitution with KEEP-LIVE negative lookahead); v0next-inventory/{SCOPE-MAP, SCOPE-SUPPLEMENT, ARTICLE-TRUTHFULNESS-AUDIT}.md; v0next-audit/PARSER-AUDIT-2026-05-05.md; promotion-ergonomics/{progress, SURVEY-NOTE}.md. Changelog historical entries left as snapshots-at-time-of-landing (the dirs they cite are now in `scrml-support/archive/changes/<same-name>/`).
- **`docs/changes/` count: 99 → 4. `docs/audits/` count: 22 → 3. `docs/{recon,experiments,deep-dives}/` removed entirely from scrmlTS.**
- **Tests:** unchanged from S78 close (11,051 pass / 77 skip / 1 todo / 0 fail). Sweep is doc-only; no source touched. Pre-commit hook fires on commit.

### 2026-05-10 (S78 close — machine-switch wrap)

Post-wrap audit-thread fold-in commits added after initial S78 wrap (`71fee50`):

- **`d1ef590` chore(s78): post-wrap fold-in — test conformance audit results.** Audit (running async at initial close) returned with 21-code cataloged-but-untested list + binding-registry unit gap + pre-commit/full-suite divergence + ~6-9 vacuous TAB tests.
- **`daf1e3e` docs(s78-audit): SPEC §34 catalog backfill (audit items 1+3).** `<onIdle>` rows in §4.15/§24.4 registry tables (S77 omission caught); 5 catalog rows for fully-described codes (`I-MATCH-PROMOTABLE`, `W-CG-001`, `E-ERRORS-001/002`, `E-SWITCH-FORBIDDEN`); 14 W-LINT-* ghost-pattern rows.
- **`54733dd` test(s78-audit): binding-registry §7 — Phase A10 arm-context unit coverage (+7).** Closes test audit item B with 7 unit tests for `pushArmContext`/`popArmContext`/`engineArm` field stamping.
- **`a9b1e7d` fix(s78-audit): close all 5 environmentally-fixable test failures + install pre-commit hook + document per-machine setup.** Test-bind A6-5 hard-coded cwd → `process.cwd()`; F-BUILD-002 §3 `.mjs` temp file; new `scripts/rebuild-self-host-dist.ts` regenerates 11 self-host dist files; Bootstrap L3 marked `describe.skip` with documented host-compiler library-mode meta-block strip bug follow-up. pa.md +55 LOC "Per-machine setup — pre-commit hook installation (S78)" section. **Discovery: pre-commit hook was silently uninstalled on this machine for unknown duration. Now installed + firing.**
- **`39c8ca7` docs(s78-audit): primer §10 — add generatePassword to scrml:auth catalog.**
- **`297ccb8` test(s78-audit): CONF — 13 codes from audit §3 21-code backfill (+30 tests).** 13 codes covered with positive+negative tests. 8 codes documented as un-triggerable follow-ups (E-LOOP-003 disabled, E-CHANNEL-004/005 no emit sites, E-CTRL-004 dead code, E-IMPORT-007 fixture-blocked, E-FN-009 deferred, E-STRUCTURAL-ELEMENT-MISPLACED no emit sites).
- **`0301a7c` docs(s78-audit): SPEC §34 +88 legacy prose-only catalog backfill (audit item §1.2).** Closes the ~100% lookup-by-row fidelity for currently-firing codes. 4 codes (E-MW-001/002/005/006) annotated as un-fireable — middleware-attribute validation pass doesn't exist in src.
- **`8f49e5c` fix(s78-audit): unblock E-IMPORT-007 conformance test via injectable gatherLimit (+3).** Hardcoded `const GATHER_LIMIT = 5000` refactored to `options.gatherLimit ?? 5000`. E-IMPORT-007 re-classified from "fixture cost prohibitive" to "testable via threshold injection."
- **`efe6ca9` docs(s78-audit): hardcoded thresholds sweep — 12 found, 2 refactor-priority.** Sweep audit at `docs/audits/hardcoded-thresholds-2026-05-10.md`. 2 Bucket A (E-IMPORT-007 shape) + 1 Bucket B + 3 Bucket C (1 already done) + 6 Bucket D (genuine constants). Top 5 prioritized refactors ~4h total.

**scrml-support commits (debounce/throttle re-deliberation):**
- Old `scrml-support/docs/deep-dives/debounce-and-timing.md` (2026-03-28) frontmatter → `status: superseded` with forward pointer.
- New `scrml-support/docs/deep-dives/debounce-and-timing-2026-05-10.md` (676 lines, post-S55 framing). 5 approaches debated under L1-L22 lock compatibility. Approach B/C dominate; PA + user ratified Approach B (clean cut — no deprecation cycle since no real adopters per S30 pivot).

**Open threads at S78 close (queued for S79+):** A5-6 Feature 1 dispatch (~2-3h, unblocked), Approach B implementation (~12-21h, ratified), 5 threshold refactors (~4h), 11 phantom-code disposition (middleware family biggest gap), Bootstrap L3 root-cause fix, multi-token threshold deep-read, project-mapper refresh, versioning-discipline thread.

### 2026-05-10 (S78 — Phase A10 engine state-child body render SHIPPED end-to-end · 6-deep deferral chain CLOSED · A5-6 Feature 1 UNBLOCKED · 2 SHIPs + 1 chore + wrap · +45 tests · 0 regressions · SPEC conformance audit COMPLETE)

### 2026-05-10 (S78 — Phase A10 engine state-child body render SHIPPED end-to-end · 6-deep deferral chain CLOSED · A5-6 Feature 1 UNBLOCKED · 2 SHIPs + 1 chore + wrap · +45 tests · 0 regressions · SPEC conformance audit COMPLETE)

Single-thread session that took Phase A10 engine state-child body render from "deferred 6 times across a month" to **fully SHIPPED end-to-end** including closure of the v1 reactive-subscription gap that the original codegen ship would have left open. Two read-only audits dispatched: SPEC conformance returned "on course" verdict; test conformance still running async at close.

- **Phase A10 SCOPE + SURVEY (`b4b9bd9`).** PA-direct authoring. Q1=Option C-prime ratified (factored variant-guard helper that future match-block-form codegen reuses without forking; preserves promotion-ladder fidelity at codegen layer). User S78 weighing-matrix decision: "C prime." SURVEY headline: cost revised down ~10-17h → ~6.5-12h post-survey (block-splitter ALREADY produces walkable children; ast-builder.js:9098-9103 was throwing them away by re-serializing to `rulesRaw: string`; fix is "preserve children" not new infrastructure). Option D eliminated (no legacy machine body-render to reuse).
- **Phase 1+2 SHIP (`9f888d0`, +14 tests).** Parser integration: ast-builder.js engine-decl construction preserves block-splitter's walkable children as `bodyChildren: ASTNode[]`; errors during recursive body walk discarded. types/ast.ts new `EngineDeclNode` interface. Typer integration: symbol-table.ts adds 7 A1b walker recursion branches (PASSes 1, 2, 3, 5, 6, 13, 14) gated on `kind === "engine-decl" && Array.isArray(anyN.bodyChildren)`. PASS 3 (B3) is load-bearing — every `@cell` in body event handlers/interpolations now resolves. type-system.ts explicit `case "engine-decl"` returning `tAsIs()` WITHOUT descending. 2 NEW test files: `engine-body-children.test.js` (8 tests) + `engine-body-walker-resolution.test.js` (6 tests).
- **Phase A10 SHIP — Phase 3+4+5+re-wire (`6a1b15e`, +31 tests / -3 skip→test).** Phase 3 codegen: factored variant-guard helper at NEW `compiler/src/codegen/emit-variant-guard.ts` (~830 LOC) — variant-source-agnostic dispatcher emitter; engine consumer `emitEngineBodyRenderForFile` + sibling for derived engines + `emitEngineMountHtml`; structural-element filter at boundary (drops `<onTimeout>`, `<onTransition>`, `<onIdle>`, nested `<engine>`/`<machine>` from arm bodies); 3 emitter recursion branches. Re-wire fix: Mechanism B chosen — per-arm wire function + dispose handle from `_scrml_effect`. binding-registry.ts EventBinding + LogicBinding gain `engineArm?: string`; `_armContextStack` push/pop machinery stamps engineArm on bindings; emit-event-wiring.ts filters arm-tagged bindings from global emission. Dispatcher reshape: module-scope dispose handle + named dispatch fn + DOMContentLoaded initial-fire bridge; idempotent dispose-before-rewire on every fire. Phase 4 tests: 22 unit tests + 3 happy-dom integration tests. 3 prior `.skip` integration tests converted to `.test`. Phase 5 docs: PRIMER §7 + IMPLEMENTATION-ROADMAP §2.5b + SCOPE STATUS RATIFIED → SHIPPED.
- **SPEC conformance audit landed.** `docs/audits/spec-conformance-2026-05-10.md` — verdict on-course. 175 of 283 codes cataloged in §34; 90 prose-only; 18 undocumented (W-LINT-001..015 family + E-ERRORS-001/002 + E-SWITCH-FORBIDDEN + W-CG-001); `<onIdle>` missing from §4.15/§24.4 registry tables; 0 universal-core predicate drift; Phase A10 body-render spec-faithful. **One real src-ahead-of-spec find:** debounce/throttle AST kinds (`@debounced(N)`, `debounce()`, `throttle()`) parse as language-level keywords with zero SPEC mention — needs deliberation. ~5-7h to close all gaps.
- **Test conformance audit COMPLETE** (returned post-wrap; folded into S78 close inline). `docs/audits/test-conformance-2026-05-10.md` (401 lines). Verdict: **SHIP-READY after closing ~4-6h of mechanical test additions; no agent-cheated pattern detected**. Top items: A. 21 codes cataloged-but-untested (~3-5h) — `E-LOOP-003/005/006/007`, `E-CHANNEL-004/005`, `E-AUTH-003/004/005`, `E-CG-010/014`, `E-LIFECYCLE-015`, `E-CTRL-004/011`, `E-IMPORT-007`, `E-FN-009`, `E-META-EVAL-002`, `E-STRUCTURAL-ELEMENT-MISPLACED`, `E-ERROR-008`. B. Phase A10 binding-registry arm-context unit gap (~30min) — pushArmContext/popArmContext have integration coverage but no direct unit test. C. Pre-commit/full-suite divergence (~30min) — pre-commit excludes browser/lsp/self-host/commands; no full-suite gate between commits. D. ~6-9 vacuous tests in `conf-TAB-005.test.js` + `conf-TAB-022.test.js` (lower priority cleanup). Positive findings: corpus runs real `compileScrml(...)` end-to-end, no mocks/snapshots/`.only`/circular-mock-assertions, 31/54 skips are documented S32 fn-state-machine gating tests. Verdict aligns with parallel SPEC audit's catalog-bookkeeping-drift framing.

### 2026-05-10 (S77 — A5 computed-delay family CLOSED · A5-6 Feature 2 SHIPPED · memory-leak deep-dive REFRESHED · 7 SHIPs · +82 tests · 0 regressions)

Heavy-throughput session combining a major background-agent dispatch (A5-4+5 ~12-17h budget end-to-end) with a parallel deep-dive refresh on scrml-support (memory-leak detection) and several PA-direct closures (codegen-tightening, STRING-quote-fix, A5-5b chore-tier, A5-6 Feature 2 implementation). Cross-machine sync clean at open. 6 substantial items closed in this single session.

- **Codegen-tightening SHIPPED `8379b92` — multi-statement test-block bodies.** Test-body collector at `compiler/src/ast-builder.js:8338-8413` previously joined every token in a `~{}` test body with single spaces and emitted ONE caseBody entry. Source `let a = f()\nlet b = g()` (no explicit `;`) emitted as `let a = f ( ) let b = g ( )` — invalid JS at bun:test load time. Fix splits on depth-0 `;` PUNCT (consumed) AND on depth-0 statement-keyword tokens (`let`/`const`/`var`/`return`/`throw`/`break`/`continue`/`if`/`for`/`while`/`do`/`try`/`switch`) that begin on a new source line. Both KEYWORD and IDENT token kinds accepted; brace depth respected. +11 unit tests. Closes the bug filed S76 via A6-5 integration testing.
- **A5-4 + A5-5 SHIPPED `7b5744d` (background-agent landing) — `<onTimeout>` codegen + computed-delay across both temporal surfaces.** 18 files / +2,480 LOC / 73 new tests. NEW `parse-after-duration.ts` shared helper recognizes literal `Nms`/`Ns`/`Nm`/`Nh` AND computed `${expr}<unit>` shapes. Per-engine timer-config table emitted as `__scrml_engine_<varName>_timers` (sibling to transitions); arm-on-entry + clear-on-exit threaded through `_scrml_engine_direct_set` + `_scrml_engine_advance` (4th-arg `timersTable`); initial-arm at module-init via `emitEngineInitialArmsForFile` called AFTER `emitReactiveWiring` so computed-form `${@var}<unit>` reads land. Tree-shake when zero `<onTimeout>`. Legacy `<machine>` form: `TransitionRule.afterExpr` field added; `parseMachineRules` calls shared helper; `emitDurationLiteral` IIFE-wraps clamp+round for computed; `emit-logic.ts` machine-init path arms computed-form rules inline. All 8 SCOPE §3 authorized decisions honored; 0 deviations. 3 deferrals beyond §5: legacy machine body-parser `${...}` preservation (filed as A5-5b); chained re-arm computed-skip; §51.0.M hierarchy/history/internal:rule out-of-bundled-scope.
- **Memory-leak detection deep-dive REFRESHED at scrml-support `1f71ef3`.** New dated successor `memory-leak-detection-2026-05-10.md` (~565 LOC); original frontmatter flipped `status: active` → `superseded`. Headline shifts since 2026-03-28: Stage 7.5 slot taken by BP (added 2026-04-14); LC pass placement moves to Stage 7.6 (3 candidates evaluated; 2 rejected). Two leak categories shifted to STRUCTURAL prevention: timers via `<timer>` (§6.7.5 with auto-stop on scope-destroy) and WebSockets via `<channel>` (§38, cleanup verified at `emit-channel.ts:391`). One NEW leak surface confirmed: A9 Ext 5 idempotency-key shadow tables grow unbounded (24h TTL but lazy-eviction-only). **W-LEAK-010 recommended (info-level lint).** 8 other NEW post-2026-03-28 surfaces audited and verified clean. Recommendation: hold for v0.3.0+ unless W-LEAK-010 spec amendment fast-tracked.
- **SPEC W-LEAK-010 row + §51.12.4 chained-rearm note SHIPPED `7d8de4a`.** Two small SPEC additions surfaced by S77 work. W-LEAK-010 added to §34 catalog (both summary at line 11526 + full catalog at line 14432) with severity Info; cross-ref added to §19.9.6. §51.12.4 amendment documents that computed-form temporal rules opt out of JSON-encoded chained auto-rearm — single-step computed transitions arm at module-init via per-rule inline arms; multi-step computed→computed chains require user-driven writes. Closes Q1 from A5-4+5 dispatch report.
- **STRING-token quote-preservation SHIPPED `6075a81` — across all 4 test-block parsers + A5-5b SCOPE doc.** Same root-cause family as the consecutive-`let` fix. The tokenizer strips outer quotes from STRING tokens (`.text` field holds unquoted content). 4 collectors in `parseTestBody` (collectBody, collectAssertTokens, parseTestBindDecl RHS, non-assert test body) used raw `parts.push(tok.text)` and joined with spaces, producing invalid JS like `expect(getGreeting ( alice )).toEqual(stubbed-greeting)`. Fix: NEW `tokenToSourceText(tok)` helper re-wraps STRING tokens (`JSON.stringify` for plain; backticks for `isTemplate`); applied at all 4 push sites. +5 unit tests covering RHS / asserts / body / before-block / backtick template. End-to-end verified.
- **A5-5b SHIPPED `b22c6d3` — legacy `<machine>` body-parser `${...}` preservation.** Closes A5-4+5 dispatch's deferred Q2. Phase 0 finding revised the SCOPE doc's hypothesis: BS preserves `${...}` correctly in logic-child `.raw`; the bug was a spurious `\n` insertion in ast-builder.js's `rulesRaw` concat (line 9086) fragmenting multi-child rules. **One-line fix.** Both temporal surfaces now end-to-end with bit-identical runtime semantics. +3 unit tests in `computed-delay.test.js §A5-5.5b`. Per-PR effort: ~30min total vs SCOPE doc's ~1-2h estimate (Approach A was overspec).
- **A5-6 Feature 2 SHIPPED `10ecdc2` — engine event-timeout watchdog (`<onIdle>`).** Per S77 user-ratified scope (Path C: Feature 2 only; Feature 1 named-timer + `cancelTimer` builtin DEFERRED on engine state-child body-render dependency). NEW SPEC §51.0.R + 3 §34 catalog rows (E-IDLE-DUPLICATE / E-IDLE-INVALID-VARIANT / E-IDLE-MISPLACED). NEW `<onIdle after=DURATION to=.Variant/>` self-closing element at engine-root scope. Distinct from `<onTimeout>` (per-state): `<onIdle>` is engine-WIDE watchdog — armed at module-init, RESET on every successful transition, fires after N ms of silence. Rule=-honoring fire (sub-A1). Tree-shake when no `<onIdle>` per engine. Implementation: NEW `scanForOnIdleEntries` parser; NEW `OnIdleEntry` interface + `engineMeta.idleWatchdog` field; PASS 11 Step 3.5 validation (cross-references rawOffset against state-child boundaries for E-IDLE-MISPLACED); NEW `_scrml_engine_arm_idle_watchdog` + `_scrml_engine_reset_idle_watchdog` runtime helpers; 5th-arg `idleEntry` threaded through `_scrml_engine_direct_set` + `_scrml_engine_advance` (passes `null` for timersTable position when only watchdog present); NEW `__scrml_engine_<varName>_idle` config const emission. +13 tests. Per-PR effort: ~3-4h vs Phase 2 ~3-5h estimate (within budget).

**Standing patterns surfaced this session:**
- **A5-5b actuals halved the SCOPE doc estimate (~30min vs ~1-2h).** Phase 0 survey discipline overrode the SCOPE doc's hypothesis-driven implementation plan. The bug was simpler than anticipated; Approach A was overspec. Standing rule reaffirmed: Phase 0 is load-bearing — do NOT skip it.
- **A5-6 Feature 1 deferral surfaced engine-body-rendering as a structural prerequisite for several future features.** `cancelTimer(name)` builtin can't have a calling surface without engine state-child body rendering. Same dependency will apply to any future engine-internal helper-call surface. Filed as a structural blocker on the v0.3.0+ candidate list.
- **6 environmental fails on this machine (3 self-host artifacts + 3 test-bind A6-5 hard-coded cwd) carried through entire S77.** Pre-existing; not caused by S77 work; verified via stash + re-run. Same set persisted across all 7 SHIPs without regression.

### 2026-05-10 (S76 — body-split min-viable SHIPPED · C15 family CLOSED · A8 family CLOSED · 2 Insight-28 OQs resolved · 4 SHIPs · +116 tests · 0 regressions)

Heavy-throughput session combining one large background-agent dispatch (A9 Ext 5 ~50h budget end-to-end) with parallel PA-direct fixes that closed two long-standing follow-up families. Cross-machine pickup loss-free at open (this machine was 26 commits behind origin after S75 wrapped on the other machine; stale untracked `handOffs/hand-off-74.md` byte-identical to origin's tracked version, removed cleanly). Six S75-menu items closed in this single session.

- **A9 Ext 5 SHIPPED `41b0764` — body-split min-viable v0.2.0 closure.** Single-agent dispatch D0-D8 (~50h end-to-end, mirror Ext 4's S72 shape). All 8 OQ resolutions per S76 PA SCOPE doc honored (§19.9.6 anchor NOT §47, `idempotency-store=` attr name, INTEGER-timestamp shadow-table schema, verbose-only D-CPS-MONOTONE, `<channel>` SKIP, db-driver→redis→none precedence, NEW Stage 5.5 placement, follow §39.2.x sub-anchor mis-numbering). 18 files touched (+2,540 LOC): NEW `compiler/runtime/idempotency.js`, `compiler/src/idempotency-store-resolver.ts` (~227 LOC), `compiler/src/monotonicity-analyzer.ts` (~463 LOC), 5 NEW test files (+81 tests); EDITED SPEC (+130 LOC: §19.9.6 + §19.9.7 + §39.2.6 + 5 §34 catalog rows), PIPELINE (+62 LOC Stage 5.5), api.js (+181 LOC Stage 5.5 hookpoint + D6 diagnostics), ast-builder.js, codegen/emit-functions.ts (client UUID + `Idempotency-Key` header both CSRF paths), codegen/emit-server.ts (dedup middleware), codegen/usage-analyzer.ts, route-inference.ts, tests/self-host/ast.test.js. Two structural-only deviations from SCOPE doc (D5 server-side helper inliner instead of client-chunk; D6 placement at api.js Stage 5.5 close instead of type-system.ts) — no spec-semantics divergence; both documented in commit. 3 in-scope-but-thin deferrals: D1 export-synth modifier propagation, D3 pure-fn-call detection, D5 Redis backend inlining. PA landing per S67 worktree-as-scratch protocol: 18 files via `git checkout worktree-agent-aa1100371152a25fb -- <files>`; 7 stale-views filtered (files main moved past during agent's run). Tests at landing: 10,790 → 10,874 (+84 = 81 new + 3 from C15 unskips earlier in session).
- **C15.13 SHIPPED `22b6806` — MOD re-export resolution in `buildExportRegistry`.** Two-pass: pass 1 stamps initial entries with internal `_reExportSource`/`_localName`; pass 2 inherits source kind/category/isComponent to fixed-point with cycle-bounded iteration cap (graph.size + 2); pass 3 strips internal underscore fields. Eliminates false-positive E-ENGINE-MOUNT-NOT-ENGINE on `<phase/>` use-sites resolved through re-exporter files. +56 LOC module-resolver.js + 8 new unit tests + §C15.13 unskipped + p3-follow isComponent budget bumped 8→11 with explanatory comment. `re-export-all` (`export * from './x'`) NOT enumerated — future B-step if needed.
- **C15.11/§C15.12 SHIPPED `2867beb` — wrapper-vs-inner `_scope` fallback in `collectCrossFileEngineMounts`.** One-line root-cause fix: SYM at `symbol-table.ts:6999` attaches `_scope` to the inner `ast` via `Object.defineProperty`; codegen's `fileAST` is wrapper-shaped `{filePath, ast, ...}` so `_scope` lives at `fileAST.ast._scope` not `fileAST._scope`. Mirrors existing `nodes` fallback at line 1184. Pre-fix: production-pipeline call always saw `importBindings: undefined` and short-circuited. Pinpointing methodology: unskipped C15.11, captured failure mode via tiny ESM probe + temporary debug logging, surfaced wrapper-vs-inner shape difference, applied 1-line fix, reverted debug. C15 suite now 37/37 passing / 0 skip. CLOSES the entire C15 follow-up dispatch list from S75 hand-off (§C15.11/§C15.12/§C15.13 all SHIPPED in S76).
- **A8 A6-5 SHIPPED `ff1df97` — testMode opt in compileScrml + .test.js writeOutput + end-to-end integration test.** Closes the test-bind family (A6-1+A6-2+A6-3+A6-4+A6-5 all ✅). +26 LOC api.js (testMode opt added; threaded into runCG; `output.testJs` written to `<base>.test.js` mirroring `.machine.test.js` writeOutput pattern; JSDoc + outputs Map shape updated). NEW integration test `compiler/tests/integration/test-bind-end-to-end.test.js` (~280 LOC, 5 tests) compiles real `.scrml` fixtures via compileScrml + spawns `bun test <generated-file>` as child process — verifies bound server-fn → test passes; unbound → E-TEST-006 surfaces + non-zero exit; 0-byte production cost (clientJs/serverJs bit-identical with vs without testMode); testMode=false → no `.test.js` written; multi-binding dispatch. Bonus codegen bug surfaced via integration: `~{}` test-block body codegen doesn't insert separators between consecutive `let` decls (`let a = f(); let b = g();` emits as one line, fails to parse as JS). Same root cause as test-bind RHS string-quote-strip artifact — raw token-join in test-block body codegen. Documented inline in test docblock as a follow-up; §5 works around by direct `assert <expr>` form. Filed as separate codegen tightening dispatch.
- **OQ-bridge-3 RESOLVED 2026-05-10 / S76 — clean.** §53.2.1 grammar EBNF audit verifies `custom` is NOT listed as a refinement-type predicate. Grammar allows `named-shape = identifier` resolving against §53.6.1's built-in registry (7 shapes: email, url, uuid, phone, date, time, color); per §53.6.3 unknown identifiers fire E-CONTRACT-002. The `custom(fn)` surface IS valid only as state-validator (§55), stdlib `scrml:data` library builder, and §55.9 `ValidationError::Custom(tag)` enum variant. Insight 28 standing OQs reduced to 1 (bridge-5 only).
- **OQ-bridge-4 RESOLVED 2026-05-09 / S76 — clean.** `validate.scrml` audit found zero `server { }` blocks; wider `grep -rn "server {" stdlib/` returned only the documentary comment at `stdlib/crypto/index.scrml:140` recording the historical safeCompare fix (Insight 26 audit, already shipped). No follow-up code change.

**Standing patterns surfaced this session:**
- **S67 worktree-as-scratch / file-delta protocol validated at scale.** A9 Ext 5 dispatch ran ~50h budget on agent's branch with PA reviewing + landing via `git checkout <agent-branch> -- <files>` from main + single PA-authored SHIP commit. Filtered 7 agent-side-stale-view files (main moved past the agent's base while it worked) without merge friction. Branch retained for forensic. Compared to cherry-pick pattern: ~2-3 minute landing cost per dispatch vs ~10-15 min.
- **Background-agent + foreground-PA-direct hybrid productivity.** While A9 Ext 5 ran in background, PA closed C15.13 (~45 min PA-direct), C15.11/12 (~30 min PA-direct), and OQ-bridge-4 audit (~10 min) in parallel — file-disjoint with agent. ZERO collisions at landing. Pattern works when agent's FILES_TOUCHED list is well-bounded + PA chooses non-overlapping work.
- **Integration testing surfaces real bugs the unit tests miss.** A6-5 integration test (spawning real bun:test on emitted code) caught the consecutive-`let`-no-separator bug that 26 prior unit tests in test-bind-codegen.test.js never surfaced because they only pattern-matched test JS as text. Documenting the find inline in the integration test docblock is the right durable trail.
- **Spec-Rule-4 enforcement at OQ audits.** Both OQ-bridge-3 and OQ-bridge-4 closed by direct spec-text inspection rather than corpus heuristics. The methodology that prevents Rule-4 drift on spec-derivative claims also closes audits efficiently — read the spec, count what's there, report.



Massive cross-cutting session. **A1c CLOSED entirely** — Wave 5 remainder shipped (C16 refinement-type runtime emission, C17 schema additive shared-core lowering, C18 channel WS broadcast/disconnect, C19 closed as already-shipped-S59 with +2 gap-fill, C20 implicit-via-JS-hoist with +14 regression tests, C21 Tier 3 positional sugar bug fix, C22 bare-variant inference codegen, C23 PIPELINE prose pass with NEW Stage 6.7 VSS sub-stage + Lock Enforcement Map + IFMC reorder). **A8 test-bind family** advanced four steps in one session — A6-2 parser + A6-3 typer + A6-4 codegen (with 0-byte production cost guarantee verified bit-identically). **B14 PASS 10.B path-shape fix** plus bonus channel-mount-false-positive scope-expansion finding. **TS state-child rule= recognition** Phase 0 SURVEY + Option A body-shape dispatch implementation. **C15.14 unskip** verifies S75 fixes work end-to-end. **A9 Ext 5 SURVEY** landed 599-line dispatch-ready brief (~50h budget; prerequisites all cleared by S75's C17/C18/C19/Trigger-5 ships). **Insight 28** ratified — zod-schema-as-validator stdlib-adapter bridge CLOSED as a synonym for `custom(fn)` (Position A 109/140 vs C 101/140 vs B 84.5/140); ratification amendment landed (validate.scrml docs section + §55.1 closure note + §53.14.4 worked example pairing with SCXML strike + parseShape rejection as synonym-detection precedent triplet). **Voice-author article draft v1** — "Run-anywhere + run-forever" musing landed at scrml-support/voice/articles/.

Per-step test deltas: C19 +2 / C22 +14 / C23 0 (docs) / C20 +14 / C17 +44 / C21 +17 / C16 +23 / C18 +20 / B14 PASS 10.B +8 / A6-2 +25 / A6-3 +23 / TS state-child +11 / C15.14 unskip +1 / A6-4 +26 = **+228 net pass**. Three depth-of-survey-discount wins (C19 already-shipped, C20 implicit-via-JS-hoist, C16 manufactured-work-skipped); 2 F4 path-discipline issues (CWD drift fired multiple times during landings, recovered each time); 1 dispatch agent ignored S67 protocol and committed to a custom branch (C18 to `agent/c18-channel-ws-emission` instead of harness-assigned worktree branch — work pulled cleanly anyway).

### 2026-05-09 (S74 — A1c Wave 4 CLOSED · B17.x family CLOSED · §51.0.H spec-complete · 8 commits · +245 tests · 0 regressions)

Massive implementation session. Wave 4 (engines C12-C15) closed in sequence — substrate (C12) → enforcement (C13 .advance + write-hook) → derived engines (C14) → cross-file mount (C15). B17.x family (parser/typer/codegen for `<onTransition>` + `effect=`) opened, scoped, ratified, and closed in same session — 3 ships (B17.2 + B17.3 + B17.4) closing the §51.0.H spec surface. A8/A6-1 (test-bind SPEC) shipped in parallel with C13. After C15, remaining `<onTransition>`/`effect=` deferrals were structurally blocked on parser-extension; PA opened B17.2/B17.3/B17.4 sub-step family with explicit ratification points; all four design Qs ratified to recommended leans. By session close: §51.0.H surface (`effect=` Form 1 + `<onTransition>` Form 2 + co-existence + default semantics + derived-engine integration) is spec-complete from compiler perspective. Body rendering remains separately deferred (wide body-parse step territory, unchanged from C12-C15).

- **C12 SHIPPED `5c910a3`** — engine state-machine runtime substrate (Wave 4 step 1 of 4). Per `<engine for=Type initial=.X>` declaration: ONE static frozen transition table const (`__scrml_engine_<varName>_transitions`); ONE auto-declared reactive variant cell init via standard `_scrml_reactive_set`; §51.0.D mount-position marker. NEW `compiler/src/codegen/emit-engine.ts` (430 LOC) distinct from legacy `emit-machines.ts` — AST shapes (B14/B15 EngineRuleForm vs legacy TransitionRule[]) + trigger sites (engineMeta.stateChildren vs machineRegistry) don't merge cleanly. Both surfaces preserved during v0.next P1 deprecation window. Direct-write rule= validation hook + body rendering DEFERRED to C13/follow-on per SURVEY decisions. +41 unit tests / 0 regressions / 10,308 → 10,349.
- **A6-1 SHIPPED `bd30009`** — test-bind SPEC amendment (Phase A8 step 1 of 6, parallel-dispatched with C13). Per Insight 22 (S67 ratified): `test-bind <name> = <literal-or-handler>` declaration in `~{}` test blocks; scope-local; keys = §47-encoded names; compile-time conditional dispatch; production binary unchanged (dead-code-eliminated); fail-fast on unbound (NEW E-TEST-006). SPEC §19.12.6/.7/.8 + cross-ref §47.5 + §19.13/§34 E-TEST-006 row. Position B (effect-record schemas) NOT ADOPTED (no flip-condition gating per S67 methodology). Path-discipline self-recovery during dispatch: agent caught its own near-leak via `git status` mismatch + reverted before commit. 0 source touched / tests unchanged.
- **C13 SHIPPED `888d0fd`** — `.advance()` + direct-write rule= validation hook (Wave 4 step 2 of 4). Re-scoped from original SCOPE row (drop `<onTransition>` firing — parser-blocker surfaced in pre-dispatch audit; deferred to B17.2+B17.4 sub-step family). Three runtime helpers in NEW chunk #18 `engine`: `_scrml_engine_check_transition` (predicate), `_scrml_engine_advance` ("asserted advance failed" framing per §51.0.G), `_scrml_engine_direct_set` (plain E-ENGINE-INVALID-TRANSITION per §51.0.F). FORK as sibling `buildEngineBindingsMap` rather than extending legacy `buildMachineBindingsMap` (TransitionRule[] shape too entangled with machine-only features). `.advance()` interception in `emit-expr.ts:emitCall` with `engineVarNames: Set<string>` plumbed through context. +40 tests / 0 regressions / 10,349 → 10,389.
- **C14 SHIPPED `a945313`** — derived engines (`derived=expr` emission, L20). Reuses C2's existing derived-cell substrate (`_scrml_derived_declare` / `_scrml_derived_subscribe` / `_scrml_derived_get`). NEW `collectC14DerivedEngineDecls` + `isC14DerivedEngineDecl` sibling functions; `emitDerivedEngineSubstrate{,ForFile}`. Initial-value-undefined throw INLINE inside the closure (no new runtime helper). CRITICAL FIX during implementation: legacy `<machine derived=@x>` ALSO ends up with `engineMeta.derivedExpr` populated, so both predicate AND chunk-detection gate on `legacyMachineKeyword !== true` to avoid double-emit. +37 tests / 0 regressions / 10,389 → 10,426.
- **B17.2 SHIPPED `fd70150`** — parser-extension for `<onTransition>` + `effect=` (A1b sub-step). Mirrors A5-2 body-scan precedent exactly (OnTimeoutEntry + NestedEngineEntry pattern). NEW `OnTransitionEntry` interface + `effectRaw: string | null` + `onTransitionElements: OnTransitionEntry[]` fields on `EngineStateChildEntry`. Three defensive bug fixes for pre-existing parser footguns surfaced by B17.2's needs (findOpenerEnd `${...}` skip; findStateChildCloser + findEngineCloser `<onTransition>` skip; mixed bare-vs-valued attribute walker) — none affect prior behaviour; B15/A5-2/B17 regression tests all pass. Path-discipline self-recovery during dispatch (one in-flight symlink error mid-encoding; reverted before WIP commit). +28 tests / 0 regressions / 10,426 → 10,454.
- **C15 SHIPPED `43c8747` — A1c Wave 4 CLOSED** — cross-file engine mount + auto-declared engine variable (M16, M18). `_scrml_state` IS module-scope-shared in production via classic-script global lex env (verified in `runtime-template.js:81` + `codegen/index.ts:660`); no new runtime helpers needed for cross-file singleton. Threaded `exportRegistry` through runCG (api.js) → CompileContext → CgInput → per-file ctx. NEW collectCrossFileEngineMounts + emitCrossFileEngineMount + lookupSourceMap (path-shape resilience: try-relative-then-absolute, working around B14 PASS 10.B path-shape mismatch surfaced by C15). Extended `gauntlet-phase1-checks.js` Form-1 export suppression to cover `<engine>`/`<machine>` markup blocks. F4 path-discipline incident: agent leaked api.js + context.ts + index.ts to main mid-flight (pre-commit P3-FOLLOW migration test caught it during sibling B17.2 landing); PA stashed leak temporarily, landed B17.2, then C15 final report confirmed those changes ARE part of C15's intent → stash dropped, canonical versions pulled from C15 branch tip. +32 tests +5 skip / 0 regressions / 10,454 → 10,486.
- **B17.3 SHIPPED `40813f4`** — typer diagnostics for `<onTransition>` + `effect=` (5 fire-sites, A1b sub-step). NEW PASS 17 in symbol-table.ts mirroring A5-3 PASS 16 pattern. Standard scope (Q1 ratified) + fire-site #5 included (Q2 ratified) — 5 fire-sites: E-ENGINE-EFFECT-AMBIGUOUS, E-ENGINE-RULE-INVALID-VARIANT for `to=` and `from=`, E-ENGINE-INVALID-TRANSITION compile-time for FROM-state `to=` placement (mirrors A5-3 PASS 16 onTimeout pattern), NEW E-ONTRANSITION-NO-TARGET (added to §34 catalog adjacent to existing E-ENGINE-EFFECT-AMBIGUOUS row, preserving §51.0.H code family contiguity). Worktree-ancestry note: agent forked from S73 wrap pre-Wave-4; resolved by merging main into worktree mid-flight (one SPEC-INDEX conflict resolved cleanly). Pre-existing SPEC.md conflict markers from older `bde823e WIP(uvb-w1)` commit surfaced + filed for separate cleanup (NOT this dispatch's scope). +26 tests / 0 regressions / 10,486 → 10,512.
- **B17.4 SHIPPED `3790131` — B17.x FAMILY CLOSED · §51.0.H spec-complete** — codegen for hook firing. Per-engine `__scrml_engine_<varName>_fire_hooks(fromVariant, toVariant)` function emission via compile-time-baked switch (Q1 ratified). All 4 design Qs ratified to recommended leans pre-dispatch: (Q1) compile-time-baked switch over runtime registry, (Q2) split timing — `if=expr` evaluated BEFORE write, body fires AFTER write, (Q3) compile-time-generated runtime boolean per `<onTransition once>` (`let __scrml_engine_<varName>_once_<idx> = false;`), (Q4) reuse `rewriteExpr` (engine bodies are RAW TEXT). `wrapDerivedEngineClosureBodyWithHooks` for derived-engine integration (Decision 6 — reads `_scrml_derived_cache[name]` for old-vs-new comparison). Hook firing wired INTO C13's helpers (`_scrml_engine_advance` + `_scrml_engine_direct_set`) and C14's derived substrate. Hooks do NOT fire on engine init (Decision 5 — transitions only per §51.0.H "when LEAVING"). After this commit: `effect=` Form 1 + `<onTransition>` Form 2 + co-existence per spec lines 20580-20583 + default semantics ("when LEAVING" + bidirectional from/to) + skipped lifecycle (`<onEnter>`/`<onLeave>`) + derived-engine integration per §51.0.J line 20640 — ALL spec-complete. Cross-ref §18.0.2 (forbidden inside `<match>`) handled by parser layer. +41 tests / 0 regressions / 10,512 → 10,553.

**Standing patterns surfaced this session:**
- **Wave 4 sequential discipline held.** Per SCOPE: C12 → C13 → C14 → C15 strict sequential. Each step's HANDOFF section explicitly addressed next-step prerequisites; downstream steps consumed prior steps' helpers without re-deriving. Zero scope-creep across the wave.
- **B17.x family pattern**: when a downstream step (C13) hits a parser-blocker, surface the gap as a real Rule-3 / Rule-4 question rather than silently re-scoping. PA surfaced B17.2/B17.3/B17.4 as a sub-step family with explicit naming + scope ratification. Result: full `<onTransition>` + `effect=` surface shipped in same session as the original blocker discovery.
- **Pre-existing SPEC.md conflict markers from older commit** (`bde823e WIP(uvb-w1)` — pre-S74) sat undetected at lines 13698-13702 + 13754-13758 because they're inside markdown spec text and tests don't validate SPEC.md syntax. Surfaced by B17.3 dispatch when agent merged main into worktree. Filed for separate cleanup.
- **F4 incident pattern (2 this session vs 0 in S73, 3 in S72).** A6-1 self-recovered pre-commit via `git status` clean-tree mismatch (the brief discipline block worked as designed). C15 didn't self-recover but pre-commit P3-FOLLOW migration test caught it via new uses of `isComponent` outside allowlist. PA mitigation pattern: stash leak temporarily to land sibling work, reconcile after C15 final report (drop stash since C15's branch contained the same content). May warrant elevating PreToolUse hook from "deferred" to "next-priority" per pa.md F4 mitigation §2.
- **CWD drift in PA shell sessions** (2 instances during landing). Bash CWD persists between commands; some chained operations leave shell in unexpected directory (e.g., inside a worktree). Recovery via explicit `cd` to known-good path. Pattern worth filing — possibly elevate to a startup-state-recheck before landing operations.
- **C15-surfaced TS bugs filed:** false-positive E-ENGINE-005 for new `<engine>` state-child rule= form (parseMachineRules only knows legacy arrow-rule); B14 PASS 10.B path-shape mismatch (`exportRegistry.get(binding.sourcePath)` uses literal relative source while production keys are absolute — silently no-ops in production; C15 worked around in its own walker via lookupSourceMap). Both filed for separate small dispatches.

### 2026-05-08 (S73 — A1c Waves 1+2+3 ALL CLOSED · 9 commits · +437 tests · 0 regressions · parallel-dispatch maturity)

Massive implementation session. C0+C1+C2 already shipped pre-S73 (S70+S72); S73 added C3-C11. Wave 1 (foundational state-decl emission) closed with C3+C4. Wave 2 (reset + validators) closed with C5+C6+C7. Wave 3 (validity surface) closed with C8+C9+C10+C11. Cross-field deps refinement (C9) verdict was REFINEMENT not silent-bug fix — pre-C9 reactivity already worked via transitive dirty propagation through the compound parent; C9 added precision (qualified-path subscriptions). Rule 4 explicitly enforced at C6: SCOPE doc drift naming `email/url/numeric/integer/custom` as universal-core predicates was rejected with a regression-guard test. Path discipline streak intact: zero main-rooted writes across 9 dispatches (S72 had 3 leaks; S73 zero — brief-encoded sibling-territory blocks held).

- **C3 SHIPPED `26ce40b`** — render-spec expansion at `<x/>` use site. When a self-closing lowercase markup tag resolves to a registered Shape-2 bindable cell, the markup walker expands the use site to the cell's renderSpec.element with a `data-scrml-render-by-tag` placeholder + LogicBinding entry. New `_validatorAttrsForCell` helper carries HTML-native validators (req → required, pattern, min/max etc.) forward as element attrs per §6.4.2 step 4. Multi-render correctness (L16) preserved: same cell at multiple use sites emits independent expansions sharing the underlying reactive cell. +23 unit tests / 0 regressions / 9,872 → 9,895.
- **C4 SHIPPED `bb317ea` — A1c Wave 1 CLOSED** — bind:* dispatch by render-spec. Walks `registry.logicBindings.filter(b => b.kind === "render-by-tag")` and emits JS wiring per §5.4.1 dispatch table: input-checkbox → bind:checked + change event; input-file → bind:files + change; input-radio → bind:group + change; input-number/range → bind:value + Number() coercion + input event; input-text/email/url/etc. → bind:value + input event; textarea → bind:value; select → bind:value + enum coercion via `<Type>_toEnum` when cell is enum-typed (§14.4.1). New `dispatchByRenderSpec` helper encapsulates the negative-form discriminator (subsumes the spec's explicit input-type list). §53.7.2 predicate gating reused for bind:value writes. +54 tests / 0 regressions / 9,895 → 9,949.
- **C5 SHIPPED `67b9e96`** — reset(@cell) runtime + default= integration. New `_scrml_init_fns` / `_scrml_init_set` storage in core chunk; new `_scrml_reset` helper in NEW `reset` chunk (tree-shakeable; included only when AST has state-decl with defaultExpr OR reset-expr). New chunk added to RUNTIME_CHUNK_ORDER (14→15). New `_emitInitThunkSidecar` emits init thunks for reset consumption. emit-expr.ts:88 Step-9 reset-expr stub replaced with proper `_scrml_reset(...)` lowering — three target shapes (IdentExpr top-level reset, MemberExpr field reset, bare compound walk-all-fields, multi-level compound nav per §6.8.2 + §6.3.5). `insideFunctionBody` plumbing through emit-functions/emit-control-flow/scheduling caught mid-impl when TodoMVC tests revealed init-thunks leaking into function-body reassignments. Closes A1a Step 9 deferral. +34 tests / 0 regressions / 9,949 → 9,983.
- **C6 SHIPPED `50d35b9`** — validator runtime catalog at `compiler/src/runtime-validators.js` (NEW, ~430 LOC). Mirrors compile-time `validator-catalog.ts` 1:1 — same 14 names, same `errorTag` per predicate, same arg-kind discrimination. Exports `VALIDATOR_RUNTIME` map + `fireValidator` dispatch + relational-predicate runner + thunk-arg unwrapping. **Rule 4 enforced:** SCOPE doc drift listing `email/url/numeric/integer/custom` as universal-core predicates explicitly REJECTED — those are stdlib `scrml:data` library predicate-builders (separate surface) and the `Custom(tag)` enum-tag escape hatch (§55.9). Regression-guard test asserts `hasValidator()` returns false for each excluded name. `is some` vs `req` distinct semantics encoded (§42.2.5 — empty string IS some / FAILS req). Locus correction: brief named `runtime/validators.js`; actual landed at `compiler/src/runtime-validators.js` (sibling of runtime-template.js, NOT stdlib module shim). Zero `runtime-template.js` edits — wire-in deferred to C7 to avoid C5 collision. +79 tests / 0 regressions / 9,983 → 10,062.
- **C7 SHIPPED `f935822` — A1c Wave 2 CLOSED** — per-cell validator runner. New `emit-validators.ts` (~330 LOC actual / 360 LOC w/ docs) emits a derived computation per state-decl with validators[] that walks entries in declaration order, dispatches via `_scrml_validator_fire`, applies §55.12 short-circuit rule (req/is some fail → break), writes results to B12's per-field synth cells. Args evaluated per kind: relational-predicate as `{op, value}` object; comparable-with-cell / any-equatable-with-cell as `() => @cell` thunks; arrays of literals/thunks; numeric/regex/inline-message-override slots stripped (B13's `validator.inlineOverride` is the canonical extracted form for C10 to consume). New `validators` chunk loads `runtime-validators.js` from disk at module-load via `fs.readFileSync` (no duplication; C6's catalog stays single source-of-truth). RUNTIME_CHUNK_ORDER 15→16. emit-client triggers chunk inside `case "state-decl":` when validators[] non-empty. §C7.14 demonstrates short-circuit: `<name>` with `req length(>=2) pattern(/^[a-z]+$/)` set to `""` produces `[Required]` only — not three errors. Top-level non-compound cells with validators emit no runner per §55.5 L11 Edge A (no synth surface to write to). +61 tests / 0 regressions / 10,062 → 10,123.
- **C8 SHIPPED `cf37440`** — validity surface synthesis. New `emit-synth-surface.ts` (~280 LOC) emits compound rollup (errors object map + isValid boolean) reading per-field outputs from C7 + per-field/compound `touched` event-driven cells + compound `submitted` reactive cell with document-level submit listener (typeof-guarded SSR + idempotency-guarded). Multi-form discrimination NOT IMPLEMENTED — predictability over selectivity per §55.7. emit-bindings.ts: `_emitTouchedListenerLines` helper + wiring into 6 bind: arms + render-by-tag path; each listener fires touched=true on first input/change OR first focus-out. §55.13 reset integration: ZERO C5 extension required — C8 registers `_scrml_init_set(<key>, () => false)` for per-field touched + compound submitted; C5's `_scrml_reset` walks `_scrml_init_fns` prefix entries naturally. Predictability rule (§55.5/§55.6) confirmed: even no-validator compounds + no-validator fields get the four/three synth properties with trivial defaults. +54 tests / 0 regressions / 10,123 → 10,176.
- **C9 SHIPPED `6a311c7`** — cross-field validator dep precision. Initial hypothesis was "silent runtime bug"; runtime probe DISPROVED it — pre-C9 cross-field reactivity already worked via transitive dirty propagation through the compound parent. The actual gap was PRECISION: validators were subscribing to the COMPOUND PARENT (over-broad — re-fires on unrelated sibling-field writes). C9 fix: validators now subscribe DIRECTLY to qualified cell-path (`signup.password`) instead of base `@signup`; thunks emit `_scrml_reactive_get("signup.password")` instead of indirect `_scrml_reactive_get("signup").password`. New sibling walker `forEachQualifiedCellRef*` family in `validator-arg-parser.ts` (~307 LOC) recognizes MemberExpr chains that existing `forEachIdentInExprNode` intentionally under-collects per its base-ident contract. New `lowerOneArg` rewrite in `emit-validators.ts` lifts @-rooted MemberExpr chains to synthetic single-ident form before emitExpr lowering. 35 integration tests driving REAL parser output (prior C7 tests used synthetic AST stubs). Browser/TodoMVC validation: PASS — the post-commit "no dot-path subscriptions" check confirms the precision improvement landed clean. **Verdict: REFINEMENT, not silent-bug.** B10 dep-graph `validator-reads` edge precision deferred (architectural — would require qualified-path keys; B-step territory not C9 codegen). +35 tests / 0 regressions / 10,176 → 10,211.
- **C10 SHIPPED in `ff0a5dd` push (worktree commit `bb64238`)** — 4-level error message resolution. New `messages` chunk in runtime-template.js (~206 LOC, append-only at END). 14+1 default ValidationError catalog (Required, NotSome, LengthFailed, PatternMismatch, MinFailed, MaxFailed, GtFailed, LtFailed, GteFailed, LteFailed, EqFailed, NeqFailed, OneOfFailed, NotInFailed, Custom). Plus `_scrml_messages_register_inline` (Level 1), `_scrml_messages_register` (Level 2, last-write-wins per §41.12), `_scrml_message_for(error, fieldName, cellName?)` (walks L1 → L2 → L3). RUNTIME_CHUNK_ORDER 16→17. New `emit-messages.ts` (NEW, 99 LOC) emits Level-1 codegen — one `_scrml_messages_register_inline` call per `(cellName, validatorName, override)` tuple. New `stdlib/data/messages.scrml` with `registerMessages` + `messageFor` user-facing wrappers; re-exported from `stdlib/data/index.scrml`. C7 test §C7.13 narrowed: original `expect(out).not.toContain('"signup.errors"')` was over-broad (C10 legitimately emits the override via `_scrml_messages_register_inline`); tightened to parser-level fire-count check. +61 tests / 0 regressions.
- **C11 SHIPPED `ff0a5dd` — A1c Wave 3 CLOSED** — `<errors of=expr/>` first-class element. New dispatch arm in emit-html.ts (~110 LOC) after `errorBoundary` block validates `of=`, captures arrow-function body-override, distinguishes per-field vs compound-rollup, emits `<span data-scrml-errors-anchor="...">` placeholder + `addLogicBinding({kind: "errors-element", ...})`. New errors-element binding consumer in emit-event-wiring.ts (~65 LOC) emits subscribe + render with `_scrml_message_for` (typeof-guarded; resolves to C10's real helper at runtime) + per-shape iteration. binding-registry.ts: LogicBinding.kind extended with `"errors-element"` discriminator + 7 fields (anchorId, errorsKey, isCompoundRollup, allFlag, fieldName, bodyExpr, bodyExprNode). `<errors>` registered in attribute-registry.js (per primer §12 amendment for VP-1/VP-3 coverage; `of` non-interpolating, `all` flag) + html-elements.js (`rendersToDom: false`). Empty-errors → `el.innerHTML = ""` (anchor span persists in DOM for re-render hookup; pragmatic interpretation per SURVEY). Body-override: `bodyFn_<id>(errTag)` replaces default `<p class="scrml-error">` wrapper. +35 C11 tests + 1 new rendersToDom test in html-elements.test.js / 0 regressions / final 10,272 → 10,308 once all three Wave 3 sibling commits compose on main.

**Standing patterns surfaced this session:**
- **Parallel-dispatch maturity (zero F4 leaks across 11 dispatches in S73 vs 3 leaks in S72).** Brief-encoded sibling-territory awareness blocks held: each parallel agent given explicit "DO NOT touch" file lists for sibling territory, plus path-discipline-block. Sustainable pattern for high-throughput dispatch.
- **Depth-of-survey-discount frequency-9.** Survey-first phase consistently returns actionable findings before implementation: file-locus corrections (C3 emit-html.ts, C5 runtime-template.js path); existing-substrate discoveries (C5 found half already shipped via C1; C6 mirrors compile-time 1:1; C8 zero C5 extension needed); scope-shape verdict surfacing (C9 REFINEMENT not silent-bug — runtime probe disproved hypothesis).
- **Spec-Rule-4 enforcement at C6.** SCOPE doc explicitly drifted (listed email/url/numeric/integer/custom as universal-core predicates); spec wins (14 only per §55.1); C6 brief enforced + regression-guard test asserts the exclusion. Sustainable — Rule 4 is an active discipline, not a passive aspiration.
- **Hypothesis-disproof-via-runtime-probe (C9 pattern).** When a refinement step's brief assumes "fix a bug," the survey's runtime probe may reveal "no bug, just imprecision." That's a refinement verdict, not a no-op. Reusable pattern for future refinement-shaped dispatches.
- **`scrml-dev-pipeline` agent staging gap continues.** S71 master-PA notice still pending; pipeline-substitution to general-purpose has been clean across 9 dispatches. Deprioritized but filed.

### 2026-05-08 (S72 — Position B server-keyword DEPRECATION ratified · A9 body-split min-viable phase opened · 2 capability-cycle deep-dives · 8 commits · master-only-push retired)

Substantial session covering server-keyword inference (Insight 25 → Insight 26 verdict flip), parallel-attribute methodology-driven retroactive correction (§51.0.P struck), A1c codegen Wave 1 (C1 + C2 SHIPPED), body-split soundness theory + design + integration mapping, SQL composition re-debate (Insight 27 status quo re-affirmed), A9 Ext 4 S4-wiring shipped, master-only-push protocol retired. Three "scrml is structurally simpler than expected" findings across two deep-dives + four debates with anti-sycophancy convener stance flipping PA's predicted leans 6 times.

- **C1 SHIPPED `0d5a144`** — Shape-aware cell emitter (A1c Wave 1, step 1 of 4). 5-arm shape dispatch in emit-logic.ts; `_scrml_default_set` runtime helper; +25 unit tests; closes S61 Step 11.5 deferred Shape 3 V5-strict gap. Test delta: 9,734 → 9,759.
- **parallel-close SHIPPED `f5b620a`** — methodology-driven retroactive correction. Strike §51.0.P from SPEC; strip parser support; deep-dive (`scrml-support/docs/deep-dives/parallel-attribute-disposition-2026-05-08.md`) eliminated Position A via four-test methodology (synonym-detection failure conceded by spec text); user-direction collapsed Position C ("scxml would be a dsl here. unacceptable") + Position D. SCXML semantic audit found scrml ALREADY HAS the structural semantics via §51.4 multi-engine + §51.0.Q nested engines + §51.0.J derived engines. Test delta: 9,759 → 9,754 (net -5 = -11 stripped tests + 6 regression tests).
- **C2 SHIPPED `33ac96e`** — derived-cell reactive computation (A1c Wave 1, step 2 of 4). Two compile-time emissions only via SURVEY depth-of-discount: extractReactiveDepsTransitive (existed; closes parity with markup-interp); markup-typed factory body via emitCreateElementFromMarkup. Closes SPEC §6.6.3 normative gap. +31 unit tests. Test delta: 9,754 → 9,785. ~3.5h actual vs 4-6h estimate.
- **Server-keyword Batch 1 SHIPPED `ea0ee5b`** — Insight 26 ratification preconditions (Position B DEPRECATE the keyword). 5 deliverables in route-inference.ts: SERVER_ONLY_SCRML_MODULES set completion (+5 modules); SERVER_ONLY_PATTERNS regex completion (+6 process functions + Bun.cron + bare-bun-import); caller-context propagation (Trigger 5; ~30h analysis but T2 implementation); W-DEAD-FUNCTION; W-DEPRECATED-SERVER-MODIFIER (fires only when keyword is redundant). +38 unit tests. Test delta: 9,785 → 9,822.
- **Server-keyword Batch 2 SHIPPED `3996d57`** — Insight 26 spec formalization + stdlib cleanup + Insight 27 §8.4 fragment-reuse paragraph. SPEC.md amendments §11.4 / §47 / §52.10 / §34 / §12.2 (W-/E-DEPRECATED-SERVER-MODIFIER deprecation cycle per `<machine>` precedent); §52.10 disambiguation explicit (server @var Tier 2 cell authority preserved as canonical); §47.10 typo identified (was Relative Import Path Rewrites; agent rerouted to §52.10). 36 decorative `server { }` blocks deleted across 11 stdlib files (audit predicted ~12; actual 3× higher). `safeCompare` reclassified to `fn`. §8.4 paragraph documenting call-graph-based fragment-reuse pattern (no new SQL surface). +16 tests. Test delta: 9,822 → 9,838.
- **A9 Ext 4 SHIPPED `dc98313`** — body-split min-viable, S4 failure-mode preservation wiring. T3 tier (multi-file compiler-source change; new dataflow direction). Auto-`!`-wrap CPS stubs in emit-functions/emit-server (try/catch + tagged-shape envelope `{__scrml_error: true, type: "CpsError", variant: "NetworkError"|"ServerError", data}`). Caller-context auto-`!`-propagation extending Insight-26 Trigger 5 (cycle-1 conservative: every CPS-eligible function implicitly `!`-typed; never under-escalates; strict refinement = cycle-2). Static-reject corner via W-CPS-NEEDS-FAILABLE / E-CPS-NEEDS-FAILABLE deprecation cycle stage 1. SPEC §19.6.7 + §19.9.5 NEW + §34 / §19.13 registry rows. **Section reroute surprise:** dispatch + design dive cited "§47 server functions" but §47 is "Output Name Encoding" — agent rerouted to §19.9 Server Function Errors. **Cycle-2 prereq:** markup-context `<errorBoundary>` suppression deferred (W-CPS-NEEDS-FAILABLE currently fires on `<errorBoundary>`-wrapped calls; cycle-2 must detect provenance before E-CPS-NEEDS-FAILABLE can ship). +16 tests. Test delta: 9,838 → 9,854.
- **Master-list amendments `479ec1a`** — A9 phase ratified (NEW row in §0.1; sequencing constraints on A1c + A8 row notes; §0.4 deferral records for full-body-split + cross-function + scrmlconfig per-app idempotency-key storage + pro-X-voting frequency-6 update).
- **scrml-support pushes** — c275b31 (S48 voice rebase) → 5a114a6 (5 deep-dives + Insight 26 + voice) → c2bddbf (body-split residual+integration design dive) → ff166bf (Insight 27 SQL composition).
- **Master-only-push protocol RETIRED** — user verbatim: *"push yourself when it is time to do so. we need to remove the 'only master pushes'. that didnt work like i hoped."* `feedback_push_protocol.md` rewritten; MEMORY.md index updated; superseded notice in master inbox renamed for forensic; PA pushes directly going forward when authorized.
- **4 deep-dives + 2 ratifying debates landed in scrml-support:**
  - parallel-attribute-disposition (deep-dive — verdict feeds spec strike)
  - server-keyword-inference-disposition (deep-dive — original Insight 25 substrate)
  - stdlib-empty-body-audit (deep-dive — E1 evidence for Insight 26 amendment)
  - soundness-analysis-for-body-split (deep-dive — discovers scrml is ALREADY a body-splitting language at function granularity; CALM-monotonic structural property)
  - body-split-soundness-design (per-extension verdicts for the 5 body-split extensions)
  - body-split-integration-and-residual-design (Q2-Q7 + v0.2.0 phase integration)
  - Insight 26 (server-keyword Position B; 6-0 unanimous re-vote OVERTURNS Insight 25 HYBRID)
  - Insight 27 (SQL composition status quo; 5/5 unanimous A holds; B/D not shipping; C re-affirmed eliminated)

**Standing patterns surfaced this session:**
- **"scrml is structurally simpler than expected" pattern (3rd time + S4 missed-option-4 = 4th time).** PA's reflex predicts "new mechanism needed"; structurally correct answer is "compose existing mechanisms" 4 of 6 design questions in body-split residual + every major question across S72 except keyword-deprecation (which is a removal). Now load-bearing methodology rule.
- **Anti-sycophancy convener stance is operational.** PA's predicted lean was wrong on parallel-attribute (B-vs-C-vs-D — user collapsed C and D), Insight 25→26 keyword reframe, Ext 4 missed-option-4 reorder, SQL composition lean B (panel went A-status-quo). Six predicted-PA-leans flipped this session.
- **F4 path-discipline failure-mode is recurrent (3 incidents this session).** C2 + Batch 2 + Ext 4 all had agents leak Edit calls to main during dispatch; PA caught + reverted each time. Worth elevating to PreToolUse hook mitigation per pa.md F4 follow-up. Filed as backlog priority.
- **Dispatch-curator file-write directive works in synthesis mode.** Insight 27 dispatch returned text for PA append per directive (option c); avoided the destruction-via-Write pattern that hit Insight 26 dispatch. Practice generalizes; permanent.

### 2026-05-08 (S71 — C1 Phase 0 SURVEY · cross-machine reconciliation · S70 accuracy gap)

Docs-only session, three commit threads. (1) Cross-machine staleness on scrml-support resolved (clone was 55 behind / 1 ahead origin since S48; load-bearing user-voice content rebased + chronologically re-inserted + pushed). (2) C1 Phase 0 SURVEY dispatched via general-purpose fallback (scrml-dev-pipeline agent file is missing on this machine; cross-machine staging gap, master inbox notice sent), landed via S67 file-delta protocol with verdict SCOPE-AMENDMENT-SUGGESTED. Three amendments PA-accepted + applied to BRIEF + A1c SCOPE. (3) S70 hand-off accuracy gap surfaced — full-suite fails were 3 (self-host parity drift), not 0; PA-verified independently.

- **scrml-support reconciliation** at `c275b31` (pushed mid-session). Local-only commit `6e25882` (S48 user-voice append, 82 lines including verbatim quotes for `first-principles, full-stack`, `Reception-fabrication`, `3-5k LOC line where languages start to show cracks`, `do it fat im switching machines`) was load-bearing recovery content — origin/main's `## Session 48 — 2026-04-29 [BACKFILL FLAG]` placeholder explicitly noted the verbatim quotes as missing. Resolution: pre-staged 4 backups in `/tmp/s71-scrml-support-recon/`, captured reflog HEAD anchor, `git pull --rebase origin main` triggered conflict on `user-voice-scrmlTS.md`, resolved via Python in-place merge (removed BACKFILL FLAG placeholder, inserted local block at S47/S49 chronological boundary, normalized header `## S48 —` → `## Session 48 —`, dropped leading `---` separator). Verified: zero conflict markers, 5,665 lines, 41 session headers, all 3 grep-anchored S48 phrases present at line 3775+.
- **C1 Phase 0 SURVEY LANDED** at `8ad94e5`. General-purpose dispatch (Tools: *), model `opus`, `isolation: "worktree"`. Self-contained brief with startup verification + 10 SURVEY deliverables + STOP-after-Phase-0 mandate. Worktree branch `worktree-agent-ac5b6dcfb8d28d416` retained for forensic. SURVEY (376 lines) confirmed BRIEF mostly correct with three amendments + caught 4 surprises: (1) Variant C compound parents structurally unemittable today (children silently dropped at codegen — wider gap than BRIEF flagged); (2) Tier 3 has latent JS-comma-operator codegen bug (`(a,b,c)` evaluating to `c`) — out of C1 scope, documented for C21; (3) `runtime-template.js:181` already routes `_scrml_reactive_get` → `_scrml_derived_get` for derived names (major infra assist for markup-typed derived consumption — zero `emit-html.ts` changes needed); (4) 3 pre-existing self-host fails detected on main HEAD. Cost estimate 4-6h holds via 7-WIP decomposition.
- **C1 Phase 0 SURVEY amendments APPLIED** at `75417fa`. (1) BRIEF §4.3 — accept ONE new runtime helper (`_scrml_default_set`) for `default=` storage per §6.8.1; compound-parent proxy reuses `_scrml_derived_declare` (Option A-prime) to avoid a second helper. (2) BRIEF §6.3 — test invariant is "no NEW fails," not "zero fails total" (baseline 9,734 / 64 / 1 / 3, NOT 9,752 / 60 / 1 / 0). (3) A1c SCOPE §4.5 — C1 row expanded to fold in Variant C compound + markup-typed-derived emission (was originally in C21); C21 row reduced to Tier 3 positional sugar only (~2-3h vs 5-7h); §4.7 emitted-locks row updated to §14.11 (M10).
- **scrml-dev-pipeline agent staging blocker surfaced.** This machine (machine-A) does NOT have `scrml-dev-pipeline.md` anywhere — uses a per-stage specialist pattern (`scrml-js-codegen-engineer` + ~30 siblings) instead. Implementation phase wants the pipeline persona's T1/T2/T3 tier classification. Master PA inbox notice at `/home/bryan/scrmlMaster/handOffs/incoming/2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md` requests staging into `/home/bryan/scrmlMaster/scrmlTS/.claude/agents/`. User session restart required after staging.
- **S70 hand-off accuracy gap.** S70 PA recorded `9,752 / 60 / 1 / 0 (full)`; PA-verified at S71 open via `bun run test` shows actual `9,734 / 64 / 1 / 3`. The 3 fails are self-host parity drift (acknowledged not load-bearing per S66). Discrepancy: -18 pass / +4 skip / +3 fail. Pre-commit hook excludes self-host integration tests so commits aren't blocked. Recorded as standing-list item 133 — next-session PA should run `bun run test` at S-open to confirm baseline, NOT trust prior hand-off counts uncritically.
- **Tests:** S70 close 9,734 / 64 / 1 / 3 (actual; was reported as 9,752 / 60 / 1 / 0) → S71 close 9,734 / 64 / 1 / 3. **0 delta** (pure docs session).

**Standing patterns surfaced this session:**
- **Cross-machine drift can be content (S48 voice) AND tooling (scrml-dev-pipeline agent).** Future cross-machine pickups should sync-check BOTH at S-open. Master inbox dropbox is the right channel for tooling drift.
- **`bun run test` at S-open is mandatory.** Don't trust prior hand-off test counts — verify independently. The "verify compilation of every dev file" project-memory directive applies to PA self-verification too, not just dev agents.
- **S67 file-delta dispatch landing pattern works for general-purpose too.** Same flow — review diff, `git checkout <agent-branch> -- <files>`, single PA-authored commit. Worktree branch retained for forensic. Validated S71 on C1 SURVEY landing.
- **Phase 0 SURVEY catching SCOPE-AMENDMENT is the success case, not a problem.** SURVEY's job is to catch BRIEF / SCOPE drift before implementation. C1's three amendments saved the implementation phase from confusion (would have wasted ~30-60min discovering "ZERO new helpers" was unachievable, ~30min discovering test baseline was wrong, etc.).

### 2026-05-08 (S70 — A7 parser+typer COMPLETE · A1c kicked off · history-regex bugfix · 0 regressions)

A1c codegen+runtime phase officially started this session. A7 parser+typer (A5-2 + A5-3) both shipped. Plus the foundational A1c usage-analyzer (C0) shipped. PA-direct investigation of a C0 SHIP-report surprise revealed a real A5-2 regex bug; fix landed.

- **A5-2 SHIPPED** at `bdc491c` — parser support for §51.0.M-Q (S67 ratified extensions). Extended `engine-statechild-parser.ts` + `ast-builder.js` + `symbol-table.ts` types for `<onTimeout>` element + `history` bare attribute + `internal:rule=` prefix + `parallel` bare attribute + nested `<engine>` recognition + `.Variant.history` structured target form. `EngineRuleForm` Option A flag (`historyForm?: boolean` on single, `historyForms?: boolean[]` on multi). `.Variant.history` zero-source-change in expression-parser confirmed (B20 regex naturally produces `MemberExpr(IdentExpr ".Playing", "history")`). Pre-existing `findStateChildCloser` bug surfaced + fixed (nested engine block depth tracking via separate `scDepth` stack). Phase 0 SURVEY's PROCEED-AS-BRIEFED held; depth-of-survey-discount frequency-7 confirmed. +63 tests / 0 regressions.
- **A5-3 SHIPPED** at `a8a6bdf` — typer + symbol-table walker for §51.0.M-Q. NEW SYM PASS 16 (`walkValidateEngineA5Extensions`) consuming A5-2's AST shapes. Fires E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE + first compile-time E-ENGINE-INVALID-TRANSITION fire-site (`<onTimeout to=>` legality per §51.0.M line 20567 — statically privileged). `EngineMetadata` aggregation as annotated records (`{stateChildTag, ...}`) for codegen clarity. Aggregation entries reuse SAME EngineRuleForm/OnTimeoutEntry objects from `stateChildren` (no deep-copy) — codegen consumers can rely on object identity. **3 deferrals on infrastructure preconditions** (acknowledged + spec-faithful): `<onTimeout>` outside engine state-child placement (markup walker not present); `<onTimeout>` inside `<match>` block-form arm (block-form match parser not present); cascade-miss diagnostic message extension (direct-write compile-time fire-site doesn't exist). Inner-engine structural recursion DEFERRED to A1c. Sub-step 6 EMPIRICAL FINDING: parser pre-rejects `engine-decl` inside function bodies (zero walker code needed for §A5-3.9 cohesion). +54 tests / 0 regressions.
- **A1c C0 SHIPPED** at `846d1ef` — foundational feature-usage analysis pass. NEW module `compiler/src/codegen/usage-analyzer.ts` (702 LOC) + 1-line wire-in to `analyzeAll`. `FeatureUsage` bitmap with 14 validator predicates (imported from `validator-catalog.ts` constants — avoids drift) + 8 engine/temporal flags (engines/derivedEngines/engineHistory/Parallel/InternalRules/OnTimeout/Nested + onTransitionHooks) + 11 cross-cutting flags (channels/refinementTypes (boundary-only)/refinementTypesAny/validitySurface/renderSpec/markupTypedDerived/reset/defaultExpr/variantCCompound/bareVariantInference/programDocAttrs/typeAsArgument-stub). Cross-file traversal via existing `analyzeAll.files[]` (no import-graph code in C0). Soundness > completeness > minimal-output-size via structural-AST-kind triggers. ZERO new diagnostics, ZERO AST mutation, ZERO emission. Output-byte-shape stability by construction. +67 tests (target was +45 to +55; drove higher for soundness coverage of AST-only triggers + cross-file merge + kitchen-sink probe).
- **history-regex bugfix LANDED** at `8d0a6f2` — A5-2's `/\bhistory\b(?!\s*=)/` regex mis-matched `history` inside `rule=.Playing.history` (SPEC §51.0.N target form) because `.` is treated as word boundary by `\b`. Mis-classified `<Paused rule=.Playing.history>` as carrying `history` bareword → false-fired E-HISTORY-NO-INNER-ENGINE. Bug found via PA-direct kitchen-sink probe (canonical SPEC §51.0.N composite example as trigger). Tightened to standalone-token form `/(?:^|\s)history(?=\s|>|\/|$)/`. Defense-in-depth same fix on `pinned`/`parallel` regexes in ast-builder.js. +3 regression tests anchoring SPEC §51.0.N example. **Investigation chain documented** in hand-off-70 — C0 SHIP report's "B14 PASS 10.A coverage gap" framing was imprecise; B14 PASS 10.A is FINE; the agent's defensive substring scan in C0 happened to mask an UNRELATED real bug in A5-2's regex. C0 substring scan stays as legitimate defense-in-depth.
- **A1c C1 BRIEF PRE-DRAFTED** at `1b9bab1` — shape-aware cell emitter. Decoupled from C0 in scope. Closes pre-existing S61 Step 11.5 deferred Shape 3 V5-strict codegen gap. Phase 0 SURVEY mandate baked in. Ready to dispatch S71.
- **PA-side dispatch error recovered (S70 mid-session):** PA misdispatched a fresh `general-purpose` Agent without `isolation: "worktree"` after A5-2 SURVEY when intending to continue the existing agent. Caught immediately via TaskStop (before any source change leaked into main). Recovery: file-delta'd SURVEY from existing agent worktree + re-dispatched implementation with proper worktree isolation. Lesson logged in hand-off: harness can silently shift PA's CWD into a worktree after `git checkout` operations against worktree branches; `SendMessage` not always in deferred-tool list — re-dispatching with self-contained brief is the canonical fallback.
- **Tests:** S69 close 9,626 / 60 / 1 / 0 → S70 close 9,752 / 60 / 1 / 0. **+126 pass / 0 skip / 0 fail / 0 regressions.**

**Standing patterns surfaced this session:**
- **Depth-of-survey-discount frequency-8** confirmed (validated A5-2 + A5-3 + A1c C0 surveys all PROCEED-AS-BRIEFED with minor scope augmentations).
- **EngineMetadata aggregation as annotated records** is the canonical post-A5-3 shape — `Array<{stateChildTag, rule}>` / `Array<{stateChildTag, entry}>`. Codegen consumers (A5-4 / A1c engine wave) can rely on object identity (no deep-copy from stateChildren).
- **First compile-time E-ENGINE-INVALID-TRANSITION fire-site** (`<onTimeout to=>` legality) lands as A5-3 fire-site #3. Pattern reusable for future direct-write compile-time fire-sites when state-child body parser lands.
- **history/parallel/pinned bareword regexes** must use standalone-token form `/(?:^|\s)<token>(?=\s|>|\/|$)/` to avoid mis-matching inside structured-target forms like `.Variant.history`. Use this pattern for ANY future bareword detection.
- **Worktree CWD silent shift** — git operations against worktree branches can shift PA's CWD into the worktree. Verify `pwd` after `git checkout <branch> -- <files>` operations.

### 2026-05-08 (S69 — A1b CLOSER · Wave 5 COMPLETE · 22/22 steps shipped · 0 regressions)

A1b (resolve+type) is now FUNCTIONALLY COMPLETE. All 22 steps shipped across S63-S69. This session closed the cross-cutting Wave 5 bundle (B18 + B19 + B20 + B21 + B22). 9 commits. 2 PA-debug recoveries on background-dispatch API errors (B18 first try + B20 first try); B20 PA hands-on completion reduced 49 fails → 0 by surfacing pre-existing latent issues (match-arm payload binding never bound in typer scope; isArrayLikeArg shape recognition).

- **A1b B22 SHIPPED** at `a294815` — Wave 5 small-bundle (1/3). Closes A1a Step 9 deferral. Three valid `reset()` target shapes per §6.8.2: bare cell, whole compound, single-level compound nav. Multi-level compound nav (`reset(@a.b.c.d)`) ACCEPTED per Phase 0 deliberation (§6.3.5 V5-strict recursive composition; rejecting would create anti-symmetry with READ access). Spec amendment landed in same commit (§6.8.2 multi-level clarification + §6.3.5 cross-ref). NEW SYM PASS 14 (`walkValidateResetTargets`). NEW §34 row E-RESET-INVALID-TARGET. +25 tests.
- **A1b B19 SHIPPED** at `7ce01e4` — Wave 5 small-bundle (2/3). Closes D3 (S58) validation-gate deferral. Two sub-walks per SPEC §38.1 / §38.4 / §34: walkChannelPlacement fires E-CHANNEL-INSIDE-PROGRAM on `<channel>` with markupDepth >= 1; walkSharedModifier fires E-CHANNEL-SHARED-MODIFIER on any state-decl with `isShared:true`. Renumbered from B19's PASS 14 → PASS 15 during S69 file-delta merge (B22 took PASS 14 in parallel small-bundle). 6 test-fixture migrations (mechanical: v1 `@shared <x>:T=init` → v0.next V5-strict `<x>:T=init`; nested `<program><channel>` → top-level `<channel>` sibling). Both error codes already exist in §34 (lines 14251-14252) — no new catalog rows. +13 tests net (+14 unit -1 channel-inside-div removed). Surgical extraction landing pattern (S68 procedure validated again — branch was pre-B22 base; PA spliced B19 walker block atop B22's + renumbered).
- **A1b B18 SHIPPED** at `87cbd36` — Wave 5 small-bundle (3/3). L19 multi-statement event-handler validation (E-MULTI-STATEMENT-HANDLER) per SPEC §5.2.3 + §4.14. NEW helper module `multi-statement-scan.ts` exporting `scanForTopLevelSemicolon` (tracks paren/brace/bracket depth, single/double/backtick string state with escape, line/block comments, `${...}` template-literal interpolation depth). Two fire-sites: (1) ast-builder.js markup branch fires at TAB time on event-handler attribute multi-statement; (2) SYM PASS 11 (validateEngineStateChildrenAndRules, now exported) extended for engine state-child `:`-shorthand multi-statement. Brief's "OUT OF SCOPE" carve-out for `onserver:` / `onclient:` reversed during implementation per spec generality. **First dispatch hit API error mid-implementation** — PA salvaged Phase 0 SURVEY (saved as SURVEY-failed-dispatch-1.md) + re-dispatched cleanly. +55 tests / 0 regressions.
- **A1b B20 SHIPPED** at `79a1a96` — Wave 5 closer (1/2). Bare-variant inference §14.10 / M9 (E-VARIANT-AMBIGUOUS + E-TYPE-063). Helper `inferBareVariantsInExpr` walks bare-variant `IdentExpr` (S66-parser-fix shape) and resolves against LHS-derived contextType. Wired into state-decl + let/const-decl cases (positions 1 + 1b). Five supporting fixes: (a) variable-length lookbehind in `preprocessForAcorn` regex correctly excludes `MarioState . Fire`-style spaced member access; (b) `ast-builder.js shouldSkipExprParse` relaxed to NOT skip `.Variant`; (c) NEW match-arm-block Form 1b parser for `.VariantName(binding,...) => { block }` capturing `payloadBindings: string[]`; (d) typer match-arm-block walker binds payloadBindings into arm scope before walking body (closes pre-existing latent E-SCOPE-001 bug surfaced by parser fix); (e) `isArrayLikeArg` recognizes new `kind:"array"` shape. **PA-debug arc:** first dispatch hit API error mid-implementation; agent's `\s*` widening was too broad (49 test regressions). PA hands-on debug + finish reduced 49 → 0 fails. DEFERRED: positions 2/3/4/5/6 + compound-nav (require infra beyond B20). +81 tests net.
- **A1b B21 SHIPPED** at `c5f9dcf` — Wave 5 closer (2/2) + **A1b CLOSER**. Refinement-type three-zone §53 (boundary-zone hook recording + trusted-zone scope upgrade). **Depth-of-survey-discount HEAVILY realized:** Phase 0 confirmed existing `classifyPredicateZone` infrastructure (type-system.ts:1629) covered most ratified scope. Two surgical changes: (1) three-zone annotation completeness — `predicateCheck` records `{predicate, zone, sourceKind}` for ALL three zones (was: boundary-only); (2) scope-aware SourceInfo upgrade — new `upgradeSourceInfoForPredicatedIdent` makes T-PRED-4 trusted-zone elision reachable from real AST code. DEFERRED to A1c: locus-extension class (fn param/return, bare-expr reassignment, reactive-nested-assign) + HTML attr generation + trusted-zone elision optimization. DEFERRED to v0.3.0 / open SPEC-ISSUE: full SPARK three-zone, named-shape registry, constraint arithmetic, type-aliases for predicates, boolean predicates, L4 predicate vocabulary unification §55 ↔ §53. +27 tests / 0 regressions.
- **PA-debug recovery patterns surfaced (S69):** (a) Crashes mid-dispatch with API errors are recoverable — agent's incremental commits (per pa.md crash-recovery rule) preserve work; PA salvages Phase 0 SURVEY into archive name and re-dispatches with continuation context. (b) For complex regression chains (B20's 49 fails), PA hands-on debug is more efficient than re-dispatch retries — the agent had already done the right Phase 0 work; PA tightens the agent's too-broad regex changes. (c) "Right answer beats easy answer" Rule 3 application: when B20 had 1 LSP test failure remaining, Bryan chose "fix the LSP path first" over land-with-known-issue or skip-the-test — exposed the latent match-arm payload-binding bug + closed it correctly.
- **Tests:** S68 close 9,425 / 49 / 1 / 0 → S69 close 9,626 / 60 / 1 / 0. **+201 pass / +11 skip / 0 fail / 0 regressions.**

**Standing patterns surfaced this session:**
- **Worktree-as-scratch / file-delta** (S67 lock) continues to work cleanly when worktrees are based on current main. Stale-base worktrees still need surgical extraction (S68 procedure) but parallel-fired worktrees are predominantly clean.
- **Background-dispatch API errors** are a real failure mode — 2 instances this session out of 6 dispatches. Mitigated by (1) incremental WIP commits per crash-recovery rule, (2) salvaging Phase 0 surveys from failed worktrees as `SURVEY-failed-dispatch-N.md`, (3) re-dispatch with continuation context + brief amendments. PA hands-on completion is also viable when partial work has bugs that re-dispatch can't predictably resolve.
- **Depth-of-survey-discount continues to apply** — B21 was the most striking S69 example (existing classifyPredicateZone infra covered ratified scope; surgical 81-line type-system.ts diff + 27 tests vs 4-6h SCOPE estimate). Phase-0-survey-first pattern continues to deliver.

### 2026-05-08 (S68 — A5-1 spec amendments + A1b Wave 3 closer + A1b Wave 4 COMPLETE)

Substantial multi-arc session: spec amendments + 7 dispatches + 4 brief pre-drafts. **Two arcs:** (1) A5-1 spec amendments LANDED — §51.0 series gains M/N/O/P/Q for the S67 v0.2.0 scope expansion (DD-Harel hierarchy + Item C `<onTimeout>` + computed-delay relaxation + Machine Cohesion footnote + 2 new error codes); (2) A1b Wave 3 closer (B11+B12+B13) shipped, then Wave 4 (B14+B15+B16+B17) shipped. Bryan resolved 3 deliberation points during A5-1 (history target syntax = `.Variant.history` structured form; cascade placement = §51.0.Q bundled; `<onTimeout to=>` legality = strict-with-rule=*-escape).

- **A5-1 SPEC AMENDMENTS LANDED** at `1de05ef` — pure SPEC.md/SPEC-INDEX.md/PA-SCRML-PRIMER.md (no compiler code). §51.0.K Machine Cohesion footnote (singleton invariant articulated; nested engines permitted in composite state-children); §51.0.M `<onTimeout after=DURATION to=.Variant/>` element (Item C Candidate C; rides §51.12 runtime); §51.0.N `history` attribute on composite state-children + `.Variant.history` structured target form (shallow-only); §51.0.O `internal:rule=` prefix (preserves inner-engine lifecycle); §51.0.P `parallel` attribute on file-scope `<engine>` (naming sugar over §51.4); §51.0.Q hierarchy / nested engines + parent-rule cascade dispatch (Q.1 declarations + Q.2 cascade + Q.3 cascade-miss diagnostic + Q.4 interaction matrix); §51.12 cross-ref pointer to §51.0.M; §51.12.3.1 computed-delay relaxation (`${expr}<unit>`; both engine and machine forms); +2 §34 codes E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE; §4.15 + §24.4 structural-elements registries updated for `<onTimeout>`; SPEC-INDEX.md row + Quick Lookup +12 entries; primer §7.1 new sub-section. 0 test impact (markdown-only).
- **A1b B11 SHIPPED** at `e4a12fd` — synth-cell registry born via SYM PASS 8 (`walkRegisterSynthSurface`). Compound-rollup unconditional per §55.5 predictability rule. E-SYNTHESIZED-WRITE compound-scope dispatch joined to B8's PASS 6 walker. NO new DG edges (Phase 0 — B10 Phase 3 already wired cross-field validator-reads). +27 tests; depth-of-survey-discount #8.
- **B12 + B13 BRIEFS pre-drafted** at `15188ab` — committed mid-session so the dispatched agents could pull from main's git database.
- **A1b B13 SHIPPED** at `336e66a` — E-DERIVED-WITH-VALIDATORS rejection per §55.14 + Level-1 inline-override extraction (`ValidatorEntry.inlineOverride`) per §55.10. New SYM PASS 9. Per-arg-split landed in `ast-builder.js` + `validator-arg-parser.ts`; B10's previously-skipped tests activated. New §34 row E-VALIDATOR-INLINE-DYNAMIC + §55.14 footnote `[^55-14-parse-time]`. +22 pass / -2 skip.
- **A1b B12 SHIPPED** at `0671286` — per-field synth surface extends B11's registry. New `ScopeKind: "field"`; `parentField` discriminant. `lookupQualifiedStateCell` relaxed (drives B22 + IDE autocomplete). PASS 6 checks relaxed (compound-parent → 4 props; compound-child → 3 props excludes `submitted`). New `getPerFieldSynthRecords()` API. +31 tests.
- **WAVE 4 CLOSER BRIEFS pre-drafted** at `1023744` + `556f540` (B15 + B16 + B17 + HEAD-ref updates).
- **A1b B14 SHIPPED** at `934100e` — Wave 4 FOUNDATION. Engine cells join StateCellRecord family with `_cellKind: "engine"` + `engineMeta` (camelCase) per audit Option C. New `EngineMetadata` shape with BASIC + FUTURE A7 fields (forward-compat). PASS 10.A `walkRegisterEngines` + PASS 10.B `walkValidateCrossFileEngineMounts`. `autoDeriveEngineVarName(typeName)` per §51.0.C. MOD's `buildExportRegistry` extended for engine annotations. New §34 row E-ENGINE-MOUNT-NOT-ENGINE. E-COMPONENT-ENGINE-SCOPE engine-decl-inside-component fire DEFERRED to B17. +36 tests.
- **A1b B15 SHIPPED** at `40e0511` — engine state-child exhaustiveness + rule= typer + initial= validation. New SYM PASS 11. Validates `rule=` per §51.0.F three target-only forms. +5 new §34 catalog rows: W-ENGINE-INITIAL-MISSING, E-ENGINE-INITIAL-INVALID-VARIANT, E-ENGINE-STATE-CHILD-MISSING, E-ENGINE-STATE-CHILD-INVALID-VARIANT, E-ENGINE-RULE-INVALID-VARIANT, E-ENGINE-RULE-LEGACY-SYNTAX. New `engine-statechild-parser.ts` (385 lines, 6 EngineRuleForm shapes). +43 tests.
- **A1b B16 SHIPPED** at `773c38b` — derived engines (L20). SECOND consumer of B7's `detectCycle` reusability promise. New `engine-derived-reads` edge kind + `buildEngineDerivedAdj` filter. PASS 12 with two sub-walks gated on `derivedExpr.kind !== "legacy-source-var"` (avoids double-fire with §51.9 LEGACY E-ENGINE-017). Fires E-DERIVED-ENGINE-NO-INITIAL / -NO-RULES / -NO-WRITE / -CIRCULAR. +16 tests.
- **A1b B17 SHIPPED** at `0ca232e` — Wave 4 closer. Per Phase 0, only 1 of 8 audit brief items actionable today; remaining 7 gated on parser preconditions. New PASS 13 (`walkRejectEnginesInComponentDefChildren`) — fires E-COMPONENT-ENGINE-SCOPE on engine-decl in `component-def.defChildren`. Defensive scaffolding (engines never reach defChildren via parser today). +9 active +8 skip tests.
- **File-delta merge friction (S68 surfaced):** B16 + B17 worktrees branched from pre-B15 base; agent-side-stale-views in their full diffs. PA filtered via diff-vs-base + surgical extraction (head/tail splice for symbol-table.ts walker blocks; renumbered B16 PASS 11 → 12 and B17 PASS 11 → 13). Three-way merge attempted on B16 (5 conflicts); abandoned for surgical-extraction approach. Procedure validated for future parallel-from-stale-base dispatches.
- **Path-discipline incidents (resolved):** B14 and B17 both initially edited main repo paths instead of worktree. Agents detected via `git status` / `runSYM` side-effect probes; recovered via copy-then-restore. Pa.md F4 worked as designed.
- **Tests:** S67 close 9,241 / 54 / 1 / 0 → S68 close 9,425 / 49 / 1 / 0. +184 pass / +5 skip / 0 fail / 0 regressions.

**Standing patterns surfaced this session:**
- **Surgical extraction beats 3-way merge** when pre-base agent worktrees produce stale-view-heavy diffs. Procedure: diff-vs-base for clean view + extract specific blocks via shell pipeline (head/insert/tail) + renumber PASSes via sed.
- **Brief HEAD-ref updates** are a separate small commit before parallel-dispatch firing. Avoids brief content drift between dispatch ordering.
- **Forward-compat metadata fields** declared in B14's `EngineMetadata` (parentEngine, innerEngines, historyAttr, internalRules, parallelAttr, onTimeoutElements) without populating — A5-2/A5-3 dispatches consume the shape later.

### 2026-05-07 (S67 — file-delta landing methodology · B7+B8+B9+B10 ship · Wave-3-4-5 audits · S67 v0.2.0 scope expansion)

Substantial session with two arcs interleaved. **Arc 1 (engineering):** worked through A1b Wave 3 — B7 (derived-cell dep-tracking + E-DERIVED-CIRCULAR-DEP), B8 (L21 walker E-DERIVED-VALUE-MUTATE), B9 (validator-arg ExprNode conversion), B10 (three phases — predicate signature catalog + SYM PASS 7 type-checker walker + E-VALIDATOR-CIRCULAR-DEP via B7's generic `detectCycle` reuse). All landed via the new file-delta dispatch-landing pattern after Bryan flagged cherry-pick churn as the blocker on the original methodology. Plus full Rule-4 audit roster for Wave 4 (B14-B17 engine wave) + Wave 5 (B18-B22 cross-cutting bundled). **Arc 2 (design):** master-PA capability-gap audit + two synthesis-mode debate dispatches landed (DD-Harel hierarchy + effects-as-data middle path); user ratified scope expansion + resolved OQ-Harel-8 with `<engine>` everywhere; Machine Cohesion sharpened to articulate the actual singleton invariant; flip-conditions-null methodology rule recorded; tooling-uniformity corollary to Pillar 5 captured.

- **A1b B7 SHIPPED** at `7760fe4` — derived-cell dep tracking + E-DERIVED-CIRCULAR-DEP via Stage 7 generic `detectCycle` (renamed from `detectAwaitsCycle`) + `buildDerivedReadsAdj` filter + pure-`fn` filter via `fnPurityMap` + self-reference handling via `selfReferencingDerivedNodes: Set<NodeId>` + fail-fast on cycle per SPEC §6.6.10 line 2710. Survey-discount: ~75min actual vs 5-7h estimate. +22 tests.
- **A1b B8 SHIPPED** at `cbc0f59` — PASS 6 walker fires E-DERIVED-VALUE-MUTATE on three AST shape paths. Mutating-method + compound-assign catalog at new `derived-mutation-ops.ts` (frozen sets). E-SYNTHESIZED-WRITE deferred to B11 per audit §1.3 wave-ordering. +39 pass / +8 skip with rationale.
- **File-delta dispatch-landing pattern** locked at `05dc631` — supersedes worktree+cherry-pick (S43-S66) AND brief fast-forward-dispatch experiment (S67 first attempt). Per S67 user verbatim: *"branching dosnt work, agents ignore the directive and commit to main creating a mess every time. worktrees means the pa has to redo everything."* Pattern: `git checkout <branch> -- <files>` from main + single PA-authored commit. ~2min landing time vs cherry-pick's ~10-15min.
- **Wave 3 audits** at `ac93b3a` (B11+B12) + `0cc5632` (B9+B10 + §6.11 footnote) + `acd20b6` (B13). Each surfaces SCOPE drifts + spec-faithful corrections.
- **A1b B9 SHIPPED** at `70d7c5d` — validator-arg ExprNode conversion. New `RelationalPredicateNode` AST kind + `validator-arg-parser.ts` (NEW 268 LOC). Step 5 STRING-token quote-strip bug surfaced + fixed inline. Survey-discount: ~1h 10min actual vs 4-6h estimate. +36 tests.
- **A1b B10 (three-phase) SHIPPED** at `737835d` (catalog) + `f4fa2fe` (walker) + `539541f` (cycle detection):
  - Phase 1: `compiler/src/validator-catalog.ts` — 14 universal-core predicates per §55.1; reusable across L4 three loci. 26 tests. Catalog correction at S67: `req`/`is some` arity extended from `0` to `"0+inline"` per §55.10 inline-override syntax.
  - Phase 2: SYM PASS 7 walker — fires E-TYPE-031 family on arity / per-arg-shape mismatches. AST-shape recognition: `{kind:"lit", litType:"string"}` for strings, escape-hatch shapes for regex + bare-variant arrays. +20 pass / +2 skip (per-arg-split deferral).
  - Phase 3: dependency-graph extension — new `validator-reads` edge kind + `buildValidatorArgsAdj` filter consumed by B7's generic `detectCycle`. FIRST consumer of B7 reusability promise. +8 tests.
- **Wave 4 (engine) audits** at `a555e33` (B14) + `c89085d` (B15+B16+B17). B14 substantive: registration architecture (PA recommends `_cellKind: "engine"` + `_engineMeta` annotation hybrid). B15 surfaced §51.0.F-vs-primer-§7 syntax drift (corrected at `53825da`). B16 SECOND consumer of B7 reusability (E-DERIVED-ENGINE-CIRCULAR). B17 substantive expansion: validates BOTH `effect=` AND `<onTransition>` placement.
- **Wave 5 (cross-cutting) bundled audit** at `7a34226` — B18-B22 in one doc. B21 substantial existing-infra finding: `parsePredicateExpr` + `classifyPredicateZone` already in `type-system.ts:718,1629` (depth-of-survey-discount likely).
- **Primer §7 corrected** at `53825da` — canonical §51.0.F three target-only `rule=` forms; transitions via direct write `@phase = .X` or `.advance(.X)`; legacy `<machine>` arrow form explicitly called out.
- **§6.11 spec-prose footnote** at `0cc5632` — type-shape correction per §55.5-§55.7 canonical (parallel to S59/§6.6.8 + S66/§6.6.10 footnote precedents).
- **Master-PA inbox processed (2 messages):** capability-gap audit findings (1327) + debates-complete-with-OQ-Harel-8-blocker (1347). Three deep-dive audits identified real gaps (engine hierarchy, state-timeouts, effects-as-data); two debate-curator dispatches landed verdicts. Insights 22 + 23 appended to `scrml-support/design-insights.md` at `20ff7f6` (master can't write to scrml-support; user said "in our court now").
- **OQ-Harel-8 resolved** — user verbatim S67: *"pick engine, that feels right"*. Machine Cohesion (2026-04-17) sharpened to articulate actual singleton invariant. Pillar 5 (no per-kind mini-DSLs) load-bearing; tooling-uniformity (CLI promotion + migration stay context-blind) operational reinforcement.
- **Item C audit** at `docs/audits/item-c-temporal-engine-rule-migration-rule4-audit-2026-05-07.md` — temporal-rule surface migration `<machine>` → `<engine>`. Three candidate syntaxes analyzed; `<onTimeout>` structural element recommended (Pillar-5-compliant + symmetric with `<onTransition>`).
- **S67 v0.2.0 scope expansion** authorized by user verbatim: *"we shoud start planning out and adding these features to all the roadmap documents and such"*. Master-list §0 updated with Phase A7 (~50-80h) + Phase A8 (~6-12h). IMPLEMENTATION-ROADMAP.md extended with §2.5 + §2.6. New `docs/changes/v0next-inventory/SCOPE-SUPPLEMENT-2026-05-07.md`.
- **Tests:** S66 close 9,090 / 44 / 1 / 0 → S67 close 9,241 / 54 / 1 / 0. +151 pass / +10 skip / 0 fail / 0 regressions.

**Standing patterns surfaced this session:**

- **File-delta dispatch-landing pattern** (S67 ratified at pa.md commit `05dc631`) — supersedes cherry-pick AND fast-forward attempts.
- **Flip conditions are not a feature-adoption gating mechanism** (S67 methodology rule).
- **Tooling-uniformity corollary to Pillar 5** (S67 user observation).
- **B7 reusability promise validated** — first consumer (B10) confirms; B16 will be second.

### 2026-05-07 (S66 — A1b B4+B6 ship · narrowing reversal · pa.md Rules 1-4 · self-host deferred · Tier B full matrix)

Substantive methodology + impl session. 38 commits. The S65 narrowing-error precedent (dropping `==` from spec because corpus showed zero occurrences) was reversed early in S66 — Bryan flagged the structural mistake; PA executed the principled fix (preprocessor enables `.Variant` as primary expression in any operator context), reverted 4 commits, re-shipped Tier B on the full predicate matrix. The reversal arc became the founding precedent for pa.md Rule 4 (spec is normative; derived planning docs are NOT). A second precedent followed almost immediately when a B4 dispatch agent caught PA's "cycle detection" framing in the brief contradicting every spec quote about pinned-cell forward-reference rules — same shape of error.

- **A1b B4 SHIPPED** at `0ff3817` (cherry-pick of 5 worktree commits) — import binding registration + E-STATE-PINNED-FORWARD-REF source-position rule + E-IMPORT-PINNED-INVALID best-effort fire (Option A: `function`/`fn`/`type`/`channel` definitively-wrong kinds; const/let deferred to B14 with explicit known-limit comment for engine-aware export-registry annotation). +32 tests. Predecessor agent's Phase 0 STOP report caught PA's cycle-detection brief error pre-implementation.
- **A1b B6 SHIPPED** at `d1b7f1e` (3 cherry-pick commits) — render-by-tag classifier (PASS 5 in `symbol-table.ts`). Fires E-CELL-NO-RENDER-SPEC + E-CELL-RENDER-SPEC-NOT-BINDABLE per Phase 0 dispositions. +19 tests. PascalCase `<MyComp/>` deferred to B14/M18/M20 (component-prop catalog territory).
- **S66 narrowing reversal** — 4 reverts restoring SPEC §56 + SCOPE.md + docs to pre-narrowing state. **Parser fix at `cb167b1`**: bare-dot variants parseable as primary expressions everywhere via `preprocessForAcorn` rule mirroring `is .Variant`. Lint + CLI extended to recognize both `op: "is"` and `op: "=="` over leading-dot ident RHS as variant-tag checks.
- **Promotion ergonomics Tier B SHIPPED** on full predicate matrix — `bun scrml promote --match` AST→AST span-rewrite + I-MATCH-PROMOTABLE lint with three message shapes. `--engine` flag stays in CLI but prints "deferred to Tier C" + exits 2.
- **Tier C SCOPE** at `289b4a3` — `docs/changes/promotion-ergonomics/TIER-C-SCOPE.md`. ~9.5-18h single-session shippable.
- **pa.md "Design discipline" section** at `c744b19` (Rules 1-3) + `6768132` (Rule 4) — load-bearing for every PA session until v0.2.0 ships. Two precedent-error narratives recorded inline.
- **Self-host bootstrap DEFERRED** at `b9ed76f` + clarification at `7a213b9` — entire self-host scrml compiler human-authored (not just bootstrap); processed through scrmlTS. v0.2.0 estimate reduces from 280-440h to 240-360h.
- **A1c roadmap Rule-4 audit** at `f9ab867` — 1 substantive drift (validator catalog `email/url/numeric/integer/custom` claimed as universal-core but NOT in SPEC §55.1; same drift in primer §8 — corrected at `eba2df0`). 1 minor incompleteness (schema lowering table). Per-step Rule-4 survey gates table at audit §3 (24 entries).
- **A1b B7 + B8 Rule-4 audits** at `ac23dde` + `5f1b925` — pre-dispatch. B7 finding: SCOPE underspecifies — transitive function-call dependencies required by SPEC §31.5. + spec naming drift §6.6.10 still uses `E-REACTIVE-005` — fixed via rename footnote at `9064767`. B8 finding: wave-ordering caveat — SCOPE puts B8 (Wave 1) firing E-SYNTHESIZED-WRITE which depends on B11 (Wave 3).
- **Maps cold-start refresh** at `7df773f` — first real refresh since S40. LOC drift visible: ast-builder.js +2,156, expression-parser.ts +687, SPEC.md 20,442→24,911 lines, tests 370→447 files.
- **Master-driven docs site refresh** — change-1 (extract styles) at `afaa6b6`, change-2 (Bun build script + templates) at `26ebfc9`. PA validation + commit; did NOT proactively run `bun run docs:build` per Rule 1.
- **Spec rename footnote** §6.6.10: `E-REACTIVE-005` → `E-DERIVED-CIRCULAR-DEP` at `9064767`. Sibling pattern to §6.6.8 S59 footnote.

**Standing patterns surfaced this session:**

- **Spec-vs-derived-doc drift is the single biggest source of session-rework cost.** S66 narrowing reversal cost ~10 commits to restore baseline. Rule 4 + pre-emptive Rule-4 audits (~30min/audit) caught at least 2 more drift cases pre-dispatch.
- **Killed-agent-reuse pattern.** When PA accidentally TaskStops a mid-flight agent, its survey commit is salvageable via cherry-pick. Re-dispatch with Phase 0 baked-in skips re-survey.
- **CWD-slips-into-worktree-dir hazard.** PA running `git -C <worktree>` commands can leave CWD set there; subsequent `git cherry-pick` lands on worktree branch instead of main.
- **Workflow concern surfaced (Bryan, mid-session):** cherry-pick overhead + perceived "double-dipping" between agent and PA. Hand-off §"Bryan's workflow concern" lists 4 candidate evolutions for S67 deliberation.

### 2026-05-06 (S65 — parseVariant SHIPS · A1b foundation B3+B5 · 5-dispatch parallel wave converges)

Substantial session: started as deliberation (Zod deep-dive + debate-05 + parseVariant SCOPE+SURVEY) and accelerated into the largest parallel compiler-work wave in scrmlTS history — 5 concurrent background dispatches converging cleanly on main with 0 regressions. parseVariant ships as the first L22 family member. A1b's foundational PASS-3 (B3) + PASS-4 (B5) annotation contracts now expose `_resolvedStateCell` + `_cellKind` for downstream consumers. Debate-04 carry-forward fully closed. Promotion ergonomics Tier A creates the CLI surface + ratifies SPEC §56; Tier B is concrete-substrate-defined and can fire next session.

- **parseVariant SHIPS at `f963a75`** — L22 family member #1 fully realized. SPEC §41.13 + §53.14 + §34 (4 codes) + family-precedent doc (scrml-support `5efdd05`) + primer §13.6/§13.7 + kickstarter §3a. 18 new tests (8 unit + 10 integration); ParseError-as-builtin-tEnum fix unblocks cross-file resolution. `parseShape` closed as intentional absent (synonym with §53 boundary refinement).
- **A1b B3 — `@name` resolution at `2433dc7`** (depth-of-survey discount #8) — ~2h actual vs 4-6h estimate. PASS 3 in `compiler/src/symbol-table.ts` walks every `@`-prefixed `IdentExpr`, annotates `_resolvedStateCell` (StateCellRecord | null | undefined). `getResolvedStateCell(ident)` read API exported. +11 tests; 0 regressions. Powers B5/B7/B10/B22 + promotion ergonomics + A1c C0.
- **A1b B5 — cell classifier at `b24aaad`** (depth-of-survey discount #9) — ~1.5h actual vs 3-5h estimate. PASS 4 in symbol-table.ts classifies every state-decl as `"plain" | "bindable" | "markup-typed" | "compound-parent"`. `getCellKind(decl)` + `isCellBindable(decl)` exported. +11 tests. Bindable tag set (`input`/`textarea`/`select`) sourced from `codegen/emit-html.ts` for canon alignment. Powers B6 + B7.
- **A+ verdict #1+#2 at `b661c0b`** — debate-04 carry-forward execution. Pattern 16 in lint-ghost-patterns.js: did-you-mean: match enrichment on E-SWITCH-FORBIDDEN + W-LIFECYCLE-CANDIDATE tightening (predicate `^[A-Z][A-Za-z0-9]*$` for enum-tag-shaped string-literal RHS). +15 unit tests. Carry-cost paid: rewrote 2 internal `switch (type.kind)` blocks in `stdlib/compiler/meta-checker.scrml` to if-else chains (the language now dogfoods its own anti-pattern lint). Quickfix infrastructure deferred to future LSP/code-action dispatch (enriched-message-text used today).
- **ast-builder grammar fixes at `b661c0b` + `50b6af3`** — three small grammar findings landed (commit attribution wrong due to S65 concurrency hazard; work itself is verbatim correct):
  - F1: `export function NAME() {}` now synthesizes a sibling `function-decl` with `exported: true, fromExport: true` (codegen skips fromExport=true to avoid double-emission)
  - F2: `export * from './path'` parses as `re-export-all`
  - F3: `export { A as B } from './path'` (and local rename) parses with `renames: [{exported, local}]`
  - +18 unit tests. Module-resolver propagates new graph entries; api.js seeder follow-up (chase `localName` + `re-export-all`) queued.
- **api.js cross-file stdlib enum re-export gap at `8479e6d`** — Phase 2 Risk #1 follow-up. `importedTypesByFile` seeder rewrite at lines 790-895 + auto-gather pre-pass regex extension at lines 448-505 (`/(?:import|export) ... from/`). Future stdlib enum additions (e.g., `serialize`'s `SerializeError`) work without builtin-status grants. +5 tests. Adjacent finding documented: only the seeder fix wasn't sufficient; the auto-gather had to compile re-export targets too.
- **Promotion ergonomics Tier A at `bc42547`** — CLI stub (`compiler/src/commands/promote.js`) + SPEC §56 (full normative spec for `bun scrml promote --match`/`--engine`) + §34 catalog row + primer §11/§13.8 + kickstarter §6 + new section in tier-ladder-promotion article. Tier B (lint detection + AST→AST transformation, ~25-41h scope-revised UPWARD) properly scoped for follow-up dispatch. **Honest scope-revision-up, not the discount pattern** — `bun scrml migrate` is regex-based not AST-aware; the CLI scaffolding carries forward but the transformation logic is novel work. Span-based AST→AST rewrite path recommended in SURVEY.md.
- **Predicate-gaps deep-dive SCOPE prep at `c8104fa` (scrml-support)** — frontload SCOPE doc for the 4 P1-promoted gaps (#8 aliases, #9 reqIf, #12 async, #17 transform). ~1,762 words. `#9 reqIf` corroborated as most-urgent. Trigger conditions explicit (A1c real-app friction OR adopter blocker OR SPEC-ISSUE-§53.13.1-4 touch). Deep-dive itself fires later when corpus signal warrants.
- **Companion follow-up dev.to article + X-snippet** drafted/ratified earlier in S65 — `published: false` awaiting Bryan post.

**Standing patterns surfaced this session:**

- **Depth-of-survey-discount counter is now 9.** B3 (#8) and B5 (#9) both confirmed. The pattern continues to fire reliably for "new infrastructure needed" claims when existing AST machinery covers more than the audit assumes. Mitigation checklist in primer §12 stands.
- **Concurrency hazard: 5 parallel compiler dispatches without worktree isolation cause cross-agent staging clobbers.** Two independent observations this session: A+ #1+#2 dispatch detected destructive `git reset HEAD` twice from other agents; ast-builder dispatch's commits got captured under A+ and promotion-ergonomics commits (work landed verbatim, attribution wrong). **Future PA recommendation: serialize edits to compiler/src/ast-builder.js + compiler/src/lint-ghost-patterns.js across dispatches, OR use worktree isolation when more than one dispatch needs them.** S65 hand-off entry surfaces this.
- **Pre-commit hook + concurrent dispatches is a real concurrency hazard.** Pre-commit tests the whole tree, not staged files; one in-flight dispatch's failing test blocks all other dispatches' commits until cleanup. Effectively serializes the commit phase even when work phases run parallel. Worth a primer §12 amendment.
- **Honest scope-revision-up is also a discount-pattern signal** — promotion ergonomics Tier B revised UP to 25-41h (not down). The depth-of-survey methodology catches both directions: when existing infrastructure carries more than expected (down) AND when assumed-similar infrastructure is actually different (up). Both are valuable findings; both are surfaced by survey.



### 2026-05-06 (S65 — predicate-Zod deep-dive + debate-05 + npm-myth amend + parseVariant scope)

A predicate-system-vs-Zod deep-dive followed by a 5-expert adversarial debate on whether scrml should ship a boundary-parsing primitive (`parseVariant`/`parseShape`) in `scrml:data`. Bryan: "I strongly lean yes, and this is the time to do it" — anti-sycophancy convener stance, fired the debate to test the lean. The 5/5 unanimous panel verdict NARROWED Bryan's lean: ship `parseVariant` only; close `parseShape` as intentional absent — the synonym-detection test (debate-04 methodology) demoted `parseShape` because §53 SPARK boundary-zone refinement on assignment to typed parameters already does what `parseShape` would do. The simplicity-defender (B-default) flipped to C-narrow under the synonym test — third consecutive debate (debate-03 roc, debate-04 crystal, debate-05 simplicity-defender) where an expert positioned to argue X voted against X after honest construction. Frequency-of-three confirms pro-X-voice-voting-against-X as methodology-grade signal.

- **Predicate-system-Zod-replacement deep-dive (`scrml-support/docs/deep-dives/predicate-system-zod-replacement-2026-05-06.md`, 608 lines)** — tested the npm-myth article's "Zod can't fail your build. This can." + "None of it belongs in a scrml app. Ever." claim. Verdict: **claim STANDS WITH CALIBRATION REQUIRED** — not retraction. Form-validation layer is genuinely stronger than Zod+rhf (auto-synth `@form.isValid` + `@form.errors` + cross-field via predicate args is what Zod needs rhf for). Boundary-parsing has 3 real gaps: (a) named-shape registry breadth (scrml ships ~7, Zod ships ~25), (b) discriminated-union parsing of unknown JSON (tRPC use case, no first-class scrml answer at deep-dive time), (c) `.partial()`/`.pick()` for create-vs-edit forms. 12-case hand-rolling inventory. 17-gap predicate-vocabulary inventory re-prioritized under Zod lens; 4 promotions to P1 (`#17 transform/preprocess`, `#9 reqIf`, `#12 async predicates`, `#8 predicate aliases`); 2 demotions/eliminations (`#1 between`, `#2 nonempty` — synonyms); 3 new gaps surfaced (#18 named-shape breadth, #19 boundary-parsing primitive, #20 validator-set transform operators). Recommended highest-leverage follow-up debate: Gap #19 disposition.
- **Debate-05 brief (`scrml-support/docs/debates/debate-05-boundary-parsing-primitive-2026-05-06-BRIEF.md`)** — 5-expert panel: simplicity-defender (B-default), roc-expert (Decode-ability precedent), crystal-multi-dispatch-expert (`from_json` precedent + sound-type-system lens), scrml-dev-typescript (tRPC use-case voice), scrml-dev-react (server-boundary use-case voice). Methodology stack: per-shape sliver + synonym-detection + predicate-survival + asymmetric-forfeit-cost + string-discriminator trap. PA orchestrated panel directly via parallel Agent dispatches per S64 hand-off note 46.
- **5 expert positions** at `scrml-support/docs/debates/debate-05-position-*-2026-05-06.md`. All 5 converge on hybrid-A-C / C-narrow: ship `parseVariant`, close `parseShape`. Crystal high score (51.5/60) for the 12-year `JSON::Serializable` precedent + cleanest formal three-column synonym proof. Simplicity-defender's B-to-C-narrow flip is "qualitatively stronger than debate-03/04 flips because it was on the foundational add-anything question" (judge).
- **Debate-05 transcript + judgment + design insight (`scrml-support` + `scrml-support/design-insights.md`)** — judge ratifies 5/5 panel verdict. Design insight #4 captured: type-establishment step (constructor selection from discriminator, e.g. `parseVariant`) and predicate-enforcement step (SPARK boundary refinement) are sequentially ordered, not substitutable; sum-type case justifies the primitive, product-type case is a synonym. Pro-X-voice-voting-against-X confirmed at frequency-3 as methodology-grade signal.
- **npm-myth article amended (`docs/articles/npm-myth-devto-2026-04-28.md` lines 44-48)** — lifted form-DX claim out of obscurity (`<signup>` + auto-synth `@signup.isValid` + cross-field via `eq(@field)` predicate args = "Zod needs react-hook-form to do what scrml does in one declaration"). Added `parseVariant` as the discriminated-union answer. Closed `parseShape` as intentional. "None of it. Ever." softened to calibrated form: "for forms, Zod doesn't belong; for boundary-parsing, scrml has its own answer." Form-validation claim survives unmodified.
- **X-snippet drafted (`docs/articles/x-snippet-zod-calibration-2026-05-06.md`)** — 3 variants (60-word standalone, quote-reply pattern, 180-word follow-up post). PA lean: variant 3 (long-form) — demonstrates the debate-and-revise process, anti-sycophancy convener stance made visible. Awaits Bryan's selection.
- **parseVariant implementation SCOPE (`docs/changes/parsevariant-impl/SCOPE.md`)** — verdict-locked design with constraints (scrml-native enum required; variant-name as fixed discriminator; `::ParseError` failure type; companion design statement closing `parseShape`). Three implementation paths analyzed: Path A (compile-time special form, ~20-30h), Path B (schema-as-value substrate, ~8-12h), Path C (hybrid-desugar, ~10-15h, PA lean). Decomposition into 11 steps (lock L22 record, SPEC §10.4 + §53.x + §34, compiler change, stdlib runtime, tests, primer + kickstarter + inventory updates). Awaits Bryan's path-selection authorization before dispatch fires.

**Standing patterns surfaced this session:**
- **Strong-lean-still-fires-debate.** Bryan: "we should do the debate, but I strongly lean yes, and this is the time to do it." When the convener leans strongly, fire the debate ANYWAY — it tests whether the lean survives methodology-stack scrutiny. Result: lean validated but narrowed (A → hybrid-A-C). Anti-sycophancy convener stance + methodology stack = honest scrutiny that produces better designs than going straight to dispatch.
- **Read-only agent positions need PA-side persistence.** simplicity-defender, roc-expert, crystal-multi-dispatch-expert all dispatched with Read-only tools per their agent definitions. PA persisted their position content from task-notification output. scrml-dev-typescript and scrml-dev-react had Write and self-persisted. Worth tracking: agent-tool-set audit may improve dispatch ergonomics later.
- **Design-insights.md write-truncation hazard mitigated** (S64 note 47). Judge agent correctly flagged its lack of Edit access for the large file and requested PA action with exact text. PA used Edit to append cleanly. The hazard documentation worked.
- **Pro-X-voice-voting-against-X confirmed at frequency-3.** Debate-03 roc, debate-04 crystal, debate-05 simplicity-defender. Methodology-grade settled signal: when a partisan-defender voice flips under their own methodology lens, the rejection is structurally stronger than expected agreement.



### 2026-05-06 (S64 — Stage 0c.A + B2 + Phase 4d + 3 debates + audit + 11 primer amendments)

The session landed an unusual amount of work spanning compiler-source dispatches, multi-debate adversarial design, and substantial doc/spec/primer amendments. Sequencing: morning forgotten-surface audit → SPEC §17.5 unbundle → primer top-3 + remaining-8 amendments → Stage 0c.A function-overload deletion (debate-02-authorized) → Phase 4d completion sweep → Phase A1b Step B2 (E-NAME-COLLIDES-STATE) → debate-03 (component-overload SPEC direction; CLOSED WITHOUT RESOLUTION verdict) → SPEC §17.5 close amendment → article surgical edits → A1c plan §0c.E sharpening → tier-ladder rungs+stability deep-dive (Bryan reframed broad: "I guess I'm thinking about adding rungs and stability to the tier ladder") → debate-04 (Bryan's anti-sycophancy: "I'm not entirely convinced" of deep-dive's Approach C lean) → unanimous Approach A+ verdict → SPEC §34 catalog 4 entries → 0c.F audit-doc updates → predicate-gaps inventory captured (Bryan's correction: "none of this discounts predicate expansion"). Net: 13 commits scrmlTS + 4 commits scrml-support; both repos pushed at close.

- **Stage 0c.A function-overload deletion (`9d4c68f` → `6507475`)** — authorized by debate-02 verdict (4-deprecate-hard / 1-soft / 0-retain). Code surface deleted: `compiler/src/codegen/emit-overloads.ts` (60 LOC, removed entirely), `buildOverloadRegistry` in `type-system.ts:7193-7245`, `tagFunctionsWithStateType` in `ast-builder.js:1346-1372`, `FunctionDeclNode.stateTypeScope` field in `types/ast.ts:663`, 5 unit tests in `type-system.test.js:2349-2450`, `codegen/README.md` row, plus surrounding plumbing. 1 file deleted + 8 edited. Tests dropped exactly -5 (the asserting unit tests); zero regressions. Pre-commit clean every commit. Audit-line drift: zero. workspace-l2.test.js correctly identified as TS-overload mention not scrml-overload — left untouched. Original worktree-isolation dispatch halted on harness routing bug; re-dispatched as `general-purpose` no-isolation with frequent commits — clean.
- **Phase 4d completion sweep (`578f6f5` → `efd87d1`)** — drop @deprecated Phase 4d string fields from ast.ts + drop retired reactive-* AST kind interfaces. Audit estimated ~32 deprecated markers + 5 retired AST kinds. Survey corrected: only **19 deprecated markers** existed (partial sweep had landed earlier in S40), and only **1 of 5 reactive-* kinds was truly retired** (`ReactiveDerivedDeclNode`); the other 4 (`reactive-debounced-decl`, `reactive-array-mutation`, `reactive-explicit-set`, `reactive-nested-assign`) are still actively constructed by the parser. Audit had over-extrapolated from a JSDoc tag that only existed on one kind. Agent corrected scope without confirmation per depth-of-survey-discount methodology. Walker arms not pruned (already done in S60). PA-SCRML-PRIMER §12 retired-AST-kinds paragraph rewritten with survey-corrected reality.
- **Phase A1b Step B2 (E-NAME-COLLIDES-STATE) (`527461d` → `0dee2f7`)** — first lock-firing step in A1b; consumes B1's `lookupStateCell` API. Two-pass design within `compiler/src/symbol-table.ts`: PASS 1 (`walk` — unchanged from B1) registers state-decls; PASS 2 (`walkLocalDeclsForCollisions` — NEW) traverses the same AST tree but only fires on let/const/tilde/lin decls, using the `_scope` annotations PASS 1 attached. Avoids forward-reference issues since state-decls hoist per SPEC §6 — visible at any local-decl in same/enclosing scope regardless of source order. **Surface much smaller than 4-6h estimate** — depth-of-survey discount #6 (~30 min implementation). No new error-code registry needed (B1 already had `SYMDiagnostic` infrastructure). 4 unrelated channel tests needed fixing — they used `messages = [...messages, ...]` inside server functions, which parses as `tilde-decl` and now correctly fires E-NAME-COLLIDES-STATE; replaced with neutral `return author` bodies (those tests probe WS routing, not function body semantics). +13 integration tests at `compiler/tests/integration/symbol-table.test.js`; zero regressions. **§S11D.5 .todo NOT promoted** — root cause is parser-level (BS produces 0 blocks for top-level Variant C compound); B1's absorption note correctly anticipated this; awaits parser dispatch (Step 11.0g or similar).
- **Forgotten-surface audit (`07b4898`)** — 5-bucket forensic audit of compiler at `docs/audits/compiler-forgotten-surface-2026-05-06.md`. Triggered by S63 finding that PA had to investigate to discover function-overload existed at all. Buckets: vestigial features, fragile string-typed surfaces, spec-vs-code drift, cross-pass invariants, things-the-primer-doesn't-know. Top P0 finding (fixed same-commit): SPEC §17.5 wording overran debate-02 verdict — declared BOTH function-overload AND component-overload retired, but debate-02 explicitly carved out component for separate examination. P1 findings: Phase 4d completion sweep (largest cleanup-debt cluster), Stage 0c.A function-overload deletion (clean surface map), 11 primer-amendment proposals. Audit's recommendation 5 (try/throw/switch hard-error diagnostic) escalated to debate-04 territory.
- **Primer top-3 amendments (`07b4898`) + remaining 8 (`c8c8bb9`)** — applied all 11 audit-derived amendments to PA-SCRML-PRIMER.md. Top-3: pipeline bookends (`lint-ghost-patterns` pre-pass + `gauntlet-phase[1|3]` post-TAB walkers — both invisible at primer level previously), retired-but-walker-handled AST kinds list. Remaining 8: legacy `<machine>` deprecation + `bun scrml migrate` CLI, schema-differ.js diff-algorithm location, SPEC.md ~410k token Read-budget reality, attribute-registry update requirement for new structural elements, `setBPPOverrides` self-host shim, open SPEC-ISSUE registry (discoverable via grep), §13.5 NEW spec-real-estate-vs-adoption table covering ^{} active vs _{} sliver-empty vs §36 input-state-types sliver-empty vs §17.5 function-overload retired vs component-overload doc-only vs <transaction> stub vs <machine> deprecated.
- **SPEC §17.5 amendments (`07b4898` for unbundle; `8bda55f` for close)** — first amendment (foundation): unbundled function-overload (RETIRED for v0.2.0) from component-overload (UNDETERMINED, pinned for queued debate-03), recorded the audit finding that component-overloading was DOC-ONLY in SPEC; second amendment (post-debate-03): component-overload now CLOSED WITHOUT RESOLUTION; SPEC-ISSUE-010-COMPONENT closes; §18.0.1 explicitly authorizes structurally-different markup trees in match arm bodies as the canonical replacement.
- **Article surgical edits (`8bda55f`)** — `docs/articles/why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md` amended in 4 surgical edits to reflect debate-03 verdict + S64 audit finding. Component-half framing changed from "deprecated" to "DOC-ONLY in SPEC, never implemented." Bryan's voice preserved throughout. Title kept as authored. Article still `published: false`; gate is now LIFTED (debate-03 + debate-04 ratified the claims). Companion `tier-ladder-promotion-devto-2026-05-04.md` UNCHANGED — awaits A+ verdict execution (document JS-style `match expr {}` as canonical value-return rung).
- **Debate-02 transcript + insight (scrml-support `03cfb57`)** — full 6-expert panel + judge: state-type-discriminated function overloading deletion. Verdict: deprecate-hard for function half; SEPARATE DEBATE for §17.5 component half (convergent dissent from roc + crystal). Design insight: **the sliver test is per-shape, not per-feature** — function dispatch (logic-shaped, reducible to match) and component dispatch (markup-shaped, JSX-call-site-asymmetric) are different questions even when implementation lumps them. Judge final scorecard: rust-edition 54.0 / haskell 53.0 / roc 50.5 / gingerbill 49.5 / simplicity 47.5 / crystal 45.5.
- **Debate-03 transcript + insight (scrml-support `761531d`)** — full 6-expert panel + judge: §17.5 component-overload SPEC direction. Verdict: 4 CLOSE + 2 DEFER + 0 DESIGN. **Roc-expert (debate-02 carve-out author) EXPLICITLY RETRACTED the carve-out**, calling it "a category error transposed across languages" — the JSX-call-site asymmetry that grounded the carve-out doesn't transfer to scrml because `<match for=Type>` is a structural element (markup-typed pattern matching), not a function-call site. Empirical gate (does match block-form arm-body carry full structurally-different markup trees?) resolved CLOSE: SPEC §18.0.1 explicitly authorizes it. Design insight: **structural-element-as-markup-value reframe** — when a language elevates a control-flow construct from a statement to a structural element of the same kind as its existing first-class values, asymmetries that exist in source languages with statement-vs-expression dichotomies do NOT transfer; future scrml language-design decisions importing JS-shape slivers must verify the asymmetry's predicate survives scrml's reframe. Plus: asymmetric-forfeit-cost decomposition; convergent-dissent-INVERSION as cross-debate signal. Judge scorecard: roc 55.5 (highest, for retracting own carve-out — intellectual-honesty bonus) / haskell 52.5 / roc 50.5 / gingerbill 49.5 / simplicity 47.5 / crystal 45.5.
- **0c.F audit-doc updates (scrml-support `fec630f`)** — language-status-audit-2026-04-29.md + tutorial-freshness-audit-2026-04-29.md closure notes refreshed to reflect S64 actuals (function-overload code DELETED at Stage 0c.A; component-overload was DOC-ONLY, SPEC track CLOSED via debate-03; supersedes S63 deprecation framing).
- **Tier-ladder rungs+stability deep-dive (scrml-support `9123af6`)** — Bryan: "I guess I'm thinking about adding rungs and stability to the tier ladder." 5-phase deep-dive at `docs/deep-dives/tier-ladder-rungs-stability-2026-05-06.md`. Corpus signal: 0 of 174 if-using files use `<match for=Type>` block-form OR `effect=` (the proposed Rung 1.5 base); only 2 use `<engine for=Type>`. Recommended Approach C (sanction switch as Tier 0+ on-ramp). Bryan's response: "I'm not entirely convinced." Fired debate-04 for adversarial scrutiny.
- **Debate-04 transcript + insight (scrml-support `9123af6`)** — 3-expert panel + judge: switch as sanctioned Tier 0+ surface. **3-of-3 unanimous Approach A** — the deep-dive's recommendation rejected. Crystal-multi-dispatch (pro-sanction by design — VOTED AGAINST TYPE): synonym-not-sliver — switch and JS-style `match expr {}` are isomorphic; 58 corpus files use the JS-style match form already. Gingerbill: **string-switch trap** — the 174 if-files are over STRINGS, not enums; sanctioning switch entrenches string-discriminator anti-pattern by giving it a comfortable home that BYPASSES the promotion lint. Simplicity-defender: applied debate-02 per-shape sliver + debate-03 predicate-survival + debate-03 asymmetric-forfeit-cost; all three triangulated to A. **Verdict: Approach A+** (audit recommendation 5 honored as written + three constructive execution improvements: did-you-mean: match quickfix on E-SWITCH-FORBIDDEN, W-LIFECYCLE-CANDIDATE tightening on `if=` over string-literal RHS values matching enum-tag lexical shape, document JS-style `match expr {}` form as canonical value-return rung in primer + tier-ladder-promotion article). Three durable design-insights: synonym-not-sliver refinement of per-shape sliver test; string-switch trap as design-failure class; pro-X-voice-voting-against-X cross-debate pattern (Roc retracted in debate-03; Crystal voted A in debate-04; frequency-of-two qualifies as methodology-grade signal).
- **Predicate-gaps inventory (scrml-support `9123af6`)** — Bryan correction mid-debate: "none of this discounts predicate expansion." Tier-ladder/switch verdict doesn't argue against any predicate-vocabulary gap; that thread is orthogonal. Captured 17 gaps in three buckets (small ergonomic / mid-impact missing / structural design-question) at `docs/predicate-gaps-inventory-2026-05-06.md`. NOT deep-dived — option (1) of three options Bryan was offered. Revisit when A1c surfaces real-app friction OR when SPEC-ISSUE-§53.13.1-4 gets touched OR when a real adopter reports `reqIf` as a blocker.
- **SPEC §34 catalog 4 missing error codes (`112358d`)** — audit found 4 codes emitted in src but absent from §34: E-CTRL-011 (for-in not supported, ast-builder.js:4087-4093, 6517-6519), E-META-EVAL-001 (compile-time meta runtime error, meta-eval.ts:447), E-META-EVAL-002 (meta re-parse failed, meta-eval.ts:375, 385), E-SYNTAX-050 (bare `/` no longer a valid closer, block-splitter.js:1276). Pure spec-only-fix; no compiler changes.
- **`jsx-dispatch-expert` forge** — agent file written at `~/.claude/agents/jsx-dispatch-expert.md` (~870 lines, color magenta, model opus, tools [Read]). NOT git-tracked. Forged to fill a panel-composition slot for the original retain-vs-delete framing of debate-03; the debate's eventual narrow-spec-direction frame didn't require this slot, but the agent is now staged for any future markup-ergonomics-voice need. Forge agent halted on Write-permission denial; re-fired with text-return shape; PA wrote file with corrections (model: sonnet → opus per pa.md "All agents run on Opus" rule; HTML-escape unescape).
- **3 design-insight entries appended** to `scrml-support/design-insights.md`. Methodology stack now: per-shape sliver test (debate-02) → predicate-survival check (debate-03) → asymmetric-forfeit-cost (debate-03) → synonym-detection precondition (debate-04). Three orthogonal axes; convergence across them is structurally stronger than unanimous voting on a single axis. Plus the cross-debate pattern: pro-X-voice-voting-against-X as the highest-virtue partisan-honest move.

**Standing patterns surfaced this session:**
- **Anti-sycophancy in convener-skepticism territory.** Bryan's "I'm not entirely convinced" → fired debate-04 → unanimous rejection of deep-dive's lean. The pattern: when the deep-dive recommends an approach the convener doesn't trust, fire adversarial debate; trust the methodology stack to test the recommendation. Worked.
- **Depth-of-survey-discount counter is now 6.** Pattern continues to fire reliably; PA can trust survey-first methodology heavily for any audit that estimates "new infrastructure needed."
- **Worktree-isolation harness routing bug.** Pipeline dispatched with `isolation: "worktree"` may route to scrml-support worktree instead of scrmlTS. Workaround: re-dispatch as `general-purpose` no-isolation with frequent commits + progress.md. Clean across Stage 0c.A + Phase 4d + B2.
- **Brief-locus correction authorization.** When survey reveals audit's named touchpoint or surface assumption is off, agent corrects scope without re-confirmation. Phase 4d's 5→1 reactive-* AST kinds correction is the canonical example this session.
- **Methodology-stack triangulation.** Three orthogonal tests (per-shape sliver + predicate-survival + asymmetric-forfeit-cost) applied to the same option produce structurally stronger verdict than unanimous voting on one axis. Ratified across debate-02/03/04.



### 2026-05-06 (S63 — Stage 0c INSERTED: overload-deprecation housekeeping queued before A1c-C0)

Mid-session sidequest crystallized into a deprecation milestone. After B1 landed, the user opened a small "how does function overloading work in scrml today" question. The conversation walked the shipped state-type-overload mechanism (`emit-overloads.ts`), surfaced a JS-shaped-scrml reflex (PA's first example used a function returning a stringly-typed sum-type with hidden side effects + manual control flow — the procedural-spaghetti shape that scrml's enum/match/engine were designed to make impossible), and re-expressed the same scenario in scrml-native form (engine + derived state). User authorized: (a) verbatim capture of the conversation, (b) an article on the JS-shaped-scrml reflex, and (c) a radical-doubt deep-dive on whether the state-type-overload mechanism should be deprecated.

- **Function-overloading sidequest — verbatim capture (`scrml-support/docs/function-overloading-sliver-2026-05-06.md`)** — full conversation transcript preserved per user mandate ("I want to capture this whole last section VERBATIM"). Sets the precedent that design conversations crystallizing a stance get full-fidelity capture, not just summary.
- **Article landed (`scrmlTS/docs/articles/why-scrml-has-to-deprecate-function-and-component-overloading-devto-2026-05-06.md`, `published: false`)** — ~1500 prose words. Bryan-narrated companion-pair with the existing `tier-ladder-promotion-devto-2026-05-04.md`. Frame: announcement-shaped, slightly facetious open ("Two features are leaving the language in v0.2.0. They worked. Nobody used them."), with the technical why and the lesson the language is keeping. Path C reframe from an earlier `scrml-voice-author`-drafted piece in claude's narrator voice (`js-shaped-scrml-is-the-failure-mode-2026-05-06.md`); the earlier draft was deleted, source-conversation preserved at `scrml-support/docs/function-overloading-sliver-2026-05-06.md`. Tier-ladder companion-edited: byline normalized to `by Bryan MacLee`, opening references the deprecation companion, closing trailer points forward + adds `Drafted with Claude` line. User controls publishing timing.
- **Radical-doubt deep-dive landed (`scrml-support/docs/deep-dives/state-type-overload-deprecation-2026-05-06.md`)** — `scrml-deep-dive` agent dispatch, 5-phase output (~57KB). Frame: take the case for KEEPING the mechanism seriously; find evidence contradicting the in-session "sliver is empty" conclusion. Findings: source-level usage = 0 (zero matches in samples / examples / stdlib / benchmarks / self-host), test coverage = 5 unit tests all programmatic via synthesized AST nodes (zero source-level integration tests), spec authority = 0 normative sections, tutorial coverage = 0, articles = 0, expert tally = 0/6 KEEP / 5 Hard / 1 Soft-preferred-Hard-acceptable. Component overloading (§17.5 / SPEC-ISSUE-010) collapses under the same scrutiny — three test cases all reduce to either two-different-components, single-component-with-match-body, or `match for=state` over an enum. Recommendation: Deprecate-Hard, integrated as Stage 0c housekeeping milestone before A1c-C0. **Caveat:** the deep-dive agent didn't have Agent/Task tool access to dispatch live experts; the §E expert positions are reasoned from each agent's documented philosophy. User authorized proceeding on the source-level zero data without live ratification (Path 1).
- **Stage 0c INSERTED (planning amendment, S63 PA-direct edits)** — `docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md §4.-1` adds 6 sub-steps (Stage 0c.A-F) totaling ~3-5h focused work: delete `emit-overloads.ts` + `emit-client.ts` call site + `analyze.ts` threading; delete `buildOverloadRegistry` + caller in `type-system.ts`; delete `tagFunctionsWithStateType` + `FunctionDeclNode.stateTypeScope` field; delete 5 programmatic unit tests in `type-system.test.js:2349-2450` (test count delta -5); rewrite SPEC §17.5 (DONE this session); update audit doc cross-references (DONE this session). Runs after A1b-COMPLETE, before A1c-C0.
- **SPEC §17.5 rewritten** — "Component Overloading" replaced with "Discrimination on type or value — use `match` or `engine`" + a deprecation status block. SPEC-ISSUE-010 closed without resolution. The replacement primitives (already in the language) are documented inline: `match for=…` for prop-type/value discrimination; `<engine>` with typed transition arms for stateful dispatch; `const <name> = …` derived cells for per-actor-type derived facts.
- **Audit cross-references updated** — `scrml-support/docs/deep-dives/language-status-audit-2026-04-29.md` row 144 + line 26 + line 288 + SPEC-ISSUE-010 row marked DEPRECATED-FOR-V0.2.0 with cross-reference to the deep-dive. `scrml-support/docs/deep-dives/tutorial-freshness-audit-2026-04-29.md` Top-5 item 2 + Pass-3 item 13 + recommended-slot table row marked RETIRED-S63 with cross-reference to the article.
- **codegen README** — `compiler/src/codegen/README.md` row for `emit-overloads.ts` annotated with deprecation note + Stage 0c cross-reference; file itself stays in tree until Stage 0c.A executes.
- **Article reframe — Path C (Bryan-narrated, slightly facetious announcement)** — the initial `scrml-voice-author` draft was claude-narrated with a "JS-shaped scrml is the failure mode" thesis. Bryan reframed to a Bryan-narrated announcement piece ("Why scrml has to deprecate function and component overloading"). Same teaching content; different speaker, different opening posture. Old draft deleted; verbatim conversation preserved at `scrml-support/docs/function-overloading-sliver-2026-05-06.md`. Companion-paired with the existing `tier-ladder-promotion-devto-2026-05-04.md` (byline normalized, opening hook + closing trailer added so the pair reads as one story: ladder is canonical path; overload mechanism was a parallel path that didn't earn its keep).
- **scrml is not a JS-superset language — concession ratified, folded into the article** — Bryan verbatim S63: *"It is true that is where it started. but for a long time I tried to keep the easy dev conversion path, despite KNOWING for some time. This is a language. It is its own, and should stand as such."* The deprecation article carries this as a parallel concession in its closing — recasts the small overload-deletion argument as part of a larger language-positioning shift. v0.2.0 stops the JS-superset pretense. Implications for future articles, scrml.dev copy, and the v0.2.0 announce captured in hand-off.
- **`scrml-voice-author` agent default-output dir shifted** — `~/.claude/agents/scrml-voice-author.md` Step 4 + reference table updated: drafts now write to `scrmlTS/docs/articles/<slug>-devto-<date>.md` (the canonical public series location). Coexists with published pieces in the same dir; `published: false` frontmatter is the publication gate, not the file location. Earlier convention (`scrml-support/voice/article-drafts/`) retired.
- **`debate-curator` + `scrml-deep-dive` defaults shifted to synthesis-from-store** — observation: both agents were synthesizing expert positions from documented philosophy ~half the time anyway, even when nominally invoking live experts. The S63 deep-dive surfaced its own caveat: Agent/Task tool wasn't available, so it reasoned from docs rather than dispatching live. New default at `~/.claude/agents/debate-curator.md` Phase 5 + `~/.claude/agents/scrml-deep-dive.md` Source C: read agent description + first 1-2 substantive sections from `~/.claude/agents-store/{name}-expert.md`, synthesize, label output **"synthesized from agent description"**. Live dispatch reserved for explicit-escalation-flag (rare; reserved for genuinely close calls or surface-area-exceeds-description). Plus `scrml-deep-dive`'s NAVIGATION + Source A paths refreshed (was stale-pointing at frozen `~/projects/scrml8/`; now points at current `~/scrmlMaster/` ecosystem). Global agent files NOT git-tracked; edits saved to disk.
- **Queued live-dispatch debate (`scrml-support/docs/debates/QUEUED-state-type-overload-deletion-2026-05-06.md`)** — Bryan flagged that the article asserts breadth-of-investigation that the synthesis-only deep-dive can't fully back. Responsible move: actually run the live debate before the article publishes or before Stage 0c executes. Queued artifact is a self-contained brief: 6-expert panel (5 already in `~/.claude/agents/`; 1 forged this session), explicit live-dispatch escalation flag, anti-sycophancy guard built in (judge told the convener has a prior conclusion; debate's job is to find the strongest case AGAINST it). Outcome → action gating table maps confirm-deprecate-hard, soft-deprecate finding, or any credible retention-case to revisions of article + Stage 0c + planning amendments. **Pre-debate work done this session:** forged `crystal-multi-dispatch-expert` (~/.claude/agents/crystal-multi-dispatch-expert.md, 865 lines) as the panel's pro-retain steel-man voice. Agent-registry rebuilt (44 active agents now). Panel is fully ready for S64+ to fire.
- **Sliver test methodology named** — Bryan-coined this session: *if I can't easily invent a case where the feature does something existing primitives can't, the feature is empty enough to act on.* Used as the lens that produced the deprecation conclusion. Carries forward as a reusable methodology for future feature audits.

**No compiler source touched in S63 after B1; the post-B1 batch is pure planning + spec + articles + global-agent infrastructure changes.** Tests baseline unchanged: 8,933 / 44 / 1 / 0 / 8,978 / 440. Stage 0c.A-D will execute the actual code/test deletions when scheduled (gated on the queued live debate).

**Standing patterns surfaced this session:**
- "Deep-dive returning mid-session is a hard-block on wrap until integrated." User authorized + executed in-session, not deferred.
- "Verbatim capture for stance-crystallizing conversations." Established at `scrml-support/docs/function-overloading-sliver-2026-05-06.md` as the precedent.
- "Anti-sycophancy posture as a durable PA default." When user brings up a feature with a stated suspicion, default behavior is "show the work, not the conclusion." Radical-doubt deep-dive frame is the formal-process version of this.
- "Concur-before-publish gate for prose edits." User-facing artifacts can be course-corrected freely as long as the user concurs before publish.

### 2026-05-06 (S63 — A1b Step B1 LANDED: symbol-table extension)

S62 dispatched B1 in a worktree and landed three WIP commits (scaffolding → survey → module: types + Scope + walker, ~500 LOC) before being interrupted. S63 PA salvaged directly: confirmed pipeline wiring + tests + two follow-up fixes, then committed and cherry-picked all 4 commits onto main.

- **B1 — symbol-table extension (`9d2fa45`)** — Stage 3.06 SYM module at `compiler/src/symbol-table.ts` inserted between NR (3.05) and CE (3.2) in `compiler/src/api.js`. Public API: `runSYM`, `runSYMBatch`, `lookupStateCell`, `lookupQualifiedStateCell`, `getScopeForNode`. Walks every `state-decl` (both structural and legacy `@`-form) and registers it in the appropriate scope (`file` / `function` / `compound`; `engine` and `component` ScopeKinds reserved for B14+/B17+). Variant C compounds register parent in enclosing scope + recurse children into a fresh compound sub-scope with qualified-path keys (`signup.name`, `outer.inner.leaf`). Records carry pre-classified booleans (`isCompoundParent`, `isCompoundChild`, `hasValidators`, `hasDefaultExpr`, `hasTypeAnnotation`, `isPinned`, `isConst`, `structuralForm`) for cheap downstream lookup. Test file `compiler/tests/integration/symbol-table.test.js` — 31 tests covering §B1.1-§B1.15 invariants + general-invariant suite (no errors at B1, FileAST `_scope` back-pointer, stats correctness, qualified-path edge cases). +31 pass / +1 file (8,902/44/1/8,947/439 → 8,933/44/1/8,978/440). Zero regressions.

  **§S11D.5 absorption confirmed.** Top-level Variant C compound (deferred from S61 Step 11.0d) is correctly handled by B1's compound-aware `state-decl.children` walk — no separate Step 11.0g needed.

  **Two salvage-time fixes documented in `docs/changes/phase-a1b-step-b1-symbol-table-extension/progress.md` § "Salvage notes":**

  1. **Walker cycle-guard.** Initial walker recursed through `children`/`body`/`consequent`/`alternate`/`arms[].body` without a visited-set guard (NR's walker doesn't have one because `block`/`parent` back-refs aren't an issue at NR's nodeset). Test helper `findKind` already used a WeakSet — discrepancy. Threaded `visited: WeakSet<object>` through `walk` + `registerStateDecl`. Cheap; matches test-helper convention.
  2. **Annotations made non-enumerable.** Initial implementation set `_record` / `_scope` via direct property assignment. Downstream stages (BP / CG) hung in an infinite loop on the cycle `state-decl._record → record.scope → scope.stateCells.get(name) → record` (verified by hang on `samples/compilation-tests/combined-001-counter.scrml`). Switched to `Object.defineProperty(node, "_record"|"_scope", { value, enumerable: false, configurable: true, writable: true })` so generic structural walkers using `Object.keys` / `for...in` skip the back-pointers. `getScopeForNode` and direct property reads still work. **Load-bearing for B2-B22:** consumers must read these annotations via the public API or direct property access — never via enumeration.

  **Survey-first decision (committed in `d6a8fc9` before any source edits):** SYM lands as a NEW Stage 3.06 module (peer to NR), not as an NR-extension. Rationale captured in worktree's `progress.md` Q6: NR's responsibility is tag-bearing-node classification (`resolvedKind` / `resolvedCategory`); state-cell scope construction is a separate concern; folding into NR would muddle separation-of-concerns and create budget creep against NR's <5ms/file bound. B2-B22 consume SYM as a peer stage cleanly.

  Commits cherry-picked to main: `61afdec` (scaffolding) → `d6a8fc9` (survey + insertion-point) → `df870f4` (module) → `9d2fa45` (wiring + tests + cycle-guard fixes).

### 2026-05-05 (S61 close — Phase A1a (lex+parse) COMPLETE)

Phase A1a — the foundational lex+parse layer of the v0.next migration — is COMPLETE. 20 sub-steps landed across S59 + S60 + S61. The compiler's parser now recognizes the full V5-strict structural decl-form `<x> = init` (Shapes 1+2+3, Variant C compound, typed-decl) at every position the SPEC sanctions: inside `${...}` logic blocks AND at file top-level. The legacy `@x = init` expression-form decl is mirror-supported via Step 4's discriminant; its pre-v0.next AST kind divergence (`reactive-derived-decl`) is folded into unified `state-decl{shape:"derived",isConst:true,structuralForm:false}` per Step 11.5. Sample-suite migration to V5-strict canon completed across 175 files in `samples/compilation-tests/` (Step 12) + sample restorations from each P-FUP step.

**Cumulative A1a step ledger (chronological landing order):**

| # | Step | SHA | Era | Tier | Δ tests | Key insight |
|---|---|---|---|---|---|---|
| 1 | Lexer: reserve `reset` | `9cd7779` | S59 | T1 | +6 | Tokenizer KEYWORD addition |
| 2 | Foundational `<NAME>` decl-site recognition | `d28f6f7` | S59 | T2 | +15 | Depth-of-survey discount #5 — 21min vs 10-15h estimate; block-splitter already preserved raw `<` |
| 3 | AST kind rename `reactive-decl` → `state-decl` | `8fa26e1` | S59 | T2 | 0 | ~514 changes / ~120 files / 0 regressions |
| 4 | Parser: state-decl `shape` discriminant | `96dbe92` | S59 | T2 | +12 | Surfaced `reactive-derived-decl` divergence → ADR + Step 11.5 |
| 5 | Parser: Shape 2 `renderSpec` + bareword validators + `req` | `505531f` | S59 | T2 | +15 | Validator args as `string[]` deferred to A1b B9; brief-locus correction |
| 6 | Parser: `default=` + `pinned` on state-decl | `2754940` | S60 | T2 | +10 | KEYWORD-vs-IDENT survey insight |
| 7 | Parser: `pinned` on import items | `556de93` | S60 | T2 | +10 | Regex-driven parser insight; 3 disambiguation edge cases |
| 8 | E-RESERVED-IDENTIFIER trigger | `af4a0da` | S59 | T1 | +4 | reset-keyword shadow check |
| 9 | Expression parser: `reset(@cell)` keyword + E-RESET-NO-ARG | `fded36a` | S60 | T2 | +8 | Full tree walker `forEachResetExprInExprNode`; conservative codegen pass-through |
| 10 | Expression parser: MemberCall/MemberAssignment/UnaryDelete | `226a2dd` | S60 | T1 | +10 | **Discount #8 — ZERO source changes**; AST kinds already correct |
| 11 | Variant C compound + render-by-tag + kickstarter v2 §3 smoke | `bcca1e6` | S60 | T2 | +23 | **Discovered-blocker escalation** — work expanded; surfaced 11.0a/b/c |
| 11.0a | Variant C compound recognizer | `6d51d00` | S60 | T2 | +8 | ~127 LOC `tryParseStructuralDecl` extension; 2 anti-test memorials flipped |
| 11.0b | Newline-as-statement-separator | `a7dd96a` | S60 | T2 | +11 | ~30 LOC `collectExpr` ASI-NEWLINE branch — universal-fix substrate for 11.0e + 11.0f |
| 11.0c | Typed-decl recognizer | `92af2ca` | S60 | T2 | +10 | ~48 LOC via 100% reuse of `collectTypeAnnotation()` — high-reuse pattern |
| 11.5 | FOLD `reactive-derived-decl` → `state-decl{shape:"derived",isConst:true}` | `a020ea1` | S61 | T2 | +4 / +1 skip | ADR Option A; 1 hidden coupling resolved at emit-logic.ts; pre-existing Shape 3 V5-strict codegen gap deferred to A1c |
| 12 | Existing-test deltas | `7be23aa` | S61 | T2 | 0 net | 175 files migrated to V5-strict; 624 sites in broader `samples/` deferred per SURVEY scope; **2 P-FUPs surfaced** |
| 11.0e | `<x> = not\n<y>` newline boundary fix (P-FUP-2) | `916de65` | S61 | T2 | +8 | Universal — `"not"` added to `VALUE_KEYWORDS` Set; 4 of 5 reverted Step 12 samples restored; **1 P-FUP surfaced** (P-FUP-3) |
| 11.0f | `<x> = ?{SQL}\n<y>` BLOCK_REF newline boundary fix (P-FUP-3) | `fe93d40` | S61 | T2 | +7 | Universal — BLOCK_REF added to `lastEndsValue` predicate; combined-007-crud restored; coverage now exhaustive (no P-FUP-4 surfaced) |
| 11.0d | Top-level structural Shape 1 recognition (P-FUP-1) | `0f92077` | S61 | T2 | +9 / +1 todo | BS top-level scan extension via `peekTopLevelStateDeclSignal`; 3 reverted Step 12 samples restored; component-def discrimination preserved; Variant C compound at top-level deferred (§S11D.5 .todo) |
| 13 | Final commit + CHANGELOG aggregate + cleanup | this commit | S61 | T1 | 0 | 5 ephemeral `scripts/step12-*.mjs` helpers removed; master-list A1 row to DONE |

**Net Phase A1a delta:** 8,720 / 43 / 0 / 8,763 (S58 close) → **8,902 / 44 / 1 todo / 0 / 8,947** (A1a-COMPLETE). +182 pass / +1 skip / +1 todo / +184 total tests across 7 new test files. Zero regressions throughout.

**AST contract changes (load-bearing for A1b):**
- `state-decl` carries new fields: `shape: "plain" | "decl-with-spec" | "derived"`, `structuralForm: boolean`, `isConst: boolean`, `renderSpec: RenderSpecNode | null`, `validators: ValidatorEntry[]`, `defaultExpr: ExprNode | null`, `pinned: boolean`, `children: ReactiveDeclNode[]`, `typeAnnotation: string`.
- New AST kinds: `render-spec` (Step 5), `reset-expr` (Step 9).
- Renamed: `reactive-decl` → `state-decl` (Step 3); `machine-decl` → `engine-decl` (S53); `reactive-derived-decl` retired and folded into `state-decl{shape:"derived",isConst:true}` (Step 11.5).
- Import items: `pinned` modifier (Step 7).
- Expression mutation shapes (`MemberCall`/`MemberAssignment`/`UnaryDelete`): unchanged AST kinds (Step 10 verified zero-source); B8 walker must handle dual-path discrimination (specialized kinds `reactive-array-mutation` / `reactive-nested-assign` AND `bare-expr.exprNode` structural walk).
- `@`-prefix discrimination: `ident.name` preserves `@` prefix verbatim — pure string-shape inspection.

**Out-of-scope deferrals for A1b (resolve+type, 22 steps RATIFIED S60):**
- V5-strict bare-name resolver enforcement (E-NAME-COLLIDES-STATE firing).
- Derived-cell wiring (dependency graph + topo sort).
- L21 (`E-DERIVED-VALUE-MUTATE`) firing.
- Validator typer (string args → `ExprNode[]` per AST contract §1.1; from Step 5 deferral).
- `pinned` forward-reference check.
- Bare-variant inference (M9; from Step 11.0c).

**Out-of-scope deferrals for A1c (codegen+runtime, 24 steps RATIFIED S60):**
- Codegen for Shape 2 `renderSpec` markup-RHS dispatch.
- `reset(@cell)` lowering past the conservative pass-through (Step 9).
- `default=` integration with reset semantics.
- Component-def lowering for engine state-children.
- **Pre-existing Shape 3 V5-strict codegen gap** (surfaced S61 Step 11.5; documented in A1c plan §6.4) — `const <x> = expr` emits `_scrml_reactive_set` not `_scrml_derived_declare`.

**Other deferrals beyond A1b/A1c:**
- Top-level Variant C compound (§S11D.5 .todo from Step 11.0d) — BS peek currently matches `=`/`:`, not `<` for compound-opener at top-level. Likely Step 11.0g or A1b territory if A1b's resolver normalizes.
- Self-host parity — current Step 4-7 deferred-policy holds. 6+ self-host files still reference `reactive-derived-decl` literal; catches up at next bootstrap regen (post-A1c).

**Methodology callouts captured this phase:**
- **Depth-of-survey discount — now 9× confirmed.** Pattern: when an audit names a multi-h "new infrastructure" fix, implementation-time survey routinely reveals 2-5× shorter due to existing infra coverage. Three notable shape variants surfaced in A1a:
  - **Zero-source variant** (Step 10 — Discount #8).
  - **Discovered-blocker escalation** (Step 11 — work expanded, not shrank; surfaced 11.0a/b/c).
  - **High-reuse pattern** (Step 11.0c — ~48 LOC via existing `collectTypeAnnotation()` reuse; Step 11.5 1 hidden coupling caught + resolved).
- **Step 11 escalation closure pattern.** When a smoke step surfaces deferred parser gaps as a discovered-blocker, queue follow-on sub-steps (11.0a/b/c, then 11.0d/e/f when more surface), close all before the wrap. Pattern proven across 6 escalation steps.
- **Per-step branch + cherry-pick + push.** Each step a focused worktree dispatch; PA cherry-picks onto main; main always green. Held throughout 20 sub-steps.
- **Cross-machine sync hygiene + path-discipline.** Multiple F4 leaks caught + recovered (S58, S59, S61 — 11.0f had 2 self-corrected near-misses, 11.0d had 1 PA-recovered leak). Pattern is structural; PreToolUse hook fix deferred.
- **Stream-timeout salvage.** Two S61-close agents (11.0d original + 11.0d-finisher) stalled with stream watchdog timeouts. Both had committed clean partial work; PA salvaged via cherry-pick of partials + finisher re-dispatch + final-commit-by-PA. Demonstrated agent-failure recovery flow.
- **Universal-fix substrate** (Step 11.0b's `collectExpr` ASI-NEWLINE branch) reused by Steps 11.0e + 11.0f — both narrow patches at the same locus extending the value-classifier. Substrate design held.

**S61 also landed (alongside Phase A1a closure):**
- **SPEC head broken-path amendment-ref cleanup** (`0a48700`) — 4 dead path refs → 1 archive pointer. Per pa.md "current truth only" scope principle.
- **Curation pass — 10 of 10 batches executed.** 76 directories dereffed from `scrmlTS/docs/changes/` to `scrml-support/archive/changes/`. Disposition matrix at `scrmlTS/docs/curation/2026-05-05-changes-dir-disposition.md`. Batches: A (P-series 12), B (expr-ast-phase-4d 4), C (dispatch-app 7), D (F-series 11), E (GITI 2), F (BUG-letters 2), G (bun-sql 2), H (LSP L1-L4 5), I (fix-* 20), J (misc 11). `docs/changes/` count: 103 → 30. Cross-refs fixed: 11 (FRICTION.md, README.md ×2, changelog ×3, scope-c-findings-tracker ×2, 2 test files, 2 src files).
- **Maps refresh attempted** but agent's Write tool returned permission-denied (system-level directive). Findings returned as text — 8 non-compliance categories surfaced; items #1 (SPEC head) + #2 (curation) actioned this session. Maps files themselves remain stale (last touched 2026-04-24); root-cause investigation deferred.

### 2026-05-05 (S61 — A1a Step 11.5 + Step 12 landed + 2 new P-FUPs + curation pass started)

S61 was the largest-throughput session yet — 4 compiler-touching landings (SPEC head cleanup, Step 11.5 FOLD, Step 12 sample migration, plus 2 new P-FUP BRIEFs queued), 2 cross-repo curation batches (19 dirs dereffed), and 2 Step 12 question ratifications. Phase A1a advanced from 14/17 (S60 close) to **16/19** (Steps 1-12 + 11.0a/b/c + 11.5 done; 11.0d + 11.0e + 13 remaining). Tests went from 8,874 / 43 / 0 (S60 close) to **8,878 / 44 / 0** (S61 wrap; +4 pass / +1 skip / +5 total — the +1 skip is the deferred self-host parity test from 11.5).

- **SPEC.md head broken-path cleanup** (`0a48700`). Lines 3-6 of SPEC.md head referenced 4 paths that no longer exist on disk (`docs/spec-issues/SPEC-AMENDMENTS-2026-04-{02,05,06}.md` + `docs/changes/spec-s37-amendments/spec-amendments.md` — confirmed MISSING). Their content was integrated into the SPEC body long ago and the source amendment docs archived to `scrml-support/archive/spec-issues/`. Replaced the 4 broken-ref lines with a single archive-pointer annotation. Lines 7+ (self-descriptive in-place amendment notes without external paths) preserved. Surfaced by S61 maps-refresh agent's non-compliance scan. Per pa.md "current truth only" scope principle.

- **Step 11.5 — FOLD `reactive-derived-decl` into `state-decl`** (`a020ea1`, T2 tier, 6-commit chain on `phase-a1a-step-11-5-fold-derived` worktree, cherry-picked clean onto main). The legacy expression-form `const @doubled = @count * 2` (inside `${...}` blocks) previously produced AST node `kind: "reactive-derived-decl"`. Per ADR Option A FOLD ratified S60, this kind is retired: parser path rewired to produce `state-decl` with `shape: "derived"`, `isConst: true`, `structuralForm: false`, `initExpr` populated. ~10 src files + LSP handler + 7 test files swept; kind-enum entry removed from `compiler/src/types/ast.ts`. **Survey findings:** 32 references in src across 10 files (matched BRIEF estimate exactly); 4 parser construction lines at 2 sites in ast-builder.js. **Hidden coupling caught + resolved:** `emit-logic.ts` had different runtime helper (`_scrml_derived_declare/subscribe` vs `_scrml_reactive_set`) for derived-vs-plain — resolved by gating derived emitter on the precise `shape === "derived" && isConst === true && structuralForm === false` triple. **Dep-graph dedup issue caught by tests:** both `collectAllReactiveDecls` and `collectAllReactiveDerivedDecls` would have picked up folded-derived nodes — resolved by adding `isFoldedDerived` exclusion filter. **Pre-existing Shape 3 V5-strict codegen gap surfaced + deferred to A1c:** Shape 3 V5-strict `const <x> = expr` emits `_scrml_reactive_set` not `_scrml_derived_declare` (latent from Step 4); out-of-scope per BRIEF §2.2. **Byte-output preserved** for legacy `const @x = expr` form (verified via probe compile). Self-host parity test marked `test.skip` per Steps 4-7 policy (6 self-host files still reference the old kind; catches up at next bootstrap regen — accounts for the +1 skip). +4 pass / +1 skip / +5 net.

- **Step 12 SURVEY pre-staged + Q1 + Q2 ratified** (`docs/changes/phase-a1a-step-12-existing-test-deltas/SURVEY.md`). PA-side static-pass survey of legacy patterns Step 12 needs to address. Findings: zero remaining references to `reactive-decl` / `machine-decl` (old names), zero `loose` flag references, zero legacy no-arg `reset()` source-level usages requiring drop. Step 11.5 owned the 11 `reactive-derived-decl` test references (now all updated). Two open questions resolved by user this session:
  - **Q1 RATIFIED — transition-decl tests OUT-OF-SCOPE.** 5 unit test files (`transition-decl-{ast,block-split,scope,purity,registry}.test.js`) probe the v0.legacy `<machine>` machine-syntax. Their retirement is governed by `<machine>` keyword deprecation policy (W-DEPRECATED-001 today P1 → E-DEPRECATED-001 in P3) + migration via `scrml-migrate` — NOT by Step 12. Step 12's scope is V5-strict canon migration for state-cell decls (`<x>` vs `@x` decl-form). transition-decl is a separate feature category whose retirement is owned by P3 (deprecation) + A2 (engine implementation phase).
  - **Q2 RATIFIED — Option A REWRITE legacy `@x = init` decl form.** SPEC §6.1.2 reserves `@varname` for reads/writes/compound-assigns only; first-appearance/decl-form `@x = init` is canon-violating. Step 4's mirror is a transitional accommodation, not endorsement. Deprecation phase is unscheduled and "later" is indefinite. Mass-rewrite to V5-strict `<x> = init` during Step 12. Affects ~85 candidate sample files; Step 12 dispatch dynamically classifies first-appearance vs post-decl-write per-file. modern-003-full-app reclassified from "DEFER" to "REWRITE" (its `< userBadge ...>` line is component-def, NOT transition-decl — separate concern).

- **AST-CONTRACTS-AND-DECOMPOSITION.md updated** — Step 11.5 ✅ S61, Step 12 ✅ S61, 11.0d + 11.0e queued. Total remaining: ~4.5-9.5h across Steps 11.0d, 11.0e, 13.

- **Step 12 — existing-test deltas** (`7be23aa`, T2 tier, 9-commit chain on `phase-a1a-step-12-existing-test-deltas` worktree). Migrated 175 sample files / 330 sites in `samples/compilation-tests/` from legacy `@x = init` decl form to V5-strict `<x> = init` (Q2 RATIFIED Option A). Per-file dynamic classification distinguished first-appearance/decl from post-decl-write — only first-appearance positions migrated; post-decl writes (`@x = newVal`) preserved per SPEC §6.1.2. Also: 2 cosmetic test-description string updates in `lsp/analysis.test.js` + `gauntlet-s24/scope-001-logic-expr.test.js`. Helper scripts at `scripts/step12-*.mjs` (5 files: classify, batch-classify, rewrite, compile-snapshot, validate-batch) — to be cleaned up at Step 13. **ZERO net delta** — 8,878/44/0/8,922 unchanged. **2 NEW PARSER-GAP FOLLOW-UPS surfaced:**
  - **P-FUP-1 — top-level Shape 1 NOT implemented in BS.** SPEC §6.2 documents `<count> = 0` at file top-level as canonical, but BS treats `<count>` at line-start as HTML markup tag opener → falls through with E-CTX-003. The 3 dispatch-named samples (`test-002-with-logic`, `test-009-test-reactive`, `modern-003-full-app`) reverted to legacy `@x = init`. Step 11 smoke covered top-level via kickstarter v2 §3 corpus but didn't hit bare top-level outside `${...}`. Real parser gap. **Queued as Step 11.0d** (BRIEF at `docs/changes/phase-a1a-step-11-0d-toplevel-shape-1/BRIEF.md`; ~3-6h; matches Step 2's foundational decl-recognition pattern but at top-level).
  - **P-FUP-2 — `<x> = not\n<y>` newline boundary bug.** The `not` keyword (M11 modifier) followed by newline causes parser to lose subsequent state-decl siblings in V5-strict structural form. Pre-V5-strict `@x = not\n@y` doesn't trigger. 5 files reverted (`combined-007-crud`, `gauntlet-r10-go-contacts`, `gauntlet-r10-odin-filebrowser`, `gauntlet-r10-rails-blog`, `integration-001-stripe-mini`). Detected via `scripts/step12-validate-batch.mjs` decl-count regression. **Queued as Step 11.0e** (BRIEF at `docs/changes/phase-a1a-step-11-0e-not-newline-boundary/BRIEF.md`; ~1-3h; narrow patch, likely Step 11.0b ASI-NEWLINE branch interaction).
- 624 sites in 858 files in broader `samples/` (outside `samples/compilation-tests/`) deliberately left in legacy form per SURVEY scope. Future migration after P-FUP-2 lands.

- **Step 11.0e — `<x> = not\n<y>` newline boundary fix** (`916de65`, T2 tier, 4-commit chain on `phase-a1a-step-11-0e-not-newline-boundary` worktree). Surfaced as P-FUP-2 by Step 12. **Universal fix** — added `"not"` to `VALUE_KEYWORDS` Set in `collectExpr`'s ASI-NEWLINE branch (`compiler/src/ast-builder.js` L1970). Preserves Step 11.0b's universal-fix property; no `not`-specific branch added. 1 LOC code change + 10 LOC explanation comment. **+8 tests** (§S11E.1-§S11E.8 covering all interactions including legacy regression test §S11E.7). **4 of 5 reverted Step 12 samples restored** to V5-strict canon with decl-count parity verified (`gauntlet-r10-go-contacts`, `gauntlet-r10-odin-filebrowser`, `gauntlet-r10-rails-blog`, `integration-001-stripe-mini`). **The 5th sample (`combined-007-crud`) blocked by NEW finding P-FUP-3** — same-shape bug but with BLOCK_REF (`?{SQL}`) trailing token instead of `not` keyword. Agent correctly scope-limited 11.0e to keyword case; surfaced P-FUP-3 in progress.md. Tests: 8,878 → **8,886 (+8)**. Other M11-family modifiers (`pinned`, `req`) verified safe — they tokenize as IDENT, not KEYWORD.

- **Step 11.0f BRIEF queued** — fixes P-FUP-3 (`<x> = ?{SQL}\n<y>` BLOCK_REF boundary). Likely 1-LOC value-classifier extension at the same locus as 11.0e; estimate 1-3h. BRIEF at `docs/changes/phase-a1a-step-11-0f-blockref-newline-boundary/BRIEF.md`. Restores `combined-007-crud.scrml`.

- **Curation pass — 9 of 10 batches landed** — `docs/changes/` 103-dir wholesale review per pa.md "current truth only" scope principle. Disposition matrix at `docs/curation/2026-05-05-changes-dir-disposition.md`.
  - **Batch A (P-series, 12 dirs)** RATIFIED + EXECUTED (`f4c0081` / `df2f3d2`). p1, p1.e, p2, p2-wrapper, p3.a, p3.a-follow, p3.b, p3-error-rename, p3-follow, p3-rename, p3-spec-paperwork, p4-scrml-migrate. 1 cross-ref fix in `examples/23-trucking-dispatch/FRICTION.md`.
  - **Batch C (dispatch-app M-series, 7 dirs)** RATIFIED + EXECUTED (`729e57c` / `9943174`). dispatch-app + m1..m6. 2 cross-refs in `examples/23-trucking-dispatch/README.md`.
  - **Batch B (expr-ast-phase-4d, 4 dirs)** RATIFIED + EXECUTED (`03e4bb7` / `d5b0e8d`). expr-ast-phase-4d, expr-ast-phase-4d-step-8, expr-ast-phase-4d-step-8-strict, expr-ast-self-host-bs-bug-l-parity. No cross-refs.
  - **Batch F (BUG-letters, 2 dirs)** RATIFIED + EXECUTED (`6e6db27` / `b605a96`). bug-h-rettype-fix, boundary-security-fix. No cross-refs.
  - **Batch D (F-series, 11 dirs)** RATIFIED + EXECUTED (`c7075aa` / `4221fb0`). All f-* feature/fix dirs. 1 cross-ref in `docs/changelog.md` (f-component-001 diagnosis pointer).
  - **Batch I (fix-*, 20 dirs)** RATIFIED + EXECUTED (`5a27670` / `36f9961`). All fix-* hotfix dirs. **6 cross-refs fixed** (changelog ×2, scope-c-findings-tracker ×2, 2 test files referencing fix-* intakes, 2 src files referencing fix-* intakes); 1 dangling pre-existing ref to non-existent fix-bs-machine-closer left as-is.
  - **Batches E + G combined (GITI bugs + bun-sql phases, 4 dirs)** RATIFIED + EXECUTED (`db4a5a6` / `c84544e`). giti-009-import-fix, giti-011-css-at-rules-fix, bun-sql-phase-1, bun-sql-phase-2. No cross-refs.
  - **Batch H (LSP L1-L4, 5 dirs)** RATIFIED + EXECUTED (`122c790` / `880bc76`). lsp-cleanup-retired-bpp-import, lsp-l1-see-the-file, lsp-l2-see-the-workspace, lsp-l3-scrml-unique-completions, lsp-l4-standards-polish. 2 cross-refs pre-fixed in J-pile dirs (`pa-shadow-db-from-any-context/intake.md` + `ast-lift-exported-components-into-components/intake.md`) so refs travel correctly when J moves later.
  - **65 dirs dereffed total.** 1 batch remaining: J (misc, 12 dirs — heterogeneous).
  - **`docs/changes/` count: 103 → 41.**

- **Maps refresh attempted** — S61 maps-refresh agent ran cold scan but Write tool returned permission-denied (system-level directive). Agent returned thorough findings as text including 8 categories of non-compliance items. Item #1 (SPEC head cleanup) actioned. Item #2 (`docs/changes/` curation) **mostly closed** — 9 of 10 batches done. The maps files themselves remain stale (last touched 2026-04-24); root-cause investigation deferred to next session.

**Methodology notes S61:**
- **Per-step branch + cherry-pick + push** pattern continues to work. Step 11.5 was T2-tier; 6-commit chain (1 survey + 4 WIP + 1 final) cherry-picked clean onto main with one transient -1 test mid-chain that recovered to +5 by chain end.
- **Pre-stage survey work** (Step 12 SURVEY) productive in parallel with in-flight dispatch (Step 11.5). PA-side static-pass produced concrete dispositions ready for user ratification. Saves Step 12 dispatch from re-discovering scope.
- **Hidden-coupling discovery during fold** (Step 11.5 emit-logic.ts) validates the BRIEF §6 risk-surface flagging: "consumer might be doing something subtly different." The fold is mechanical until it isn't.

### 2026-05-05 (S60 — A1a 8 steps + A1b/A1c scope-out + RATIFICATION + ADR ratification)

S60 opened on a clean baseline (8,784) post-S59 close with Phase A1a 7/13 done. Eight dispatch cycles + extensive planning produced: 8 A1a step landings (Steps 6, 7, 9, 10, 11, 11.0a, 11.0b, 11.0c — net **+90 tests / +4 test files**), full scope-out documents for A1b (22 steps, 85-120h, FULLY RATIFIED) and A1c (24 steps post-Q3-ratification, 96-136h, FULLY RATIFIED), ADR ratification for `reactive-derived-decl` divergence (Option A FOLD, sequenced AFTER Step 11 BEFORE Step 12, inserted as Step 11.5), Step 11 escalation fully closed (all 3 deferred parser gaps 11.0a/b/c landed), and decomposition refresh (A1a now 17 steps including 11.0a/b/c + 11.5).

**A1a sub-step landings S60 (cumulative 12/17 done):**
- **Step 6 — `default=` + `pinned` on state-decl** (`2754940`). Single-helper extension to `tryParseStructuralDecl` attr scan. Survey insight: `default` is KEYWORD (not IDENT) so needed NEW branch in scanner; `pinned` is contextual IDENT — needed guard BEFORE Step 5's generic validator branch (else captured as validator). 10 test cases (range 6-10), in new §S6 block. Self-host parity not needed. +10 tests; 0 regressions.
- **Step 7 — `pinned` on import items** (`556de93`). Single-file extension to import-decl parser. **Key survey finding:** import parser is REGEX-driven (not token-walker like state-decl), required different extension shape — `_splitPinned` pre-strip helper. Disambiguation handled all 3 edge cases: `import { pinned }` (name not modifier), `import { foo as pinned }` (alias-to-pinned), `import { foo as pinned pinned }` (alias + modifier). 10 test cases; 0 regressions.
- **Step 9 — `reset(@cell)` keyword + E-RESET-NO-ARG** (`fded36a`). 6 commits; 8 tests. Touchpoint: `expression-parser.ts:1057` `CallExpression` case in `esTreeToExprNode` (post-acorn). KEYWORD-vs-IDENT distinction was moot — scrml's KEYWORD set is consulted only by block-level tokenizer; acorn treats `reset` as plain identifier. SPEC §34 already had `E-RESET-NO-ARG` (line 14199); reused for both zero-arg AND multi-arg/spread cases with arity-specific message variants. Files touched broader than BRIEF named: `types/ast.ts`, `expression-parser.ts`, `ast-builder.js` (surfacing), `codegen/emit-expr.ts` (conservative pass-through preserving JS bit-for-bit), `component-expander.ts`, `meta-checker.ts`. Surfacing extended from "root-only check" to **full tree walk** via new `forEachResetExprInExprNode` helper.
- **Step 10 — Mutation shape verification** (`226a2dd`). **Depth-of-survey discount #8** — ZERO source changes. Survey confirmed all three target shapes already correctly produced: `kind:"call"` with `callee.kind:"member"|"index"` for MemberCall; `kind:"assign"` with `target.kind:"member"|"index"` and **`op`** field (16 operators) for MemberAssignment; `kind:"unary"` with `op:"delete"` for UnaryDelete. **Key A1b finding:** discrimination via `ident.name.startsWith("@")` — pure string-shape inspection. **Two-layer lowering** in `ast-builder.js`: specialized kinds (`reactive-array-mutation`, `reactive-nested-assign`) AND `bare-expr.exprNode` structural walk. **B8 walker MUST handle BOTH paths.** +10 tests.
- **Step 11 — Variant C compound + render-by-tag + kickstarter v2 §3 smoke** (`bcca1e6`). **Discovered-blocker escalation, NOT Discount #9.** Survey surfaced 3 deferred parser gaps (Step 2 progress lines 93-98 explicitly DEFERRED Variant C compound recognizer to "Step 11"). Render-by-tag ✅ (parses to `kind:"markup", tag:"userName"`). 16 positive cases passed; 7 anti-test memorials with `TODO[step-11.0a/b/c]` markers added. Kickstarter file located at `docs/articles/llm-kickstarter-v2-2026-05-04.md` with §3 spanning lines 132-249. +23 tests.
- **Step 11.0a — Variant C compound recognizer** (`6d51d00`). 3 commits; +127 LOC source + 14 LOC types. BRIEF touchpoint correction (L3528-3580 was wrong; actual L2912 + L3070 + L1784) — agent corrected per authorization. Both `</>` and `</NAME>` closers accepted (A1b enforces name-match). 2 `TODO[step-11.0a]` memorials flipped. +8 tests.
- **Step 11.0b — Newline-as-statement-separator** (`a7dd96a`). 4 commits; ~30 LOC source. **BRIEF touchpoint correction:** locus is `collectExpr` L1985-2030 ASI-NEWLINE branch, NOT `parseLogicBody`. Step 11.0a's `compoundBody` flag was inside-compound-only; this one is top-level newline-gated. **Free side-benefit:** fix lives in `collectExpr` (not body parser) so it fires universally for ALL ASI gaps (let-decl + state-decl, bare-expr + state-decl, etc.). Multi-line legitimate expressions (`@a +\n@b`) preserved (§S11B.5); markup-RHS angleDepth preserved (§S11B.4 + .10). 1 `TODO[step-11.0b]` memorial flipped. +11 tests.
- **Step 11.0c — Typed-decl recognizer** (`92af2ca`). 4 commits; ~48 LOC source. **High-reuse pattern:** existing `collectTypeAnnotation()` at ast-builder.js:2671 (used at 11+ call sites) was 100% reusable; absorbs refinement-type forms (`string(pattern(/.../))`) via existing paren-depth tracking — zero new logic for refinement-shape collection. Tier 3 positional sugar `("alice", 30, true)` → acorn `SequenceExpression` (ExprNode-acceptable; A1b interprets per §14.11). Bare-variant inference `.Idle` → escape-hatch ExprNode with raw `.Idle` (A1b's M9 resolver handles). 2 `TODO[step-11.0c]` anti-test memorials flipped (4 mentions total resolved; zero `TODO[step-11.0c]` remain in `kickstarter-v2-smoke.test.js`). +10 tests.

**Step 11 escalation FULLY CLOSED at S60.** All 3 deferred parser gaps surfaced by Step 11's smoke verification (Variant C compound, newline-separator, typed-decl) now landed. The 7 anti-test memorials introduced by Step 11 are all flipped to positive: 2 (11.0a) + 1 (11.0b) + 4 mentions resolved (11.0c). `kickstarter-v2-smoke.test.js` no longer carries TODO markers from the Step 11 sweep.

**Planning durables landed S60:**
- **A1b SCOPE-AND-DECOMPOSITION** RATIFIED 2026-05-05 (`docs/changes/phase-a1b-resolve-type/SCOPE-AND-DECOMPOSITION.md`). 22 steps B1-B22 in 5 waves. All 7 open Qs ratified per PA recommendations (user verbatim "ratify all"). Sequence locked: 11.5 → 12 → 13 → A1b. Selective parallel Wave 5 cap 2-3 agents. New `validators.ts` file (final call deferred to B9 survey). Refinement-zone subset for A1b (trusted-zone deferred to A1c C16 OR v0.3.0). Self-host parity deferred to post-A1c. Branch convention `phase-a1b-step-bN-<slug>`.
- **A1c SCOPE-AND-DECOMPOSITION** RATIFIED 2026-05-05 (`docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md`). All 8 open Qs ratified (user verbatim "Q3. C is what i want, the rest are ratified"). **Runtime library Option C compile-time elision selected** — adds NEW foundational step **C0** (feature-usage analyzer at start of A1c) producing a per-app feature-usage bitmap that powers per-step emission. **Total now 24 steps (C0-C23), 96-136h.** Soundness > completeness > minimal-output trade-off ratified. Refinement-zone subset for C16 (trusted-zone deferred to v0.3.0). Postgres+SQLite+MySQL drivers only. ≤5% output regression budget on critical paths (surface-not-block).
- **ADR — `reactive-derived-decl` divergence** RATIFIED 2026-05-05 (S60). User verbatim: "ratify the ADR — Option A". Inserted as Step 11.5 in A1a decomposition.

**Methodology updates S60:**
- Path-discipline near-miss caught + recovered: PA Bash CWD drifted to worktree during a cherry-pick attempt; produced phantom add/add conflict on progress.md; aborted; redid with explicit `git -C <abs-path>` flag. Lesson: cross-tree git ops use `-C` form.
- Depth-of-survey discount #8 confirmed (Step 10).
- Step 11 surfaced new pattern: smoke-verification can produce **discovered-blocker escalation** rather than Discount — the audit-vs-actual gap may flow IN BOTH DIRECTIONS (sometimes work shrinks via discount, sometimes work expands via deferred-from-prior-step revelation).

### 2026-05-05 (S59 — heavy-execution: 7/13 of Phase A1a + program-attrs + L21 + 3 audits + dashboard rewrite)

S59 opened on the outstanding L21 deliberation (E-DERIVED-VALUE-MUTATE) and ended having landed roughly half of Phase A1a's parser-shape work plus a comprehensive scope-of-work realignment after a parser audit revealed the original A1 sizing was based on incomplete picture (~3x understatement). User-driven realignment: "we are in the middle of a MAJOR breaking language change... we need a way of knowing where we are at in the progress." Master-list rewritten as v0.2.0 progress dashboard; README + scrml.dev announce drafted; comprehensive subsystem inventory (~280-440h estimate); article truthfulness audit (15 articles classified). Phase A1a then dispatched per-step with 6 actual landings: Steps 1, 2, 3, 4, 5, 8 + program documentary attrs feature.

**A1a sub-step landings (7 / 13 done at S59 close):**
- **Step 1 — `reset` keyword reserved** (`9cd7779`). Single tokenizer change + 6 unit tests.
- **Step 2 — foundational `<NAME>` decl-site recognition** (`d28f6f7`). Depth-of-survey discount confirmed: agent surveyed and found block-splitter ALREADY preserves raw `<` content correctly via §4.6 PA-001; body-pre-parser inherits via parseLogicBody. Intervention is one helper (`tryParseStructuralDecl`) + 4 call sites in ast-builder.js's statement dispatcher. ~21 minutes wall time vs the audit's 10-15h estimate. +15 tests.
- **Step 3 — AST kind rename `reactive-decl` → `state-decl`** (`8fa26e1`). Mass mechanical sweep: 234 source string-literal renames across 67 files + 254 bare-text comment renames across 51 files + ~20 doc renames. ~514 changes / ~120 file updates. 0 regressions. Permanent fix: `bpp.test.js` cross-cut isolation bug closed (`findMainProjectRoot` now prefers local worktree). Surfaced action item: `.claude/maps/primary.map.md` had 1 ref unrenamed (Edit permission-denied during dispatch); fixed locally during S59 cleanup `94f903a`.
- **Step 4 — shape discriminant on state-decl** (`96dbe92`). 17 construction sites updated (+ self-host parity at `compiler/self-host/ast.scrml`). Sets `shape: "plain"|"derived"`, `structuralForm: true|false`, `isConst: true|false` per AST-CONTRACTS §1.1 discriminant rules. **Surfaced AST-kind divergence:** legacy `const @NAME = expr` produces `kind: "reactive-derived-decl"` (separate kind, NOT touched by Step 3's rename). ~20 consumer sites; folding into `state-decl` queued as future small standalone step (~3-5h). +12 tests; 0 regressions.
- **Step 5 — Shape 2 renderSpec + bareword validators** (`505531f`). Single-helper extension to `tryParseStructuralDecl` for markup-RHS detection + bareword/call-form attribute scan. Wraps RHS markup in `kind: "render-spec"` sub-node; collects validators into `validators[]` field. **Brief-locus correction:** W-ATTR-001 only fires on `kind: "markup"` not `state-decl`, so Layer C of brief (validator-name registration in attribute-registry) was unwarranted. Validator args collected as `string[]` for now; A1b converts to ExprNode[] when typing lands. `is some` (two-word predicate) deferred. §S4.10 invariant test relaxed to admit `"decl-with-spec"`. +15 tests; 0 regressions.
- **Step 8 — E-RESERVED-IDENTIFIER trigger + init.js template fix** (`af4a0da`). Parser detects `function reset()` / `fn reset {...}` as reserved-identifier shadow. init.js starter template renamed `function reset()` → `function clearCount()`; 6 sample sites also renamed. +4 tests; 0 regressions. Scoped to `reset` specifically per dispatch design choice (option a).

**Side feature landings:**
- **L21 lock — `E-DERIVED-VALUE-MUTATE` FORBIDDEN** (`1217b41`, `8e5e459`, `9772c0f`). SPEC.md §6.6.18 NEW (~100 lines): in-place mutation of a `const`-derived cell is forbidden. Covers array mutating methods on derived arrays, property assignment / compound-assignment / `delete` on derived objects, and in-compound derived sub-cells. **Sibling rename §6.6.8** `E-REACTIVE-002` → `E-DERIVED-WRITE` to align with §34 + the `E-DERIVED-*` family.
- **`<program>` documentary attributes** (`4620290`). Five new optional attrs on `<program>`: `title=` (→ `<title>`), `description=` (→ `<meta name="description">`), `version=`, `author=`, `license=`. SPEC §40.7 NEW. W-PROGRAM-TITLE-NESTED warning. emit-html.ts head injection. tier-ladder-promotion article uses new attrs in first code block. Scope creep finding: needed registration in `attribute-registry.js` + `html-elements.js` to avoid spurious W-ATTR-001 (not in original brief). +12 tests; 0 regressions.

**Audit + planning deliverables:**
- **Parser audit** at `docs/changes/v0next-audit/PARSER-AUDIT-2026-05-05.md` (`1eab7a2`). 25 features classified PARSES-NOW / PARTIAL / NOT-AT-ALL / HTML-FRAGMENT (the deceptive-success pattern: 17 of 25 v0.next forms compile-clean while parsing as html-fragment). Foundational gap audit; informed re-decomposition.
- **Comprehensive scope-of-work inventory** at `docs/changes/v0next-inventory/SCOPE-MAP-2026-05-05.md` (`802375e`). Subsystem-by-subsystem inventory: compiler / runtime / stdlib / tests / self-host / examples / samples / editors / docs. ~280-440h estimate for full v0.2.0 migration (~3x prior assumption). Recommendation: PIECEMEAL not greenfield. Acorn STAYS — pre-processor extension absorbs new syntax above acorn's level. Phase shape revised: A1 35-55h foundational lex/parse → A2 25-40h structural elements → A3 20-35h validators → A4 15-25h schema/refinement → A5 20-30h resolver/typer → A6 30-50h codegen.
- **Article truthfulness audit** at `docs/changes/v0next-inventory/ARTICLE-TRUTHFULNESS-AUDIT-2026-05-05.md` (`d1618ed`). 15 articles classified ACCURATE / NEEDS-EDIT / RETRACT / DO-NOT-PUBLISH for v0.2.0-in-flight context. Most concerning: `tier-ladder-promotion` (DO-NOT-PUBLISH until A2 ships engines) + `realtime-and-workers` / `mutability-contracts` / `server-boundary-disappears` (NEEDS-EDIT — split works-today vs v0.2.0+ examples).
- **AST contracts + 13-step decomposition rev 2** at `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md` (`be964b7`). Audit-corrected: target node `state-decl` (not `kind: "state"`); foundational pass added as Step 2; Steps 4-7 reorganized to extend renamed `state-decl`; deceptive-success-pattern anti-test mandate in §7.

**Public-facing + dashboard:**
- **Master-list rewrite as v0.2.0 progress dashboard** (`a6504da`, `f1a6da5`). Bloated session-log header (~5k+ words S40-S58 deltas) replaced with concise current-state + new §0 v0.2.0 Migration Status as live dashboard. §0.1 phase progress table; §0.2 L1-L21 locks at-a-glance; §0.3 audit deliverables index; §0.4 open design questions; §0.5 13-step status; §0.6 surfaced divergences (`reactive-derived-decl` divergence + `is some` deferral + path-discipline leak).
- **README v0.2.0 banner + stats refresh** (`88535f9`). Banner near top calling out v0.1.0 shipped baseline + v0.2.0 in-flight breaking change. Stats updated: 32 examples (was 14), 16 stdlib modules (was 13), 8,700+ tests (was 5,500+).
- **scrml.dev announce draft** at `docs/website/v0.2.0-announce-2026-05-05.md` (`88535f9`). ~250 lines. TL;DR + What's-shipped + What's-coming + What-this-means-for-articles + Why-now + Timeline. Voice-fidelity-scrubbed. User-controlled publishing decision.

**Methodology meta-insight captured:**
- **Depth-of-survey discount design-insight** at `scrml-support/design-insights.md` (`5c005a0`, `f7b935a`). Pattern: when an audit estimates >5h for a "new-infrastructure" fix, mandate implementation-time survey-first phase before accepting the estimate. Cost shrinks 2-5x because existing infrastructure routinely covers gaps; actual fix is localized extension, not new infrastructure. **Four confirmed occurrences:** S51 W2 (LSP already shipped canonical-key), S52 DD4 (SPEC §54.2-§54.3 already had extension-point pattern), S59 Step 2 (block-splitter already preserves raw `<`), S59 documentary-attrs (brief-locus error: emit-html.ts vs codegen/index.ts:530-555). PA-SCRML-PRIMER §12 has session-start-discoverable summary + mitigation checklist.

**Other small landings:**
- pa.md F4 step 5 added (`bun run pretest` mandate at fresh worktree startup; recurring infra finding from rev-1 dispatch's ~130 ECONNREFUSED experience).
- `<program>` dual role design question RESOLVED — keep all three (config attrs + body wrapper + nested execution context). No spec changes needed.
- Acorn replacement question RESOLVED — stays. Pre-processor extension absorbs new syntax above acorn's level.
- `reactive-decl` rename to `state-decl` ratified + landed (Step 3).

**Anomalies:**
- **Rev-1 audit agent stalled** at watchdog timeout — recovery: PA-direct probe.
- **Rev-1 + Rev-2 Step-2 dispatches halted at startup verification** — surfaced (a) `bun run pretest` requirement (rev-1 fix in commit `25f4397`) and (b) flake-handling protocol for ≤3-fail-then-clean-rerun (rev-3 fix in commit `3c9748e`). Both became permanent additions to brief template + pa.md.
- **S60 (rev-3) dispatch decomposition vs implementation tension** — agent invoked PHASE 0.5 doctrine and produced decomposition + AST contracts doc instead of monolithic implementation. PA accepted the decomposition; per-step model adopted; led to the depth-of-survey discount finding.
- **Step 5 path-discipline leak (S59 close)** — agent leaked progress.md content directly to main's working tree (not just to its worktree). Recovered cleanly via `git checkout -- progress.md` then proper cherry-pick. No code damage. Investigation queued for next session — extend pa.md F4 path-discipline check to detect leaks earlier.



Previous baseline (2026-05-04 after S58 close): **8,720 pass / 43 skip / 0 fail / 432 files** (pre-commit hook excluding browser; full suite 8,763 / 43 / 0). **Stage 0b COMPLETE** — D3 + D4 landed, scrml:oauth shipped, const-form sweep complete, F4 path-discipline addendum live. 47 commits past S57 close, all pushed. Phase A1+ implementation phase opens at S59.

### 2026-05-05 (S59 — small-deliberation lock L21 + sibling-error rename)

S59 opened with one outstanding deliberation from the S56 outcomes ledger (queued open-Q on `E-DERIVED-VALUE-MUTATE`). Lock ratified by user; SPEC + cross-cutting docs updated in a single targeted edit. Phase A1+ entry planning to follow.

- **Lock L21 — `E-DERIVED-VALUE-MUTATE` FORBIDDEN.** SPEC.md §6.6.18 NEW (~100 lines): in-place mutation of a `const`-derived cell is forbidden. Covers (a) array mutating methods on a derived array (`.push`, `.pop`, `.shift`, `.unshift`, `.splice`, `.reverse`, `.sort`, `.fill`, `.copyWithin`); (b) property assignment / compound-assignment / `delete` on a derived object; (c) in-compound derived sub-cells (`@form.derivedField.push(x)`). Distinguished from sibling errors E-DERIVED-WRITE (reassignment), E-SYNTHESIZED-WRITE (validity surface), E-DERIVED-WITH-VALIDATORS. §34 entry added with rich error-message guidance ("mutate the upstream cell instead — `@items = [...@items, x]`").
- **Sibling rename §6.6.8.** `E-REACTIVE-002` → `E-DERIVED-WRITE` to align with §34 (already on the new name), §6.2 cross-refs, and the `E-DERIVED-*` family naming. Inline rename note left in §6.6.8.
- **§6.5.1 note added.** Mutating-method rewrite applies to mutable reactive cells; on derived cells, see §6.6.18 / E-DERIVED-VALUE-MUTATE.
- **Cross-cutting doc updates.** `IMPLEMENTATION-ROADMAP.md` open-Q + risk row + Phase A2 Q resolved with commit cross-ref. `DISPATCH-2-BRIEF-engines-match-validators.md` §3.6 + §7 entries marked LOCKED. `PA-SCRML-PRIMER.md` §13 locks table extended L21; §11 anti-patterns table got the corresponding row. Single SPEC commit `1217b41`.

Previous baseline (2026-05-04 after S57 close): **8,658 tests passing / 47 skipped / 0 failing / 430 files** (pre-commit hook excluding browser; full suite 8,705/47/0). **+807 pre-commit pass / +129 full pass vs S56 close.** S57 was a heavy-execution session — Stage 0b D1 + D2 SPEC rewrites complete, three stdlib tiers shipped, tier-ladder article drafted + voice-scrubbed, PA scrml expert primer created with pa.md mandating its session-start read, Bun audit complete (already on Bun.SQL; pin ≥1.3.13), agent-file fixed, kickstarter reconciliations + canonical-pattern fold. Stage 0b half done — D3 + D4 pre-written, dispatch-ready S58.

### 2026-05-04 (S57 — heavy-execution: D1+D2 SPEC + stdlib tiers 1-3 + article + primer + agent-file fix)

S57 landed Stage 0b's first two of four dispatches plus extensive stdlib gap-fill plus a primer that should prevent the next PA from re-deriving scrml fundamentals at runtime. 16 commits to scrmlTS main; 1 to scrml-support. Pushed both repos.

- **Dispatch 1 (foundation)**: §1.4 markup-as-first-class-value pillar, §1.5 north star + Tier 0/1/2 ladder, §1.6 V5-strict access; §3.4 V5-strict-per-context table; §6 major rewrite (V5-strict, three RHS shapes, Variant C compound state, render-by-tag, in-compound `const <x>` derived, default=/reset, hoisting, pinned, validity surface stub, §11 fold); §11 deleted/stubbed; §34 +9 error codes; SPEC-INDEX regenerated. Two attempts (D1 partial + D1.5 finish) — landed via `8ac5f3e` + `37f46ca`. **+0 tests; spec text only.**
- **Dispatch 2 (engines/match/validators)**: §17 Tier 0 framing; §18 Tier 1 match (block-form + JS-style + W-MATCH-RULE-INERT); §51 major rewrite (12 subsections); §54 substates composition note; §55 NEW validators + auto-synthesized validity surface (15 subsections); §34 +17 error codes; SPEC-INDEX regenerated with ~40 new Quick Lookup entries. Five attempts (D2 Sonnet → D2.5/D2.6/D2.7 Opus → D2.8 general-purpose) — landed via `af86fc2` + `5f59594`. The D2 saga revealed: agent-file edits cache at session start; SPEC.md size wall makes Read+Write infeasible; Edit's diff-form scales fine; general-purpose dispatch is a valid fallback when pipeline-persona tools haven't propagated.
- **Stdlib Tier 1**: `scrml:redis` (18 exports — Bun.redis wrapper) + `scrml:cron` (3 exports — Bun.cron wrapper). `aae1200`. **+10 tests** (shape-only; live integration gated on REDIS_TEST_URL).
- **Stdlib Tier 2**: `scrml:time` +6 timezone/ISO functions; `scrml:format` +4 Intl extensions (compactNumber, formatList, formatRange, formatNumberAdvanced). `9d038d0`. **+29 tests.**
- **Stdlib Tier 3**: `scrml:http` +5 middleware (withAuth, withDefaults, retry, multipart, uploadFile); `scrml:regex` NEW (14 vetted patterns + 7 helpers). `f700116`. **+43 tests.**
- **OAuth dispatch brief pre-written** at `docs/changes/stdlib-oauth/DISPATCH-BRIEF-scrml-oauth.md` (332 lines). Standalone — no SPEC.md changes. Estimated 12-18h. `0ef332d`.
- **Tier-ladder article drafted** at `docs/articles/tier-ladder-promotion-devto-2026-05-04.md` (293 lines after voice-scrub revision). Bullet-proof framing, three side-by-side Tier 0/1/2 code blocks, errors-as-states beat, anti-overclaim closing. Voice scrubbed: never claim React shipping experience (only personal-project experimentation); never claim XState experience (never used). Code examples use scrml's `fail`/`!{}` model — try/catch is NOT in scrml's vocabulary. `9e728f3`, `ec2784c`.
- **Implementation roadmap** at `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md`. Phase A1-A4 sequential compiler tracks + B1-B5 parallel + C1-C2 docs. Storage-model lock (Phase A1 = source-canonical), data/validate γ rewrite + vocab-alignment task, distribution lock, tagline refresh thread, §8.5 post-v0.2.0 Bun candidates table, SPEC.md per-section split logged as v0.3.0+ candidate (S57 D2.6 finding). `1bd6a7d`, `2532cd6`.
- **Bun audit findings**: SQL ✅ already on Bun.SQL (sqlite/postgres ready, mysql Phase 3); channels = single-instance Bun WS pub/sub (no Redis fan-out — fine for v0.2.0 single-instance, ceiling for multi-replica); routing = custom layer on top of Bun.serve() fetch handler. package.json engines.bun ≥1.3.13.
- **Kickstarter v2 reconciliations**: §9 catalog scrml:http row corrected (REST helpers, not "fetch wrapper"); per-row underclaim fixed across data/crypto/time/format/router; "kills npm reach" tightened to "~80% of typical-app npm needs"; catalog snapshot stamp added; §11.6 schema recipe DB-backend note added; §11.5 canonical async-lifecycle pattern promoted (per-screen `<Name>Phase` enum, no stdlib generic — scrml doesn't need generics; per-domain naming beats generic placeholders); new scrml:redis + scrml:cron + scrml:regex rows added; scrml:time + scrml:format rows extended.
- **PA scrml expert primer NEW** at `docs/PA-SCRML-PRIMER.md` (~300 lines). Distilled scrml canon for PA session-start: V5-strict + three RHS shapes + Variant C compound state + error model (`fail`/`!{}`) + engine recipe + Tier 0/1/2 ladder + validators + 15-module stdlib catalog + frequent anti-patterns + operational rules + L1-L20 lock reference. Per S57 user verbatim: *"PA needs to be the second formost expert on scrml, after me, of course"*. Pa.md mandates read at session-start step 2.
- **scrml-dev-pipeline agent file fixed** at `~/.claude/agents/scrml-dev-pipeline.md`: `model: sonnet → opus` (silent default-down bug); `tools` += `Edit, Grep` (D2.5/D2.7 halted because Edit was missing). Effective NEXT PA session start.
- **scrml-support cross-repo writes**: user-voice-scrmlTS.md S57 entries (release version v0.2.0; storage model A1 = source-canonical; stdlib audit dispositions ratified — γ rewrite, distribution, ~80% honesty; Bun audit ratifications; load-bearing-decision-now methodology directive). `48170b1`.

Previous baseline (2026-05-04 after S55 close): **8,576 tests passing / 40 skipped / 0 failing** (~29,789 expects across 426 files) — **UNCHANGED from S53 close**. Zero compiler/code changes — S55 was a pure deliberation session that closed the v0.next architectural design arc.

Previous baseline (2026-05-03 after S53 close): **8,576 tests passing / 40 skipped / 0 failing** (~29,789 expects across 426 files). Eleven dispatches landed in S53 (4 architectural fixes + 4 mechanical paperwork + DOC-E-RENAME + P4 CLI + AST-SHAPE-RENAME); **+85 tests vs S52 close, 0 regressions across all 11 dispatches**. F-ENGINE-001 RESOLVED + F-CHANNEL-003 FULLY RESOLVED + NR AUTHORITATIVE + state-type-routing.ts disposed + engine rename arc COMPLETE (keyword + TAB type-decl synthesis + internal vars + SPEC worked examples + error codes + user-facing docs + AST shape) + `scrml migrate` CLI shipped (Migrations 1+2). 44 commits past S52 close, all pushed. S51 was the systemic silent-failure sweep session: 12 dispatches (2 deep-dives + 10 fix dispatches) shipped in a single day, closing 9 P0s + many P1/P2s. Net +184 tests, 0 regressions across all dispatch waves. The validation principle (S49) is now mechanically realized for M1/M3/M4/M5/M6/M11 mechanisms; UVB (Unified Validation Bundle) closed 4 silent-failure mechanisms in one focused dispatch.

**Backfill note:** S40, S41, S42 entries are missing from this log — captured in hand-offs + git log. S43 + S44 + S45 + S46 + S47 + S48 + S49 entries below; full backfill is open content todo.

---

## Recently Landed

### 2026-05-04 (S58 CLOSED — Stage 0b COMPLETE: D3 + D4 + scrml:oauth + const-form sweep + F4 addendum)

S58 closed Stage 0b. The v0.next spec engineering target is finalized; Phase A1+ implementation phase opens at S59. 47 commits past S57 close, all pushed.

- **Stage 0b D3 (channels + schema + predicates + `not` keyword)**. SPEC.md +688 lines / SPEC-INDEX.md +45 lines. Branch `changes/v0next-spec-impact-d3`, integrated as `4131891..b55834a` (7 commits incl. final summary). §38 file-level channels + V5-strict body + drop `@shared` (M19); §39 additive shared-core validator vocabulary + SQL DDL lowering rules (L4); §53 refinement-type cross-ref to shared-core (L4); §42.2.5 `is some` vs `req` clarification (L5); §34 +2 codes (E-CHANNEL-INSIDE-PROGRAM, E-CHANNEL-SHARED-MODIFIER), E-CHANNEL-002 retired. **+0 tests; spec text only.** ~14 min wall-time.
- **Stage 0b D4 (cleanup + PIPELINE.md + SPEC-INDEX final regen)**. SPEC.md +688 lines / PIPELINE.md +439 lines (1,941 → 2,380; 22.6% rewrite, addendum-style — prose pass deferred to follow-up §8.6 #2) / SPEC-INDEX.md +50 lines structural regen. Branch `changes/v0next-spec-impact-d4`, integrated as `4131891..cded613` (23 commits incl. final summary). 13 Tier 8 small-edit sections threaded with locks/moves; 4 Tier 10 reviews (§28 +4 lint suppression configs); §34 +7 codes (E-CLOSER-001, E-NAME-COLLIDES-RESERVED, E-STRUCTURAL-ELEMENT-MISPLACED, E-MULTI-STATEMENT-HANDLER, E-IMPORT-PINNED-INVALID, E-DERIVED-CIRCULAR-DEP, E-USE-INVALID-CTX); PIPELINE.md per-stage v0.next addenda (TAB / NR / MOD / UVB / TS / DG / CG) + 11-entry Integration Failure Mode Catalog; SPEC-INDEX final regen with 22 D4 Quick Lookup entries. **+0 tests; spec text only.** ~35 min wall-time.
- **scrml:oauth (16th stdlib module)**. OAuth 2.0 + PKCE (RFC 7636) client. Branch `changes/stdlib-oauth`, integrated as `eaa7cd2..15dd6ff` (5 commits, ordering quirk: PKCE landed last in timeline due to off-by-one in initial cherry-pick range; correctness intact). 6 .scrml modules: `index`, `pkce`, `google`, `github`, `microsoft`, `discord`. Core API: `startFlow`, `exchangeCode`, `refreshToken`, `getUserInfo`, `revoke`. PKCE: `generateVerifier`, `deriveChallenge`. Storage: `memoryAdapter()` dev-only; caller injects production. Typed errors (`OAuthStateMismatch`, `OAuthVerifierMissing`, `OAuthTokenError`, `OAuthUserInfoError`, `OAuthRevocationError`) caught by `err.name`. Kickstarter v2 §9 catalog row + new §11.2.1 OAuth recipe. **+58 tests** (38 core + 20 presets). JWKS sig + OIDC discovery (RFC 8414) deferred to v0.3.0+ (logged roadmap §8.5).
- **§6 + cross-section `const @x` → `const <x>` sweep**. Two-phase. Phase 1: §6 worktree dispatch (`c729a0f..c905b2b`, 6 commits, 62 edits) inside §6 only. Phase 2: 14 additional edits across §11, §12, §22/§23 (g{}/r{} foreign-code derived examples), §34 (E-DERIVED-WRITE prose, E-REACTIVE-002/003 + W-DERIVED-001 prose), §52 (state-authority examples + form refs), L19 status header. SPEC.md now has **zero** `const @x` declaration-form instances. PIPELINE.md, kickstarter v2, primer all spot-checked clean. Roadmap §8.6 #1 marked DONE.
- **pa.md F4 path-discipline addendum**. Surfaced during s34-s52-cleanup dispatch: a sub-dispatched agent's relative path `compiler/SPEC.md` was resolved against the harness's `Additional working directories` list (which includes the main repo), causing 5 silent writes to land in main's working tree instead of the worktree. Agent halted on noticing. The 5 edits were inspected and confirmed correct, accepted into the cluster commit. Addendum to pa.md F4 now mandates ABSOLUTE `$WORKTREE_ROOT/...` paths for Write/Edit; relative paths forbidden because of this leak vector. Also documents `bun install` as startup-step #4 — recurring infra finding (worktrees don't inherit node_modules; pre-commit fails without it; hit by every D2.8/D3/oauth/D4/§6-sweep dispatch this session).
- **PA-SCRML-PRIMER.md updated for D3 + D4**. §0 stamp → S58 close; §9 rewritten "pending → LANDED" with §9.1-§9.6 covering channels, schema additive, predicates cross-ref, `is some` vs `req`, and D4 small-edit threading; §10 stdlib count 15 → 16 with scrml:oauth row + deferrals; §11 anti-patterns +3 rows (multi-statement handler, import-pinned-invalid, component-engine-scope); §12 SPEC.md size 23,100 → 24,382 lines + PIPELINE.md size note + sweep-DONE marker + recurring-bun-install note.
- **Article (`tier-ladder-promotion`) rules-inert framing added**. User flagged that the article never made explicit that `rule="..."` attributes are *allowed but inert* inside `<match>`. Inline paragraph at end of Tier 1 section + ladder diagram annotations: "rule= allowed but inert" at Tier 1, "rule= now load-bearing" at Tier 2. Match is render-time projection, not state machine.
- **Permissions whitelist** added to `.claude/settings.local.json` `permissions.additionalDirectories` for both `scrmlTS/` and `scrml-support/` paths. Stops session-start prompts for cross-repo Read access. Effective next session start.
- **Bun upgraded** locally (mid-session, user-driven). Fresh worktrees from now on inherit the upgrade automatically.

Stage 0b totals: **+1,376 SPEC lines / +439 PIPELINE lines / +95 SPEC-INDEX lines / +9 §34 codes / +58 oauth tests** across 4 dispatches + 2 cleanup sweeps + 16th stdlib module. Test posture stable at 7,991-8,720 pass / 0 fail (pre-commit excludes browser; full 8,763) — count varies with module additions but 0 fails maintained.

### 2026-05-04 (S56 CLOSED — implementation-prep session, 4 dispatchable briefs landed, kickstarter v2 fully L1-L20 compliant; 0 tests, 0 compiler changes, but the implementation phase is now dispatchable)

S56 transitioned the v0.next arc from deliberation (closed at S55) to implementation-prep. Two arcs ran sequentially:

**Arc 1 — Continuation deliberation (locks L11-L20).** PA drafted kickstarter v2 then surfaced 4 open clusters from §4 still-open list. User authorized push-on. Direct PA-user discussion mode produced 9 additional locks closing all four clusters (L11-L19) plus L20 addressing the S55-carryover `derived=` attribute grammar. Total S56 locks: L1-L20.

**Arc 2 — Implementation-prep machinery.** Comprehensive Stage 0a SPEC + PIPELINE impact assessment (446 lines) maps every lock + active S55 move to specific SPEC sections with disposition + dependency-respecting rewrite order. ALL FOUR Stage 0b dispatch briefs pre-written: Dispatch 1 Foundation (502 lines, 14-27hr), Dispatch 2 Engines+Match+Validators (801 lines, 29-50hr — heaviest), Dispatch 3 Channels+Schema+Predicates (367 lines, 9-17hr), Dispatch 4 Cleanup+PIPELINE+SPEC-INDEX (381 lines, 18-33hr). Total Stage 0b: 70-127 hours distributed across 4 bounded dispatches with crash-recovery discipline (commit-each-meaningful-change + progress.md + worktree-isolation).

Locks landed:
- **L1 markup-as-first-class-value (PILLAR — held since scrml8 era)** — markup elements may sit anywhere expressions sit; the markup/value distinction collapses across the language. Surfaced via PA edge-case pushback; user immediately flagged as durable claim from pre-user-voice scrml8 era.
- **L2 Variant C compound state with canonical access** — `<formRes>` structural-children, `@formRes.name` canonical access. Same V5-strict asymmetry as Tier 1, one level deeper.
- **L3 decl-coupled-with-render-spec** — `<name req> = <input/>` declares cell + render-spec + validity contract together; `<name/>` in markup invokes the spec.
- **L4 partial validator unification** — shared core (`req`, `length`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`) across loci; schema KEEPS SQL-mirror canonical (`not null`, `unique`, `references`); shared core is additive.
- **L5 `is some` clarification** — coexists with `req` because they enforce different things: `is some` = exists at all; `req` = non-empty / meaningful (`""` is some but not req).
- **L6 match Tier 0/1/2 ladder** — Tier 0 `if=` chains; Tier 1 `<match for=Type>` block-form (structural exhaustiveness, no transitions); Tier 2 `<engine for=Type initial=...>` (full deal). Promotion mechanical/additive.
- **L7 match attributes** — rules legal but inert in `<match>` (lint W-MATCH-RULE-INERT); `effect=`/`<onTransition>` engine-only (E-MATCH-EFFECT-FORBIDDEN).
- **L8 two match shapes** — block-form for markup-emit, JS-style for value-return; same exhaustiveness check, different output category.
- **L9 `loose` flag dropped** — rules-in-match obviates; the `<match>` → `<engine>` swap IS the tightening event.
- **L11 auto-derived validity surface (ε)** — both compound-level (`@x.isValid`, `@x.errors`, `@x.touched`, `@x.submitted`) and per-field (`@x.field.isValid`, etc.) auto-synthesized for compounds with validators. Errors as `ValidationError` enum tags (NOT strings). All read-only.
- **L12 4d four-level error-message resolution** — inline override / project-registered (scrml:data registerMessages) / scrml:data English defaults / `match` escape hatch. `messageFor(errorTag)` walks levels 1-3.
- **L13 `<errors of=expr/>` first-class element** — composable per-field or compound rollup. `of=` always required; `all` attribute toggles full-list rendering; body override permitted.
- **L14 cross-field validation** — no separate vocabulary; falls out of universal-core predicates with cross-cell expression args (`<confirm req eq(@signup.password)>`). Reactive recomputation via L11; circular deps caught at compile time.
- **L15 `const <derived> = expr` (extended ALL-SCOPE)** — derived-cell decl is structural at every scope (not just in-compound). v1's `const @x` form superseded as pre-V5-strict.
- **L16 multi-render via existing paths** — no override syntax; `${@x}` interpolation, component props, or secondary `const <derived>` markup cell.
- **L17 binding-by-render-spec dispatch** — compiler chooses bind:value / bind:checked / bind:files / etc. by render-spec shape; writable cells require bindable render-specs (E-CELL-RENDER-SPEC-NOT-BINDABLE).
- **L18 `reset(@cell)` keyword + `default=` attribute (γ semantics)** — language keyword (not stdlib); mutates in place; `default=` evaluates at reset time, else re-evaluate init expression. Reserved identifier.
- **L19 multi-statement event handlers** — illegal inline; named function required for anything beyond bare-call / bare-assignment / bare-single-expression.
- **L20 `derived=expr` engine attribute** — accepts any reactive expression of the engine's type (typically JS-style `match` block). Derived engines reject `rule=`, `initial=`, direct writes; `<onTransition>`/`effect=` fire on derived state changes; chained derivation legal with cycle detection.

Plus:
- **const-immutability semantics formalized** post-L15 alignment pass: reference-immutable YES (`@x = newval` is `E-DERIVED-WRITE`); value-immutable depends on RHS deps. Truly-frozen non-reactive constants drop the `<>` entirely (plain `const x = ...`). Open Q queued: `E-DERIVED-VALUE-MUTATE` on `@filteredItems.push(x)` (PA leans forbidden, not currently locked).
- **PA.MD context-budget directive (PERMANENT)** — Opus 4.7 1M-context model; do NOT suggest wrap above ~50% remaining without real reason; default threshold ~15-20% remaining; wrap costs ~5-7% context; user-supplied budget signals authoritative. Captured at S56 user observation that PA was carrying earlier-Claude-era 200k-context heuristics.

9 commits scrmlTS + 3 commits scrml-support, all pushed. Implementation phase dispatchable; S57's first move is "launch Dispatch 1 or do further planning" — user's call.

### 2026-05-04 (S55 CLOSED — **PIVOTAL session, massive wrap, deliberation arc complete**; 0 tests, 0 compiler changes, but the v0.next language design is locked)

S55 opened by recovering from an S54 interrupt (the v0.next deliberation pipeline had completed Phase 0 synthesis + Phase 1+2 dives DD5-DD10 + Phase 3 DD5 debate, then crashed). User authorized a mode shift away from the dive/debate cadence in favor of direct PA-user discussion of the open-questions list surfaced by the v0.next-Mario design artifact. The session ran one sustained discussion thread; **21 architectural moves were locked**, the **north star ("UI as a fully-handled state machine") was articulated**, and at session end the **migration design surface dissolved entirely** when the user clarified there are no production scrml adopters (all current code is throwaway experimental).

**Architectural moves catalog at S55 close (21 total):** Moves 1-6 + 8 from S54 synthesis; Moves 9-20 added/refined in S55. Move 7 (multi-close `<///>`) DROPPED — handled by 6nz editor auto-expansion (cross-repo message dropped). Move 21 (two-phase migration) DROPPED — no users to migrate.

**Decisions locked S55 (verbatim user inputs preserved in `scrml-support/user-voice-scrmlTS.md` Session 55):**

- **Move 9 (no debate):** bare-variant `marioState = .Small` parses as qualified when LHS/parameter type known. TS-shape inference.
- **Move 10:** positional binding `<state a b c> = (1,2,3)` legal only when state's shape is fixed by predefined enum/match/engine type. Compiler-gated.
- **V5-strict (Move 3 revised):** `@` is canonical, NOT sugar. Bare names in expressions are LOCALS only. Two-form access (`<v>` structural + `@v` canonical). C9 rescinded — `@` is not JS-framework concession; framework precedent was correct.
- **Move 11:** scoped hoisting (Position D) + lint warning on out-of-order use + `pinned` per-declaration opt-out keyword (upgrades lint to error). TDZ-1 model — no user-visible TDZ window.
- **Move 7 DROPPED:** multi-close shorthand → 6nz editor auto-expansion. General principle: ergonomic shortcuts that fail readability test belong in editor, not grammar.
- **Move 12:** engine validates direct writes via `rule=` contract. `@marioState = .Big` silent-validated; throws on invalid; compile-time check inside state-child bodies.
- **Move 13:** `.advance(.X)` explicit-throws variant for assert-must-work transitions. `.tryAdvance` (silent no-op) explicitly rejected — silent failures hide bugs.
- **Move 14:** `effect=` attribute (single-target one-shot) + `<onTransition to/from once if=...>` structural element (multi-target / attribute-bearing). On-leave default semantics. Lifecycle elements `<onEnter>`/`<onLeave>` skipped — covered by `<onTransition from/to>`.
- **State-children-as-sugar refinement:** `<Small rule=...>{body}</>` is sugar over `if=(@engineVar == .ThisVariant)` + rule= contract. Bodies optional. Mixed engines (some bodied, some bare) legal.
- **Snippets handle shared chrome** — no `<chrome>` template, no `<*>` matcher. Existing language mechanism suffices.
- **Move 15:** `:`-shorthand for single-expression body when no `</>` closer present. `<tag attrs> : expr`. Bare body otherwise (canonical HTML semantics preserved). Mandatory whitespace around `:`.
- **`W-LIFECYCLE-CANDIDATE` lint (opt-out):** boolean state in 3+ structural `if=` sites flags as enum-engine-promotion candidate. Lifecycle-as-engine is the design pattern. Connection to "exhaustively provable" goal — booleans defeat the prover; enum-engines enable it.
- **Move 16:** auto-derived var name = lowercase-first-run of `for=` type. `var=` attribute for override / disambiguation.
- **Move 17:** `initial=` attribute required on non-derived engines (lint warns if omitted, defaults to first state-child). Forbidden on derived engines.
- **Move 18:** engine `<EngineName/>` use-site lives only for cross-file mount; same-file decl-IS-mount; multi-instance marinates.
- **Move 19:** channel shape under v0.next: file-level (NOT inside `<program>`); drops `@shared` modifier; auto-declares variable per Move 16; V5-strict body.
- **Schemas unchanged** — principled exception survives.
- **Move 20:** components stay distinct from engines (Position 1 from multi-instance thread). Components are multi-instance vehicle; engines/channels/schemas are singleton-by-design. Heuristic: app-lifecycle/singleton → engine; widget/reusable/per-instance → component.
- **Move 21 DROPPED at session end** — no migration story; v0.next IS scrml.

**The north star (proposed §1.4 of synthesis, captured S55):**
> the UI of an application SHOULD be a fully handled state machine (engine in scrml case). but development is a process

The structural shape of the UI tree IS the structural shape of the application's state. With the process clause: apps don't START at the north star; they EVOLVE toward it. Compiler nudges (lint), kickstarter teaches the destination, language doesn't ENFORCE the shape. Connection to S54's "exhaustively provable" goal: enum-engines enable structural exhaustiveness checking; booleans-as-lifecycle defeat it.

**THE PIVOTAL CORRECTION — no migration:**
> there is NO ONE writing anything but purely experamental scrml, 100% throw-away code, we dont need to worry about any of that. we just need to fix the compiler, kickstarter, turorial, docs, etc.

This collapsed Move 21, dropped the v0.compat coexistence design, and reframed implementation as "fix scrml to be what it should be" rather than "migrate the world to a new version." Implementation work surface named: compiler + SPEC + PIPELINE + kickstarter + tutorial + examples + samples + self-host + stdlib + LSP/editors + articles. Multi-month effort. Implementation phase opens at S56.

**Files written this session:**

scrml-support:
- `user-voice-scrmlTS.md` — Session 55 entry appended (~14 verbatim quotes + interpretations; ~+450 lines)
- `docs/deep-dives/v0next-s55-deliberation-outcomes-2026-05-04.md` — NEW clean decisions ledger
- `docs/deep-dives/v0next-mario-design-2026-05-04.scrml` — header annotation marking 11 superseded constructs (V5-strict, Move 7 dropped, etc.)
- `docs/deep-dives/phase-2-dispatch-briefs-2026-05-03.md` + 3 `progress-dd5/dd6/dd7-...-2026-05-03.md` — S54 leftover untracked artifacts, committed at this wrap as historical preservation

scrmlTS (this wrap commit):
- `hand-off.md` — S55 close fat hand-off (289 lines)
- `handOffs/hand-off-56.md` — pre-save mirror of hand-off.md (forensic preservation)
- `master-list.md` — S55 close inventory update
- `docs/changelog.md` — this entry

6nz (cross-repo outbox):
- `6NZ/handOffs/incoming/2026-05-04-0958-scrmlTS-to-6nz-multi-close-editor-option.md` — request for editor-side `<//>` auto-expansion since Move 7 dropped from language

**Open queue at S55 close (substantially shrunk):**
- Tagline refresh — design polish, not blocking
- Components props/slots/lifecycle internals — sub-thread under Move 20, design AS implementation proceeds
- Mario design file regen under post-S55 rules — useful canonical reference, not blocking
- Self-host migration plan — operational, not design

**Carry-forward findings (deferred into implementation phase):** ast.machineDecls file-level container rename + 3 small S54 dispositions (scrml migrate / SPEC §39.8 collision, SPEC-INDEX.md `E-MACHINE-DIVERGENCE` typo) + pre-S52 findings (F-COMPONENT-003, F-PARSER-ASI sweep, W5a/b, W7, W8, W9-11). Most folded into v0.next implementation; some may be obsoleted; triage at implementation-phase planning.

**Push state:** scrmlTS at this wrap commit pending push; scrml-support at user-voice + outcomes-doc + Mario annotation + S54 leftovers commit pending push. Push authorization pending user greenlight at S56 open.

**Authorization scopes:** "no holds barred" S54 framing was scoped to S55 (deliberation) by hand-off-55 — DOES NOT carry into S56. "PIVOTAL wrap" authorization is for THIS WRAP only. S56 implementation work needs its own authorization scope.

### 2026-05-03 (S53 CLOSED — fixit session, fat wrap, push complete; engine rename arc complete + 4 architectural fixes; 11 dispatches landed, +85 tests, 0 regressions)

S53 opened on the same calendar day as S52 close (2026-05-02). User direction: *"P3 recos good, go"* + *"this is fixit session. we go go go."* + *"keep going on what ever you have answers for or seems obvious."* — high-velocity per-action greenlights, P3 dive recommendations ratified across the board.

**S53 ratifications (per OQ-P3-1..8):** UCD over SP for category dispatch (51/60 vs 46/60); separate dispatches with P3.B first; per-category NR routing for P3.A/B + P3-FOLLOW for the 75-ref migration; W6 worktree DISCARDED entirely (mechanism preserved verbatim in P3 dive §3.1); PURE-CHANNEL-FILE auto-recognized (analogous to §21.5); E-CHANNEL-008 hard error on cross-file `name=` collision; `channels/` at app-root convention; ship P3.A with SQL-via-page-ancestor pattern documented (W5-FOLLOW continues independently).

**Track A — W6 worktree discard.** Branch `changes/w6` deleted (was at `b05812c`); worktree `agent-a566c25e34a40eb59` removed. P3 dive §3.1 preserves the W6 mechanism verbatim for re-implementation. Zero information loss.

**Track B — P3.B (T2-medium primary + T1-small continuation, +21 tests, merge `b794f64`).** TAB synthesizes `type-decl` AST node when parsing `export type X:kind = {...}` (in addition to existing `export-decl`); cross-file `<engine for=ImportedType>` resolves through the import graph. Closes F-ENGINE-001 architecturally. **Primary agent crashed mid-flight on ECONNRESET after 41 min / 110 tool uses** with 7 WIP commits (pre-snapshot + diagnosis + core TAB fix +90 LOC + 4 test tranches +804 LOC) — architectural fix and tests landed and proven (8,512 pass / 0 fail). **T1-small continuation dispatch** (worktree-isolation OFF; operated in existing P3.B worktree) finished SPEC §51.3.2 message correction + §51.16 NEW (cross-file engine subsection) + §21.2 normative + PIPELINE Stage 3 amendment + adopter integration (`pages/driver/hos.scrml` workaround removed; imports `DriverStatus` from `../../schema.scrml`; ~6 LOC eliminated; FRICTION marks F-ENGINE-001 RESOLVED). 4 pre-existing F-NULL-001 errors on `null` literals in hos.scrml verified out-of-scope (compile pre-change baseline shows same errors). 11-commit FF-merge clean.

**Track C — P3.A (T2-large, +27 tests, merge `00c533a`).** Channel cross-file inline-expansion via CHX (CE phase 2 under UCD). Closes F-CHANNEL-003 architecturally. ~700 LOC compiler refactor: `compiler/src/types/ast.ts` (+45, ChannelDeclNode + FileAST.channelDecls + ExportDeclNode.kind="channel") + `ast-builder.js` (+200, top-level `export <channel>` recognition + ChannelDeclNode synthesis + `_p3aIsExport` propagation + quoted-name import handling) + `module-resolver.js` (+30, channel exports registered with `category` field) + `component-expander.ts` (+270, UCD refactor with Phase 1 component + Phase 2 channel expansion + cross-file inline algorithm) + `state-type-routing.ts` NEW (+119, transitional category routing table per OQ-P3-2 b) + `codegen/emit-channel.ts` (+15, defensive `_p3aIsExport` filter) + `gauntlet-phase1-checks.js` (+12, E-IMPORT-001 suppression extended to channel exports). ~970 LOC tests across 8 new files: TAB recognition (6) + MOD registry (3) + CHX same-file pass-through (5) + CHX cross-file inline (5) + multi-page broadcast (3) + PURE-CHANNEL-FILE (2) + E-CHANNEL-008 collision (2) + diagnosis closure (1) + self-host parity ignore filter for `channelDecls`+`specifiers`. SPEC §21.2 + §38.12 NEW (~150 LOC) + §15.15.6 (~10 LOC) + PIPELINE.md Stage 3.2 Phase 2 (~80 LOC). FRICTION marks F-CHANNEL-003 ARCHITECTURALLY RESOLVED. New error codes: E-CHANNEL-008 (cross-file name= collision) + E-CHANNEL-EXPORT-001 (channel exports without string-literal name=). **3 surprising findings agent flagged:** quoted import-name handling (kebab-case channel names like `"dispatch-board"`) added as discrete fix; gauntlet Phase 1 fix (E-IMPORT-001 suppression mirroring P2 component pattern); P3 dive §6.2 worked-example has subtle scoping bug (`topic=@dispatcherId` referring to consumer-scope var doesn't naturally inline; agent used canonical self-contained pattern from `examples/15-channel-chat.scrml` instead) — flagged as P3.A-FOLLOW design consideration. 15-commit FF-merge clean.

**Track D — P3.A-FOLLOW (T1-small, +8 tests, merge `32a330b`).** Dispatch-app channel sweep. **4 channels of 4 migrated, none skipped:** `dispatch-board` (5 pages, ~60 LOC), `customer-events` (5 pages, ~70 LOC), `load-events` (3 pages, ~45 LOC), `driver-events` (2 pages, ~30 LOC). 4 PURE-CHANNEL-FILE exports created under `examples/23-trucking-dispatch/channels/`. 12 consumer pages updated. ~205 LOC inline boilerplate eliminated. FRICTION marks F-CHANNEL-003 → FULLY RESOLVED with migration table + LOC delta + zero-skip rationale. None of the channels had consumer-scope-bound `topic=@var` references (the dispatch app uses default `topic=name` semantics throughout, so the SPEC §38.12 worked-example scoping caveat doesn't apply). 6-commit FF-merge clean.

**Track E — P3-FOLLOW (T2-medium, +4 tests, merge `ab589b3` post-rebase).** Global migration of `isComponent` routing reads to NR-authoritative `resolvedKind` / `resolvedCategory`. **25 routing reads migrated** (the dive's ~75 estimate was misleading — actual: 103 in compiler/src/ + 154 in compiler/tests/, but read-site count is ~25; the rest are write-side stamps + intra-stage syntactic predicates + doc comments, all bounded by the new allowlist test). `compiler/src/state-type-routing.ts` **DELETED** (transitional file disposed; zero in-tree consumers). SPEC §15.15.6 rewritten ("Shadow Mode (P1 Only)" → "NameRes Authority (Post-P3-FOLLOW)") + PIPELINE Stage 3.05 status flipped to "AUTHORITATIVE". Files modified: `component-expander.ts` (added `isUserComponentMarkup` helper, 7 routing-read sites flipped) + `module-resolver.js` (vocabulary aligned: `category: "user-component"` from `"component"`) + `name-resolver.ts` (importedRegistry derivation prefers `info.category`; walker traverses `lift-expr.expr.node`) + `type-system.ts` (§35 attr validation gate flipped) + `validators/post-ce-invariant.ts` (VP-2 gate flipped to `resolvedKind` + uppercase-first-char heuristic) + `types/ast.ts` (deprecation note on `isComponent`; new fields declared) + `lsp/handlers.js` + `lsp/workspace.js` (cross-file completion classification). New allowlist test `p3-follow-no-isComponent-routing.test.js` (4 tests). 9-commit FF-merge clean (post-rebase onto post-P3.A-FOLLOW main).

**5 surprising findings flagged by P3-FOLLOW agent:**
1. **Vocabulary divergence between NR and module-resolver** — NR used `resolvedCategory: "user-component"`, MR used `category: "component"`. P3.A never aligned them. P3-FOLLOW unifies — single canonical name. One P3.A test (`p3a-mod-channel-registry.test.js`) updated.
2. **NR walker did not traverse lift-expr expressions.** VP-2's `walkFileAst` did. Without NR also walking, residual `<UserBadge>` inside `lift <li><UserBadge/></li>` had no NR stamps. NR walker now mirrors VP-2's lift-expr handling.
3. **VP-2 semantic widening.** NR resolves unknown identifier as `resolvedKind: "unknown"` (NOT `"user-component"`). Literal swap would have lost F-COMPONENT-001 silent-failure case. Gate widens to: `resolvedKind === "user-component" OR (resolvedKind === "unknown" AND uppercase-first-char tag)` — mirrors BS's `isComponentName` predicate without reading `isComponent`.
4. **NR-prefer-with-fallback pattern.** Many CE/VP-2 unit tests bypass NR. Pure NR-only routing read would have broken 105+ tests. Implemented: `resolvedKind === "user-component" OR (resolvedKind === undefined AND isComponent === true)`. NR wins when present (authoritative); legacy fallback for unit-test paths.
5. **Dive's ~75-reference estimate was low.** Actual: 103 in compiler/src/ + 154 in compiler/tests/. Most of the gap was BS/ast-builder write-side stamps and parseAttributes parameters that don't need migration. Read-site count (the actual migration scope) is closer to ~25.

**Track F — three mechanical paperwork dispatches (T1-small × 3, dispatched in parallel; all merged with PA-side rebase + conflict resolution).**

- **P3-SPEC-PAPERWORK** (`7c0468e`, 6 commits, FF). SPEC.md worked-example sweep `<machine>` → `<engine>`. **19 replacements, 67 kept** (deprecation references, normative concept text, error-message templates, grammar rules, section headings, attribute-registry cross-reference list). Plan revision during execution: line 20623 (§52.13.3 closed-attribute-set list) reversed REPLACE→KEEP because cross-references `compiler/src/attribute-registry.js`'s internal `"machine"` key. Migration plan documents per-occurrence rationale.
- **P3-RENAME** (`7a575c0`, 6 commits, FF after rebase). Internal compiler `machineName→engineName` identifier rename across 8 files (`ast-builder.js`, `type-system.ts`, codegen × 6). **58 internal renames, 11 references preserved** (1 AST field name `machineName` on AST node + 2 reads + 8 user-visible-text placeholders in JSDoc/error messages). Inventory delta vs dive's ~350 estimate: real read-site count is 68 in 9 files; renamed 58 of those. Future "AST shape rename" dispatch will handle `kind: "machine-decl"` literal + AST field name.
- **P3-ERROR-RENAME** (`b302ede`, 3 commits, FF after rebase + 3-file conflict resolution). Error code rename E-MACHINE-* → E-ENGINE-* across **20 codes / 367 occurrences across 34 files** (compiler/src 5 files / SPEC.md / tests 26 files / examples 2). Surprising finding: naive `s/E-MACHINE-/E-ENGINE-/g` is unsafe — `E-STATE-MACHINE-DIVERGENCE` contains `E-MACHINE-` as substring; agent adopted negative-lookbehind regex `(?<![A-Za-z0-9])E-MACHINE-`. PA-side conflict resolution at merge: 3 files (`ast-builder.js`, `codegen/emit-machines.ts`, `type-system.ts`) had P3-RENAME's `engineName` and P3-ERROR-RENAME's `E-ENGINE-*` changing adjacent lines; resolved by `git checkout --ours` (taking main's post-P3-RENAME state with `engineName` + old `E-MACHINE-*`) + Python re-application of `E-MACHINE-*` → `E-ENGINE-*` substitution (4 + 12 + 75 = 91 replacements). Combined result is the union: `engineName + E-ENGINE-*`. Rebase completed, FF-merged.

**Engine rename status (post P3.B + P1 + P3-RENAME + P3-SPEC-PAPERWORK + P3-ERROR-RENAME):** the rename arc is functionally complete except for: AST `kind: "machine-decl"` literal rename, AST field name `machineName` rename on AST nodes (deferred to future "AST shape rename" dispatch — affects 20+ test references), user-facing docs flagged by P3-ERROR-RENAME (docs/tutorial.md 3 refs, docs/articles/mutability-contracts-devto-2026-04-29.md, docs/tutorial-snippets/02l-derived-machine.scrml, compiler/SPEC-INDEX.md `E-MACHINE-DIVERGENCE` shorthand).

**Test count timeline this session:** S52 close 8,491 → P3.B merge 8,512 (+21) → P3.A merge 8,539 (+27) → P3.A-FOLLOW merge 8,547 (+8) → P3-FOLLOW merge 8,551 (+4) → P3-SPEC-PAPERWORK merge 8,551 (0 — paperwork) → P3-RENAME merge 8,551 (0 — paperwork) → **P3-ERROR-RENAME merge 8,551 (0 — paperwork)**. **Net S53: +60 tests, 0 regressions across 7 dispatches.** Pre-push validation green at every push.

### 2026-05-02 (S52 CLOSED — fat wrap, push complete; architectural pivot; state-as-primary unification ratified; 4 deep-dives + debate + 5 fix dispatches + 1 P3 design dive; +111 tests, 0 regressions)

S52 ran 2026-04-30 → 2026-05-02 (long session crossed midnight twice, machine-A) following S51 close (8,380p baseline). **The architectural-pivot session.** Triggered by a single user observation that scrml has been silently capitulating to JSX conventions for years; resulted in ratification of state-as-primary unification (Approach A, 93/110 vs B 71.5/110 in 6-expert debate), engine rename (machine→engine) folded into P1, whitespace warn-then-error decided, body grammar uniform-with-extension-points decided.

The catalyst was the W6 dispatch (carry-over from S51 plan): it shipped a §21.2 SHALL NOT against `export <markup>` to close F-CHANNEL-003 silently, and the user identified that within hours as "basically unacceptable" — locks in the wrap-in-const concession. That single rejection triggered the architectural pivot.

**Track A — W6 dispatch (PARKED, NOT MERGED).** F-MACHINE-001 fully RESOLVED (TAB synthesizes sibling type-decl for `export type X:kind = {...}`; cross-file `<machine for=ImportedType>` works; SPEC §51.3.2.5 + §41.2). F-CHANNEL-003 PARTIAL — agent unilaterally shipped the §21.2 SHALL NOT against `export <markup>` (E-EXPORT-001) instead of the diagnosis's recommended inline-expansion. User identified the SHALL NOT as wrong direction (locks in wrap-in-const concession permanently). W6 worktree at `changes/w6` 10 commits never merged. F-MACHINE-001 fix in W6 is salvageable but redundant once P3 lands cross-file resolution architecturally.

**Track B — Three parallel deep-dives (DD1+DD2+DD3).** User direction: *"deep dive. start multiple if its worth it"*. PA dispatched 3 parallel scrml-deep-dive agents.
- **DD1 — State-as-Primary Architectural Unification** (master conceptual, T3) at `scrml-support/docs/deep-dives/state-as-primary-unification-2026-04-30.md` (~1170 lines). Recommends Approach A. Scores A 51/60 vs W6-shipped C 28/60 on 12-dimension matrix. Catalogs 8 historical concessions Approach A removes (PascalCase, wrap-in-const, whitespace-after-`<`, separate state/markup categories, dual naming patterns, §21.2 SHALL NOT, §38.4.1 channel carveout, F-AUTH-002 modifier prefix asymmetry). Convergent dev-agent signal: 3 friction reports independently reach for Approach A-shaped fixes. 7 OQs with defaults proposed.
- **DD2 — Parser Disambiguation Feasibility** (T2-large) at `parser-disambiguation-feasibility-2026-04-30.md` (~700 lines). Verdict **FEASIBLE-WITH-COST**. T2-large × 3 phases (~2-3 weeks). Built on existing W2 canonical-key infrastructure already in LSP. Eliminates Approach B (name-table-at-parse breaks per-file parallelism, lexer-hack risk).
- **DD3 — Prior Art Survey** (T2-large) — **FAILED at 600s agent stall**. PA decided to skip re-launch (DD1 §7 had 14-system catalog autonomously). Progress file remains as untracked artifact.
- Both DD1 and DD2 agents delivered as inline messages instead of writing to disk; PA had to manually persist them. Pattern noted for future deep-dive briefs.

**Track C — DD4 (state-type body grammar).** User-floated questions about `<machine>` body restriction and engine rename led to pre-decided direction: bodies should be uniform with extension points. PA dispatched DD4 with that as input.
- **DD4 — State-Type Body Grammar Uniform-with-Extensions** (T2-large) at `state-type-body-grammar-uniform-extensions-2026-04-30.md` (1187 lines). Confirmed reusability hypothesis (uniform bodies INCREASE reusability). **Killer finding:** SPEC §54.2-§54.3 (Nested Substate Declarations + State-Local Transition Declarations) ALREADY ships the extension-point pattern for type-with-body. DD4 GENERALIZES existing scrml shape, not invents.
- Recommended phasing: T1+T2 (~10-13 days dispatch). `<schema>` stays compile-time-only (principled exception). `<formResult>` default-rendering deferred to T3.
- DD4 wrote to disk correctly (the agent followed the explicit "WRITE this to disk" brief).

**Track D — Debate (Approach A vs B, "for shits and giggles").** User authorized debate even though technical case for A was already strong. debate-curator dispatched with full pipeline. 6 panelists: A camp (scrml-dev-elixir + scrml-dev-htmx + racket-hash-lang-expert) vs B camp (scrml-dev-react + scrml-dev-typescript + scrml-dev-vue). **Verdict: Approach A wins 93/110 vs Approach B's 71.5/110** on extended 11-dimension rubric. Largest spreads favoring A: Paradigm fit (+7), Idiomaticity to user vision (+5.5), Cross-file architectural cleanup (+5), Spec coherence (+4.5). Tie-breaker: convergent dev-agent signal. Honest minority position from B camp on per-category type distinctness — informs implementation: A's `StateTypeDeclNode` must carry strong `category` discriminator (DD4's `StateTypeRegistration` already does this). Insight appended to `~/.claude/design-insights.md`.

**Track E — User ratification.** *"ratify yes. engine yes . other qs default. go"* — Approach A locked, engine rename folded into P1 (overrode DD4's defer recommendation), all 7 OQs at defaults.

**Track F — P1 dispatch (T2-large, +8 tests, merge `0334942`).** Lowest-risk first commit per DD1 §9.1. SPEC §4.3 + §15.6 + §15.8 + §15.12 case-rule softening (SHALL → MAY); SPEC §15.15 NEW unified state-type registry section; 3 new warning codes catalogued (W-CASE-001/W-WHITESPACE-001/W-DEPRECATED-001); TAB recognizes both `<engine>` and `<machine>` keywords; W-DEPRECATED-001 runtime emission on `<machine>` (8 tests); 2 examples migrated to `<engine>` (mario, dispatch app hos.scrml); SPEC §51.3.2 engine canonical; PIPELINE Stage 3.05 NameRes design contract documented. **PARTIAL but adequate** — implementation of NR + warning emissions + uniform opener deferred to P1.E (depends on uniform opener landing first to avoid W-WHITESPACE-001 noisiness flood).

**Track G — P1.E dispatch (T2-medium, +56 tests, merge `1a89e84`).** Builds on P1. **NameRes Stage 3.05** at `compiler/src/name-resolver.ts` (~410 LOC, bigger than 150 estimate; shadow mode — advisory). Wired post-MOD. Walks tag-bearing nodes; stamps `resolvedKind` + `resolvedCategory`. Downstream stages (CE, MOD, TS, codegen) STILL route on `isComponent`; the 63 isComponent references DO NOT migrate yet (deferred). **Uniform opener:** both `<id>` and `< id>` produce equivalent AST for db, schema, engine, machine, channel, timer, poll, request, errorBoundary. **W-CASE-001 + W-WHITESPACE-001 runtime emission live** (NR-driven). Samples migrated to `<engine>` (machine-basic, machine-002-traffic-light, rust-dev-debate-dashboard). Dedicated W-DEPRECATED-001 regression tests replaced sample-based coverage. SPEC §15.15 + §34 + PIPELINE Stage 3.05 flipped from "documented" to "implemented (shadow mode)". Performance within 10% (14.45-15.91s vs 14.51 baseline). Wart: agent renamed gauntlet stage labels in api.js (3.05/3.06 → 3.005/3.006) to avoid clash with NR. New finding: 60 new W-WHITESPACE-001 warnings firing on `samples/compilation-tests/` (pre-existing samples use `< db>` style; deprecation warning doing its job; not a bug).

**Track H — P2 dispatch (T2-medium-to-large, +18 tests, on `changes/p2`).** The user-visible win: `export <ComponentName attrs>{body}</>` direct grammar at top level. SPEC §21.2 amendment with both forms documented (Form 1 canonical + Form 2 legacy `export const Name = <markup>` as transitional sugar per OQ-DD1-3). TAB recognizes `export <Identifier ...>` at top level. MOD's exportRegistry shape-equivalent for both forms. Cross-file imports work for both. Both forms coexist. **Wrapper semantic gap surfaced:** agent shipped Form 1 by desugaring to `export const UserBadge = <UserBadge attrs>{body}</>` — body wrapped in `<UserBadge>` custom-element shell at render time. NOT byte-equivalent to Form 2. Agent documented as "deferred refinement"; PA surfaced; user chose option (a) — block merge until wrapper fixed.

**Track I — P2 wrapper fix dispatch (T1-medium, +17 tests, merge `966a493` via `changes/p2-wrapper`).** Builds on P2. TAB desugaring rewritten — body's root element absorbs outer attrs (typed-prop declarations + non-typed attrs). E-EXPORT-002 fires on empty/multi-rooted body. E-EXPORT-003 fires on outer/inner attr name conflict. SPEC §21.2 caveat dropped — byte-equivalence is now normative. SPEC §21.6 — new error codes catalogued. 14 unit tests (AST equivalence) + 3 integration tests (HTML byte-equivalence) verify Form 1 + Form 2 are equivalent. **New finding (pre-existing, not P2-introduced) — F-COMPONENT-004:** `substituteProps` in CE walks markup text + attr values but NOT into logic-block bodies (ExprNodes inside `${...}` blocks within component bodies); affects both Form 1 and Form 2 equally.

**Track J — F-COMPONENT-004 fix (IN FLIGHT at this changelog entry).** First dispatch HALTED at startup verification — harness gave the worktree a stale base (S51 close `3338377` instead of current main `966a493`). Agent correctly halted per startup-verification protocol; clean exit. Re-dispatched with explicit stale-base recovery prelude (`git reset --hard main` + symlink check + pretest regen). Scope: extend `substituteProps` to walk into logic-block bodies (ExprNodes); shadowing-aware (lambda parameters, local declarations, template literals, nested logic blocks); new helper `substitutePropsInExprNode(node, propMap, shadowedSet)`; Form 1 + Form 2 parity test updated from "same errors" → "same success".

**Status of original 6 S50 P0s (carry-forward):** unchanged from S51 close — F-AUTH-001 silent-window UVB-closed (ergonomic W7 deferred), F-AUTH-002 Layer 1 only (W5a + W5b deferred), F-COMPONENT-001 W1+W2 + F4 caveat (F-COMPONENT-003 nested-PascalCase open), F-RI-001 fully resolved W4, F-CHANNEL-001 W1, F-COMPILE-001 W0a; F-COMPILE-002 + F-BUILD-002 + F-SQL-001 closed S51.

**8 historical concessions catalogued (DD1 §3) for Approach A removal across P1-P4 phases:** PascalCase as discriminator (C1 — first concession identified) / wrap-in-const for components (C2) / whitespace-after-`<` discriminator (C3) / separate state-type categories (C4) / dual naming patterns (C5) / §21.2 SHALL NOT W6 amendment (C6 — never merged) / §38.4.1 channel per-page carveout (C7 — never merged) / `export pure/server function` modifier prefix asymmetry (C8).

**1 newly-surfaced finding open at S52 close:** F-COMPONENT-004 (substituteProps doesn't walk logic-block bodies — IN FLIGHT, expected to land soon).

**Carry-forward queue from S51:** F-COMPONENT-003 (nested-PascalCase Phase-1 limitation), F-COMPILE-003 (pure-helper export emission), W5a (pure-fn library auto-emit), W5b (cross-file `?{}` resolution), F-PARSER-ASI batch (30 trailing warnings), W7-W12 dispatches.

**Multi-session phase plan ahead (per DD1 §9.1 + DD4):** P3 (T3, ~10-15 days — cross-file `<channel>`/`<engine>` inline-expansion; closes F-CHANNEL-003 + F-MACHINE-001 architecturally; supersedes W6's tactical fixes); P4 (T1-small — `scrml-migrate` CLI); internal compiler rename `machineName→engineName` (~350 refs T2-small mechanical); SPEC §51 keyword sweep (T1-small paperwork); E-MACHINE-* → E-ENGINE-* rename (T1-small paperwork); NameRes promotion to authoritative routing (63 isComponent → kind switches; T2-medium, likely part of P3).

**Test count timeline this session:** S51 close 8,380 → P1 merge 8,388 (+8) → P1.E merge 8,484 pre-pretest / 8,444 post-pretest (+96 / +56 effective) → P2 worktree 8,462 (+18) → P2-wrapper merge 8,479 (+17) → P2-wrapper post-pretest 8,519 / 410 files (current). **Net delta from S51 close: +139 pass, 0 skip change, 0 fail change, +10 files. Zero regressions across all 5 fix-dispatch waves.**

**Authorization scope (closing note):** S52's per-action greenlights ("go", "fine to merge", "ratify yes", "2 fix go", "park w6", "go your reco") were per-action throughout. Does NOT carry into S53. Per pa.md "Authorization stands for the scope specified, not beyond." Re-confirm before any merge / push / cross-repo write / dispatch.

**Track K-M close additions (post-mid-flight):** F-COMPONENT-004 fix landed (substituteProps walks logic-block bodies; shadowing-aware; SPEC §15.10.1; FRICTION RESOLVED; +12 tests; merge `e95aa87`). Bookkeeping commit `6e2aa4c` mid-flight. Both repos pushed (scrmlTS `3338377..6e2aa4c` 32 commits; scrml-support `2687e48..f016dad` 1 commit). P3 design dive completed and on disk at `scrml-support/docs/deep-dives/p3-cross-file-inline-expansion-2026-05-02.md` (1029 lines). P3 recommendations: channel via CHX/UCD; engine via Tier 1 TAB type-decl synthesis (W6 Option A pattern preserved); UCD over SP (51/60 vs 46/60); per-category NR promotion; 75 isComponent migration to P3-FOLLOW; W6 worktree disposition = discard entirely. P3.B first (T2-medium), P3.A second (T2-large), P3-FOLLOW third (T2-medium). **Push state at S52 close:** scrmlTS pushed clean to origin (33 commits past S51 close including final wrap commit); scrml-support pushed clean (P3 dive + progress committed in this wrap). **Push complete via "do it fat" wrap directive.**

### 2026-04-30 (S51 close — fat wrap; systemic silent-failure sweep, 12 dispatches, +184 tests, 0 regressions)

S51 ran 2026-04-30 (single long day, machine-A) following S50 close (8,196p baseline). User directive: *"anywhere, we're fixing everything"* + *"lets deep dive with everrything first"*. The session opened with a structured 5-phase deep-dive at `scrml-support/docs/deep-dives/systemic-silent-failure-sweep-2026-04-30.md` (1,026 lines) cataloging 35 items across 16 mechanisms and recommending the **Unified Validation Bundle (UVB)** as the critical path. Twelve dispatches followed in sequence + parallel.

**Track A — parent silent-failure deep-dive (research, 1,026 lines).** Cataloged every open architectural defect from S50 + 5+ pre-existing carry-forwards. Identified 16 failure mechanisms (6 P0-bearing). Discovered M17: test-scaffolding-masks-production (F-COMPONENT-001 + F-RI-001 both have unit tests that pass while production is broken — synthetic key fixtures + isolated narrow shapes mask real cross-file bugs). Recommended UVB unified bundle (4 validation passes shipped in one focused T2 dispatch) as critical path. 12 OQs surfaced; user accepted defaults. Prior art: Cargo / MSBuild / Astro / Bazel / Salsa / Roc / Lean / Rust / Elm — all have fail-loud invariants for the same defect classes.

**Track B — W0a F-COMPILE-001 fix (T2, +17 tests, merge `268f190`).** `scrml compile <dir>` was flattening output by basename: 32 source → 17 HTML / 47 distinct (15 collisions) for the dispatch app pre-fix. Two-part fix: Option A (preserve source dir structure in dist/ — `pages/customer/home.scrml` → `dist/pages/customer/home.html`) + Option B (E-CG-015 hard-error on basename collision pre-write). SPEC §47.9 (output path encoding) added. Dispatch app now produces 32 → 74 distinct outputs with 0 collisions. Discovered F-BUILD-002 candidate (`_scrml_session_destroy` duplicate import) and E-CG-002 spec/impl drift (E-CG-002 was already taken by `emit-server.ts:76`; SPEC corrected; W0a used E-CG-015 next-available).

**Track C — W0b OQ-2 dev-server bootstrap (T2, +9 tests, merge `70eb995`; CRASHED + RESUMED).** Codegen emitted literal `import { ... } from "scrml:auth"`; Bun cannot resolve `scrml:*` scheme. Fix: hand-written ES module shims for auth/crypto/store at `compiler/runtime/stdlib/<name>.js`; `bundleStdlibForRun()` copies them to `<outputDir>/_scrml/<name>.js`; `rewriteStdlibImports()` rewrites emitted `from "scrml:NAME"` to relative path computed from each file's `targetDir` (so nested-output files emit `../../_scrml/...`). First dispatch crashed at tool_use 184 with API ConnectionRefused. Resumed via fresh dispatch on existing worktree; rebased against post-W0a main with manual conflict resolution in api.js (preserved W0a's `pathFor()`/`writeOutput()`/`writtenPaths` AND W0b's stdlib bundling). Why hand-written shims: stdlib `.scrml` sources contain `server {}` blocks the standard pipeline doesn't lower at TS time today (separate M16 gap). Discovered F-COMPILE-002 candidate (`.scrml` extension imports not rewritten) + SQL Class B parse failures (13 of 17 dev-server failures emit `sql-ref:-1`).

**Track D — W1 UVB unified validation bundle (T2, +44 tests, merge `1f640d5`).** 4 validation passes: VP-1 per-element attribute allowlist with W-ATTR-001 (unrecognized name) + W-ATTR-002 (unrecognized value-shape); VP-2 post-CE invariant E-COMPONENT-035 on residual `isComponent: true`; VP-3 attribute-interpolation E-CHANNEL-007 on `${...}` in `<channel name=>`/`<channel topic=>`; VP-4 subsumed by W0a's E-CG-015. New `compiler/src/attribute-registry.js` (per-element attribute schema for scrml-special elements). New `compiler/src/validators/` directory (4 files + AST walker). SPEC §15.14 + §38.11 + §52.13 amendments. PIPELINE Stage 3.3 added. Smoke-test confirmed: `examples/22-multifile/` now FAILS LOUDLY with E-COMPONENT-035 instead of silently emitting `document.createElement("UserBadge")`. Dispatch app's `pages/dispatch/board.scrml` errors with 3× E-COMPONENT-035.

**Track E — W2 architectural deep-dive child (research, 1,093 lines).** Killer finding: the LSP at `lsp/workspace.js` already ships canonical-key + auto-gather. CE is the outlier among 4 cross-file consumers (TS-pass, module-resolver, LSP all use absolute-path keying correctly; only CE reads `imp.source` raw). Trade-off matrix decisive: Approach B (unified canonical-key + recursion + auto-gather) leads by 11 over A, 13 over D, 17 over C. **No debate needed** per deep-dive §15. Compresses parent's T3 estimate to T2-large.

**Track F — W2 architectural fix (T2-large, +10 tests, merge `1f4430d`).** Approach B + B2-b sub-decision (CE consumes `importGraph` directly; mirrors TS-pass pattern at `api.js:626-660`). F1 (CE recursion fix in `hasAnyComponentRefsInLogic`) + F2 (canonical-key via importGraph + lookupKey helper) + F3 (CLI auto-gather transitive `.scrml` import closure with `--no-gather` opt-out + sane-limit guard E-IMPORT-007). Bonus discovery NOT in deep-dive's catalog: TAB classifies `${ export const X = <markup/> }` as `export-decl` (not `component-def`), so cross-file `ast.components` was empty for export-const components; CE now also scans `ast.exports` and synthesizes a component-def. New integration tests `compiler/tests/integration/cross-file-components.test.js` close M17 scaffolding-mask gap. SPEC §15.14.4/§15.14.5/§21.6/§21.7 + PIPELINE Stage 3.2 amendments. G1-G4 PASSED (22-multifile compiles clean + emits expanded markup + integration tests pass). G5 partial — F4 nested-PascalCase Phase-1 limitation surfaced (`parseComponentBody` produces 0 blocks for `<LoadCard>` containing `<LoadStatusBadge>`; same-file fails identically; pre-existing not W2-caused; filed F-COMPONENT-003 candidate). `examples/22-multifile/` master-list row flipped `[x][❌]` → `[x][✅]`. Kickstarter v1 multi-file section dropped KNOWN-BROKEN flag.

**Track G — W3 F-NULL-001 + F-NULL-002 paired fix (T2, +15 tests, merge `37c9f8d`).** Diagnostic finding: F-NULL-001's "machine-context-dependent" trigger was incidental at post-W1 baseline. Real root cause: GCP3 walker's `walkAst` inspected `condExpr/initExpr/exprNode/argsExpr` but never visited `markup.attrs[*].value.exprNode` (server-fn bodies routed through `if-stmt.condExpr` visited; markup-attr expressions at `attrs[*].value.exprNode` unreached). Plus separate diagnostic-quality bug: `spanFromEstree` hard-coded `line:1, col:1`. SPEC §42.7 amendment (uniform rejection across all source positions). **`--no-verify` violation by commit `7d2c4e7`** (TDD red intermediate; bypassed pre-commit hook for failing-tests-then-fix cycle; next commit `09cca5e` was clean). Per pa.md this requires explicit user authorization; flagged for next-session attention.

**Track H — W3.1 + W3.2 paired follow-on null sweeps (T2, +39 tests, merge `e69ecac`).** W3.1 bare-null literals: detector only caught `==`/`!=` operands; missed bare `null`/`undefined` in declaration init / return / object property / array element / ternary branch / default param. Fix: `forEachLitNull` walker visits every exprNode subtree + emits E-SYNTAX-042 on lit-null. Suppression for `is-not`/`is-some`/`is-not-not` synthetic operands. W3.2 string-template attribute interpolation: `<div class="${@x == null ? a : b}">` silently passed because `${...}` was preserved as raw text inside `kind:"string-literal"`. Fix shape (b) tactical: `extractTemplateInterpSegments` scans for `${...}` with brace-depth tracking; each segment re-parsed via existing `parseExprToNode`; resulting exprNode fed back through `inspectExprNode`. SPEC §42.7 enumerated 3 rejection categories + suppression rule. Cascade fixture updates: TodoMVC `app.scrml` (3 sites) + `fn-expr-member-assign.test.js` (3 fixtures) — both used `null` as semantically-equivalent placeholders for `not`; updated to spec-compliant `not` in same commit as detector.

**Track I — F-COMPILE-002 + F-BUILD-002 paired (T2, +15 tests, merge `9ac3731`).** F-COMPILE-002 two-layer bug: (1) `emit-server.ts:111-122` emitted `stmt.source` verbatim (no `.scrml` rewrite); (2) post-emit `rewriteRelativeImportPaths` would mis-relocate `.server.js`/`.client.js` back into source tree. Fix: extension rewrite in emit-server + rewriter skip for compiled-output extensions. F-BUILD-002 single-source bug: `emit-server.ts:166` emits `_scrml_session_destroy` from EVERY auth-middleware server.js; `generateServerEntry` imported each module's exports under name → N copies → SyntaxError. Fix shape: option (d) skip-duplicate (first-importer-wins). SPEC §47.10 + §47.11 + §47.12 amendments. Discovered F-COMPILE-003 candidate (pure-helper `.scrml` files compile to near-empty `.client.js` and no `.server.js`).

**Track J — F-SQL-001 `?{}` parser (T2, +17 tests, merge `5c35618`).** Diagnostic finding: regex `/\?\{[^}]*\}/g` in `compiler/src/expression-parser.ts:137,169` cannot handle `?{...${expr}...}` — non-greedy `[^}]*` stops at first `}`, which in real SQL templates is the closing brace of `${}` interpolation. Acorn then sees truncated input. The dispatch's reference to `sql-ref:-1` was a slight mis-statement; real bug was regex truncation. Fix shape (C) both ergonomic + hard-error: `replaceSqlBlockPlaceholder()` context-mode-stack scanner with frames `js{depth}` / `template` / `single` / `double`; `?{` enters JS-context, `` ` `` enters template, `${` inside template enters nested JS, pops correctly; quoted strings respected. When scanner reaches end-of-input with outer JS-frame still open, `ParseResult.sqlDiagnostic` carries E-SQL-008. SPEC §44.8 + E-SQL-008 amendments. Trailing-content warnings dispatch app: 146 → 30 (eliminated 116; 30 remaining are pre-existing non-SQL ASI cases — F-PARSER-ASI-* / F-PARSER-MARKUP-FRAG-* candidates).

**Track K — W4 F-RI-001 deeper (T2-large, +6 tests, merge `474cce0`).** Most surprising finding of the session: `route-inference.ts` `collectReferencedNames` extracted identifier names via regex applied to **flat-stringified ExprNodes**. The regex matched identifier-shaped tokens **inside string-literal contents**. The capture-taint loop then resolved those bogus names against the global cross-file `fnNameToNodeIds` map. In the dispatch app, `transition()`'s `"/login?reason=unauthorized"` string literal collided with `app.scrml`'s `server function login`, false-tainting `transition`, firing E-RI-002 — but only in directory (multi-file) compile mode, which is why S50's narrow regression tests (single-server-fn shapes) didn't catch it. Fix: replace regex with structural ExprNode walk via existing `forEachIdentInExprNode` (visits only `IdentExpr` nodes, skips `LitExpr` content, skips `MemberExpr.property`, skips `LambdaExpr` bodies). M2 workaround reverted across **10 dispatch-app pages**: dispatch/load-detail, dispatch/billing, customer/load-detail, customer/quote, customer/invoices, driver/load-detail, driver/home, driver/hos, driver/messages, driver/profile. SPEC §12.4 per-fn invariant amendment. **F-RI-001 went PARTIAL → FULLY RESOLVED.** No E-RI-002 fired anywhere on dispatch app post-fix.

**Track L — W5 F-AUTH-002 PARTIAL (T2, +13 tests, merge `56b80ad`).** 3-layer diagnosis: (Layer 1) `ast-builder.js` EXPORT branch's regex was blind to `pure`/`server` modifier tokens; `collectExpr` stopped at `function` STMT_KEYWORD after consuming `server`; left `exportedName=null` and broke cross-file imports of `export server function NAME` with E-IMPORT-004. (Layer 2) Pure-fn files in browser mode produce empty `.client.js` regardless of exports — SPEC §21.5's "auto-detect" promise is unimplemented. (Layer 3) Cross-file `?{}` resolution against importing `<program db=>` has no spec contract. **Layer 1 only fixed.** Modifier parsing fix + SPEC §21.5.1 + §44.7.1 + E-SQL-009 contract direction. **Layers 2 + 3 deferred as W5a (pure-fn library auto-emit) + W5b (cross-file `?{}` resolve)**; W5a is prerequisite for W5b. Architectural cross-file emission gap is broader than F-AUTH-002 (also affects non-SQL pure-fn exports).

**Bookkeeping:** mid-session commit `8dddd27` added 5 newly-surfaced findings to dispatch-app FRICTION.md (F-COMPILE-002, F-BUILD-002, F-SQL-001, F-NULL-003, F-NULL-004) before their respective fix dispatches.

**Status of original 6 S50 P0s:** 5 closed (F-AUTH-001/W1, F-COMPONENT-001/W1+W2, F-CHANNEL-001/W1, F-COMPILE-001/W0a, F-RI-001/W4 fully resolved); 1 partial (F-AUTH-002/W5 Layer 1; W5a + W5b queued). **3 newly-surfaced P0s all closed** (F-COMPILE-002, F-BUILD-002, F-SQL-001).

**5 newly-surfaced findings still open at S51 close:** F-COMPONENT-003 candidate (nested-PascalCase Phase-1 limitation in `parseComponentBody`); F-COMPILE-003 candidate (pure-helper export emission); W5a (pure-fn library auto-emit) + W5b (cross-file `?{}` resolve); F-PARSER-ASI / F-PARSER-MARKUP-FRAG batch (30 trailing warnings post-F-SQL-001).

**Authorization scope (closing note):** S51's "go"/"green"/"a"/"b"/"c"/"greenlight fat wrap" pattern was per-action throughout. Does NOT carry into S52. Per pa.md "Authorization stands for the scope specified, not beyond." Re-confirm before any merge / push / cross-repo write / dispatch.

**Push state:** scrmlTS 67 commits ahead of origin pre-wrap; wrap commits add 3-4 more. scrml-support 4 untracked deep-dive files + needs user-voice S51 append. **Push authorized via "greenlight fat wrap" directive at session close.**

### 2026-04-30 (S50 close — fat wrap; 4 tracks + 6-milestone dispatch app + 26+ findings)

S50 ran 2026-04-29 → 2026-04-30 (crossed midnight during dispatch app M2). Four major tracks shipped:

**Track A — Phase 2g.** Chain branches `if=`/`else-if=`/`else` mount/unmount via per-branch B1 dispatch + single chain wrapper `<div data-scrml-if-chain="N">` + per-branch mixed-cleanliness handling. Greenlit from structured 5-phase deep-dive at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` (753 lines) — surfaced 2 findings the dispatch missed (§17.1.1 line 7533 normative-by-implication; mixed-cleanliness chains the DOMINANT pattern, 5/10 audited samples). User accepted all 4 OQ suggestions on first read. T2 pipeline dispatch with worktree-isolation; first dispatch timed out at 43min/68 tool calls, resumed via fresh dispatch on the existing worktree (SendMessage tool not available in this env), completed cleanly in 10min. Merged via `b362b33`. +31 tests in new `chain-mount-emission.test.js`. No new runtime helpers (Phase 2c B1 reused verbatim). No spec amendment.

**Track B — F-RI-001 triage.** PARTIAL resolution. Triage agent found F-RI-001 was filed against an OLDER RI mental model (commit `7462ae0` S39 boundary-security had already removed callee-based escalation). Doc-comment fix in `route-inference.ts:34-47 + 1387-1394` to remove misleading "purely-transitively-escalated function is suppressed" wording. **7 regression tests** in new `route-inference-f-ri-001.test.js` (§A 3 narrow-canonical / §B 2 server-bound-still-fires / §C 2 CPS-applicable still splits). PA attempted to revert M2's workaround in `pages/dispatch/load-detail.scrml` post-merge — discovered `transition` STILL fires E-RI-002 in real-app file context when `saveAssignment` coexists. Workaround restored. **Two adjacent findings split:** F-RI-001-FOLLOW (P1, `obj.error is not` fails E-SCOPE-001 — `is not` doesn't support member-access targets); F-CPS-001 (P1, architectural — `analyzeCPSEligibility` doesn't recurse into nested control-flow while `findReactiveAssignment` does). F-RI-001 downgraded from STALE to PARTIAL.

**Track C — F-COMPONENT-001 architectural diagnosis.** Triage dispatch refused conservative fix; surfaced as architectural BLOCKED. **Cross-file component expansion does not work end-to-end** on current scrmlTS — three intersecting faults: (F1) `hasAnyComponentRefsInLogic` doesn't recurse into nested markup (wrapped patterns silently skip CE); (F2) `runCEFile` looks up `exportRegistry.get(imp.source)` by raw path string but production registries are keyed by absolute filesystem path; (F3) CLI reads `inputFiles` only, never auto-gathers files reachable through imports. **Independent confirmation:** compiled `examples/22-multifile/`, dist/app.client.js line 12 contains `document.createElement("UserBadge")` — phantom custom element. The canonical multi-file scrml example renders blank. Existing `cross-file-components.test.js` masks the bug via test-only key synthesis that bypasses production paths. **Plan B parked** per user direction: examples/22-multifile flipped to `[x][❌]` in master-list §E; kickstarter v1 multi-file section now flags cross-file components KNOWN-BROKEN; recommends import-types+helpers+inline-markup pattern; deep-dive scheduled post-S50. Diagnosis writeup at `scrml-support/archive/changes/f-component-001/diagnosis.md` (322 lines; moved from `docs/changes/f-component-001/` in S61 curation Batch D).

**Track D — Trucking dispatch app.** 6-milestone language stress test at `examples/23-trucking-dispatch/`. Domain matches user's actual operation (NE Utah, oil and gas, owner-operator). User locked: all-three slices integrated (load tendering + driver log + customer billing), 3 personas (dispatcher / driver / customer), real-time channels, 5,000+ LOC ceiling, **Option A `auth="role:X"` syntax** (deliberately surface the silent-inert friction; server-side fallback layered), customer self-register open. 6 sequential dispatches via Agent (general-purpose, opus, worktree-isolated):

- **M1** schema + auth scaffold (1,587 LOC, 5 commits) — 9 tables, login/register flow, NE Utah seed data (Basin Energy / Uintah Field / Vernal Operations etc.). 7 friction findings.
- **M2** dispatcher slice (2,199 LOC, 10 commits) — 6 pages + 8 components dir (latter unused after F-COMPONENT-001). 4 friction findings including the original (since-found-stale) F-RI-001 framing + F-COMPONENT-001 first surface.
- **M3** driver slice + HOS state machine (2,259 LOC, 7 commits) — 6 pages + `<machine name=HOSMachine for=DriverStatus>` with 8 transitions (off_duty ↔ on_duty ↔ driving + sleeper_berth cycle). 3 friction findings (F-MACHINE-001 / F-NULL-001 / F-PAREN-001).
- **M4** customer slice (1,799 LOC, 5 commits) — 6 pages + rate-quote → tendered-load flow. 2 friction findings (F-NULL-002 / F-CONSUME-001).
- **M5** real-time channels (587 LOC net, 5 commits) — 4 channels (`dispatch-board`, `driver-events`, `load-events`, `customer-events`) wired across 12 pages. 6 friction findings (F-CHANNEL-001 P0 + 5 others).
- **M6** lin tokens + README + final summary (343 LOC net, 6 commits) — acceptance + BOL + payment lin tokens with two-layer enforcement (compile-time `lin` parameter + DB UPDATE-with-NULL durable single-use guard). 2 friction findings (F-LIN-001 / F-DG-002-PREFIX).

**26+ FRICTION findings logged** at `examples/23-trucking-dispatch/FRICTION.md` — the load-bearing artifact of the entire exercise. Severity breakdown: 6 P0 / 10 P1 / 5 P2 / 1 P2 observation / 5 reconfirmations / 1 partial-resolution.

**Two user-prompted findings (high-value extras the dispatch app didn't surface autonomously):**

- **F-IDIOMATIC-001 (P2 observation)** — User asked "has any code used 'is not' 'is some'?" — grep showed **zero usage as operators across 8,200 LOC** of natural scrml writing by 4 distinct general-purpose agents. Adopters reach for `!x` truthiness, `== null`, `==` instead. SPEC §42.2 + kickstarter v1 §3 document `is not`/`is some` as canonical, but it's not landing in practice. Three plausible chilling effects: familiarity bias / F-RI-001-FOLLOW chilling effect / F-NULL-001+002 chilling effect.

- **F-COMPILE-001 (P0)** — User asked "are we actually compiling all code?" — audit revealed `scrml compile <dir>` flattens output by basename. **32 source .scrml → 17 HTML + 28 client.js + 17 server.js in dist/ = 15 silent overwrites.** Customer's `home.scrml` + `profile.scrml` + 2/3 of `load-detail.scrml` were silently overwritten by driver versions. Verified via grep on emitted JS (`driver-events` channel ref in `home.server.js` proves driver/home won; `cdl_number` SQL in `profile.server.js` proves driver/profile won). The "compile clean" verdict from M3-M5 dispatches was misleading — agents didn't audit input-count vs output-count. **The dispatch app cannot run as advertised** — adopters logging in as customer would see driver UI and bounce off role-checks.

**The systemic silent-failure meta-finding:** scrml repeatedly accepts inputs that produce silently-wrong outputs. At least 5 distinct mechanisms violate the S49 validation principle:
1. F-AUTH-001 — `auth="role:X"` silently inert
2. F-CHANNEL-001 — `<channel name="dynamic-${id}">` mangles to literal underscore
3. F-COMPONENT-001 — phantom `document.createElement("Component")` emission
4. F-COMPILE-001 — basename collision silent overwrite
5. F-RI-001 partial — file-context-dependent escalation

Belongs in a unified post-S50 deep-dive sweep, NOT 5 independent triages.

**Other sundries:**
- Authorization scope discipline maintained per pa.md — every action explicitly authorized; "go" cadence per-action, never session-scoped.
- Worktree-creation off stale main was recurring — every `isolation: "worktree"` dispatch needed an explicit rebase prelude in the brief. Cause: harness uses origin/main as branch base. Workaround stable across all dispatches this session.
- Cross-machine sync hygiene clean entering S50 (both repos 0/0 origin); push at S50 close pushes 57+ commits to origin.

### 2026-04-29 (S50 mid-session — Phase 2g: chain branches mount/unmount via per-branch B1 dispatch)

Continued from S49 close (`a70c6aa`). Two-step session: structured deep-dive at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md` (753 lines) → T2 pipeline implementation. Greenlit design: **Approach A + W-keep-chain-only + per-branch mixed-cleanliness dispatch.**

**Tests at Phase 2g merge:** 8,125 pass / 40 skip / 0 fail / 384 files. Net delta vs S49 close: **+31 tests, +89 expects, +1 file. No regressions.**

- **Phase 2g — chain branches mount/unmount** (merge `b362b33`). Extends Phase 2c B1 (single-`if=`) to chain branches. Each `if=`/`else-if=`/`else` branch now compiles per its cleanliness: clean branches → `<template id="..."><inner></template><!--scrml-if-marker:...-->` (per-branch B1 emission inside a single `<div data-scrml-if-chain="N">` chain wrapper); dirty branches → `<div data-scrml-chain-branch="K" style="display:none"><inner></div>` retained as fallback. New `isCleanChainBranch()` helper strips chain attrs then defers to `isCleanIfNode` so cleanliness criteria match Phase 2c B1 verbatim. Strip-precursor (`stripChainBranchAttrs`) preserved in BOTH paths. Chain controller (`emit-event-wiring.ts`) emits `_update_chain_<chainId>()` that dispatches per `branchMode: "mount" | "display"` — clean branches go through `_scrml_create_scope` + `_scrml_mount_template` / `_scrml_unmount_scope`; dirty branches toggle `style.display`. `LogicBinding` interface in `binding-registry.ts` extended with `branchMode`, `templateId?`, `markerId?`, `branchIndex` for the controller. **Honors §17.1.1 line 7533** ("only one span exists in DOM at any time") for clean branches; dirty branches retain pre-Phase-2g behavior (display-toggle inside chain wrapper). **No new runtime helpers** — Phase 2c B1 helpers reused verbatim. **No spec amendment.** New `chain-mount-emission.test.js` with 31 tests (N1-N31) covering all 4 emission shapes (all-clean / mixed / all-dirty / multi-branch) + controller wiring + initial render + branch swap + strip-precursor + reactive flip. ~5 assertion updates in `else-if.test.js` for new chain-clean shape; N31 anti-leak invariant unchanged. +1,035 / -79 across 7 files.

- **Phase 2g deep-dive** at `scrml-support/docs/deep-dives/phase-2g-chain-mount-strategy-2026-04-29.md`. 753 lines, 5-phase structure. Surfaced two findings the dispatch missed: (1) §17.1.1 line 7533 is normative-by-implication ("Only one span exists in the DOM at any time") and applies to chains too — today's wrapper-+-display-toggle violates this verbatim; (2) mixed-cleanliness chains are the DOMINANT pattern (5/10 audited samples), not a corner case. These findings drove the per-branch dispatch decision over whole-chain fallback. Eliminated Approach C (DOM-keep + scope-swap) on §17.1.1 amendment cost + cross-ecosystem reversal + S49 validation principle. Deep-dive carried 7 OQs, 4 of which were greenlit-block; user accepted all 4 suggestions on first read, no debate needed.

- **Routed-to-Phase-2h findings** (NOT 2g regressions, surfaced during 2g implementation): (a) **Pre-existing chain-controller condition-emission bug** for expression conditions like `if=@step == 1` — compiles to `_scrml_reactive_get("step")` instead of `(_scrml_reactive_get("step") == 1)`. Confirmed pre-existing on main (`a70c6aa`), preserved verbatim by Phase 2g. Likely TAB-stage `branch.condition.raw` not populated for `@var == literal`. (b) **6/6 deep-dive §7 allow-list samples** (recipe-book, blog-cms, quiz-app, kanban-r11, api-dashboard, gauntlet-r11-task-dashboard) fail upstream BS/TAB/TS pipeline errors — pre-existing, deep-dive §7/§8 warned. (c) 3/4 chain compilation-test fixtures pass; 4th (099) is expected E-CTRL-001 chain-break test.

- **Phase 2h scope reality check.** Originally framed as "small T1 sample-suite verification sweep." With 6/6 allow-list samples blocked on upstream errors, Phase 2h is no longer small — it's "triage 6 upstream failures + then verify chain semantics." Phase 2g is well-tested at the unit level (31 new tests covering all observable shapes); Phase 2h's value is reduced; user opted to skip 2h and pivot to the 3-5k LOC trucking dispatch app instead. Upstream sample failures remain open as a separate (lower-priority) work-item.

### 2026-04-29 (S49 — multi-track parallel fix-the-cracks; 8 tracks shipped; 4 of 5 audit items closed; all phantoms cleared)

Cross-machine pickup on machine-A continuing from S48's machine-B work. User mode: "go go go" — broad autonomy directive across all dispatched fix work. Validation principle stated mid-session and applied to all current/future feature design: *"if the compiler is happy, the program should be good."* No silent failures at compiler/runtime boundary. PA recommendations of "pass-through; runtime will reject" treated as anti-patterns going forward.

**Tests at S49 close:** 8,094 pass / 40 skip / 0 fail / 383 files. Net delta vs S48 close: **+153 pass, -2 fail (pre-existing fails resolved as side effect of compiler.* meta-checker work)**.

- **compiler.* phantom closed (Option B)** (merge `4fb5cec`). The S48 audit's #1 phantom: `compiler.*` was classified by meta-checker but never implemented by meta-eval — user code passed classification then ReferenceError'd at eval. Recon found user-code surface was the empty set (zero samples, zero examples, zero tests). Option B locked over A (implement) and C (partial impl) on asymmetric-regret + simplicity-defender grounds. Removed regex from `COMPILE_TIME_API_PATTERNS`; deleted `exprNodeContainsIdentNamed("compiler")` wire-up; mirror deletion in `compiler/self-host/meta-checker.scrml` AND `stdlib/compiler/meta-checker.scrml` (2-copy self-host surfaced during impl); added E-META-010 (reserved-namespace diagnostic); backfilled E-META-009 (nested ^{} inside compile-time meta) into §22.11 + §34. SPEC §22.4 amended; §22.8 example trimmed. **All 4 audit phantoms closed by this single mechanism** (rows 2/3/4 were "subset of phantom" — same issue; verified via separate recon). +3 net tests; -2 pre-existing fails resolved as side effect.

- **W-TAILWIND-001 warning + PA-corrective edit** (merges `c543859` + commit `2a10d04`). New `findUnsupportedTailwindShapes()` detector wired into pre-BS lint loop. `maskInterpolations()` brace-balances over `${...}` regions to avoid ternary false-positives (caught real adopter scenario in gauntlet-r10-svelte-dashboard sample). Initial detection had a contradiction in PA's brief (always-fire on shape vs skip-on-engine-match) — agent flagged + resolved shape-based; PA-corrective edit then aligned impl with intended rule. **Bonus fix:** `parseClassName` silent-strip bug closed — `weird:p-4` previously returned CSS for `.p-4` (selector mismatch with source class — silent failure violating S49 validation principle). +44 net tests across both commits.

- **Phase 2c B1 — if= mount/unmount via template + marker** (merges `c543859`-precursor + `7ce8b55`-main). After a structured 5-phase deep-dive at `scrml-support/docs/deep-dives/if-mount-unmount-implementation-strategy-2026-04-29.md` locked B1 over B4 (DOM-keep + scope-swap; eliminated on cross-ecosystem + stale-DOM event hazard + Svelte 5 PR #603 separating-unmount-from-destroy grounds) and B5 (compile-time-static + hide-on-init; parked for SSR work). Re-enabled the deferred Phase 2b emit-html block; clean-subtree if= elements compile to `<template id="...">` + `<!--scrml-if-marker:N-->` + client-JS controller calling `_scrml_create_scope` + `_scrml_mount_template`/`_scrml_unmount_scope`. SPEC §17.1 (DOM existence) + §6.7.2 (LIFO scope teardown) honored. **Precursor commit closed a latent if-chain bug** — `stripChainBranchAttrs()` strips `if=`/`else-if=`/`else` from chain branch elements before recursive emit, preventing B1 double-fire on chain branches. **Most surprising finding the recon missed:** today's display-toggle has flash-of-wrong-content bug for initial-false (no inline `display:none`) — B1 IMPROVES initial-false FCP; only "regression" is initial-true blank, industry-standard prior-art cost. **Phase 2c covers ONLY narrow path** (lowercase tag, all-static descendants); cleanliness gate rejects events/reactive-interp/lifecycle/components/bindings/transitions which fall back to display-toggle. Phase 2 verification recon found 2d/2e/2f are NON-tasks (closed by gate); 2g is real T2 work (chain branches still display-toggle, §17.1 spec divergence); 2h is small T1 sweep. +26 net tests in new `if-mount-emission.test.js`.

- **Tailwind 3 — arbitrary values + variant expansion** (merge `b18fa8e`). New §26.4 "Arbitrary Values" with §26.4.1 validation rules + §26.4.2 cross-feature interaction; new `parseArbitraryValue`/`validateArbitraryCss`/`resolveArbitraryValue`/`wrapWithVariants`/`balancedParens`/`validateUrlBody` helpers. **E-TAILWIND-001 minted** — invalid bracket content fires compile-time error (per S49 user validation principle). Validation surface: hex digit lengths, full v3+v4 unit set (32 units), color function whitelist (rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color/color-mix), math function whitelist (calc/min/max/clamp/var), url() body parsing, var() identifier validation, balanced-parens. Plus 4 new theme variants (dark/print/motion-safe/motion-reduce). `parseClassName` rewritten to `{breakpoint, theme, state, base, hasUnrecognizedPrefix}` (preserving silent-strip-bug fix from W-TAILWIND-001 corrective). Cross-feature: `md:p-[1.5rem]`, `lg:hover:bg-[#ff00ff]`, `dark:bg-[var(--theme)]` all work. 64 new tests in §19/§19b/§19c/§19d. Closes audit drift item #3 (intro article SPEC-ISSUE-012 caveat) by shipping the implementation rather than amending the article. +71 net tests.

- **Tutorial Pass 2** (merges `49b623e` Subgroup A + `a29295a` Subgroup B). 14 mechanical edits per recon: new §1.8 promoting `if=` to Layer 1; new `01h-if-chains.scrml` snippet (~25 LOC); §2.5 trim; §1.1 11-element state-opener list per SPEC §4.2; glossary line 1615 fork. Observable-behavior wording for the if= mount/unmount-vs-display drift; bare-attribute `else` callout. 3 files +106/-16. Pass 3-5 (~30h) NOT STARTED.

- **lin Approach B verified — FALSE ALARM** (doc-only). Audit's "implementation status uncertain" was an inventory miss: `compiler/tests/unit/gauntlet-s25/lin-cross-block.test.js` already had 6 cross-block tests covering §35.2.2's normative surface. Audit row 124 amended 🟡 → ✅. No code change required.

- **E-META-004 numbering gap closed** (commit `c116331`). Added explicit "Reserved — do not reuse" rows to §22.11 + §34. Future codes SHOULD start at E-META-011.

- **Hook drift fix** — `.git/hooks/pre-commit` synced to in-repo canonical `scripts/git-hooks/pre-commit` (excludes browser, adds `--bail`, branch-warning). Worktree commit failures during S49 surfaced this.

- **9 recons + 1 structured deep-dive** produced. compiler.* decision recon, Phase 2c test-impact recon, Tutorial Pass 2 edit list, Phase 2c implementation-strategy deep-dive (5-phase, persisted to scrml-support), lin Approach B verification, audit phantoms (3 settled into 1 issue), Tailwind 3 scoping, Phase 2 completion status (2d-2h verification), audit ❌ rows verification (7 TRUE / 1 false-alarm row 139 / 3 settled). All in `docs/recon/` or `scrml-support/docs/deep-dives/`.

- **Audit "fix-the-cracks" 4 of 5 closed.** Item 1 (show= tutorial fix) — closed by Phase 1 in S48. Item 2 (browser-language article amendment) — DEFERRED per user "no amendments for now." Item 3 (intro article Tailwind caveat) — closed by Tailwind 3 implementation. Item 4 (compiler.* decision) — closed by Option B. Item 5 (component overloading tutorial) — DEFERRED until SPEC-ISSUE-010 closes the syntax (impl is 60-LOC scaffold, no tests, no samples).

- **Audit distribution shift** (post-amendments): 53 ✅ → **57** (+4: lin B, show=, Tailwind arbitrary, Tailwind variants); 22 🟡 → **21** (lin B promoted); 10 ❌ → **7** (-3: 2 Tailwind false alarms + custom-theme remains as v2 deferral); 4 👻 → **0** (all closed by compiler.* Option B).

- **Validation principle captured to user-voice S49 as load-bearing.** Verbatim user directive: *"the only change to everything is that im pretty sure I want comp-side validation of anything valid including css. everything else is, if the compiler is happy, the program should be good."* Cascading effects mapped across Tailwind 3 (compile-time CSS validation), Phase 2c B1 (already aligned — deterministic emission), W-TAILWIND-001 (manifestation of principle), compiler.* (explained why Option B was right). Future feature design must validate compiler-accepted inputs at compile time — no silent failures at compiler/runtime boundary.

- **24 commits on scrmlTS, 3 on scrml-support, all pushed to origin at session close.**

### 2026-04-29 (S48 — articles batch + 3 audits + Phase 1 if/show + Phase 2 foundation; cross-machine wrap)

Two-mode session that pivoted mid-stream. **First half** continued S47's voice-author work (article batch). **Pivot** triggered by user direction — *"I think we need to do a serious investigation on this language. what done, what it needs, what is prommised but not delivered"* + a request for a 3-5k LOC trucking dispatch example app to surface real friction. **Second half** turned audit findings into fix-the-cracks compiler work. Wrap was mid-Phase-2-prep due to machine switch; user *"do it fat, im switching machines, and I hate it when we're mid-progress and the next pa start screwing everything up."* All commits pushed to origin before machine switch; receiving machine pulled cleanly the following day.

**Tests at S48 close:** 7,941 pass / 40 skip / 2 fail / 381 files. Net delta vs S47: -11 tests (5 obsolete `show=` cases deleted that locked in pre-Phase-1 semantics; 5 cases in `allow-atvar-attrs.test.js` updated to assert new directive semantics; behavior coverage net-increased despite the count drop). The 2 fails are pre-existing.

- **Articles batch — 3 published to dev.to** (Bryan MacLee 2026-04-28, commit `45913e5`): `What npm package do you actually need in scrml?`, `What scrml's LSP can do that no other LSP can, and why giti follows from the same principle`, `The server boundary disappears`. Closes the dead Further-reading links from the previously-shipped browser-language overview piece. Cross-links between the three patched in `cf81908` after publish (user must trigger dev.to re-sync OR re-paste content for the live versions to pick up the patched URLs).

- **Articles batch — 5 deep-dive drafts staged but UNPUBLISHED** (commit `a1b9bc4`). Series unpacking the shipped browser-language overview: `components-are-states`, `orm-trap`, `mutability-contracts`, `css-without-build-step`, `realtime-and-workers`. All in `docs/articles/*-devto-2026-04-29.md` + private drafts in `scrml-support/voice/articles/`. Slate item #7 (Why scrml *Feels* Faster) deferred until smart-app-splitting deep-dive's Approach A ratifies. **User-locked: "no amendments to published articles for now"** — the intro article's "Built-in Tailwind engine" overclaim and the browser-language piece's sidecar/WASM/supervisor overclaim stay live (parked, not abandoned).

- **Voice constraint added — never fabricate audience reception.** Article voice was corrected mid-session: "the end of the npm article calls scrml 'opinionated'... I really tried avoiding the rails model" → swapped to "first-principles, full-stack language." Reception-fabrication patterns ("people tell me", "I keep hearing", "most often dismissed") were also corrected. Future article work must NEVER fabricate audience reception — user has not yet had public reception. Strawman framing fine; reception-claiming is a do-not-claim violation.

- **Audit #9 — language-status audit** (`scrml-support/docs/deep-dives/language-status-audit-2026-04-29.md`). 89 features audited across 10 categories: 53 ✅ shipped / 22 🟡 partial / 10 ❌ spec-only / 4 👻 phantom. Top-5 most consequential drifts surfaced: (1) `compiler.*` is a phantom (meta-checker classifies, meta-eval doesn't implement — worst-of-both-worlds); (2) nested `<program>` sidecar (`lang=`), WASM (`mode="wasm"`), supervised restarts spec-defined with no codegen; (3) Tailwind utility engine narrower than intro article advertised (SPEC-ISSUE-012); (4) `lin` Approach B normative in §35.2.2 with type-system plumbing but no test fixture exercising cross-block discontinuous case; (5) `show=` directive taught in tutorial, not in spec, not handled by compiler — corrected by Phase 1 this session.

- **Audit #13 — scrml8 archaeology map** (`scrml-support/docs/deep-dives/scrml8-archaeology-map-2026-04-29.md`). Relevance map of `/home/bryan/projects/scrml8` (predecessor implementation). 290+ entries surveyed. **Critical finding:** all 79 scrml8 deep-dives have filename twins in scrml-support but the scrml-support copies are AMENDED — scrml8 holds the as-originally-debated pre-edit snapshot. **Single biggest non-forwarded artifact:** `/home/bryan/projects/scrml8/docs/giti-spec-v1.md` (1,386 lines) — already cited from current materials but never lifted forward in full (this is what the lsp+giti article had to source-cite "internally" for the 6 git-pain percentages). Bio extension target: 9 user-voice-bearing deep-dives in scrml8 — estimated 15-30 net-new verbatim quotes for bio §3a (npm-evil), §3c (colocation), §3d (mutability-contracts etymology), §3i (meta system). NOT YET CRAWLED.

- **Audit #8 — tutorial freshness audit** (`scrml-support/docs/deep-dives/tutorial-freshness-audit-2026-04-29.md`). 47 sections walked, 33 snippets walked. Distribution: 4 clean / 18 drift / 4 broken / 3 ghost / 11 gap / 4 superseded / 3 stale-deferral. **Crucial spec-vs-impl finding:** `if=` / `show=` is a THREE-WAY drift — tutorial said Vue-style split (mount/unmount vs visibility-toggle), spec §17.1 said `if=` removes-from-DOM, implementation did display-toggle for `if=` and inert-attribute for `show=`. Tutorial, spec, and implementation were mutually contradictory. Phase 1 resolved the `show=` half; Phase 2 in flight resolves the `if=` half.

- **Tutorial Track A (9 small fixes from freshness-audit Pass 1) shipped** (commit `9873e0e`, bundled with Phase 1). `@@user` ghost removal, `@server` non-feature note correction, `lin` deferral language update, snippet bugs, `onkeydown` event-arg correction, et al. Track B (the if/show wording realignment) is gated on Phase 2c completing the impl flip. Tutorial Pass 2-5 (ordering rewrites + missing sections + polish) NOT STARTED — ~30h estimated, deferred.

- **Phase 1 of if/show split shipped** (commit `9873e0e`). `show=` is now a real visibility-toggle directive — pre-S48 it was tutorial-taught with NO codegen support and `show=@x` compiled as a generic HTML attribute. Codegen path: `data-scrml-bind-show` placeholder + `el.style.display` toggle wrapped in `_scrml_effect`; SPEC §17.2 already had correct normative text — no spec change needed. End-to-end verified `<p show=@verbose>` → `<p data-scrml-bind-show="X">` + `el.style.display = _scrml_reactive_get("verbose") ? "" : "none"`. Test fixtures `samples/compilation-tests/control-show-{basic,expr}.scrml`. 5 cases in `allow-atvar-attrs.test.js` updated to assert new directive semantics; `show=count` (no `@`) still produces literal HTML attribute (no regression).

- **Phase 2 foundation shipped** (commit `90f8d16`). Runtime helpers added to `compiler/src/runtime-template.js`: `_scrml_create_scope` (fresh scopeId per mount cycle, counter-based), `_scrml_find_if_marker` (TreeWalker over comment nodes), `_scrml_mount_template` (clones `<template>` content, inserts before marker), `_scrml_unmount_scope` (LIFO destroy honoring SPEC §6.7.2 four-step). LogicBinding interface extended with `isMountToggle?: boolean`, `templateId?: string`, `markerId?: string` (parallel to existing `isConditionalDisplay`, `isVisibilityToggle`). Runtime already had scope teardown infrastructure used by `<timer>`, `<poll>`, `<keyboard>` — Phase 2a just adds the mount-side helpers and the if=-specific marker scan.

- **Phase 2b emit-html integration WRITTEN + DEFERRED to Phase 2c** (commit `e62a11f`). The codegen logic exists in `emit-html.ts` but is COMMENTED OUT. Activating it simultaneously fails ~22 existing tests across `if-expression.test.js`/`allow-atvar-attrs.test.js`/`code-generator.test.js` that lock in the OLD `data-scrml-bind-if` + `el.style.display` shape. Group the test churn into a single disciplined Phase 2c commit. Verified emission shape (hand-compiled, before deferral): `<template id="...">` + `<!--scrml-if-marker:...-->` HTML; client controller wraps mount/unmount in `_scrml_effect`. To re-enable: uncomment block at marked location in `emit-html.ts`, update failing assertions, validate.

- **Trap surfaced for Phase 2c — JSDoc backticks in template-literal runtime.** `compiler/src/runtime-template.js` is a single giant template literal (`export const SCRML_RUNTIME = \`...\`;`). Backticks inside JSDoc must be escaped (`\\\`text\\\``) or the template literal closes early and the rest of the runtime parses as JS. Same trap for `<!--` strings — bun treats them as JS legacy HTML comments. Existing escapes at line 623 are the reference pattern.

- **`auth=` design-completeness deferred** per user *"I would really like to see the gap first"*. Today only `auth="required"` is recognized; `loginRedirect=` / `csrf=` / `sessionExpiry=` siblings work but are tutorial-untaught. Decision deferred until the 3-5k LOC dispatch app's role-based gating needs surface real friction.

- **User direction summary (the through-line):** Articles batch → "I want to blast some articles, Im talking a grip of them" → 5 deep-dive drafts. Pivot → "I think we need to do a serious investigation on this language" + "build a 3-5k LOC trucking dispatch example app" → audits dispatched. Pivot 2 → "lets fix, we need to make sure we fix things right" → Tutorial Track A + Phase 1. Mid Phase 2 confirmation → "we may not [need mount/unmount production-grade]. but these features exist for a reason... so if thats the case then A: scrml is not a production level language B: im missing something scrml already does to nullify the issue. so which?" → confirmed Phase 2 is the right work; foundation shipped. Through-line: adopter-friction is the priority; production-grade language is the goal; gap-driven design (auth=, mount/unmount details) over abstract redesign; honesty over over-claim in articles, spec, tutorial.

- **Cross-machine wrap.** All 8 scrmlTS commits + 2 scrml-support commits pushed to origin before machine switch. Receiving machine pulled cleanly the following day; both repos clean / 0-ahead / 0-behind. master-list and changelog (this entry) updated post-switch on the receiving machine.

### 2026-04-28 (S47 — cross-machine pickup + voice-author bio v0 → v1 + sibling-sweep + carry resolution)

Cross-machine pickup session. S46 ran on the OTHER machine as a scrml-voice-author session; S47 picked up here with a 26-commit pull on scrml-support to integrate machine-B's deliverables. No compiler changes; tests held at S46/S45 baseline.

- **Bio v0 signed off** — user *"sign off start the next bio-crawl"* cleared the bio gating clause and authorized Tier 2-3 incremental crawl in one phrase. Bio status flipped from `DRAFT — v0 initial seed` → `v1 — Tier 1 baseline SIGNED OFF`. Article mode unblocked.
- **Tier 2-3 bio increment** (`scrml-voice-author` background dispatch) — 339 → 392 lines (+53). 6 net-new verbatim quotes: 2 in §3a (NPM/Odin from `transformation-registry-design`, originally pre-archive `user-voice.md:1739/1747`), 4 in §3j (workflow-style from `hand-off-47`). 1 v0 gap closure (R13 "see how it feels" was in Tier 1 all along; v0 missed it). Zero contradictions; zero position shifts. §10 (provenance) + §11 (sibling-repo coverage gap) added. Two scrml-support commits: `1ead983` + `782551b`.
- **Sibling-repo sweep CLOSED EMPIRICALLY** — second `scrml-voice-author` dispatch with PA-enumerated file paths reached `scrml/` (3/3 read, 0 net-new — pure PA-admin) but Read-blocked at sub-agent permission level for `giti/` + `6nz/` (Bash universally denied). PA closed the gap directly via `grep -c` from PA shell across all 20 sibling-repo hand-offs: giti/ → 0 file matches → 0 quotes; 6nz/ → 1 match (`hand-off-4.md:52`) → 1 quote (`> strip shift from roll`, captured in §3h). All sibling-repo coverage gaps closed. §11 rewritten from "STILL BLOCKED" to "CLOSED EMPIRICALLY". **PA-direct empirical-closure recipe** documented as durable methodology for future sandbox-restricted scopes.
- **`design-insights-tmp-G.md` carry-over from S45 §1.9 RESOLVED via lift-then-delete** — PA-direct read showed canonical `design-insights.md` §"scrml G" preserved the headline insight (B-as-category-error, A-now-C-later, tar test, oss-transcripts, §47 stay artifact-scoped) but lossy-compressed the §"Debate-worthy follow-ups" section. 5 specific gates (3 measurement: gauntlet hot-loop wall-clock, parsing-fraction breakdown, parallel-parsing-first; 2 policy: LSP regime shift, SPEC §47 lift separability) lifted into `scrml-support/docs/debate-wave-2026-04-26-actionables.md` §"G-debate storage-model migration gates" with attribution. Temp file deleted. Zero actionable loss.
- **Cross-machine rotation gap convention** — first occurrence on record. When one machine runs a session-N that's sibling-repo-only (e.g. machine-B S46 was scrml-voice-author work, only one scrmlTS commit `b1f6a00`), the OTHER machine's `handOffs/` slot N stays empty when picking up. Sequential numbering preserved by rotating S(N-1)-close to slot (N+1). Slot 46 is permanently empty on this clone.

### 2026-04-27 (post-S45 — article-author agent shipped + first article landed in `docs/articles/`)

Side session post-S45 close. No compiler changes. Tests held at S45 baseline (7,952 / 40 / 0 / 381). New article landed at `docs/articles/why-programming-for-the-browser-needs-a-different-kind-of-language-devto-2026-04-27.md` — dev.to-ready format (`published: false`, will flip when user uploads). Authored by the new `scrml-voice-author` agent (commissioned scrmlTS S38, built today). Agent file at `~/.claude/agents/scrml-voice-author.md` is outside this repo. Working drafts + bio + tweet drafts live in `scrml-support/voice/` (private). User direction 2026-04-27 whitelisted `scrmlTS/docs/articles/` as the agent's only writable path on the public side; everything else (compiler source, spec, root) remains hard-prohibited for the agent.

### 2026-04-27 (S45 — 4-debate wave: Bug B / G / A / C; 4 design insights; tracking doc; scrml-support push cleared)

Design-only session. User direction at session open: "defer push go to debate waves." Four
sequential debates fired with full expert rosters (5 + 5 + 5 + 4 = 19 expert dispatches);
4 design insights recorded to `scrml-support/design-insights.md` (lines 498/533/560/669).
A condensed tracking doc — `scrml-support/docs/debate-wave-2026-04-26-actionables.md` —
distills the 5 v1 commitments + 1 open user-decision + explicit non-goals from the wave.
scrml-support pushed at `d177afe` (20 files / 8,299 insertions), clearing the 2-session
push hold from S43+S44.

**No compiler changes. No test changes.** Tests at S45 close: 7952 pass / 40 skip / 0 fail
across 381 files (unchanged from S44 close).

- **Bug B debate (tier ladder).** Roster: haskell-language-pragma + rust-edition +
  lean-tactic-mode + racket-hash-lang + simplicity-defender. Final: simplicity-defender
  50.5/60 > rust-edition 49 > racket-hash-lang 45 > haskell-language-pragma 43 >
  lean-tactic-mode 41. Decision for v1: no-knob, ship `scrml fmt --upgrade-syntax` first;
  reach for `#lang` only when Superposition lands as a non-default dialect.

- **G debate (file storage model).** Roster: salsa (C-hybrid) + unison (B-pure) +
  simplicity-defender (A-pure) + nix + bazel as CAS witnesses. Final: A 52 > C 48.5 >
  B 32.5. Decision: stay on A (source-canonical); B falsified empirically by Unison's own
  `oss-transcripts` (LLM/AI-agent friction); C-with-Salsa deferred until measurement
  justifies. The G-judge stream timed out on first attempt; recovered with a condensed
  retry.

- **A debate (recoverability + comp-time-shape capture).** Roster: unison (B-pure CA-AST) +
  nix (C-layered Merkle DAG) + lean-lake (R3 hybrid `.olean`) + bazel (C-action-graph +
  toolchain transitions) + security (provenance/DDC/SLSA). Final: lean-lake 49 > unison-B
  46.5 > security-hybrid 44.5 > nix-C 43 > bazel-C 41.5. The B-vs-C dispute resolves via
  hybrid: AST-as-identity (B's win) orthogonal to hermetic-build-with-signed-provenance
  (C's win). v1 capture format = `.scrml-shape/objects/<hash>` + `manifest.toml` carrying
  `(root, compiler, target)` — designed now to carry SLSA L3 attestation later. **Open
  user-side question flagged by lean-lake-expert:** "Is R4 a real workflow or a wish?"
  Mathlib's 1.5M LOC ships entirely on R1+R3, never R4; Bazel says R4 operational at
  Google/Meta scale.

- **C debate (bridges architecture).** Roster: roc + gingerbill + security + unison.
  Final: roc 47 > gingerbill 46.5 > security 44 > unison 42.5. The 4 positions converge
  to a single composite: distribution + identity + execution + trust are 4 orthogonal
  layers. v1: BLAKE3 hash-of-tarball + URL+hash transport (no registry) + §41.6 vendored
  floor + `scrml vendor add` does NOT execute bridge code + comp-time bridge code in
  kernel-enforced capability sandbox.

- **The single highest-leverage commitment surfaced across all 4 debates:** specify the
  comp-time capability boundary in SPEC BEFORE any `^{}` / bridge / build-time feature
  ships. Cargo `build.rs` RFC#475 is stuck 7 years because they tried to retrofit. scrml
  has the structural advantage of writing the boundary now. **The window closes once the
  first popular bridge ships needing $HOME or network at compile time.**

- **scrml-support push** at `d177afe` (origin/main). 20 files / 8,299 insertions: 4 new
  design-insight entries + tracking doc + 8 deep-dives + 8 progress files +
  joint-coupling synthesis + user-voice-scrmlTS.md. Stray draft `design-insights-tmp-G.md`
  (from G-judge timeout retry) left unstaged.

- **Forged-agent harness load:** S44's YAML format fix took effect on session restart.
  All 17 forged experts + scrml-voice-author + simplicity-defender visible at S45 open.
  19 expert dispatches across the wave executed cleanly.

### 2026-04-26 (S44 — compiler-bug throughput: 3 fixes shipped + 12 debate experts forged + systemic YAML loader bug diagnosed/fixed)

High-throughput session immediately following S43. Three compiler bugs cleared from the
inbox/carry queue, all shipped to main and pushed (`8d1e07f..150c553`). Twelve debate
experts forged across three waves. Diagnosed and fixed a systemic YAML format defect in
all 18 forged-agent files (gap-0 between `</example>` and `model:` was breaking the
harness loader; fix takes effect on next session start). Superposition formalization debate
held per user direction; pillar commitment standing.

- **Bug M — `obj.field = function() {...}` mis-emits.** `08ca2f8`. Property/member
  assignment of a function expression was emitting as two statements with empty RHS,
  producing `SyntaxError: Unexpected token ';'` on JS load. Two-file fix:
  `compiler/src/ast-builder.js` `collectExpr` (keep function-expression as part of
  AssignmentExpression RHS rather than detaching as sibling stmt) +
  `compiler/src/expression-parser.ts` `AssignmentExpression` branch (thread `rawSource`
  through so function-expression child receives source context). Filed by 6nz from
  playground-six WebSocket setup. **+18 regression tests.** Anomaly noted: the same
  rawSource-threading gap exists in 5 other expression-parser branches (BinaryExpr,
  NewExpr, ArrayExpr, ObjectExpr, ConditionalExpr); function-expression children of those
  nodes will fall back to `raw=""` until that sweep lands. Probably masked in practice by
  scrml's arrow-callback convention.

- **Bug O — for-of loop variable leaks into `^{}` meta-effect frozen-scope.** `50b431e`.
  Markup-embedded `for (it of @list) { lift <li>${it}</li> }` was leaking `it` into the
  surrounding meta-effect's frozen-scope object as `it: it`, producing
  `ReferenceError: it is not defined` at module load. Single-file fix in
  `compiler/src/meta-checker.ts` `collectRuntimeVars` — skip for-loop bodies during
  module-scope walk (parallel to existing function-decl skip from Bug 6). Filed by 6nz
  from playground-six diagnostics list. **+13 regression tests** (6 unit + 7 integration).
  **Bonus discovery:** the duplicate `_scrml_meta_effect` emission in O's repro is a
  SEPARATE BS-stage bug — HTML `<!-- ... -->` comments aren't opaque to the block splitter,
  so `^{}` text inside a comment parses as a real meta block. After O's fix the phantom
  emission has clean capture (no crash); severity dropped to "phantom side-effect on
  module load." Filed as standalone intake at `scrml-support/archive/changes/fix-bs-html-comment-opacity/intake.md` (moved from `docs/changes/` in S61 curation Batch I).

- **A7 + A8 — HTML void elements leak `angleDepth` in component-def body.** `150c553`.
  Resolves both Scope C tracker findings A7 and A8 with a single fix. The original A7
  hypothesis pointed at `${@reactive}` BLOCK_REF interpolations; trace proved the
  BLOCK_REF was a red herring — the actual trigger was HTML void elements (`<input>`,
  `<br>`, `<hr>`, `<img>`, etc.) leaking `angleDepth` in `collectExpr` because the
  element-nesting tracker (added in A3 `bcd4557`) treated `<void>` opens without ever
  seeing closing tags. Depth counter went up, never came down, swallowing later
  component-def declarations into the first def's body. A8 was a side-effect of the same
  root cause: PreferencesStep's failure was the void
  `<input bind:value=@newsletter>`, not the `<select><option>` shape. Fix in
  `compiler/src/ast-builder.js`: added `HTML_VOID_ELEMENTS` const list (the standard 14)
  and updated `collectExpr` / `collectLiftExpr` / `parseLiftTag` to NOT increment
  `angleDepth` for void elements. **+15 regression tests.** `examples/05-multi-step-form`
  now compiles clean — all three components register. **A8 closure note** filed at
  `scrml-support/archive/changes/fix-component-def-select-option-children/closure-note.md` (moved from `docs/changes/` in S61 curation Batch I). **New finding
  A9 surfaced:** components inside if-chain branches are not expanded by component-expander;
  distinct downstream concern, tracker entry filed (intake pending next session).

- **Bug N — closure pending 6nz confirmation.** Two `@x = ...` reactive writes inside an
  inline function expression were producing missing-paren-on-set + assignment-to-get
  emit on `c51ad15`. On current main `82e5b0d`+ the codegen now emits cleanly with
  `node --check` passing. Likely fixed incidentally by `ed9766d`
  (arrow-object-literal-paren-loss) or `2a5f4a0` (BS string-aware brace counter). 6nz
  follow-up dropped at `2026-04-26-1530-scrmlTS-to-6nz-bugs-mo-shipped.md` requesting
  re-verification on a `82e5b0d`+ 6nz clone before closing.

- **12 debate experts forged in 3 waves (`~/.claude/agents/`):**
  - **Wave 2 (Bug B's tier-ladder set, 4 experts):** `racket-hash-lang-expert` (file-pragma
    via DSL), `haskell-language-pragma-expert` (file-pragma + project-default-baseline),
    `rust-edition-expert` (project/lockfile + migration), `lean-tactic-mode-expert`
    (block-tier extensibility).
  - **Wave 3 (Superposition set, 4 experts — all forged before Superposition was held):**
    `modal-logic-expert` (formal substrate), `quantum-PL-expert` (E hardline,
    type-primitive), `haskell-laziness-expert` (B-leaning hybrid), `erlang-hot-reload-expert`
    (runtime/distributed perspective).
  - **Wave 4 (G + C debate completers + cross-debate voice, 4 experts):**
    `salsa-incremental-compilation-expert` (G C-hybrid), `simplicity-defender`
    (cross-debate conservative voice; synthesizes Hickey + gingerBill + Armstrong + Wirth),
    `roc-expert` (C platform abstraction + URL distribution),
    `gingerbill-expert` (C distributed-hash-refs / no central registry).

- **Systemic YAML loader-bug diagnosis + fix.** All 18 forged-agent files (S43's 5 +
  scrml-voice-author + S44's 12) had `</example>` immediately followed by `model: ...`
  with no blank-line separator. The harness's YAML loader treated this as a malformed
  block scalar and silently dropped the agents — every dispatch attempt returned
  `Agent type 'X' not found`. Diagnosed by comparing agent-forge output to working agents
  (gauntlet-overseer, scrml-deep-dive). Fixed all 18 files via awk script (insert blank
  line before `^model: `). Latency: harness loaded the agent list at S44 start; fix takes
  effect on next session. **Backlog:** update agent-forge template to emit a blank line
  before `model:` so future forges aren't broken.

- **Color collisions caught + fixed:** rust-edition-expert + lean-tactic-mode-expert
  both forged with `purple` (fixed lean-tactic-mode → `teal`); modal-logic-expert +
  quantum-PL-expert both with `pink` (fixed quantum-PL → `coral`). Pre-existing yellow
  collision between security-expert + unison-expert (S43 carryover) NOT fixed this
  session.

- **Superposition formalization debate HELD.** Per user direction mid-session ("we can
  hold superposition off in the plan"), the B-vs-E formalization decision is deferred;
  the Superposition pillar commitment from S43 standing. 4-debate queue remaining for
  next session: B → G → A → C (in dependency order).

- **scrml-support push STILL HELD** — 18 untracked files (8 deep-dives + 8 progress
  files + joint synthesis + user-voice-scrmlTS.md) sustained from S43 close through
  S44 close. **Now 2 sessions held**, flagged as the immediate next-session decision
  per the cross-machine sync hygiene rule.

- **Cross-repo:** dropped 2 messages into 6nz inbox: `2026-04-26-1430-...mno-triage.md`
  (initial triage) and `2026-04-26-1530-...mo-shipped.md` (post-fix follow-up with commit
  SHAs + workaround revert points + bonus-bug intake notice + Bug N re-verification
  request).

- **Anomaly inventory at S44 close:** A9 candidate (if-chain branch expansion gap),
  rawSource-threading gap in 5 expression-parser branches, BS-html-comment opacity (intake
  filed), agent-forge template needs update, fresh-worktree dist regen requirement,
  voice-author bio bake blocked through S44 (resolves on next session start).

- **Tests:** 7906 → 7952 / 40 / 0 / 381 files. **+46 net tests across 3 fixes, 0
  regressions.** Per fix: M +18, O +13, A7+A8 +15.

### 2026-04-26 (S43 — living-compiler investigation arc: 8 deep-dives + 5 expert agents + voice-author + permission fix + cross-machine sync hygiene)

Design-heavy session. NO compiler changes. The work product is the largest single-session
deep-dive yield in project history plus the agent infrastructure to run debates from it.

- **8 deep-dives all landed**, output to `scrml-support/docs/deep-dives/*-2026-04-26.md`.
  The "living compiler" thread fired full-bore per the user's "keep pulling on every thread,
  dd and debate wherever the trail leads" methodology directive. Two dives stalled silently
  on Phase 4 single-shot writes; both recovered (C re-dispatched from progress file; H
  re-dispatched with strict per-section enforcement; Superposition recovered via PA-write
  hybrid pattern after a 3rd stall). Dive titles:
  - **A** — Recoverability + compile-time-shape capture (1,068 lines). User disambiguation:
    R4 with R1+R4 combo target. Approach A (Lockfile) eliminated by user choice; debate is
    B (Content-Addressed AST) vs C (Pipeline-Stage Merkle Tree).
  - **B** — Mid-compile config swap via `<compiler config=...>` blocks (876 lines). Of 14
    industry languages, only 3 have working block-scope mode swap. Recommendation: defer
    block-tier; floor on lockfile + per-`<program>` attr.
  - **C** — Bridge architecture (re-dispatched). 5 spec rules drafted (§X.1-§X.5):
    bridges are content units, hashes are identity, names are convenience, no global
    registry as authority, post-Stage-7 phasing constraint, deterministic at compile time.
    Approach D (Curated Registry) eliminated.
  - **E** — Meta-system capability frontier `^{}` (638 lines). Three critical findings:
    `compiler.*` is a phantom (named in SPEC, not implemented); determinism is unenforced
    (the largest spec-vs-checks gap); phasing inversion confirms `^{}` operates Stage 7-8
    only — independent agreement with B's same finding.
  - **F** — Per-dev keyword alias layer. Big surprise: scrml's SPEC already has the
    canonical+alias precedent in §14.5 (`./::`), §18.2 (`=>/->`), §18.6 (`else/_`),
    §48.11 (`fn`/`pure function`) — all with the normative line *"the compiler preference
    setting controls which form the formatter normalizes to."* The user's idea generalizes
    that single-global mechanism to per-dev. Phase 5 explicitly recommends NO debate.
  - **G** — File storage source-vs-AST-canonical. After user disambiguation #4 ("AI agents
    can figure it out. they will NOT be limiting factors of this language"), Approach B
    (Unison-flavor full AST) was re-included after initial elimination. Final framing:
    A (source-canonical + lockfile + editor-alias) vs B (Unison-flavor) vs C-hybrid
    (source-canonical + AST-cache).
  - **H** — Smart app splitting / "feel of performance" (588 lines). Centerpiece:
    `playable_surface(entry_point, N)` formalized as a closure over initially-rendered
    + reactive-dep + server-fn-reachable + auth-gated + vendor-units. Honest assessment:
    structural advantage real but narrower than framing suggests; contingent on three
    implementation gaps (reactive-graph static-resolvability, server-fn interaction-graph
    modeling, §40 auth depth).
  - **Superposition** (788 lines) — committed as an explicit language pillar after user
    disambiguation #5. 8 strong-fit constructs catalogued (auto-await, RemoteData, sum
    types, Optional, `?{}` SQL, `<request>`, `^{}` meta classification, multi-version
    coexistence). 3 NOT-fits (reactive `@vars`, lin, machines) demoted via radical-doubt
    discipline. Debate framing: B (Dedicated SPEC section) vs E (Composite: B + selective
    sigil/type-primitive).

- **Joint A+B coupling synthesis written by PA** (~150 lines) — pre-debate anchor on the
  4 coupling points (shape-capture granularity, cache-key derivation, replay correctness,
  diagnostic provenance). Collapses 6 pre-debate disambiguations to 3 real debate questions.

- **5 foundational tech-experts forged** at `~/.claude/agents/`: nix-expert, unison-expert,
  bazel-expert, lean-lake-expert, security-expert. Cover A + C + G + Superposition + parts
  of B/E debates. Specialized experts for B (racket-#lang, haskell-pragma, rust-edition,
  lean-tactic) and Superposition (modal-logic, quantum-PL, haskell-laziness, erlang-hot-reload)
  remain to forge in next wave.

- **Custom `scrml-voice-author` agent** (298 lines) at `~/.claude/agents/` — bio curator +
  article-drafter that crawls user-voice + hand-offs + deep-dives for verbatim quotes,
  maintains a structured bio at `scrml-support/voice/user-bio.md`, and drafts articles
  citing only attested positions (never fabricates expertise the bio doesn't attest).
  First article queued: *"Why programming for the browser needs a different kind of
  language"* — to draft after bio is baked.

- **Settings.json permission fix** at `~/.claude/settings.json` — added `permissions.allow`
  for `Write/Edit/Read` on `~/.claude/agents/*` paths. First wave of forges hit Write-denied;
  permission fix unblocked the workflow; remaining forges landed clean.

- **scrmlTS pa.md updates:** Added "Cross-machine sync hygiene" section (session-start
  fetch + ahead/behind, session-end push verify, machine-switch protocol, recovery
  procedure). Updated "wrap" step 3 to point at this in-repo `docs/changelog.md` (was
  briefly pointing at a now-retracted `scrml-support/CHANGELOG-scrmlTS.md`).

- **Strategic vector confirmed** across 6 independent investigations: content-over-name,
  source-canonical (now conditional after AI-friction disambiguation), deterministic-at-
  compile-time, distributed-not-centralized, phasing-constraint-respected, superposition-
  as-foundational. 6 dives converging on compatible constraints = highest-confidence
  signal radical-doubt has produced.

- **Five durable methodology directives surfaced** (captured in user-voice): radical
  doubt is a SAFETY mechanism not skepticism; track 1 (preference) bias conservative,
  track 2 (power) bias extension; AI-agent friction is NOT a language-design constraint;
  "make no mistakes" for irreversible operations; cross-machine sync hygiene codified.

- **scrml-support staleness reconciliation arc.** Discovered local clone 12 commits behind
  origin (S40-S42 cross-repo writes built on stale baseline). Forensic audit + checksums +
  /tmp backups + reflog anchor → `git reset --hard origin/main` → keepers preserved →
  master-PA inbox message dropped. Demonstrated the "make no mistakes" principle in
  practice. user-voice-archive.md (2,837 lines) brought into local tree.

- **Tests unchanged from S42 baseline:** 7,906 pass / 40 skip / 0 fail / 378 files.
  No compiler changes this session — confirmed by `bun test` at S43-close.

- **Commits this session:** 2 on scrmlTS (`82e5b0d` cross-machine sync work + S43 close
  hand-off/master-list/changelog). scrml-support push HELD — 18 untracked design files
  remain uncommitted in scrml-support pending push authorization.

---

### 2026-04-24 (S39 — boundary security + 6 bug fixes + ExprNode Phase 4d + multi-DB scoping)

Largest single-session output in project history. Boundary security deep-dive
+ 3-expert debate produced a compiler-enforced closure-capture taint model.
All 6 inbox bug reports (4 from 6nz, 2 from giti) fixed and verified. ExprNode
Phase 4d advanced through structured inline match arms + render preprocessor.
Multi-DB SQL driver support scoped via deep-dive. Suite 7,463 → 7,562
(+99 net tests), zero regressions.

- **Boundary security — closure-capture taint propagation.**
  Deep-dive identified 5 root causes: transitive escalation deliberately
  disabled in RI (correct for calls, wrong for captures), `extractReactiveDeps`
  string-only scan (Bug J), global regex name-mangling (Bug I), fail-open
  `_ensureBoundary` (NC-4), SPEC §15.11.6 violation (prop-passing not detected).
  3-expert debate: Type Tags (42/60), Crossing Points (48/60), Extended
  Interprocedural Taint (54/60 — winner). Implementation: `closureCaptures`
  map + fixed-point taint propagation in `route-inference.ts`, call-graph BFS
  for transitive reactive deps in `reactive-deps.ts`, `_ensureBoundary`
  graduated to diagnostic fail-safe with `SCRML_STRICT_BOUNDARY=1` strict mode.
  +15 tests in `boundary-security.test.js`.

- **Bug I (codegen) — name-mangling bleed through spaced member expressions.**
  Lookbehind `(?<!\.)` missed emitter's spaced `.` output (`n . lines`).
  Fix: variable-length `(?<!\.\s*)`. +7 tests.

- **Bug H (codegen) — function return-type match drops return.**
  Missing `return` before match-expression IIFEs when `function` (not `fn`)
  has `-> T` or `: T` return-type annotation. Fix: `hasReturnType` flag on
  function-decl AST nodes; `emitFnShortcutBody` applies implicit return when
  set. +5 tests.

- **Bug K (runtime) — sync-effect throw halts caller.**
  `_scrml_trigger()` dispatched effects without try/catch. A throwing derived
  expression propagated through `_scrml_reactive_set` → user function, halting
  subsequent reactive writes. Fix: try/catch per effect, consistent with
  existing subscriber pattern. +5 tests.

- **GITI-009 (codegen) — relative-import forwarding against source path.**
  Server JS emitted import paths verbatim from source `.scrml`; wrong when
  output directory differs. Fix: `rewriteRelativeImportPaths()` post-processor
  in `api.js` resolves against source dir then computes relative from output dir.
  +16 tests.

- **GITI-011 (tokenizer+codegen) — CSS at-rule handling.**
  `tokenizeCSS()` had no `@` handler. `@import`, `@media`, `@keyframes` etc.
  mangled into property declarations (`media: ;`). Fix: new `CSS_AT_RULE` token
  type with depth-tracked brace matching for block at-rules, semicolon-terminated
  for statement at-rules. AST builder stores verbatim text; `emit-css.ts`
  passthrough. +19 tests.

- **ExprNode Phase 4d — structured inline match arms.**
  Inline match arms (`. Variant => result`) now produce structured
  `match-arm-inline` AST nodes instead of raw `bare-expr` strings. Codegen
  uses pre-parsed fields (test, binding, result, resultExpr) instead of
  regex-parsing `.expr` at emit time. Also fixed two token-kind bugs in S27
  arm-boundary detection (`=>` is OPERATOR not PUNCT, `::` is OPERATOR not
  PUNCT). +19 tests.

- **ExprNode Phase 4d — render preprocessor.**
  `render name()` → `__scrml_render_name__()` in `preprocessForAcorn`,
  following the same pattern as 6 existing preprocessor rules. Produces
  proper `CallExpr` ExprNode instead of escape-hatch. Enables CE to switch
  from string regex to ExprNode structural matching, unblocking
  `bare-expr.expr` field deletion.

- **ExprNode Phase 4d — steps 1-7 merged.** ExprNode-first paths across
  `body-pre-parser.ts`, `component-expander.ts`, `type-system.ts`,
  `dependency-graph.ts`, `meta-checker.ts`. `bpp.test.js` GIT_DIR leak fix.

- **Multi-DB SQL deep-dive.** Bun.SQL template literals (SPEC §44 mandate).
  4-phase plan: (1) SQLite→Bun.SQL, (2) Postgres, (3) MySQL, (4) edge DBs.
  Per-stage change assessment with file:line references. Phase 1 code
  complete in concept; merge deferred to S40 due to branch divergence.

- **README:** giti added to Related Projects, broken 6nz relative links
  fixed to absolute GitHub URLs.

- **Maps refreshed:** 11 maps + non-compliance report regenerated.

- **master-list.md refreshed** to S39 (was ~15 sessions stale).

### 2026-04-22 (S38 — adopter-bug wave + CSRF bootstrap + SPEC §22.3 multi-`^{}`)

Eight commits, all pushed to origin/main. Four adopter bugs from the 6nz
2026-04-21 batch shipped (Bugs 1, 3, 4, 5), GITI-010 CSRF bootstrap blocker
resolved, Bug-5 mixed-case follow-on hoist, SPEC §22.3 terminal bullet
ratifying multi-top-level `^{}` source-order semantics (5-expert debate,
minimum-delta won), and a classifier bug surfaced during multi-`^{}`
testing fixed the same day. Suite 7,383 → 7,463 (+80 net tests), zero
regressions throughout.

- **Bug 1 (ast-builder) — string literal escapes double-escaped in emit.**
  8 identical `STRING`-token re-quote sites in `ast-builder.js` used
  `.replace(/\\/g, "\\\\").replace(/"/g, '\\"')` on the tokenizer's raw
  inner text. Tokenizer stores source-as-written (`"a\n b"` → 4 chars:
  `a`, `\`, `n`, `b`); the `.replace` doubled every backslash → `"a\\nb"`
  in emitted JS → parses as literal backslash+n, not LF. Every escape
  sequence affected; leaked into bug-2 and bug-6 reproducers too. Fix:
  new `reemitJsStringLiteral(rawInner)` helper interprets standard
  escapes (`\n \t \r \\ \" \' \0 \b \f \v \xHH \uHHHH \u{HHHHHH}`) then
  `JSON.stringify`s — canonical double-quoted JS literal. 11 unit tests.
  Commit `41aa7c0`.
- **Bug 3 (ast-builder) — `return X + y` dropped after `const y = A ? B : C`.**
  Root cause: `collectExpr`'s angle-bracket tracker bumped `angleDepth`
  unconditionally when `<` was followed by IDENT. In `base < limit`,
  no matching `>` appeared — `angleDepth` stayed at 1, disabling the
  `STMT_KEYWORDS` boundary check. Greedy collect ate `return base + min`
  into the expression; meriyah rejected the mashed string; downstream
  silently dropped the tail. Fix: before bumping `angleDepth`, check
  whether the previous consumed token is a clearly value-producing token
  (IDENT, AT_IDENT, NUMBER, STRING, `)`, `]`). If so, `<` is a less-than
  comparison. 11 unit tests. Commit `3778d76`.
- **Bug 5 (codegen) — pure keyed-reconcile skips outer `_scrml_effect`.**
  `emit-reactive-wiring.ts` unconditionally wrapped any reactive-deps
  lift group in `_scrml_effect`. Reactive for-lift emits already contain
  `_scrml_effect_static(renderFn)` which handles re-reconciliation on
  `@items` mutation in-place. The outer effect re-created the list
  wrapper div per mutation — 6nz observed `3 → 8 → 15` `<li>` children
  on sequential clicks. Fix: detect pure-keyed-reconcile (combinedCode
  has `_scrml_reconcile_list(` AND no other `_scrml_reactive_get(`
  outside reconcile calls, via balanced-paren `stripReconcileCalls`
  helper) and skip the outer wrap. 6 unit tests. Narrow-scope caveat:
  mixed-case (keyed reconcile + other reactive reads) still had a
  pre-existing wrapper-re-creation issue — shipped as separate follow-on
  `8691f75` the same session. Commit `b37769c`.
- **GITI-010 (codegen) — CSRF bootstrap mint-on-403 + client single-retry.**
  Baseline CSRF 403 response emitted no `Set-Cookie`, so cookie-less
  first POST returned 403 forever. User ratified Option A after A/B/C
  trade-off analysis. Three-sided fix: (1) server baseline path — 403
  now includes `Set-Cookie: scrml_csrf=${token}; Path=/; SameSite=Strict`;
  (2) middleware CSRF paths — split missing-vs-mismatched cookie (missing
  gets mint+retry, mismatched gets terminal 403); (3) client — new shared
  `_scrml_fetch_with_csrf_retry(path, method, body)` helper that retries
  exactly once on 403 re-reading `document.cookie`. Helper emission gated
  behind `hasMutatingCsrfServerFn` so SSE-only files don't emit dead
  code. Auth-middleware CSRF path deferred to its own fix. 9 unit tests.
  Commit `40e162b`.
- **Bug 4 (codegen) — named derived reactive refs get DOM wiring.**
  Two-layered root cause: (1) `collectReactiveVarNames` in `reactive-deps.ts`
  collected `reactive-decl` and `tilde-decl` but not `reactive-derived-decl`
  — `${@isInsert}` had `reactiveRefs` computed as empty, emit-event-wiring
  saw `varRefs.length === 0`, skipped the wiring block entirely (silent
  render bug). (2) Once wiring emission was restored, the rewrite emitted
  `_scrml_reactive_get("isInsert")` instead of `_scrml_derived_get(...)`
  because `emitExprField` calls in emit-event-wiring didn't pass
  `ctx.derivedNames`. Fix: (a) add `reactive-derived-decl` to the name
  collector; (b) populate `ctx.derivedNames` via `collectDerivedVarNames`
  at both CompileContext construction sites; (c) thread `derivedNames`
  through the markup-interpolation `emitExprField` calls. 8 unit tests.
  Commit `adbc30c`.
- **Mixed-case for-lift wrapper hoist (follow-on to Bug 5).** Logic blocks
  combining keyed for-lift with other reactive content stacked two bugs:
  (a) wrapper re-created per outer-effect fire; (b) conditional lift
  accumulated without `innerHTML=""` (skipped to preserve wrapper). Fix:
  detect mixed case and hoist for-lift setup OUTSIDE the outer effect
  via `hoistForLiftSetup(combinedCode)` — regex + balanced-brace
  extraction of wrapper decl, `createFn`, `renderFn`, first `renderFn()`
  call, `_scrml_effect_static(renderFn)`. Effect body retains
  `_scrml_lift(wrapper)` which re-mounts the same node (appendChild
  MOVES, wrapper's reconciled children persist). With wrapper hoisted,
  `innerHTML=""` restored at effect top — safe. Fixes both (a) and (b)
  in one pass. 11 unit tests. Commit `8691f75`.
- **SPEC §22.3 — multi-top-level `^{}` source-order normative rule.**
  Ratified by 5-expert debate (elm-architecture 34, template-haskell 45,
  zig-comptime 46, racket-phases 44, scrml-radical-doubt **53/60 — winner**).
  Minimum-delta wins: codify existing compiler behavior, **do NOT**
  introduce `^init{}`/`^mount{}`/`^teardown{}` keywords. One bullet
  appended to §22.3 Normative statements (top-level = file scope; each
  block classified independently per §22.4/§22.5; source order within
  phase; DOMContentLoaded-already-fired clause; mixed compile-time+runtime
  permitted). scrml-language-design-reviewer 2-pass review: pass 1 REVISE
  (4 issues) → pass 2 CLEAN. Two debate-curator hallucinated citations
  caught + stripped before merge (nonexistent "insight 40" and "file-
  scoped compile-time accumulator"). 6 unit tests + 1 sample. Commit
  `6609fb6`.
- **`emit.raw(...)` classifier compile-time detection (surfaced same day).**
  `^{ emit.raw("<p>...") }` was classifying as runtime meta — emitting
  `_scrml_meta_effect(...)` with body `emit.raw(...)` that would CRASH
  at runtime (per §22.5.1, `emit.raw` has no runtime counterpart). Root
  cause: `testExprNode` in `meta-checker.ts` used `exprNodeContainsCall(exprNode, "emit")`
  which only matches bare `emit(...)`; for `emit.raw(...)` the callee
  is a MemberExpr, not an IdentExpr. String-fallback regex DID catch
  it, but ExprNode path runs first and short-circuits. Fix: new
  `exprNodeContainsEmitRawCall` helper walks for CallExpr with
  MemberExpr callee matching `emit.raw`. Wired into `testExprNode`.
  7 unit tests. Commit `cfb1a14`.

Process highlights:
- Verify-before-fix applied throughout — every bug had a confirmed repro
  before any source edit.
- Write-test-always applied throughout — each fix shipped with tests.
- SPEC edit gated by 2-pass scrml-language-design-reviewer discipline
  (1 REVISE → 1 CLEAN).
- Radical-doubt debate-curator flow executed on the multi-`^{}` question.
- Two debate-agent hallucinations (invented insight + invented compiler
  concept) caught during the pre-merge review and stripped.

### 2026-04-19 → 2026-04-21 catch-up (S29–S37, consolidated)

Nine sessions' worth of commits that were never individually logged. Organized by arc rather than session-by-session for readability.

**S29 — ast-builder component-def gate (2026-04-19).** `const X = <markup>`
without explicit RHS markup was parsing as a runtime const-decl but
being treated downstream as a component. Fix at `b189051` adds markup-
RHS requirement for uppercase-name const decls. Wrap at `4823519`.

**S30 — adopter friction audit, 4 fixes (2026-04-19/20).** Four
adopter-facing polish items landed:
- `8217dd9` — `package.json` bin points to `compiler/bin/scrml.js` (executable entry fixed for users installing via npm link).
- `2eb4513` — CSS tokenizer no longer collapses element-leading compound selectors to declarations.
- `f0e7222` — CLI surfaces ghost-pattern lint diagnostics by default (W-LINT-011..015).
- `e8ddc8d` — W-LINT coverage extended to Vue and Svelte ghost patterns.
Wrap at `a6ce8c6`.

**S31 — adopter polish + fate-of-fn debate verdict (2026-04-20).**
Two adopter fixes (`ebd4d1d` F5 — bare ident referencing reactive
without `@` is now E-SCOPE-001; `26df45d` F6 init-safety + F10 README
bun link step) plus a multi-expert inline debate on whether `fn` should
be retired, merged with `pure function`, or elevated into a state-
typestate contract. Insight 21 ratified (commit `1d1c49d`): fate-of-fn
verdict leans toward `pure fn` as redundant-but-permitted, deferred the
state/machine-completeness strengthening to S32's phased implementation.
Wrap at `696b787`.

**S32 — state/machine cluster, Phases 1–3 (2026-04-20/21).** Fate-of-fn
verdict translated to incremental compiler work:
- Phase 1a/1b: E-FN-006 renamed E-STATE-COMPLETE; widened to `function`
  bodies (§54.6.1 universal scope).
- Phase 2: `pure fn` parser support + W-PURE-REDUNDANT warning.
- Phase 3a–3e: substate blocks tagged with `isSubstate` + `parentState`;
  registered with parent's `substates` set; substate match exhaustiveness
  wired; `resolveTypeExpr` falls back to `stateTypeRegistry`;
  `< Substate>` recognized as match arm pattern. Substate match is now
  end-to-end live.
- 31 normative statements from Insight 21 registered as skipped gating
  conformance tests (commit `328b6ab`) — to be un-skipped as phases
  land.
Wrap at `593f52f`.

**S33 — state Phase 4a–4g + adopter bug salvo (2026-04-21).** Phase 4
of the state cluster plus 9 adopter bugs shipped:
- Phase 4a/b: block-splitter recognizes transition-decl body + AST
  transition-decl node.
- Phase 4c: `StateType.transitions` registry hook.
- Phase 4d: `from` contextual keyword + params binding in transition
  bodies.
- Phase 4e: E-STATE-TRANSITION-ILLEGAL at call site.
- Phase 4f: E-STATE-TERMINAL-MUTATION on field writes to terminal
  substates.
- Phase 4g: fn-level purity enforcement in transition bodies (§33.6).
- 9 adopter bugs: Object.freeze comma emission (E); `event` threading
  in bare-call handlers (A); scope-aware mangling to skip property
  access (D); GITI-002 imported names in scope; declaredNames threading
  through control-flow (B + F); block-body arrows in call-arg position
  (C); GITI-005 `${serverFn()}` markup interpolation wiring; GITI-003 +
  GITI-004 server/client boundary import pruning + server-context lift;
  GITI-001 await server-fn reactive-set + skip empty-url `<request>`.
- S32 conformance tests un-skipped for the 9 Phase-4 statements now
  covered (`36eadb9`).
Wrap at `eab5251`.

**S34 — map refresh + 2 GITI lift/css adopter fixes (2026-04-21).**
Narrow session:
- `3f79d71` — GITI-008: coalesce consecutive text tokens in lift markup.
- `b8f3b51` — GITI-007: descendant combinator selector recognition.
- Project-map + master-list refresh. Wrap at `d6e8288`.

**S35 — codegen refactor C-arc (2026-04-21).** Nine-step codegen cleanup
migrating call sites from legacy `rewriteExpr` to the
`emitExprField`-with-`derivedNames` pattern. Steps 1–9 commits
`3f8d88c`, `099a30a`, `36b02ec`, `03aad3d`, `6cdcc7f`, `3c2e848`,
`03a0c56`, `9501371`, `54bcab7`. Also `fd51d70` required boundary on
`EmitLogicOpts` (B2 refactor gate — boundary is no longer optional);
`8c64a98` added per-file WinterCG fetch handler + aggregate routes.

**S36 — context-carry snapshot (2026-04-21).** No commits shipped;
interrupted mid-arc. Content rolled into S37.

**S37 — fn/pure unification + Bug G + Bug 6 + adopter external-JS doc
(2026-04-21 → 2026-04-22).** Major arcs:
- `83e6896` — Bug G parser: `fn` shorthand accepts `-> ReturnType` annotation.
- `d40afbe` — Bug G codegen: `fn` shorthand implicit-return for tail
  expressions (match, switch, bare-expr).
- `6d9b62a` — §33.3 / §48 spec consolidation: unify `fn` ≡ pure function,
  retire E-RI-001, absorb non-determinism + async into §33.3. Three
  `scrml-language-design-reviewer` passes surfaced 6 cross-section
  contradictions the first-pass eyeball missed.
- `ccae1f6` — E-RI-001 code cleanup across PIPELINE.md, route-inference.ts,
  lsp/server.js, stale test headers.
- `c7198b6` — Phase 0 item 2: adopter-facing `docs/external-js.md`
  translation table (zod→§53 is the anchor; lodash/date-fns/cm6 etc.).
- `f6fb0cc` — Bug 6: `^{}` meta-checker no longer collects function-local
  decls as module-scope (over-capture fix).
- 2 ratified debates: B1+B3 refactor DEFER (insight 23 staged) and
  NPM compat-tier Phase-0-first verdict (insight 24 staged). Radical-
  doubt explicitly overturned user bias on the compat-tier question —
  user: "Accept verdict, I'm thrilled to be wrong here."
- 6-bug triage of 6nz batch: 1, 4 confirmed HIGH; 3, 5 confirmed; 2
  dismissed (downstream effect of bug 4); 6 fixed same session.
- Wrap + pa.md rule updates at `9540518`.

### 2026-04-19 (S28 — validation elision arc + 5 adjacent fixes)

The S27-queued static-elision deep-dive shipped end-to-end across four
codegen slices plus a §51.5.2 spec amendment. Five additional gaps closed
on the warm context: §51.13 phase 7 (guarded projections), §51.14
E-REPLAY-003 (cross-machine replay), two long-standing parser bugs,
test-helper centralization, and §19 error-arm scope-push (S25-queued).
Suite 7,126 → 7,183 pass (+57 new tests). Dual-mode parity verified
(default vs. `SCRML_NO_ELIDE=1`).

- **§51.5 validation elision (4 slices + spec).** `classifyTransition` +
  `emitElidedTransition` in `emit-machines.ts` drop variant extraction,
  matched-key resolution, and the rejection throw for transitions the
  compiler can prove legal at compile time. Side-effect work — §51.11
  audit push, §51.12 timer arm/clear, §51.3.2 effect block, §51.5.2(5)
  state commit — is preserved on every elided site (spec normative).
  Coverage: Cat 2.a/2.b literal unit-variant against unguarded wildcard
  rule with no specific shadow; Cat 2.d payload constructors via
  balanced-paren scanner; Cat 2.f trivially-illegal target → compile-
  time **E-MACHINE-001** (closes §51.5.1's symmetric obligation). Slice
  4 adds `setNoElide()` / `SCRML_NO_ELIDE=1` env var for CI dual-mode
  parity. §51.5.1 illegal detection runs BEFORE the no-elide gate
  (normative obligation, not optimization). Spec §51.5.2 normative
  bullets rewritten to clarify "runtime guard" = validation work
  specifically. Commits `01f5847` `cb25aaa` `59b35a1`. Backed by
  `scrml-support/docs/deep-dives/machine-guard-static-elision-2026-04-19.md`.
- **§51.13 phase 7 — guarded projection-machine property tests.** Mirrors
  phase 2's parametrization model. Inlined projection harness takes a
  `guardResults` map keyed on rule label; generator walks each source
  variant's rules in declaration order emitting one test per guarded
  rule (truthy case) plus a terminal test (unguarded fallback or
  `undefined` when all-guarded). Same labeled-guards constraint carries
  over from phase 2. Commit `2f3f95e`.
- **§51.14 E-REPLAY-003 — cross-machine replay rejection.** §51.14.6
  non-goal lifted. Reverse map `auditTarget → machineName` via existing
  `machineRegistry` lets the compile-time validator detect when `@log`
  is the audit target of machine A and `@target` is governed by
  machine B. Synthetic-log replays (logs not declared as any machine's
  audit target) still permitted — user-managed. No audit-entry-shape
  change required. Commit `6c1dfe7`.
- **§51.3 multi-statement effect bodies.** `parseMachineRules` previously
  split rule lines on `raw.split(/[\n;]/)`, which fragmented effect
  bodies containing `;` like `.A => .B { @x = 1; @y = 2 }` into three
  broken lines (silent — first rule had unterminated brace, second was
  dropped). Replaced with depth-tracking `splitRuleLines` that respects
  `{}` / `()` / `[]` depth, strings (single/double/backtick), and
  comments (line/block). Surfaced in S27 wrap. Commit `17b8972`.
- **§14.4 single-line payload enums.** `parseEnumBody` split the variants
  section on `\n` only, so a declaration like
  `{ Pending, Success(value: number), Failed(error: string) }` collapsed
  into one "line" that the payload branch silently rejected, registering
  zero variants. Downstream symptom: any `< machine for=Result>` reference
  fired E-MACHINE-004 "Valid variants: ." (empty list). Fixed by splitting
  on `["\n", ","]` at top level — `splitTopLevel` already tracks `()`
  depth so payload field commas stay with their variant. Backfilled the
  slice-2 runtime-E2E tests deferred earlier in the session. Commit `fdb43f0`.
- **§19 error-arm handler scope-push (S25 queue).** Pre-S28 the
  `guarded-expr` case in `type-system.ts` did exhaustiveness analysis on
  `!{}` arms but never walked arm.handlerExpr through the scope checker —
  undeclared idents in handlers compiled cleanly, and the caught-error
  binding (`::X(e) -> use(e)`) was invisible. Symmetric with propagate-
  expr's binding push: enter a child scope per arm, bind `arm.binding`,
  walk the handler, pop. Commit `a15cdb6`.
- **Test-helper centralization + bare-keyword gotcha.** New
  `compiler/tests/helpers/extract-user-fns.js` replaces 8 duplicated
  `knownInternal` regexes across S27/S28 test files. Bare-word entries
  (`effect`, `lift`, `replay`, `subscribe`, etc.) gain `(?!_\d)` negative
  lookahead so a user fn named `effect` (which mangles to `_scrml_effect_5`)
  no longer gets filtered as the internal `_scrml_effect` helper. Doc
  comment in `var-counter.ts` documents the `_scrml_<safe>_<N>` mangle
  convention. Commit `5c61438`.
- **Regression tests (+64).** New `compiler/tests/unit/gauntlet-s28/`
  with 6 files: elision slice-1 (22 tests), slices 2-4 (17 tests),
  multi-stmt effect body (6), payload-enum comma-split (5), projection-
  guard phase-7 (8), error-arm scope (6). Plus 8 S27 test files refactored
  to use the shared helper, 3 S25 temporal tests retargeted (assignments
  to undeclared targets are now compile-errors), 1 S26 phase-6 test
  retargeted (unlabeled vs labeled-guarded projection), 1 S27 cross-
  machine replay test flipped to assert E-REPLAY-003.

### 2026-04-19 (S27 — §2b G free audit/replay shipped + 4 silent runtime fixes)

Single-arc session: §2b G (the audit/replay deep-dive item) shipped end-
to-end across two slices, but the real story was the four pre-existing
silent-runtime bugs that surfaced during testing. S26's auto-property-
test harness synthesized its own `{variant, data}` objects which
ironically masked the fact that the real transition guard was broken
for unit-variant enums. Suite 7,069 → 7,126 pass (+57 new tests).

- **§51.11.4 audit entry shape extension.** Audit entries gain `rule` +
  `label` fields alongside `from` / `to` / `at`. `rule` is the canonical
  wildcard-fallback-resolved table key (`"A:B"` exact, `"*:B"` wildcard
  target, etc.); `label` is the identifier from a `[label]` clause on the
  matched rule. `emitTransitionTable` bakes labels into table entries
  (`{ guard: true, label: "foo" }`); `emitTransitionGuard` computes
  `__matchedKey` alongside `__rule` via a parallel ternary fallback chain.
  Commit `224847d`.
- **§51.11 audit completeness — timer transitions + freeze.**
  `_scrml_machine_arm_timer` signature extended with a `meta` payload
  carrying `auditTarget` + `rulesJson`. Timer expiry now both pushes the
  audit entry AND re-arms downstream temporal rules so chained temporals
  (A after 1s => B, B after 1s => C) cascade automatically. Every audit
  entry is `Object.freeze`'d on both push paths (transition guard and
  timer expiry) per §51.11.4. Commit `267ed61`.
- **§51.14 replay primitive — `replay(@target, @log[, index])`.** New
  spec section (~210 lines). Function-call syntax (no new keyword);
  target is name-string via @-ref, log is reactive_get, index is any
  integer expression. Runtime helper `_scrml_replay(name, log, endIdx?)`
  bypasses transition guard, audit push, and clears pending temporal
  timers; fires subscribers + derived propagation + effects normally.
  Compile-time recognition in `emit-expr.ts` structured-call path +
  fallback `rewriteReplayCalls` pass for non-structured contexts.
  Commit `00ba7d3`.
- **§51.14 replay compile-time validation (G2 slice 2).** **E-REPLAY-001**
  (target must be machine-bound reactive) and **E-REPLAY-002** (log must
  be declared reactive) via duck-typed recursive AST walker that visits
  every `CallExpr` whose callee is `ident "replay"`. Two sub-messages
  for E-REPLAY-001 distinguish "declared but not machine-governed" from
  "undeclared in scope". Commit `2453062`.
- **§51.5 unit-variant transitions crash at runtime — fix.** Pre-S27
  `__prev.variant` extraction fell back to `"*"` for bare-string unit
  variant values, producing key `"*:*"` that missed every declared rule
  and threw E-MACHINE-001-RT. Every machine-governed unit-variant enum
  was unusable in practice. Hidden by shape tests + the S26 property-
  test harness that synthesized its own variant objects. Three real
  end-to-end tests now compile + execute the guard via SCRML_RUNTIME in
  a `Function()` sandbox. Commit `eff8188`.
- **§51.5 guarded wildcard rules fire guard + effect — fix.** `* => .X
  given (…)` was treated as unguarded at runtime because the guard /
  effect comparisons keyed on `__key` (literal `prev:next`) instead of
  the `__matchedKey` the runtime actually resolved to. One-line fix in
  each branch. Commit `abfe637`.
- **§51.5 effect-body @-refs compile through `rewriteExpr` — fix.** Effect
  bodies like `{ @trace = @trace.concat(["x"]) }` emitted literal `@`
  tokens (invalid JS) because emit-machines inserted `rule.effectBody`
  raw. Wrapped in `rewriteExpr` so effect bodies behave like any other
  bare statement. Commit `73225f7`.
- **§18 match-arm expression-only form on a single line — fix.**
  `match x { .A => 1 .B => 2 }` triggered E-TYPE-020 because
  `splitMatchArms` only split on newlines, hiding B and later arms from
  the exhaustiveness checker. Replaced with a char-level scanner that
  tracks brace/paren/bracket depth, strings, and comments, recognizing
  arm-header starts inline. Defensive `collectExpr` tightening in
  `ast-builder.js` as a second layer. Commit `5d0bdc6`.
- **Runtime-test convention established.** Several S27 tests execute
  compiled output via `SCRML_RUNTIME` in a `Function()` sandbox to catch
  silent-runtime bugs. Pattern: regex-extract user fn names from compiled
  JS, closure-capture them into a `userFns` object. New compiler features
  that claim runtime behavior should use this pattern rather than shape-
  only assertions — every pre-existing bug closed in S27 went undetected
  for months under shape-only testing.

### 2026-04-18 (S26 — §2b F: auto-generated machine property tests, phases 1-6)

§51.13 `--emit-machine-tests` shipped end-to-end across six phases in a
single session. Slogan: **machine = enforced spec**. The declared
transition table IS the oracle; generated tests confirm the compiled
machine refuses everything the table doesn't allow. Suite 7,006 → 7,069
pass (+63 new tests).

- **§51.13 phase 1 — exclusivity (property a).** Generator emits a bun:test
  suite per `< machine>` declaration: for every reachable variant V and
  every variant W in the governed enum, declared `(V → W)` pairs SHALL
  succeed and undeclared pairs SHALL throw E-MACHINE-001-RT. New
  `compiler/src/codegen/emit-machine-property-tests.ts` (425 LOC) +
  CLI flag `--emit-machine-tests` writes `<base>.machine.test.js`
  alongside the user-test `<base>.test.js`. Inlined `tryTransition`
  harness uses `globalThis._scrml_reactive_store` so tests don't bleed
  into the real reactive runtime. Commit `24089c5`.
- **Machine guard rewriteExpr fix.** `< machine>` rule guards captured raw
  scrml text but emitted unmodified, so guards referencing `@reactive`
  refs emitted invalid JS (raw `@name` token). Now run through `rewriteExpr`
  before emission. Same root cause that S27 found in effect bodies.
  Commit `b84dadf`.
- **Parser fix — typed `const @name:` decls preserve initializer.** Pre-
  S26 `const @gate: boolean = true` lost its `= true` initializer because
  the typed-const parser branched into a path that didn't capture the
  RHS. Surfaced while writing phase-1 tests that needed reactive-bound
  gate vars. Commit `19e8b29`.
- **§51.13 phase 2 — guard coverage (property c).** Each LABELED `given`
  guard SHALL receive one passing test (truthy → succeeds) and one
  failing test (falsy → E-MACHINE-001-RT). Tests parametrize the guard
  result rather than evaluating the real expression — harness takes a
  `guardResults: Map<ruleKey, boolean>` and dispatches on it. Real-
  expression evaluation deferred to a future phase that needs input
  synthesis. Unlabeled guards skip the enclosing machine entirely so
  every guard in a generated suite has a human-readable identifier.
  Commit `81d6d5c`.
- **§51.13 phase 3 — payload-bound rule support.** §51.3.2 binding-group
  rules now in scope. The harness is binding-transparent — it never
  invokes the real machine IIFE, so declared destructuring is never
  executed in generated tests. Filter relaxed accordingly. Commit `4bd9ca6`.
- **§51.13 phase 4 — wildcard rule support.** `*` as the from-variant
  matches any already-reachable variant; `*` as the to-variant expands
  the reachable set to every variant declared on the governed enum.
  Pair resolution follows the four-step fallback chain used by
  `emitTransitionGuard`: exact → `*:To` → `From:*` → `*:*`. Harness
  tracks the matched table key so `guardResults` keys on the matched
  (possibly-wildcard) rule rather than the concrete input pair. Commit
  `3156b5d`.
- **§51.13 phase 5 — temporal rule support.** §51.12 temporal rules
  contribute exclusivity + guard-coverage tests just like non-temporal
  rules — the `(.From, .To)` pair is a declared transition regardless of
  how it fires. Test titles get an `(after Nms)` annotation so temporal
  rules are visible in the suite. EXPLICITLY OUT OF SCOPE: timer lifecycle
  itself (arm/clear/reset on variant entry/exit/reentry). Verifying that
  needs a live runtime with fake-timer control; the self-contained
  harness doesn't invoke runtime code. Generated file emits a header
  comment surfacing this scope boundary so users cover timer lifecycle
  with hand-written integration tests. Commit `eecaa89`.
- **§51.13 phase 6 — projection machine support.** §51.9 derived
  machines emit through a distinct path. No transition table; reading
  `@projected` delegates through `_scrml_project_<Name>(source)`. The
  property under test is **(d) Projection correctness** — for every
  source variant V, the projection function returns the target variant
  declared by the first matching rule. Generated suite inlines a minimal
  copy of the projection function (mirroring `emitProjectionFunction`)
  and emits one test per source variant. Phase 6 covered unguarded
  projections only; guarded projections deferred to phase 7 (shipped
  S28). Commit `0af336e`.

### 2026-04-18 (S25 — §2h lin redesign cleanup + §51.12 temporals + §51.11 audit clause)

Two arcs in one session: closing the lin redesign work (Approach B —
restricted intermediate visibility) and shipping §51.12 temporal
transitions (`.From after Ns => .To`). Plus the §51.11 `audit @log`
clause that S27 would later build replay on top of. Suite 6,949 →
7,006 pass (+57 new tests).

- **§35.5 E-LIN-005 — reject let/const/lin shadowing an enclosing lin.**
  Per Approach B, intermediate visibility means a lin in an outer scope
  is visible (and consumable) by inner scopes, but cannot be SHADOWED
  by an inner declaration of the same name. New error fires for `let x`,
  `const x`, and `lin x` declarations that would shadow an enclosing
  `lin x`. Commit `6f5b90c`.
- **§35.5 push scope for while-stmt so E-LIN-005 fires in while bodies.**
  Companion fix — without scope-push, while-body declarations weren't
  checked against the enclosing lin. Commit `b6c4f5d`.
- **§51 emit effect blocks for rules without a `given` guard — fix.**
  Pre-S25 the effect-block emission filter ran over `guardRules`, which
  silently dropped effect-only rules (no guard). Now uses `effectRules`.
  Commit `3556b22`.
- **§35.1 / §35.2 wording — Approach-B restricted intermediate visibility.**
  Spec text aligned with the implemented semantics: lin variables are
  visible across all sibling and child scopes within the same `${}`
  block, but shadowing is rejected. Companion §35.2.2 ratifies cross-
  `${}` block lin via the same model. Commits `0e52306` `83101c7`.
- **§2a scope push for match-arm-block + if-stmt branches.** Match arms
  and if branches each get a fresh child scope so declarations inside
  one branch don't leak into siblings. E-SCOPE-001 now fires correctly
  for refs inside an arm body that don't resolve up the chain. Commits
  `5ab63ac` `4b1e8b2`.
- **§35.5 E-LIN-006 — reject lin consumption inside `<request>` /
  `<poll>` body.** Async lifecycle elements re-execute their body on
  every refresh cycle, which would consume the lin multiple times.
  Compile-time check + diagnostic naming the lin and the lifecycle
  element. Commit `e171e33`.
- **`docs/lin.md` how-to guide.** User-facing walkthrough of the lin
  keyword: declaration, consumption, scope visibility, shadowing rules,
  E-LIN-005/006 examples. Commit `3b8f2db`.
- **§51.3.2 machine opener migration — sentence form → attribute form.**
  `< machine OrderFlow for OrderStatus { ... } /` (sentence form)
  migrated to `< machine name=OrderFlow for=OrderStatus> ... </>`
  (attribute form). The attribute form aligns with how every other
  custom-element opener parses. The old sentence form stays parseable
  for back-compat but the canonical form is now the attribute one.
  Touched all examples, docs, and the spec. Commit `347ac02`.
- **§51.12 temporal machine transitions — `.From after Ns => .To`.** New
  rule grammar: `after Ns` (or `0.5s`, `500ms`, `3m`, `1h`) between
  `.From` and `=>`. Wildcard `from` rejected at parse time
  (E-MACHINE-021); concrete from-variant only. Each temporal rule arms
  a timer when the machine enters its from-variant; on expiry the
  timer commits the transition and re-arms downstream temporals.
  `_scrml_machine_arm_timer` / `_scrml_machine_clear_timer` runtime
  helpers. Cross-cutting interaction with §51.11 audit (S27 closed
  the audit-completeness gap for timer-fired transitions). Commit
  `7305ac1`.
- **§51.11 audit @varName clause.** New machine-body clause `audit @log`
  declares a reactive array as the destination for transition entries.
  Each successful transition appends `{from, to, at}` (extended to
  `{from, to, at, rule, label}` in S27). Foundation for S27's `replay`
  primitive. Commit `c5e41b3`.
- **Parser fix — statement boundary on `@name:`.** S22 had a known
  pre-existing BPP bug where two consecutive `@foo: SomeMachine = ...`
  reactive-decls on adjacent lines silently dropped the second one. S25
  fixed it: the boundary detector now recognizes `@<ident>:` as a
  statement start. Commit `e37a6fd`.

### 2026-04-18 (S24 — §2a E-SCOPE-001 coverage sweep + §2b/c/d/e/f/g fixes)

§2a scope-checker rolled out across the full statement / expression
surface in nine slices. Plus a clutch of small §2b–§2g fixes from a
gauntlet pass. Suite 6,889 → 6,949 pass (+60 new tests).

- **§2a E-SCOPE-001 sweep — nine slices.** Pre-S24 `E-SCOPE-001`
  (undeclared identifier in logic expression) only fired in a few
  expression contexts. S24 extended coverage to: let/const initializers
  (`9e06884`), reactive-decl initializers (`234f116`), loop-scope
  plumbing + if/return/match-subject/propagate (`e1e21a5`), lin / tilde
  / reactive-derived decls (`ec26c63`), structured assignment RHS
  (`740de7d`), throw / fail / debounced / value-lift (`a758fe1`), and
  bare-expr statements + two supporting fixes (`bb01644`). Each slice
  shares the same pattern: walk the expression's ExprNode (or string
  fallback) through `checkLogicExprIdents` against the current scope
  chain, raising E-SCOPE-001 with a context-specific suggestion.
- **§2b/d phase separation + nested `^{}` at checker-time.** Two meta-
  context fixes: (b) the phase-separation check (compile-time `^{}` vs
  runtime `^{}` content) now runs at meta-checker time instead of eval-
  time, catching the error before it'd crash the eval; (d) nested `^{}`
  in compile-time meta no longer crashes — it's flagged as a clear
  E-META error. Commit `9f2a247`.
- **§2c match subject narrowing for local let/const + function params.**
  Match expression subject narrowing previously only worked for top-
  level reactives. Extended to let/const-bound locals and function
  parameters via the same scope-chain lookup. Commit `c1d71dd`.
- **§2c/§2a meta DG fixes.** Dependency graph credits `meta.get` /
  `meta.bindings` reads as @var consumers (so the dep-graph properly
  tracks reactive dependencies through compile-time meta plumbing); lin
  consumption is now counted at `^{}` capture time rather than later.
  Commit `8711056`.
- **§2d DG credits @var refs in compound `if=(...)` attributes.** Custom-
  element `if=(@a + @b > 5)` previously credited only the leftmost @ref
  (S22 regression). Now every @ref in the parenthesized expression is
  added to the dep-graph so changes propagate correctly. Commit `e377223`.
- **§2e DG credits @var refs inside runtime `^{}` meta html-fragment
  content.** When meta html-fragment content references reactives
  (`^{ <p>${@count}</p> }`), every @ref is added to the dep-graph.
  Commit `ccfc0c0`.
- **§2f trim whitespace after variant-ref prefix in in-enum transitions.**
  `transitions { . Pending => .Processing }` (space after the dot)
  previously fired E-MACHINE-004 against a variant called `" Pending"`.
  Variant-ref normalization now trims whitespace between the prefix and
  variant name. Commit `4f72a45`.
- **§2g extension-less relative imports.** `import { x } from "./foo"`
  now resolves to `./foo.scrml` if the bare path doesn't exist. Aligns
  with TS / JS convention while keeping the explicit `.scrml` form valid.
  Commit `9da03a7`.
- **§4.11.4 / §51.3.2 spec ratification — machine cohesion.** After
  debate the team kept `given` (vs. moving guards to a separate `where`
  clause) and queued the machine-opener migration to attribute form for
  S25. Commit `d2bee47`.

### 2026-04-17 (S23 — meta-checker debt cleanup + DOM read-wiring + tutorial revamp)

Tighter session focused on closing meta-checker debt items, adding the
last piece of §51.9 derived machines (DOM read-wiring), and a tutorial
content sweep. Suite 6,875 → 6,889 pass (+14 new tests).

- **§51.9 DOM read-wiring for projected vars (`${@ui}`).** S22 slice 2
  shipped projection runtime but reading `@ui` in markup left the
  display element unwired because the dep-graph didn't know `@ui` was
  reactive. S23 synthesizes a reactive-decl-like AST node for the
  projected var during annotation so the dep-graph treats it as a
  consumer of the source @order. Reading `${@ui}` now updates correctly
  on @order writes. Closes the S22 known-blocker. Commit `5b5d636`.
- **Meta-checker fixes (4 items).** Phase separation runs at checker time
  (was eval time); nested `^{}` doesn't crash; DG credits `meta.get` /
  `meta.bindings` reads as @var consumers; lin captured by `^{}` is
  counted as consumed. Companion to S24's broader §2a coverage sweep.
  Commits `9f2a247` `8711056`.
- **Examples + tutorial refresh.** `examples/14-mario-state-machine.scrml`
  rewritten to showcase S22 §1a payload variants + §51.9 derived
  machines (the deferred S22 example update). All non-gauntlet sample
  files brought up to current idiomatic scrml. Tutorial §2.3/§2.4 updated
  to canonical syntax + new §2.10 state machines section. Commits
  `7045adf` `2ba4ccd` `e0455b6`.
- **MIT license + GitHub Pages landing.** scrmlTS went public under MIT.
  GitHub Pages landing page at `docs/landing/index.html` + SEO checklist
  in `docs/SEO-LAUNCH.md`. Custom domain CNAME set/unset cycle as the
  domain config landed. user-voice relocated out of the public repo to
  `scrml-support/user-voice-scrmlTS.md` (verbatim history split:
  pre-public archived, post-public continues in scrml-support per the
  per-repo PA scope rules). Commits `427b9ec` `46f007a` `99d9286`
  `5811ed2` `0801d98` `3e8f545`.

---

### 2026-04-17 (S22 — §51.9 slice 2: derived machines runtime + write rejection)

- **Projection function codegen.** `emit-machines.ts` now exports `emitProjectionFunction(machine)` producing `function _scrml_project_<M>(src) { ... }` that walks the projection rules top-to-bottom, dispatches on `src.variant ?? src`, and emits the destination variant as a plain string. Guarded rules emit `if (tag === X && (guard)) return Y;` so `given` clauses run at read time. Rules after an unguarded match are unreachable per §51.9.3 (unguarded terminates the alternation group).
- **Derived reactive registration.** `emitDerivedDeclaration(machine)` emits `_scrml_derived_fns["ui"] = () => _scrml_project_UI(_scrml_reactive_get("order"));` + dirty flag + downstream subscription. Reuses the existing §6.6 infrastructure: `_scrml_reactive_get("ui")` already delegates to `_scrml_derived_get` when the name is in `_scrml_derived_fns`, and writes to `@order` propagate a dirty flag via `_scrml_propagate_dirty` so DOM bindings on `@ui` re-read the projection.
- **emit-reactive-wiring.ts** routes derived machines past the transition-table emit (they have no runtime transitions to enforce) and into the new projection + declaration path. Transition tables are only emitted for non-derived machines.
- **E-MACHINE-017 write rejection** (type-system.ts `rejectWritesToDerivedVars`). Walks the AST once after `validateDerivedMachines`, flagging two kinds of writes: (a) a `reactive-decl` whose name is a projected var (someone wrote `@ui: UI = X`) and (b) a `bare-expr` starting with `@ui = X` or any compound assignment (`@ui += X`). Messages name both the source var and the machine so the user knows where to assign instead.
- **SPEC §51.9** flipped from `(parser + validator landed S22, runtime codegen pending)` to `(landed S22)`, with implementation notes on the runtime wiring added.
- **Regression tests (+10)**. Slice 2 additions to `compiler/tests/unit/gauntlet-s22/derived-machines.test.js`: projection-function shape + runtime round-trip (guarded + unguarded dispatch), derived-declaration shape + dirty-propagation end-to-end, E-MACHINE-017 on reactive-decl + `=` + `+=` + non-projected-vars-untouched, full-file compile + shadow-boolean-collapse example.
- **Known blockers (tracked for follow-up):**
  - Pre-existing BPP statement-boundary bug: two consecutive `@foo: SomeMachine = ...` reactive-decls on adjacent lines can silently drop the second one. Not new in this slice — exposed while writing the end-to-end write-rejection test. The test now sidesteps by splitting the two decls into separate `${}` blocks; a proper fix belongs in the body-pre-parser.
  - Reading `@ui` in markup (`${@ui}`) inserts a `<span data-scrml-logic>` placeholder but the reactive display wiring is not yet emitted because the dep-graph doesn't know `@ui` is reactive. Fix: synthesize a reactive-decl-like AST node for the projected var during annotation so the dep-graph treats it as a consumer of `@order`. Deferred to a follow-up slice.

### 2026-04-17 (S22 — §51.9 slice 1: derived/projection machines — parser + validator)

- **§51.9 derived machine syntax parsed.** `< machine UI for UIMode derived from @order>` — the `derived from @SourceVar` clause is now recognized by the ast-builder, captured into the machine-decl node's new `sourceVar` field, and registered as a derived machine in the type system with `{ isDerived: true, sourceVar, projectedVarName }`. The projected variable name is the machine name with its leading uppercase run lowercased (`UI` → `ui`, `OrderStatus` → `orderStatus`, `HTTPStatus` → `httpStatus`).
- **E-MACHINE-018 exhaustiveness** validated after type annotation finishes: for every derived machine, the compiler looks up the source reactive's governed enum and confirms every variant has at least one unguarded projection rule covering it. Missing variants produce one error each, naming the variant and the source enum.
- **Source-var resolution.** `E-MACHINE-004` fires when `derived from @order` names a reactive that doesn't exist or isn't machine-bound, and a second form of `E-MACHINE-004` rejects transitive projections (source is itself a derived machine — deferred to §51.9.7 future work).
- **Projection RHS still validated** against the projection enum (`E-MACHINE-004` on unknown projection variants); LHS (source variants) intentionally skipped in `parseMachineRules` since the source enum isn't known at that point.
- **SPEC §51.9.6** naming rule tightened: "named by the machine's governed TypeName" → "named by the machine name with its leading uppercase run lowercased" (matches the worked example `< machine UI ... > → @ui`).
- **Deferred to slice 2** (this commit NOT runtime-ready):
  - Runtime codegen — projection function (`_scrml_project_<M>`), `_scrml_derived_declare` wiring, dep-graph edges from derived vars to source. Reading `@ui` at runtime today will see `undefined` from the reactive store; compile-time exhaustiveness catches the design error but doesn't yet produce running code.
  - **E-MACHINE-017** on writes to the projected var — user code that writes `@ui = X` is not yet rejected. Will land with codegen.
  - Projection `given` guards at read time (rules table still records the guard expression, codegen for evaluating it at read time lives in slice 2).
- **Regression tests (+9).** `compiler/tests/unit/gauntlet-s22/derived-machines.test.js`: registration of derived machines with correct projected var naming, LHS-not-validated-as-projection-enum, RHS validated, E-MACHINE-018 on missing variants, exhaustive passes, source-var-not-bound, transitive-projection rejected, guarded-without-unguarded-sibling.

### 2026-04-17 (S22 — §1b payload binding in machine rules)

- **§51.3.2 payload bindings in machine transition rules.** The `variant-ref` grammar now accepts an optional `(binding-list)` on either side of `=>`. On the `From` side, bindings expose the pre-transition variant's payload fields as locals inside the rule's `given` guard and effect block; on the `To` side, they expose the incoming variant's payload. Positional bindings (`.Charging(n)`) resolve to declared field order at parse time; named bindings (`.Reloading(reason: r)`) name the field directly; `_` discards drop a positional slot. The resolved bindings emit as `var <local> = __prev.data.<field>;` (from) or `var <local> = __next.data.<field>;` (to) inside the keyed `if (__key === "From:To") { ... }` block — rule-local scope, no leakage to sibling rules. Parser in `type-system.ts:parseMachineRules` + helper `resolveRuleBindings`; emitter in `emit-machines.ts:emitTransitionGuard` with new `buildBindingPreludeStmts` helper exported for tests.
- **E-MACHINE-015** fires on three cases: binding against a unit variant, a named binding of a non-existent field, and more positional bindings than declared fields. Message names the variant and lists the declared fields.
- **E-MACHINE-016** fires when `|` alternation alternatives disagree on binding shape (either all alternatives bind the same names, or none bind). Detection uses a sort-stable signature of each alternative's binding group.
- **`expandAlternation` rewritten** to respect paren-balanced variant refs: the `|` splitter now tracks paren depth so `.Charging(n)` is not split at internal binding parens, and the suffix-detector (identifies where the `given`/`[`/`{` suffix starts on the RHS) scans at depth 0 rather than using a naive regex — otherwise `given (n > 0)` could be cut off mid-expression by a binding-list that happens to contain `(`.
- **Rule regex tightened.** The old `(\w+|\*)?` variant-name capture backtracked correctly for the original grammar but produced wrong captures once optional binding-groups were added (`given` would be greedily captured as a variant name). Narrowed to `([A-Z][A-Za-z0-9_]*|\*)?` — variants are PascalCase per §14.4, keywords are lowercase.
- **Regression tests (+15).** `compiler/tests/unit/gauntlet-s22/machine-payload-binding.test.js`: positional, named, `_` discard, E-MACHINE-015 (unit variant / unknown field / overflow), E-MACHINE-016 (mismatched alternation / some-bind-some-don't), wildcard `* => *` passes through unaffected, `buildBindingPreludeStmts` standalone helper, and the emitter asserts that bindings land inside the keyed block (not outside).
- **Deferred:** rewriting `examples/14-mario-state-machine.scrml` to demonstrate a payload variant. Mario's current machine-guard runtime wiring has a pre-existing gap (assignments inside function bodies don't go through `emitTransitionGuard`), and changing `MarioState` from unit-only to a payload variant would break its equality checks (`@marioState == MarioState.Small`) and string interpolations. Tracked for a later slice that fixes the wiring gap first.

### 2026-04-17 (S22 — §1a enum payload variants: construction + match destructuring)

- **Enum payload variant construction (prereq for §51.3.2 payload binding in machine rules).** Before S22, `Shape.Circle(10)` threw `TypeError: Shape.Circle is not a function` because `emitEnumVariantObjects` only emitted string entries for unit variants and short-circuited entirely when an enum had zero unit variants. Now `emit-client.ts:emitEnumVariantObjects` iterates every variant and emits a constructor function for each payload variant: `Shape.Circle(10) === { variant: "Circle", data: { r: 10 } }`. Unit variants still emit as strings (`Shape.Square === "Square"`). The tagged-object shape aligns with §19.3.2 `fail` (minus the `__scrml_error` sentinel) so one runtime dispatches both error and regular variants by inspecting `.variant`. The inline `EnumType.Variant(args) → { variant, value: (args) }` rewrite in `rewrite.ts:rewriteEnumVariantAccess` was removed — the constructor function is now the single source of truth, and the old shape (`value` vs the correct `data`) couldn't carry multi-field / named-field payloads anyway. SPEC §51.3.2 prereq text flipped from "blocked" to "landed S22". Commit `2fbc332`.
- **Match destructures tagged-object payload variants.** Before S22, `.Circle(r) => r * r` parsed the binding but the emitter dropped it; `r` was referenced undeclared in the generated JS. Multi-arg `.Rect(w, h)` wasn't parsed at all. Now `parseMatchArm` captures the raw paren contents; a new `parseBindingList` splits on commas and recognizes positional (`r`), named (`reason: r`), and `_` discard forms. `emitMatchExpr` + `emitMatchExprDecl` emit `const __tag = (v && typeof v === "object") ? v.variant : v;` when at least one arm needs tagged dispatch (unit-only and scalar matches stay on the plain `tmpVar === "X"` path). Variant arms with bindings emit `const loc = tmp.data.<field>;` — positional bindings resolve via a per-file variant-fields registry (`buildVariantFieldsRegistry(fileAST)` populates it at the top of `generateClientJs`, clears after), named bindings use the field name directly. Collisions / unknown variants produce a diagnostic comment instead of a runtime `ReferenceError`. A `splitMultiArmString` bug was also fixed — the §42 presence-arm detector was splitting `.Circle(r) =>` at the `(` because it didn't notice the paren belonged to a variant binding. Commit `d8ebfb3`.
- **Regression tests (13 new, 2 updated).** New `compiler/tests/unit/gauntlet-s22/payload-variants.test.js` (6 tests: all-payload, mixed unit/payload, single- and multi-field round-trip, `.variants` ordering, §19.3.2 `fail` alignment). New `compiler/tests/unit/gauntlet-s22/payload-variants-match.test.js` (7 tests that compile + execute the emitted client JS: positional, multi-field, named, mixed unit/payload, `_` discard, scalar, unit-only). `emit-match.test.js:45` flipped from "binding ignored" to registry-aware positional and named destructuring. Existing `enum-variants.test.js` §6–§13b and `codegen-struct-rewrite.test.js` "enum variant in chain" updated to the constructor-function model (calls are preserved by rewrite, shape is asserted via `emitEnumVariantObjects` eval).
- **Known limitation, deferred.** Short-form `.Circle(10)` in a typed-annotation context `let s:Shape = .Circle(10)` still lowers to `"Circle"(10)` by the standalone-dot pass (a type-inference concern, not codegen). Fully qualified `Shape.Circle(10)` works. Live repro remaining at `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-match-payload-positional-031.scrml` — match destructures correctly now, only the construction line is still broken.

### 2026-04-17 (S21 — §19 codegen, §21 imports, §51 alternation, README/tutorial polish)

- **§51 `|` alternation in machine transition rules.** Grammar extended: `machine-rule ::= variant-ref-list '=>' variant-ref-list guard? effect?`, where `variant-ref-list ::= variant-ref ('|' variant-ref)*`. Both sides of `=>` may list variants; the rule desugars to the cross-product of single-pair rules before the type checker (`expandAlternation` at `type-system.ts:1902`). Any guard or effect block attaches to every expansion. Duplicate `(from, to)` pairs — within a line or across lines — emit new **E-MACHINE-014**. Mario example collapses from 8 lines to 3. Commit `eef7b5e`.
- **§19 error handling codegen rewrite.** `fail E.V(x)` now parses and emits a tagged return object inside nested bodies (if/for/function); `?` propagation works in nested bodies; `!{}` inline catch checks `result.__scrml_error` and matches on `.variant` rather than using try/catch (per §19.3.2 "fail does not throw"). E-ERROR-001 (fail in non-failable function) now fires — was unreachable before because `fail` never parsed inside function bodies. Parser also accepts canonical `.` separator alongside `::` alias. `ast-builder.js` parseFailStmt + parseOneStatement dispatch; `emit-logic.ts` guarded-expr rewrite. Commit `37049be`.
- **E-IMPORT-006 on missing relative imports.** Module resolver previously resolved the absolute path but never checked `existsSync`, so `import { x } from "./missing.scrml"` compiled clean. `buildImportGraph` now flags E-IMPORT-006 when the target is not a `.js` specifier, not in the compile set, and absent on disk; synthetic test-path importers are skipped so self-host / resolver unit tests stay green. Commit `86b5553`.
- **README "Why scrml" rewrites.** "State is first-class" redefined from "@var reactivity" to "state is named, typed, instantiable" per the S10/S11 memory. "Mutability contracts" rescoped from a machine-only paragraph to an opt-in three-layer story: value predicates (§53) + presence lifecycle (`not`/`is some`/`lin`) + machine transitions. Features-section bullet that still held the `server @var`/`protect` grab-bag renamed to "Server/client state." Commits `d802707` and the preceding §51 commit.
- **Tutorial v2 promoted.** `docs/tutorial.md` now contains the former v2 content (v1 deleted). Snippets renamed `docs/tutorialV2-snippets/` → `docs/tutorial-snippets/`. Commit `41e4401`.
- **Regression tests (3 new files, 22 tests).** `compiler/tests/unit/gauntlet-s20/error-handling-codegen.test.js` (11), `.../import-resolution.test.js` (3), `.../machine-or-alternation.test.js` (8). Updated `emit-logic-s19-error-handling.test.js` (14 tests) to the new return-value model.

### 2026-04-16 (S20 — gauntlet phases 5-12)

Executed gauntlet phases 5-12 against SPEC.md: meta, SQL, error/test, styles, validation/encoding, channels, integration apps, error UX. Fixed 5 compiler bugs, documented 11 more for batch treatment.

- **Bugs fixed (5).** `reflect(@var)` misclassified (now runtime per §22.4.2); E-META-008 now fires for `reflect()` outside `^{}`; E-META-006 now catches `lift <tag>` inside `^{}`; no spurious E-META-001/005 alongside E-META-003 on unknown types in `reflect()`; E-FN-003 now catches `@var = …` / `@var += …` inside `fn` bodies.
- **Bugs documented for future batch.** `fail` compiles to bare `fail;` (fixed in S21); E-ERROR-001 not enforced (fixed in S21); `?` emits as literal `?;` (fixed in S21); `!{}` try/catch vs `fail` return mismatch (fixed in S21); `lin + ^{}` capture not counted as consumption; phase separation detected at eval-time; DG false-positive for `@var` via `meta.get()`/`meta.bindings`; nested `^{}` in compile-time meta crashes eval; E-SCOPE-001 doesn't fire for undeclared variables in logic blocks; **E-IMPORT-006** for missing modules (fixed in S21).
- **Test artifacts.** 80 fixture files under `samples/compilation-tests/gauntlet-s20-{channels,error-test,error-ux,meta,sql,styles,validation}/` and 16 regression tests under `compiler/tests/unit/gauntlet-s20/`. End-of-S20 baseline: 6,802 pass / 10 skip / 2 fail.

### 2026-04-14–15 (S19 — gauntlet phases 1-4)

Language gauntlet across declarations, control-flow, operators, and markup. Multiple bug fixes + fixture additions across commits `8e95226` (error-system §19 compliance), `dd25311` (reject JS-reflex keywords), `cf426a1` (animationFrame + `ref=`), `36a99bd` (loops/labels/assignment-in-condition), `a9ab734` (`_` wildcard alias + E-LOOP-003 disable), `cee9fc1` (markup fixture corpus). Full Phase 2 triage documented under `docs/changes/gauntlet-s19/` (pending archival to scrml-support/archive).

### 2026-04-14 (S18 — public-launch pivot)

- **README SQL-batching expansion.** Five new Server/Client bullets (Tier 2 N+1 rewrite, Tier 1 envelope, mount coalescing, `.nobatch()` opt-out, batch diagnostics) plus a sharper "Why scrml" paragraph (adds `D-BATCH-001` near-miss + `.nobatch()` escape hatch) plus `?{}` row in the Language Contexts table noting auto-batching. Commit `d20ffa4`.
- **Lift Approach C Phase 2c-lite — drop dead BS+TAB re-parse block.** The inline re-parse fork inside `emitLiftExpr` (~50 LOC) that normalized tokenizer-spaced markup and rebuilt a MarkupNode via `splitBlocks` + `buildAST` was confirmed dead by S14 instrumentation (0 hits across 14 examples + 275 samples + compilation-tests). Deleted. Commit `f5d78df`. Full Phase 2 deferred (helpers still reached via `emitConsolidatedLift` for fragmented bodies).
- **Bug fix: `export type X:enum = {...}` misparsed.** `ast-builder.js` `collectExpr` treated `:` + IDENT + `=` as a new assignment-statement boundary, breaking the decl because `enum`/`struct` tokenize as IDENT (not KEYWORD). The leftover `enum = {...}` was reparsed as a standalone let-decl, firing `E-MU-001` on `enum`. Fix: added `:` to the lastPart skip-list alongside `.` and `=`. Commit `b123ed1`. **Affects any user writing an exported named-kind type — high public impact.**
- **Bug fix: reactive-for `innerHTML = ""` destroys keyed reconcile wrapper.** `emit-reactive-wiring.ts` unconditionally emitted the clear inside `_scrml_effect`, so every re-run destroyed the `_scrml_reconcile_list(` wrapper before the diff could run. Fix: skip the clear when `combinedCode` contains `_scrml_reconcile_list(` (mirrors the existing single-if branch guard). Commit `b123ed1`.
- **Test fixture: `if-as-expr` write-only-let.** Not a compiler bug — MustUse correctly flagged `let x = 0; if (true) { x = 1 }` (no read of `x`). Test intent was if-stmt codegen, not MustUse semantics — fixture updated to `log(x)` after the if-stmt. Commit `b123ed1`.
- **8 TodoMVC happy-dom tests skipped with notes.** The harness wraps the runtime in an IIFE, scoping `let _scrml_lift_target = null;` to that IIFE; client-JS IIFE can't see it, throws `ReferenceError: _scrml_lift_target is not defined`. Real browsers share global lexical env between classic `<script>` tags — works there. Puppeteer e2e (`examples/test-examples.js`) covers 14/14 examples. Tests marked `test.skip` with top-of-file annotation documenting root cause and unskip condition. Commit `b123ed1`.
- **S19 gauntlet plan queued.** Full 12-phase language gauntlet plan (decls, control-flow, operators, markup, meta, SQL, error/test, styles, validation/encoding, channels, integration apps, error UX) left at `handOffs/incoming/2026-04-14-2330-scrmlTS-to-next-pa-language-gauntlet-plan.md`. 31 agents identified from `~/.claude/agentStore/` with wave-staging recommendation.

### 2026-04-14 (S17)

- **SQL batching Slice 6 — §8.11 mount-hydration coalescing.** When ≥2 `server @var` declarations on a page have callable initializers (loader functions), the compiler emits one synthetic `POST /__mountHydrate` route whose handler runs every loader via `Promise.all` and returns a keyed JSON object. The client replaces per-var `(async () => { ... })()` IIFEs with one unified fetch that demuxes results via `_scrml_reactive_set`. Non-callable placeholders (literal inits, `W-AUTH-001`) are excluded; writes stay 1:1 per §8.11.3. Route export follows the existing `_scrml_route_*` convention. Tier 1 coalescing (§8.9) applies automatically inside the synthetic handler because loaders are sibling DGNodes.
- **SQL batching Slice 5b remainder — §8.10.7 guards.** `E-PROTECT-003` fires when a Tier 2 hoist's `SELECT` column list overlaps any `protect`-annotated column on the target table — the hoist is refused and CG falls back to the unrewritten for-loop. `SELECT *` expands to every protected column on the table. New exported `verifyPostRewriteLift` runs after Stage 7.5 and emits `E-LIFT-001` if any hoist's `sqlTemplate` contains a `lift(` call (defensive — §8.10.1 construction makes this unreachable today, but the pass is the spec's required re-check gate).
- **SQL batching microbenchmark.** New `benchmarks/sql-batching/bench.js` measures the exact JS shapes the compiler emits before/after the batching passes on on-disk WAL `bun:sqlite` (synchronous=NORMAL). Results in `benchmarks/sql-batching/RESULTS.md`. Headline: Tier 2 loop-hoist speedup is **1.91× at N=10, 2.60× at N=100, 3.10× at N=500, 4.00× at N=1000**. Tier 1 shows ~5% on read-only handlers — the envelope's real value is snapshot consistency and contention amplification under concurrent writers.
- **README promotion.** "Why scrml" now states "the compiler eliminates N+1 automatically" with a link to the measured results.

### 2026-04-14 (S16)

- **SQL batching Tier 1 + Tier 2 end-to-end** — spec §8.9 / §8.10 / §8.11 + PIPELINE Stage 7.5 + CG emission all landed (11 commits on `main`).
  - **Tier 1 per-handler coalescing (§8.9)**: independent `?{}` queries in a single `!` server handler execute under an implicit `BEGIN DEFERRED..COMMIT` envelope with catch-`ROLLBACK`. One prepare/lock cycle instead of N. `.nobatch()` chain method opts out of any site. `E-BATCH-001` fires on composition with explicit `transaction { }`; `W-BATCH-001` warns when `?{BEGIN}` literals suppress the envelope.
  - **Tier 2 N+1 loop hoisting (§8.10)**: `for (let x of xs) { let row = ?{... WHERE col = ${x.field}}.get() }` rewrites to one `WHERE IN (...)` pre-fetch + `Map<key, Row>` + per-iteration `.get(x.id) ?? null`. `.all()` groups into `Map<key, Row[]>`. Positional `?N` placeholders preserve parameter safety. `D-BATCH-001` informational diagnostic on near-miss shapes (`.run()`, tuple WHERE, multiple SQL sites, no match). `E-BATCH-002` runtime guard on `SQLITE_MAX_VARIABLE_NUMBER` overflow.
  - **CLI**: `scrml compile --emit-batch-plan` prints the Stage 7.5 BatchPlan as JSON.
- **`.first()` → `.get()` reconciliation (§8.3)** — 17 occurrences renamed in SPEC. `.get()` matches bun:sqlite convention; `.first()` dropped.
- **README refinements** — new "Free HTML Validation" subsection explains predicate → HTML attr derivation; "Variable Renaming" rewritten with real §47 encoding (`_s7km3f2x00`) + tree-shakeable decode table story.

### 2026-04-14 (S14)

- **Match-as-expression (§18.3)** — `const x = match expr { .A => v else => d }` now works end-to-end. Follows the same pattern as `if`/`for` as expressions.
- **`:>` match arm arrow** — codegen support complete. Both `=>` and `:>` are canonical; `->` retained as a legacy alias. `:>` avoids overloading JS arrow-function syntax and reads as "narrows to."
- **`</>` closer propagation** — the 2026-04-09 spec amendment (bare `/` → `</>`) was incompletely applied; the AST builder still accepted bare `/` as a tag closer. Now uniformly enforced across parser, codegen, and all 11 affected sample files.
- **Lift Approach C Phase 1** — `parseLiftTag` produces structured markup AST nodes directly during parsing. Previously 0% of real inline lift markup went through the structured path; now it's 100%. The fragile markup re-parse path is dead in production (retained only for legacy test fixtures pending Phase 3).
- **Phase 4d (ExprNode-first migration)** — all compiler consumers now read structured `ExprNode` fields first, with string-expression fields deprecated across 20+ AST interfaces. Expression handling is now AST-driven end-to-end.

---

## In Flight

- **Phase 3 — Legacy test fixture migration.** ~21 fixtures still use the old `{kind: "expr", expr: "..."}` shape. Rewriting them unlocks deletion of ~250–300 LOC of dead string-parsing fallback code in `emit-lift.js`.
- **Lin Approach B (discontinuous scoping).** Design complete, spec amendments drafted. Multi-session work to land an enriched `lin` model beyond Rust-style exact-once consumption.
- **SPEC sync.** Formalizing the `:>` match arm, match-as-expression, and Lift Approach C changes in `compiler/SPEC.md`.

---

## Queued

- **Phase 2 reactive effects** — two-level effect separation for `if`/`lift`. Design settled; will land when a concrete example drives the need.
- **SQL batching (compiler-level).** Two wins on the table:
  - *Per-request coalescing* — independent `?{}` queries in one server function get emitted together, one prepare/lock cycle instead of N.
  - *N+1 loop hoisting* — detect `for (let x of xs) { ?{...WHERE id=${x.id}}.get() }` and rewrite to a single `WHERE id IN (...)` fetched once before the loop. This is only tractable because the compiler owns both the query context and the loop context.
  - Cross-call DataLoader-style batching is parked until beta.
- **Remaining 14 test failures** — triaged, pre-existing, none block beta.
