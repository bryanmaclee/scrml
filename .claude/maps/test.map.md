# test.map.md
# project: scrmlts
# updated: 2026-06-07T07:00:00Z  commit: cc69c62d

## Test Framework
Runner: bun test (built-in Bun test runner)
Config: bunfig.toml (timeout + happy-dom preload settings)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<filename>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Full suite at S167 close: 23,075 pass / 0 fail / 220 skip / 1 todo (on 75431e9e). S168 added 2 NEW test files (cow-bracket-write-emit 7 + browser-cow-bracket-write 3) + extended equality-semantics (+6 cycle-guard) + parse-mutation-shapes (+1 COW node-shape) — not re-counted into a fresh suite total here (no full re-run); within-node native-parser parity 1005/0 (UNCHANGED — S168 bracket-write COW is a LIVE-pipeline change; native still folds bracket-write to in-place, but no new flip-failure was registered) — S169 added 13 NEW value-native-map / each-tuple / union-not test files (see S169 section below); not re-counted into a fresh suite total here (no full re-run captured in this map refresh)

## Test Categories

| Category | Location | Count |
|----------|----------|-------|
| Unit | compiler/tests/unit/ | 569 files (+9 S169: value-native-map-{type-system,literal-parser,runtime}-s169, native-map-literal-d2b, value-native-map-codegen-{chunk,collector,emit}-d4, value-native-map-iteration-order-lint-d4, each-as-tuple-destructure-d2c, union-not-normalization) |
| Browser (DOM) | compiler/tests/browser/ | 36 files (+1 S169: each-as-tuple-destructure-d2c.browser) |
| Conformance | compiler/tests/conformance/ | ~40 files |
| Integration | compiler/tests/integration/ | 105 files (+1 S169: value-native-map-e2e-d4) |
| Parser conformance | compiler/tests/parser-conformance*.test.js | 10 files |
| LSP | compiler/tests/lsp/ | ~8 files |
| Self-host | compiler/tests/self-host/ | ~5 files |
| CLI commands | compiler/tests/commands/ | ~5 files |
| **Total** | compiler/tests/ | **913 .test.js files (S169 find-count; +13 value-native-map arc files)** |

## S153 New Test Files (each-in-dynamic-context sweep)

| File | Covers |
|------|--------|
| compiler/tests/browser/nested-each-in-enclosing-scope.browser.test.js | nested `<each>` (the `as` pattern) renders end-to-end (e6870f25) |
| compiler/tests/browser/component-each-in-prop-scope.browser.test.js | `<each>` in a component body over a prop-scope binding (e6870f25) |
| compiler/tests/browser/each-in-block-form-match.browser.test.js | `<each>` w/ `@.` inside a block-form `<match>` arm (3429b385) |
| compiler/tests/unit/engine-statechild-colon-shorthand-child.test.js | `:`-shorthand child inside an engine arm parses (c89c1cb1) |
| compiler/tests/unit/each-block.test.js | updated for the S153 emit-each dep-first read + reconcile-lines refactor |

## S154-S156 New Test Files

| File | Covers |
|------|--------|
| compiler/tests/conformance/conf-engine-message-dispatch-s155.test.js | E-ENGINE-ACCEPTS-NOT-ENUM / E-ENGINE-MSG-* / message-arm exhaustiveness |
| compiler/tests/unit/enum-subset-refinement.test.js | `parseEnumSubsetAnnotation()` happy + error paths |
| compiler/tests/unit/enum-subset-match-exhaustiveness.test.js | E-MATCH-SUBSET-DEAD-ARM at both match loci (type-system + PASS 20) |
| compiler/tests/unit/enum-subset-predicates.test.js | `predicateToJsExpr` `kind:"variant-set"` → `.includes()` emission |
| compiler/tests/unit/enum-subset-schemafor.test.js | `classifyFieldForSql` subset → `CHECK IN` DDL |
| (+ prior S154-S155 unit files for accepts= parser + message-arm lexer) | |

## S157-S158 New Test Files

