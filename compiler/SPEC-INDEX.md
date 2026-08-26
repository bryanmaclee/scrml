# SPEC.md Section Index

> Auto-generated line numbers. Regenerate: `bun run scripts/regen-spec-index.ts` (in-tree TS regen; updates the Sections-table line ranges + sizes AND the totals block below, in-place from SPEC.md headings, preserving summaries). The legacy `bash scripts/update-spec-index.sh` is a print-only helper that lists current heading line numbers.
>
> **Last updated: 2026-07-20 (S273)** — NEW **§14.8.10 Server→client confidentiality — tenant-row isolation floor** (Nominal/spec-ahead): the row-level twin of §14.8.9 (columns→rows), owning only the isolation INVARIANT ("a row of tenant A never reaches a request whose ambient tenant is B") and never policy. Normative summary: the §14.8 row in the Sections table; topic entries under Quick Lookup.
>
> **Full amendment history → [`scrml-support/archive/spec-index-changelog.md`](../../scrml-support/archive/spec-index-changelog.md)** (S58 → S273, newest-first). That narrative was carried INLINE in this preamble until **S290 (2026-07-27)**, where it measured **72,053 of this file's 158,373 characters — 45%** of a file that is a mandatory full-read at every Profile-A PA boot, none of it current truth. Dereffed per the scope principle (current-truth-only in `scrml`; stale → `scrml-support`). Line-number references inside it are as-of-their-own-landing and are NOT current.

<!-- @generated:spec-index-totals START (do not edit — `bun run scripts/regen-spec-index.ts`) -->
Total lines: 37,540 | Total sections: 65 + appendices
<!-- @generated:spec-index-totals END -->

> **Note on §49 heading format:** SPEC.md §49 uses a single `#` (H1) at line 19410 (`# §49. ...`) instead of the `## N.` pattern every other section uses. The in-tree `bun run scripts/regen-spec-index.ts` regenerator handles this case explicitly via a `^# §<N>\.` regex branch; the legacy `bash scripts/update-spec-index.sh` print-only helper does NOT pick it up.

## Sections

