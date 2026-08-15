# BRIEF — derived-transitive fix round 5 (S345-bryan dispatch)

DONE-PROBE: git rev-parse --verify --quiet refs/remotes/origin/dtr-r5 >/dev/null 2>&1

## Context
The S239 review of round 4 (frozen `review/derived-transitive-r4` = `4b3f36f0`) returned
**DO-NOT-LAND**: 6/6 lenses completed (coverage guard satisfied), **10 blockers**, each
dual-verified by execution. Work order (full claims + executed repros + verifier evidence):
`/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/d127780a-7268-4bd1-bd32-5e2af33ebefb/scratchpad/dtr-r5/WORK-ORDER.json`
Read it IN FULL first (parse with node; extract per-blocker).

**Round 4 DID make real progress** — the r3 alias blockers (`let f = doHash`,
`let api = {run: doHash}`, `const g = (p) => doHash(p)`) are confirmed FIXED. Do not
regress them; pin them if not already pinned.

## The root problem: round 4 added a NORMATIVE CLAIM that is measurably false
Round 4 ADDED (it is not pre-arc text) a justifying sentence, asserted in FOUR places:
- `compiler/SPEC.md:3724` — "Codegen does not rename references to a server-only import — the
  emitted JS honours the local binder — so route inference's suppression and the emitted program
  agree here."
- `compiler/SPEC.md:19572` (the §34 catalog row parenthetical) — same claim
- `compiler/src/route-inference.ts:3744` and `:3821` — same claim in code comments

**It is false in the load-bearing direction.** Codegen honours the shadow for the CALL but NOT for
the import EMISSION. Executed proof (in the work order): the SPEC's own blessed shadow shape
compiles **exit 0, zero diagnostics**, emits **no `.server.js`**, puts
`const { hashPassword } = _scrml_stdlib.auth;` in the client bundle, and the runtime the HTML loads
carries **4 hits of `Bun.password` / argon2id**. A differential control (same file, shadowed name
renamed) is clean on every axis — so the shadowed reference is what pulls the module in.

This is the same shape that made round 3 blocking (a false "already refused via 5b" comment), now
re-asserted on the other limb.

## MANDATORY for round 5

1. **STRIKE the false claim at all four sites.** Do not soften it — it is false, not imprecise. The
   direct-limb shadow suppression does NOT agree with emission.
2. **REMOVE the transitive limb's params-only carve-out.** The review proved codegen renames the
   PARAMETER ITSELF to the fetch stub, so the arc's own bite-test shape binds an async recompute
   and renders a Promise at exit 0. The carve-out is exactly where RI and codegen disagree. Per the
   arc's own recorded rule (a too-wide shadow set is a SILENT MISS and forbidden; a too-narrow one
   is a LOUD, fixable over-fire), the transitive limb suppresses on **NOTHING**. Newly-rejecting →
   run the corpus direction-of-change differential and REPORT the count; a non-zero count is a
   finding to report, never something to self-ratify past.
3. **FIX `§11l` — the test that RATIFIES the miscompile.** Its "BITE — a hop caller's own PARAM
   still suppresses" pin asserts the exact silent-miscompile class this arc exists to close, and its
   oracle is RI-only (conformance §6 is deliberately not pointed at that shape). Flip it to the new
   semantics AND point an executed-artifact assertion at it.
4. **FIX the provenance citation.** The §6.6.19 provenance line attributes the round-4 SHADOW
   SEMANTICS to `ruling:user-voice-scrml.md S345`. **S345 does not contain that ruling** — bryan
   ruled the F3 lambda-param rewrite descriptive-not-ratified; he did NOT rule shadow semantics.
   Cite the honest kind (`rationale:` for an author's stated reason) and keep the S345 citation
   ONLY for what he actually ruled.
5. **RESOLVE the §6.6.19 internal contradiction** the spec lens found: the unscoped "any depth …
   including inside an RHS that does not structurally parse" statement vs the limb-scoped raw-text
   carve-out. One of them is wrong; make the text self-consistent and true against the compiler.
6. **RE-VERIFY every residual by COMPILING the shape it describes.** A residual that misdescribes
   behaviour is a defect; the review found one already.

## Explicitly OUT OF SCOPE (report, do not build)
- **The DIRECT-limb leak itself is PRE-EXISTING** (codegen untouched by this arc — verify:
  `git diff 23ea2e5c..HEAD --stat` shows `route-inference.ts` as the only src file). Round 5 must
  remove the FALSE CLAIM about it; FIXING the leak is its own arc with its own ruling and migration.
  Restate it in your final report with the executed reproducer so the PA can file it as a HIGH gap
  (it is currently filed only as RELAYED-NOT-PA-VERIFIED and is now SETTLED).
- Lexical scoping (ruled S345 Q1(c), QUEUED as its own conformance-restoration arc). Its constraint
  stands: the reference scanner AND codegen's renamer must move together.
- Do NOT touch `docs/known-gaps.md` (PA-owned this session).

## Mechanics (CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE)
- isolation: worktree. FIRST: `pwd` must start with
  `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`; toplevel equals it; clean tree.
  Any failure: STOP + report. Then `bun install`, then `git checkout -b dtr-r5 4b3f36f0`.
- Edit via Edit/Write on worktree-absolute paths only; NEVER write to the main checkout. Echo pwd in
  the first commit message. Commit after each unit (WIP fine); append-only `progress.md`;
  NEVER `--no-verify`; commit timeout ≥ 8 min (the hook runs the full gated subset).
- `git push -u origin dtr-r5` after the first substantive commit AND at the end.
- Gates before DONE: all arc pins green; contract gate (unit+integration+conformance) 0 fail;
  direction-of-change differential RUN with counts reported; executed-artifact checks pass.

## Final report
FINAL_SHA · branch · files touched · which blockers fixed vs deferred (with reasons) · the
direction-of-change counts (+ newly-rejecting file list if non-zero) · the pre-existing direct-limb
leak restated with its reproducer · whether any review-asserted locus was wrong.
