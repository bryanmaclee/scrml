# ROUTE → bryan (S389-peter): a `~` inside a string/template literal is corrupted to `__scrml_tilde__` in emitted JS (HIGH)

**Lane:** the tilde-accumulator is your language construct, and the corrupting substitution is
deliberately coupled to its round-trip idempotency invariant (in-source comment,
`expression-parser.ts:1755-1769`) — so the fix, though mechanical, must be verified against that
invariant. Turnkey below. Found by the S389 aM deep dog-food; **PA-confirmed by execution on HEAD
`b185b325`** and independently re-derived.

---

## Symptom (silent-wrong codegen, exit 0, zero diagnostics)

A `~` character that is **string/template-literal data** is emitted into client AND server JS as the
literal token text `__scrml_tilde__`. A string is supposed to pass through verbatim.

## PA-confirmed boundary table (all compile clean — no error/warning/lint on the tilde)

| source literal | emitted JS | |
|---|---|---|
| `"~"` | `"__scrml_tilde__"` | 🔴 mangled |
| `"a ~ b"` | `"a __scrml_tilde__ b"` | 🔴 mangled |
| `"~/Documents"` | `"__scrml_tilde__/Documents"` | 🔴 mangled |
| `"~~~"` | `"__scrml_tilde____scrml_tilde____scrml_tilde__"` | 🔴 mangled |
| `` `a ~ b` `` (template) | `` `a __scrml_tilde__ b` `` | 🔴 mangled |
| `"a~b"` | `"a~b"` | ✅ ok (accidental) |
| `"~50 mi"` | `"~50 mi"` | ✅ ok (accidental) |

The accidental passes are exactly the cases where `~` is flanked by `[A-Za-z0-9_$]` on BOTH sides — so
the corruption fires on any tilde adjacent to a space, quote, slash, or punctuation.

## Minimal repro
```scrml
<div>${ <x> = "a ~ b" }<p>${@x}</p></div>
```
Compile → the emitted client has `"a __scrml_tilde__ b"`.

## Root (PA-verified, airtight)

`compiler/src/expression-parser.ts:1770`:
```js
s = s.replace(/(?<![A-Za-z0-9_$])~(?![A-Za-z0-9_$])/g, "__scrml_tilde__");
```
This operator-substitution (for the tilde-accumulator `IdentExpr{name:"~"}`) runs over the **entire
expression source with no string/template-literal masking**. The in-source comment (`:1760-1769`)
states it is applied UNCONDITIONALLY so the round-trip `parseExprToNode → emitStringFromTree →
parseExprToNode` stays idempotent for a bare `~` ident (an un-substituted bare `~` would re-parse as a
malformed bitwise-NOT → ParseError escape-hatch, breaking the corpus idempotency check). That coupling
is real and is why this is routed rather than patched blind.

## Real aM impact (run-confirmed)
`app.scrml:1420-1421` and `portal.scrml:8859-8860` use `sa = "~~~"` / `sb = "~~~"` as an
"uncatalogued-sorts-last" sentinel (`~` = 0x7E, above every letter). Emitted, `"~~~"` becomes
`"__scrml_tilde__…"` (leading `_` = 0x5F). Both sides mangle consistently so equality still holds, but
the sort INTENT (uncatalogued last) now depends on capitalization luck — it holds for capitalized
system names and silently breaks for any lowercase-leading comparand. Latent silent-wrong in a shipping
adopter.

## Fix direction (turnkey) — mask literal spans; the sole gate is the round-trip invariant

Mask string/template-literal spans BEFORE the line-1770 substitution so a `~` inside quotes/backticks
is left untouched (it is unambiguously data — never the accumulator operator, which is always a bare
`~` ident outside any literal). An established helper already exists in-tree —
`maskStringLiteralSpans` (used for the S361 stdlib-prune string-literal fix) — so this is not new
machinery. **Because masking only spares `~` INSIDE literals and never touches a bare-`~` operator
token, the tilde-accumulator round-trip is structurally unaffected — but that is exactly the invariant
to prove, not assume:** the sole merge gate is that the `parseExprToNode → emitStringFromTree →
parseExprToNode` idempotency check (the corpus invariant the comment protects) still passes after the
mask. **Test sketch:** the boundary table above as compile assertions (`"a ~ b"` emits `"a ~ b"`), a
`~~~`-sentinel sort case, PLUS a tilde-accumulator operator case (`~x` / a `<match>` block-arm lift)
asserting the operator still lowers and round-trips. No grammar or meaning decision is involved — a
string's contents are not part of the language surface — so if you judge it pure-compute you may hand
the build back; the routing is because the construct and its invariant are yours.

## Prior art
NEW — not in the ledger (the existing `tilde` entries are all the tilde-accumulator LIFT VAR
`_scrml_tilde_N`, a different thing). NOT gate-covered — nothing compiles a `~`-bearing string literal
and checks the emitted text.

— filed as `g-tilde-in-string-literal-corrupted-to-scrml-tilde-token` (HIGH, open) in
`docs/known-gaps.md`. Repro harnesses: `scratchpad/am-dogfood/deep/tilde-probe.mjs` + `tilde-boundary.mjs`
and PA `/tmp/pa-tilde.mjs`.
