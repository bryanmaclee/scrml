# BRIEF — Road-B self-host-v2 LEXER slice 2 (strings + comments) (S234, 2026-07-01)

Extend the impl#2 lexer `compiler/self-host-v2/lex.scrml` (slice-1 LANDED at main a8df839a) with the
next token classes. This continues the Approach-B pure-fold lexer (`fn lex(src) -> Token[]` folding
`step(st)` over `match (mode, event)`).

## READ FIRST
- `compiler/self-host-v2/lex.scrml` (slice-1) + `compiler/self-host-v2/progress.md` — the built
  substrate/fold/scanners AND the 8 dogfood findings F1-F8 (KNOWN compiler limitations — use the
  slice-1 WORKAROUNDS, do not re-hit them: F1 keep the `<program>` wrapper; F2 dispatch match on
  1-char strings not int code-points; F4 use qualified `TokenKind.X`; F6 avoid `|`-alternation with
  string/payload alternatives). If you hit a NEW compiler bug, capture it in progress.md (minimal repro
  + E-code) — the dogfood is a primary deliverable.
- `scrml-support/docs/deep-dives/compiler-reimagining-lexer-slice-2026-06-26.md` §"Shared substrate"
  (the string/comment token shapes) + the deferred-scanner notes.

## SLICE-2 SCOPE (keep it GREEN-able)
Replace the slice-1 `deferAdvance` stubs for these events with real scanners:
1. **Strings** — single- + double-quoted (`'…'`, `"…"`), with escape handling (`\\` `\"` `\'` `\n` `\t`
   etc.); emit `StringLit`-class tokens matching impl#1's kind/text/span. (LexMode InSingleString /
   InDoubleString atomic sub-scans, per the DD.)
2. **Comments** — line (`//…\n`) + block (`/*…*/`); impl#1 SKIPS them as trivia — match that (emit no
   token, advance the cursor + track line/col).
**DEFER to slice-3:** regex bodies (`/…/flags`) + template-interp nesting (`` `…${…}…` ``) — leave
their events on the total `deferAdvance` stub. Note the deferral in progress.md.

## ORACLE — extend the token-diff (loop-until-green)
Extend `compiler/tests/integration/self-host-v2-lexer-slice1.test.js` (or add a slice-2 sibling in the
same dir) with a string/comment corpus (single/double strings, escapes, line/block comments, mixed
with slice-1 tokens) → token-diff vs impl#1 (`native-parser/lex.js`) → drive to GREEN. Keep the
slice-1 corpus green (no regression). Regex/template inputs stay OUT of the corpus (deferred).

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Worktree under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` MUST start with that prefix (else STOP — S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT; clean; `bun install`; `bun run pretest`.
Edits via **Bash** on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/` — NEVER Edit/Write,
NEVER main-rooted paths, NEVER `cd` into main (`git -C "$WORKTREE_ROOT"`, `bun --cwd`). First commit
message includes verbatim `pwd` (S99).

# MAPS — `.claude/maps/primary.map.md` first; your work is in the new dir compiler/self-host-v2/ (zero
map coverage) so maps are orientation only — verify vs live source. Report load-bearing or not.

# COMMIT + REPORT
Incremental commits (`git -C "$WORKTREE_ROOT"`). Full `bun run test` GREEN before DONE (new + slice-1
tests pass, zero regressions); never `--no-verify`. Report: WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED ·
which string/comment corpus is token-diff GREEN · remaining deferrals · NEW dogfood findings (or none).
