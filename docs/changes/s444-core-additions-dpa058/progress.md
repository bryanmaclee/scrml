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
- 2026-09-30 PHASE B (dpa-058 build) — started on the working tree while Phase A's full mutation run was in flight;
  Phase A is committed / verified / pushed on its own (see PHASE-A-DONE) and B is replayed on top.
  RULINGS (ruling:user-voice-scrml.md S442 "⭐⭐ RULED — dpa-058 (O25) = all PA recs", item 1 (1)–(5), quoted):
   (1) *"Always write the bind … with no implicit bind, ever."* — by construction: the bootstrap never binds an
       element that does not write `bind:` (a validated field whose renders holds an unbound input is dead → (5)).
   (2) *"Validators follow the bind"* — the HTML-native subset (`required`, `minlength`/`maxlength`, `min`/`max`,
       `pattern` only when exact) lands on every native `input`/`textarea`/`select` whose `bind:` targets that
       declaration's value, wherever the bind is written; no bind → validity surface only.
   (3) *"the compiler adds `novalidate` to any form carrying lowered attributes."*
   (4) O54 = (a) — `@email` inside `email`'s own `renders` is this instance (landed in Phase A, D7).
   (5) *"Silently dead validators become errors"* — validators on a top-level scalar with no surface (§55.5 Edge A)
       or on a declaration nothing binds, and `@x.isValid` on a no-surface cell → an error.
  BUILT:
   - ast/parse: `AValidator{name, arg: AValArg{NoArgs, Cmp(op,e), Exprs(es), Regex(source,flags)}}`,
     `ADecl.validators` (source order, §55.12); a validator CALL on an element → E-PARSE-ATTR; a non-validator call in
     a tag → E-PARSE-ATTR (was: every `name(…)` skipped + O25 refusal).
   - analyze: `FieldInfo.vals: ValInfo[]` — each honored validator with its HTML lowering; `ABind.vattrs` — the
     lowered attributes for THAT element (HTML applicability; a hand-written attribute of the same name wins);
     `Tables.novalidate` — the forms; `validatorPass` (dead binds + forms); surface-property reads.
   - lower: Attr.Static per lowered attribute next to the Attr.Bind; `novalidate` on the listed forms. Core unchanged.
   - SPEC §34: rows E-VALIDATOR-DEAD, E-VALIDITY-NO-SURFACE (bootstrap emitter provenance; impl#1 Nominal, §34.0);
     SPEC-INDEX regenerated. `bun scripts/s34-census.ts --check-new` PASS.
  DECISIONS (⚑ PA):
   B1 THE VALIDITY SURFACE (§55.5–§55.7) IS NOT BUILT. The bootstrap honors a validator ONLY through its exact HTML
      form; a validator with none — `eq`/`neq`/`gt`/`lt`/`gte`/`lte`/`oneOf`/`notIn`, a non-literal `min`/`max`, an
      inexact `pattern`, `req` on a boolean, a Level-1 message `req("…")` — is E-BOOTSTRAP-UNSUPPORTED (never kept
      inert). `@decl.isValid` / `@decl.field.errors` (a surface that EXISTS per §55.5/§55.6) → E-BOOTSTRAP-UNSUPPORTED;
      a write to one → E-SYNTHESIZED-WRITE. Building the surface is the next item (it needs: per-instance errors /
      isValid / touched Deriveds, the ValidationError payload types (§55.9 `asIs` / `regex` have no bootstrap type),
      the compound `errors` map shape, and a ruling on WHICH submit marks `submitted`).
   B2 (5)'s "a declaration nothing binds" is applied as written: a validated child field that no `bind:` targets is
      E-VALIDATOR-DEAD EVEN IF logic writes it. The dpa-058 deep-dive's R4 said "nothing ever binds or writes", and
      its P2b case D (`renders <button onclick=(@color = "teal")>`, surface only) would be legal under R4 — the ruling
      text drops "or writes". With the surface unbuilt the two readings coincide in the bootstrap today; they differ
      once the surface lands. ⚑ PA: confirm the reading.
   B3 (5)'s "top-level scalar with no surface" is applied to EVERY program cell with validators — bound or not
      (Edge A: a top-level cell synthesizes no surface, and under (3) its lowered attributes cannot block, so nothing
      observes the validators). ⚑ PA: the deep-dive (P2b §55 bullet) expected a bound top-level scalar to "at least
      get `required`"; the ruling's (5) makes it an error — confirm.
   B4 HTML lowering, exact only: `req` → `required=""` on a STRING value (text-like inputs, textarea, select);
      `length(>=N / <=N / >N / <N / ==N)` (N an int literal) → minlength / maxlength (integer lengths: `>N` = `>=N+1`);
      `min(n)` / `max(n)` (numeric literal) → min / max on number / range / date-time inputs (unreachable today: a
      numeric place cannot be bound — D2); `pattern(/re/)` → `pattern="re"` only when: no flags, anchored `^…$`, no
      top-level `|`, and the plain subset (letters/digits/`_`/space/`@`/`.*+?-`, groups `(…)`/`(?:…)`, `{n,m}`, `\d\w\s`
      + escaped syntax chars, classes of alnum/ranges/`\d\w\s`) that reads the same under HTML's `v`-flag compile of
      `^(?:p)$`. A validator whose attribute does not apply to the bound element (e.g. `length` on a `<select>`) →
      E-BOOTSTRAP-UNSUPPORTED at that bind.
   B5 `novalidate` looks THROUGH `<*f/>` inlines, `<*x/>` Stars, uses `<x/>`, `<each>` rows and state-view arms (a
      use's inputs are in the form's DOM); a form that already writes `novalidate` gets no second one.
   B6 Validators are honored only on a CHILD field of a user declaration; on a user declaration's own opener or a
      field at depth ≥ 2 → E-BOOTSTRAP-UNSUPPORTED (not reached by the six programs).
   B7 New codes: **E-VALIDATOR-DEAD**, **E-VALIDITY-NO-SURFACE** (§34 rows added, Nominal for impl#1). Reused:
      E-DERIVED-WITH-VALIDATORS (§55.14), E-SYNTHESIZED-WRITE (§55.5), E-TYPE-031 (§55.1 applicability).
  impl#1 DOGFOOD: F-s444-2 recurred outside a match arm — a struct-literal string in a `for` body containing
  `(RULED S442 (5)). Bind it` → E-CODEGEN-INVALID-LOGIC; `(a whole-value replace). Declare` elsewhere compiles — the
  trigger involves `(…)). ` + a capital; reworded (". " → " — ").
