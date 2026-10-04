# BRIEF r2 — s452-boot-arm-pipe (archived verbatim)

PA → bootstrap pipe-lint agent: the review returned LAND-WITH-NITS (counter grading verified clean). One small fix round on the same branch. Archive this as BRIEF-r2.md.
1. LOW: `pipeLint` fires a garbled lint during error recovery. A pipe-less arm whose body contains a bitwise `|` (`.NotFound(m) :> @n = @a | 2` / `_ :> @n = 2`) emits `W-ARM-PIPE-LEGACY "Arm '|  :>' … write ' :>'"` with an empty pattern, next to the real E-PARSE-ARM. Also, `| .Timeout | .Gone :>` (unsupported alternation) lints a suggestion `.Timeout :>` that silently drops `.Gone`. Fix: emit the lint ONLY when the arm's pattern parsed successfully and is non-empty (skip it when `tp.i == pfrom` or the arm parse failed). Add both repros as tests: no lint, the errors unchanged.
2. NIT: the migrated slice-m4 tests that pack several pipe-less arms onto one line (`!{ .NotFound(m) :> … .Timeout :> … }`) → one arm per line (§18.2). Assertions unchanged.
Then `git merge origin/main` (main moved), re-run slice-m4 by path + the counter (`--check`) + the pre-commit gate, and push. Reply with FINAL_SHA and test counts (≤60 words).
