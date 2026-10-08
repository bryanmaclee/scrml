# PLAN — s458-refinement-every-position (Phase 0)

Base: origin/main `46ed1f8ff`. Nothing in `compiler/` changed. Reproducers: `repro/` (sources.mjs = 36 probes,
run.mjs = compile, exec.mjs = execute, two-readers.mjs, corpus-census.mjs). Re-run with
`bun docs/changes/s458-refinement-every-position/repro/run.mjs && bun docs/changes/s458-refinement-every-position/repro/exec.mjs`.

## 0. Short version

- **All nine positions reproduce, executed.** I also found **two more**: a struct-typed server parameter (its fields are
  never judged; `{u:"javascript:…", n:-1}` gets a 200), and a refined derived cell (`const <d>: number(>=0) = @c*2` has no
  check when it recomputes).
- There is **no single cause. There are four, and they share one shape:** the check depends on *which emitter* handles
  the code, not on *what the program writes*.
  - **C1:** no stage asks "what declared type does this value flow into?" — except at a declaration with its own
    annotation.
  - **C2:** the checks are hung on emitters. 2 of 6 function emitters write a parameter prologue, 2 of 3 declaration
    emitters write a check, and 1 of 4 return paths does.
  - **C3:** there are two predicate readers, and the codegen one drops enum subsets.
  - **C4:** the judge fails open (`if (!(true))`).
- **Root design:** one TS-stage pass decides every refinement obligation. It *desugars* each one into the AST as a
  call-shaped node, using the parseVariant precedent. Every emitter then emits the check without having to know about
  it. There is one reader (TS), one type-directed judge, and fail-closed defaults at three layers.
- **Corpus blast radius of the nine positions: 0 files newly refused at compile, and 0 runtime sites added.** The corpus
  has no refined reassignment, struct field, payload, return, lib/tool/worker parameter or literal argument. This is not
  evidence of low demand (the corpus is 100% LLM-authored). The real blast radius is in the **predicate-form axis**: 112
  struct-field annotations in shared-core form that the reader does not read today (§7 ruling R4).

## 1. Governing sentences, per position (SPEC §53 read in full, 39698-40961)

