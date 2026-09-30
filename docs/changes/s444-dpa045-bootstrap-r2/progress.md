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

## FINAL (merged tree)
slice-m1 73/73 · lowered m1 73/73 · slice-m2 443/443 · slice-m3 60/60 · slice-m4 182 + 1 todo ·
v2-lexer 337/337 · lint 58 files / 0 · mutations 207/207 RED, 0 problems, exit 0 (660 s) ·
bite CG 32 + CSS 32 + FRONT 12 certified, 0 uncertified, exit 0 · conformance impl#1 1144/1151
+ 7 xfail (compiler/src + conformance/ identical to origin/main) · gate 26679 pass / 0 fail /
72 skip / 12 todo.

Whitespace check (reviewer's cmp.mjs; base = origin/main 4953ff135, which has no dpa-045
parser change): every program's Core is JSON-identical modulo whitespace-only Text views —
counter 4 · dropdown 22 · dropdownReorder 22 · dropdownEarlyRead 23 · valuesem 3 (= 74, as
the reviewer measured) · M4 (added by the merge's programs): engine 5 · audit fixture 8 ·
audit shapes fixture 8 · form fixture 16. Theme does not compile clean in the bootstrap on
either side; its diagnostic list is identical.

## Round 3 (re-review of 5b21080b3: fixes 1,2,3,5 + merge clean; fix 4 regressed)
Reproduced first (reviewer's cases1/2 under review-dpa045b/): F1 `"see </> here"` →
E-CTX-001 + E-PARSE-DECL-BODY, while `("see </> here")` rendered clean (a leading `(` moved the
body's end — §4.18.1b pin 3); F2 `"x ${ @n </> y` → rest of file Text + unclosed cascade;
F3 `"x ${"a"` at EOF → no E-CTX-001; F4 named-closer branch unbitten.
PA ruling R1 applied: UNTERMINATED iff the scan from the `"` (a `${…}` skipped by lexFrom
Balanced — token depth) reaches EOF with no closing `"` (`displayCloseAt`). Only then:
E-CTX-001 at the `"`, content ends at the first `</>` / `</tag>` after it (raw, `firstBodyCloser`)
or EOF; parsing goes on. A closed literal is never searched for closers. The r2 tests pinning
`"x </> y"` → E-CTX-001 flipped to content. `unterminatedDisplay` / `runsToEof` removed.
Consequence (per the ruling): `"abc` followed later in the file by any `"` is a CLOSED literal
(it closes there) — the tests use `stateLast` (tested state-child last) for the E-CTX-001 cases.
`:`-shorthand: unterminated → E-CTX-001, content to EOF (no body closer).
Mutation rows for fix 4 rewritten: 6 rows (check dropped ×2, `${…}` not skipped, closed literal
searched for closers, named closer dropped, `</>` dropped) — all RED.

## FINAL round 3 (e8d92bfd9)
slice-m1 73/73 · lowered m1 73/73 · slice-m2 443/443 · slice-m3 60/60 · slice-m4 188 + 1 todo ·
v2-lexer 337/337 · lint 58 / 0 · mutations 209/209 RED, 0 problems, exit 0 · bite CG 32 + CSS 32
+ FRONT 12 certified, 0 uncertified, exit 0 · conformance impl#1 1144/1151 + 7 xfail (untouched) ·
gate 26679 pass / 0 fail / 72 skip / 12 todo (first run flaked once on a 5 s live-Postgres hook
timeout; clean re-run) · whitespace check unchanged (74 on the five; M4 5 / 8 / 8 / 16).
