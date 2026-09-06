# If You Give a Dev an Enum

> **Working file.** Newest draft at the top; superseded drafts kept below under
> *Previous versions* so a cut line can be pulled back. Untracked and uncommitted.
>
> | version | date | words | note |
> |---|---|---|---|
> | **v7** | 2026-08-31 | ~540 | validity paragraph → a substantive code block; the ruled loop-cut re-applied (v6 was lost to an overwrite) |
> | v6 | 2026-08-31 | ~598 | closing meta section cut — **OVERWRITTEN, rebuilt into v7** |
> | v5 | 2026-08-31 | ~731 | joke ordering restored; bryan's server line; 4 small fixes |
> | v4 | 2026-08-31 | ~721 | bryan's meter pass |
> | v3 | 2026-08-31 | ~739 | 4 fixes on bryan's v2 |
> | v2 | 2026-08-31 | ~644 | bryan's pass — second person restored, heavy trim |
> | v1 | 2026-08-31 | ~1,025 | first draft |
>
> **Editing criterion (bryan, S390):** every line outside the code blocks is judged
> by a sing-song cadence, akin to the animated series' theme song. **The code blocks
> are the pictures** — where a paragraph explains what the language does, prefer a
> block that shows it. Concision is downstream of meter.
>
> ⚑ **The ending is SETTLED: end on the loop.** bryan, S390: *"end on the loop"*.
> The two-line coda was offered and **DECLINED**. Do not re-propose it.
>
> **Still open, pinned:** how much code belongs in it · voice pass.
>
> ⚑ **Every code block compiles clean** — verified by execution, zero diagnostics,
> including the new validity block.

---

## v7 — current

If you give a dev an enum, they're going to ask if they can match on it.

When you let them match on it, they'll want to know they got it all.

So the compiler counts. And it finds one.

It says `E-MATCH-NOT-EXHAUSTIVE`, and it names the variant: `.Empty`.

And then they'll add the arm.

```scrml
<match for=Phase on=@phase>
    <Idle>      <button onclick=load()>Load</button>   </>
    <Loading>   Loading...                             </>
    <Error msg> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                           </>
    <Success count> Got ${count} rows                  </>
</>
```

Then they'll look at those five arms and notice something.

***

`.Idle` doesn't go to `.Success`. It goes to `.Loading` first. See, it says so.

So then they'll want the arrows. You give them `rule=` and `<engine>`.

So they'll do the whole rewrite.

```scrml
<engine for=Phase initial=.Idle>
    <Idle rule=.Loading>      <button onclick=load()>Load</button>   </>
    <Loading rule=(.Success | .Error | .Empty)>   Loading...         </>
    <Error msg rule=.Loading> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                             </>
    <Success count> Got ${count} rows                    </>
</>
```

Every body is untouched.

One word on the wrapper. Where it starts. Where each may go.

And now that it knows where it starts and where it may go,

it simply will not let them go anywhere else.

Then in a click handler, they'll write `@phase = .Success`.

Straight out of `.Idle`. The happy path was right there.

The compiler says no.

And it quotes the rule they wrote twenty minutes ago.

They'll be annoyed for about four seconds.

Then they'll realize they would have shipped that.

***

Once the states are honest, they'll want something to *happen*.
Fire the analytics. Focus an input. Start a timer.

```scrml
<onTransition from=.Loading to=.Success>
    ${ analytics.track("load.success") }
</>
```

And that effect wants data. So they'll write the query out.

```scrml
const rows = ?{ select * from items }
```

And they'll wonder how to tell it this part is on the server.

So you tell them that's the compiler's job.

They'll type `await` out of muscle memory. It won't be a keyword.

***

Then they'll think about the query coming back empty.

Not *empty* empty. **Not there** empty. The row that wasn't.

That one has a name. It's `not`.

And then you ask them a few questions.

> Is `""` absent?

No. It's a string. You have one.

> Is `0`?

That's a number.

> Is `[]`?

No. It's an array. It's just short.

Absence is absence and emptiness is emptiness. Only one of them is `not`.

```scrml
given rows :> {
    @phase = .Success(rows.length)
}
```

***

A user will need to type something in. Then,

The dev will declare the field with what's *true* about it:

```scrml
<signup>
    <name  req length(>=2)> = <input type="text"/>
    <agree req>             = <input type="checkbox"/>
</>

<errors of=@signup.name/>
<button disabled=${!@signup.isValid}>Sign up</button>
```

