# I am Jack's `match`

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
