# S397 tilde-one-or-two — research progress (append-only)

## Startup gate (all pass)
- WORKTREE_ROOT: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a9225a06dce5e5f3c
- toplevel == pwd; tree clean; merge-base HEAD origin/main == origin/main == 326ecde378cfb1a4820f308c17bc84a37d76e8a8
- bun install OK (218 pkgs); `bun run pretest` PLAIN from worktree root OK — samples/compilation-tests/dist/ populated (verified by ls, 13 samples)

## Map consult
- `.claude/maps/primary.map.md`: 141 rows. `grep -n "§32"` -> ZERO hits. `grep -i tilde` -> 2 hits, BOTH about
  if-as-expression binding sites (rows 85 and the emit-logic routing row), NOT about `~` the keyword/accumulator.
  **THIRD CONFIRMATION: the `~`/§32 surface has zero map rows.**
- One incidental but load-bearing finding: `_scrml_tilde_N` is ALSO the emitted variable family for
  if-as-expression result binding (row 85 quotes `let _scrml_tilde_2 = null;` for `const label = if (...)`).
  So the emitted symbol is shared between the §32.2 single-value role and the §17.6 arm-result role.

## SPEC read (targeted, no full read)
- §32 (SPEC.md:19221-19537) IN FULL. **§32 never mentions arrays or the loop accumulator at all.**
  Its whole model is single-value-of-preceding-statement + lin exactly-once.
- §48.5 / §48.5.1 (:26353-26386) — the `fn` accumulator: `for (...) { lift item } return ~`.
- §49.4.4 (:27005) — the "sole exception" permitting `while` in expression position.
- §49.6.1 (:27068) — `while` accumulator: `while (hasNext()) { lift getNext() }  let result = ~`.


## Corpus enumeration — EXHAUSTIVE, not sampled

Sweep: `find -name '*.scrml'` across scrml (2421) · scrml-native (11) · 6nz (11) · scrml-support (860) ·
flogence (22) · giti (83) = **3408 files**. `grep -n '~'` -> **876 lines in 451 files**.

Filtered to READ shapes (`return ~` | `= ~` | `~.` | `~[` | `(~)`/`,~` | `lift ~`): **33 lines, 13 files**.
Residual 843 lines audited for missed shapes (bare `~` statement, `~` in operator/pipe position, `~` in
`${}` interpolation, `if (~`/`of ~`): **the residual is almost entirely `~{` — the inline-test-block sigil**,
plus prose in `.scrml` doc pages and comments in the native-parser. **Zero missed read shapes.**
The prior dispatch's "10 `~`-reading scopes across 3,404 files" is CONFIRMED (I count 3408 files / 11 scopes;
the delta is the two S397 ctrl-027/028 cases landed today).

### The complete population, by which ROLE of `~` it exercises

**VALUE role (§32.2 — value of the preceding statement):**
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-as-expr-tilde-complete-013.scrml:5` — `if (cond) lift 1; else lift 2;` then `let dbl = ~ * 2`
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-if-as-expr-tilde-partial-012.scrml:5` — same, no `else` (E-TILDE-001 intent)
- `conformance/cases/control-flow/ctrl-028-arm-body-tilde-read-orphan-neg/case.scrml:10,23,32` — 3 scopes, in-arm reads
- `examples/24-tilde-pipeline.scrml:35,45` — `step1(2)` then `return step2(~)` / `const result = step2(~)`

**ARRAY role (§48.5.1 / §49.6.1 — loop/lift accumulator):**
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-fn-multiline-011.scrml:8` — `fn buildItems(names) { for (const name of names) { ... lift item } return ~ }` (SHAPE 1, verbatim)
- `samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-lin-lift-014.scrml:8` — `fn run() { lin token = fetchToken(); lift token; return ~ }` (NO loop, single lift)
- `conformance/cases/fn/lift-local-accumulator-clean/case.scrml:5` — `fn helper() { lift "a"; return ~ }` (NO loop)
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-lift-061.scrml:10` — `while` in a NESTED `${}`, read in the OUTER one
- `conformance/cases/control-flow/loop-007-while-as-expr-neg/case.scrml:7` — `while (@n<3) { ... lift @n }  let result = ~` (SHAPE 7)

**Boundary:** `conformance/cases/fn/lift-outer-accumulator-reject/case.scrml:3` — `~acc = []` (SHAPE 10 / E-FN-008).
Note the token there is `~acc`, NOT `~` — flagged separately.

**Both roles are live in the corpus.** The contradiction is in shipped conformance cases, not only in SPEC.

## MEASURED BEHAVIOUR AT HEAD (326ecde3) — shapes 1-4

Harness: `bun run compiler/src/cli.js compile <probe>.scrml --output-dir <out>`; verdict read from the
emitted `.client.js`, never from SPEC's self-description.

### SHAPE 1 — pure `fn` accumulator (§48.5.1's own example, corpus-verbatim)
Source `fn buildItems(names) { for (const name of names) { lift name } return ~ }`.
**exit 0.** Emitted:
```js
function _scrml_buildItems_3(names) {
  let _scrml_tilde_4 = [];
  for (const name of names) { _scrml_tilde_4.push(name); }
  return _scrml_tilde_4;
}
```
So the ARRAY role is REAL and SHIPPING: `~` is a `let <name> = []` + `.push()` per lift + read at `return`.
The corpus original (`phase1-fn-multiline-011.scrml`) emits the identical shape.

