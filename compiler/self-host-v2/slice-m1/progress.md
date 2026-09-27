# self-host-v2 / slice-m1 — bootstrap first slice, MILESTONE 1 (s437-bootstrap-slice-m1)

Append-only, timestamped. Design authority:
`scrml-support/docs/deep-dives/bootstrap-codegen-architecture-dpa-051-2026-09-26.md`
(R1 = (a) S233 re-cut; R2 thin Core; R3 immutable runtime values; R4 the program is a `single`
declaration — all ruled by bryan S437). Targets: SPEC §66.19.1 (counter) and §66.19.3 (the dropdown
consumed three times + `<each>` row instances).

## 2026-09-27T07:06-06:00 — start
- worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab351e4467e733728`, base a186f76c7 (== origin/main).
- read in full: dpa-051; SPEC §66.0–§66.11, §66.13–§66.15, §66.19.1, §66.19.3; self-host-v2 lex.scrml
  conventions + progress.md (F1–F10); BRIEFING-ANTI-PATTERNS; kickstarter v2 (§0–§4, §7, §11.12, §13–§16).

## 2026-09-27T07:40-06:00 — baseline + impl#1 capability probes
- Pre-commit gate baseline (unit+integration+conformance): **25361 pass / 70 skip / 11 todo / 0 fail** (287.9s).
  (The post-commit hook's full run also reports ~57 browser-tier failures — navigate-wave1c, Bug 60 etc. —
  pre-existing, not touched by this dispatch.)
- PROBED (scratch, not committed): recursive payload enums (Expr contains Expr / Expr[]), mutual
  struct<->enum recursion (Block{stmts:Stmt[]} / Stmt.If(thenB:Block)), qualified payload construction as
  args (`Expr.Bin(BinOp.Add, Expr.Lit(1), …)`), `T | not` struct fields, exhaustive no-wildcard `match`
  (E-TYPE-020 fires cross-file when a variant arm is missing — so "no default arm" has real teeth under
  impl#1), cross-file `import` of types+fns between `${}` library modules when the compile set contains a
  `<program>` entry (emitted as chunk IIFEs + a `_scrml_modules["x.client.js"]` registry footer).
  **F1 has moved**: a library module now lowers `match` correctly IF compiled alongside a `<program>` entry.

### F11 (NEW) — positional payload binding in `match` over an IMPORTED enum is silently dropped
`match e { .Lit(n) :> "" + n }` where `Expr` is imported from another `.scrml` file emits
`/* §1a: cannot positionally bind 'n' — variant 'Lit' field order unknown */ return "" + n;` — no
diagnostic, and a ReferenceError at runtime. Same-file matches bind fine. The emitter
(`emit-control-flow.ts` emitVariantBindingPrelude) resolves positional binders against `_variantFields`,
which holds only the CURRENT file's enums. The same drop happens for a variant name declared in two enums
(`_variantFieldCollisions`). Also: with NO `<program>` in the compile set (pure library mode), positional
binding drops even for same-file enums, and the ES output keeps `from "./core.scrml"` unrewritten.
**Workaround (used everywhere in slice-m1): NAMED payload binding** `.Lit(n: n) :> …` — resolves by field
name, never by order, so it is immune to both the cross-file and the collision case. Verified cross-file.
Classification: silent miscompile (a dropped binder with no diagnostic is a bug, not a doc gap).

## 2026-09-27T08:20-06:00 — Core IR (core.scrml) + the no-default-arm lint
- `compiler/self-host-v2/core.scrml` compiles clean under impl#1 (via `slice-m1/bundle.scrml`, the
  `<program>` entry that makes the library chunks lower correctly — F1/F11).
- `scripts/lint-no-default-arm.js` + `slice-m1/lint.test.js` (12/12). Decisions:
  - **A JS script, not a scrml tool**: it must run before the bootstrap has a parser (M2), must not read
    impl#1's AST (S337; impl#1 keeps match arms as text), and needs only tokens — so it uses
    `native-parser/lex.js` (token-identical to the bootstrap lexer on 337/337), which also makes it immune
    to `match`/`_` inside strings/comments. It can become a scrml pass over FileAst once M2 exists.
  - **Scope = EVERY enum match, fail-closed, with a co-located reasoned opt-out**
    (`// no-default-arm: <reason>`). Deciding "which enums are IR" by a hand-kept list is itself the F3
    family. Literal-pattern matches (string lookup tables — an open domain) are exempt; a partially
    wildcarded tuple arm `(.InCode, _)` is not flagged (total over the named axis).
  - **Bite proven**: planted `_ :> false` over Core `Type` in a scratch copy of the real tree → 1
    violation at the exact line; removed → 0.
