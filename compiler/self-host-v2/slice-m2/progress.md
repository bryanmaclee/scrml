# slice M2 progress (s437-bootstrap-slice-m2)

Started at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ab0d7a7eec55df026 on top of origin/feat/s437-bootstrap-slice-m1 (a54130a65).

## Log

## 2026-09-27 — STEP 0(a): L12 (b) applied to M1 (instance records at construction)
- Ruling (user-voice S437): instance records are created when the program is CONSTRUCTED, before any user
  code runs, separate from DOM mount; unconditional `as=` handles are `T` by construction; conditional
  instances stay `T | not`; DOM effects wait for mount.
- Printer: a declaration's factory (`mk_<decl>`) now runs inside `rt.construct(inst$, () => …)` and, after
  its fields and handles, creates the instances its `renders` mounts UNCONDITIONALLY (reached through
  element children only — not through a Cond arm, an Each row or slot content) into `inst$.kids[k]`, in
  document order, binding their `as=` handles. `render_<decl>` MOUNTS `inst$.kids[k]` (it no longer
  creates them). Instances inside arms/rows/slots are still created as their region mounts (those are the
  conditional ones, §66.7.5). One switch (`Ctx.prebuilt`, set only by `instCtx`) governs both halves.
- Runtime: `Instance.kids`; `construct(inst, body)`; `shared()` registers the record BEFORE running the
  factory (M1 re-entered construction and recursed forever when a seed's initializer called a function
  reaching `.Shared(program)`); a `let` seed created during construction is OWED — settled on first demand
  or when the outermost construction ends, so a seed may read any record of the construction tree in any
  allocation order; a genuine cycle throws "seeding cycle". Outside construction `seeded` evaluates
  immediately (unchanged).
- Fixture `dropdownEarlyReadCore()` (NOT the oracle): §66.19.3 + `function countryValue() { return
  @country.value }`, `<let firstCountry:string=(countryValue())/>`, and a `<p class="early">` placed BEFORE
  the instances. Test: seed = "US", early read live ("Early CA / US" after picking CA), kids ids [1,2].
  **Proved RED on M1's printer+runtime** (RangeError: maximum call stack — the re-entrant construction).
- Mutations added (both RED): "instance creation deferred to mount" (`prebuilt: false`), "shared instance
  registered after its factory". Slice suite 68 → 72 (+3 L12, +1 runtime owed-seed/cycle contract).
- Not done (surfaced): slot content's instances are created when the slot mounts (treated as a nested
  region). A slot rendered unconditionally by its declaration would make them unconditional too — deciding
  that needs the callee's renders at the use site; no §66.19 program has slot content.

## 2026-09-27 — STEP 0(b): "replace respects sub-field contracts" (check C7)
- Ruling (S437): a whole-value replace of a struct whose sub-fields carry contracts (graph, append-only,
  fixed) SHALL satisfy each; `@order = { ...@order, status: .Shipped }` is checked like `@order.status = .Shipped`.
- **D12b (Core deviation):** `FieldDef` gains `graph: TransitionGraph | not` — a struct sub-field's `rule=`
  graph had nowhere to live (FieldDef carried only `grants`). core.scrml gains the shared lookup
  `contractedSubFields` / `graphSubFields` (used by check AND print — one definition).
- check.scrml **C7**: for a `.Replace` (already granted by C3), every contracted sub-field (recursing
  through struct sub-fields that are themselves free/`let`) must be PROVABLY KEPT — the struct literal's
  component is a read of the same sub-field of the same instance — or, for a graph sub-field, the component
  is a literal every state may move to, or the write carries `Check.RuntimeEdge`. Fixed and edit-only
  sub-fields have no runtime form: unless kept, the replace is refused. C6 now allows RuntimeEdge on a
  `.Replace` whose type has a graph sub-field.
