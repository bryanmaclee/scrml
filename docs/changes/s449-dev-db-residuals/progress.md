# s449-dev-db-residuals progress (append-only)

- 2026-10-02 start; base = origin/main 2d6d8cd43; bun install + pretest OK.
- 2026-10-02 item 1 NOT-REPRODUCED on 2d6d8cd43. Probe ~/.cache/scrml-agent-tmp/s449-dev-db (no toml/.git above).
  A tool built in proj/ run from runcwd/ -> created proj/flogence.db (recorded root). A2 source in the cwd -> created
  in cwd (build root == cwd; SPEC-conformant). B moved build -> refused naming SCRML_DATA_DIR, nothing created;
  B2 SCRML_DATA_DIR=vol -> runcwd/vol; B3 empty SCRML_DATA_DIR == unset -> refused. C db="../outside.db" -> recorded
  absolute, created there. D git-project tool copied out -> opens project file; root removed -> refused. E web build
  server from outside -> created at recorded root; moved -> refused. Report root cause: flogence S52 says the
  observation was the S47 drop (pre-#1215 31c42fbf0), whose emission was CWD-relative `new SQL("sqlite:./flogence.db")`.
- 2026-10-02 items 2/3/4 reproduced red (4 new tests failing: dangling db link created target / dangling dir +
  loops -> raw EEXIST), fixed in sqlite-file-target.ts; commit 4cf4173f4 (pre-commit 34125 tests / 0 fail).
- 2026-10-02 items 4/5 SPEC: §47.14 wording + §34 rows (W-DEPLOY-001, -DB-SHARED-PATH, -DB-OUTSIDE-DATA-ROOT,
  -DB-NO-PROJECT-ROOT); s34-census --check-new PASS; SPEC-INDEX regen; commit 3f15aafe3.
- 2026-10-02 R26: db files before 23 / after 24 distinct (+1 = the flogence-shaped probe tool's own recorded-root
  db, expected); building examples/ (all) + 23 --target docker created none; outside-cwd run left runcwd empty.
  Real flogence capture-tool compiled (into probe only, never run): records "flogence.db" + root /…/flogence.
  commands suite 307 pass / 0 fail / 3 skip; 0 orphan dev-child processes.