| File | Covers |
|------|--------|
| compiler/tests/unit/each-in-tier0-lift-bug72.test.js | emit-lift.js nested `<each>` → inline reconcile, not literal DOM `<each>` |
| compiler/tests/unit/per-item-live-keyed-effect-bug64.test.js | `maybeWrapEachPerItemEffect` emits `_scrml_effect`+`_scrml_resolve_item` wrapper |
| compiler/tests/unit/reconcile-list-same-keys-fast-path.test.js | B2 fast-path still triggers `_scrml_item_by_key` rebuild |
| compiler/tests/unit/render-by-tag-nested-compound-bug60.test.js | `enclosingCompoundStack` + qualified lookup resolution |
| compiler/tests/unit/each-sigil-outside-each-bug70.test.js | `@.` outside `<each>` fires E-SYNTAX-064 not E-CODEGEN-INVALID-JS |
| compiler/tests/unit/derived-const-match-exhaustiveness-bug71.test.js | `const x = match @cell` exhaustiveness via dual-parse side-field |
| compiler/tests/unit/return-match-exhaustiveness-bug67.test.js | `return match expr { ... }` exhaustiveness |
| compiler/tests/unit/schemafor-positional-payload-enum-bug68.test.js | schemaFor payload-binding field names |
| compiler/tests/unit/lift-engine-advance-bug65.test.js | emit-lift.js engine-ctx threading; `.advance(.X)` lowers correctly |
| compiler/tests/unit/markup-attr-advance-typecheck-bug63.test.js | `onclick=@phase.advance(.V)` variant checking → E-TYPE-063 |
| compiler/tests/browser/each-per-item-reactivity-bug64.browser.test.js | live-keyed TEXT/class: bindings re-resolve on reconcile (happy-dom) |
| compiler/tests/browser/each-in-tier0-lift-bug72.browser.test.js | nested `<each>` inside lift renders correctly (happy-dom) |
| compiler/tests/browser/render-by-tag-nested-compound-bug60.browser.test.js | render-by-tag compound field end-to-end (happy-dom) |
| compiler/tests/browser/lift-engine-advance-bug65.browser.test.js | engine transition from lifted handler fires (happy-dom) |

## S159 New Test Files (Bug 73 + S154 ruling (a) HTML `:`-shorthand content-model)

| File | Covers |
|------|--------|
| compiler/tests/unit/per-item-handler-live-keying-bug73.test.js | Emit-shape assertions: Tier-1 + Tier-0 iter-reading handlers get resolve-prelude+null-guard; global handlers stay plain (iter-scope token scan negative case). 4 tests. |
| compiler/tests/unit/html-colon-shorthand-content-model-s159.test.js | §4.14 content-model rule: non-void `<span : @label>` emits interpolated body byte-identical to bare-body form; void `<input : @val>` fires E-COLON-SHORTHAND-ON-VOID; `@.`-sigil body outside `<each>` fires E-SYNTAX-064; component `:`-shorthand unaffected; E-DG-002 cleared for cells consumed via `:`-shorthand. 18 tests. |
| compiler/tests/browser/each-per-item-handler-live-keying-bug73.browser.test.js | Runtime: Tier-1 + Tier-0 array-replace-same-key handler fires with live item, not create-time snapshot; in-place field mutation handler fires with live data; global handler after removal skips correctly (happy-dom). 6 tests. |
| compiler/tests/unit/each-block.test.js | Updated for S159 Bug 73 per-item handler emit shape |

## S160 New Test Files (S154 rulings (b) and (c))

