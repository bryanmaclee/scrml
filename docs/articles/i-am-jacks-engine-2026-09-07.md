# I am Jack's `<engine>`

> **Working file.** Newest draft at the top; superseded drafts kept below under
> *Previous versions* so a cut line can be pulled back.
>
> | version | date | words | note |
> |---|---|---|---|
> | **v6** | 2026-09-07 | ~605 | the deletion MOTIVE fixed — "nobody gets refunds" contradicted `<Shipped rule=.Refunded>`, which Jack wrote himself; he now simply has not built the screen |
> | v5 | 2026-09-07 | ~600 | bryan's edits absorbed; the `<Refunded>` deletion now states that `Order` still declares the variant — without it the compiler reads as pedantic rather than right |
> | v4 | 2026-09-07 | ~593 | bryan's two edits absorbed; eleven-states tightened to the unspeakable-payload; quiet/loud ambiguity resolved with both forms in one block; the enum article's "four seconds" line replaced |
> | v3 | 2026-09-07 | ~538 | React contrast section added (the boolean product space) + "I am Jack's raging bile duct" |
> | v2 | 2026-09-07 | ~375 | "complete lack of surprise" RESERVED for the `<match>` piece; section now closes on the place-callback |
> | v1 | 2026-09-07 | ~373 | first draft (S407, XPS) |
>
> ---
>
> ## The series — "I am Jack's ___"
>
> Small articles in the register of the Reader's Digest organ columns from *Fight Club*
> ("I am Jack's medulla oblongata. Without me, Jack could not regulate his heart rate,
> blood pressure, or breathing."). A scrml construct speaks in the first person about the
> developer who wrote it. **Jack is the developer.**
>
> ⚑ **THIS IS NOW ARTICLE 3, NOT ARTICLE 1** (bryan, S407 — order ratified):
> **`<program>` → `<match>`/`match` → `<engine>`.** Container, then discrimination, then
> discrimination with a transition contract. `<match>` owes BOTH forms — bryan: *"the enum
> article showed the state match but not the logic context match."*
>
> **Register (bryan, S407):** *"Dry Dark Humor."* Clinical, deadpan, flat declaratives,
> then the turn. ⚑ **The S390 sing-song meter criterion does NOT carry to this series** —
> it governs *If You Give a Dev an Enum* and nothing here.
>
> **Length:** middle — between the movie's one-to-three sentences and a full essay.
> ~350–550 words. ⚑ **v4 runs 593 — over the band.** The flab was trimmed (the singleton
> sentence, the incident line, the advance gloss); what remains is load-bearing, and the
> next 40 words have to come out of prose that is doing work. Flagged rather than cut
> silently — bryan's call whether the band or the paragraph gives.
>
> ⚑ **These teach.** bryan, S407: *"these are still meant to teach the scrml mindset and
> use, not just be clever prose with a scrml theme."* The conceit is the delivery vehicle;
> the scrml is the payload. Every piece carries real code that does real work.
>
> **Candidate organs for later pieces:** `not` (absence itself) · `<match>` · `?{}` ·
> `@state` · `${}` · the compiler as the whole nervous system.
>
> ---
>
> ## ⛑ FRAMING — RULED (bryan, S407). Applies to EVERY piece in the series.
>
> > *"The purpose of these articles is to curry interest from potential adopters. We need to
> > be honest about the state (not brutal, just honest). But we are describing the *language*
> > not the current compiler."*
>
> **Consequences:** the prose describes the LANGUAGE, so a normative SHALL may be stated even
> where the compiler has not caught up. Honesty is discharged by a short closing status note,
> NOT by hedging inside the organ's voice — caveats there wreck the register and read as
> brutal, and a plain line is more useful to an adopter anyway. Defects go to
> `known-gaps.md` (three filed S407, PR #899), never into the article.
>
> ⚑ **This piece needs no status note.** Everything it describes ships today — every block
> was compiled and every diagnostic quoted is real output at `2c34a94c`. The `<program>`
> piece carries one because nested execution contexts are spec-ahead.
>
> ## ⚑ Every code block compiles clean — verified by execution
>
> Proved at `2c34a94c` on 2026-09-07, not read off the spec.
>
> ⚑ The five proving files sit at `docs/articles/proving/i-am-jacks-engine/` but that path
> is **gitignored** (`.gitignore:53` — `docs/articles/*/`), so they are LOCAL to the XPS
> clone and will not travel with this file. What survives is reproducible anyway: the two
> positive blocks ARE the article's own code blocks, and the three negatives are those
> blocks with one line changed (delete `<Refunded>`; retarget the write to `.Shipped`; swap
> the `<engine>` opener for `<match for=Order on=@order>`). Re-run with
> `bun compiler/src/cli.js compile <file>`:
>
> | block | file | result |
> |---|---|---|
> | the `<engine>` declaration | `a-positive.scrml` | **exit 0, zero diagnostics** |
> | the deleted `<Refunded>` | `b-missing-variant.scrml` | fires `E-ENGINE-STATE-CHILD-MISSING` |
> | `.Refunded` cut from enum AND body | `g-variant-also-deleted.scrml` | **exit 0, zero diagnostics** — proves the error is driven by the TYPE, which is why v5 says so |
> | the 2am illegal write | `c-illegal-write.scrml` | fires `E-ENGINE-INVALID-TRANSITION` |
> | legal write + `.advance` | `e-legal.scrml` | **exit 0, zero diagnostics** |
>
> Both quoted diagnostics are the compiler's real first sentence, elided after it — not
> paraphrased.
>
> **The `.advance` / write block (v4)** compiles clean — both forms in one state-child body,
> `f-both-forms.scrml`, exit 0 zero diagnostics.
>
> **The React block (v3)** parses clean under `node --check` as an ES module. Its arithmetic
> is checked, not asserted: 2^4 = **16** combinations, **5** correspond to an `Order` variant
> (all-false = `.Cart`, plus one flag each), leaving **11** that are constructible in React
> and unrepresentable in scrml.
>
> ⚑ **The React section answers its own best counter rather than strawmanning it.** A React
> dev's real reply to four booleans is "use `useReducer` with a discriminated union" — so the
> piece names that and answers it: a reducer restores the single variable but not the
> *arrows*. `dispatch({type:'SHIP'})` from a cart state returns a shipped order and
> type-checks, because TypeScript checks the SHAPE of the result, never the LEGALITY of the
> edge. That is the whole gap `rule=` closes, and it is the honest version of the argument
> (Rule 5).
>
> ---
>
> ## ⚑⚑ A SPEC defect this draft turned up — filed, not papered over
>
> The first draft was going to say a missing state-child fires `E-MATCH-NOT-EXHAUSTIVE`,
> **because SPEC says so.** §13.5's cross-ref note at SPEC.md:7787 reads:
>
> > *"compile-time exhaustiveness over states (every state has UI; missing a `<Failed>`
> > arm is `E-MATCH-NOT-EXHAUSTIVE`)"*
>
> **It is wrong.** Compiling it fires `E-ENGINE-STATE-CHILD-MISSING` (§51.0.B + §51.0.F),
> which is what §51.0.B's own normative statement says it should. `E-MATCH-NOT-EXHAUSTIVE`
> is real but belongs to `<match>` (§18.0.1) — verified separately at
> `d-match-missing.scrml` (the `<match>` swap).
>
> So SPEC contradicts SPEC: a narrative cross-ref in §13.5 against a normative statement in
> §51.0.B, with the implementation siding with §51.0.B. Caught only because the article's
> standard is compile-every-block. **Reading the spec would have published the false claim.**
>
> ---
>
> ## ⛑ RULED (bryan, S407) — the Fight Club line is RESERVED, do not spend it here
>
> > *"save the 'lack of surprise' line"*
>
> **"I am Jack's complete lack of surprise" belongs to the future "I am Jack's `<match>`"
> piece**, where the code it names — `E-MATCH-NOT-EXHAUSTIVE` — actually fires. v1 spent it
> on the engine's missing-state-child refusal (same beat, different code); v2 takes it back
> out. Recorded as RESERVED rather than deleted so a later draft does not re-propose it.
>
> The section now closes on its own line — *"I do not know who. I know there will be a place
> for them to stand."* — which calls back to the opening (*"has values … does not have a
> place"*) and carries the teaching point directly: exhaustiveness means every state has a
> home.

---

## v6 — current

I am Jack's `<engine>`.

Without me, Jack's application has values. It does not have a place.

Jack declares me once. I am a singleton. Every part of his program that reads my cell is
reading the same me.

```scrml
${
    type Order:enum = { Cart, Paying, Paid, Shipped, Refunded }
}

<engine for=Order initial=.Cart>
    <Cart    rule=.Paying          : "Your cart.">
    <Paying  rule=(.Paid | .Cart)  : "Talking to the bank.">
    <Paid    rule=.Shipped         : "Thank you.">
    <Shipped rule=.Refunded        : "On its way.">
    <Refunded                      : "We are sorry.">
</>
```

That is all of me. Where Jack's order can be, what each place says, and the arrows.

I declare Jack's variable for him. He never writes `@order`. He receives it.

***

Every variant has a line. That is not tidiness. That is the deal.

Jack has not built the refund screen yet. He deletes `<Refunded>` from my body.

He does not delete it from `Order`. He removed the room, not the guest.

> `error [E-ENGINE-STATE-CHILD-MISSING]: <engine for=Order> body is missing a state-child for variant .Refunded.`

Somebody is going to get a refund.

I do not know who. I know there will be a place for them to stand.

***

The `rule=` is the part Jack underestimates. It is not documentation. It is a contract on
writes.

Jack writes this at 2am:

```scrml
<Cart rule=.Paying>
    <button onclick=${ @order = .Shipped }>Check out</>
</>
```

He is inside `<Cart>`. I know precisely where he is standing. So I do not wait for a test,
or a user, or a chargeback:

> `error [E-ENGINE-INVALID-TRANSITION]: @order = .Shipped inside state-child <Cart> is invalid. <Cart>'s rule=.Paying — only .Paying is reachable.`

Jack shipped an order that was never paid for. He shipped it in a text editor, to nobody,
and I was the only one who saw.

That is the whole incident. No page, no ticket, no customer.

Jack closes the error and goes to bed.

***

Before me, Jack wrote this.

```jsx
const [isPaying,   setIsPaying]   = useState(false);
const [isPaid,     setIsPaid]     = useState(false);
const [isShipped,  setIsShipped]  = useState(false);
const [isRefunded, setIsRefunded] = useState(false);

// four hundred lines later
setIsShipped(true);
```

Four booleans. Sixteen combinations. Five of them are an order.

The other eleven are paid and refunded and never shipped. Shipped and still sitting in the
cart. They are exactly as easy to write as the real five, and nothing tells Jack which is
which. He carries that list in his head, in every file.

I do not refuse the other eleven. There is no way to say them.

Jack could reach for a reducer. A reducer gives Jack his one variable back. It does not give
him the arrows. It will take a `SHIP` action while the order is still in the cart, hand back
an order that is shipped, and type-check on the way out.

I am Jack's raging bile duct.

***

Jack has two ways to move. Both of them go through me.

```scrml
@order = .Paying            // a write. checked, and quiet when it holds.
@order.advance(.Paying)     // an assertion. this must hold, or halt.
```

The difference is not whether I check. It is what Jack means by failing. A write that
cannot happen is a bug. An assertion that cannot happen is a belief Jack held that was
wrong, and he wants the noise.

There is no `.tryAdvance`. One was proposed and refused, on the grounds that silent failures
hide bugs.

Writing Jack's current state back onto itself does nothing at all. Re-asserting where you
are is not travel.

***

I am not Jack's validation. Validation arrives after Jack has already built the wrong thing.

I am the shape of what Jack is permitted to build.
