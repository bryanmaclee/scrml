# BRIEF — SPLIT the held rulings branch: land ruling 3 + the LOW rider, excise ruling 2's bare-call gate

**Dispatched:** S379-bryan, 2026-08-27. **Base:** `origin/main` @ `48f0aaf8`.
**change-id:** `ruling3-split-land-2026-08-27`
**Source branch (do not push to it):** `worktree-agent-a91805a13f51a8596` @ **`28ce5b90`**, cut from
`a1c14878`. Worktree retained at `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a91805a13f51a8596`.

This is a **carve, not a build**. Everything you need already exists on `28ce5b90` and is verified.
Your job is to land the half that is clean and remove the half that is not, without disturbing
either.

## Why the split — the decision is already made, this is the execution

`28ce5b90` bundles TWO ratified rulings that both touch `ast-builder.js`. Four consecutive S239
adversarial rounds have now run against it. **Ruling 3's control-flow work has been clean in all
four.** **Ruling 2's bare-call recognizer has produced real defects in every single one** — 4 of
round 3's 5, and 2 HIGH + 1 LOW of round 4's 5.

The S378 hand-off pre-authorised exactly this outcome: *"If it finds more in the bare-call
recognizer again, SPLIT — land ruling 3 + the LOW rider, hold the bare-call gate as its own arc."*
The condition fired. **Do not attempt to fix the bare-call recognizer in this dispatch.** It is
being re-derived under a separate arc for a reason stated at the end of this brief.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 — hard gate)

