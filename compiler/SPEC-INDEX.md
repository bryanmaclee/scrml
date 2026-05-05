# SPEC.md Section Index

> Auto-generated line numbers. Regenerate: `bash scripts/update-spec-index.sh`
> Last updated: 2026-05-04 (S57 Stage 0b D3 — channels + schema + predicates + `not`):
> §38 MAJOR REWRITE (M19) — channels at file level, drop `@shared`, V5-strict body,
> §38.4.1 v1→v0.next migration note, E-CHANNEL-002 retired in §38.9 + §34;
> §39.5.7-§39.5.9 NEW (L4) — additive shared-core validator vocabulary in schema columns,
> SQL DDL lowering rules, when-to-use guidance;
> §53.6.1-§53.6.2 NEW (L4) — shared-core in refinement-type position, composition with
> state-cell validators (cross-ref §55);
> §42.2.5 NEW (L5) — `is some` vs `req` distinct predicates, three loci of
> exists/required semantic;
> §34 +2 error codes (E-CHANNEL-INSIDE-PROGRAM, E-CHANNEL-SHARED-MODIFIER).
> Carries forward D2.8 line numbers below; section line numbers updated post-D3.

Total lines: 23,692 | Total sections: 55 + appendices

> **Note on §49 heading format:** SPEC.md §49 uses a single `#` (H1) at line 15800 instead of the `## N.` pattern every other section uses. The regenerator script will not pick it up automatically — keep this in mind when running the script.

## Sections