Nobody declared `@signup.isValid`.

They'll want to show the errors, so they'll ask where the error strings live.

And here is where it gets funny.

They aren't strings. You say.

`@signup.name.errors[0]` is `.Required`. Or `.LengthFailed(predicate)`.

The failure has a **tag** and a **payload**.

The message comes later. Whoever writes the copy. Whatever language.

Which means the dev is holding a value with a fixed set of named cases.

And a payload on some of them.

So the dev now has an enum...

***
---
---
So they're going to ask if they can match on it.

And when they match on it, they'll want to know they got all of it. Not *probably*
all of it —



---
---

---
---

---
---

---
---

# Previous versions

## v5 — 2026-08-31 (superseded by v7)

If you give a dev an enum, they're going to ask if they can match on it.

When you let them match on it, they'll want to know they got it all.

So the compiler counts. And it finds one.

It says `E-MATCH-NOT-EXHAUSTIVE`, and it names the variant: `.Empty`.

And then they'll add the arm.

```scrml
<match for=Phase on=@phase>
    <Idle>      <button onclick=load()>Load</button>   </>
    <Loading>   Loading...                             </>
    <Error msg> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                           </>
    <Success count> Got ${count} rows                  </>
</>
```

Then they'll look at those five arms and notice something.

***

`.Idle` doesn't go to `.Success`. It goes to `.Loading` first. See, it says so.

So then they'll want the arrows. You give them `rule=` and `<engine>`.

So they'll do the whole rewrite.

```scrml
<engine for=Phase initial=.Idle>
    <Idle rule=.Loading>      <button onclick=load()>Load</button>   </>
    <Loading rule=(.Success | .Error | .Empty)>   Loading...         </>
    <Error msg rule=.Loading> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                             </>
    <Success count> Got ${count} rows                    </>
</>
```

Every body is untouched.

One word on the wrapper. Where it starts. Where each may go.

And now that it knows where it starts and where it may go,

it simply will not let them go anywhere else.

Then in a click handler, they'll write `@phase = .Success`.

Straight out of `.Idle`. The happy path was right there.

The compiler says no.

And it quotes the rule they wrote twenty minutes ago.

They'll be annoyed for about four seconds.

Then they'll realize they would have shipped that.

***

Once the states are honest, they'll want something to *happen*.
Fire the analytics. Focus an input. Start a timer.

```scrml
<onTransition from=.Loading to=.Success>
    ${ analytics.track("load.success") }
</>
```

And that effect wants data. So they'll write the query out.

```scrml
const rows = ?{ select * from items }
```

And they'll wonder how to tell it this part is on the server.

So you tell them that's the compiler's job.

They'll type `await` out of muscle memory. It won't be a keyword.

***

Then they'll think about the query coming back empty.

Not *empty* empty. **Not there** empty. The row that wasn't.

That one has a name. It's `not`.

And then you ask them a few questions.

> Is `""` absent?

No. It's a string. You have one.

> Is `0`?

That's a number.

> Is `[]`?

No. It's an array. It's just short.

Absence is absence and emptiness is emptiness. Only one of them is `not`.

```scrml
given rows :> {
    @phase = .Success(rows.length)
}
```

***

A user will need to type something in. Then,

The dev will declare the field with what's *true* about it:

```scrml
<name req length(>=2)> = <input type="text"/>
```

And the validity surface assembles itself. `@signup.name.isValid`.
`@signup.name.errors`. `@signup.name.touched`. `@signup.isValid` for the whole
form. Rolled up. Reactive. Read-only.

They'll want to show the errors, so they'll ask where the error strings live.

And here is where it gets funny.

They aren't strings. You say.

`@signup.name.errors[0]` is `.Required`. Or `.LengthFailed(predicate)`.

The failure has a **tag** and a **payload**.

The message comes later. Whoever writes the copy. Whatever language.

Which means the dev is holding a value with a fixed set of named cases.

And a payload on some of them.

Then the dev is holding an enum.

***

So they're going to ask if they can match on it.

And when they match on it, they'll want to know they got all of it. Not *probably*
all of it —

***

That's the joke, and it's also the design.

