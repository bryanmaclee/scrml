# S428 — self-host conformance migration (append-only progress log)

Worktree: `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-ad65d27bcd6f3cc05`
Branch: `migrate/self-host-conformance`
Base SHA: `bf9e831c26fb1bf073c3e24e8817bda1c496c480` (== `origin/main` at dispatch)

Scope: syntax migration of `compiler/self-host/*.scrml` only. Four rules:
A1 `null`/`undefined` -> `not` (SPEC §42.1 / §42.7), A2 `===`/`!==` -> `==`/`!=` (§45),
B1 `try`/`catch` -> failable fns + `!{}` (§19), B2 `await`/`async` (§19.9.3 / §19.9.8).
NOT a refactor. Nothing is deleted, stubbed, simplified, or invented. Unmigratable sites are
left as-is and reported.

---

## Baseline — measured by execution at base SHA

Command (per module): `bun compiler/bin/scrml.js compile <f> --output-dir <tmp>`; exit code 0 == clean.

| module | LOC | exit | errors / warnings | error codes |
|---|---|---|---|---|
| ast | 3792 | 1 | 93 / 549 | E-SYNTAX-042 x67, E-FN-003 x10, E-SCOPE-001 x8, E-TRY-NOT-IN-SCRML x4, E-EQ-004 x2, E-AWAIT-NOT-IN-SCRML x2 |
| bpp | 232 | 1 | 5 / 38 | E-SYNTAX-042 x5 |
| bs | 894 | 1 | 1 / 53 | E-FN-003 x1 |
| cg | 21 | 0 | clean | — |
| dg | 1052 | 1 | 24 / 165 | E-SYNTAX-042 x16, E-FN-003 x8 |
| meta-checker | 874 | 0 | clean | — |
| module-resolver | 305 | 0 | clean | — |
| pa | 444 | 1 | 30 / 59 | E-EQ-004 x14, E-SYNTAX-042 x9, E-SCOPE-001 x5, E-TRY-NOT-IN-SCRML x2 |
| ri | 984 | 1 | 51 / 134 | E-SYNTAX-042 x51 |
| tab | 1109 | 1 | 1 / 154 | E-CODEGEN-INVALID-LOGIC x1 |
| ts | 2570 | 1 | 144 / 329 | E-SYNTAX-042 x134, E-FN-003 x5, E-SCOPE-001 x2, E-FN-004 x2, E-FN-002 x1 |

**HEADLINE BASELINE: 3 of 11 compile clean** (cg, meta-checker, module-resolver). Confirms the
brief's inherited figure by re-execution.

Note: error counts are "as far as the pipeline got" — later stages may surface more once earlier
gates pass.

### Raw A1 census (lexical scan, before any edit)

356 raw `null`/`undefined` word occurrences. Lexical classification (scanner in scratchpad,
cross-checked by hand):

- 343 in code position (candidates)
- 13 in exclusion positions: 2 line comments, 11 string-literal interiors
- 0 inside `_{}` foreign blocks (there are none in these files)
- 0 inside `?{}` SQL blocks
- 0 inside `^{}` meta blocks

---

## TIER A CHECKPOINT — measured by execution after A1 + A2, before any Tier B edit

**HEADLINE: 5 of 11 compile clean** (baseline 3). New: `bpp`, `ri`.
Total errors across the tree: **349 -> 37**.

| module | exit | errors/warnings | remaining error codes |
|---|---|---|---|
| ast | 1 | 16 / 540 | E-FN-003 x10, E-TRY-NOT-IN-SCRML x4, E-AWAIT-NOT-IN-SCRML x2 |
| bpp | 0 | clean | — |
| bs | 1 | 1 / 53 | E-FN-003 x1 |
| cg | 0 | clean | — |
| dg | 1 | 8 / 165 | E-FN-003 x8 |
| meta-checker | 0 | clean | — |
| module-resolver | 0 | clean | — |
| pa | 1 | 3 / 56 | E-TRY-NOT-IN-SCRML x2, E-SCOPE-001 x1 |
| ri | 0 | clean | — |
| tab | 1 | 1 / 154 | E-CODEGEN-INVALID-LOGIC x1 |
| ts | 1 | 8 / 327 | E-FN-003 x5, E-FN-004 x2, E-FN-002 x1 |

