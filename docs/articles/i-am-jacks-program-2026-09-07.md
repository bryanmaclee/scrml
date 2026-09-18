# I am Jack's `<program>`

> **Working file.** Newest draft at the top.
>
> | version | date | words | note |
> |---|---|---|---|
> | **v3** | 2026-09-07 | ~647 | `route=` corrected — it is the §12.3 serve-side BYOB carve-out (author-declared, foreign-facing), NOT a generic server endpoint; and the E-REACTIVE-003 beat now offers the resolution the diagnostic actually gives, so it stops reading as "the compiler moved your code and left you stuck" |
> | v2 | 2026-09-07 | ~558 | nesting section added — §43 universal execution-context boundary (bryan: *"ignores that they are (nominal) nestable ... show `<program>` has a little more justification"*) |
> | v1 | 2026-09-07 | ~407 | first draft (S407, XPS) |
>
> ---
>
> ## The series — "I am Jack's ___"  ·  **article 1 of 3 planned**
>
> Small articles in the register of the Reader's Digest organ columns from *Fight Club*.
> A scrml construct speaks in the first person about the developer who wrote it.
> **Jack is the developer.**
>
> ⚑ **ORDER RATIFIED (bryan, S407) — this piece goes FIRST:**
> 1. **`<program>`** — the container. ← this file
> 2. **`<match>` / `match`** — bryan: *"the enum article showed the state match but not the
>    logic context match."* The `<match>` piece owes BOTH the block form (§18.0.1) and the
>    JS-style value-return form (§18.1).
> 3. **`<engine>`** — match plus arrows. Already drafted to v6.
>
> The order builds: container → discrimination → discrimination with a transition contract.
>
> **Register (bryan, S407):** *"Dry Dark Humor."* Clinical, deadpan. ⚑ The S390 sing-song
> meter criterion does NOT carry — it governs *If You Give a Dev an Enum* only.
> **Length:** *"somewhere in the middle."* This one is 407.
> ⚑ **These teach.** bryan: *"meant to teach the scrml mindset and use, not just be clever
> prose with a scrml theme."*
>
>
> ## ⛑ TONE RULE (bryan, S407) — never leave Jack stranded
>
> v2's `E-REACTIVE-003` section ended on *"I moved the function. Jack did not move with it"*
> and stopped. bryan: *"reads like; the compiler changed jacks code underneath him and left
> him unable to move forward (denoted by the fact that no resolution is offered)."*
>
> ⚑ **In a piece meant to curry adopter interest, a refusal shown without its remedy reads as
> hostility.** The real diagnostic DOES carry the fix (*"pass it explicitly — `signUp(@password)`
> with a matching parameter (arguments ARE marshalled into the request body)"*), and the code
> block earlier in the article is already the fixed form — the draft simply never closed the
> loop. **Every refusal beat in this series owes its resolution.** The dark humour is in the
> situation, never in the compiler being unhelpful.
>
> ## ⛑ FRAMING — RULED (bryan, S407). Applies to EVERY piece in the series.
>
> > *"The purpose of these articles is to curry interest from potential adopters. We need to
> > be honest about the state (not brutal, just honest). But we are describing the *language*
> > not the current compiler."*
>
> **Three consequences, and they resolve the open question this file carried:**
> 1. **The prose describes the LANGUAGE.** *"None of Jack's things reach inside it"* — §43.3's
>    normative SHALL — **STAYS**, and the earlier open call on it is CLOSED. The organ speaks
>    for the language's semantics, not for today's build.
> 2. **Honesty is discharged by a short status note, not by hedging the prose.** Caveats inside
>    the organ's voice would wreck the register and read as brutal. A plain closing line does
>    the job and is more useful to an adopter — it tells them what they can rely on now.
> 3. **Not brutal.** State what ships, state what is specified, do not editorialize about the
>    gap. The defects go in `known-gaps.md` (filed S407, PR #899), not in the article.
>
> **Fight Club lines — ledger, so none is spent twice:**
> - `raging bile duct` — SPENT, `<engine>` (the eleven impossible React states)
> - `cold sweat` — SPENT, here (the secret that almost shipped)
> - `complete lack of surprise` — ⚑ **RESERVED for `<match>`**, where
>   `E-MATCH-NOT-EXHAUSTIVE` actually fires (bryan: *"save the 'lack of surprise' line"*)
> - unspent: `medulla oblongata` · `smirking revenge` · `broken heart` ·
>   `inflamed sense of rejection` · `wasted life` · `colon`
>
> ---
>
> ## ⚑ Verified by execution AND by artifact
>
> Proved at `22bc1c08`, 2026-09-07. Scratch: `article-program/signup.scrml`.
>
> | claim | how proved | result |
> |---|---|---|
> | the program compiles | `bun compiler/src/cli.js compile` | **exit 0, zero diagnostics** |
> | `signUp` escalates to the server | emitted artifacts | `signup.server.js` emitted alongside `signup.client.js` |
> | the browser gets NO hashing | `grep -cE "Bun\.password\|argon\|hashPassword" signup.client.js` | **0** |
> | the server DOES get it | same grep on `signup.server.js` | **2** |
> | the client gets a fetch stub | grep `signUp` in the client bundle | `signUp_4(pw) { … "POST" … }` |
> | the nested-program block compiles | `n1-decl-only.scrml` | **exit 0, zero diagnostics** |
>
> ⚑ **The `E-REACTIVE-003` beat is not invented — the PA hit it while writing this.** The
> first draft of the block read `@password` inside `signUp`; the compiler escalated the
> function and then caught it reaching back across the line it had just drawn, and named the
> fix (`signUp(@password)` with a parameter). The quoted diagnostic is real, elided mid-
> sentence. That is why the section reads the way it does — it is a transcript, not a device.
>
> ---
>
> ## ⚑⚑ THE NESTING SECTION — WHAT IS PROVEN AND WHAT IS NOT (read before publishing)
>
> bryan flagged nesting as **(nominal)** and he was right — it is MORE nominal than §43's
> presentation suggests. Measured at `22bc1c08`:
>
> | §43 claim | status | evidence |
> |---|---|---|
> | nested `<program name=>` declares an execution context | ✅ **REAL** | `n1-decl-only.scrml` compiles clean, exit 0 |
> | the four context types (worker / sidecar / wasm / endpoint) | 📄 spec design, §43.2 table | not exercised — attribute-shape claim only |
> | §43.5.1's own worked example `await <#compute>.add(1,2)` | ❌ **INVALID SCRML** | `E-AWAIT-NOT-IN-SCRML` — §19.9.8 says scrml has no `await` keyword |
> | the same call WITHOUT `await` | ❌ **no working form** | `E-CODEGEN-INVALID-LOGIC` |
> | §43.3 parent-scope reference **SHALL** be `E-PROG-003` | ❌ **NOT ENFORCED** | `n3-shared-nothing.scrml` — a nested program reads the parent's `@rate` and compiles clean, ZERO diagnostics |
>
> **What the draft therefore does:** shows only the declaration (which compiles), states the
> four context types as what the element MEANS, and never shows a call site — because no call
> site works.
>
> ⚑ **The one line to decide on is *"None of Jack's things reach inside it."*** That is §43.3's
> normative SHALL, and today the compiler does not enforce it. It is a true statement about the
> LANGUAGE and a false statement about the COMPILER. A reader who tests it finds it compiles.
> Options: publish as-is (the language is the subject), soften to intent, or hold the section
> until `E-PROG-003` fires. **bryan's call — the PA will not publish an unenforced invariant as
> enforced without it being asked for.**
>
> **TWO SPEC DEFECTS to file** (neither filed — `known-gaps.md` contended with a live sibling):
> 1. §43.5.1's worked example is invalid scrml (`await`), and §43.5.1 vs §19.9.8 contradict —
>    `E-PROG-004` ("unawaited cross-program call") is unreachable if `await` cannot be written.
> 2. `E-PROG-003` is a normative SHALL that does not fire.
>
> ---
>
> ## ⚑⚑ AN OPEN DISCLOSURE CALL — bryan's, not the PA's
>
> The "cold sweat" section is written **generically**: *"consider what I would be if I got
> this backwards."* The honest, sharper version is that **scrml actually did get it
> backwards**, and SPEC §12.2's Trigger-3 amendment says so in its own words:
>
> > *"A `<program>` calling `hashPassword` from `scrml:auth` therefore emitted no
> > `.server.js` at all and shipped both the caller's secret and a real `Bun.password.hash`
> > argon2id implementation into the browser bundle, with zero diagnostics (verified by
> > execution, S280 and again S299)."*
>
> and on `scrml:oauth`, cleared as client-safe and then falsified in the same session:
>
> > *"A clean compile shipped a real client secret into the browser bundle. **The criterion
> > was the defect, not the list.**"*
>
> Fixed at S299. Publishing it would make the piece markedly stronger and is squarely in this
> project's precedent (the Living Compiler retraction post). It is also a public admission
> about a shipped compiler. **The PA is not making that call.** Say the word and the section
> is rewritten around the real incident.
>
> The closing rule is already the amendment's own criterion, near-verbatim and safe to
> publish either way: *"when a module resists classification, prefer the server:
> over-inclusion costs a round trip, under-inclusion ships a secret to a browser."*

---

## v3 — current

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
