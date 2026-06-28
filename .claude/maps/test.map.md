# test.map.md
# project: scrmlts
# updated: 2026-06-28  commit: 0df45d2e
# reconciliation: the test-FILE inventory (Total) is current to 0df45d2e (S229). Per-file 'New Test Files' detail is written for S229; S227 (g-ternary-arrow-sql-e-error-003) + the S228 window (5 new integration tests, named in the Total breakdown) are counted but not given their own sections this pass.

## Test Framework
Runner: bun test (built-in Bun test runner)
Config: bunfig.toml (timeout + happy-dom preload settings)
Run all: `bun test compiler/tests/`
Run single: `bun test compiler/tests/unit/<filename>.test.js`
Coverage: `bun test compiler/tests/ --coverage`
Full suite at S167 close: 23,075 pass / 0 fail / 220 skip / 1 todo (on 75431e9e). S168 added 2 NEW test files (cow-bracket-write-emit 7 + browser-cow-bracket-write 3) + extended equality-semantics (+6 cycle-guard) + parse-mutation-shapes (+1 COW node-shape) — not re-counted into a fresh suite total here (no full re-run); within-node native-parser parity 1005/0 (UNCHANGED — S168 bracket-write COW is a LIVE-pipeline change; native still folds bracket-write to in-place, but no new flip-failure was registered) — S169 added 13 NEW value-native-map / each-tuple / union-not test files (see S169 section below); not re-counted into a fresh suite total here. **S170: Bug B (`72aa6836`) +9 tests (5 emit-shape + 4 happy-dom) with 2 mistarget-locking tests corrected per Rule-4; set-algebra (`df08f282`) +16 value-correct unit; native-parser fix-wave-1 (`5a346faa`) +24 regression with the within-node allowlist surgically reconciled (34 over-budget → current; PARSE-FAILURE:0 / NESTED-SHAPE:0); fix-wave-2 (`cc69c62d`) +5 statement-survival canary, full suite at fix-wave-2 23405 pass / 0 fail.** native-parser flip-failures re-measured 605 on `df08f282` → ~508 after the two waves (default BS+Acorn 0-fail / fully green throughout). **S173 added +2 (E-EXPORT-001 export-reject + W-TYPE-FN-FIELD); S174 added log()-builtin / any-reject coverage; S175 added +5 typed-SQL-row files (sql-projection-extract 13 cases, sql-row-typing 4, sql-row-tranche2-width-subtype 18, sql-row-tranche3-typeflow 17, struct-fn-field-reject 11 — see the S175 section below). S176 added +6 files (unknown-type-forbidden 25, unknown-type-name-predicate 38, stdlib-math 28, stdlib-random-capability 13, stdlib-time-now-capability 8, stdlib-transitive-shim-copy 3 — see the S176 section below) + extended scrml-migrate (+Migration-3 `pure`→`fn` cases) and stdlib-shim-resolution (+2).** **S181 added +2 (display-text-overquote.test.js for W-DISPLAY-TEXT-OVERQUOTE; server-keyword-error-msg-canon.test.js for the deprecated-`server function` diagnostic reword).** Current find-count (on `5a51c1ca`): **957 total .test.js** (verified `find compiler/tests -name '*.test.js' | wc -l` = 957 — S179 added +2 [route-inference.test.js, server-keyword-eliminate-d1.test.js]; S180 added +5 [channel-broadcast-escalation-trigger7.test.js, handle-middleware-ri.test.js, middleware-handle.test.js, migrate-server-keyword.test.js, trucking-dispatch-smoke-integration.test.js]; S181 added +2 [display-text-overquote.test.js, server-keyword-error-msg-canon.test.js]; master-list test-marker 23779→23816 at S180 wrap, 23816→23830 at S181 wrap). **S182/S183 added engine-effect + formFor/tableFor-unimported coverage (957→959 .test.js at 1734b81b). S184 added +7 .test.js (959→966 at HEAD 7fe7044f): lifecycle-field-comment-leak.test.js, lifecycle-etype001-doublefire.test.js, lifecycle-shape1-variant-initializer.test.js, lint-ghost-snippet-fill-exempt.test.js, lint-w-each-promotable-tablefor-exempt.test.js, error-arm-multifield-payload-binding.test.js, match-block-form-payload-binding.test.js. Current canonical find-count (on 7fe7044f): **966 total .test.js** (`find compiler/tests -name '*.test.js' | wc -l` = 966); repo-wide all-suffix (.test.js + .test.ts + .spec.ts) = 981. master-list test-marker 23837→23855 at S183 wrap.** **S185 added +2 .test.js (966→968 at HEAD a4726dd3): errarm-refail-lowering.test.js (11 cases — !{} + <match> arm re-fail lowering to the function-exiting error envelope) + validator-inline-colon.test.js (10 cases — E-VALIDATOR-INLINE-COLON colon-form reject + paren-form recovery). Current canonical find-count (on a4726dd3): **968 total .test.js** (find compiler/tests -name *.test.js = 968); repo-wide all-suffix (.test.js + .test.ts + .spec.ts) = 983.** **S196 added +5 .test.js (987→992 across 2 commits): `fcdec43c` render-expr prereq-bugs +4 unit (g-failable-arm-nested-constructor-crash 6, g-match-arm-apostrophe-bs 8, g-shorthand-interp-match-arm-codegen 8, h1-steer-markup-in-value-match 8 — E-MATCH-ARM-MARKUP-IN-VALUE); `471cbb34` render-expression primitive +1 integration (render-expr-primitive 6, 5 describe blocks) + 2 EXTENDED unit (html-elements +10L for the `<render>` registry row, type-system +5L). Current canonical find-count (on `471cbb34`): **992 total .test.js** (`find compiler/tests -name '*.test.js' | wc -l` = 992); repo-wide all-suffix = 1007.** **S200 added +3 .test.js (994→997 at HEAD `b1f5f8bf`): g-each-component-helper-hoist.browser.test.js (`60ace8b4` STEP1 — directly-imported component helper-export hoist), g-each-component-transitive-helper.browser.test.js (`ecba9fee` STEP2 A+B — transitive helper import + nested expression-prop), g-each-peritem-if-predicate.browser.test.js (`39bd061f` C1+C2 — §42 per-item predicate lowering + `if=` conditional). Current canonical find-count (on `b1f5f8bf`): **997 total .test.js** (`find compiler/tests -name '*.test.js' | wc -l` = 997); repo-wide all-suffix = 1012.**

## Test Categories

