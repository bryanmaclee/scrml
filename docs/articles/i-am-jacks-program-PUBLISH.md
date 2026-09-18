# I am Jack's `<program>`

I am Jack's `<program>`.

Jack declares me once, in one file, for the whole application. Everything he writes lives
inside me — his markup, his logic, his styles, his database.

There is a line running through me. On one side is Jack's server. On the other is a browser
Jack does not own, cannot see, and should not trust.

Jack does not draw that line. I do.

***

Everything Jack writes runs in the browser. That is the default, and it holds until I find a
reason to move it.

```scrml
<program title="Jack's Store">
    import { hashPassword } from "scrml:auth"

    <password> = ""

    function signUp(pw: string) {
        const hash: string = hashPassword(pw)
        println(hash)
    }

    <h1>Sign up</>
    <input type="password" bind:value=@password/>
    <button onclick=signUp(@password)>Create account</>
</program>
```

I found a reason. `signUp` reaches `scrml:auth`, and `scrml:auth` handles things that must
never arrive in a browser. So `signUp` is not a browser function any more.

Jack gets two files he did not ask for. This is what ships to the browser:

```js
signUp_4(pw) { ... fetch("signUp_1", "POST", _scrml_body) }
```

And this is what stays behind:

```js
import { hashPassword } from "./_scrml/auth.js"
```

The password is hashed in a process Jack controls. The browser gets a POST and a promise.

Jack never typed the word `server`. There was a keyword for it once. It is deprecated now.
Everything it used to tell me, I work out on my own.

***

Jack thinks of me as one thing per application. I am one thing per *boundary*.

Put me inside myself, and the inner one is not a section of Jack's app. It is a separate
execution context, with its own scope and its own lifecycle.

```scrml
<program name="compute">
    export function withTax(n: number) -> number { return n * 1.08 }
</>
```

What that becomes depends on how Jack dresses it. A `name=` and it is a web worker. Add a
`lang=` and it is a subprocess speaking another language. Add `mode="wasm"` and it is a
WebAssembly module. Give it a `route=` and it is an endpoint at a fixed address — the one
shape Jack has to name himself, because the thing that will call it is not his.

Every other address in his application is mine. He has never seen one.

Same element. Four different machines.

None of Jack's things reach inside it. Not a binding, not a type, not an import. If he wants
the inner one to know his tax rate, he sends it.

A boundary that leaks is decoration.

***

The first time Jack wrote that function, it read `@password` out of the air.

> `error [E-REACTIVE-003]: Server-escalated function signUp reads the client-side reactive variable @password. ... this read lowers to _scrml_body["password"], which the client stub never sends, so it resolves to undefined at request time.`

He had written a function that reached across a line which did not exist when he started
typing it. I moved the function. Jack did not move with it.

So I told him where the seam goes: pass the password in, and I will carry it across. That is
the version above. It cost him one parameter.

***

Consider what I would be if I got this backwards.

Jack's hashing, and the secret it holds, compiled into a file that every visitor downloads.
A green build. No warning. Nobody learns about it until somebody does.

I am Jack's cold sweat.

So when something resists classification, I put it on the server. Wrong in that direction
costs Jack a round trip. Wrong in the other direction costs him the secret.

***

Jack thinks of me as the place his application starts.

I am the place it is divided.

---

*scrml is pre-1.0. The server/client split in this piece ships today — the two bundles above
are real compiler output. Nested execution contexts are specified and not yet built: the
boundary described here is the language's, and the compiler is still catching up to it.*
