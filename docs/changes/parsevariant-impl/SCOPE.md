---
title: parseVariant implementation — scope + decomposition
date: 2026-05-06
session: S65
authority: debate-05 verdict (5/5 unanimous, judge-ratified) + S65 Path-A architectural commit + S65 survey findings
status: SCOPE LOCKED — Path A · survey-revised cost estimate · awaiting dispatch authorization
path: A (compile-time special form — type-as-argument as language primitive, OUTSIDE meta-blocks)
family: parseVariant is FIRST general-position member of type-as-argument feature family
roadmap: parseVariant → serialize → formFor → schemaFor → tableFor → variantNames + reflective metadata
survey: docs/changes/parsevariant-impl/SURVEY-REPORT.md (depth-of-survey-discount #7; ~15-25% cost reduction; 2 SCOPE drifts caught)
revised_estimate: ~16-23h (vs original ~20-30h); ~14-19h achievable with engine-validation helper co-location
---

## Survey findings (S65 diagnostic dispatch — see SURVEY-REPORT.md for full detail)

**The depth-of-survey discount is real and large for this dispatch.** Most of Path A's compiler scope is already shipped:

- **`reflect(TypeName)`** in `^{}` meta blocks (`meta-checker.ts:144-153, 174, 258-274`) is a working type-as-argument primitive TODAY. parseVariant rides the same recognition pattern — moves it OUTSIDE meta-blocks. This narrows the architectural-precedent claim: type-as-argument was always going to escape `^{}` eventually; parseVariant is the first ratified case.
- **`<engine for=Type>` validation** at `type-system.ts:1998-2018` (E-ENGINE-004) is the structural template for E-PARSEVARIANT-TYPE-NOT-ENUM. One helper extraction away.
- **Engine codegen** (`emit-machines.ts`) is the shape model for compile-time-walks-variants emission. **NOT** match-stmt — match dispatches via runtime `_scrml_structural_eq`, which is the wrong pattern.
- **`!{}` handler integration** is fully supported; parseVariant just marks itself failable returning `ParseError` and existing codegen does its job.

**Two SCOPE drifts caught (corrected in this revision):**

- ~~§10.4~~ → **§41.13** for `scrml:data` API entry. §10 is `lift`; stdlib API surface lives in §41. §41.12 (`registerMessages`) is the precedent entry.
- ~~Parser-level recognition of `parseVariant(json, TypeRef)` as special call form~~ → **No-op**. Already parses cleanly as regular CallExpression with Identifier argument. Recognition is type-system + codegen only.

**Survey-revised total: ~16-23h** (vs original ~20-30h), or **~14-19h** with engine-validation helper co-location.

# parseVariant implementation — scope + decomposition

## Authority

5/5 unanimous panel verdict (debate-05) ratified by debate-judge:
- `scrml-support/docs/debates/debate-05-boundary-parsing-primitive-2026-05-06.md` (transcript)
- `scrml-support/docs/debates/debate-05-judgment-2026-05-06.md` (judgment)
- `scrml-support/design-insights.md` §"Boundary-parsing primitive" (design insight #4)

## Verdict-locked design

### What ships

```scrml
import { parseVariant } from 'scrml:data'

type LoadResult:enum = { Success(rows: int), Empty, Failed(reason: string) }
type LoadError:enum  = { Malformed(reason: string), Network(msg: string) }

server function loadResult()! -> LoadError {
    const raw = fetch("https://api.example.com/results")
    const result = parseVariant(raw, LoadResult) !{
        | ::ParseError msg -> { fail LoadError::Malformed(msg) }
    }
    return result    // typed as LoadResult; <match> exhaustive
}
```

### Constraints (from debate-05 verdict — ALL FOUR are load-bearing)

1. **Second argument MUST be a scrml-native `enum` type descriptor.** Struct types and arbitrary type literals are rejected at compile time. Closes the string-discriminator trap at the type system.
2. **Discriminator key is fixed: the enum's own variant names.** No custom field-name override. No name-mapping table. Wire formats with non-matching shapes (`{type: "SUCCESS"}` vs enum `Success`) require a server-fn normalization step.
3. **Returns typed enum value or fails with `::ParseError msg`.** The function is failable; call site uses standard `!{}` handler pattern.
4. **Companion design statement closes `parseShape` as intentionally absent.** Struct boundary parsing is a server function or §53 boundary-zone refinement on assignment. Documentation must explicitly close this slope or the next request follows.

### What does NOT ship (closed by verdict)

- `parseShape(json, StructType)` — closed as synonym for §53 SPARK boundary refinement on assignment to typed parameter
- `parseArray` — synonym for `[].map(parseVariant(...))`; closed
- `parseRecord`, `parseTuple`, `parsePartial` — closed; document explicitly

## Implementation path — LOCKED: Path A (compile-time special form)

**Decision:** S65 — Bryan locked Path A after evaluating the type-as-argument feature pipeline. **`parseVariant` is the FIRST member of a type-as-argument family**, not a one-off. The architectural commit is paid here, once; subsequent family members ride on the precedent.

### What Path A means

`parseVariant(json, EnumType)` is recognized by the compiler as a special call form. The second argument is a **type expression**, not a value. The compiler:
1. Resolves `EnumType` to its variant set at compile time (parser + type-system pass)
2. Emits monomorphized parser code per call site (codegen pass)
3. Verifies (compile-error: `E-PARSEVARIANT-TYPE-NOT-ENUM`) that the type argument is a scrml-native enum, not a struct/named-shape/literal

### Why Path A (over B/C)

The deciding factor is **the family**, not parseVariant itself:

| Future family member | Path A enables | Path C blocks |
|---|---|---|
| `serialize(value, Type)` | ✅ symmetric with parseVariant; reuses precedent | ⚠️ requires retrofit |
| `formFor(StructType)` | ✅ requires compile-time structural walk of type | ❌ desugar can't carry structural walk |
| `schemaFor(StructType)` | ✅ requires compile-time field+predicate enumeration | ❌ same |
| `tableFor(StructType, rows)` | ✅ same family | ❌ same |
| `variantNames(EnumType)` | ✅ reflective metadata via type-as-argument | ⚠️ requires synthetic `.foo` property explosion |

**Two of these (`formFor`, `tableFor`, `schemaFor`) genuinely require type-as-argument as a structural language concept**, not as a desugar trick. Without Path A here, the language hits a wall at `formFor` and has to retrofit type-as-argument anyway. Pay the architectural cost ONCE; harvest across the family.

### The discipline that bounds Path A's surface

Path A opens a door. The discipline that prevents bloat:

1. **Per-shape sliver test mandatory** for every future type-as-argument addition (debate-02 + debate-04 methodology)
2. **Synonym-detection precondition** (debate-04) — every candidate must produce a distinct semantic shape vs. existing primitives
3. **Asymmetric-forfeit-cost decomposition** (debate-03) — every candidate weighs SHIP-and-wrong vs DON'T-SHIP-and-wrong honestly
4. **No `Type.foo` request enters the language without its own deep-dive + debate** if the convener has any doubt

Without these, Path A is the slippery slope simplicity-defender warned about. With them, Path A is the load-bearing infrastructure for a family of 5-7 high-leverage features that scrml's existing design center already points at.

### Family roadmap (concrete shipping order)

1. **`parseVariant`** — THIS DOC. Establishes the type-as-argument precedent + ParseError type + compile-time enum-only verification
2. **`serialize`** — symmetric counterpart; round-trips with parseVariant; same type-as-argument machinery
3. **`formFor(StructType)`** — flagship. Walks struct fields → emits `<form>` markup tree using existing Shape 2 + auto-synth validity surface + `<errors of=>` machinery. Closes Gaps #19 + #20 (validator-set transform via `pick=`/`omit=`/`partial=true`)
4. **`schemaFor(StructType)`** — emits `<schema>` SQL DDL from struct predicates. Closes the §39 + L4 vocabulary-unification loop ("define type once → schema, form, validator, parser all derive")
5. **`tableFor(StructType, rows)`** — auto-`<table>` from struct + rows; per-column slot overrides; sorting/selection/empty-state attrs
6. **`variantNames(EnumType)` / reflective metadata** — small primitives that tighten the family

Each member is its own dispatch with its own deep-dive when it fires. **The architectural commitment is THIS DOC.**

### Family demo (the "we are not React" pitch)

```scrml
type User:struct = {
    name:  string req length(>=2)
    email: string(email) req unique
    age:   int min(13) max(120)
}

<schema>${schemaFor(User)}</>
<users>: [User] = []

<program>
    ${ async () => @users = await loadUsers() }
    <{formFor(User, submit=createUser)}/>
    <{tableFor(User, rows=@users)}/>
</>

server function createUser(input)! -> CreateError {
    ?{ insert into users values (${input.name}, ${input.email}, ${input.age}) }
    @users = await loadUsers()
}
```

One struct definition + five lines of glue → SQL schema with constraints, working form with validation, working table with rendered cells, full reactive lifecycle, zero npm packages. **scrml.dev flagship demo.**

## Decomposition (once path selected)

### Pipeline tier classification

This is **T2** (compiler change with new SPEC surface). T1 (stdlib only) won't work — the function needs compiler-side type-argument handling.

### Steps (Path A)

1. **Lock L22 record** — append to `scrml-support/docs/deep-dives/v0next-s56-deliberation-outcomes-2026-05-04.md` (or wherever L21 was recorded). L22 phrasing: *"Type-as-argument is a first-class scrml language primitive, introduced by `parseVariant`. Foundation for the type-as-argument family (`serialize`, `formFor`, `schemaFor`, `tableFor`, reflective metadata). Each future family member must independently pass per-shape sliver test + synonym-detection precondition + asymmetric-forfeit-cost decomposition."* Cite debate-05 verdict + judge ratification + S65 family-roadmap commit.

2. **SPEC §41.13 (`scrml:data parseVariant`)** [DRIFT-1 corrected — was §10.4 in pre-survey draft] — add `parseVariant` API entry as a sibling to existing §41.12 `registerMessages`. Full call signature, second-arg type-constraint (enum-only), `::ParseError` failure type, exhaustive failure-variant list. Cite §53.14 (new — see step 3) for type-as-argument family framing; §22 (reflect) for sibling-precedent inside meta-blocks; §53 SPARK boundary semantics for type-establishment-vs-predicate-enforcement sequencing. ~40-60 lines.

3. **SPEC §53.14 (new subsection — "Type-as-argument primitives")** [survey-confirmed insert point: after §53.9.4, before §53 SPEC-ISSUE list] — formalize type-as-argument as a language concept per design insight #4. Distinguishes type-establishment step (constructor selection from discriminator) from predicate-enforcement step (SPARK boundary refinement). Documents the family roadmap. Documents the discipline that bounds the family (sliver test mandatory; synonym detection mandatory; per-feature deep-dive). Cross-refs §22 (reflect — meta-block precedent) + §41.13 (parseVariant — first general-position member) + §53.6 named-shape registry as structural model. ~80-120 lines (load-bearing for the family; first member specification carries the architectural framing).

4. **SPEC §34 catalog** — add error codes:
   - `E-PARSEVARIANT-TYPE-NOT-ENUM` — compile-time; second arg is not a scrml-native enum
   - `E-PARSEVARIANT-DISCRIMINATOR-MISSING` — runtime, surfaced via `::ParseError::MissingDiscriminator`
   - `E-PARSEVARIANT-UNKNOWN-VARIANT` — runtime, via `::ParseError::UnknownVariant(tag)`
   - `E-PARSEVARIANT-INVALID-PAYLOAD` — runtime, via `::ParseError::InvalidPayload(field, reason)`

5. **Compiler change (Path A scope — survey-revised):**
   - ~~**Parser:** recognize `parseVariant(expr, TypeRef)` as a call form~~ — **NO-OP per DRIFT-2 survey finding.** `parseVariant(raw, LoadResult)` already produces a valid `CallExpression { callee: IdentExpr("parseVariant"), arguments: [IdentExpr("raw"), IdentExpr("LoadResult")] }`. No tokenizer / block-splitter / ast-builder / expression-parser change required. ~3-5h removed from scope.
   - **Type-system pass (~2-3h):** locate at `compiler/src/type-system.ts` (8724 lines). New check inspects call-expressions; when callee resolves through MOD's import registry to imported `parseVariant`, inspects `args[1]`. If `args[1].kind !== "ident"`, emit `E-PARSEVARIANT-TYPE-NOT-ENUM` ("must be a bare type name"). Otherwise `typeRegistry.get(args[1].name)`; if missing or `kind !== "enum"`, emit `E-PARSEVARIANT-TYPE-NOT-ENUM` ("is a struct, not an enum" — wording mirrors E-ENGINE-004 at line 2010-2018). Annotate the call-expr node with back-reference to resolved EnumType (parallel to how meta-checker sets `node.typeRegistrySnapshot`). **Strong leverage:** ride E-ENGINE-004 helper extraction; ~80-150 LOC.
   - **Codegen (~3-5h):** new `compiler/src/codegen/emit-parse-variant.ts` (~200-400 LOC) modeled on `emit-machines.ts` (the canonical compile-time-walks-variants emission shape; **NOT** match-stmt, which dispatches via runtime `_scrml_structural_eq`). For each parseVariant call: emit a monomorphized IIFE that JSON-parses-or-passes-through, validates discriminator presence, switches on tag, builds the matching variant constructor with payload validation per variant. Reads EnumType directly off the annotated call-node (per Risk #3 — skips `serializeTypeEntry` payload-extension). `!{}` handler integration is FREE: TS pass sets the call's failure-type to `ParseError`, existing failable-call codegen takes over.
   - ~~**Self-host shim**~~ — **NO-OP.** parseVariant is recognized at TS+codegen stages directly; doesn't flow through BPP. Self-host parity is a separate follow-up when self-host catches up.
   - **Survey COMPLETE.** See `SURVEY-REPORT.md` for full per-area findings. ~~Survey first~~ done.

6. **Stdlib `stdlib/data/parse.scrml` (new file)** — declares `ParseError:enum` with the four variants. Provides any per-call-site runtime helpers the compiler-emitted code needs (e.g., common type-coercion routines for primitive payloads). Most parsing logic is monomorphized at the call site; this file is mostly the error-type declaration + helpers. Smaller than expected.

7. **`stdlib/data/index.scrml`** — re-export `parseVariant` (special-form name) and `ParseError`.

8. **Tests** — comprehensive:
   - Happy path: variant-with-payload, variant-without-payload, mixed enums, all-variants-tested
   - Failure paths: missing discriminator, unknown variant, payload type mismatch (per-primitive), nested-payload mismatch
   - Compile-time errors: `parseVariant(json, MyStruct)` → E-PARSEVARIANT-TYPE-NOT-ENUM with helpful message; `parseVariant(json, "Foo")` → same; `parseVariant(json)` (arity) → standard arity error
   - Edge cases: enum with single variant, enum with one no-payload variant + one with payload, empty enum (compile-error E-EMPTY-ENUM if scrml has such; otherwise document)
   - Recursion question: nested enums — `parseVariant` does NOT recurse on payload-typed-as-enum. Document. Dev calls `parseVariant` again at the inner site if needed. (Forces composition discipline; matches family's sliver-test minimalism.)

9. **Primer update**:
   - §10 stdlib catalog: add `parseVariant` row + `ParseError` enum description
   - §13 locks: add L22 entry
   - §13.5 spec-real-estate-vs-adoption table: parseVariant now ACTIVE
   - **§14 (NEW) Type-as-argument family** — short reference paragraph naming the 5-member family with shipped/planned status; cross-references SPEC §53.14

10. **Predicate-gaps inventory update** — `scrml-support/docs/predicate-gaps-inventory-2026-05-06.md`: flip Gap #19 status from "captured" to "CLOSED by parseVariant (debate-05 verdict + Path-A architectural commit, S65)". Add note: Gap #20 (validator-set transform operators) still open; planned closure via `formFor(StructType, pick=/omit=/partial=)` (next family member after `serialize`).

11. **Kickstarter v2 update** — add `parseVariant` to scrml:data section (line 750 area); update anti-pattern row "parsing untyped JSON without typed boundary" to point at `parseVariant`. Add section §11.X "Type-as-argument primitives" with parseVariant as the worked example + family roadmap.

12. **Family-precedent doc (NEW)** — `scrml-support/docs/type-as-argument-family-2026-05-06.md` records: (a) the 5-7 family members with sliver-test status per member, (b) the discipline that bounds future additions, (c) the design insight #4 reasoning that grounds the family (type-establishment vs predicate-enforcement sequencing). This is the doc future PA's read when a new `Type.foo` request lands and they need to apply the discipline.

### Estimated effort (Path A — SURVEY-REVISED)

**~16-23h focused** (vs original ~20-30h; ~14-19h achievable with engine-validation helper co-location). Survey-revised breakdown:

| Bucket | Original | Survey-revised | Notes |
|---|---|---|---|
| Lock L22 record + family doc | ~1-2h | ~1.5h | mechanical |
| SPEC §41.13 entry [DRIFT-1 fix] | (was §10.4) | ~2-3h | §41.12 is the model |
| SPEC §53.14 type-as-argument family | ~3-4h | ~2-3h | §53.6 named-shape registry is structural model |
| SPEC §34 catalog (4 codes) | ~0.5-1h | ~0.5h | mechanical pattern |
| Compiler — parser [DRIFT-2 fix] | ~3-5h | **0h (no-op)** | already parses correctly |
| Compiler — type-system pass | ~3-5h | **2-3h** | rides E-ENGINE-004 helper + reflect() precedent |
| Compiler — codegen monomorphization | ~3-5h | **3-5h** | new emit-parse-variant.ts modeled on emit-machines.ts |
| Compiler — self-host shim | ~0.5-1h | **0h (no-op)** | not in BPP path |
| Stdlib parse.scrml + index re-export | ~1-2h | ~0.5-1h | ~50-80 line file |
| Tests (unit + integration + compile-error) | ~2-3h | ~2-3h | unchanged |
| Primer + kickstarter + inventory updates | ~1-2h | ~1-2h | unchanged |
| **Optional ghost-patterns lint add** | not in original | ~0.5h | new "did you mean parseVariant?" diagnostic |

**Family economics:** the ~16-23h here still pays for `serialize` (~10-15h riding precedent), `formFor` (~25-40h flagship), `schemaFor` (~15-25h), `tableFor` (~15-25h), reflective metadata (~5-10h). **~85-145h total family**, of which ~16-23h is the architectural commit here. The remaining ~65-125h is harvest across the next 6-12 months. **Discount widens family-economic ratio from ~3-5x to ~4-6x.**

### Survey-recommended dispatch order (4 phases)

1. **Phase 1 (~2h):** L22 record + new `stdlib/data/parse.scrml` (ParseError enum + parseVariant marker export) + cross-file-import sniff test (write a one-file scrml that does `import { ParseError } from 'scrml:data'; <state>: ParseError = .Malformed("test")` — does the type resolve?). **Risk #1 verification gate.**
2. **Phase 2 (~5-8h):** TS pass (E-PARSEVARIANT-TYPE-NOT-ENUM, ride E-ENGINE-004 helper) + codegen (`emit-parse-variant.ts` modeled on `emit-machines.ts`). Verify `!{}` handler integration via existing failable-call codegen.
3. **Phase 3 (~5-7h, parallelizable):** SPEC §41.13 + §53.14 + §34 catalog adds + family-precedent doc + primer/kickstarter/inventory updates. Independent of compiler dispatch.
4. **Phase 4 (~1-2h, optional):** ghost-patterns lint add ("JSON.parse against typed boundary → consider parseVariant"); final inventory updates.

## Risks

1. **Recursion question.** Does `parseVariant` over an enum whose payload is *another* enum recurse? **Recommended: NO** — each level is an explicit call. Forces composition discipline; matches family's sliver-test minimalism. Document explicitly in §10.4 entry. Adopters who want recursion compose `parseVariant` at each level.

2. **Name-mapping insistence from adopters.** External APIs send `{type: "ok"}` against scrml `Ok`. Adopters will request a `discriminatorKey=` or `mapping=` argument. **Hold the line — verdict-locked.** Server-fn normalization is the canonical answer. The variant-name-as-fixed-key constraint is the type-system-level enforcement of the string-discriminator-trap mitigation.

3. **Compile-time errors must be specific.** `parseVariant(json, MyStruct)` should produce a clear "second argument must be a scrml-native enum type — got struct" message, not a generic type error. Diagnostic quality is worth dedicated budget. The compile-error message is the doc adopters first encounter.

4. **Type-as-argument precedent floodgate.** Path A's value comes from the family — but the family discipline (sliver test + synonym detection + per-feature deep-dive) MUST be applied with full force on every future addition. Without that discipline, every `Type.foo` request becomes a credible feature ask. The family-precedent doc (Step 12) records the discipline so future PA's apply it automatically.

5. ~~**Survey-first phase under-scoped.**~~ — **SURVEY COMPLETE.** Discount confirmed at ~15-25% (~14-19h with co-location); see SURVEY-REPORT.md.

6. **Stdlib-declared enum cross-file resolution (NEW from survey).** `ParseError:enum` will be the FIRST stdlib-declared enum type. The importing file's typeRegistry must include it for `!{| ::ParseError msg -> ...}` exhaustiveness checking to work. D4 §21.8 cross-file engine-import is the relevant precedent. **Phase 1 of dispatch is the verification gate** — write a one-file sniff test BEFORE proceeding to Phase 2. If the type doesn't resolve, additional MOD work is needed and dispatch must fork to handle it.

7. **`emitTypeRegistryLiteral` payload-field gap (NEW from survey).** Currently emits enum variant NAMES only — no payload field info. parseVariant codegen needs payload field names + types. Survey-recommended fix: read EnumType directly off the annotated call-node at codegen time (skips disturbing existing meta consumers of `serializeTypeEntry`). Documented in dispatch brief.

## Dispatch readiness

When Bryan authorizes:
- **Path A LOCKED** — no further architectural review needed
- ~~Survey-first phase~~ — **SURVEY COMPLETE.** See `SURVEY-REPORT.md`. Implementation dispatch can proceed directly.
- Use Phase 1/2/3/4 ordering from Survey-recommended dispatch order section above
- Phase 1 (cross-file-import sniff test) is the **gating verification** — if it fails, fork to MOD work before continuing
- Write tier-classified brief per S64 worktree-isolation discipline (paste absolute worktree path; bun install + bun run pretest in startup verification)
- Use `general-purpose` no-isolation per S64 hand-off note 43 (worktree-routing harness bug)
- Strong incremental-commit instructions per pa.md §"Background Agents"
- Brief MUST include: `docs/articles/llm-kickstarter-v1-2026-04-25.md` + `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` (per S64 PA-orchestration discipline)
- Dispatch brief MUST cite: this SCOPE doc (DRIFT-corrected) + SURVEY-REPORT.md + debate-05 transcript + judgment + design insight #4
- **Critical for the dispatching agent:** the SURVEY-REPORT.md is load-bearing — it documents file paths + line numbers + helper-extraction targets that the brief refers to. Any agent following the SCOPE without reading SURVEY-REPORT.md will redo work the survey already mapped.

## Tags

#parsevariant #scrml-data #predicate-gap-19-closing #debate-05-verdict #path-A-locked #L22 #SPEC-10.4 #SPEC-53.x #type-as-argument-family #serialize-next #formfor-flagship #schemafor #tablefor #scope-document