| Category | Location | Count |
|----------|----------|-------|
| Unit | compiler/tests/unit/ | find-count at c48c4f71; +S169 value-native-map arc; +S170 native-parser regression set; +S173 export-reject/fn-field; +S174 log()/any-reject; **+S175: sql-projection-extract, sql-row-typing, sql-row-tranche2-width-subtype, sql-row-tranche3-typeflow, struct-fn-field-reject**; **+S177 unit: bare-slash-before-close-tag-bug4, closer-on-shorthand-body-e-closer-001-bug74, formfor-nested-in-engine-statechild-r27-c6, inline-map-assign-handler-s169, opener-arrow-truncation-bug48, schemafor-predicated-base-nullable-r28-7b; **+S184 unit: lifecycle-field-comment-leak, lifecycle-shape1-variant-initializer, lint-ghost-snippet-fill-exempt, lint-w-each-promotable-tablefor-exempt, error-arm-multifield-payload-binding, match-block-form-payload-binding (+integration: lifecycle-etype001-doublefire)****); **+S185 unit: errarm-refail-lowering, validator-inline-colon**; **+S190 unit: derived-engine-expression-form (16 cases), cluster-c-decl-boundary (19 cases); extended: derived-engine-rejections (B16 NO-RULES rule= reword), c14-derived-engines (+2 boundary cases)**; **+S191 unit: attr-if-fn-call-conditional (12), attr-if-fn-condition-followup (5), bug-1-tailwind-filter-family (28), bug-1-tailwind-gradient-family (14); extended: bug-1-tailwind-ring-family/transform-shorthand/minor-families/unrecognized-class/arbitrary-value-emit/tailwind-classes** |
| Browser (DOM) | compiler/tests/browser/ | 39 files (+1 S169 each-as-tuple-destructure-d2c.browser; +1 S170 browser-structural-compound-deepset; +2 S212 flogence/W4: g-bare-ref-event-handler + g-match-arm-reactive-attr-effects) |
| Conformance | compiler/tests/conformance/ | ~40 files |
| Integration | compiler/tests/integration/ | 109 files (+1 S169: value-native-map-e2e-d4; +1 S196: render-expr-primitive) |
| Parser conformance | compiler/tests/parser-conformance*.test.js | 10 files |
| LSP | compiler/tests/lsp/ | ~8 files |
| Self-host | compiler/tests/self-host/ | ~5 files |
| CLI commands | compiler/tests/commands/ | ~5 files |
| **Total** | compiler/tests/ | **1107 .test.js files** at `0df45d2e` (verified `find compiler/tests -name '*.test.js' | wc -l` = 1107; **+2 S229** [g-markup-session-read-undeclared integration (7 cases) + reactive-map-set-control-flow-g-reactive-map-set-control-flow-2026-06-28 integration (10 cases / 3 describe)] + **+5 S228** [g-mount-hang-rails-dev-detect-chunks-linear / g-ternary-arrow-sql-e-error-003 / g-unary-of-additive-arg / g-unary-of-exponent-arg-paren / sql-in-arrow-body-diagnostic — all integration]; PRIOR **1100 .test.js files** at `cf1471dd` (verified `find compiler/tests -name '*.test.js' | wc -l` = 1100; **+6 S224-S226**: apply-utility-composition integration + g-unary-of-exponent-arg-paren integration + nested-fn-sql-escalation-regression integration + nonreactive-local-map-set-ss52 integration + multi-scrutinee-match-ss43 unit + named-machine-undeclared-read-ss42 unit; was **1094 at `6988c426`** (+4 S223: ss38 HAMT map-differential unit + ss34 E-ENDPOINT-MULTI-STATEMENT-ARM integration + ss39 nested-template-raw-mangle + ss39 match-arm-comment angle-bracket-opacity; was **1090 .test.js files** at `12600217` (verified `find compiler/tests -name '*.test.js' | wc -l` = 1090; **+19 since S220** [**+5 S222**: ss31 `g-double-unary-minus-emit-decrement` + `g-enum-toenum-client-structured-decl` integration (`g-unary-left-of-exponent-paren` EXTENDED); ss37 `value-native-set-type-system` + `value-native-set-codegen-collector` unit + `value-native-set-e2e` integration (`expr-node-round-trip` EXTENDED); **+14 S221 gap** — ss23/ss29/ss30 etc., NOT itemized in this incremental pass]; was **1071 .test.js files** at `852d6aa7` (verified `find compiler/tests -name '*.test.js' | wc -l` = 1071; suite: **~25223 pass / 0 fail**; +16 S220 [7 browser + 5 integration + 4 unit]; was **1055 .test.js files** at `26ffea4e` (verified `find compiler/tests -name '*.test.js' | wc -l` = 1055; +2 S219: engine-arrow-body-legacy-reject-b2.test.js unit 150L [NEW] + lint-w-input-state-markup-nonreactive.test.js unit 266L [NEW]; +14 S217/S218 — see S217/S218 sessions; was **1039 at `1ff06eae`** (verified `find compiler/tests -name '*.test.js' | wc -l` = 1039; +3 S214: render-shadowing-ss16-c3.test.js integration + eq-payload-variant-lint-ss16-c4.test.js unit + g-on-mount-bare-call-render-slot.test.js unit; was **1036 .test.js files** at `fec0a054` (verified `find compiler/tests -name '*.test.js' | wc -l` = 1036; +2 S213: request-id-render-bridge.test.js unit + api-decl-codegen.test.js unit; uvb-w1-post-ce-invariant.test.js NEW but counts as 1 of the 2 net new files; was **1034 at `8ddc8448`** unchanged 8569f774→8ddc8448 — the ss4 delta EXTENDED existing files, no new test FILES); was **1034 at `8569f774`** (+2 S212 flogence/W4: g-bare-ref-event-handler.browser, g-match-arm-reactive-attr-effects.browser; api-decl-typer.test.js EXTENDED +3); was **1032 .test.js files** at `a9c2108f` (verified `find compiler/tests -name '*.test.js' | wc -l` = 1032); was **1029 at `6d8a47ab`** (S211); **+3 S212: g-tailwind-markup-block-scan.test.js integration, g-nested-each-no-own-subscription.browser.test.js browser, lift-concurrent-transitive-tdz.test.js unit** — see S212 New Test Files section below. Previous entry: **+5 S211: lint-w-interp-in-raw-content.test.js unit, api-decl-typer.test.js unit, api-decl-parser.test.js unit, g-paren-receiver-group-dropped.test.js integration, each-sigil-expr-parser.test.js unit** — see S211 New Test Files section below. Previous total: **992 .test.js files (verified `find compiler/tests -name '*.test.js' | wc -l` = 992 on `471cbb34`; +5 S196: render-expr-primitive [integration, 6 cases] + the 4 render-expr prereq-bug unit files [g-failable-arm-nested-constructor-crash 6, g-match-arm-apostrophe-bs 8, g-shorthand-interp-match-arm-codegen 8, h1-steer-markup-in-value-match 8]; +1 S195: match-arm-void-element-scanner [13 cases / 46 expects]; +4 S191: attr-if-fn-call-conditional [12 cases], attr-if-fn-condition-followup [5 cases], bug-1-tailwind-filter-family [28 cases], bug-1-tailwind-gradient-family [14 cases] — also extended bug-1-tailwind-ring-family/transform-shorthand/minor-families/unrecognized-class/arbitrary-value-emit/tailwind-classes); +2 S198-S199: engine-hydration-initial-cell [unit, 16 cases] (A-leg `initial=@cell`) + engine-hydration-server-source [unit, 18 cases] (E-leg `server=@source`); +3 S200: g-each-component-helper-hoist [browser], g-each-component-transitive-helper [browser], g-each-peritem-if-predicate [browser] — find-count = 997 at `b1f5f8bf`; +3 S201: markup-value-render.browser, g-markup-value-in-expression, g-nested-component-member-arg (+ each-block extended) → find-count = 1000 at `fa2edccf`; +4 S202: each-over-arm-payload-binding-unbound [browser, 10], g-each-inline-prop-member [browser, 14], e2e-render-map [4 describe], detector-validation [3 describe] → **find-count = 1004 at `60d547e1`** (verified `find compiler/tests -name '*.test.js' | wc -l` = 1004; repo-wide all-suffix = 1019); +1 S204; +2 S205; +2 S206; +2 S206-block-analysis; +2 S207; +2 S208 → **1016 at `9afc746e`**; **+4 S209-ss2 → 1020 at `b67cd6e6`** (verified)**; **+4 S210 → 1024 at `5c68e87e`** (verified `find compiler/tests -name '*.test.js' | wc -l` = 1024)** |

## S229 New Test Files (g-reactive-map-set-control-flow + g-markup-session-read-undeclared)

### S229 — g-reactive-map-set-control-flow (`ffc6fbec`, MED)
- `compiler/tests/integration/reactive-map-set-control-flow-g-reactive-map-set-control-flow-2026-06-28.test.js` (integration, 10 cases / 3 describe). REACTIVE `@`-cell value-native map/set method/property/index access INSIDE every control-flow shape (if cond + if/else body, for body / iterable / C-style cond, while body / cond, do-while body), END-TO-END. Each case asserts: (1) compiles with NO codegen errors + is syntactically valid JS; (2) LOWERS to `_scrml_map_*(_scrml_reactive_get("…"), …)` — NOT raw `_scrml_reactive_get("…").insert(`/`.size`/`.has(`; (3) EXECUTES against the emitted runtime returning the CORRECT values (the load-bearing R26 RUN gate — the bug was a silent runtime-only crash, so emit-string assertions alone miss it). Matrix + the S215 adversarial edges. Imports `compileScrml` from `../../src/api.js`.

### S229 — g-markup-session-read-undeclared (`0df45d2e`, LOW; S228 ruling)
- `compiler/tests/integration/g-markup-session-read-undeclared.test.js` (integration, 7 cases). A `@session` read is a legal AMBIENT read in markup AND logic (NOT an asymmetry — the brief's 'logic resolves fine' premise was a mis-inference; both the E-STATE-UNDECLARED diagnostic AND the codegen were broken). Asserts the 4-surface fix: type-system.ts `RESERVED_AMBIENT_PROJECTION_NAMES={session}` exempts `@session` from E-STATE-UNDECLARED (a genuine `@typoCell` still fires); emit-expr.ts client-mode `@session`->bare `session` projection (not `_scrml_reactive_get("session")`); index.ts flag = auth-configured AND no user `session` cell; route-inference.ts `(?<!@)\bsession\b` so the server bare `session` still escalates but client `@session` does not. SECURITY case: the client `@session` projection is HTTP-boundary-fed and exposes no server-only data.

## S223 New Test Files (ss38 HAMT map + ss34 endpoint diagnostic + ss39 parser fixes)

4 NEW `.test.js` files across S223 codegen/parser landings (find-count 1090→1094 at `6988c426`). Full `bun test compiler/tests/` green. ZERO new §34 codes from ss33/ss38/ss39/ss41; +1 E-ENDPOINT-MULTI-STATEMENT-ARM (ss34) wired.

### ss38 — HAMT persistent structural-sharing swap for §59 value-native map runtime (`5fb41cb9`)
| compiler/tests/unit/value-native-map-hamt-differential-ss38.test.js | unit | **NEW** — Differential correctness regression: every existing §59 map algebra op (insert / remove / merge / from-entries / keys / values / size / has / get) returns the same result under the new HAMT implementation as it did under the prior COW implementation. R26 rule: the runtime behaviour is byte-identical; only the internal storage (COW flat-copy → HAMT structural-sharing) changes. |

### ss34 — E-ENDPOINT-MULTI-STATEMENT-ARM diagnostic (§61.10, `f76f9fd0`)
| compiler/tests/integration/endpoint-multi-statement-arm.test.js | integration | **NEW** — A multi-statement bare-body `<endpoint>` arm (`<Variant> stmt1; stmt2; </>`) fires `E-ENDPOINT-MULTI-STATEMENT-ARM` (SPEC §61.10) rather than the generic `E-CODEGEN-INVALID-JS`. Tests: multi-statement bare body fires named code + steering message; single-expression bare body clean; colon-shorthand arm clean; self-closing no-op arm clean; wildcard `<_>` multi-statement arm also fires. Validates `isSingleJsExpression` (validate-emit.ts) gate in `emitEndpointArmEnvelope` (emit-server.ts). |

### ss39 — parser fixes: nested-template scanner + match-arm comment trivia (`04db09de`)
| compiler/tests/integration/nested-template-raw-mangle.test.js | integration | **NEW** — `scanInterpBody`/`scanTemplateBody` mutual-recursion (tokenizer.ts ss39 #2). A JS template literal containing a nested template literal (`` ` \`\${...\`}\` ``) in a string-type attribute is no longer mangled by the scrml source-text rewriter. Tests: single-level template preserved; nested template preserved; triple-nested; template in server fn body; template with scrml interp sibling. |
| compiler/tests/unit/match-arm-comment-angle-bracket-opacity.test.js | unit | **NEW** — match-arm `//` comment trivia (match-statechild-parser.ts ss39 #1). A `//` end-of-line comment inside a match-arm body whose text contains `<…>` angle brackets was being parsed as angle-bracket tokens and triggering false arm-tokenization or tag-close detection. Tests: comment with `<`, `>`, `<Tag/>`, and `<Tag attr="v">` are fully opaque. |

## S224-S226 New Test Files (ss43 multi-scrutinee + ss42 named-machine + ss49/ss50/ss52 fixes)

6 NEW `.test.js` files across S224-S226 landings (find-count 1094→1100 at `cf1471dd`). Full `bun test compiler/tests/` green.

### S224 — §26.8 @apply utility composition W2 (`9ad78593`)
| compiler/tests/integration/apply-utility-composition.test.js | integration | **NEW** — §26.8 `@apply` utility composition end-to-end. Tests: `@apply bg-blue-500` inlines the flat CSS declarations; `@apply text-white font-bold` multiple tokens in one rule; `@apply` with a variant-prefixed utility fires E-APPLY-VARIANT-UNSUPPORTED; unknown Tailwind token fires E-APPLY-UNKNOWN-UTILITY; non-inlinable (multi-rule) utility fires E-APPLY-NON-INLINABLE-UTILITY; duplicate `--tw-*` custom-property setters dedupe last-wins. Validates `renderApplyGroupedDeclarations` + `generateCss` in `emit-css.ts`. |

### S224 — ss42 named-machine undeclared-read (`7d009fb`)
| compiler/tests/unit/named-machine-undeclared-read-ss42.test.js | unit | **NEW** — Model-1 named-machine (`<engine name=X for=T>`) undeclared-cell read fires E-STATE-UNDECLARED. Tests the `hadNameAttr` gate that scopes the whole-body arrow-rule reject to the no-`name=` state-engine form only, ensuring named-machine `@cell` reads outside a reaction handler fire the correct diagnostic. |

### S225 — ss43 §18.19 multi-scrutinee match W2 (`41438514`)
| compiler/tests/unit/multi-scrutinee-match-ss43.test.js | unit | **NEW** — §18.19 multi-scrutinee `match (e1, e2) { (p1, p2) :> body }` parser+typer+codegen. Tests: two-scrutinee head parsed correctly; three-scrutinee; arm with wildcard `_` in one position; E-MATCH-SCRUTINEE-ARITY on arity mismatch; E-SYNTAX-012 on nested pattern in a position; E-TYPE-006 on non-exhaustive; partial-match opts out of exhaustiveness; expression-position multi-scrutinee match desugars to nested single-scrutinee dispatch. |

### S225 — ss49 + ss50 fixes (`3957f38e`, `1eb8ada5`)
| compiler/tests/integration/nested-fn-sql-escalation-regression.test.js | integration | **NEW** — ss49 g-sql-nested-fn: when a nested function inside a client-context fn uses a server-only resource (`?{}` SQL), the ENCLOSING function is escalated to server. Tests: nested fn with SQL escalates outer; nested fn in arrow; outer already server stays server; non-SQL nested fn does not escalate. |
| compiler/tests/integration/g-unary-of-exponent-arg-paren.test.js | integration | **NEW** — ss50 unary-`**`: a prefix unary operator applied to a `**` binary ALWAYS wraps the exponent operand with parens (`-(2 ** 3)` not `-2 ** 3`). Tests: all prefix unary ops (`-`, `~`, `!`, `typeof`, `void`); multi-level unary; interplay with `emitUnary` and `binaryOperandNeedsParens` in `emit-expr.ts`. |

### S225 — ss52 non-reactive local map/set (`5ebdbce3`)
| compiler/tests/integration/nonreactive-local-map-set-ss52.test.js | integration | **NEW** — ss52 Road-B-critical: non-reactive LOCAL value-native map/set (declared inside a function body, NOT a `@cell`) method calls (`.add`, `.set`, `.delete`, `.clear`, `.get`, `.has`, `.size`, `.entries`, `.keys`, `.values`) are lowered directly to their `_scrml_map_*` / `_scrml_set_*` runtime counterparts WITHOUT the reactive `@cell`-write wrapper. Tests: all map/set method lowering; nested function scope; mixed reactive + non-reactive; `collectLocalMapSetNames` + `collectAllLocalMapSetNames` scope separation. |

## S222 New Test Files (ss31 expr-validity + ss37 value-native Set §59.12)

5 NEW `.test.js` files across S222 codegen / type-system landings (+14 more in the S221 gap → find-count 1071→1090 at `12600217`). Full `bun test compiler/tests/` green. ZERO new §34 codes (ss31 reuses E-CODEGEN-INVALID-JS; set reuses E-MAP-BRACKET-WRITE).

### ss31 — codegen expr-validity (2 NEW + 1 EXTENDED, `9ac6967b`)
| compiler/tests/integration/g-double-unary-minus-emit-decrement.test.js | integration | **NEW** — B3: `-(-a)` serializes `- -a`, not `--a` (pre-decrement). |
| compiler/tests/integration/g-enum-toenum-client-structured-decl.test.js | integration | **NEW** — B2: client structured `<x> = Enum.toEnum(@raw)` AST lowering → `(Enum_toEnum[..] ?? null)`. |
| compiler/tests/integration/g-unary-left-of-exponent-paren.test.js | integration | **EXTENDED** — B1: bare `-@a ** 2` now fires loud E-CODEGEN-INVALID-JS ("write (-@a) ** 2"). |

### ss37 — value-native Set `set[K]` (3 NEW + 1 EXTENDED, `70b11383`)
| compiler/tests/unit/value-native-set-type-system.test.js | unit | **NEW** — `set[K]` resolution → map `[K:bool]`, `set[K]` diagnostic render, key-comparability, set-aware E-MAP-BRACKET-WRITE. |
| compiler/tests/unit/value-native-set-codegen-collector.test.js | unit | **NEW** — `collectSetVarNames` / `isSetTypeAnnotation` / `fileHasSetAlgebraUsage` collectors. |
| compiler/tests/integration/value-native-set-e2e.test.js | integration | **NEW** — membership, dedup-by-construction, struct-element value-correctness, `.add`/`.elements`/`.union`/`.intersect`/`.difference`, order-independent `==`. |
| compiler/tests/unit/expr-node-round-trip.test.js | unit | **EXTENDED** — `deepEqualExprNode` `case "map-lit"` regression (was `default: false`, rejected any `[:]`/`[k:v]` corpus init). |

## S220 New Test Files (ss17 + ss18 endpoint + ss19 auth + ss20 render-codegen + g-paren-ternary)

16 NEW `.test.js` files across S220 landings (find-count 1055→1071 at `852d6aa7`). Suite: **~25223 pass / 0 fail**.

### ss20 render-codegen fixes — 7 browser tests

| File | Category | What it covers |
|---|---|---|
| compiler/tests/browser/g-compound-bind-value-source-cell.browser.test.js | browser | ss20 compound-bind source-leaf fix. A `bind:value=@compound.field` where the dotted path root is a Variant-C structural nested-object cell now binds to the leaf cell (not the compound parent). |
| compiler/tests/browser/g-each-mount-form-submit-preventdefault.browser.test.js | browser | ss20 each-submit `preventDefault` fix. A `<form>` submit handler inside an `<each>` body emits `event.preventDefault()` before the server call (mirrors the non-each form path). |
| compiler/tests/browser/g-each-peritem-markup-value-ternary.browser.test.js | browser | ss17 + ss20 per-item markup-value in ternary arm. A ternary inside an `<each>` per-item body whose arm is a markup-as-value expression is reconciled (not skipped). |
| compiler/tests/browser/g-emit-lift-markup-text-interp.browser.test.js | browser | ss20 items 4+5 markup-text interpolation reactive. A TEXT child with `${expr}` inside a lift context is lowered via `_scrml_effect` so it updates reactively on cell change. |
| compiler/tests/browser/g-expr-event-handler-dead-in-each.browser.test.js | browser | ss17 expression-form event handler in `<each>` per-item body. The handler receives the event argument and re-resolves the live iter var. |
| compiler/tests/browser/g-if-guard-inner-effect-not-gated.browser.test.js | browser | ss20 if-guard gate (HIGH). A reactive interpolation inside an `if=`-gated element was emitting its `_scrml_effect` without the if-guard condition, causing updates in hidden branches. Now gated by `computeDisplayToggleCondition`. |
| compiler/tests/browser/g-nested-each-outer-key-reuse-inner-frozen.browser.test.js | browser | ss17 nested-each outer key re-resolve. An inner `<each>` handler that reads the outer iter var re-resolves via `_scrml_resolve_item(outerMount, outerKey)` so the outer item stays live after outer reconcile. |

### ss18 `<endpoint>` typed-inbound-endpoint — 5 integration + 4 unit tests

| File | Category | What it covers |
|---|---|---|
| compiler/tests/integration/endpoint-conformance-integration.test.js | integration | R26 conformance proof: `<endpoint>` app compiles → `node --check` → route record imported → `fetch`/`Request`/`Response` exercised against the handler. |
| compiler/tests/integration/db-src-runtime-path-consistency.test.js | integration | ss19 #9 db-src runtime path fix. Ensures the compiled server js DB-source path is consistent at runtime (no path truncation). |
| compiler/tests/integration/g-each-match-body-class-literal-extracted.test.js | integration | ss20 class literal extracted from `<each>`/`<match>` body via collect-class-names.ts (regression). |
| compiler/tests/integration/g-paren-ternary-operand-dropped.test.js | integration | g-paren-ternary fix. A binary operator whose operand is a ternary expression is re-parenthesized correctly: `@a + (@b ? @c : @d)` (was: `@a + @b ? @c : @d`). |
| compiler/tests/integration/sql-in-arrow-body-diagnostic.test.js | integration | ss19 SQL-in-arrow-body diagnostic. A `?{}` SQL block inside an arrow / lambda body fires a targeted steers-to-server-fn diagnostic instead of a silent miscompile. |
| compiler/tests/unit/endpoint-decl-parser.test.js | unit | W2 parser unit. `<endpoint>` parses `path=`/`method=`/`accepts=` attrs + arm bodies; E-ENDPOINT-PATH-MISSING / E-ENDPOINT-METHOD-INVALID / E-ENDPOINT-ACCEPTS-MISSING fire correctly. |
| compiler/tests/unit/endpoint-decl-typer.test.js | unit | W3 typer unit. `checkEndpointDeclarations`: E-ENDPOINT-NOT-EXHAUSTIVE on unhandled variant; E-ENDPOINT-ACCEPTS-NOT-ENUM on non-enum `accepts=`; wildcard arm satisfies exhaustiveness; undeclared `accepts=` reuses E-TYPE-UNKNOWN-NAME. |
| compiler/tests/unit/endpoint-decl-codegen.test.js | unit | W4 codegen unit. `async function _scrml_endpoint_<id>` emitted; `parseVariant` decode call; per-arm dispatch; `_scrml_endpoint_decode_error` helper; route record `{ path, method, handler }` exported; client bundle skips endpoint-arm helpers. |
| compiler/tests/unit/endpoint-private-arm-reachability.test.js | unit | §61.2 private-arm reachability. A non-exported pure `fn` referenced only from an `<endpoint>` arm body is emitted server-side (via `endpointServerHelperIds`) and skipped from the client bundle (via `endpointClientSkipIds`). |

NOTE: `trucking-dispatch-smoke-integration.test.js`, `server-fn-calls-server-fn.test.js`, `auth-redirect-tightening-integration.test.js`, `bug-18-scrml-stdlib-client-import.test.js`, `generate-auth.test.js`, `auth-graph-tightened-messages.test.ts`, `protect-schema-ddl-source.test.js`, `route-inference.test.js`, `session-auth.test.js`, `giti-032-ternary-markup-in-match-arm.test.js` are EXTENDED (not new files) — ss19 auth-wall cases added to existing test files.

Total NEW test FILES for S220: 16. Total at `852d6aa7`: **1071 .test.js** (verified `find compiler/tests -name '*.test.js' | wc -l` = 1071).


## S214 New Test Files (ss16 C3/C4 + ss15 bare-expr-render)

3 NEW `.test.js` across S214 landings (find-count 1036->1039 at `1ff06eae`).

| File | Category | Cases | What it covers |
|---|---|---|---|
| compiler/tests/integration/render-shadowing-ss16-c3.test.js | integration | ~8 | ss16 C3 render-shadowing fix. A file-level `function render` no longer hijacks the `render()` builtin call — the user fn is emitted as `_scrml_render_N` (§47 name-encoding) and the call site is rewritten by the `fnNameMap` post-pass. Tests: user `render` def compiles clean; call site routes to user fn; builtin `render()` call unaffected in a file WITHOUT a user `render` decl; `W-RENDER-SHADOWED` Info-lint fires at the user declaration. Commit `6650f1eb`. |
| compiler/tests/unit/eq-payload-variant-lint-ss16-c4.test.js | unit | ~10 | ss16 C4 W-EQ-PAYLOAD-VARIANT lint. A `==` comparison against a payload-bearing variant constructor (`.V(args)`) fires the Info-level warning. Tests: payload variant fires, non-payload variant clean, != form fires, nested in if-condition fires, match/given unaffected. Commit `6650f1eb`. |
| compiler/tests/unit/g-on-mount-bare-call-render-slot.test.js | unit | ~8 | ss15 bare-expr-is-effect fix. `on mount { val() }` and a bare `${ val() }` at program-body no longer emit a spurious `<span data-scrml-logic>` render slot. Tests: bare call at program root = effect (no render slot), bare call inside real markup element = renders, logic node with lift-expr keeps its placeholder. Commit `c13bbc48`. |

NOTE: `bug-1-tailwind-unrecognized-class.test.js` and `emit-html-meta.test.js` are EXTENDED (not new files);
`bare-variant-nested-context-inference.test.js` is NEW (ss16 C5 ctor-arg contextual typing). `request-id-render-bridge.test.js` and others are S213 carryover.
`parser-conformance-within-node-allowlist.json` is EXTENDED (allowlist update, not a test file).
Total NEW test FILES for S214: 3.

## S213 New Test Files (render-bridge + E-MATCH-BLOCK-IN-LIFT + api-decl-codegen)

3 NEW `.test.js` across S213 landings (find-count 1034→1036 at `fec0a054`).

| File | Category | Cases | What it covers |
|---|---|---|---|
| compiler/tests/unit/request-id-render-bridge.test.js | unit | 20 | `request-id-render-bridge-2026-06-22` (g-request-id-render-bridge-unwired HIGH, now CLOSED). The `<request> <#id>` render bridge fix: 20 codegen-shape tests covering (1) `_scrml_deep_reactive({...})` wrap on the state object, (2) `<#id>` in `${}` interpolation routes to `_scrml_request_<id>` not the §36 registry, (3) `<#id>` in `match on=` routes to `_scrml_request_<id>`, (4) `if=<#id>.loading` routes via the reactive path (not `_scrml_reactive_get`), (5) file-scope `const <x> = <#id>.data` hoisting fix (state object declared before top-level logic), (6) non-request `<#id>` (url= form) unchanged, (7) api= form state object also deep-reactive. Commit range `f144d7b1`→`635eb355`. |
| compiler/tests/unit/api-decl-codegen.test.js | unit | ~12 describe | A2 W5 deep-walk fix + api-decl codegen regression (`9d30ee93`). `<api>` block nested inside `<program>` markup subtree: endpoint registry correctly populated (was empty with shallow scan); `checkApiDeclarations` W3 typer checks fire for nested `<api>`; W4 `responseEnum` annotation set so `W-API-RESPONSE-NOT-VARIANT` fires on non-variant ResponseT in nested `<api>`. |
| compiler/tests/unit/uvb-w1-post-ce-invariant.test.js | unit | 70L | E-MATCH-BLOCK-IN-LIFT conformance (`43a996c1`). A block `<match for=T on=expr>` inside a `${ ... lift ... }` loop body emits ONE `E-MATCH-BLOCK-IN-LIFT` (not multiple E-COMPONENT-035 cascades); the suppressed arm nodes do NOT fire separate E-COMPONENT-035; a recognized `match-block` (the canonical BS-layer form) is NOT flagged; clean source produces no diagnostic. |

NOTE: S213 A2 W5 and PongAI C1/C2 carry ZERO new diagnostic codes. The render-bridge fix adds ZERO new §34 codes (all changes are codegen routing and parse fixes). E-MATCH-BLOCK-IN-LIFT is the single new §34 code from S213.

## S212 New Test Files (A2 W4 + flogence Bug A/B + Tailwind block scan + nested-each subscription + lift-concurrent TDZ)

5 NEW + 1 EXTENDED `.test.js` across S212 landings (find-count 1029→1034 at `8569f774`).

### S212 flogence Bug A + Bug B + A2 W4 (find-count 1032→1034, commits `3d311fc9` + `93e02b35` + `914029dc`)

| File | Category | Cases | What it covers |
|---|---|---|---|
| compiler/tests/browser/g-bare-ref-event-handler.browser.test.js | browser | 8 | g-bare-ref-event-handler-emits-literal-not-wired (MED, now CLOSED). `onclick=handler` (bare identifier, no parens, no `${}`) was emitting a literal `onclick="bump"` HTML attribute instead of wiring `handler` as the event listener. §5.2.2 row 5: the bare-ref form SHALL wire the resolved `_scrml_<name>_N` DIRECTLY as the listener (no `function(event){ fn(); }` wrap). Pre-fix: `onclick="bump"` → ReferenceError on click (dead handler). Post-fix: `data-scrml-bind-onclick="<id>"` + `addEventListener` in client.js wires the resolved reference. Tests: 8 cases (compile-clean, data-attr present, literal-attr gone, listener fires, event arg passed, call-form unaffected, expr-form unaffected, no-parens vs paren-call distinction). `3d311fc9`. |
| compiler/tests/browser/g-match-arm-reactive-attr-effects.browser.test.js | browser | 8 | g-match-arm-drops-reactive-attr-class-effects (HIGH, now CLOSED). A reactive `style="...${@cell}..."` attribute template OR a `class:foo=(cond)` directive INSIDE a `<match>` arm body compiled green but never wired its `_scrml_effect` (dead binding). Root: `collectMarkupNodes` (collect.ts) descends only `node.children`, never arm bodies. Fix: arm-body class:/attr-tpl directives are registered as arm-tagged registry logic-bindings (kinds `"class-directive"` / `"attr-template"`) carrying the lowered JS expr; `emitArmWireFunction` (emit-variant-guard.ts) re-emits `classList.toggle` / `setAttribute` + `_scrml_effect` per-mount, disposed on variant change. Tests: 8 cases (class: inside arm toggles post-cell-write, style attr-tpl inside arm updates, outside-arm bindings unaffected, teardown on variant change). `93e02b35`. |

EXTENDED: `compiler/tests/unit/api-decl-typer.test.js` +3 cases (19 total at `914029dc`): W-API-RESPONSE-NOT-VARIANT non-fatal lint — struct ResponseT fires Info, `:enum` ResponseT clean, `asIs` ResponseT clean (deliberate raw-pass escape hatch).

EXTENDED (`8569f774`→`8ddc8448`, ss4 — find-count UNCHANGED at 1034, no new test FILES):
- `compiler/tests/unit/block-analysis.test.js` +3 cases (ss4 item-3, `05df4c48`): function-decl block `end`/`endLine` no longer overshoots into the next function (the `spanOf` `peek()`→`peek(-1)` fix); regression for G-BLOCK-ANALYSIS-FN-SPAN-OVERSHOOT.
- `compiler/tests/parser-conformance-lexer.test.js` modified (ss4 item-2, `3cd58aa4`): 3 native-lexer bench residuals flipped to byte-identical full-gate comparison (lexer-conformance fidelity; no compiler-src change).

### S212 prior batch (find-count 1029→1032 at `a9c2108f`)

3 NEW `.test.js` across S212 landings.

| File | Category | Cases | What it covers |
|---|---|---|---|
| compiler/tests/integration/g-tailwind-markup-block-scan.test.js | integration | — | Tailwind class names inside `<match>`/`<each>` markup-block arm bodies are collected and emitted as CSS; regression for collect-class-names.ts `match-block`/`each-block` body-descent (g-tailwind-not-scanned-in-match-arms) |
| compiler/tests/browser/g-nested-each-no-own-subscription.browser.test.js | browser | — | A nested `<each>` inside an outer `<each>` per-item body re-renders when its source cell changes post-mount (Approach C `_scrml_effect` wrapper on inner reconcile); covers Tier-1 and Tier-0 paths (g-nested-each-no-own-subscription) |
| compiler/tests/unit/lift-concurrent-transitive-tdz.test.js | unit | — | Lift-concurrent scheduler does not batch a statement ahead of a declaration it transitively depends on; also covers reassigned-`let` exclusion from const-destructure batches (g-lift-concurrent-transitive-exclusion-tdz) |

NOTE: S212 prior batch adds ZERO new diagnostic codes (all three are behavior-only codegen fixes — no new §34 E-/W- entries). S212 A2 W4 adds +1 NEW code: W-API-RESPONSE-NOT-VARIANT (Info, non-fatal). See error.map.md.

## S211 New Test Files (W-INTERP-IN-RAW-CONTENT lint + A2 W3 api-decl typer + ss3 parser fixes)

5 NEW `.test.js` across S211 landings (find-count 1024→1029 at `6d8a47ab`).

| File | Dir | Coverage |
|------|-----|----------|
| compiler/tests/unit/lint-w-interp-in-raw-content.test.js | tests/unit/ | `db5d91b6` (ss11 item 1). W-INTERP-IN-RAW-CONTENT conformance: `${...}` interpolation / `<TagName>` opener / brace-sigil inside `<pre>`/`<code>` body fires the info lint → result.warnings (non-fatal); lowercase HTML `<pre>`/`<code>` targets; PascalCase `<Pre>` excluded; nested raw elements; multiple tokens in one body fires once (first detected); clean bodies produce no diagnostic. |
| compiler/tests/unit/api-decl-typer.test.js | tests/unit/ | `612f92e6` (A2 W3). `checkApiDeclarations` conformance: E-API-PATH-PARAM-UNBOUND (path template `${param}` not in RequestType struct fields); E-API-ENDPOINT-UNKNOWN (`<request api="X">` names no declared endpoint); E-API-REQ-SHAPE-MISMATCH (`<request args=V>` missing required struct fields); clean declaration + matching request passes with no errors. |
| compiler/tests/unit/api-decl-parser.test.js | tests/unit/ | `8d4e96ae` (A2 W2 — S210). `parseApiDecl` conformance: E-API-BASE-MISSING / E-API-RESPONSE-TYPE-UNDECLARED / E-API-METHOD-INVALID / E-API-ENDPOINT-MALFORMED. (Present at `5c68e87e`, carried here for completeness.) |
| compiler/tests/integration/g-paren-receiver-group-dropped.test.js | tests/integration/ | `aae34c26` (ss3). Paren-grouping preservation before method/index/call receivers: `(a + b).toString()` no longer inverts to `a + b.toString()`. 5 describe blocks. |
| compiler/tests/unit/each-sigil-expr-parser.test.js | tests/unit/ | `544e5c42` (ss3). `@.` sigil structuring in expression-parser: iteration sigil now produces an `IdentExpr` leaf; attribute-condition `@.` tokenizes correctly. |

## S202 New Test Files (the each-inline Class-A arc + the NEW e2e render known-failure-map test capability)

4 NEW `.test.js` across the S202 codegen arc + the e2e render-map DD MVP (find-count 1000→1004 at `60d547e1`).

| File | Dir | Cases | Coverage |
|------|-----|-------|----------|
| compiler/tests/browser/each-over-arm-payload-binding-unbound.browser.test.js | tests/browser/ | 10 | `60d547e1` (g-each-over-arm-payload-binding-unbound RESOLVED). A TOP-LEVEL `<each in=BARE>` whose iterable is the enclosing match-/engine-arm PAYLOAD binding (`.Loaded(rows)` → `<each in=rows>`): pre-fix the flattened top-level no-arg render fn emitted `const _items = rows;` UNBOUND → ReferenceError at mount; post-fix it resolves from `_scrml_reactive_get(cell).data[field]` gated on the current variant. Both match arms + engine arms (ONE shared `stampArmPayloadEaches` mechanism). Bug-57-style happy-dom mount. |
| compiler/tests/browser/g-each-inline-prop-member.browser.test.js | tests/browser/ | 14 | `d830ec59` (g-each-inline-component-prop-member-unsubstituted + g-inlined-component-root-class-interp-raw RESOLVED). An inlined component's string-literal markup-attr `${...}` segments carrying a prop member-access (`${load.id}`) or call-arg (`${cls(status)}`) substitute the prop ref correctly (CE `substituteInterpSegments`); an interpolated root `class=` emits the substituted expr (class-merge post-substitution), not raw `${...}`. The board `<each>` / for-lift render. |
| compiler/tests/e2e-render-map/e2e-render-map.test.js | tests/e2e-render-map/ | 4 describe blocks | `0a0e0391` — the L1 e2e render known-failure-MAP delta-gate (WARN-not-fail on the fast slice). Re-observes the FAST representative slice (examples + benchmarks, in-process ~3s); reports the green→red delta against the on-disk baseline (e2e-render-map-baseline.json). Gaps existing is NOT a failure; the gate fails ONLY on a closed cell re-opening. The hard gate is `bun generate-baseline.js --check` on CI/pre-push. |
| compiler/tests/e2e-render-map/detector-validation.test.js | tests/e2e-render-map/ | 3 describe blocks | `0a0e0391` — PROVES the D0–D7 detectors FIRE on the 3 S202 acceptance-bug shapes (D3 `[object`-in-DOM via a still-live genuine trigger; D1+D7 unbound-ref + D4 raw-`${`-in-attr via reproduced historical-broken renders). The regression-sentinel guarantee — if a bug class re-opens, the detector catches it. |

NEW test-infra capability — `compiler/tests/e2e-render-map/` (the L1 render known-failure map, `0a0e0391`; tier-tagged `04ad76e3`):
the standing whole-corpus render harness from the e2e-known-failure-map DD MVP. Non-test support modules:
- render-corpus-enumerator.js — pure inventory of `<program`-rooted apps (examples/ + samples/ + benchmarks/; EXCLUDES stdlib/self-host); tier-tags flagship/probe/stress/perf/sample (`tierOf`).
- render-detectors.js — D0–D7 oracle-FREE render-invariant set (compile-fail / mount-throw / console.error / `[object ` / raw `${` / nullish text / empty-with-seeded-data / `is not defined`). Classifies; NEVER suppresses an error class.
- render-harness.js — compileScrml({write:true}) → mount in happy-dom → run detectors → record per-app/per-seed state + smells (R26 industrialized; empty + populated as SEPARATE cells).
- generate-baseline.js (+ `--check` CI gate), observe-one.js, seed-fixtures.js — baseline writer + probes.
- e2e-render-map-baseline.json — the known-failure ALLOWLIST (434 apps / 438 cells).
- fixtures/ — d1d7-unbound-ref.scrml, d3-object-in-dom.scrml, d4-raw-interp-attr.scrml.

The 3 S201 test files (markup-value-render.browser, g-markup-value-in-expression, g-nested-component-member-arg + each-block extended) were NOT re-sectioned into the test-map body in the S201 incremental (structure/domain/primary only — see the line-25 Total note); the find-count carried them (1000 at `fa2edccf`).

## S200 New Test Files (component-with-helper inlining + `<each>` per-item §42 predicate / `if=`)

3 new browser regression files across 3 commits (g-each-component-body-invalid-js + g-each-peritem-if-predicate).

| File | Dir | Cases | Coverage |
|------|-----|-------|----------|
| compiler/tests/browser/g-each-component-helper-hoist.browser.test.js | tests/browser/ | 5 | `60ace8b4` (S200 STEP 1, Bug-57 style). A consumer DIRECTLY importing a component-with-helper from module M: CE hoists M's non-component (helper) exports into the consumer's existing import bindings so the inlined body's helper calls resolve in BOTH the TS symbol table AND codegen `_scrml_modules[key]`. Pre-fix: E-SCOPE-001 (each per-item path) / silent runtime ReferenceError (Tier-0 `${for…lift}`). |
| compiler/tests/browser/g-each-component-transitive-helper.browser.test.js | tests/browser/ | 5 (4 fail pre-fix) | `ecba9fee` (S200 STEP 2 A+B). A component whose body renders ANOTHER imported component-with-helper, with an expression-valued nested prop. STEP 2-A: CE's enrichment BFS synthesizes a consumer import + `importGraph` edge for the TRANSITIVELY-reached inner module's helper exports. STEP 2-B: `buildPropExprMap`/`substitutePropsInExprNode` substitute EXPRESSION-valued nested props (parseExprToNode + IdentExpr-replacement walk). |
| compiler/tests/browser/g-each-peritem-if-predicate.browser.test.js | tests/browser/ | 5 (5 fail pre-fix) | `39bd061f` (S200 C1+C2). C1: a per-item expr carrying a §42 absence predicate (`is some`/`is not`/`not`) lowers via `lowerEachExpr` → `parseExprToNode`→`emitExprField` (was invalid JS `String((x is some))`). C2: a per-item element `if=` attribute gates `fragmentVar.appendChild(elVar)` behind the lowered predicate. Full suite at the land: 24,386 / 0. |

Also fixed (not a new file) by `39bd061f`: the nested-component member-arg misparse on the each per-item path (see commit `64f189b7` docs).

## S198-S199 New Test Files (engine-hydration arc — A-leg `initial=@cell` + E-leg `server=@source`)

2 new unit files (`7532bd8f` S198 A-leg / `2e3aa6a4` S199 E-leg). Full suite at the E-leg land: 24,372 pass / 0 fail / 1009 files; within-node parity clean. R26 dog-food verified (bare-root + dotted field-access; compile exit 0, `node --check` OK).

| File | Dir | Cases | Coverage |
|------|-----|-------|----------|
| compiler/tests/unit/engine-hydration-initial-cell.test.js | tests/unit/ | 16 | `7532bd8f` (S198 A-leg). `initial=@cell` SNAPSHOT-once: parser captures `initialCell`; codegen emits `emitEngineCellHydrationInit` deferred after `reactiveLines`; routes through guard-free `_scrml_engine_hydrate_init`; E-ENGINE-INITIAL-BOTH-FORMS (vs `initial=.Literal`), E-ENGINE-INITIAL-CELL-UNDECLARED, E-ENGINE-INITIAL-CELL-TYPE fences; the runtime decoder-boundary `E-ENGINE-INITIAL-INVALID-VARIANT`. Construction-not-transition. |
| compiler/tests/unit/engine-hydration-server-source.test.js | tests/unit/ | 18 | `2e3aa6a4` (S199 E-leg). `server=@source` REACTIVE server-authoritative: parser captures `serverSource` (bare-root + dotted `@driver.current_status`); codegen `emitEngineServerSourceHydration` emits the `_scrml_reactive_subscribe(rootCell)` → guard-free `_scrml_engine_hydrate_init` IIFE with null-safe field-walk + skip-if-absent; mutual-exclusion E-ENGINE-SERVER-WITH-DERIVED / E-ENGINE-SERVER-WITH-INITIAL-CELL; W-ENGINE-SERVER-SOURCE-NOT-AUTHORITATIVE info nudge; reuses A-leg E-ENGINE-INITIAL-CELL-* on bare-root; W-ENGINE-INITIAL-MISSING suppression; DG credits the root cell (no false E-DG-002). |

Also EXTENDED (not new) by `4f6aa2e8` (HOS showcase): compiler/tests/integration/trucking-dispatch-smoke-integration.test.js (+7L — the `<engine for=HOSStatus server=@source>` dog-food on examples/23-trucking-dispatch/pages/driver/hos.scrml + components/driver-card.scrml). The within-node allowlist (`parser-conformance-within-node-allowlist.json`) was bumped by both legs (+1 MISSING-FIELD per engine-decl for `initialCell`/`serverSource`, the native-parser parity backlog).

## S196 New Test Files (render-expression primitive `<render of=X/>` + render-expr prereq steer)

5 new files across 2 commits (`471cbb34` render-expression primitive / `fcdec43c` render-expr prereq-bugs). Full suite at the primitive land: 24,321 pass / 0 fail.

| File | Dir | Cases | Coverage |
|---|---|---|---|
| compiler/tests/integration/render-expr-primitive.test.js | tests/integration/ | 6 (5 describe blocks) | `471cbb34`. The `<render of=X/>` primitive end-to-end via `compileScrml`: §19.15.3 exhaustiveness fence (E-RENDER-NO-CLAUSE fires when a held-enum variant has no `renders`; a non-enum `of=` target is an inert no-op, NOT godified — limit-primitives); §19.15.1 E-RENDER-NO-OF fires when `<render>` has no `of=`; BOTH loci dispatch on `(X).data` — match-arm payload `<render of=err/>` (per-variant `switch` against the held payload) + top-level `<render of=@cell/>` (switch fills + SUBSCRIBES the cell for reactive re-render); §19.15.4 `<errorBoundary>` catch path UNPERTURBED (a boundary catching a live `!`-call still emits the `__scrml_error` gate + variant switch). |
| compiler/tests/unit/h1-steer-markup-in-value-match.test.js | tests/unit/ | 8 | `fcdec43c`. E-MATCH-ARM-MARKUP-IN-VALUE — the early TYPER-stage steer: a JS-style value-`match` arm whose body is a MARKUP element fires the steer as the SOLE diagnostic (arm-body visit skipped, no downstream E-CODEGEN-INVALID-JS / E-SCOPE-001 cascade); block-form `<match>` structurally exempt. |
| compiler/tests/unit/g-failable-arm-nested-constructor-crash.test.js | tests/unit/ | 6 | `fcdec43c`. Render-expr prereq (was S195 HIGH g-failable-arm-nested-constructor-crash): a payload-bearing variant CONSTRUCTOR nested as an arg in an `!{}` arm now lowers to a valid frozen-enum constructor call (no string-invoked-as-function mangle, no E-CODEGEN-INVALID-JS); plain-fn-body control + qualified unit-variant read unaffected. |
| compiler/tests/unit/g-shorthand-interp-match-arm-codegen.test.js | tests/unit/ | 8 | `fcdec43c`. Render-expr prereq (was S195 MED g-shorthand-interp-match-arm-codegen): `${...}` interpolation inside a `<match>`-arm `:`-shorthand display-text literal (§4.18.4) now lowers correctly instead of emitting literally. |
| compiler/tests/unit/g-match-arm-apostrophe-bs.test.js | tests/unit/ | 8 | `fcdec43c`. Render-expr prereq (was S195 MED g-match-arm-apostrophe-bs): an apostrophe in `<match>`-arm FREE-TEXT prose (`We'll`) no longer breaks the block-splitter's string-delimiter scan (was E-CTX-001 "Unclosed `<match>`"). Same family as the S144 `//`-in-string cluster. |

Also EXTENDED (not new) by `471cbb34`: compiler/tests/unit/html-elements.test.js (+10L — the `<render>` element registry row: registered structural, self-closing, `of=` required, `rendersToDom:false`) + compiler/tests/unit/type-system.test.js (+5L). The within-node parity allowlist (`parser-conformance-within-node-allowlist.json`) was rebumped by the SEPARATE corpus-wave-2 commit `2c8c8edd` (NOT a render-expr change). NOTE: the 4 `g-*` prereq files close render-expr blockers filed open at S195 — g-each-body-bare-variant-arg (HIGH), g-engine-autodecl-bare-variant-write (MED), g-blocksplitter-comment-span-not-opaque (LOW), g-each-body-sigil-invariant-classifier (LOW) remain open (not in this wave).

## S195 New Test File (GAP-A: §24 void elements self-terminate in `<match>`/`<each>` arm bodies — `f563bc89`)

| File | Dir | Cases | Coverage |
|---|---|---|---|
| compiler/tests/unit/match-arm-void-element-scanner.test.js | tests/unit/ | 13 (46 expects), 3 describe blocks | §1 — `parseMatchArms` treats a void direct child as a self-terminating leaf: self-closed `<input/>` AND bare `<input>` direct children of a `<match>` arm body close correctly (no E-MATCH-PARSE-001), `<br>`/`<img>`/multi-void/void-wrapped-in-`<label>` cases. §2 — a genuinely-unclosed NON-void arm STILL fires E-MATCH-PARSE-001 (the fix did not weaken the unclosed-arm detector). §3 — end-to-end `compileScrml` compile: a void direct child of a match arm compiles clean (was a misleading E-CTX-001 "Unclosed `<match>`" pre-fix). Uses the cross-stream `findDiagnostic(result, code)` helper (W-/I- partition rule). Imports `parseMatchArms` directly from `../../src/match-statechild-parser.ts`. Full suite 24285/0. Repro/fixtures: `__fixtures__/match-arm-void-element-scanner/`; BRIEF at `docs/changes/match-arm-void-element-scanner-2026-06-15/`. |

## S191 New Test Files (Tailwind composing-utility families §26.7.x + if=fn() condition routing)

4 new files (`ed3fa5ee`/`f5b71e61`/`ddf5919d`/`004007fb` Tailwind / `98bdb760`/`90fd7412` if=fn):

| File | Loc | Tests | Covers |
|------|-----|-------|--------|
| compiler/tests/unit/bug-1-tailwind-filter-family.test.js | tests/unit/ | 28 | §26.7.3 Phase 4 — filter + backdrop-filter families compose via Approach C: `filter:`/`backdrop-filter:` shorthands (`FILTER_COMPOSE`/`BACKDROP_COMPOSE`) built from `var(--tw-blur,) …` with EMPTY inline fallbacks; named `registerFilters()`/`registerBackdrop()` utilities each set one `--tw-*` filter var; `-webkit-backdrop-filter:` prefix present; arbitrary `blur-[<len>]`. NO global preflight block. |
| compiler/tests/unit/bug-1-tailwind-gradient-family.test.js | tests/unit/ | 14 | §26.7.1 Phase 2 — `registerGradient()`: `bg-gradient-to-{dir}` → `background-image: linear-gradient(<dir>, var(--tw-gradient-stops, …))`; `from-`/`via-`/`to-` color stops set `--tw-gradient-from`/`-via`/`-to`/`-stops` with transparent-twin defaults; arbitrary `from-[<color>]`. |
| compiler/tests/unit/attr-if-fn-call-conditional.test.js | tests/unit/ | 12 | `g-attr-if-fn-call-misroute` — a bare-call `if=fn()` / `show=fn()` condition lowers identically to the paren form `if=(fn())`: emits a reactive conditional binding (`data-scrml-bind-if`/`-show` + logic binding), NOT a DOM event binding; `@`-args dynamic-track; the fn name mangles. |
| compiler/tests/unit/attr-if-fn-condition-followup.test.js | tests/unit/ | 5 | `g-attr-if-fn-display-not-mount` + `g-attr-if-fn-chain-head-call-misroute` — a clean-subtree `if=fn()` gets the mount/unmount controller (not display-toggle); a chain-head / else-if `if=isHigh()` is CALLED (not read as a cell → branch activates). |

NOTE (S191): all 4 are unit tests; zero new diagnostics (Tailwind = recognition coverage so W-TAILWIND-UNRECOGNIZED-CLASS no longer fires on these tokens; if=fn = a codegen routing fix). Extended files: bug-1-tailwind-ring-family (34 cases, §26.7 Phase 1 ring/shadow `BOX_SHADOW_COMPOSE`/`ringShadowSetter`), bug-1-tailwind-transform-shorthand (37 cases, §26.7.2 Phase 3 `TRANSFORM_COMPOSE`), bug-1-tailwind-minor-families (26), bug-1-tailwind-unrecognized-class (39), bug-1-tailwind-arbitrary-value-emit (66), tailwind-classes (160).

## S190 New Test Files (§51.0.J derived-engine expression form + Cluster C decl-boundary)

2 new files (`11c648c7` Cluster C / `f0030049` derived-engine-expression):

| File | Loc | Tests | Covers |
|------|-----|-------|--------|
| compiler/tests/unit/derived-engine-expression-form.test.js | tests/unit/ | 16 | §51.0.J derived-engine EXPRESSION form end-to-end: `derived=match @var { .A => .X }` (inline-match kind); `derived=@miles > 500 ? .High : .Low` (expr kind); multi-cell `derived=@a > 0 && @b > 0 ? .On : .Off` (enumerates both upstreams); call form `derived=classify(@score)` (expr kind, arbitrary call). Rejection cases: NO-RULES / NO-INITIAL / NO-WRITE / CIRCULAR (B16 codes) fire for modern kinds; opener `effect=` / state-child `effect=` still fire E-ENGINE-EFFECT-NOT-INTERPOLATED; legacy trailing-attrs still parse. c14-derived-engines.test.js extended +2 boundary block cases (plain-cell `derived=@var` → E-ENGINE-004 with §51.0.J steer in wrap commit `1e17213e`). |
| compiler/tests/unit/cluster-c-decl-boundary.test.js | tests/unit/ | 19 | Cluster C parser fixes: E-DECL-RHS-INTERP-WRAPPED (Bug 1) — a `const`/plain/typed decl with a `${}` wrapped RHS fires the error and recovers (no cascade E-SCOPE-001); control cases with a bare RHS expression still parse cleanly. Markup-const sibling-swallow (Bug 2) — a markup-const `<div>...</div>` followed by a cell decl, a derived decl, a fn, a bindable no longer consumes the sibling into the markup body; the sibling registers as a separate node. The `</>` root-close double-decrement guard: an inner self-closer inside a markup-const body does not prematurely trip `markupRootClosed`. |

NOTE (S190): both are parser/type-pass unit tests. E-DECL-RHS-INTERP-WRAPPED is severity:error → result.errors.
The markup-const sibling-swallow fix is a PARSE correctness fix (no diagnostic); regression is a node-count / node-kind assert.
`derived-engine-rejections.test.js` was extended (not new) to reword the B16 NO-RULES message to cover state-child `rule=` attr shape.
Full suite at `f0030049`: 24100/0.

## S185 New Test Files (errarm re-fail-from-arm 2-layer + E-VALIDATOR-INLINE-COLON validator inline-msg paren-canon)

| File | Covers |
|---|---|
| compiler/tests/unit/errarm-refail-lowering.test.js | re-fail-from-arm (§19.5.2) lowering: a `fail` inside an `!{}` error-arm + a `<match>` match-expr arm lowers to a function-exiting `return { __scrml_error, … }` error envelope; NS-1 fires E-ERROR-001 when the enclosing function is non-`!`; the spurious E-SCOPE-001 on the `fail` keyword is gone; `?`-propagate const-decl re-fail/re-wrap path (11 cases). Repro fixtures under docs/changes/errarm-refail-lowering-2026-06-11/repro/. |
| compiler/tests/unit/validator-inline-colon.test.js | E-VALIDATOR-INLINE-COLON: the colon-form validator inline-message override (`<name req:"…">`, `<name length(>=2):"…">`) reject + paren-form recovery; the colon form no longer corrupts `@`-cell registration (no misleading E-SCOPE-001 cascade); E-VALIDATOR-INLINE-COLON is the only diagnostic; paren + typed-cell colon control cases still WORK (10 cases). Repro fixtures under docs/changes/validator-inline-message-colon-form-2026-06-11/repro/. |

## S175 New Test Files (typed-SQL-row arc — the flagship typed-data delivery + function-boundary rule)

| File | What it covers |
|------|----------------|
| compiler/tests/unit/sql-projection-extract.test.js | **NEW (13 cases).** `extractSelectProjection(query)` (sql-projection.ts) — explicit column lists, `t.col` qualified sources, `AS` aliases, the FROM-JOIN alias map, and GRACEFUL DEGRADATION on the deferred long tail (`*` wildcard / CTE / UNION / subquery-in-FROM return an under-determined projection). Pure extractor unit test (no type pass). |
| compiler/tests/unit/sql-row-typing.test.js | **NEW (4 cases, §14.8.7).** Tranche-1 read-site row typing: `resolveSqlRowType` joins the SELECT projection against the generated table types so a `?{ SELECT ... }` host node resolves to a typed projection-row struct; the untyped long tail degrades to `asIs` + `W-SQL-ROW-UNTYPED`. |
| compiler/tests/unit/sql-row-tranche2-width-subtype.test.js | **NEW (18 cases, §14.8.8).** The bounded width-subtyping helper (`checkSqlRowWidthSubtype`): every contract field present + assignable, EXTRA row columns allowed, one-directional, general struct-to-struct stays nominal. **T2a** — typed loop-var row access end-to-end (`r.<unknown>` → E-TYPE-004). **T2b** — call-site prop-contract check (`checkPropContract` → `E-SQL-ROW-CONTRACT-MISMATCH` per unsatisfied field, fed by the `__propContractChecks` descriptor). |
| compiler/tests/unit/sql-row-tranche3-typeflow.test.js | **NEW (17 cases, §14.8.8).** End-to-end type-flow: **T3b** — `unwrapStructContractElement` + `checkSqlRowAgainstCellContract` (width-check INTO a `:struct`-typed state cell at the cell boundary). **T3c** — `resolveSqlRowSourceFromExpr` / `inferReturnTypeFromBody` (a server-fn body returning a projection row over-approximates via the `<fn-return>` sentinel; those inferred types are EXEMPT from the reject). |
| compiler/tests/unit/struct-fn-field-reject.test.js | **NEW (11 cases, §14.3/§15.11).** `E-STRUCT-FUNCTION-FIELD` — POSITIVE (a named struct decl with a function-typed field is rejected), NEGATIVE (lifecycle annotations `(A to B)` + plain fields do NOT reject — the conservative `isFunctionTypeAnnotation` predicate), and NATIVE-PARSER parity (the reject fires under `--parser=scrml-native` too). The escalation of the retired S173 W-TYPE-FN-FIELD Info-nudge to a hard Error. |

NOTE (S175): all five are type-pass / extractor unit tests (no happy-dom needed — the typed-SQL-row arc is a
type-checking feature, not a runtime/codegen one). The diagnostics are decl-site/read-site scans wired in
type-system.ts (~15917 `checkFunctionTypedStructFields` / row-typing read sites). Cross-stream assertion
applies for `W-SQL-ROW-UNTYPED` (Info → result.warnings — a `result.errors.filter` on a W- code silently
passes; see the diagnostic-stream-partition note). No new AST node shapes; default pipeline output UNCHANGED.

## S176 New Test Files (unrecognized-type-name reject + `pure`-deprecation + scrml:math / scrml:random / scrml:time.now())

| File | What it covers |
|------|----------------|
| compiler/tests/unit/unknown-type-forbidden.test.js | **NEW (25 cases, §14.1.2).** `E-TYPE-UNKNOWN-NAME` end-to-end — POSITIVE: an unrecognized type name fires at EVERY locus (state-cell annotation `<x>: Frobnicate`, struct field, enum-variant payload field, type-alias RHS, fn param + return type). NEGATIVE: built-ins / same-file decls (incl. forward refs) / imported types / `asIs` do NOT fire; single-file-mode imported names + machine-typed cells exempt. |
| compiler/tests/unit/unknown-type-name-predicate.test.js | **NEW (38 cases).** The `isUnrecognizedTypeNameAtom` leaf classifier in isolation: `Frobnicate` (genuine unknown PascalCase) → true; `asIs` / primitives (`string`/`number`/`int`/`boolean`) / the lowercase NAMED_SHAPES vocabulary (`email`/`url`/`uuid`/`phone`/`color`) / the 8 PascalCase built-in error+enum types → false. Pins the PascalCase gate + the registry/exempt-set logic. |
| compiler/tests/unit/stdlib-math.test.js | **NEW (28 cases, §41.18).** `scrml:math` PURE scalar vocabulary: `round`/`floor`/`ceil` rounding direction, `abs`, `min`/`max`, `clamp`, `parseInt`/`parseFloat`/`toNumber`/`isNaN` — value behavior of the `compiler/runtime/stdlib/math.js` shim. |
| compiler/tests/unit/stdlib-random-capability.test.js | **NEW (13 cases, §41.20).** `scrml:random` capability gate: `random()` / `randomInt()` in a `server function` or `function` → OK; in a pure `fn` body → **E-FN-004** (the generalized imported-non-det-binding gate). Plus `randomInt` closed-interval bounds behavior. |
| compiler/tests/unit/stdlib-time-now-capability.test.js | **NEW (8 cases, §41.19).** `scrml:time.now()` capability gate, UNIFORM with the host non-det gate: `now()` in `server function`/`function` → OK; in a pure `fn` → E-FN-004; a USER's own `function now() {}` called in a `function` is NOT falsely gated (binding-resolution, not name-match). |
| compiler/tests/unit/stdlib-transitive-shim-copy.test.js | **NEW (3 cases).** `bundleStdlibForRun` transitive sibling-shim copy: `scrml:time` alone copies `time.js` AND its `./math.js` dep; `scrml:oauth` alone copies `oauth.js` + `./http.js` + `./crypto.js` (latent-bug fix); a leaf shim (`path`) with no sibling imports copies only itself. |

NOTE (S176): the two type-reject files are type-pass / predicate unit tests; the three stdlib files
are capability-gate + shim-behavior tests; transitive-shim-copy is an `api.js bundleStdlibForRun` test.
No happy-dom needed. Cross-stream assertion applies for `W-PURE-DEPRECATED` (Info → result.warnings).
Also touched (not new): `scrml-migrate.test.js` (+Migration-3 `pure`→`fn` cases) and
`stdlib-shim-resolution.test.js` (+2). The `s33-pure`/`s48-fn`/`fn-constraints` suites were updated
for the `pure`-modifier deprecation.

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
| compiler/tests/parser-conformance-within-node.test.js + within-node-allowlist.json | updated S164-S170 — native↔live within-node parity; the allowlist tracks remaining per-family gaps. **S170 fix-wave-1 surgically reconciled the allowlist for the combined GROUP-P+T AST-shape changes (34 over-budget files → current; PARSE-FAILURE:0 / NESTED-SHAPE:0; the deltas are benign parity-churn from the deliberate shape changes); fix-wave-2 needed NO reconcile.** |
| compiler/tests/integration/m6.4a-native-p2-form1.test.js (§B) | S166 ROOT-2: emitted-output regression for the native cross-file `${...}`-wrapped `export const Name = <markup>` raw-slice fix — `<Badge/>` markup EXPANDS in consumer HTML, E-COMPONENT-020/035 GONE (was `raw=""` → empty CE registry). |

NOTE: S165's four families (F2-match string-lit arms, promote-each, R1 typed-`@cell`, server-fn-star) were
landed with parser-conformance + within-node coverage (1005/0) and the swap flip-harness re-measure; the
S165 dispatch BRIEFs (docs/changes/native-f2match-literal-arm-2026-06-05/ etc.) record the per-family R26
byte-identity checks. The flip harness (default exit-0 vs `--parser=scrml-native`) is the family-level gate;
a fix-dispatch agent re-runs it to re-rank before picking a family.
S166 landed two re-triage roots: bare-`function` failable `76059024` (within-node residual-preserving rebump —
27 class-budgets across 14 failable fixtures whose now-reachable bodies surface PRE-EXISTING native residuals;
1005→991→1005; full suite 23,054/0) + cross-file `${...}`-export `9d12d980` (within-node 1005/0 with NO allowlist
rebump — resolved via a `bodyStart` STRIP_KEY in within-node-classifier.ts; cross-file integration 48/0).
**S170 re-measured 605 native-only flip-failures on `df08f282` (default BS+Acorn 0-fail / fully green) → ~508**
after fix-wave-1 `5a346faa` (within-node allowlist surgically reconciled, 34 over-budget → current; PARSE-FAILURE:0/
NESTED-SHAPE:0) + fix-wave-2 `cc69c62d` (NO allowlist reconcile; full suite 23405/0). See the S170 section below.

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

## S170 New / Corrected Test Files (Bug B codegen + set-algebra stdlib + native-parser fix-wave-1/2)

| File | What it canaries |
|------|------------------|
| compiler/tests/unit/structural-compound-deepset.test.js | **NEW (5 emit-shape).** `@a.ref = v` on a Variant-C structural compound (`<a><ref>=""</>` → `a` is a `_scrml_derived_declare` composite) now retargets the WRITE to the backing LEAF cell (`_scrml_reactive_set("a.ref", v)` single-segment; COW `_scrml_deep_set` into the leaf for residual/computed) instead of the composite key `a` (which the derived recompute clobbered). FLAT object cells unchanged. Bug B fix (`reactive-deps.ts:stampCompoundDeepSetTargets` + emit-logic.ts). |
| compiler/tests/browser/browser-structural-compound-deepset.test.js | **NEW (4 happy-dom runtime acceptance).** Drives the DOM-event → handler → deep-set path on a structural-compound cell and asserts the write SURVIVES the derived recompute (was a silent lost mutation even for a single write). |
| compiler/tests/unit/cow-bracket-write-emit.test.js (×2 cases) + deepset-write-loss-position.test.js | **CORRECTED (Rule-4).** Two prior tests LOCKED the Bug-B mistarget as expected output; updated to the SPEC-faithful leaf-cell shape (SPEC §6.3.2). |
| compiler/tests/unit/data-set-algebra.test.js | **NEW (16, value-correct over structs).** `scrml:data` `union`/`intersection`/`difference`/`member` over plain arrays return value-DISTINCT arrays agreeing with `==` (§45) — `Array.includes`/JS `Set` reference-keying would be WRONG for structs/enums/nested maps; the helpers reuse the §59.5 value-canonical codec (`_data_value_canonical`). Also asserts `unique`'s no-key path now value-dedups (was `[...new Set]`, struct-broken). Type DEFERRED — these are PRIMER-only transforms, NO `set` type. |
| compiler/tests/unit/native-on-lifecycle-block.test.js | **NEW (native).** `on mount`/`on dismount` blocks desugar under `--parser=scrml-native` (§6.7.1; fix-wave-1 GROUP P). |
| compiler/tests/unit/native-const-at-derived-decl.test.js | **NEW (native).** `const @name` parses as a DERIVED state-decl (`parseConstAtStateDecl`) under native — F5 CLOSED. |
| compiler/tests/unit/native-reactive-write-deepset-mutation.test.js | **NEW (native).** Native emits the live `reactive-nested-assign` / `reactive-array-mutation` kinds (→ COW + trigger, routing through the Bug-B-fixed emit-logic) byte-identical to live (fix-wave-1 GROUP T). |
| compiler/tests/unit/native-destructured-param-structuring.test.js | **NEW (native).** Destructured param names resolve under native (closes false E-SCOPE-001; GROUP T). |
| compiler/tests/unit/native-vardecl-type-annotation-thread.test.js | **NEW (native).** Var-decl `typeAnnotation` threads under native so a bare variant resolves against the declared type (E-VARIANT-AMBIGUOUS → E-CONTRACT-001; GROUP T). |
| compiler/tests/unit/native-exprtext-backfill.test.js | **NEW (native).** `backfillNativeExprText` stamps `.expr`/`.init`/`.condition` from structured siblings so type-system regex-over-text passes work under native (GROUP W). INERTNESS: 295/297 byte-identical, 2 deltas a NET-POSITIVE fix. |
| compiler/tests/unit/native-blockstub-verbatim-body.test.js | **NEW (native, statement-survival canary per the Bug-73 lesson).** `parseBlockStub` stamps `stub.verbatim`; `reconstructArmBody` returns it (was literal `"{}"` → dropped statements — the Mario MUSHROOM Small→Big fix); lambda callback block bodies preserved. +17 flip closures. |

The within-node parity allowlist (`parser-conformance-within-node-allowlist.json`) was surgically reconciled
for the combined fix-wave-1 P+T state (34 over-budget files → current; PARSE-FAILURE:0, NESTED-SHAPE:0 — benign
parity-churn from the deliberate AST-shape changes); fix-wave-2 needed NO allowlist reconcile (deltas within budget).

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
| compiler/tests/browser/browser-deepset-write-loss.test.js | **NEW (4 happy-dom runtime acceptance).** Drives the DOM-event → handler → reactive-set path and asserts the deep-set MUTATIONS ACTUALLY APPLY at runtime: every deep-set in a multi-statement body takes effect, last-write-wins ordering. Uses a FLAT object cell `<a> = { ref: "" }` to isolate the parser fix (a STRUCTURAL-COMPOUND cell — `<a><ref></>` — lowers to a derived composite that failed at runtime even for a single deep-set; that was Bug B, a SEPARATE codegen mistarget **CLOSED S170 `72aa6836` — see the S170 section below**). |

NOTE (S167): the deep-set fix is a LIVE-pipeline (ast-builder.js `collectExpr`/`parseLogicBody`) fix, not a
native-parser swap-closer. Real-corpus impact: `samples/gauntlet-r11-elixir-chat.scrml` had `@messages.push(msg)`
after a `let msg = {...}` decl silently dropped — now correctly emitted. Within-node allowlist bumped +4 on that
file (EXTRA-FIELD 31→32, FIELD-SHAPE 20→21, KIND-NAME 12→13, SPAN-COORD 110→111) because the NATIVE parser still
folds `@arr.push` to a bare-expr — a SEPARATE native swap-grind parity item (correct-shadow: the live fix is now
ahead of native, the bump records the lag, it is NOT masking a regression). within-node stayed 1005/0.

## S179 New Test Files (E-ROUTE-003/004 enforcement + I-FN-PROMOTABLE inferred-server skip + E-FN-001 broadening)

2 new files (`d70f6bd8`):

| File | Loc | Tests | Covers |
|------|-----|-------|--------|
| compiler/tests/unit/route-inference.test.js | tests/unit/ | ~12 | E-ROUTE-003 now enforced (non-serializable return type fires); E-ROUTE-004 NEW (non-serializable param fires); inferred-server `function` (no `server` keyword, RI-escalated) is NOT flagged by I-FN-PROMOTABLE; E-FN-001 fires on `return ?{}` inside a `fn` body |
| compiler/tests/unit/server-keyword-eliminate-d1.test.js | tests/unit/ | ~8 | D1 codegen: the wire-chunk gate in emit-client.ts keys on inferred boundary (not `node.isServer` keyword); a keyword-free inferred-server function still gets the wire-chunk; MCP RPC discovery in mcp-descriptors.ts also keys on inferred boundary |

NOTE (S179): these are type-pass / route-inference unit tests. Cross-stream assertion applies for W-/I-* codes
(I-FN-PROMOTABLE is Info → result.warnings). No happy-dom needed — E-ROUTE-003/004 is a type-pass check with
no runtime behaviour change.

## S182 New Test Files (engine `effect=` diagnostics — E-ENGINE-EFFECT-NOT-INTERPOLATED + dedup engine-var double-fire)

1 new file (`aba5392f`):

| File | Loc | Tests | Covers |
|------|-----|-------|--------|
| compiler/tests/unit/engine-effect-not-interpolated.test.js | tests/unit/ | 7 (4 describe blocks) | `E-ENGINE-EFFECT-NOT-INTERPOLATED` (Error, §51.0.B / §51.0.H + §34) at BOTH loci: Fix 1 opener / Form 3 (bare `effect=load()`; empty `${ }` braces → error), Fix 1 state-child / Form 1 (bare `effect=foo()` → error, message names the tag), Fix 1 canonical-`${...}` regression (opener boot-call + state-child hook STILL emit, no false-fire), Fix 2 duplicate-engine-var mutual exclusivity (canonical `<engine>` → `E-ENGINE-VAR-DUPLICATE` only, NOT `E-ENGINE-003`; legacy `<machine>` → `E-ENGINE-003` only). |

NOTE (S182): diagnostic/parser-only — the error is severity:error → asserts on `result.errors`. The canonical-`${...}` regression cases verify the boot-call / hook-firing JS is still emitted (no over-fire). Zero codegen change.

## S181 New Test Files (W-DISPLAY-TEXT-OVERQUOTE inverse-footgun lint + deprecated-`server function` diagnostic reword)

2 new files (`0058c462` overquote-lint / `339f37c2` server-keyword diagnostic reword):

| File | Loc | Tests | Covers |
|------|-----|-------|--------|
| compiler/tests/unit/display-text-overquote.test.js | tests/unit/ | ~10 | `W-DISPLAY-TEXT-OVERQUOTE` (§4.18.7) — 5 POSITIVE loci (a `"..."` sole-content nested plain-markup `<p>`/`<span>` inside an engine state-child body, a markup-form `<match>` arm body, a `:`-shorthand body, etc.) + 5 NEGATIVE controls (a correct §4.18.3 code-default `"..."`; bare free-text; a multi-literal `"a" and "b"` body; a `"..."` in a component/structural element; a `"..."` outside any code-default body) + byte-identity (the lint changes ZERO emitted bytes). |
| compiler/tests/unit/server-keyword-error-msg-canon.test.js | tests/unit/ | ~? | Canon-pins the reworded deprecated-`server function` teaching strings: the E-FN-004 client-boundary correction + the E-CG-006 + the W-LINT-019 Solid-kickstarter `correction` now say `server-side function` / `inferred per §12.2`, never the eliminated `server function` modifier (S180). Guards against the diagnostics teaching a deprecated form. |

NOTE (S181): both are type-pass / diagnostic-string unit tests (no happy-dom — the lint is emit-byte-identical and the reword touches only strings). Cross-stream assertion applies for `W-DISPLAY-TEXT-OVERQUOTE` (Info → result.warnings — a `result.errors.filter` on a W- code silently passes; see the diagnostic-stream-partition note).

## S180 New Test Files (T7/T8 escalation + W-DEPRECATED-SERVER-MODIFIER + Migration 4 + trucking-dispatch smoke)

5 new files (`bf4e51c4` D2 / `e1d4f88c` D3 / `7f641010` D4a):

| File | Loc | Tests | Covers |
|------|-----|-------|--------|
| compiler/tests/unit/channel-broadcast-escalation-trigger7.test.js | tests/unit/ | ~8 | Trigger 7 (D2): a plain `function` inside a `<channel>` that writes a channel cell OR calls `broadcast()`/`disconnect()` is escalated to server boundary by RI; a channel function that does neither stays client; a function outside channel scope is unaffected |
| compiler/tests/unit/handle-middleware-ri.test.js | tests/unit/ | ~5 | Trigger 8 (D2): a function named `handle` is escalated to middleware boundary by RI regardless of body content; the W-DEPRECATED-SERVER-MODIFIER lint is suppressed for `handle`-named functions (the name IS the authority) |
| compiler/tests/unit/middleware-handle.test.js | tests/unit/ | ~4 | `handle(request, resolve)` middleware boundary classification — shape validation, `isSSE=false` for middleware, boundary===`"middleware"` |
| compiler/tests/commands/migrate-server-keyword.test.js | tests/commands/ | ~14 | Migration 4 end-to-end: W-DEPRECATED-SERVER-MODIFIER fire-site detection + `server ` prefix strip at each diagnostic span; fail-closed (compile-error → no edit); `function*` generator excluded; `server fn` never stripped; idempotent (second run = no-op); D3.1 lift-suppression (non-triggered `server function` does NOT fire W-DEPRECATED, so Migration 4 makes no edit) |
| compiler/tests/integration/trucking-dispatch-smoke-integration.test.js | tests/integration/ | ~26 | Full compile + codegen smoke on the migrated 23-trucking-dispatch app (channels + main files post-`server function` elimination); asserts the compile exits 0 and the trucking-dispatch routes are correctly classified server vs client after T7/T8 and Migration 4 |

NOTE (S180): S180 adds ZERO new §34 codes. The W-DEPRECATED-SERVER-MODIFIER fires as Info → result.warnings
(cross-stream helper required for test assertions). The within-node parity allowlist (`parser-conformance-within-node-allowlist.json`) was reconciled for the channel-file shape changes introduced by D4a example migration.

## S177 New Test Files (g-formfor + bug-tail batch + client stdlib-inliner)

8 new files (`b1931f02` bug-tail · `75f724af` g-formfor · `c48c4f71` client stdlib-inliner):

| File | Loc | Tests | Covers |
|------|-----|-------|--------|
| formfor-component-expand-in-arms-s177.browser.test.js | tests/browser/ | 13 | happy-dom — a `<formFor>`/`<Component>` inside an `<engine>` state-child + a `<match>` arm renders (was silent non-render / raw tag) |
| formfor-nested-in-engine-statechild-r27-c6.test.js | tests/unit/ | 4 | emit-shape — formFor `walkAndSplice` recurses into engine `bodyChildren` (r27-c6) |
| bare-slash-before-close-tag-bug4.test.js | tests/unit/ | 7 | E-SYNTAX-050 no longer over-fires on a bare `/` immediately before a close tag (`<li>… /</>`); still fires at EOF |
| closer-on-shorthand-body-e-closer-001-bug74.test.js | tests/unit/ | 5 | E-CLOSER-001 fires on a `/>`+`:`-shorthand body; the directive-`:` form does NOT (`isGenuineShorthandBodyNotDirective`) |
| opener-arrow-truncation-bug48.test.js | tests/unit/ | 4 | opener `>`-finder paren/bracket depth — `on=@nums.filter(c => c == 1)` not truncated |
| schemafor-predicated-base-nullable-r28-7b.test.js | tests/unit/ | 5 | schemaFor on `string req length(<=200) | not` no longer mis-fires E-SCHEMAFOR-NO-SQL-MAPPING |
| inline-map-assign-handler-s169.test.js | tests/unit/ | 4 | an inline map-method assign in a handler lowers through emitAssign (`_scrml_map_insert`), not the string path |
| clientinline-sibling-shim-import.test.js | tests/integration/ | 26 | `_inlineSiblingShimImports` — relative `./x.js` sibling shims inlined transitively, external `bun`/`node:*` stripped |

Plus extensions to existing files (bug-2-markup-text-quote-not-tracked, gauntlet-s19/tokenizer-slash,
p3-follow-no-isComponent-routing) for the bug-tail batch.

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

## S209-ss2 New Test Files (engine-codegen-statechild — 4 NEW + 3 EXTENDED)

find-count: **1020 at `b67cd6e6`** (verified; +4 NEW .test.js; +3 EXTENDED).

| File | Type | Cases | Coverage |
|------|------|-------|----------|
| compiler/tests/unit/engine-statechild-grammar.test.js | unit | 2 describe (7 assertions) | **NEW** `ff196ce8`. Membership regression guard for the NEW `engine-statechild-grammar.ts` SSOT. Pins exact members of `ENGINE_STATE_CHILD_RESERVED_ATTRS` (`rule`, `history`, `internal:rule`, `effect`) and `STATE_CHILD_STRUCTURAL_TAGS` (`onTimeout`, `onTransition`, `onIdle`, `engine`, `machine`). Any future membership edit MUST update this guard deliberately. |
| compiler/tests/unit/engine-server-flag-deferred.test.js | unit | 2 describe / 8 tests | **NEW** `8cd2282e`. §1 Parser (4 tests): bare `server` → `engineDecl.serverFlagBare === true, serverSource null`; `server=@source` E-leg → `serverFlagBare false, serverSource set`; plain engine → both false/null; attr-aware string/`${}` guard does NOT trip the flag. §2 SYM (4 tests): bare flag fires `W-ENGINE-SERVER-DEFERRED`; `server=@source` does NOT fire; plain engine does NOT fire; the diagnostic has severity:"warning". |
| compiler/tests/unit/engine-shorthand-body-render.test.js | unit | 3 describe / 7 tests | **NEW** `a48b8a7b` + `4eeaf34`. §1 pure-literal `:`-shorthand arm renders (compiles clean, text appears in render fn, not dropped); §2 `${...}` interp `:`-shorthand arm wires (literal `${@count}` absent from output, `_scrml_reactive_get("count")` present, `_scrml_logic_span` present, ` items` literal segment appears); §3 byte-equivalence shorthand vs bare-body (`<Variant : "text">` render-fn return value identical to `<Variant>text</>`). |
| compiler/tests/unit/value-native-map-ordered-build-s169.test.js | unit | 2 describe / 10 tests | **NEW** `s169 @ordered build` (ss3 item — landed in S209 window). §1 `emitMapLit` ordered flag emission (DEFAULT unordered, explicit `emitMapLitOrdered:true` lowers ORDERED, NESTED map-VALUE literal stays unordered). §2 `emitAssign` reassignment to an `@ordered` cell lowers the RHS ORDERED (`@m = [...]` + `@m = [:]`). |

EXTENDED files (not new):
- **compiler/tests/unit/engine-opener-effect-c1.test.js** (+79L new §2 describe) — 5 new tests: illegal boot-effect target fires `E-ENGINE-INVALID-TRANSITION` (absent rule / wrong single-target / wrong multi-target); legal single-rule passes; self-write no-fire.
- **compiler/tests/unit/engine-component-scope-b17.test.js** (6 deferred cases activated) — B17 items 4-8 (effect= on multi-target rule, `<onTransition to=.Variant>` valid/invalid, `<onTransition>` no-target, `<onTransition>` in `<match>` arm, `effect=` in `<match>` arm) — machinery now landed; previously skipped pending boot-write-validation.
- **compiler/tests/integration/emit-block-analysis-integration.test.js** (+41L D6 describe block) — channel-import source does NOT produce phantom function-decl blocks for the channel's own fns; the importing file's own fns are counted correctly. The D6 ownerFile guard.


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

## S210 New Test Files (engine name= dual-table fix + codegen interp-literal serializer)

4 NEW `.test.js` across two S210 codegen fix dispatches (find-count 1020→1024 at `5c68e87e`). **S210 A2/ss2/ss3/ss8 added 3 more NEW .test.js (find-count 1024→1027 at `0a605d3e`) — see table below.**

| File | Dir | Cases | Coverage |
|------|-----|-------|----------|
| compiler/tests/integration/engine-name-dual-table.test.js | tests/integration/ | ≥6 | `29b34c6c` (g-engine-name-attr-swallows-var-duplicate RESOLVED). `<engine name=ModeMachine for=Mode>` + machine-typed cell `@mode: ModeMachine` compiled clean but threw E-ENGINE-001-RT on every legal transition. Root: SYM auto-derived a phantom var from the `name=` attribute instead of unifying with the user-declared `@mode` cell; the §51.3 write-guard then pointed at an empty `__scrml_transitions_ModeMachine` table. Fix: symbol-table.ts `registerEngineDecl` binds the engine variable to the machine-typed cell (§51.3.3 unify); emit-reactive-wiring.ts skips the dead empty §51.3 table for modern engines (empty `machine.rules`). Full suite 24659/0. |
| compiler/tests/unit/engine-statechild-comment-opacity.test.js | tests/unit/ | ≥4 | `14fb0230` (g-blocksplitter-comment-span-not-opaque RESOLVED, ss4 item 2). A `<!-- ... -->` HTML comment inside an `<engine>` body caused a spurious E-ENGINE-STATE-CHILD-MISSING when a quote/backtick/`</Variant>` appeared inside the comment interior. Root: `engine-statechild-parser.ts` walker fell through the comment-`<` to the opener/closer scanner, which then opened a phantom string from the comment-interior quote, swallowing subsequent state-children. Fix: `skipCommentOrString` now recognizes the `<!--...-->` form and returns the span end; the outer walker also checks `skipCommentOrString` at the opener `<` position so an AT-`lt` comment is skipped whole. |
| compiler/tests/unit/g-attr-interp-fn-name-not-renamed.test.js | tests/unit/ | ≥11 | `14fb0230` (g-attr-interp-fn-name-not-renamed RESOLVED). A user function called inside a template-literal attribute interpolation (`class="${fn()}"`) was NOT renamed by the fn-name mangle pass in `emit-client.ts` (the whole-buffer mangler). Root: `code-segments.ts` treated the backtick string as FULLY OPAQUE so the `${...}` interior — actual code — was never passed to the transform. Fix: `rewriteCodeSegments` now recognizes template literals as a HYBRID: static text spans opaque, `${...}` interpolations descended recursively via brace-depth tracking and re-entered as code. Cross-stream assertion applies for the mangle result. |
| compiler/tests/unit/g-literal-arg-expr-serializer-wrong-span.test.js | tests/unit/ | ≥11 | `14fb0230` (g-literal-arg-expr-serializer-wrong-span RESOLVED). Two roots: Root A — a REGEX literal in call-argument position (`s.split(/[^a-z0-9]+/)`) re-serialized the ENTIRE enclosing expression into the arg slot (the `EscapeHatch` node took the outer `rawSource` instead of `node.raw`). Root B — a STRING token inside `collectBracedBody` (e.g. `on mount { f("a-b-c") }`) was pushed as bare content text, dropping the quotes → `safeParseExprToNode` parsed `f(a-b-c)` as subtraction. Fix Root A: `expression-parser.ts` regex-literal branch uses `node.raw` (the literal's own source text). Fix Root B: `ast-builder.js collectBracedBody` re-wraps STRING tokens in their delimiter quotes before reassembling the body. |

NOTE (S210): ZERO new §34 error codes across all 4 test files. The tokenizer shift-compound-assign prefix fix (ss4 item 7, `tokenizer.ts` — `<<=`/`>>=`/`>>>=` now lex as ONE OPERATOR token before the bare shift ops) is covered by `g-literal-arg-expr-serializer-wrong-span.test.js` (the compound-assign parser rewrite path) and the existing emit-logic / parse-mutation-shapes unit tests. Full suite at S210 close: 24659/0.


## S210 A2 / ss2 / ss3 / ss8 New and Extended Test Files

3 NEW `.test.js` + 6 EXTENDED across A2 api-decl, ss2 derived-engine-crash, ss3 paren/sigil, ss8 tailwind
(find-count 1024→1027 at `0a605d3e`).

| File | Dir | New/Ext | Coverage |
|------|-----|---------|----------|
| compiler/tests/unit/api-decl-parser.test.js | tests/unit/ | NEW 289L | `8d4e96ae` (A2 W2 — `<api>` declaration parser). Conformance suite for the new `api-decl` AST node. Covers: `<api base="/api">` opener recognition; `METHOD /path -> ResponseType` endpoint body; E-API-BASE-MISSING (no `base=`); E-API-RESPONSE-TYPE-UNDECLARED (missing `-> ResponseType`); E-API-METHOD-INVALID (unrecognized method); E-API-ENDPOINT-MALFORMED (body line mismatch). All 4 E-API-* codes exercised. |
| compiler/tests/integration/g-paren-receiver-group-dropped.test.js | tests/integration/ | NEW 168L | `aae34c26` (ss3 paren-grouping preservation). 5 describe blocks covering: method receiver `(a+b).toString()`, index receiver `(a+b)[0]`, call receiver `(a+b)()`, chained `(a+b).x.y`, nested `((a+b)).z`. Pre-fix: all desugared to bare `a+b.receiver` — silent precedence inversion. Post-fix: `(a+b).receiver` preserved verbatim. |
| compiler/tests/unit/each-sigil-expr-parser.test.js | tests/unit/ | NEW | `544e5c42` (ss3 `@.` sigil structuring, §17.7.3). `@.field` contextual iteration sigil structured as `IdentExpr` leaf so it participates in full ExprNode walks including attr-condition ATTR_EXPR position. |
| compiler/tests/unit/derived-engine-rejections.test.js | tests/unit/ | EXTENDED +59L | `3a29be32` (ss2 derived-engine-autoderive-crash). Added B16 crash-class cases: `<engine for=@cellVar>` (cell-typed `for=` attribute) previously crashed with `ReferenceError: autoDeriveEngineVarName is not defined` at SYM `registerEngineDecl`; now resolves correctly and fires E-DERIVED-ENGINE-NO-INITIAL as expected. |
| compiler/tests/unit/bug-1-tailwind-arbitrary-value-emit.test.js | tests/unit/ | EXTENDED +167L | `81a46d36` (ss8 tw-arbitrary). NEW string-shaped arbitrary value cases: `bg-[url('...')]`, `content-['text']`, `text-[length:'50%']` — bracket content starting with `'` / `"` now recognized via `isStringArbitraryValue` guard and emitted as CSS passthrough. |
| compiler/tests/unit/bug-1-tailwind-ring-family.test.js | tests/unit/ | EXTENDED +66L | `81a46d36` (ss8 ring-offset-[len]). NEW `ring-offset-[len]` arbitrary-value cases: `ring-offset-[3px]`, `ring-offset-[0.5rem]` — emits `--tw-ring-offset-width: <val>; --tw-ring-offset-shadow: ...` compose pattern. |
| compiler/tests/unit/bug-1-tailwind-minor-families.test.js | tests/unit/ | EXTENDED +24L | `81a46d36` (ss8) additional minor-families cases. |
| compiler/tests/unit/bug-1-tailwind-unrecognized-class.test.js | tests/unit/ | EXTENDED +19L | `81a46d36` (ss8) unrecognized-class lint coverage updated (string-shaped arbitrary no longer fires W-TAILWIND-UNRECOGNIZED-CLASS). |
| compiler/tests/unit/bug-1-tailwind-transform-shorthand.test.js | tests/unit/ | EXTENDED +15L | `81a46d36` (ss8) transform-shorthand additional cases. |

NOTE (S210 A2/ss3/ss8): ZERO new §34 codes in ss3/ss8 test files.
A2 exercises all 4 E-API-* codes (all Error, §60.9). ss2 extended file exercises existing E-DERIVED-ENGINE-* codes.
Full suite at `0a605d3e`: not re-counted from the 24659/0 baseline (no suite rerun in this maintenance window).



## S219 New Test Files (6nz B2 + W-INPUT-STATE-MARKUP-NONREACTIVE)

2 NEW `.test.js` + 2 EXTENDED across S219 landings (find-count 1039→1055 at `26ffea4e` — counting also +14 from S217/S218 that were previously untracked in test.map).

NOTE: S217 (commits `062165a5` through `489951aa`) and S218 (commits `e64c4095` through `162564f3`) added 14 test files total that were NOT reflected in the prior test.map watermark (`1ff06eae`). Those additions are captured in structure.map.md "Key S217/S218 Source Changes" sections. Current verified find-count: `find compiler/tests -name '*.test.js' | wc -l` = **1055 at `26ffea4e`**.

| File | Dir | New/Ext | Coverage |
|------|-----|---------|----------|
| compiler/tests/unit/engine-arrow-body-legacy-reject-b2.test.js | tests/unit/ | NEW 150L | `d71a6dcc` (6nz B2 — §51.0.C state-engine whole-body arrow reject). Covers: `<engine for=T>` whole-body `.From => .To` fires E-ENGINE-RULE-LEGACY-SYNTAX (Error); `<engine name=X for=T>` named form EXEMPT (whole-body arrow legitimately admitted by §51.3.2); `<machine for=T>` legacy-keyword form EXEMPT (deprecated surface, W-DEPRECATED-001 fires instead). |
| compiler/tests/unit/lint-w-input-state-markup-nonreactive.test.js | tests/unit/ | NEW 266L | `45182694` (6nz AF — W-INPUT-STATE-MARKUP-NONREACTIVE, SPEC §36.6). Covers: `<keyboard #cursor>` / `<mouse #mouse>` / `<gamepad #pad>` `<#id>.field` inside markup interp fires W-INPUT-STATE-MARKUP-NONREACTIVE (Info → result.warnings); `<#id>` ref NOT matching a declared input-state element does NOT fire; `<#id>.field` INSIDE an `animationFrame` callback EXEMPT (the `@cell` bridge); `<request>` ref does NOT fire (reactive bridge, not input-state). |
| compiler/tests/unit/engine-statechild-b15.test.js | tests/unit/ | EXTENDED 700L | `d71a6dcc` (6nz B2 — B15 extension cases). Extended with whole-body arrow-body reject cases. |
| compiler/tests/unit/lint-w-interp-in-raw-content.test.js | tests/unit/ | EXTENDED | `d71a6dcc` (6nz B1 — severity promotion). Severity assertions updated from `info` to `warning` following the B1 promotion of W-INTERP-IN-RAW-CONTENT. |

ZERO new §34 codes from S219 test coverage. W-INPUT-STATE-MARKUP-NONREACTIVE is a NEW code (Info, §36.6). E-ENGINE-RULE-LEGACY-SYNTAX whole-body fire site is NEW but the code was pre-existing in the catalog.


## Tags
#s226 #s225 #s224 #ss43 #ss50 #ss52 #multi-scrutinee-match #section-18-19 #apply-utility-composition #section-26-8 #e-apply-variant-unsupported #e-apply-non-inlinable-utility #e-apply-unknown-utility #nested-fn-sql-escalation #g-sql-nested-fn-escalation #e-sql-009-new-site #detect-sql-in-arrow #unary-exponent-paren #emitunary-exponent #nonreactive-local-map-set #local-map-set-names #collect-local-map-set-names #build-fn-return-map-kinds #ss42 #named-machine-undeclared-read #ss49 #g-arrow-expr-body-sql-truncate #g-endpoint-at-led-arm-trailing #g-unary-of-exponent-arg-paren #e-match-scrutinee-arity #e-syntax-012-multi-scrutinee #1100-tests #find-count-1100 #s220 #s219 #endpoint-decl #e-endpoint-path-missing #e-endpoint-method-invalid #e-endpoint-accepts-missing #e-endpoint-not-exhaustive #e-endpoint-accepts-not-enum #endpoint-conformance-integration #g-paren-ternary-operand-dropped #g-if-guard-inner-effect-not-gated #g-compound-bind-value-source-cell #g-each-mount-form-submit-preventdefault #g-emit-lift-markup-text-interp #g-nested-each-outer-key-reuse-inner-frozen #g-expr-event-handler-dead-in-each #g-each-peritem-markup-value-ternary #db-src-runtime-path #sql-in-arrow-body-diagnostic #g-each-match-body-class-literal-extracted #ss17 #ss18 #ss19 #ss20 #endpoint-primitive-2026-06-25 #endpoint-server-helper-ids #endpoint-client-skip-ids #25223-pass
#scrmlts #map #test #bun-test #unit #browser #integration #conformance #s222 #s221 #value-native-set #section-59-12 #set-bracket-k #expr-node-round-trip #deep-equal-expr-map-lit #value-native-set-type-system #value-native-set-codegen-collector #value-native-set-e2e #ss31 #expr-validity #g-double-unary-minus-emit-decrement #g-enum-toenum-client-structured-decl #g-unary-left-of-exponent-paren #e-codegen-invalid-js #e-map-bracket-write #s213 #request-id-render-bridge #e-match-block-in-lift #api-decl-codegen #uvb-w1-post-ce-invariant #deep-reactive-request #render-bridge #a2-w5 #pongai-c1 #pongai-c2
#scrmlts #map #test #bun #conformance #parser-parity #happy-dom #each-in-dynamic-context #per-item-reactivity #live-keyed #bug64 #bug65 #bug72 #bug73 #colon-shorthand-html #colon-shorthand-canonical #shape4-no-rhs #s153 #s154 #s155 #s156 #s157 #s158 #s159 #s160 #native-parser #native-parser-swap #each-promotion #match-promotion #f3-match-arm #f2-match #promote-each #typed-atcell #server-fn-star #exprnode-walker #within-node-1005 #flip-605 #flip-508 #bare-function-failable #cross-file-export-bodystart #deepset-write-loss #reactive-nested-assign #reactive-array-mutation #s161 #s162 #s163 #s164 #s165 #s166 #s167 #s168 #s169 #value-native-maps #map-type #each-tuple-destructure #union-not-normalization #s170 #set-algebra #scrml-data #bug-b-structural-compound-deepset #structural-compound-deepset #data-set-algebra #native-on-lifecycle-block #const-at-derived-decl #blockstub-verbatim-body #mario-match-arm-fix #s173 #s174 #s175 #typed-sql-row #sql-projection #width-subtyping #e-sql-row-contract-mismatch #w-sql-row-untyped #e-struct-function-field #function-boundary #fn-return-inference #flagship-typed-data #s176 #e-type-unknown-name #unrecognized-type-name #w-pure-deprecated #pure-deprecation #migration-3 #scrml-math #scrml-random #scrml-time-now #capability-scoped #non-deterministic #e-fn-004 #transitive-shim-copy #s177 #g-formfor #bug-4 #bug-48 #bug-74 #r27-c6 #r28-7b #s169-map-inline-insert #client-stdlib-inliner #s179 #e-route-003 #e-route-004 #wire-serializability #i-fn-promotable #e-fn-001 #inferred-server #s180 #w-deprecated-server-modifier #migration-4 #server-keyword-eliminate #channel-broadcast #trigger-7 #trigger-8 #handle-middleware #trucking-dispatch-smoke #s181 #w-display-text-overquote #display-text-overquote #inverse-footgun #e-unquoted-display-text #server-keyword-reword #server-keyword-canon #s182 #e-engine-effect-not-interpolated #engine-effect #effect-interpolated #engine-var-dedup #e-engine-003 #s183 #e-formfor-not-imported #e-tablefor-not-imported #formfor-unimported #tablefor-unimported #w-tailwind-001 #w-tailwind-unrecognized-class #dynamic-class-prefix #fn-pure-canonicity #s184 #lifecycle-field-comment-leak #e-type-001-double-fire #snippet-fill-exemption #w-lint-007 #shape-1-variant-lifecycle-initializer #e-variant-ambiguous-fp #payload-binding-gaps #match-block-arm-payload-scope #error-arm-multi-field #table-for-synth-skip #w-each-promotable #s185 #errarm-refail #re-fail-from-arm #fail-from-arm #emit-fail-expr #errarm-refail-lowering #e-validator-inline-colon #validator-inline-colon #validator-inline-msg-paren #colon-form-reject #s19-5-2 #s190 #cluster-c #e-decl-rhs-interp-wrapped #markup-root-closed #markup-const-sibling-swallow #g-derived-rhs-interp-wrapped #g-markup-const-consumes-cell-decl #derived-engine-expression-form #derived-expr-kind #inline-match-derived #expr-derived #b16-no-rules #b16-no-initial #b16-no-write #b16-circular #derived-upstream-enum #e-engine-004-steer #c14-derived-substrate #section-51-0-j #s191 #tailwind-composing-families #approach-c #inline-var-fallback #no-preflight-block #w-tailwind-unrecognized-class #register-ring #register-gradient #register-transform #register-filters #register-backdrop #box-shadow-compose #transform-compose #filter-compose #backdrop-compose #ring-shadow-setter #section-26-7 #section-26-7-1 #section-26-7-2 #section-26-7-3 #if-fn-condition #call-ref-conditional #g-attr-if-fn-call-misroute #g-attr-if-fn-display-not-mount #g-attr-if-fn-chain-head-call-misroute #update-chain-call-ref #reactive-conditional-not-event #section-5-1 #zero-new-codes #s195 #gap-a #match-arm-void-element-scanner #void-element-self-terminating #parse-match-arms #find-arm-closer #find-structural-body-end #match-arm-void #each-arm-void #flush-closer-fix #e-ctx-001-unclosed-match #e-match-parse-001 #cross-stream-find-diagnostic #section-24-void #section-18-0-1 #s196 #render-expression #render-of #render-expr-primitive #e-render-no-of #e-render-no-clause #e-render-not-enum #e-match-arm-markup-in-value #h1-steer-markup-in-value-match #held-error-display #g-held-error-display-closed #g-failable-arm-nested-constructor-crash #g-shorthand-interp-match-arm-codegen #g-match-arm-apostrophe-bs #section-19-15 #errors-as-states #limit-the-primitive #s198 #s199 #engine-hydration #initial-cell #server-source #scrml-engine-hydrate-init #e-engine-initial-both-forms #e-engine-server-with-derived #w-engine-server-source-not-authoritative #s200 #g-each-component-helper-hoist #g-each-component-transitive-helper #g-each-peritem-if-predicate #helper-export-hoist #transitive-helper-import #lower-each-expr #s201 #markup-value-render #g-markup-value-in-expression #g-nested-component-member-arg #markup-as-value #markup-value-expr #emit-markup-value-expr #scrml-render-value #s202 #each-inline-class-a #g-each-over-arm-payload-binding-unbound #arm-payload-binding #stamp-arm-payload-eaches #g-each-inline-component-prop-member-unsubstituted #g-inlined-component-root-class-interp-raw #substitute-interp-segments #layer-2-string-literal-attr #e2e-render-map #known-failure-map #render-detectors #d0-d7 #oracle-free #render-harness #tier-tag-corpus #delta-gate #detector-validation #regression-sentinel #r26-industrialized #trucking-board-flagship #board-each-conversion #board-high-0 #s209 #ss2 #engine-codegen-statechild #engine-statechild-grammar #engine-state-child-reserved-attrs #state-child-structural-tags #w-engine-server-deferred #server-flag-bare #engine-server-deferred-lint #engine-shorthand-body-render #section-51-0-i #iscolon-shorthand #shorthand-body-render #display-text-literal-inner #native-parse-file #block-analysis-d6 #phantom-block #ownerfile-guard #import-inlined-channel-fns #b17-activated #engine-opener-effect-c1 #boot-write-validation #e-engine-invalid-transition #fire-site-11 #ordered-map-build #emit-map-lit-ordered #ordered-map-var-names #collect-ordered-map-var-names #s169-ordered #a2-api-decl #api-decl-parser #e-api-base-missing #e-api-method-invalid #e-api-response-type-undeclared #e-api-endpoint-malformed #ss2-derived-engine-crash #derived-engine-autoderive-crash #derived-engine-rejections #ss3-paren-group #paren-grouping-preservation #g-paren-binary-group-dropped #each-sigil-structuring #at-dot-sigil #ss8-tailwind #ring-offset-arbitrary #tw-arbitrary-string #is-string-arbitrary-value #section-60-9 #s212 #g-tailwind-not-scanned-in-match-arms #each-block-body-children #match-block-arm-body-children #g-nested-each-no-own-subscription #nested-each-reactive-subscription #approach-c-inner-each #g-lift-concurrent-transitive-exclusion-tdz #transitive-dep-closure #reassigned-let-gate #collect-reassigned-names #lift-concurrent-scheduler #collect-lambda-body-reads #lambda-body-free-reads #zero-new-codes #flogence-dogfood

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
