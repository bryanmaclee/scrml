# How to use `lin`

`lin` is scrml's keyword for values that must be **consumed exactly once**. The compiler refuses to compile code that uses a `lin` value twice, drops it without using it, or moves it across a boundary where it might be used zero or many times.

If you have never met linear types before, the shortest way to think about them is: **`lin` is a `const` that has to go somewhere.** `const` lets you read the value as many times as you want, or never. `lin` insists the value is used precisely one time — once forget it, once use it twice, and the compiler stops you. This doc walks through when to reach for it, what counts as "using" it, how the rules interact with control flow and the markup bodies, and how to read and fix every `lin` error message.

For the normative spec, see `compiler/SPEC.md` §35. For the language as a whole, see `docs/tutorial.md`.

---

## When to reach for `lin`

Use `lin` for values where "it got used twice" or "it got silently dropped" is a real bug, not just a style choice. The canonical cases:

- **One-time authentication tokens, nonces, CSRF values.** A second use is a protocol violation; a zero-use is a silent drop.
- **Transaction handles, DB statements that must be submitted.** Forgetting to submit leaves the transaction dangling.
- **Database payloads destined for a single `INSERT`.** Re-using the same payload in two mutations is almost always a bug.
- **Values that carry ownership or identity you do not want to copy.** A session id, a Server-Sent-Events subscription handle, a single-use capability.

Use `let` or `const` for everything else. Reactive `@vars`, lookup keys that you want to reference multiple times, shared configuration, render data — none of these want `lin`. If the reader of your code would not be surprised that a value is used in two places, you are not looking at a `lin` value.

A decent rule of thumb: if removing one of the references would feel like losing data, the value is not linear. If removing one of the references would be a silent correctness fix, `lin` is the right tool.

---

## Declaring a `lin` variable

The keyword goes where `let` and `const` go:

```scrml
lin token = fetchToken()
```

The binding is immutable — you cannot reassign it — and the compiler begins tracking the variable as "unconsumed" at this line.

A function parameter can be `lin` too, by prefixing it:

```scrml
function authenticate(lin token: string) {
    sendToken(token)   // one consumption, inside the function body
}
```

`lin` parameters are tracked the same way local `lin` bindings are. The compiler demands that every execution path through the function body consumes the parameter exactly once.

The one restriction: you cannot reassign a `lin`. There is no `lin x = 1; x = 2`. The binding is fixed at its initializer.

---

## What counts as "consuming"

Any reference to a `lin` identifier in a position where a value is needed is a consumption. Five cases, each counted as one use:

**1. Reading it in an expression.**

```scrml
lin token = fetchToken()
let pair = [token, otherValue]   // consumption — token is read
```

**2. Passing it as a function argument.**

```scrml
lin token = fetchToken()
authenticate(token)              // consumption — token is passed
```

Regardless of what `authenticate` does with the value — reads it, ignores it, stores it, throws it away — the call site counts as the consumption.

**3. Capturing it in a closure.**

```scrml
lin token = fetchToken()
let send = () => sendToken(token)   // consumption — at closure CREATION
```

This one surprises people. The closure's capture of the variable is the consumption event, not the closure's body running. That is deliberate: the compiler cannot tell at compile time whether `send` will be called 0, 1, or 1000 times, so it fixes the count at the moment the closure forms. Once `send` exists, `token` is consumed. Capturing `token` in a second closure is E-LIN-002 (used twice).

**4. Lifting it** via `lift`.

```scrml
lin token = fetchToken()
lift token   // consumption — moves the value into the ~ pipeline
```

**5. Using it as a `match` subject.**

```scrml
lin ticket = nextTicket()
match ticket {
    .Small :> …
    .Large :> …
}
```

The subject of a `match` is consumed. Each arm then sees the value under a different variant pattern; the branch-consistency rules below apply.

One mental shortcut: if the reference shows up in the AST in a position where a regular value would be read, it is a consumption.

---

## Control flow — the branch rule

If you consume a `lin` inside an `if`, you must consume it in **every** branch that can be taken on that execution path, or in **no** branch. Consuming it asymmetrically is `E-LIN-003`.

```scrml
lin token = fetchToken()

if (needsAuth) {
    authenticate(token)
}
// Error E-LIN-003: the else path leaves token unconsumed
```

Two fixes:

```scrml
// 1. Consume in both branches. `discard` here is a helper you write
//    somewhere in the file — e.g. `function discard(lin x) {}`. There
//    is no built-in sink; the pattern is just a function that accepts
//    the lin parameter and does nothing with it.
if (needsAuth) {
    authenticate(token)
} else {
    discard(token)
}
```