| § | Section | Lines | Size | Summary |
|---|---------|-------|------|---------|
| — | Table of Contents | 23-105 | 83 | Section listing |
| 1 | Overview | 106-187 | 82 | Design principles, Bun runtime, markup-as-value (§1.4), north-star ladder (§1.5), V5-strict access (§1.6) |
| 2 | File Format and Compilation Model | 126-166 | 41 | Source files, output, entry point, perf target |
| 3 | Context Model | 229-288 | 60 | Contexts, stack rules, coercion, V5-strict access form per locus (§3.4) |
| 4 | Block Grammar | 207-856 | 650 | Tags, states, closer forms, PA rules, keywords, angleDepth (PA-005) |
| 5 | Attribute Quoting Semantics | 857-1374 | 518 | Three forms, bind:, dynamic class, event handler binding (§5.2.2) |
| 6 | Reactivity and the V5-Strict Access Model | 1463-4697 | 3235 | V5-strict two forms (§6.1), three RHS shapes (§6.2), compound state (§6.3), render-by-tag (§6.4), arrays (§6.5), derived+in-compound (§6.6+§6.6.16-17), lifecycle (§6.7), default+reset (§6.8), hoisting (§6.9), pinned (§6.10), validity stub (§6.11), §11 inheritance (§6.12) |
| 7 | Logic Contexts | 4187-4360 | 174 | `{}` syntax, function forms, markup-as-expr, type annotations, file-level scope (§7.6) |
| 8 | SQL Contexts | 4361-4907 | 547 | `?{}` syntax, bound params, chaining, WHERE, INSERT/UPDATE/DELETE, **§8.9 per-handler coalescing, §8.10 N+1 loop hoist, §8.11 mount hydration** |
| 9 | CSS Contexts | 4908-4950 | 43 | Inline CSS (§9.1), style block, CSS files |
| 10 | The `lift` Keyword | 4951-5329 | 379 | Semantics, coercion, syntax forms, ordering, value-lift, accumulation (§10.8) |
| 11 | State Objects and `protect=` (Reserved — Folded) | 5831-5852 | 22 | Content distributed: state declarations → §6; protect=, schema, authority → §52 |
| 12 | Route Inference | 5474-5560 | 87 | Default placement, escalation triggers, generated infra, server return (§12.5) |
| 13 | Async Model | 5561-5829 | 269 | Developer-visible syntax, compiler-managed async, RemoteData enum (§13.5) |
| 14 | Type System | 5830-6352 | 523 | Structs (§14.3.2 enum fields), enums, pattern matching, asIs, schema types, snippet type |
| 15 | Component System | 6353-7083 | 731 | Definition, props, shapes, slots, callbacks, rendering syntax, reactive scope (§15.13) |
| 16 | Component Slots | 7084-7351 | 268 | Named slots, unnamed children, fill syntax, render validation |
| 17 | Control Flow | 8072-8781 | 710 | **§17.0 Tier ladder (S57 D2.8)**: Tier 0 (`if=`) + cross-refs to §18 / §51 + W-LIFECYCLE-CANDIDATE; if=, show=, lifecycle, iteration, overloading, if-as-expression (§17.6) |
| 18 | Pattern Matching and Enums | 8782-10057 | 1276 | **§18.0 (S57 D2.8)**: two match shapes — block-form `<match for=Type>` (Tier 1, §18.0.1) + JS-style; §18.0.2 attribute legality (rule= inert, effect=/onTransition forbidden); §18.0.3 bare-variant inference; existing JS-style match content preserved (§18.1+) |
| 19 | Error Handling (Revised) | 9160-10031 | 872 | Renderable enum variants, fail, ?, !, errorBoundary, renders clause, **§19.10.5 implicit per-handler tx** |
| A | Appendix A: Interaction Matrix | 10032-10050 | 19 | Error system feature interactions |
| B | Appendix B: Superseded Spec Text | 10051-10059 | 9 | What §19 replaced |
| C | Appendix C: Future Considerations | 10060-10068 | 9 | Error composition, retry, telemetry, async errors |
| D | Appendix D: JS Standard Library | 10069-10089 | 21 | JS stdlib access in logic contexts |
| E | Appendix E: `</>` Closer Migration | 10090-10124 | 35 | Migration guide for `/` → `</>` |
| 20 | Navigation API | 10125-10296 | 172 | navigate(), route params, session context |
| 21 | Module and Import System | 10505-10770 | 266 | Export/import syntax (incl. §21.2 Form 1 / Form 2 — P2 2026-04-30), re-export, pure-type files |
| 22 | Metaprogramming | 10408-11061 | 654 | `^{}` meta context, compile-time/runtime meta, Option D scope model |
| 23 | Foreign Code Contexts (`_{}`) | 11062-11504 | 443 | Level-marked braces, opaque passthrough, WASM sigils, sidecars |
| 24 | HTML Spec Awareness | 11505-11530 | 26 | Element registry, shape constraints |
| 25 | CSS Variable Syntax | 11531-11629 | 99 | Defining/using vars, hyphenated names, scoping |
| 26 | Tailwind Utility Classes | 11630-11721 | 92 | Integration model; **§26.3 Variant Prefixes (S49)** with W-TAILWIND-001 emission rule; **§26.4 Arbitrary Values (S49 NEW)** with §26.4.1 validation + §26.4.2 cross-feature; **§26.5 Open Items (S49)** group-*/peer-*/custom-theme deferred |
| 27 | Comment Syntax | 11722-11742 | 21 | Universal `//`, per-context native comments |
| 28 | Compiler Settings | 11672-11707 | 36 | html-content-model setting |
| 29 | Vanilla File Interop | 11708-11716 | 9 | Plain JS/CSS/HTML interop |
| 30 | Compile-Time Eval — `bun.eval()` | 11717-11747 | 31 | Scope, markup interpolation, security |
| 31 | Dependency Graph | 11748-11771 | 24 | Purpose, construction, route analysis |
| 32 | The `~` Keyword | 11772-11983 | 212 | Pipeline accumulator, lin variable, context boundary |
| 33 | The `pure` Keyword | 11984-12048 | 65 | Purity constraints, **§33.6 fn ≡ pure function (S32)**, W-PURE-REDUNDANT |
| 34 | Error Codes | 13290-13535 | 246 | All error code definitions. **D3 (2026-05-04) +2:** E-CHANNEL-INSIDE-PROGRAM, E-CHANNEL-SHARED-MODIFIER; E-CHANNEL-002 retired (replaced by E-CHANNEL-SHARED-MODIFIER). **D2.8 (2026-05-04) +17:** match/engine/derived-engine/component-engine-scope/validator-circular/derived-with-validators. |
| 35 | Linear Types — `lin` | 12252-12713 | 462 | Declaration (exactly-once + restricted intermediate visibility), consumption, control flow, closures, lin function params (§35.2.1), cross-`${}` block lin (§35.2.2), E-LIN-005 shadowing + E-LIN-006 deferred-ctx (§35.5) |
| 36 | Input State Types | 12714-13071 | 358 | `<keyboard>`, `<mouse>`, `<gamepad>` |
| 37 | Server-Sent Events | 13072-13313 | 242 | `server function*` SSE generators |
| 38 | WebSocket Channels | 14598-15307 | 710 | **D3 MAJOR REWRITE (M19, 2026-05-04).** `<channel>` at FILE LEVEL (sibling of `<program>`, not child); `@shared` modifier REMOVED — auto-sync from being declared in channel body; V5-strict body (`<x> = init` declares; `@x` reads/writes); §38.1 file-level placement, §38.4 V5-strict reactive sync, §38.4.1 v1→v0.next migration; broadcast/disconnect/onserver:*/onclient:* preserved; cross-file inline expansion (§38.12) updated. E-CHANNEL-002 retired; E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER added (§34). |
| 39 | Schema and Migrations | 15308-15677 | 370 | `< schema>`, column types, migration diff. **D3 (L4, 2026-05-04) +3 subsections:** §39.5.7 additive shared-core validator vocabulary (`req`/`length`/`pattern`/`min`/`max`/`gt`/`lt`/`gte`/`lte`/`eq`/`neq`/`oneOf`/`notIn`); §39.5.8 lowering to standard SQL DDL (`CHECK`, `NOT NULL`); §39.5.9 when-to-use SQL-mirror vs shared-core. SQL-mirror remains canonical; shared-core is purely additive. |
| 40 | Middleware and Request Pipeline | 13896-14119 | 224 | Auto middleware, handle() escape hatch |
| 41 | Import System — `use`/`import` | 14120-14326 | 207 | Capability imports, value imports, vendoring |
| 42 | `not` — Unified Absence Value | 16109-16399 | 291 | `not` keyword, `is not`, `is some`, `given x =>`, `T | not`, compound exprs (§42.2.4). **D3 (L5, 2026-05-04) +1 subsection:** §42.2.5 `is some` vs `req` are distinct predicates — `is some` checks existence (`""` IS some), `req` checks meaningful value (`""` fails req); three native loci of "exists/required" semantic. |
| 43 | Nested `<program>` | 14559-14641 | 83 | Execution contexts, shared-nothing, lifecycle, RPC |
| 44 | `?{}` Multi-Database Adaptation | 14969-15055 | 87 | Bun.SQL target, driver resolution, `.get()` → `T | not`; **§44.8 bracket-matched `?{` scanner (F-SQL-001)** + E-SQL-008 hard-error |
| 45 | Equality Semantics | 14698-14759 | 62 | Single `==`, no `===`, structural, compiler-derived |
| 46 | Worker Lifecycle | 14760-14806 | 47 | `when ... from <#name>`, supervision attrs |
| 47 | Output Name Encoding | 14807-15146 | 340 | Encoded JS variable names, kind prefixes, hash scheme |
| 48 | The `fn` Keyword — Pure Functions | 15147-15799 | 653 | Body prohibitions, return-site completeness, lift in fn, calling conventions; **S32: Layer 2 retired, §54 cross-ref** |
| 49 | `while` and `do...while` Loops | 15800-16502 | 703 | Grammar, break/continue, labels, lift in loops, E-LOOP errors (heading uses H1, not H2) |
| 50 | Assignment as Expression | 16503-16969 | 467 | Assign-expr syntax, semantics, type rules, fn interaction |
| 51 | State Transition Rules / `< machine>` / `<engine>` | 18778-21080 | 2303 | **§51.0 (S57 D2.8) — engines as Tier 2**: §51.0.A overview/singleton; §51.0.B declaration syntax; §51.0.C auto-declared variable + var=; §51.0.D mount position (decl=mount; cross-file singleton); §51.0.E initial= + W-ENGINE-INITIAL-MISSING; §51.0.F rule= contract (compile-time + runtime); §51.0.G .advance() loud; §51.0.H effect= / <onTransition> (to/from/once/if=); §51.0.I :-shorthand; §51.0.J derived engines (L20); §51.0.K components vs engines (Move 20, E-COMPONENT-ENGINE-SCOPE); §51.0.L relationship to legacy §51.1+. Legacy `<machine>` content preserved §51.1-§51.16. |
| 52 | State Authority Declarations | 18693-19221 | 529 | Two-tier authority, server @var, sync infrastructure |
| 53 | Inline Type Predicates | 21932-22913 | 982 | Value constraints, SPARK zones, named shapes, bind:value HTML attrs. **D3 (L4, 2026-05-04) +2 subsections:** §53.6.1 shared-core vocabulary in refinement-type position (cross-ref §55.1 for the universal-core predicate listing); §53.6.2 composition with state-cell validators (type predicate + `req` stack as independent enforcement layers). |
| 54 | Nested Substates and State-Local Transitions | 22606-22906 | 301 | **S32 (2026-04-20).** Nested substate grammar (§54.2), state-local transitions (§54.3), field narrowing (§54.4), terminal states (§54.5), 4 new error codes (§54.6), interaction matrix (§54.7). Companion to §51.15 cross-check. **S57 D2.8 composition note**: §54 composes uniformly with §51.0 engine state-children. |
| 55 | Validators and the Auto-Synthesized Validity Surface | 22907-23383 | 477 | **NEW S57 D2.8.** §55.1 universal-core vocabulary (req, length, pattern, min/max, gt/lt/gte/lte, eq/neq, oneOf/notIn — L4); §55.2 state-cell validators; §55.3 refinement-type validators (cross-ref §53); §55.4 schema-column validators (cross-ref §39); §55.5/§55.6 auto-synth validity surface compound + per-field (L11) — isValid/errors/touched/submitted; §55.7 synthesized-property semantics (read-only); §55.8 `<errors of=expr/>` first-class element (L13); §55.9 ValidationError enum (L12); §55.10 4-level message resolution chain (L12); §55.11 cross-field via predicate args (L14); §55.12 multi-errors / short-circuit; §55.13 reset interaction (cross-ref §6.8); §55.14 engine + derived cells; §55.15 cross-refs + error-code listing. |