"If You Give a Mouse a Cookie" is funny because the chain is arbitrary: the milk has
nothing to do with the straw, and the mouse is just relentless. This chain isn't
arbitrary. Every link is the *same* link. Name the cases. Handle all of them. Let
the compiler hold you to it. Then notice that what you're holding at the end of one
loop is the input to the next.

Most languages let you start that chain. Not many are built so it closes.

The dev who came in asking for one small thing — *can I match on this?* — walks out
having accidentally described their entire application as a machine that cannot
reach a state nobody drew.

They think they got a `<match>` block.

They got the whole thing.

---
---

---
---

---
---

---

## v4 — 2026-08-31 (superseded by v5)

If you give a dev an enum, they're going to ask if they can match on it.

When you let them match on it, they'll want to know they got it all.

So the compiler counts. And it finds one.

It says `E-MATCH-NOT-EXHAUSTIVE`, and it names the variant: `.Empty`.

And then they'll add the arm.

```scrml
<match for=Phase on=@phase>
    <Idle>      <button onclick=load()>Load</button>   </>
    <Loading>   Loading...                             </>
    <Error msg> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                           </>
    <Success count> Got ${count} rows                  </>
</>
```

Then they'll look at those five arms and notice something.

***

`.Idle` doesn't go to `.Success`. It goes to `.Loading` first. See, it says so.

So then they'll want the arrows. You give them `rule=` and `<engine>`.

So then they'll change one word. match to engine, add some rules

```scrml
<engine for=Phase initial=.Idle>
    <Idle rule=.Loading>      <button onclick=load()>Load</button>   </>
    <Loading rule=(.Success | .Error | .Empty)>   Loading...         </>
    <Error msg rule=.Loading> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                             </>
    <Success count> Got ${count} rows                    </>
</>
```

Every body is untouched.

And now that it knows where it starts and where it may go,

it simply will not let you go anywhere else.

Then in a click handler, they'll write `@phase = .Success`.

Straight out of `.Idle`. The happy path was right there.

The compiler says no.

And it quotes the rule they wrote twenty minutes ago.

They'll be annoyed for about four seconds.

Then they'll realize they would have shipped that.

***

Once the states are honest, this dev will want something to *happen*.
Fire the analytics. Focus an input. Start a timer.

```scrml
<onTransition from=.Loading to=.Success>
    ${ analytics.track("load.success") }
</>
```

And that effect wants data. So they'll write the query out.

```scrml
const rows = ?{ select * from items }
```

And they'll wonder how to discriminate the call site.

So You tell them that's the compiler's job.

They'll type `await` out of muscle memory. It won't be a keyword.

***

Then they'll think about the query coming back empty.

Not *empty* empty. **Not there** empty. The row that wasn't.

That one has a name. It's `not`.

And then you ask them a few questions.

> Is `""` absent?

No. It's a string. You have one.

> Is `0`?

That's a number.

> Is `[]`?

No. It's an array. It's just short.

Absence is absence and emptiness is emptiness. Only one of them is `not`.

```scrml
given rows :> {
    @phase = .Success(rows.length)
}
```

***

A user will need to type something in. Then,

The dev will declare the field with what's *true* about it:

```scrml
<name req length(>=2)> = <input type="text"/>
```

And the validity surface assembles itself. `@signup.name.isValid`.
`@signup.name.errors`. `@signup.name.touched`. `@signup.isValid` for the whole
form. Rolled up. Reactive. Read-only.

They'll want to show the errors, so they'll ask where the error strings live.

And here is where it gets funny.

They aren't strings. You say.

`@signup.name.errors[0]` is `.Required`. Or `.LengthFailed(predicate)`.

The failure has a **tag** and a **payload**.

The message comes later. Whoever writes it in whatever form.

Which means the dev is holding a value with a fixed set of named cases.

And a payload on some of them.

Then the dev is holding an enum.

***

So they're going to ask if they can match on it.

And when they match on it, they'll want to know they got all of it. Not *probably*
all of it —

***

That's the joke, and it's also the design.

"If You Give a Mouse a Cookie" is funny because the chain is arbitrary: the milk has
nothing to do with the straw, and the mouse is just relentless. This chain isn't
arbitrary. Every link is the *same* link. Name the cases. Handle all of them. Let
the compiler hold you to it. Then notice that what you're holding at the end of one
loop is the input to the next.

Most languages let you start that chain. Not many are built so it closes.

The dev who came in asking for one small thing — *can I match on this?* — walks out
having accidentally described their entire application as a machine that cannot
reach a state nobody drew.