```scrml
// 2. Consume unconditionally, then branch on something else
authenticate(token)
if (needsAuth) { … }
```

`match` follows the same rule: every arm must consume the `lin` the same number of times as every other arm.

Loops are stricter. You cannot consume an outer-scope `lin` inside a loop body — the compiler cannot prove the loop runs exactly once, and a consumption that happens `n` times is definitionally not "exactly once."

```scrml
lin token = fetchToken()

for (let i = 0; i < 3; i = i + 1) {
    authenticate(token)   // Error E-LIN-002: consumed inside a loop
}
```

A `lin` declared *inside* the loop body and consumed inside the same iteration is fine — each iteration produces and consumes its own fresh binding.

---

## Across `${}` blocks and markup interpolations

A `lin` declared in one `${}` logic block can be consumed in a later `${}` block, or in a markup interpolation between them, as long as both sit under the same parent scope.

```scrml
<program>
    ${
        lin token = fetchToken()
    }
    <p>Welcome — your session starts with ${token}.</>
</program>
```

The `${token}` in the `<p>` text is a consumption. The compiler hoists the JS `const` for `token` to the enclosing scope once, so the generated output has a single binding that both the declaration and the interpolation refer to.

What is **not** allowed is a reference *between* the declaration and the consumption:

```scrml
<program>
    ${
        lin token = fetchToken()
    }
    <p>Peek: ${token}</>   <!-- consumption #1 -->
    <p>And again: ${token}</>   <!-- Error E-LIN-002: consumed twice -->
</program>
```

Every reference is a consumption event. "I just wanted to look at it" is not a category — there is no read-only form of `lin`.

---

## The `<request>` / `<poll>` boundary

Two markup elements schedule their body for deferred execution:

- `<request>` (§6.7.7) runs its body on mount and again whenever a declared reactive dep changes.
- `<poll>` (§6.7.6) runs its body on an interval.

You **cannot** consume an outer `lin` inside one of these bodies. The compiler cannot prove the body runs exactly once — it might run zero times (deps never change, component unmounts first) or many times (poll interval fires repeatedly, reactive dep updates). This is `E-LIN-006`.

```scrml
<program>
    ${
        lin token = fetchToken()
    }
    <request id="profile">
        ${ @user = authenticate(token) }   <!-- Error E-LIN-006 -->
    </>
</program>
```

The fix is to move the `lin` declaration inside the deferred body, so it is freshly produced every time the body runs:

```scrml
<program>
    <request id="profile">
        ${
            lin token = fetchToken()
            @user = authenticate(token)
        }
    </>
</program>
```

If the token is genuinely a one-shot value that does not re-fetch on every request, then `lin` is probably the wrong tool — use a regular `let` or `const`.

---

## Closures are different

Closures are NOT subject to the `<request>`/`<poll>` boundary rule. That looks odd at first — a closure is also "deferred execution," right? — but the §35.6 model already solved the dominance problem for closures by fixing consumption to capture time.

```scrml
lin token = fetchToken()
setTimeout(() => authenticate(token), 100)   // OK — consumption happened at the closure expression
```

The arrow function's creation is the consumption event. Whether `setTimeout` ever fires the callback, and whether the callback runs once or zero times, is irrelevant to the static count. The compiler sees one consumption, the rule is satisfied, you are done.

Two consequences worth knowing:

