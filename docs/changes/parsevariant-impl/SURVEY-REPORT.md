---
title: parseVariant Path A — existing-infrastructure survey
date: 2026-05-06
session: S65
authority: PA-orchestrated diagnostic; Path A locked; survey-first phase
status: COMPLETE — informs implementation per-step decomposition + cost re-estimate
---

# parseVariant Path A — existing-infrastructure survey

## Headline (read this first)

The depth-of-survey discount **is real and large** for this dispatch. The single most important finding: scrml ALREADY has a working type-as-argument primitive — **`reflect(TypeName)`** in §22 meta — and the compiler already does, for `<engine for=Type>` and `<match for=Type>` and `reflect(Color)`:

1. registry-resolves a bare type-name identifier to enum metadata via `typeRegistry.get(name)` returning a `tEnum` shape with `.variants[]`,
2. rejects non-enum types with a specific compile-error pattern (E-ENGINE-004 — "is a struct, not an enum"),
3. serializes enum metadata to a JS object literal at codegen time (`emitTypeRegistryLiteral` in `codegen/emit-logic.ts:175-188`).

These three steps ARE Path A's compiler change. parseVariant doesn't need new type-resolution machinery; it needs to ride the existing machinery into a new emit shape (a per-call-site monomorphized parser using the same enum-metadata literal).

**Revised cost: ~7-12h compiler + ~3-5h spec/stdlib/tests/docs ≈ 10-17h total** (vs SCOPE estimate ~20-30h). **2-3x discount confirmed.**

Two surprises worth surfacing as **DRIFT** vs the SCOPE doc:

- **DRIFT-1: SCOPE says "SPEC §10.4 (`scrml:data`)" — that section does not exist.** SPEC §10 is `lift`. The `scrml:data` API surface lives in **§41 (Import System)**, specifically §41.12 `scrml:data registerMessages` is the precedent entry. The parseVariant API entry should land near §41.12 (new §41.13).
- **DRIFT-2: SCOPE step 5 says "parser must recognize `parseVariant` as a special call form where arg 2 is a TypeRef AST node."** The parser does NOT need any change. `parseVariant(json, LoadResult)` already parses cleanly as a regular CallExpression with an Identifier argument — exactly like `reflect(Color)` (`compiler/src/ast-builder.js:1977` documents this). The "TypeRef in arg position" is recognized at the **type-system stage** by inspecting the call's IdentExpr argument and looking it up in `typeRegistry`. No tokenizer / block-splitter / ast-builder / expression-parser changes required.

The remainder of this report supports those headlines area-by-area.

---

## 1. Type-as-argument precedents in scrml today

**What exists today:**

- **`reflect(TypeName)`** — `compiler/src/meta-checker.ts:144-153, 174, 258-274` — built-in compile-time API in `^{}` meta blocks. Takes a bare type-name identifier (PascalCase) as its first positional argument; `reflectCallIsCompileTime()` classifies the arg as a compile-time type-name vs a runtime variable by inspecting the IdentExpr name shape. The runtime variant `meta.types.reflect(name)` (runtime-template.js:1006) takes a string and looks up the same registry. **This is the closest existing precedent, structurally identical to what parseVariant needs.**
- **`<engine for=Type>` / `< machine for=Type>`** — `compiler/src/ast-builder.js:8175-8276` parses `for=` as an attribute (string), then `compiler/src/type-system.ts:1998-2018` does the resolution: `typeRegistry.get(govName)` → check `govType.kind === "enum"` → emit E-ENGINE-004 if absent or non-enum. **This is THE structural template for parseVariant's compile-time validation.** The error message pattern ("references type 'X' which is a struct, not an enum or struct") is the model for E-PARSEVARIANT-TYPE-NOT-ENUM.
- **`<match for=Type>` block-form** — `compiler/src/type-system.ts:5267-5297 (checkEnumExhaustiveness)`, called at line 5756. Walks the enum's `.variants[]` array at compile time to verify every variant is covered.
- **`let x: Phase = .Idle`** bare-variant inference — TS resolves the annotation type (`resolveTypeExpr`, type-system.ts:1273-1372), pulls the variant set, validates `.Idle` is one of them. Same registry, same `.variants[]` walk.

**What's missing for parseVariant:**

