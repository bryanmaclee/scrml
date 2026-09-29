# s442-bootstrap-six-programs — progress

Worktree: /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a337dc820eb4a91db (branch worktree-agent-a337dc820eb4a91db)
Base: origin/main cf62b415 (asserted == merge-base).

## Log
- 2026-09-29 — startup verified; BRIEF committed (d904acbd). Bun 1.4.2 (the pre-commit hook takes ~4 min per commit on this machine).
- 2026-09-29 — BASELINE (before any edit):
  - slice-m1 73/73 · SLICE_CORE=lowered slice-m1 73/73 · slice-m2 325/325 · slice-m3 24/24 · lint-no-default-arm 28 files / 0 violations
  - `bun conformance/run.ts` (impl#1): 1047/1054 pass + 7 xfail
  - footprint (`scripts/hybrid.ts --swap CG=…/slice-m3/substitute.js --footprint`): 18/18 runtime passes, 10 codes-only, 579 not-yet, 447 front-end
- 2026-09-29 — the four remaining §66.19 programs extracted VERBATIM from SPEC into `compiler/self-host-v2/slice-m4/src/`
  (form/signup.scrml = §66.19.2; theme/lib/brand-theme.scrml + theme/app.scrml = §66.19.4; audit/audit.scrml = §66.19.5;
  engine/after.scrml + engine/before.scrml = §66.19.6). **slice-m4, not slice-m2:** slice-m2 is the M2 proof (the lowered Core
  EQUALS M1's hand-built oracle, drift-guarded); these four programs have no hand-built oracle and are graded by RUNNING them,
  so they get their own slice with its own harness/tests, and slice-m2's oracle suite stays untouched.

## SURVEY — where each §66.19 program fails through the bootstrap today (base cf62b415)

Instrument: `frontEnd` (slice-m2/lowered.js — parse → analyze → lower over the verbatim SPEC sources); first diagnostic and
every construct the program needs that the front end does not have (read from the diagnostics + the source).

| § | program | first failing stage | constructs missing (source order) | Core-blocked / OPEN |
|---|---|---|---|---|
| 66.19.1 | counter | — (passes; M2) | — | — |
| 66.19.3 | dropdown ×3 | — (passes; M2) | — | — |
| 66.19.5 | audit log | PARSE | (a) array spread `[...@audit, x]` (E-PARSE-EXPR — `...` handled only in struct literals); (b) `Date.now()` host call (analyze E-BOOTSTRAP-UNSUPPORTED "only calls of a named function"); (c) a struct literal as a `.push` argument (E-TYPE-STRUCT-CONTEXT — no expected type from the element type); (d) spread-append `@audit = [...@audit, e]` classified as an end-append (today E-WRITE-NOT-GRANTED, a replace); (e) `bind:value=@actor` (E-BOOTSTRAP-UNSUPPORTED); (f) negative lines: `.shift()`, `.filter(...)` (method calls other than push/unshift/length unsupported), `@audit[0].action = …` (index place), `@audit = appended(…)` (O37 (c) certified call) | (b) and (e) need Core: Core has no host-call Expr and no event-value/bind form — core.scrml is off-limits (brief §4) |
| 66.19.6 | engine as `single` | PARSE | (a) `:`-shorthand state-child bodies `<Idle rule=.Loading : "Ready">` (E-PARSE-TAG / E-PARSE-STATE-CHILD cascade); (b) `single` modifier; (c) a declaration with attributes + child graph field + `renders` nested in `<program>` (`<card>`); (d) `@phase = .X` — a transition write to a `single` declaration's OWN value; (e) `<*phase/>` rendering the state-child bodies (O5 (1i)); (f) `${status}` — an enum value rendered; negative lines E-COMPONENT-ENGINE-SCOPE (`single` on `status`) and E-DECL-SINGLE-INSTANTIATED (`<phase/>`) | E-DECL-SINGLE-INSTANTIATED is conditional on **O55** (OPEN) — not decided |
| 66.19.2 | validated form | PARSE | (a) `:`-shorthand state-child bodies (as 66.19.6); (b) validator attributes `req length(>=5)` in an opener (E-PARSE-TAG); (c) a `renders` clause after a CHILD declaration inside a declaration body (E-PARSE-DECL-BODY); (d) `bind:value` / `bind:checked` (analyze E-BOOTSTRAP-UNSUPPORTED); (e) `<*email/>` / `<*password/>` / `<*signup/>` / `<*saveState/>` (Core has no View.Star); (f) `single`; (g) bare `return` in a function; (h) a declaration with attrs + renders nested in `<program>` | (d) needs Core (bind); validators' runtime reach is **O25** (OPEN) |
| 66.19.4 | theme library | PARSE | (a) a `match` expression inside an opener value `(match @mode {…})` (E-PARSE-EXPECTED); (b) `<theme>` marker — tokens → CSS custom properties (not recognized: its declarations are not exported → E-IMPORT-NOT-EXPORTED `brand`/`danger`); (c) named shared instances `<accent:swatch …/>` (§66.8.2; E-SCOPE-001 "no field label"); (d) `<*accent/>`; (e) `@mode = …` whole write of a library top-level `let` (E-BOOTSTRAP-UNSUPPORTED) | (b) is CSS — brief §4: stop (slice-m3 CSS files held by another session); ⚑ O17(d), O39 marked in the source |

`§66.19.6 before` (the retired `<engine>` form) is not a target: it is §51.0 legacy (§66.21, Stage 1 "parses identically" —
the ingest shim's / impl#1's form, not the §66 front end's).

PLAN (least missing surface first): 66.19.5 audit → 66.19.6 engine → 66.19.2 form → 66.19.4 theme (non-CSS parts only,
if reached). Core-blocked constructs are implemented up to the Core boundary and reported.

## Log (continued)
- 2026-09-29 — PLAN CHANGE: §66.19.6 first — it is the one program with no Core-blocked construct (the survey's
  audit row needs a host call and `bind:`, neither expressible in Core, and core.scrml is off-limits).
- 2026-09-29 — §66.19.6 (engine as `single`) — FRONT END + RUN TEST GREEN:
  - lex: `LexStop.Shorthand` (a `:`-shorthand body stops before the opener's depth-0 `>` / `/>`).
  - ast: `AStateChild.body: ANode[]` (O5 RULED (1i): a state-child's body is that variant's markup).
  - parse: §4.14 `:`-shorthand body on any opener (`parseShorthand` → one Interp node; `/>` after it is
    E-CLOSER-001; on a void element E-COLON-SHORTHAND-ON-VOID; on a declaration opener E-PARSE-SHORTHAND);
    state-children take a shorthand or a bare body (the E-PARSE-STATE-CHILD refusal is gone).
  - analyze (ADDITIVE, commit 5cf1ba3d): a declaration with typed attributes / `renders` inside `<program>` is a
    USER declaration (`isNestedUserDecl`, `withNestedStubs`; `programFields` skips it instead of refusing);
    `<*f/>` of a field of the enclosing declaration (program cells included) whose `rule=` graph has state-child
    bodies → `ElemFact.MStateView(StateView{decl, inst, idx, enumSym, arms})`; state-child bodies are resolved
    in the declaring declaration's context (`stateBodies`); `single` on a child field of a multi-instance
    declaration → E-COMPONENT-ENGINE-SCOPE (§66.13.4); a plain `<x/>` of a `single` program cell →
    E-BOOTSTRAP-UNSUPPORTED naming ⚑ O55 (never an HTML element); typer walks nested declarations.
  - lower: nested declarations' renders (`nestedSyntaxes`); `MStateView` → `View.Cond` (one arm per body,
    test = field EqPrim variant).
  - DECISION D-S442-1: `<phase:Phase=.Idle single>` (own value + state-children, no attributes) is a PROGRAM
    CELL (R4: the program is a `single` declaration whose top-level declarations are its fields) — the same
    representation as `<let count:int=0/>`; `single` is a no-op there (a program cell is one by construction).
    A `single` USER declaration with an own value would need O19 (own value + attributes) — not met by §66.19.6.
  - Tests: slice-m4/sources.test.js (drift guard, 4 sections) + slice-m4/engine.test.js (front end, 8 behaviour
    tests run in happy-dom, negative lines: E-COMPONENT-ENGINE-SCOPE exact; E-DECL-SINGLE-INSTANTIATED = todo O55).
  - Bite: slice-m3/bench/bite-matrix.js gained a FRONT-END section (bite-front.js, judged in bite.test.js):
    6 front constructs, all CERTIFIED against the behaviour tests (`--front`, 18.5 s).
  - Environment: two pre-commit runs failed on timing-sensitive impl#1 tests (a live-Postgres hook timeout,
    an arrow-SQL test at 7.3 s > 5 s) while a bite run loaded the machine; the retry with no concurrent load
    passed. Not a Bun-version artifact; heavy runs and commits are now serialized.
- 2026-09-29 — §66.19.5 (audit log) — PARTIAL, everything but the Core-blocked constructs RUNS:
  - ast: three new AExprK variants `Spread(e)` (an array element `...e`), `Index(obj, idx)`, `Lambda(params, body)`
    (expression body); every total match over AExprK took the new arms (analyze: 19 sites, neutral answers).
  - parse: array elements with `...e`; `a[i]` postfix (the `[` must touch); `x => e` / `(a, b) => e` (a braced
    body is E-BOOTSTRAP-UNSUPPORTED).
  - analyze (ADDITIVE, d5a6e9dc): §66.11.2 recognized reassignment shapes — `@x = [...@x, e…]` end-append,
    `@x = [e…, ...@x]` front-prepend, `@x = @x.filter(λ)` shrink-anywhere, `@x = @x.map(λ)` position-write —
    classified BEFORE the replace path (`seqEditShape` / `resolveSeqShape`), each refused with
    E-WRITE-NOT-GRANTED naming the edit when the type does not grant it; `.shift()` / `.pop()` (front / end
    removals, §66.12.2); `@xs[i].f = v` an edit of field `f` judged by f's own contract (dpa-052 Q3, RULED
    S440) — a fixed field → E-WRITE-NOT-GRANTED. A GRANTED filter / map / shift / pop / element-field write is
    E-BOOTSTRAP-UNSUPPORTED (Core has no lambda, removal edit or index place — core.scrml untouched).
    New EffectFact `EEdits(w, elems)` + the typer checks each element against the element type.
  - lower: `EEdits` → one Append Write per element in order / Prepend in reverse (so `[a, b, ...@x]` reads a, b).
  - Core-blocked (reported, pinned by a test on the VERBATIM source): `Date.now()` (no host-call Expr) and
    `<input bind:value=@actor/>` (no bind / event-value Attr).
  - Tests: slice-m4/audit.test.js — verbatim diagnostics pinned; fixture (`fixtures.js`, derived by named edits)
    run: log in, spread-append order, the §66.10 snapshot line as a probe, interleaving; shapes fixture (front
    granted): multi-element append / prepend order; 5 negative lines → exactly E-WRITE-NOT-GRANTED each, their
    messages name the edit, and the same shapes GRANTED on a wider type are not grant errors.
- 2026-09-29 — §66.19.2 (validated form) — PARTIAL, everything but the validators (O25) and binds (Core) RUNS:
  - parse: validators in an opener (`req`, `length(…)`, … — the kickstarter §6.1 vocabulary) → E-BOOTSTRAP-
    UNSUPPORTED naming ⚑ O25 (and the validity surface, §6.4); a `name(args)` call is skipped whole.
  - analyze (ADDITIVE): `ElemFact.MInline(InlineView{nodes, subst})` — `<*f/>` of a CHILD field with its own
    `renders` (§66.4 rule 2) inlines that renders for THIS instance; `<*x/>` of a user declaration at program
    top level inlines x's renders for its SHARED instance (`subst` = Shared(x)); restricted to markup that
    constructs nothing (no use / `as=` / `<slot/>`) because Core has no View.Star (M1 D4); child-field renders
    are resolved in the declaration's context; the typer walks state-child bodies and child renders.
  - lower: `MInline` → the nodes lowered in place (with `subst` for a shared instance, as L4's reset does).
  - Tests: slice-m4/form.test.js — verbatim diagnostics pinned (7: 4 validator, 3 bind); fixture run: the form
    via `<*signup/>`, `<*email/>`/`<*password/>`, `<*saveState/>` bodies, `save()`'s guard, `.Idle → .Saving →
    .Saved`, the bare `agree` projection, `<*signup/>` twice = one instance; negative line
    E-DECL-FIELD-TAG-NEEDS-STAR exact. slice-m4/typing.test.js: Typing covers every expression node.
  - Bite: 15 front mutations, 12 constructs, all CERTIFIED (41 s).
  - slice-m2 shared tests updated (dedicated commit): typer.test BASE_66_19 re-measured (the §66.19 programs
    now carry only their Core-blocked / O25 codes; no typer code), tables.test knows the new variants.
- 2026-09-29 — §66.19.4 (theme library) — BLOCKED at `<theme>` (CSS, brief §4): the parser now REFUSES `<theme>`
  (E-BOOTSTRAP-UNSUPPORTED naming its CSS lowering) instead of parsing it as markup where its token declarations
  vanished silently; analyze refuses the named shared instances `<accent:swatch …/>` (§66.8.2) where written.
  Not built: `match` in an opener value, `@mode = …` on a library top-level `let` (⚑ O39). slice-m4/theme.test.js
  pins the refusals; the run is a `test.todo`.
- 2026-09-29 — code certification: slice-m1/bench/mutations.js gained 12 s442 rows (base 82 → 94; every new
  diagnostic / refusal and the typer walks) — 94 mutations, 0 problems (all RED; clean mirror suite incl. slice-m4
  green). [CORRECTED in r1 (G4): an earlier line said 14.]

## FINAL STATE (HEAD at report time)

| § | program | status | stopped at |
|---|---|---|---|
| 66.19.1 | counter | DONE (M2) | — |
| 66.19.3 | dropdown ×3 | DONE (M2) | — |
| 66.19.6 | engine as `single` (After) | DONE — verbatim source compiles clean and RUNS (8 behaviour tests); negative line E-COMPONENT-ENGINE-SCOPE exact | E-DECL-SINGLE-INSTANTIATED line: ⚑ O55 (test.todo; the bootstrap refuses `<phase/>` naming O55) |
| 66.19.5 | audit log | PARTIAL — everything but 2 constructs RUNS on a derived fixture; 5/5 negative lines exact | `Date.now()` (Core: no host-call Expr), `bind:value` (Core: no bind Attr) |
| 66.19.2 | validated form | PARTIAL — everything but validators + binds RUNS on a derived fixture; negative line exact | validators `req`/`length(…)` (⚑ O25 + validity surface), 3 × `bind:` (Core) |
| 66.19.4 | theme library | BLOCKED | `<theme>` (CSS emission — slice-m3 CSS held); also named shared instances, `match` in an opener, ⚑ O39 |

AFTER (HEAD): slice-m1 73/73 · lowered slice-m1 73/73 · slice-m2 325/325 · slice-m3 29/29 (+5 bite-front judgement) ·
slice-m4 71 pass + 2 todo · lint-no-default-arm 34 files / 0 violations · conformance (impl#1) 1047/1054 + 7 xfail
(unchanged) · footprint 18/18 runtime, 10 codes-only, 579 not-yet, 447 front-end (unchanged — printer / runtime /
ingest untouched) · bite matrix: 32 footprint constructs CERTIFIED (unchanged) + 12 front constructs CERTIFIED
(21 behaviour tests, 15 mutations) · mutations.js 94/94 RED.

## FIX ROUND r1 (adversarial review of 5ceef638: DO-NOT-LAND)
Reproduction (reviewer tests copied read-only to scratchpad/repro/, paths retargeted to this worktree; run at 5ceef638):
- F1 REPRODUCED — `bun test repro/r2.test.js`: localAppend / localAppendConst / localFilter / localAppendWrongType all compile
  with NO diagnostic and `lp()` returns 1 (the statement is deleted); paramAppend emits `null;` and throws at runtime.
- F2 REPRODUCED — `repro/r6.test.js` singleUserDeclTwice: no diagnostic, cards=2.
- F3 REPRODUCED — `repro/r5.test.js`: `<p : @n >= 3>` renders `<p>5</p>= 3&gt;`; `<p : @n > 3>` renders `<p>5</p> 3&gt;`.
- F4 REPRODUCED — `repro/r7.test.js` bareWord `Ready now` renders as text, no diagnostic; `repro/r6.test.js`
  stateChildBareBody `"Ready"` renders WITH quotes; cardChildBodies free text.
- F5 REPRODUCED — `repro/r9.test.js`: two appended elements read `@audit.length` as 2 then 3.
- F6 REPRODUCED — `repro/r8.test.js`: after `[mk("a"), mk("b"), ...@audit]` the actor is `a` (right-to-left evaluation).
- F7 REPRODUCED — `repro/r1.test.js`: `Entry[end]` (fixed length) compiles, and push + spread-append grow it.
- Nits reproduced: `<p : @n></>` and `<p : <span>x</span>>` cascade (r5); `@phase = [...@phase, .Done]` is
  E-WRITE-NOT-GRANTED, not a type error (r3); `<*status/>` at top → E-DECL-STAR-PREDEFINED "predefined (HTML)" (r10);
  duplicate `<Idle>` state-children accepted silently (r6 stateChildDup).
- NEW RULING (bryan S442): O55 = a plain use of a `single` declaration is E-DECL-SINGLE-INSTANTIATED.

### r1 fixes (per finding — each has a test in slice-m4/review-r1.test.js and a mutations.js row)
- F1 FIXED — `rootIsLocal`: the §66.11.2 shapes, element-field writes and `.shift/.pop` classify CELL places only; a
  place rooted in a local falls through to the ordinary local path (E-ASSIGN-CONST, value resolution → the spread /
  lambda is refused E-BOOTSTRAP-UNSUPPORTED). The same deletion existed on base for `s.push(e)` on a local (M2's
  resolveEditCall returned silently) — now refused (`localEditRefused`). Evidence: repro/r2.test.js now reports
  diagnostics for all 5 probes.
- F2 FIXED (O55 RULED S442 — plain use of a `single` declaration → E-DECL-SINGLE-INSTANTIATED): user declarations
  (`d.info.single`) and program cells declared `single`. §66.19.6's `<phase/>` negative line is now a real test.
- F3 FIXED — lex `endsOpener` never splits `>=`; a bare `>` comparison (another `>` on the same line after the
  opener's `>`, with content between) is **E-PARSE-SHORTHAND-GT** (bootstrap-local parse code: §34 has no fitting
  row — E-CTX-003 is unclosed-context, not this; a §34 row is owed) and the tail is consumed, never page text.
  Nits: `<p : x></>` / `</p>` right after → E-CLOSER-001 alone; `<p : <span>x</span>>` is markup-as-value (built,
  not refused — §1.4 / §4.14 make it legal); `<p : >` one diagnostic.
- F4 FIXED — state-child bodies are CODE-DEFAULT (§4.18.1): `parseCodeBody` + `LexStop.CodeBody`; a run must be ONE
  expression, else E-UNQUOTED-DISPLAY-TEXT suggesting `"<run>"`; nested tags keep free text; whitespace between
  items is not display text. (Choice: two quoted literals in a row, `"a" "b"`, are one run of two expressions →
  E-UNQUOTED-DISPLAY-TEXT; the SPEC does not say whether a code-default body holds several expressions.)
- F5/F6 FIXED — EEdits carries one analyze-minted local per element; lower evaluates every element LEFT TO RIGHT into
  its local, then writes (a Commit for ≥ 2 writes; prepends in reverse so the result reads in source order).
  NOTE (not decided): the reviewer's `[...@audit, mk2()]` with mk2 pushing keeps the inner push (evaluate, then one
  append) — as the PA stated; a STRICT snapshot of `@audit` for sequence shapes (S440 ruled it for struct spreads)
  would drop it. Reads of `@x` inside the elements are live, not snapshotted.
- F7 NOT LANDED — STOP CONDITION: refusing an append on a fixed-length sequence (E-WRITE-INVARIANT, both push and
  the spread shape) turns slice-m2/front.test.js "S440 N1 … side-effecting override … converges" (guarded +
  unguarded) RED: its fixture declares `<log:int[end]=([])/>` (fixed length) and pushes. Reverted (hunk-level; the
  implementation is saved as docs/changes/s442-bootstrap-six-programs/F7-held.diff). To land it the PA must approve
  changing that slice-m2 fixture to `int[free, end]` (it is, per §66.12.1, an ill-formed program today).
- Nits FIXED: duplicate state-child → E-DECL-STATE-CHILD; a shape over a non-sequence → E-TYPE-031; `<*f/>` of another
  declaration's field → E-SCOPE-001 naming the owner (not "predefined (HTML)").
- G1 FIXED — tests + mutation rows for resolveStarShared's constructs-nothing / program-top-level / no-renders checks
  and resolveStarField's E-DECL-STAR-REF-ATTR-WRITE.
- G2 FIXED — own value + attributes (nested and file-level) → E-BOOTSTRAP-UNSUPPORTED naming ⚑ O19.
- G3 FIXED — `<*x/>` of a declaration with a default-less attribute → compile-time E-BOOTSTRAP-UNSUPPORTED naming ⚑ O33.
- G4 — the mutation count above corrected; slice-m2/typer.test.js's "zero delta vs base b7c863235" describe retitled.
  NOTE: the `<theme>` refusal newly REJECTS the conformance-corpus programs `style/theme-misplaced` and
  `style/theme-tokens-recognized` when run through the bootstrap front end (fail-closed; base silently dropped their
  token declarations).
- Stop-condition check: the five pre-existing slice programs' lowered Core AND printed output are byte-identical to
  base (review-six-b/dumpcore.js at HEAD vs review-six-b/out-base: `diff -rq` clean).
- Mutations: 112 (94 + 18 r1 rows), 0 problems. Bite (front): 12 constructs certified (one Lower.SeqEdits row
  re-sited after the editStmts rewrite).

## MERGE + GROW/SHRINK TOKENS (after r1)
- Pre-merge r1 tip: 898b3a1a. Merge commit 4ba2ef14 (origin/main 55a9f3d5, #1151 S440 typer). Conflict: lower.scrml
  import list only (kept both sides). analyze.scrml auto-merged; #1151 added 7 total matches over AExprK that lacked
  s442's Spread/Index/Lambda arms (nKey, isNotLit, condNarrowing, exprKids — children, ownEffect, assignValue,
  writtenKey) — added in the merge commit. No §66.19 program or fixture tripped the new typer rules.
  Post-merge suites all green; mutations 138/138 RED; bite 32 + 12 front certified.
- RULED S442 grow/shrink split (ruling:user-voice-scrml.md S442 — "1 yes, 2 yes" and "spellings are fine"):
  `append`/`pop` (end), `prepend`/`shift` (front), `insert`/`remove` (anywhere); insert/remove COVER end and front.
  analyze: `grantAxis` is the one place grant spellings are read (the rest of O10 — the bracket form, `free` /
  `writable` / `replace`, bounded length — is still OPEN); Core's SeqGrants.at = the GROW places (insert expands to
  Append+Prepend+Anywhere edits in seqEdits, so check.scrml's C3 is untouched); SHRINK places are an analyze fact
  (`FieldInfo.shrink`); pop / shift / filter are judged by the shrink grant (a shrink-only field has no write
  capability — the removals are never lowered, so the grant alone decides). Retired `end` / `front` / `anywhere`
  → E-GRANT-UNKNOWN naming both halves. Tests: slice-m4/grants.test.js (append-only log refuses pop / shift /
  filter / prepend; stack `[free, append, pop]`; `[free, insert, remove, writable]` all four; runtime: `insert`
  appends and prepends). 6 mutations rows. Shared slice-m1/m2 files moved to the ruled tokens (valuesem fixture:
  its lowered Core is unchanged — oracle equality holds).
- PENDING the SPEC PR: slice-m4/src/audit/audit.scrml now writes `Entry[free, append]`; the §66.19.5 drift guard
  compares modulo that one token (+ a `test.todo` for verbatim); slice-m2 BASE_66_19's §66.19.5 block list gains
  E-GRANT-UNKNOWN (+ 2 × E-WRITE-NOT-GRANTED) until SPEC is amended.
- F7 STILL HELD (unchanged by the ruling): see "F7 NOT LANDED" above — what tripped it is slice-m2/front.test.js's
  S440 N1 "side-effecting override … converges" (guarded + unguarded), whose fixture `<log:int[append]=([])/>`
  (was `int[end]`) declares a FIXED-length log and pushes into it; refusing growth of a fixed-length sequence makes
  that fixture a compile error. Landing F7 = F7-held.diff + that fixture → `int[free, append]` (PA call).
- FINAL (HEAD): slice-m1 73/73 · lowered 73/73 · slice-m2 409/409 · slice-m3 29/29 · slice-m4 111 + 2 todo · lint 34/0 ·
  conformance 1047/1054 + 7 xfail · footprint 18/18, 579 not-yet, 447 front-end · mutations 144/144 RED ·
  bite 32 footprint + 12 front constructs certified.

## F7 LANDED (PA approved, S442)
- Applied F7-held.diff (re-sited by hand after the merge / token work): a GROWING edit — push / unshift, or the
  `[...@x, e]` / `[e, ...@x]` shape — on a sequence whose length axis is FIXED (no `free`) is E-WRITE-INVARIANT.
- Shared fixture change, slice-m2/front.test.js S440 N1 loop program: `<log:int[append]=([])/>` →
  `<log:int[free, append]=([])/>`. Reasoning (PA): the fixture declared a fixed-length log and pushed into it, which
  the ruled invariant forbids (§66.11.2 "invariants … are checked on EVERY write"; §66.12.1 "a sequence with no
  grants is fully constrained" — omission of the length axis = fixed). Those tests are about spread-override
  convergence, not length, so the fix does not change what they test (both still pass: box=1,0,1, log length 1).
- Tests: review-r1.test.js "F7" (push, spread-append, unshift on fixed-length → E-WRITE-INVARIANT; the same on
  `[free, append]` clean). 2 mutations rows.
- Left as-is per PA: `[...@x, call()]` snapshot semantics (to bryan); the E-PARSE-SHORTHAND-GT §34 row is owed.
- F7 FINAL: slice-m1 73/73 · lowered 73/73 · slice-m2 409/409 · slice-m3 29/29 · slice-m4 113 + 2 todo · lint 34/0 ·
  mutations 146/146 RED · bite 32 footprint + 12 front certified · five pre-existing programs byte-identical to base.

## FIX ROUND r2 (re-review of 2bd817a9 — one blocker)
Reproduced first (scratchpad/r2probe.js at 2bd817a9): item 1 — `<box a:int=1><c:int=0 s:int=7/></>` (void and bodied)
compiled clean with `s` absent from Core; item 2 — pop / shift / filter under `[pop]` / `[shift]` / `[remove]` (no
`free`) reported "granted"; item 3 — `[free, append, append]` accepted silently.
- Item 1 FIXED (blocker) — `o19Diags` checks the declaration AND every child field at any depth: E-BOOTSTRAP-UNSUPPORTED
  naming ⚑ O19. Tests: void child, bodied child, grandchild, twin (own value, no attributes — runs `1|0`).
- Item 2 FIXED — a removal (pop / shift) or `filter` on a fixed-length sequence → E-WRITE-INVARIANT ("shrinks …"),
  F7's mirror. Twin: `[free, pop]` stays granted.
- Item 3 FIXED — a grant token named twice → **E-GRANT-UNKNOWN** ("granted twice"). Choice: no §66.20 / §34 code names
  a repeated grant; E-GRANT-UNKNOWN is the grant-list code, and a repeat is not a value of any axis. (W-GRANT-REDUNDANT
  is a warning about `replace` + edits, not a refusal.)
- Item 4 IMPLEMENTED — RULED S442 (user-voice "…sequence spreads use one snapshot…"): every `@x` read inside
  `[...@x, …]` / `[…, ...@x]` reads ONE snapshot taken before the statement (analyze mints `SeqSnap`; lower emits the
  snapshot Let only when an element reads it, as the S440 struct spread does). F5/F6 shapes unchanged (review-r1
  tests still green). ⚑ FLAG — the PA's restatement says the statement's RESULT is "old-@audit + mk2's return" (the
  inner push lost). Implemented instead: the READS are snapshotted (the ruling's own parenthetical: "the inner push is
  not observed by the statement's READS"), and the write stays the classified append onto the current value, so
  mk2's own push survives — as a struct spread keeps a write to a field it does not override ("struct and tape
  spreads work the same way"). The restated result would REMOVE an entry from an append-only log (a shrink its grant
  forbids), so it cannot be lowered as the append the grant admits. If bryan meant the result, that needs a ruling on
  what happens to the intervening entry (refuse at runtime, or a replace).
  Test: review-r2 item 4 — `[...@audit, mk2(), { at: @audit.length }]` reads 2 (snapshot) though mk2 pushed.
- No previously-passing pin changed. Five pre-existing programs byte-identical (dumpcore). 5 mutation rows (+1 re-sited:
  the r1 G2 row's site moved into o19Diags).
- N1 and N4 (r2 reviewer nits): left as recorded nits, per the PA.

## r2 MERGE (#1157) + FINAL
- Pre-merge r2 tip f3005959. Merge a074fb02 (origin/main 8367a6b8 = #1157; main also carried the s440 CSS bite phase).
  Conflicts: slice-m3/bench/bite-matrix.js (main's cg/css phase loop kept; s442 FRONT phase added — `--front` alone,
  default runs cg + css + front) and slice-m3/bite.test.js (both judgement suites kept). analyze / lower / mutations /
  typer tests auto-merged; no #1157 match over AExprK lacked the Spread/Index/Lambda arms. First merge-commit attempt
  failed the pre-commit hook on the known live-Postgres hook timeout (§14.8.11 M2 db-migrate acceptance); the retry
  passed.
- Post-merge: one bite row (Lower.SeqEdits one-element append) was hollow — its site moved with r2 item 4 — re-sited.
- FINAL: slice-m1 73/73 · lowered 73/73 · slice-m2 431/431 · slice-m3 60/60 · slice-m4 123 + 2 todo · lint 58 files / 0 ·
  conformance (impl#1) 1063/1070 + 7 xfail (main grew 1054 → 1070) · footprint 18/18 runtime, 587 not-yet, 455
  front-end · mutations 170/170 RED · bite: CG 32 + CSS 32 certified (mirrors reproduced) + FRONT 12 certified ·
  five pre-existing programs byte-identical to base (dumpcore).
