change-id: s444-dpa045-bootstrap-r2

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (PATH-DISCIPLINE INCIDENTS this session: 0)
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP, report, exit. Call it WORKTREE_ROOT.
2. Toplevel == WORKTREE_ROOT; clean. `git fetch origin`.
3. Base: `git checkout -b feat/s444-dpa045-bootstrap-r2 origin/feat/s442-dpa045-bootstrap` (tip 1fe0b22a7), then `git merge origin/main` (main moved a lot since c6fec3c2 — resolve real 3-way, never wholesale; the typer, CSS slice, six §66.19 programs and dpa-045 SPEC §4.18 all landed). Commit the merge.
4. `bun install`; `bun run pretest` (plain, from WORKTREE_ROOT).
5. ABSOLUTE paths under WORKTREE_ROOT only. Never `cd` into /home/bryan/scrmlMaster/scrml. Never `git stash`. Never `pkill -f` on shared strings.
6. Save this prompt verbatim → `docs/changes/s444-dpa045-bootstrap-r2/BRIEF.md` + `progress.md`; commit `WIP(s444-dpa045-bootstrap-r2): start at <pwd>`. Commit after each unit.

## MAPS
Stale (cf62b415) — verify against source.

## Context
The S442 dpa-045 bootstrap work (plain-markup text grammar in compiler/self-host-v2/parse.scrml + lower.scrml; tests in slice-m4/dpa045.test.js; its own progress at docs/changes/s442-dpa045-bootstrap/) got an S239 adversarial review: LAND-WITH-NITS. You fix the findings. Reviewer claims were reproduced by the reviewer; re-reproduce each yourself FIRST and report if any does not reproduce. Reviewer scratch (read-only for you): /tmp/claude-1000/-home-bryan-scrmlMaster-scrml/89e0ed5f-944e-4b25-b028-46392493e556/scratchpad/review-dpa045/ (probe.test.js.keep, cmp.mjs, mutations.log).

## Fixes
1. (MED, spec nonconformance) `\"` in a code-default display-text literal fires E-PARSE-001. SPEC §4.18.3 (main, Amendment S442) is normative: "A `\` inside a display-text literal is an ordinary content character; there is no malformed-escape error (`E-PARSE-001` no longer fires on `\x` here). Consequently `\"` is a `\` followed by the closing `"`, `\\` is two backslashes, and `\${` is a `\` followed by an interpolation." Make the bootstrap conform: `"C:\"` (state body) and `<p : "C:\">` render `C:\`. Pin with tests (positive + the twins `\\`, `\${@n}`), and a mutation row.
2. (LOW) Extent of `^{` / `!{` / `~{` inside free text is untested: mutating `skipSigil` to stop at the first raw `}` keeps every suite green, and `<p>a ^{ x = "</p> }" } b</p>` then leaks `" } b` as page text. SPEC §4.18.1b: "no byte inside the body may change where the body ends." Add tests asserting the AST Text / extent (not only diagnostic codes) for each sigil with a `}` inside a string; fix the fu1 test whose title claims "never text" but checks only codes. Add the skipSigil mutation row (must go RED).
3. (LOW) `<?` and `<!` in the tag-open class are untested (removing `?` or `!` from `opensTag` keeps m1/m2/m4 green). Add tests + mutation rows that bite.
4. (NIT) An unterminated display literal (`"abc` alone in a state body) emits E-UNQUOTED-DISPLAY-TEXT; SPEC §4.18.3 names E-CTX-001 — check the exact SPEC sentence and conform.
5. (NIT) check.test.js: an edit changed `kids[0]` to `find(button)`, losing the first-element assertion — restore the order check if the whitespace-kept change allows (e.g. first non-whitespace element), else explain.
DO NOT change the `//` comment behaviour in free text — that is an open design question for the operator (a URL `http://x` in text loses the rest of the line). Leave it exactly as is; note it in progress.md.

## Verification
All self-host-v2 suites (slice-m1, m2, m3, m4, lowered m1, v2-lexer, lint), the mutation harness (every row RED, exit 0), bite matrix, conformance (impl#1 untouched), and `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`. Re-run the reviewer's whitespace check (74 whitespace Text views on the five pre-existing programs; otherwise JSON-identical Core) on the merged tree and report the number (the merge may add programs — report per program). Push `git push -u origin feat/s444-dpa045-bootstrap-r2`. No PR, no merge.

## Report (terse)
WORKTREE_ROOT, SHA, merge conflicts + resolutions, each fix (reproduced-before yes/no, test + mutation added), all verification numbers.
