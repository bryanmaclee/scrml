# I am Jack's `match`

> **Working file.** Newest draft at the top.
>
> | version | date | words | note |
> |---|---|---|---|
> | **v1** | 2026-09-08 | ~487 | first draft (S407, XPS) |
>
> ---
>
> ## The series — "I am Jack's ___"  ·  **article 2 of 3**
>
> 1. `<program>` — the container (v3, 665w)
> 2. **`<match>` / `match`** — discrimination ← this file
> 3. `<engine>` — match plus arrows (v6, 609w)
>
> ⚑ **This piece owes BOTH forms.** bryan, S407: *"the enum article showed the state match
> but not the logic context match."* Both are here — block-form in markup, JS-style in
> logic — and the point of the section is that they are the same construct in two positions.
>
> ⚑ **`I am Jack's complete lack of surprise` — SPENT HERE**, as reserved at S407. It lands on
> `E-TYPE-020` rather than on a `<match>` arm, which is the honest placement: the code fires
> on the JS-style form, and the beat is about Jack adding a variant and the compiler finding
> every site.
>
> **Fight Club ledger:** `raging bile duct` → engine · `cold sweat` → program ·
> `complete lack of surprise` → **match (this file)**. Unspent: `medulla oblongata` ·
> `smirking revenge` · `broken heart` · `inflamed sense of rejection` · `wasted life` · `colon`.
>
> **Register:** dry dark humour, deadpan; the S390 meter rule does NOT carry.
> **Framing (S407):** describes the LANGUAGE; honesty via a closing status note, never hedged
> prose. ⚑ **This piece needs no status note — everything in it ships today.**
> **Tone rule (S407):** every refusal beat owes its resolution. Both are discharged below.
>
> ---
>
> ## ⚑ Every code block compiles clean — verified by execution
>
> Proved at `914f06f5`, 2026-09-08. Scratch: `article-match/`.
>
> | claim in the piece | file | result |
> |---|---|---|
> | both shapes, one file | `m4-both-shapes.scrml` | **exit 0, zero diagnostics** |
> | JS-style value-return match | `m1-js-full.scrml` | **exit 0** |
> | a missing arm stops the build | `m2-js-missing.scrml` | `E-TYPE-020` — *"Missing variants: ::Refunded"* |
> | `else` silently absorbs the rest | `m6-else-covers.scrml` | **exit 0, zero diagnostics** — the trade is real |
> | a vacuous `else` is called out | `m3-vacuous-else.scrml` | `W-MATCH-001` |
> | **the promotion is a one-word change** | `m5-promote.scrml` | **exit 0** — the SAME five arms under an `<engine>` opener |
>
> Both quoted diagnostics are real output, elided only of their `::`/`_` alias noise.
>
> ⚑ **The closing beat is a VERIFIED claim, not a rhetorical flourish.** §51.0.A trait 3 says
> a `<match for=Type>` becomes an `<engine for=Type initial=.X>` "by changing only the opener.
> State-children carry forward verbatim." That was compiled both ways (`m4` → `m5`) and it
> holds. It is the series' handoff into article 3.
>
> ---
>
> ## ⚑⚑ TWO SHAPES, TWO CODES — deliberate, and the piece does not paper over it
>
> The same missing arm produces a different code depending on the shape:
>
> | shape | missing arm |
> |---|---|
> | block-form `<match for=Order on=@order>` | `E-MATCH-NOT-EXHAUSTIVE` (§18.0.1) |
> | JS-style `match o { … }` | `E-TYPE-020` (§18.8.1) |
>
> Both PA-verified by execution. §18's own header says *"E-TYPE-020 is the single canonical
> error code for non-exhaustive match"* — which reads as one code and is not, because the
> block form has its own. This is NOT filed as a defect: the diagnostic surfaces genuinely
> differ (an arm list vs a markup child set), the same split §51.0.B.1 takes for
> `E-ENGINE-PAYLOAD-ARITY-MISMATCH` vs §18.7's `E-TYPE-021`. **Recorded here so a later
> session does not "discover" it and file it as an inconsistency.** The piece quotes only
> `E-TYPE-020`, on the JS-style form where it is exactly right.
>
> ---
>
> **Still open, pinned:** whether the `.Refunded`-added-last-month framing should name a
> sixth variant instead. It currently reuses `.Refunded` **deliberately**, so the quoted
> `E-TYPE-020` text is the compiler's real output rather than an extrapolation to an invented
> variant name.

---

## v1 — current

I am Jack's `match`.

I am the question Jack asks about a value that could be more than one thing.

He has an order. It is exactly one of five things, and he wrote the list himself.

```scrml
type Order:enum = { Cart, Paying, Paid, Shipped, Refunded }
```

***

There are two of me. Jack does not pick between us — where he puts me decides which one he
gets.

In his markup, I draw.

```scrml
<match for=Order on=@order>
    <Cart     : "Your cart.">
    <Paying   : "Talking to the bank.">
    <Paid     : "Thank you.">
    <Shipped  : "On its way.">
    <Refunded : "We are sorry.">
</>
```

In his logic, I answer.

```scrml
fn label(o: Order) -> string {
    return match o {
        .Cart     :> "in the cart"
        .Paying   :> "with the bank"
        .Paid     :> "paid for"
        .Shipped  :> "on its way"
        .Refunded :> "refunded"
    }
}
```

Two shapes. One of me underneath — the same tree, the same count. The only thing that
changed is whether Jack wanted a screen or an answer.

***

Jack added `.Refunded` to that list last month, because a customer's bank called.

He did not go looking for the places that needed updating. He did not have to.

> `error [E-TYPE-020]: Non-exhaustive match over enum type Order. Missing variants: ::Refunded. Add arms for the missing variants, or add an else arm to handle them all.`

Every place in his application that asks what an order is, and has no answer for a refunded
one, stopped the build. I name the file. I name the variant. I name both remedies.

Jack was annoyed. The alternative was four screens quietly rendering nothing on the worst
day of a customer's week.

I am Jack's complete lack of surprise.

***

Jack can finish me with `else`, and I will take everything he did not name.

```scrml
.Shipped :> "on its way"
else     :> "something else"
```

That compiles. It also costs him the paragraph above: the next variant lands in `else`, the
build stays green, and I say nothing. It is a real trade and it is sometimes the right one.
It is only a mistake when Jack makes it without knowing he made it.

If he names all five and writes `else` anyway, I tell him that too.

> `warning [W-MATCH-001]: Wildcard _ arm is unreachable. All variants of Order are already covered by explicit arms. Remove the _ arm.`

***

One day Jack notices his five arms are not five pictures.

`.Cart` never goes straight to `.Shipped`. There is an order to them, and he has been holding
it in his head this whole time.

When that day comes, he changes one word.

```scrml
<engine for=Order initial=.Cart>
```

The arms do not move. The same five lines, untouched.

He has stopped asking what his order is, and started declaring where it may go.

That is a different organ.
