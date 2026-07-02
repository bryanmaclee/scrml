# BRIEF — Road-B self-host-v2 LEXER slice 3 (regex + template-interp) (S234, 2026-07-01)

Extend `compiler/self-host-v2/lex.scrml` (slices 1+2 LANDED at main 4c9c113b) with the LAST two
token classes: **regex bodies** + **template-interpolation nesting**. Approach-B pure fold
(`fn lex(src) -> Token[]` folding `step(st)` over `match (mode, event)`).

## READ FIRST
- `compiler/self-host-v2/lex.scrml` (slices 1+2) + `compiler/self-host-v2/progress.md` — the built
  substrate/fold/scanners + the 8 known findings F1-F8 (compiler limits — use the slice-1/2
  WORKAROUNDS: F1 keep the `<program>` wrapper; F2 dispatch match on 1-char strings; F4 qualified
  `TokenKind.X`; F6 avoid `|`-alternation with string/payload alternatives. NOTE slice-2 CONFIRMED
  product-match binding a payload-variant in a tuple slot WORKS — `(.InCode, .SawQuote(q)) :> …`).
  A NEW compiler bug → capture it in progress.md (minimal repro + E-code); the dogfood is a primary
  deliverable.
- `scrml-support/docs/deep-dives/compiler-reimagining-lexer-slice-2026-06-26.md` §"Shared substrate"
  + §"Approach B" — the template composite (`InTemplateBody` + the `${…}` LexMode-in-LexMode nested
  frame + `interpDepths: int[]` stack) and the `regexAllowedAfter`/`SawRegexSlash` usage.

## SLICE-3 SCOPE
Replace the slice-2 `deferAdvance` stubs for `SawRegexSlash` + `SawBacktick`:
1. **Regex bodies** — `/…/flags`, scanned when `regexAllowedAfter(last) == true` (that fn is BUILT in
   slice-1 — the `/`-vs-division disambiguation). Handle char-classes (`[...]` — a `/` inside `[]`
   does NOT close the regex) + escapes (`\/`). Emit a `RegexLit`-class token matching impl#1's
   kind/text/span.
2. **Template-interpolation nesting** — `` `…${expr}…` ``: the composite. A backtick template body is
   free-text with `${...}` interpolation frames whose contents lex as EXPRESSIONS one level deep (the
   DD's `InTemplateBody` composite + the `interpDepths` frame stack). Match impl#1's template token
   shapes — STUDY `compiler/native-parser/lex.js` for its actual emission (TemplateChunk /
   interp-start / interp-end or equivalent). This is the HARDEST piece (nested lexing).
**DEFER to slice-4 (leave as-is, note in progress.md):** BracketStack/ErrorRecovery LexState
threading + precise cooked-decode of hex/unicode/line-continuation escapes (raw/span already correct;
only the uncompared `cooked` field is approximate).

## ORACLE — extend the token-diff (loop-until-green)
Add `compiler/tests/integration/self-host-v2-lexer-slice3.test.js` with a regex + template corpus
(regex literals in regex-allowed positions, char-classes, escapes; templates: plain, single +
multi-interp, nested `${` … `}`, templates mixed with slice-1/2 tokens) → token-diff vs impl#1
(`native-parser/lex.js`) → drive to GREEN. Keep slices 1+2 green (no regression). If template-interp
can't reach green cleanly, get REGEX green + report the template state precisely (partial-green +
what's deferred) rather than forcing it.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Worktree under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` MUST start with that prefix (else STOP — S90). Save as WORKTREE_ROOT. Your base may be one
   commit behind main — `git -C "$WORKTREE_ROOT" merge --ff-only main` (or note if it FF's) to pull
   slices 1+2 (S112 base-staleness).
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT; clean; `bun install`; `bun run pretest`.
Edits via **Bash** on worktree-absolute paths incl. `.claude/worktrees/agent-<id>/` — NEVER Edit/Write,
NEVER main-rooted paths, NEVER `cd` into main (`git -C "$WORKTREE_ROOT"`, `bun --cwd`). First commit
message includes verbatim `pwd` (S99).

# MAPS — `.claude/maps/primary.map.md` first; work is in the new dir compiler/self-host-v2/ (zero map
coverage) so maps are orientation only — verify vs live source. Report load-bearing or not.

# COMMIT + REPORT
Incremental commits (`git -C "$WORKTREE_ROOT"`). Full `bun run test` GREEN before DONE (new + slices
1+2 tests pass, zero regressions); never `--no-verify`. Commit-hook may hit the ~5min timeout under
load but still land (S164 background-commit-race) — verify HEAD/tree post-hoc. Report: WORKTREE_PATH ·
FINAL_SHA · FILES_TOUCHED · which regex/template corpus is token-diff GREEN (or partial + deferred) ·
remaining deferrals · NEW dogfood findings (or none).