They think they got a `<match>` block.

They got the whole thing.

---
---

---
---

---

## v3 — 2026-08-31 (superseded by v4)

If you give a dev an enum, they're going to ask if they can match on it.

When you let them match on it, they'll want to know they got it all.

So the compiler counts. And it finds one.

It says `E-MATCH-NOT-EXHAUSTIVE`, and it names the variant: `.Empty`.

They'll add the arm.

```scrml
<match for=Phase on=@phase>
    <Idle>      <button onclick=load()>Load</button>   </>
    <Loading>   Loading...                             </>
    <Error msg> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                           </>
    <Success count> Got ${count} rows                  </>
</>
```

Then they'll look at those five arms and notice something.

***

`.Idle` doesn't go to `.Success`. It goes to `.Loading` first. See, it says so.

So then they'll want the arrows. You give them `rule=` and `<engine>`.

So they'll do the whole rewrite.

```scrml
<engine for=Phase initial=.Idle>
    <Idle rule=.Loading>      <button onclick=load()>Load</button>   </>
    <Loading rule=(.Success | .Error | .Empty)>   Loading...         </>
    <Error msg rule=.Loading> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                             </>
    <Success count> Got ${count} rows                    </>
</>
```

Every body is untouched. One word on the wrapper, where it starts, and where each
may go.

And now that it knows where it starts and where it may go, it starts refusing to go
anywhere else.

Somewhere in a click handler they'll write `@phase = .Success` straight out of
`.Idle`, because the happy path was right there. The compiler says
no, and quotes the rule they wrote twenty minutes ago.

They'll be annoyed for about four seconds.

Then they'll realize they would have shipped that.

***

Once the states are honest, they'll want something to *happen* between two of them.
Fire the analytics. Focus an input. Start a timer.

```scrml
<onTransition from=.Loading to=.Success>
    ${ analytics.track("load.success") }
</>
```

And that effect wants data. So they'll write the query out.

```scrml
const rows = ?{ select * from items }
```

Then they'll wonder how they tell this thing to be in the back.

You tell them that's the compiler's job.

They'll type `await` out of muscle memory. It won't be a keyword.

***

Then they'll think about the query coming back empty.

Not *empty* empty. **Not there** empty. The row that wasn't.

That one has a name. It's `not`.

And then you ask them a few questions.

> Is `""` absent?

No. It's a string. You have one.

> Is `0`?

That's a number.

> Is `[]`?

No. It's an array. It's just short.

Absence is absence and emptiness is emptiness. Only one of them is `not`.

```scrml
given rows :> {
    @phase = .Success(rows.length)
}
```

***

A user will need to type something in. Then,

The dev will declare the field with what's *true* about it:

```scrml
<name req length(>=2)> = <input type="text"/>
```

And the validity surface assembles itself. `@signup.name.isValid`.
`@signup.name.errors`. `@signup.name.touched`. `@signup.isValid` for the whole
form, rolled up, reactive, read-only.

They'll want to show the errors, so they'll ask where the error strings live.

And here is where it gets funny.

They aren't strings. You say.

`@signup.name.errors[0]` is `.Required`. Or `.LengthFailed(predicate)`.

The failure has a **tag** and a **payload**; the message is a rendering decision
made later, by whoever writes the copy, in whatever language.

Which means the dev is now holding a value with a fixed set of named cases and a
payload on some of them.

Then the dev is holding an enum.

***

So they're going to ask if they can match on it.

And when they match on it, they'll want to know they got all of it. Not *probably*
all of it —

***

That's the joke, and it's also the design.

"If You Give a Mouse a Cookie" is funny because the chain is arbitrary: the milk has
nothing to do with the straw, and the mouse is just relentless. This chain isn't
arbitrary. Every link is the *same* link. Name the cases. Handle all of them. Let
the compiler hold you to it. Then notice that what you're holding at the end of one
loop is the input to the next.

Most languages let you start that chain. Not many are built so it closes.

The dev who came in asking for one small thing — *can I match on this?* — walks out
having accidentally described their entire application as a machine that cannot
reach a state nobody drew.

They think they got a `<match>` block.

They got the whole thing.

---
---

---

## v2 — 2026-08-31 (bryan's pass, superseded by v3)

If you give a dev an enum, they're going to ask if they can match on it.

When you let them match on it, they'll want to know they got it all.