- print.scrml: struct-sub-field edge tables (`<Type>_<field>_edges`, NameKey.TypeEdges) and a RuntimeEdge
  replace prints `rt.replaceChecked(target, v, [{ path, edges }])`; runtime `replaceChecked` checks each
  graph sub-field's edge (stay-put is a no-op) before the set.
- Tests (check.test.js, 6 new): fixed `y` rewritten → C7; kept → OK; `.B` Static → C7 / RuntimeEdge → OK;
  a call result can't be seen into → C7; a read of the sub-field through ANOTHER instance does not count
  as keeping it; printed `replaceChecked` + the runtime rejects a non-edge. Mutations (both RED): C7 off;
  checked replace printed as a plain `set`.
- SURFACED for the PA (not decided here): (1) sequences and `T | not` are NOT entered — `@lines = [...]`
  (a `Line[replace]` whose `Line` fields are fixed) replaces ELEMENTS wholesale and is accepted; whether a
  sequence replace must respect its element type's sub-field contracts is not ruled (the ruling names
  structs). The M1 reorder fixture depends on "accepted". (2) An append-only sub-field could be given a
  runtime prefix check instead of a refusal; not built.

## 2026-09-27 — STEP 0(b) REVISED twice by the PA (supersedes the C7 entry above; commit b62023dea reverted in scope)
- Correction 1 (PA): "fixed" is NOT a sub-field contract — a contract-free field does not bound a replace
  (⚑ O57, lean "no"); the codes are the direct write's (graph → E-ENGINE-INVALID-TRANSITION, lifecycle /
  sequence grant → E-WRITE-NOT-GRANTED).
- Correction 2 (PA, supersedes): generalizing "a whole-struct replace is judged like each changed
  sub-field's direct write" has consequences bryan was never shown (a server reload of a struct with an
  append-only / lifecycle sub-field would error; a server-side graph transition rejected; `reset` fails
  when the graph has no edge back to the default) — that generalization is ⚑ **O58** (OPEN). Implement
  ONLY the spelling hole: `@o = { ...@o, s: .X }` (a spread of the SAME value with named overrides) is a
  recognized FIELD-EDIT shape — `lower` emits one `FieldAt(s)` write per override, so C3/C6 apply the
  sub-field's contract exactly as for the direct write.
- Done (this commit): **C7 removed.** A genuine `.Replace` (non-spread value, `reset`, reload) is NOT
  bounded by sub-field contracts — `TODO(O58)` at check.scrml's Replace arm. Kept: `FieldDef.graph` (D12b).
  C3: a FieldAt whose TARGET sub-field carries a `rule=` graph is granted (it is a transition of that
  sub-field, §66.11.4 "a field is writable along its own contract"), even without an outer `replace`.
  C6: such a FieldAt is checked like a transition — a literal must be a variant of the graph's enum;
  `Static` only when every state reaches it; else `RuntimeEdge`. core.scrml: `fieldAtTarget` (shared by
  check + print) replaces the removed SubContract/contractedSubFields machinery. print: FieldAt +
  RuntimeEdge into a graph sub-field → `rt.transitionIn(target, path, <Type>_<field>_edges, v)`;
  `rt.replaceChecked` removed. Runtime `transitionIn`: stay-put no-op, edge check, `setIn`.
- Tests (check.test.js, replacing the C7 block): along the graph FieldAt(z) RuntimeEdge → accepted; Static
  to a not-everywhere-reachable state → C6; a non-variant → C6; a graph sub-field writable without the
  outer `replace`; a spread changing the contract-free `y` → accepted; a genuine `.Replace` (struct
  literal / call result) → accepted (TODO O58); printer emits `transitionIn`, runtime rejects an off-edge.
  The earlier "outer replace may not bypass a sub-field contract" FieldAt test now uses the append-only
  sub-field `w` (the graph sub-field is writable along its graph by design).
- Front-end half (M2 analyze/lower): the spread shape → FieldAt writes, with source-level tests — below.
- Mutations: "graph sub-field write skips the graph check" (C6) and "printed as a plain setIn" — both RED.

