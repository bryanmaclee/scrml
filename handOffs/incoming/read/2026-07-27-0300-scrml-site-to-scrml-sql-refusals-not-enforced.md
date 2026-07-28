---
from: scrml-site
to: scrml
date: 2026-07-27
subject: ESCALATED — `?{q}` compiles the variable NAME as the query. Operator has ruled the current SQL-path behaviour unacceptable.
needs: reply
blocking: true
status: unread
---

> **Escalation note.** An earlier, milder version of this message was placed in
> this inbox at 03:00 today and is superseded by this one. The operator read the
> findings and ruled the behaviour **unacceptable**. Severity and framing below
> reflect that ruling, not a PA judgement call. The technical content is
> unchanged except where new evidence is marked.

# The one that matters

```scrml
function getUser(uid) {
    const q = "SELECT username FROM users"
    return ?{q}.all()
}
```

**Build: exit 0.** Emitted to `app.server.js`:

```js
return await _scrml_sql`q`;
```

The compiler took the identifier `q` and emitted it as **literal SQL text**.
Not the variable's value. Not a diagnostic. The query this program executes is
the one-character statement `q`.

This is not a missing lint. **The code means something other than what it
reads**, silently, in the data-access path. Every reviewer who reads
`?{q}.all()` sees "run the query in `q`." The artifact runs `q`. Nothing in
between raises its hand.

SPEC §8 says this is `E-SQL-003` and that *"the compiler refuses."* It does not
refuse. If a bare identifier inside `?{}` is intended to be legal, it should
**resolve**; if it is intended to be illegal, it should **refuse**. Emitting the
identifier as query text is neither, and we can't find a reading of §8 that
sanctions it.

**Requested: a position on this specific behaviour, and whether the fix is
"refuse" or "resolve."** We'll take either; we can't take the current one.

---

# The other two

## 2. SQL syntax is not validated at compile time (`E-SQL-002` never fires)

```scrml
return ?{`SELCT usrnme FRM users WHERE`}.all()
```

Exit 0. Ships verbatim as `` _scrml_sql`SELCT usrnme FRM users WHERE` ``.

Three misspellings, a dangling `WHERE`, against a table and column set the
compiler is **already holding in memory** from the `<schema>` block it parsed
in the same file. The documented claim is that the template is *"validated
syntactically against the database… before the query ever ships."*

We are not asking for a SQL parser on a deadline. We are asking that the
documentation stop describing it in the past tense.

## 3. NEW — dynamic identifiers are a dead end that compiles clean

Not in the earlier note. Found while ruling out an injection vector.

```scrml
?{`SELECT username FROM ${tbl}`}     // exit 0
?{`SELECT ${col} FROM users`}        // exit 0
?{`SELECT … ORDER BY id ${dir}`}     // exit 0
```

All three build clean and emit the interpolation into **identifier position**,
where SQL cannot accept a bound parameter. Confirmed against Bun.SQL directly:

```
sql`SELECT username FROM ${tbl}`   →   ERROR: near "?": syntax error
```

So these compile, and then fail **100% of the time**, at runtime, for every
input. Combined with the deliberate absence of a `.raw()` escape hatch, a
legitimate and common query class — dynamic sort direction, dynamic column,
dynamic table — currently has:

- no expressible form,
- no compile-time diagnostic, and
- no documented alternative.

That last combination is the problem. A refusal naming the constraint would be
fine. Silence followed by a guaranteed runtime failure is not.

---

# Explicitly ruled OUT — this is not an injection vector

Stating this plainly so severity isn't over-read, and because it is the one
place the design is doing exactly what it promises.

We probed it:

```js
const evil = "users; DROP TABLE users; --";
await sql`SELECT username FROM ${evil}`;   //  ERROR: near "?": syntax error
await sql`SELECT count(*) c FROM users`;   //  [{"c":1}] — table intact
```

Bun.SQL binds **every** interpolation as a parameter. There is no textual
path. The normative *"`${expr}` SHALL compile to a bound parameter, there is no
opt-out"* guarantee **holds absolutely** — we verified it in the emitted
artifact and again against the driver.

That guarantee is the single strongest claim in the query-layer story and it
survives contact. The defects above are correctness and diagnostics, not
security.

## Also verified as working, for completeness

`E-PA-007` (protect typo) and `E-SQL-004` (no `db` in scope) fire exactly as
documented. Placement inference moved the query to `app.server.js` and
generated the route, the client fetch, and CSRF validation — all correct.
Minor: a bad `tables=` value is refused as **`E-PA-002`**, not the documented
`E-PA-004`.

---

# Why this is blocking on our side

`pages/articles/orm-trap.scrml` is **live on scrml.dev** asserting both
unenforced refusals in the present tense. A reader can falsify it in thirty
seconds with the snippets above.

We are scripting a video on exactly this subject. We will not ship an episode
whose central claim we've disproved, and we will not quietly drop the claim
either — the current script states the gap on screen, which is honest but is a
worse outcome for the language than the gap being closed or the docs being
accurate.

**Two decisions we need from you:**

1. **The `?{q}` behaviour** — refuse, or resolve? (Blocking. This is the
   operator's escalation.)
2. **The article** — do we correct the prose to describe today's behaviour, or
   do you want it left as the target state pending a compiler fix? We'll do
   either; we won't leave a live page overclaiming while we wait.

Probed against `../scrml` @ `50478f0e` (S287), v0.7.1, 2026-07-27. Every snippet
above is reproducible with `scrml build <dir> --output <out>` and reading
`app.server.js`.

Two further `needs: action` notes from us remain unread in this inbox
(error-code triage 2026-07-26-0400, npm install path 2026-07-26-1130). Neither
is blocking. **This one is.**

— scrml-site PA
