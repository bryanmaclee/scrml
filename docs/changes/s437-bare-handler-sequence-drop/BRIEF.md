change-id: s437-bare-handler-sequence-drop

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (a live PA session uses the main checkout)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP and report.
2. `git fetch origin && git merge --ff-only origin/main`; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
3. `bun install`; then run `bun run pretest` PLAINLY from your worktree CWD (NOT `bun --cwd … run` — it silently no-ops).
4. Every Write/Edit on an absolute path UNDER your worktree. NEVER write to or `cd` into `/home/bryan-maclee/scrmlMaster/scrml` outside your worktree. NEVER `git stash` (shared stack) — flip base/build by file copy. NEVER `pkill -f`/`killall` by command string — kill only by a PID you captured.
5. First commit: `WIP(s437-bare-handler-sequence-drop): start at $(pwd)`. Commit after each meaningful change; keep `progress.md` (timestamped, append-only). Code + its tests = ONE commit, never split. NEVER `--no-verify`, never override core.hooksPath. Pre-commit runs the unit/integration/conformance suite (~2-5 min): commit in the foreground with a long timeout.

MAPS — REQUIRED FIRST READ: `.claude/maps/primary.map.md` on your base is stamped `787d4cb4` (stale). A refresh to `d02738767` exists on the pushed branch `chore/s437-bookkeeping`: `git fetch origin chore/s437-bookkeeping && git show origin/chore/s437-bookkeeping:.claude/maps/primary.map.md` (read-only — do NOT check those files out). Follow its Task-Shape Routing for a parser/diagnostic fix. Treat map content as verify-against-source. Report whether the map was load-bearing.

THE DEFECT (PA-reproduced on `d02738767`) — silent wrong output:
```scrml
<program>
<count> = 5
${ function track(x) { @count = @count + 1 } }
<button onclick=@count = 0; track("reset")>r</button>
</program>
```
`bun compiler/bin/scrml.js compile h.scrml --output-dir out` → exit 0, NO error. Emitted HTML: `<button data-scrml-bind-onclick="_scrml_attr_onclick_1" track reset>` — the handler keeps only `@count = 0`; `track("reset")` becomes two bare HTML attributes; `W-DEAD-FUNCTION` then fires on `track`. By contrast the CALL-led form `onclick=startGame(); track("start")` correctly fires `E-MULTI-STATEMENT-HANDLER` (exit 1).

GOVERNING SENTENCES — SPEC §5.2.3 (compiler/SPEC.md ~line 1461-1503; read the whole subsection):
- (line ~1500) *"A BARE event-handler value that contains a `;` outside of expression-internal contexts (string literals, template literals, parentheses, brackets, braces, nested function bodies, comments) is compile error `E-MULTI-STATEMENT-HANDLER`. The fix is to wrap the statements in braces — `onclick={ startGame(); track("start") }` — or to name a function."*
- (line ~1503) *"The error is kept so the unbraced sequence can never be silently read the wrong way."*
Direction: NEWLY-REJECTING toward an existing SHALL (conformance restoration). Ruled for fixing by bryan S437 ("fix it").

SCOPE — two things:
1. **The drop.** Every BARE handler value containing a depth-0 `;` must fire `E-MULTI-STATEMENT-HANDLER`, regardless of what the first statement is: assignment (`@a = 0; f()`), compound (`@a += 1; f()`), increment (`@a++; f()`), method call, member assignment. Probe the full matrix, including a trailing attribute after the sequence (`… track("x") class="y">`), a `;` inside a string / parens / template literal (must NOT fire), handlers inside an engine state-child and inside an `<each>` row, and the `:`-shorthand is out of scope (§4.14 unchanged). Verify the braced forms `onclick={ @a = 0; f() }` still compile and run all statements.
   **Locus (PA-located-verify — searched, not traced):** the S69 B18 fire-site lives in `compiler/src/multi-statement-scan.ts` + its callers; the extent of a bare attribute value is decided by the attribute tokenizer (block-splitter / `ast-builder.js`). The likely mechanism: for a call-led value the scanner sees `startGame(); track(...)`, but for an assignment-led value the attribute value ends before the `;` (or the scan only runs on call-shaped values), so the tail re-tokenizes as attributes. FIND where the extent is actually decided and fix at the root (where the value's extent is determined / where the `;` is seen), not with a per-shape special case. Report whether the locus hypothesis held.
   Also check the opt-in native parser (`--parser=scrml-native`): SPEC says it "reads `track` and `start` as attributes" for the call-led form. Report its behaviour on the matrix; fix it too if the same root applies cheaply, otherwise report precisely.
2. **The message.** `E-MULTI-STATEMENT-HANDLER`'s message still says to lift the body to a named function. Rewrite it to match §5.2.3: wrap the statements in braces (show `onclick={ … }` built from the user's actual statements if cheap), or name a function. Update the §34 catalog row text if it carries the old fix.

MEASURED MIGRATION (mandatory, base §8): before landing, COMPILE the corpus (examples/, samples/, stdlib/, conformance/cases, docs code that the tests compile) on the pre-fix base and the post-fix build and diff the diagnostics; report every file that newly fails with E-MULTI-STATEMENT-HANDLER (count + paths). If any exist, migrate each to the brace form in the same change (the SPEC's stated fix) and list them. Do not assume zero.

TESTS: unit tests for the matrix above (fires / does-not-fire), a runtime test that the braced form runs every statement in order, and a conformance case under conformance/cases pinning the assignment-led bare sequence as E-MULTI-STATEMENT-HANDLER (codes half) — follow the existing case format in that directory. Prove your harness can SEE a failure: show one test red on the pre-fix base.

PHASE 3 — EMPIRICAL (do NOT mark done without it): recompile the reproducer above post-fix → exit 1 with E-MULTI-STATEMENT-HANDLER naming the handler; recompile the braced version → exit 0 and grep the emitted client JS for BOTH `_scrml_reactive_set` (or equivalent) for count AND the `track(` call inside the handler body.

REPORT: worktree path, FINAL_SHA, files touched, locus verdict (held/refined/wrong + the real decision point), the migration count + files, the native-parser result, the probe matrix table, and anything you could not do.
