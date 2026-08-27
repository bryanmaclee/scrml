# BRIEF — rulings 2 and 3, SEQUENCED on `ast-builder.js` (+ one LOW rider)

**Dispatched:** S378-bryan, 2026-08-26. **Base:** `origin/main` @ `a1c14878`.
**change-id:** `rulings-2-3-ast-builder-2026-08-26`

Both rulings were RATIFIED by bryan at S375 (`user-voice-scrml.md` S375, *"your recs all 4"*). They
are **not open questions** — this is a build. What is open is the *implementation*, and two of the
premises below were re-derived on `main` by the PA **today** rather than relayed, because the S372
and S375 hand-offs each recorded carried premises going stale.

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
   git fetch origin brief/s378-rulings-2-3
   git checkout FETCH_HEAD -- docs/changes/rulings-2-3-ast-builder-2026-08-26/
   ```
5. `git status --short` clean. 6. `bun install`.
7. `bun run pretest` — **run it plainly, from the worktree CWD.**
   ⚑ **S376: `bun --cwd <path> run <script>` SILENTLY NO-OPS and exits 0.** It prints the script
   list and does nothing, so the browser fixtures never build and the pass is fake. Verdict by exit
   code is no defence here — **check the artifact exists**. Use `--cwd=<path>` (with the `=`) or
   plain CWD.
8. Use `bun run test` (chains pretest) for full-suite baselines, never bare `bun test`.

If ANY step fails: **STOP and report.** Do not proceed on a half-verified workspace.

## Path discipline
- Apply edits via **Edit/Write on `WORKTREE_ROOT`-absolute paths**.
  ⚑ **S314: the old "Bash-only edits" rule is RETIRED and is now actively wrong** — the isolation
  guard refuses Bash heredocs/redirects as "too complex to verify", and the `path-discipline.sh`
  PreToolUse hook guards *Edit/Write* specifically. Bash-based writes are the one surface the hook
  cannot see.
- **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `--cwd=`, absolute paths.
- ⚑ **S376: NEVER a bare `pkill -f "bun test..."` / `killall`.** Every checkout shares the command
  string, so that pattern matches a suite running in MAIN just as well as yours, and killing another
  checkout's pre-commit hook leaves **no trace on your side**. Kill by PID captured at launch, or
  filter on cwd. This is the same footing as "never `cd` into main."
- First commit message includes your verbatim `pwd`: `WIP(rulings-2-3): start at <pwd>`.

# COMMIT DISCIPLINE
Commit **after each phase** — do not batch. Your branch + `progress.md` are the only crash-recovery
anchor; a batch-at-the-end agent that stalls loses the whole round (witnessed S372, where a stall at
600s during *reporting* was survivable only because the work was already committed).
Coupled code+test lands **together** (no transiently-red window). `git status` clean before DONE.
Update `$WORKTREE_ROOT/docs/changes/rulings-2-3-ast-builder-2026-08-26/progress.md` per phase.
**NEVER `--no-verify`** — and never work around it by overriding `core.hooksPath` (S283).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing**; for this shape also
read `.claude/maps/error.map.md` (diagnostics) and `.claude/maps/structure.map.md`.
Map stamp `fc6df72e`; base `a1c14878`. **PA currency check performed:** the only compiler-adjacent
file landed since the map is `scripts/ctx.ts`, which is unrelated to `ast-builder.js` — so the map
is current for this arc. Treat map content as a **verify-against-source hypothesis** anyway, and
report whether it was load-bearing (including "not load-bearing" — that is a real answer).

# RULE 4 — SPEC IS NORMATIVE
Every SPEC line number below was grepped by the PA on `a1c14878`. **Re-confirm by grep before
editing** — a §34 insertion shifts every range below it.

---

# THE SEQUENCING CONSTRAINT — READ BEFORE PLANNING

Ruling 2, ruling 3, and the LOW rider **all land in `compiler/src/ast-builder.js`**. They are
**SEQUENCED, NOT PARALLEL** — whichever goes second clobbers the others.

⚑ **The bare-call gate is a REJECT gate and MUST NOT be folded into the comment-flush fix** (S375).
They are different changes with different failure directions; keep them as distinct commits.

Order: **Phase 1 (ruling 2) → Phase 2 (ruling 3) → Phase 3 (LOW rider) → Phase 4 (verify).**

---

# PHASE 1 — RULING 2: land the held bare-call build, then migrate its 2 files into conformance cases

## The ruling (RATIFIED S375, verbatim grounds)
> Migrate the 2 bare-call files **INTO CONFORMANCE CASES that assert `E-BARE-CALL` fires.**

Both hits are the comment-branch's own reproducer artifacts — one is bryan's hand-written file — so
**them newly-erroring IS the rule biting correctly.** "Exempt" would carve out the one thing that
tests the rule; "accept" lands with a red gate. Converting a demonstration into a pinned contract is
strictly better than either.

## The held build
`origin/wip/s368-bare-call-build` @ **`7d5fe573`** — *"WIP(bare-call): progress — SPEC, locus
refinement, conformance parity, full verification"*. Base `3a7203ff`, now **46 commits behind
`origin/main`**.

**⚑ IT HAS NEVER HAD ITS S239 ADVERSARIAL PASS.** That gate is mandatory and is not waived by the
build being old or by it self-reporting "full verification."

## ⚑ PA-VERIFIED TODAY, BY EXECUTION — do not re-derive, but do not assume it stays true either
- **`E-BARE-CALL` does not exist on `main`**: `grep -rn 'E-BARE-CALL' compiler/src/` returns **0**.
- **The merge is CLEAN — MEASURED, not predicted.** `git merge-tree --write-tree --messages
  origin/main origin/wip/s368-bare-call-build` exits **0**, auto-merging `compiler/SPEC.md` and
  `compiler/src/ast-builder.js` with no conflict.
  The S376 `DE-RISK.md` in this repo predicted this from hunk offsets; **it is now a fact.**
- ⚑ **A clean 3-way merge proves TEXTUAL write-set disjointness only** (`pa-base` §7) — roughly
  snapshot isolation, which is not serializability. **The full suite is the semantic backstop**, which
  is a further load-bearing reason it is never bypassed.

## What the build contains (`3a7203ff..7d5fe573`)
| file | change | landing mechanic |
|---|---|---|
| `compiler/src/ast-builder.js` | +194 | 3-way merge (2 intervening writes on main) |
| `compiler/src/symbol-table.ts` | −46 net | wholesale-safe (0 intervening) |
| `compiler/src/default-logic-exemption.ts` | new +73 | new file |
| `compiler/SPEC.md` | +5 (a §34 row) | per-section reconcile |
| `compiler/tests/unit/bare-call-at-body-top.test.js` | new +269 | new file |
| `compiler/tests/unit/c22-bare-variant-codegen.test.js` | ±11 | wholesale-safe |
| 3 × `conformance/cases/call-not-in-logic-context-{pos,neg,prose-neg}/` | new | new dirs |

## Steps
1. Merge `origin/wip/s368-bare-call-build` into your branch. **Read the merge result** — do not
   trust my `merge-tree` run as a substitute for reading your own tree.
2. **§34 / SPEC-INDEX reconcile.** Ruling 1's `E-STATE-BLOCK-STATEMENT-FORM` row already landed on
   `main` (#718) and sits in §34. This build inserts its own row. A §34 insertion shifts every
   `SPEC-INDEX.md` line range below it → run `bun run scripts/regen-spec-index.ts` and commit the
   result.
3. **Derive the migration population FROM THE COMPILER**, not by text grep. Compile the corpus
   (`compileScrml({write:false})` over the `.scrml` sources) and report which files newly fire
   `E-BARE-CALL`.
   ⚑ **The S375 measure was 2 files. Re-measure — do not inherit it.** 46 commits have landed since.
4. **Migrate each hit into a conformance case asserting `E-BARE-CALL` fires** (that is the ruling).
   The 3 `call-not-in-logic-context-*` case dirs the build already carries are the pattern to mirror.
5. **STOP-AND-REPORT condition:** if the newly-firing population contains any file that is **not** a
   reproducer artifact for this defect — i.e. a real corpus program that a user would recognize as
   working code — **STOP and report before migrating it.** That is a different ruling and it is
   bryan's, not yours.

---

# PHASE 2 — RULING 3: BOTH halves

## The ruling (RATIFIED S375, verbatim)
> **BOTH halves: correct the false §34 claim, AND extend the diagnostic to the control-flow
> statement class.**

## Half A — the false normative claim (a Rule 4 item)

⚑ **PA-VERIFIED BY EXECUTION on `a1c14878` today.** Reproducer:
```scrml
<program>
if (1) { }
<page>
  <h1>Hi</h1>
