# Progress — M1.x cleanup cluster (M1.5 + K2)

Dispatch: scrml-js-codegen-engineer (worktree).
Worktree: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-afa3d77613bdd53c6
Base: 44563a1c (merged main at startup).

## K2 — M1 circular import + aliased-import E-SCOPE-001

- Diagnosed: `lex-in-code.scrml` imports `dispatchInRegexBody` from
  `lex-in-regex.scrml`; `lex-in-regex.scrml` imports `isNewlineCode` +
  `isIdentCont` back from `lex-in-code.scrml` — a 2-file cycle (E-IMPORT-002).
- Diagnosed: `lex-in-code.scrml`'s `import { ..., push as pushBracket,
  pop as popBracket, ... }` aliased import — the v0.3 compiler does not bind
  an unquoted `import { ident as alias }` name (E-SCOPE-001, 6 sites).
- Fix (circular import): extracted the 6 char-classification predicates
  (`isWhitespaceCode` / `isNewlineCode` / `isDigit` / `isHexDigit` /
  `isIdentStart` / `isIdentCont`) into a NEW leaf module
  `char-classify.scrml`/.js (zero native-parser imports). Both
  `lex-in-code` and `lex-in-regex` now import from the leaf. Cycle broken.
- Fix (aliased import): `import { ..., push, pop, ... }` plain; the 6
  bracket call sites in `dispatchInCode` renamed `pushBracket`/`popBracket`
  -> `push`/`pop`. (No collision — `ctx.tokens.push(...)` is member access.)
- Verified: `lex-in-code.scrml` + `lex-in-regex.scrml` compile 100% clean
  (0 errors / 0 warnings; was 7 errors). `.js` shadows execute identically —
  conformance-lexer 96/0, all parser-conformance 1589/0.
- Committed.

## M1.5 — expr-literals.js conformance flip

- FINDING: M1.5 was ALREADY IMPLEMENTED at S102 — commit `bcb48c9f`
  "feat(native-parser): M1.5 — template-mode tracking flips expr-literals
  to full". The roadmap §5 M1.5 row was never marked ✅ complete; the
  lexer-test file header still described M1.5 as pending — both stale.
- Verified: `compiler/tests/parser-conformance-lexer.test.js` has
  `"expr-literals.js": "full"` (the byte-identical disposition); the
  `(full) byte-identical token stream vs Acorn` row PASSES (expr-literals
  subset 5/0). `git blame` line 405 → `bcb48c9f`.
- The regex-token aspect named in the roadmap M1.5 description was
  already normalized via the `ACORN_LABEL_TO_KIND` map (`"regexp" ->
  RegexLit`); the actual M1.5 work (per the `bcb48c9f` commit message)
  was template-mode normalization. No regex normalizer was missing.
- Action taken: corrected the stale `parser-conformance-lexer.test.js`
  file-header comment (claimed M1.5/regex-normalizer pending + bench
  files recording a SKIP — neither true). No code change — M1.5 is done.
- Roadmap §5 M1.5-row status update is PA-owned (DO NOT TOUCH the
  roadmap) — reported to PA in the final message.
- Committed (header-comment correction).