Worktree root: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/` = `WORKTREE_ROOT`.
⚑ The repo is **`scrml`** (renamed S200). Any older brief you may pattern-match saying `scrmlTS` is stale.

## Startup — BEFORE any other tool call
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is under any other repo, **STOP and report** (S90 CWD-routing). Save `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. **Assert your base**: `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
   ⚑ **S346: a worktree is cut from `origin/main`, NOT from the dispatching checkout's HEAD.**
4. **Fetch this brief into your tree** — it is on a branch, not yet on `main`:
   ```
   git fetch origin brief/s379-ruling3-split
   git checkout FETCH_HEAD -- docs/changes/ruling3-split-land-2026-08-27/
   ```
5. **Fetch the source branch you are carving from** (it is local-only on this machine, so fetch it
   from the shared checkout, not from `origin`):
   ```
   git fetch /home/bryan-maclee/scrmlMaster/scrml worktree-agent-a91805a13f51a8596
   git rev-parse FETCH_HEAD    # MUST print 28ce5b90992bdcb16a51fca1416d577bc5c5690b
   ```
   ⚑ **READ-ONLY.** Never push to it, never commit onto it, never `git checkout` it as a branch.
   A fourth review round is pinned to that SHA; moving it invalidates the record.
6. `git status --short` clean. 7. `bun install`.
8. `bun run pretest` — **run it plainly, from the worktree CWD.**
   ⚑ **S376: `bun --cwd <path> run <script>` SILENTLY NO-OPS and exits 0.** It prints the script
   list and does nothing, so the browser fixtures never build and the pass is fake. Verdict by exit
   code is no defence here — **check the artifact exists**. Use `--cwd=<path>` (with the `=`) or
   plain CWD.
9. Use `bun run test` (chains pretest) for full-suite baselines, never bare `bun test`.

If ANY step fails: **STOP and report.** Do not proceed on a half-verified workspace.

## Path discipline
- Apply edits via **Edit/Write on `WORKTREE_ROOT`-absolute paths**.
  ⚑ **S314: the old "Bash-only edits" rule is RETIRED and is now actively wrong** — the isolation
  guard refuses Bash heredocs/redirects as "too complex to verify", and the `path-discipline.sh`
  PreToolUse hook guards *Edit/Write* specifically. Bash-based writes are the one surface the hook
  cannot see.
- **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `--cwd=`, absolute paths.
- ⚑ **NEVER a bare `pkill -f "bun test..."` / `killall`.** Every checkout shares the command string,
  so that pattern matches a suite running in MAIN just as well as yours, and killing another
  checkout's pre-commit hook leaves **no trace on your side**. Kill by PID captured at launch.
- First commit message includes your verbatim `pwd`: `WIP(ruling3-split): start at <pwd>`.

# COMMIT DISCIPLINE
Commit **after each phase** — do not batch. Your branch + `progress.md` are the only crash-recovery
anchor. Coupled code+test lands **together**. `git status` clean before DONE. Update
`$WORKTREE_ROOT/docs/changes/ruling3-split-land-2026-08-27/progress.md` per phase.
**NEVER `--no-verify`** — and never work around it by overriding `core.hooksPath` (S283).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing**; for this shape also
read `.claude/maps/error.map.md` (diagnostics) and `.claude/maps/structure.map.md`.
Map stamp `fc6df72e`; base `48f0aaf8`. **PA currency check performed:** `git diff --name-only
fc6df72e..48f0aaf8 -- compiler/src` is **EMPTY** — zero compiler source moved since the map was
written. Treat map content as a **verify-against-source hypothesis** and report whether it was
load-bearing ("not load-bearing" is a real answer).

# RULE 4 — SPEC IS NORMATIVE
`compiler/SPEC.md` is the single normative source. Every line number in this brief was grepped on
`28ce5b90`; **re-confirm by grep before editing** — a §34 insertion shifts every range below it.

---

# WHAT LANDS (the clean half)

All of this is on `28ce5b90` and was confirmed correct by the round-4 reviewer:

1. **Ruling 3 — `E-CONTROL-FLOW-IN-MARKUP` extended to the default-logic body-top.** Reviewer,
   verbatim: *"The three new `E-CONTROL-FLOW-IN-MARKUP` arms behave as specified: `<program>` +
   `if (1) { }` and `< state>` (deprecated opener) + `if (1) { }` both fire on the branch and both
   were silent on `main`; the canonical `<db>` case is unchanged; the four prose near-misses in
   `ctrl-012-default-logic-prose-neg` stay silent."*
   Includes ruling 3's §34 half — correcting the false claim in `E-CONTROL-FLOW-IN-MARKUP`'s own row
   that the §40.8 auto-lift covers this locus (it does not; the locus was covered by NEITHER).
2. **The LOW rider** — `g-state-block-bare-write-scan-has-no-comment-state`, the comment-state fix in
   `lint-e-state-block-statement-form.js` (a commented-out `@count = 0` no longer false-fires).
3. **The `symbol-table.ts` → `default-logic-exemption.ts` extraction.** Reviewer verified
   behavior-preserving: *"strict membership, then `/`-boundary suffix match, identical fallbacks."*
4. **The F5 `col` fix in both scanners.** Reviewer verified correct:
   `li === 0 ? baseCol + colStart : colStart + 1` agrees with the byte offset computed beside it in
   both the mid-line-start and newline-led cases.
5. **Their tests + conformance cases**, including `ctrl-012-default-logic-prose-neg` and the
   `control-flow-at-default-logic-body-top` + `state-block-bare-write-comment-state` unit files.

## Two round-4 LOW findings you SHOULD fix while you are in here
- **Finding 4 — a doc banner asserting a consumer that does not exist.**
  `compiler/src/lint-e-state-block-statement-form.js` lines ~323 and ~327 claim
  `scanStateBlockBareWriteDecls` "now imports THIS function" and that "BOTH consumers change with
  it". **That import was reverted later on the same branch**, and
  `compiler/tests/unit/state-block-bare-write-comment-state.test.js:155` is a live tripwire
  asserting `ast-builder.js` must NOT import it. The only call site is line ~446 in the same module.
  Correct the banner to describe reality, and drop the now-dead `export` if nothing consumes it.
  ⚑ Do NOT "fix" this by re-adding the import — that fold-in is what caused a regression at S378 and
  was reverted twice. See the standing rule at the end of this brief.
- **Finding 3 — the diagnostic span.** `ast-builder.js` ~line 2181 sets
  `end: baseStart + block.raw.length` (end of the whole text run) while M3 recovery only consumes
  `block.raw.slice(0, hit.end)`. An editor consumer underlines the offending line AND every
  declaration below it. `hit.end` is already in hand. **NOTE:** this is in the bare-call recovery
  path — if excising the gate removes this code entirely, this finding evaporates. Check first;
  do not resurrect dead code to fix it.

---

# WHAT IS EXCISED (the held half)

**Ruling 2's bare-call gate, in full.** Concretely, and verify each by grep rather than trusting
this list:
- `matchTopLevelBareCall` and its regex `TOPLEVEL_BARE_CALL_RE`
- `SCRML_BUILTIN_CALL_KEYWORDS`
- every fire site of **`E-CALL-NOT-IN-LOGIC-CONTEXT`**
- the M3 recovery path that consumes `hit.end`
- `compiler/tests/unit/bare-call-at-body-top.test.js`
- the five `conformance/cases/reactive/call-not-in-logic-context-*` cases
- the §34 row for `E-CALL-NOT-IN-LOGIC-CONTEXT` and any SPEC prose that promises it fires

⚑ **`default-logic-exemption.ts` is SHARED.** Check whether the exemption machinery is used by
ruling 3's arms as well as by the bare-call gate. If it is used by both, it **stays**. If it is used
ONLY by the bare-call gate, it goes with it. Decide by grep, and state which in `progress.md`.

## ⚑ THE ACCEPTANCE DEFINITION IS BEHAVIOURAL, NOT A HUNK COUNT
Do not define the split by diff hunks — the two rulings are interleaved inside
`liftBareDeclarations` and a hunk-shaped cut will take the wrong lines. Define it by what the
compiler DOES:

1. On your branch, `E-CALL-NOT-IN-LOGIC-CONTEXT` **fires nowhere**, for any input.
2. On your branch, `E-CONTROL-FLOW-IN-MARKUP`'s new arms fire on **exactly** the inputs they fire on
   for `28ce5b90`, and stay silent on exactly the inputs they are silent on there.
3. **The differential is the gate.** Compile the corpus with the `28ce5b90` compiler and with yours,
   and diff the diagnostic sets. **The ONLY differences may be `E-CALL-NOT-IN-LOGIC-CONTEXT`
   diagnostics disappearing.** Any other delta — a control-flow diagnostic moving, a new warning, a
   changed span — means the carve took something it should not have. Report the differential
   verbatim in `progress.md`, including the case where it is empty.

---

# THE TWO HIGH DEFECTS — why the gate is held, PA-REPRODUCED, do not re-litigate

Both were reported by the round-4 reviewer and then **independently reproduced by the PA by
execution** against the `28ce5b90` compiler with an A/B against `main`. You do not need to fix
these; you need to make sure your carve removes the code that causes them.

**HIGH 1 — the gate declines on the canonical scrml declaration form.**
```scrml
<program>
loadData()
<bias> = 1.2
<p>hi</>
</program>
```
Branch: **exit 0**, and `loadData()` ships into the HTML as page text — identical to `main`. The
same source with a JS-shaped `const x = 1` instead of `<bias> = 1.2` **does** fire.

**HIGH 2 — prose that renders on `main` becomes a fatal error.** PA-measured at a `<program>`
body-top, with the reviewer's own controls:

| line | branch | main |
|---|---|---|
| `Version(2) + notes` | **FATAL** | compiles + renders |
| `Total(5) - discounts` | **FATAL** | compiles |
| `Signup(now) \|\| later` | **FATAL** | compiles |
| `Chapter(3) and more` | compiles | compiles |
| `Rate(x) * 2 per unit` | compiles | compiles |
| `Note(3) is important` | compiles | compiles |

**Both fall out of ONE line.** The guard hands `parseExprToNodeQuietProbe` the WHOLE lead-trimmed
run and branches on `node.kind === "escape-hatch"`, i.e. **on whether acorn could parse the
remainder**. HIGH 1: a V5-strict structural decl on a later line makes the run un-acorn-parseable,
so the guard returns `null` and declines. HIGH 2: acorn extends the expression over trailing prose,
so `callEnd = node.span.end` swallows the sentence, the tail reads empty, and the gate fires.

⚑ **This is why the gate is being re-derived rather than patched again.** bryan ruled at S368,
verbatim: *"There is lots of valid js that dose not work in scrml. ... 'valid js' is not a
consideration one way or another."* The recognizer decides a scrml question by asking a JS parser —
the exact premise that ruling struck, which is Rule 7 one level up. Four rounds each patched a
symptom of that one wrong decision procedure. **Not your problem in this dispatch. Stated so you do
not helpfully "fix" it on the way past.**

---

# TESTS
- Every test that pins ruling 3, the LOW rider, the extraction and the F5 `col` fix must survive and
  pass unchanged.
- Every test that pins the bare-call gate is removed with it. **Removing a test is a coverage
  reduction — count what stops being checked and record the number in `progress.md`** (pa-base §8:
  before narrowing any check, count what it will stop looking at).
- ⚑ **MUTATION-PROVE the surviving ruling-3 pins.** Revert ruling 3's arms, confirm those tests go
  RED, restore, confirm GREEN. S378 shipped three pins that stayed green with the code reverted and
  had to revert the whole collateral. A pin that cannot fail is worse than no pin.

# BASELINE — set-comparison, never a remembered number
⚑ Do NOT trust any pre-existing failure count you are told, including one in a hand-off. S378
relayed "6 pre-existing integration flakies"; the true figure was **53-55**, and it moved by 2
between two runs of the same unmodified tree. **Capture your own baseline on your base commit before
you change anything, and compare SETS (0 new / 0 fixed), not counts.**

# WHAT TO REPORT
`WORKTREE_PATH`, `FINAL_SHA`, files-touched, the corpus differential verbatim, the coverage-removal
count, the mutation-proof observations, the `default-logic-exemption.ts` shared-or-not decision, the
baseline set-diff, and anything this brief got wrong. ⚑ **The brief being wrong is an expected
outcome** — the last four dispatches on this project each out-measured the PA on at least one
premise. If a premise here does not hold, say so and act on what you measured.

# ⚑ STANDING RULE THIS ARC HAS ALREADY VIOLATED TWICE — READ BEFORE TOUCHING THE SCANNERS
**`maskCommentRegions` is safe ONLY over text that cannot contain a string literal, and NEITHER
scanner qualifies.** It was folded in and reverted TWICE in one session on two different domain
arguments, both wrong. A `/*` inside a string value (`src/*.js`, a glob, a path, a regex) opens a
block comment that never closes and silences the lint for the rest of the body. **Converge-don't-
enumerate is a rule about shared DOMAIN, not shared code shape.** Do not fold these scanners
together, and do not import the masking helper into either one.

# MUST NOT TOUCH
- `docs/known-gaps.md`, `hand-off.md`, `master-list.md`, `handOffs/delta-log.md`,
  `docs/changelog.md` — PA-owned, being edited concurrently this session.
- `compiler/src/commands/dev.js` — a sibling dispatch owns it right now.
- The branch `worktree-agent-a91805a13f51a8596` — read-only, a review is pinned to its SHA.
