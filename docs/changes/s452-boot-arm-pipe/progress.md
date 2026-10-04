# progress — s452-boot-arm-pipe (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a6a94c9a36607e045, base e7fb5fba5; branch feat/s452-boot-arm-pipe.
- ab16f4a49: parse.scrml parseArms -> pipeLint emits W-ARM-PIPE-LEGACY (Info) per `|`-led `!{}` arm; severity.scrml regenerated; slice-m4 tests (1098 pass) — legacy tests assert the lint, incidental `|` arms migrated to canonical.
- counter: the lint initially moved 20 graded cases (9 PASS) to UNSUPPORTED/parse-reject (any unexpected parse-phase code was a reject). Fixed the counter: only Error-severity parse diags reject. PASS 120 -> 120, no bucket moves. Fixture codes/parse-info + bite.
- engine message arms: the bootstrap does not parse them (parseCodeBody reads state-child bodies as code-default markup) — no emit site.
- SPEC §34 W-ARM-PIPE-LEGACY row: bootstrap emit site cited (parseArms -> pipeLint); impl#1 still not-yet-emitted. Index/census/facts/severity checks PASS.
- r2 (BRIEF-r2.md): pipeLint only for a parsed arm (non-empty pattern, no pattern diag, separator follows); 2 repro tests; migrated one-line multi-arm handlers split one arm per line (the one-line-subject test kept). slice-m4 1100 pass; counter --check current.
