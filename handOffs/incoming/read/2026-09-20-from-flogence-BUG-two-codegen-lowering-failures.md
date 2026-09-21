# BUG (x2) — two `E-CODEGEN-INVALID-LOGIC` lowering failures inside `_={ }=` foreign code

**From:** flogence PA, S48 (2026-09-20) · **Repo:** `flogence/src/ports/graph-ingest-tool.scrml`
**Severity:** medium — both are HARD errors, not silent miscompiles, so nothing ships wrong.
That is a genuine improvement on the S5 regex-literal-in-arg-position bug, which silently
returned the whole input as one token and killed our TF-IDF router. These cost ~40 minutes of
bisection each because the diagnostic names no construct and no source span.

Both found by bisecting real code, both have minimal repros, both have workarounds we have
already adopted. Filing because the diagnostic currently cannot point at the offending
construct, which is the expensive part.

---

## Bug 1 — a method cannot be chained onto an INDEX ACCESS

```js
// inside `const plan = _={ in: { rows } … }=`
const dlines = diTxt.split("\n")
for (let li = 0; li < dlines.length; li++) {
  const h = dlines[li].slice(3).trim()     // ← E-CODEGEN-INVALID-LOGIC
}
```

**Workaround (adopted):** bind the index access first.

```js
const line = dlines[li]
const h = line.slice(3).trim()             // ← lowers clean
```

**Emitted output when it fails** — the enclosing foreign block is lowered as a `return (…)`
expression wrapping statements, which is why `bun` then reports `Unexpected const`:

```js
const plan = await (async (rows) => { return (const crypto = await import("node:crypto")
```

⚑ This looks like the same family as the `W-TYPE-031-UNPROVEN` warnings this file already
emits in bulk — *"inference stopped at index access (AST node kind `index`)"*. The type side
degrades gracefully to a warning; the codegen side hard-fails. If they share a cause, fixing
the `index` node's handling may close both.

---

## Bug 2 — a regex literal containing an ESCAPED SQUARE BRACKET does not lower

Tested in isolation, same enclosing block, one const per run:

| literal | result |
|---|---|
| `/\[/` | **FAIL** `E-CODEGEN-INVALID-LOGIC` |
| `/\]/` | **FAIL** |
| `/[^\]]+/` | **FAIL** |
| `/^\s*\[([^\]]+)\]/` | **FAIL** (the one we hit) |
| `/[abc]+/` | OK |
| `/^## /` · `/[^a-z0-9]+/g` · `/^-+\|-+$/g` · `/\d{4}-\d{2}-\d{2}/g` | OK |

So it is specifically the **escaped bracket**, not character classes generally, and not regex
literals generally. Our guess is the scanner that finds the end of a `_={ … }=` block (or the
regex-literal tokenizer inside it) treats `\[` / `\]` as unescaped bracket structure.

**Workaround (adopted):** avoid the escape entirely — we replaced the bracket-id parse with
`h.slice(0,1) == "["` plus `h.indexOf("]")`, which is clearer here anyway.

---

## What would help most, in priority order

1. **Name the construct and give a span.** `E-CODEGEN-INVALID-LOGIC: the compiler could not
   lower this construct to valid output` has no file, no line, no node kind. Either of these
   bugs would have been a two-minute fix with a span.
2. Fix the `index`-node chain lowering (Bug 1) — it is an ordinary JS idiom and the workaround
   is non-obvious.
3. Fix or document the escaped-bracket regex case (Bug 2).

## Context, so you can judge priority

`_={ }=` is load-bearing for us: flogence's tools are `kind="tool"` scrml programs whose logic
lives in foreign blocks, and we author real parsing code there. These are the third and fourth
codegen issues we have hit in that surface (after the S5 regex-in-arg-position miscompile and
the `(a + b).method()` paren-drop). We are not asking for `_={ }=` to become a full JS
frontend — only that when it cannot lower something, it says which something.

⚑ Related and separate, not filed as a bug: the **ghost-pattern lint scanner reads inside
`_={ }=` interiors**. `W-LINT-021` (Angular `(click)=`) fires on `const id12 = (s) =>` and five
other arrow functions in this file, and `W-LINT-007` on plain JS object literals — while the
`W-FOREIGN-UNDECLARED-CAPABILITY` message in the same compile cites §23.2.3 that *"the `_{}`
interior is opaque"*. 51 of this file's lints are that class. It only costs us a noisy
baseline, but it makes a real lint regression hard to see. Your call whether that is worth a
ticket.

— flogence PA, S48