Almost nothing at the resolution layer. The gap is purely:
- A new TS check that recognizes a CallExpression whose callee is the imported name `parseVariant` and whose **second positional argument's AST is an IdentExpr** referring to a typeRegistry entry, and runs the same `kind === "enum"` predicate as E-ENGINE-004.

**Discount-shaped finding:** The SCOPE step 5 split (parser / type-system / codegen) is overweighted on parser. The actual surface is **type-system + codegen only**. Discount: ~3-5h shaved off step 5.

---

## 2. Parser-level work

**What exists today:**

- Call expressions parse via Acorn-driven `expression-parser.ts` (lines 521-575, 1058+ for CallExpression). Positional arguments are general expressions; an Identifier-as-argument is just an `IdentExpr`. There is no special treatment of "argument is a type name" in the parser — and there doesn't need to be, because the type-system can inspect the IdentExpr.name.
- The compiler today does NOT pre-build a `TypeRef` AST node. Type annotations on declarations are stored as **strings** (`typeAnnotation: "Phase"`, `compiler/src/ast-builder.js:3199-3330`) and resolved on-demand via `resolveTypeExpr(string, registry)`. This is a deliberate design — type names in scrml live as identifiers/strings at AST level.
- The "names recognized as scrml structural specials" is dual-tracked:
  - Block-level (`<engine>`, `<match>`, `<errors>`, `<onTransition>`) — `compiler/src/attribute-registry.js` (per-element attribute schemas) + tokenizer + block-splitter recognition.
  - Expression-level (`reflect`, `emit`, `bun.eval`, `~`, `lift`) — recognized at the type-system / meta-checker / specific-pass level by inspecting CallExpression callee names.
  - **`parseVariant` belongs in the second bucket** (expression-level recognized name), not the first. No tokenizer / attribute-registry change.

**What's missing for parseVariant:**

- **Nothing at the parser layer.** `parseVariant(raw, LoadResult)` already produces a valid `CallExpression { callee: IdentExpr("parseVariant"), arguments: [IdentExpr("raw"), IdentExpr("LoadResult")] }`.
- The TS pass needs to know the callee is `parseVariant` (after import-resolution from `scrml:data`) — same way `reflect` is recognized today.

**Discount-shaped finding:** SCOPE step 5's "Parser: recognize `parseVariant(expr, TypeRef)` as a call form" is **a no-op**. The parser already produces the right AST. Discount: ~2-4h.

---

## 3. Type-system level

**What exists today (`compiler/src/type-system.ts`, 8724 lines):**

- `EnumType` interface (line 104-108, 234) — `{ kind: "enum", name, variants: VariantDef[], transitionRules }`.
- `tEnum(name, variants, transitionRules)` constructor (line 433-435).
- `typeRegistry: Map<string, ResolvedType>` — built by Pass 1/2/3 type-decl resolution (lines 1750-1792).
- `resolveTypeExpr(expr, typeRegistry)` (line 1273-1372) — given a type-expr string, returns a ResolvedType. Used for: state-decl annotations (3611, 3901, 4024), function param annotations (3670, 3737), error-enum annotations (4363).
- **Enum-only validation precedent** (E-ENGINE-004, line 2010-2018): exactly the shape parseVariant needs.
- **Variant-set walking precedents**: `checkEnumExhaustiveness` (5267), `parseMachineRules` against variant set (2208-2226), `.Idle` inference (5228-5234).
- **VariantDef carries payload metadata** — `parseEnumBody` (line 994+) reads variant payloads (e.g., `Network(msg: string)`) and resolves each payload field type via `resolveTypeExpr` (line 1129). So `LoadError::Network(msg: string)` already has full structural info — name + ordered payload field name + each field's ResolvedType. **This is exactly what monomorphized parseVariant codegen needs.**

**What's missing for parseVariant:**

A new TS pass (or addition to the existing call-expression check pass) that:

