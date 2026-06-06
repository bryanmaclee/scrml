# Value-Native Map (§59) — Phase-c Build: Survey Synthesis + Decomposition

**Date:** 2026-06-06 (S169). **Status:** current — the grounded input for the D1–D4 dispatch briefs.
**Basis:** 4 parallel read-only infra surveys (type-system / parser-both-paths / runtime / codegen) against SPEC §59 (lines 31583–31755) + `RATIFIED-DESIGN.md` (M1–M9), at source-current HEAD (maps `4c8063b6`).

> **Headline:** §59 is mostly NET-NEW (not a thin extension), but the discount is large and **asymmetric** — codegen is ~80% pattern-mirror; the genuine net-new mass is the runtime value-canonical hasher + map structure + codec. **Hard ordering: TYPER FIRST.** The survey caught a §59↔§17.7 spec inconsistency (iteration form) — RESOLVED S169 (`<each ... as e>`, §59.8 amended).

---

## Dispatch sequence (the ordering chain)

```
D0  union-`not` normalization (§42.3.1)   [IN FLIGHT — agent a9c3075095363301a]
      ↓ (prereq for the map read-type V|not; blast-radius on [T,not] recognizers)
D1  type-system: MapType + recognition + key-check + E-MAP-BRACKET-WRITE gate   [L, the foundation]
      ↓ (codegen + parser key on rt.kind==="map")
D2  parser: [:] / [k:v] literal + iteration form   [legacy L (Acorn pre-rewrite) / native M]
D3  runtime: value-canonical hasher + map structure + method surface + codec + map-==   [L]
      ↓ (D2 + D3 can run parallel after D1; D4 gated behind D1+D3)
D4  codegen: mapVarNames collector + emit-expr interception + literal lowering + W-MAP-* wiring   [M]
D5  Set follow-on + self-host migration (130 new Map/Set sites)   [decoupled, P3 bridge, NOT a v1 blocker]
```
Every codegen-touching dispatch: S138 R26 empirical verification + Phase-0 confirm-gate. PA-independent dual-verify on landing.

---

## D1 — TYPE-SYSTEM (file: `compiler/src/type-system.ts`, `compiler/src/types/ast.ts`)

| Requirement | Existing / pattern-to-mirror | Net-new |
|---|---|---|
| `[KeyT:ValT]` recognition | `resolveTypeExpr` @1812; array branch `endsWith("[]")` @1907-1910 (`tArray`); inline-struct branch @1939-1972 (`splitTopLevel` on `:` — **the exact pattern to mirror** for K:V split) | **`[string:Money]` resolves to `tAsIs()` today** (fallthrough @1989-1990). No `MapType` in the `ResolvedType` union (@357-374), no `tMap`. Add interface + ctor + recognizer branch (before `[]` + before fallthrough) applying §59.3 depth-1-colon-excluding-ternary; `formatTypeForDiagnostic` @2864 map arm. |
| `@ordered` postfix affix | `collectTypeAnnotation` @ast-builder.js:3815 (bracketDepth-aware); `[label]` after-`)` suffix @3835-3841 is the only postfix precedent | Strip trailing `@ordered` in the map-type branch (set `ordered:true`). Verify lexer treats post-`]` `@ordered` as inline tokens, NOT the reactive `@` sigil. |
| union `V\|not` + §42.3.1 normalization | `tUnion` @593; `isOptionalType` @7805-7811 | **D0 handles this** (spec-only today; `tUnion` does zero flatten/dedup). |
| key comparability / E-EQ-003 | E-EQ-003 lives in **`gauntlet-phase3-eq-checks.js`** (NOT the typer); regex `structBodyHasFunctionField` @100-107 (too weak — do NOT reuse) | Principled `isComparable(resolvedType)` walk over `MapType.key` at the **decl-binding sites** (5807/6074, have span+errors), NOT `resolveTypeExpr` (error-free). Reject function-fields→E-EQ-003, map-key→E-MAP-KEY-IS-MAP, else→E-MAP-KEY-NOT-COMPARABLE. |
| member-access / method typing | `visitNode` @5091 has **NO general member/index/call return-typing** (only E-TYPE-004 struct-field; `.advance` arg-plane special-case) | **Optional for v1** — typer is inference-free; map methods ride the permissive path. `@m[k]→V\|not` read-typing is a net-new `case "index"` arm ONLY if a diagnostic needs it (defer). |
| bracket-WRITE gate | `case "reactive-nested-assign"` @7230-7269; @7244 already does `scopeChain.lookup(rnaTarget)` → `resolvedType` (the S168 widened path) — **the exact insertion point** | Add `if (rt.kind==="map") fire E-MAP-BRACKET-WRITE` (fatal, with `.insert` fix-it) at 7244. Fatal → codegen never sees it → COW path @emit-logic.ts:3026 needs ZERO change. v1: shallow receiver check; deep `@outer[k1][k2]=v` = modest extension. |

