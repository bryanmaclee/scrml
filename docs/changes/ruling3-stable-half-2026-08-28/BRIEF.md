# BRIEF — land the STABLE HALF of ruling 3; HOLD the new arms

**Dispatched:** S383-bryan, 2026-08-28. **Base:** `origin/main` @ `a042f3fd`.
**change-id:** `ruling3-stable-half-2026-08-28`
**Source branch (READ-ONLY, do not push to it, do not check it out as a branch):**
`worktree-agent-a84d38ac3c1c30a4b` @ **`79894418`** — local-only on this machine.

**bryan ruled this session, verbatim: *"land the stable half."*** That is a SECOND, FINER cut than
the one `79894418` already performed. `79894418` carved ruling 2's bare-call gate OUT and kept
ruling 3's new arms IN. **You are removing ruling 3's new arms as well**, keeping everything that is
true regardless of the ruling.

This is a **carve, not a build.** Do not fix, improve, or extend anything. If you find yourself
writing new logic, stop and report.

---

# WHY THE ARMS ARE HELD — do not re-litigate, do not "fix" on the way past

`E-CONTROL-FLOW-IN-MARKUP`'s recognizer has only ever covered **braced** `if`/`for`/`while`. Ruling 3
extended its **LOCUS**, not its **COVERAGE**. PA-CONFIRMED on `main`, at the pre-existing markup
locus, all shipping raw source into the DOM with zero diagnostics: `if (@a) log(1)` (braceless) ·
`switch (@a) { }` · `outer: for (…) { … }` · `do { … } while (@a)`.

`if (@a) log(1)` and `if (you ask) we deliver` differ ONLY in whether the tail is code or prose.
**The `{` is the entire discriminator** — which is why the recognizer requires it and why prose
survives. A braceless control-flow statement at a body-top cannot be diagnosed by any regex without
also refusing prose. **That is a permanent hole in the approach, inside the class ruling 3 exists to
close.** It needs a grammar-derived implementation, which is a separate arc.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 — hard gate)