| § | Section | Lines | Size | Summary |
|---|---------|-------|------|---------|
| — | Table of Contents | 20-111 | 92 | Section listing |
| 1 | Overview | 112-205 | 94 | Design principles, Bun runtime, markup-as-value (§1.4), north-star ladder (§1.5), V5-strict access (§1.6) |
| 2 | File Format and Compilation Model | 206-256 | 51 | Source files, output, entry point, perf target |
| 3 | Context Model | 257-323 | 67 | Contexts, stack rules, coercion, V5-strict access form per locus (§3.4). §3.4 note — engine state-child / match-arm / `:`-shorthand bodies are code-default-body loci (cross-ref §4.18). |
| 4 | Block Grammar | 324-1349 | 1026 | Tags, states, closer forms, PA rules, keywords, angleDepth (PA-005). §4.14 `:`-shorthand body form · §4.15 scrml-defined structural-elements registry (`<engine>`/`<match>`/`<errors>`/`<onTransition>`) · §4.16 M7 multi-close `<///>` anchor · §4.17 raw-content elements `<pre>`/`<code>` (single text run; `${...}` / `<TagName>` / brace sigils NOT recognized inside) · §4.18 code-default body mode + display-text literal, the single canonical definition — engine state-child / match block-form arm / `:`-shorthand bodies are code-default (a bare run is code; display text is an explicit `"..."` literal), plain-markup bodies stay free-text: §4.18.1 the two body modes · §4.18.3 the `"..."` display-text literal (`"`-only per §5 precedent) · §4.18.4 `${...}` interpolation inside it · §4.18.5 verbatim whitespace · §4.18.6 codegen auto-HTML-escape · §4.18.7 `E-UNQUOTED-DISPLAY-TEXT` · §4.18.8 `text`/`TextNode` kind survives. §4.18.1 does NOT classify `<program>`/`<page>` bodies — that is `default-logic`, a distinct THIRD body-mode owned by §40.8; §4.18.1 + the §3.4 note + the §4.15 registry note carry the reciprocal cross-ref. |
| 5 | Attribute Quoting Semantics | 1350-2035 | 686 | Three forms, bind:, dynamic class, event handler binding (§5.2.2). §5.2.3 bare-form event handler rule — single-expression discipline + E-MULTI-STATEMENT-HANDLER · §5.4.1 bind-dispatch table by render-spec shape. |
| 6 | Reactivity and the V5-Strict Access Model | 2036-5933 | 3898 | V5-strict two forms (§6.1), three RHS shapes (§6.2), compound state (§6.3), render-by-tag (§6.4), arrays (§6.5), derived+in-compound (§6.6+§6.6.16-17), lifecycle (§6.7), default+reset (§6.8), hoisting (§6.9), pinned (§6.10), validity stub (§6.11), §11 inheritance (§6.12). §6.8.1 makes `default=not` the canonical absence form; `null` AND `undefined` in attribute-value position are rejected via E-SYNTAX-042 + surfaced via W-ABSENCE-IN-SCRML-SOURCE (§34). §6.8.2 normatively allows multi-level compound-nav targets in `reset(@a.b.c.d)`. |
| 7 | Logic Contexts | 5934-6416 | 483 | `{}` syntax, function forms, markup-as-expr, type annotations, file-level scope (§7.6). §7.4.1 markup-as-expression under the markup-as-value pillar · §7.6.1 file-level scope under V5-strict + hoisting + `pinned` · §7.7 logic-markup interleaving. |
| 8 | SQL Contexts | 6417-6978 | 562 | `?{}` syntax, bound params, chaining, WHERE, INSERT/UPDATE/DELETE, **§8.9 per-handler coalescing, §8.10 N+1 loop hoist, §8.11 mount hydration** |
| 9 | CSS Contexts | 6979-7023 | 45 | Inline CSS (§9.1), style block, CSS files |
| 10 | The `lift` Keyword | 7024-7436 | 413 | Semantics, coercion, syntax forms, ordering, value-lift, accumulation (§10.8). §10.1.1 lift under the markup-as-value pillar. |
| 11 | State Objects and `protect=` (Reserved — Folded) | 7437-7458 | 22 | Content distributed: state declarations → §6; protect=, schema, authority → §52 |
| 12 | Route Inference | 7459-7633 | 175 | Default placement, escalation triggers, generated infra, server return (§12.5). §12.5.1 wire-format envelope `{"__scrml_absent": true}` for `T | not` server-fn returns; cross-ref §57. |
| 13 | Async Model | 7634-7987 | 354 | Developer-visible syntax, compiler-managed async, RemoteData enum (§13.5). §13.5 cross-ref to the engine recipe (Tier-2 idiom for state-driven loading). |
| 14 | Type System | 7988-9794 | 1807 | Structs (§14.3.2 enum fields), enums, pattern matching, asIs, schema types, snippet type. §14.10 bare-variant inference · §14.11 positional binding for predefined-shape compound state. §14.10 NOTE → §51.0.G.1 (`.advance` two-candidate-enum resolution is a NEW rule, NOT a §14.10 reuse; the §14.10 mechanism is unchanged). |
| 15 | Component System | 9795-10974 | 1180 | Definition, props, shapes, slots, callbacks, rendering syntax, reactive scope (§15.13). §15.13.5 components stay distinct from engines (E-COMPONENT-ENGINE-SCOPE) · §15.13.6 component reactive scope under V5-strict. |
| 16 | Component Slots | 10975-11244 | 270 | Named slots, unnamed children, fill syntax, render validation; §16 carries the markup-as-value pillar reaffirmation for slots. |
| 17 | Control Flow | 11245-12510 | 1266 | §17.0 Tier ladder: Tier 0 (`if=`) + cross-refs to §18 / §51 + W-LIFECYCLE-CANDIDATE; if=, show=, lifecycle, iteration, overloading, if-as-expression (§17.6). §17.5 — function-overload RETIRED, component-overload closed-without-resolution (SPEC-ISSUE-010-COMPONENT closed); the trio (`match` / `engine` / derived) is the canonical replacement. §17.1.2 `if=` on the three scrml-defined structural elements (`<engine>`/`<match>`/`<each>`, S302) · §17.1.2.1 render-gating-NOT-lifecycle-gating (the load-bearing rule; carries the `<each if=>` collection-stays-unread sentence) · §17.1.2.2 composition · §17.1.2.3 position carve-out — NOT inside an `<each>` row template. |
| 18 | Pattern Matching and Enums | 12511-14117 | 1607 | §18.0 two match shapes — block-form `<match for=Type>` (Tier 1, §18.0.1) + JS-style · §18.0.2 attribute legality (rule= inert; effect=/onTransition forbidden) · §18.0.3 bare-variant inference · JS-style content from §18.1. §18.0.1 block-form arm bodies are code-default bodies (§4.18); bare prose fires `E-UNQUOTED-DISPLAY-TEXT`. §18.8.1 enum-subset exhaustiveness (§53.15) — match reads the SUBSET variant set; dead arm = E-MATCH-SUBSET-DEAD-ARM, vacuous else = W-MATCH-001; §18.6 W-MATCH-001 over a subset-refined type. §18.19 multi-scrutinee match (**Nominal**) — `match (e1,…,eN) { (p1,…,pN) :> body }`, product-dispatch lifted from the engine `(state × message)` form (§51.0.S); parens are grammar NOT a tuple; product exhaustiveness extends E-TYPE-020/E-TYPE-006; the §18.11 nested-pattern exclusion holds; `E-MATCH-SCRUTINEE-ARITY`; JS-style only. §18.2 grammar. |
| 19 | Error Handling (Revised) | 14118-15467 | 1350 | Renderable enum variants, fail, ?, !, errorBoundary, renders clause · §19.10.5 implicit per-handler tx · §19.9.8 "No `async`/`await`" language-wide standing rule (§48.3.5 / E-FN-005 subordinates to it; §19.9.3 body-split/CPS is the canonical async surface; §34 codes E-ASYNC-NOT-IN-SCRML, E-AWAIT-NOT-IN-SCRML, E-FOR-AWAIT-NOT-IN-SCRML; generators preserved) · §19.9.9 Multi-Batch CPS reorder + static reject — §19.9.9.1 statement-grain body-DG · §19.9.9.2 topological planner · §19.9.9.3 per-batch monotonicity + `batchIndex` · §19.9.9.4 multi-stub emit + error envelope · §19.9.9.5 worked example · §19.9.9.6 soundness; §19.6.7 forward-ref; codes E-CPS-MULTIBATCH-REORDER, E-CPS-MULTIBATCH-MACHINE-CROSSING · §19.12 `test-bind` declaration form (explicit-unchanged claims E-TEST-004 / E-FN-004) — §19.12.6 surface syntax + scope · §19.12.7 dispatch contract + 0-byte production guarantee · §19.12.8 worked example; §19.13 row E-TEST-006. |
| A | Appendix A: Interaction Matrix | 15468-15486 | 19 | Error system feature interactions |
| B | Appendix B: Superseded Spec Text | 15487-15495 | 9 | What §19 replaced |
| C | Appendix C: Future Considerations | 15496-15504 | 9 | Error composition, retry, telemetry, async errors |
| D | Appendix D: JS Standard Library | 15505-15525 | 21 | JS stdlib access in logic contexts |
| E | Appendix E: `</>` Closer Migration | 15526-15598 | 73 | Migration guide for `/` → `</>` |
| 20 | Navigation API | 15599-16241 | 643 | navigate(), route params, session context |
| 21 | Module and Import System | 16242-16767 | 526 | Export/import syntax (incl. §21.2 Form 1 / Form 2), re-export, pure-type files. §21.8 cross-file engine import + §21.8.1 `pinned` on imports. §21.3.1 `import:host` declaration form — the bounded self-host bootstrap bridge, manifest-gated via §22.13; codes E-IMPORT-008 (manifest-gate violation) + E-IMPORT-009 (unknown host-tag); forward-pluggable to `import:wasm` / `import:wat` via SPEC amendment. |
| 22 | Metaprogramming | 16768-17510 | 743 | `^{}` meta context, compile-time/runtime meta, Option D scope model; the markup-as-value pillar reinforces splicing. §22.5.1 the runtime `meta` API — closed at 12 primitives, including the four timers (`meta.interval` / `meta.timeout` / `meta.clearInterval` / `meta.clearTimeout`). §22.12 "Approach C — what scrml-native fully describes" + the M6 total-retirement implication (BS + Acorn + BPP + the JS-parser-in-`^{}`-body all retired). §22.13 manifest entry `[capabilities] host-import`. |
| 23 | Foreign Code Contexts (`_{}`) | 17511-18322 | 812 | Level-marked braces, opaque passthrough, WASM sigils, sidecars, inline value-returning `_={ … }=` (§23.2.4a). §23.3/§23.4 fail-closed-Nominal (`E-WASM-NOMINAL` / `E-FOREIGN-SIDECAR-NOMINAL`; recognized-and-fail-closed banners). §23.5 Capability Declaration (Nominal/spec-ahead) — the `capabilities=` `<program>` attribute (vocab `{network,fs-read,fs-write,spawn,env,db}`; closest-ancestor-wins inheritance §23.2.1-style; `[]` default), the `W-FOREIGN-UNDECLARED-CAPABILITY` presence-nudge (opacity bound: presence NOT accuracy, §23.2.3), `E-FOREIGN-CAPABILITY-UNKNOWN`; manifest-aggregate + enforcement DEFERRED. |
| 24 | HTML Spec Awareness | 18323-18394 | 72 | Element registry, shape constraints. §24.4 scrml-defined structural elements (NOT HTML — `<engine>`/`<match>`/`<errors>`/`<onTransition>`/`<onTimeout>`). |
| 25 | CSS Variable Syntax | 18395-18497 | 103 | Defining/using vars, hyphenated names, scoping |
| 26 | Tailwind Utility Classes | 18498-18898 | 401 | Integration model. §26.3 Variant Prefixes (W-TAILWIND-001) · §26.4 Arbitrary Values (grid/flex/aspect, underscore-as-space, ratio shape) + §26.4.1 validation + §26.4.2 cross-feature · §26.5 Open Items (group-*/peer-*/custom-theme deferred) + W-TAILWIND-UNRECOGNIZED-CLASS · §26.6 Typography `prose` family — §26.6.1 base styling (`:where()` + `not-prose` selectors), §26.6.2 color variants, §26.6.3 size variants, §26.6.4 not-prose opt-out, §26.6.5 open items · §26.7 Composing Utilities, the inline-fallback `var()` model — ring/ring-offset/shadow compose into one `box-shadow` via `var(--tw-*, <fallback>)` plus per-utility `--tw-*` setters (NO global preflight block, preserving §26.1 minimalism; `currentColor` ring default is a deliberate divergence from TW v3) · §26.7.1 Gradient family — `bg-gradient-to-{8 dirs}` + `from`/`via`/`to` via `--tw-gradient-stops` · §26.7.2 Transform family — translate/scale/rotate/skew compose ONE `transform:` shorthand via `--tw-*` with identity fallbacks; 3D rotate-x/y/z and the full-shorthand `transform-[...]` / `scale-[...]` / `translate-[...]` stay literal escape hatches; bare axis-less `skew-[...]` is unrecognized. |
| 27 | Comment Syntax | 18899-18919 | 21 | Universal `//`, per-context native comments |
| 28 | Compiler Settings | 18920-18962 | 43 | html-content-model setting; 4 lint-suppression configs (`lint.lifecycle-candidate`, `lint.match-rule-inert`, `lint.engine-initial-missing`, `lint.deprecated-machine`). |
| 29 | Vanilla File Interop | 18963-18973 | 11 | Plain JS/CSS/HTML interop (Nominal — spec-ahead; not implemented; §21 is the live JS interop) |
| 30 | Compile-Time Eval — `bun.eval()` | 18974-18999 | 26 | Scope, markup interpolation, security |
| 31 | Dependency Graph | 19000-19072 | 73 | Purpose, construction, route analysis. §31.4 validator predicate-arg dependency tracking · §31.5 derived-state expression dependency tracking. |
| 32 | The `~` Keyword | 19073-19284 | 212 | Pipeline accumulator, lin variable, context boundary |
| 33 | The `pure` Keyword | 19285-19351 | 67 | **DEPRECATED — the `pure` modifier is deprecated language-wide; `fn` is the canonical pure form; W-PURE-DEPRECATED (supersedes W-PURE-REDUNDANT), reserved E-PURE-DEPRECATED.** Legacy content: purity constraints, §33.6 fn ≡ pure function. |
| 34 | Error Codes | 19352-20236 | 885 | All error code definitions — §34 is the catalog every other section's codes land in. §34.1 "Native-Parser Parse Diagnostics" — 66 native-parser parse-error codes (30 `E-EXPR-*` + 35 `E-STMT-*` + 1 `E-MARKUP-VALUE-UNCLOSED`) as three grouped sub-tables under a normative prologue, emitted by `compiler/native-parser/`; the 7 `class`/`try`/`throw` codes carry an R1 cross-ref note. Notable codes and the sections that own them: E-ENGINE-EFFECT-ON-DERIVED (§51.0.H Form 3 / §51.0.J) · W-MATCH-ARROW-LEGACY, info-level and arm-context-scoped for the deprecated `=>`/`->` separator vs the canonical `:>`, with `E-MATCH-ARROW-LEGACY` reserved at end-of-window and E-MATCH-ARM-SEPARATOR text updated `=>`/`->` → `:>` (§18.2 / §19); it mirrors W-LIFECYCLE-LEGACY-ARROW · E-STORY-UNKNOWN + W-STORY-ON-TOP-LEVEL (§58) · E-CPS-MULTIBATCH-REORDER + E-CPS-MULTIBATCH-MACHINE-CROSSING (§19.9.9) · E-UNQUOTED-DISPLAY-TEXT (§4.18.3 / §4.14 / §4.18), with scoping notes on E-SYNTAX-050 (bare-`/` still fires in plain-markup free-text bodies, NOT in code-default bodies where `/` is an operator) and E-CTX-003 · E-ENGINE-PAYLOAD-ON-UNIT-VARIANT, E-ENGINE-PAYLOAD-ARITY-MISMATCH, E-ENGINE-PAYLOAD-RESERVED-COLLISION (§51.0.B.1) · W-ABSENCE-IN-SCRML-SOURCE (renamed from W-NULL-IN-SCRML-SOURCE), the info-level regression-guard companion to E-SYNTAX-042 covering BOTH `null` and `undefined` (§42.1 / §6.8.1 / §42.9) · E-ONTRANSITION-NO-TARGET · E-TEST-006 (§19.12.7) · E-RESET-INVALID-TARGET · E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE · I-MATCH-PROMOTABLE (§56) · E-PARSEVARIANT-* (§41.13) · E-CLOSER-001, E-NAME-COLLIDES-RESERVED, E-STRUCTURAL-ELEMENT-MISPLACED, E-MULTI-STATEMENT-HANDLER, E-IMPORT-PINNED-INVALID, E-DERIVED-CIRCULAR-DEP, E-USE-INVALID-CTX · E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER · the engine message-dispatch four — E-ENGINE-ACCEPTS-NOT-ENUM, E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE, E-ENGINE-MSG-UNKNOWN, E-ENGINE-MSG-WITHOUT-ACCEPTS (§51.0.S) · E-MATCH-SUBSET-DEAD-ARM (§53.15). Reused across these: E-VARIANT-AMBIGUOUS, E-ENGINE-INVALID-TRANSITION, E-CONTRACT-001/-RT, W-MATCH-001. |
| 35 | Linear Types — `lin` | 20237-20698 | 462 | Declaration (exactly-once + restricted intermediate visibility), consumption, control flow, closures, lin function params (§35.2.1), cross-`${}` block lin (§35.2.2), E-LIN-005 shadowing + E-LIN-006 deferred-ctx (§35.5) |
| 36 | Input State Types | 20699-21072 | 374 | `<keyboard>`, `<mouse>`, `<gamepad>` |
| 37 | Server-Sent Events | 21073-21314 | 242 | `server function*` SSE generators |
| 38 | WebSocket Channels | 21315-22208 | 894 | `<channel>` sits INSIDE `<program>` (sibling of `<page>`); the `@shared` modifier is REMOVED — auto-sync follows from being declared in the channel body; V5-strict body (`<x> = init` declares, `@x` reads/writes). §38.1 inside-`<program>` placement · §38.4 V5-strict reactive sync · §38.4.1 v1→v0.next migration · §38.12 cross-file inline expansion; broadcast / disconnect / onserver:* / onclient:* preserved. E-CHANNEL-002 retired; E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER (§34). |
| 39 | Schema and Migrations | 22209-22662 | 454 | `< schema>`, column types, migration diff. §39.5.7 additive shared-core validator vocabulary (`req`/`length`/`pattern`/`min`/`max`/`gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn`) · §39.5.8 lowering to standard SQL DDL (`CHECK`, `NOT NULL`) · §39.5.9 when to use SQL-mirror vs shared-core. SQL-mirror remains canonical; shared-core is purely additive. |
| 40 | Middleware and Request Pipeline | 22663-23477 | 815 | Auto middleware, handle() escape hatch. §40.7 documentary attributes (`title`/`description`/`version`/`author`/`license` on `<program>`; HTML head metadata; W-PROGRAM-TITLE-NESTED on nested `<program>` blocks). §40.8 program shape — one-program-per-application; `<program>`/`<page>` bodies parse in `default-logic` mode (bare top-level decls auto-lift; W-PROGRAM-REDUNDANT-LOGIC). `default-logic` is a distinct THIRD body-mode owned by §40.8, separate from §4.18's free-text / code-default split; §4.18 carries the reciprocal cross-ref. |
| 41 | Import System — `use`/`import` | 23478-24441 | 964 | Capability imports, value imports, vendoring · §41.12 `scrml:data` `registerMessages` (project-level error message registration) · §41.13 `parseVariant(json, EnumType)` — boundary-parsing for tagged-variant JSON, the FIRST general-position type-as-argument member (L22); failure type `ParseError:enum` with `MissingDiscriminator`/`UnknownVariant`/`InvalidPayload`/`Malformed`; `E-PARSEVARIANT-*` codes · §41.14 `formFor(StructType)` — type-driven form generation, the SECOND L22 member (cross-ref §53.14.3); markup form `<formFor for=Signup onsubmit=fn pick=[...]/>` with named slots (§16); progressive-enhancement `<form action=>` when the handler is a `server function`; auto-synthesized state cell + validity surface + `<errors of=>`; 8 codes in §34; v1.0 excludes multi-step, read-only, nested-struct auto-recurse, per-type renderer registry and `@label` · §41.15 `schemaFor(StructType)` — type-driven SQL DDL, the THIRD L22 member (cross-ref §53.14.3); FUNCTION-CALL form `${ schemaFor(Users) }` inside a `<schema>` block (§39); emits a `table-declaration` fragment; shared-core emit vocabulary (§39.5.7); enum-typed fields lower to `text req oneOf([variant-names...])`; pick/omit transforms; payload-bearing enums, nested struct fields and non-mappable types REJECTED; 8 `E-SCHEMAFOR-*` codes · §41.15.6 a subset-refined enum field lowers to the SUBSET check (nullable subset composes via §41.15.8a). |
| 42 | `not` — Unified Absence Value | 24442-24860 | 419 | `not` keyword, `is not`, `is some`, `given x =>`, `T | not`, compound exprs (§42.2.4). §42.1 Overview — `null` does NOT exist in scrml and never will, extended to `undefined`; W-ABSENCE-IN-SCRML-SOURCE is the info-level regression-guard companion to E-SYNTAX-042, with an explicit exclusion list for JS-host / SQL-DDL / wire-format / runtime-ABI positions. §42.1.1 "Defined Values vs. Absence" — `""` / `0` / `false` / `[]` / `{}` are DEFINED values and SHALL NOT be migrated to `not`. §42.2.5 `is some` vs `req` are distinct predicates (`""` IS some; `""` fails req). §42.6 the W-ABSENCE-IN-SCRML-SOURCE row · §42.7 `default=not` canonical form + the compiler-emission SHALL clause. |
| 43 | Nested `<program>` | 24861-24943 | 83 | Execution contexts, shared-nothing, lifecycle, RPC |
| 44 | `?{}` Multi-Database Adaptation | 24944-25072 | 129 | Bun.SQL target, driver resolution, `.get()` → `T | not`; **§44.8 bracket-matched `?{` scanner (F-SQL-001)** + E-SQL-008 hard-error |
| 45 | Equality Semantics | 25073-25194 | 122 | Single `==`, no `===`, structural, compiler-derived |
| 46 | Worker Lifecycle | 25195-25241 | 47 | `when ... from <#name>`, supervision attrs |
| 47 | Output Name Encoding | 25242-25831 | 590 | Encoded JS variable names, kind prefixes, hash scheme. Synthesised validity props, auto-declared engine vars and derived engines all ride the existing kind markers (`p`/`a`/`t`) — no new kind markers required. §47.5 cross-ref — test-mode `test-bind` dispatch (§19.12.6 / §19.12.7) keys its scope-local dispatch table by §47-encoded names; no new naming scheme; dead-code-eliminated from release builds. |
| 48 | The `fn` Keyword | 25832-26573 | 742 | Body prohibitions, return-site completeness, lift in fn, calling conventions; Layer 2 retired, §54 cross-ref. §48.6.4 Mutual Recursion and Hoisting — `fn` declarations at file scope hoist per §6.9, mirroring `function`; mutual recursion is supported without source-order constraints; `pinned fn` opts out; +2 normative statements at §48.13. §48.3.5 (E-FN-005) subordinates to §19.9.8. |
| 49 | `while` and `do...while` Loops | 26574-27281 | 708 | Grammar, break/continue, labels, lift in loops, E-LOOP errors (heading uses H1, not H2) |
| 50 | Assignment as Expression | 27282-27787 | 506 | Assign-expr syntax, semantics, type rules, fn interaction. §50.14 composition with the markup-as-value pillar · §50.15 composition with bare-form event handlers. |
| 51 | State Transition Rules / `< machine>` / `<engine>` | 27788-31916 | 4129 | Engines as Tier 2 (the §51.0 block); legacy `<machine>` preserved at §51.1-§51.16. §51.0.A overview / singleton · §51.0.B declaration syntax + opener and state-child attribute tables (reserved set `{rule, effect, history, internal:rule}`; `effect=` and `accepts=` rows) · §51.0.B.1 payload binding on state-children — three forms (bare-attribute, named, parenthesized), the sister form to §18.0.1, semantics inherited from §18.7; codes E-ENGINE-PAYLOAD-ON-UNIT-VARIANT, E-ENGINE-PAYLOAD-ARITY-MISMATCH, E-ENGINE-PAYLOAD-RESERVED-COLLISION (§34) · §51.0.C auto-declared variable + `var=` · §51.0.D mount position (decl=mount; cross-file singleton) · §51.0.E `initial=` + W-ENGINE-INITIAL-MISSING · §51.0.F `rule=` contract (compile-time + runtime) + §51.0.F.1 idempotent self-write (self-writes are no-ops, NOT `rule=` violations; W-ENGINE-SELF-WRITE-DETECTED info lint) · §51.0.G `.advance()` loud + §51.0.G.1 argument resolution (state plane vs message plane; ambiguous → E-VARIANT-AMBIGUOUS, unknown → E-ENGINE-MSG-UNKNOWN, union-typed arg FORBIDDEN) · §51.0.H `effect=` / `<onTransition>` (to/from/once/if=), incl. Form 3 opener `effect=` — the boot-only init→`initial=` edge, forbidden on a derived opener (E-ENGINE-EFFECT-ON-DERIVED, §51.0.J) · §51.0.I `:`-shorthand · §51.0.J derived engines · §51.0.K components vs engines (E-COMPONENT-ENGINE-SCOPE) · §51.0.L relationship to legacy §51.1+ · §51.0.M `<onTimeout>` (engine temporal surface; rides the §51.12 runtime) · §51.0.N `history` on composite state-children (synth cell `@_<outerVar>_<variant>_history`; shallow-only) · §51.0.O `internal:rule=` prefix · ~~§51.0.P `parallel`~~ **STRUCK 2026-05-08** (the section number is retired; the §51.0.O → §51.0.Q gap is intentional) · §51.0.Q hierarchy / nested `<engine>` + parent-rule cascade dispatch · §51.0.R ordering (arm onIdle → fire effect) and handled-message idle-watchdog reset · §51.0.S engine message dispatch — `accepts=MsgType`, the `(state × message)` arm form reusing match grammar, per-state exhaustiveness (E-ENGINE-MSG-ARM-NOT-EXHAUSTIVE), no-op-when-no-arm, `rule=` still the transition contract. Engine state-child bodies (bare-body and `:`-shorthand) are code-default bodies (§4.18); bare prose fires E-UNQUOTED-DISPLAY-TEXT; worked examples at §51.0.B.1 / §51.0.N / §51.0.Q.1. Codes E-HISTORY-NO-INNER-ENGINE, E-INTERNAL-RULE-NOT-COMPOSITE. §51.12.3.1 computed-delay relaxation (engine and machine forms). |
| 52 | State Authority Declarations | 31917-32876 | 960 | Two-tier authority, server @var. §52 is a READ-authority + reactive-wiring layer (load + SSR + E-AUTH) — the persist write is the developer's explicit `?{}` server fn at BOTH tiers (§52.6.2 auto-persist **RETRACTED** 2026-06-14; §52.6.6 dev write-fn convention; SPEC-ISSUE-026 RESOLVED). V5-strict access composes; the auto-synth validity surface synthesises regardless of authority; channels are not §52 authority. |
| 53 | Inline Type Predicates | 32877-34113 | 1237 | Value constraints, SPARK zones, named shapes, bind:value HTML attrs · §53.6.1 shared-core vocabulary in refinement-type position (cross-ref §55.1) · §53.6.2 composition with state-cell validators · §53.14 type-as-argument primitives (the L22 family) — §53.14.1 type-establishment vs predicate-enforcement, §53.14.2 `reflect(TypeName)` precedent, §53.14.3 family roster (`parseVariant` shipped; `serialize`/`formFor`/`schemaFor`/`tableFor`), §53.14.4 discipline, §53.14.5 compile-time recognition, §53.14.6 stdlib-declared types · §53.15 enum-subset refinement — a SUBSET via `oneOf([.V1,…])`/`notIn([…])`, statically-decidable membership, §53.4 three-zone, widen-free / narrow-checked flow, NO range form, match exhaustiveness narrows (§18.8.1 / §18.0.1), engine `for=` subset DEFERRED · §53.9.2 widen/narrow rows. |
| 54 | Nested Substates and State-Local Transitions | 34114-34430 | 317 | Nested substate grammar (§54.2), state-local transitions (§54.3), field narrowing (§54.4), terminal states (§54.5), 4 error codes (§54.6), interaction matrix (§54.7). Companion to the §51.15 cross-check; §54 composes uniformly with §51.0 engine state-children. |
| 55 | Validators and the Auto-Synthesized Validity Surface | 34431-35018 | 588 | §55.1 universal-core vocabulary (req, length, pattern, min/max, gt/lt/gte/lte, eq/neq, oneOf/notIn) · §55.2 state-cell validators · §55.3 refinement-type validators (cross-ref §53) · §55.4 schema-column validators (cross-ref §39) · §55.5/§55.6 auto-synth validity surface, compound + per-field — isValid/errors/touched/submitted · §55.7 synthesized-property semantics (read-only) · §55.8 `<errors of=expr/>` first-class element · §55.9 ValidationError enum · §55.10 the 4-level message resolution chain · §55.11 cross-field via predicate args · §55.12 multi-errors / short-circuit · §55.13 reset interaction (cross-ref §6.8) · §55.14 engine + derived cells · §55.15 cross-refs + error-code listing. `.OneOfFailed(set)` carries the SUBSET, not the base enum (§53.15), and the three loci (state-cell validator / refinement type / schema column) agree on the same subset membership predicate. |
| 56 | Promotion Ergonomics — `I-MATCH-PROMOTABLE` and `bun scrml promote` | 35019-35481 | 463 | §56.1 motivation · §56.2 fire conditions for the `I-MATCH-PROMOTABLE` info-level lint · §56.3 three message shapes (exhaustive / near-miss / compound) · §56.4 compound-condition advisory · §56.5 `bun scrml promote --match` CLI subcommand (per-branch rewrite rule, idempotent, `--dry-run`) · §56.6 `--engine` Tier 1→2 sibling, deferred to Tier C pending W-MATCH-TRANSITIONS-ACCRUING groundwork · §56.7 tooling integration · §56.8 cross-references. The predicate matrix supports both `if (@cell is .Variant)` and `if (@cell == .Variant)`. |
| 57 | Wire Format | 35482-35576 | 95 | §57.1 scope (server-fn / channel / SSE for `T | not`) · §57.2 canonical envelope shape `{"__scrml_absent": true}` · §57.3 encoder rules — envelope on absence, raw value on presence · §57.4 dual-decoder — accepts the envelope and raw null · §57.5 clean break at v1.0 (forward-deprecation) · §57.6 forward-compat with a potential runtime-sentinel naming · §57.7 cross-refs §12.5.1 / §37 / §38 / §41.13 / §42. Slot note: the working label `§50.x` lands at §57 because §50 is occupied by Assignment-as-Expression. |
| 58 | Build Story | 35577-35880 | 304 | **Nominal — spec-ahead** (no compiler implementation; `*`-marked clauses are specified-but-unproven). §58.1 compilation as a pure function `compile(source, buildStory) → artifact` (static, read-once; NOT a live/hot-swappable compiler) · §58.2 the four-component composite (stdlib / language tools / compiler source / vendored edge code) · §58.3 the artifact as a content-addressed Merkle closure · §58.4 the `[story]` manifest table in `scrml.toml` · §58.5 the mandatory human-inspectable `build-story.lock` sidecar — §58.5.1 closure node model (5 kinds, acyclic DAG), §58.5.2 canonical node-hash + root computation, §58.5.3 the line-based canonically-ordered serialization, §58.5.4 verification (recompute-and-reject; no network, no trusted third party) · §58.6 closure encoding (canonical, bit-stable, SHA-256 root, deliberately distinct from §47's FNV-1a-32) · §58.7 relationship to §47 · §58.8 per-`<program>` build stories via the nested-only `story=` attribute (top-level → W-STORY-ON-TOP-LEVEL) · §58.9 resolution + inheritance (`db=`-style) · §58.10 dialect islands · §58.11 cross-`<program>` ABI invariance (§57 / §43.5 / §4.12.5) · §58.12 determinism, specified vs not-yet-proven · §58.13 error codes · §58.14 cross-refs. Codes E-STORY-UNKNOWN + W-STORY-ON-TOP-LEVEL (§34); §4.12.2 `story=` row; §47.5 / §22.13 / §40.8 cross-ref amendments. |
| 59 | Value-Native Maps | 35881-36072 | 192 | **IMPLEMENTED** (type-system + literal parser + runtime + codegen; the SPEC §59 banner and known-gaps reflect this). A value-native runtime-keyed dictionary — an immutable value associating keys with VALUES, which structs cannot express. §59.1 overview (a map is a VALUE, `==` by entries, no identity, every write returns a new map; a raw JS `Map` is NOT scrml's map) · §59.2 type grammar `[KeyT: ValT]` + the `@ordered` postfix TYPE affix · §59.3 literals `[:]` / `[k:v,...]`, the depth-1-entry-colon disambiguation, duplicate-key last-wins (`W-MAP-DUPLICATE-LITERAL-KEY`), v1 struct/enum-key-literal defer (`W-MAP-STRUCT-KEY-LITERAL`) · §59.4 key domain (any §45-comparable; map-as-key out in v1 → `E-MAP-KEY-IS-MAP`; function-key → `E-EQ-003`) · §59.5 value-canonical key codec (mirrors §47.1.4 alpha-sort + §47.1.3 FNV-1a-32 at the VALUE level; collisions EXPECTED and resolved by bucket `==` — the OPPOSITE disposition from §47.1.5 E-CG-010) · §59.6 bracket-read `@m[k]` → `V|not` plus `.getOr`/`.has`/`.size` (`.has` disambiguates `[K:V|not]` via union-`not` normalization §42) · §59.7 method-native `.insert`/`.remove`/`.update`/`.insertAll`; `.remove` is the ONLY removal; bracket-WRITE banned at every level (`E-MAP-BRACKET-WRITE`) · §59.8 unordered + loud iteration `.keys`/`.values`/`.entries` (`.sorted()` / `@ordered`; `W-MAP-ITERATION-ORDER` Info → result.warnings) · §59.9 `==` structural and order-independent even for `@ordered`; map-vs-non-map → `E-EQ-001` · §59.10 lossless serialization (entries-array codec; stored-`not` via the §57 absence-envelope) · §59.11 codes (E-MAP-KEY-NOT-COMPARABLE, E-MAP-KEY-IS-MAP, E-MAP-BRACKET-WRITE, E-MAP-LITERAL-MALFORMED, W-MAP-ITERATION-ORDER, W-MAP-STRUCT-KEY-LITERAL, W-MAP-DUPLICATE-LITERAL-KEY) · §59.12 v1 scope-cuts and the value-native set `set[K]`, **IMPLEMENTED** as a thin desugar over this map (`.add`/`.has`/`.remove`/`.size`/`.elements`/`<each in=@s>` + `.union`/`.intersect`/`.difference`) · §59.13 cross-refs. Cross-section amendments: §45.2/.7/.8, §47.1.6, §42.3.1, §57.7, §6.5, §14.3; §34 +7 rows. |
| 60 | Typed External API — `<api>` | 36073-36194 | 122 | **IMPLEMENTED** (parser + typer + codegen + tests/example; R26-verified). The typed external-API primitive for the bring-your-own-backend boundary — a scrml frontend over a foreign backend scrml does NOT own. §60.1 BYOB overview (untyped-silent vs typed-compile-loud drift) · §60.2 the `<api src= base=>` block + endpoint grammar `name(reqShape) -> METHOD "path" : ResponseT` (mirrors `<db src= tables>`) · §60.3 owned-vs-unowned must-not-lie — the element name `<api>`≠`<db>` IS the type-system-visible marker (no `unverified` token, no propagating taint); `<db>` has `scrml migrate`/§39.12 W-SCHEMA-003, `<api>` has NO reconcile lever · §60.4 `<request api="name" args=>` bind mode · §60.5 response reuses `parseVariant` §41.13 · §60.6 client-only per §12.2; SSR-of-external-data structurally GAPPED · §60.7 LIMIT-PRIMITIVES (no retry / cache / pagination) · §60.8 OpenAPI ingest gated + deferred · §60.9 `E-API-*` codes — 4 parse (BASE-MISSING, METHOD-INVALID, RESPONSE-TYPE-UNDECLARED, ENDPOINT-MALFORMED) + 3 typer (ENDPOINT-UNKNOWN, REQ-SHAPE-MISMATCH, PATH-PARAM-UNBOUND), §34 rows land with the impl; type-refs reuse §14.1.2 E-TYPE-UNKNOWN-NAME · §60.10 limits · §60.11 xrefs. |
| 61 | Typed Inbound Endpoint — `<endpoint>` | 36195-36356 | 162 | **IMPLEMENTED** (parser + typer + codegen + tests/example; serves end-to-end, R26-verified; appended at SPEC end, so it shifts no ranges below). The typed INBOUND edge — the serve-side mirror of §60 `<api>`: a foreign client calls a scrml-served route, the compiler owns decode + exhaustive dispatch + the JSON envelope, the author fills per-variant arms. §61.1 overview + the `<api>` mirror table + inbound-edge honesty (an unhandled variant is a compile error); NOT a JSON-RPC dispatcher · §61.2 grammar `<endpoint path= method= accepts=:enum>` + per-variant arms (reuses §18.0.1 arms and §51.0.B.1 payload binding; §4.14 / §4.18) · §61.3 request decode via `parseVariant` §41.13 · §61.4 exhaustiveness (reusing §18.0.1 / §51) → `E-ENDPOINT-NOT-EXHAUSTIVE` · §61.5 the JSON envelope (default + author-override; JSON-RPC is a convention, NOT a baked-in mode) · §61.6 client-codegen SKIP (mirror of §60.6) · §61.7 method / path / auth (`path=` an author-stable contract URL per the §12.3 / §37.3 foreign-facing carve-out; JSON+bearer CSRF-exempt by construction) · §61.8 relationship map (§60 outbound ⇄ §61 inbound · §37 `server function* route=` SSE · §40 `handle()` raw escape · §12 routes · the DEFERRED path-bound `raw` server-fn) · §61.9 the `E-ENDPOINT-*` codes, named + reserved, landing in §34 with the impl exactly as §60's `E-API-*` do: `E-ENDPOINT-NOT-EXHAUSTIVE`, `E-ENDPOINT-ACCEPTS-NOT-ENUM`, `E-ENDPOINT-PATH-MISSING`, `E-ENDPOINT-METHOD-INVALID`, `E-ENDPOINT-ACCEPTS-MISSING` · §61.10 limits / Nominal gaps · §61.11 xrefs. Registry rows: §4.15 + §24.4. |
| 62 | Language Versioning — the `scrml-language` semver axis | 36357-36682 | 326 | **Nominal / spec-ahead** — the version-tier definitions, `lang:` vocab and freeze discipline are NORMATIVE; the compiler wiring (`chunks.json` `language` emit, `scrml.toml [language]` pre-parse read, the 2 version-gate codes) lands with the impl. The LANGUAGE version axis, distinct from the compiler (§47.5). §62.1 two axes (language = CONTRACT ⟂ compiler = IMPL; a compiler is scrml iff it passes the conformance suite for the version it declares — the native cutover is a non-event) · §62.2 the conformance corpus IS the versioned contract (the `(source → codes + runtime-effect)` tuple-set) · §62.3 MAJOR/MINOR/PATCH anchored to the corpus + anchor table · §62.4 the `chunks.json` `language` field (informational, NOT a hash input) · §62.5 the 1.0-rc → 1.0 cut + freeze discipline and the 3-part 1.0-final gate (corpus = agreed surface · impl#1 100% · zero pending breaks — impl#2/native is NOT a gate) · §62.6 the adopter pin `scrml.toml [language] version`, with reserved `E-LANGUAGE-VERSION-TOO-NEW` / `E-LANGUAGE-COMPILER-TOO-OLD` (§34 rows land with the impl); unpinned = highest-conformant · §62.7 the `lang:` vocab (`1.0` / `deprecated` / `future`; deprecated = accept + W-lint required, future = fail-closed) · §62.8 **NO editions in the 1.0 surface as built** — the deprecation cycle replaces them, one rule-set per version, on three population-INDEPENDENT reasons (no registry / no independently-versioned units per §41.4 · conformance is ONE predicate over a BUILT gated corpus · N rule-sets = N languages the compiler, checker, formatter and LSP carry forever); earlier population-based premises are STRUCK; carries the reopening condition (*is this a front-end-only delta?*) and the standing `[language] version=` tripwire (**unfired** — §62.6 is subset/ceiling-shaped and 100% unbuilt), and leaves **`remove-only-at-a-MAJOR` explicitly OPEN** · §62.9 xrefs. |
| 63 | Deprecation Lifecycle — the stage machine | 36683-36894 | 212 | **Normative formalization of the W → reserved-E → removal pattern**, tied to §62 version events. §63.1 four stages SANCTIONED → SOFT-DEPRECATED → SCHEDULED → REMOVED · §63.2 the well-formedness invariant — co-land {parses-identically W-lint} + {reserved-E named in §34} + {a `scrml fix` rule OR a designer-card}; a Stage-1 deprecation **MUST NOT name a removal version** · §63.3 timing (deprecate at any MINOR · remove ONLY at a MAJOR · ≥1 minor in-window · the clock is version-events + corpus-clean, NOT a calendar · schedules reversible until fired) · §63.4 the `--fix` / `scrml fix` gate (SHOULD at deprecate, HARD-GATE verified-landed at schedule/remove; designer-card waiver) and the `scrml fix` verb split from the DB-schema `scrml migrate` (§39.8) · §63.5 conformance interaction (both forms in-contract during the window, the W-code REQUIRED, runtime identical; a stricter native parser is an impl BUG, not a break) · §63.6 `lang:` transition semantics · §63.7 corpus disposition at the 1.0 freeze = **permanent-soft** (ZERO scheduled removals; the 3 floating forms — `<machine>` §51.3.2 / whitespace §15.15.5 / CPS §19.9.5 — are reclassified unscheduled; 2 codemod-less forms gate-blocked) · §63.8 what is NOT a lifecycle deprecation (`W-ABSENCE-IN-SCRML-SOURCE` is a permanent regression-guard; `W-EACH-PROMOTABLE` / `I-MATCH-PROMOTABLE` are permanent-coexistence nudges) · §63.9 xrefs. |
| 64 | Standalone Tool Target — `<program kind="tool">` | 36895-37115 | 221 | **SPEC-TEXT landed; impl pending** (§34 E-TOOL rows land with the impl). The first explicit top-level `kind=` — re-targets the §40.8 top-level program's emit from web-app to a plain runnable ES module (CLI or long-running server); composes with `lang=` → `_{}`, `db=` → `?{}` (§44) and `capabilities=`; only the emit shape changes, and `kind=` is orthogonal to §43 nested-context inference and the §47.1.2 name-encoding kinds. §64.1 emit — no html / client / CSRF / routes · §64.2 entry `function main(args:string[]):number`, IMPURE so `function` not `fn` (`E-TOOL-004`); a tool body admits bare-`_{}` for host I/O (§23.2.4, a 3rd admitted form) · §64.3 the return-type HARNESS discriminator — `:number` → `process.exit(await main(argv))`; no-return → invoke-only, where Bun's active handles keep it alive, so ONE kind covers run-and-exit and long-running and there is no `kind="service"` · §64.4 UI in a tool is `E-TOOL-003`. Codes `E-TOOL-001` no-main, `E-TOOL-002` bad-or-nested-kind, `E-TOOL-003` UI, `E-TOOL-004` fn-main. Library complement: `<foreign lang="ts" />` §23.6. |
| 65 | The scrml-native CSS Model — predictable, cascade-free styling | 37116-37540 | 425 | **Wave-1 emission LANDED; Waves 2-3 Nominal / spec-ahead.** The model surface, resolution algorithm, `<theme>`/`<defaults>` structural elements, `style=`-value application and named diagnostics are NORMATIVE. Splits CSS's god-primitive cascade into bounded, locally-reasoned primitives: specificity is deleted and an ambiguous overlap is a compile error. **LANDED (Wave 1, wired in codegen):** the §65.2 conflict-checker (`E-STYLE-CONFLICT` / `W-STYLE-CONFLICT-POSSIBLE`); `:where()`-flat emission (§65.2.5, reusing the §26.6 `prose` mechanism); the `@layer reset, global;` order + built-in `reset` layer (§65.3.4) + `@charset`/`@import` hoist (§65.8); `<theme>` token → `:root` lowering (§65.3.2 / §25.7) with the `@`-sigil use-site check `E-THEME-TOKEN-UNKNOWN` (§34 row LANDED) on BOTH the scoped-selector and the flat-inline `#{}` → `style=""` path (§65.4.1); and the §65.6 runtime theme-switch reflection (client half). **Follow-on (Nominal):** style-as-value (`const chrome=#{}`, `style=<value>`, `style=[a,b]`, `style:name=`, `<defaults>` — Wave 2); the full §65.8 Tailwind-`utilities`-layer chain (Wave 3); `--explain-style`; the `E-STYLE-VALUE-*` / `E-DEFAULTS-*` / `E-STYLE-IMPORTANT-*` / `E-STYLE-CONDITION-OVERLAP` codes. §65.0 thesis · §65.1 the single resolution algorithm (no specificity step) · §65.2 Axis 1 flat specificity · §65.3 Axis 2 bounded cascade (DOM-inheritance + `<theme>` token-flow + `<defaults>` + the opt-out-able reset) · §65.4 Axis 3 style-as-value (`#{}` expr-vs-stmt position; `style=` value-shape overloading; FLAT-single-element + `E-STYLE-VALUE-DESCENDANT`; ordered `style=[a,b]`; `style:name=@cond`) · §65.5 the precedence chain (applied `style=` > scope `#{}` > `<defaults>`/inherited > reset > initial) · §65.6 reactive theming (`<theme for=@cell>` — one `:root` write, zero re-render) · §65.7 the `!important` interop-only escape · §65.8 Tailwind fixed `@layer` order (utilities-LOW) · §65.9 the structural-element collision principle · §65.10 diagnostic codes · §65.11 the MVP gate (corpus dry-run) · §65.12 deferred OQs · §65.13 worked example · §65.14 migration (additive) · §65.15 waves (Wave 1 gates V1.0) · §65.16 xrefs. Amendments: §9.1, §25.7, §26.9, §4.15 / §24.4 registries. |

## Quick Lookup: Topic → Section

- multi-scrutinee match `match (e1,…,eN) { (p1,…,pN) :> body }` (S224 — dispatch on the JOINT case of N scrutinees; standalone value-return sibling of the engine `(state × message)` form §51.0.S; parens are grammar NOT a tuple value [no-tuple S222 intact]; product exhaustiveness; nested-pattern exclusion §18.11 preserved; Nominal/spec-ahead) → §18.19 + §18.2

- build story (S118 — `compile(source, buildStory)` pure function; content-addressed Merkle closure over the four-component compiler composite; Approach B; static + read-once, NOT a live compiler) → §58
- `[story]` manifest table + `build-story.lock` sidecar (S118 — build-story declarations in `scrml.toml`; the mandatory human-inspectable closure expansion) → §58.4 + §58.5
- per-`<program>` build story / `story=` attribute (S118 — nested-`<program>`-only; references a `[story]` table name; dialect islands) → §58.8 + §58.10 + §4.12.2
- value-native map (S168 — runtime-keyed dictionary; immutable value; `==` by entries; Nominal/spec-ahead; the collection structs cannot express) → §59
- `[KeyT: ValT]` map type + `@ordered` affix (S168 — concrete type affix, not a generic; `@ordered` is a postfix TYPE affix for insertion-order iteration) → §59.2 + §14.3
- bracket-read map / `@m[k]` → `V|not` (S168 — reads are bracket-native; bracket-WRITE is `E-MAP-BRACKET-WRITE`, writes are method-native) → §59.6 + §59.7
- `.insert` / `.remove` / `.update` / `.insertAll` (S168 — method-native reassignment-canonical map writes; `.remove` is the only removal, `=not` is NOT a remove) → §59.7
- map iteration `.keys` / `.values` / `.entries` (S168 — value-native arrays, UNSPECIFIED order + loud, positional correspondence, `.sorted()` / `@ordered`) → §59.8
- map equality (S168 — structural, order-independent even for `@ordered`; map-vs-non-map is cross-type `E-EQ-001`) → §59.9 + §45.2
- map serialization (S168 — lossless entries-array codec, NOT raw JS `Map`; stored-`not` via §57 absence-envelope) → §59.10 + §57.7
- map key hashing / value-canonical codec (S168 — §47.1.4 alpha-sort + FNV-1a-32 at the VALUE level; hash-consistency from §45; collision resolved by bucket `==`) → §59.5 + §47.1.6
- typed inbound endpoint `<endpoint>` (S219 — the typed INBOUND edge; a foreign client calls a scrml-served route, compiler owns decode + exhaustive dispatch + JSON envelope, author fills per-variant arms; IMPLEMENTED default-pipeline S219) → §61
- `<endpoint path= method= accepts=:enum>` + per-variant arms (S219 — REUSE §18.0.1 arm + §51.0.B.1 payload binding; decode via `parseVariant` §41.13; arms exhaustive over `accepts=` → `E-ENDPOINT-NOT-EXHAUSTIVE` the inbound-honesty guarantee) → §61.2 + §61.3 + §61.4
- typed-inbound ⇄ typed-outbound mirror (S219 — `<endpoint>` is the serve-side mirror of §60 `<api>`; both type a foreign HTTP wire scrml does not own end-to-end; client-codegen SKIP — server handler only, foreign client has its own SDK; JSON+bearer CSRF-exempt, `csrf` strawman dropped per dpa-002) → §61.1 + §61.6 + §61.7 + §60
- raw-content elements `<pre>` / `<code>` (S101 — scrml tokens NOT parsed inside; HTML entity-escaping for display remains author concern) → §4.17 + §24.3.1
- code-default body mode (S111 — quoted-text model, scope b; engine state-child / match arm / `:`-shorthand bodies: a bare run is code, display text is a `"..."` literal; plain markup stays free-text) → §4.18
- display-text literal `"..."` (S111 — body-position display-text vehicle in code-default bodies; `"`-only, `'` is a free interior char; `${...}` interpolation inside; verbatim whitespace; codegen auto-HTML-escapes literal text) → §4.18.3 + §4.18.4 + §4.18.5 + §4.18.6
- `:`-shorthand body grammar (S111 — within-body construct bounded by `:` and the opener `>`; no new structural delimiter; code-default sub-mode) → §4.14 + §4.18.1
- `text` / `TextNode` block/AST kind survives (S111 — scope b keeps it for plain-markup free text; NOT deleted) → §4.18.8
- attribute parsing → §5 (1026-1674)
- bind:value → §5 (~1147+)
- event handler binding → §5.2.2 (1105-1126)
- bare-form event handler / multi-statement rule → §5.2.3 (1127+) (D4)
- bind-dispatch table by render-spec → §5.4.1 (1318+) (D4)
- dynamic class → §5 (1255+)
- reactive declaration → §6.1-§6.2 (1675+) (V5-strict two forms + three RHS shapes)
- V5-strict access → §6.1 (1677+) + §1.6 (169+) + §3.4 (267+)
- three RHS shapes for state declarations → §6.2 (~1764+)
- Variant C compound state → §6.3 (~1827+)
- render-by-tag semantics → §6.4 (~1895+)
- default= attribute → §6.8 (~4716+)
- reset keyword → §6.8 (~4716+)
- hoisting model → §6.9 (~4774+)
- pinned keyword → §6.10 (~4816+)
- validity surface (auto-synthesized) → §6.11 (~4856+) + §55
- markup-as-value pillar → §1.4 (126+)
- north star + Tier ladder → §1.5 (145+)
- in-compound derived values → §6.6.16 (~2960+)
- markup-typed derived cells → §6.6.17 (~2997+)
- server-only stdlib reach in a derived RHS (E-DERIVED-SERVER-ONLY-REACH) → §6.6.19 (~3691+) + §12.2 Trigger 3
- reactive arrays → §6.5 (~1945+)
- reactive array mutation → §6.5 (~1945+)
- derived values → §6.6 + §6.6.16-17 (~2363+)
- lifecycle / cleanup → §6.7 (~2960+)
- timeout / single-shot timer → §6.7.8 (~3774+)
- logic context → §7 (4910-5149)
- markup-as-expr in logic context → §7.4 (4991+) + §7.4.1 (5011+) (L1 reframe, D4)
- file-level scope sharing → §7.6 (~5060+) + §7.6.1 (5096+) (V5-strict + pinned, D4)
- logic-markup interleaving → §7.7 (5113+) (M8, D4)
- SQL / ?{} → §8 (5150-5686)
- SQL per-handler coalescing (Tier 1) → §8.9 (~5552+)
- SQL N+1 loop hoisting (Tier 2) → §8.10 (~5600+)
- SQL mount-hydration coalescing → §8.11 (~5670+)
- CSS → §9 (5687-5729)
- CSS inline block → §9.1 (5691+)
- lift → §10 (5730-6123)
- lift under markup-as-value → §10.1.1 (5746+) (L1 reframe, D4)
- lift accumulation order → §10.8 (~6088+)
- state objects / protect= → §11 (6124-6145) (reserved stub; see §6.12 and §52)
- route inference → §12 (6146-6241)
- server function return values → §12.5 (~6206+)
- async → §13 (6242-6512)
- async loading / RemoteData → §13.5 (6329+) (D4: cross-ref to engine recipe)
- generators / `function*` / `yield` / `yield*` (S131 — FULL LANGUAGE VOCABULARY; local-not-viral rationale, admitted while async/await is forbidden; §37 SSE prior-art; non-SSE emits via JS-host generator path — the client emit path preserves the `*` per bug-16/S178) → §13.6 + §19.9.8 (sibling no-async/await rule)
- type system / structs / enums → §14 (6513-7116)
- enum types as struct fields → §14.3.2 (~6529+)
- bare-variant inference (general) → §14.10 (7034+) (M9, D4)
- positional binding for predefined-shape compound → §14.11 (7070+) (M10, D4)
- components / props → §15 (7117-8230)
- component reactive scope → §15.13 (~7908+)
- components-vs-engines distinction → §15.13.5 (7960+) (M20, D4)
- component reactive scope under V5-strict → §15.13.6 (7993+) (D4)
- slots → §16 (8231-8500)
- if= / show= / control flow → §17 (8501-9210)
- if-as-expression → §17.6 (~8855+)
- match / pattern matching → §18 (9211-10486)
- match arm-arrow `:>` canonical (S145 ratification / S147 landing — `:>` is the canonical match + `!{}` handler arm separator; `=>`/`->` deprecated aliases via `W-MATCH-ARROW-LEGACY`; all three parse/emit identically; wildcard `else`/`_` + variant `.`/`::` unchanged) → §18.2 + §19 + §34
- W-MATCH-ARROW-LEGACY (S147 — deprecated `=>`/`->` arm separator; info-level, arm-context-scoped; `bun scrml migrate --fix` AST rule; mirrors W-LIFECYCLE-LEGACY-ARROW) → §18.2 + §34
- is operator → §18.17 (~10093+)
- partial match → §18.18 (~10223+)
- error handling / fail / ? / ! → §19 (10487-11358)
- implicit per-handler transactions → §19.10.5 (~11038+)
- navigation / navigate() → §20 (11452-11623)
- module / import / export → §21 (11624-12059)
- export <ComponentName> Form 1 / Form 2 (P2 §21.2) → §21.2 (~11632+)
- cross-file engine import → §21.8 (11989+) (M18, D4)
- pinned on imports → §21.8.1 (12034+) (D4)
- meta / ^{} → §22 (12060-12727)
- foreign code / _{} → §23 (12728-13170)
- WASM sigils → §23.3 (~12950+)
- sidecars / use foreign: → §23.4 (~13105+)
- §23.3/§23.4 fail-closed-Nominal (S232 — g-nominal-foreign-forms; WASM call-char + `use foreign:` recognized-and-fail-closed; E-WASM-NOMINAL / E-FOREIGN-SIDECAR-NOMINAL; the v1.0 fail-closed-Nominal invariant) → §23.3 + §23.4 + §34
- capability declaration / `capabilities=` `<program>` attribute (S232 — capability-vocab V1, Nominal/spec-ahead authoring surface; vocab `{network,fs-read,fs-write,spawn,env,db}`; closest-ancestor inheritance; `[]` default; W-FOREIGN-UNDECLARED-CAPABILITY presence-nudge [opacity bound §23.2.3]; E-FOREIGN-CAPABILITY-UNKNOWN [both NAMED in §23.5.7; §34 rows land with the impl wave]; manifest-aggregate + Pole-D enforcement DEFERRED) → §23.5 + §4.12.2
- HTML elements → §24 (13171-13223)
- scrml-defined structural elements (NOT HTML) → §24.4 (13195+) (D4)
- CSS variables → §25 (13224-13322)
- comments → §27 (13421-13441)
- compiler settings → §28 (13442-13483)
- lint suppression configs (v0.next) → §28 (13442-13483) (D4)
- vanilla file interop / `.js`/`.html`/`.css` pass-through (Nominal — spec-ahead; NOT implemented; disposition: defer per S131 Q-W3-4 / reframed S132; §21 import is the live JS interop today) → §29
- bun.eval() → §30 (13493-13523)
- dependency graph → §31 (13524-13596)
- validator predicate-arg dependency tracking → §31.4 (13546+) (L14, D4)
- derived-state expression dependency tracking → §31.5 (13574+) (L15, L20, D4)
- tilde / ~ → §32 (13597-13808)
- pure → §33 (16513-16579) — DEPRECATED 2026-06-09; `fn` is the canonical pure form (W-PURE-DEPRECATED)
- error codes → §34 (13874-14126)
- E-UNQUOTED-DISPLAY-TEXT (S111 — quoted-text model, scope b; bare display text in a code-default body — engine state-child / match arm / `:`-shorthand; display text must be a `"..."` literal; spec-ahead-of-implementation, Wave 2+ wires the fire) → §34 + §4.18.7
- E-SYNTAX-050 / E-CTX-003 scoping notes (S111 — bare-`/` `looksLikeCloser` fires in plain-markup free-text bodies NOT code-default bodies; `:`-shorthand shape-confusion surfaces as E-CTX-003) → §34 + §4.18 + §4.14
- linear types / lin → §35 (14127-14588)
- lin function params → §35.2.1 (~14127+)
- keyboard / mouse / gamepad → §36 (14589-14946)
- SSE / server function* → §37 (14947-15188)
- WebSocket / channel → §38 (15189-15898)
- realtime feed over EXTERNAL db writes (`<channel watches=>` / `<onchange>` / synthesized `RowChange`) → §38.13 (Nominal)
- schema / migrations → §39 (15899-16268)
- middleware / handle() → §40 (16269-16492)
- `<program>` documentary attributes / HTML head metadata → §40.7 (Phase A1a, 2026-05-05)
- use / import system → §41 (16493-16742)
- E-STDLIB-CLIENT-CHUNK-MISSING (S368 stdlib-client-registry — compile ERROR when a CLIENT-reachable `import { ... } from 'scrml:NAME'` names a module with no client registry chunk; a classic-script bundle lowers the import to `_scrml_stdlib.NAME`, which only the `stdlib-NAME` entry in `RUNTIME_CHUNK_ORDER` defines, so an absent chunk is a load-time TypeError that kills the whole page — the compiler can PROVE the artifact is dead, hence error not warning; the gate reads `RUNTIME_CHUNK_ORDER` itself and scans the FINAL client text, so a server-only use pruned out of the bundle does not fire; a submodule specifier always fires because `_scrml_stdlib.auth/jwt` parses as a division; DISTINCT from W-STDLIB-SHIM-MISSING, which probes for a shim FILE on disk and never fires for this condition) → §34 + §41
- W-STDLIB-SHIM-MISSING (S121 Bug #8 — compile-time warning when an adopter `import { ... } from 'scrml:NAME'` references a stdlib module with no runtime shim at `compiler/runtime/stdlib/<name>.js`; emitted JS still carries literal `scrml:NAME` and fails loudly at runtime; warning surfaces the gap before deploy + acts as regression guard for future stdlib additions; the `scrml:compiler*` family is reclassified to `W-STDLIB-COMPILER-DEFERRED` per §41.17 — the deferral is by design, not a stdlib-author gap) → §34 + §41
- W-STDLIB-COMPILER-DEFERRED (S121 Wave 8 Unit F — compile-time warning for any `scrml:compiler` or `scrml:compiler/<stage>` import; fires whether the thunk shim is on disk or not because the deferral is a property of the family surface; per survey-memo Option (d), KNOWN-DEFERRED until validated adopter demand justifies Option (b)'s path-rewriter; resolution paths: invoke via CLI `scrml compile` or direct import from `compiler/src/api.js` in tooling code) → §34 + §41.17
- scrml:compiler family — KNOWN-DEFERRED stdlib family (S121 Wave 8 Unit F; umbrella + 13 per-stage thunk shims for `bs/tab/mod/ce/bpp/pa/ri/ts/mc/me/dg/cg/expr` at `compiler/runtime/stdlib/compiler/<stage>.js`; each export throws at call time with W-STDLIB-COMPILER-DEFERRED attribution; bundler reclassifies any `compiler` or `compiler/*` name from W-STDLIB-SHIM-MISSING to W-STDLIB-COMPILER-DEFERRED; ref `docs/changes/bug-8-followup/scrml-compiler-shim-survey-s121-2026-05-22.md`) → §41.17 + §34
- registerMessages / scrml:data → §41.12 (16698+) (L12, D4)
- formFor — type-driven form generation FLAGSHIP (S102 — L22 family second general-position member; SHIPPED S102-S103 end-to-end incl. stdlib re-export) → §41.14 (18389+)
- schemaFor — type-driven SQL DDL generation (S104 — L22 family THIRD general-position member; SHIPPED S104 incl. stdlib re-export + 62 tests + flagship enum-lowering per OQ-SCH-12) → §41.15 (~18540+)
- tableFor — type-driven `<table>` rendering FOURTH general-position L22 member; admin-UI-lift sibling to formFor (S105 — SPEC §41.16 + 13 `E-TABLEFOR-*` codes; impl pending). Markup-element form `<tableFor for=T rows=@cell>` per OQ-TF-1 synthesis-mode verdict 53/60 → §41.16 (~18700+)
- tableFor markup-element form `<tableFor for=Type rows=@cell/>` (OQ-TF-1 debate verdict Form A 53/60 vs Form B function-call 34/60 vs Form C block-attribute 29/60; 19-pt margin) → §41.16
- tableFor `<column field="X">` slot grammar (OQ-TF-7; rides §16 component slots; mirror formFor OQ-FF-1 51.5/60 verdict) → §41.16.3
- tableFor sort surface — opt-in `<column sortable>` + auto-synth `@<varName>.sortedBy: TableSort | not` state cell (OQ-TF-2 + OQ-TF-12) → §41.16.7
- tableFor selection surface — opt-in `selectable=@cell` outer attribute + leading checkbox column + mechanical `id`-field PK derivation + `selectedBy="field"` override (OQ-TF-3 + OQ-TF-12) → §41.16.8
- tableFor empty-state default + `<empty>` slot override (OQ-TF-6) → §41.16.9
- tableFor `pick:`/`omit:` field-set transforms (OQ-TF-8 family-vocabulary symmetry with formFor + schemaFor) → §41.16.5
- tableFor per-cell type-driven default rendering (string/integer/real/boolean/timestamp/bare-variant-enum → text; payload-enum → E-TABLEFOR-VARIANT-PAYLOAD-ENUM-V1; nested-struct → E-TABLEFOR-NESTED-STRUCT-NO-SLOT) → §41.16.6
- tableFor row binding inside `<column>` slot — explicit `:let={(row) => ...}` per §16.6 (OQ-TF-11 MEDIUM verdict; sub-debate optional if user contests implicit `@row` alternative) → §41.16.3
- tableFor v1.0 scope-OUT (filtering / pagination / auto-recurse nested struct / `@label`/`@column` annotations / positional column slots / row-click handlers / server-side sort-filter-pagination / CSS-shipped styling / `<actions>` named slot / `registerColumnRenderer` registry / implicit `@row` magic var) → §41.16.10
- schemaFor compiler-source impl (S104 — type-system walker + emit-schema-for.ts expander + 8 E-SCHEMAFOR-* codes wired) → compiler/src/type-system.ts (collectSchemaForImports + walkAndExpandSchemaForCalls + _processSchemaForCallInSchemaContext) + compiler/src/codegen/emit-schema-for.ts
- schemaFor function-call form `${ schemaFor(Users) }` inside `<schema>` (OQ-SCH-1 debate verdict Form B 50/60) → §41.15.1
- schemaFor `pick:`/`omit:` field-set transforms → §41.15.4
- schemaFor predicate → SQL CHECK lowering (per §39.5.8) → §41.15.5
- schemaFor enum-typed field lowering (`text req oneOf([variants...])`; OQ-SCH-12 load-bearing value-add) → §41.15.6 + §39.5.8 enum row
- schemaFor nested struct REJECTED v1.0 (`E-SCHEMAFOR-NESTED-STRUCT-NO-FK-V1`) → §41.15.7
- schemaFor v1.0 scope exclusions (`@table`/`@column` annotations / FK derivation / variant-payload enums / array-form / partial) → §41.15.8
- formFor markup-element form `<formFor for=Signup onsubmit=fn/>` → §41.14
- formFor slot-style per-field customization (OQ-FF-1 debate verdict 51.5/60) → §41.14.4
- formFor submit handler wiring + progressive-enhancement default (OQ-FF-2 debate verdict 52/60) → §41.14.3
- formFor `pick=` / `omit=` / `partial=true` field-set transforms → §41.14.5
- formFor `error-strategy=` per-field / summary / both → §41.14.6
- formFor label resolution layered chain (title-case + registerLabels + slot) → §41.14.7
- formFor nested-struct disposition (explicit slot required; auto-recurse v1.next) → §41.14.8
- formFor v1.0 scope exclusions (multi-step / read-only / `@label` annotation / per-type renderer registry) → §41.14.9
- not keyword / absence → §42 (18221-18532)
- compound is not / is some → §42.2.4 (~18346+)
- W-ABSENCE-IN-SCRML-SOURCE info lint (S89 regression-guard, companion to E-SYNTAX-042; covers BOTH null AND undefined absence tokens; renamed from W-NULL-IN-SCRML-SOURCE by S89-undefined-eradication-dispatch) → §34 + §42.1 (18228+) + §42.6 + §42.7 + §6.8.1 (4848+)
- defined values vs absence — `""` / `0` / `false` / `[]` / `{}` are NOT absence (S89-undefined-eradication user ruling) → §42.1.1 (18250+)
- wire format / `{"__scrml_absent": true}` envelope for `T | not` JSON payloads (S90 — M-7C-D-12 Track 4) → §57 (27050+)
- server-fn return wire format / `T | not` envelope encoding → §12.5.1 + §57 (27050+)
- decoder dual-decoder (envelope + raw JSON null) for v0.3..v0.x → §57.4 (S90)
- v1.0 clean break (canonical envelope only) → §57.5 (S90)
- DevTools / debugger experience — JS `null` bit-pattern surface for scrml `not` (S90 OQ-7) → §42.8 (~18545+)
- `default=not` canonical attribute-default absence form (S89) → §6.8.1 (4848+)
- nested program / workers → §43 (17034-17116)
- multi-database / ?{} adaptation → §44 (17117-17232)
- equality / == → §45 (17233-17294)
- worker lifecycle / when...from → §46 (17295-17341)
- output name encoding → §47 (17342-17863)
- auto-synthesized property encoding → §47 (17342-17863) + §47-Reviewed-for-v0.next note (D4)
- fn keyword / pure functions → §48 (17864-18524)
- fn mutual recursion / hoisting (S98, 2026-05-17) → §48.6.4 (~19805+) — `fn` declarations at file scope hoist per §6.9, mirroring `function`; mutual recursion supported without source-order constraints; `pinned fn` opt-out spec'd, parser-recognition implementation-pending
- pinned fn (opt-out of hoisting, implementation-pending) → §48.6.4 (~19805+) + §6.10 (4816+)
- while / do...while loops → §49 (18525-19219)
- assignment as expression → §50 (19220-19723)
- assign-as-expr × markup-as-value → §50.14 (19688+) (L1, D4)
- assign-as-expr × bare-form handlers → §50.15 (19707+) (L19, D4)
- state transitions / machine → §51 (19724-22026)
- §51.15 machine cross-check (S32) → §51 (~21482+)
- state authority / server @var → §52 (22027-22621)
- inline predicates / constraints → §53 (22622-23295)
- nested substates / state-local transitions → §54 (23296-23596)
- E-STATE-COMPLETE (S32) → §54.6 (~23472+)
- state-local transitions (S32) → §54.3 (~23358+)
- field narrowing on substates (S32) → §54.4 (~23438+)
- terminal states (S32) → §54.5 (~23455+)

<!-- Stage 0b D2.8 (2026-05-04) — v0.next additions -->
- Tier 0/1/2 ladder → §1.5 (145+) + §17.0 (8503+) + §18.0 (9232+) + §51.0 (~19734+)
- match block / `<match for=Type [on=expr]>` → §18.0.1 (~9257+)
- W-MATCH-RULE-INERT / E-MATCH-EFFECT-FORBIDDEN / E-MATCH-ONTRANSITION-FORBIDDEN → §18.0.2 (~9308+)
- E-MATCH-NOT-EXHAUSTIVE → §18.0.1 (~9299+)
- bare-variant inference (match arm patterns) → §18.0.3 (~9329+)
- E-VARIANT-AMBIGUOUS → §18.0.3 + §14.10
- engine declaration / `<engine for=Type initial=.X>` → §51.0.B (~19759+)
- engine state-child attribute surface (S98 normative-statements list — reserved attribute set `{rule, effect, history, internal:rule}` + payload-binding cross-ref) → §51.0.B
- engine payload binding on state-children (S98 — three forms: bare-attribute / named / parenthesized; positional + named semantics per §18.7; reserved-name precedence; unit-variant rejection; arity match) → §51.0.B.1
- payload-bearing engine state-child variants (S98 — `<OpenAt depth opener span rule=...>` canonical M1.x form; sister normative form to §18.0.1 match block-form) → §51.0.B.1
- E-ENGINE-PAYLOAD-ON-UNIT-VARIANT (S98 — payload binding attrs on a unit variant) → §51.0.B.1 + §34
- E-ENGINE-PAYLOAD-ARITY-MISMATCH (S98 — binding count != variant payload field count; attribute-list locus; §18.7 E-TYPE-021 remains for parenthesized form's arity/mixed-form per inheritance) → §51.0.B.1 + §34
- E-ENGINE-PAYLOAD-RESERVED-COLLISION (S98 — payload binding name shadows reserved state-child attribute) → §51.0.B.1 + §34
- engines as singleton → §51.0.A (~19734+)
- auto-declared engine variable → §51.0.C (~19804+)
- engine `var=` override → §51.0.C (~19826+)
- E-ENGINE-VAR-DUPLICATE → §51.0.C (~19836+)
- engine mount position (decl=mount; cross-file singleton) → §51.0.D (~19840+)
- engine `initial=` + W-ENGINE-INITIAL-MISSING → §51.0.E (~19888+)
- engine `rule=` contract (single/multi-target/wildcard) → §51.0.F (~19918+)
- E-ENGINE-INVALID-TRANSITION → §51.0.F (~19961+)
- idempotent self-write semantics (v0.3 Option-d, 2026-05-12 — self-writes to current variant are runtime no-ops, NOT rule= violations) → §51.0.F.1
- W-ENGINE-SELF-WRITE-DETECTED (v0.3 Option-d info lint — surfaces self-writes at compile time; STRICT inside-state-child + CONSERVATIVE outside-state-child fire conditions) → §51.0.F.1 + §34
- `.advance(.X)` engine method → §51.0.G (~19968+)
- engine `effect=` / `<onTransition>` (to/from/once/if=) → §51.0.H (~19996+)
- E-ENGINE-EFFECT-AMBIGUOUS → §51.0.H (~20021+)
- E-ONTRANSITION-NO-TARGET (S74 — A1b B17.3; `<onTransition>` with neither to= nor from=) → §51.0.H + §34
- `:`-shorthand for state-child body → §51.0.I (~20047+) + §4.14 (943+) (D4 universal grammar registration)
- derived engines / `derived=expr` (L20) → §51.0.J (~20067+)
- E-DERIVED-ENGINE-NO-RULES / -NO-INITIAL / -NO-WRITE / -INITIAL-ABSENT / -CIRCULAR → §51.0.J (~20098+)  (-INITIAL-ABSENT renamed S90 from -INITIAL-UNDEFINED per M-7C-D-12 Track 4 / OQ-6; line shifted +7 by §12.5.1 wire-format amendment)
- components vs engines (Move 20) / E-COMPONENT-ENGINE-SCOPE → §51.0.K (~20108+) + §15.13.5 (7960+) (D4)
- `<engine>` keyword; `<machine>` REMOVED before 1.0 (S305/S307 — `E-DEPRECATED-001`, Error; still PARSES per §63.5 for a single non-cascading diagnostic; `W-DEPRECATED-001` + `E-ENGINE-003` RETIRED) → §51.0.L (~20129+) + §63.7 + E-DEPRECATED-001 (§34)
- Machine Cohesion footnote (S67 — singleton invariant articulated; nested engines permitted in composite state-children) → §51.0.K
- `<onTimeout after= to=>` element (S67 — engine temporal surface; rides §51.12 runtime) → §51.0.M
- `history` attribute on composite state-children (S67 — Insight 23 #2; tree-shakeable synth cell; shallow-only) → §51.0.N + E-HISTORY-NO-INNER-ENGINE (§34)
- `.Variant.history` structured target form (S67 — for transitioning into history-restored composite state) → §51.0.N
- `internal:rule=` prefix on composite state-children (S67 — Insight 23 #4; preserves inner-engine lifecycle) → §51.0.O + E-INTERNAL-RULE-NOT-COMPOSITE (§34)
- nested `<engine>` declarations / composite state-children / hierarchy (S67 — Insight 23 #1) → §51.0.Q.1
- parent-rule cascade dispatch (S67 — Insight 23 #3; standard §51.0.F enforcement applied per variable from inside composite) → §51.0.Q.2
- cascade-miss diagnostic (S67 — extended E-ENGINE-INVALID-TRANSITION message; OQ-Harel-6) → §51.0.Q.3
- DD-Harel hierarchy interaction matrix (S67 — §51.4/§51.9/§51.11/§51.12/§51.14/§54 + .advance discipline) → §51.0.Q.4
- `<machine>` → `<engine>` cross-ref pointer (S67 — new code prefers `<engine>` + `<onTimeout>`) → §51.12 prologue
- computed-delay relaxation (S67 — `${expr}<unit>` form for both engine and machine temporal) → §51.12.3.1
- validators / req / is some / length / pattern / min / max / gt / gte / eq / oneOf → §55.1 (~23610+)
- validators on state cells (L4) → §55.2 (~23642+)
- validators on refinement types → §55.3 (~23675+) (cross-ref §53)
- validators on schema columns → §55.4 (~23702+) (cross-ref §39)
- auto-synthesized validity / isValid / errors / touched / submitted (compound) → §55.5 (~23731+)
- per-field validity surface → §55.6 (~23768+)
- synthesized-property semantics (read-only) → §55.7 (~23790+)
- E-SYNTHESIZED-WRITE → §55.7 + §34 + §6.11
- `<errors of=expr/>` first-class element (L13) → §55.8 (~23804+)
- ValidationError enum (L12) → §55.9 (~23858+)
- error message resolution / 4-level / messageFor → §55.10 (~23889+) + §41.12 (16698+) (D4)
- registerMessages / `scrml:data` → §41.12 (16698+) (L12, D4) + §55.10 (~23905+)
- cross-field validation (L14) → §55.11 (~23949+)
- E-VALIDATOR-CIRCULAR-DEP → §55.11 + §31.4 (D4) + §34
- multiple errors per field / short-circuit → §55.12 (~23977+)
- reset + validity surface → §55.13 (~23995+) (cross-ref §6.8)
- validators on engine state-cells / derived cells → §55.14 (~24010+)
- E-DERIVED-WITH-VALIDATORS → §55.14 + §34

<!-- Stage 0b D3 (2026-05-04) — channels + schema + predicates + `not` clarification -->
- channel file-level placement → §38.1 (~15191+)
- channel V5-strict body (auto-sync from placement) → §38.4 (~15298+)
- v1→v0.next channel migration note → §38.4.1 (~15347+)
- E-CHANNEL-INSIDE-PROGRAM → §38.1 + §34
- E-CHANNEL-SHARED-MODIFIER → §38.4 + §34
- schema additive shared-core vocabulary (req/length/pattern/min/max/...) → §39.5.7 (~16036+)
- schema lowering shared-core to SQL DDL → §39.5.8 (~16061+)
- schema SQL-mirror vs shared-core (when to use) → §39.5.9 (~16121+)
- refinement-type shared-core (cross-ref §55) → §53.6.1 (22975+)
- refinement-type + state-validator composition → §53.6.2 (23000+)
- `is some` vs `req` distinct predicates (L5) → §42.2.5 (~16842+)
- three loci of exists/required semantic → §42.2.5 (~16857+)

<!-- Stage 0b D4 (2026-05-04) — cleanup + structural elements + cross-refs -->
- `:`-shorthand body form (universal block-grammar) → §4.14 (943+)
- scrml-defined structural elements registry (`<engine>`/`<match>`/`<errors>`/`<onTransition>`) → §4.15 (986+) + §24.4 (13195+)
- M7 multi-close `<///>` negative-space (NOT scrml) → §4.16 (1014+)
- E-CLOSER-001 → §4.14 + §34
- E-NAME-COLLIDES-RESERVED → §4.15 + §24.4 + §34
- E-STRUCTURAL-ELEMENT-MISPLACED → §4.15 + §51.0.H + §55.8 + §34
- E-MULTI-STATEMENT-HANDLER → §5.2.3 + §4.14 + §34
- E-IMPORT-PINNED-INVALID → §21.8.1 + §34
- E-DERIVED-CIRCULAR-DEP → §31.5 + §34 (distinct from E-DERIVED-ENGINE-CIRCULAR)
- E-USE-INVALID-CTX → §41.12 + §34
- bare-form event handler bare-call / bare-assignment / bare-single-expression → §5.2.3 (1127+)
- bind dispatch by render-spec shape (text/textarea/select/checkbox/radio/file/component) → §5.4.1 (1318+)
- markup-as-expression under L1 pillar → §7.4.1 (5011+)
- V5-strict file-level scope + hoisting + pinned composition → §7.6.1 (5096+)
- logic-markup interleaving canonical form → §7.7 (5113+)
- lift under markup-as-value pillar (reframe) → §10.1.1 (5746+)
- RemoteData → engine recipe v0.next cross-ref → §13.5 (6329+)
- bare-variant inference (general expression positions) → §14.10 (7034+)
- positional binding for predefined-shape struct → §14.11 (7070+)
- components-vs-engines distinction (M20) → §15.13.5 (7960+)
- markup-as-value pillar reaffirmation for slots → §16 (8231+)
- cross-file engine import (M18) → §21.8 (11989+)
- pinned on imports → §21.8.1 (12034+)
- §22 metaprogramming v0.next reviewed → §22 (12060+)
- §28 lint suppression configs (v0.next) → §28 (13442+)
- validator predicate-arg dependency tracking (L14) → §31.4 (13546+)
- derived-state expression dependency tracking (L15, L20) → §31.5 (13574+)
- §47 output name encoding v0.next reviewed → §47 (17342+)
- registerMessages / scrml:data → §41.12 (16698+)
- §52 state authority v0.next reviewed → §52 (22027+)
- assignment-as-expression × markup-as-value (L1) → §50.14 (19688+)
- assignment-as-expression × bare-form handlers (L19) → §50.15 (19707+)
- scrml-native CSS model — predictable, cascade-free styling (flat specificity + `E-STYLE-CONFLICT`; bounded cascade; style-as-value; `<theme>`/`<defaults>`; Nominal/spec-ahead) → §65 (34896+)
- `E-STYLE-CONFLICT` flat-specificity conflict-checker + `:where()`-flat emission (codes NAMED; §34 rows land with impl, Rule 4) → §65.2 / §65.10
- style-as-value (`#{}` expression-position; `style=`-value overloading; ordered `style=[a,b]`; conditional `style:name=@cond`) → §65.4
- `<theme>` reactive theming — named-variant selector `<theme for=@cell>`; tokens lower to §25 `:root` custom properties → §65.6 / §65.3.2 / §25.7
- `<defaults>` app-wide bare-element defaults (locally overridable; `base` `@layer`) → §65.3.3
- fixed `@layer` order under the CSS model (utilities-LOW — a co-located scope rule beats a global utility) → §65.8 / §26.9
