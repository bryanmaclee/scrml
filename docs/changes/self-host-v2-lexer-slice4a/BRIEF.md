# BRIEF — self-host-v2 lexer slice-4a (precise cooked-decode)

sPA ss55 · item 1/5 · dispatched to `scrml-js-codegen-engineer` (isolation:worktree) · base `1c7526f6`.

## Task
Extend `compiler/self-host-v2/lex.scrml` so `scanString` AND `scanTemplateChunk` produce a PRECISE
`cooked` value matching impl#1's `scanStringEscape` (`compiler/native-parser/lex-in-single-string.js`):
- `\xHH` (2 hex) · `\uHHHH` (4 hex) · `\u{…}` (brace) → codepoint (`parseInt(hex,16)` + `String.fromCodePoint`).
- `\<newline>` / `\<CR>`(+`\n`) line-continuation → contributes "" to cooked.
- all other escapes stay on the single-char `decodeSingleEscape` table.
`raw`/span unchanged (already correct); only `cooked` becomes precise. Template chunk previously set
`cooked == raw` — now carries true decoded cooked (impl#1 reuses `scanStringEscape` for template chunks).

## Host-support probe (BEFORE editing)
Verify scrml can call `parseInt(str,16)` → int, `String.fromCodePoint(int)` → string, `Number.isNaN`.
If unsupported → dogfood finding + workaround (manual hex fold / `fromCharCode` fallback for BMP corpus).

## Oracle extension
New sibling `compiler/tests/integration/self-host-v2-lexer-slice4a.test.js` mirroring the slice3
compile→discover→eval→token-diff harness, additionally comparing the **cooked** field:
impl#1 `token.cooked` (spread) vs impl#2 `token.kind.data.cooked`. Escape-bearing corpus in both quote
styles + template chunks. No-regression guard for slices 1-3. Loop-until-green; slices 1-3 stay 119/119.

## Constraints
- Touch ONLY: `lex.scrml`, `progress.md`, `self-host-v2-lexer-slice4a.test.js`.
- Honor F1 (`<program>` wrapper) · F2 (string-dispatch) · F4 (qualified `TokenKind.X`) · F5 (annotate `: int`)
  · F6 (no `|` alternation) · F8 (no reassign-to-anon-struct).
- Path discipline: worktree-relative writes ONLY; no main-absolute leakage. Commit incrementally; no `--no-verify`.
- Append a `slice 4a` section to `progress.md` (probe result + dogfood findings + STATUS), slice-1/2/3 style.

Full dispatched prompt is the Agent() call in the sPA session transcript (S235).