### A1 counts

- migrated: **343** sites (`null`/`undefined` -> `not` / `is not` / `is some`)
  - ast 86, ts 156, ri 51, dg 17, pa 20, bpp 5 (plus the `!==null && !==undefined` pairs in pa
    collapsed into a single `is some` each, so the edit count is lower than the token count)
- excluded: **13** sites — 2 line comments (`ast:40`, `tab:15`), 11 string-literal interiors
  (`meta-checker:95,96,625`, `tab:110 x2,162 x2`, `ts:95 x2, 815, 821`). All 11 string sites are
  keyword tables / type-name strings belonging to the compiler's own lexer + type registry.
- `""` / `0` / `false` / `[]` / `{}`: **zero touched** (§42.1.1).

### A2 counts

- migrated: **15** sites — `ast:548` (1 `!==`), `pa` (14, all inside
  `(x !== null && x !== undefined)` idioms collapsed to `x is some`).
- excluded: **3** — `tab:79` (comment), `tab:141` (`"==="` and `"!=="` string elements of the
  tokenizer's operator table).

### Compiler defects surfaced by the A1 migration (see report)

- D1: `is some` / `is not` with a BARE operand inside a `function(){}` expression body or a class
  method body emits the internal placeholder `__scrml_is_some__(...)` / `__scrml_is_not__(...)`
  into output JS. The helper is never defined in the runtime bundle -> guaranteed ReferenceError.
  No diagnostic. Affected after migration: `pa` 2 sites, `ts` 2 sites.
- D3: the same position with a PARENTHESISED operand lowers to `((expr) !== null)` /
  `((expr) === null)` — the `undefined` half is dropped, violating §42.8. Affected: `ast` 1 site.
- D2: `class X { }` in a `${}` logic block is emitted but not registered in the scope table;
  `new X()` fires E-SCOPE-001 (`pa:279`).
- D4: `let x = ^{ ... }` (meta block as expression RHS) produces malformed JS ->
  E-CODEGEN-INVALID-LOGIC (`tab:325`).

---

## TIER B CHECKPOINT — measured by execution after B1 + B2

**HEADLINE: 5 of 11 compile clean** (baseline 3, after Tier A 5). Total errors **349 -> 33**.

| module | exit | errors/warnings | remaining error codes |
|---|---|---|---|
| ast | 1 | 14 / 540 | E-FN-003 x10, E-TRY-NOT-IN-SCRML x2, E-AWAIT-NOT-IN-SCRML x2 |
| bpp | 0 | clean | — |
| bs | 1 | 1 / 53 | E-FN-003 x1 |
| cg | 0 | clean | — |
| dg | 1 | 8 / 165 | E-FN-003 x8 |
| meta-checker | 0 | clean | — |
| module-resolver | 0 | clean | — |
| pa | 1 | 1 / 56 | E-SCOPE-001 x1 |
| ri | 0 | clean | — |
| tab | 1 | 1 / 154 | E-CODEGEN-INVALID-LOGIC x1 |
| ts | 1 | 8 / 327 | E-FN-003 x5, E-FN-004 x2, E-FN-002 x1 |

### B1 counts — `try`/`catch` -> `safeCall` + `!{}` (§19 + `scrml:host`)

14 real `try` blocks in the tree (all other `try`/`catch` tokens are inside string literals or
comments). **5 migrated, 9 left unmigrated and reported.**

Migrated (each one `let x = safeCall(() => <original expr>) !{ | ::Thrown(message, name) :> <original handler> }`):

- `pa:59` `readTableSchema` PRAGMA introspection
- `pa:331` `processDbBlock` realpathSync resolution
- `ast:162` ATTR_CALL `JSON.parse`
- `ast:329` ATTR_TYPED_DECL `JSON.parse`
- `meta-checker:297` `extractIdentifiersFromAST` fallback

No new error enum was needed: `scrml:host` already declares `safeCall(thunk) ! -> HostError` with
`HostError::Thrown(message, string)`, which is the exact shape of "a JS-host call threw".

### B2 counts — `async`/`await` (§19.9.8)

24 raw `await` tokens. 20 are inside `^{}` meta-block bodies (legal JS host — excluded by §19.9.8's
own JS-host-interop carve-out) or inside string literals. `async` appears 0 times in a code position.
**2 real code-position sites: `ast:35` and `ast:39`. Both left unmigrated — see below.**

### THE UNMIGRATABLE LIST (9 B1 blocks + 2 B2 sites)

**(c) the language has no way to express this**

- `ast:34-43` (2 nested `try` blocks, containing the 2 B2 `await import` sites) — dynamic host-module
  import with a two-level filesystem fallback. §19.9.8 enumerates the Promise boundaries the
  body-split/CPS machinery covers (`^{}`, `_{}`, server-fn return, `use foreign:`); a bare
  `import()` call in scrml source is none of them. MEASURED: dropping `await` from
  `const mod = import("./x.js")` emits a bare `import(...)` with no auto-await and no diagnostic —
  `mod` is a Promise. And the failure being caught is module RESOLUTION failure of a JS-host
  primitive, which has no `!` signature to hang an `!{}` on. Moving it into `^{}` would work but is
  a restructure, and the source comment at `ast:31-32` says `^{}` is stripped in the test context —
  which is why the fallback lives outside `^{}` in the first place.
- `pa:282-297` — `try { … } finally { cache.closeAll() }`. scrml has no `finally`, no `defer`, and
  no scope-exit primitive. `safeCall` cannot express "run this cleanup on both paths". Deleting the
  `finally` and calling `closeAll()` after the loop leaks the DB handle on any throw.

**(b) compiler defect**

- `pa:104-113`, `pa:122-131`, `pa:134-145`, `pa:142`, `pa:154` — all five sit inside
  `class SchemaCache` method bodies. MEASURED: an `!{}` guarded expression inside a class method
  body cannot be lowered — E-CODEGEN-INVALID-LOGIC (defect D5). Migrating these would turn pa's one
  remaining error into a codegen failure.
- `ast:553-557` — `try { return parseExprToNode(...) } catch (_e) { return not }`. The 1:1 canonical
  form is `return safeCall(...) !{ … }`. MEASURED: that form emits the guard but **silently drops
  the `return`** (defect D7) — the function returns `undefined` on every path, exit 0, no
  diagnostic. Not migrated rather than rewritten around.

### Additional compiler defects found while migrating (all MEASURED, minimal repros in the report)

- D5: `!{}` inside a class-method body -> E-CODEGEN-INVALID-LOGIC (raw scrml text in the JS output).
- D6: `export class X { }` is **silently dropped from the emitted JS**, exit 0, no diagnostic.
  12 of the 14 class declarations in this tree are `export class`; the emitted JS for the tree
  contains **2** class definitions total. Three modules that "compile clean" (`ri`,
  `module-resolver`, `meta-checker`) emit `new RIError(...)` / `new ModuleError(...)` /
  `new MetaError(...)` with the class nowhere in the artifact.
- D7: `return <failableCall> !{ … }` silently drops the `return`.
- D8: E-FN-003 false positive — a `for (const x of xs) { x.f = v }` inside a `fn` body is reported as
  an outer-scope write, though §48.3.3 says "Local `let`/`const`/`lin` variables declared inside the
  `fn` body may be freely mutated" (`ast:2488`, `ast:2492`).
- Walker gaps: E-TRY-NOT-IN-SCRML fires on only 6 of the 14 real `try` blocks; `throw new Error(...)`
  at `meta-checker:454`, `meta-checker:459`, `ts:446` is never rejected.

### Non-conformance classes OUTSIDE the four rules (not touched; reported)

- E-FN-003 x24 + E-FN-004 x2 + E-FN-002 x1 — `fn` declarations whose bodies call nested `function`
  helpers, call `Math.random()`/`Date.now()`/`document.createElement`. Source non-conformance; the
  fix is a declaration-shape change (`fn` -> `function`), which is not a syntax migration.
- 3 `throw new Error(...)` sites (forbidden vocabulary, not one of the four rules).