**Size L** (one file, ~6 sites, each precedented). **Risks:** stale `path as string[]` casts (@15681 etc. — pre-S168 shape); `@ordered`/reactive-`@` collision. **Open calls (PA-decided):** key-check at decl-binding sites; `@m[k]` read-type deferred; E-MAP-BRACKET-WRITE shallow for v1.

## D2 — PARSER (legacy `expression-parser.ts` / native `compiler/native-parser/`)

| Requirement | Legacy | Native |
|---|---|---|
| array literal / bracket-access | EXISTING (`ArrayExpr` @1821, `IndexExpr` @1639-1662) | EXISTING (`parseArrayLiteral` @parse-expr.js:3327; bracket @1033-1043) |
| `[:]` / `[k:v]` literal | **Acorn REJECTS `:` in `[...]` (verified).** NET-NEW: a hand-written balanced + ternary-aware scanner in `preprocessForAcorn` emitting a placeholder call — **exact precedent `preprocessMatchExprs` @1271-1325** (regex CANNOT do depth-1 + unmatched-`?` exclusion). `[:]` may alternatively be a `readToken` plugin like `scrmlEnumPlugin` @108-128. New `MapLitExpr` node + `esTreeToExprNode` unmask arm. **L.** | NET-NEW but clean — **lexer already emits a clean `Colon`** (@lex-in-code.js:852). Branch in `parseArrayLiteral` @3327: empty `[:]` peek + depth-1 entry-colon (ternary-excluded). `MapLit`/`MapEntry` ExprKind + `translate-expr` arm. **M.** |
| bracket-read `@m[k]` | NO change (map-vs-array is at the typer) | NO change |
| bracket-WRITE | NO change (typer gates) — routes through `collectAtPathSegments` @ast-builder.js:2523 → reactive-nested-assign | **Pre-existing native gap:** native does NOT promote `@arr[i]=x` to reactive-nested-assign/COW at all (`Assignment`→`makeBareExpr`). Under `--parser=scrml-native` neither COW nor E-MAP-BRACKET-WRITE exists. Decouple if native stays shadow-only at ship. |
| iteration `<each ... as e>` | **S169 RULING:** rides shipped §17.7 `<each in=@m.entries() as e>` + `e.key`/`e.value` (`.entries()`→`[{key,value}]` structs). Optional `as (k,v)` positional-destructure (§14.11) = a small `as`-clause add (`readAsName` @ast-builder.js:12097 is single-ident today). The `(k,v) in` tuple-opener is **REJECTED** (§59.8 amended). | same `as (k,v)` add in `synthEachBlockNode`/`readAsName` @parse-file.js:967 |
| method calls `.insert`/`.entries()` | NO change | NO change |

**Open call (PA):** the legacy `[k:v]` admission is placeholder-rewrite (general form) + optional `readToken` plugin (`[:]` only). The `as (k,v)` destructure is a small add atop the shipped `as name`.

## D3 — RUNTIME (file: `compiler/src/runtime-template.js` — authoritative; `dist/scrml-runtime.js` is STALE tree-shaken, do NOT touch)