## Quick Lookup: Topic → Section

- attribute parsing → §5 (857-1374)
- bind:value → §5 (~954-1090)
- event handler binding → §5.2.2 (~877-910)
- dynamic class → §5 (1090-1374)
- reactive declaration → §6.1-§6.2 (1463+) (V5-strict two forms + three RHS shapes)
- V5-strict access → §6.1 (1465+) + §1.6 (169+) + §3.4 (267+)
- three RHS shapes for state declarations → §6.2 (1552+)
- Variant C compound state → §6.3 (1615+)
- render-by-tag semantics → §6.4 (1683+)
- default= attribute → §6.8 (4504+)
- reset keyword → §6.8 (4504+)
- hoisting model → §6.9 (4562+)
- pinned keyword → §6.10 (4604+)
- validity surface (auto-synthesized) → §6.11 (4644+) + §55
- markup-as-value pillar → §1.4 (126+)
- north star + Tier ladder → §1.5 (145+)
- in-compound derived values → §6.6.16 (~2748+)
- markup-typed derived cells → §6.6.17 (~2785+)
- reactive arrays → §6.5 (~1733+)
- reactive array mutation → §6.5 (1733+)
- derived values → §6.6 + §6.6.16-17 (~2151+)
- lifecycle / cleanup → §6.7 (~2748+)
- timeout / single-shot timer → §6.7.8 (~3562+)
- logic context → §7 (4187-4360)
- file-level scope sharing → §7.6 (4337+)
- SQL / ?{} → §8 (4361-4907)
- SQL per-handler coalescing (Tier 1) → §8.9 (4763+)
- SQL N+1 loop hoisting (Tier 2) → §8.10 (~4811+)
- SQL mount-hydration coalescing → §8.11 (~4881+)
- CSS → §9 (4908-4950)
- CSS inline block → §9.1 (4912+)
- lift → §10 (4951-5329)
- lift accumulation order → §10.8 (5294+)
- state objects / protect= → §11 (5831-5852) (reserved stub; see §6.12 and §52)
- route inference → §12 (5474-5560)
- server function return values → §12.5 (5520+)
- async → §13 (5561-5829)
- async loading / RemoteData → §13.5 (5648+)
- type system / structs / enums → §14 (5830-6352)
- enum types as struct fields → §14.3.2 (5846+)
- components / props → §15 (6353-7083)
- component reactive scope → §15.13 (7030+)
- slots → §16 (7084-7351)
- if= / show= / control flow → §17 (7352-8026)
- if-as-expression → §17.6 (7726-8026)
- match / pattern matching → §18 (8027-9159)
- is operator → §18.17 (~8766-8896)
- partial match → §18.18 (~8896-9159)
- error handling / fail / ? / ! → §19 (9160-10031)
- implicit per-handler transactions → §19.10.5 (9612+)
- navigation / navigate() → §20 (10125-10296)
- module / import / export → §21 (10505-10770)
- export <ComponentName> Form 1 / Form 2 (P2 §21.2) → §21.2 (10513-10615)
- meta / ^{} → §22 (10408-11061)
- foreign code / _{} → §23 (11062-11504)
- WASM sigils → §23.3 (~11284-11439)
- sidecars / use foreign: → §23.4 (~11439-11504)
- HTML elements → §24 (11505-11530)
- CSS variables → §25 (11531-11629)
- comments → §27 (11651-11671)
- compiler settings → §28 (11672-11707)
- bun.eval() → §30 (11717-11747)
- dependency graph → §31 (11748-11771)
- tilde / ~ → §32 (11772-11983)
- pure → §33 (11984-12048)
- error codes → §34 (12049-12251)
- linear types / lin → §35 (12252-12713)
- lin function params → §35.2.1 (12252+)
- keyboard / mouse / gamepad → §36 (12714-13071)
- SSE / server function* → §37 (13072-13313)
- WebSocket / channel → §38 (13314-13619)
- schema / migrations → §39 (13620-13895)
- middleware / handle() → §40 (13896-14119)
- use / import system → §41 (14120-14326)
- not keyword / absence → §42 (14327-14558)
- compound is not / is some → §42.2.4 (14337+)
- nested program / workers → §43 (14559-14641)
- multi-database / ?{} adaptation → §44 (14642-14697)
- equality / == → §45 (14698-14759)
- worker lifecycle / when...from → §46 (14760-14806)
- output name encoding → §47 (14807-15146)
- fn keyword / pure functions → §48 (15147-15799)
- while / do...while loops → §49 (15800-16502)
- assignment as expression → §50 (16503-16969)
- state transitions / machine → §51 (16970-18692)
- §51.15 machine cross-check (S32) → §51 (~18439+)
- state authority / server @var → §52 (18693-19221)
- inline predicates / constraints → §53 (19222-20160)
- nested substates / state-local transitions → §54 (22606-22906)
- E-STATE-COMPLETE (S32) → §54.6 (~22782+)
- state-local transitions (S32) → §54.3 (~22669+)
- field narrowing on substates (S32) → §54.4 (~22748+)
- terminal states (S32) → §54.5 (~22765+)