So the compiler counts. And it finds one.

It says `E-MATCH-NOT-EXHAUSTIVE`, and it
names the variant: `.Empty`.

They'll add the arm.

```scrml
<match for=Phase on=@phase>
    <Idle>      <button onclick=load()>Load</button>   </>
    <Loading>   Loading...                             </>
    <Error msg> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                           </>
    <Success count> Got ${count} rows                  </>
</>
```

Then they'll look at those five arms and notice something.

***

`.Idle` doesn't go to `.Success`. It goes to `.Loading` first. See, it says so.

So then they'll want the arrows. You give them `rule=` and `<engine>`

So they'll do the whole rewrite

```scrml
<engine for=Phase on=@phase>
    <Idle>      <button onclick=load()>Load</button>   </>
    <Loading>   Loading...                             </>
    <Error msg> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                           </>
    <Success count> Got ${count} rows                  </>
</>
```

Now it's an engine, so it wants to know where it *starts*. `initial=.Idle`.

And now that it knows where it starts and where it may go, it starts refusing to go
anywhere else.

***

Once the states are honest, they'll want something to *happen* between two of them.
Fire the analytics. Focus an input. Start a timer.

```scrml
<onTransition from=.Loading to=.Success>
    ${ analytics.track("load.success") }
</>
```

And that effect wants data. So they'll write the query out.

```scrml
const rows = ?{ select * from items }
```

Then they'll wonder how they tell this thing to be in the back.

You tell them that's the compilers job

***

Then they'll think about the query coming back empty.

What the compiler gives them then is `not`

You ask them a few questions

> Is `""` absent?

No. It's a string. You have one.

> Is `0`?

Thats a number.

> Is `[]`?

No. It's an array. It's just short.

Absence is absence and emptiness is emptiness. And both of them are `not`

```scrml
given rows :> {
    @phase = .Success(rows.length)
}
```

***

A user will need to type something in. Then,

The dev will declare the field with what's *true* about it:

```scrml
<name req length(>=2)> = <input type="text"/>
```

And the validity surface assembles itself. `@signup.name.isValid`.
`@signup.name.errors`. `@signup.name.touched`. `@signup.isValid` for the whole
form, rolled up, reactive, read-only.

They'll want to show the errors, so they'll ask where the error strings live.

And here is where it gets funny

They aren't strings. You say.

`@signup.name.errors[0]` is `.Required`. Or `.LengthFailed(predicate)`. 

The failure has a **tag** and a **payload**; the message is a rendering decision made later, by
whoever writes the copy, in whatever language.

Which means the dev is now holding a value with a fixed set of named cases and a
payload on some of them.

Then the dev is holding an enum.

***

So they're going to ask if they can match on it.

And when they match on it, they'll want to know they got all of it. Not *probably*
all of it —

***

That's the joke, and it's also the design.

"If You Give a Mouse a Cookie" is funny because the chain is arbitrary: the milk has
nothing to do with the straw, and the mouse is just relentless. This chain isn't
arbitrary. Every link is the *same* link. Name the cases. Handle all of them. Let
the compiler hold you to it. Then notice that what you're holding at the end of one
loop is the input to the next.

Most languages let you start that chain. Not many are built so it closes.

The dev who came in asking for one small thing — *can I match on this?* — walks out
having accidentally described their entire application as a machine that cannot
reach a state nobody drew.

They think they got a `<match>` block.

They got the whole thing.

---
---

---

## v1 — 2026-08-31 (superseded by v2)

If you give a dev an enum, they're going to ask if they can match on it.

When you let them match on it, they'll want to know that they got all of it. Not
*probably* all of it. All of it.

So the compiler counts. And it finds the one they forgot.

It doesn't say *something went wrong somewhere*. It says `E-MATCH-NOT-EXHAUSTIVE`,
and it names the variant: `.Empty`. They wrote `.Idle`, `.Loading`, `.Error`,
`.Success` — four states, four little pieces of UI — and they never wrote down what
the screen does when there is simply nothing there.

They'll add the arm. It takes nine seconds.

```scrml
<match for=Phase on=@phase>
    <Idle>      <button onclick=load()>Load</button>   </>
    <Loading>   Loading...                             </>
    <Error msg> <div class="err">${msg}</div>          </>
    <Empty>     No rows yet.                           </>
    <Success count> Got ${count} rows                  </>
</>
```

