# PA scrml Primer — what every PA must know about the language

**Purpose:** make the PA the second-foremost expert on scrml at session start, without having to re-derive base syntax + mindset across hundreds of thousands of context tokens. This file is mandatory reading at session start (see `pa.md`).

**Status:** living document. Updated when SPEC changes, when locks land, when patterns emerge. Treat as the canon snapshot at the listed date.

**Last updated:** 2026-05-23 (S122 — NEW §6.2 Match block-form (Tier 1) — primer subsection added after the native parser's match-block FileAST synthesis shipped at S121 P5-7 / Wave 9-J `69388e28`. Covers block-form syntax, payload binding, both-shape coexistence, promotion path to Tier-2 engines, implementation status. Earlier baseline preserved below.) — 2026-05-17 (S98 — NEW Pillar 5b "Reach discipline" landed in §2 as companion to Pillar 5; ratified via the scrml-native JS parser Phase 0 deep-dive `scrml-support/docs/deep-dives/scrml-native-parser-design-2026-05-17.md` §D1; charter form: "When a problem has a finite condition set with a transition contract, REACH FOR state primitives FIRST; reach for fn/function only when the problem is calculation, or when state-shape demonstrably loses on a named axis." Operationalized via a two-table YES/NO test; canonical state examples include lexer modes / engine state / parser-context / brace-depth tracking; canonical calculation examples include numeric-literal value parsing / string escape resolution / AST node construction. Pillar 5b is the procedural form of the corrected S95 state-vs-logic axiom — state describes its own transitions; logic does pure compute; reach for state first. Earlier baseline preserved below.) — 2026-05-14 (S92 — Approach A close end-to-end: A-1 markup-context edges (S88) + A-2 Reachability Solver (S89-S91, 5 components + outer fixpoint + canonical JSON §40.9.8) + A-3 §40 AuthGraph (S91, `<auth role>` first-class element + 5 sub-phases) + A-4 Per-Route Artifact Splitter (S91, 7 sub-phases + §47 FNV-1a content-addressing) + A-5 Integration Tests (S92, 5 sub-phases). v0.3.0 critical path complete; cut gated only on Wave 4.A adopter content. See new §9.7 below for the full overview. Plus: Q-OPEN-4 (S92) sourced `chunks.json` `compiler` field from package.json + bumped pkg.json to 0.3.0-alpha.0; Q-OPEN-6 (S92) split W-CG-CHUNK-NO-PREFETCH into Info (case 1: no internal links) + new W-CG-CHUNK-PREFETCH-UNRESOLVED Warning (case 2: links resolve nowhere); Q-OPEN-5 (S92) added `--chunk-size-budget` CLI flag. Insight 30 (S87) ratified: channels are CHILDREN of entry-file `<program>` (sibling of `<page>`) — §9.1 below rewritten. S86 ratifications: idiomatic-examples styling rule (no file-top `#{}`), corpus-ouroboros warning, BS-layer over SPEC retreat (Option A). S89 ABSOLUTE rule: `null` and `undefined` do NOT exist in scrml source; `not` for absence; `""`/`0`/`false`/`[]`/`{}` are defined values. Earlier baselines: 2026-05-07 (S68 — A5-1 spec amendments) → 2026-05-06 (S64 — forgotten-surface audit + Phase 4d completion sweep).

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

server function fetchItems()! -> LoadError {
    const result = ?{ select * from items }
    if (result.length == 0) fail LoadError::Empty
    return result
}

function load() {
    const rows = fetchItems() !{
        | ::Network msg -> { @phase = .Error(msg); return }
        | ::Empty       -> { @phase = .Empty;       return }
    }
    @phase = .Success(rows.length)
}
```

Pattern:
- `function name(args) ! ErrorType { ... }` declares failable
- `fail .Variant(args)` surfaces the error
- `let x = call() !{ | ::Variant arg -> { ... } }` exhaustive call-site handler

**Errors-as-states is the canonical lifting:** at Tier 1+, the `!{}` handler at the call site does one thing — route each error variant into the right Phase variant. The error becomes a state in the Phase enum. `<isError>` + `<errorMsg>` cells are anti-patterns; the failure modes live in the type.

**`<errorBoundary>` for render-fallback (§19.11; S135 cluster J catch-up, F-032).** When an `!{}` handler can't recover at the call site — or when a sub-component throws an uncaught error during render — `<errorBoundary>` provides the render-fallback. It scopes to its body subtree:

```scrml
<errorBoundary renders=.Fallback>
    <UserList users=@users/>
    <ContactList contacts=@contacts/>
</errorBoundary>

<errorBoundary.Fallback>
    Something went wrong loading this section. <button onclick=reset>Try again</>
</>
```

`renders=.Fallback` names which variant of the boundary's enum to render when an error escapes the body subtree. The boundary's enum is auto-synthesized (variants: `.Ok` for normal render, `.Fallback` for error). Multiple boundaries can nest — error propagates UP until a boundary catches it. The boundary does NOT swallow the error; the diagnostic + stack trace are routed to scrml's logging surface.

**Implicit per-handler transactions (§19.10.5).** Inside an `!{}` handler arm, scrml wraps the SQL writes the arm performs in an implicit transaction. If the handler arm fails (re-throws OR a downstream `!{}` doesn't catch), the SQL writes ROLL BACK automatically. This is the canonical safety property — adopters get atomic-rollback semantics without `BEGIN`/`COMMIT` ceremony. Per-handler-tx is opt-OUT (annotation `@nosql-tx` on the handler arm) for the rare case you want to commit-on-error.

**Body-split / CPS (§19.9.3 — footnote).** Server-function calls inside non-top-level positions (inside `if` branches, inside `match` arms, inside loop bodies) are compiled-to-CPS — the compiler splits the function body at server-call boundaries and routes the continuation through a stub. Multi-batch CPS (§19.9.9, S114 Ext 1) extends this to multi-server-call sequences. Adopters never write the CPS form — it's compiler-managed; the source stays uncolored. Failures route through `!{}` handlers naturally; the CPS plumbing is invisible.

**Function forms — `function` / `fn` / `server function` / `pure` (§48 + §33; S135 cluster M catch-up, F-049 + F-039).**

scrml has FOUR function-declaration shapes:

- **`function`** — the workhorse; client-side; can fire any side effects (DOM, state mutation, event handlers).
- **`fn`** — pure (§33.6 S32: `fn` ≡ `pure function`); body prohibitions: no SQL, no DOM, no outer-scope mutation, no non-determinism (`Date.now()`/`Math.random()`), no async, must return at every path. `lift` inside `fn` is `E-SYNTAX-002` — `fn` returns markup, never lifts.
- **`server function`** — server-side; can use SQL, file I/O, env vars; auto-bound to a route (§12 inference); client call compiles to a fetch.
- **`pure function`** — synonym for `fn`. Explicit form. `pure fn` is REDUNDANT and fires `W-PURE-REDUNDANT`.

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
    .Idle               -> "Idle"
    .Loading            -> "Loading"
    .Error(msg)         -> "Error: " + msg
    .Empty              -> "No rows"
    .Success(count)     -> count + " rows"
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
- **`bun scrml promote --each` — Landing 3 PENDING** (SPEC §56.10 is honest SPEC-ahead; the CLI help prints "impl pending"). Don't tell adopters to run it expecting a rewrite yet.
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

const u: User = { id: 1, email: "a@b.com", passwordHash: not }
print(u.passwordHash)                     // E-TYPE-001 — pre-transition access

u.passwordHash = hashPassword(rawPassword)
print(u.passwordHash)                     // OK — post-transition access
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
| Function return | YES (hybrid; §6.5 below) | `server fn loadUser(id: number) -> (not to User)` |
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

### Function-return position — the hybrid mechanism (§14.12.6)

Lifecycle on function-return type is fully tracked end-to-end. The transition mechanism splits by the lifecycle's pre-type:

| Lifecycle shape | Pre-type | Transition mechanism |
|---|---|---|
| **Presence-progression** | `not` (e.g., `(not to T)`) | **Discrimination IS transition** — `given u = expr {}`, `if (u is not) return`, OR `match u { ... }` AUTO-MARKS |
| **Variant-progression** | An enum variant (e.g., `(.A to .B)`) | **Explicit `transition(u)`** — call the `transition()` built-in after discriminating the source variant |

**Presence-progression — discrimination IS transition:**

```scrml
server fn loadUser(id: number) -> (not to User) {
    const row = ?{ select * from users where id = ${id} }.get()
    return row     // returns `User | not`; lifecycle declares the post-transition contract
}

const u = loadUser(42)

// Form 1 — given presence-guard (§42.2.3)
given u => {
    print(u.name)                         // OK — discrimination = transition
}

// Form 2 — if-is-not early-return
if (u is not) return
print(u.name)                             // OK — narrowed + transitioned

// Form 3 — match
match u {
    not => handleAbsence()
    given u => { print(u.name) }          // OK — arm discriminates + transitions
}

// Pre-transition access — fires E-TYPE-001
const u2 = loadUser(42)
print(u2.name)                            // E-TYPE-001 — u2 was not discriminated
```

**Variant-progression — explicit `transition(u)`:**

```scrml
type Article:enum = {
    Draft(body: string),
    Published(body: string, publishedAt: number)
}

server fn publish(id: number) -> (.Draft to .Published) {
    const a = ?{ select * from articles where id = ${id} }.get()
    return a as .Published                // callee transitions; returns Published-shape
}

const a = publish(42)

if (a is .Draft) {
    transition(a)                         // explicit per-access transition signal
    print(a.publishedAt)                  // OK — post-transition access of B-shape field
}

// Missing-transition — fires E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED
if (a is .Draft) {
    print(a.publishedAt)                  // accessed .Published-shape field after
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

```scrml
type Phase:enum = { Idle, Loading, Error(msg: string), Empty, Success(count: int) }

function load() {
    @phase = .Loading
    const result = fetchItems() !{
        | ::Network msg -> { @phase = .Error(msg); return }
        | ::Empty       -> { @phase = .Empty;       return }
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
- **`rule=` declares legal transitions FROM the state-child** per §51.0.F. **Three target-only forms:** single-target `rule=.NextVariant`, multi-target `rule=(.A | .B | .C)`, wildcard `rule=*` (escape hatch — loses static guarantees). The arrow form `rule="event -> Variant"` is **legacy `<machine>` syntax** (§51.3, deprecated); `<engine>` does NOT use it.
- **Transitions are direct writes (`@phase = .X`) or `.advance(.X)`** per §51.0.F + §51.0.G. The `rule=` contract is enforced compile-time when from-state is statically known (inside a state-child body) and runtime otherwise. `E-ENGINE-INVALID-TRANSITION` fires on writes that violate the rule= set. `.advance(.X)` is the loud-failure variant; direct write is the canonical quiet-validation path. (`.tryAdvance` was rejected at S55 deliberation — silent failures hide bugs.)
- **`<onTransition from=A to=B>`** for cross-state effects (analytics, cleanup). Multiple `<onTransition>` children supported per state-child for multi-target rules.
- **`effect=` attribute** on a state-child for inline per-rule effects (single-target only — `E-ENGINE-EFFECT-AMBIGUOUS` on multi-target).
- **Derived engines** — `<engine for=Phase derived=expr>` reactively recomputes the variant; no rules, no writes (`E-DERIVED-ENGINE-NO-WRITE`); no `initial=` (`E-DERIVED-ENGINE-NO-INITIAL`).
- **Components are NOT engines** — a component-instance with internal state is fresh per instance; an engine is one app-lifecycle singleton (`E-COMPONENT-ENGINE-SCOPE`).
- **Legacy `<machine>` keyword** — deprecated alias for `<engine>`. Emits `W-DEPRECATED-001` at the call site; the `bun scrml migrate <file>` CLI auto-rewrites `<machine` → `<engine`. `W-DEPRECATED-001 → E-DEPRECATED-001` transition planned for v0.3.0. **Migration of legacy temporal `rule=` grammar (S68):** S67 spec amendments brought temporal transitions forward into `<engine>` form via `<onTimeout>` (§51.0.M); see §7.1 below. Legacy `<machine>` event-arrow + predicate `rule=` forms (§51.3) remain machine-only — those are not migrated into `<engine>` and remain `<machine>`-form-exclusive surfaces.
- **Engine state-child bodies render reactively (S78, Phase A10).** Each state-child body is walkable AST (markup, text, `${@cell}` interpolations, event handlers, payload bindings). At compile time the engine emits per-arm render functions + a dispatcher subscribed to the engine variable; on each variant change the dispatcher writes the matching arm's HTML into a `<div data-scrml-engine-mount="<varName>">` slot. Initial-arm body lands in the static HTML at module init so file-level reactive-wiring binds correctly. Tree-shake invariant: engines with all-empty bodies emit zero render code. v1 limitations: in-place reactive `${@cell}` interp inside non-initial arm bodies isn't re-wired across variant changes (rendered HTML IS correct on each change; only subscription-driven updates within a non-initial arm are not auto-refreshed); delegable events (click, submit) work fine across variant changes. See `compiler/src/codegen/emit-variant-guard.ts` for the factored helper (variant-source-agnostic; future match-block-form codegen reuses it).

### §7.1 S67 amendments — hierarchy, history, internal/external, onTimeout

**Status:** SPEC LANDED at S68 (this section reflects A5-1). A5-4 + A5-5 codegen SHIPPED at S77 2026-05-10 (`<onTimeout>` + computed-delay across both surfaces). Other A5 sub-steps still pending Phase A7 dispatch (~50-80h). Surface summary for PA navigation:

- **`<onTimeout after=DURATION to=.Variant [name=IDENT]/>`** (§51.0.M; `name=` per §51.0.M.1 S79) — engine temporal surface, parallel to `<onTransition>`. Self-closing. `to=` validated strict-by-default against surrounding state-child's `rule=` (must be in set OR rule=*). Reset-on-reentry per §51.12.4. Multiple per state-child legal. Rides §51.12 runtime backbone (`_scrml_machine_arm_timer` / `_scrml_machine_clear_timer`). E-STRUCTURAL-ELEMENT-MISPLACED outside engine state-child. **A5-4 codegen SHIPPED at S77 2026-05-10** — engine-side per-state timer-config table emitted as `__scrml_engine_<varName>_timers` (sibling to transitions table); arm-on-entry + clear-on-exit threaded through `_scrml_engine_direct_set` + `_scrml_engine_advance` (4th-arg `timersTable`); initial-arm at module-init (after reactive wiring so computed-form `${@var}<unit>` reads land); tree-shake when zero `<onTimeout>` per engine. **A5-6 Feature 1 SHIPPED at S79 2026-05-10** — optional `name=IDENT` attribute (must match `/^[A-Za-z_][A-Za-z0-9_]*$/`; E-TIMER-NAME-INVALID + E-TIMER-NAME-DUPLICATE on misuse). Named timers use composite key `<varName>::<stateName>::n:<name>` instead of index suffix; anonymous timers keep index keying. The `cancelTimer("name")` builtin — recognized in event-handler call-ref attributes inside arm bodies — lowers to `_scrml_engine_clear_named_timer("<varName>", "<armTag>", "<name>")` using the static (varName, armTag) from Phase A10's arm context. v1 limitation: only call-ref event-handler form supported (`onclick=cancelTimer("X")`); expression-form (`onclick=${cancelTimer("X")}`) and function-body calls fall through to ordinary emission and runtime-fail with `cancelTimer is not defined`. Names are scope-local to the state-child; unknown names are runtime no-ops (matches `clearTimeout(undefined)` browser semantics).

- **`<onIdle after=DURATION to=.Variant/>`** (§51.0.R, S77 amendment) — engine-WIDE event-timeout watchdog (distinct from `<onTimeout>` which is per-state). Self-closing. Engine-root scope only (E-IDLE-MISPLACED inside state-child body). `to=` strict-validated against engine's `for=` enum (E-IDLE-INVALID-VARIANT). One per engine maximum (E-IDLE-DUPLICATE). Armed at module-init; **RESET on every successful transition** (any `_scrml_engine_direct_set`/`_scrml_engine_advance` commit); fires after N ms of silence. Rule=-honoring fire (sub-A1) — the watchdog write goes through the same write path as a direct write, subject to current state's `rule=` validation. **A5-6 SHIPPED at S77 2026-05-10** — per-engine watchdog config emitted as `__scrml_engine_<varName>_idle` (sibling to transitions/timers tables); 5th-arg `idleEntry` threaded through write-guard call sites; reset called on successful commit; tree-shake when no `<onIdle>` per engine. Computed-delay `${expr}<unit>` works (rides parseAfterDuration helper).

- **Computed-delay form** (§51.12.3.1) — `after=${expr}<unit>` accepts any non-negative-number expression. Applies to both `<onTimeout>` (engine) and legacy `<machine>` `.From after duration => .To` form. Static literals retain constant-fold path. **A5-5 codegen SHIPPED at S77 2026-05-10** for the engine `<onTimeout>` surface (msExpr arrow-fn in the timer-config table; runtime applies negative/NaN→0 clamp + Math.round). **A5-5b SHIPPED S77** closing the legacy-machine surface — the body-parser bug was a one-line fix at ast-builder.js's `rulesRaw` concat (spurious `\n` between children fragmenting `${...}` substrings); both surfaces now end-to-end with bit-identical runtime semantics. Computed-form rules opt out of JSON-encoded chained auto-rearm per §51.12.4 S77 amendment (single-step computed transitions arm correctly at module-init via per-rule inline arms; multi-step computed→computed chains require user-driven writes).

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
1. Inline on decl (`<name req:"Please enter your name">`)
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
    ${ server function postMessage(author, body) {
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

- SQL-mirror (`not null`, `unique`, `references(table.col)`, `default(literal)`, `primary key`) remains **canonical**.
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

- **`given x => …` presence-guard** — the canonical narrow-to-present form. `given x => @x.name` is type-equivalent to `if (@x is some) @x.name` but the bound `x` is narrowed to the non-`not` type within the body. Reach for `given` when you need to USE the value; reach for `if (x is some)` when you only need to BRANCH.
- **`T | not` union form** — the canonical type for absence-possible values. A server fn returning `User | not` cleanly composes with the §6.8.3 reset × lifecycle semantic. The compiler wire-format envelope (§57) round-trips `not` losslessly.
- **`""` / `0` / `false` / `[]` / `{}` are DEFINED values, NOT absence** (§42.1.1, S89 ratification). `is some "" → TRUE`; `req "" → FALSE`. Don't conflate "empty" with "absent" — they're distinct concepts in scrml.

### §9.5 `not` keyword

(Move 11 — pinned-style modifier on imports / decls for opt-out semantics. Existing §42 content retained.)

### §9.6 D4 — small-edit threading + cross-file imports + structural elements registry

D4 (S58 close) threaded the locks/moves across the smaller spec sections. Highlights worth knowing:

- **Cross-file engine import** (§21.8, M18). `import { MarioMachine } from './engines.scrml'` then mount via `<MarioMachine/>` at use-sites. Singleton semantics across all use-sites in the importer's file. `pinned` legal on imports: `import { MarioMachine pinned } from './engines.scrml'`.
- **Components vs engines** (§15.13.5, M20). Singleton-by-design (`<engine>`) ≠ multi-instance (component). Component bodies cannot instantiate an engine — `E-COMPONENT-ENGINE-SCOPE`.
- **Structural elements registry** (§4 + §24). `<engine>`, `<match>`, `<errors>`, `<onTransition>`, `<onTimeout>` (§51.0.M, S77), `<onIdle>` (§51.0.R, S77), `<channel>` (§38), `<page>` (§4.15, S85), `<auth>` (§40.1, S91) are scrml-defined structural elements (NOT HTML). `E-STRUCTURAL-ELEMENT-MISPLACED` if used in unsupported contexts.
- **Bare-variant inference** (§14.10, M9). When LHS or parameter type is statically known, the variant qualifier may be omitted: `<phase>: Phase = .Idle` not `Phase.Idle`. Union-typed contexts → ambiguous → require qualification.
- **`:`-shorthand body** (§4.14, M15). Single-expression body: `<Idle>: <button onclick=load()>Load</button>`. Whitespace mandatory after `:`.
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

## §10 stdlib — what's on the shelf (16 modules)

**Important:** stdlib modules are **import-only**, not standalone-compile targets. Don't try to compile `stdlib/<x>/index.scrml` directly — it's designed to be imported into a `<program>`.

**App-building primitives:**
- `scrml:auth` — `hashPassword`, `verifyPassword`, `generatePassword`, `signJwt`, `verifyJwt`, `decodeJwt`, `createRateLimiter`, TOTP (generate/verify)
- `scrml:oauth` (NEW S58) — OAuth 2.0 + PKCE (RFC 7636). Core: `startFlow`, `exchangeCode`, `refreshToken`, `getUserInfo`, `revoke`. PKCE: `generateVerifier`, `deriveChallenge`. Storage: `memoryAdapter()` (dev only); caller injects production adapter. Provider presets: `googleConfig` + `parseGoogleIdToken` (decode-only, no JWKS verify yet — v0.3.0), `githubConfig`, `microsoftConfig`, `discordConfig`. Typed errors caught by `err.name`: `OAuthStateMismatch`, `OAuthVerifierMissing`, `OAuthTokenError`, `OAuthUserInfoError`, `OAuthRevocationError`. **Deferred:** JWKS sig verification, OIDC discovery (RFC 8414).
- `scrml:data` — `validate(data, schema)`, `isValid`, `firstError`; predicate builders; transforms (`pick`, `omit`, `groupBy`, `sortBy`, `unique`, `flatten`, etc.) — vocabulary alignment task pending B3. **Plus (S65)** `parseVariant(json, EnumType)` — boundary-parsing primitive for tagged-variant JSON; FIRST general-position member of the type-as-argument feature family (cross-ref §13.6 + SPEC §41.13 + §53.14). Failure type `ParseError:enum` with variants `MissingDiscriminator`, `UnknownVariant(tag: string)`, `InvalidPayload(field: string, reason: string)`, `Malformed(reason: string)` — first stdlib-declared enum.
- `scrml:router` — `match(pattern, path)`, `parseQuery`, `buildUrl`, `navigate`, `currentPath`, `onNavigate`
- `scrml:store` — `createStore`, `createSessionStore`, `createCounter` (KV / session via SQLite)

**Network + scheduling:**
- `scrml:http` — REST helpers (`get/post/put/del/patch`) + `withBaseUrl/withAuth/withDefaults`, `retry(fn, opts)`, `multipart`, `uploadFile`, `isOk`/`isError`. All async.
- `scrml:redis` — `get/set/setex/del/exists/expire/ttl/incr/decr`; sets `sadd/srem/sismember/smembers`; pub/sub `publish/subscribe/unsubscribe`; `createClient`, `send`, `close`. Bun.redis-backed.
- `scrml:cron` — `schedule(pattern, handler)` returns CronJob; `nextOccurrence`, `stop`. Bun.cron-backed (Bun ≥1.3.12).

**Crypto + format + patterns:**
- `scrml:crypto` — `hash`, `verifyHash`, `hmac`, `safeCompare`, `generateUUID`, `generateToken`
- `scrml:format` — `formatCurrency/Number/Percent/Bytes`, `slug`, `pluralize`, `titleCase`, `capitalize`, `toWords`, `truncate`, `padLeft/Right`, locale-aware Intl: `compactNumber`, `formatList`, `formatRange`, `formatNumberAdvanced`
- `scrml:time` — `formatDate/Time/DateTime/Relative/Duration`, `parseDate`, `isValidDate`, `startOf/addTime/diffTime`, `debounce/throttle/sleep`; timezone: `formatInTimezone`, `nowInTimezone`, `toTimezoneParts`, `tzOffset`; ISO: `formatISO`, `parseISO`
- `scrml:regex` — vetted `patterns` catalog (email, url, ipv4, uuid, slug, hexColor, semver, isoDate, phoneE164, usZip, etc.); helpers `test`, `match`, `extract`, `replace`, `escape`, `caseInsensitive`, `isValid(name, str)`

**Wrappers:**
- `scrml:fs`, `scrml:path`, `scrml:process`, `scrml:test` — Node compat / test runner

**Distribution model (locked S57):** bundled-with-compiler, single-version, stdlib-version = compiler-version, no registry, no separate semver.

**Honesty positioning:** "kills ~88-90% of typical-app npm needs" (S58 lift after `scrml:oauth` lands). Real remaining gaps: JWKS / OIDC discovery (deferred); date-formatting beyond Intl; advanced HTTP middleware beyond what's bundled; some niche utility libs (lodash-equivalents).

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
| `items.map(...)` / `${ for (let x of @items) { lift <li/> } }` to render a list | the `for/lift` form is the valid Tier-0 iteration shape but reads as imperative logic; the Tier-1 structural form is more discoverable and composes with `<empty>` + inferred `key=` | `W-EACH-PROMOTABLE` (§6.3, SPEC §17.7 / §34) info-lint surfaces the opportunity; lift to `<each in=@items key=@.id>...</each>` (with `<empty>` for the zero-items case). `bun scrml promote --each` is the mechanical lift (SPEC §56.10) — **Landing 3 PENDING**, lift by hand for now |

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
| `<machine>` keyword | **deprecated** (W-DEPRECATED-001) | `bun scrml migrate` rewrites to `<engine>`. Hard-removal at v0.3.0 |

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

A1b decorates the A1a AST with resolution metadata that downstream passes (B5+, codegen) consume. Each step's contract is recorded here as it lands so future passes can rely on the field name + value semantics.

| Step | Field | On node kind | Values | Read API |
|---|---|---|---|---|
| **B1** | `_record` | state-decl nodes (registered cells) | `StateCellRecord` | `lookupStateCell(name, scope)` |
| **B1** | `_scope` | various nodes attached during PASS 1 | scope identifier | (internal walker discrimination) |
| **B2** | (no new field — fires `E-NAME-COLLIDES-STATE` diagnostic) | local-decl nodes shadowing state names | — | — |
| **B3** | `_resolvedStateCell` | every `@`-prefixed `IdentExpr` reachable via SYM PASS-3 | `StateCellRecord` (resolved), `null` (unresolved — no error fired at B3), `undefined` (not walked) | `getResolvedStateCell(ident)` exported from `compiler/src/symbol-table.ts` |
| **B5** | `_cellKind` (+ `_isBindable`) | every registered `state-decl` | `"plain" \| "bindable" \| "markup-typed" \| "compound-parent"` (+ boolean convenience) | `getCellKind(decl)`, `isCellBindable(decl)` exported from `compiler/src/symbol-table.ts` |
| **B4** | `Scope.importBindings` (per-scope **registry**, not per-node) | file-level scope | `Map<localName, ImportBindingRecord>` (`{localName, exportedName, sourcePath, pinned, declNode}`) | `lookupImportBinding(scope, localName)` exported from `compiler/src/symbol-table.ts` |
| **B6** | (no new field — fires `E-CELL-NO-RENDER-SPEC` / `E-CELL-RENDER-SPEC-NOT-BINDABLE` diagnostics on `<x/>` use-sites) | self-closed lowercase MarkupNodes resolving to registered cells | — | — |
| **B7** | (no new AST field — emits `reads` edges between `reactive` DG nodes inside Stage 7 dep-graph; fires `E-DERIVED-CIRCULAR-DEP` on cycles) | derived `state-decl` (`shape:"derived"`, `structuralForm:false`) + transitive callees | — | DG output `depGraph.edges.filter(kind === "reads")` (consumed at codegen / inspectable from Stage 7) |
| **B8** | (no new field — fires `E-DERIVED-VALUE-MUTATE` diagnostic per SPEC §6.6.18 / L21) | mutation forms (`reactive-array-mutation`, `reactive-nested-assign`, `bare-expr` containing `assign`/`call`/`unary`) where the receiver chain root is a `const`-derived cell | — | — |
| **B9** | `ValidatorEntry.args` (in-place type change: `string[] \| null` → `ValidatorArg[] \| null`) | state-decl `validators[]` | each arg is `ExprNode` (standard preds) or `RelationalPredicateNode` (length(>=N)-style); `null` = bareword preserved; `[]` = zero-arg-call preserved | `forEachIdentInValidatorArg(arg, cb)`, `forEachIdentInValidators(validators, cb)` exported from `compiler/src/validator-arg-parser.ts` (consumed by B10 typer + future B7-style walkers) |
| **B10 (Phase 1+2)** | (no new AST field — fires `E-TYPE-031` per SPEC §55.1 line 24295 on validator arity / per-arg shape mismatches) | state-decls with `_record.hasValidators` | — | universal-core catalog at `compiler/src/validator-catalog.ts` (`lookupPredicate`, `isUniversalCorePredicate`, `universalCorePredicateCount`, `UNIVERSAL_CORE_PREDICATES`); walker is SYM PASS 7 (`walkValidatorTypeCheck`) |
| **B10 (Phase 3)** | new edge kind `validator-reads` in DG (`DGEdgeKind` union); fires `E-VALIDATOR-CIRCULAR-DEP` per SPEC §55.11 / §34 on validator-arg cycles | state-decls with cross-field `@cell` refs in validator args | — | `buildValidatorArgsAdj(edges, nodes)` filter (sibling of `buildDerivedReadsAdj`) consumed by B7's generic `detectCycle`; FIRST consumer of B7's reusability promise per audit §1.4 |
| **B11** | `StateCellRecord.{isSynthesized, synthProperty, parentCompound, runtimeHookKind}` (extension fields on synth records ONLY) | compound parent's `_scope.stateCells` map gains 4 synth records keyed by `isValid`/`errors`/`touched`/`submitted` | `synthProperty: "isValid" \| "errors" \| "touched" \| "submitted"`; `runtimeHookKind: "touch" \| "submit" \| null` (per §55.7 timing table) | `isSynthesizedCell(record)`, `getSynthRecords(compoundDecl)` exported from `compiler/src/symbol-table.ts`; constants `SYNTH_PROPERTY_NAMES`, `COMPOUND_SYNTH_PROPERTIES`. Walker is SYM PASS 8 (`walkRegisterSynthSurface`). Also fires `E-SYNTHESIZED-WRITE` per SPEC §55.5 / §55.7 / §34 by extending B8's PASS 6 walker (audit §1.3 wave-ordering correction). |
| **B12** | `StateCellRecord.parentField` (extension field on per-field synth records ONLY) + new `ScopeKind: "field"` (per-field synth scope attached to compound children) | compound CHILD's `declNode._scope` (kind `"field"`) gains 3 synth records keyed by `isValid`/`errors`/`touched` (NOT `submitted` — compound-only per §55.7 line 24468) | `synthProperty` enum reused; `parentField` back-pointer to the field cell (B12 discriminant vs B11 compound-level synth) | `getPerFieldSynthRecords(fieldDecl)` exported from `compiler/src/symbol-table.ts`; constant `PER_FIELD_SYNTH_PROPERTIES: readonly ["isValid", "errors", "touched"]`. Walker is the SAME SYM PASS 8 — `registerCompoundSynthSurface` now also registers per-field surfaces for each non-synth, non-compound-typed child (`registerPerFieldSynthSurface`). `lookupQualifiedStateCell` extended to descend through ANY cell with `_scope` (no longer requires `isCompoundParent`). Also fires `E-SYNTHESIZED-WRITE` per SPEC §55.6 / §34 by relaxing B11's compound-vs-field guard in PASS 6 (compound parent → all 4 properties; compound child → 3 properties excluding `submitted`). |
| **B13** | `ValidatorEntry.inlineOverride` (Level-1 §55.10 override extraction) | every validator on every non-derived `state-decl` carrying validators | `string` (extracted from trailing string-literal arg) / `null` (no override / non-string-literal — fires E-VALIDATOR-INLINE-DYNAMIC) | direct field read on each `validator` in `decl.validators[]`. Also fires `E-DERIVED-WITH-VALIDATORS` per SPEC §55.14 / §34 on `isConst:true` state-decls with non-empty validators (one diagnostic per cell, recommends refinement-type alternative). Walker is SYM PASS 9 (`walkRejectDerivedWithValidatorsAndExtractOverride`). |
| **B14** | `StateCellRecord.engineMeta` (extension field on engine records ONLY) + new `CellKind: "engine"` (5th value); ast-builder adds `engine-decl.{varName, varNameOverride, initialVariant, pinned, isExported}`; MOD's exportRegistry gains `kind: "engine"` + `category: "engine"` for `export <engine ...>` Form 1 | every `engine-decl`'s auto-declared variable registers as a StateCellRecord with `_cellKind: "engine"` in the file scope | `EngineMetadata` shape: `{forType, variants[], initialVariant, derivedExpr, varName, isExported, isPinned}` BASIC + A7 forward-compat fields (`parentEngine`, `innerEngines`, `historyAttr`, `internalRules`, `parallelAttr`, `onTimeoutElements` — declared, undefined at B14) | `autoDeriveEngineVarName(typeName)` exported from `compiler/src/symbol-table.ts` (§51.0.C lowercase-first-character literal rule). Walker is SYM PASS 10.A (`walkRegisterEngines`). Fires `E-ENGINE-VAR-DUPLICATE` per SPEC §51.0.C / §34 on collision with state-cell or another engine. PASS 10.B (`walkValidateCrossFileEngineMounts`) validates self-closing `<EngineName/>` mounts against MOD's engine-aware exportRegistry, firing `E-ENGINE-MOUNT-NOT-ENGINE` (NEW §34 row, S68 — A1b B14) when the import's source export is not engine-categoried. |
| **B15** | `EngineMetadata.{variants[], stateChildren[]}` populated (B14 left empty); new types `EngineRuleForm` + `EngineStateChildEntry` exported from `compiler/src/symbol-table.ts` | every `engine-decl` carrying a `_record` (set by PASS 10.A) is walked; `engineMeta.variants` populated from `ast.typeDecls[]`; `engineMeta.stateChildren` populated by `parseEngineStateChildren` from `engine-statechild-parser.ts` | `EngineRuleForm = { kind: "single"; target } \| { kind: "multi"; targets[] } \| { kind: "wildcard" } \| { kind: "absent" } \| { kind: "legacy-arrow"; raw } \| { kind: "parse-error"; raw, reason }` (six §51.0.F + extension forms); `EngineStateChildEntry { tag, rule: EngineRuleForm, bodyRaw, rawOffset }` | direct field reads on `record.engineMeta.{variants, stateChildren}`. Walker is SYM PASS 11 (`walkValidateEngineStateChildrenAndRules`). Fires per §51.0.E + §51.0.F + §34: `W-ENGINE-INITIAL-MISSING` (lint, non-derived only), `E-ENGINE-INITIAL-INVALID-VARIANT`, `E-ENGINE-STATE-CHILD-MISSING` (per missing variant), `E-ENGINE-STATE-CHILD-INVALID-VARIANT` (per unknown tag), `E-ENGINE-RULE-INVALID-VARIANT` (per invalid `rule=` target), `E-ENGINE-RULE-LEGACY-SYNTAX` (event-arrow form on `<engine>`). All five `E-ENGINE-*` rows are NEW §34 catalog additions S68 — A1b B15. Compile-time E-ENGINE-INVALID-TRANSITION for direct writes inside state-child bodies DEFERRED — bodies are raw text today (parser limitation; same pattern as B14's E-COMPONENT-ENGINE-SCOPE deferral). |
| **B16** | new edge kind `engine-derived-reads` in DG (`DGEdgeKind` union); fires `E-DERIVED-ENGINE-CIRCULAR` per SPEC §51.0.J + §31.5 + §34 on engine-derived-cycle subgraph; SYM PASS 12 fires `E-DERIVED-ENGINE-NO-INITIAL` / `-NO-RULES` / `-NO-WRITE` per SPEC §51.0.J + §34 on Move-14-shape derived engines | every `engine-decl` with `_record.engineMeta.derivedExpr !== null`; rejection trio gated on `derivedExpr.kind !== "legacy-source-var"` to avoid double-fire with §51.9 LEGACY E-ENGINE-017 | `_pendingEngineDerivedReads: string[]` scratch field on engine ReactiveDGNodes; consumed by post-collection edge-resolution loop | `buildEngineDerivedAdj(edges, nodes)` filter (sibling of B7's `buildDerivedReadsAdj` and B10's `buildValidatorArgsAdj`) consumed by B7's generic `detectCycle`; SECOND consumer of B7's reusability promise per primer §13.7 B7 specifics. Walkers `walkDerivedEngineDeclRejections` + `walkDerivedEngineWriteRejections` exported from `compiler/src/symbol-table.ts` for test direct-invocation. |
| **B17** | (no new AST field — fires `E-COMPONENT-ENGINE-SCOPE` diagnostic per SPEC §51.0.K + §34 on `engine-decl` reachable inside any `component-def.defChildren` array) | every `component-def` reachable from `ast.nodes` (recurses through `children`/`body`/`consequent`/`alternate`/`arms[].body` and through nested defChildren) | — | walker is SYM PASS 13 (`walkRejectEnginesInComponentDefChildren`). Audit §2 brief items 1-5 + 7 (effect=, `<onTransition>`, match-arm restrictions, residual fire-sites in component-body markup) DEFERRED — preconditions (engine state-children parser, `<onTransition>` element tokenization, block-form `<match>` parser, component-def body markup parser) not met today. See `scrml-support/archive/changes/phase-a1b-step-b17-ontransition-component-engine/SURVEY.md`. |
| **B22** | (no new AST field — fires `E-RESET-INVALID-TARGET` diagnostic per SPEC §6.8.2 + §34 on `reset-expr` nodes whose `target` is not one of the canonical shapes) | every `reset-expr` node reachable via any ExprNode-bearing AST field; nodes carrying a parse-time `diagnostic` (E-RESET-NO-ARG path) are SKIPPED to avoid double-fire | — | walker is SYM PASS 14 (`walkValidateResetTargets`). Reuses `forEachResetExprInExprNode` (`compiler/src/expression-parser.ts:2538`) for the reset-expr finder + `lookupQualifiedStateCell` (B12-extended descent) for multi-level compound-nav resolution. Closes A1a Step 9's deferred validation (per `compiler/src/types/ast.ts:1670-1674` docstring). New §34 catalog row added S69 — A1b B22. |
| **B19** | (no new AST field — fires `E-CHANNEL-INSIDE-PROGRAM` per SPEC §38.1 + §34 on `<channel>` markup nodes reached at `markupDepth >= 1`; fires `E-CHANNEL-SHARED-MODIFIER` per SPEC §38.4 + §34 on any `state-decl` with `isShared: true`) | every `<channel>` markup node + every `state-decl` reachable from `ast.nodes` (recurses through children/body/defChildren/consequent/alternate/arms[].body and through state-decl.children compound arrays) | — | walker is SYM PASS 15 (`walkValidateChannels` — two sub-walks: `walkChannelPlacement` for placement check + `walkSharedModifier` for modifier rejection). Both error codes already exist in §34 (lines 14251-14252) — no new catalog rows. Spec authority: §38.1 line 15422 (file-level placement mandate) + §38.4 line 15468 (`@shared` retirement). Per audit §2.1, B19 owns the modifier rejection only — V5-strict access validation inside channel body remains B3's territory. Renumbered from B19's PASS 14 → PASS 15 during S69 file-delta merge (B22 took PASS 14 in the parallel small-bundle dispatch). |
| **B18** | (no new AST field for markup-attribute fire-site — fires `E-MULTI-STATEMENT-HANDLER` per SPEC §5.2.3 + §34 on `<markup>` openers whose event-handler attribute value contains a top-level `;` outside expression-internal contexts; new `EngineStateChildEntry.isColonShorthand: boolean` flag for SYM PASS 11 fire-site #2) | every `<markup>` block (TAB time, in `ast-builder.js`) + every `EngineStateChildEntry` with `isColonShorthand: true` (SYM PASS 11) | `EngineStateChildEntry { tag, rule, bodyRaw, isColonShorthand: boolean, rawOffset }` (extension of B15's interface) | new helper `compiler/src/multi-statement-scan.ts` exporting `scanForTopLevelSemicolon(text): SemicolonHit[]` + `isEventHandlerAttrName(name): boolean`. Helper tracks paren/brace/bracket depth, single/double/backtick string state with escape, line/block comments, and `${...}` template-literal interpolation depth. **Two fire-sites:** (1) `ast-builder.js` markup branch fires at TAB time (around line 8365) — scans opener slice via existing `scanOpenerForAttrs`, maps each top-level `;` to nearest preceding `name=` token via local regex, fires when name passes `isEventHandlerAttrName` (`/^on[a-z]+$/i` OR `/^on:/` OR `/^onserver:/` OR `/^onclient:/`). (2) SYM PASS 11 (`validateEngineStateChildrenAndRules`, now exported for direct test use) extended with a final loop after rule= validation: for each entry with `isColonShorthand: true`, scan `bodyRaw` and fire E-MULTI-STATEMENT-HANDLER per §4.14 line 980. No new §34 catalog row — `E-MULTI-STATEMENT-HANDLER` (line 14260) already exists from earlier spec dispatch. |
| **B21** | EXTENDED AST field: `let-decl.predicateCheck` and `state-decl.predicateCheck` now record three-zone classification on EVERY predicated decl (was: boundary-only). Shape extension: `predicateCheck = {predicate: PredicateExpr, zone: "static" \| "trusted" \| "boundary", sourceKind: "literal" \| "predicated" \| "arithmetic" \| "unconstrained"}`. A1c codegen still gates runtime-check emission on `zone === "boundary"`, so the static + trusted annotations are additive + non-breaking | every `let-decl` / `const-decl` / `state-decl` whose `typeAnnotation` resolves to a `PredicatedType` (via `resolveTypeExpr`); annotation written in `type-system.ts:annotateNodes` at lines ~3997 (let/const) and ~4131 (state-decl). Walker placement: type-system.ts annotateNodes (NOT a new SYM PASS — type info isn't populated until TS runs, same placement as B20) | new helper `upgradeSourceInfoForPredicatedIdent(initial, initExpr, scopeChain)` (`type-system.ts` ~line 1656): when the syntactic SourceInfo is `unconstrained` AND the init ExprNode is a single non-bare-variant non-tilde `IdentExpr`, looks up the ident in the scope chain; if bound to a predicated-typed variable, upgrades SourceInfo to `{kind: "predicated", predType: ...}` so `classifyPredicateZone` can call `predicateImplies` (T-PRED-4) and choose trusted vs boundary. Conservative: leaves `literal` / `arithmetic` SourceInfos alone (literals are statically known; arithmetic strips constraints per T-PRED-5 regardless of operand types) | direct field reads on `decl.predicateCheck.{zone, sourceKind, predicate}`. Existing A1c codegen consumers `compiler/src/codegen/emit-logic.ts:477,496,674,689` continue to gate on `zone === "boundary"` and call `emitRuntimeCheck` from `compiler/src/codegen/emit-predicates.ts` to emit `E-CONTRACT-001-RT` boundary checks. Test: `compiler/tests/unit/refinement-three-zone-b21.test.js` (13 sections, 27 tests) — REAL-AST trusted-zone propagation through let/state-decl pairs is the load-bearing new coverage. Pre-B21 the `predicated` SourceInfo was unreachable from real code (only direct unit-test calls hit `classifyPredicateZone` with that kind). Existing infra reused: `parsePredicateExpr` (line 718), `evaluatePredicateOnLiteral` (line 909), `formatPredicateExpr` (line 1405), `checkPredicateLiteral` (line 1431), `predicateImplies` (line 1585), `classifyPredicateZone` (line 1629), `extractInitLiteral` (line 1511), `classifyLiteralFromExprNode` (`expression-parser.ts:2721`). All E-CONTRACT-001 / -002 / -003 fire-paths unchanged. Per audit §4.2 brief #4: B21 fires at compile-time for static-zone violations only; boundary + trusted are codegen-time concerns (already wired). DEFERRED to A1c (per audit §4.2 brief #2): function-parameter zone classification (`function-decl` walker line 3808 binds predicated params but does not classify caller-site or return-site zones today), return-stmt zone classification, bare-expr reassignment to predicated state-decl, reactive-nested-assign predicate classification, HTML attr generation (`emit-html.ts`), E-CONTRACT-004-WARN bind:value attr conflict. DEFERRED to v0.3.0 / open SPEC-ISSUE: full SPARK three-zone semantics, named-shape registry extension via meta blocks, constraint arithmetic, type-aliases for predicates, boolean predicates (§53.13). |
| **B20** | (no new AST field on state-decl/let-decl — fires `E-VARIANT-AMBIGUOUS` per SPEC §14.10 + §34 on bare-variant `IdentExpr` (`name: ".Variant"`) at LHS-typed positions when context is null/asIs/unknown OR a union with multiple enum members declaring the variant; fires `E-TYPE-063` when context is a known enum and the variant is not in its declarations. NEW AST field: `match-arm-block.payloadBindings: string[]` so payload-destructure arm bodies (`.Mushroom(n) => { ... }`) can resolve `n` in scope) | every `state-decl` and `let-decl`/`const-decl` invocation in `type-system.ts:annotateNodes` whose RHS contains bare-variant `IdentExpr` nodes (helper `inferBareVariantsInExpr` walks the ExprNode tree via `forEachIdentInExprNode`, identifies idents with `name.startsWith(".")` + uppercase first letter, resolves against the LHS-derived `contextType`); `match-arm-block` walker now also binds `payloadBindings` into the arm scope before recursing into body | `EnumType.variants` lookup (B20's helper) + new `parseArmPattern(...).payloadBindings: string[]` (extracted from `(args)` between variant name and `=>`) | helper `inferBareVariantsInExpr(exprNode, contextType, span, errors)` exported from `compiler/src/type-system.ts`; `parseArmPattern` extended to capture `payloadBindings` for both `.Variant(args)` and `< Variant>(args)` shapes. Walker placement: type-system.ts annotateNodes (NOT a new SYM PASS — type info isn't populated until TS runs). Parser fixes load-bearing for B20: (1) `expression-parser.ts:preprocessForAcorn` regex tightened to variable-length lookbehind `(?<![A-Za-z0-9_$\)\]"'`]\s*)\.\s*([A-Z][A-Za-z0-9_]*)` so bare-variants are recognized after `joinWithNewlines` token-spacing AND `MarioState . Fire`-style spaced member access is correctly EXCLUDED. (2) `ast-builder.js:shouldSkipExprParse` relaxed to NOT skip leading-dot followed by uppercase — `.Variant` IS a valid standalone primary expression. (3) `ast-builder.js` match-arm-block parser gains Form 1b (`.VariantName(binding, ...) => { block }`) capturing payload binding names. (4) `symbol-table.ts:isArrayLikeArg` recognizes new `kind:"array"` shape (`[.Admin, .Editor]` now parses cleanly post-B20-fix; old escape-hatch `ParseError` shape preserved for defense). DEFERRED to B20.b: positions 3 (fn param) + 4 (fn return) require `FunctionType.params` upgrade + return-type capture infrastructure beyond B20's scope. Position 5 (match `for=T` arm patterns) is handled by exhaustiveness today; explicit ambiguity check deferred. Position 6 (engine `for=T initial=.V`) already covered by B15. SPEC-PROSE FOLLOW-UP: §34 row 14233 currently cites only §18.0.3; should be amended to also cite §14.10. |

**B3 specifics (load-bearing for B5/B7/B10/B22 + promotion ergonomics + A1c C0):**

- `_resolvedStateCell: null` is an EXPLICIT "B3 ran, found nothing" marker — not the same as `undefined`. Downstream passes can detect failed resolution and decide whether to fire (a future tightening dispatch will convert null markers into fired E-SCOPE-001 at the type-check pass; today the `@`-prefix path in `type-system.ts:2870-2999` skips diagnostics).
- **Compound nav** (`@form.name`): B3 resolves the BASE cell on the `@form` IdentExpr. The `.name` part is a static property string (MemberExpr), NOT an IdentExpr — `forEachIdentInExprNode` walks `member.object` only. Consumers needing leaf-level resolution (e.g., B22 `reset(@form.name)`) must re-resolve via `lookupQualifiedStateCell`.
- **No collision with parseVariant Phase 2's `parseVariantEnum`** — different node kinds (CallExpr vs IdentExpr), different stages (type-check pass vs SYM PASS-3).

**B4 specifics (load-bearing for cross-file pinning + B14 engine import):**

- `Scope.importBindings` is per-scope (file-level today; future per-function or per-component scoping is forward-compatible via the same shape — `lookupImportBinding` already walks the parent chain). Default imports register a single binding under `imp.names[0]` with `pinned:false`; named imports walk `imp.specifiers[]` for full `{imported, local, pinned}` data. Aliased imports register under the LOCAL name (`bar` in `import { foo as bar }`) with `exportedName: "foo"`.
- **E-STATE-PINNED-FORWARD-REF source-position rule.** A read of a pinned cell (or pinned import) before the cell's decl-span end fires the error. Self-init (`<x pinned> = @x + 1`) fires (the cell is not "fully declared" until decl-span closes). Non-pinned cells permit hoisted forward-refs (no fire).
- **Read-position approximation.** IdentExpr `span.start` is NOT a reliable absolute file offset — when expression-parser parses isolated substrings (function bodies, interpolations) with `baseOffset:0`, the IdentExpr's `span.start` is substring-relative. B4 substitutes the **enclosing AST node's `span.start`** as the read-position. The approximation is exact for every spec-normative case because pinned decls live only at file/program/compound scope (never inside function bodies); a future B-step that propagates absolute baseOffsets through expression-parser will let us upgrade to source-exact spans.
- **E-IMPORT-PINNED-INVALID best-effort fire (Option A).** Fires on `pinned` imports of definitively-not-cell-not-engine kinds: `function`, `fn`, `type`, `channel`. Accepts `const`/`let` imports (Form 1 `export <engine var=…>` desugars to `export const`, indistinguishable from arbitrary const today; B14 / M18 cross-file engine import lands engine-aware export-registry annotation). Re-export / rename / local / unknown kinds are accepted (no chasing in B4). The check requires MOD's `exportRegistry`; when absent (test-harness path), the check is skipped silently — the registration + forward-ref check still runs.

**B6 specifics (load-bearing for codegen routing + Tier-ladder render-by-tag fidelity):**

- **PASS 5 walks every MarkupNode.** A `<tag/>` self-closed lowercase tag that resolves to a registered state cell (file-scope `lookupStateCell` lookup) is a render-by-tag use. The cell-kind switch (read from B5's `_cellKind` annotation) fires either `E-CELL-NO-RENDER-SPEC` or `E-CELL-RENDER-SPEC-NOT-BINDABLE`; bindable cells accept silently.
- **Disambiguator: B5's `markup-typed` bucket collapses two spec-distinct cases.** Shape 3 markup-typed derived (`const <badge> = <span>...</span>`) and Shape 2 with non-bindable RHS (`<msg> = <div>...</div>`) both classify as `markup-typed`. B6 reads `decl.isConst` to disambiguate: `isConst:true` → E-CELL-NO-RENDER-SPEC (SPEC §6.6.17 line 3027); `isConst:false` → E-CELL-RENDER-SPEC-NOT-BINDABLE.
- **Compound parent self-tag (`<formRes/>`) fires E-CELL-NO-RENDER-SPEC** (Phase 0 §3.1 disposition; spec is silent on this exact form, the spec-faithful extension treats compound parents as cells-without-render-spec). The error message tightens to mention the wrapping form `<formRes><field/></>` and `${@formRes.field}` interpolation as the spec-canonical alternatives.
- **Component RHS render-specs DEFERRED.** A Shape 2 decl whose `renderSpec.element.tag` is PascalCase (`<x> = <MyComp/>`) is accepted silently in B6 v1. SPEC line 1341 requires component-prop-catalog inspection (does the component declare a bindable prop?), and that catalog is born in B14/M18/M20. Deferring rather than mis-firing matches Rule 4 (spec is normative; under-fire is recoverable, mis-fire on currently-undefinable cases is a worse footgun). PascalCase **use-sites** in markup (`<MyComponent/>`) are also accepted — the lowercase-tag predicate filters them before lookup.
- **HTML built-ins skip silently.** `<br/>`, `<input/>`, `<img/>`, etc. are self-closed lowercase markup but don't resolve via `lookupStateCell`, so the walker no-ops on them. Distinct from B6's concern; existing infra surfaces unresolved-tag errors elsewhere when needed.

**B7 specifics (load-bearing for codegen reactive recompute + B10/B11/B12/B16 cycle-detection reuse):**

- **Stage 7 (DG) is the home, not a new SYM PASS.** B7 lives in `compiler/src/dependency-graph.ts`, not symbol-table — by the time DG runs, all derived state-decls have been registered (B1) and resolved (B3), so the dep walker has full identifier resolution available. Per SPEC §6.6.10 line 2697 ("…during the dependency graph construction pass (Stage 7, §30)").
- **Direct + transitive deps both tracked.** Direct `@cell` reads in the RHS register `reads` edges between two `reactive` DG nodes. Function calls in the RHS register `calls`/`awaits` edges to the callee's `function` DG node; the call graph then propagates the callee's transitive reactive reads back into the deriving cell via fixed-point iteration (existing infra at lines 1357-1422 of `dependency-graph.ts`).
- **Pure-`fn` filter (§31.5, §48).** Callees whose `FunctionDeclNode.fnKind === "fn"` are SKIPPED in the transitive-read propagation. Pure functions have no implicit reactive deps (E-FN-001..E-FN-005 enforce body purity upstream; the filter is mostly a defense-in-depth contract assertion). Reactive `function` callees DO inherit deps. Audit §1.1 worked example: `const <fmt1> = formatCount(@count)` (pure) gets dep on `@count` only; `const <fmt2> = reactiveLog(@count)` (reactive, body reads `@lastSeen`) gets dep on `@count + @lastSeen`.
- **Cycle detection via generic DFS.** `detectCycle(adj, allNodes)` (renamed from `detectAwaitsCycle` for reuse) is parameterized on adjacency map + node set. B7 supplies `buildDerivedReadsAdj(edges, nodes)` which filters the global edge list to `reads` edges between two `reactive` DG nodes. B16 (engine-derived, `E-DERIVED-ENGINE-CIRCULAR`) and B10/B11/B12 (validator-arg deps, §31.4) will reuse the same DFS with their own filtered adjacency.
- **Self-reference is a degenerate 1-cycle (SPEC §6.6.10 line 2712).** `const <x> = @x + 1` and the transitive case (`const <t> = compute(); function compute() { @t }`) are both captured into a `selfReferencingDerivedNodes: Set<NodeId>` and reported alongside multi-hop cycles. Self-edges are NOT pushed into the live `edges` list (would pollute the read-edge consumer set and confuse downstream passes).
- **Fail-fast on E-DERIVED-CIRCULAR-DEP.** Per SPEC §6.6.10 line 2710 ("SHALL block code generation"), the function returns early after emitting derived-cycle errors, before E-DG-001 awaits-cycle scan and E-LIFT-001 lift-concurrent scan. Mirrors the existing E-DG-001 fail-fast pattern.
- **Canonical error name:** `E-DERIVED-CIRCULAR-DEP` (per §34 catalog row + §31.5). The old §6.6.10 placeholder `E-REACTIVE-005` was deprecated by S66 audit (`scrml-support/archive/audits/a1b-b7-rule4-audit-2026-05-07.md`) and replaced with a SPEC footnote at §6.6.10 line 2747 (parallel to the §6.6.8 S59 rename).

**B8 specifics (load-bearing for L21 — derived-cell value-immutability invariant):**

- **PASS 6 walker — three AST shape paths.** `reactive-array-mutation` and `reactive-nested-assign` (specialized lowerings) are checked via direct field access on the body node (`target` + `method` / `target` + `path`). `bare-expr` carries an `exprNode` with one of three shapes: `assign` (compound assigns + multi-segment `=` + computed-index `=`), `call` (compound-receiver method calls like `@form.errors.push(x)`), `unary` with `op === "delete"`. Walker dispatches on `exprNode.kind` and verifies the receiver chain root resolves to a `const`-derived `StateCellRecord`.
- **Mutating-method + compound-assign catalog.** Lives in `compiler/src/derived-mutation-ops.ts`. `ARRAY_MUTATING_METHODS` (9 names per SPEC §6.5.1) and `COMPOUND_ASSIGNMENT_OPS` (14 forms per §6.6.18) are frozen sets, exported for future consumers (E-DERIVED-WRITE implementation, codegen rewriter, IDE autocomplete suppressors). The `=` operator is treated separately because the spec wording calls it out as a distinct property-write form.
- **Receiver-chain root resolution.** For specialized lowerings, `target` is a string. For `bare-expr`, the walker uses `leafIdentInChain` + `collectMemberPath` (mirroring `parse-mutation-shapes.test.js` patterns) to build a path array, then `findDeepestRegisteredOnPrefix` walks prefixes longest→shortest and returns the deepest registered record. This handles single-segment (`["copy"]`), compound-nav (`["form", "derivedField"]`), and intermediate-prefix-resolves cases uniformly.
- **Same-pass affordance for E-DERIVED-WRITE (§6.6.8).** §6.6.18 normative says the check SHALL share a pass with E-DERIVED-WRITE. E-DERIVED-WRITE has no implementation today (spec-only); when it lands, it joins B8's PASS 6 walker as a sibling discriminator (`@derived = newval` is an `assign` with bare-ident target, not a member chain — distinct dispatch from B8's member/index forms).
- **E-SYNTHESIZED-WRITE deferred to B11.** §6.6.18 catalog also references E-SYNTHESIZED-WRITE (§55.7), which depends on B11/B12's synth-cell registry. B11 will extend this walker with a fourth dispatch keyed on synthesized property names. The walker structure is prepared for that join.
- **In-compound `const <derived>` (case 3) parser-deferred.** SPEC §6.6.16 defines `<form><items>=[] const <derivedField> = ... </>`. The B8 walker handles this case correctly (compound `_scope` descent + `findDeepestRegisteredOnPrefix`), but current ast-builder declines the `const`-inside-compound parse path (per `parse-shapes-v0next.test.js §S11A.8`). Tests for case 3 are `.skip` with rationale; they activate when parser support lands.
- **Markup-typed derived cells: uniform handling.** Per §6.6.18 last paragraph, markup APIs today expose no mutators so the rule is non-firing in practice on `markup-typed` derived cells — no special exemption needed in the walker. If a future markup API gains a mutator, B8 fires automatically.

**B9 specifics (load-bearing for B10 typer + cross-field §55.11):**

- **Two sub-grammar regions per audit §1.2.** (1) Relational-predicate form (`length(>=N)`, `length(<=N)`, `length(<N)`, `length(>N)`, `length(=N)`, `length(!=N)`) is NOT standalone-parseable JS — it's `<rel-op> <expr>`. B9 wraps this in a new sibling AST kind `RelationalPredicateNode { kind: "relational-predicate", op, value: ExprNode, span }`. (2) Standard-expression form (everything else) — numeric (`min(18)`), regex/string (`pattern(...)`), comparable (`gt(@startDate)`), bare-variant arrays (`oneOf([.Admin, .Editor])`), arbitrary expressions (`eq(@signup.password)`) — uses the existing `expression-parser` (S66 bare-dot fix is the precondition for `.Variant` array elements).
- **`RelationalPredicateNode` is NOT in the `ExprNode` union.** Sibling type. The exhaustiveness check on `forEachIdentInExprNode` / `exprNodeContainsCall` / etc. stays intact. The asymmetry is absorbed at the validator-args boundary by `forEachIdentInValidatorArg` (dispatches on `kind`; for relational-predicate, recurses into `value` via `forEachIdentInExprNode`; otherwise calls `forEachIdentInExprNode` directly).
- **null vs [] vs [...] distinction preserved per audit §1.5.** `args: null` ↔ bareword (`<x req>`); `args: []` ↔ zero-arg-call (`<x req()>`); `args: [...]` ↔ non-empty call-form. `decorateValidatorsWithExprNodes` no-ops on null and [] entries.
- **Step 5 STRING-token bug fix:** the validator-arg collector at `ast-builder.js:scanStructuralDeclLookahead` was joining STRING token texts raw (without quotes). Mirror-applied the JSON.stringify treatment from the default-expr collector so `pattern("[a-z]+")` arrives parseable. Surfaced + fixed in B9 pre-wire.
- **Regex literals fall to escape-hatch (raw preserved).** `pattern(/^[^@]+@[^@]+$/)` parses to `escape-hatch { estreeType: "Literal", raw: "/^.../" }` because `esTreeToExprNode` routes RegExp values through the BigInt/exotic branch. B10 reads the raw text on regex args. Future tightening can introduce a `RegexLitExpr` kind if needed.
- **Idempotent.** `decorateValidatorsWithExprNodes` skips entries whose first arg is already a structured object (has a `kind` field), allowing safe re-invocation in partial-build flows.
- **Closed sets.** `RELATIONAL_PREDICATE_HOSTS = {"length"}` and `REL_OPS = [">=", "<=", "!=", ">", "<", "="]` (2-char ops first to avoid `>=` parsing as `>`). Per §55.1 — only `length` admits the relational form in spec worked examples. If §55 is extended, add to the set.

**B10 specifics (load-bearing for validator type-check + future B11/B12/B16/B21 catalog reuse):**

- **Catalog at `compiler/src/validator-catalog.ts`.** Single source of truth for the 14 universal-core predicates per SPEC §55.1 (L4). Reusable across three loci: state validators (§55.2 — primary B10 consumer), refinement-type expressions (§55.3 / §53 — future B21 consumer), schema columns (§55.4 / §39 — future unification with `schema-differ.js`). 14 predicates: `req`, `is some`, `length`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`. NOT in catalog (per primer §8 + S66 audit): `email`/`url`/`numeric`/`integer` (stdlib `scrml:data` predicate-builders) and `custom` (§55.9 enum tag, not a predicate).
- **Per-predicate signature:** `arity` (`0` strict bareword / `"0+inline"` bareword OR string-literal inline-override / `1` strict-one-arg / `"1+inline"` one-required + optional inline-override) + `args: PredicateArgKind[] \| null` (per-positional-slot kind: `relational-predicate` / `numeric` / `regex` / `comparable-with-cell` / `any-equatable-with-cell` / `array-of-cell-type` / `inline-message-override`) + `cellTypeRequirement` (`any` / `string-or-array` / `string` / `number` / `orderable` / `equatable` — for the deferred cell-type compatibility check) + `errorTag` (`ValidationError` enum tag per §55.9).
- **Walker is SYM PASS 7** at `compiler/src/symbol-table.ts` (`walkValidatorTypeCheck`). AST-driven structural recursion (mirrors PASS 5 / PASS 6); reads `_record.hasValidators` to skip cells with no validators. Fires `E-TYPE-031` (§34, the existing umbrella per §55.1 line 24295) with descriptive per-violation messages.
- **AST shape recognition:** strings are `{kind:"lit", litType:"string"}`; numbers are `{kind:"lit", litType:"number"}`; regex literals fall to escape-hatch `{kind:"escape-hatch", estreeType:"Literal", raw:"/.../"}` (per B9 specifics — esTreeToExprNode routes RegExp through BigInt/exotic); array literals are escape-hatch `{kind:"escape-hatch", estreeType:"ArrayExpression"}` for clean arrays OR `{estreeType:"ParseError", raw:"[...]"}` for bare-variant arrays (`[.Admin, .Editor]` fails standalone JS parse). RelationalPredicateNode is its own kind (B9 sibling of ExprNode).
- **DEFERRED to follow-up steps (per audit §1.3 + §1.5):** cell-type compatibility check (e.g., `pattern(re)` on a `number` cell → would need type-system inference); per-arg-split (B9 produces single-element joined-raw `SequenceExpression` args today; the walker's `args.length > 2` and trailing-arg-shape branches are FORWARD-COMPATIBLE — activate when per-arg-split lands or B13 takes over inline-override extraction). Tests for these branches are `.skip` with rationale.
- **Library-surface predicates pass through silently.** `email`, `url`, `numeric`, `integer` (stdlib `scrml:data`) are NOT in the universal-core catalog; B10 emits no error on unknown predicate names today (a future tightening can convert to strict reject once stdlib predicates register through a separate path).
- **B11/B12/B16/B21 will reuse this catalog** without duplicating signatures (per audit §1.1 — single source of truth across three loci per L4).

**B11 specifics (load-bearing for B12 + A1c codegen + IDE autocomplete):**

- **Trigger predicate is `_cellKind === "compound-parent"`** (B5 annotation). Single-value Tier-1 cells (L11 Edge A) get NO surface — the compound-parent check filters them naturally. Synthesis is UNCONDITIONAL for compound parents per §55.5 predictability rule (audit §1.1) — even no-validator compounds get the surface, with trivially-valid defaults.
- **Type shapes per §55, NOT §6.11 stub** (audit §1.2). Compound `errors` is `{fieldName: [...errorTags]}` (object map). Per-field `errors` (B12 future scope) is array of `ValidationError` enum tags (NOT singular `error: string`). §6.11 stub remains a non-blocking spec-prose drift to be resolved via a separate footnote-style spec amendment.
- **Synth records share `declNode` with the compound parent.** Since synth cells have no underlying source AST decl (they're metadata, not AST insertions), the `record.declNode` field references the COMPOUND PARENT's decl node — the source-anchor for span-based diagnostics. The discriminant is `record.isSynthesized === true`.
- **Runtime-hook annotations per §55.7 line 24449-24461 (audit §1.5):** `isValid` and `errors` are pure-reactive (`runtimeHookKind: null`); `touched` is event-driven on bind:value/bind:checked change OR first focus-out (`runtimeHookKind: "touch"`); `submitted` is event-driven on form submit handler (`runtimeHookKind: "submit"`). B11 RECORDS the hook requirement; A1c codegen reads the annotation and emits the actual hook plumbing.
- **`submitted` is COMPOUND-LEVEL ONLY** per §55.7 line 24468 (audit §1.6). B12 (per-field surface) MUST NOT register per-field `submitted`.
- **E-SYNTHESIZED-WRITE join with B8's PASS 6** (audit §1.3 wave-ordering correction). The synth-write check runs FIRST in `checkExprNodeForMutations` and `checkReactiveNestedAssign` — if it fires, the derived-value-mutate path is short-circuited (E-SYNTHESIZED-WRITE is a more specific rule with distinct fix-advice from E-DERIVED-VALUE-MUTATE). Per-field scope is B12's extension (audit §1.3 — B12 will gain a fifth dispatch).
- **NO new DG edges** (Phase 0 finding (c)). B10 Phase 3 already wired cross-field `validator-reads` edges in S67; the rollup reactivity (compound's `isValid` reads each field's surface) is logically a consequence of synth-record annotations and is materialized by A1c codegen via the existing edge machinery. B11 emits zero edges into Stage 7.
- **Dev-child shadowing.** When a dev declares a compound child with one of the synth-property names (e.g., `<form><isValid>=true</>`), the dev's record wins; synth registration silently skips that name. The other three synth cells still register. Test §B11.14 codifies. Future tightening can convert to `E-SYNTH-NAME-COLLIDES` via a separate dispatch.
- **Walker bug surfaced + fixed during dispatch.** Initial implementation of `walkRegisterSynthSurface` had `return` instead of `continue` after the state-decl branch, which caused siblings AFTER a state-decl in a `for` loop to be skipped (e.g., `<count> = 0` followed by `<form>{...}` would leave the form without synth cells). The §B11.13 test in the dedicated B11 suite caught it before merge.
- **Public read APIs (audit §1.7 + dispatch §5):** `isSynthesizedCell(record): boolean` and `getSynthRecords(compoundDecl): StateCellRecord[]` (returns the 4 synth records in `COMPOUND_SYNTH_PROPERTIES` order: `[isValid, errors, touched, submitted]`). Constants `SYNTH_PROPERTY_NAMES: ReadonlySet<SynthProperty>` and `COMPOUND_SYNTH_PROPERTIES: readonly SynthProperty[]` are stable exports.

**B12 specifics (load-bearing for A1c codegen + IDE autocomplete + B22 reset):**

- **Trigger is "compound CHILD that is NOT itself a compound parent"** (audit §1.1 substantive — SCOPE B12 row "per validator-tagged child cell" was narrower than §55.6). PASS 8's `registerCompoundSynthSurface` walks every child of a compound parent; non-synth, non-compound-typed children get a fresh `kind:"field"` `Scope` attached as `declNode._scope` and three synth records (`{isValid, errors, touched}`) registered into it. Validator presence is irrelevant — predictability per L11 Edge B + §55.6 line 24445-24447.
- **`submitted` is NOT a per-field property** per §55.7 line 24468 + audit §1.6. `PER_FIELD_SYNTH_PROPERTIES` is the 3-tuple `["isValid", "errors", "touched"]`; `COMPOUND_SYNTH_PROPERTIES` (B11) remains the 4-tuple. Lookup of `@form.field.submitted` correctly returns `null` (the field-scope holds no `submitted` record).
- **Compound-typed child gets NO duplicate per-field surface.** When a compound child is itself a compound parent (e.g., `<form><address><street>...</></>`), B12 SKIPS per-field registration on `address`. The compound-level synth on `address`'s `kind:"compound"` scope (B11) IS the per-field surface for that path. The two interpretations coincide.
- **`lookupQualifiedStateCell` extension (load-bearing for B12 + B22 + A1c codegen + IDE).** Previously required every intermediate segment to be `isCompoundParent`. B12 RELAXES this: descent works through ANY cell with a `_scope` attached. B11 attaches `kind:"compound"` scopes on compound parents; B12 attaches `kind:"field"` scopes on compound children. Both descended uniformly.
- **E-SYNTHESIZED-WRITE per-field firing — no new walker.** B11's `checkSynthAssignFire` and `checkSynthNestedAssignFire` (PASS 6 join points) had a guard `if (!hit.record.isCompoundParent) return false;`. B12 RELAXES this to discriminate: compound-parent receiver → fires for all 4 properties; compound-child receiver → fires for 3 properties (excludes `submitted`).
- **`parentField` discriminant.** B11 synth records carry `parentCompound` only; B12 per-field synth records carry BOTH `parentField` (the field cell — B12 discriminant) AND `parentCompound` (the enclosing compound — convenience for codegen ergonomics).
- **`declNode` anchors at the FIELD's decl (not the compound's).** B12 anchors per-field-synth records at the field's decl node — the right error-reporting anchor for `@form.email.isValid = false`-style writes.
- **NO new DG edges** (mirrors B11 stance). B10 Phase 3 already wires cross-field `validator-reads` edges; per-field reactivity is materialized by A1c codegen via existing edge machinery.
- **Multi-field compound — independent per-field surfaces.** Each field gets its OWN `kind:"field"` scope (distinct object). Three fields → three field-scopes → nine total per-field synth records (3 props × 3 fields).
- **Public read APIs:** `getPerFieldSynthRecords(fieldDecl): StateCellRecord[]` (returns 3 records in `PER_FIELD_SYNTH_PROPERTIES` order: `[isValid, errors, touched]`; returns `[]` for non-field cells, compound parents, top-level cells, null/undefined). `PER_FIELD_SYNTH_PROPERTIES: readonly SynthProperty[]` is a stable export. `isSynthesizedCell` (B11 API) discriminates per-field synth records too.

**B13 specifics (load-bearing for A1c codegen `messageFor` short-circuit + L12 Edge F i18n extraction):**

- **Two responsibilities, single walker pass per audit §1.2.** PASS 9 walks every state-decl. If `isConst:true && validators.length > 0` → fire E-DERIVED-WITH-VALIDATORS (one per cell, listing offending validator names, recommending refinement-type alternative per §55.14 line 24692). Otherwise (non-derived) → for each validator, extract Level-1 inline override onto `validator.inlineOverride` and fire E-VALIDATOR-INLINE-DYNAMIC if the override slot is populated by a non-string-literal expression.
- **Per-arg-split landed in this dispatch (audit §1.5 + §3 ownership transfer).** Pre-B13, ast-builder.js joined call-form validator args into a single raw string. B13 splits at top-level commas (parenDepth === 1, bracketDepth === braceDepth === 0) so `length(>=2, "Must be at least 2 chars")` arrives as 2 distinct ValidatorArg entries. `oneOf([.A, .B])` keeps array-internal commas intact (bracketDepth > 0). `parseValidatorArg` gained a `slotIndex` parameter so the relational-predicate sub-grammar fires ONLY on slot 0 of `length(...)` — subsequent slots parse as standard expressions (string literals expected for inline overrides).
- **B10's previously-skipped tests activated.** `validator-type-check.test.js:172` (`min(0, "msg", "extra")` arity violation) and `:196` (`min(18, @minAge)` non-string-literal trailing arg) were `.skip` pending per-arg-split; B13's split unblocks B10's already-wired branches. Both tests now pass.
- **Engine state-cell pass-through per §55.14 (audit §1.5).** Engine auto-declared cells are NOT `isConst`; the walker's `isConst:true` predicate skips them silently. Engine-derived (`<engine derived=expr>`) WITH validators is REJECTED by §55.14 but requires engine-decl annotations not yet present (B14 sequencing) — deferred to B13.5/B14 follow-up.
- **Refinement-type alternative recommended in error message** per §55.14 line 24692. The E-DERIVED-WITH-VALIDATORS message includes "Did you mean a refinement type? `const <NAME>: number(>=0) = ...`" so the dev sees the spec-canonical fix inline.
- **Dual-firing of E-TYPE-031 + E-VALIDATOR-INLINE-DYNAMIC tolerated.** When a dynamic inline override appears (`min(18, @cell)`), PASS 7 fires E-TYPE-031 (catalog shape check) AND PASS 9 fires E-VALIDATOR-INLINE-DYNAMIC (more-specific). Codegen takes the more-specific one; tests tolerate both. A future tightening could short-circuit PASS 7 when the catalog signals the slot is `inline-message-override`.
- **Spec-prose follow-ups landed** (audit §1.1 + §4): SPEC §55.14 footnote `[^55-14-parse-time]` clarifies that "parse-time" is operational shorthand for A1b firing — parallel to the §6.6.8 / §6.6.10 footnote convention. SPEC §34 catalog row added for E-VALIDATOR-INLINE-DYNAMIC. §55.15 short-form catalog row added.
- **Wave 3 closer.** With B11 + B12 + B13 landed, the validator + validity-surface wave (B9–B13) is functionally complete pending the B14 engine-derived edge case.

**B14 specifics (load-bearing for B15/B16/B17 + A1c codegen + cross-file engine import per M18):**

- **Option C hybrid registration** (audit §1.1) — engine cells join the StateCellRecord family with a new `_cellKind: "engine"` value (5th in the union: `plain | bindable | markup-typed | compound-parent | engine`). Engine-specific data lives on the sibling `engineMeta: EngineMetadata` field. Single registration mechanism for ALL reactive cells; downstream consumers (B3 `@name` resolution, B7 dep-tracker, B11/B12 synth surface) work through the same StateCellRecord shape. PASS 10.A (`walkRegisterEngines`) handles engine-decl nodes specifically; B5's `classifyStateDecl` is unchanged (it only sees `state-decl`, not `engine-decl`).
- **Forward-compatible `EngineMetadata` shape per audit §2 brief #1.** BASIC fields populated by B14: `forType`, `variants[]` (empty at B14; B15 populates from type-system), `initialVariant` (RECORD only — B15 validates), `derivedExpr` (RECORD only — B16 consumes; legacy `sourceVar` carry-over), `varName`, `isExported`, `isPinned`. A7 hierarchy fields (per §51.0.M-Q) are DECLARED in the type but `null`/`undefined` at B14: `parentEngine`, `innerEngines`, `historyAttr`, `internalRules`, `parallelAttr`, `onTimeoutElements`. Future A5-2/A5-3 dispatches populate them without type-system churn.
- **`autoDeriveEngineVarName(typeName)` per §51.0.C literal rule** (audit §1.2). Lowercase first character only; rest unchanged. `MarioState` → `marioState`, `URL` → `uRL` (literal). Audit §1.2 flagged the all-uppercase edge case as a potential spec amendment (could enumerate contiguous-uppercase-run rule); B14 implements the literal spec — the amendment is a separate non-blocking footnote follow-up.
- **`var=NAME` override supersedes auto-derive.** When `var=` is present on the engine opener, the override IS the variable name; auto-derive is bypassed. Legacy `name=` is preserved as the third resolution path for back-compat with pre-§51.0 source. Resolution order: `var=` → `name=` → auto-derive from `for=Type` → fallback empty (parser-failure case, downstream surfaces).
- **Engine declaration syntax extensions in ast-builder** (canonical §51.0.B). engine-decl AST node now carries: `varName: string`, `varNameOverride: string | null`, `initialVariant: string | null`, `pinned: boolean`, `isExported: boolean` — alongside the legacy `engineName`, `governedType`, `rulesRaw`, `sourceVar`. The `engineName` field is back-filled with `varName` when only `for=` is present (so legacy codegen + NR consumers continue working transparently).
- **`export <engine ...>` Form 1** mirrors the channel-export Form 1 pattern (component Form 1 cousin). Detection in `liftBareDeclarations`: text block ending in trailing `export` paired with the next state-form (or BS-classified markup-form) block whose name is `engine`/`machine` → tag the block with `_b14IsExport: true`. The flag flows to engine-decl construction as `isExported: true`. NB: the BS classifier emits engine blocks as either `markup` or `state` depending on opener form; the detection accepts both since `liftBareDeclarations` runs BEFORE the buildBlock normalization at `_STATE_FORM_LIFECYCLE`.
- **MOD's exportRegistry engine-aware extension.** `buildExportRegistry` (`compiler/src/module-resolver.js`) now walks `file.ast.machineDecls` for engines with `isExported: true` and pushes them into the file's exports as `{kind: "engine"}`. The kind→category mapping recognizes `kind === "engine"` → `category: "engine"` (distinct from `user-component`, `channel`, etc.). This closes the audit §1.3 wave-ordering concern AND the primer §13.7 B4 specifics deferral note ("Form 1 `export <engine var=…>` desugars to `export const`, indistinguishable from arbitrary const today").
- **`pinned` import policy update for engines.** B4's `B4_IMPORT_PINNED_FIRE_KINDS` set is unchanged (`function`, `fn`, `type`, `channel`); engines fall through to ACCEPT. With MOD's engine-awareness landed, an `import { engineName pinned } from './engines.scrml'` is now correctly accepted because the source export's `kind === "engine"`. Comment block + table updated to reflect.
- **PASS 10.B cross-file engine mount validation** (`walkValidateCrossFileEngineMounts`). Walks markup for self-closing tags; for each tag matching an import-binding, looks up the source export's category. Engine-category → no diagnostic. Non-engine, non-`user-component` → fires `E-ENGINE-MOUNT-NOT-ENGINE` (NEW §34 catalog row, S68 — A1b B14). User-component mounts are SUPPRESSED — those are CE/NR territory (component instantiation), not engine mounts. Skipped silently when no exportRegistry is supplied (test-harness path).
- **DEFERRED to B17: E-COMPONENT-ENGINE-SCOPE fire-site** (audit §1.5). The audit recommended B14 fire it directly when an engine-decl is found inside a component-def body. Today's AST stores `component-def.raw: string` (raw text, not walkable), so engine-decls inside component bodies are not present as walkable children. The check is OWNED by B17 with a structural component-body parse precondition. The walker shape is ready — once component bodies become walkable, the same `walkRegisterEngines` can fire the diagnostic.
- **Tests:** 36 unit tests covering AST-builder syntax acceptance (§51.0 form, var=, initial=, pinned, legacy name=, export Form 1), `autoDeriveEngineVarName` edge cases (URL → uRL, single-letter, lowercase-leading, empty, underscore-leading), SYM PASS 10.A registration (record fields, `_cellKind: "engine"`, engineMeta surface, var= override, legacy back-compat, A7 forward-compat field shape), E-ENGINE-VAR-DUPLICATE collision branches, PASS 10.B cross-file mount validation (engine accepts, function/channel fires, user-component suppressed, no-registry skips, HTML pass-through), engineMeta surface (derivedExpr null for non-derived, variants empty pre-B15, isExported flow). Test count delta: +36; full suite 9357 / 0 fail / 52 skip / 1 todo.

**B15 specifics (load-bearing for B16/B17 + A1c codegen + future state-child-body parser tightening):**

- **PASS 11 walker** (`walkValidateEngineStateChildrenAndRules`). For each engine-decl carrying a `_record` (set by B14's PASS 10.A), populates `engineMeta.variants` from `ast.typeDecls[]`, parses state-children from `engine-decl.rulesRaw` via `parseEngineStateChildren` (engine-statechild-parser.ts), then validates per §51.0.E + §51.0.F. Five new diagnostics + one warning, all with NEW §34 catalog rows (S68 — A1b B15): `W-ENGINE-INITIAL-MISSING` (lint, non-derived only), `E-ENGINE-INITIAL-INVALID-VARIANT`, `E-ENGINE-STATE-CHILD-MISSING`, `E-ENGINE-STATE-CHILD-INVALID-VARIANT`, `E-ENGINE-RULE-INVALID-VARIANT`, `E-ENGINE-RULE-LEGACY-SYNTAX`.
- **`engineMeta.variants` populated by B15 (B14 left empty).** B14 explicitly leaves `variants: []` per audit §2 brief #1 ("B15 populates from type-system"). Local helper `parseEnumVariantNamesFromRaw` (in symbol-table.ts) walks `ast.typeDecls[]`, finds the matching enum, and parses variant names. Splits on `\n` / `,` / `|` at depth 0 (paren-aware), strips payload `(...)` + `renders ...` suffix, validates PascalCase. **Why local helper, not `meta-checker.ts:parseEnumVariantsFromRaw`:** that function only splits on `|`, missing the canonical `,` / `\n` separators per SPEC §14.4. **Why not the type-system's `parseEnumBody`:** TS pass runs LATER than SYM (per `compiler/PIPELINE.md`); SYM cannot consume the typeRegistry that TS produces. Local helper mirrors `parseEnumBody`'s variant-extraction logic minus payload + transitions resolution.
- **`engineMeta.stateChildren` populated by B15.** New `EngineStateChildEntry { tag, rule: EngineRuleForm, bodyRaw, rawOffset }` shape; `EngineRuleForm` is a 6-form discriminated union (`single` / `multi` / `wildcard` / `absent` / `legacy-arrow` / `parse-error`). The parser handles single-target (`rule=.X`), multi-target (`rule=(.A | .B)`), wildcard (`rule=*`), absent (terminal state), legacy event-arrow (`rule="event -> Variant"` — flagged), and parse-error (unrecognized syntax — diagnostic-bearing). Self-closing state-children (`<Tag/>`), `:`-shorthand bodies (parser-level support; see BS limitation note), and explicit closers (`</>`, `</Variant>`) all recognized. Nested PascalCase tags + `${...}` interpolation skipped via depth tracking.
- **`isLegacyArrowRulesBody` heuristic** (engine-statechild-parser.ts). Detects legacy `<machine>` arrow-rule bodies (`.From => .To`) — heuristic: presence of `=>` AND absence of `<Uppercase` opener. Such bodies SKIP state-child parsing (the legacy form is type-system territory via `parseMachineRules`), preserving B14 test compatibility. `initial=` validation runs INDEPENDENTLY of body form per §51.0.E — legacy bodies still fire W-ENGINE-INITIAL-MISSING / E-ENGINE-INITIAL-INVALID-VARIANT.
- **Variant-set fallback.** When `engineMeta.variants === []` (type unresolved, struct, or import-not-yet-resolved), B15 SKIPS exhaustiveness + variant-membership checks (cannot validate against an unknown set) but still fires structural diagnostics (legacy-arrow detection, parse-error) since those are variant-independent. `initial=` validation also adapts: W-ENGINE-INITIAL-MISSING fires regardless (the variants might exist; we just can't see them); E-ENGINE-INITIAL-INVALID-VARIANT requires variants > 0 to fire (avoids false-positive on unresolved types).
- **DEFERRED — Compile-time E-ENGINE-INVALID-TRANSITION for direct writes inside state-child bodies** (BRIEF §4 point #4 + audit §1.4). Today's AST stores state-child bodies as raw text (`bodyRaw: string`, not walkable AST nodes); the body-walking dispatch needed to detect `@engineCell = .Variant` or `@engineCell.advance(.X)` writes inside is structurally absent. Same deferral pattern as B14's E-COMPONENT-ENGINE-SCOPE (component bodies are also raw text). Walker shape is READY — once state-child bodies become walkable AST nodes, the same PASS 11 walker dispatches on the engine variable's `_resolvedStateCell` annotation inside each state-child body. The existing §34 row E-ENGINE-INVALID-TRANSITION (line 14230) already covers the runtime tier; the compile-time fire when added extends the existing row's coverage.
- **DEFERRED — `:`-shorthand body in BS.** The state-child parser handles `:`-shorthand correctly (parser-level test codifies the contract), but BS currently DROPS engine blocks containing `:`-shorthand bodies (verified empirically). Per SPEC §51.0.I (Move 15) `:`-shorthand IS canonical for state-children, but BS support is pending. Workaround in B15 tests: explicit-closer form (`<X rule=.Y></>`) which BS supports today. When BS gains `:`-shorthand support, PASS 11 needs no changes.
- **Reusability with B14 + downstream.** B15 READS B14's `engineMeta.{forType, varName, initialVariant, derivedExpr}` and EXTENDS the structure with `variants` (populated) + `stateChildren` (new field). B16 reads `engineMeta.derivedExpr` for derived-engine cycle detection (E-DERIVED-ENGINE-CIRCULAR via B7 reuse) AND now `engineMeta.variants` + `engineMeta.stateChildren` for derived-engine specific rejections. A1c codegen reads `engineMeta.{variants, initialVariant, stateChildren}` for the engine state machine emission.
- **Tests:** 43 unit tests covering parser internals (`parseRuleAttrValue` six forms, `isLegacyArrowRulesBody` heuristic, `parseEngineStateChildren` end-to-end with self-close / explicit-close / `:`-shorthand / multiple children / legacy-arrow detection) + PASS 11 walker integration (`initial=` validation in three branches × non-derived + derived; exhaustiveness with all-covered / missing / unknown-tag; rule= form validation single / multi / wildcard / absent / legacy-arrow / parse-error; engineMeta annotations; legacy arrow-rule body skip + initial= validation through legacy body). Test count delta: +43; full suite 9400 / 0 fail / 52 skip / 1 todo.

**B16 specifics (load-bearing for A1c codegen + future Move-14 ast-builder):**

- **Engine cells join DG as `reactive` nodes via `_record.engineMeta.varName`.** B7's read-edge graph and B10's validator-edge graph were cell-only; B16 unifies engine cells into the same node kind so cross-class cycle traversal works (e.g., a derived cell reads a derived engine that derives from a derived cell). The DG node `kind: "engine"` was considered but rejected — keeping `"reactive"` lets B7's existing infrastructure (`reactiveVarNodeIds`, `reactiveVarReaders`) work unchanged.
- **Two-tier B16 firing.** DG-side fires E-DERIVED-ENGINE-CIRCULAR on BOTH legacy (§51.9) AND Move-14 (§51.0.J) forms — cycles are illegal regardless of authoring shape. SYM-side rejection trio fires ONLY on Move-14 form per `lookupDerivedEngineMeta`'s `legacy-source-var` guard. The legacy form has its own write-rejection (E-ENGINE-017) and its own legitimate `=>` body shape (projection-rule mapping per §51.9.2).
- **`derivedExpr.kind === "legacy-source-var"` is the gate.** B14 wraps `engine-decl.sourceVar` (legacy `derived=@varname` parser output) as `{ kind: "legacy-source-var", varName }`. When ast-builder learns the §51.0.J `derived=match @x { ... }` form, it'll set `derivedExpr` to a parsed ExprNode (or a discriminant other than `"legacy-source-var"`). At that point the B16 SYM rejections fire automatically; the DG walker upgrades to `forEachIdentInExprNode` for multi-cell reads.
- **State-decl-shaped writes detected via `checkStateDeclForDerivedEngineWrite`.** scrml's parser surfaces `@var = expr` in function bodies as a `state-decl` node (no separate assignment-statement kind). The walker pattern-matches state-decl `name === <derived-engine-var>` and fires NO-WRITE — mirrors `rejectWritesToDerivedVars` (legacy E-ENGINE-017 path).
- **B16 is the SECOND consumer of B7's reusability promise.** B10 was the FIRST (validator-args, S67); B16 is the SECOND (engine-derived, S68). The pattern (`buildXAdj` filter + edge-kind enum addition + `detectCycle` reuse) is now established for future cycle-class additions.
- **Renumbered to PASS 12** during S68 file-delta merge. B16's worktree branched from pre-B15 base and originally numbered as PASS 11; PA renumbered call site to PASS 12 to sit cleanly after B15's PASS 11. Walker functions themselves are independent — no logic conflict with B15.

**B17 specifics (load-bearing for components-vs-engines distinction M20 + future component-body markup parser):**

- **Phase 0 finding (foundational).** Of the 8-point B17 audit brief (effect= validation, `<onTransition>` placement + direction attributes, `<onTransition>`/`effect=` forbidden in `<match>` arms, E-COMPONENT-ENGINE-SCOPE residual fire-sites, `<onTimeout>` deferred to A5-2/A5-3, etc.), ALL items 1-5 + 7 are DEFERRED — the underlying AST surfaces are not parsed today. The §51.0.F engine state-child syntax (`<Small rule=.Big effect=...>`) has no parser path; engine bodies remain `engine-decl.rulesRaw: string` consumed by `parseMachineRules()` under the legacy `.From => .To` arrow grammar. The §51.0.H `<onTransition>` element is registered in spec §4.15 but is NOT tokenized as a structural element. Block-form `<match for=Type on=expr>` is also unparsed. Component-def stores body as `component-def.raw: string` (not walkable AST). See `scrml-support/archive/changes/phase-a1b-step-b17-ontransition-component-engine/SURVEY.md` for the precondition catalog.
- **Single actionable B17 fire-site (per Phase 0).** PASS 13 (`walkRejectEnginesInComponentDefChildren`) walks the AST tree mirroring PASS 10.A's recursion shape; for every `component-def` with a `defChildren` array, fires `E-COMPONENT-ENGINE-SCOPE` per §51.0.K + §34 on each child whose `kind === "engine-decl"`. Recurses into each defChild so nested component-defs are also inspected. The diagnostic message includes the component name, the engine's `var=` / governed-type label (with graceful fallback when both are absent), and spec-canonical remediation hints (file-scope engine + `<EngineName/>` mount, OR plain reactive cells `@cell` for per-instance state).
- **End-to-end via parser is NOT currently reachable.** Per `compiler/src/ast-builder.js` line 9149-9151: "engine-decl nodes are children of markup (program), not logic." Logic-body is where `defChildren` consumption happens. Therefore engines never reach `defChildren` via the parser today. The walker is defensive scaffolding — when the precondition (component-body markup parser, OR a future engine-decl placement relaxation) lands, the walker is already correct. Synthesized AST tests verify firing today; end-to-end tests are `.skip`-ed pending preconditions.
- **No new §34 catalog row.** B17 reuses the existing `E-COMPONENT-ENGINE-SCOPE` (line 14239). The B14 specifics block above noted "DEFERRED to B17: E-COMPONENT-ENGINE-SCOPE fire-site" — B17 partially closes that deferral (defChildren-form). The `raw` markup body fire-site remains deferred until the component-body markup parser lands.
- **Walker recursion — defChildren is NOT in PASS 10.A's recursion set.** PASS 10.A descends into `node.children` / `node.body` / `node.consequent` / `node.alternate` / `node.arms[].body`. It does NOT descend into `node.defChildren`. So if engines DID somehow reach a defChildren array (today they don't via parser), PASS 10.A would NOT register them. PASS 13 fires the diagnostic instead — surfacing the violation as a hard error rather than silently dropping the engine.
- **Tests:** 9 active synthesized-AST tests (PASS 13 walker correctness — single + multiple + nested defChildren cases, var= surface in message, malformed-AST graceful fallback, recursion-via-tree-vs-ast.components, recursion-via-parent-body) + 8 `.skip` deferred end-to-end tests (component `raw` body, mount tags, `effect=`, `<onTransition>` placement / direction attrs / inside `<match>`).
- **Renumbered to PASS 13** during S68 file-delta merge. B17's worktree branched from B14 base and originally numbered as PASS 11; PA renumbered call site to PASS 13 to sit alongside B15's PASS 11 + B16's PASS 12.
- **DEFERRED to follow-up steps.** When parser preconditions land — block-form `<match>` parser, engine state-children parser (§51.0.F), `<onTransition>` element tokenization (§4.15 / §51.0.H), component-def body markup parser — the deferred B17 work activates with tests already authored (`.skip` removed). Recommended naming for new §34 catalog rows: `E-ONTRANSITION-NO-DIRECTION`, `E-ONTRANSITION-INVALID-VARIANT`. Match-arm `effect=` / `<onTransition>` reuse the existing `E-MATCH-EFFECT-FORBIDDEN` (line 14226) + `E-MATCH-ONTRANSITION-FORBIDDEN` (line 14227) — those are the more precise codes per §18.0.2 (the original BRIEF table named `E-STRUCTURAL-ELEMENT-MISPLACED` for the match-arm cases; the §18.0.2-specific codes are canonical).

**B22 specifics (load-bearing for A1c codegen reset-lowering + future spec-amendment of §6.8.2 multi-level):**

- **Closes A1a Step 9's deferred validation.** Step 9 (`compiler/src/expression-parser.ts:1142-1196`) lifts bare-callee `reset(...)` calls into `reset-expr` AST nodes with a permissive `target: ExprNode` (any shape accepted). The Step 9 docstring (`compiler/src/types/ast.ts:1670-1674`) explicitly defers shape validation to A1b. B22 PASS 14 closes that loop.
- **Three canonical shapes accepted (per §6.8.2 line 4848-4853):** `reset(@cell)` (bare top-level cell or compound parent — distinguished only by record kind, not by walker), `reset(@compound)` (alias for the above when the cell is a compound parent), `reset(@compound.field)` (single-level compound nav).
- **Multi-level compound nav (`reset(@a.b.c.d`)) is ALSO accepted** per Phase 0 SURVEY decision (`scrml-support/archive/changes/phase-a1b-step-b22-reset-target-shape/SURVEY.md`). Rationale: §6.3.5 ("V5-Strict Composition in Compound Cells") establishes recursive-composition as the V5 invariant, and B12's `lookupQualifiedStateCell` extension descends through any cell with `_scope` (arity-N already). Rejecting multi-level would create an anti-symmetry with READ access — `@a.b.c.d` is legal anywhere else in the language. SPEC-PROSE FOLLOW-UP recorded in B22 progress.md: §6.8.2 amendment in this commit normatively allows multi-level paths.
- **`@`-prefix is shape-required, leaf-resolution is NOT.** A bare `@cell` IdentExpr target where B3 stamped `_resolvedStateCell: null` (unknown-name case) does NOT fire E-RESET-INVALID-TARGET — that's a name-resolution concern (B3's null marker; future tightening dispatch will surface as E-SCOPE-001). Same for `@a.b.c` MemberExpr where `lookupQualifiedStateCell` returns null at the leaf. B22 stays silent on resolution issues, fires only on shape issues.
- **Diagnostic-skip on already-diagnosed nodes (no double-fire).** If the `reset-expr` carries a parse-time `diagnostic` (E-RESET-NO-ARG path — zero-arg, multi-arg, spread), B22 SKIPS that node. The parser has already surfaced the error (via the ast-builder wrapper); double-reporting on the synthesized undefined-literal target would be noise.
- **`obj.reset(x)` (member-call form) is NEVER a reset-expr.** Step 9's lift is bare-callee-only (§R9.7 regression test). B22 never sees member-call forms — those stay as ordinary `call` nodes and are handled by user-code semantics, not the keyword.
- **Walker reuses `forEachResetExprInExprNode`** (`compiler/src/expression-parser.ts:2538`) which recurses the full ExprNode tree. The PASS 14 outer walker mirrors PASS 13 / PASS 6 structural recursion (children/body/consequent/alternate/arms[].body, scope-aware via state-decl `_scope` + function-decl `_scope`).
- **Optional-chain (`?.`) is rejected** as `E-RESET-INVALID-TARGET` (reason `optional-chain`). Semantics of "reset something that might not exist" are spec-undefined; reject upfront rather than ship a footgun.
- **New §34 catalog row added (S69):** `E-RESET-INVALID-TARGET`, severity Error, cross-ref §6.8.2. Sits alongside the existing `E-RESET-NO-ARG` row (line 14223).
- **Tests:** 25 active end-to-end tests via `splitBlocks` → `buildAST` → `runSYM` pipeline (positive cases for all three canonical shapes + multi-level; negative cases for literal/call/binary/ternary/unary/non-`@` ident root/non-`@` member root/nested-reset; pass-through for E-RESET-NO-ARG; member-call form integration; diagnostic message quality + SPEC cross-refs + span integrity).
- **No `.skip` follow-ups** — B22 ships its full scope today. SPEC-PROSE FOLLOW-UPS (recorded for PA): (1) §6.8.2 line 4848-4853 has been amended in this commit to normatively cover multi-level (per Phase 0 decision); future PA may revisit if a stricter policy is desired.

**B19 specifics (load-bearing for v0.next channel migration M19 + future TAB `@shared` tightening):**

- **Two independent sub-walks share PASS 15.** `walkChannelPlacement` walks markup tree carrying `markupDepth: number` (count of markup ancestors). When `node.kind === "markup" && node.tag === "channel"` is reached at depth >= 1, fires `E-CHANNEL-INSIDE-PROGRAM`. Top-level (depth 0) channels are allowed per §38.1 line 15422. `walkSharedModifier` walks every AST node visiting `state-decl` nodes; fires `E-CHANNEL-SHARED-MODIFIER` on `isShared: true` regardless of containing context per §38.4 line 15468 + §38.9 line 15670 ("inside (or outside) a channel body").
- **`component-def` counts as a markup-ish ancestor.** `walkChannelPlacement` increments `markupDepth` on descent through `markup` AND `component-def` nodes — a channel inside a component-def's `defChildren` is also non-top-level placement and fires E-CHANNEL-INSIDE-PROGRAM. Channels never appear inside logic-blocks via the parser (channels are markup, logic is `${...}`); recursion into `body` happens defensively without depth increment.
- **TAB `@shared` capture.** `@shared <name> = init` produces `state-decl{ kind: "state-decl", name, isShared: true, shape: "plain", structuralForm: false, isConst: false }` per ast-builder.js lines 3947-3966 (logic-block parser) and 5823-5841 (alternate path). The structural form `<x> @shared = init` does NOT exist in any parser branch — `@shared` is exclusively the legacy `@`-prefix-modifier form. Malformed `@shared` (no init) falls back to `bare-expr`. **Pre-existing TAB quirk surfaced by B19:** `collectExpr()` greedily consumes through newlines, so a sequence like `@shared a = 0\n@shared b = 0` only stamps `isShared:true` on the FIRST line; subsequent lines become other node kinds (often `tilde-decl`). Only one B19 fire per such block. Semicolons (`@shared a = 0; @shared b = 0`) or separate `${...}` logic blocks each cleanly produce independent `state-decl{ isShared: true }` nodes — three fires when warranted. B19 fires on whatever the parser produces; the spec's "any occurrence SHALL emit" mandate is satisfied for unambiguous shapes. Future TAB tightening (separate dispatch, NOT B19) could fire on every `@shared` token regardless of subsequent parser state.
- **Diagnostic message fixed wording.** Both messages reference §38.1 / §38.4 + §34, name the offending construct (channel `name=` value when extractable from a static-string-literal attr; cell `name` for state-decls), and recommend the spec-canonical fix (file-level sibling-of-`<program>` placement; V5-strict structural form `<name> = init` inside a channel body, or `<name> = init` / `@name = init` outside). Test §B19.8 codifies the message-shape contract.
- **B3 cross-scope channel-cell access is unaffected.** Channel-body logic blocks (`${...}` inside a channel body) do NOT introduce a new SYM scope — the cell registers in the file scope (per B1's PASS 1 walker descending into `markup.children` + `logic.body`). B3's PASS 3 `@cellName` resolution sees them via the standard `lookupStateCell` parent-chain walk. B19 does NOT touch B3's resolution logic. Test §B19.10 verifies: `<channel name="chat">${ <messages> = [] }</>` paired with `<program>${ const n = @messages.length }</program>` fires no B19 errors AND `sym.fileScope.stateCells.has("messages") === true`.
- **No new §34 catalog rows.** Both `E-CHANNEL-INSIDE-PROGRAM` (line 14251) and `E-CHANNEL-SHARED-MODIFIER` (line 14252) already exist post-D3 / S58. B19 closes the validation-gate deferral D3 left open.
- **6 test-fixture migrations** to v0.next V5-strict file-level form: p3a-cross-file-multi-page-broadcast, p3a-pure-channel-file, p3a-name-collision-error, p3a-diagnosis, p3a-chx-same-file-passthrough (also removed §5 "channel-inside-div" — that shape is now an error per §38.1; coverage migrated to B19 §B19.3), p3a-chx-cross-file-inline (also renamed test "with @shared" → "mutates a channel-body cell"). Migration was mechanical: `@shared <name>: T = init` → `<name>: T = init` (or `<name> = init` when no type); nested `<program><channel>...</></program>` → top-level `<channel>...</></><program>...</program>`. No spec-prose changes needed.
- **Sample/example corpus DEFERRED migration.** `samples/compilation-tests/gauntlet-s20-channels/channel-shared-state-001.scrml` + `examples/08-chat.scrml` + `examples/15-channel-chat.scrml` + `examples/23-trucking-dispatch/...` retain v1 shapes but are NOT driven through SYM in any active test. No regression. Future curation pass can migrate.
- **Renumbered to PASS 15** during S69 file-delta merge. B19's worktree branched pre-B22; agent originally numbered as PASS 14. PA renumbered call site to PASS 15 to sit after B22's PASS 14 in the parallel small-bundle dispatch ordering.
- **Tests:** 14 unit tests in `compiler/tests/unit/channel-placement-shared-b19.test.js` covering top-level placement (no fire), nested-in-program fire, deeper nesting fire, V5-strict body acceptance, `@shared` inside channel fire, `@shared` outside channel fire (per §38.4 line 15468), multi-violation fan-out, message-shape contract, span attachment, and the file-level + cross-scope `@cellName` regression baseline (B3 unaffected). Test count delta: **+14 pass / +44 expect calls / 0 skip / 0 fail / 0 todo**.

**B18 specifics (load-bearing for L19 multi-statement-handler restriction + future BS `:`-shorthand tokenization):**

- **Two fire-sites, two stages.** Fire-site #1 (markup-attribute) lives at TAB time in `compiler/src/ast-builder.js` markup branch (around line 8365), AFTER `parseAttributes` returns. The reason: by the time the AST is built, the tokenizer's silent skip of `;` between attributes (tokenizer.ts lines 498-499) has already happened; the diagnostic must inspect `block.raw` directly to see the `;`. Fire-site #2 (engine state-child `:`-shorthand body) lives in SYM PASS 11 (`validateEngineStateChildrenAndRules` in `compiler/src/symbol-table.ts`), as a final loop AFTER rule= validation. Reason: the `EngineStateChildEntry` already exists post-B15 and carries `bodyRaw`; B18 just adds the `isColonShorthand: boolean` flag and a `;`-scan check.
- **Helper module is the unification primitive.** Both fire-sites call into `compiler/src/multi-statement-scan.ts`'s `scanForTopLevelSemicolon(text): SemicolonHit[]`. The helper tracks paren / brace / bracket depth, single / double / backtick string state (with `\`-escape), line / block comments, and `${...}` template-literal interpolation depth (with nested-template support). The `${...}` exemption from SPEC §5.2.3 line 1144 falls out for free because `${` opens brace-tracked depth — `;` inside is never top-level. Helper-failure is wrapped in try/catch at fire-site #1 — any exception is a survivable degradation, NOT an AST-build break.
- **Attribute-owner mapping.** For each top-level `;` hit, fire-site #1 needs to know which attribute the `;` "belongs to." The mapping uses a local regex `([A-Za-z_][A-Za-z0-9_:\-]*)\s*=` over the opener slice; for each `;` at offset `k`, the owning attr is the latest `name=` whose `=` is at offset `< k`. This works robustly across `on:click`, `bind:value`, `onserver:foo`, etc. Only attribute names that pass `isEventHandlerAttrName` (`/^on[a-z]+$/i` OR `on:` / `onserver:` / `onclient:` prefixes) trigger the fire; other attrs (`class`, `title`, `bind:value`, `class:active`) are silently skipped even when their value contains a top-level `;`.
- **`onserver:*` / `onclient:*` channel handlers included.** The brief's "OUT OF SCOPE" carve-out for these was a hedge; per saved survey + this dispatch, the `isEventHandlerAttrName` predicate's prefix regex covers them via the same single-expression discipline (the spec rule is general — channel handlers ARE event handlers in the bare-form sense). §B18.15 codifies. Future channel-handler-specific argument-binding semantics (§38.6.1) are independent and live elsewhere.
- **`EngineStateChildEntry.isColonShorthand` flag** is the load-bearing surface for fire-site #2. The parser (`parseEngineStateChildren`) sets `true` when the body comes from the post-`:` text branch (around `engine-statechild-parser.ts` lines 343-356) and `false` for bare-body and self-closing forms. SYM PASS 11 reads this flag and conditionally fires E-MULTI-STATEMENT-HANDLER. Bare-body engines (`<Variant>...children...</>`) and self-closing (`<Variant/>`) are EXEMPT — multi-statement is legal in those bodies because they ARE sequences of children/logic.
- **BS-side `:`-shorthand tokenization gap (load-bearing for test methodology + future dispatch).** Today's block-splitter does NOT tokenize the canonical spec-form `:`-shorthand for engine state-children (`<Idle : startGame()>` per §4.14 — `:` INSIDE opener, body terminated by `>`). BS also chokes on the post-`>` `:` form (`<Idle> : startGame()`) when used as an engine state-child body — the bare `;` at markup level corrupts BS state and the engine block doesn't even form. Per the B15 test-file note (lines 26-31), parser support for `:`-shorthand was added in B15 but BS-side tokenization is pending. **Consequence:** B18 fire-site #2 cannot be exercised end-to-end via integration source today. Tests invoke `validateEngineStateChildrenAndRules` directly with synthetic engine-decls + parser-produced `EngineStateChildEntry.bodyRaw`. The parser IS verified to set `isColonShorthand` correctly via direct unit tests. When BS-side `:`-shorthand tokenization lands (future dispatch — outside B18 scope), full-pipeline integration tests activate without changing PASS 11. The spec is correct; the gap is implementation, not normative.
- **No new §34 catalog row.** `E-MULTI-STATEMENT-HANDLER` (line 14260) already exists from a prior spec dispatch. B18 closes the validation-gate that the prior spec/§34 work left open.
- **Tests:** 55 tests in `compiler/tests/unit/multi-statement-handler-b18.test.js` covering all 7 brief scenarios + edge cases. §B18.1-3 (allowed bare-call/assignment/single-expression), §B18.4 (multi-statement fires), §B18.5-7 (string/nested/`${...}` exceptions), §B18.8-10 (engine state-child `:`-shorthand multi-statement fires via direct validator invocation, single-expression allowed, bare-body/self-closing exempt), §B18.11 (multi-violation fan-out), §B18.12 (message-shape contract), §B18.13 (non-event attrs exempt), §B18.14-15 (`on:` / `onserver:` family), §B18.16 (helper + parser + predicate unit tests). Test count delta: **+55 pass / +97 expect calls / 0 skip / 0 fail / 0 todo**.
- **DEFERRED follow-ups.** (1) Match-block `:`-shorthand arm bodies (§18.0.1) — same shape as engine state-children pre-B15; parser yields raw text only. (2) Full-pipeline integration tests for fire-site #2 — gated on BS-side `:`-shorthand tokenization (above). (3) Compile-time named-function existence — resolver territory (B3-style); B18 only validates bare-form shape. (4) A1c codegen — `function(event){...}` wrapper lowering for bare-form (§5.2.1).

**B20 specifics (load-bearing for A1c codegen + future B20.b fn param/return positions + match-arm-payload-typed binding):**

- **Walker placement: type-system.ts annotateNodes** (NOT a new SYM PASS). Type info isn't populated until TS runs; helper `inferBareVariantsInExpr` is invoked from the `state-decl` and `let-decl`/`const-decl` cases with the LHS-derived `contextType`. When `contextType` is null/asIs/unknown OR a union-with-shared-variants → fire E-VARIANT-AMBIGUOUS; when `contextType` is a known enum and the variant is missing → fire E-TYPE-063; when it's a single enum (or single-declarer union) and the variant exists → silent.
- **Bare-variant AST shape: `IdentExpr { name: ".Variant" }`** (leading-dot preserved). Produced by S66 parser fix's placeholder unmask in `esTreeToExprNode`. The S69 B20 parser refinement extended `preprocessForAcorn`'s regex to a variable-length lookbehind `(?<![A-Za-z0-9_$\)\]"'`]\s*)\.\s*([A-Z][A-Za-z0-9_]*)` so bare-variants are recognized after `joinWithNewlines` token-spacing (`. Idle` post-tokenize) AND `MarioState . Fire`-style spaced member access is correctly EXCLUDED.
- **`shouldSkipExprParse` relaxation in `ast-builder.js`.** Previously skipped ANY leading-dot expression as method-chain continuation. Now skips leading-dot UNLESS followed by uppercase (i.e., bare-variant). Required for `.Variant`-only initializers like `<x>: T = .V` to reach the expression parser.
- **Match-arm payload binding parser (B20 fix; pre-existing latent bug surfaced).** AST-builder gained Form 1b for `match-arm-block`: `.VariantName(binding, ...) => { ... }`. Captures `payloadBindings: string[]` on the AST node. The typer's `match-arm-block` walker binds these names into the arm scope (type `tAsIs()` for B20; payload-type-aware binding is post-B20 territory) before walking the body. Without this fix, references to `n` inside `.Mushroom(n) => { @coins = @coins + n }` fired spurious E-SCOPE-001. Pre-B20, the body was unparseable (escape-hatch) and the typer silently skipped it — B20's parser fix exposed the issue, and B20's match-arm-block fix closes it.
- **`isArrayLikeArg` extended in `symbol-table.ts`.** Recognizes the new `kind:"array"` shape (`[.Admin, .Editor]` post-B20-fix parses cleanly; old escape-hatch `ParseError` shape preserved as defensive fallback).
- **Walker reuses `forEachIdentInExprNode`** (`compiler/src/expression-parser.ts:2200`) — the same generic ExprNode walker that B3, B8, B10's typer use. No new traversal infra.
- **Six §14.10 inference positions — coverage matrix:**
  - **Position 1** (LHS state-decl annotation `<x>: T = .V`) — **NET-NEW in B20.**
  - **Position 1b** (LHS let/const-decl annotation `let x: T = .V`) — **NET-NEW in B20.**
  - **Position 2** (previously-typed cell `@cell = .V`) — **DEFERRED.** SCOPE B20 row mentioned this; agent's Phase 0 deemed the type-lookup-on-AssignExpr-target path non-trivial in current code structure. Follow-up: walk `bare-expr` containing AssignExpr, look up target's `_resolvedStateCell.declNode.resolvedType`, invoke helper.
  - **Position 3** (function param `fn(.V)`) — **DEFERRED to B20.b.** Requires `FunctionType.params` upgrade (currently `unknown[]`).
  - **Position 4** (function return `return .V`) — **DEFERRED to B20.b.** Requires return-type capture at AST level.
  - **Position 5** (match `for=T` arm patterns) — **handled by exhaustiveness today.** Explicit ambiguity check (`E-VARIANT-AMBIGUOUS` in match-arm context) is §18.0.3 territory; deferred.
  - **Position 6** (engine `for=T initial=.V`) — **already covered by B15** (`E-ENGINE-INITIAL-INVALID-VARIANT`). B20 does not regress; B15's surface is preserved.
- **Compound-nav `@compound.field = .V` DEFERRED.** Requires compound-nav type resolution at the AssignExpr target — non-trivial in current code. Follow-up alongside Position 2.
- **No new §34 catalog row.** `E-VARIANT-AMBIGUOUS` (line 14233) and `E-TYPE-063` already exist. B20 introduces fire-sites at the §14.10 expression positions for both. **SPEC-PROSE FOLLOW-UP:** §34 row 14233 cross-references only §18.0.3; should be amended to also cite §14.10 (parallels B22's §6.8.2 cross-ref addition).
- **PA-debug arc (S69):** B20 first dispatch (agent `a54c4e8caafc5a14e`) hit API error mid-implementation — Phase 0 + helper + initial wiring committed but final integration broke 49 tests with the agent's `\s*` regex widening (too broad — matched `MarioState . Fire`). PA hands-on: variable-length lookbehind tightening + `isArrayLikeArg` extension for clean-array shape + match-arm-block payload binding parser + typer scope-bind. Reduced 49 fails → 0 across full 9599-test suite. Worktree branch `worktree-agent-adf572e6b1297bb85` retained for forensic.
- **Tests:** 20 active in `compiler/tests/unit/bare-variant-inference-b20.test.js` covering positions 1 (state-decl) + 1b (let/const-decl), positive resolves, ambiguous union with shared variants, no-context fires, unknown variant in known enum, nested expressions (ternary, array), non-enum context. Test count delta: **+20 pass / +43 expect calls / 0 skip / 0 fail / 0 todo**. Plus implicit regression coverage on Mario LSP (E-SCOPE-001 binding-scope) + B10 array-of-bare-variants validator + S22 payload-variants-match.

**B21 specifics (load-bearing for A1c codegen runtime-check elision + future fn param/return three-zone extension + L4 cross-loci predicate vocabulary unification):**

- **Walker placement: type-system.ts annotateNodes** (NOT a new SYM PASS). Predicated type resolution + zone classification require the type registry — they live alongside the existing `let-decl` / `state-decl` predicate handling at `type-system.ts:3997` and `:4131`.
- **AST shape (additive extension):** `predicateCheck = {predicate: PredicateExpr, zone: "static" | "trusted" | "boundary", sourceKind: "literal" | "predicated" | "arithmetic" | "unconstrained"}` is now written for ALL three zones (was: boundary-only). A1c codegen at `compiler/src/codegen/emit-logic.ts:477,496,674,689` continues to gate runtime-check emission on `zone === "boundary"`, so adding static + trusted annotations is non-breaking. Static/trusted annotations enable future A1c optimizations (trusted-zone elision marker recognition) + IDE tooling (refinement-type hints).
- **B21's load-bearing behavioral upgrade — scope-aware SourceInfo classification.** Pre-B21, `classifyLiteralFromExprNode` (`expression-parser.ts:2721`) returned only `literal | arithmetic | unconstrained` based on syntactic analysis of the init ExprNode. The `predicated` SourceInfo branch in `classifyPredicateZone` (`type-system.ts:1641`) was therefore unreachable from real AST code — only direct unit-test calls produced `kind: "predicated"` SourceInfo. **B21's new helper `upgradeSourceInfoForPredicatedIdent` (`type-system.ts` ~line 1656)** closes this gap: when the syntactic SourceInfo is `unconstrained` AND the init ExprNode is a single non-bare-variant non-tilde `IdentExpr`, looks up the ident in the scope chain. If bound to a predicated-typed variable (`ScopeEntry.kind === "variable"` with `resolvedType.kind === "predicated"`), upgrades SourceInfo to `{kind: "predicated", predType: ...}` so `predicateImplies` (T-PRED-4) decides trusted vs boundary at the call site.
- **Conservative upgrade: literals + arithmetic + non-IdentExpr RHS preserved.** A literal value is statically known and supersedes any source-type info (literal pass → static-zone with no error; literal fail → static-zone with E-CONTRACT-001). Arithmetic on constrained values strips constraints per T-PRED-5 regardless of operand types. Non-IdentExpr RHS (calls, member access, complex expressions) classifies as unconstrained → boundary. Bare-variant `.Variant` idents (B20 territory) and tilde `~` ident are explicitly excluded so they never collide with B21's scope lookup.
- **Six §53.4 enforcement loci — coverage matrix:**
  - **Locus 1** (let / const declaration with predicated annotation `let x: T(P) = expr`) — **DONE in B21 (extended).**
  - **Locus 2** (state-decl with predicated annotation `@x: T(P) = expr`) — **DONE in B21 (extended).**
  - **Locus 3** (function parameter `fn f(x: T(P))`) — **DEFERRED to A1c.** `function-decl` walker (line 3808) binds predicated params with their resolved type but does not classify caller-site or return-site zones today. A1c codegen will need a callsite walker that classifies argument zones at every call to a predicated-param function. Per audit §4.2 brief #2: B21 is gap-fill; the "what's already exercised" frame.
  - **Locus 4** (function return `fn f(): T(P) { ... return ... }`) — **DEFERRED to A1c.** Requires return-type capture infra parallel to B20.b. `return-stmt` walker (line 4806) checks scope but doesn't classify return-value predicate zones today.
  - **Locus 5** (bare-expr reassignment `@cell = expr` to predicated state-decl) — **DEFERRED to A1c.** `bare-expr` walker (line 4267) tracks scope but doesn't re-classify predicates.
  - **Locus 6** (`reactive-nested-assign` `@compound.field = expr`) — **DEFERRED to A1c.** Walker at line 4887 lacks zone classification.
- **No new §34 catalog row.** All B21 error codes (E-CONTRACT-001, -002, -003) already exist (lines 14181-14185). E-CONTRACT-001-RT (runtime) is emitted by A1c codegen and was already wired in `emit-predicates.ts` + `emit-logic.ts` pre-B21. E-CONTRACT-004-WARN (bind:value attribute conflict) is A1c codegen territory (`emit-html.ts`).
- **Existing infra reused (verified intact):**
  - `parsePredicateExpr` (line 718) — predicate-string → AST parser; sets `hasExternalRef` on `@`-refs (E-CONTRACT-003 trigger).
  - `evaluatePredicateOnLiteral` (line 909) — static eval with AND/OR/NOT composition.
  - `formatPredicateExpr` (line 1405) — pretty-printer for diagnostics.
  - `checkPredicateLiteral` (line 1431) — fires E-CONTRACT-001 / -002 / -003.
  - `predicateImplies` (line 1585) — T-PRED-4 implication: numeric tighter-or-equal, named-shape exact match, AND-conjunct extraction, OR target distribution.
  - `classifyPredicateZone` (line 1629) — entry point; unchanged signature, B21 sees more `predicated` SourceInfo kinds than before.
  - `extractInitLiteral` (line 1511) — string-init regex fallback; primary path now goes through `classifyLiteralFromExprNode` for ExprNode-bearing decls.
- **A1c codegen consumers (already in place pre-B21):** `emit-predicates.ts` exports `emitRuntimeCheck`, `predicateToJsExpr`, `NAMED_SHAPE_RUNTIME` table (regex/URL.canParse for the 7 built-in shapes), `NAMED_SHAPE_HTML` table for §53.7, `emitServerParamCheck` (§53.9.4 server-side boundary). `emit-logic.ts` consumes `node.predicateCheck` at the four boundary-check fire-sites listed above.
- **L4 predicate vocabulary unification status.** B10's universal-core catalog at `compiler/src/validator-catalog.ts` is the SoT for state-validator predicates (§55.1 — `req`, `is some`, `length`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`). §53 inline predicates use a DIFFERENT syntactic surface (`>`, `<`, `>=`, `<=`, `==`, `!=`, `.length`, named-shape) parsed by `parsePredicateExpr`. The L4 cross-loci unification is conceptual (both are predicates in spirit; same dev mental model) — not literal code reuse. The B10 catalog comment "Future B21 consumer" remains accurate as a forward-direction note; v0.3.0 candidate work would unify the syntactic surfaces.
- **Tests:** 27 active in `compiler/tests/unit/refinement-three-zone-b21.test.js` (13 describe blocks). REAL-AST trusted-zone propagation through let/state-decl pairs is the load-bearing new coverage (sections §B21.5, §B21.7, §B21.12 — pre-B21 the `predicated` SourceInfo was unreachable from real code). Other sections verify static-zone literal pass/fail, boundary-zone unconstrained/arithmetic, sourceKind metadata recording, E-CONTRACT-002/003 fire-paths from real AST, and SourceInfo upgrade safety (non-IdentExpr, non-predicated, dot-prefix). Test count delta: **+27 pass / +42 expect calls / 0 skip / 0 fail / 0 todo**.

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