| File | Covers |
|------|--------|
| compiler/tests/unit/colon-shorthand-inside-opener-s154b.test.js | S154 ruling (b): inside-opener `:`-shorthand is canonical; after-`>` placement detected and emits `W-COLON-SHORTHAND-LEGACY-PLACEMENT` (info-level); both engine state-child and `<match>` arm paths covered; `rewriteColonShorthandPlacement()` migrates legacy arms correctly; `migrate --fix` output verified. |
| compiler/tests/unit/typed-array-no-rhs-default.test.js | S154 ruling (c): no-RHS typed decl Shape 4 — primitive types synthesize canonical-empty (`0`/`false`/`""`); bare named type synthesizes `not` init with implicit `(not to T)` lifecycle; `T[]` still synthesizes `[]`; refinement-typed no-RHS: SATISFIES predicate → no error, VIOLATES → E-REFINEMENT-NO-DEFAULT; `const` no-RHS non-array → E-DECL-NEEDS-INITIALIZER (preserved); union-admitting-absence → `not` with no lifecycle. |

## S162 New Test Files (native-parser each-promotion arc + F3 same-line match-arm)

| File | Covers |
|------|--------|
| compiler/tests/unit/native-each-promotion.test.js | S162 unit A: native parser promotes `<each>` → structural `each-block` FileAST node (`isEachBlock`/`synthEachBlockNode`); the synthesized node carries the live `each-block` shape; mirrors the `<match>` → `match-block` promotion. |
| compiler/tests/parser-conformance-each-contextual-sigil.test.js | S162 unit C: native lexer recognizes the `@.` contextual iteration sigil; bare `@.`, `@.field`, `@.a.b` dotted-chain forms lex as one `ScrmlAt` token. |
| compiler/tests/browser/each-contextual-sigil-native.browser.test.js | S162 unit B+C: end-to-end runtime — native-parsed `<each>` with `@.` per-item interp renders correctly (emit-each honors the `exprNode` contract). |
| compiler/tests/native-match-arm-same-line.test.js | S162 F3: same-line match-arm boundary detection in `parse-expr.js isAtArmBoundary` (NEWLINE gate dropped; `inMatchArmBody` + `peekStartsArmPattern`). |
| compiler/tests/parser-conformance-markup.test.js | updated S162 for the markup-classification parity surface (touched by the each-promotion arc). |

## S164-S166 New Test Files (native-parser-swap parity-closers)

| File | What it covers |
|------|----------------|
| compiler/tests/unit/native-attrvalue-exprnode-population.test.js | S164: `populateNativeAttrValueExprNodes` (native-walker/attrvalue-exprnode-walker.ts) stamps `exprNode`/`argExprNodes` on native attr-values byte-identical to live. |
| compiler/tests/unit/native-lift-markup-closetag-span.test.js | S164: lift `<markup>` close-tag lexing fix (lex-in-code.js `/`-branch no longer reads `</li>` as runaway regex). |
| compiler/tests/unit/native-sql-chained-form-f2a.test.js | S164 F2a: chained `?{}.method()` SQL promotion in statement position (translate-stmt.js `reconstructChainedSql`). |
| compiler/tests/unit/native-tablefor-struct-field-drop.test.js | S164: `typeBodyText`/`joinWithNewlines` preserve struct/enum field-separator newlines (`<tableFor>` no longer drops fields). |
| compiler/tests/unit/m66-b2-engine-statechild-walker.test.js | S164 B2 (updated): `native-walker/engine-statechild-walker.ts` populates `messageArms` from `parseMessageArms(bodyRaw).arms` + `synthEngineDecl` reads `accepts=`. |
| compiler/tests/parser-conformance-within-node.test.js + within-node-allowlist.json | updated S164-S167 — native↔live within-node parity (1005/0); the allowlist tracks remaining per-family gaps (S167: +4 native-lag on samples/gauntlet-r11-elixir-chat.scrml — see below). |
| compiler/tests/integration/m6.4a-native-p2-form1.test.js (§B) | S166 ROOT-2: emitted-output regression for the native cross-file `${...}`-wrapped `export const Name = <markup>` raw-slice fix — `<Badge/>` markup EXPANDS in consumer HTML, E-COMPONENT-020/035 GONE (was `raw=""` → empty CE registry). |

