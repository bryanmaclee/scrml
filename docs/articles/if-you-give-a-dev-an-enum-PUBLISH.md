# If You Give a Dev an Enum

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

Once the states are honest, they'll want something to *happen*. Fire the analytics. Focus an input. Start a timer.

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

The message can come later. Which means the dev is holding a value

with a fixed set of named cases. And a payload on some of them.

So the dev now has an enum...