## 2026-09-27 — STEP 0(c): the dev-mode deep-freeze is DROPPED (S437 PA decision, vetoable)
- runtime.js: `DEV` / `setDev` / `freeze` / `isValue` removed; Cell / Derived / seeds store the value as-is;
  `snapshot` returns a new plain object (unfrozen); `edges` returns its table. Kept — the identity/value
  line: instance records (`class Instance`), scopes and `as=` handle cells are identities, never copied.
  Immutability is a Core fact (every write is a classified `Write` building a new value), not a runtime check.
- valuesem.browser.test: the two freeze assertions replaced (old value untouched + `isFrozen === false`;
  each `@x` snapshot a new value). bench/value-edit.bench.js: DEV column gone. This run (shared machine,
  ±30%): append 10 / 1k / 100k = 201 ns / 2.77 µs / 506 µs (in-place 11 ns / 24 ns / 3.8 µs);
  field-write 121 ns / 1.25 µs / 287 µs (in-place 7 / 6 / 31 ns). M1's DEV numbers were 52.7 ms / 51.3 ms
  at 100k. bytes/op still below heap-sampling resolution (noise, as M1 recorded for PROD).
- Mutations: all still RED after the edit (script re-run).

## 2026-09-27 — bryan's rulings O58 (b) · O57 no · O59 lean · O60 lean (user-voice S437 "RULED — O58 (b) …")
- **O58 = (b)**: the spread-only implementation above IS the ruled behaviour. check.scrml's Replace arm now
  cites the ruling instead of the TODO; the "genuine replace accepted" test is a normative assertion.
- **O57 = no**: a contract-free sub-field bounds nothing (already so).
- **O59**: conditional / `<each>`-row instance records are created AT MOUNT, fresh on each remount;
  unconditional ones at program construction (L12 (b)); construction runs in document order after the
  cells it reads. The runtime already matches (the factory creates unconditional kids; Cond arms / rows
  create theirs when they mount; owed seeds settle each dependency before its reader). Added to the M1
  dropdown test: a conditional instance picked "red" + menu open, hidden, re-shown → value "" and `.Closed`
  (fresh). The "use-site initializer reads a cell declared earlier" test is written at SOURCE level
  (slice-m2, through the real front end) — see below.
- **O60**: a use-site live expression to a LOCKED field that carries a grant (graph / sequence edits)
  SEEDS it. In Core terms this is already the printer's rule (a field with a capability is a seeded Cell;
  one without is a Derived) — the per-field decision is `wcap`, which analyze derives from the grants. The
  source-level test (`<dropdown open=(@x)/>`) is below. NOTE for the PA: the ratified O60 example sets
  `open`, a CHILD field, at a use site — setting a child field at a use site is ⚑ O43 (OPEN). The
  bootstrap follows the ratified example (a use-site attribute may name a child field); if O43 rules
  otherwise, `resolveUse` in analyze.scrml is the one place to change.
- Oracle impact: none — no line of §66.19.1/.3 changes meaning under these rulings.

## 2026-09-27 — M2: the front end (lex → parse → analyze → lower) — THE PROOF HOLDS
### Result
`lower(analyze(parse(lex(src))))` for §66.19.1 (counter) and §66.19.3 (lib/dropdown.scrml + app.scrml), the
sources byte-for-byte the SPEC code blocks (drift-guarded by a test), EQUALS M1's hand-built `counterCore()` /
`dropdownCore()` structurally, modulo a Sym-id bijection (slice-m2/compare.js — first-occurrence id mapping,
reports the FIRST differing path; its own bite is tested). **No oracle correction was needed** — M1's L1–L19
were implementable exactly as recorded. The M1 fixtures, written as source (slice-m2/fixtures/: app-reorder,
app-early, valuesem), lower to the hand-built fixture Cores too. `checkCore` is clean on every lowered Core.
**The M1 slice suite passes on the LOWERED programs**: `SLICE_CORE=lowered bun test ./compiler/self-host-v2/
slice-m1/` → 78/78 (slice-m1/cores.js switches the Core provider; default = hand-built, also 78/78).