And then they'll look at those five arms and notice something they didn't expect
to notice.

***

The arms aren't only *display*. Two of them are quietly making a claim about
**time**. `.Idle` doesn't go to `.Success`. It goes to `.Loading` first, always,
and everybody on the team knows that, and it is written down absolutely nowhere.

So they'll want the arrows.

And once you want the arrows, you need an engine — because in scrml an arrow is
spelled `rule=`, and `rule=` only means anything on an `<engine>`. Which sounds
like a rewrite, until they run `bun scrml promote --match` and watch the arms carry
over exactly as they were. One word changes on the wrapper. That's the whole
ceremony. The commitment was the interesting part; the typing wasn't.

Now it's an engine, so it will want to know where it *starts*. `initial=.Idle`.

And now that it knows where it starts and where it's allowed to go, it will start
refusing to go anywhere else.

Somewhere down in a click handler, the dev will write `@phase = .Success` straight
out of `.Idle`, because the happy path was right there and it was late. And the
compiler will say no — not in a console, not on a Tuesday in production, but right
then, quoting the rule they wrote themselves twenty minutes earlier.

They'll be annoyed for about four seconds.

Then they'll realize they would have shipped that.

***

Once the states are honest, they'll want something to *happen* on the way between
two of them. Fire the analytics. Focus the input. Start the timer.

```scrml
<onTransition from=.Loading to=.Success>
    ${ analytics.track("load.success") }
</>
```

And that effect is going to want data. So they'll write the query.

```scrml
const rows = ?{ select * from items }
```

Then they'll go looking for the part where you say `server`.

There isn't one. Touching the database *is* the escalation — the compiler reads the
query, works out that this cannot possibly run in a browser, moves the function to
the server and turns the call site into a fetch. Nobody colored the function.
Nobody wrote a route. Nobody opened a second file called `api/`.

They'll type `await` out of muscle memory. It won't be a keyword. They'll sit with
that for a second.

***

Then they'll think about the query coming back empty.

Not *empty* empty. **Not there** empty. The row that wasn't.

And scrml will hand them exactly one word for it — `not` — and refuse to give them
a second one. There is no `null` here. There is no `undefined`. There is no third
thing that means almost-nothing-but-different. The dev will test the edges of this,
because devs test the edges of this:

> Is `""` absent?

No. It's a string. You have one.

> Is `0`?

No.

> Is `[]`?

No. It's a list. It's just short.

Absence is absence and emptiness is emptiness, and after a week of that they will
be unable to go back, and they will be slightly annoyed about *that* too.

```scrml
given rows :> {
    @phase = .Success(rows.length)
}
```

***

Then a user will need to type something in, and the dev will brace for the part of
the job everyone hates.

They'll declare the field with what's *true* about it, right where it's declared:

```scrml
<name req length(>=2)> = <input type="text"/>
```

And the validity surface will assemble itself. `@signup.name.isValid`.
`@signup.name.errors`. `@signup.name.touched`. `@signup.isValid` for the whole
form, rolled up, reactive, read-only. Nobody wired it. There is no
`useForm`. There is no schema file that has to be kept in sync with the input
that it is describing, one desk over, forever.

They'll want to show the errors, so they'll ask where the error strings live.

And here is where it gets funny.

They aren't strings.

`@signup.name.errors[0]` is `.Required`. Or `.LengthFailed(predicate)`. The failure
has a **tag** and a **payload**, and the message is a rendering decision made later
by whoever is doing the copy, in whatever language they're doing it in.

Which means the dev is now holding a value with a fixed set of named cases and a
payload on some of them.

Which means the dev is holding an enum.

***

So they're going to ask if they can match on it.

And when they match on it, they'll want to know they got all of it. Not *probably*
all of it —

***

That's the joke, and it's also the design.

"If You Give a Mouse a Cookie" is funny because the chain is arbitrary: the milk
has nothing to do with the straw, and the mouse is just relentless. This chain
isn't arbitrary. Every link is the *same* link. Name the cases. Handle all of them.
Let the compiler hold you to it. Then notice that what you're holding at the end of
one loop is the input to the next.

Most languages let you start that chain. Not many are built so it closes.

The dev who came in asking for one small thing — *can I match on this?* — walks out
having accidentally described their entire application as a machine that cannot
reach a state nobody drew.

They think they got a `<match>` block.

They got the whole thing.