- The lint found 3 real sites in the S234 lexer: `keywordName` (`_` over TokenKind — the Token IR),
  `dispatch` (`(_, _)` over LexMode×LexEvent), `step` (`_` over LexMode). **Fixed, not opted out**:
  keywordName enumerates every TokenKind; dispatch is now `match mode` → `dispatchInCode` /
  `dispatchOffMode`, each total over LexEvent; step enumerates LexMode. Behaviour-identical: the lexer
  oracle stays **337/337**. Opt-outs in the tree: 0.

### F12 (NEW) — a `|` alternation arm lowers only as the FIRST arm of a `match`
`match m { .A :> "a"  .B | .C :> "x" }` emits `if (m === "A") return "a"\n "B" | "C" :> "x";` — the
alternation arm is glued onto the previous arm's body; with a string body there is NO diagnostic (silent
garbage JS); with a numeric body it surfaces only as a misleading E-TYPE-020 (`1.B | …` parsed as a member
access). The same alternation as the FIRST arm (single- or multi-line, trailing `|`) lowers correctly to
an `||` chain. A continuation line that STARTS with `|` is also rejected ("statement boundary not
detected"). Refines F6 ("nullary alternation works") — it works only first. **Workaround**: put the one
alternation arm first (lex.scrml) or give each variant its own arm (all slice-m1 code).

## 2026-09-27T09:30-06:00 — walk / js / html / names / print + counter Core + runtime; first print
- `walk.scrml` — the ONE structural traversal (`kids(n: Node)`, total over every Core enum) + `allNodes`,
  and the folds built on it (sharedRefs, boundSyms, assignedSyms). No pass hand-writes recursion over Core.
- `js.scrml` / `html.scrml` — output trees + one-shot printers (precedence from the tree; compact
  template HTML). `names.scrml` — the one NameSupply. `print.scrml` — Core → trees.
- `slice-m1/runtime/runtime.js` — instance records, scope tree, Cell/Derived/Effect, cond/each/insert.
- `slice-m1/counter.core.scrml` + `harness.js` (compile with impl#1, load chunks in dependency order) +
  `print-demo.js`. The counter prints to readable JS + a one-template page.

### F13 (NEW) — a payload pattern binding FIVE or more fields is not recognised as an arm
`.W(a: a, b: b, c: c, d: d, e: e) :> …` after a previous arm is glued onto that arm's body
(`return 0.W ( a : a , … ) :> a + e;`) and the match reports E-TYPE-020 "missing ::W". Four bindings lower
fine. **Workaround**: bind only the fields an arm uses (named partial binding); where all five are needed
(`Stmt.Write`, `View.Each` in the printer) bind four and read the fifth through a one-arm accessor
(`writeCheck`, `eachHandles`). The Core keeps its 5-field variants — the design is not bent to the bug.

### F14 (NEW) — a string literal containing `{` or `}` next to other characters breaks `${}` block splitting
Inside a `${ … }` module, `return " => {\n"` or `"{ "` → `E-CTX-003 Unclosed 'logic'`; `" }"` →
`E-CTX-001 Unexpected '}'`. The standalone literals `"{"` / `"}"` are fine. The block splitter counts
braces inside string literals unless the literal is exactly one brace. (Same family as F9's `${`.)
**Workaround**: js.scrml spells braces only through `LB()` / `RB()` returning the standalone literals.

### F15 (NEW) — an enum payload FIELD named like a same-file function is renamed in the constructor
`type JsStmt:enum = { SFunc(name, params: string[], body) }` in a file that also declares `fn params(…)`
emits `SFunc: function(name, _scrml_params_62, body) { … data: { name, _scrml_params_62, body } }` — the
field is silently renamed to the function's mangled name, so every reader of `.params` gets `undefined`.
Same for core.scrml's `fn sym` vs the many `sym:` payload fields and `fn text` vs `View.Text(text)`.
**Workaround**: helper functions never share a name with any payload field (`mkSym`, `textView`,
`paramList`). Silent miscompile, no diagnostic.

### F16 (NEW) — tag-only arms over an IMPORTED payload enum compare the value to a string
`match a { .Static :> false  .Bound :> true  .On :> true }` where `Attr` is imported emits
`if (a === "Static") …` — correct only for nullary variants; a payload value is an object, so no arm matches
and the match yields `undefined`. The emitter switches to `.variant` comparison only when an arm has a
binding or the variant is in `_variantFields`, which holds only the CURRENT file's enums (the F11 root).
**Workaround**: in a match over an imported payload enum, at least one arm binds a field
(`.Static(name: n) :> false`). Same-file matches (lex.scrml) are unaffected.

## 2026-09-27T08:30-06:00 — dropdown + valuesem Cores, check/measure, acceptance GREEN, measurements

### Design catch found by execution: a handle holds an IDENTITY, not a value
The first dropdown run crashed: `bindHandle` stored an instance record in a Cell, and the Cell deep-froze it
(scope, cleanup list and all). §45.1 already says it — "cells and instances are identities that hold values"
— but the runtime value model (§6.1, R3) had no identity/value line. Fixed: `freeze` touches only arrays and
plain objects; instance records are `class Instance`; `as=` cells are `rt.handle()` (the printer emits it).
**For the design**: R3 "runtime values are immutable" needs the explicit carve-out "identities (instances,
handles) are not values", matching §66.7.5 / O56 (the narrowed `given` binding writes the instance).

### Acceptance (all executed; `bun test ./compiler/self-host-v2/slice-m1/` → 38 pass / 0 fail)
| requirement | test | result |
|---|---|---|
| counter: +step increments, reset restores, doubled tracks | counter.browser `behaviour` (3) | PASS |
| counter: writes to `doubled` / `step` not representable in Core | counter.browser `Core-level fact` (4) | PASS |
| D1: one click opens ONE dropdown | dropdown.browser `D1` "exactly one menu" | PASS |
| 3 instances + row instances toggle independently | dropdown.browser `D1` (each of 4 + Color) | PASS |
| `as=country` reads/writes instance 1 only | dropdown.browser `as=country` (2) | PASS |
| conditional `color` mounts/disposes with showColor; effects gone | dropdown.browser `conditional` — stats back to the exact pre-show counts; scope.disposed; handle → not | PASS |
| row `qty` follows its row on reorder; disposed with its row | dropdown.browser `row-scoped` (4, on the reorder FIXTURE) — same DOM node + same instance after reorder, 0 effects created/disposed; removed row's scope disposed, listeners/effects/instances drop | PASS |
| §66.10: a snapshot does not change when the source is written | valuesem.browser (4) — program-level (`let before = @audit; @audit.push`) and instance-level (`@country`) | PASS |
| no-default-arm lint bites | lint.test (12) | PASS |

How "not representable" is made true (counter): `step` and `doubled` have `wcap: not`; a `Stmt.Write` names a
capability Sym, so there is no symbol a write to them could name. `checkCore` enforces the symbol-table side
(C1: wcap ⟺ a grant; C2: every Write's cap is some field's wcap; C3: the edit is granted). A forged Write naming
the field's READ symbol is a dangling capability (C2), and the printer has no field to target for it. The
runtime shadow: a field without a capability is emitted as a `Derived`, which has no `set` method at all.
Limit, stated plainly: a data IR cannot stop someone constructing a Write with a forged integer id — the claim
is that the missing grant is a fact of the SYMBOL TABLE (like an undeclared name), not a per-write check.

The reorder test needs a writable `lines`; §66.19.3 declares it locked and never changes it. So the ORACLE is
`dropdownCore()` (exactly §66.19.3) and the row tests run on `dropdownReorderCore()`, a FIXTURE that adds a
`replace` grant and three literal-rewrite functions. Stated in the file.

### §3.2 deviations (field lists "build-time detail" — each with its reason)
- D1 CoreProgram: no `views:[ViewRoot]` (under R4 every view root is some Decl's `renders`; a second path to
  the same thing); added `program: Sym`.
- D2 Decl: `renders: View[] | not`; added `handles: Sym[]` (the `as=` cells that live on its instances).
- D3 Field: added `role: Attribute | Child` (the factory's construction parameters; O43 hook), `wcap: Sym | not`
  (grants-as-symbols), `init: Expr | not` (O33 — an attribute with no default); `type` → `ty`.
- D4 Stmt.Write `{place, edit, value, check}` → `{cap, inst, edit, value, check}`: the target is a write
  capability + an InstRef, not a read Place. `Stmt.Expr` → `Eval`. `Loop`, `Guard`, `Expr.ServerCall`,
  `View.Star` OMITTED — no M1 construct uses them; `Guard` needs the §19 failable runtime. Adding them is additive.
- D5 Expr: added `Prim` (operators RESOLVED by analyze, e.g. EqPrim vs EqStruct), `ArrayOf`, `StructOf`,
  `Handle` (an instance identity); `Lit` carries a `Literal` enum. Match arms are Expr-bodied only.
- D6 Place paths `[FieldIdx]` → `[FieldRef{owner, idx}]` (the printer needs no type environment);
  `LocalPath.path` non-empty (a whole local is `Expr.Local` — one spelling per shape).
- D7 View: every child position is `View[]` (Cond arm, Each row, Instance slot) — no Fragment variant;
  `On` moved from View to a new `Attr` enum (`Static | Bound | On`) — a listener belongs to its element and has
  no position among children; `ConstructAttr{field, value}`; Each gains `bind` + `handles`.
- D8 EditKind `.Field(path)` → `.FieldAt(path)` (clash with the `Field` type).
- D9 Check = `Static | RuntimeEdge` (no `Runtime(invariant)` until O36 rules).
- D10 GrantSet = `{ replace, edits: EditKind[] }` (the RESOLVED set); TransitionGraph = `{ enumSym, edges:
  [{origin, targets}] }` by variant index.
- D11 NodeId is defined but attached to no Core node in M1 (no side-table consumer yet — runtime dependency
  tracking needs none). Consequence for M2: the oracle comparison is structural equality MODULO a Sym-id
  bijection (hints must match).

### `lower`-design decisions (made to hand-build the Core; FLAGGED for the PA — M2 must implement exactly these)
- L1 InstRef by lexical position: inside declaration X (its opener, body, renders) `@f` of X's field →
  `.Lexical(depth)`; elsewhere → `.Shared(X)`. For the program (single) both name one instance: its field
  initializers + renders use `.Lexical(0)`, top-level functions use `.Shared(program)`.
- L2 A field initializer reading a sibling field (`<doubled=(@count * 2)>`) → `.Lexical(0)` = the instance
  under construction (the factory evaluates initializers against the new record). O54 (a) extended from
  `renders` to openers — O54 is not ruled for openers.
- L3 Grants → a write-capability Sym minted by analyze iff the field grants ≥1 write (replace, a sequence edit,
  a graph). A write to a field without one is diagnosed at BINDING (E-DERIVED-WRITE if derived,
  E-WRITE-NOT-GRANTED otherwise); no Core node exists for it.
- L4 `reset(@x)` → `Write{.Replace, value: x's initializer Expr, re-evaluated at reset}` (a `default=` would
  substitute). Consequence: `reset` needs the `replace` grant (§66.11.2) — `reset` on an append-only or
  graph-only field is E-WRITE-NOT-GRANTED.
- L5 `if=` on an element (and on a use, O18) → a one-arm `View.Cond` whose arm body is that element.
- **L6 Use-site construction values REPLACE the field's initializer for that instance, and the §66.9 mode rule
  applies per instance**: a LOCKED attribute given a reactive expression is DERIVED for that instance
  (`label=line.name` tracks the row); a `let` attribute is SEEDED once (`value="1"`). §66.14 rule 4 says
  "construction" without saying whether construction values track (adjacent to O21). **The most consequential
  choice in the slice — needs a ruling.**
- L7 Ternary / if-as-expression → `Expr.Match` over a bool with `true`/`false` literal arms (no separate
  conditional Expr). The printer prints that shape as `?:`.
- L8 Check classification (conservative, sound): Replace/Append/… are `.Static` (no invariants here); every
  `.Transition` is `.RuntimeEdge` unless its value is a literal AND the from-state is proven by a dominating
  test in the same block. So the toggle, the `<li>` close and closeCountry are all RuntimeEdge. A
  path-sensitive proof (the li is inside `if=(open == .Opened)`) is deferred — it must also account for a
  handler that writes the field before a later write.
- L9 `<each>` without `key=` → `key: not` → positional keys. (§17.7's rule for unkeyed rows not re-read here.)
- L10 `as=` cell placement: the nearest enclosing `<each>` row (row-scoped, §66.7.4) → `Each.handles`; else the
  declaration whose renders contains the use → `Decl.handles` (the program, for top-level `as=`). Top-level
  functions reach program handles through the shared instance. Set on mount, cleared to `not` on dispose.
- L11 `given c = @h :> { … }` over an instance handle → `Let c = Handle(Alias h)` in the ENCLOSING block, then
  `If(IsSome(Local c), { … writes through .Narrowed(c) … })`. One read of the handle; the Let's scope is the
  enclosing block (harmless — Syms are unique).
- **L12 GAP — an unconditionally-mounted handle read outside its view** (`@country.value` in the page, or in
  `closeCountry()`) is typed `dropdown`, not `dropdown | not` (§66.7.5 makes only conditional mounts `T | not`),
  so no narrowing is emitted. That holds only AFTER the instance mounts: a function called before render, or a
  read placed before the instance in document order, sees `not` at runtime. M1 passes because boot renders
  before any handler. Needs a rule: top-level handles are `T | not` outside the owning view, or analyze proves
  mount-before-use.
- L13 Render-node normalization: whitespace-only text containing a newline between elements is dropped;
  other text is kept verbatim; markup comments are dropped. (S233's named hard part; also a PRINT constraint:
  templates are addressed by child index computed from the tree, so views must be parse-stable HTML — no block
  element inside `<p>`, etc. — or the browser's parse diverges from the tree.)
- L14 The program's markup body is its `renders`; the program renders at boot, at the end of `<body>`
  (takes O38's "markup position" question as: yes, the program itself). `type` decls → `CoreProgram.types`.
- L15 One CoreProgram per LINKED program (lib/dropdown's declaration appears in app's Core); module-level
  `export` is not in Core; field-level `export` is `Field.exported` (E2 is analyze's check).
- L16 An `<each>` row binding is a per-row reactive cell (a surviving row gets its new item); the key
  expression reads the plain item.
- L17 Field order: attributes in opener order, then child fields in body order; the factory's parameters are
  the attributes in that order.
- L18 A graph field (`<open:Openness=.Closed>` + `rule=` children) is `mode: Locked`,
  `grants: {replace: false, edits: [Transition]}`, with a wcap; edges by variant index.
- L19 `<step=1/>` → `Type.Int` (§66.3 rule 3); compound opener literals `([...])` → ArrayOf / StructOf
  (positional in declared field order).

### Measurements
(a) Immutable-value edit cost (§6.1 / R3) — `bench/value-edit.bench.js`; median per op; every append is to an
n-element array; bytes = heap growth per op with results retained (Bun.gc between). Machine shared with other
agents' test runs, so treat absolute numbers as ±30%.

| edit | n | immutable DEV (deep-freeze) | immutable PROD | mutable in-place | bytes/op DEV |
|---|---|---|---|---|---|
| append | 10 | 2.93 µs | 89 ns | 22 ns | ~0 (below heap granularity) |
| append | 1 000 | 288 µs | 5.2 µs | 40 ns | 26 KB |
| append | 100 000 | 52.7 ms | 0.67 ms | 2.9 µs | 2.4 MB |
| field-write | 10 | 3.05 µs | 118 ns | 6 ns | ~0 |
| field-write | 1 000 | 300 µs | 1.05 µs | 6 ns | ~0 (below granularity) |
| field-write | 100 000 | 51.3 ms | 1.08 ms | 38 ns | 1.1 MB |

PROD bytes/op were not measurable by heapUsed (noise ≥ the ~8 B/element copy). Finding: the PROD copy is the
O(n) the design predicted (0.7–1.1 ms at 100k — fine for UI lists, a real cost for large logs), but **DEV
deep-freezing dominates by ~50–80×**: `Object.freeze` on a 100k-element array costs ~35 ms in JSC (measured
alone: slice 1.0 ms vs slice+freeze 35.8 ms). "Frozen in dev builds" (§6.1) is not viable for large sequences
as designed; options: freeze only below a size threshold, freeze only the new branch of an edit, or drop the
freeze and rely on Core (no in-place mutation is ever emitted — every write is a classified `Write`).

(b) Core size — `bench/sizes.js` (source = the SPEC §66.19 code block; tokens by native-parser lex.js):
- counter: source 934 B / 14 lines / 165 tokens → Core 59 nodes (0.36 nodes/token): View 12, Expr 14, InstRef 8,
  Place 6, Block 4, Stmt 4, Field 3, EditKind 2, Attr 2, Fn 2, Decl 1, Program 1.
- dropdown (lib + app): source 2689 B / 46 lines / 513 tokens → Core 170 nodes (0.33 nodes/token): Expr 62
  (Lit 31), View 32, InstRef 17, Place 13, Stmt 10, Attr 9, Block 8, Field 6, EditKind 6, Pattern 2, Decl 2, Fn 2.

(c) Output size vs impl#1 (`bench/sizes.js`; impl#1 inputs `bench/impl1-counter.scrml`,
`bench/impl1-dropdown.scrml`):
| program | artifact | bootstrap bytes / gzip | impl#1 bytes / gzip |
|---|---|---|---|
| counter | client JS | 1708 / 611 (47 lines) | 4035 / 1242 (96 lines) |
| counter | HTML | 302 / 202 | 715 / 351 |
| dropdown | client JS | 5533 / 1394 (121 lines) | 13720 / 2459 (296 lines) |
| dropdown | HTML | 854 / 355 | 1818 / 538 |
| both | runtime | 18374 / 6234 (commented source) | 67954–71627 / 20015–21560 |
Caveat for the dropdown row: impl#1 cannot express §66.19.3 (no `as=`, no per-instance state — D1 — and
`<each>` inside a component fails, dpa-050 M16). The impl#1 input is dpa-050 §3.2's "CURRENT" program: a
SUBSET (3 uses, callback props, no conditional instance, no rows) that compiles but is runtime-broken (one click
opens all three). The bootstrap output is for the FULL §66.19.3 program and is still ~2.5× smaller.

## 2026-09-27T09:10-06:00 — M1 STOP (M2 not started, per brief)
- Pre-commit gate after all changes: 25361 pass / 70 skip / 11 todo / 0 fail — identical to baseline.
- NOT in any gate yet (for the PA to wire): `bun scripts/lint-no-default-arm.js` and
  `bun test ./compiler/self-host-v2/slice-m1/` (bunfig `root = compiler/tests/` means `bun test` alone does not
  discover them).
- Size of M1: ~2.4k lines of scrml (core 338, walk 347, print 944, js 308, names 154, html 94, check 94,
  measure 135) + 530 hand-built Core + 535 runtime JS. impl#1 friction: 6 new findings (F11–F16) in ~2.9k
  lines, all silent miscompiles or misleading diagnostics, all worked around without bending Core.
- M2 estimate (parse → analyze → lower for exactly these two programs, reproducing these Cores modulo a
  Sym-id bijection): parser for the §66 subset used (openers with typed attrs / own values / `let` / `export`,
  `renders`, state-children, markup with `if=` / `as=` / `<each>` / `<slot/>` / `onclick=` in call, expr and
  block forms, `${}` interpolation, fns, `given`, `type` decls, imports) ≈ 2.5–4k lines; analyze (binder →
  Syms, types for fields/locals/struct paths, capability minting, the edit classifier, E-DERIVED-WRITE /
  E-WRITE-NOT-GRANTED / E-DECL-HANDLE-NOT-NARROWED, handle placement) ≈ 1.5–2.5k; lower (L1–L19) ≈ 1–1.5k.
  Total ≈ 5–8k lines of scrml, 2–3× M1. Risk concentrates in the markup/logic dual grammar and L13
  normalization, and it needs rulings on L6 and L12 before `lower` is written.

## 2026-09-27T10:40-06:00 — M1 fix round (adversarial review F1–F8)
Merged origin/main (clean; no overlap with slice files). Every item below has a named mutation that is now
RED — `bun compiler/self-host-v2/slice-m1/bench/mutations.js` applies each, runs the named tests, restores
the file (try/finally), and re-runs the clean suite (13/13 RED; clean suite green).

- **F4 (FieldAt always granted) — FIXED.** `check.scrml` C3 now walks the FieldAt path: empty path refused
  (a whole-field write is `.Replace`); each step's `owner` must be the struct type of the value it steps
  into (a step into an enum / scalar / sequence is refused — so FieldAt can no longer reach `audit`
  (append-only) or `open` (graph)); `idx` range-checked. Granted iff the TARGET struct field grants a write
  (per-field `let`, O3), OR the outer field grants `replace` AND no field on the path carries a non-replace
  contract (an outer replace may not bypass a contract the direct edit would have to follow). To express
  per-field grants, **`FieldDef` gains `grants: GrantSet`** (D12; Line's fields = noGrants). A field whose only
  writable part is a sub-field lists `FieldAt(path)` in its resolved `grants.edits` (that is what gives it a
  wcap under C1). Negative tests for each case; review case reproduced and now C3.
  OPEN for the design (not fixed): a top-level `.Replace` of a struct whose sub-fields carry contracts has
  the same bypass shape (§66.11.3 says replace subsumes edits; whether a sub-field graph is an "invariant"
  that bounds a replace is not ruled). And `@rows[i].qty = v` (a dynamic position then a field) has no Core
  form — FieldRef steps are static struct fields only; M2 needs a dynamic-index path step.
- **F5 (`inst` ignored) — FIXED.** C4: the Write's InstRef must resolve to the capability's own declaration —
  Shared(X) → X; Lexical(k) → the k-th enclosing declaration (context from where the write sits: a
  declaration's initializers/renders = [that decl], a function = []); Alias(h) → the declaration of the use
  binding h; Narrowed(c) → what the Let binding c holds. Added C5: the same for every cell READ (and its
  first path step is a field of that declaration). The review's `value` via `Shared(program)` is now C4.
- **F7 (Static transitions unchecked) — FIXED.** C6: RuntimeEdge only on a Transition; a literal transition
  value must be a variant of the graph's enum (checked whatever the check); `Static` only when Core proves
  the edge: the value is a literal variant that EVERY state either is (self-write no-op) or has an edge to.
  A from-state proven by a dominating test is not expressible in Core (no flow facts) → lower emits
  RuntimeEdge (L8 unchanged). Note: by this rule `.Closed` in the 2-state dropdown graph is provably Static;
  the oracle keeps RuntimeEdge (L8's conservative rule), which C6 accepts.
- **F1 (handler exceptions invisible) — FIXED.** `load-program.js` captures window `error` +
  `unhandledrejection`; `click()` throws if a handler errored; every browser test file has
  `afterEach(expectNoPageErrors)`. Mutation "remove transition()'s self-write no-op" → RED (the second
  "Done" click).
- **F2 (surviving key, changed item) — FIXED.** Fixture fn `renameTea` (same keys/order, row 1 renamed); test
  asserts span + `label=line.name` update, same DOM node + instance, stats unchanged. Mutation "drop
  `old.row.item.set(item)`" → RED.
- **F3 (coverage) — FIXED.** `rt.stats.deriveds` added (included in the exact pre-show equality); new
  `runtime.test.js` contract tests. RED mutations: Derived not unsubscribing; disposed scope left in
  parent.children; `each` reconciling while tracking (list effect re-ran on a row's read — first attempt did
  NOT bite because surviving rows aren't re-rendered; the test now counts list-effect runs); `seeded`
  evaluating tracked; handlers unbatched (glitch state "1:0" observed); edge check removed.
- **F8 (lint) — FIXED.** The lint now parses alternation patterns: `_` inside an alternation in an enum match
  is a default arm; an alternation arm that is not FIRST is flagged in any match (enforces the F12
  workaround). impl#1 probe of the review case `match m { .B :> "b"\n _ | .A :> "a" }`: no diagnostic, the
  arm is DROPPED (`f(.A)` returns undefined) — F12 confirmed for this shape. Bite proven on the real tree.
- **F6 — left as designed**; documented in core.scrml as THE BINDER'S OBLIGATION.
- Not touched (awaiting rulings): dev-freeze policy, L6, L12.
- Counts: slice suite 38 → **68** (6 files); lexer oracle 337/337; lint 0 violations / 0 opt-outs.