### Design (the S233 re-cut, dpa-051 §3)
- **lex** (lex.scrml, +99 lines): `lexFrom(src, pos, stop)` runs the SAME fold as `lex` over a logic REGION
  (`Balanced` — a region starting on an opener; `BareValue` — an unquoted attribute value; `Statement` — a
  `function`/`type` declaration; `Line` — `import …`). Token types exported. No second lexer. Lexer oracle 337/337.
- **ast** (ast.scrml): every node `{ nid, span, … }` (NodeIds dense per LINKED program — the driver gives
  each file a disjoint range); bodies are trees (§4 — a test scans the parsed ASTs for stray strings).
- **parse** (parse.scrml): a char-level MARKUP scanner (tags, text, comments `//` + `<!-- -->` per §27/§4.7)
  that hands every logic region to `lexFrom` and parses it from tokens (precedence climbing, statements,
  items). Opener classification per §66.2.2 + O52 (decl / use / state-child) is syntactic. Parse-level
  diagnostics: E-DECL-OPENER-EXPR-UNPARENTHESIZED, E-DECL-ILLEGAL-FIELD-NAME, E-PARSE-*.
- **analyze** (analyze.scrml): THE BINDER (sole Sym minter) + typer + edit classifier. Phase A: types,
  declarations (the program is one — R4), functions, fields (L17 order, §66.9 modes, L3/L18 grants, graphs,
  capabilities), `as=` handles (L10, conditional flag for §66.7.5). Phase B: every body. Output: ONE
  `Tables` record (decls, types, fns, handles, and `facts: [{ nid, f: Fact }]`) — lower re-decides nothing.
- **lower** (lower.scrml): L4, L5, L7, L9, L11, L13, L14, L15, L19 and O58 (b) desugars; everything else is
  a fact it copies. Output: CoreProgram.

### Front-end diagnostics tested at source level (slice-m2/front.test.js)
Every `→ E-…` comment line of §66.19.1/.3, uncommented, produces EXACTLY that code (a table maps each
comment to its uncommented form; a test fails if the SPEC gains a negative line the table lacks):
E-DERIVED-WRITE (message names `@count` and the `let`-seeding trade-off), E-WRITE-NOT-GRANTED (names `let`),
E-DECL-HANDLE-NOT-NARROWED, E-DECL-STAR-REF-ATTR-WRITE. Also: E-DECL-RENDERS-BARE-WRITE,
E-DECL-FIELD-TAG-NEEDS-STAR, E-DECL-STAR-PREDEFINED, E-FIELD-PRIVATE-WRITE (and the exported field is
fine), `reset` without `replace` → E-WRITE-NOT-GRANTED, E-ENGINE-INVALID-TRANSITION (a spread to a state
nothing can reach). O58 (b), O59, O60 source-level tests — see below.

### The S437 rulings at source level
- O58 (b): `@d = { ...@d, phase: .Live }` over an INSTANCE → a Transition write of that field (RuntimeEdge);
  over a struct cell `@p = { ...@p, y: 5 }` → a FieldAt write (Static — `y` is contract-free under `let p`);
  `@p = { x: 1, y: 2 }` → a genuine Replace, authoritative. Runtime: along the edge it moves; off the graph
  the handler throws E-ENGINE-INVALID-TRANSITION. A target no write can ever reach (no incoming edge, not
  the initial state) is refused at COMPILE time (E-ENGINE-INVALID-TRANSITION).
- O59: `value=(@startCountry)` (a `let` attribute) is seeded "CA" at construction from a cell declared
  earlier and stays after the cell changes; `label=(@title)` (locked) tracks (L6).
- O60: `<dropdown open=(@startOpen)/>` — no E-DERIVED-WRITE; the instance starts Opened, the library's
  toggle closes/reopens it, writing `@startOpen` no longer drives it. Printer: the factory takes a
  parameter for every ATTRIBUTE and for a CHILD field some use constructs (decided from Core; M1 output
  unchanged for §66.19). ⚑ O43 note above.

