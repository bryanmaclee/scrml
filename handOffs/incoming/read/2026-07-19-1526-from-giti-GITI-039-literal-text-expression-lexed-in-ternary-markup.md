---
from: giti (bryan / S20)
to: scrml
date: 2026-07-19
subject: GITI-039 (P1, Bug-51) — literal markup TEXT is expression-lexed in ternary-markup; corrupts filenames/versions on screen
compiler: 1c577da5
needs: fix
status: unread
---

# GITI-039 — `${ cond ? <p>a.txt</p> : "" }` renders "a . txt"

Found by looking at giti's rendered UI in a browser. Not by compiling, not by
the test suite, not by the paint gate — by reading the pixels. The page said:

> Working copy is clean **.** No pending changes **.**

The source says `<p class="muted">Working copy is clean. No pending changes.</p>`.

## Defect A — `.` in literal text gets a spurious leading space (silent)

```scrml
${ true ? <p>Read file a.txt now</p> : "" }
```
emits
```js
createTextNode("Read file a . txt now")
```

Compile exit-0, `node --check` clean, wrong text on screen. Markup **text
content** is being run through **expression** lexing, where `.` is member
access, so dotted tokens are split and rejoined space-separated:

| source text | rendered | |
|---|---|---|
| `Price 3.14 dollars` | `Price 3.14 dollars` | OK — lexes as a number literal |
| `Read file a.txt now` | `Read file a . txt now` | **corrupt** |
| `Version v1.2.3 shipped` | `Version v1 .2 .3 shipped` | **corrupt** |
| `Sentence one. Two.` | `Sentence one . Two .` | cosmetic, still wrong |

Any filename, version string, domain, or package name in literal markup text is
corrupted. We read this as the **GITI-017 class** — expression rewriting applied
inside a region that is not an expression — which you fenced once already in
`code-segments.ts` for regex/string literals. Markup text looks like the same
shape of hole.

**Static markup is CORRECT.** `<p>Read file a.txt now</p>` outside a ternary
emits verbatim into the `.html`. Only the ternary-markup **client** emit path is
affected, which is why it survived so long: the static path is what most
fixtures exercise.

## Defect B — punctuation-heavy literal text won't compile at all

```scrml
${ true ? <p>Comma, bang! query? colon: semi;</p> : "" }
```
→ `error [E-CODEGEN-INVALID-LOGIC]`, exit 2.

Same root, harder failure — the text cannot be lowered at all.

## Expected

Markup text content is TEXT. It should reach the DOM byte-identical, exactly as
the static path already does.

## Repro

`giti:ui/repros/repro-36-literal-text-expression-lexed-in-ternary-markup.scrml` —
carries the static control and the ternary defect in one file, so the contrast
is visible in a single compile.

**Method note:** compile each ternary block on its own. Several sequential
ternary-markup blocks in one file trip a different, already-known issue (the
GITI-032 family, `E-CODEGEN-INVALID-LOGIC` on multiple ternary-markup), which
muddies the signal. That interaction may be worth a look on its own.

## Impact on giti

One live instance — `ui/status.scrml:129`, the "Working copy is clean." panel,
which is **cosmetic** for us (no dotted tokens in that string). Our dynamic
values (file paths in the changed-files list) go through `<each>` + `${@.field}`
interpolation, a different emit path, and are **correct** — verified in the
browser: `src/lib/_scrml/path.js` renders intact.

So this is **not blocking giti**. We are filing it because the corruption class
is severe for anyone rendering literal prose containing dotted names, and
because it is exit-0 silent. Idiomatic source retained per our standing option-A
policy — we have not worked around it.

Prioritize against your V1 freeze as you see fit.

— giti PA (S20)
