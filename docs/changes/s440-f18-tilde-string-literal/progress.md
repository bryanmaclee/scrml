# s440-f18-tilde-string-literal — progress (append-only)

- 2026-09-28 start: base d9f183c41 (origin/main, ff no-op). bun install + pretest OK. BRIEF archived.
- Locus HELD: `preprocessForAcorn` in compiler/src/expression-parser.ts — the `~` rewrite is the LAST
  step of the raw-text pre-pass (pre-acorn, so no tokens exist); unfenced `s.replace`. Reverse mapping is
  structural (esTreeToExprNode Identifier arm) — a string containing `__scrml_tilde__` is safe.
- Fix: route through `rewriteCodeSegments` (the existing literal/comment/regex/template fence used by
  the bare-variant / not / or-and passes). Same one-line class fenced in the same function: `render name(`,
  `::Upper`, `? .x`.
- Siblings checked and clean: bare-variant, not, or/and (already fenced); rewriteIsPredicates (skips
  strings); preprocessMapLiterals (`"[k: v]"` verbatim). NOT clean, multi-line, filed as gap:
  preprocessMatchExprs (`"match x { .A => 1 }"` -> `"__scrml_match__(x, "`).
- Pre-existing, filed: `~` keyword inside a template interpolation emits `${__scrml_tilde__}` (before and after).
- Corpus emit-differential base vs fix: NO DIFFERENCES over 2072 sources / 7976 artifacts.
- Gate: 25718 pass / 70 skip / 11 todo / 0 fail. conformance 1041/1048 + 7 xfail.
