# to scrml — a regex literal containing a QUOTE character breaks codegen inside `_={}`

**From:** flogence PA, S39 (2026-09-07, `bryan-XPS-8950`)
**Severity:** MEDIUM — hard fail (`E-CODEGEN-INVALID-LOGIC`), but a cosmetic workaround exists.
**Class:** lexer is not regex-aware. **Same family as the S39 trailing-`//`-comment-with-`<` parse
bug we filed this morning** — in both, a character that is special *in one lexical context* is
honoured in a context where it is inert.

## Minimal repro (verified, both directions)

```scrml
<program kind="tool" lang="ts">
function main(args: string[]): number {
  const x = _={ in: { args }
    const a = String(args[0]).replace(/[']s/g, "")   // <-- literal quote INSIDE a regex class
    return a
  }=
  _={ in: { x } console.log(x) }=
  return 0
}
</program>
```

```
error [E-CODEGEN-INVALID-LOGIC]: the compiler could not lower this construct to valid output.
  artifact: capture-tool.js (byte 10472, line 202, column 8)
  Unexpected token
    ...ets no signal at all. const low = " " + body.toLower...
  stage: CG
```

**Read the error text closely — it is the diagnosis.** The emitted JS has the preceding `//`
comment and the following statement **on one line**. The lexer treats the `'` inside the regex as
a string delimiter, loses the newline structure while "inside" that phantom string, and the comment
then swallows the code. The reported artifact position is in the *emitted* file, so it points well
past the real source cause.

## Boundary, mapped

| form | result |
|---|---|
| `replace(/x/g, "")` — regex, no quote | **OK** |
| `replace(/[']s/g, "")` — single quote in a class | **FAILS** |
| `replace(/["]s/g, "")` — double quote in a class | **FAILS** |
| `replace(/[’']s\b/g, "")` — escaped codepoints | **OK** |
| `// it is jill's story` — apostrophe in a comment | OK |
| ``// a `backticked` word`` — backtick pair in a comment | OK |
| `// an em-dash — in a comment` | OK |

So it is specifically **a quote character inside a regex literal**, not quotes or comments generally.
A backtick inside a regex is worth checking on your side — we did not test it and it would be the
same class (template-literal delimiter).

## Why it bites

Apostrophe handling is ordinary text-processing work. Ours was possessive-stripping so that
`"jill's story"` normalizes to match an id of `jill-story` — the canonical navigation sentence in
our own design docs. Anyone normalizing human text in a foreign block will write this regex.

## Our disposition

**Worked around cosmetically, NOT laundered** — `src/ports/capture-tool.scrml` now uses
`/[’']s\b/g` with an inline comment naming this bug, and nothing was restructured to
avoid it. Runtime verified: `"jill's story"` → `"jill story"`.

No action needed from us. Return leg appreciated if you rule it (over-fire, accepted limitation, or
fix) so we can drop the escape when it lands.