NOTE: S165's four families (F2-match string-lit arms, promote-each, R1 typed-`@cell`, server-fn-star) were
landed with parser-conformance + within-node coverage (1005/0) and the swap flip-harness re-measure; the
S165 dispatch BRIEFs (docs/changes/native-f2match-literal-arm-2026-06-05/ etc.) record the per-family R26
byte-identity checks. The flip harness (default exit-0 vs `--parser=scrml-native`) is the family-level gate;
a fix-dispatch agent re-runs it to re-rank the remaining 451.
S166 landed two re-triage roots: bare-`function` failable `76059024` (within-node residual-preserving rebump —
27 class-budgets across 14 failable fixtures whose now-reachable bodies surface PRE-EXISTING native residuals;
1005→991→1005; full suite 23,054/0) + cross-file `${...}`-export `9d12d980` (within-node 1005/0 with NO allowlist
rebump — resolved via a `bodyStart` STRIP_KEY in within-node-classifier.ts; cross-file integration 48/0).

## S168 New / Extended Test Files (cycles-prereq — COW-all bracket-write + structural-eq cycle guard)

| File | What it covers |
|------|----------------|
| compiler/tests/unit/cow-bracket-write-emit.test.js | **NEW (7 emit-shape tests).** A bracket-index WRITE `@arr[i] = x` now lowers to the COW node (`reactive-nested-assign` → `_scrml_deep_set(_scrml_reactive_get(target), [<path>], value)`); a literal index `@arr[0]=x` rides the STRING path segment, a computed index `@arr[@sel]=x` emits the index ExprNode INLINE (`[_scrml_reactive_get("sel")]`). Asserts bracket READS (`@y = @arr[i]`) stay verbatim (not rewritten to COW). |
| compiler/tests/browser/browser-cow-bracket-write.test.js | **NEW (3 happy-dom runtime acceptance).** Drives bracket-write mutations at runtime and asserts copy-on-write semantics — `@arr[0] = @arr` (self-reference) produces NO live cycle (the clone-then-set in `_scrml_deep_set` snapshots an acyclic value), and bracket reads continue to observe in-place data. |
| compiler/tests/unit/equality-semantics.test.js | **EXTENDED (+6).** Cycle-guard termination for `_scrml_structural_eq`: a made-acyclic self-referential value's `==` terminates via the `WeakMap<a,WeakSet<b>>` seen-set instead of stack-overflowing. |
| compiler/tests/integration/parse-mutation-shapes.test.js | **UPDATED (+1).** Bracket-index write now parses to the COW `reactive-nested-assign` node shape (was a raw index assignment). |

NOTE (S168): the cycles-prereq is the build prerequisite for value-native maps (SPEC §59, now IMPLEMENTED end-to-end
in S169 — see the S169 section below). It is a LIVE-pipeline change (ast-builder.js `collectAtPathSegments` + emit-logic.ts piecewise path
+ runtime-template.js cycle guard). The native parser still folds bracket-write to in-place — a SEPARATE swap-grind
parity item, but no NEW flip-failure was registered (within-node stayed 1005/0).

## S169 New Test Files (value-native maps §59 — IMPLEMENTED end-to-end)