| # | position | governing sentence(s) |
|---|---|---|
| all | — | §53.3.1: "It is evaluated as a pure boolean expression over the incoming value **at every assignment or binding site**." · §53.11 E-CONTRACT-001-RT: "The compiler SHALL emit a runtime check for every boundary-zone assignment that it cannot statically elide." · §53.4.5: "The check SHALL be emitted at the assignment site, not at a later use site." |
| 1 | reassignment `@u = v` / `x = v` | §53.3.3: "When a value is assigned to a variable of a constrained type, the compiler performs an assignment-site check … the compiler-generated check SHALL throw a runtime error with code `E-CONTRACT-001-RT` before the assignment is applied. The variable retains its prior value." · §53.4.4 trusted zone ends when the value is "Reassigned from a new unconstrained source". · §53.6.2: "the type predicate fires at every assignment regardless of whether the cell is form-coupled." |
| 2 | struct fields | §53.2.2 lists "struct field: `type Invoice:struct = { amount: number(>0 && <10000) }`" as a usage position. · §53.15.2 static row `{ role: .Viewer }` → "compile error"; boundary row `return Post { title: row.title, role: row.role }   // boundary: runtime check → E-CONTRACT-001-RT`. · §55.1 table "Struct-field / refinement type … §53.4 three-zone (the cell CANNOT hold out-of-subset)". |
| 3 | `const X: T = f()` | Same as row "all", plus §53.2.2 "variable declaration: `let x: number(…) = expr`" (`const` is a variable declaration; §53.4.3(1) "raw function return value" is the boundary zone). **Found broader than briefed:** *every* `const` is unchecked, at any depth, not only top-level. |
| 4 | `<endpoint>` payload / `<api>` response / `parseVariant` | §61.3: "the variant's payload fields are decoded with §53 refinement enforcement". · §60.5: "refinement types (§53) on the response shape are enforced at the decode". · §41.13: "`InvalidPayload(field, reason)` — a variant's payload field has the wrong type **or fails a payload predicate**". · §61.5: the decode failure is the 400 `{ error: { kind, message } }`. · §55.3: "the runtime inserts boundary checks where it cannot (function entry, **deserialization boundaries**)". |
| 5 | schema / table fields | §41.15 (line 30336): "The struct's refinement-type predicates lower to SQL `CHECK` constraints automatically". · §53.15.2 boundary row: "a full-`Role` value from **DB** / network / … narrowed to the subset → Runtime … check emitted at the assignment site". · §39.5.7 table: "Refinement type (§53) — Compile-time + runtime boundary". **SPEC is silent** for a predicate with no SQL form (`url`, `email`, …) and for what a row-set load does on one bad row → ruling R1. |
| 6 | server fn refined return | §53.9.3: "The compiler SHALL verify that all return expressions satisfy the constraint, applying the three-zone model to each return site." (no client/server carve-out) · §53.15.2's `function loadPost … return Post {…}` example is a server function. **SPEC is silent** on the HTTP status of a non-parameter server-side E-CONTRACT-001-RT → ruling R2. |
| 7 | library / tool / value-export params | §53.9.1: "The compiler SHALL emit a runtime check when the function is called with an unconstrained argument" (callers of a library/tool are foreign, so every call is unconstrained). · §55.3 "function entry". |
| 8 | literal call argument | §53.4.2 rules 1-2 (literal → statically proven/refuted) + §53.3.1 "binding site" + §53.12.3 worked example "Call site: 10 is a literal, 10 > 0 && 10 < 500 — static zone, no check" + §53.11 "The compiler SHALL emit E-CONTRACT-001 when a literal value is assigned to a constrained type variable and the literal demonstrably fails the predicate." |
| 9 | nested worker `<program>` fn param | §53.9.1 (same as 7). The §53.6.1 impl-status paragraph already names the worker *declaration* as checked. The parameter is not checked. |
| 10 (new) | refined derived cell | §53.15.3: "Return types and reactive derived `const` cells follow the same three-zone rule". · §55.14: "add a refinement type (`const <x>: number(>=0) = ...`) — that is the type-level invariant equivalent." The derived-cell failure behaviour is **SPEC-silent** → ruling R3. |
| 11 (new) | struct-typed server param (deep) | §53.9.4: "A server function's parameter constraint cannot be bypassed by raw HTTP requests." + row 2. |

Searched and found consistent (not gaps): §60.5 *non-variant* `<api>` ResponseT is raw-passed **by rule** (W-API-RESPONSE-NOT-VARIANT); §53.15.7 engine `for=` subset DEFERRED.

## 2. Reproduction on origin/main (all executed; see `repro/exec.mjs`)