</page>
</program>
```
→ **exit 0, ZERO diagnostics**, and `if (1) { }` appears in the emitted HTML at line 11.

`E-CONTROL-FLOW-IN-MARKUP`'s own §34 row (`compiler/SPEC.md:19817`) lists under **"Does NOT fire"**:
> *a `<program>`/`<page>`/`<channel>` direct-child default-logic root (the §40.8 auto-lift handles it)*

**The lift does not handle it.** The locus is covered by **NEITHER** the error nor the lift. That is
a normative row asserting behaviour that does not happen.

⚑ **THERE IS A SECOND SITE MAKING THE SAME CLAIM, and the S375 record did not name it** — the PA
found it while re-deriving. `compiler/SPEC.md:11765` (§17.4 prose):
> *the §40.8 default-logic auto-lift fires only at `<program>`/`<page>`/`<channel>` direct-child
> roots, never inside nested markup*

Both must be corrected in the same landing, or half A ships half-done. Grep for the claim shape
before you finish — if there is a third site, correct it too and say so.

## Half B — extend the diagnostic to the control-flow statement CLASS

**Scope is the control-flow statement class specifically** — control flow is logic by the identical
reasoning that made a bare *call* logic at S368. **NOT** "diagnose every non-declaration run": the
S368 ruling **deliberately rejected** that (limb b), because it over-reaches into prose, and prose at
that position renders and is a working shape. **Named form, refused complement.**

## ⚑ THE LOCUS — PA-TRACED, not merely located (`pa-base` §5 wants this distinction)

`compiler/src/ast-builder.js`, `liftBareDeclarations`:

- **line 784** — `BARE_CONTROL_FLOW_IN_MARKUP_RE = /^\s*(for|while|if)\b\s*\([^]*?\)\s*\{/`
  (already matches the shape).
- **~line 1858** — the fire site, gated:
  ```js
  block.type === "text" && parentType === "markup" && BARE_CONTROL_FLOW_IN_MARKUP_RE.test(block.raw)
  ```
- **line 1161** — the function ALREADY takes an `isDefaultLogicBody` parameter.
- **line 1263** — it is computed as `(isProgramRoot || isChannelRoot || isPageRoot)` — **exactly the
  §40.8 default-logic locus this ruling is about.**
- **lines 1783 and 1820** — **two sibling gates in the same loop body already use it**:
  `isDefaultLogicBody && TOPLEVEL_AT_WRITE_RE` (bare writes) and
  `isDefaultLogicBody && TOPLEVEL_ON_LIFECYCLE_RE` (bare lifecycle statements).

**So the discriminator already exists, is already in scope at the fire site, and two siblings already
mirror the exact shape you need.** This is the depth-of-survey discount (PRIMER §12) — the fix is
plausibly a second arm on an existing gate, not new infrastructure.

⚑ **This is a PA-located-and-traced hypothesis, not a verified fix.** Verify it, and **report whether
it held, was refined, or was wrong.** If the right answer is a different site, take the different
site and say so — three S375/S376 briefs named a wrong or self-contradicting locus and every
dispatch out-measured the PA. That is the standing expectation, not a failure.

## Migration — MEASURED by the PA, and the number is ZERO

⚑ **Direction of change: newly-rejecting.** That owes a measured migration (`pa-base` §8), and
**assumed-zero is not measured-zero.**

**PA measurement, this session, from compiled artifacts:**
- Captured the full corpus emit on `a1c14878` via `scripts/corpus-emit-differential.ts capture`
  (1906 sources → 7380 artifacts, **1839 HTML**, all 5 stages completed).
- Swept every emitted HTML for a control-flow statement shipping as page text. **2 hits**, both
  classified OUT by inspection:
  1. `samples/rust-dev-debate-dashboard` — the match is *inside* a `${ … }` logic block, i.e. the
     canonical Tier-0 `${ for/lift }` form shipping as text. **A different defect**, not this locus.
  2. `stdlib/http/index` — a stdlib module compiled **standalone**, which PRIMER §10 states
     explicitly is not a compile target. **A measurement artifact.**
- **Bite proven**: the same sweep run against the known-positive reproducer above **does** match it,
  so "0" is a real zero and not a blind pattern. A widened sweep (adding `else`/`switch`/`do`,
  allowing mid-line) returns the same 2.

**⚑ THE HONEST BOUND ON THAT NUMBER — do not quote it as unconditional.** It measures the SYMPTOM in
*emitted HTML*, so it only covers sources that compiled and emitted: **1839 of 1906**. A source that
fails compilation for an unrelated reason could still harbour the shape and would not appear.

**Your measurement is the authoritative one** — once the diagnostic exists, it fires across ALL
sources including failing ones. Derive it from the compiler and report it.
**If your number is non-zero: STOP and report before migrating anything.** A non-zero population is a
separate ruling and it is bryan's.

---

# PHASE 3 — the LOW rider (same file; do NOT dispatch this standalone)

`g-state-block-bare-write-scan-has-no-comment-state` (LOW, open).

The sibling Info lint `scanStateBlockBareWriteDecls` (`compiler/src/ast-builder.js:~1923`) **has no
comment state at all**. Its `^(\s*)@` anchor makes the `//` form *accidentally* safe; the block-comment
form is not — a commented-out `@count = 0` inside a `/* */` in a `<db>`/`<state>` body false-fires.

**The pattern to mirror already exists and shipped last session:** ruling 1's
`compiler/src/lint-e-state-block-statement-form.js` solved the identical problem with a comment state
machine that **MASKS comment bytes to spaces rather than skipping lines**, which keeps every span
byte-exact. Reuse that approach — ideally the same helper. Do not invent a second comment scanner;
two divergent ones is the defect family this project keeps filing.

---

# PHASE 4 — VERIFICATION (do not mark DONE without this)

1. **Full-suite baseline at START** (`bun run test`), and confirm **0 NEW failures** at the end.
   The 6 pre-existing integration flakies (self-host / csrf / any-type-forbidden) are known — compare
   against your own start-of-run baseline, not against a remembered number.
2. **Corpus emit differential.** `scripts/corpus-emit-differential.ts` is the repo tool for this;
   read its header before using it. A base manifest on `a1c14878` already exists at
   `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/58f145c7-3cc7-4bf8-bc78-31fea85a88d3/scratchpad/corpus/main.manifest.json`
   — but **it is in the PA's scratchpad, not your worktree.** Capture your own base if you cannot
   read it; do not skip the differential.
   Expected: the ONLY artifact changes are files that newly and correctly fire a diagnostic.
3. **Bite proof, both directions, for EACH new/extended diagnostic:**
   - a positive fixture fires it (**assert the exit code, and assert the CODE — not by grepping
     output text**);
   - a near-miss negative does NOT fire it (prose at the same position must still compile);
   - deliberately break the gate, confirm red, restore, confirm green.
4. ⚑ **`grep -c` exits 1 on a CLEAN result and `$?` after a pipeline is the pipeline's exit code.**
   Both are recorded traps on this project. Verdict by **exit code of the thing under test**, never
   by grepping its output text.
5. **Report the direction-of-change classification** for each landing (inert / newly-rejecting /
   newly-accepting / semantics-changed) with the artifact-diff evidence that supports it.

# FINAL REPORT — what the PA needs back
- `WORKTREE_ROOT` (verbatim `pwd`), branch name, **final SHA**, files touched.
- Whether the ruling-3 locus hypothesis **held / was refined / was wrong**.
- The **compiler-derived migration population** for ruling 2 and for ruling 3, with the command used.
- Whether the maps were load-bearing.
- Anything you could NOT verify, named as such. **A residual you disclose is worth more than a green
  report** — the S377 review's real catch was an overclaim, not a bug.
- **Do NOT run `/code-review` yourself** — you cannot invoke it in-agent. The PA runs the mandatory
  S239 adversarial pass on your diff before anything merges.