<!-- Stage 0b D2.8 (2026-05-04) — v0.next additions -->
- Tier 0/1/2 ladder → §1.5 (145+) + §17.0 (8074+) + §18.0 (8803+) + §51.0 (18788+)
- match block / `<match for=Type [on=expr]>` → §18.0.1 (8828+)
- W-MATCH-RULE-INERT / E-MATCH-EFFECT-FORBIDDEN / E-MATCH-ONTRANSITION-FORBIDDEN → §18.0.2 (8879+)
- E-MATCH-NOT-EXHAUSTIVE → §18.0.1 (~8870+)
- bare-variant inference → §18.0.3 (8900+)
- E-VARIANT-AMBIGUOUS → §18.0.3 (~8920+)
- engine declaration / `<engine for=Type initial=.X>` → §51.0.B (18813+)
- engines as singleton → §51.0.A (18788+)
- auto-declared engine variable → §51.0.C (18858+)
- engine `var=` override → §51.0.C (~18880+)
- E-ENGINE-VAR-DUPLICATE → §51.0.C (~18890+)
- engine mount position (decl=mount; cross-file singleton) → §51.0.D (18894+)
- engine `initial=` + W-ENGINE-INITIAL-MISSING → §51.0.E (18942+)
- engine `rule=` contract (single/multi-target/wildcard) → §51.0.F (18972+)
- E-ENGINE-INVALID-TRANSITION → §51.0.F (~19015+)
- `.advance(.X)` engine method → §51.0.G (19022+)
- engine `effect=` / `<onTransition>` (to/from/once/if=) → §51.0.H (19050+)
- E-ENGINE-EFFECT-AMBIGUOUS → §51.0.H (~19075+)
- `:`-shorthand for state-child body → §51.0.I (19101+)
- derived engines / `derived=expr` (L20) → §51.0.J (19121+)
- E-DERIVED-ENGINE-NO-RULES / -NO-INITIAL / -NO-WRITE / -INITIAL-UNDEFINED / -CIRCULAR → §51.0.J (~19145+)
- components vs engines (Move 20) / E-COMPONENT-ENGINE-SCOPE → §51.0.K (19162+)
- `<engine>` keyword vs legacy `<machine>` deprecation → §51.0.L (19183+) + W-DEPRECATED-001 (§34)
- validators / req / is some / length / pattern / min / max / gt / gte / eq / oneOf → §55.1 (22920+)
- validators on state cells (L4) → §55.2 (22952+)
- validators on refinement types → §55.3 (22985+) (cross-ref §53)
- validators on schema columns → §55.4 (23012+) (cross-ref §39)
- auto-synthesized validity / isValid / errors / touched / submitted (compound) → §55.5 (23041+)
- per-field validity surface → §55.6 (23078+)
- synthesized-property semantics (read-only) → §55.7 (23100+)
- E-SYNTHESIZED-WRITE → §55.7 + §34 + §6.11
- `<errors of=expr/>` first-class element (L13) → §55.8 (23114+)
- ValidationError enum (L12) → §55.9 (23168+)
- error message resolution / 4-level / messageFor → §55.10 (23199+)
- registerMessages / `scrml:data` → §55.10 (23215+) + §41
- cross-field validation (L14) → §55.11 (23259+)
- E-VALIDATOR-CIRCULAR-DEP → §55.11 + §34
- multiple errors per field / short-circuit → §55.12 (23287+)
- reset + validity surface → §55.13 (23305+) (cross-ref §6.8)
- validators on engine state-cells / derived cells → §55.14 (23320+)
- E-DERIVED-WITH-VALIDATORS → §55.14 + §34

<!-- Stage 0b D3 (2026-05-04) — channels + schema + predicates + `not` clarification -->
- channel file-level placement → §38.1 (14600+)
- channel V5-strict body (auto-sync from placement) → §38.4 (14707+)
- v1→v0.next channel migration note → §38.4.1 (14756+)
- E-CHANNEL-INSIDE-PROGRAM → §38.1 + §34
- E-CHANNEL-SHARED-MODIFIER → §38.4 + §34
- schema additive shared-core vocabulary (req/length/pattern/min/max/...) → §39.5.7 (~15445+)
- schema lowering shared-core to SQL DDL → §39.5.8 (~15470+)
- schema SQL-mirror vs shared-core (when to use) → §39.5.9 (~15530+)
- refinement-type shared-core (cross-ref §55) → §53.6.1 (22285+)
- refinement-type + state-validator composition → §53.6.2 (22310+)
- `is some` vs `req` distinct predicates (L5) → §42.2.5 (~16210+)
- three loci of exists/required semantic → §42.2.5 (~16225+)