Worktree root: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/` = `WORKTREE_ROOT`.
⚑ The repo is **`scrml`** (renamed S200). Any older brief saying `scrmlTS` is stale.

## Startup — BEFORE any other tool call
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is under any other repo, **STOP and report** (S90 CWD-routing). Save `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. **Assert your base:** `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
   ⚑ **S346: a worktree is cut from `origin/main`, NOT from the dispatching checkout's HEAD.**
4. **Fetch this brief into your tree** — it is on a branch, not on `main`:
   ```
   git fetch origin brief/s383
   git checkout FETCH_HEAD -- docs/changes/ruling3-stable-half-2026-08-28/
   ```
5. **Fetch the source branch you are carving from** (local-only, so fetch from the shared checkout,
   NOT from `origin`):
   ```
   git fetch /home/bryan-maclee/scrmlMaster/scrml worktree-agent-a84d38ac3c1c30a4b
   git rev-parse FETCH_HEAD    # MUST print 79894418dd17ad4d80cd30730de82ffefbf8b9e1
   ```
   ⚑ **READ-ONLY.** A review record is pinned to that SHA; moving it invalidates the record.
6. `git status --short` clean. 7. `bun install`.
8. `bun run pretest` — **run it plainly, from the worktree CWD.**
   ⚑ **S376: `bun --cwd <path> run <script>` SILENTLY NO-OPS and exits 0.** It prints the script list
   and does nothing, so the browser fixtures never build and the pass is fake. **Verdict by exit code
   is no defence — check the artifact exists** (`samples/compilation-tests/dist/`). Use `--cwd=<path>`
   (with the `=`) or plain CWD.
9. Use `bun run test` (chains pretest) for full-suite baselines, never bare `bun test`.

If ANY step fails: **STOP and report.** Do not proceed on a half-verified workspace.

## Path discipline
- Apply edits via **Edit/Write on `WORKTREE_ROOT`-absolute paths.**
  ⚑ **S314: the old "Bash-only edits" rule is RETIRED and is now actively wrong** — the isolation
  guard refuses Bash heredocs/redirects as "too complex to verify", and the `path-discipline.sh`
  PreToolUse hook guards *Edit/Write* specifically. Bash writes are the one surface it cannot see.
- **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `--cwd=`, absolute paths.
- ⚑ **NEVER a bare `pkill -f "bun test..."` / `killall`.** Every checkout shares the command string,
  so that pattern matches a suite running in MAIN just as well as yours, and killing another
  checkout's pre-commit hook leaves **no trace on your side**. Kill by PID captured at launch.
- First commit message includes your verbatim `pwd`: `WIP(ruling3-stable): start at <pwd>`.

# COMMIT DISCIPLINE
Commit **after each phase** — do not batch. Your branch + `progress.md` are the only crash-recovery
anchor. Coupled code+test lands **together**. `git status` clean before DONE. Update
`$WORKTREE_ROOT/docs/changes/ruling3-stable-half-2026-08-28/progress.md` per phase.
**NEVER `--no-verify`** — and never work around it by overriding `core.hooksPath` (S283).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing**; for this shape also
read `.claude/maps/error.map.md` (diagnostics) and `.claude/maps/structure.map.md`.
Map stamp `0dd659a1`; base `a042f3fd`. **PA currency check performed:**
`git diff --name-only 0dd659a1..a042f3fd -- compiler/src` returns **exactly one file**,
`compiler/src/commands/dev.js`, which this arc does not touch. **`ast-builder.js`, `symbol-table.ts`
and `lint-e-state-block-statement-form.js` have not moved since the map stamp** — treat map content
as a verify-against-source hypothesis anyway, and report whether it was load-bearing ("not
load-bearing" is a real answer).

# RULE 4 — SPEC IS NORMATIVE
`compiler/SPEC.md` is the single normative source. **You do NOT edit it in this dispatch** (see MUST
NOT TOUCH). Where you need to know what a code is contracted to do, grep it.

---

# WHAT LANDS

Everything below is on `79894418` and is true **regardless of whether ruling 3's arms ever ship.**

1. **The `default-logic-exemption.ts` extraction.** New leaf module + the `symbol-table.ts` consumer
   + its test in `compiler/tests/unit/unit-cc-write-at-body-top.test.js`.
   ⚑ **PA ALREADY DETERMINED THE SHARED-CONSUMER QUESTION BY GREP — verify it, do not re-derive from
   scratch:** the module has TWO importers on `79894418`, `symbol-table.ts:216` and
   `ast-builder.js:60`. `symbol-table.ts` is the ORIGINAL home and consumes it **independently of
   ruling 3**, so the extraction stands on its own. `ast-builder.js`'s import exists only to serve
   the held arm (its own banner at `ast-builder.js:53` says *"CONSUMED HERE BY THE §40.8 ARM OF
   `E-CONTROL-FLOW-IN-MARKUP` ONLY"*) — **that import goes out with the arm.** Confirm both by grep
   and state the result in `progress.md`.

2. **The F5 `col` fix in `ast-builder.js` — TWO sites.**
   `const col = li === 0 ? baseCol + colStart : colStart + 1;`
   ⚑ **PA ALREADY DETERMINED THIS SURVIVES THE CARVE:** its two sites are the **sibling scanners**
   (`scanStateBlockBareWriteDecls` / `scanMarkupBodyConstAtDecls`), which exist on `main` today
   emitting the unfixed `col: colStart + 1` at `ast-builder.js:1944` and `:2005`. They are NOT
   ruling 3's arms. The twin fix in `lint-e-state-block-statement-form.js` **already landed** and is
   on `main` at `:437` — do not re-land it.
   ⚑ **CONSEQUENCE FOR YOUR DIFFERENTIAL, STATED SO YOU DO NOT MISREAD IT AS A BAD CARVE:** this fix
   **changes diagnostic `col` values** on `W-STATE-BLOCK-BARE-WRITE-DECL` and `W-CONST-AT-DEPRECATED`.
   Those column deltas are **EXPECTED and CORRECT**. See the differential gate below.

3. **The `lint-e-state-block-statement-form.js` DO-NOT-SHARE banner** (round-4 Finding 4) — the
   comment block documenting that `maskCommentRegions` is module-private and why it was reverted
   twice. Comment-only; no behaviour change. Land it: it is the durable output of getting that wrong
   twice, and its tripwire test already exists.

4. **Any test on `79894418` that PASSES against your carved compiler and pins behaviour that
   actually exists.** Determine this **by running them**, not by reading them.

# WHAT IS HELD (excised)

Ruling 3's new arms, in full. Verify each by grep rather than trusting this list:
- `BARE_CONTROL_FLOW_AT_BODY_TOP_RE`
- `findControlFlowStatementEnd` (the four-guard statement-end scanner)
- `_DEFAULT_LOGIC_ROOT_NAMES`
- the `isStateBlockBody` parameter on `liftBareDeclarations` and all of its threading
- the new `E-CONTROL-FLOW-IN-MARKUP` fire sites (`79894418` `ast-builder.js` ~`:2237`, ~`:2423`)
- `ast-builder.js`'s `import { isDefaultLogicBodyTopExempt }` (per item 1 above)
- the three `-pos` conformance cases, which assert the arms fire:
  `ctrl-012-bare-control-flow-default-logic-root-pos`,
  `ctrl-012-bare-control-flow-deprecated-state-opener-pos`,
  `ctrl-012-default-logic-root-neg` ← **read the `expected.json`, do not go by the `-pos`/`-neg`
  suffix.** Any case whose `expected.json` requires a diagnostic that only the held arms produce goes
  out with them. Any case that passes against the carved compiler MAY stay — decide **by running the
  conformance suite**, and state each case's disposition in `progress.md`.

# ⚑ WHAT LANDS AS *SPECIFICATION*, NOT AS A GATE

bryan's ruling, verbatim: the problem statement is *"worth more than the code"* — **"Land those as
SPECIFICATION for whoever builds the grammar version, never as a dormant gate."**

Three artifacts, all currently living inside code/test files that are being carved:
- the **52-fixture cross-axis corpus** and its axis matrix (`mk-` markup-REAL 6: main 6 / r3 2 / r4 6
  · `dl-` §40.8-REAL 6: 0/2/2 · `pr-mk` markup-PROSE 16: 4/0/4 · `pr-dl` §40.8-PROSE 16: 0/0/0)
- the **two-recognizer DO-NOT-MERGE note**, carrying the history in both directions
- the **four-guard structure of `findControlFlowStatementEnd`** (the decline-on-unlexable rule, the
  brace-from-the-match rule, and the two post-conditions on the result)

**Move them into a design document** at `docs/changes/ruling3-grammar-derived/PROBLEM-STATEMENT.md`
(new change-id, for the held arc). Include the four braceless/`switch`/labelled/`do-while` shapes
PA-confirmed above as the reason a regex approach cannot close the class.

⚑ **NOT as `.skip`'d tests, and NOT as dead code behind a flag.** A skipped test that asserts
unbuilt behaviour is exactly the dormant gate bryan excluded — it reads as coverage, cannot fail, and
the next session has to re-derive whether it is aspirational or broken.

---

# ⚑ THE ACCEPTANCE DEFINITION IS BEHAVIOURAL, NOT A HUNK COUNT

Do not define the carve by diff hunks — the arms are interleaved inside `liftBareDeclarations` and a
hunk-shaped cut will take the wrong lines. Define it by what the compiler DOES:

1. **`E-CONTROL-FLOW-IN-MARKUP` fires on EXACTLY the inputs it fires on for `origin/main`** —
   no more, no fewer. The §40.8 default-logic body-top locus is SILENT again, as on `main`.
2. **`E-CALL-NOT-IN-LOGIC-CONTEXT` fires nowhere**, for any input (already true on `79894418`).
3. **THE CORPUS DIFFERENTIAL IS THE GATE.** Compile every tracked `.scrml` with the `origin/main`
   compiler and with yours, and diff the per-file diagnostic multisets. **The ONLY permitted
   differences are `col` values on `W-STATE-BLOCK-BARE-WRITE-DECL` / `W-CONST-AT-DEPRECATED`
   diagnostics, from the F5 fix (item 2).** Any other delta — a diagnostic appearing, disappearing,
   changing code, changing line, changing message — means the carve took something it should not
   have, or left something it should. **Report the differential VERBATIM in `progress.md`, including
   the case where it is empty apart from the expected `col` moves.**
   Use `scripts/corpus-emit-differential.ts` if it fits; if you roll your own, say so and show the
   command.
4. **The compile floor holds.** `scripts/corpus-compile-floor.ts` landed at #742 and is wired into
   CI `gate`. Run it. It must pass.

# TESTS
- Every test pinning the extraction, the F5 `col` fix, and the banner must survive and pass.
- Every test pinning the held arms goes with them. **Removing a test is a coverage reduction —
  count what stops being checked and record the number in `progress.md`** (pa-base §8: *before
  narrowing any check, count what it will stop looking at*).
- ⚑ **MUTATION-PROVE the surviving pins.** Revert the F5 `col` fix, confirm its tests go RED,
  restore, confirm GREEN. Same for the extraction. **S378 shipped three pins that stayed green with
  the code reverted** and the whole collateral had to be reverted. A pin that cannot fail is worse
  than no pin.

# BASELINE — set-comparison, never a remembered number
⚑ Do NOT trust any pre-existing failure count you are told, including one in this brief. S378
relayed "6 pre-existing integration flakies"; the true figure was **53-55**, and it moved by 2
between two runs of the same unmodified tree. **Capture your own baseline on `origin/main` before
you change anything, and compare SETS (0 new / 0 fixed), not counts.**

# WHAT TO REPORT
`WORKTREE_PATH`, `FINAL_SHA`, files-touched, **the corpus differential verbatim**, the
coverage-removal count, the mutation-proof observations, the `default-logic-exemption.ts` and F5
verifications, each conformance case's disposition, the baseline set-diff, and **anything this brief
got wrong.**
⚑ **The brief being wrong is an expected outcome** — the last five dispatches on this project each
out-measured the PA on at least one premise. If a premise here does not hold, say so and act on what
you measured, and say which premise.

# ⚑ STANDING RULE THIS ARC HAS ALREADY VIOLATED TWICE
**`maskCommentRegions` is safe ONLY over text that cannot contain a string literal, and NEITHER
sibling scanner qualifies.** It was folded in and reverted TWICE in one session on two different
domain arguments, both wrong. A `/*` inside a string value (`src/*.js`, a glob, a path, a regex)
opens a block comment that never closes and silences the lint for the rest of the body.
**Converge-don't-enumerate is a rule about shared DOMAIN, not shared code shape.** Do not fold these
scanners together and do not import the masking helper into either one. A live tripwire at
`compiler/tests/unit/state-block-bare-write-comment-state.test.js:155` asserts `ast-builder.js` does
not import it — **that tripwire must survive this carve.**

# MUST NOT TOUCH
- **`compiler/SPEC.md` and `compiler/SPEC-INDEX.md`** — the PA is authoring the carved normative text
  in parallel this session. Leave both exactly as they are on `origin/main`. If your carve implies a
  doc change, **write it in `progress.md` as a note to the PA**; do not make it.
- `docs/known-gaps.md`, `hand-off.md`, `master-list.md`, `handOffs/delta-log.md`,
  `docs/changelog.md` — PA-owned.
- `docs/PA-SCRML-PRIMER.md`, `docs/PA-SCRML-REFERENCE.md` — a sibling dispatch owns them right now.
- The branch `worktree-agent-a84d38ac3c1c30a4b` — read-only, a review is pinned to its SHA.