### SHAPE 2 — statements before the loop
`const pre = setup()` then the loop then `return ~`. **exit 0.** The accumulator is minted
**at the loop, not at fn-body top**: `const pre = _scrml_setup_3(); let _scrml_tilde_5 = []; for (...) ...`.

### SHAPE 3 — reads `~` then computes: `const n = ~.length  return n`
**exit 1 — `E-FN-008` FALSE POSITIVE.** Diagnostic: *"`lift` at line 5 inside `fn countItems` targets a
`~` accumulator initialized outside the `fn` boundary."* It is not outside: it is the same fn body, and
**codegen emitted perfectly correct JS anyway** —
`let _scrml_tilde_4 = []; for(...){push} const n = _scrml_tilde_4.length; return n;`.
Only the swap of `return ~` for `const n = ~.length` moved it from exit 0 to exit 1.
**So at HEAD the ARRAY role is only usable through the single literal spelling `return ~`.** (See the
E-FN-008 trigger analysis below.)

### SHAPE 4 — TWO loops, ONE accumulator ⚑ (the shape the PA predicted would break)
`for (x of xs) { lift ... }  for (y of ys) { lift ... }  return ~`. **exit 0 at HEAD.** Emitted:
```js
function _scrml_merge_3(xs, ys) {
  let _scrml_tilde_4 = [];
  for (const x of xs) { _scrml_tilde_4.push("x:" + x); }
  for (const y of ys) { _scrml_tilde_4.push("y:" + y); }
  return _scrml_tilde_4;
}
```
**ONE array, two push loops, exit 0.** The shape is real, works today, and is exactly the fold the
loop-expression form cannot produce in one binding. Cost analysis in FINDINGS.md.

## MEASURED BEHAVIOUR AT HEAD — shapes 5-10

### SHAPE 5 — conditional lift (a filter)
`for (const x of xs) { if (x % 2 == 0) { lift x } }  return ~`. **exit 0.**
`let _scrml_tilde_4 = []; for(...) { if ((x % 2 === 0)) { _scrml_tilde_4.push(x); } } return _scrml_tilde_4;`

### SHAPE 6 — nested loops, inner lift
`for (row of rows) { for (cell of row) { lift cell } }  return ~`. **exit 0.**
The inner `lift` reaches the OUTER (fn-body) accumulator and the result is **FLAT**:
`let _scrml_tilde_4 = []; for(row){ for(cell){ _scrml_tilde_4.push(cell); } } return _scrml_tilde_4;`
There is exactly ONE accumulator per `fn` body, not one per loop.

### SHAPE 7 — `while` accumulator inside `fn` (§49.6.1)
`let i = 0  while (i < n) { lift i * 10  i = i + 1 }  return ~`. **exit 0.**
`let i = 0; let _scrml_tilde_4 = []; while (i < n) { _scrml_tilde_4.push(i*10); i = i+1; } return _scrml_tilde_4;`

### SHAPE 8 — early `return ~` from INSIDE the loop (partial accumulation)
`for (x of xs) { if (x == "STOP") { return ~ }  lift x }  return ~`. **exit 0.**
Emits `return _scrml_tilde_4;` from inside the loop — the PARTIALLY-BUILT array is returned. Real fold-with-halt.
**8b (same, plus a post-loop `lift "END"`)**: also exit 0 —
`for(...){ if(eq(x,"STOP")) return acc;  acc.push(x); }  acc.push("END");  return acc;`
i.e. the early exit SKIPS the post-loop lift. Loop-expression cost analysed in FINDINGS.md.

### ⚑⚑ SHAPE 9 — an unbound expression statement AFTER the loop SILENTLY DESTROYS THE ACCUMULATOR
This is the single most consequential measurement in this dispatch.
```scrml
fn build(xs) {
    for (const x of xs) { lift x }
    note("after loop, before read")     // an ordinary unbound call
    return ~
}
```
**exit 0. Zero diagnostics. And the emitted JS returns the WRONG VALUE:**
```js
function _scrml_build_4(xs) {
  let _scrml_tilde_5 = [];
  for (const x of xs) { _scrml_tilde_5.push(x); }
  let _scrml_tilde_6 = _scrml_note_3("after loop, before read");
  return _scrml_tilde_6;          // <-- returns the STRING, not the array
}
```
`_scrml_tilde_5` is minted, pushed to, then DEAD. `return ~` resolves to the §32.2 VALUE `~`
(`_scrml_tilde_6`), not to the §48.5.1 ARRAY `~`. **The one-vs-two contradiction is not only a SPEC
contradiction — it is a SHIPPED SILENT MISCOMPILE at HEAD.** Two roles, one name, and the compiler
picks the later one with no diagnostic. Nothing in §32.5's trigger list catches it (E-TILDE-001/002
have zero fire sites), and `--validate-emit` cannot see it because the JS is syntactically valid.

### ⚑ SHAPE 10 — `lift` inside a `fn` called from a loop (§48.5's E-FN-008 boundary) — plus a SECOND finding
```scrml
fn one(x)   { lift x        return ~ }
fn outer(xs){ for (const x of xs) { lift one(x) }  return ~ }
```
**exit 0, NO E-FN-008** — the boundary holds; the callee's `lift` does not reach the caller. But look
at the emitted callee:
```js
function _scrml_one_3(x) { let _scrml_tilde_4 = x;  return _scrml_tilde_4; }   // a SCALAR, not [x]
function _scrml_outer_5(xs){ let _scrml_tilde_6 = []; for(...){ _scrml_tilde_6.push(_scrml_one_3(x)); } return _scrml_tilde_6; }
```
**A `lift` NOT inside a loop produces a SCALAR `~`; a `lift` inside a loop produces an ARRAY `~`.**
The array-ness of `~` is decided by SYNTACTIC CONTEXT (is there an enclosing loop), not by the `lift`.
This directly contradicts §49.6.1's *"If the `while` loop lifts nothing … `~` holds an empty array"*,
which asserts `~` is an array unconditionally in lift-accumulating position. It also means the corpus
case `conformance/cases/fn/lift-local-accumulator-clean/case.scrml` (`fn helper(){ lift "a"  return ~ }`,
consumed as `<ul>${helper()}</ul>`) is returning the STRING `"a"`, not `["a"]`.