### New impl#1 finding
**F17 (NEW) — a `match` arm whose body is an OBJECT LITERAL drops its named payload bindings.**
`.Eval(e: e) :> { env: env, st: f(e) }` emits `/* §1a: cannot positionally bind 'e' — variant 'Eval' field
order unknown */ return { env, st: f(e) }` → ReferenceError at runtime; no diagnostic (the same arm with a
call body binds fine). In some positions (`:> { ds: [], st: st }`) it instead surfaces as a misleading
E-CTX-001 "Unexpected `}`". Workaround: arms return through a constructor fn (`keepEnv`, `noStubs`,
`noHandles`). Silent miscompile. (F14 bit twice more — diagnostic strings with ` }`; F16 shaped every
accessor over the imported `Fact` / `AExprK` enums; F11 named binding everywhere.)

### Deviations / decisions (for the PA)
- D13 `Fact` sentinel `FNone` (factOf's answer for "no fact"): impl#1 rejects a `match` on `Fact | not`
  without a `not` arm (E-MATCH-012) even after an `is not` guard, and a `not` arm would be a default. The
  sentinel keeps every accessor total.
- D14 `Fact.FParam(sym, ty)`: Core parameters are typed; an UNANNOTATED parameter is reported
  (E-BOOTSTRAP-UNSUPPORTED) rather than given an invented type.
- Parser: `...` is three touching `.` tokens (the lexer's Ellipsis token is still deferred); spread value
  after `..` + a BareVariant (`...x`) handled.
- `<*x/>` is parsed and its diagnostics analyzed, but a VALID `<*x/>` is reported E-BOOTSTRAP-UNSUPPORTED:
  Core has no `View.Star` (M1 D4). Neither §66.19.1 nor §66.19.3 renders one (only a negative line).
- Unsupported-and-reported (never guessed): statements at logic-block level, method calls other than
  `.push` / `.unshift` / `.length`, `given` over a non-instance, a declaration with attributes/renders
  nested in `<program>`, `bind:` / `class:` attributes, state-child bodies, a whole-instance write
  that is not a self-spread.
- E-codes with no §34/§66.20 row yet are named E-PARSE-* / E-BOOTSTRAP-UNSUPPORTED / E-TYPE-* locally;
  they are bootstrap diagnostics, not language codes (the house rule: §34 rows land with the implementation).

### Measurements (bench/measure.js; this machine, shared)
| phase | lines | code lines | match-arm lines |
|---|---|---|---|
| lex (lexFrom region lexing, added in M2) | 99 | 75 | 8 |
| ast (FileAst types) | 176 | 97 | 0 |
| parse | 1583 | 1337 | 67 |
| analyze | 2516 | 2129 | 361 |
| lower | 961 | 818 | 427 |

| program | AST nodes | Core nodes (lowered) | Core nodes (oracle) | parse ms | analyze ms | lower ms | total ms |
|---|---|---|---|---|---|---|---|
| counter | 61 | 59 (155 objects) | 59 (155 objects) | 0.58 | 0.24 | 0.13 | 0.95 |
| dropdown | 239 | 170 (534 objects) | 170 (534 objects) | 1.76 | 0.60 | 0.43 | 3.01 |
(Warm medians of 15 runs, the bootstrap running as impl#1-compiled JS; excludes impl#1's own compile of the
bootstrap, ~2 s per test process.) M2 total ≈ 5.3k lines of scrml (M1 estimate: 5–8k).

### "Risk moved into lower" (dpa-051 §10) — the answer for these two programs
`lower` is the SMALLEST phase (818 code lines) and over half of it (427 lines) is match arms: total
`match`es with no default arm over the 22-variant `Fact` enum, each accessor ("the FLit here", "the FFn
there") enumerating every variant (F16 forces a binding arm; the no-default-arm lint forbids `_`). The
DESUGAR itself (L4/L5/L7/L9/L11/L13/L14/L19 + O58) is ~150 lines. The risk did not move into lower for these
programs; it moved into ANALYZE (2129 code lines: binder, InstRef resolution L1/L2/L10/L12, the edit
classifier, variant resolution by expected type). Hardest L-decisions to implement: **L1/L2/L10** (which
InstRef an `@x` / bare name / handle means depends on WHERE the code sits — decl initializer vs renders vs
function, program vs user declaration, row scope), **L12** (conditional-mount typing of handles through
nested `if=` but reset at an `<each>` row), and **L4** (reset lowers the field's initializer in the reset's
context — `.Lexical(0)` must be substituted by the reset target). L13 (text normalization) was trivial once
the parser dropped comments. What did NOT fit: a single `Fact` enum + total matches = accessor bloat —
M3 should split the tables by fact family (refs / writes / elements / binders) so each accessor matches a
small enum.

### OPEN (⚑) spellings the grammar met — followed as the SPEC text writes them
- ⚑ O10 grant spelling: `T[g1, g2]` bracket list on the element type (`string[free, end]`, `Line[replace]`);
  the axis words `free` / `end` / `front` / `anywhere` / `writable` / `replace` (anything else, incl. `any` /
  `all` → E-GRANT-UNKNOWN, §66.12.4).
- ⚑ O32 compound opener literals: parenthesized (`=([…])`, `=({ … })`); a bare `[]` is accepted (§66's examples).
- ⚑ O52 (ruled S435) state-children: the void form `<Closed rule=.Opened/>`; the `:`-shorthand body is not in slice.
- ⚑ O54 (a): `@x` inside x's own renders / initializers = the current instance (`.Lexical(0)`).
- ⚑ O33: an attribute with no default has `init: not`; a use that omits it fails at runtime (`rt.noDefault`).
- ⚑ O18: `if=` on a USE is legal (§66.19.3 writes it).
- ⚑ O43: a use-site attribute naming a CHILD field constructs it (the ratified O60 example) — see above.
- ⚑ O35: an own value with no annotation infers from a literal (int / number / string / bool); anything else
  needs `:Type` (E-TYPE-ANNOTATION-REQUIRED).
- SURFACED (not decided): a READ through a conditional `T | not` handle outside a narrowing (`${@color.value}`
  in markup) is not diagnosed — §66.7.5 mandates narrowing for WRITES only; the read would fail at runtime while
  unmounted. Whether an un-narrowed read is an error (or yields `not`) needs a ruling.

## 2026-09-27 — M2 FIX ROUND (adversarial review; branch rebased by the PA onto origin/main f52423a5d)
### F-B (MED, a bug) — `reset` inside a declaration ignored the use-site value — FIXED
`<box export let v:string="init">` used as `<box v="start"/>`: `reset(@box.v)` restored "init". L6 (§66.9, ruled)
makes the use-site attribute THAT INSTANCE's initializer, and reset re-evaluates the initializer (§6.8.2 / L4);
lower inlined the declaration's default, and Core could not name "this instance's initializer".
- **D15 (Core deviation): `Expr.InitOf(decl, inst, idx)`** — the value field `idx` of `inst` was constructed
  with (its use-site value, else the declared default), evaluated again now. `reset(@x.f)` of a USER
  declaration's field lowers to `Write(cap, inst, .Replace, InitOf(x, inst, f), Static)`. The PROGRAM (R4, a
  `single` with no use site) keeps the inline initializer — its initializer is the declared one — so the
  §66.19.1 oracle (`restart` → `litInt(0)`) is UNCHANGED; §66.19.3 has no reset. Both proofs still hold.
- walk (kids = the InstRef), check (C5: the InstRef resolves to `decl`, `idx` is its field), measure.
- print: a factory keeps `inst$.inits[i]` ONLY for a field some `InitOf` names (M1 output unchanged);
  `InitOf` prints `rt.initial(inst, i)` = `untrack(inst.inits[i])`. Runtime: `Instance.inits`, `initial`.
- Test (front.test.js): three uses of `<box>` — use-site "start" restored, no use-site → "init" restored, a
  LIVE-seeded `let` (`v=(@src)`, O60 / rule 8) re-evaluates its initializer at reset ("live2" after @src
  changed, though the seeded value did not follow). Mutation "reset inlines the declared initializer" → RED.

### F-D (LOW) — `#{ … }` inside markup lowered as literal Text — FIXED
parse.scrml `atCss` / `skipCss`: a `#{…}` block, in markup children or at program/file item level, is lexed
as a Balanced region (so its braces and strings are skipped correctly), dropped, and reported
E-BOOTSTRAP-UNSUPPORTED ("a `#{…}` CSS block is not in bootstrap slice M2"). Test: parse.test.js.

### F-C (LOW) — `@count += @step` gave "E-PARSE-EXPR: expected an expression, found '='" — FIXED
The lexer has no compound-assignment token (`+=` is `+` then touching `=`). binPrec stops before an
arithmetic operator that touches a following `=`; parseAssign reports E-BOOTSTRAP-UNSUPPORTED "compound
assignment `+=` is not in bootstrap slice M2 — write `x = x + …`" (and `++` / `--` likewise, by name), one
diagnostic, no cascade. Test: parse.test.js.
**`<let count:int = 0/>` (spaces around `=`)** — SPEC §66.2.2 (i), quoted: *"an own value — `=` immediately
after the name, or after `name:Type` (`<count=0/>`, `<count:int=0/>`)"*. "Immediately" rules the spaced form
OUT as the own-value marker; the SPEC does not name a diagnostic for it. The parser reports
E-PARSE-OPENER-EQ-SPACED (bootstrap-local code, quoting §66.2.2) once and reads the value (the same for a
typed attribute default `title:string = "x"`, by the same sentence's "after `name:Type`").

### RULED S437 — reads require narrowing (bryan: "yes, reads require narrowing") — DONE
Supersedes the "SURFACED (not decided)" note above. A READ through a conditionally-mounted handle
(`T | not`, §66.7.5) outside a narrowing — `${@color.value}` in markup, `@color.value` in logic — is
**E-DECL-HANDLE-NOT-NARROWED**. Code choice: the §66.20 row defines it as "a write through an `as=` handle
typed `T | not` … without a preceding narrowing"; the ruling extends the same condition to reads, so the
same code is used and the §66.20 row's "Fires when" needs the word "or read" (for the SPEC amendment —
the definition as written does NOT yet cover reads). analyze: `resolveAtRead` (every `@h` in value position);
`resolveHandleSubject` for a `given` subject and a write target (a write keeps exactly one diagnostic,
from writeGuards). Tests (front.test.js): markup read refused; logic read refused; `given c = @color :> {
@seen = c.value }` accepted; an UNconditional handle read (`@country.value`) accepted; the §66.19.3 write
line still yields exactly one diagnostic. Mutation "un-narrowed read accepted" → RED. The §66.19.3 program
is unaffected (`@country` is unconditional; `@qty` is unconditional within its row).

### F-A (MED) — NOT YET CHECKED: value types, arity, redeclaration — DISCLOSED (not fixed this round)
"Reported, never guessed" above is true for SYNTAX and for the §66 write/read contracts only. analyze has NO
value-type checker and NO redeclaration check. These shapes compile SILENTLY and run wrong (each confirmed
silent, and pinned in slice-m2/typer-gap.test.js — a "today: silent" test plus a `test.failing` stating the
required diagnostic; both flip the day the typer lands):
- `@x = "oops"` into an `int` cell;
- a call with the wrong arity; a call with a wrong argument type;
- `<each in=@x>` over an `int`;
- a non-bool `if=`; a non-bool ternary condition;
- `label=(5)` for a `string` attribute;
- a duplicate `<let x>`; duplicate `as=` names; duplicate function names; a handle named like a cell.
**M3 ITEM 1 (before the front end grows):** a typer pass in analyze — types in the §3.5 tables (a type per
expression nid), checked assignments / arguments / conditions / `in=` / construction values → the
E-TYPE-001 family, and a scope pass → E-SCOPE-REDECLARE.

### INFO items (review) — DONE
- **Canonical ConstructAttrs**: lower emits a use's construction attributes in FIELD-INDEX order, so the Core
  of a use does not depend on source attribute order (test: two orderings lower to equal Cores; §66.19
  oracles unchanged — their source order already was field order).
- **The L7 arm-swap mutation is BEHAVIOUR-NEUTRAL**: swapping the `true`/`false` arms of the lowered ternary
  (L7) changes the Core but not the program — the printer turns either order into the same `?:` (print
  `matchJs` recognizes both). It goes RED only through the structural comparator (lower.test.js), not through
  any runtime test. Recorded so nobody reads that RED as a runtime check.
- **`FieldDef.graph` REMOVED** (supersedes D12b and the step-0(b) FieldAt-graph machinery): no source form
  declares a `rule=` graph on a `type … :struct` field, so the front end could never fill it. Removed with
  it: check's FieldAt-into-graph branch (C3/C6), print's `transitionIn` / struct-type edge tables
  (`NameKey.TypeEdges`), runtime `transitionIn`, core `fieldAtTarget`, and the two mutations that targeted
  them. What remains of O58 (b) is where the source can reach it: the spread over an INSTANCE lowers to a
  `.Transition` write of its graph FIELD (Field.graph — declaration fields), over a struct cell to FieldAt
  writes (front.test.js). check.test's C7-era block is replaced by one normative test: a genuine `.Replace`
  rewriting contracted sub-fields is accepted (O58 (b)). Re-add FieldDef.graph when a declaration-typed
  struct cell (§66.8.1) can carry one.
- **bench/mutations.js mutates a COPY**: a mirror under the worktree's gitignored `.tmp/mutations-<pid>`
  (a copy of compiler/self-host-v2 + the lint script, symlinks to compiler/src, native-parser, SPEC.md);
  tests run in the mirror; the mirror is deleted at the end. A kill mid-run leaves the source untouched.
  Result this round: 23 mutations, all RED; the unmutated suite on the mirror is green.
- **check.test F5 hard-coded indices**: fields / declarations / functions / types are looked up BY NAME
  (`field(core, "dropdown", "value")`, `fnNamed`, `withDecl`), never by position.

## 2026-09-27 — M3 item 1: F-A CLOSED (s439-bootstrap-m3-typer)
The typer and the scope pass landed in analyze.scrml ("THE SCOPE PASS", "THE TYPER"); the typer's facts are
their own table (`Tables.typing`: a VType per expression NodeId). The eleven F-A pins were a hypothesis and
were resolved against SPEC.md first (docs/changes/s439-bootstrap-m3-typer/progress.md has the quoted
sentences): `@x = "oops"` → E-TYPE-031 (§66.1 rule 5); `label=(5)` → E-TYPE-031 (§7.5.1 position 2 via
§66.9 rule 8); duplicate `<let x>` and duplicate functions → E-SCOPE-010 (§7.3.3 routes file scope there,
NOT E-SCOPE-REDECLARE); arity, `<each in=>` over a non-sequence, duplicate `as=`, handle-vs-cell →
bootstrap-local E-BOOTSTRAP-* (SPEC silent; owe rulings). THREE PINS WERE WRONG and are now "stays silent"
tests: a wrong ARGUMENT type (§7.5.1: positions 3-5 "SHALL compile"), a non-bool `if=` and a non-bool
ternary test (conditions are boolean-coercible, §17.1.1 / §49.2.3). Tests: typer-gap.test.js (each shape +
a well-typed twin), typer.test.js (families, adversarial controls, Typing coverage, §66.19 zero typer codes).