1. Walks call-expressions in the file's AST.
2. When callee is the imported `parseVariant` (resolved through MOD's import registry — `module-resolver.js`), inspect args[1].
3. If args[1].kind !== "ident": emit E-PARSEVARIANT-TYPE-NOT-ENUM with "second argument must be a bare type name".
4. Look up `typeRegistry.get(args[1].name)`. If missing or `kind !== "enum"`: emit E-PARSEVARIANT-TYPE-NOT-ENUM with the same wording style as E-ENGINE-004 ("is a struct, not an enum").
5. Annotate the call-expr node with a back-reference to the resolved EnumType so codegen can pick it up (parallel to how meta-checker sets `node.typeRegistrySnapshot`).

**Estimated scope:** ~80-150 LOC of new code in type-system.ts, riding entirely on existing primitives.

**Discount-shaped finding:** SCOPE step 5's "Type-system" sub-bullet (estimated ~3-5h within the 10-15h compiler bucket) is realistic at the **low end** because the registry, lookup, validation pattern, and metadata shape ALL exist. Net work: validate + annotate. Estimate: **2-3h**.

---

## 4. Codegen-level

**What exists today (`compiler/src/codegen/`):**

- **`emitTypeRegistryLiteral`** (`codegen/emit-logic.ts:175-188`) + **`serializeTypeEntry`** (line 193-214) — given a TypeRegistryEntry with `kind: "enum"` and `variants`, emits a JavaScript object literal: `({ "Phase": { kind: "enum", variants: [{name: "Idle"}, {name: "Loading"}, ...] } })`. **Currently emits names only — does NOT serialize payload field names + types.** This is an extension point, not a new file.
- **Match codegen** (`emit-logic.ts:1233-1235` → `emitMatchExpr`) — does NOT walk variants at compile time to emit per-variant arms; it emits a runtime structural-equality dispatch using `_scrml_structural_eq`. **So `<match for=Type>` is NOT a codegen precedent for "compile-time-walks-variant-set-emits-per-variant-code"** — it's a runtime dispatch.
- **Engine codegen** (`emit-machines.ts`, 719 LOC) — engines DO emit per-variant rendering shells (`emit-machines.ts` walks variants; `emit-machine-property-tests.ts` emits per-variant property checks at compile time). This IS the per-type compile-time specialization precedent. `emit-machines.ts` is ~the shape parseVariant codegen will look like.
- **`emit-server.ts`, `emit-client.ts`** — handle "this code goes server-side / client-side" splitting (CG output invariants). parseVariant emit must respect: parseVariant is callable in both contexts (server fn boundary as in the canonical example, but also client).
- **Codegen output:** `codegen/index.ts` is the orchestrator (759 LOC). Emit-functions live in per-feature files; parseVariant fits the pattern by adding either a new `emit-parse-variant.ts` (~150-300 LOC estimate) OR a function inside `emit-expr.ts` (the call-expression rewriter — 575 LOC).

**What's missing for parseVariant:**

- **A new emit function** that takes a parseVariant call-node + its annotated EnumType and emits a monomorphized JS function body. Shape (rough sketch):
  ```js
  ((_raw) => {
    const _v = typeof _raw === "string" ? JSON.parse(_raw) : _raw;
    if (_v == null || typeof _v !== "object" || typeof _v.tag !== "string")
      return _scrml_fail("ParseError", "MissingDiscriminator", ...);
    switch (_v.tag) {
      case "Success": { /* per-variant payload validation, build .Success(rows) */ }
      case "Empty":   { return _scrml_variant("LoadResult", "Empty"); }
      case "Failed":  { /* validate reason field is string, build .Failed(reason) */ }
      default: return _scrml_fail("ParseError", "UnknownVariant", _v.tag);
    }
  })(rawArg)
  ```
- **Extension to `serializeTypeEntry`** to include payload-field name+type info (currently only names). About +20 LOC. OR, codegen reads the EnumType directly off the annotated call-node — no serializer change needed.
- **`!{}` handler integration** — the SCOPE example has `parseVariant(raw, T) !{ | ::ParseError msg -> ... }`. The `!{}` handler is already a fully-supported scrml feature for failable calls. parseVariant just needs to be marked as failable returning `ParseError`. The TS pass annotating the call (step 3 above) sets the call's failure-type to `ParseError`, then existing `!{}` handler codegen does its job. **Major leverage: `!{}` codegen is free.**

**Discount-shaped finding:** Codegen is the largest piece, but the per-variant walk pattern is established (`emit-machines.ts` precedent), the metadata shape is established (`serializeTypeEntry`), and the failable-call surface is fully supported. New code: ~200-400 LOC in a new `emit-parse-variant.ts` (or extension to `emit-expr.ts`). Estimate: **3-5h**, not 5-10h.

---

## 5. ParseError type + stdlib runtime

**What exists today:**

- `stdlib/data/validate.scrml` (303 LOC) — exports `validate`, `isValid`, `firstError`, predicate builders, etc. Convention: declare a `<program>${ ... }</program>` wrapper, write `export function name(...) { ... }` for each public API, JSdoc-style block comments.
- `stdlib/data/index.scrml` re-exports from `./validate.scrml` and `./transform.scrml` via `export { ... } from './path.scrml'` syntax (lines 13-19).
- `stdlib/data/transform.scrml` — pure helpers, mirror conventions of validate.scrml.
- **No existing `:enum` type declarations in any stdlib file.** parseVariant's `ParseError:enum` will be the **first** stdlib enum type. This is meaningful: the stdlib loader needs to surface stdlib-declared types into the importing file's typeRegistry (cross-file type imports are legal — §21.8 cross-file engine-import-via-`import`-then-mount has the same prerequisite).

**What's missing for parseVariant:**

- **`stdlib/data/parse.scrml`** (NEW). Body should be small:
  - `<program>${ ... }</program>` wrapper.
  - `export type ParseError:enum = { MissingDiscriminator, UnknownVariant(tag: string), InvalidPayload(field: string, reason: string), Malformed(reason: string) }` — first stdlib enum.
  - `export function parseVariant(json, T) { ... }` — **stub or marker** function. The actual implementation is monomorphized at each call site by the compiler (Path A). The stdlib export exists primarily so `import { parseVariant } from 'scrml:data'` resolves at MOD stage. Could be a runtime-fallback if the call-site monomorphization didn't fire, OR could `fail ParseError::Malformed("internal: parseVariant not monomorphized")` as a defense.
  - Possibly some shared runtime helpers (e.g., a `_makeParseError(variant, ...args)` factory if codegen wants to avoid open-coding the constructor) — though emit-machines.ts already emits enum-variant constructors, so this is likely a no-op.
- **`stdlib/data/index.scrml`** — extend the `export { ... } from './validate.scrml'` line, add `export { parseVariant, ParseError } from './parse.scrml'`.

**Stdlib-type-cross-file-export verification needed:** confirm that stdlib's exported enum types make it into the importer's typeRegistry. If not, extra MOD work is required. Likely already works because `<engine for=ImportedEnum>` works via `import { Phase } from './engines.scrml'` (D4 §21.8).

**Discount-shaped finding:** Step 6 in SCOPE estimates ~3-5h for "Stdlib runtime + tests" — most of the runtime is monomorphized at call sites, so the .scrml file itself is **~50-80 lines** and trivial. Stdlib runtime work: **~1-2h**. Tests are the bigger sub-bucket here.

---

## 6. Self-host shim

**What exists today:**

- `compiler/src/codegen/compat/parser-workarounds.js` (read in full) — the `setBPPOverrides(mod)` hook is for overriding BPP **string-cleanup helpers** (`isLeakedComment`, `stripLeakedComments`) when the self-hosted BPP module is loaded. **Not** a generic "stdlib function override" mechanism.
- Self-host directory exists at `compiler/self-host/` (per pa.md §"Repo layout") — primary copy at `~/scrmlMaster/scrml/`. Not the parseVariant target.

**What's missing for parseVariant:**

- **Nothing.** parseVariant is a compile-time special form recognized by the TS+codegen stages directly; it does not flow through BPP, and it doesn't need a runtime override hook.
- Self-host parity question: when scrml self-hosts, will the self-hosted compiler also need to recognize parseVariant? **Yes** — but that's a self-host follow-up, not a current dispatch concern. The TypeScript compiler is the v0.next target.

**Discount-shaped finding:** SCOPE step 5 sub-bullet "Self-host shim if needed" is a no-op. Discount: minor (~30min that wouldn't have happened anyway).

---

## 7. Test infrastructure

**What exists today:**

- `compiler/tests/unit/` — ~150+ unit tests (per ls output). Naming convention: `<feature-name>.test.js`. Compile-error tests follow the pattern: compile a small scrml string → assert `errors[*].code === "E-FOO-NNN"` via helper `hasCode(errors, code, ...)`.
- Examples of good models:
  - `transition-decl-terminal.test.js` — uses `hasCode(errors, "E-STATE-TERMINAL-MUTATION", "Validated")` for code+context check.
  - `value-lift-codegen.test.js` — uses `expect(result).toContain("E-LIFT-002")` for emitted-code checks.
- `compiler/tests/integration/` — multi-file / cross-feature tests; `kickstarter-v2-smoke.test.js` is the closest "integration smoke" precedent for parseVariant happy-path.
- `compiler/tests/helpers/` — `expr.ts`, `extract-user-fns.js` — shared test utilities.

**What's missing for parseVariant:**

- New unit test file `parse-variant.test.js` covering:
  - Happy path: enum with variants of all three shapes (no payload, single-field payload, multi-field payload). Compile + spot-check emitted code shape.
  - Compile-error path: `parseVariant(json, MyStruct)` → E-PARSEVARIANT-TYPE-NOT-ENUM. `parseVariant(json, "Foo")` (string literal in arg 2) → same. `parseVariant(json)` → standard arity error.
  - `!{}` handler integration: `parseVariant(json, T) !{ | ::ParseError(msg) -> ... }` — verify exhaustiveness check sees ParseError variants.
  - Recursion: nested enum payload — verify NO auto-recursion (per SCOPE risk #1); developer must call parseVariant again at inner site.
- New runtime tests for the monomorphized output (browser test or Node test exercising the actual JSON parsing on emitted code). `compiler/tests/integration/` is the right home.

**Discount-shaped finding:** Test infra is mature; new tests slot into existing patterns. Estimated ~2-3h for thorough test coverage.

---

## 8. Lint-ghost-patterns + gauntlet-phase walkers (the two pipeline bookends)

**What exists today:**

- `compiler/src/lint-ghost-patterns.js` (492 LOC) — pre-Stage-2 pass. Catalog of React/Vue/Svelte syntax patterns triggering "did you mean?" warnings. Source of catalog: `scrml-support/docs/ghost-error-mitigation-plan.md`.
- `compiler/src/gauntlet-phase1-checks.js` (416 LOC) + `gauntlet-phase3-eq-checks.js` — post-TAB diagnostic walkers (per primer §12). Catalog: import/scope/use-decl placement (E-IMPORT-001/003, E-SCOPE-010, E-USE-001/002), equality / null-token misuses (E-EQ-002/004, E-SYNTAX-042). Cross-cutting diagnostics, NOT type-system specific.

**What's missing for parseVariant:**

- **Optional lint:** add a ghost-patterns entry for `JSON.parse(...)` against a typed boundary, suggesting `parseVariant`. Catalog growth is cheap (a regex + correction string + message). ~15 LOC. Worth doing in this dispatch — turns the kickstarter anti-pattern row into a compiler-emitted diagnostic.
- **No gauntlet-phase walker change** — those are import/scope/equality concerns, orthogonal to parseVariant.

**Discount-shaped finding:** No risk surfaced here. Optional ghost-patterns add: ~30min.

---

## 9. SPEC §53.14 placement

**What exists today:**

- §53 "Inline Type Predicates" runs lines 22622-23295 (674 lines, per SPEC-INDEX). Subsections:
  - §53.1 Motivation, §53.2 Syntax, §53.3 Semantics
  - §53.4 Three-Zone Enforcement (SPARK Model) — §53.4.1-§53.4.5
  - §53.5 Type Rules
  - **§53.6 Named Shape Registry** — §53.6.1 Built-in Shapes (table of `email`/`url`/`uuid`/etc.), §53.6.2 Registry Extensibility, §53.6.3 Shape Lookup Failure
  - §53.6.1 Shared-core vocabulary in refinement-type position (L4 cross-ref)
  - §53.6.2 Composition with state-cell validators
  - §53.7 `bind:value` Interaction, §53.8 Interaction with `< machine>`, §53.9 Interaction with Function Boundaries
- **Header numbering quirk:** §53.6 has THREE direct children (§53.6.1, §53.6.2, §53.6.3) AND ALSO has §53.6.1 / §53.6.2 used as **sibling** L4 cross-refs at lines 23175 / 23200. So the spec already has a precedent for "extension subsections that share §53.6.x numbering." Be careful when adding new subsections.

**What's missing for parseVariant:**

- **New subsection §53.14 "Type-as-argument primitives"** (Phase-3-corrected — pre-survey draft said §53.10 but that slot was already occupied by "Interaction with `protect=`"; §53.14 is the actual landing slot). Must:
  - Declare type-as-argument as a first-class scrml primitive.
  - Describe the type-establishment-vs-predicate-enforcement framing (design insight #4).
  - Document the family roadmap (parseVariant, serialize, formFor, schemaFor, tableFor, variantNames).
  - Document the discipline (sliver test + synonym detection + per-feature deep-dive).
  - Cross-ref §41.13 for the parseVariant API, §22 for reflect, §53.6 named-shape registry as a structurally-similar registry pattern.
- §53.6 named-shape registry IS structurally similar to a "type-as-argument-family registry" (compile-time-only registry, lookup-failure error code, extensibility hook deferred to ^{}). The model carries to §53.14 cleanly.

**Recommended insert point:** after §53.9.4, before SPEC-ISSUE list at end of §53. New subsection §53.14 is the cleanest landing.

---

## 10. SPEC §10 stdlib catalog placement — DRIFT

**SCOPE doc says §10.4 (`scrml:data`).** This is wrong.

- **§10 in SPEC.md is `lift` keyword** (lines 5828-6234, with §10.1-§10.8). Not stdlib.
- **The `scrml:data` API surface is documented in §41 (Import System)** — specifically §41.12 `scrml:data registerMessages` (line 16898) is the lone existing per-API entry under `scrml:data`. The pattern: import-system section gets per-stdlib-module API subsections.

**Recommended insert point:** new **§41.13 `scrml:data parseVariant` — boundary-parsing primitive for tagged-variant JSON** (line ~16940 area, after the existing §41.12 block, before §41 closer).

**Content structure for §41.13** (~40-60 lines per SCOPE estimate):
- Call signature: `parseVariant(json: string | object, EnumType) -> EnumType`
- Failable: failure type `ParseError:enum` declared in `scrml:data`.
- Second-arg constraint: scrml-native `:enum` type only. Rejected at compile time with E-PARSEVARIANT-TYPE-NOT-ENUM (cross-ref §34).
- Discriminator: enum's variant names (no override).
- Cross-ref: §53.14 for the type-as-argument family framing; §22 for reflect (sibling type-as-argument primitive); §53 SPARK boundary semantics for type-establishment-vs-predicate-enforcement sequencing.
- ParseError variants enumerated with semantics.

**Primer §10 update note:** the primer's `## §10 stdlib — what's on the shelf` lists `scrml:data` capabilities in prose. Add `parseVariant` + `ParseError` description there. SCOPE step 9 already calls this out.

---

## Cost re-estimate

| Step (per SCOPE) | SCOPE estimate | Survey-revised | Discount source |
|---|---|---|---|
| 1. Lock L22 record | (within 1-2h "Lock + family doc") | 0.5h | Mechanical append |
| 2. SPEC §41.13 (NOT §10.4 — DRIFT-1) | ~3-4h (within 6-8h spec bucket) | 2-3h | §41.12 is the model |
| 3. SPEC §53.14 — type-as-argument family | ~3-4h | 2-3h | §53.6 named-shape registry is the structural model |
| 4. SPEC §34 catalog — 4 error codes | ~0.5-1h | 0.5h | Mechanical pattern (D4 just added 7 codes) |
| 5a. Compiler — parser | ~3-5h estimated | **0h (no-op, see DRIFT-2)** | parseVariant is a regular CallExpression already |
| 5b. Compiler — type-system pass | ~3-5h | **2-3h** | Riding E-ENGINE-004 pattern + typeRegistry.get + EnumType.variants[] + reflect() precedent — primitives all exist |
| 5c. Compiler — codegen monomorphization | ~3-5h | **3-5h** | New emit-parse-variant.ts; serializeTypeEntry extension; emit-machines.ts is the shape model |
| 5d. Self-host shim | ~0.5-1h | **0h (no-op)** | parseVariant doesn't flow through BPP |
| 6. Stdlib parse.scrml + index re-export | ~1-2h | 0.5-1h | Tiny file; convention from validate.scrml |
| 7. (folded into 6) | — | — | — |
| 8. Tests | ~2-3h | 2-3h | Standard scaffolding |
| 9. Primer + kickstarter + inventory updates | ~1-2h | 1-2h | Mechanical |
| 10. Predicate-gaps inventory | (within 9) | 0.25h | Status-flip |
| 11. Kickstarter v2 update | (within 9) | 0.5h | Insert + link |
| 12. Family-precedent doc (NEW) | ~1-2h | 1-2h | Structural |
| **Optional ghost-patterns add** | not in SCOPE | 0.5h | New diagnostic |

**Survey-revised total: ~16-23h** (vs SCOPE ~20-30h). **Conservative discount: ~15-25%.**

If the type-system pass is cleanly co-located with the existing `<engine for=Type>` validation (line 1998-2018) — i.e., reuse `parseEnumValidationCheck(govType, errors, span)` as a helper — the discount widens to **~30-40%** (~14-19h total).

---

## Risks surfaced by survey (beyond SCOPE risk list)

1. **Stdlib-declared enum type cross-file resolution** — `ParseError:enum` lives in `stdlib/data/parse.scrml`. The importing file's typeRegistry must include it (so `parseVariant(...)!{| ::ParseError msg -> ...}` exhaustiveness check can resolve `ParseError`). D4's §21.8 cross-file engine-import via `import { Phase } from './path'` is the relevant precedent — verify the same path works for stdlib protocol prefix `'scrml:data'`. If not, additional MOD/TS work is needed. **Recommend**: validation step 1 of dispatch — write a one-file scrml that does `import { ParseError } from 'scrml:data'; <state>: ParseError = .Malformed("test")` — does the type resolve? If yes, the rest is straightforward. If no, surface as a sub-issue.

2. **`!{}` handler exhaustiveness against ParseError** — depends on TS recognizing the call's failure-type as `ParseError`. The annotation step (TS pass for parseVariant) MUST set the failure-type onto the call-expr node so existing `!{}` codegen picks it up as exhaustively-checkable. This is one extra field to set, not a structural change — but must not be missed. Add to dispatch checklist.

3. **`emitTypeRegistryLiteral` payload-field gap** — currently emits enum variant NAMES only (no payload field info). parseVariant codegen needs payload field names + types. Two paths: (a) extend `serializeTypeEntry` to include `payload: [{name, type}]`, (b) skip the registry serialization and read the EnumType directly off the annotated call-node at codegen time. **Path (b) is simpler and doesn't disturb existing meta consumers.** Recommend (b).

4. **Codegen context — server vs client** — parseVariant is callable from both server and client functions (canonical example calls it from a server function, but client-side parsing of `fetch()` results is also legal). The emit must respect existing server/client codegen splits. Likely free because it's just a synchronous function-shaped call, not an SQL/server-only construct.

5. **Lint-ghost-patterns false-positive risk** if we add `JSON.parse → parseVariant` suggestion: developers legitimately use `JSON.parse` for non-tagged-variant data (config files, untyped responses). Make the lint a "consider parseVariant if parsing tagged variants" warning, not a prescriptive correction. Defer if doubtful — kickstarter-text-only is a fine fallback.

6. **DRIFT-1 + DRIFT-2 cascade** — SCOPE doc references "§10.4" and "parser TypeRef" in multiple places (steps 2 + 5). Implementation dispatch brief MUST correct these references; otherwise an agent following the SCOPE literally will spend hours looking for §10.4 and trying to invent a TypeRef AST node that the compiler doesn't have.

---

## Recommended implementation order

The dependency graph from this survey:

```
1. Lock L22 record (independent)
2. Stdlib parse.scrml ParseError enum (depends on nothing)
   └─> Validate: cross-file stdlib enum import resolves into typeRegistry
3. TS pass: recognize parseVariant call + validate arg2 enum + annotate
   └─> depends on #2 (typeRegistry must contain ParseError for failure-type annot)
4. Codegen: emit-parse-variant.ts (depends on #3 annotation)
5. SPEC §41.13 + §53.14 + §34 entries (parallel; can land before code)
6. Tests (depend on #3 + #4)
7. Primer / kickstarter / inventory updates (parallel; near end)
8. Family-precedent doc (parallel; near end)
9. Optional ghost-patterns lint
```

**Dispatch sequencing recommendation:**

- **Phase 1 (foundation, ~2h):** Steps 1 + 2 + cross-file-stdlib-enum-import validation. Settles risk #1 immediately.
- **Phase 2 (compiler core, ~5-8h):** Steps 3 + 4. Land as one cohesive change with tests for both compile-error and happy-path cases.
- **Phase 3 (spec + docs, ~5-7h):** Steps 5 + 7 + 8. Can run partially in parallel with Phase 2 if SPEC dispatcher is separate from compiler dispatcher.
- **Phase 4 (polish, ~1-2h):** Step 9 (optional lint), final inventory updates, push.

---

## Files referenced (absolute paths)

**Compiler source:**
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/type-system.ts` — `EnumType` (104), `tEnum` (433), `resolveTypeExpr` (1273), engine for=Type validation (1998-2018), `checkEnumExhaustiveness` (5267).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/ast-builder.js` — type-annotation collector (3199-3330), reflect() precedent doc (1977), parseEnumBody (~1494, 994 in type-system).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/meta-checker.ts` — reflect() classification (144-274) — primary type-as-argument precedent.
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/codegen/emit-logic.ts` — `emitTypeRegistryLiteral` (175-188), `serializeTypeEntry` (193-214), match-stmt dispatch (1233-1235).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/codegen/emit-machines.ts` — per-variant compile-time specialization model (719 LOC).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/codegen/emit-machine-property-tests.ts` — same model continued (579 LOC).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/codegen/compat/parser-workarounds.js` — self-host BPP override hook (NOT relevant for parseVariant).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/lint-ghost-patterns.js` — optional lint extension point (492 LOC).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/module-resolver.js` — import resolution (parseVariant must be recognized after MOD).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/src/runtime-template.js:1006` — `meta.types.reflect(name)` runtime accessor (sibling precedent).

**Stdlib:**
- `/home/bryan-maclee/scrmlMaster/scrmlTS/stdlib/data/index.scrml` — re-export hub.
- `/home/bryan-maclee/scrmlMaster/scrmlTS/stdlib/data/validate.scrml` — convention model.
- `/home/bryan-maclee/scrmlMaster/scrmlTS/stdlib/data/parse.scrml` — **NEW (to create)**.

**Tests:**
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/tests/unit/transition-decl-terminal.test.js` — compile-error test pattern (`hasCode`).
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/tests/integration/kickstarter-v2-smoke.test.js` — integration smoke pattern.

**Spec:**
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/SPEC.md` §41.12 (16898) — model for §41.13 entry.
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/SPEC.md` §53.6 (23139) — model for §53.14 family-registry framing.
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/SPEC.md` §34 (13874) — error code catalog.
- `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/SPEC.md` §22 / §47.2 (17672 — `reflect(variable)` runtime decode API) — type-as-argument prior art inside SPEC.

---

## Drift / contradictions to surface to Bryan

1. **DRIFT-1: SPEC §10.4 does not exist** for `scrml:data`. Use **§41.13** (next free slot after §41.12 `registerMessages`).
2. **DRIFT-2: Parser-level recognition is unnecessary.** parseVariant is a regular CallExpression; the special-form recognition lives at TS+codegen. Removes the largest sub-bucket from SCOPE step 5.
3. **Stronger precedent than SCOPE acknowledges:** `reflect(TypeName)` in §22 meta is structurally identical to parseVariant's type-as-argument shape. This is mentionable in the family-precedent doc — parseVariant is not "first" type-as-argument, it's "first OUTSIDE meta-blocks." That framing slightly changes the family-precedent rhetoric but does not change the architectural commit.
4. **`<match for=Type>` is NOT a per-type-codegen-specialization precedent** despite SCOPE step 5's framing. It dispatches at runtime via `_scrml_structural_eq`. The actual compile-time-walks-variants codegen precedent is **`emit-machines.ts`** (engines), not match-stmt. Realign expectations: parseVariant's codegen looks like engine codegen, not match-stmt codegen.

---

## Bottom line

- **Survey discount: 2-3x on compiler-change bucket.** SCOPE's 10-15h compiler estimate is realistically ~5-8h.
- **Total dispatch: ~16-23h** (was ~20-30h).
- **Two specific drift items** in the SCOPE doc must be corrected in the implementation dispatch brief: §10.4 → §41.13 and "parser TypeRef" → no-op.
- **Risk #1 (cross-file stdlib enum import resolution)** is the only structural unknown — should be validated as the FIRST step in any implementation dispatch. ~15min sniff test.
- **Recommended dispatch shape:** single foreground dispatch with the 4-phase order above, OR split spec/compiler/stdlib into 3 parallel dispatches if Phase 2 is the long pole and concurrency is desired.
