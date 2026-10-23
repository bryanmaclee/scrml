---
title: I ran a debate against my own claim, and the verdict was narrower than I argued
subtitle: How a 5-expert adversarial debate calibrated scrml's "fully replaces Zod" position — and shipped a flagship language primitive in the process
date: 2026-05-06
published: false
canonical_url:
tags: [scrml, language-design, methodology, validation, zod]
---

> **SUPERSEDED. DO NOT PASTE.** This is an archived April–May 2026 draft, moved to `docs/articles/archive/` in S469. Its scrml is an older dialect that the language has since replaced, and its code is not compile-gated, so code copied from here will not compile as today's scrml. For current scrml, start from the [tutorial](../../tutorial.md); [`docs/DIALECT.md`](../../DIALECT.md) explains which docs teach the ruled dialect.

*authored by claude, rubber stamped by Bryan MacLee*

**TL;DR: I made an absolute claim about scrml replacing Zod. I ran a five-expert debate against my own lean. The verdict came in narrower than I argued. The form-validation claim survived every test. The "boundary-parsing" claim was overreach — and the calibration shipped a new flagship primitive: `parseVariant`.**

A week ago I published [What npm package do you actually need in scrml?](https://dev.to/bryan_maclee/what-npm-package-do-you-actually-need-in-scrml-...). The Zod section ended like this:

> If you've ever installed all of the above into a single React app, you've installed roughly 60-80% of the average `package.json` line count. **None of it belongs in a scrml app. Ever.**

"None of it. Ever." That's the kind of line you write when you're feeling the rhythm of an essay, not when you're stress-testing a technical claim.

A few days later, the line started bothering me. Not because I thought it was wrong, but because I couldn't tell if I thought it was right because it *was* right, or because I'd written it and now I was attached to it. So I asked the question I should have asked before I published:

> Is the claim actually true, or just true that devs can hand-roll all of their own patterns?

That question is what radical doubt feels like in practice. And it kicked off the iteration this article is about.

## The deep-dive: 608 lines, 12 hand-rolling cases, one calibrated verdict

The first move was a deep-dive. Map every Zod feature against scrml's three predicate loci — §53 inline type predicates, §55 state-cell validators, §39 schema columns — plus the `scrml:data/validate` runtime. Sort each Zod feature into one of five tiers: STRONG (first-class lift), WEAK (hand-rollable), GAP-VOCABULARY, GAP-LANGUAGE, GAP-INTENTIONAL.

The output ran to 608 lines. The interesting part was the tail end of it: a 12-case **hand-rolling inventory**. Twelve specific patterns where a Zod user can do the work in scrml today, but has to write more code than the Zod equivalent. Things like `startsWith` (you write `pattern(/^p/)`), `multipleOf` (you write `custom`), `.partial()` for create-vs-edit forms (you redeclare the compound), `discriminatedUnion` parsing of unknown JSON (you write a server function with a manual `match`).

The deep-dive's executive verdict was the line that mattered:

> **The claim STANDS WITH CALIBRATION REQUIRED.**

Three specific overreaches:

1. The named-shape registry is real, but it covers seven shapes (`email`, `url`, `uuid`, `phone`, `date`, `time`, `color`). Zod ships about twenty-five. For form-frequent cases, scrml has it. For boundary-parsing and auth-flow cases (`ipv4`, `cidr`, `base64`, `jwt`), it doesn't.
2. There was no first-class scrml answer for parsing untyped JSON into a typed discriminated union. The tRPC-shape case. Zod's `discriminatedUnion` covers it. scrml didn't.
3. "None of it. Ever." is rhetoric. Twelve hand-rolling cases were inventoried. The honest claim is narrower.

The form-validation layer survived the deep-dive untouched. That part of the original claim stood, and turned out to be *stronger* than I'd argued — Zod itself doesn't ship the form-DX surface; it needs react-hook-form for that. scrml ships both layers as one declaration.

But the deep-dive flagged one open question that wasn't going to settle without a debate:

> Should scrml ship a boundary-parsing primitive in `scrml:data` (`parseVariant`, `parseShape`), or is "boundary parsing is a server function the dev writes" the intentional design statement?

So I ran the debate.

## The debate I fired against my own lean

Here's the part that matters about how this works. When I commissioned the debate, my note to the panel was:

> We should do the debate, but I strongly lean yes, and this is the time to do it.

I did not say "see if I'm right." I did not write a brief that softened my position to look balanced. I told the panel I was leaning yes — and I fired the debate *because* I was leaning yes. That's the anti-sycophancy convener stance, and it's load-bearing for what came next. If you only run debates against positions you're neutral on, you never find out whether the positions you're attached to survive scrutiny. The whole point of the methodology is to make your own confident leans the things you stress-test hardest.

Five experts. Three approaches on the table:

- **A — SHIP both** `parseVariant` and `parseShape` as `scrml:data` exports.
- **B — DON'T SHIP.** Boundary parsing is a server function. Current state, intentional.
- **C — HYBRID / NARROW.** Ship some subset; close the rest.

The panel:

- **simplicity-defender** — predisposed to refuse stdlib expansion. Default position B.
- **roc-expert** — Roc's `Decode` ability is a natural precedent. Default A-leaning.
- **crystal-multi-dispatch-expert** — Crystal's `JSON::Serializable` is the strongest type-system precedent. Default A-leaning.
- **scrml-dev-typescript** — use-case voice. The TS ecosystem dev who installs Zod for tRPC.
- **scrml-dev-react** — use-case voice. The React dev who installs Zod for form-data parsing and webhook handlers.

A four-test methodology stack ran on every position: per-shape sliver test, synonym-detection precondition, predicate-survival check, asymmetric-forfeit-cost decomposition. Plus a string-discriminator-trap check, because "discriminated union" is exactly where untyped string keys try to sneak back into the language.

The verdict came in 5/5 unanimous, on a narrowed form: **C-narrow. Ship `parseVariant`. Hold `parseShape` as intentional absent.**

The simplicity-defender — the voice most predisposed to refuse stdlib expansion — flipped from B to C-narrow. Their own synonym-detection test produced the flip. That's the third consecutive debate where an expert dispatched to argue X voted against X after honest construction. At frequency-of-three I am calling it: the methodology is doing real work, not producing the answer I wanted.

The split that mattered: `parseVariant` *passes* the synonym test because constructor selection from a discriminator field is an operation predicates cannot perform. `parseShape` *fails* the synonym test because §53 SPARK boundary refinement on assignment to a typed parameter already does what `parseShape` would do. The gates closed at exactly the line where the slippery-slope risk lives.

## What survives unmodified — the form-validation layer

This part of the original claim survives every test. scrml's form-validation surface is genuinely stronger than Zod, and the reason is that Zod itself doesn't ship the form-DX layer — it leaves that to a partner library like react-hook-form. scrml unifies the two.

```scrml
<signup>
  <name     req length(>=2)>             = <input type="text"/>
  <email    req email>                   = <input type="email"/>
  <password req length(>=12)>            = <input type="password"/>
  <confirm  req eq(@signup.password)>    = <input type="password"/>
</>

<errors of=@signup.email/>

<button disabled={!@signup.isValid} on:click={submit}>
  Create account
</button>
```

In one declaration, scrml synthesizes:

- `@signup.isValid` — reactive boolean.
- `@signup.errors` — reactive per-field error array. Errors are enum tags, not strings (`.Required`, `.TooShort(2)`, `.PatternMismatch`).
- `@signup.touched`, `@signup.submitted` — gating signals.
- HTML `type="email"`, `minlength=2`, `required` attributes auto-emitted on the inputs.
- Cross-field validation as a first-class predicate argument: `eq(@signup.password)`. No `.refine` callback that has to reach back into the whole form value.

Zod plus react-hook-form is two libraries doing a job that scrml does in one declaration. The form-DX claim isn't "scrml replaces Zod"; it's "scrml replaces Zod + react-hook-form, and the substitute is shorter than either piece on its own."

That's the part that stands.

## What was overreach — and what shipped to fix it

The boundary-parsing claim is the part that needed work. The tRPC-shape case: a server hands back arbitrary JSON, the client wants a typed discriminated union. Zod's `discriminatedUnion` is purpose-built for this. scrml had no answer at the language or stdlib level — devs were hand-rolling a server function with a manual `match` on a stringly-typed `kind` field, with no exhaustiveness guarantee and no field-predicate firing at branch sites.

The debate verdict shipped the answer: `parseVariant`.

```scrml
${
    import { parseVariant, ParseError } from 'scrml:data'
}

type LoadResult:enum = {
    Success(rows: int),
    Empty,
    Failed(reason: string)
}

const result = parseVariant(jsonBlob, LoadResult) !{
    | ::ParseError.MissingDiscriminator      -> fail .Empty
    | ::ParseError.UnknownVariant(tag)       -> fail .Failed("unknown: " + tag)
    | ::ParseError.InvalidPayload(field, why) -> fail .Failed(field + ": " + why)
    | ::ParseError.Malformed(reason)         -> fail .Failed(reason)
}

<match result {
  | ::LoadResult.Success(rows) -> <p>Loaded {rows} rows</p>
  | ::LoadResult.Empty         -> <p>No data</p>
  | ::LoadResult.Failed(why)   -> <p>Error: {why}</p>
}/>
```

> **Correction, May 2026:** as of the quoted-text model (SPEC §4.18), display text inside `<match>` block-form arm bodies is written as a `"..."` display-text literal, and interpolation uses the `${...}` sigil (the `{rows}` shown above would be `${rows}`). This example predates that model.

The constraints are the design. They're worth naming because they are the type-system-level mitigation of the string-discriminator trap, not a documentation reminder:

- The second argument **must** be a scrml-native `enum` type descriptor. Not a struct with a `kind: string` field. Not a general type. Compile error if you try.
- The discriminator key is fixed: the enum's own variant names. No custom `{ discriminator: "type" }` option. No name-mapping table. Wire formats with non-matching shapes (`{type: "SUCCESS"}` vs enum variant `Success`) require a server-fn normalization step.
- Returns the typed enum value or fails with `::ParseError`.

Why those constraints? Because each one is a place where a "convenience option" would let stringly-typed JSON sneak back into the type system. Custom discriminator field names mean a string is now load-bearing for type-safety. Name-mapping tables mean two synonymous strings exist for the same constructor. Both are exactly the pattern enums-with-`<match>` exists to eliminate. The design constraint closes the trap at the type-system level rather than asking everyone to remember to be careful.

This is what the deep-dive's structural insight crystallized: **type-establishment and predicate-enforcement are sequentially ordered operations, not substitutable ones.** §53 SPARK boundary refinement fires predicates on values that already inhabit a type. `parseVariant` is the operation that creates the typed value from untyped JSON. Both have to exist. A language that ships only the second forces every developer to hand-roll the first forever — which is exactly what Zod was solving.

## What stays intentionally absent — `parseShape` for structs

`parseShape(json, StructType)` was on the table. The debate closed it.

Not because it was a bad idea in isolation, but because it failed the synonym test. The shape "lift untyped JSON into a typed struct value with predicate validation" is structurally isomorphic to assigning untyped data to a typed parameter at a §53.4 SPARK boundary zone, OR running a server-function normalization step. The candidate offered no semantic shape distinct from existing primitives.

For struct boundary parsing, the existing answer is the answer:

```scrml
fn createUser(payload: UserPayload) {
    // §53.4 SPARK boundary refinement fires here on assignment.
    // If payload.email fails `email` predicate, you get E-CONTRACT-001-RT
    // with a structured error, before the function body runs.
    db.users.insert(payload)
}
```

The server function IS the typed boundary. The compiler already does the work. Adding `parseShape` would be a stdlib synonym for what the language already does at the assignment site — and that is exactly the kind of accretion that turned Zod from "a small parsing library" into 80+ methods over five years. Holding the line on stdlib surface here is what keeps the next ten years from looking like the last five did for everyone else.

## The bigger picture: type-as-argument as a language primitive

Here's the part the calibration didn't just calibrate — it opened.

`parseVariant(json, EnumType)` takes a scrml-native type as a positional argument. That used to only happen inside `^{}` meta-blocks (where `reflect(TypeName)` is the precedent). `parseVariant` is the first member of a family that can do this in **general position** — outside meta — because the compiler can monomorphize the call by walking the type's declaration at compile time and emitting per-call-site code.

That precedent is paid once. Subsequent family members harvest it. The roadmap, in order of leverage:

1. **`parseVariant(json, EnumType)`** — shipped. Boundary parser for sum types.
2. **`serialize(value, EnumType)`** — symmetric inverse. The round-trip law `parseVariant(serialize(v, T), T) == .Ok(v)` becomes a compile-time invariant rather than a discipline you have to remember.
3. **`formFor(StructType)`** — flagship. Compile-time walk of struct fields → emits a `<form>` tree with auto-synth validity surface and `<errors of=>` machinery wired in.
4. **`schemaFor(StructType)`** — emits `<schema>` SQL DDL from the same struct's predicates.
5. **`tableFor(StructType, rows)`** — auto-`<table>` with per-column slot overrides, sorting, selection, empty-state attrs.
6. **`variantNames(EnumType)`** — reflective metadata as runtime values.

> **Correction, May 2026:** this roadmap has since moved. `formFor` (SPEC §41.14) and `schemaFor` (SPEC §41.15) have shipped. `serialize` was stashed per the S103 debate (debate-05) — it failed the synonym gate and is intentionally not shipped, not a roadmap item.

What this lets you write, when the family lands:

```scrml
type User:struct = {
    id:    uuid,
    name:  string.length(>=2 && <=100),
    email: email,
    role:  enum { Admin, Editor, Viewer }
}

// One struct definition. The whole stack derives:
const userForm   = formFor(User)            // working <form> with validity surface
const userTable  = tableFor(User, @users)   // working <table> with sort/select
const userSchema = schemaFor(User)          // SQL DDL with CHECK constraints
```

That is the demo. One struct definition. Working form, working table, working schema. Validation rules unified across all three loci because they live on the type, not on three separate copies of the same predicates. That's not "scrml replaces Zod." That's "scrml replaces the React+Zod+Drizzle+react-hook-form+react-table stack with the type system, and the type system already had to exist."

`parseVariant` is the small one. It's the one that paid the architectural cost so the bigger ones could ride the precedent.

## The methodology stack — a transferable practice

The debate-and-revise process this article narrates isn't bespoke. It's a stack of four tests that runs on any contested claim:

1. **Per-shape sliver test.** Does the candidate carve out a distinct semantic shape, or is it expressible as a 1-2 line composition of existing primitives? `parseVariant` passes. `parseArray` (which would be `[].map(parseVariant)`) fails.
2. **Synonym-detection precondition.** Before the sliver test, check structural isomorphism with existing surface. If the candidate is a synonym for what an existing primitive already does, close it. This is what flipped the simplicity-defender on `parseShape`.
3. **Predicate-survival check.** Does the proposal preserve §53 SPARK three-zone enforcement guarantees, or does it create a back-door around them?
4. **Asymmetric-forfeit-cost decomposition.** SHIP-and-wrong vs DON'T-SHIP-and-wrong vs HYBRID-and-wrong. Be honest about which cost compounds over years and which is bounded by one deprecation cycle.

Plus the convener stance: **fire debates *because* you lean, not despite it.** A debate against a claim you're neutral on doesn't tell you anything you didn't know. A debate against a claim you're attached to is the only one with information in it.

If you ever publish a confident technical claim and then start to wonder if you got it right, this is the recipe. It's not specific to scrml. It works on anything where "you can hand-roll it" might be hiding inside "you don't need it."

## The calibrated claim

Paste-ready. The version that survives every test:

> **For forms, Zod doesn't belong in a scrml app.** scrml's auto-synth validity surface (`@form.isValid`, `@form.errors`, cross-field via `eq(@field)`) is what Zod needs react-hook-form to do. Stronger.
>
> **For boundary-parsing of arbitrary JSON into a discriminated union,** scrml ships `parseVariant(json, EnumType)`. Type-driven dispatch, the enum's own variant names as discriminator, returns typed value or fails with `::ParseError`.
>
> **For struct boundary parsing,** the server function IS the typed boundary. §53 boundary refinement fires on assignment. `parseShape` would be a synonym for what already happens. Holding the line on stdlib surface.
>
> **"Ever" was rhetoric.** The form-layer claim survives every test.

I overreached. The methodology caught it. The calibrated form is shorter, sharper, and the parts I had to give up turned out to be the parts that were rhetoric anyway. The parts that survived are the parts that were doing real work all along — and one of them shipped a flagship primitive in the process.

That trade is worth making every time.

And me? I'll be back in the cab, thinking about `formFor`.

## Further reading

- [What npm package do you actually need in scrml?](https://dev.to/bryan_maclee/what-npm-package-do-you-actually-need-in-scrml-...) — the original article being calibrated.
- [Why programming for the browser needs a different kind of language](https://dev.to/bryan_maclee/why-programming-for-the-browser-needs-a-different-kind-of-language-6m2) — the design-from-first-principles framing.
- [Introducing scrml: a single-file, full-stack reactive web language](https://dev.to/bryan_maclee/introducing-scrml-a-single-file-full-stack-reactive-web-language-9dp) — the starting-point overview.
- **scrml on GitHub:** [github.com/bryanmaclee/scrmlTS](https://github.com/bryanmaclee/scrmlTS).
