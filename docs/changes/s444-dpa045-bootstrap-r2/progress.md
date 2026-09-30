# s444-dpa045-bootstrap-r2 — progress

WORKTREE_ROOT: /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-ae01492a7f9c23062
Branch: feat/s444-dpa045-bootstrap-r2 (from origin/feat/s442-dpa045-bootstrap @ 1fe0b22a7)

## Log
- Merge origin/main (4953ff135) → 7fe0a3f62. One conflict: `slice-m1/bench/mutations.js`
  — both sides appended rows at the same spot (branch: dpa-045 rows; main: s442 r3 rows).
  Kept both. Pre-commit hook flaked 5x on 5 s timeouts under machine load (load avg ~25;
  protect-analyzer-db-source, sql-in-arrow-body, P2 writes-authority) — each passes alone.
- Reproduced before fixing (probe = reviewer's probe.test.js.keep):
  - F1 yes: `"C:\"` (state) and `<p : "C:\">` → E-PARSE-001.
  - F3: `<?xml b?>` → E-PARSE-TAG cascade (a tag-open attempt, as SPEC says); `<!--` is
    handled before `opensTag` (skipMarkupComment), so `!` only matters for `<!x`.
  - F4 yes: `"abc` in a state body → E-UNQUOTED-DISPLAY-TEXT (SPEC §4.18.3 last bullet: E-CTX-001).

## Not changed (operator's open question)
- `//` in free text is a comment exit (§4.18.1b item 2): `http://x` in a `<p>` loses the rest
  of the line. Left exactly as is.
