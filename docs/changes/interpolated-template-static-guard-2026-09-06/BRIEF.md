# BRIEF — an interpolated template is classified STATIC, deleting the §53.4 boundary guard

**Dispatched:** S404-bryan, 2026-09-06. Base: `origin/main`.
**change-id:** `interpolated-template-static-guard-2026-09-06`
**Gap:** `g-interpolated-template-classified-static-deletes-the-53-4-boundary-guard` (**HIGH**, open).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST; follow its "Task-Shape Routing" to the maps for a
type-system / predicate-zone shape. ⚑ The map watermark is `499eecce` and `origin/main` has moved
past it — treat map content as a **verify-against-source hypothesis**, and note that the two files
you are changing were themselves modified after that watermark (by `wrap/s402`, #873, the PR that
introduced this defect). Report whether the maps were load-bearing.

## THE DEFECT — PA-REPRODUCED BY EXECUTION, both limbs, against a DETACHED TRUE-BASE WORKTREE

Base used: `499eecce` (the parent of the `wrap/s402` merge), checked out as a **separate detached
worktree** — not a checkout sharing state with the thing under test. Do the same for any A/B you run.

**Limb A — the guard is SILENTLY DELETED (`semantics-changed`, the dangerous one):**
```scrml
<first>: string = "Bartholomew"
<last>:  string = "Vanderbilt"
<full>:  string(.length <= 8) = `${@first} ${@last}`
```
`grep -c E-CONTRACT-001-RT` over the emitted output — **base: 2 · HEAD: 0.** Byte-identical source,
**both exit 0, zero diagnostic delta.** A 22-character value inhabits a `<= 8` predicate with nothing
checking it at compile time or runtime. ⚑ **A diagnostic differential is BLIND to this by
construction. Only an artifact diff sees it.**

**Limb B — valid code is REJECTED, same root:**
```scrml
<a>: string = "hello"
<s>: string(.length >= 5) = `${@a} world here`
```
base: compiles clean, 2 guards. HEAD: hard error `E-CONTRACT-001: Value  does not satisfy the
predicate`. ⚑ **The EMPTY value in that message is the tell** — `""` is what is being evaluated.

## ROOT (reviewer-identified, PA-confirmed by the empty-value tell) — VERIFY IT, do not assume it

`isStaticTemplateLit` (`compiler/src/expression-parser.ts:4514`) tests
`n.raw === "\`" + n.value + "\`"`. That is **TRUE when `raw === "\`\`"` and `value === ""`** — exactly
the encoding a multi-quasi (interpolated) template degrades to. Single-quasi-empty and
multi-quasi-degraded are **indistinguishable in `(raw, value)`**, so the doc comment claiming this is
"an exact test, not a heuristic" is false. The `literal-type-only` kind that #873 added specifically to
prevent this is therefore **never reached** on the state-cell path. The same aliasing hole is
independently reachable through the parser's last-resort `templateRaw = "\`\`"` fallback around
`expression-parser.ts:2376`.

⚑ **Mark this locus PA-located-verify.** It came from a review, and a review finding is a claim. I
confirmed the SYMPTOM by execution and the empty-value tell is strong corroboration, but **I did not
trace execution from the parser arm to the classification site.** Report whether the hypothesis held,
was refined, or was wrong.

## THE GOVERNING SENTENCE — this is CONFORMANCE RESTORATION, not a widening

SPEC §7.5.1, landed by `wrap/s402` itself:

> *"a widening of the literal set **SHALL NOT** convert a §53.4 BOUNDARY assignment into a STATIC one
> for a literal whose VALUE is not statically determined — an interpolated template literal is such a
> literal (its type is known, its text is not)."*

The contract already says the form is BOUNDARY; the implementation reclassified it. Quote this in the
landing commit. ⚑ **Do not treat limb B's un-rejection as a widening** — it restores behaviour a
normative sentence already mandated.

## ⚑ THE ASYMMETRY THAT LET IT SHIP — your tests must not repeat it

