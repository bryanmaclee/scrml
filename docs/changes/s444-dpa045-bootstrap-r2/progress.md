# s444-dpa045-bootstrap-r2 — progress

WORKTREE_ROOT: /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-ae01492a7f9c23062
Branch: feat/s444-dpa045-bootstrap-r2 (from origin/feat/s442-dpa045-bootstrap @ 1fe0b22a7)

## Log
- Merge origin/main (4953ff135) → 7fe0a3f62. One conflict: `slice-m1/bench/mutations.js`
  — both sides appended rows at the same spot (branch: dpa-045 rows; main: s442 r3 rows).
  Kept both. Pre-commit hook flaked 5x on 5 s timeouts under machine load (load avg ~25;
  protect-analyzer-db-source, sql-in-arrow-body, P2 writes-authority) — each passes alone;
  the retry passed with no change.
- Reproduced before fixing (probe = reviewer's probe.test.js.keep; mutations run against
  the PRE-fix dpa045.test.js + check.test.js + slice-m2 + engine.test.js):
  - F1 yes: `"C:\"` (state) and `<p : "C:\">` → E-PARSE-001.
  - F2 yes: skipSigil stopping at the first raw `}` — only the 2 pre-existing failures
    (the old E-PARSE-001 tests), i.e. no test bit.
  - F3 yes: `?` or `!` dropped from opensTag — no test bit. (`<!--` is taken before
    opensTag by skipMarkupComment, so `!` only matters for `<!x` / `<!DOCTYPE`.)
  - F4 yes: `"abc` in a state body → E-UNQUOTED-DISPLAY-TEXT + 3 E-PARSE-UNCLOSED
    (SPEC §4.18.3 last bullet / §4.18.7 recovery: E-CTX-001 against the opening `"`).
  - F5: `kids[0]` → `find(button)` lost the order pin, and the rebuilt kid list
    `[button', ...kids.slice(1)]` kept the ORIGINAL button as a duplicate once a whitespace
    Text came first.
- ea66f5621 — fixes 1, 2 (tests), 3 (tests), 4 in parse.scrml + dpa045.test.js.
  - Fix 1: displayEscapeDiags deleted with both call sites. No new code: the lexer's
    display mode already made `\` content and `"` the closer.
  - Fix 4: `unterminatedDisplay(m, tag)` in parseCodeBody: the literal's extent is the
    lexer's; inside its literal segments (a `${…}` is skipped by lexFrom Balanced) the
    body closer `</>` / `</tag>` ends it, and a literal with no closing `"` runs to EOF.
    E-CTX-001 spans the `"`; recovery takes `"`..closer as a Text and continues at the closer.
- 19d087561 — mutation rows (8 new, 2 dead ones replaced) + check.test.js.

## Notes / residue
- Fix 4 in a `:`-shorthand: only the END-OF-FILE case is E-CTX-001 (was E-PARSE-SHORTHAND).
  The shorthand's other "closer" is the opener's `>`, which is also legal display text
  (`<p : "a > b">`), so a runaway literal that meets a later `"` is not decidable there.
  Surfaced for the PA.
- `"a\"b"` in a state body: the `\"` closes the literal (SPEC), `b` is then a bare run and
  the trailing `"` opens a new literal mid-run → E-UNQUOTED-DISPLAY-TEXT + unclosed cascade.
  Conformant (the unterminated check only looks at a run that STARTS with `"`); ugly.

## Not changed (operator's open question)
- `//` in free text is a comment exit (§4.18.1b item 2): `http://x` in a `<p>` loses the rest
  of the line. Left exactly as is.
