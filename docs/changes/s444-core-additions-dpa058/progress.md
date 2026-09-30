# progress — s444-core-additions-dpa058

- 2026-09-30 start at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a41b51d8ff7e85d9d (base 29eb80c31, branch feat/s444-core-additions-dpa058)
- 2026-09-30 BASELINE: slices m1+m2+m3+m4 = 819 pass + 1 todo, 0 fail; lint-no-default-arm 58 files / 0.
  Corpus instrument (scratchpad corpus.js: the front end over every conformance case dir + the slice-m4 §66.19 sources) saved as corpus-base.json.
- 2026-09-30 PA ADDITION (fail-open → fail-closed), unit 1:
  (1) analyze resolveElem: a scrml structural element the bootstrap does not implement → E-BOOTSTRAP-UNSUPPORTED
      (§4.15 / §24.4 "These element names SHALL NOT be treated as HTML elements"). Refused: request, poll, timer, timeout,
      machine, errorBoundary, db, schema, channel, onchange, auth, page, engine, onTransition, onTimeout, onIdle, errors,
      match, empty, render, outlet, column, formFor, tableFor, if, else, else-if, component, snippet, partial, foreign,
      endpoint, api, markup, defaults, keyboard, mouse, gamepad (lowercase compare). Implemented and NOT refused: each, slot;
      `<theme>` already refused by the parser; `<program>` parses as the program.
  (2) analyze namedInstanceDiags → openerWordDiags: a declaration-opener word other than `single` / a validator word
      → E-BOOTSTRAP-UNSUPPORTED naming it (persist= / key= → "§6.14 persist= is not in the bootstrap yet"), on user
      declarations, program cells and child fields at any depth; skipped inside a declaration holding a parse error
      (Rule C — debris). Put in analyze, not parse: a named shared instance's construction words (`<accent:swatch
      label=…>`) are not opener words (it is refused whole there).
  Tests: slice-m4/failclosed.test.js (42). slice-m2 typer.test BASE_66_19 block 7 (§66.19.6 Before, `<engine>`) re-pinned:
  refused whole now. Mutations: 5 rows (MUTATIONS_ONLY="s444 PA": 5 RED). mutations.js gained MUTATIONS_ONLY=<substr>.
  CORPUS: 242 case dirs changed, EVERY new diagnostic is a structural-element refusal (no opener-word refusal fired in
  the corpus). Previously-clean cases now refused (21): outlet/{class-id,recognized-clean,duplicate}, input/input-001-{neg,pos}
  (<keyboard>), auth/* ×9 (<auth>/<page>), schema/* ×5, api/{api-unknown-type-ref-neg,api-endpoint-malformed-neg}.
- 2026-09-30 PHASE A, unit 2 — the Core additions (commit 5487eddf5 + follow-ups). core.scrml:
  - `Attr.Bind(kind: BindKind{Value,Checked}, read: Expr, sink: Sym, write: Block)` — the event-value round trip: the
    element's `value`/`checked` shows `read`; on input/change the property value is bound to `sink` (binder-minted
    local) and `write` runs (ONE capability-checked Write of Local(sink)). check.scrml **C8**: write = exactly
    [Write(cap, inst, Replace|FieldAt(path), Local(sink))] and read = Read(Cell(<cap decl>, inst, [<cap field>]++path)).
  - `Expr.Host(call: HostCall{DateNow})` — a CLOSED host-call set.
  - `Expr.Lambda(params: Sym[], body: Expr)`, `Expr.SeqCall(op: SeqFn{Filter,Map}, seq, f)` — new values (R3).
  - `View.Star(decl, inst)` — the existing instance rendered with decl's renders (M1 D4 closed). check **C10**: the
    instance resolves to decl (C4's rule) and decl has renders.
  - `EditKind.RemoveEnd | RemoveFront | RemoveAnywhere | ElemAt(index: Expr, path: FieldRef[])`; `SeqGrants.shrink`.
    check **C3** arms for all four (ElemAt: the ELEMENT field's own contract, dpa-052 Q3); **C9**: RemoveEnd/Front
    carry the COUNT (Int literal ≥ 1), RemoveAnywhere carries `SeqCall(Filter, <this field>, λ)` only.
  - walk (editKids, exprBinds for Lambda params, attrBinds for the Bind sink), print, names (`Date` reserved), measure,
    ingest, runtime (`bind`, `removeEnd`, `removeFront`, `setAt`) updated; every total match took the new arms (lint 0).
  analyze: ValueFact VHost / VSeqCall / VLambda; EffectFact ERemove / EElemAt; AttrKind ABind; ElemFact MStar; Env gains
  `host: HostCtx{HostNo,HostOk,HostPure}` and `own` (O54). lower: callOrBuiltin, lambdaExpr, elemAtStmt, bindAttr, MStar.
- DECISIONS where the SPEC is silent (⚑ PA):
  D1 HOST-CALL SURFACE — NARROWEST that runs §66.19.5: exactly `Date.now()` (a `number`), admitted in a `function`
     body and in an event handler; in a pure `fn` → **E-FN-004** (governing: §33.3 item 7 "A `pure` function SHALL NOT …
     Call any non-deterministic built-in (`Date.now`, …)"; §41.19 "the host member-expression `Date.now` remains covered
     by the existing E-FN-004 `NON_DET_CALLS` list"; §41.19 "`now()` SHALL be permitted in `function` (event-handler /
     effect class) bodies"). Anywhere else (an initializer, markup `${…}`, an attribute value) → E-BOOTSTRAP-UNSUPPORTED:
     SPEC §6 line ~6692 gives markup a "one-shot evaluation at module initialization" rule the bootstrap's lazy shared
     instances / reactive re-runs do not reproduce, so it is refused rather than guessed. `scrml:time.now()` (§41.19,
     import-only) is NOT in the bootstrap (no imports of stdlib modules) — flagged. No other host member call.
  D2 BIND: `bind:value` on input/textarea/select (E-ATTR-011 otherwise), `bind:checked` on `<input type="checkbox">`
     (static type attr; E-ATTR-011 otherwise), RHS an `@` place (E-ATTR-010); `bind:selected` / `bind:group` /
     `bind:files` → E-BOOTSTRAP-UNSUPPORTED. The write is judged EXACTLY as `@p = v` (wholeFieldWrite / fieldAtWrite:
     E-WRITE-NOT-GRANTED, E-DERIVED-WRITE, writeGuards). `bind:value` writes a STRING: a string (or `string | not`)
     place only — an int/number place → E-BOOTSTRAP-UNSUPPORTED (§5.4 specifies a coercion only for `<select>`; the
     `<input type=number>` case is unspecified — ⚑ PA), any other → E-TYPE-031; `bind:checked` writes a boolean.
  D3 REMOVALS in Core carry a value: the count (pop/shift = 1) or the filtered sequence (C9 pins both). A `.pop(x)` with
     an argument → E-BOOTSTRAP-UNSUPPORTED. `@x = @x.map(λ)` lowers as PositionWrite of the mapped value
     (writeValueType: PositionWrite / RemoveAnywhere = the field's type — the whole value; was the element type).
  D4 INDEX PLACES: `@xs[i].f = v` is granted iff the element field `f` grants `replace` (a `= v` IS a replace of it; an
     element field with edits but no replace → E-WRITE-NOT-GRANTED "no `replace`"; before s444 analyze took edits>0 as
     granted — it only mattered for the refusal message then). The grant is listed in the GrantSet as FieldAt(path) over
     the ELEMENT struct (so `Row[]` with `let qty` has a capability). An out-of-range index at runtime THROWS, nothing
     written ("position N is outside the sequence") — no SPEC code names it (⚑ PA).
  D5 LAMBDAS: only as the one argument of `.filter` / `.map` on a sequence, one parameter, expression body; the
     parameter is typed as the element (annots → the typer). filter's type = the receiver's; map's = Seq(body type,
     receiver's grants). `let s = @audit; s = s.filter(…)` is now a LEGAL local rebinding (a new value) — review-r1 F1's
     "refused" test changed to "kept and run" (the F1 bug was deletion; nothing is deleted).
  D6 STAR: `<*x/>` at program top level → View.Star(x, Shared(x)) — the constructs-nothing restriction is gone (a Star
     renders the instance's own children too). The printer renders a Star into the SITE's scope, and (changed) a
     prebuilt kid now renders into the scope its parent's render was given (was: the kid's own instance scope) — same
     lifetime for a fresh instance, and a Star site's kid view is disposed with the site (test + mutation).
     `<*x/>` inside a declaration's renders stays refused (lexically nearest x is not tracked).
  D7 O54 = (a) (RULED S442 "`@email` inside `email`'s own `renders` … Rec: this instance." → RULED O54 = (a)): a CHILD
     field's own renders is resolved with `own` = its name; `@own` = NField(decl, Lexical(0), idx) (read and write/bind).
  D8 A granted write whose field has no capability (impossible by construction) is reported (noCapability), never dropped.
- impl#1 DOGFOOD (bundle compile): F-s444-1 impl#1's E-FN-004 fires on the TEXT `Date.now()` inside a STRING literal in a
  `fn` body (repro: `fn a() -> string { return "the text Date.now() in a string" }`) — workaround dateNowText().
  F-s444-2 a match-arm string literal containing `(a). Call it` → E-CODEGEN-INVALID-LOGIC "Unexpected token" (repro:
  `.A :> "(a). Call it"`; `"a. Call it"` / `"(a) Call it"` / `"(a). call it"` are fine) — message reworded.
- Tests: slice-m4/core-additions.test.js (37: bind ×10, host ×7, Star ×5, removals ×9, index ×5, lambdas ×4 — incl. C8 /
  C9 / C10 / C3-ElemAt on hand-corrupted Core); audit.test.js REWRITTEN to run the VERBATIM §66.19.5 (typing into the bound
  input, stubbed clock); form.test.js runs §66.19.2 minus validators only (binds, O54, Star, two Stars = one instance);
  tables.test EVERY_FACT reaches every new fact variant; grants / review-r1 / review-r2 pins moved from "granted, not
  lowered" to "granted and lowered"; typer.test BASE_66_19: §66.19.5 → [], §66.19.2 → 4 validator codes.
- 2026-09-30 PHASE A VERIFICATION (tree = 7a86f18c2 + this commit's bite / mutation re-sites):
  - lint-no-default-arm: 58 files / 0 violations · slice-m1+m2+m3+m4: 906 pass + 1 todo / 0 fail (baseline 819 + 1 todo)
    · SLICE_CORE=lowered slice-m1: 73/73 · v2-lexer (compiler/tests/integration/self-host-v2-lexer-slice*): 337/0
  - mutations.js FULL: 281 rows, 279 RED + 2 NOT RUN (sites moved by Phase A) → fixed here: the r1 G1
    "constructs-nothing" row RETIRED (Star renders instance-constructing markup now; covered by "s444 A3 … inlined
    again"), the dpa-052 Q3 "TAPE's grants" row RE-SITED (RED, 7.3 s). ⇒ 280 rows, all RED; unmutated mirror clean.
  - bite matrix (cg + css + front): CG 32 certified / 0 uncertified · CSS 32 / 0 · FRONT 16 / 0 (was 12: + Analyze.Host,
    Analyze.Bind, Lower.Bind, Analyze.Star, Lower.Star, Analyze.O54Own; − Analyze.StarShared / Lower.Inline retired —
    the shared-instance inline path is gone; Analyze.ChildRenders re-sited). exit 0, 369 s.
  - conformance (impl#1, untouched): 1152/1159 pass + 7 xfail.
  - ALL top-level compiler/tests/*.test.js (14 files): 6384 pass / 15 skip / 0 fail.
  - gate (pre-commit: unit + integration + conformance --bail) at 7a86f18c2: 26785 pass / 0 fail.
  - facts.ts --check PASS · regen-spec-index --check OK.
  §66.19 STATUS after Phase A:
  | § | program | status |
  |---|---|---|
  | 66.19.1 | counter | DONE (M2) |
  | 66.19.3 | dropdown ×3 | DONE (M2) |
  | 66.19.6 | engine as `single` | DONE (s442) |
  | 66.19.5 | audit log | **DONE — the VERBATIM source compiles clean and RUNS** (Date.now() host call, bind:value round trip, stubbed clock) |
  | 66.19.2 | validated form | **everything but the validators RUNS from source** (binds, O54, `<*signup/>` Star); validators → Phase B |
  | 66.19.4 | theme library | BLOCKED (unchanged: `<theme>` CSS, named shared instances, `match` in an opener, ⚑ O39) |
- PHASE-A-DONE 2026-09-30 — Phase A committed + verified; pushed as feat/s444-core-additions-dpa058.