**The `let` form WAS fixed by #873 and the state-cell / derived-cell form was NOT** (PA-verified:
`let` keeps its guard). The PR's own 262 lines of new tests **cover only `let`**. That is how a
soundness regression landed green. **Your tests SHALL cover all three forms** — `let`, state-cell
(`<x>: T(pred) = …`), and `const`-derived (`const <x>: T(pred) = …`) — in **both** directions
(guard-emitted and no-false-rejection), and SHALL include the degenerate shapes: a genuinely empty
template `` `` ``, a single-quasi non-empty template, and a multi-quasi template whose interpolations
render to the empty string.

## ALSO IN SCOPE

- **LOW, same review:** `type-system.ts:3468` — the new back-tick branch in `extractInitLiteral` is
  ordered **before** the arithmetic test and matches compound expressions, so `` `abc` + `de` ``
  yields a literal of 11 chars instead of `arithmetic`. On the fallback path this elides a boundary
  guard while the real runtime value is 5 chars. Move the template test **below** the arithmetic test,
  or require the body to contain no unescaped back-tick.

## EXPLICITLY OUT OF SCOPE

- `g-position-2-annotation-check-skipped-when-the-annotation-carries-a-predicate` (MED) — the
  predicated carve-out at `type-system.ts:10979`. **It is RELAYED-UNVERIFIED** (the reviewer
  reproduced it; the PA did not) and it is **not a regression** — position 1 has the same hole. It is
  a separate arc with its own SPEC question (fire `E-TYPE-031` before the predicate branch, or state
  the carve-out in §7.5.1). Do not fold it in.
- Any change to `int`/`integer` handling — a separate ruled arc is in flight.
- `docs/known-gaps.md` and `docs/pr-reviews.md` — contended with a live concurrent session. Report
  findings; the PA files them.

## VERIFICATION — the gate is an ARTIFACT differential, not a diagnostic one

1. **Both reproducers above**, on a detached true-base worktree vs your branch. Limb A must go 0 → 2
   guards; limb B must go hard-error → clean-with-guards.
2. **R26 empirical:** recompile real adopter `.scrml` on your post-fix baseline —
   `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` plus live adopter sources.
3. ⚑ **A CORPUS ARTIFACT DIFFERENTIAL is MANDATORY**, because limb A moves no diagnostic. Compile the
   corpus before and after and diff the **emitted output**, not the error stream. Report: files
   changed, guards added, guards removed. **Any guard REMOVED by your fix is a finding — report it,
   do not absorb it.**
4. **Measured migration:** count corpus sites where an interpolated template meets a predicated
   annotation. Assumed-zero is not measured-zero.
5. Full suite green. ⚑ Run `bun run pretest` plainly from the worktree CWD first — the browser tier
   reads gitignored fixtures and reports ~50 phantom failures without it. (`bun --cwd <path> run
   <script>` SILENTLY NO-OPS at exit 0; verify the artifact appeared.)
6. **DO NOT mark DONE without the artifact differential passing.**

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
   `git rev-parse --show-toplevel` MUST equal it; tree clean. Any failure: STOP and report.
2. `git merge-base HEAD origin/main` MUST equal `origin/main` — assert your own base.
3. The brief is NOT in your worktree (main is branch-protected). Step 1:
   `git fetch origin scope/s404-template-static-guard && git checkout FETCH_HEAD -- docs/changes/interpolated-template-static-guard-2026-09-06/`
4. `bun install` (worktrees do not inherit `node_modules`), then `bun run pretest` plainly.
5. Worktree-ABSOLUTE paths on every Read/Write/Edit. **NEVER `cd` into the main checkout** — use
   `git -C "$WORKTREE_ROOT"` and `--cwd=<path>` (with the `=`).
6. ⚑ **NEVER `git stash`** — `refs/stash` is SHARED across every worktree including the PA's. Do
   base-vs-build flips by **FILE COPY** or a second detached worktree.
7. ⚑ **NEVER a bare `pkill -f` / `killall`** — every checkout shares the command string.
8. First commit: `WIP(template-static-guard): start at $(pwd)`.
9. NEVER `--no-verify`; never override `core.hooksPath`. If a gate blocks you, report it.

## CRASH RECOVERY
Commit after each meaningful unit; WIP commits expected. Append-only timestamped `progress.md` in the
change dir. Report worktree path, FINAL SHA, files touched, and whether the locus hypothesis held.

## DONE-PROBE
Both reproducers flip on a true base; the corpus artifact differential shows guards ADDED and none
removed; the three-form × two-direction test matrix is green; full suite green.
