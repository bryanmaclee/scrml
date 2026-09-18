# I am Jack's `<engine>`

I am Jack's `<engine>`.

Without me, Jack's application has values without a place.

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

That is all of me. Jack's order, the message, and the arrows.

I declare Jack's variable for him. He never writes `@order`. He receives it.

***

Every variant has a line. That is not tidiness. It is the deal.

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

I am Jack's raging bile duct!

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
