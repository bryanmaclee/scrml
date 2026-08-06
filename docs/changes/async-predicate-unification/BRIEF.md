# Limb 1 — one async-name provider for three consumers

**Dispatched S322-bryan 2026-08-05.** Authority: bryan, this session — *"fire limb 1."*
Scope: `docs/changes/async-predicate-unification/SCOPING.md` (read it — it carries a correction to the
DD that recommended this work). Origin: `dpa-023`
(`scrml-support/docs/deep-dives/async-boundary-as-state-lifecycle-2026-08-05.md`, ADVISORY).

## The defect, in one sentence

Three consumers ask *"is this name async in client mode?"* and get different answers for a **client
server fn**, because the provider they should share treats server fns as a **seed trigger** and never
admits them to its own result set.

## Verified loci — PA-read this session, but RE-DERIVE before editing

| # | consumer / provider | locus | answer for a client server fn |
|---|---|---|---|
| 1 | `isClientServerFnCall` | `compiler/src/codegen/emit-expr.ts:1736` | **INCLUDES** |
| 2 | `combinatorIsAsyncName` | `compiler/src/codegen/emit-expr.ts:1630` | **INCLUDES** (since U1's F2) |
| 3 | `isAsyncName` | **NOT a function** — an injected callback parameter, `compiler/src/codegen/async-combinators.ts:93` | **EXCLUDES** |
| — | `computeAsyncFnNames` (provider for #3) | `compiler/src/codegen/emit-library-shared.ts:148` | seeds the CALLER, never the callee |

**The DD called these "three predicates." That framing is wrong and the correction changes the work.**
#3 is a *parameter*; its source of truth is `computeAsyncFnNames` (confirmed by `emit-tool.ts:378`'s own
comment). **You are not merging three functions — you are giving ONE provider to THREE consumers.**

**The mechanism (verified):** `computeAsyncFnNames` marks a fn async when
`callsServerFn(callees)` is true — that colors the **caller**. It never adds the server fn's own name to
`async`. So a consumer asking *"is `loadRows` async?"* gets **no** from the drain and **yes** from the
emitter, for the same name, in the same compilation.

## The job

Land ONE exported predicate with ONE source of truth, and route all three consumers through it.
Deleting code is a success condition here — this is a **subtraction**.

## ⚠ This will almost certainly change emit. That is the interesting part, not a problem to hide.

Widening the drain's answer means `async-combinators.ts` will start transforming combinator call sites
it previously left alone (that is exactly what U1's F2 did for `combinatorIsAsyncName`, and F2 changed
real output). **Expect a non-empty artifact differential.** Your job is to make every difference
*explicable*, not to make it zero.

**Direction-of-change classification is MANDATORY** per `pa-base` §8 — label the landing
`inert` / `newly-rejecting` / `newly-accepting` / `semantics-changed`, per class, with the reasoning.
A newly-**accepting** result is a one-way door and needs the governing sentence quoted or it becomes a
RULING, not a fix. A newly-**rejecting** result owes a **measured** migration — grep the corpus, report
the count and the files. Assumed-zero is not measured-zero.

## THE GATE — use the harness; this is its first real job

`scripts/corpus-emit-differential.ts` landed this session (#428) precisely for this class of change.
Do NOT hand-roll a corpus script; the last three attempts each measured a fraction of their population.

```
bun scripts/corpus-emit-differential.ts capture --compiler-root <base-checkout> \
    --label base --work <w>/base --manifest <w>/base.json --expect-total <N>
bun scripts/corpus-emit-differential.ts capture --compiler-root <your-worktree> \
    --label head --work <w>/head --manifest <w>/head.json --expect-total <N>
bun scripts/corpus-emit-differential.ts diff --base <w>/base.json --head <w>/head.json
```

Report, from the tool's own output — do not paraphrase:

- sources enumerated per side (both must match `--expect-total`; a mismatch ABORTS, that is intended)
- compile-outcome SET delta, diagnostic delta
- **every** differing artifact, grouped by source, each with a one-line reading of *why*
- **syntax delta under EFFECTIVE, SCRIPT and MODULE goggles.** The script goggle is not optional: a
  top-level stranded `await` passes `node --check` and is a hard `SyntaxError` in the classic
  `<script>` the compiler actually emits.
- **the bare client server-fn call-site count.** Baseline is **142** in cleanly-compiling sources.
  If your change moves that number, say by how much and which sources — it is the closest thing we
  have to a direct measure of whether async classification actually improved.

## HARD CONSTRAINTS

1. **Do NOT touch the whole-buffer name mangler** (`emit-client.ts:2947–2966`, `combinedRegex` +
   `fnNameMap`). That is **Limb 2**, deliberately separate and much larger. If Limb 1 seems to need it,
   **STOP and report**.
2. **Do NOT build another injector.** dpa-020's standing instruction. This is a subtraction.
3. **Do NOT fix U1's remaining scope** (the 142 bare sites). Measuring the number is in scope; closing
   it is not.
4. **Do NOT implement the `pending` rung.** That is the next item and it is unratified.
5. **Never bypass the commit gate** (`--no-verify`). Batch commits if the hook is slow; come back for
   authorization rather than working around it.

## MAPS — REQUIRED FIRST READ, and the map is STALE for exactly your surface

Read `.claude/maps/primary.map.md` first and follow its Task-Shape Routing (codegen). **Stamp:
`15e5e070`. HEAD is `27eba1aa`.** Every file you are touching has landed since that stamp — treat the
map as a hypothesis and verify against source. Post-map codegen landings you MUST factor in:

- **#429 (U1)** — `emit-expr.ts` · `emit-client.ts` · `emit-control-flow.ts` · `emit-functions.ts` ·
  `emit-logic.ts` · `scheduling.ts`. **This is the landing that created predicate #2's current shape.**
  Read `docs/changes/u1-emitcall-client-serverfn-await/progress.md` — its rounds 2–3 section is the
  most accurate account of this surface that exists.
- **#417** — `emit-logic.ts` · `emit-reactive-wiring.ts` · `reactive-deps.ts`
- **#416** — `emit-each.ts` · **#435** — `emit-server.ts`

Report whether the maps were load-bearing. "Not load-bearing" is a valid and useful answer.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

1. First action: `pwd` — MUST start with
   `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Confirm
   `git rev-parse --show-toplevel` equals it and the tree is clean. Any failure → **STOP and report**.
2. `bun install` (a fresh worktree does not inherit `node_modules`; the hook fails on missing `acorn`).
   Then `bun run pretest`.
3. Every Read/Write/Edit uses an **absolute path under your worktree root**. A relative path resolves
   against the main checkout and leaks.
4. **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`.
   A sibling `cd` persists and silently makes every later command answer about the wrong repository —
   this bit the PA three times in one session.
5. Echo the startup pwd in your first commit message.

## CRASH RECOVERY

Commit after each meaningful unit — WIP commits are expected. Keep an append-only, timestamped
`progress.md` in `docs/changes/async-predicate-unification/`. The branch plus that log are all a
successor gets. **A prior agent on this arc stalled mid-task**; assume you can too, and make the branch
the anchor rather than your context.

## Report

Files touched · what the unified provider is and where it lives · the direction-of-change label with
reasoning · the full harness output · the bare-call-site delta · anything you could not do and why. If
the change turns out materially larger than scoped, **STOP and report** rather than widening.