**A closure can capture a `lin` only once.** Capturing the same name in two closures is E-LIN-002 (double consumption, at the second closure's creation).

```scrml
lin token = fetchToken()
let a = () => use(token)   // consumption
let b = () => use(token)   // Error E-LIN-002
```

**A closure that captures a `lin` and is never called still consumes it.** Capture is the event; invocation is irrelevant.

```scrml
lin token = fetchToken()
let unused = () => use(token)   // token is consumed even though unused() never runs
// (no error — single consumption is valid)
```

---

## Shadowing is an error

You cannot introduce a `let`, `const`, or inner `lin` with the same name as a `lin` in a strictly enclosing scope. That is `E-LIN-005`.

```scrml
function outer() {
    lin token = fetchToken()
    for (let i = 0; i < 3; i = i + 1) {
        let token = i   // Error E-LIN-005
    }
    authenticate(token)
}
```

The reasoning: shadowing a `lin` makes every subsequent reference to `token` ambiguous — which binding did the consumption refer to? The compiler refuses to guess. The fix is always to rename.

Same-scope rebinding is a different story and not covered by E-LIN-005 (a `lin x`-then-`let x` at the same scope is a general redeclaration question). The rule specifically targets shadowing from a child scope into a parent's `lin`.

---

## Error catalog with fixes

Every `lin` error has a named code. Here is what each one means and how to resolve it.

**E-LIN-001 — declared but never consumed.** The variable reached the end of its scope unused on at least one path.

> E-LIN-001: Linear variable `token` declared but never consumed before scope exit. Pass it to a function, return it, or remove the 'lin' qualifier if single-use isn't needed.

Fix: use it, or drop the `lin` keyword. If the value is optional at this scope, lift it up — pass it to a caller that will decide what to do with it.

**E-LIN-002 — used more than once.** A second reference on the same execution path. The message names both use sites so you can see which one to delete.

Fix: delete one of the uses, or clone the value into a regular `let` before the first use (this is the usual pattern for values where "I need the value twice" is a legitimate requirement — `lin` was the wrong choice).

**E-LIN-003 — branches disagree.** Some branches consume, some do not. The message names the asymmetric branch.

Fix: consume in every branch, or in none; consume before the branch if the consumption is unconditional; or use `else` to make an `if` exhaustive.

**E-LIN-005 — shadowing.** A `let`/`const`/`lin` declaration shadows an enclosing `lin` of the same name.

Fix: rename the inner binding. Always safe.

**E-LIN-006 — consumed inside `<request>`/`<poll>`, declared outside.** The deferred-execution boundary makes dominance unprovable.

Fix: declare the `lin` inside the body so it is produced fresh each run — or reconsider whether `lin` is the right choice; if the value is shared across the boundary, it is not really linear.

---

## Patterns worth remembering

**Pattern 1 — auth token into a single request.** The canonical use case.

```scrml
${
    function loadProfile(userId) {
        lin token = getAuthToken()
        return fetchWithAuth(userId, token)
    }
}
```

One declaration, one consumption inside the returned call. If a reviewer ever adds a second use, the compiler will catch it.

**Pattern 2 — transaction handle.**

```scrml
${
    function submitOrder(cart) {
        lin tx = db.beginTransaction()
        tx.commit(cart)   // consumption — commit takes the handle
    }
}
```

The compiler enforces that the transaction is always committed (or aborted via an explicit consume). Forgetting to commit is E-LIN-001.

**Pattern 3 — fresh value per deferred run.**

```scrml
<request id="profile" deps=[@userId]>
    ${
        lin token = getAuthToken()   // fresh on every deps change
        @user = fetchUser(@userId, token)
    }
</>
```

`lin` inside `<request>` is fine — the declaration and consumption share a single deferred execution.

**Pattern 4 — conditional consume.** If the consumption site is conditional, move the decision to a helper function so the compiler sees the paths clearly.

```scrml
${
    function useOrDiscard(cond, lin val) {
        if (cond) {
            process(val)
        } else {
            discard(val)
        }
    }

    function caller() {
        lin token = fetchToken()
        useOrDiscard(shouldAuth, token)
    }
}
```

---

## When `lin` is the wrong tool

`lin` is strict by design. It gets in your way every time the value is genuinely multi-use. A few signs that you have reached for it by mistake:

- You find yourself writing `let copy = value` right after `lin value = …` to make the compiler quiet. Just use `let` or `const` in the first place.
- The "consumption" is really a read for rendering (`<p>${token}</p>`), and later code also wants to read it. Rendering is a consumption, so one use is fine — but if two places need the same value, `lin` is fighting you.
- The value represents application state that ought to be reactive. Use `@var` (§6). Linearity and reactivity are different concerns.
- The value is loaded once and read many times (configuration, a cached lookup, a constant). Use `const`.

A good intuition: `lin` is for **ownership transfer**. If you would not write "transfer ownership of X to Y" to describe what the code does, `lin` is not pulling its weight.

---

## Reference

- `compiler/SPEC.md` §35 — normative language.
- `compiler/SPEC.md` §35.2.1 — `lin` function parameters.
- `compiler/SPEC.md` §35.2.2 — cross-`${}` block `lin`.
- `compiler/SPEC.md` §35.3 — consumption events.
- `compiler/SPEC.md` §35.4 — control flow interactions.
- `compiler/SPEC.md` §35.5 — error catalog (E-LIN-001 through E-LIN-006).
- `compiler/SPEC.md` §35.6 — closure interaction.
- `compiler/SPEC.md` §35.7 — server/client boundary interaction.
- `compiler/SPEC.md` §35.8 — interaction with `~`.