| File | What it covers |
|------|----------------|
| compiler/tests/unit/value-native-map-type-system-s169.test.js | **NEW.** `MapType`/`tMap`/`resolveTypeExpr` `[K:V]` recognition + `@ordered` affix + key-comparability classification (`E-MAP-KEY-NOT-COMPARABLE`/`E-MAP-KEY-IS-MAP`/`E-EQ-003`) + the `E-MAP-BRACKET-WRITE` gate. |
| compiler/tests/unit/value-native-map-literal-parser-s169.test.js | **NEW.** Legacy `preprocessMapLiterals` scanner: `[:]`/`[k:v]` disambiguation (vs ternary), `E-MAP-LITERAL-MALFORMED`, `W-MAP-STRUCT-KEY-LITERAL`, `W-MAP-DUPLICATE-LITERAL-KEY`. |
| compiler/tests/unit/native-map-literal-d2b.test.js | **NEW.** Native-parser `parseArrayLiteral` map fork — token-level literal parity with the legacy path (same disambiguation + same 3 diagnostics). |
| compiler/tests/unit/value-native-map-runtime-s169.test.js | **NEW.** Runtime surface: `_scrml_fnv1a`/`_scrml_value_canonical` (§59.5), the 14 map methods, the §57-envelope codec, and the order-independent `map` case in `_scrml_structural_eq`. |
| compiler/tests/unit/value-native-map-codegen-collector-d4.test.js | **NEW.** `collectMapVarNames`/`fileHasMapUsage` (reactive-deps.ts). |
| compiler/tests/unit/value-native-map-codegen-emit-d4.test.js | **NEW.** emit-expr.ts map lowering: literal, bracket-read (`_scrml_map_get`), method-call, `.size`. |
| compiler/tests/unit/value-native-map-codegen-chunk-d4.test.js | **NEW.** The `'map'` runtime chunk tree-shaking (runtime-chunks.ts). |
| compiler/tests/unit/value-native-map-iteration-order-lint-d4.test.js | **NEW.** `runWMapIterationOrder` → `W-MAP-ITERATION-ORDER` on non-`@ordered` `<each in=@m.keys()/.values()/.entries()>` without `.sorted()`. |
| compiler/tests/integration/value-native-map-e2e-d4.test.js | **NEW.** End-to-end: source `[K:V]` → typed → emitted JS using the map runtime. |
| compiler/tests/unit/each-as-tuple-destructure-d2c.test.js (+ .browser) | **NEW.** `<each in=@m.entries() as (k, v)>` tuple-destructure sugar (parser + emit; browser runtime acceptance). |
| compiler/tests/unit/union-not-normalization.test.js | **NEW (D0).** §42.3.1 union-`not` normalization in `tUnion`/`normalizeUnion`. |
| compiler/tests/unit/{runtime-tree-shaking,translate-expr-bridge,c10-error-message-resolution}.test.js | **EXTENDED.** Map chunk in tree-shaking; native↔legacy bridge for MapLit; map error-message resolution. |

## S167 New Test Files (HIGH multi-statement deep-set / array-mutation write-loss — LIVE parser fix)

| File | What it covers |
|------|----------------|
| compiler/tests/unit/deepset-write-loss-position.test.js | **NEW (16 emit-shape tests / 87 asserts).** Full position matrix for the `collectExpr` depth-0 statement-boundary fix (ast-builder.js): consecutive dotted-path deep-set writes (`@obj.field = value` → `reactive-nested-assign` §5.2.3) AND array-mutations (`@arr.push(...)` et al. → `reactive-array-mutation`) survive at EVERY body position, in source order, with the right `_scrml_deep_set(...)` path + value — not just as the first statement. Includes the RHS-operand guard (`@y = @x.prop` collects `@x.prop` as the RHS read, NOT a swallowed new statement). Emit-shape lower bound (S139/S140/S152 — string check; the runtime proof is the browser file). |
| compiler/tests/browser/browser-deepset-write-loss.test.js | **NEW (4 happy-dom runtime acceptance).** Drives the DOM-event → handler → reactive-set path and asserts the deep-set MUTATIONS ACTUALLY APPLY at runtime: every deep-set in a multi-statement body takes effect, last-write-wins ordering. Uses a FLAT object cell `<a> = { ref: "" }` to isolate the parser fix (a STRUCTURAL-COMPOUND cell — `<a><ref></>` — lowers to a derived composite that fails at runtime even for a single deep-set; that is Bug B, a SEPARATE pre-existing codegen mistarget filed but NOT fixed this session). |

NOTE (S167): the deep-set fix is a LIVE-pipeline (ast-builder.js `collectExpr`/`parseLogicBody`) fix, not a
native-parser swap-closer. Real-corpus impact: `samples/gauntlet-r11-elixir-chat.scrml` had `@messages.push(msg)`
after a `let msg = {...}` decl silently dropped — now correctly emitted. Within-node allowlist bumped +4 on that
file (EXTRA-FIELD 31→32, FIELD-SHAPE 20→21, KIND-NAME 12→13, SPAN-COORD 110→111) because the NATIVE parser still
folds `@arr.push` to a bare-expr — a SEPARATE native swap-grind parity item (correct-shadow: the live fix is now
ahead of native, the bump records the lag, it is NOT masking a regression). within-node stayed 1005/0.