| # | probe | observed | expected |
|---|---|---|---|
| ctl | c0 decl `let q: string(url) = v` · c1 client param · c2 server param · c3 client `-> string(url)` | REFUSED / 400 | ✓ (these are the checked positions) |
| 1a | `@u = v` | ACCEPTED, cell set to `javascript:alert(1)` | refused, cell keeps prior |
| 1b | `let q: string(url) = …; q = v` | ACCEPTED | refused |
| 1c | `@u = "javascript:alert(1)"` (literal) | compiles clean; ACCEPTED | E-CONTRACT-001 |
| 2a | `const l: Link = { u: v, n: k }` | ACCEPTED `{u:"javascript:…",n:-5}` | refused |
| 2b | `const l: Link = { u: "javascript:…", n: -1 }` | compiles clean | E-CONTRACT-001 (control: the enum-subset struct literal **does** get E-CONTRACT-001 → only §14.10 bare-variant inference reaches struct fields) |
| 2d | `l.u = v` | ACCEPTED | refused |
| 3a | top-level `const X: string(url) = pick()` | `const X = _scrml_pick_2();` no check | refused |
| 3b | fn-local `const q: string(url) = v` | ACCEPTED | refused |
| 4a | `<endpoint>` POST `{tag:"Save",link:"javascript:…"}` / `{tag:"Count",n:-5}` | **200** `{"saved":"javascript:alert(1)"}` / **200** `{"n":-5}` | 400 InvalidPayload |
| 4b | `parseVariant(raw, Req)` | payload guard is only `typeof _v["link"] === "string"` | InvalidPayload |
| 4c | `<api>` response `Found(link: string(url))` | same guard | `.error` |
| 5a | `schemaFor(Link)` with `n: number(>0)` | the predicate is dropped (code: `emit-schema-for.ts:311` "fall through to the primitive base type") | CHECK (n > 0) per §41.15; `url` → R1 |
| 5b | `< Link table=…> url: string(url)` | `SELECT * FROM links` → `@links` with no judge | per R1 |
| 6 | `server function make(v) -> string(url)` | **200** `"javascript:alert(1)"` | refused (status per R2) |
| 7a | `--mode library` `export function take(u: string(url))` | ACCEPTED | refused |
| 7b | `kind="tool"` `take(u: string(url))` from argv | exit 0, prints `javascript:alert(1)` | refused |
| 7c | in-app `export function` param | checked (client path) — **does not reproduce in app mode**; reproduces in library mode (7a) | — |
| 8a/8b | `take("javascript:…")` / `take(-5)` literal | compiles clean; throws E-CONTRACT-001-RT at runtime | E-CONTRACT-001 at compile |
| 9 | worker `function check(u: string(url))` | ACCEPTED, replies `javascript:…` (the check is in `app.client.js`, which never runs it; the worker bundle has none) | refused |
| 10 | `const <doubled>: number(>=0) = @count * 2`, count = -5 | no check on recompute | refused |
| 11 | `server function save(l: Link)`, `{l:{u:"javascript:…",n:-1}}` | **200** | 400 |
| f2/f4 | `promote(r: Role oneOf([.Admin,.Editor]))` client / server | ACCEPTED `"Viewer"` / **200** `"Viewer"` | refused / 400 |
| f3/f5/f6 | `let e: string(pattern(/…/)) = v` · `let e: string(ssn) = v` · `let n: number(min(0) && max(100)) = v` | compiles clean; emitted `if (!(true))`; ACCEPTED | f3/f6 per R4; f5 E-CONTRACT-002 (§53.6.3) |
| f1 | `take(n: number.min(0).max(100))` (§53.6.1's own example) | asIs: no check, no diagnostic | per R4 |

LOW gap reproduced in code (not executed): `emitServerParamCheck` builds `value: String(param)`, and `emitRuntimeCheck`
builds `"Value: " + String(v)`. Both throw on `{toString:1}`.

## 3. Trace — where §53 checks ARE emitted today, and why the nine are missed

**Decision paths that exist:**

1. **Declaration (TS decides).** `type-system.ts` `case "let-decl"/"const-decl"` (~11093) and `case "state-decl"` (~11620):
   annotation → `resolveTypeExpr` → `PredicatedType` → `classifyLiteralFromExprNode` / `extractInitLiteral` →
   `upgradeSourceInfoForPredicatedIdent` → `classifyPredicateZone` (3958; static calls `checkPredicateLiteral` 3397,
   which is the ONLY place E-CONTRACT-001/-002/-003 fire) → stamps `node.predicateCheck = {predicate, zone}`.
   Codegen: `emit-logic.ts` let-decl (2384, 2403) and state-decl (3113, 3129) emit `emitRuntimeCheck` when
   `zone === "boundary"`. **const-decl (2420+) never reads `predicateCheck`** → position 3 (all consts).
2. **Client parameter (codegen decides).** `emit-functions.ts emitClientParamChecks` (137) re-parses `param.typeAnnotation`
   with `parsePredicateAnnotation` (the codegen mirror reader) → `emitRuntimeCheck`. Only the top-level client function
   emitter calls it.
3. **Server parameter (codegen decides).** `emit-server.ts` 4839 (CSRF path) and 5124 (non-CSRF path): the same mirror reader →
   `emitServerParamCheck` (400). Route handlers only.
4. **Return (codegen decides).** `emit-logic.ts case "return-stmt"` (3146) reads `opts.returnTypeAnnotation`. That
   option is threaded only by `emit-functions.ts:1582-1640` / `scheduling.ts:967` (the client top-level path). The server
   handler, worker, tool and library never pass it → position 6.
5. **bind:value input (codegen decides).** `emit-bindings.ts` 630/1076 + `emit-html.ts` 3156, using the mirror reader.
6. **Decode (codegen decides NOT to).** `emit-parse-variant.ts emitTypeGuard` (~line 80): for a `predicated` payload it
   checks the base type only, with an explicit comment saying predicate enforcement "happens at assignment to a typed
   cell". That contradicts §61.3, §60.5 and §41.13. A single function (`emitParseVariantDecodeIIFE`) serves
   `parseVariant`, `<endpoint>` (emit-server 5668) and `<api>` (emit-reactive-wiring 2474), so fixing it covers all
   three.

**Structural causes (four, one shape):**

- **C1 — no write-site question.** Only a declaration node is asked "is my type refined?", and only by its *own*
  annotation. A reassignment is AST-shaped as an *unannotated* `state-decl` (emit-logic 4843: "`@x = expr`
  reassignments … are AST-shaped as state-decls"); a local `x = v` is a `tilde-decl`; field writes, object-literal fields,
  call-argument bindings, returns, payloads, derived recomputes and DB rows are not decls at all. **TS already answers
  "what type is fixed at this position" for the same positions**, in the §14.10 bare-variant machinery: the prior-bind
  lookup for `@cell =` (11838), the annotated prior for `x =` (13346), `callArgFnSignatures` for arguments (9462), the
  return context, and struct-literal fields. That is how p2c (enum-subset struct literal) gets its E-CONTRACT-001 while
  p2b (`string(url)` struct literal) does not. The §53 judge was never wired to those position answers.
- **C2 — the checks belong to emitters, not to the program.** Function-like emitters: emit-functions (client top-level,
  ✓ params, ✓ return), emit-server route handler (✓ params, ✗ return), emit-logic `case "function-decl"` (4829; nested
  fns, worker bodies via emit-worker 74, server helpers: ✗ both), emit-tool (714/926, its own signature: ✗), emit-library
  (raw-text path plus `cleanFnSignatures` regex type-strip at 1620: ✗). Each new bundle shape (worker, tool, library) silently
  opted out.
- **C3 — two readers.** TS `resolveTypeExpr`/`parsePredicateExpr` (1729) for decls; the codegen
  `parsePredicateAnnotation` + `parsePredicateExprInternal` (emit-predicates 446-546, "mirrors type-system.ts", a regex
  over the annotation string) for params, returns, server params and bind:value. The mirror rejects every non-`number|
  string|integer|boolean` head, so **enum-subset parameters are never checked, client or server** (f2/f4). `repro/two-readers.mjs` prints both readers side by side.
- **C4 — the judge fails open.** `predicateToJsExpr` returns `"true"` for an unknown named shape, an `error` node and the
  default case. E-CONTRACT-002/-003 fire only inside `checkPredicateLiteral`, i.e. only in the static zone. So a
  boundary-zone `string(ssn)` / `string(pattern(…))` / `number(min(0)…)` compiles clean to `if (!(true))` (f3/f5/f6),
  and `number(0 < value < 10)` (the §53.2.1 EBNF range form) or `number.min(0).max(100)` (§53.6.1's example) resolve to
  `asIs`: no check and no diagnostic.

The PA hypothesis locus held and was refined. `emit-predicates.ts`, the zone classifier and parseVariant are the right
three. The "zone classifier" is `classifyPredicateZone`, and it is sound. The defect is that only 2 of the roughly 12 write
kinds ever reach it. A fourth locus the hypothesis did not name is the codegen mirror reader.

## 4. Root design — refinement obligations, decided once, desugared into the program

**One decider (TS stage).** A new module, `compiler/src/refinement-obligations.ts`, is invoked from `runTS` in the same
walk positions that already stamp `predicateCheck` and run §14.10 inference. It has one function,
`targetTypeAt(site, scopeChain, fnSignatures, typeRegistry)`, which returns the declared type a value flows into for every
site kind:

| site | target type source (already known to TS) |
|---|---|
| decl init (`let`/`const`/state/derived) | own annotation |
| `@x = e` (unannotated state-decl) / `x = e` (tilde-decl) / compound assignment | prior binding's `resolvedType` (scope lookup, as at 11838 / 13346) |
| `o.f = e` / `@o.f = e` | struct field type of `o`'s declared type |
| object-literal field (`{ f: e }`, `T { f: e }`) whose literal has a target struct | field type (recursive, with arrays / `T \| not`) |
| call argument | `callArgFnSignatures` param type (local + imported) |
| `return e` | enclosing fn return type (incl. server, worker, tool, library) |
| function parameter (entry) | own annotation (deep for struct params) |
| decode payload field | `VariantDef.payload` ResolvedType (parseVariant / endpoint / api) |
| DB row → table/struct-typed cell | the row type (after R1) |

For each site whose target type contains a refinement *anywhere*, the decider calls the existing
`classifyPredicateZone`. A **static** result fires E-CONTRACT-001 now (new: 1c, 2b, 8, return literals). A **trusted**
result does nothing. A **boundary** result records an **obligation**. Obligations are **desugared into the AST**:

- **Expression sites** (assignment RHS, object-literal field values, return expressions, derived expressions) are wrapped
  in a call-shaped ExprNode: `{ kind: "call", callee: ident "__scrml_refine__", args: [e], refine: { type, where } }`.
  This is the `parseVariant` precedent (annotated CallExpr + an `emitCall` dispatch). Every existing walker (deps,
  reactive-deps, CPS/auto-await, each-row clone, bare-variant inference) already descends a call's args, so no walker
  learns a new node kind.
- **Parameter sites** get a synthetic guard statement prepended to the function body. Every function emitter already
  emits body statements through `emitLogicNode`, so the prologue appears in client, server-handler, nested, worker, tool
  and library-AST functions without any of them knowing about it. The failure mode comes from emitter context: inside a
  server route body it is `return new Response(400 …)` (the existing `emitServerParamCheck` shape, which already runs inside the
  body IIFE whose result is checked `instanceof Response`); elsewhere it is `throw`.
- **Decode payload fields:** `emitTypeGuard` adds `&& <judge>` for `predicated` field types → `InvalidPayload`.
  This is codegen-side because the decoder is generated per enum, but it reads the TS-resolved payload types and uses
  the same judge.

**One reader, one judge.** `parsePredicateAnnotation` and its mirror parser are deleted. Every consumer
(emit-functions, emit-server ×2, emit-logic return/let/state, emit-bindings ×2, emit-html, usage-analyzer) reads the TS
`ResolvedType` from the obligation or node. `emit-predicates.ts` keeps `predicateToJsExpr` and gains a **type-directed**
`emitJudgeExpr(type, valueJs)`: predicated → the predicate; struct → per-field AND of judges; array → `.every`;
`T | not` → `v === null || judge` (absence); enum-subset → `.includes`. `_scrml_url_shape_ok` stays the one `url`
judge.

**Fail-closed defaults (three layers):**

- **F1 (reader).** An annotation the TS reader classifies as refined but cannot judge (unknown shape, a `min`/`pattern`
  head mis-read as a shape, an external ref) is E-CONTRACT-002/-003 **at the declaration, in every zone**, not only for
  literals. `predicateToJsExpr` loses its `"true"` fallbacks and throws an internal compiler error instead.
- **F2 (emission).** The sentinel callee `__scrml_refine__` can never legitimately reach output. A post-emit scan of every
  bundle (client, server, worker, tool, library, value-only) for `__scrml_refine__` is a hard internal error. Any emitter
  that emits the AST faithfully either lowers it or leaks the sentinel, and the scan catches the leak. The library
  **raw-text path** cannot see AST nodes, so a function carrying obligations is forced onto the AST member path
  (`emitLibraryFnMember`). If `rawFallbackReason` says it cannot take that path, that is a compile error, not an
  unchecked emit.
- **F3 (helper delivery).** The judges are inline JS, so the only runtime helper is `_scrml_url_shape_ok`. Generalize
  emit-tool's `sig → source` table (emit-tool 390) into one shared non-client table, consumed by server, worker, tool
  and library. Add the fail-closed unmet-`_scrml_*(`-reference scan that emit-library already has (`unmetRuntimeHelperRefs`,
  415) to every non-client bundle. This also closes `g-worker-bundle-runtime-helpers-not-inlined-s457`
  (`_scrml_structural_eq`, `_scrml_map_from_entries`).

**How each position falls out:**

- (1) the reassign site gets a target type from the prior bind → wrap.
- (2) object-literal fields and field writes have a struct field target → wrap. (11) the param guard is deep.
- (3) `const` is just a decl site. The emit-logic const-decl drop disappears because no decl emitter emits checks any more;
  the wrap is in the expression.
- (4) `emitTypeGuard` + the judge.
- (5) the row read is an expression site (the user's `@rows = ?{…}` → wrap). The §52 `serverLoad` generator calls
  `emitJudgeExpr` on rows (R1).
- (6) the return wrap lives in the AST, so the server body gets it.
- (7)/(9) the prologue is a body statement.
- (8) the static zone at the argument site.
- (10) the derived expression is a wrap site (R3 semantics).

**Runtime cost.** One O(1) boolean per refined write. `url` costs a WHATWG parse (µs). A struct judge is O(fields), and an
array-typed refined target is O(n) per write (a `Link[]` cell reassigned from a DB load is O(rows) per load). There are no
checks on reads. Entry checks stay always-on for functions with foreign callers (server, library, tool, worker, exported).
§53.9.2 caller-side elision is an optimization, not this arc.

**Failure reporting (closes the LOW gap).** The judge's failure path never coerces the value. It reports `typeof` plus
`JSON.stringify` for primitives only. That is non-throwing, and it does not echo an attacker object into the 400 body.

**Files** (estimate; † = deletion-heavy):

- NEW `refinement-obligations.ts`.
- `type-system.ts`: invoke the pass; F1; stop stamping `predicateCheck` or keep it as metadata only.
- `codegen/emit-predicates.ts`†: drop the mirror reader; add the type-directed judge and three fail modes.
- `codegen/emit-expr.ts`: the `emitCall` dispatch.
- `codegen/emit-logic.ts`†: the let/state/return check emission goes; guard-statement lowering is added.
- `codegen/emit-functions.ts`†: `emitClientParamChecks` goes.
- `codegen/emit-server.ts`†: two param sites go; serverLoad row judge added.
- `codegen/emit-parse-variant.ts`.
- `codegen/emit-library.ts`: forced AST path / refusal.
- `codegen/emit-tool.ts` and `codegen/emit-worker.ts`: shared helper table + scan.
- `codegen/emit-bindings.ts` and `emit-html.ts`: switch to the TS type.
- `codegen/usage-analyzer.ts`.
- `codegen/emit-schema-for.ts`: lowerable predicates → CHECK (R1).
- `runtime-template` / the derived runtime (R3).
- SPEC §53.6.1 impl-status paragraph and the §34 catalogue (one internal code for F2).
- Tests: an executed unit test per position, plus a `refinement/` conformance pos/rt pair per position.

## 5. Direction of change, per position — measured population (`repro/corpus-census.mjs`, 2418 files compiled-scanned)

Census: 131 refinement-shaped annotations in 67 files. **Base-form `T(pred)` = 16, all at already-checked positions**
(13 state-cell, 5 param, 1 derived; all in samples/ + conformance/). There are **0** reassignments of a refined
cell/local, **0** literal arguments to a refined parameter, **0** refined enum payloads, **0** refined returns, **0** refined
lib/tool/worker parameters, and **0** base-form refined struct fields. Every carrying file was compiled on base (codes recorded in
the census output). The 16 base-form files keep their base result.

| # | direction | corpus population (newly refused at compile / sites gaining a runtime check) |
|---|---|---|
| 1 reassign | semantics-changed (a write that succeeded now throws; cell keeps prior) + newly-rejecting (literal) | 0 / 0 |
| 2 struct field | semantics-changed + newly-rejecting (literal field) | base-form: 0 / 0 (shared-core forms: R4) |
| 3 const | semantics-changed | 0 / 0 |
| 4 endpoint / parseVariant / api | semantics-changed (200 → 400 InvalidPayload; `.data` → `.error`) | 0 / 0 |
| 5 schema / table | semantics-changed (DDL gains CHECK; row loads judged), per R1 | 0 / 0 |
| 6 server return | semantics-changed (200 → R2 status) | 0 / 0 |
| 7 lib/tool/export param | semantics-changed | 0 / 0 |
| 8 literal arg | newly-rejecting (compile) | 0 / — |
| 9 worker param | semantics-changed | 0 / 0 |
| 10 derived cell | semantics-changed (R3) | 0 / 1 (`conformance/cases/forms/derived-refinement-type-accepted`, compile-only, unaffected) |
| 11 struct server param | semantics-changed (200 → 400) | 0 / 0 base-form |
| enum-subset params | semantics-changed | 0 / 0 (subsets appear only on cells and struct fields) |
| F1 unjudgeable annotation | newly-rejecting (compile) | 0: the 2 fail-open annotations (`string(ssn)`, `<=@maxMana`) are conformance negatives that already error |

**The population that is NOT zero is the predicate-form axis (R4).** There are 112 struct-field annotations in shared-core /
`Enum req` form (`string req length(<=80)`, `string req pattern(/…/)`, `boolean req`, `Role req`, `integer min(0)`) in 37
files: formFor / schemaFor / tableFor / match conformance cases, examples 07/26/27, samples schemaFor-basic /
tableFor-basic, and stdlib/data/table-for.scrml. The TS reader returns `asIs` for all of them today, so the root design
leaves them **unchanged** (no obligation, and F1 does not fire, because the reader does not classify them as refined). If R4 rules them §53
refinements, the write sites that gain runtime checks are:

- 6× `server function persistSignup(values: Signup)`: 200 → 400 on an invalid raw-HTTP body. The formFor gate already blocks it client-side.
- 11× `fn label(p: Post)`: entry check on `role: Role req`.
- 1 ctor (`User{ name: "Ada", … }`): passes statically.
- 1 `User[] = []` decl: passes statically.

Compile-time newly refused: 0.

## 6. Size estimate (survey-first discount stated)

| piece | LOC (code) |
|---|---|
| obligation pass (`targetTypeAt` × 9 site kinds, deep type walk, desugar) | 600-1200 |
| one judge (type-directed, 3 fail modes) + deleting the mirror + rewiring ~9 consumer sites | 300-600 net |
| decode payload | 30-80 |
| library forced-AST/refusal + shared helper table + unmet scan in 4 bundles | 150-350 |
| schemaFor CHECK lowering + serverLoad row judge (after R1) | 150-350 |
| derived cells (after R3) | 50-200 |
| tests (executed unit per position + ~22 conformance pos/rt) | 800-1500 |

**Raw: ~2.1k-4.3k LOC.** What I did NOT trace, any of which can multiply the work:

- the downstream walkers' reaction to the call-shaped wrap (DG / CPS auto-await / reactive-deps / each-row clone /
  `_wrapDeepReactive`);
- `fn`-shortcut implicit returns (`emitFnShortcutBody`, `hasReturnType`);
- the native-parser path's annotation strings;
- compound assignment (`+=`) and destructuring writes;
- §52 server-authority write paths beyond the one load route;
- cross-file imported refined signatures at the server boundary.

Discounted: **3k-10k LOC, 3-8 dispatch rounds** at the S455-S457 review cadence (each of those arcs needed 3-6 review rounds).
Excluding R4 (the shared-core reader: three surface forms plus the cross-field contradiction) keeps it at the low end. R4 is
its own arc: +1-3k LOC.

**Recommended phasing:**

- **Phase 1** = the decider + one reader + one judge + F1/F2/F3 + positions 1-4, 6-11 + enum-subset params. These are all
  SPEC-SHALL with no ruling needed.
- **Phase 2** = position 5 (after R1) + derived semantics (after R3).
- **Separate arc** = R4.

## 7. Rulings the SPEC does not settle (reported, NOT decided)

- **R1: predicates with no SQL form at the DB boundary.**
  - The conflict: §41.15 says refinement predicates "lower to SQL CHECK constraints automatically". `url` / `email` /
    `uuid` / `phone` / `date` / `time` / `color` have no portable CHECK. SPEC is also silent on what a row-set load
    (`< T table=>` serverLoad, `@rows = ?{…}`) does when one row fails.
  - Options: (a) schemaFor rejects a non-lowerable refined field (E-SCHEMAFOR-NO-SQL-MAPPING); (b) lower the column to
    its base type and enforce at the scrml read/write boundary; (c) silent drop (today; forbidden).
  - **Rec: (b)** + lowerable predicates → CHECK + a failed row fails the whole load (500 + E-CONTRACT-001-RT naming the
    row index). Never drop a row silently.
- **R2: HTTP status for a server-side E-CONTRACT-001-RT that is not a parameter check** (body decl, return,
  reassignment). §53.9.4 fixes the 400 for parameters only. **Rec: 500**, because the server broke its own promise. The
  body says E-CONTRACT-001-RT without the value.
- **R3: a refined derived cell whose recompute fails.**
  - The conflict: §53.3.3 says "The variable retains its prior value". For a derived cell that means a stale value that
    no longer matches its inputs.
  - **Rec:** throw E-CONTRACT-001-RT at the recompute and retain the prior value (the literal SPEC). Ask whether a
    derived cell should instead become absent (`not`).
- **R4: shared-core vocabulary in refinement-type position.** §53.6.1 says it "MAY appear … Compile-time + runtime boundary check", but:
  - **(i)** SPEC shows **three surface forms**: dot-chain `string.req.length(>=2)` (§53.6.1), in-paren
    `number(min(0) && max(100))` / `string(pattern(/…/))` (§55.3), and space-separated `string req length(>=2)` /
    `Role oneOf([…]) req` (§41.14, §41.15, §53.15). The §53.2.1 EBNF admits **none** of them. Impl#1 reads only the enum-subset one.
  - **(ii)** §53.6.1 bullet 3 allows `gte(@startDate)` ("a reactive-aware refinement-type predicate"). That **directly
    contradicts** §53.3.1 / §53.8.3 / E-CONTRACT-003 ("SHALL NOT access … Any reactive variable").
  - **(iii)** Are `:struct` field shared-core annotations §53 refinements (§53.6.1 example, §55.1 table: yes) or §55
    validators only (how formFor/schemaFor consume them today)?
  - **Rec:** they are refinements. Pick one canonical surface form (space-separated, which is the corpus form and the
    §41.14/§53.15 form) plus the in-paren form. Rule cross-field args OUT of type position (keep §53.3.1; cross-field
    belongs to §55.11 validators).
- **R5 (spec hygiene, not behaviour):** two headings are both numbered §53.6.1 (40017 "Built-in Shapes" and 40076
  "Shared-core vocabulary"). The §53.6.1 impl-status paragraph lists the gap positions. Phase 1 must rewrite it.
- **Also:** the EBNF range form `number(0 < value < 10)` (§53.2.1 `numeric-literal comparison-op "value" comparison-op
  numeric-literal`) resolves to `asIs` today. That is an implementation gap, not a ruling.