## ⚑ THE ARRAY ROLE IS REACHABLE THROUGH EXACTLY ONE SPELLING — `return ~` at fn-body top level

Root cause read from source (READ-ONLY): `compiler/src/type-system.ts:24920-24943` + `:25395-25404`.
E-FN-008 fires when `hasLiftInBody && !hasFnLocalTilde`. `hasFnLocalTilde` is set by ONLY two things,
and both are scanned over the fn body's **TOP-LEVEL statement list only**:

```ts
if (stmt.kind === "tilde-decl" || stmt.kind === "tilde-stmt") hasFnLocalTilde = true;
if (stmt.kind === "return-stmt" && textMentionsTilde(stmt))   hasFnLocalTilde = true;
// textMentionsTilde: /(^|[\s(=,{\[])~($|[\s);,}\]])/  — a BARE ~ token between delimiters
```

Measured consequences — **every one of these emits CORRECT JS and still exits 1:**

| spelling inside the `fn` | emitted JS | exit |
|---|---|---|
| `return ~` (top level) | `return _scrml_tilde_4;` | **0** |
| `const n = ~.length  return n` (shape 3) | `const n = _scrml_tilde_4.length; return n;` | **1 — false E-FN-008** |
| `return ~.length` (3b) | `return _scrml_tilde_4.length;` | **1 — false E-FN-008** (`.` is not in the regex's trailing class) |
| `const acc = ~  return acc` (3c) | `const acc = _scrml_tilde_4; return acc;` | **1 — false E-FN-008** |
| early `return ~` INSIDE the loop, no top-level one (8c) | `return _scrml_tilde_4;` inside the `for` | **1 — false E-FN-008** (not top level) |

§32.3 enumerates the valid consumptions of `~` as *"`let result = ~`, `if (~.ok)`, `process(~)`, `lift ~`"*.
**Inside a `fn`, NONE of those four compile.** Only the one spelling `return ~` does.
That is a live, load-bearing constraint on any migration story and it is measured, not inferred.

Corpus corroboration: `conformance/cases/fn/lift-local-accumulator-clean/expected.json` asserts only
`codes: []` / `notCodes: ["E-FN-008"]` — **no conformance case anywhere pins the VALUE `~` produces.**

## The logic-context (`${}`) accumulator also works — and co-emits the markup-lift plumbing
- `while (@n<3) { @n = @n+1  lift @n }  let result = ~` (corpus `loop-007-while-as-expr-neg`, verbatim):
  exit 0; `let _scrml_tilde_2 = []; while(...) { ...push... } let result = _scrml_tilde_2;`
- `for (const n of names) { lift n }  let result = ~`: exit 0, same shape.
Both ALSO emit `_scrml_lift_target = document.querySelector(...)` around the body — i.e. in a `${}`
context the compiler wires up the MARKUP-lift target AND the VALUE accumulator in the same body.

## ⚑⚑ THE PROPOSED LOOP-EXPRESSION FORM ALREADY COMPILES AT HEAD — for `for`, NOT for `while`

The brief treats `const items = for (n of names) { lift n }` as a PROPOSED form. **It is not proposed —
it ships.** Measured:

```scrml
fn buildItems(names) {
    const items = for (const name of names) { lift name }
    return items
}
```
**exit 0, no E-FN-008.** Emitted:
```js
function _scrml_buildItems_2(names) {
  let _scrml_tilde_3 = [];
  for (const name of names) { _scrml_tilde_3.push(name); }
  const items = _scrml_tilde_3;
  return items;
}
```
That is exactly loop-expression semantics: hoist the loop, mint the accumulator, bind it. Codegen needs
NO new machinery for the `for` case.

### The re-expressions, measured

| shape | loop-expression re-expression | result |
|---|---|---|
| 1 pure | `const items = for (...) { lift n }  return items` | **exit 0**, correct |
| 4 two loops | `const a = for(xs){lift}  const b = for(ys){lift}  return a.concat(b)` | **exit 0**, correct — two accumulators + `.concat` |
| 6 nested | `const cells = for (row of rows) { for (cell of row) { lift cell } }  return cells` | **exit 0**, FLAT, correct — the inner lift reaches the bound loop-expression |
| 8 early exit | `const items = for (x of xs) { if (x=="STOP") { break }  lift x }  return items` | **exit 0**, correct — `break` inside a loop-expression works |
| 7 `while` | `const items = while (i < n) { lift i*10  i = i+1 }  return items` | **exit 1 — `E-LOOP-007`** |

### ⚑ The `while` limb is the hole, and TWO things about it are notable

**(a) The E-LOOP-007 message ALREADY names the loop-expression form as the alternative:**
> `` `while` is a statement, not an expression (§49.4.4). Use the `~` accumulator pattern to collect a
> value across iterations, **or refactor to a `for/lift` expression.** ``

So the compiler already regards `for/lift` as an expression form and `while` as the excluded one. The
"sole exception" of §49.4.4 exists precisely because `while` has no expression form; `for` doesn't need one.

**(b) The rejected compile still emits INVALID JAVASCRIPT.** The `.client.js` for R7 contains raw scrml:
```js
  const items = while ( i < n ) {
  lift i * 10
  i = i + 1
  };
```
Exit is 1 so nothing ships, but codegen fell through rather than refusing. Flagged as a side observation,
not in scope to fix here.

## MARKUP-LIFT FACT — CONFIRMED, INDEPENDENTLY
`<ul>${ for (const x of @items) { lift <li>${x}</> } }</ul>` compiles at exit 0 and the emitted client JS
contains **ZERO `_scrml_tilde`**. It uses `_scrml_lift_target` / `_scrml_lift(...)` / `_scrml_list_wrapper_N`
/ `_scrml_reconcile_list`. §32.2's *"a `lift` statement SHALL initialize `~`"* is **unimplemented for markup
lift**. The PA's settled fact holds.

## ⚑⚑ SHAPE 14 — header / loop / footer: a SECOND shipped miscompile, and this one HARD-CRASHES

```scrml
fn framed(xs) {
    lift "HEADER"
    for (const x of xs) { lift x }
    lift "FOOTER"
    return ~
}
```
**exit 0, zero diagnostics.** Emitted:
```js
function _scrml_framed_3(xs) {
  let _scrml_tilde_4 = "HEADER";     // SCALAR seed — the first lift is not inside a loop
  for (const x of xs) {
    _scrml_tilde_4.push(x);          // TypeError
  }
  _scrml_tilde_4.push("FOOTER");
  return _scrml_tilde_4;
}
```
**PROVEN BY EXECUTION, not by reading the JS** (`bun scratchpad/s397/exec-s14.mjs`, the emitted body verbatim):
```
THROWS: TypeError: _scrml_tilde_4.push is not a function.  (In '_scrml_tilde_4.push(x)')
empty input THROWS: TypeError: ... (In '_scrml_tilde_4.push("FOOTER")')     <- crashes even on []
shape 9  build(['a','b']) = "after loop, before read"      <- expected ['a','b']
shape 10 one('a')         = "a"                            <- §49.6.1 says an accumulator holds an ARRAY
```
Syntactically valid JS, so §2.2.1's `--validate-emit` gate is structurally blind to it.
Building a list with a fixed header and footer is an ordinary thing to write. It compiles clean and
crashes on the first iteration, including on an EMPTY input.

## SHAPE 15 — conditional second loop into one accumulator: works
`for (x of xs) { lift x }  if (includeExtras) { for (y of ys) { lift y } }  return ~` — exit 0, one
accumulator, `if` wrapping the second push loop. Correct.

## Which loop forms support the loop-expression binding, measured

| form | `const v = <loop> { lift … }` | result |
|---|---|---|
| `for (const x of xs)` | yes | **exit 0**, correct |
| `while (cond)` | no | **exit 1 — `E-LOOP-007`**, and codegen emits raw scrml into the `.client.js` |
| `do { … } while (cond)` | no | **exit 1 — `E-CODEGEN-INVALID-LOGIC`** |
| C-style `for (let i=0; i<n; i=i+1)` | no | **exit 1 — `E-CODEGEN-INVALID-LOGIC`** |

Only `for…of` has the expression form. §49.6.1's own canonical condition-driven shape
(`fn drain() { let c = 0  while (hasNext(c)) { lift getNext(c)  c = c+1 }  return ~ }`) compiles CLEAN at
HEAD (exit 0, correct array) and has **no `for…of` to convert to** — the iteration count is not known
in advance and there is no collection to walk.

## THE THREE KNOCK-ONS

### 1. §32.6 all-or-nothing elision — DELETABLE, and it is ALREADY vacuous. ⚑ Root cause differs from the brief.

The elision predicate is `hasNonLiftTildeConsumer(nodes)` (`type-system.ts:18429`), used at exactly two
sites (`:18956` per-loop-body `elide` flag; `:19547-19550` `lastWasElisionLoop` at scope exit) and
exported only for two unit tests (`compiler/tests/unit/type-system.test.js:1845,1852`). **No other
consumer.** Deleting the rule touches those two sites plus two synthetic unit tests. Confirmed.

But it is already dead in practice, and **for a reason the brief did not name**:

> `grep -rn "tilde-init\|tilde-ref" compiler/src/ compiler/native-parser/` returns **FOUR hits, all in
> `type-system.ts`, and all of them CONSUMERS**: `:18435` (the predicate's test), `:18744`
> (`case "tilde-init"`), `:18750` (`case "tilde-ref"`). **ZERO producers anywhere in the compiler.**

The parser / ast-builder never emits a `tilde-init` or `tilde-ref` node, so:
- `TildeTracker.initialize` is reachable only from `case "lift-stmt"` (`:18761`);
- `TildeTracker.consume` is reachable only from `lift-stmt` with `node.usesTilde` (`:18758`);
- `hasNonLiftTildeConsumer` returns **`false` unconditionally on real source** — so the §32.6 elision
  is permanently ON.

⚑ **CORRECTION TO THE BRIEF.** The brief attributes the zero-fire to `type-system.ts:18586` / `:19259`
carrying `if (name.startsWith("@") || name === "~") return;` plus `exprNodeFields` omitting
`ifExpr`/`forExpr`/`matchExpr`. Both of those lines are real — I read them — but **they are in
`consumeLinRef` / `consumeLinRefExternal`, which is the LIN tracker path, not the TildeTracker path.**
They explain why `~` is excluded from E-LIN-00x; they do not explain the dead E-TILDE-001/002.
The missing node-kind producers do. Reported because the brief asked for anything in it that was wrong.

**Verified by execution, not relayed** — SPEC's own verbatim invalid examples compile clean:
- §32.7 *"Invalid — `~` used without initialization (E-TILDE-001)"*: `let result = transform(~)` →
  **exit 0**, no diagnostic. Emitted: `let result = _scrml_transform_1(null /* ~ orphaned — codegen-fallback */);`
- §32.5 *"Invalid — reinitialization without consumption (E-TILDE-002)"*: `fetchUser(1)` then
  `fetchOrder(2)` → **exit 0**, no diagnostic.
- §32.6's own *"Invalid"* elision example (`getHeader()  let hdr = ~  for (…) { lift <li>… }`) →
  **exit 0**, no diagnostic.

The E-TILDE unit tests at `compiler/tests/unit/type-system.test.js:1770-1880` pass because they hand
the checker synthetic `{ kind: "tilde-ref" }` / `{ kind: "tilde-init" }` nodes directly. Green tests,
dead code path. **Note the implementation is ALSO narrower than §32.6 says even where it does run:**
§32.6 is *"all-or-nothing per logic context"*, but `:18956` scopes `elide` to the LOOP BODY and
`:19549` only elides when the loop is the LAST node in the body.

### 2. §35.8 unification — the SPEC/impl contradiction is confirmed; the claim is directionally sound

§35.8 (`SPEC.md:20870`) states normatively: *"`~` SHALL be tracked as a `lin` variable by the linear
type checker. The same enforcement pass handles both named `lin` declarations and `~`."*
The implementation says the opposite, in a comment, at `type-system.ts:19257-19258`:
```ts
// Reactive variable references start with '@' — not lin variables.
// Tilde accumulator is '~' — not a lin variable.
if (name.startsWith("@") || name === "~") return;
```
Both exclusion sites confirmed (`:18586` in `consumeLinRefExternal`, `:19259` in `consumeLinRef`).
`~` is tracked by a SEPARATE `TildeTracker` (`:18380`) threaded through `checkLinear` as a parallel
tracker — exactly the duplication §35.8 says should not exist.

Under one-thing, `~` becomes a plain single-value read-once slot and the two paths genuinely could
merge. ⚑ **Sanity-check caveat:** the merge is not free-standing — you must ALSO give `~` producer
node kinds, because `LinTracker` is driven off identifier references while `TildeTracker` is driven
off node kinds that nothing produces. Unifying without fixing that just moves dead code.

Also flagged: **§35.8's closing cross-reference is stale** — *"See §31 for the complete specification
of `~`"*. `~` is §32; §31 is a different section.

### 3. §49.4.4's "sole exception" — DOES NOT dissolve. It becomes a CAPABILITY HOLE.

§49.4.4: *"A `while` statement in a `lift`-accumulating context (§49.6) is valid as an expression
position assignment target via the `~` accumulator. **This is the only exception.**"*

The exception exists precisely BECAUSE `while` has no expression form. Measured:
- `const items = while (i < n) { lift … }` → **E-LOOP-007**, exit 1. Trigger read at
  `type-system.ts:19850-19882`: it fires when a `let`/`const`/`tilde-decl` init is an **escape-hatch
  ParseError** whose raw matches `/^while\s*\(…\)\s*\{…\}$/`. **The parser cannot parse it at all** —
  this is a grammar gap, not merely a checker rejection.
- `const items = do { … } while (…)` → **E-CODEGEN-INVALID-LOGIC**, exit 1.
- `const items = for (let i=0; i<n; i=i+1) { … }` → **E-CODEGEN-INVALID-LOGIC**, exit 1.
- `const items = for (const x of xs) { lift x }` → **exit 0, correct.**

So under one-thing WITHOUT extending the loop-expression form to `while`, §49.4.4's exception does not
dissolve into a general rule — **it is deleted, and with it the only way to get a value out of a
`while`.** That is a strict capability loss, not a simplification.
It dissolves only if the loop-expression form is extended to `while` / `do…while` (and, for symmetry,
C-style `for`). ⚑ The E-LOOP-007 message ALREADY tells authors to *"refactor to a `for/lift` expression"*,
so the compiler's own diagnostic already assumes the form exists — it just doesn't for `while`.

## FOUR MORE SHAPES FROM THE CORPUS + COMPOSITION LIMITS

### ⚑⚑ SHAPE 16 — a THIRD shipped miscompile, and it is a file in the PRETEST SET
`samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-lift-061.scrml`, whose own
first line reads `// while + lift produces array (§49.6)`:
```scrml
${
    let i = 0
    ${ while (i < 3) { lift i * 10   i = i + 1 } }
    let result = ~
    log(result.length)
    function log(n: number) { let _ = n }
}
```
**exit 0, zero diagnostics.** The ENTIRE emitted body is:
```js
function _scrml_log_2(n) { let _ = n; }
_scrml_lift_target = document.querySelector('[data-scrml-logic="_scrml_logic_1"]');
let i = 0;
let result = null /* ~ orphaned — codegen-fallback */;
_scrml_lift_target = null;
```
**The `while` loop is GONE. The `log(result.length)` call is GONE. `result` is `null`.** Three
statements silently dropped from a compile that exits 0. (The drop also masks the `null.length`
that would otherwise throw.) This file is compiled by `bun run pretest` on every developer machine.
Note the source is ALSO spec-invalid — §32.4 says `~` does not cross a `${}` boundary and this should
be E-TILDE-001 — so there are two failures stacked: the mandated diagnostic does not fire, AND the
fallback silently deletes code instead of failing.

### SHAPE 17 — `lin` + single lift (`samples/.../phase1-lin-lift-014.scrml`)
`fn run() { lin token = fetchToken()  lift token  return ~ }` → exit 0; emits
`const token = _scrml_fetchToken_3(); let _scrml_tilde_5 = token; return _scrml_tilde_5;`
— SCALAR again (shape-10 class). The file's consumer is `<p>${run().length}</>`, which therefore
renders `3` (`"tok".length`) rather than `1` (an array length).

### SHAPE 18 — `continue` in an accumulating loop
`for (x of xs) { if (x=="skip") { continue }  lift x }  return ~` → exit 0, correct.
Loop-expression re-expression → exit 0, correct. **EXPRESSIBLE.**

### SHAPE 15's re-expression, and a COMPOSITION LIMIT of the loop-expression form
HEAD shape: `for (x of xs) { lift x }  if (flag) { for (y of ys) { lift y } }  return ~` — exit 0, correct.
- Re-expression A (condition moved INSIDE the second loop):
  `const base = for (x of xs) { lift x }   const extra = for (y of ys) { if (flag) { lift y } }   return [...base, ...extra]`
  → **exit 0, correct** — but it **now iterates `ys` unconditionally.** If `ys` is absent/expensive when
  `flag` is false, that is a real semantic change, not a cosmetic one.
- Re-expression B (the faithful one — a loop-expression as an if-arm's lifted value):
  `const extra = if (flag) { lift for (y of ys) { lift y } } else { lift [] }`
  → **exit 1, `E-CODEGEN-INVALID-LOGIC`.** A loop-expression CANNOT currently appear as the lifted
  value of an if-as-expression arm. **This is a second hole in the loop-expression form, distinct from
  the `while` hole: composition.**

### Array-building helper forms that DO work (used by the re-expressions)
`a.concat(b)` → exit 0. `[...a, ...b]` → exit 0. `["H", ...mid, "F"]` → exit 0.

---

# ⚑ FINAL VERDICT + MATRIX (the dispatch deliverable)

> The brief named `FINDINGS.md` as the output path. The dispatch harness blocks a sub-agent from
> creating a report `.md`, so the deliverable is landed here, at the tail of the mandated crash
> anchor, in the same directory. Same content, same landing path
> (`git checkout <branch> -- docs/changes/s397-tilde-one-or-two/`). Surfaced, not silently dropped.

**Base:** `326ecde378cfb1a4820f308c17bc84a37d76e8a8` (== `origin/main` at dispatch).
**Method:** every claim was produced by compiling a probe at HEAD and reading the emitted `.client.js`,
or by EXECUTING that emitted JS. Nothing is cited from §32's description of itself.

## THE VERDICT, FIRST

### Is there a shape the loop-expression form cannot express? **YES — one class, plus one composition limit.**

**NOT EXPRESSIBLE — condition-driven accumulation (`while` / `do…while` / C-style `for`).**
§49.6.1's own canonical shape compiles clean at HEAD and produces a correct array:

```scrml
fn drain() {
    let c = 0
    while (hasNext(c)) { lift getNext(c)   c = c + 1 }
    return ~
}
```
→ exit 0; `let c = 0; let _t = []; while (_scrml_hasNext_3(c)) { _t.push(_scrml_getNext_4(c)); c = c+1; } return _t;`

The loop-expression form has **no `while` limb**:

| form | `const v = <loop> { lift … }` | measured |
|---|---|---|
| `for (const x of xs)` | **yes** | exit 0, correct |
| `while (cond)` | no | **exit 1 — `E-LOOP-007`** |
| `do { … } while (cond)` | no | **exit 1 — `E-CODEGEN-INVALID-LOGIC`** |
| C-style `for (let i=0; i<n; i=i+1)` | no | **exit 1 — `E-CODEGEN-INVALID-LOGIC`** |

There is no `for…of` conversion available: the point of a `while` accumulator is that the iteration
count and the collection are NOT known in advance. There is nothing to iterate over.

**NOT EXPRESSIBLE — a loop-expression as an if-as-expression arm's lifted value.**
`const extra = if (flag) { lift for (const y of ys) { lift y } } else { lift [] }`
→ **exit 1, `E-CODEGEN-INVALID-LOGIC`.** This bites conditional multi-source accumulation (shape 15),
whose only working re-expression moves the condition INSIDE the second loop — which changes semantics,
because `ys` is then iterated unconditionally.

### What that does and does not mean

It does **not** kill one-thing. **It changes what one-thing costs.** The proposal as stated was
"delete the accumulator role; the loop-expression form covers it." That is not true as stated.
One-thing REQUIRES two additional pieces of work, and they must be IN the ruling, not assumed:

1. **Extend the loop-expression form to `while` / `do…while` (and, for consistency, C-style `for`).**
   Not speculative: the `for…of` desugar already exists and is the same transform. The blocker is the
   **parser** — `const x = while (…) { … }` lands as an escape-hatch ParseError, which is exactly what
   E-LOOP-007's trigger keys on (`type-system.ts:19850-19882`). ⚑ E-LOOP-007's message ALREADY says
   *"or refactor to a `for/lift` expression"* — the compiler's own diagnostic assumes the form exists.
2. **Make a loop-expression legal as a value-form arm's lifted value**, or accept that conditional
   multi-source accumulation loses its faithful spelling.

Without (1), **§49.4.4's "sole exception" does not dissolve — it is DELETED, taking with it the only
way to get a value out of a `while`.** A capability loss, not a simplification.

### The counterweight the sweep turned up, and it is large

**The two-things reading is not merely a SPEC contradiction. It is THREE shipped, silent, exit-0
defects — and the loop-expression form fixes all three by construction.**

| | shape | HEAD behaviour |
|---|---|---|
| **A** | statement after the loop, before `return ~` (shape 9) | **returns the WRONG VALUE**, exit 0, zero diagnostics |
| **B** | `lift` header / loop / `lift` footer (shape 14) | **hard `TypeError` at runtime**, exit 0, zero diagnostics — crashes even on empty input |
| **C** | `while` accumulator across a `${}` boundary (shape 16 — a file in `pretest`) | **three statements silently DELETED from the output**, exit 0 |

All three are the §32.2 VALUE role colliding with the §48.5.1 ARRAY role over one name. Under a bound
`const items = for (…) { lift … }` none can occur: A and C become ordinary bindings; B becomes
`["H", ...mid, "F"]` (measured, exit 0). **The migration is not a pure cost — it retires a class of
silent wrong-answer bugs.**

Additionally: **at HEAD the array role has exactly ONE working spelling** — a bare `return ~` at
`fn`-body top level. §32.3's own list of valid consumptions (`let result = ~`, `if (~.ok)`,
`process(~)`, `lift ~`) has **zero members that work inside a `fn`.**

## THE MATRIX

Legend: **E** expressible · **E-** expressible but worse · **E+** expressible and strictly better than
HEAD · **N** not expressible · **n/a** outside the accumulator role.

| # | shape | HEAD behaviour (from emitted JS) | loop-expression re-expression | verdict |
|---|---|---|---|---|
| 1 | **Pure** `for (x of xs) { lift g(x) } return ~` (§48.5.1 verbatim; corpus `phase1-fn-multiline-011`) | exit 0 · `let _t=[]; for(…){_t.push(…)} return _t` | `const items = for (const x of xs) { lift g(x) }  return items` | **E** — already compiles at HEAD, exit 0 |
| 2 | **Statements before the loop** | exit 0 · accumulator minted at the loop, not fn-top | unchanged | **E** |
| 3 | **Reads `~` then computes** `const n = ~.length  return n` | **exit 1 — false `E-FN-008`** (the JS emitted is correct) | `const items = for(…){lift}  const n = items.length  return n` | **E+** — removes a false reject |
| 4 | ⚑ **TWO loops, ONE accumulator** | **exit 0** · ONE array, two push loops | `const a = for(xs){lift}  const b = for(ys){lift}  return [...a, ...b]` — exit 0, measured | **E-** — cost below |
| 5 | **Conditional lift (filter)** | exit 0 · `if` inside the push loop | unchanged, bound | **E** |
| 6 | **Nested loops both lifting** | exit 0 · inner lift reaches the fn-body accumulator; result is **FLAT** | `const cells = for(row){ for(cell){ lift cell } }` — exit 0, flat | **E** |
| 7 | ⚑ **`while` accumulator** (§49.6.1; corpus `loop-007-while-as-expr-neg`) | **exit 0**, correct array | **none — `E-LOOP-007`, a PARSER gap** | **N** |
| 8 | **Early `return ~` inside the loop** | exit 0 · returns the partial array | `const items = for(…){ if(p){break} lift x }  return items` — exit 0 | **E** |
| 8b | early return **plus a post-loop `lift`** | exit 0 · the early exit skips the post-loop push | `break` + bind; the post-loop element moves into the tail expression | **E-** — "skip the footer on early exit" becomes explicit |
| 9 | ⚑ **Statement AFTER the loop, before the read** | **exit 0 — RETURNS THE WRONG VALUE** (proven by execution) | `const items = for(…){lift}  note(…)  return items` — exit 0, correct | **E+** — removes a silent miscompile |
| 10 | **`lift` inside a `fn` called from a loop** (E-FN-008 boundary) | exit 0, **no E-FN-008** — boundary holds. But the callee's `lift x  return ~` emits a **SCALAR**, not `[x]` | unchanged for the caller; the callee stops needing `~` at all | **E** |
| 11 | **`${}`-level accumulator** (`for`/`while` + `let result = ~`) | exit 0, correct — co-emits `_scrml_lift_target` plumbing | `const items = for(…){lift}` — exit 0 at `${}` level too | **E** |
| 12 | **Markup-accumulation `lift`** | exit 0 · **ZERO `_scrml_tilde`** — `_scrml_lift_target` / `_scrml_lift()` / `_scrml_reconcile_list` | untouched — a different mechanism | **n/a** |
| 13 | **`lift` with NO enclosing loop** (corpus `fn/lift-local-accumulator-clean`, `phase1-lin-lift-014`) | exit 0 · `~` is a **SCALAR** (`let _t = x`), contradicting §49.6.1's "holds an array" | `const v = x` — the ambiguity disappears | **E+** |
| 14 | ⚑ **header / loop / footer** (`lift "H"` · loop · `lift "F"`) | **exit 0 — `TypeError: _t.push is not a function`** (proven by execution; crashes on `[]` too) | `const mid = for(…){lift}  return ["H", ...mid, "F"]` — exit 0 | **E+** — removes a hard crash |
| 15 | **Conditional second loop into one accumulator** | exit 0, correct | (A) condition moved into the 2nd loop — exit 0 but **iterates `ys` unconditionally**; (B) faithful `lift for(…)` in an if-arm — **exit 1 `E-CODEGEN-INVALID-LOGIC`** | **E-** (A) / **N** (B) |
| 16 | **Accumulator across a `${}` boundary** (corpus `phase2-while-lift-061`, in `pretest`) | **exit 0 — the `while` loop AND the following call are DELETED from the output; `result` is `null`** | n/a — spec-invalid under §32.4 either way | **n/a** |
| 17 | **`continue` in an accumulating loop** | exit 0, correct | exit 0, correct | **E** |
| 18 | **`~` VALUE role** (`step1(2)` then `return step2(~)`; `examples/24-tilde-pipeline.scrml`) | exit 0, correct | untouched — this IS the one thing | **n/a** |

### Shape 4's cost, stated honestly and then weighed

```scrml
// HEAD (works today)                     // one-thing
for (const x of xs) { lift "x:" + x }     const a = for (const x of xs) { lift "x:" + x }
for (const y of ys) { lift "y:" + y }     const b = for (const y of ys) { lift "y:" + y }
return ~                                  return [...a, ...b]
```

The cost is real and it is exactly the tax `~` was designed to avoid. The roadmap article
(`docs/website/pages/articles/roadmap-2026-05-14.scrml:117`) states the intent in terms: *"the time
cost of choosing a good name for a value you're going to use exactly once in the next line is a tax the
language shouldn't impose."* Two invented names plus one intermediate array is that tax, charged twice.

Against that, three things measured here:
- **The one-slot version is ONE EDIT from crashing.** Add `lift homeLink` after those two loops — an
  obvious thing to want — and it is shape 14: exit 0, `TypeError` at runtime.
- **The one-slot version is ONE EDIT from returning the wrong value.** Add any unbound call between
  the last loop and `return ~` and it is shape 9: exit 0, wrong answer.
- **The reader cannot see the result's shape from the `return`.** `return ~` after two loops requires
  knowing both fed a hidden slot; `return [...a, ...b]` says it.

**I do not think shape 4 alone is a reason to reject one-thing.** Recorded as EXPRESSIBLE-BUT-WORSE
with the cost quantified rather than talked away, because the PA predicted it would be the breaker and
it is not. **Shape 7 is.**

## WHAT IN THE BRIEF WAS WRONG

1. ⚑ **"The loop-expression form" is described as a proposal. It already SHIPS for `for…of`.**
   `const items = for (const name of names) { lift name }  return items` compiles at HEAD, exit 0, no
   E-FN-008, emitting exactly the loop-expression desugar. Codegen needs no new machinery for `for…of`.
   The gap is `while` / `do…while` / C-style `for`, and arm-composition.
2. ⚑ **The attributed root cause of the dead `E-TILDE-001/002` is wrong.** The brief names
   `type-system.ts:18586` / `:19259` (`name === "~"`) and `exprNodeFields` omitting
   `ifExpr`/`forExpr`/`matchExpr`. Those lines are real — I read them — but they sit in
   `consumeLinRef` / `consumeLinRefExternal`, **the LIN path, not the TildeTracker path.** The actual
   cause is that **`tilde-init` and `tilde-ref` have ZERO producers in the entire compiler.** The
   brief's CONCLUSION (the codes fire zero times) is correct and I re-verified it by execution.
3. **The PA's prediction that shape 4 is the breaker is not borne out.** Shape 4 compiles at HEAD and
   re-expresses cleanly with `[...a, ...b]`, exit 0. Shape 7 (`while`) is the breaker.
4. Minor: **`conformance/cases/fn/lift-outer-accumulator-reject/case.scrml:3` is `~acc = []`, not `~`.**
   Counting it as a `~`-read site inflates the population by one.

## THIRD CONFIRMATION — the `~`/§32 surface has ZERO map rows

`.claude/maps/primary.map.md` (775 lines, 141 rows): `grep -n "§32"` → **zero hits**. `grep -i tilde`
→ two hits, **both about if-as-expression BINDING SITES** (invariant 85 and the `emit-logic.ts` routing
row), not about `~` the keyword or the accumulator. Third dispatch to confirm.

Incidental, worth a row if anyone writes one: **`_scrml_tilde_N` is the shared emitted symbol family
for BOTH the §32.2 single-value role AND the §17.6 if-as-expression result slot.** Anyone grepping
`_scrml_tilde` to reason about `~` is looking at two mechanisms at once.

## SIDE OBSERVATIONS (out of scope, recorded, not acted on)

- **`const items = while (…) { lift … }` emits INVALID JAVASCRIPT before failing** — the rejected
  compile still wrote raw scrml into the `.client.js`: `const items = while ( i < n ) { lift i * 10 i = i + 1 };`.
  Exit 1, so nothing ships; but codegen fell through rather than refusing.
- **All three miscompiles (shapes 9, 14, 16) emit syntactically VALID JS**, so §2.2.1's
  `--validate-emit` gate is structurally blind to every one of them.
- `samples/compilation-tests/gauntlet-s19-phase2-control-flow/phase2-while-lift-061.scrml` is
  **spec-invalid under §32.4** and is compiled by `bun run pretest` on every developer machine,
  silently, at exit 0.
- **§35.8's closing cross-reference is stale** — *"See §31 for the complete specification of `~`"*.
  `~` is §32.
