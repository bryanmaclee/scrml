# BRIEF — LSP semantic tokens

**Change-id:** `lsp-semantic-tokens-2026-07-08`
**Owner review:** the PA runs an S239 adversarial review before landing. DO NOT push, DO NOT merge to main, DO NOT self-land.

## Goal
Add a `semanticTokensProvider` to the scrml LSP so editors get **context-exact** highlighting from the compiler's own parse (compiler-as-oracle), retiring reliance on regex vim/TextMate grammars. The LSP currently advertises NO semantic-tokens capability (`lsp/server.js` capabilities block has none) despite an old changelog claiming it did.

## Token source (the crux — Phase 0, report before building)
The LSP's `analyzeText` (`lsp/handlers.js`) produces `analysis.ast` (via BS+TAB) but **no token stream**. The rich positioned-token source is the native lexer: `compiler/native-parser/lex.js` → `export function lex(source)` returns tokens shaped `{ kind, pos, line, col }` with `TokenKind` from `compiler/native-parser/token.js`. (A self-host-v2 lexer also exists under `compiler/self-host-v2/` — token-complete 119/119; evaluate both, prefer whichever is more complete AND tolerant.)

Phase-0 gate — report these before building:
1. Confirm `lex(source)` returns every token with usable positions (line/col or absolute pos convertible to LSP line/char).
2. **Tolerance is mandatory** — editors send syntactically-broken buffers on every keystroke. Verify `lex()` does NOT throw on incomplete/invalid input (unterminated strings, half-typed tags, stray sigils). If it throws, wrap defensively and/or fall back to a hybrid (walk `analysis.ast` spans for structural roles + a light leaf tokenizer). **Whatever you choose, the handler must NEVER throw** — return `[]` or a partial token set on failure (mirror how `analyzeText` guards BS/TAB with try/catch).
3. Report your token-source decision + rationale.

## v1 scope (bound it here)
- **Lexical semantic tokens**: map `TokenKind` → LSP `SemanticTokenTypes`. Suggested mapping (adjust to actual TokenKinds): keyword→`keyword`, string/template→`string`, number→`number`, comment→`comment`, `@reactive`→`variable`, operators/sigils→`operator`, markup tag name→`type`, attribute name→`property`, CSS property→`property`, SQL keyword→`keyword`, identifier→`variable`. Use STANDARD `SemanticTokenTypes` names (cross-editor safe); document the mapping in a comment.
- **Full-document tokens** (`full: true`) only. Range/delta tokens = a noted follow-on.
- AST-informed role enrichment (type vs var vs enumMember beyond what the lexer knows) = OPTIONAL noted follow-on, NOT required for v1.

## Wiring
- `lsp/server.js`: add `semanticTokensProvider: { legend, full: true }` to `capabilities`; register the handler (`connection.languages.semanticTokens.on(...)` or `onRequest('textDocument/semanticTokens/full', ...)`), delegating to handlers.js.
- `lsp/handlers.js`: export `SEMANTIC_TOKENS_LEGEND` (`{ tokenTypes, tokenModifiers }`) and `buildSemanticTokens(text, analysis)` returning encoded token data. Use `SemanticTokensBuilder` from `vscode-languageserver`. Keep it unit-testable WITHOUT a transport (the reason handler logic lives in handlers.js — see the server.js top comment).

## Tests (required)
- Add unit tests for `buildSemanticTokens` matching the existing L1–L4 test pattern: feed known .scrml snippets, assert token (line,char,length,type) for representative constructs — a keyword in `${}`, a markup tag name, an `@reactive` var, a `#{}` CSS property, a `?{}` SQL keyword, a string, a number, a comment. Include a BROKEN-buffer test asserting no throw + graceful output.
- Full pre-commit gate must stay green (`bun test compiler/tests/{unit,integration,conformance}`).

## Constraints
- **Disjoint from a concurrent LIVE CSS §65 arc.** Touch ONLY `lsp/**` + READ `compiler/native-parser/**` (and `compiler/self-host-v2/**` if you use that lexer). Do NOT write `compiler/SPEC.md`, `compiler/scripts/css-conflict-dryrun.ts`, `samples/**`, or any `docs/changes/css-*`. If you find you need to edit compiler/src emit code, STOP and report — out of scope.
- Verify your worktree base is current main HEAD + green before building; if the run is long, `git merge main` to stay current (main is receiving concurrent commits).
- Commit INCREMENTALLY on your branch (crash-recovery anchor). Do NOT push, do NOT merge to main.
- Write `docs/changes/lsp-semantic-tokens-2026-07-08/BRIEF.md` (this brief) + a `progress.md` in your worktree.

## Report back
1. Phase-0 token-source decision (source + tolerance verification result).
2. Confirmation `semanticTokensProvider` is advertised and `textDocument/semanticTokens/full` returns encoded tokens for a real .scrml file.
3. Handler-never-throws evidence (the broken-buffer test).
4. Test counts (unit + full pre-commit suite).
5. FINAL_SHA + branch name + the TokenKind→LSP-type mapping table for PA review.