## Fixtures & Factories

| Path | Contents |
|------|----------|
| compiler/tests/fixtures/ | shared .scrml test fixtures and multi-file app stubs |
| compiler/tests/helpers/ | compile harness utilities (compileSrc, expectError, cross-stream helpers) |
| compiler/tests/conformance/block-grammar/ | block-grammar conformance fixtures |
| compiler/tests/conformance/s32-fn-state-machine/ | fn-as-state-machine conformance + REGISTRY.md |
| compiler/tests/conformance/tab/ | TAB-stage conformance fixtures |
| compiler/tests/integration/fixtures/ | integration test .scrml inputs |
| compiler/tests/parser-conformance-within-node-allowlist.json | native-parser parity allowlist (S167: +4 native-lag on r11-elixir-chat) |
| docs/changes/high-deepset-write-loss-2026-06-06/repro-multi-deepset.scrml | S167 minimal reproducer (multi-statement deep-set) — change-dir artifact, not a test runner input |

## Pattern

Tests are written as Bun test files using `describe` / `test` / `expect` from `bun:test`.
Unit tests invoke individual compiler passes (block-splitter, ast-builder, type-system, codegen
emit-* modules) directly via `compileSrc(source)` helpers or direct pass calls.
Conformance tests assert that specific E-/W-/I- codes appear in compile output; they use
a cross-stream helper because W-*/I-* codes land in result.warnings, not result.errors —
tests that check `result.errors.filter(e => e.code === "W-...")` silently false-pass.
Browser tests use happy-dom via `@happy-dom/global-registrator` to run emitted client JS
in a DOM environment and assert reactive behavior. The S153 each-in-dynamic-context fixes AND
the S158-S159 per-item-reactivity / handler-live-keying fixes are gated by happy-dom canaries
(not emit-string-only checks) — the S140/S152 lesson that emit-string tests mask runtime
miscompiles applies directly to these classes. The S167 deep-set write-loss fix follows the same
pairing: an emit-shape unit file (deepset-write-loss-position) PLUS a happy-dom runtime acceptance
file (browser-deepset-write-loss) that proves the mutations actually apply.
Parser conformance tests compare live-pipeline (block-splitter + ast-builder) output to
native-parser output for a large corpus; parity gaps are tracked in the within-node allowlist.
Bug 73 emit-shape tests assert the resolver-prelude pattern in the emitted JS and complement the
happy-dom browser tests that verify the runtime live-keying effect.
S160 ruling (b) tests cover both the `W-COLON-SHORTHAND-LEGACY-PLACEMENT` detection path (info-level,
so cross-stream helper required) and the `rewriteColonShorthandPlacement()` migrate output.
S160 ruling (c) tests cover the full Shape 4 dispatch matrix including the refinement-predicate
SATISFIES/VIOLATES/UNDETERMINABLE trichotomy and the `synthesizedFromNoRhs` lifecycle note path.

## Tags
#scrmlts #map #test #bun #conformance #parser-parity #happy-dom #each-in-dynamic-context #per-item-reactivity #live-keyed #bug64 #bug65 #bug72 #bug73 #colon-shorthand-html #colon-shorthand-canonical #shape4-no-rhs #s153 #s154 #s155 #s156 #s157 #s158 #s159 #s160 #native-parser #native-parser-swap #each-promotion #match-promotion #f3-match-arm #f2-match #promote-each #typed-atcell #server-fn-star #exprnode-walker #within-node-1005 #flip-451 #bare-function-failable #cross-file-export-bodystart #deepset-write-loss #reactive-nested-assign #reactive-array-mutation #s161 #s162 #s163 #s164 #s165 #s166 #s167 #s168 #s169 #value-native-maps #map-type #each-tuple-destructure #union-not-normalization

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
