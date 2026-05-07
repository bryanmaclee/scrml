# PA scrml Primer — what every PA must know about the language

**Purpose:** make the PA the second-foremost expert on scrml at session start, without having to re-derive base syntax + mindset across hundreds of thousands of context tokens. This file is mandatory reading at session start (see `pa.md`).

**Status:** living document. Updated when SPEC changes, when locks land, when patterns emerge. Treat as the canon snapshot at the listed date.

**Last updated:** 2026-05-07 (S68 — A5-1 spec amendments LANDED: §51.0.K Machine Cohesion footnote (singleton invariant articulated; nested engines permitted in composite state-children); §51.0.M `<onTimeout>` element (engine temporal surface; rides §51.12 runtime); §51.0.N `history` attribute on composite state-children + `.Variant.history` structured target form (shallow-only this revision); §51.0.O `internal:rule=` prefix; §51.0.P `parallel` attribute on file-scope `<engine>` (naming sugar); §51.0.Q hierarchy / nested `<engine>` declarations + parent-rule cascade dispatch; §51.12.3.1 computed-delay relaxation; §34 +2 codes E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE. Implementation pending Phase A7 dispatch. Earlier baseline: 2026-05-06 (S64; reflects forgotten-surface audit findings + Phase 4d completion sweep — pipeline bookends, retired-AST-kinds (1 of 5 truly retired, interface dropped), 19 `@deprecated Phase 4d` string field declarations dropped from ast.ts).

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

**Optional `default=` attribute** — any cell may declare an explicit reset target: `<startTime default=null> = Date.now()`.

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

### §7.1 S67 amendments — hierarchy, history, internal/external, parallel, onTimeout

**Status:** SPEC LANDED at S68 (this section reflects A5-1). Implementation pending Phase A7 dispatch (~50-80h). Surface summary for PA navigation:

- **`<onTimeout after=DURATION to=.Variant/>`** (§51.0.M) — engine temporal surface, parallel to `<onTransition>`. Self-closing. `to=` validated strict-by-default against surrounding state-child's `rule=` (must be in set OR rule=*). Reset-on-reentry per §51.12.4. Multiple per state-child legal. Rides §51.12 runtime backbone (`_scrml_machine_arm_timer` / `_scrml_machine_clear_timer`). E-STRUCTURAL-ELEMENT-MISPLACED outside engine state-child.

- **Computed-delay form** (§51.12.3.1) — `after=${expr}<unit>` accepts any non-negative-number expression. Applies to both `<onTimeout>` (engine) and legacy `<machine>` `.From after duration => .To` form. Static literals retain constant-fold path.

- **Hierarchy / nested `<engine>`** (§51.0.Q.1) — engines may be declared inside an outer engine's state-child body. Such state-children are **composite state-children**. Inner engine has full engine semantics (own `for=`, `initial=`, state-children). Lifecycle coupled to outer state-child (init on entry, suspend on exit). Singleton invariant preserved: outer × 1 = 1 inner instance. Permitted by Machine Cohesion footnote (§51.0.K) — singleton invariant articulated; OQ-Harel-8 verdict: `<engine>` everywhere (no `<region>` keyword).

- **Parent-rule cascade dispatch** (§51.0.Q.2) — writes to outer-engine variable from inside the composite are validated against the composite outer state-child's `rule=` (standard §51.0.F mechanic; just applied per-variable). Writes to inner-engine variable from inside inner state-children validated against inner state-child's `rule=`. No new dispatch primitive — "cascade" is conceptual framing for which `rule=` contract governs which variable's writes from which scope.

- **`history` attribute** (§51.0.N) — bare attribute on a composite state-child. Compiler synthesizes reactive cell `@_<outerVar>_<variant>_history`; written on outer-exit, read on outer-re-entry. Shallow only this revision (deep deferred per OQ-Harel-4). **Tree-shakeable** — synth cell + hooks elided when zero engines declare `history`. Target syntax: `.Variant.history` is a structured-variant-target form, usable as `rule=.Playing.history` or `@phase = .Playing.history` to mean "transition to .Playing AND restore inner from history" (vs bare `.Playing` which starts inner at `initial=`). Empty-history fallback: equivalent to bare `.Variant`. E-HISTORY-NO-INNER-ENGINE if attribute appears on a non-composite state-child.

- **`internal:rule=` prefix** (§51.0.O) — alternative to canonical `rule=` on composite state-children. Same three target-only forms. Internal transition does NOT exit/re-enter the composite (inner-engine lifecycle preserved; no history-write/read; composite's `<onTransition>` handlers don't fire). Default (no prefix) is external. Both `internal:rule=` and `rule=` may coexist on the same composite — different semantics. E-INTERNAL-RULE-NOT-COMPOSITE on non-composite state-children.

- **`parallel` attribute** (§51.0.P) — bare attribute on file-scope `<engine>`. **Naming sugar only** over §51.4 multi-engine pattern. Compiler does nothing special; coexisting engines work as before (`examples/14-mario-state-machine.scrml` precedent). Documents that engines model orthogonal concerns. Full SCXML parallel-node semantics (joint activation/sync) remain deferred per §51.9.7 + OQ-Harel-3.

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

`req`, `is some` (existence-check, scrml's null+undefined unification), `length(<rel-arg>)`, `pattern`, `min`, `max`, `gt`, `lt`, `gte`, `lte`, `eq`, `neq`, `oneOf`, `notIn`.

**(S66 correction):** earlier primer drafts listed `email`, `url`, `numeric`, `integer`, `custom` here. **Those are NOT universal-core predicates.** `email`/`url`/`numeric`/`integer` are stdlib `scrml:data` library predicate-builders (separate surface; see §10). `custom` is the ValidationError tag at SPEC §55.9 line 24532 ("for developer-defined custom validators (Edge G)") — a tag-level escape hatch for application-defined predicates, NOT a universal-core predicate. The 14 above are the SPEC §55.1 catalog verbatim. Audit at `docs/audits/a1c-roadmap-rule4-audit-2026-05-07.md` §1.1 documents the drift + correction. Per pa.md Rule 4: spec wins.

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

### §9.1 Channels (§38) — file-level, V5-strict, no `@shared`

```scrml
<channel name="chat" topic="lobby">
  <messages> = []                                    // V5-strict — auto-syncs across clients

  server function postMessage(author, body) {
    @messages = [...@messages, { author, body, ts: Date.now() }]
  }
</>

<program>
  ${ const count = @messages.length }                // cross-scope canonical access
</>
```

- Channels live at **file level** (sibling of `<program>`, never child). `E-CHANNEL-INSIDE-PROGRAM`.
- `@shared` modifier is **REMOVED** in v0.next. `E-CHANNEL-SHARED-MODIFIER`. Auto-sync comes from being inside the channel body, not from a modifier.
- Channel body uses **V5-strict** (§6). `<x> = init` declares a channel-scoped reactive cell auto-synced across subscribed clients.
- Auto-creates WS endpoint `/_scrml_ws/<name>`; `topic=` defaults to `name`.
- Auto-injected in server functions: `broadcast(data)`, `disconnect()`.
- Channel-declared cells reachable from `<program>` via canonical `@cellName` access.
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
| `is some` | value EXISTS (null/undefined fail) | TRUE — empty string IS some value |
| `req` | value is NON-EMPTY / MEANINGFUL | FALSE — empty string fails req |

Both predicates exist; both are needed; they coexist in the validator vocabulary. **Three native loci** of "exists/required" semantic across scrml: schema SQL-mirror (`not null`), state validator (`req` and/or `is some`), refinement type (predicate form). Each fires in its layer's enforcement context — not redundancy.

### §9.5 `not` keyword

(Move 11 — pinned-style modifier on imports / decls for opt-out semantics. Existing §42 content retained.)

### §9.6 D4 — small-edit threading + cross-file imports + structural elements registry

D4 (S58 close) threaded the locks/moves across the smaller spec sections. Highlights worth knowing:

- **Cross-file engine import** (§21.8, M18). `import { MarioMachine } from './engines.scrml'` then mount via `<MarioMachine/>` at use-sites. Singleton semantics across all use-sites in the importer's file. `pinned` legal on imports: `import { MarioMachine pinned } from './engines.scrml'`.
- **Components vs engines** (§15.13.5, M20). Singleton-by-design (`<engine>`) ≠ multi-instance (component). Component bodies cannot instantiate an engine — `E-COMPONENT-ENGINE-SCOPE`.
- **Structural elements registry** (§4 + §24). `<engine>`, `<match>`, `<errors>`, `<onTransition>` are scrml-defined structural elements (NOT HTML). `E-STRUCTURAL-ELEMENT-MISPLACED` if used in unsupported contexts.
- **Bare-variant inference** (§14.10, M9). When LHS or parameter type is statically known, the variant qualifier may be omitted: `<phase>: Phase = .Idle` not `Phase.Idle`. Union-typed contexts → ambiguous → require qualification.
- **`:`-shorthand body** (§4.14, M15). Single-expression body: `<Idle>: <button onclick=load()>Load</button>`. Whitespace mandatory after `:`.
- **Multi-statement handler restriction** (§5.2.3, L19). Inline event handlers may be a bare call, bare assignment, or bare single expression. Multi-statement handlers force a named function. `E-MULTI-STATEMENT-HANDLER`.
- **`scrml:data` `registerMessages`** (§41.12, L12). `data.registerMessages({.ErrorTag: (field, ...args) => string, ...})` — project-wide once-at-boot for i18n + brand-voice. The "project-registered" tier of the 4-level error message chain.
- **+7 error codes** added in §34 (D4 Tier 9 consolidation): `E-CLOSER-001`, `E-NAME-COLLIDES-RESERVED`, `E-STRUCTURAL-ELEMENT-MISPLACED`, `E-MULTI-STATEMENT-HANDLER`, `E-IMPORT-PINNED-INVALID`, `E-DERIVED-CIRCULAR-DEP`, `E-USE-INVALID-CTX`.

---

## §10 stdlib — what's on the shelf (16 modules)

**Important:** stdlib modules are **import-only**, not standalone-compile targets. Don't try to compile `stdlib/<x>/index.scrml` directly — it's designed to be imported into a `<program>`.

**App-building primitives:**
- `scrml:auth` — `hashPassword`, `verifyPassword`, `signJwt`, `verifyJwt`, `decodeJwt`, `createRateLimiter`, TOTP (generate/verify)
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

---

## §12 Operational rules (orientation, not language)

- **Pre-commit hook** runs `bun test` (excluding browser). Never bypass with `--no-verify` without explicit user authorization. ~7,800-8,800 tests pass; 0 failures is the contract.
- **Cherry-pick + push protocol** — see pa.md §"Cross-machine sync hygiene" + §"wrap" definition.
- **Worktree path discipline** — agent dispatches with `isolation: "worktree"` may construct main-rooted paths from intake docs by mistake; brief must paste the absolute worktree path explicitly; agents must run `pwd` at startup.
- **Agent-file edits don't propagate mid-session** — if you edit `~/.claude/agents/<name>.md`, the change takes effect at the NEXT PA session, not the current one. Plan accordingly.
- **scrml-dev-pipeline tool set** (post S57): `Agent, Read, Write, Edit, Glob, Grep, Bash`. Default model `opus`. Edits to this file took effect S58+; before that, the agent's tools were limited and dispatches needed careful brief design.
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
- **Internal AST kinds — retirement status (S64 Phase 4d completion sweep):** `reactive-derived-decl` is fully retired — folded into `state-decl` at S60 (Phase A1a Step 11.5), interface dropped at S64. Survey during the sweep corrected the audit's "5 retired kinds" claim: `reactive-debounced-decl`, `reactive-array-mutation`, `reactive-explicit-set`, `reactive-nested-assign` are STILL ACTIVELY CONSTRUCTED by `ast-builder.js` and remain live. **Do NOT extend or use `reactive-derived-decl` in new dispatch code** — but the other four ARE the canonical AST kinds for their respective constructs. The companion cluster of `@deprecated Phase 4d` `string` shadow fields (`init?: string`, `condition?: string`, etc.) was dropped from the TypeScript shape at S64 — 19 field declarations removed from `compiler/src/types/ast.ts`. ast-builder.js still writes the runtime fields for class-(a) walker fallback paths (e.g. `node.init ?? ""` patterns where `safeParseExprToNode("")` returns undefined for placeholder cases like if-as-expression / for-as-expression / sql-init shapes). See `docs/audits/compiler-forgotten-surface-2026-05-06.md` §1.5 + §2.1 for the original audit (read with the survey-correction noted: only 1 of 5 retired kinds was truly retired) and `docs/changes/phase-4d-completion-sweep/progress.md` for the completion record.
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
| `<keyboard>` / `<mouse>` / `<gamepad>` (§36, 358 lines spec) | **sliver-empty** (0 source-level uses, 1 unit test) | Spec real-estate exceeds adoption. §36 retention debate (debate-04 candidate) before extending. Trio (`match`/`engine`/derived) does NOT cover live-input dispatch — input events are inherently external |
| State-type-discriminated function-overloading (§17.5 first half) | **retired** (debate-02 verdict, S64) | Stage 0c.A deletes the implementation; replacement primitives are `match`/`engine`/derived |
| Component-overloading (§17.5 second half) | **DOC-ONLY in SPEC, never implemented** (S64 audit finding) | `component-expander.ts` has zero overload code paths. Stage 0c has nothing component-shaped to delete. SPEC-ISSUE-010-COMPONENT pinned for queued debate-03 (CLOSE / KEEP-OPEN-DEFER / DESIGN-AND-SHIP) |
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

**Family members (shipped + planned):**

| Member | Status | Sliver |
|---|---|---|
| `parseVariant(json, EnumType)` | **shipped** S65 (SPEC §41.13) | type-establishment for sum types — constructor selection from discriminator |
| `serialize(value, EnumType)` | planned (~6-12mo) | symmetric to parseVariant; round-trip law |
| `formFor(StructType)` | planned (FLAGSHIP — `scrml.dev` demo) | compile-time struct-walk → emits `<form>` markup tree |
| `schemaFor(StructType)` | planned | emits `<schema>` SQL DDL from struct field predicates (§39+L4 vocabulary unification) |
| `tableFor(StructType, rows)` | planned | auto-`<table>` from struct + rows; admin-UI lift |
| `variantNames(EnumType)` / reflective metadata | planned | exposes variant lists as runtime values |

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
- **Canonical error name:** `E-DERIVED-CIRCULAR-DEP` (per §34 catalog row + §31.5). The old §6.6.10 placeholder `E-REACTIVE-005` was deprecated by S66 audit (`docs/audits/a1b-b7-rule4-audit-2026-05-07.md`) and replaced with a SPEC footnote at §6.6.10 line 2747 (parallel to the §6.6.8 S59 rename).

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
- Implementation phase plan (Phase A1+) — see `docs/changes/v0next-spec-impact/IMPLEMENTATION-ROADMAP.md`
- Forgotten-surface audit (vestigial features / fragile string paths / spec-vs-code drift / cross-pass invariants) — see `docs/audits/compiler-forgotten-surface-2026-05-06.md`

---

## §15 Update protocol

When SPEC changes substantively (a Stage 0b dispatch lands, a lock changes, a stdlib module is added/extended), update this primer in the same commit or shortly after. Hand-off should note "primer updated for X" so next-session PA knows the canon snapshot is fresh.

A primer that has fallen behind is worse than no primer — it teaches yesterday's language. Stale primers cost more in correction than they save in onboarding.