| Requirement | Existing / template | Net-new |
|---|---|---|
| cycle-safe value walker | `_scrml_structural_eq` @2491 + the S168 WeakMap-pair seen-guard @2503-2511 (array/enum-`_tag`/struct dispatch) — **the walk shape to mirror** | the value-canonical walker mirrors this but emits a STRING + alpha-sorts struct keys |
| **value-canonical hasher (THE cost driver)** | FNV-1a-32 @`codegen/fnv1a-hash.ts:82` (prime 16777619 / offset 2166136261 — NORMATIVE) but **compile-time TS over `ResolvedType`**; `normalizeType` @`codegen/type-encoding.ts:180` is the alpha-sort+recursion template but **type-level not value-level** | **FULLY NET-NEW** runtime `_scrml_value_canonical(v)` (transcribe FNV-1a into runtime; walk LIVE values: primitives by literal form, struct keys `Object.keys().sort()`, enums `tag(payload)`, arrays element-ordered). Acyclic precondition satisfied (no own cycle-guard needed). **`_scrml_value_indexed_key` @594 is primitive-only — NOT this; do not conflate.** |
| reassignment-canonical write | `_scrml_reactive_set` @426 (the precedent every map method mirrors); `_scrml_deep_set` @1543 (COW — the path maps FORBID, route AROUND) | map methods build a new map + hand to `_scrml_reactive_set` |
| §57 absence-envelope codec | encoder `wire-format.ts:184` (`{__scrml_absent:true}`); decoder `_scrml_wire_decode` @710 (scalar/shallow) | `_scrml_map_encode`/`decode` = entries-array container + per-value §57 envelope reuse + canonical ordering |
| map structure + method surface | NONE (no value-native collection runtime; zero `_scrml_map_*`) | **FULLY NET-NEW.** Recommend: plain JS object keyed by **full canonical-string**, storing `{k,v}` entries, clone-on-write (matches array reassignment; `.insertAll` = one bulk clone). **Defer HAMT.** Full-canonical-string keying = collision-free for distinct values (no bucket-`==` needed). |

**Load-bearing design calls (PA):** (i) value-canonical literal-form must be byte-exact (`1` vs `1.0`, `-0`, string escaping — hash-consistency sharp edge); (ii) plain-object full-canonical-string keying, clone-on-write, defer HAMT; (iii) **`@ordered` needs an explicit `_order` sidecar** — JS objects iterate integer-ish keys in numeric (not insertion) order → unordered default = no sidecar (consistent with "unordered+loud"), `@ordered` = `_order` array maintained per write (the "visibly costs more"). Register new `_scrml_map_*` chunk markers @`runtime-chunks.ts:218`.

## D4 — CODEGEN (file: `compiler/src/codegen/*`) — ~80% pattern-mirror

| Requirement | Existing / template | Net-new |
|---|---|---|
| **type-at-emit-site** | **NO — codegen re-parses exprs, has NO resolved type** (`emitIndex` @emit-expr.ts:1109 is pure syntactic). `EmitExprContext` carries NAME-SETS only | mirror `engineVarNames`: a `mapVarNames: Set<string>` collected by an AST walk (mirror `collectEngineVarNames`), threaded via `EmitExprContext` (populate @emit-reactive-wiring.ts:266/312, index.ts:805) |
| bracket-read lowering | `emitIndex` @1109 | guard `if (mapVarNames.has(root)) → _scrml_map_get(...)` (returns `V\|not` → JS `null` on miss, to compose with `given`/`is some` @645-668) |
| bracket-WRITE COW | reactive-nested-assign @emit-logic.ts:3003-3027 | **ZERO change** (map write is typer-fatal before COW) |
| method lowering | **`.advance` interception @emit-expr.ts:1158-1170** (gate on `engineVarNames.has(bare)`) — **the exact template** for map methods | intercept in `emitCall`, gate `mapVarNames.has(bare)` → `_scrml_map_insert(...)` etc. (pure, returns new map) |
| reactivity via reassignment | `emitAssign` @930-1003 → `_scrml_reactive_set` | ZERO new reactivity |
| §34 codes (7) | E-EQ-001/003 in `gauntlet-phase3-eq-checks.js`; info-partition enforced ONCE @api.js:2403-2407 (`W-`/`I-` prefix → `result.warnings`, free) | E-MAP-KEY-* in the gauntlet eq-checks sibling; E-MAP-BRACKET-WRITE in typer (D1); E-MAP-LITERAL-MALFORMED in parser (D2); W-MAP-* at the relevant walk sites |

**Open call (PA) — Q1 nested-map read `@outer["a"]["b"]`:** the inner map-ness is a VALUE type invisible to the name-set. Options: (a) `_scrml_map_get` runtime-dispatches gracefully on non-map; (b) recurse-on-chain when the root is a known map. Decide before the emit-expr guard. **Codegen is strictly gated behind D1 (typer registers `rt.kind==="map"`) + D3 (the `_scrml_map_*` helpers must exist + survive tree-shaking).**

---

## Provenance
Survey agents (read-only, opus): type-system `a23f5d080f1ebfe78`, parser `a34d06ce347f10d56`, runtime `ac93f40cf8b88954b`, codegen `a65c5ee7c7178ba59`. Full reports in the S169 session transcript. Authority: SPEC §59 + `RATIFIED-DESIGN.md` (M1–M9) + user-voice S167/S168/S169.
