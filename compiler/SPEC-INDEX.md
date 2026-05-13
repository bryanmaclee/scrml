# SPEC.md Section Index

> Auto-generated line numbers. Regenerate: `bun run scripts/regen-spec-index.ts` (in-tree TS regen; updates the Sections table line ranges + sizes in-place from SPEC.md headings, preserving summaries). The legacy `bash scripts/update-spec-index.sh` is a print-only helper that lists current heading line numbers.
> Last updated: 2026-05-11 (S81 — mechanical line-range refresh after S80/S81 SPEC growth: §39.2.1 cors-max-age amendment (F.1), §38.3.1 channel-reconnect amendment (F.2), prior S80 csrf/protect/auth edits. 62 rows refreshed in-place — every section row's `Lines` / `Size` columns now reflect current SPEC.md positions. Summaries unchanged.)
>
> Substantive content landings since the prior S58 line-range baseline:
> - S81 (`ab980c0` F.1+F.2): §39.2.1 amended — `<program cors-max-age=N>` override paragraph (default 86400); §38.3.1 NEW subsection — `<program channel-reconnect=N>` project-level default override; §38.3 attribute table cleanup (S80 stale `protect` row dropped, `auth` row added, `reconnect` row clarified with precedence note).
> - S78 audit fold-in (post-Phase-A10-SHIP, 2026-05-10): §4.15 + §24.4 +1 row each (`<onIdle>` — §51.0.R reference, S77 registry omission caught at S78 audit); §34 +20 rows: `I-MATCH-PROMOTABLE` (§56 cross-ref claim now true), `W-CG-001` (top-level statement suppression), `E-ERRORS-001/002` (`<errors>` element validation), `E-SWITCH-FORBIDDEN` (§17 — `switch` not in scrml vocabulary), W-LINT-001..008 + W-LINT-010..015 (14 ghost-pattern rows from `compiler/src/lint-ghost-patterns.js`).
> - S74 (A8 / A6-1, 2026-05-08): §19.12 +3 subsections (§19.12.6 `test-bind` declaration; §19.12.7 dispatch contract + 0-byte production guarantee + Position B forward-compat (S67-style, no flip-condition gating) + S67-style OQ deferral footnote; §19.12.8 worked example); §19.13 +1 row E-TEST-006; §47.5 +1 cross-reference paragraph (test-mode dispatch hook keys by §47-encoded names; dead-code-eliminated from release builds); §34 +1 row E-TEST-006. Spec-only landing — 0 compiler source changes (parser A6-2, typer A6-3, codegen A6-4, tests A6-5, scrml:test API alignment A6-6 are subsequent sub-steps). Authority: design-insight 22 + S67 user-direction methodology rule (flip conditions are NOT a feature-adoption gating mechanism).
> - S65 (`f963a75`): §41.13 `parseVariant` API entry; §53.14 type-as-argument primitives (L22 family — `parseVariant` shipped, `serialize`/`formFor`/`schemaFor`/`tableFor`/reflective metadata planned);
> - S66 (`I-MATCH-PROMOTABLE` Tier B SHIPPED): §56 NEW Promotion Ergonomics — fire conditions, three message shapes, `bun scrml promote` CLI, `--engine` Tier-1→2 sibling (deferred to Tier C); §34 +1 row I-MATCH-PROMOTABLE; §6.6.10 + §6.6.8 footnote convention precedent;
> - S68 (`1de05ef` — A5-1 spec amendments): §51.0.K Machine Cohesion footnote (singleton invariant articulated; nested engines permitted in composite state-children); §51.0.M `<onTimeout>` element; §51.0.N `history` attribute + `.Variant.history` structured target form (shallow-only); §51.0.O `internal:rule=` prefix; §51.0.P `parallel` attribute (struck 2026-05-08 — see [parallel-disposition deep-dive](../docs/deep-dives/parallel-attribute-disposition-2026-05-08.md); section number retired, gap §51.0.O → §51.0.Q intentional); §51.0.Q hierarchy / nested engines + parent-rule cascade dispatch; §51.12.3.1 computed-delay relaxation; §34 +2 codes E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE; §4.15 + §24.4 structural-elements registries updated for `<onTimeout>`;
> - S69 wrap (`f59bbcc`): §6.8.2 multi-level compound-nav clarification (B22) + §34 new row E-RESET-INVALID-TARGET (B22); A1b functionally COMPLETE (22/22 steps).
> - S78 (`spec-conformance-2026-05-10` §1.2 backfill — legacy prose-only catalog rows): §34 +88 catalog rows for legacy codes whose spec-body prose existed but `§34` row was absent (E-ATTR-013, E-DG-002, E-SQL-006/008, E-COMPONENT-013/014/020/021, W-COMPONENT-001, E-CTRL-001..005, E-MATCH-012, W-MATCH-003, E-IMPORT-005/006/007, E-META-002/003/005..008, E-LIFECYCLE-009/010/012/015/017/018, W-LIFECYCLE-002/007, E-LIN-005/006, E-INPUT-001..004, E-CHANNEL-008/EXPORT-001/002, E-MW-001/002/005/006, E-USE-001/002/005, E-EQ-001..004, W-EQ-001, E-CG-006/010/014, E-ENGINE-001/003..005/010/013..021, E-TIMEOUT-001/002, E-REPLAY-001..003, E-TYPE-041/042/045/071/081, E-PROTECT-003, E-SYNTAX-042..044, E-BATCH-001/002, W-BATCH-001). Companion to the earlier S78 fold-in (audit items 1+3); §1.2 backfill closes the remaining 88-row gap. E-MW-001/002/005/006 + I-MATCH-PROMOTABLE noted as already-present-via-earlier-S78-fold-in / un-fireable per the audit follow-up.
>
> Earlier S58 baseline (preserved for reference): Tier 8 small SPEC edits across §4 / §5 / §7 / §10 / §13 / §14 / §15 / §16 / §21 / §24 / §31 / §41 / §50; Tier 10 reviews (§22 / §28 / §47 / §52); Tier 9 §34 +7 error codes (E-CLOSER-001, E-NAME-COLLIDES-RESERVED, E-STRUCTURAL-ELEMENT-MISPLACED, E-MULTI-STATEMENT-HANDLER, E-IMPORT-PINNED-INVALID, E-DERIVED-CIRCULAR-DEP, E-USE-INVALID-CTX); Tier 11 PIPELINE.md v0.7.0 — per-stage v0.next addenda + Integration Failure Mode Catalog +11 v0.next entries.

Total lines: 26,286 | Total sections: 56 + appendices

> **Note on §49 heading format:** SPEC.md §49 uses a single `#` (H1) at line 19403 (`# §49. ...`) instead of the `## N.` pattern every other section uses. The in-tree `bun run /tmp/regen-spec-index.ts` regenerator handles this case explicitly via a `^# §<N>\.` regex branch; the legacy `bash scripts/update-spec-index.sh` print-only helper does NOT pick it up.

## Sections

| § | Section | Lines | Size | Summary |
|---|---------|-------|------|---------|
| — | Table of Contents | 20-102 | 83 | Section listing |
| 1 | Overview | 103-184 | 82 | Design principles, Bun runtime, markup-as-value (§1.4), north-star ladder (§1.5), V5-strict access (§1.6) |
| 2 | File Format and Compilation Model | 185-225 | 41 | Source files, output, entry point, perf target |
| 3 | Context Model | 226-285 | 60 | Contexts, stack rules, coercion, V5-strict access form per locus (§3.4) |
| 4 | Block Grammar | 286-1030 | 745 | Tags, states, closer forms, PA rules, keywords, angleDepth (PA-005). **D4 +3 subsections:** §4.14 `:`-shorthand body form (M15, L20); §4.15 scrml-defined structural elements registry (`<engine>`/`<match>`/`<errors>`/`<onTransition>`); §4.16 M7 multi-close `<///>` negative-space anchor. |
| 5 | Attribute Quoting Semantics | 1031-1679 | 649 | Three forms, bind:, dynamic class, event handler binding (§5.2.2). **D4 +2 subsections:** §5.2.3 bare-form event handler rule (L19, M11) — single-expression discipline + E-MULTI-STATEMENT-HANDLER; §5.4.1 bind-dispatch table by render-spec shape (L17). |
| 6 | Reactivity and the V5-Strict Access Model | 1680-5119 | 3440 | V5-strict two forms (§6.1), three RHS shapes (§6.2), compound state (§6.3), render-by-tag (§6.4), arrays (§6.5), derived+in-compound (§6.6+§6.6.16-17), lifecycle (§6.7), default+reset (§6.8), hoisting (§6.9), pinned (§6.10), validity stub (§6.11), §11 inheritance (§6.12). **S69 amendment (2026-05-08):** §6.8.2 normatively allows multi-level compound-nav targets in `reset(@a.b.c.d)` (B22). |
| 7 | Logic Contexts | 5120-5359 | 240 | `{}` syntax, function forms, markup-as-expr, type annotations, file-level scope (§7.6). **D4 +3 subsections:** §7.4.1 markup-as-expression under markup-as-value pillar (L1); §7.6.1 file-level scope under V5-strict + hoisting + `pinned` (M11); §7.7 logic-markup interleaving (M8). |
| 8 | SQL Contexts | 5360-5921 | 562 | `?{}` syntax, bound params, chaining, WHERE, INSERT/UPDATE/DELETE, **§8.9 per-handler coalescing, §8.10 N+1 loop hoist, §8.11 mount hydration** |
| 9 | CSS Contexts | 5922-5964 | 43 | Inline CSS (§9.1), style block, CSS files |
| 10 | The `lift` Keyword | 5965-6358 | 394 | Semantics, coercion, syntax forms, ordering, value-lift, accumulation (§10.8). **D4 +1 subsection:** §10.1.1 lift under markup-as-value pillar (L1 reframe). |
| 11 | State Objects and `protect=` (Reserved — Folded) | 6359-6380 | 22 | Content distributed: state declarations → §6; protect=, schema, authority → §52 |
| 12 | Route Inference | 6381-6478 | 98 | Default placement, escalation triggers, generated infra, server return (§12.5) |
| 13 | Async Model | 6479-6749 | 271 | Developer-visible syntax, compiler-managed async, RemoteData enum (§13.5). **D4:** §13.5 v0.next cross-ref to engine recipe (Tier 2 idiom for state-driven loading). **S89 (§13.2 Sub-Phase A):** §13.1 stdlib carve-out paragraph (Q5); §13.2.1 NEW auto-await for statically-known Promise<T> callees (Q1 BROAD — extends auto-await to ~40 stdlib surfaces + cross-program); §13.2.2 NEW cross-program calls & E-PROG-004 amendment (Q2 Position C — Error → Info, not retired). |
| 14 | Type System | 6750-7353 | 604 | Structs (§14.3.2 enum fields), enums, pattern matching, asIs, schema types, snippet type. **D4 +2 subsections:** §14.10 bare-variant inference (M9); §14.11 positional binding for predefined-shape compound state (M10). |
| 15 | Component System | 7354-8467 | 1114 | Definition, props, shapes, slots, callbacks, rendering syntax, reactive scope (§15.13). **D4 +2 subsections:** §15.13.5 components-stay-distinct-from-engines (M20, E-COMPONENT-ENGINE-SCOPE); §15.13.6 component reactive scope under V5-strict. |
| 16 | Component Slots | 8468-8737 | 270 | Named slots, unnamed children, fill syntax, render validation. **D4:** §16 markup-as-value pillar (L1) reaffirmation note for slots. |
| 17 | Control Flow | 8738-9458 | 721 | **§17.0 Tier ladder (S57 D2.8)**: Tier 0 (`if=`) + cross-refs to §18 / §51 + W-LIFECYCLE-CANDIDATE; if=, show=, lifecycle, iteration, overloading, if-as-expression (§17.6). **S64 (2026-05-06):** §17.5 amended — function-overload retired (debate-02 verdict); component-overload closed-without-resolution (debate-03 verdict, SPEC-ISSUE-010-COMPONENT closed); trio (`match`/`engine`/derived) named as canonical replacement. |
| 18 | Pattern Matching and Enums | 9459-10734 | 1276 | **§18.0 (S57 D2.8)**: two match shapes — block-form `<match for=Type>` (Tier 1, §18.0.1) + JS-style; §18.0.2 attribute legality (rule= inert, effect=/onTransition forbidden); §18.0.3 bare-variant inference; existing JS-style match content preserved (§18.1+) |
| 19 | Error Handling (Revised) | 10735-11877 | 1143 | Renderable enum variants, fail, ?, !, errorBoundary, renders clause, **§19.10.5 implicit per-handler tx**. **S74 A8/A6-1 (2026-05-08):** §19.12 extended with `test-bind` declaration form — §19.12.6 surface syntax + scope + explicit-unchanged claims (E-TEST-004 / E-FN-004 / Insight 21); §19.12.7 dispatch contract + 0-byte production guarantee + Position B forward-compat (S67-style, no flip-condition gating) + S67-style OQ deferral footnote (OQ-8b / OQ-test-bind-concurrency / OQ-test-bind-passthrough / OQ-audit-log-compose); §19.12.8 worked example. §19.13 +1 row E-TEST-006 (fail-fast unbound server-fn in active test-bind context). |
| A | Appendix A: Interaction Matrix | 11878-11896 | 19 | Error system feature interactions |
| B | Appendix B: Superseded Spec Text | 11897-11905 | 9 | What §19 replaced |
| C | Appendix C: Future Considerations | 11906-11914 | 9 | Error composition, retry, telemetry, async errors |
| D | Appendix D: JS Standard Library | 11915-11935 | 21 | JS stdlib access in logic contexts |
| E | Appendix E: `</>` Closer Migration | 11936-11970 | 35 | Migration guide for `/` → `</>` |
| 20 | Navigation API | 11971-12142 | 172 | navigate(), route params, session context |
| 21 | Module and Import System | 12143-12578 | 436 | Export/import syntax (incl. §21.2 Form 1 / Form 2 — P2 2026-04-30), re-export, pure-type files. **D4 +1 subsection:** §21.8 cross-file engine import (M18) + §21.8.1 `pinned` on imports. |
| 22 | Metaprogramming | 12579-13246 | 668 | `^{}` meta context, compile-time/runtime meta, Option D scope model. **D4:** Reviewed-for-v0.next note at section start — markup-as-value pillar reinforces splicing; no spec changes required. |
| 23 | Foreign Code Contexts (`_{}`) | 13247-13689 | 443 | Level-marked braces, opaque passthrough, WASM sigils, sidecars |
| 24 | HTML Spec Awareness | 13690-13748 | 59 | Element registry, shape constraints. **D4 +1 subsection:** §24.4 scrml-defined structural elements (NOT HTML — `<engine>`/`<match>`/`<errors>`/`<onTransition>`/`<onTimeout>` per S68 A5-1). |
| 25 | CSS Variable Syntax | 13749-13847 | 99 | Defining/using vars, hyphenated names, scoping |
| 26 | Tailwind Utility Classes | 13848-13938 | 91 | Integration model; **§26.3 Variant Prefixes (S49)** with W-TAILWIND-001 emission rule; **§26.4 Arbitrary Values (S49 NEW)** with §26.4.1 validation + §26.4.2 cross-feature; **§26.5 Open Items (S49)** group-*/peer-*/custom-theme deferred |
| 27 | Comment Syntax | 13939-13959 | 21 | Universal `//`, per-context native comments |
| 28 | Compiler Settings | 13960-14001 | 42 | html-content-model setting. **D4:** Reviewed-for-v0.next note + 4 new lint-suppression configs (`lint.lifecycle-candidate`, `lint.match-rule-inert`, `lint.engine-initial-missing`, `lint.deprecated-machine`). |
| 29 | Vanilla File Interop | 14002-14010 | 9 | Plain JS/CSS/HTML interop |
| 30 | Compile-Time Eval — `bun.eval()` | 14011-14041 | 31 | Scope, markup interpolation, security |
| 31 | Dependency Graph | 14042-14114 | 73 | Purpose, construction, route analysis. **D4 +2 subsections:** §31.4 validator predicate-arg dependency tracking (L14); §31.5 derived-state expression dependency tracking (L15, L20). |
| 32 | The `~` Keyword | 14115-14326 | 212 | Pipeline accumulator, lin variable, context boundary |
| 33 | The `pure` Keyword | 14327-14391 | 65 | Purity constraints, **§33.6 fn ≡ pure function (S32)**, W-PURE-REDUNDANT |
| 34 | Error Codes | 14420-14928 | 509 | All error code definitions. **S89 +2:** W-TRY-CATCH-IN-SCRML-SOURCE (Phase 3a regression guard, §19.1); W-INPUT-001 (mouse-target null-at-mount static-reachability lint, §36.7.1 OQ-A γ). **S74 A1b B17.3 +1:** E-ONTRANSITION-NO-TARGET (`<onTransition>` with neither `to=` nor `from=`). **S74 A8/A6-1 +1:** E-TEST-006 (fail-fast unbound server-fn in active test-bind context, §19.12.7; design-insight 22). **S69 +1:** E-RESET-INVALID-TARGET (B22). **S68 A5-1 +2:** E-HISTORY-NO-INNER-ENGINE, E-INTERNAL-RULE-NOT-COMPOSITE. **S66 +1:** I-MATCH-PROMOTABLE info-level lint (Promotion Ergonomics §56). **S65 +4:** E-PARSEVARIANT-* (parseVariant, §41.13). **D4 (2026-05-04) +7:** E-CLOSER-001, E-NAME-COLLIDES-RESERVED, E-STRUCTURAL-ELEMENT-MISPLACED, E-MULTI-STATEMENT-HANDLER, E-IMPORT-PINNED-INVALID, E-DERIVED-CIRCULAR-DEP, E-USE-INVALID-CTX. **D3 +2:** E-CHANNEL-INSIDE-PROGRAM, E-CHANNEL-SHARED-MODIFIER. **D2.8 +17:** match/engine/derived-engine/component-engine-scope/validator-circular/derived-with-validators. |
| 35 | Linear Types — `lin` | 14899-15360 | 462 | Declaration (exactly-once + restricted intermediate visibility), consumption, control flow, closures, lin function params (§35.2.1), cross-`${}` block lin (§35.2.2), E-LIN-005 shadowing + E-LIN-006 deferred-ctx (§35.5) |
| 36 | Input State Types | 15391-15897 | 507 | `<keyboard>`, `<mouse>`, `<gamepad>`. **S89 §36 impl Phase 1 (2026-05-13):** §36.5.1 nested-scope cleanup boundary (OQ-B α — cleanup fires at immediately enclosing scope); §36.5.2 SSR / server-side emission client-only normative (OQ-input-3 — SHALL NOT emit input-state runtime helpers into server JS); §36.6 `_clearFrameState()` SHOULD-level discipline for frame-loop consumers (OQ-E α); §36.7.1 `<mouse target=@el/>` null-at-mount silent fallback + W-INPUT-001 info lint (OQ-A γ — replaces proposed E-INPUT-006). |
| 37 | Server-Sent Events | 15719-15960 | 242 | `server function*` SSE generators |
| 38 | WebSocket Channels | 15961-16706 | 746 | **D3 MAJOR REWRITE (M19, 2026-05-04).** `<channel>` at FILE LEVEL (sibling of `<program>`, not child); `@shared` modifier REMOVED — auto-sync from being declared in channel body; V5-strict body (`<x> = init` declares; `@x` reads/writes); §38.1 file-level placement, §38.4 V5-strict reactive sync, §38.4.1 v1→v0.next migration; broadcast/disconnect/onserver:*/onclient:* preserved; cross-file inline expansion (§38.12) updated. E-CHANNEL-002 retired; E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER added (§34). |
| 39 | Schema and Migrations | 16707-17104 | 398 | `< schema>`, column types, migration diff. **D3 (L4, 2026-05-04) +3 subsections:** §39.5.7 additive shared-core validator vocabulary (`req`/`length`/`pattern`/`min`/`max`/`gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn`); §39.5.8 lowering to standard SQL DDL (`CHECK`, `NOT NULL`); §39.5.9 when-to-use SQL-mirror vs shared-core. SQL-mirror remains canonical; shared-core is purely additive. |
| 40 | Middleware and Request Pipeline | 17105-17863 | 759 | Auto middleware, handle() escape hatch. **+ §40.7 documentary attributes** (`title`/`description`/`version`/`author`/`license` on `<program>`; HTML head metadata; W-PROGRAM-TITLE-NESTED on nested `<program>` blocks; landed S59 `4620290`). |
| 41 | Import System — `use`/`import` | 17864-18184 | 321 | Capability imports, value imports, vendoring. **D4 +1 subsection:** §41.12 `scrml:data` `registerMessages` — project-level error message registration (L12). **S65 +1 subsection:** §41.13 `scrml:data` `parseVariant(json, EnumType)` — boundary-parsing primitive for tagged-variant JSON; FIRST general-position type-as-argument family member (L22); failure type `ParseError:enum` with `MissingDiscriminator`/`UnknownVariant`/`InvalidPayload`/`Malformed`. **S89 +1 subsection:** §41.4.1 stdlib API authoring rule — Promise<T> returns SHALL always be Promise<T> (no conditional union with bare value); Q6 ratified — supports the §13.2.1 auto-await classifier static-decidability invariant. |
| 42 | `not` — Unified Absence Value | 18185-18475 | 291 | `not` keyword, `is not`, `is some`, `given x =>`, `T | not`, compound exprs (§42.2.4). **D3 (L5, 2026-05-04) +1 subsection:** §42.2.5 `is some` vs `req` are distinct predicates — `is some` checks existence (`""` IS some), `req` checks meaningful value (`""` fails req); three native loci of "exists/required" semantic. |
| 43 | Nested `<program>` | 18476-18558 | 83 | Execution contexts, shared-nothing, lifecycle, RPC |
| 44 | `?{}` Multi-Database Adaptation | 18559-18674 | 116 | Bun.SQL target, driver resolution, `.get()` → `T | not`; **§44.8 bracket-matched `?{` scanner (F-SQL-001)** + E-SQL-008 hard-error |
| 45 | Equality Semantics | 18675-18736 | 62 | Single `==`, no `===`, structural, compiler-derived |
| 46 | Worker Lifecycle | 18737-18783 | 47 | `when ... from <#name>`, supervision attrs |
| 47 | Output Name Encoding | 18784-19323 | 540 | Encoded JS variable names, kind prefixes, hash scheme. **D4:** Reviewed-for-v0.next note — synthesised validity props, auto-declared engine vars, derived engines all ride existing kind markers (`p`/`a`/`t`); no new kind markers required. **S74 A8/A6-1 (2026-05-08):** §47.5 +1 cross-reference paragraph — test-mode `test-bind` dispatch hook (§19.12.6 / §19.12.7) keys its scope-local dispatch table by §47-encoded names; no new naming scheme; dead-code-eliminated from release builds. |
| 48 | The `fn` Keyword | 19324-19976 | 653 | Body prohibitions, return-site completeness, lift in fn, calling conventions; **S32: Layer 2 retired, §54 cross-ref** |
| 49 | `while` and `do...while` Loops | 19977-20679 | 703 | Grammar, break/continue, labels, lift in loops, E-LOOP errors (heading uses H1, not H2) |
| 50 | Assignment as Expression | 20680-21183 | 504 | Assign-expr syntax, semantics, type rules, fn interaction. **D4 +2 subsections:** §50.14 composition with markup-as-value pillar (L1); §50.15 composition with bare-form event handlers (L19). |
| 51 | State Transition Rules / `< machine>` / `<engine>` | 21184-24306 | 3123 | **§51.0 (S57 D2.8) — engines as Tier 2**: §51.0.A overview/singleton; §51.0.B declaration syntax; §51.0.C auto-declared variable + var=; §51.0.D mount position (decl=mount; cross-file singleton); §51.0.E initial= + W-ENGINE-INITIAL-MISSING; §51.0.F rule= contract (compile-time + runtime) + §51.0.F.1 idempotent self-write semantics (v0.3 Option-d, 2026-05-12 — self-writes are no-ops, NOT rule= violations; W-ENGINE-SELF-WRITE-DETECTED info lint surfaces the no-op at compile time); §51.0.G .advance() loud; §51.0.H effect= / <onTransition> (to/from/once/if=); §51.0.I :-shorthand; §51.0.J derived engines (L20); §51.0.K components vs engines (Move 20, E-COMPONENT-ENGINE-SCOPE) + S67 Machine Cohesion footnote; §51.0.L relationship to legacy §51.1+. **S67 amendments LANDED S68 `1de05ef`:** §51.0.M `<onTimeout>` element (Item C — Candidate C; engine temporal surface; rides §51.12 runtime); §51.0.N `history` attribute on composite state-children (Insight 23 #2; tree-shakeable synth cell `@_<outerVar>_<variant>_history`; shallow-only this revision; `.Variant.history` structured target form); §51.0.O `internal:rule=` prefix (Insight 23 #4; preserves inner-engine lifecycle on internal transitions); ~~§51.0.P `parallel` attribute~~ (S68 ratification STRUCK 2026-05-08 per [parallel-disposition deep-dive](../docs/deep-dives/parallel-attribute-disposition-2026-05-08.md) — synonym-test failure conceded by spec text; section number retired, gap §51.0.O → §51.0.Q intentional); §51.0.Q hierarchy / nested `<engine>` declarations + parent-rule cascade dispatch (Insight 23 #1 + #3; composite state-children; OQ-Harel-1..7 bundled). +2 new error codes: E-HISTORY-NO-INNER-ENGINE, E-INTERNAL-RULE-NOT-COMPOSITE. §51.12.3.1 computed-delay relaxation (S67 — applies to both engine and machine forms). Legacy `<machine>` content preserved §51.1-§51.16. |
| 52 | State Authority Declarations | 24307-24909 | 603 | Two-tier authority, server @var, sync infrastructure. **D4:** Reviewed-for-v0.next note — V5-strict access composes; auto-synth validity surface synthesises regardless of authority; channels are not §52 authority. |
| 53 | Inline Type Predicates | 24910-25970 | 1061 | Value constraints, SPARK zones, named shapes, bind:value HTML attrs. **D3 (L4, 2026-05-04) +2 subsections:** §53.6.1 shared-core vocabulary in refinement-type position (cross-ref §55.1 for the universal-core predicate listing); §53.6.2 composition with state-cell validators (type predicate + `req` stack as independent enforcement layers). **S65 +1 subsection:** §53.14 type-as-argument primitives (L22 family; §53.14.1 motivation type-establishment vs predicate-enforcement; §53.14.2 `reflect(TypeName)` meta-block precedent; §53.14.3 family roster — `parseVariant` shipped, `serialize`/`formFor`/`schemaFor`/`tableFor` planned; §53.14.4 discipline; §53.14.5 compile-time recognition; §53.14.6 stdlib-declared types). |
| 54 | Nested Substates and State-Local Transitions | 25971-26271 | 301 | **S32 (2026-04-20).** Nested substate grammar (§54.2), state-local transitions (§54.3), field narrowing (§54.4), terminal states (§54.5), 4 new error codes (§54.6), interaction matrix (§54.7). Companion to §51.15 cross-check. **S57 D2.8 composition note**: §54 composes uniformly with §51.0 engine state-children. |
| 55 | Validators and the Auto-Synthesized Validity Surface | 26272-26759 | 488 | **NEW S57 D2.8.** §55.1 universal-core vocabulary (req, length, pattern, min/max, gt/lt/gte/lte, eq/neq, oneOf/notIn — L4); §55.2 state-cell validators; §55.3 refinement-type validators (cross-ref §53); §55.4 schema-column validators (cross-ref §39); §55.5/§55.6 auto-synth validity surface compound + per-field (L11) — isValid/errors/touched/submitted; §55.7 synthesized-property semantics (read-only); §55.8 `<errors of=expr/>` first-class element (L13); §55.9 ValidationError enum (L12); §55.10 4-level message resolution chain (L12); §55.11 cross-field via predicate args (L14); §55.12 multi-errors / short-circuit; §55.13 reset interaction (cross-ref §6.8); §55.14 engine + derived cells; §55.15 cross-refs + error-code listing. |
| 56 | Promotion Ergonomics — `I-MATCH-PROMOTABLE` and `bun scrml promote` | 26760-26943 | 184 | **NEW S66 — Tier B SHIPPED 2026-05-07.** §56.1 motivation; §56.2 fire conditions for `I-MATCH-PROMOTABLE` info-level lint; §56.3 three message shapes (exhaustive / near-miss / compound); §56.4 compound-condition advisory; §56.5 `bun scrml promote --match` CLI subcommand (per-branch rewrite rule, idempotent, `--dry-run`); §56.6 `--engine` Tier 1→2 sibling (deferred to Tier C — needs W-MATCH-TRANSITIONS-ACCRUING groundwork); §56.7 tooling integration; §56.8 cross-references. Predicate matrix supports both `if (@cell is .Variant)` AND `if (@cell == .Variant)` per S66 narrowing reversal. |

## Quick Lookup: Topic → Section

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
- HTML elements → §24 (13171-13223)
- scrml-defined structural elements (NOT HTML) → §24.4 (13195+) (D4)
- CSS variables → §25 (13224-13322)
- comments → §27 (13421-13441)
- compiler settings → §28 (13442-13483)
- lint suppression configs (v0.next) → §28 (13442-13483) (D4)
- bun.eval() → §30 (13493-13523)
- dependency graph → §31 (13524-13596)
- validator predicate-arg dependency tracking → §31.4 (13546+) (L14, D4)
- derived-state expression dependency tracking → §31.5 (13574+) (L15, L20, D4)
- tilde / ~ → §32 (13597-13808)
- pure → §33 (13809-13873)
- error codes → §34 (13874-14126)
- linear types / lin → §35 (14127-14588)
- lin function params → §35.2.1 (~14127+)
- keyboard / mouse / gamepad → §36 (15391-15897)
- SSE / server function* → §37 (14947-15188)
- WebSocket / channel → §38 (15189-15898)
- schema / migrations → §39 (15899-16268)
- middleware / handle() → §40 (16269-16492)
- `<program>` documentary attributes / HTML head metadata → §40.7 (Phase A1a, 2026-05-05)
- use / import system → §41 (16493-16742)
- registerMessages / scrml:data → §41.12 (16698+) (L12, D4)
- not keyword / absence → §42 (16743-17033)
- compound is not / is some → §42.2.4 (~16753+)
- nested program / workers → §43 (17034-17116)
- multi-database / ?{} adaptation → §44 (17117-17232)
- equality / == → §45 (17233-17294)
- worker lifecycle / when...from → §46 (17295-17341)
- output name encoding → §47 (17342-17863)
- auto-synthesized property encoding → §47 (17342-17863) + §47-Reviewed-for-v0.next note (D4)
- fn keyword / pure functions → §48 (17864-18524)
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
- E-DERIVED-ENGINE-NO-RULES / -NO-INITIAL / -NO-WRITE / -INITIAL-UNDEFINED / -CIRCULAR → §51.0.J (~20091+)
- components vs engines (Move 20) / E-COMPONENT-ENGINE-SCOPE → §51.0.K (~20108+) + §15.13.5 (7960+) (D4)
- `<engine>` keyword vs legacy `<machine>` deprecation → §51.0.L (~20129+) + W-DEPRECATED-001 (§34)
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
