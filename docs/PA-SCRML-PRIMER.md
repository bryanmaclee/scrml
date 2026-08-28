# PA scrml Primer — what every PA must know about the language

**Purpose:** make the PA the second-foremost expert on scrml at session start, without having to re-derive base syntax + mindset across hundreds of thousands of context tokens. This file is mandatory reading at session start (see `pa.md`).

**Status:** living document. Updated when SPEC changes, when locks land, when patterns emerge. Treat as the canon snapshot at the listed date.

**Last updated:** 2026-06-03 (S160 — S154 (b)/(c) landed: **(b)** `:`-shorthand **inside-opener canonical EVERYWHERE** (§4.14; the `:` follows the last attribute inside the opener, body to the opener `>`; after-`>` placement DEPRECATED via `W-COLON-SHORTHAND-LEGACY-PLACEMENT`; after-`:` whitespace now OPTIONAL; engine state-children + match arms + HTML + `<each>` all use the one form; ZERO codegen change). **(c)** no-RHS typed-decl **canonical-empty/`not` defaults** (§6.2 Shape 4 generalized from array-only: int/integer→0, number→0, bool/boolean→false, string→"", T[]→[]; bare-`T` no-canonical-empty struct/enum/date/timestamp/opaque → `not` + an implicit `(not to T)` lifecycle §14.12 [read-before-assign fires E-TYPE-001]; union `T|not`/`T?` → `not` NO lifecycle; refinement-violating-empty → NEW `E-REFINEMENT-NO-DEFAULT` §53; §34 **RETIRES `E-DECL-NEEDS-INITIALIZER`**). Also: §13.7 dA-b1 corrected — enum-subset batches 2-4 LANDED S156 (was wrongly shown deferred). NB the per-session header below is preserved from the S122 baseline; the body has had incremental S123-S160 additions inline. Earlier baseline preserved below.) — 2026-05-23 (S122 — NEW §6.2 Match block-form (Tier 1) — primer subsection added after the native parser's match-block FileAST synthesis shipped at S121 P5-7 / Wave 9-J `69388e28`. Covers block-form syntax, payload binding, both-shape coexistence, promotion path to Tier-2 engines, implementation status. Earlier baseline preserved below.) — 2026-05-17 (S98 — NEW Pillar 5b "Reach discipline" landed in §2 as companion to Pillar 5; ratified via the scrml-native JS parser Phase 0 deep-dive `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` §D1; charter form: "When a problem has a finite condition set with a transition contract, REACH FOR state primitives FIRST; reach for fn/function only when the problem is calculation, or when state-shape demonstrably loses on a named axis." Operationalized via a two-table YES/NO test; canonical state examples include lexer modes / engine state / parser-context / brace-depth tracking; canonical calculation examples include numeric-literal value parsing / string escape resolution / AST node construction. Pillar 5b is the procedural form of the corrected S95 state-vs-logic axiom — state describes its own transitions; logic does pure compute; reach for state first. Earlier baseline preserved below.) — 2026-05-14 (S92 — Approach A close end-to-end: A-1 markup-context edges (S88) + A-2 Reachability Solver (S89-S91, 5 components + outer fixpoint + canonical JSON §40.9.8) + A-3 §40 AuthGraph (S91, `<auth role>` first-class element + 5 sub-phases) + A-4 Per-Route Artifact Splitter (S91, 7 sub-phases + §47 FNV-1a content-addressing) + A-5 Integration Tests (S92, 5 sub-phases). v0.3.0 critical path complete; cut gated only on Wave 4.A adopter content. See new §9.7 below for the full overview. Plus: Q-OPEN-4 (S92) sourced `chunks.json` `compiler` field from package.json + bumped pkg.json to 0.3.0-alpha.0; Q-OPEN-6 (S92) split W-CG-CHUNK-NO-PREFETCH into Info (case 1: no internal links) + new W-CG-CHUNK-PREFETCH-UNRESOLVED Warning (case 2: links resolve nowhere); Q-OPEN-5 (S92) added `--chunk-size-budget` CLI flag. Insight 30 (S87) ratified: channels are CHILDREN of entry-file `<program>` (sibling of `<page>`) — §9.1 below rewritten. S86 ratifications: idiomatic-examples styling rule (no file-top `#{}`), corpus-ouroboros warning, BS-layer over SPEC retreat (Option A). S89 ABSOLUTE rule: `null` and `undefined` do NOT exist in scrml source; `not` for absence; `""`/`0`/`false`/`[]`/`{}` are defined values. Earlier baselines: 2026-05-07 (S68 — A5-1 spec amendments) → 2026-05-06 (S64 — forgotten-surface audit + Phase 4d completion sweep).

**Word of caution:** if this primer disagrees with `compiler/SPEC.md` or `docs/articles/llm-kickstarter-v2-2026-05-04.md`, the SPEC + kickstarter are authoritative. Surface the contradiction.

---

## §1 The single most important framing

**scrml's UI of an application SHOULD be a fully-handled state machine.** In scrml's vocabulary that machine is called an **engine**. The structural shape of the UI tree IS the structural shape of the application's state. This is not aspiration; it is design intent.

But — apps don't START at the north star; they EVOLVE toward it. Booleans-as-lifecycle in early sketch code are not violations; they are in-progress pins. The compiler nudges via lints (`W-LIFECYCLE-CANDIDATE`, `W-MATCH-TRANSITIONS-ACCRUING`) but does not enforce. Forcing the north star punishes prototyping; we don't.

**The Tier 0/1/2 commitment ladder for case analysis on enums:**

| Tier | Form | What you get |
|---|---|---|
| 0 | `if=` chains / `${ if (...) lift ... }` | prototype, no exhaustiveness check |
| 1 | `<match for=Type [on=expr]>` block (structural) **OR** `match expr {}` (JS-style value-return) | structural exhaustiveness; rules-inert in block form (with W-MATCH-RULE-INERT lint); value-return in JS-style form |
| 2 | `<engine for=Type initial=.Variant>` | full deal: exhaustiveness + active rules + transition handlers |

**The two Tier-1 shapes coexist (per L8):** the structural `<match for=Type>` block-form is the canonical UI-tree shape (rules-inert with lint nudge to Tier 2 — W-MATCH-RULE-INERT); the JS-style `match expr { … }` is the canonical **value-return** form for in-expression branching. Both check exhaustiveness against the discriminating type. Use whichever fits the surrounding context — markup tree vs. expression position. (S64 debate-04 verdict A+ item #3: this two-shape coexistence is what closes "where do I put the value-return rung?" — answer: it's already there.)

**Promotion is mechanical and additive.** State-children carry forward verbatim from Tier 1 (block form) to Tier 2; the wrapper swap is the commitment moment. JS-style `match expr {}` does NOT promote to Tier 2 directly — its semantic is value-return, not state-machine; if the value-return logic accumulates state-transition shape, the dev hoists into a `<match for=Type>` block first, then to `<engine>`.

---

## §2 The pillars (held since scrml8 era; locked at S55-S56)

1. **Markup is a first-class value type.** Markup elements may sit anywhere expressions sit — passed as args, stored in cells, returned from functions, on the RHS of `=`. Not a shortcut, not JSX-style sugar. Markup IS a value. (Lock L1.)
2. **State is the declaration primitive.** Reactive state cells `<x> = value` are the atomic unit. Everything declared as state is reactive by default.
3. **The compiler owns the wiring.** Server functions, routes, fetch calls, serialization, DOM wiring, async scheduling, and reactive dependency tracking are compiler concerns. The developer writes no boilerplate for these.
4. **One file type.** `.scrml` is the only source format. Logic, markup, style intermingle; the compiler decomposes them.
5. **All scrml should be scrml.** No bespoke per-state-type mini-DSLs. Every body that accepts content accepts the universal scrml grammar. Per-kind extensions (transitions, DDL, `@shared`) ride ON TOP of the universal base, not INSTEAD of it.
5b. **Reach discipline (S98 ratification).** When a problem has a finite condition set with a transition contract, REACH FOR state primitives (`<engine>` / typed structs / refinement-typed cells / validators) FIRST; reach for `fn` / `function` only when the problem is calculation, or when a state shape has been authored and demonstrably loses on a NAMED axis (ergonomics / spec-clarity / runtime-cost). The default for any new design is state-shape; logic is the explicit escape. Operationalized via a two-table YES/NO test: ask whether the locus has named conditions + a transition contract + a sensible "what condition is this in?" question — if YES, it is a state problem. The corrected S95 state-vs-logic axiom is the meta: state should describe its own transitions; logic should do pure compute. Pillar 5b is the procedural form. (Companion to Pillar 5 — Pillar 5 says scrml has one grammar; Pillar 5b says state-shape is its default expressive surface. Full charter + operational test + canonical state/calculation examples: `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` §D1.)
6. **Goal: bullet-proof apps.** A shipped scrml app should be essentially bullet-proof — every reachable state has UI, every transition is intentional, every effect runs at the right moment. **And** the developer should (almost) not realize they're making the app exhaustively provable. Provability falls out of the language's natural shape, not from separate proof ceremony.

---

## §3 V5-strict access — the access principle (§6.1)

scrml has TWO access forms for reactive state cells. Internalize this; it threads through every example.

| Form | Where |
|---|---|
| `<varname>` (structural) | declaration site, render-by-tag in markup, engine state-child tags |
| `@varname` (canonical expression access) | reads, writes, compound assignments |

**Bare names in expressions are LOCAL identifiers only.** They do NOT resolve to reactive state. `<count> = 0; let count = 5;` is `E-NAME-COLLIDES-STATE` — locals cannot shadow registered state names.

Why two forms: every state touch is visually distinguishable from local-variable touch. The reader can scan a function body and instantly count "how many state cells does this read or mutate." Load-bearing for the exhaustiveness goal.

**`@` is NOT a JS-framework concession.** It is the canonical, semantically-required marker. The pre-S55 framing of `@` as "sugar" is superseded.

---

## §4 The three RHS shapes for state declarations (§6.2)

Every state cell's right-hand side is one of three shapes.

**Shape 1 — plain reactive cell.** RHS is a literal or expression value. No render-spec. Display via `${@x}` interpolation only.

```scrml
<count> = 0
<name>  = ""
<items> = []
```

**Shape 2 — decl-coupled-with-render-spec.** RHS is bindable markup. Validators ride as bare attributes on the decl. `<varname/>` in markup expands to the bound input element with appropriate `bind:value`/`bind:checked` dispatch.

```scrml
<userName req length(>=2)> = <input type="text"/>
<agree    req>             = <input type="checkbox"/>
```

**Shape 3 — derived (read-only).** `const` modifier; RHS is an expression that recomputes on dep change. Markup-typed derived cells are legal under L1.

```scrml
const <doubled>     = @count * 2
const <greeting>    = "Hello, " + @userName
const <badge>       = <span class="badge">${@userName}</span>   // markup-typed
```

`<derivedName/>` in markup with a non-markup-typed derived cell is `E-CELL-NO-RENDER-SPEC`.

**Shape 1 is the non-markup value door.** Display-only markup on a Shape-1 (writable) RHS — `<thing> = <span>hi</span>` — is **`E-CELL-RENDER-SPEC-NOT-BINDABLE`**: use `const` (Shape 3) for display-only markup, Shape 2 for input-bound. A markup value reaches a cell by **derivation / binding / state-keying — never imperative reassignment** (the reactive-first grain). The **five declarative doors** markup enters through (§1.4, S279 ruling — an exhaustive, non-overlapping partition): **Component** (`<Foo>` reuse), **Bindable cell** (Shape 2, input value), **Derived cell** (Shape 3, recomputed), **Enum `renders`** (state-keyed, exhaustive — the home for "swap between a fixed set of markups"), **Iteration** (`<each>`, per-item). A writable markup cell is a redundant sixth door → deliberately rejected.

**Optional `default=` attribute** — any cell may declare an explicit reset target: `<startTime default=not> = Date.now()`.

**Optional `debounced=DURATION` / `throttled=DURATION` attributes (S79; SPEC §6.13)** — any Shape 1 or Shape 2 cell may carry one of two reactivity attributes that wrap the cell's write path with timing semantics:

```scrml
<query debounced=300ms> = ""                                  // writes coalesced; one trailing fire 300ms after last write
<scrollY throttled=100ms> = 0                                 // standard leading+trailing throttle
<typingDraft debounced=300ms req length(<=280)> = <textarea/> // composes with Shape 2 + validators
```

DURATION accepts the same form set as `<onTimeout after=>` (literal `Nms`/`Ns`/`Nm`/`Nh` OR computed `${expr}<unit>` — reuses `parseAfterDuration`). Forbidden on `const`-derived cells (`E-DEBOUNCED-WITH-DERIVED`); both attributes on the same cell forbidden (`E-REACTIVITY-ATTR-CONFLICT`); on `<x server>` cells forbidden (`E-DEBOUNCED-WITH-SERVER` — server timing semantics deferred). `reset(@cell)` on a cell with a pending timer cancels the timer before applying the reset value (§6.8 amendment). The pre-v0.next `@debounced(N) name = expr` keyword-form was retired at S79 (clean-cut, no deprecation cycle).

---

## §5 Compound state — Variant C (§6.3)

Ad-hoc compound state uses structural-children. Field access via canonical dot navigation.

```scrml
<formRes>
    <name>  = ""
    <email> = ""
    <error> = ""
</>

// Read: @formRes.name, @formRes.error
// Write: @formRes.name = "alice"
```

Tier 3 predefined-shape compound (positional sugar legal):

```scrml
type UserInfo:struct = { name: string, age: number, active: boolean }
<userInfo>: UserInfo = ("alice", 30, true)
```

Positional binding is legal ONLY when the structure is fixed by a predefined type. Ad-hoc compound state must use structural-children form.

---

## §6 The error model — `fail` / `!{}` (NOT try/catch)

**try/catch is not in scrml's vocabulary.** Public claim. Surface a retraction if anyone slips and uses it.

scrml uses **failable functions** + **call-site `!{}` handlers**:

```scrml
type LoadError:enum = {
    Network(msg: string)
    Empty
}

function fetchItems()! -> LoadError {
    const result = ?{ select * from items }
    if (result.length == 0) fail LoadError::Empty
    return result
}

function load() {
    const rows = fetchItems() !{
        | ::Network msg :> { @phase = .Error(msg); return }
        | ::Empty       :> { @phase = .Empty;       return }
    }
    @phase = .Success(rows.length)
}
```

Pattern:
- `function name(args) ! ErrorType { ... }` declares failable
- `fail .Variant(args)` surfaces the error
- `let x = call() !{ | ::Variant arg :> { ... } }` exhaustive call-site handler

**Errors-as-states is the canonical lifting:** at Tier 1+, the `!{}` handler at the call site does one thing — route each error variant into the right Phase variant. The error becomes a state in the Phase enum. `<isError>` + `<errorMsg>` cells are anti-patterns; the failure modes live in the type.

**`<errorBoundary>` for render-context error catch (§19.6).** When a `!`-function call sits in markup context — or when a sub-component throws an uncaught host error during render — `<errorBoundary>` catches it. It is the markup-context counterpart to `match` / `!{}` in logic context, and scopes to its body subtree:

```scrml
type LoadError:enum = {
    NotFound(id: string)
        renders <div class="err">Item ${id} not found</>
    Timeout
}

<errorBoundary fallback={<div>Something went wrong loading this section.</>}>
    ${loadUser(42)}
    ${loadContacts()}
</>
```

A caught error variant is displayed via its OWN `renders` clause (§19.2) when it has one — e.g. `NotFound` renders its own `<div class="err">…</>` with the payload `${id}` in scope. A variant WITHOUT a `renders` clause falls through to the boundary's `fallback={<markup/>}` attribute (priority: variant `renders` > boundary `fallback`, §19.6.5). The compiler statically verifies (E-ERROR-005, §19.6.6) that every error variant reachable inside the boundary is displayable — neither `renders` nor `fallback` covering a variant is a compile error. Boundaries nest — an inner boundary catches before an outer (inner-catches-first, §19.6.4). In addition to the typed `!`-error path, the compiler emits a host-JS backstop (§19.6.8 C-hybrid) so an unexpected NON-`!` throw during render also degrades to `fallback` — the boundary does NOT swallow the error; the diagnostic + stack trace are routed to scrml's logging surface. (The backstop is compiler-emitted host-JS, NOT a scrml-source try/catch — §19.9.8 is unaffected.)

**Implicit per-handler transactions (§19.10.5).** Inside an `!{}` handler arm, scrml wraps the SQL writes the arm performs in an implicit transaction. If the handler arm fails (re-throws OR a downstream `!{}` doesn't catch), the SQL writes ROLL BACK automatically. This is the canonical safety property — adopters get atomic-rollback semantics without `BEGIN`/`COMMIT` ceremony. Per-handler-tx is opt-OUT (annotation `@nosql-tx` on the handler arm) for the rare case you want to commit-on-error.

**Body-split / CPS (§19.9.3 — footnote).** Server-function calls inside non-top-level positions (inside `if` branches, inside `match` arms, inside loop bodies) are compiled-to-CPS — the compiler splits the function body at server-call boundaries and routes the continuation through a stub. Multi-batch CPS (§19.9.9, S114 Ext 1) extends this to multi-server-call sequences. Adopters never write the CPS form — it's compiler-managed; the source stays uncolored. Failures route through `!{}` handlers naturally; the CPS plumbing is invisible.

**Function forms — `function` / `fn` (§48 + §33). Server placement is INFERRED, not a written form; the `pure` modifier and the explicit `server function` modifier are deprecated.**

scrml has TWO canonical function-declaration shapes:

- **`function`** — the workhorse; can fire any side effects (DOM, state mutation, event handlers). Client-vs-server placement is INFERRED (§12) — you don't annotate it.
- **`fn`** — THE canonical pure form (§33/§48.11); body prohibitions: no SQL, no DOM, no outer-scope mutation, no non-determinism (`Date.now()`/`Math.random()`), no async, must return at every path. `lift` inside `fn` is `E-SYNTAX-002` — `fn` returns markup, never lifts.

**Server placement is INFERRED (§12), not written.** Any `function` touching a server-only resource (`?{}` SQL, `Bun.*`, file I/O, env) auto-escalates to server; the client call compiles to a fetch. **You don't write `server` on a `function`** — the explicit modifier is deprecated and fires `W-DEPRECATED-SERVER-MODIFIER` wherever the body already escalates (≈ everywhere `server function` appears). User intent (S175): *"there is no explicit `server function`."* (Worked examples across spec/primer still show the explicit form pending the §12-inference corpus migration — `g-server-keyword-drift`.)

- **`server fn` is the EXCEPTION — NOT deprecated.** A pure `fn` has no escalation trigger to infer from, so `server` is LOAD-BEARING there: it pins a pure helper to the server. (This is also why the `server` modifier can't be fully retired — `server function` is redundant, `server fn` is not.)
- **~~`pure function`~~ / ~~`pure fn`~~ — DEPRECATED** (2026-06-09). The `pure` modifier is deprecated language-wide; every `pure`-modifier form fires `W-PURE-DEPRECATED` (supersedes the old `W-PURE-REDUNDANT`). Use `fn`, or `server fn` for a pure server helper. Run `bun scrml migrate --fix` (covers `pure` + `<machine>` today; a `server function`→`function` migration is scoped — `g-server-keyword-drift`). Mirrors the `<machine>`→`<engine>` cycle, which has since run to completion — `<machine>` is REMOVED, not deprecated (§7). Bare `function` stays the impure form.

**Mutual recursion + hoisting (§48.6.4, S98)** — `fn` declarations at file scope hoist exactly like `function`; mutual recursion works without forward-ref ceremony. `pinned fn` opts out (forward-ref becomes `E-STATE-PINNED-FORWARD-REF`).

**Reach discipline (Pillar 5b)** — when computing a value with no side effects, reach for `fn`. The call site reads as "this is a calculation, not a state machine." `function` is the impure-work escape hatch.

### §6.1 No `async` / `await` (S114 — parallel rule to "no try/catch")

**Added 2026-05-21 (S114 ratification, user-voice append).** scrml has **no `async` / `await` keywords** — language-wide standing rule. Public claim. Surface a retraction if anyone slips and uses it. Reasons (user-voice S114 verbatim): *"I hate leaky abstractions and colored functions."* The body-split / CPS mechanism (A9 / Insight 26 / S72 ratified) is scrml's canonical async surface — compiler-managed, uncolored at source.

**Naming discipline — `!{}` is the ERROR context, NOT the async surface:**

| Concern | Surface | Description |
|---|---|---|
| Async | **body-split / CPS** | Compiler CPS across server boundary. Uncolored at source. |
| Failable signature | **`!`** on fn signature | Type-level "this can fail with ErrorType." |
| Error handler | **`!{}`** at call site | Exhaustive error-variant handler. The error context. |

These COMPOSE — body-split stubs are implicitly `!`-typed because network/server calls fail; their failures route through `!{}` — but they are DISTINCT mechanisms. Don't say "the `!`-body-split" — body-split is named for what it is; the `!`-typing is a consequence (failure-mode preservation), not the mechanism name.

**SPEC status (S114).** SPEC §48.3.5 / E-FN-005 currently forbids async/await inside `fn` bodies only; the error message implies it's OK elsewhere. Promotion to language-wide is queued (see hand-off / master-list). The native parser (M4.3, S114) fires `E-ASYNC-NOT-IN-SCRML` / `E-AWAIT-NOT-IN-SCRML` / `E-FOR-AWAIT-NOT-IN-SCRML` at parse-time on any of these forms.

**Generators (`yield` / `yield*` / `function*`) are NOT covered by this rule.** They are a separate conversation — preserved in the JS-subset bound at M4.3, semantic policy open per S114.

**Trail.** User has stated the "no async/await" position on multiple prior occasions (see `scrml-support/docs/research/developer-ergonomics-report.md:127` — *"parallel by default, no async/await"*); S114 user-voice is the formal capture, not the origination.

---

## §6.2 Match block-form (Tier 1) — `<match for=Type>` (§18.0.1)

**Added 2026-05-23 (S122 — primer subsection added after P5-7 / Wave 9-J shipped match-block FileAST synthesis in the native parser at S121 commit `69388e28`).**

The structural rung of the Tier-0/1/2 commitment ladder (per §1). Two coexisting shapes; this is the **block-form**.

```scrml
type Phase:enum = { Idle, Loading, Error(msg: string), Empty, Success(count: int) }

<phase>: Phase = .Idle

<match for=Phase on=@phase>

    <Idle>
        <button onclick=load()>Load</button>
    </>

    <Loading>
        Loading...
    </>

    <Error msg>
        Error: ${msg}
    </>

    <Empty>
        No rows yet.
    </>

    <Success count>
        Got ${count} rows
    </>

</>
```

**What it gives you:**

- **Structural exhaustiveness check** — `E-MATCH-NOT-EXHAUSTIVE` fires if any variant of the discriminating type is missing. Wildcard `_` legal as escape hatch.
- **Bare-variant inference inside arm tags** (§14.10 / M9) — write `<Idle>` not `<Phase.Idle>`. The arm-tag's variant qualifier is inferred from the `for=` type.
- **Payload binding** (§18.7 / §51.0.B.1 sister form) — `<Error msg>` binds the variant's payload field positionally; `<Success count>` likewise. Named form: `<Error msg=err>`; parenthesized form: `<Error(msg)>`. Unit variants reject payload binding (`E-ENGINE-PAYLOAD-ON-UNIT-VARIANT` — same shape for match-block).
- **Rules-inert** — `rule=` on a match arm parses but does nothing (`W-MATCH-RULE-INERT` lints — that's the engine surface). `effect=` and `<onTransition>` are forbidden inside match arms (`E-MATCH-EFFECT-FORBIDDEN` / `E-MATCH-ONTRANSITION-FORBIDDEN`).

**The other Tier-1 shape — JS-style value-return:**

```scrml
const <label> = match @phase {
    .Idle               :> "Idle"
    .Loading            :> "Loading"
    .Error(msg)         :> "Error: " + msg
    .Empty              :> "No rows"
    .Success(count)     :> count + " rows"
}
```

Both shapes check exhaustiveness against the discriminating type; use whichever fits the surrounding context — **markup-tree position uses block-form; expression position uses value-return form**. They are not interchangeable — value-return doesn't render markup, block-form doesn't return a value.

**Promotion path: Tier 1 → Tier 2 (engines).** Block-form match arms carry forward to engine state-children verbatim. Mechanical:

```scrml
<engine for=Phase initial=.Idle>          <!-- promoted: <match for=Phase on=@phase> -->

    <Idle rule=.Loading>                  <!-- NEW: rule= becomes active -->
        <button onclick=load()>Load</button>
    </>

    ...

</>
```

The `bun scrml promote --match <file>[:line]` CLI lifts block-form to engine form mechanically (§56, S66 SHIPPED). The state-children content carries over unchanged; the wrapper swap (`<match>` → `<engine>`) + `initial=` addition + per-arm `rule=` additions are the commitment moments.

**JS-style match does NOT promote directly to engine.** Its semantic is value-return; if value-return logic accumulates state-transition shape, hoist into a `<match for=Type>` block first, then to `<engine>`.

**Implementation status (as of S121 / S122):**

- Block-form FileAST synthesis lands in the native parser at S121 P5-7 / Wave 9-J commit `69388e28`. Live (BS+Acorn) pipeline shipped earlier (D2.8 / S57).
- `I-MATCH-PROMOTABLE` info-lint surfaces Tier-0 chains (`if (@cell is .X)`) ready for Tier-1 lifting (§56, S66 Tier B SHIPPED). Subsequent W-MATCH-TRANSITIONS-ACCRUING lint nudges Tier-1→Tier-2 (deferred to §56 Tier C — needs the lint's groundwork; not yet shipped).

---

## §6.3 Iteration (Tier 1) — `<each>` (§17.7)

**Added 2026-05-26 (S131 — primer subsection added after the iteration arc shipped end-to-end: codegen Landing 1 `emit-each.ts` at commit `23db318c`, SPEC §17.7 Landing 2, and the `@.` sigil / `<empty>` / inferred `key=` surface).**

The structural rung of the iteration Tier ladder — the SIBLING of §6.2 match block-form. Two tiers coexist; this is the **Tier-1 structural form**, where the per-item template is markup (Pillar 1), not a logic-context lift.

```scrml
type Contact:struct = { id: string, name: string, email: string }

<contacts>: Contact[] = []

<ul>
    <each in=@contacts key=@.id>
        <li : @.name>
        <empty>No contacts yet.</>
    </each>
</ul>
```

**What it gives you:**

- **Two iteration shapes.** `<each in=@coll>` iterates a reactive collection; `<each of=N>` iterates `N` times (count form). Exactly one of `in=` / `of=` per opener.
- **The `@.` contextual sigil (§3.4 / §17.7.3)** — `@.` is always "the current iteration value." In `in=` form it's the current item (`@.name`, `@.email` are field access); in `of=` form it's the current index (`0..N-1`). It is a SIGIL, not a reserved name — `@` is the state-access sigil per §6.1, and `@.` extends it to the current iteration scope (the DD-eliminated `@it` reserved-name approach would have violated V5-strict; a sigil does not). `@.` outside an `<each>` body is `E-SYNTAX-064` (queued — see Implementation status).
- **Optional `as name` alias** — `<each in=@items as item>` binds the meaningful name `item` to the current value. `item` and `@.` are ALIASES in the body; `${item.name}` and `${@.name}` produce identical codegen. The bound name needs NO `@` sigil because it is a local binding, not registered state. `as` is the mechanism for keeping an OUTER item addressable inside a nested `<each>` (the inner `@.` always resolves to the innermost scope).
- **The `<empty>` sub-element (§17.7.4)** — optional empty-state fallback rendered when the collection is empty (`.length === 0` / `is not`) or the count is `0`. Plain free-text body; `@.` is NOT in scope inside `<empty>` (there is no current item). At most one `<empty>` per `<each>`. May use `:`-shorthand: `<empty : "Nothing here.">`.
- **`:`-shorthand body via §4.14, no new mechanism (§17.7.6)** — a single-expression per-item template uses the existing §4.14 `:`-shorthand verbatim: `<li : @.name>` (`:` inside the opener, mandatory space before, no closer). Mixing `:`-shorthand / bare-body / self-closing per-item elements in one `<each>` is legal; each opener picks its body form. The bare-body form uses ordinary `${...}` interpolation: `<span class="tag">${@.name}</span>`.
- **Inferred `key=` (§17.7.5)** — the DESIGN intent is auto-inference from the item type's `.id` field (silent + correct, keyed DOM reconciliation). When inference can't resolve an identity, the `W-EACH-KEY-001` info-lint fires and names three legitimate fixes: (a) order-stable list → suppress with `key=__index__`; (b) identity lives in another field → `key=@.email`; (c) positional fallback is intentional → `key=__index__`. Override anytime with explicit `key=expr`. `<each of=N>` defaults to `key=@.` (the index) and NEVER lints. **Landing-1 caveat:** the `.id` type-introspection is conservative — in the common pipeline path the lint fires even when the struct has an `id` field, so the reliable silencer today is explicit `key=@.id`. The lint is informational; correctness (positional fallback) is preserved regardless.

**The four canonical shapes (§17.7.2):**

```scrml
<each in=@contacts>                      <!-- 1. collection + :-shorthand body -->
    <li : @.name>
</each>

<each in=@conflicts as conflict>         <!-- 2. collection + as-name + multi-element body -->
    <div>
        <h3>${conflict.summary}</h3>
        <p>${conflict.partyA} vs ${conflict.partyB}</p>
    </div>
</each>

<each of=10>                             <!-- 3. count + :-shorthand; @. is the index -->
    <li : "Slot " + @.>
</each>

<each of=@daysLeft as day>               <!-- 4. count + as-name + multi-element body -->
    <li>Day ${day + 1}</li>
    <empty>Trip is over.</>
</each>
```

**Promotion path: Tier 0 → Tier 1.** The Tier-0 iteration form is the logic-context `${ for (let x of @items) { lift <markup/> } }` (§17.4); it stays valid and compiles cleanly. The `W-EACH-PROMOTABLE` info-lint surfaces promotable Tier-0 sites (fires when a `for`-stmt iterates a reactive `@cell` AND the body contains a `lift`); the message names the suggested `<each in=@cell as x>...</each>` target. The mechanical lift is `bun scrml promote --each <file>[:line]` (§56.10) — wrapper swaps from `${...lift...}` to `<each in=@cell>...</each>`, the per-item template carries forward, single-expression bodies auto-apply `:`-shorthand. Additive, not deprecating; mirrors the §6.2 `bun scrml promote --match` ergonomics.

**Implementation status (as of S131):**

- **Codegen LANDED** — `compiler/src/codegen/emit-each.ts` emits the mount slot + per-each render fn + `_scrml_reconcile_list` keyed diff + `_scrml_effect_static` reactive subscription. All four shapes + `<empty>` + `as name` + `:`-shorthand + explicit `key=` compile today (24 unit tests, `compiler/tests/unit/each-block.test.js`). Landing-1 attribute-interpolation on per-item openers is best-effort (literal string attrs copy; complex interpolation-bearing attrs defer) — keep per-item element attributes simple, or push dynamic values into the body expression.
- **Lints LANDED** — `W-EACH-PROMOTABLE` (`lint-w-each-promotable.js`) + `W-EACH-KEY-001` (`lint-w-each-key.js`), both info-severity, both with §34 catalog rows.
- **`bun scrml promote --each` — SHIPPED (S134; verified empirically S195).** It mechanically lifts a `${for/lift}` site to `<each>`, BUT only when the iterable is a bare `@cell[.field.chain]` ref (§56.10.2) — function-call iterables (`loadContacts()`), literal arrays, and multi-lift bodies are correctly SKIPPED (reports "no promotable sites"). A transactional sanity-gate reverts any rewrite that fails to re-parse, so no file is ever corrupted. Consequence: most real corpus list-renders need a hand-lift (extract the iterable into an `@cell` first); the tool captures the bare-`@cell` cases. (The prior "Landing 3 PENDING" claim here was stale — `--each` shipped at S134; only the `--engine` companion verb is still pending.)
- **Queued diagnostics NOT yet emitted** — `E-SYNTAX-064` (`@.` outside `<each>`), `E-EACH-ITER-SHAPE` (neither/both `in=`/`of=`), `E-EACH-EMPTY-BODY`, `E-EACH-EMPTY-DUPLICATE`, `E-EACH-KEY-SENTINEL` are specified (§17.7 / §34) but not wired. The §34 native-parser catalog (81 codes) is unchanged by iteration — these are host-side TS/lint codes.

**Cross-references:** §17.7 (normative), §3.4 (`@.` per-locus row), §17.4 (Tier-0 form + `W-EACH-PROMOTABLE`), §4.14 (`:`-shorthand grammar), §56.10 (`promote --each` CLI), §6.2 (the sibling match Tier ladder), §13.8 (promotion-ergonomics design center).

---

## §6.4 Producing markup from logic — the one-shot-lift idioms

**Added 2026-05-26 (S132 — folds in the `one-shot-lift-ergonomics-2026-05-26` DD idiom catalog (HU-Q2). The DD asked whether a new `$(param){…}` shorthand was needed for "one-shot parameterized logic that lifts markup"; the verdict was MOSTLY-(A): scrml already expresses every sub-shape with existing primitives, so no new sigil was added. This subsection is the canonical "how scrml produces markup from logic" reference. The companion §10.4 staleness fix shipped the same session.)**

> **The teachable rule (read this first).** *`lift` lives only in anonymous `${}` blocks. A function that produces markup `return`s it — it never `lift`s. To name a reusable markup value, use `const <x> = <markup>` (reactive) or a `snippet` prop (parameterized). To branch inline, use a ternary or `if=`.*

**The anchor fact — the reflex shape does NOT compile.** The pattern your training-data muscle memory reaches for — *"declare a one-shot named function inside a `${}` block and `lift` markup out of it"* — is rejected by the compiler:

```scrml
<ul>${
    function buildRows(items) {           // ← a bare `function`
        for (item of items) {
            lift <li>${item.name}</li>    // ← Error E-SYNTAX-002
        }
    }
    buildRows(@contacts)
}</ul>
```

> `E-SYNTAX-002`: `lift` is not valid inside a standard `function` body. A `function` returns markup as a value; the caller lifts the returned value, or you refactor into a component.

This is **why the shape always felt like ceremony** — its lift-bearing form is forbidden outright. There is nothing to "simplify": the construct never existed. (A `fn` body — distinct from a bare `function` — *does* permit `lift` to its local `~`, returned via `return ~`; see §48.5 and the corrected §10.4. But you rarely need even that — the five idioms below cover the real cases.)

**The five sub-shapes.** "One-shot parameterized logic that produces markup in child/logic-block position" decomposes into five cases; none needs the forbidden shape. Each example below compiles against the live compiler.

**(1) Iteration → `<each>` (Tier 1) or `${ for … lift }` (Tier 0).** Rendering a collection is the original motivating case, and §6.3 already ate it. Reach for the structural `<each>`:

```scrml
type Contact:struct = { id: string, name: string }
<contacts>: Contact[] = []

<ul>
    <each in=@contacts key=@.id>
        <li : @.name>
        <empty>No contacts yet.</>
    </each>
</ul>
```

The Tier-0 logic form stays valid and compiles cleanly (`W-EACH-PROMOTABLE` nudges the lift): `<ul>${ for (c of @contacts) { lift <li>${c.name}</li> } }</ul>`.

**(2) Conditional / branch → ternary, `if=`, or a named `const`.** Pick by complexity. Inline single-use → ternary markup-as-value:

```scrml
<div>${ @user.admin ? <span>Admin</span> : <span>User</span> }</div>
```

Show-or-hide a single element → the `if=` attribute: `<span if=@user.admin>Admin</span>`. Name it / reuse it / make it reactive → a markup-typed derived cell (§6.6.17):

```scrml
const <badge> = @user.admin ? <span>Admin</span> : <span>User</span>
<div>${@badge}</div>
```

**(3) Computed value → markup → a derived cell, then interpolate.** When the markup is "some text built from an expression," compute the value first and interpolate it — no block, no lift:

```scrml
<price> = 19.99
const <formatted> = "$" + @price.toFixed(2)
<strong>${@formatted}</strong>
```

(Or inline it where it's used once — `<strong>${"$" + @price.toFixed(2)}</strong>` — via §7.4.2 inline interpolation.)

**(4) One-shot helper that feeds markup → `fn name(args) -> T { return … }`, then `${ name(args) }`.** This is the canonical existing idiom — it's all over the corpus (e.g. trucking-dispatch `messages.scrml` `fn senderLabel(role, email) -> string`). A `fn` does pure computation and `return`s a value; the markup interpolates the call:

```scrml
${
    fn senderLabel(role, email) -> string {
        return role == "driver" ? "Driver" : email
    }
    lift <span>${senderLabel(@role, @email)}</span>
}
```

**(5) Parameterized markup fragment reused across call sites → a `snippet` prop (§14.9) + `render` + a `{ (p) => <markup> }` lambda (§16.6).** This IS scrml's "named parameterized markup fragment." Declare the slot as a parametric `snippet` on a component, `render` it in the body, and fill it with a lambda at the call site:

```scrml
const Field = <div props={
    label: string,
    control: snippet(name: string)
}>
    <label>${label}</label>
    ${render control(label)}
</div>

<userName> = "Ada"

<Field
    label=@userName
    control={ (n) => <strong>${n}</strong> }
/>
```

**Why this is the whole answer (cross-framework).** The consensus across Svelte 5 (`{#snippet}` + `{@render}`), SolidJS (helper-fn-returns-JSX vs component), React (ternary vs render-prop), and Vue 3 (ternary-for-simple, computed-for-complex) is exactly scrml's existing family: ternary for simple branches, derived `const` for computed values, a `fn`-returns-value for helpers, a parametric `snippet` for reused fragments. scrml is not missing a member — there was never a residual for a `$(param){}` shorthand to fill.

**Cross-references:** §10.4 (the corrected `lift`-in-`function`-vs-`fn` rule), §48.5 (`lift` inside `fn`), §14.9 (`snippet` type) + §16.6 (parametric snippet lambda at the call site), §6.6.17 (markup-typed derived cell), §17.7 (`<each>`) + §6.3 (the iteration subsection), §7.4.2 (inline interpolation).

---

## §6.5 Lifecycle annotation — `(A to B)` (§14.12)

**Added 2026-05-26 (S134 — Lifecycle Landing 3; closes F-023 from S130 HU-1 ratification. Type-system surface ratified S130 — SPEC §14.12; per-access tracker shipped S130 Landing 1; extension scope + glyph migration shipped S130 Landing 2; fn-return hybrid shipped S131 HU-2.)**

A lifecycle annotation `(A to B)` on a type position declares that the location starts holding a value of type `A` and transitions to type `B`. The compiler tracks per-access transition state and fires `E-TYPE-001` at any read of the location before it has transitioned.

```scrml
type User:struct = {
    id: number,
    email: string,
    passwordHash: (not to string)        // starts absent; transitions to string after hashing
}

<u>: User = { id: 1, email: "a@b.com", passwordHash: not }

function hashUserPassword(raw: string) {
    const leaked    = @u.passwordHash      // E-TYPE-001 — pre-transition read
    @u.passwordHash = hashPassword(raw)    // transition: a string value is assigned
    const ok        = @u.passwordHash      // OK — post-transition read
}
```

The annotation is a **type-system** mechanism, NOT a state-machine. For variant-graph progression with explicit `from` / `to` declarations, use an engine (§7 / Tier 2). Engines and lifecycle annotations are complementary; the engine-cell carve-out below preserves the separation.

### The canonical glyph — `to` (contextual keyword)

`to` inside the parenthesised lifecycle expression is a **contextual keyword**, parallel to `from` in `import` declarations (§21.3). Outside this position, `to` remains usable as an identifier, attribute name, struct field, etc.

```scrml
passwordHash: (not to string)            // canonical (S130 — HU-1)
passwordHash: (not -> string)            // legacy — accepted; surfaces W-LIFECYCLE-LEGACY-ARROW
```

The legacy `->` glyph is RECOGNISED during the deprecation window and surfaces an info-level lint `W-LIFECYCLE-LEGACY-ARROW`. Both forms parse and resolve identically during the window. New code SHALL use `to`; existing samples MAY migrate at convenience. End-of-window timing promotes `W-LIFECYCLE-LEGACY-ARROW` → `E-LIFECYCLE-LEGACY-ARROW` (reserved; not yet emitted).

**Disambiguation from JS arrow `=>`:** the JS arrow function `(x) => expr` uses `=>` in EXPRESSION position; the lifecycle annotation uses `to` (or legacy `->`) in TYPE position. No glyph collision.

**Disambiguation from `fn` return arrow `->`:** the `fn` signature `fn name() -> ReturnType` uses `->` as a STRUCTURAL SEPARATOR in the function signature grammar — NOT a lifecycle annotation. The lifecycle annotation appears INSIDE a parenthesised type expression in the return type slot (e.g., `fn loadUser(id: number) -> (not to User)`).

### Permitted positions — the teachable rule

**"Lifecycle annotation goes anywhere a type goes, except engine cells."** (S130 — HU-1 Q1=c.)

| Position | Permitted? | Worked example |
|---|---|---|
| Struct field | YES | `passwordHash: (not to string)` |
| Shape 1 plain reactive cell | YES | `<status>: (Idle to Active) = .Idle` |
| Function parameter | YES | `fn process(u: (not to User))` |
| Function return | YES (hybrid; §6.5 below) | `server function loadUser(id: number) -> (not to User)` |
| Schema field | YES | (cross-ref §14.12.7) |
| Channel cell | YES | (cross-ref §14.12.8) |
| **Engine cell** | **NO** — fires `E-TYPE-LIFECYCLE-ON-ENGINE-CELL` | (see carve-out below) |

### Engine-cell carve-out (the critical exception)

A cell that is the **auto-declared variable of an `<engine>` declaration** (or any `var=` override) is an **engine cell** and SHALL NOT carry a lifecycle annotation. Engines own variant-graph progression via `rule=` / `initial=` / `<onTransition>`; a lifecycle annotation on an engine cell would create a second, redundant progression mechanism on the same surface.

```scrml
type Phase:enum = { Idle, Loading, Done }

<engine for=Phase initial=.Idle>
  <Idle    rule=.Loading>: "idle"
  <Loading rule=.Done>:    "loading"
  <Done>:                  "done"
</>

<phase>: (Idle to Done) = .Idle           // E-TYPE-LIFECYCLE-ON-ENGINE-CELL
                                          // `@phase` is the engine's auto-declared cell;
                                          // engine `rule=` already owns the progression.
```

For value-shape progression on a cell that is NOT an engine cell, declare as a plain Shape 1 reactive cell:

```scrml
type Phase:enum = { Idle, Loading, Done }

<phase>: (Idle to Done) = .Idle           // Shape 1 plain reactive cell — lifecycle permitted.
                                          // No engine declaration exists for `phase`.
@phase = .Done                            // legal — transition fires; subsequent reads pass.
```

The carve-out is detected at type-resolution: a state-decl is classified as an engine cell iff a sibling `<engine>` declaration's `engineMeta.varName` (or `var=` override) matches the state-decl's name. Unambiguous — engine declarations are syntactic constructs, not user-named conventions.

**Subtlety — struct fields whose TYPE is engine-driven are NOT engine cells (R24 surface).** The carve-out applies to the engine's auto-declared variable. A struct field that happens to have the same type as an engine's variant enum is a struct field, not an engine cell — and lifecycle annotation on that field is LEGAL. The struct field's lifecycle is a type-system contract on the struct value's history; it is INDEPENDENT of the engine's variant-graph progression.

```scrml
type TicketStatus:enum = { Open, InProgress, Resolved, Closed }

type Ticket:struct = {
    id: int,
    title: string,
    status: TicketStatus (Open to Closed),     // LEGAL — struct field, NOT an engine cell
    resolvedAt: (not to timestamp),            // LEGAL — orthogonal lifecycle on a different field
    createdAt: timestamp
}

<engine for=TicketStatus initial=.Open>
  <Open    rule=.InProgress>:     "open"
  <InProgress rule=[.Resolved, .Open]>: "in progress"
  <Resolved rule=.Closed>:        "resolved"
  <Closed>:                        "closed"
</>

// `<status>: TicketStatus = .Open` would be an ENGINE CELL (sibling matches engine's auto-declared name).
// Annotating it with `(Open to Closed)` fires E-TYPE-LIFECYCLE-ON-ENGINE-CELL.
// But `status: TicketStatus (Open to Closed)` INSIDE the `Ticket` struct is a struct FIELD, not the
// engine's auto-declared cell — the annotation is legal per §14.12.

let t: Ticket = { id: 1, title: "x", status: .Open, resolvedAt: not, createdAt: Date.now() }
// At construction: t.status starts at pre-type (Open); read of t.status is legal because struct
// fields use construction-time discrimination, not the engine's runtime progression.
```

The point of separation: the **engine** owns the runtime-mutable variant cell (the auto-declared variable). The **struct field** owns a type-system contract on what variant a struct VALUE carries through its lifetime. Two different concerns; the carve-out only forbids them collapsing onto the same cell. If you find yourself wanting both — engine-driven runtime progression AND struct-field lifecycle on the same logical state — that's a hint to factor the struct field's lifecycle into a sibling cell (use the engine's variant progression for the runtime state; let the struct value be a snapshot).

### Function-return position — the hybrid mechanism (§14.12.6)

Lifecycle on function-return type is fully tracked end-to-end. The transition mechanism splits by the lifecycle's pre-type:

| Lifecycle shape | Pre-type | Transition mechanism |
|---|---|---|
| **Presence-progression** | `not` (e.g., `(not to T)`) | **Discrimination IS transition** — `given u = expr {}`, `if (u is not) return`, OR `match u { ... }` AUTO-MARKS |
| **Variant-progression** | An enum variant (e.g., `(.A to .B)`) | **Explicit `transition(u)`** — call the `transition()` built-in after discriminating the source variant |

**Presence-progression — discrimination IS transition:**

```scrml
function loadUser(id: number) -> (not to User) {
    const row = ?{ select * from users where id = ${id} }.get()
    return row     // returns `User | not`; lifecycle declares the post-transition contract
}

const u = loadUser(42)

// Form 1 — given presence-guard (§42.2.3)
given u :> {
    const name = u.name                   // OK — discrimination = transition
}

// Form 2 — if-is-not early-return
if (u is not) return
const name = u.name                       // OK — narrowed + transitioned

// Form 3 — match
match u {
    not => handleAbsence()
    given u :> { const name = u.name }    // OK — arm discriminates + transitions
}

// Pre-transition access — fires E-TYPE-001
const u2 = loadUser(42)
const u2name = u2.name                    // E-TYPE-001 — u2 was not discriminated
```

**Variant-progression — explicit `transition(u)`:**

```scrml
type Article:enum = {
    Draft(body: string),
    Published(body: string, publishedAt: number)
}

function publish(id: number) -> (.Draft to .Published) {
    const a = ?{ select * from articles where id = ${id} }.get()
    return a as .Published                // callee transitions; returns Published-shape
}

const a = publish(42)

if (a is .Draft) {
    transition(a)                         // explicit per-access transition signal
    const publishedAt = a.publishedAt     // OK — post-transition access of B-shape field
}

// Missing-transition — fires E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED
if (a is .Draft) {
    const publishedAt = a.publishedAt     // accessed .Published-shape field after
                                          // discriminating .Draft without transition()
}
```

**Why the asymmetry?** Presence-discrimination (`is not` / `is some` / `given` / `match`) is already a first-class scrml primitive (§42); reusing it as the transition marker keeps the adopter mental model unified. A variant tag like `.Draft` is a positive shape — discriminating it proves the SOURCE variant but does NOT inherently prove the callee advanced the lifecycle. The explicit `transition()` call provides the per-access signal the type-system needs to gate post-transition field access.

### `transition()` semantics

- **Compile-time only.** Zero runtime cost; emitted as no code.
- **One argument** — an identifier binding whose type carries a lifecycle annotation.
- **Single transition per scope.** Subsequent calls on the same binding in the same scope are silent no-ops.
- **Scope-local.** Aliasing (`let b = a; transition(b)`) does NOT transition `a`.
- **Out-of-place use** — `transition()` on a value with no lifecycle annotation is silently no-op (no diagnostic). Keeps the keyword cheap to use defensively in generic helper code.

### Multi-variant chains `(A to B to C)` — RESERVED

The hybrid mechanism specifies the binary case. Multi-variant chains — `(.Draft to .Review to .Published)` — are RESERVED for a future SPEC amendment. A planned `markTransitioned(u, .Variant)` form (per HU-2 (d), explicitly NOT implemented at the v0.6.0 surface per pa.md Rule 3 YAGNI) would target a specific intermediate variant. Until that amendment lands, lifecycle annotations are restricted to two-state pre→post pairs; a three-token annotation is REJECTED by the type-system resolver.

### Cross-references

- §14.12 — normative spec (canonical home; promoted from §14.3 sub-content at S130)
- §6.2 (PRIMER) — Shape 1 plain reactive cells (the §6.2-shape position that receives the annotation)
- §7 (PRIMER) — engines (the engine-cell carve-out target)
- §42.2.3 — `given` presence-guard (form 1 of presence-progression discrimination)
- `compiler/src/type-system.ts:1444` — Landing 1 per-access tracker (S130 `1feaedc9`)
- `bun scrml migrate --lifecycle` is NOT yet a CLI verb; `->` → `to` migration is manual during the deprecation window.

---

## §7 Engines (Tier 2) — the centerpiece (§51)

Engines are the v0.next centerpiece. Singleton-by-design (one declaration mounts the singleton; cross-file mount via `<EngineName/>`). Components are the multi-instance vehicle (Move 20 — components and engines are distinct, do not collapse).

**The engine-singleton IS scrml's typed global reactive store (S178 — DD1 Fork 2 = 2A+2B).** A cross-file `<EngineName/>` mounts the SAME singleton everywhere, and a component **ambient-reads** its auto-cell via `@cellName` from the enclosing scope (a live reactive subscription per §15.13.4 — compiler-proven: emits `_scrml_effect(() => …_scrml_reactive_get("var"))`). So genuinely-shared reactive state is modeled as an engine; scrml ships NO free-shaped global store (Svelte-stores/Riverpod pole) by design — explicit-data-flow + typed-engine-singleton is the *final* shared-state model. `E-COMPONENT-ENGINE-SCOPE` bans a component *declaring* an engine, NOT *reading* one. See SPEC §51.0.A S178 amendment.

```scrml
type Phase:enum = { Idle, Loading, Error(msg: string), Empty, Success(count: int) }

function load() {
    @phase = .Loading
    const result = fetchItems() !{
        | ::Network msg :> { @phase = .Error(msg); return }
        | ::Empty       :> { @phase = .Empty;       return }
    }
    @phase = .Success(result.length)
}

<engine for=Phase initial=.Idle>

    <Idle rule=.Loading>
        <button onclick=load()>Load</button>
    </>

    <Loading rule=(.Success | .Error | .Empty)>
        Loading...
    </>

    <Error msg rule=.Loading>
        <div>${msg}</div>
        <button onclick=${@phase = .Loading}>Retry</button>
    </>

    <Empty>
        No rows yet.
    </>

    <Success count>
        Got it: ${count} rows
    </>

    <onTransition from=.Loading to=.Success>
        ${ analytics.track("load.success") }
    </>

</>
```

Key engine concepts:
- **Auto-declared engine variable** — first `<engine for=Phase>` in a scope auto-declares `<phase>` (lowercase first-letter of type, Move 16). Manual override via `var=<name>`.
- **Mount position = decl position.** Same-file decl-IS-mount; `<EngineName/>` for cross-file mount of a shared singleton.
- **`initial=`** required (W-ENGINE-INITIAL-MISSING lint defaults to first variant if omitted; forbidden on derived engines).
- **`rule=` declares legal transitions FROM the state-child** per §51.0.F. **Three target-only forms:** single-target `rule=.NextVariant`, multi-target `rule=(.A | .B | .C)`, wildcard `rule=*` (escape hatch — loses static guarantees). The arrow form `rule="event -> Variant"` is **legacy `<machine>` syntax** (§51.3) and `<machine>` is REMOVED (see below); `<engine>` does NOT use it.
- **Transitions are direct writes (`@phase = .X`) or `.advance(.X)`** per §51.0.F + §51.0.G. The `rule=` contract is enforced compile-time when from-state is statically known (inside a state-child body) and runtime otherwise. `E-ENGINE-INVALID-TRANSITION` fires on writes that violate the rule= set. `.advance(.X)` is the loud-failure variant; direct write is the canonical quiet-validation path. (`.tryAdvance` was rejected at S55 deliberation — silent failures hide bugs.)
- **`<onTransition from=A to=B>`** for cross-state effects (analytics, cleanup). Multiple `<onTransition>` children supported per state-child for multi-target rules.
- **`effect=` attribute** on a state-child for inline per-rule effects (single-target only — `E-ENGINE-EFFECT-AMBIGUOUS` on multi-target).
- **Boot-only opener `effect=`** (S148, §51.0.H Form 3 — Insight 33 Fork C1) — `effect=` on the `<engine>` OPENER runs ONCE at module-init as the effect of the implicit init→`initial=` edge (Elm `init`+`Cmd`; the canonical "load on boot" form). Boot-only — no re-fire on later re-entry into `initial=`. Writes inside are compile-checked against `.<initial>.rule` (from-state is statically the initial variant). It is a DISTINCT slot from the state-child `effect=` above. A throw escaping the boot effect is NOT caught by `<errorBoundary>` (it's init-time logic, not render): route `!` failures through the effect's own `!{}` into the engine's error variant; a non-`!` host throw goes to the §19.6.8 backstop. Forbidden on `derived=` engines (`E-ENGINE-EFFECT-ON-DERIVED`). **This is scrml's answer to "on-initial-mount" — NOT a self-target `<onTransition to=.SameState>` (a hard error) and NOT a new `<onEnter>` element (held pending a witnessed on-enter-from-any-source need).**
- **Derived engines** — `<engine for=Phase derived=expr>` reactively recomputes the variant; no rules, no writes (`E-DERIVED-ENGINE-NO-WRITE`); no `initial=` (`E-DERIVED-ENGINE-NO-INITIAL`); opener `effect=` forbidden (`E-ENGINE-EFFECT-ON-DERIVED`).
- **Components are NOT engines** — a component-instance with internal state is fresh per instance; an engine is one app-lifecycle singleton (`E-COMPONENT-ENGINE-SCOPE`).
- **`<machine>` is REMOVED (S305 ruled · S307 landed) — it is not a deprecated alias, it does not compile.** `<machine>` emits **`E-DEPRECATED-001`** (severity **Error**, §51.0.L / §63.7), fired from TAB (`ast-builder.js:16839`). Retired at the same time: `W-DEPRECATED-001` and `E-ENGINE-003` (both struck in §34). **Removed BEFORE 1.0 rather than at a MAJOR** because §63.3(2) protects a *released* contract and 1.0 is the first — striking it decided what 1.0 CONTAINS. Corpus migration measured zero; the §63.4 codemod gate was satisfied by execution.
  - **It still PARSES, deliberately (§63.5).** The parser accepts the keyword and still builds the `engine-decl` so a `<machine>` source reports exactly ONE diagnostic naming the migration instead of a cascade from an unbuilt node. **If you grep the parser for `machine` you will find live code — that is why.**
  - **`bun scrml migrate` rewrites three things, not one:** the opener, the `</machine>` closer, and the **§51.9 projection body** into §51.0.J `derived=match`. That third rewrite is load-bearing — a blind keyword swap silently changes behaviour, because `<machine derived=@x>` + a rules body compiles a real MAPPING function while `<engine derived=@x>` is an IDENTITY projection that drops the body. The migration fails CLOSED on any body line it cannot parse.
  - **The two subsystems `<machine>` fronted were PORTED, not retired** (S307): §51.11 `audit` and §51.13 auto-generated property tests both run on the modern `<engine>` state-child form.
  - **Legacy temporal / event-arrow `rule=` grammar:** S67 brought temporal transitions into `<engine>` via `<onTimeout>` (§51.0.M); see §7.1. The legacy event-arrow + predicate `rule=` bodies (§51.3) are reachable only through `migrate`.
- **Engine state-child bodies render reactively (S78, Phase A10).** Each state-child body is walkable AST (markup, text, `${@cell}` interpolations, event handlers, payload bindings). At compile time the engine emits per-arm render functions + a dispatcher subscribed to the engine variable; on each variant change the dispatcher writes the matching arm's HTML into a `<div data-scrml-engine-mount="<varName>">` slot. Initial-arm body lands in the static HTML at module init so file-level reactive-wiring binds correctly. Tree-shake invariant: engines with all-empty bodies emit zero render code. v1 limitations: in-place reactive `${@cell}` interp inside non-initial arm bodies isn't re-wired across variant changes (rendered HTML IS correct on each change; only subscription-driven updates within a non-initial arm are not auto-refreshed); delegable events (click, submit) work fine across variant changes. See `compiler/src/codegen/emit-variant-guard.ts` for the factored helper (variant-source-agnostic; future match-block-form codegen reuses it).

### §7.1 S67 amendments — hierarchy, history, internal/external, onTimeout

**Status:** SPEC LANDED at S68 (this section reflects A5-1). A5-4 + A5-5 codegen SHIPPED at S77 2026-05-10 (`<onTimeout>` + computed-delay across both surfaces). Other A5 sub-steps still pending Phase A7 dispatch (~50-80h). Surface summary for PA navigation:

- **`<onTimeout after=DURATION to=.Variant [name=IDENT]/>`** (§51.0.M; `name=` per §51.0.M.1 S79) — engine temporal surface, parallel to `<onTransition>`. Self-closing. `to=` validated strict-by-default against surrounding state-child's `rule=` (must be in set OR rule=*). Reset-on-reentry per §51.12.4. Multiple per state-child legal. Rides §51.12 runtime backbone (`_scrml_machine_arm_timer` / `_scrml_machine_clear_timer`). E-STRUCTURAL-ELEMENT-MISPLACED outside engine state-child. **A5-4 codegen SHIPPED at S77 2026-05-10** — engine-side per-state timer-config table emitted as `__scrml_engine_<varName>_timers` (sibling to transitions table); arm-on-entry + clear-on-exit threaded through `_scrml_engine_direct_set` + `_scrml_engine_advance` (4th-arg `timersTable`); initial-arm at module-init (after reactive wiring so computed-form `${@var}<unit>` reads land); tree-shake when zero `<onTimeout>` per engine. **A5-6 Feature 1 SHIPPED at S79 2026-05-10** — optional `name=IDENT` attribute (must match `/^[A-Za-z_][A-Za-z0-9_]*$/`; E-TIMER-NAME-INVALID + E-TIMER-NAME-DUPLICATE on misuse). Named timers use composite key `<varName>::<stateName>::n:<name>` instead of index suffix; anonymous timers keep index keying. The `cancelTimer("name")` builtin — recognized in event-handler call-ref attributes inside arm bodies — lowers to `_scrml_engine_clear_named_timer("<varName>", "<armTag>", "<name>")` using the static (varName, armTag) from Phase A10's arm context. v1 limitation: only call-ref event-handler form supported (`onclick=cancelTimer("X")`); expression-form (`onclick=${cancelTimer("X")}`) and function-body calls fall through to ordinary emission and runtime-fail with `cancelTimer is not defined`. Names are scope-local to the state-child; unknown names are runtime no-ops (matches `clearTimeout(undefined)` browser semantics).

- **`<onIdle after=DURATION to=.Variant/>`** (§51.0.R, S77 amendment) — engine-WIDE event-timeout watchdog (distinct from `<onTimeout>` which is per-state). Self-closing. Engine-root scope only (E-IDLE-MISPLACED inside state-child body). `to=` strict-validated against engine's `for=` enum (E-IDLE-INVALID-VARIANT). One per engine maximum (E-IDLE-DUPLICATE). Armed at module-init; **RESET on every successful transition** (any `_scrml_engine_direct_set`/`_scrml_engine_advance` commit); fires after N ms of silence. Rule=-honoring fire (sub-A1) — the watchdog write goes through the same write path as a direct write, subject to current state's `rule=` validation. **A5-6 SHIPPED at S77 2026-05-10** — per-engine watchdog config emitted as `__scrml_engine_<varName>_idle` (sibling to transitions/timers tables); 5th-arg `idleEntry` threaded through write-guard call sites; reset called on successful commit; tree-shake when no `<onIdle>` per engine. Computed-delay `${expr}<unit>` works (rides parseAfterDuration helper).

- **Computed-delay form** (§51.12.3.1) — `after=${expr}<unit>` accepts any non-negative-number expression. Applies to `<onTimeout>` (engine); it also covered the legacy `<machine>` `.From after duration => .To` form, which is now reachable only through `bun scrml migrate` (`<machine>` REMOVED — see §7). Static literals retain constant-fold path. **A5-5 codegen SHIPPED at S77 2026-05-10** for the engine `<onTimeout>` surface (msExpr arrow-fn in the timer-config table; runtime applies negative/NaN→0 clamp + Math.round). **A5-5b SHIPPED S77** closing the legacy-machine surface — the body-parser bug was a one-line fix at ast-builder.js's `rulesRaw` concat (spurious `\n` between children fragmenting `${...}` substrings); both surfaces now end-to-end with bit-identical runtime semantics. Computed-form rules opt out of JSON-encoded chained auto-rearm per §51.12.4 S77 amendment (single-step computed transitions arm correctly at module-init via per-rule inline arms; multi-step computed→computed chains require user-driven writes).

- **Hierarchy / nested `<engine>`** (§51.0.Q.1) — engines may be declared inside an outer engine's state-child body. Such state-children are **composite state-children**. Inner engine has full engine semantics (own `for=`, `initial=`, state-children). Lifecycle coupled to outer state-child (init on entry, suspend on exit). Singleton invariant preserved: outer × 1 = 1 inner instance. Permitted by Machine Cohesion footnote (§51.0.K) — singleton invariant articulated; OQ-Harel-8 verdict: `<engine>` everywhere (no `<region>` keyword).

- **Parent-rule cascade dispatch** (§51.0.Q.2) — writes to outer-engine variable from inside the composite are validated against the composite outer state-child's `rule=` (standard §51.0.F mechanic; just applied per-variable). Writes to inner-engine variable from inside inner state-children validated against inner state-child's `rule=`. No new dispatch primitive — "cascade" is conceptual framing for which `rule=` contract governs which variable's writes from which scope.

- **`history` attribute** (§51.0.N) — bare attribute on a composite state-child. Compiler synthesizes reactive cell `@_<outerVar>_<variant>_history`; written on outer-exit, read on outer-re-entry. Shallow only this revision (deep deferred per OQ-Harel-4). **Tree-shakeable** — synth cell + hooks elided when zero engines declare `history`. Target syntax: `.Variant.history` is a structured-variant-target form, usable as `rule=.Playing.history` or `@phase = .Playing.history` to mean "transition to .Playing AND restore inner from history" (vs bare `.Playing` which starts inner at `initial=`). Empty-history fallback: equivalent to bare `.Variant`. E-HISTORY-NO-INNER-ENGINE if attribute appears on a non-composite state-child.

- **`internal:rule=` prefix** (§51.0.O) — alternative to canonical `rule=` on composite state-children. Same three target-only forms. Internal transition does NOT exit/re-enter the composite (inner-engine lifecycle preserved; no history-write/read; composite's `<onTransition>` handlers don't fire). Default (no prefix) is external. Both `internal:rule=` and `rule=` may coexist on the same composite — different semantics. E-INTERNAL-RULE-NOT-COMPOSITE on non-composite state-children.

- **Machine Cohesion sharpening footnote** (§51.0.K, S67) — singleton invariant articulated explicitly. Engines MAY be declared at file scope OR inside another engine's state-child body. MAY NOT be declared in component bodies (E-COMPONENT-ENGINE-SCOPE), function/snippet bodies. Cross-file engine import (`<EngineName/>`) applies only to file-scope engines. Pillar 5 (no per-kind mini-DSLs) + tooling-uniformity (CLI promotion / migration stays context-blind) are the load-bearing reasons a separate keyword (`<region>`/`<sub-engine>`) was rejected.

**OQ-Harel-1 through OQ-Harel-7** are spec-authoring details bundled in §51.0.Q (entry/exit order; reset-vs-history on outer exit; parallel activation; deep vs shallow history; grammar disambiguation; cascade-miss diagnostic; temporal in hierarchy). Most resolved during A5-1 spec writing; OQ-Harel-1 (entry/exit order) deferred to A5-2/A5-3 implementation.

**OQ-Harel-8** RESOLVED 2026-05-07 → `<engine>` everywhere; Machine Cohesion sharpened.

---

## §8 Validators + auto-synthesized validity surface (§55)

Compound state with validators auto-synthesizes a reactive validity surface at TWO levels — compound rollup AND per-field — both reactive, both read-only.

```scrml
<signup>
    <name  req length(>=2)>           = <input type="text"/>
    <email req email>                 = <input type="email"/>
    <agree req>                       = <input type="checkbox"/>
    const <displayName> = @signup.name.toUpperCase()
</>

// Auto-synthesized (read-only):
//   @signup.isValid       boolean rollup
//   @signup.errors        compound-level errors array
//   @signup.touched       any field touched yet?
//   @signup.submitted     was first submit attempted?
//   @signup.name.isValid  per-field
//   @signup.name.errors   per-field (enum tags from ValidationError, NOT strings)
//   @signup.name.touched  first interaction
//   @signup.email.isValid ...
```

**Universal-core predicate vocabulary** (§55.1) — 14 predicates; same word at compile site and runtime:

`req`, `is some` (existence-check; `not` is scrml's sole absence value), `length(<rel-arg>)`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`.

**(S66 correction):** earlier primer drafts listed `email`, `url`, `numeric`, `integer`, `custom` here. **Those are NOT universal-core predicates.** `email`/`url`/`numeric`/`integer` are stdlib `scrml:data` library predicate-builders (separate surface; see §10). `custom` is the ValidationError tag at SPEC §55.9 line 24532 ("for developer-defined custom validators (Edge G)") — a tag-level escape hatch for application-defined predicates, NOT a universal-core predicate. The 14 above are the SPEC §55.1 catalog verbatim. Audit at `scrml-support/archive/audits/a1c-roadmap-rule4-audit-2026-05-07.md` §1.1 documents the drift + correction. Per pa.md Rule 4: spec wins.

**Errors are enum tags, not strings.** `@signup.name.errors[0]` is `.Required` or `.LengthFailed(predicate)` — consumers pattern-match on the tag. The `ValidationError` enum at SPEC §55.9 has tag-per-predicate (`Required`, `NotSome`, `LengthFailed(predicate)`, `PatternMismatch(re)`, `MinFailed(threshold)`, `MaxFailed(threshold)`, `GtFailed(expected)`, `LtFailed(expected)`, `GteFailed(expected)`, `LteFailed(expected)`, `EqFailed(expected)`, `NeqFailed(forbidden)`, `OneOfFailed(set)`, `NotInFailed(set)`, `Custom(tag: string)`).

**4-level error message resolution chain** (§55.5, L12):
1. Inline on decl (`<name req("Please enter your name")>` — trailing string-literal ARG inside the validator parens, §55.10-normative; the colon form `req:"…"` is NOT valid scrml)
2. Project-registered (a project-level message catalog)
3. `scrml:data` defaults (English)
4. Match escape hatch (`<match for=ValidationError>`)

**`<errors of=expr/>`** first-class element renders errors per-cell or rollup. `all` attribute toggles full-array vs first-error rendering.

**Cross-field validation** via predicate args with cross-cell expressions: `<confirm req eq(@signup.password)>` — no separate vocabulary. (L14.)

**Validators on derived cells** are forbidden (`E-DERIVED-WITH-VALIDATORS`); use refinement-type predicates at the type level instead.

---

## §9 Channels, schema, predicates, `not` keyword (Stage 0b D3 — LANDED S58)

D3 landed S58 — `compiler/SPEC.md` §38 / §39 / §42 / §53 / §34 are now authoritative.

### §9.1 Channels (§38) — inside `<program>` (Insight 30, S87), V5-strict, no `@shared`

```scrml
<program>

  <channel name="chat" topic="lobby">
    <messages> = []                                    // V5-strict — auto-syncs across clients
    ${ function postMessage(author, body) {
        @messages = [...@messages, { author, body, ts: Date.now() }]
    } }
  </>

  ${ const count = @messages.length }                  // cross-scope canonical access
</>
```

- Channels live as **CHILDREN of the entry-file `<program>`** (sibling of `<page>` declarations) — Insight 30 placement reversal ratified S87 (`scrml-support/design-insights.md`). `E-CHANNEL-OUTSIDE-PROGRAM` if at file top in a file that declares `<program>`; `E-CHANNEL-INSIDE-PAGE` if nested inside an individual `<page>`.
- **Pure-channel module files** (no `<program>` in the file) MAY declare `<channel>` at file top — the "pure channel file" sharing pattern, §38.12.6.
- `@shared` modifier is **REMOVED** in v0.next. `E-CHANNEL-SHARED-MODIFIER`. Auto-sync comes from being inside the channel body, not from a modifier.
- Channel body uses **V5-strict** (§6). `<x> = init` declares a channel-scoped reactive cell auto-synced across subscribed clients.
- Auto-creates WS endpoint `/_scrml_ws/<name>`; `topic=` defaults to `name`.
- Auto-injected in server functions: `broadcast(data)`, `disconnect()`.
- Channel-declared cells reachable from elsewhere in `<program>` via canonical `@cellName` access — program-scope visible.
- Handler attribute params (`onserver:message=handler(msg)`) — `msg` is a function-local LOCAL, accessed bare. V5-strict locals semantic; not state.

### §9.2 Schema (§39) — SQL-mirror canonical + additive shared-core (L4)

```scrml
<schema>
  users {
    email: text not null unique          // SQL-mirror native — canonical source-level
    name:  text req length(>=2)          // shared-core additive — req lowers to NOT NULL
    age:   integer min(18) max(120)      // shared-core additive — lowers to CHECK constraints
  }
</>
```

- SQL-mirror (`not null`, `unique`, `references table(col)`, `default(literal)`, `primary key`) remains **canonical**.
- Shared-core (`req`, `length`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`) is **additive**. Both forms legal; mixed is legal.
- Lowering rules (§39.5.8): `req → NOT NULL`; `length(>=N) → CHECK (length(col) >= N)`; `pattern(re) → CHECK (col REGEXP …)` driver-dependent (Postgres `~`, SQLite/MySQL `REGEXP`); `min/max/gt/lt/gte/lte/eq/neq → CHECK`; `oneOf([...]) → CHECK (col IN (...))`.
- **Inviolable:** SQL strings sent to the database are unchanged in shape. Vocabulary unification touches scrml source-level only.
- Cross-locus consistency: same shared-core word fires in three contexts — state validator (§55, reactive), refinement type (§53, compile + boundary), schema column (here, DBMS-enforced).
- SQL passthrough (`?{}` blocks) remains **inviolable**.
- **Schema-to-migration-SQL diff lives in `compiler/src/schema-differ.js`** (~273 LOC). Compares desired (`<schema>` AST) vs actual (`PRAGMA table_info()` output); emits migration SQL. Live during dev-mode reload. The diff algorithm is invisible at the §39 spec level — when dispatching schema-evolution work, read schema-differ.js directly.

### §9.3 Predicates (§53) — refinement-type cross-ref (L4)

```scrml
<email>: string(pattern(/^[^@]+@[^@]+$/)) req = <input type="email"/>
//        ────── refinement type (compile-time + runtime boundary)
//                                              ── state validator (reactive form-validity)
```

- Shared-core vocabulary appears in refinement types as predicates on type annotations.
- Firing semantics: compile-time + runtime boundary check. A non-conforming value cannot inhabit the type. **Stronger** than state validators (runtime-only-reactive) and schema constraints (DBMS-enforced).
- Type predicate + state validator stack as **independent enforcement layers**. They compose cleanly.

### §9.4 `is some` vs `req` (§42.2.5) — distinct predicates (L5)

| Predicate | Semantics | `""` (empty string) |
|---|---|---|
| `is some` | value EXISTS (`not` fails) | TRUE — empty string IS some value |
| `req` | value is NON-EMPTY / MEANINGFUL | FALSE — empty string fails req |

Both predicates exist; both are needed; they coexist in the validator vocabulary. **Three native loci** of "exists/required" semantic across scrml: schema SQL-mirror (`not null`), state validator (`req` and/or `is some`), refinement type (predicate form). Each fires in its layer's enforcement context — not redundancy.

**Advanced `not` forms** (§42.2.3 / §42 union form / §42.1.1 — S135 cluster N catch-up, F-045):

- **`given x :> …` presence-guard** — the canonical narrow-to-present form. `given x :> @x.name` is type-equivalent to `if (@x is some) @x.name` but the bound `x` is narrowed to the non-`not` type within the body. Reach for `given` when you need to USE the value; reach for `if (x is some)` when you only need to BRANCH.
- **`T | not` union form** — the canonical type for absence-possible values. A server fn returning `User | not` cleanly composes with the §6.8.3 reset × lifecycle semantic. The compiler wire-format envelope (§57) round-trips `not` losslessly.
- **`""` / `0` / `false` / `[]` / `{}` are DEFINED values, NOT absence** (§42.1.1, S89 ratification). `is some "" → TRUE`; `req "" → FALSE`. Don't conflate "empty" with "absent" — they're distinct concepts in scrml.

### §9.5 `not` keyword

(Move 11 — pinned-style modifier on imports / decls for opt-out semantics. Existing §42 content retained.)

### §9.5.1 Word-form boolean operators — `or` / `and` (S136 R24-BUG-1 ratification)

**Added 2026-05-27 (S136).** scrml accepts BOTH word-form (`or` / `and`) AND symbol-form (`||` / `&&`) for logical OR / AND. Both forms produce bit-identical emitted JS at codegen; the compiler lowers word-form to symbol-form at the JS-host boundary. Either is canonical; the compiler emits no warning or lint on either choice. Mixed-form expressions (`a or b && c`) are legal — precedence follows JS standard (`&&` / `and` bind tighter than `||` / `or`).

**Adopter signal:** R24 gauntlet showed 2 of 4 dev personas instinctively reached for word-form in derived-cell filter expressions; SPEC was silent on whether it was valid. User ratified word-form as canonical per option (i) — adopter signal + zero-friction fix (the rewrite pass mirrors the `not` precedent). SPEC §45.9 carries the normative text.

**NOT a parallel to `not`:** `not` is the absence VALUE, not a logical-NOT operator. `not` ≠ `!`. The word-form aliases here are for boolean OR / AND specifically; logical negation stays `!` (JS-host) — there is NO word-form alias for `!`.

**Accepted trade-offs** (mirror the `not` rewrite precedent):
- `obj . or` (whitespace-separated property access) breaks.
- `let and = 5` / `let or = 5` (valid JS identifier shadowing operator-keyword) breaks.

Both are zero in current corpus. If adopters report friction, extend lookbehind / keyword-context-exclusion list; not warranted preemptively.

### §9.6 D4 — small-edit threading + cross-file imports + structural elements registry

D4 (S58 close) threaded the locks/moves across the smaller spec sections. Highlights worth knowing:

- **Cross-file engine import** (§21.8, M18). `import { MarioMachine } from './engines.scrml'` then mount via `<MarioMachine/>` at use-sites. Singleton semantics across all use-sites in the importer's file. `pinned` legal on imports: `import { MarioMachine pinned } from './engines.scrml'`.
- **Components vs engines** (§15.13.5, M20). Singleton-by-design (`<engine>`) ≠ multi-instance (component). Component bodies cannot instantiate an engine — `E-COMPONENT-ENGINE-SCOPE`.
- **Structural elements registry** (§4 + §24). `<engine>`, `<match>`, `<errors>`, `<onTransition>`, `<onTimeout>` (§51.0.M, S77), `<onIdle>` (§51.0.R, S77), `<channel>` (§38), `<page>` (§4.15, S85), `<auth>` (§40.1, S91) are scrml-defined structural elements (NOT HTML). `E-STRUCTURAL-ELEMENT-MISPLACED` if used in unsupported contexts.
- **Bare-variant inference** (§14.10, M9). When LHS or parameter type is statically known, the variant qualifier may be omitted: `<phase>: Phase = .Idle` not `Phase.Idle`. Union-typed contexts → ambiguous → require qualification.
- **`:`-shorthand body** (§4.14, M15; **S160 — inside-opener canonical EVERYWHERE**). Single-expression body INSIDE the opener: `<Idle : startGame()>`. Whitespace mandatory BEFORE `:`; after-`:` is **OPTIONAL** (S160 ruling (b) — `<span :@thing>` legal). The legacy after-`>` placement (`<Idle> : startGame()`) is **DEPRECATED** (`W-COLON-SHORTHAND-LEGACY-PLACEMENT`, §34).
- **Multi-statement handler restriction** (§5.2.3, L19). Inline event handlers may be a bare call, bare assignment, or bare single expression. Multi-statement handlers force a named function. `E-MULTI-STATEMENT-HANDLER`.
- **`scrml:data` `registerMessages`** (§41.12, L12). `data.registerMessages({.ErrorTag: (field, ...args) => string, ...})` — project-wide once-at-boot for i18n + brand-voice. The "project-registered" tier of the 4-level error message chain.
- **+7 error codes** added in §34 (D4 Tier 9 consolidation): `E-CLOSER-001`, `E-NAME-COLLIDES-RESERVED`, `E-STRUCTURAL-ELEMENT-MISPLACED`, `E-MULTI-STATEMENT-HANDLER`, `E-IMPORT-PINNED-INVALID`, `E-DERIVED-CIRCULAR-DEP`, `E-USE-INVALID-CTX`.

### §9.7 Approach A — closure analysis + per-route artifact splitter (S88-S92)

The v0.3.0 critical-path investment. Five sub-waves, ALL CLOSED end-to-end:

- **A-1 markup-context edges** (S88) — per-interpolation source nodes in the dependency graph (Option Y per S88 user override of PA recommendation Option X — Rule-2 fidelity); ceiling re-measurement 2.04x corpus baseline (523 nodes vs 256 ceiling)
- **A-2 Reachability Solver** (S89-S91) — 5 reachability components: entry-point closure (Component 1) + reactive-dep-closure (Component 2) + server-fn-reachable-within (Component 3, bounded BFS N=0/1/2 per OQ-A2-B Option a) + auth-gated-boundaries (Component 4, runtime-fallback admission per OQ-A2-I) + vendor-units (Component 5, file-scoped attribution per opacity rule). Plus A-2.7 outer fixpoint operator + A-2.8 canonical JSON serialization (§40.9.8)
- **A-3 §40 AuthGraph** (S91) — 5 sub-phases: enumerator + role-enum resolution (OQ-A3-F (b)+(c) dual rule) + per-gate classifier (OQ-A3-A user override S91: full interpolation grammar) + redirect cross-ref (OQ-A3-B (a) bare-string) + pipeline wire-in at api.js Stage 7.55. §40.9.9 worked-example 13-test integration replay
- **A-4 Per-Route Artifact Splitter** (S91) — 7 sub-phases: orchestrator + initial_chunk JS payload + atom-emitter + tier-1 idle-prefetch + tier-2 hover-prefetch (`data-scrml-prefetch` markup attribute) + tier-N on-demand dispatch + §47 FNV-1a content-addressing + per-route HTML augmentation + role-detection bootstrap + chunk-side runtime helpers (`_scrml_chunk_mount` + `_scrml_vendor_require`)
- **A-5 Integration Tests** (S92) — 5 sub-phases: A-5.1 multi-page multi-role cornerstone (FX-1) + A-5.2 cross-file expansion (FX-2 Form 2 export-const-component) + A-5.3 negative cascades (FX-3 + FX-4) + A-5.4 W-* lint family e2e (FX-5/6/7/8a/8b; verifies Q-OPEN-6 split + Q-OPEN-5 plumbing) + A-5.5 determinism + trucking-dispatch compile-smoke + §40.9.9 case-fix verification + A-5.1 cornerstone false-negative audit-fix bundled

**`<auth role="X">` first-class element (A-3, §40.1).** Compile-time visibility constraint, NOT a runtime check. Universal value-bearing-attr shape: string literal (`role="Admin"`), variable ref (`role=@currentRole`), or `${expr}` (per OQ-A3-A user override S91 — *"the idea that user defined state has full interpolation but first class compiler supported state doesn't is confusing, counter intuitive, and hints that the language is still in a 'toy' status"*). Closed-form predicates (variant literals + literal comma-OR + const-refs to role-set values + boolean composition of statically-known operands) ship per-role bundles. Runtime-fallback predicates (reactive reads, async server-fn calls, arbitrary expressions) emit `W-AUTH-RUNTIME-FALLBACK` (info-level lint) and ship the gated component eagerly per §40.9.5.

**Per-route per-role chunk variance (A-4).** Per (entry-point, role, tier) the route-splitter emits a content-addressed chunk descriptor. Anonymous visitors download a strictly smaller initial bundle than admins because the gated subtree's atoms aren't in their per-role chunk. Tiered prefetching: tier-1 idle-prefetch fires on `requestIdleCallback` via `_scrml_prefetch_tier1`; tier-2 hover-prefetch fires on hover via `data-scrml-prefetch` markup attribute (`_scrml_prefetch_tier2`); tier-N on-demand pulls when navigation actually fires.

**Content-addressing (A-4.6, §47).** Every chunk filename embeds the lower-32-bit FNV-1a hash of the chunk's normalized canonical string, lowercase base36, zero-padded to 8 characters. Adopter caches stay valid across builds when source bytes don't change. The `compiler` field of `chunks.json` manifest is sourced from `package.json` `version` (Q-OPEN-4 ratification S92 — single source of truth; informational only, NOT a hash input per §40.9.8). pkg.json bumped to `0.3.0-alpha.0` (S92).

**Diagnostic family (8 W-* + 3 E-* + 1 I-*).** Surface for shapes that defeat or activate the analysis:

| Code | Severity | Fires when |
|---|---|---|
| `W-CG-CHUNK-EMPTY` | Warning | A route's initial chunk has no atoms (placeholder body) |
| `W-CG-CHUNK-LARGE` | Warning | Initial chunk exceeds size budget (configurable via `--chunk-size-budget`, Q-OPEN-5 S92) |
| `W-CG-CHUNK-NO-PREFETCH` | Info | Page has no internal `<a href>` links (genuine no-prefetch case; severity narrowed at Q-OPEN-6 split S92) |
| `W-CG-CHUNK-PREFETCH-UNRESOLVED` | Warning | Page has internal links but none resolve to RouteMap.pages (typo / missing page; NEW at Q-OPEN-6 split S92) |
| `W-CG-CHUNK-MISSING-ROLE` | Warning | Source-cited role NOT in chunk's emittedRoles (typo'd / unresolved role enum) |
| `W-CG-UNDEFINED-INTERPOLATION` | Warning | Codegen interpolation site would emit literal `"undefined"` to wire format (post-M-7C-D-12 S90 regression-guard) |
| `W-AUTH-RUNTIME-FALLBACK` | Info | A gate predicate isn't closed-form; gated component shipped eagerly with runtime gate |
| `W-AUTH-PAGE-INFERRED` | Info | A `<page>` lacks explicit `auth=` under enclosing `<program auth=>`; inference applied |
| `W-AUTH-LOGIN-MISSING` | Warning | `<program auth="required">` set without explicit loginRedirect AND no `/login` page exists |
| `E-CLOSURE-001` | Error | RS outer fixpoint iteration-cap overflow (per §40.9.1) |
| `E-CLOSURE-002` | Error | RS Component 4 implicit-anonymous + auth-role-block (per OQ-A2-F) |
| `E-AUTH-GRAPH-002` | Error | AuthGraph: role enum required but ambiguous discovery (per A-3.2 OQ-A3-F) |
| `E-AUTH-GRAPH-003` | Error | AuthGraph: role variant not found in resolved enum (typo'd role) |
| `I-AUTH-REDIRECT-UNRESOLVED` | Info | A redirect cross-ref resolves to no known route in RouteMap |

**Pipeline integration.** AuthGraph fires at api.js Stage 7.55 between BP and RS (uses BP-resolved markup; produces input for RS Component 4 auth-gated-boundaries). RS Component 4 is the runtime-fallback admission point. Route-splitter fires at Stage 8 sub-emit consuming the ReachabilityRecord.

**api.js diagnostic stream partition (load-bearing for test authoring; updated S93).** `result.warnings` = `code.startsWith("W-") || code.startsWith("I-") || severity === "warning" || severity === "info"`. `result.errors` = everything else (fatal — E-* prefix, severity:"error", or unspecified). **Info-level (I-* prefix OR severity:"info") is non-fatal and partitions into `result.warnings`** per S93 fix — pre-S93 the partition treated info-level as fatal, which caused 07-admin-dashboard and 23-trucking-dispatch to exit non-zero on `I-AUTH-REDIRECT-UNRESOLVED` (the redirect-target-not-in-route-map info-lint). Formatter (commands/compile.js) distinguishes info-level (cyan "info" label) from canonical warnings (yellow "warning" label) by reading `severity` + prefix on the diagnostic. **A-5.1 cornerstone test originally used `result.errors.filter(e => e.code === "W-...")` for "does NOT fire" assertions — STRUCTURAL FALSE NEGATIVE; audit-fixed at A-5.5 (S92) via `allDiags(r) = [...r.errors, ...r.warnings]` cross-stream helper.** Post-S93 partition fix, info-level codes also land in `result.warnings` so the cross-stream helper covers the same shape. When authoring integration tests against W-/I- codes, USE the cross-stream helper.

**Gate on v0.3.0 cut.** Approach A close end-to-end (S88-S92) was the v0.3.0 critical-path investment. v0.3.0 cut blockers remaining: Wave 4.A adopter-content refresh (this primer's update is Phase 4 of that wave) + Wave 4.R (README + currency, Phase 5).

---

## §9.8 Scoped CSS — native `@scope`, no Tailwind required (SPEC §9.1 DQ-7 / §25.6)

scrml has first-class **scoped CSS** independent of Tailwind. A `#{...}` CSS block **inside a component** compiles to a native CSS `@scope` block keyed to the component — **class names are NOT mangled**, the emitted CSS is 1:1 human-readable, and styles do not leak into nested components (implicit **donut boundary**; no `:deep()` escape hatch needed).

```scrml
const Card = <div props={ label: string }>
    #{
        .card { padding: 16px; border: 1px solid #e5e7eb; }
        .card-title { font-weight: 600; }
    }
    <div class="card"><span class="card-title">${label}</span></div>
</div>
```

Emits (verified end-to-end, S214):

```css
@scope ([data-scrml="Card"]) to ([data-scrml]) {
    .card { padding: 16px; border: 1px solid #e5e7eb; }
    .card-title { font-weight: 600; }
}
```

…and the component root carries `data-scrml="Card"` (auto-injected — you never write it).

**The three `#{}` placements (SPEC §9.1):**
- **Inside a component** → wrapped in `@scope ([data-scrml="Name"]) to ([data-scrml])` (scoped, donut, no mangling).
- **Flat declarations** (bare `property: value;` only, no selectors) → inline `style=""` on the element; not in the `.css` file.
- **Program-level `#{}`** (top of `<program>`, no component) → global CSS, unwrapped.

Also available: `<style>` blocks (§9.2), plain `.css` files (§9.3), and **CSS variable syntax** (§25) — write `name = value` (compiles to `--name: value`) and `prop: name fallback` (compiles to `var(--name, fallback)`); the `--` / `var()` are compiler-generated. Tailwind utilities (§26) live OUTSIDE `@scope` and are never wrapped.

> **Currency note (S214).** SPEC §9.1 / §25.6 still use pre-v0.next "state type constructor" vocabulary + a stale worked example (manual lowercase `data-scrml="card"`); the live behavior is **component-keyed** with an **auto-injected** `data-scrml="Card"` (verified above). A SPEC §9/§25.6 currency pass is owed. **Known papercut:** `W-TAILWIND-UNRECOGNIZED-CLASS` false-fires on class names defined in your own in-scope `#{}` block (the lint only knows Tailwind utilities) — the lint should cross-reference in-scope `#{}`-defined selectors before warning.

---

## §10 stdlib — what's on the shelf (18 modules)

**Important:** stdlib modules are **import-only**, not standalone-compile targets. Don't try to compile `stdlib/<x>/index.scrml` directly — it's designed to be imported into a `<program>`.

**App-building primitives:**
- `scrml:auth` — `hashPassword`, `verifyPassword`, `generatePassword`, `signJwt`, `verifyJwt`, `decodeJwt`, `createRateLimiter`, TOTP (generate/verify)
- `scrml:oauth` (NEW S58) — OAuth 2.0 + PKCE (RFC 7636). Core: `startFlow`, `exchangeCode`, `refreshToken`, `getUserInfo`, `revoke`. PKCE: `generateVerifier`, `deriveChallenge`. Storage: `memoryAdapter()` (dev only); caller injects production adapter. Provider presets: `googleConfig` + `parseGoogleIdToken` (decode-only, no JWKS verify yet — v0.3.0), `githubConfig`, `microsoftConfig`, `discordConfig`. Typed errors caught by `err.name`: `OAuthStateMismatch`, `OAuthVerifierMissing`, `OAuthTokenError`, `OAuthUserInfoError`, `OAuthRevocationError`. **Deferred:** JWKS sig verification, OIDC discovery (RFC 8414).
- `scrml:data` — `validate(data, schema)`, `isValid`, `firstError`; predicate builders; transforms (`pick`, `omit`, `groupBy`, `sortBy`, `unique`, `flatten`, etc.) — vocabulary alignment task pending B3. **Set-algebra (S170 — "defer the set type, ship the helpers"):** `union(a, b)` / `intersection(a, b)` / `difference(a, b)` return plain arrays of value-DISTINCT elements (∪ / ∩ / ∖); `member(arr, x)` is value-safe membership (a bool). All are **value-correct for struct / enum / nested elements** — they key by the §59.5 value-canonical codec, so they agree with `==` (§45) and the §59 map key, where `Array.includes` / JS `Set` are reference-keyed and would be wrong. Each takes an optional `keyOrFn` 3rd arg mirroring `unique(array, keyOrFn)` (a field-name string or a projection fn; default keys by the full value-canonical string). No mutation; reassignment-canonical (`@x = union(@a, @b)`). **`unique` was also made struct-safe** in the same arc — its no-key path dedup'd by JS-`Set` reference identity (value-broken for structs); it now dedups by the value-canonical key. (As of **S222**, `set[K]` **IS** the value-native set type — landed §59.12 as the B2 map-alias; the `set[K]` `.union`/`.intersect`/`.difference` methods **delegate to THESE helpers**, so the array-level helpers remain the lowering target. SPEC §59.12.) **Plus (S65)** `parseVariant(json, EnumType)` — boundary-parsing primitive for tagged-variant JSON; FIRST general-position member of the type-as-argument feature family (cross-ref §13.6 + SPEC §41.13 + §53.14). Failure type `ParseError:enum` with variants `MissingDiscriminator`, `UnknownVariant(tag: string)`, `InvalidPayload(field: string, reason: string)`, `Malformed(reason: string)` — first stdlib-declared enum.
**Set idioms — the value-native `set[K]` type (landed S222, §59.12 B2 map-alias):**
- **Canonical: `set[K]`** — a thin desugar over the §59 value-native map (value-canonical, struct-correct, order-independent `==`; empty = the map's `[:]` — there is NO set literal, seed via `.add`):
  ```scrml
  <visited>: set[NodeId] = [:]
  @visited = @visited.add(n)                  // dedup-by-construction
  given seen = @visited.has(n) { /* present */ }   // or .remove(k), .size
  <both>: set[K] = ${ @a.union(@b) }          // .union / .intersect / .difference
  <each in=@visited.elements() as v> … </each>     // iterate the elements (the map keys)
  ```
  The patterns below remain valid as the **underlying mechanics** (set rides them) / when a typed cell is overkill:
- **Multi-select toggle** — Use an array + `.includes` for primitive ids (zero-friction, what the corpus already does):
  ```scrml
  <selectedIds>: integer[] = []
  // toggle:
  if (@selectedIds.includes(id)) { @selectedIds = @selectedIds.filter(x => x != id) }
  else { @selectedIds = [...@selectedIds, id] }
  ```
- **O(1) keyed membership over many keys** — use the §59 value-native map keyed to `bool`:
  ```scrml
  <seen>: [string: bool] = [:]
  @seen = @seen.insert(key, true)
  given _ = @seen[key] { /* present */ }      // or @seen.has(key)
  ```
- **Dedup a list** — `unique` (now struct-safe, §59.5-keyed):
  ```scrml
  <distinctTags>: string[] = ${ unique(@allTags) }
  ```
- **Set-algebra** — the `scrml:data` helpers (value-correct for structs):
  ```scrml
  ${ import { union, intersection, difference, member } from 'scrml:data' }
  <both>:    integer[] = ${ union(@listA, @listB) }          // ∪
  <common>:  integer[] = ${ intersection(@listA, @listB) }   // ∩
  <onlyA>:   integer[] = ${ difference(@listA, @listB) }     // ∖
  const have = member(@selectedRows, @row)                    // value-safe membership
  ```

- `scrml:router` — `match(pattern, path)`, `parseQuery`, `buildUrl`, `navigate`, `currentPath`, `onNavigate`
- `scrml:store` — `createStore`, `createSessionStore`, `createCounter` (KV / session via SQLite)

**Network + scheduling:**
- `scrml:http` — REST helpers (`get/post/put/del/patch`) + `withBaseUrl/withAuth/withDefaults`, `retry(fn, opts)`, `multipart`, `uploadFile`, `isOk`/`isError`. All async.
- `scrml:redis` — `get/set/setex/del/exists/expire/ttl/incr/decr`; sets `sadd/srem/sismember/smembers`; pub/sub `publish/subscribe/unsubscribe`; `createClient`, `send`, `close`. Bun.redis-backed.
- `scrml:cron` — `schedule(pattern, handler)` returns CronJob; `nextOccurrence`, `stop`. Bun.cron-backed (Bun ≥1.3.12).

**Crypto + format + patterns:**
- `scrml:crypto` — `hash`, `verifyHash`, `hmac`, `safeCompare`, `generateUUID`, `generateToken`
- `scrml:format` — `formatCurrency/Number/Percent/Bytes`, `slug`, `pluralize`, `titleCase`, `capitalize`, `toWords`, `truncate`, `padLeft/Right`, locale-aware Intl: `compactNumber`, `formatList`, `formatRange`, `formatNumberAdvanced`
- `scrml:time` — `formatDate/Time/DateTime/Relative/Duration`, `parseDate`, `isValidDate`, `startOf/addTime/diffTime`, `debounce/throttle/sleep`; timezone: `formatInTimezone`, `nowInTimezone`, `toTimezoneParts`, `tzOffset`; ISO: `formatISO`, `parseISO`; **`now()` — (S176, DD1 Fork 1 / 1C) capability-scoped wall clock** (`Date.now()` ms): non-deterministic → REJECTED in pure `fn`/`pure` bodies (E-FN-004, binding-aware — a user's own `function now()` is not gated), ALLOWED in `function`/`server function`. The sanctioned centralized clock touch. SPEC §41.19.
- `scrml:regex` — vetted `patterns` catalog (email, url, ipv4, uuid, slug, hexColor, semver, isoDate, phoneE164, usZip, etc.); helpers `test`, `match`, `extract`, `replace`, `escape`, `caseInsensitive`, `isValid(name, str)`
- `scrml:math` — **(S176, DD1 Fork 1 / 1A)** PURE scalar vocabulary: `round`, `floor`, `ceil`, `abs`, `min(...values)`, `max(...values)`, `clamp(value, min, max)`, `parseInt(str, radix=10)`, `parseFloat`, `toNumber`, `isNaN`. The sanctioned centralized host `Math.*`/`Number.*` touch. Every member is pure → CALLABLE in pure `fn` bodies (imports are fn-callable; no E-FN-003). Import-only (no ambient `Math`). Deliberately EXCLUDES `random()` (non-deterministic — its home is the capability-scoped `scrml:random`, §41.20). SPEC §41.18.
- `scrml:random` — **(DD1 Fork 1 follow-on)** capability-scoped NON-DETERMINISTIC random source: `random()` → float `[0, 1)`; `randomInt(min, max)` → integer in `[min, max]` **INCLUSIVE** (the fair-die / token-mint idiom, replaces `Math.floor(Math.random()*N)`). The sanctioned centralized `Math.random()` touch. Same capability class as the clock: non-deterministic → REJECTED in pure `fn`/`pure` bodies (E-FN-004, binding-aware — a user's own `function random()` is not gated), ALLOWED in `function`/`server function`. Import-only (no ambient random). SPEC §41.20.

**Wrappers:**
- `scrml:fs`, `scrml:path`, `scrml:process`, `scrml:test` — Node compat / test runner

**Distribution model (locked S57):** bundled-with-compiler, single-version, stdlib-version = compiler-version, no registry, no separate semver.

**Honesty positioning:** "kills ~88-90% of typical-app npm needs" (S58 lift after `scrml:oauth` lands). Real remaining gaps: JWKS / OIDC discovery (deferred); date-formatting beyond Intl; advanced HTTP middleware beyond what's bundled; some niche utility libs (lodash-equivalents). **(S176)** The scalar gap (raw `Math.*` / `parseInt` / `Number` reaches, ~95 corpus sites) is now closed by `scrml:math` (§41.18); the wall-clock reach is capability-scoped via `scrml:time.now()` (§41.19); the random-source reach is capability-scoped via `scrml:random` (§41.20).

**No generics** — scrml doesn't have type parameters. Recurring finding: per-domain enums + per-screen state-machine variants beat generic stdlib types like `AsyncPhase<T>` — naming the variants in app context produces better match blocks. The five-line "boilerplate" is five lines of useful domain spec.

---

## §11 Frequent anti-patterns (kickstarter §7, agent-trip-up list)

What LLMs reflexively reach for + the scrml form:

| Reflex | Why wrong | scrml form |
|---|---|---|
| `useState`, `ref`, `signal()` | scrml has no hook calls | `<x> = 0` declares; `@x` reads |
| `useEffect`, `watchEffect` | no effect hooks | Reactive `${...}` blocks; `<onTransition>` for engine effects |
| `try { ... } catch (e) { ... }` | not in scrml | `function f()! -> Err { fail Err::V(...) }` + `let x = f() !{ \| ::V → ... }` |
| `if (errors.length > 0)` | manual error checking | `@form.isValid` (auto-synth); `<errors of=@form.field/>` |
| `bcrypt.hash(pwd, 10)` | npm import | `import { hashPassword } from 'scrml:auth'` |
| `===`, `!==` | scrml is strict-by-default | `==`, `!=` (E-EQ-004) |
| `throw new Error(msg)` | not in scrml (§19) | `fail SomeErr::Variant(msg)` |
| `function reset() {}` (local) | `reset` is reserved | Use a different name; `reset(@cell)` is the keyword |
| Local var named after a state cell | shadows state | E-NAME-COLLIDES-STATE; rename the local |
| `<x>: SomeEnum = SomeEnum.Variant` | redundant prefix | `<x>: SomeEnum = .Variant` |
| `match` without exhaustiveness | scrml requires it at Tier 1+ | E-MATCH-NOT-EXHAUSTIVE; cover every variant or use `_` wildcard |
| Inline multi-statement event handler `onclick={ doA(); doB() }` | inline form is bare-call/bare-assignment/bare-single-expression only | E-MULTI-STATEMENT-HANDLER; extract to a named function and call it |
| Importing across files without `pinned` when forward-ref is needed | forward-references through imports require `pinned` to lift the cycle | E-IMPORT-PINNED-INVALID; add `pinned` modifier to the import |
| Engine instantiated inside a component body | components are multi-instance, engines are singleton — they don't compose | E-COMPONENT-ENGINE-SCOPE; declare the engine at file/program scope and mount via `<EngineName/>` |
| `@derivedArr.push(x)` / `@derivedObj.foo = x` on a `const`-derived cell | derived cells are value-immutable from the developer's perspective; the mutation would be silently clobbered next time upstream deps fire | E-DERIVED-VALUE-MUTATE (§6.6.18); mutate the upstream cell instead (`@items = [...@items, x]`) or declare a separate mutable cell |
| `if (@phase == .Idle) { ... } else if (@phase == .Loading) { ... }` over an enum-typed cell | works, but loses Tier-1 structural-exhaustiveness guarantees and forfeits future-variant-add catching at the discrimination site | I-MATCH-PROMOTABLE (§13.8, SPEC §56) info-level lint surfaces the opportunity; run `bun scrml promote --match <file>[:line]` to mechanically lift to `<match for=Type on=@phase> <Idle>...</> <Loading>...</> </>` |
| `items.map(...)` / `${ for (let x of @items) { lift <li/> } }` to render a list | the `for/lift` form is the valid Tier-0 iteration shape but reads as imperative logic; the Tier-1 structural form is more discoverable and composes with `<empty>` + inferred `key=` | `W-EACH-PROMOTABLE` (§6.3, SPEC §17.7 / §34) info-lint surfaces the opportunity; lift to `<each in=@items key=@.id>...</each>` (with `<empty>` for the zero-items case). `bun scrml promote --each` is the mechanical lift (SPEC §56.10) — **shipped S134**; auto-lifts bare-`@cell` iterables, hand-lift function-call/literal-array iterables (§56.10.2) |

---

## §12 Operational rules (orientation, not language)

- **Pre-commit hook** runs `bun test` (excluding browser). Never bypass with `--no-verify` without explicit user authorization. ~7,800-8,800 tests pass; 0 failures is the contract.
- **Cherry-pick + push protocol** — see pa.md §"Cross-machine sync hygiene" + §"wrap" definition.
- **Worktree path discipline** — agent dispatches with `isolation: "worktree"` may construct main-rooted paths from intake docs by mistake; brief must paste the absolute worktree path explicitly; agents must run `pwd` at startup.
- **Agent-file edits don't propagate mid-session** — if you edit `~/.claude/agents/<name>.md`, the change takes effect at the NEXT PA session, not the current one. Plan accordingly.
- **`scrml-js-codegen-engineer` tool set** (post S57; agent renamed from `scrml-dev-pipeline` per S133 DD — see pa.md "Code editing rules" canonical-dev-agent line): `Agent, Read, Write, Edit, Glob, Grep, Bash`. Default model `opus`. Edits to this file took effect S58+; before that, the agent's tools were limited and dispatches needed careful brief design.
- **SPEC.md size** (post-D4): **~24,382 lines / ~410k tokens**. Past the size where Read+Write full-file-overwrite is feasible; Edit's diff-form scales fine. Per-section split queued as v0.3.0+ candidate (see IMPLEMENTATION-ROADMAP.md §8.5).
- **PIPELINE.md size** (post-D4): ~2,380 lines (1,941 → 2,380; 22.6% rewrite). Per-stage v0.next addenda landed: TAB / NR / MOD / UVB / TS / DG / CG. Integration Failure Mode Catalog +11 v0.next entries. **Follow-up prose pass deferred** (IMPLEMENTATION-ROADMAP.md §8.6 #2) — addenda are stitched, not re-flowed; engineering content complete.
- **`const @x` → `const <x>` sweep DONE (S58)**. Two-phase cleanup: (a) §6 sweep (62 edits) replaced declarations within §6 itself; (b) follow-up cleanup across §11/§12/§22/§23/§34/§52 (13 more edits). SPEC.md now has zero `const @x` declarations. Canonical form `const <x> = expr` is universal. Read sites still use `@x` (canonical access).
- **`bun install` required in fresh worktrees**: pre-commit `bun test` fails with "cannot find package 'acorn'" in newly-spawned worktrees because node_modules doesn't inherit from main. Hit by every D2.8/D3/oauth/D4 dispatch this session. Workaround: `bun install` once at worktree startup. Worth a pa.md F4 addendum or a worktree-setup hook (deferred).
- **`bun run pretest` required in fresh worktrees** (S59 rev-1 finding): browser tests load from `samples/compilation-tests/dist/` which is gitignored. Without `bun run pretest`, full `bun test` produces ~130 ECONNREFUSED-shaped failures in happy-dom. Use `bun run test` (chains pretest) NOT `bun test` directly for baseline checks. Documented in pa.md F4 step 5.
- **SPEC.md Read-budget reality (S64 amendment).** SPEC.md is ~410k tokens. Primer + SPEC-INDEX.md + targeted-section Read is the only sustainable pattern. Never attempt full-file Read (will overflow). For lookups: `grep -n "^### " compiler/SPEC.md` for top-level headings, then targeted Read with `offset:` + `limit:`. SPEC-INDEX.md (~288 lines) is the navigation map. Per-section split queued as v0.3.0+ candidate.
- **Adding a new scrml-special structural element (S64 amendment)** — e.g., a new structural element added at SPEC §4/§24 — REQUIRES updating `compiler/src/attribute-registry.js` (~233 LOC, defines per-element attribute schemas) for VP-1 (attribute-allowlist.ts) and VP-3 (attribute-interpolation.ts) validation. Otherwise unknown attributes are silently forwarded as HTML. PIPELINE.md 0.7.0 §3.3 calls this out at the stage-contract level; the dispatch checklist must enforce it.
- **Self-host integration shim (S64 amendment).** `compiler/src/codegen/compat/parser-workarounds.js` exposes `setBPPOverrides(mod)` — runtime override hook that swaps in self-hosted BPP module implementations when available. Live in self-host integration. Without context, the shim looks like dead-code-with-getter; it isn't.
- **Open SPEC-ISSUE registry (S64 amendment, scattered in SPEC prose).** Discoverable via `grep -ohE 'SPEC-ISSUE-[0-9]+' compiler/SPEC.md | sort -u`. As of 2026-05-06: **005** (HTML version target), **010-COMPONENT** (component overloading; pinned for queued debate-03), **012** (Tailwind variants/theming), **018** (SQL transactions), **025-027** (server `@var` initial-load semantics), §53.13.1-4 (named-shape registry, constraint arithmetic, type-alias for predicates, boolean predicates). 010-FUNCTION closed-without-resolution (debate-02 verdict). 013 closed 2026-03-27.
- **Pipeline has TWO bookends the named-stage list doesn't show (S64 audit finding):**
  - **Pre-Stage-2 lint pass** — `compiler/src/lint-ghost-patterns.js` (~492 LOC) runs BEFORE Stage 2 BS. Scans for React/Vue/Svelte syntax and emits "did you mean?" warnings. The §11 anti-patterns table above is enforced at *both* doc-level AND lint-level by this pass. Catalog source: `scrml-support/docs/ghost-error-mitigation-plan.md`.
  - **Post-TAB diagnostic walkers** — `compiler/src/gauntlet-phase[1|3]-checks.js` (~1226 LOC total) emit a class of diagnostics AFTER the named pipeline stages: import/scope/use-decl placement (E-IMPORT-001/003, E-SCOPE-010, E-USE-001/002, E-USE-INVALID-CTX) + equality / null-token misuses (E-EQ-002/004, E-SYNTAX-042). When dispatching diagnostic-fix work, **search both `type-system.ts` AND these gauntlet files** — the diagnostic source may not live in the named stage you'd expect.
- **Internal AST kinds — retirement status (updated S79 2026-05-10):** `reactive-derived-decl` retired (folded into `state-decl` at S60 Phase A1a Step 11.5, interface dropped at S64). **`reactive-debounced-decl` retired at S79** — the pre-v0.next `@debounced(N) name = expr` keyword-form was deleted (clean-cut Approach B per `scrml-support/docs/deep-dives/debounce-and-timing-2026-05-10.md` §6 ratification); debounced/throttled cells now ride on state-decl with a `reactivity?: { debounced?: AfterDurationResult; throttled?: AfterDurationResult }` field per SPEC §6.13. The S64 "STILL ACTIVELY CONSTRUCTED" claim for `reactive-debounced-decl` is now obsolete. `reactive-array-mutation`, `reactive-explicit-set`, `reactive-nested-assign` remain live AST kinds per their own paths. The companion cluster of `@deprecated Phase 4d` `string` shadow fields was dropped at S64 — 19 field declarations removed from `compiler/src/types/ast.ts`. See `docs/audits/compiler-forgotten-surface-2026-05-06.md` for the original audit (now with two retired kinds: `reactive-derived-decl` + `reactive-debounced-decl`); `scrml-support/archive/changes/phase-4d-completion-sweep/progress.md` for the S64 sweep record; `docs/changes/debounce-throttle-approach-b/progress.md` for the S79 cut.
- **Depth-of-survey discount (S59 captured)**: when an audit estimates >5h for a "new-infrastructure" fix, mandate an implementation-time survey-first phase before accepting the estimate. The survey routinely cuts cost 2-5x because existing infrastructure often partially covers the perceived gap; the actual fix is a localized extension, not new infrastructure. **Seven confirmed occurrences:** S51 W2 (LSP already shipped canonical-key + auto-gather; CE was the outlier), S52 DD4 (SPEC §54.2-§54.3 already had the extension-point pattern), S59 Step 2 (block-splitter already preserves raw `<` content correctly; intervention was one helper in ast-builder.js, not multi-subsystem rework — agent finished in ~21 min vs the audit's 10-15h estimate), S59 documentary-attrs (brief named `emit-html.ts` as touchpoint; survey corrected to `codegen/index.ts:530-555`; ALSO surfaced two unanticipated touchpoints `attribute-registry.js` + `html-elements.js` for validator allowlist), S64 Stage 0c.A (Phase 4d audit said "5 retired reactive-* AST kinds"; survey corrected to 1; agent self-corrected scope per brief-locus-correction authorization), S64 A1b Step B2 (audit estimated 4-6h; B2 landed in ~30 min via two-pass design within `symbol-table.ts` riding existing `_scope` annotations — 8-12x discount), and **S65 parseVariant Path A survey** (~15-25% discount; ~14-19h vs 20-30h estimate; the most important finding: `reflect(TypeName)` in `meta-checker.ts:144-274` is a working type-as-argument primitive TODAY, so parseVariant rides existing recognition pattern + E-ENGINE-004 helper + `emit-machines.ts` codegen template; ALSO caught 2 SCOPE drifts — §10.4 doesn't exist, parser-level work is a no-op). The fourth instance validates that the discount applies to brief-locus errors as well as architectural-cost errors — implementation-time survey routinely reveals the actual surface area is different from what the brief named. Full pattern + mitigations + counter-cases at `scrml-support/design-insights.md` "Depth-of-survey discount" entry. Mitigation checklist: (a) for each gap row in an audit OR each touchpoint in a brief, ask "what existing infrastructure partially covers this?" + "is this REALLY the right file?"; (b) add cost-estimate confidence intervals ("Xh IF new-infra-needed; ≤Yh IF existing-infra covers"); (c) PA dispatches a 1-2h survey-only diagnostic agent before per-step decomposition when in doubt; (d) brief MUST authorize agents to correct the touchpoint when survey reveals the brief is off — no "stick to the named file" rigidity.

---

## §13 The locks (L1-L20) — at-a-glance

Captured in full at `scrml-support/docs/deep-dives/v0next-s56-deliberation-outcomes-2026-05-04.md`. Quick reference:

| # | Lock |
|---|---|
| L1 | Markup-as-first-class-value (PILLAR — held since scrml8) |
| L2 | Compound state Variant C with canonical `@formRes.name` access |
| L3 | Decl-coupled-with-render-spec (`<name req> = <input/>`) |
| L4 | Partial validator vocabulary unification (no bilingual schema) |
| L5 | `is some` reused from existing scrml primitive (coexists with `req`) |
| L6 | Match Tier 0/1/2 ladder |
| L7 | Match attributes (rules-inert + `effect=`/`<onTransition>` engine-only) |
| L8 | Two match shapes coexist (block-form + JS-style) |
| L9 | `loose` flag dropped (rules-in-match obviates) |
| L10 | `reset()` as primitive (superseded by L18) |
| L11 | Auto-derived validity surface (compound + per-field, errors as enum tags) |
| L12 | Validator error-message origin (4-level resolution chain) |
| L13 | `<errors of=expr/>` first-class element |
| L14 | Cross-field validation via predicate args (no separate vocabulary) |
| L15 | `const <derived> = expr` (extended ALL-SCOPE during S56 alignment pass) |
| L16 | Multi-render via existing access paths (no override syntax) |
| L17 | Compiler dispatches binding by render-spec; writable requires bindable |
| L18 | `reset(@cell)` keyword + `default=` attribute (γ semantics) — supersedes L10 |
| L19 | Multi-statement event handlers force named function |
| L20 | `derived=expr` engine attribute (any reactive expression of engine's type) |
| L21 | `E-DERIVED-VALUE-MUTATE` — in-place mutation of a `const`-derived cell forbidden (array mutating methods, object property writes / compound-assignment / `delete`, in-compound derived sub-cells). Sibling rename: §6.6.8 reassignment code E-REACTIVE-002 → E-DERIVED-WRITE. Spec at §6.6.18 + §34. (S59 small-deliberation lock, 2026-05-05.) |
| L22 | **Type-as-argument is a first-class scrml language primitive**, introduced by `parseVariant`. Foundation for the type-as-argument family (`serialize`, `formFor`, `schemaFor`, `tableFor`, reflective metadata). Each future family member must independently pass per-shape sliver test + synonym-detection precondition + asymmetric-forfeit-cost decomposition. (S65; debate-05 verdict + judge ratification + Path-A architectural commit; SPEC §41.13 + §53.14; family-precedent doc at `scrml-support/docs/type-as-argument-family-2026-05-06.md`.) |

---

## §13.5 Spec real-estate vs adoption — known slivers + doc-only surfaces (S64 audit)

The spec is ahead of adoption for several feature surfaces. Knowing which surfaces are sliver-empty or doc-only saves PA from dispatching work that has no real consumer or has nothing to delete.

| Surface | Status | Note |
|---|---|---|
| `^{}` meta-blocks | **active** (74+ sample/example files) | First-class; design + adoption both real |
| `_{}` foreign-code (§23, ~443 lines spec) | **sliver-empty** (0 source-level uses) | Design real, adoption pending. Treat foreign-code design questions as low-priority unless a specific WASM/sidecar use-case is in scope |
| `<keyboard>` / `<mouse>` / `<gamepad>` (§36, 358 lines spec) | **sliver-empty** (0 source-level uses, 1 unit test) — **debate-04 IN FLIGHT S88** | Spec real-estate exceeds adoption. debate-04 (§36 retention — CLOSE-AND-RIP / KEEP-OPEN-DEFER / DESIGN-AND-SHIP) auto-curator-dispatched 2026-05-12. Trio (`match`/`engine`/derived) does NOT cover live-input dispatch — input events are inherently external |
| State-type-discriminated function-overloading (§17.5 first half) | **retired** (debate-02 verdict, S64) | Stage 0c.A deletes the implementation; replacement primitives are `match`/`engine`/derived |
| Component-overloading (§17.5 second half) | **CLOSED WITHOUT RESOLUTION** (debate-03 verdict, S64 — `scrml-support/docs/debates/debate-03-component-overload-decision-2026-05-06.md`) | 6-expert panel 4-CLOSE / 2-DEFER / 0-DESIGN; roc-expert retracted the debate-02 carve-out ("JSX-call-site asymmetry doesn't transfer to scrml because `<match for=Type>` is structural"). SPEC §17.5 lines 9140-9148 normative. `component-expander.ts` has zero overload code paths. **Do not revisit** without a render-shape corpus from authored apps showing a case the trio cannot cover. |
| `<transaction>` block (§44.6, SPEC-ISSUE-018 open) | **stub** | Codegen has TODOs; spec defers full transaction syntax. Either close SPEC-ISSUE-018 + finish, or retire AST kind |
| `<machine>` keyword | **REMOVED** (S305 ruled / S307 landed) — `E-DEPRECATED-001`, severity **Error** | Does NOT compile. Still PARSES per §63.5 (one diagnostic, not a cascade). `bun scrml migrate` rewrites opener + `</machine>` closer + the §51.9 projection body. `W-DEPRECATED-001` + `E-ENGINE-003` retired. See §7. |

**General principle:** when planning work touching one of these surfaces, check the row first. PA should not dispatch implementation work against a doc-only surface, and should not assume a sliver-empty surface has consumers.

Updated row for parseVariant (S65):

| Surface | Status | Note |
|---|---|---|
| `parseVariant(json, EnumType)` (§41.13 + §53.14, type-as-argument family) | **active** (S65; first general-position type-as-argument primitive) | Path-A architectural commit ratified. SPEC + stdlib + 4 error codes landed. Compiler-side TS-pass + codegen tracked under S65 dispatch (Phase 2). Family-precedent doc at `scrml-support/docs/type-as-argument-family-2026-05-06.md` |

---

## §13.6 Type-as-argument family (S65 — short reference)

**One-paragraph summary:** scrml admits scrml-native types (`:enum`, `:struct`) as positional arguments to a small, disciplined family of compile-time-special functions OUTSIDE `^{}` meta-blocks. The family is OPEN with bounded discipline; each member must independently pass per-shape sliver test + synonym-detection precondition + asymmetric-forfeit-cost decomposition before entering spec or implementation. `reflect(TypeName)` in §22 meta-blocks is the existing precedent INSIDE meta; `parseVariant` (S65, ratified) is the FIRST general-position member.

**Family members (status as of S135):**

| Member | Status | Sliver |
|---|---|---|
| `parseVariant(json, EnumType)` | **shipped** S65 (SPEC §41.13) | type-establishment for sum types — constructor selection from discriminator |
| `serialize(value, EnumType)` | STASHED S103 (§53.14.4 discipline filter) | symmetric to parseVariant; round-trip law — synonym-detection re-trigger pending |
| `formFor(StructType)` | **shipped** S102-S103 (SPEC §41.14; FLAGSHIP — `scrml.dev` demo) | compile-time struct-walk → emits `<form>` markup tree + validity surface + submit handler wiring |
| `schemaFor(StructType)` | **shipped** S104 (SPEC §41.15) | emits `<schema>` SQL DDL from struct field predicates (§39+L4 vocabulary unification); enum-lowering per OQ-SCH-12 |
| `tableFor(StructType, rows)` | **shipped** S105 (SPEC §41.16) | auto-`<table>` from struct + rows; admin-UI lift; v1.next features (filtering / pagination / row-click / server-side) deferred |
| `variantNames(EnumType)` / reflective metadata | planned | exposes variant lists as runtime values |

**Flagship-treatment cross-ref (S135 cluster H catch-up, F-044).** The kickstarter §4.13 ships the adopter-facing flagship treatment of the L22 family (`parseVariant` / `formFor` / `schemaFor` / `tableFor` worked examples) + `^{}` meta context (F-035) + refinement-type predicates with SPARK zones (F-053) as ONE integrated section per the audit's recommendation. The PRIMER §13.6 table here is the per-member status reference; the kickstarter §4.13 is the on-ramp for adopters.

**Authority chain for any new `Type.foo` request:**
1. SPEC §53.14 — type-as-argument primitives subsection (family framing + discipline)
2. SPEC §41.13 — parseVariant API entry (worked example)
3. `scrml-support/docs/type-as-argument-family-2026-05-06.md` — gate-keeping reference + future-PA checklist
4. L22 — the architectural lock

**What was rejected (CLOSED by debate-05 verdict; do not re-propose without new corpus signal):** `parseShape` (synonym for §53.4 boundary refinement), `parseArray` (synonym for `[].map(parseVariant)`), `parseRecord`, `parseTuple`, `parsePartial` (Gap #20 closes via `formFor(..., partial=true)`, not via parse primitive).

---

## §13.7 Annotated-AST contracts produced by A1b resolver passes (S65)

⚑ **ROTATED OUT at S383 — this section now lives in [`docs/PA-SCRML-REFERENCE.md`](PA-SCRML-REFERENCE.md), under its original `## §13.7` heading.** Nothing was cut, condensed or re-dated; the move was byte-identical.

**What is there:** the B1–B22 + dA-b1 annotated-AST contracts — the resolution metadata the A1b resolver passes attach to the A1a AST for B5+/codegen to consume, one row per step giving field name, node kind, values, and read API.

**Why it moved:** boot-budget rotation under `pa-base v2.16` §2 — *a maintained-tier document SHALL have a size budget, and the overflow ROTATES into the write-once tier.* §13.7 was **264 lines = 44.2%** of this primer, the largest single block in a mandatory boot read, and was referenced zero times at S375. Ratified by bryan at S383.

⚑ **Landing a new AST contract? Add its row in `PA-SCRML-REFERENCE.md`, not here.** This stub is a pointer only — a contract row added here forks the table.

---

## §13.8 Promotion ergonomics — `I-MATCH-PROMOTABLE` + `bun scrml promote --match` (S65 design / S66 shipped)

The tier ladder (§1) is "promotion is mechanical and additive." Promotion ergonomics is the design center that makes that promise concrete in the dev loop:

**Two pieces, one workflow:**

1. **`I-MATCH-PROMOTABLE`** — info-level lint (NOT a warning). Surfaces when an if-else chain over an enum-typed state cell is mechanically promotable to a Tier-1 `<match>` block. Three message shapes:
   - **Exhaustive** — all variants covered; clean lift available.
   - **Near-miss** — partial coverage; lists the *missing variants concretely*. Add the missing arm, then promote. (Once promoted, the compiler catches future variant-adds at the `<match>` site automatically — that's the gain.)
   - **Compound** — branches use `||` / `&&` grouping; not auto-promotable. Separate info points out the constraint.

2. **`bun scrml promote --match <file>[:line]`** — CLI subcommand that *executes* the lift mechanically. Per-branch rewrite rule (SPEC §56.5.2): `if (@cell is .X) { body }` → `<X>{body}</>`; trailing `else { ... }` dropped on exhaustive coverage. Idempotent — re-running on already-promoted code is a no-op. Supports `--dry-run`, file or directory targets. Pairs with `bun scrml migrate` (deprecated→current) but is a separate verb because semantics differ — `promote` is a tier-up of valid code.

**Predicate matrix (S66 — full restored after narrowing-error reversal):** the lint and `--match` accept BOTH `if (@cell is .Variant)` AND `if (@cell == .Variant)` as variant-tag-check predicates. They're structurally equivalent in scrml; the dev's choice of operator is style. Mixed `is`/`==` in the same chain is supported and produces a unified rewrite. The S66 preprocessor fix (`compiler/src/expression-parser.ts`) makes `.Variant` parseable as a primary expression in any operator context — that change is what unblocks `==` recognition here. The earlier S66 sub-survey "narrowing to bare-`is`-only" was a methodology-error reversal: corpus-shows-zero-`==` was inverted (corpus empty BECAUSE parser broken, not because devs chose `is`); see `docs/changes/promotion-ergonomics/progress.md` "S66 narrowing reversal" entry for the full arc + methodological note.

**Companion verb (DEFERRED to Tier C):** `bun scrml promote --engine <file>[:line]` lifts a `<match>` block whose state-arms accrue `rule=` attributes into an active `<engine>` (Tier 1→2). Pairs with the `W-MATCH-TRANSITIONS-ACCRUING` lint. Both the lint and the rewrite were deferred from Tier B — `W-MATCH-TRANSITIONS-ACCRUING` has no §34 row + no impl today; needs proper groundwork. The `--engine` flag stays in the CLI but prints "deferred to Tier C — needs W-MATCH-TRANSITIONS-ACCRUING groundwork" and exits 2. See `docs/changes/promotion-ergonomics/TIER-C-SCOPE.md`.

**Status (S66 — Tier B SHIPPED):** I-MATCH-PROMOTABLE lint live (`compiler/src/lint-i-match-promotable.js`) + `bun scrml promote --match` AST→AST span-rewrite live (`compiler/src/commands/promote.js`). 14 lint tests + 6 promote tests; 0 regressions. SPEC §34 catalog row landed. `--engine` Tier-C-deferred per Finding B. Test count pre-S66: 9019; post-S66: 9039.

**Why this matters (marketing-load-bearing):** scrml is the only mainstream-target framework where the *compiler tells you when your code is ready to lift* AND *a CLI does the mechanical lift* AND *no silent rewrite happens*. React/Vue/Svelte have nothing comparable. Promotion ergonomics is the marketing flagship for the tier-ladder system itself, paired with `formFor` as the marketing flagship for L22-family validators.

**Cross-references:**
- SPEC §34 — `I-MATCH-PROMOTABLE` catalog row
- SPEC §56 — full normative spec (fire conditions, message shapes, CLI flag set, exit codes, formatting-preservation invariant)
- Primer §1 — tier ladder framing
- Primer §11 — anti-pattern row pointing here
- `docs/articles/tier-ladder-promotion-devto-2026-05-04.md` — the dev.to article
- `docs/changes/promotion-ergonomics/` — dispatch artifacts (SCOPE, SURVEY-NOTE, progress)

---

## §14 What this primer does NOT cover (read elsewhere)

- Detailed grammar — see `compiler/SPEC.md` (the authoritative spec; ~24k lines / ~410k tokens — see §12 Read-budget reality)
- Section index — see `compiler/SPEC-INDEX.md`
- Recipes (auth, real-time, schema, etc.) — see `docs/articles/llm-kickstarter-v2-2026-05-04.md` §11
- Anti-patterns table for dev-agent dispatch — see `scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md`
- Compilation pipeline stages — see `compiler/PIPELINE.md` (and primer §12 for the two bookends not in PIPELINE.md)
- Implementation phase plan (Phase A1+) — see `scrml-support/archive/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md`
- Forgotten-surface audit (vestigial features / fragile string paths / spec-vs-code drift / cross-pass invariants) — see `docs/audits/compiler-forgotten-surface-2026-05-06.md`

---

## §15 Update protocol

When SPEC changes substantively (a Stage 0b dispatch lands, a lock changes, a stdlib module is added/extended), update this primer in the same commit or shortly after. Hand-off should note "primer updated for X" so next-session PA knows the canon snapshot is fresh.

A primer that has fallen behind is worse than no primer — it teaches yesterday's language. Stale primers cost more in correction than they save in onboarding.
