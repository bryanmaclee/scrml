# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is the CWD that `pwd` reports at startup.

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. Output MUST start with
   `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If the path is
   under any other repo (e.g. `scrml-support/.claude/worktrees/` or a `scrml-spa-*`
   sibling), STOP and report — that is the S90 CWD-routing failure mode. Save the
   output as your WORKTREE_ROOT for the rest of the dispatch.
2. Run `git rev-parse --show-toplevel` via Bash. Output MUST equal WORKTREE_ROOT.
3. Run `git rev-parse --abbrev-ref HEAD` and `git rev-parse --short HEAD`. Note them
   (base should be `c734ec35` or a descendant). Run `git status --short` — confirm clean.
4. Run `bun install` via Bash. Worktrees do NOT inherit `node_modules`; the
   pre-commit hook's `bun test` fails with "cannot find package 'acorn'" otherwise.
5. Run `bun run pretest` via Bash — populates `samples/compilation-tests/dist/`
   that the browser-test suite loads (gitignored; empty in a fresh worktree). For
   baseline checks use `bun run test` (chains pretest), NOT `bun test` directly.

If ANY check fails: DO NOT proceed. Report the mismatch and exit.

## Path discipline (enforce on EVERY edit)

- **Apply ALL file edits via Bash** (`perl -0pi`/`python3`/heredoc/`cp`) on
  ABSOLUTE paths under WORKTREE_ROOT that include the `.claude/worktrees/agent-<id>/`
  segment — NOT the Edit/Write tools (S126 Edit/Bash filesystem-divergence class).
  Echo the target path before each write; re-verify with `git diff`/`grep` after.
- NEVER use absolute paths starting with the main repo root
  (`/home/bryan-maclee/scrmlMaster/scrml/compiler/...` without the worktrees segment) —
  that leaks into main's working tree.
- NEVER `cd` into the main repo (or anywhere outside WORKTREE_ROOT). Use
  `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, and worktree-absolute
  paths exclusively — for compile/run commands too, not just edits.
- If context references a main-rooted path, translate to `$WORKTREE_ROOT/...` first.

## Commit discipline

- Commit after each meaningful unit; WIP commits expected. Update
  `docs/changes/ss2-engine-boot-effect-invalid-transition-2026-06-19/progress.md`
  after each step (append-only, timestamped).
- Coupled code+test changes land in ONE commit (no transiently-red window).
- `git status` clean before you report DONE.
- NEVER `--no-verify`. The pre-commit hook (`bun test`, browser-excluded) gates each commit.

---

# TASK — ss2 item 1: wire §51.0.H Form-3 opener-effect write-validation

## What this is

Activate the DEFERRED compile-time check that an engine **opener `effect=`** (boot-only
init effect, §51.0.H Form 3) write to the engine variable is legal vs `.<initial>.rule`.
Today the opener effect is captured as RAW TEXT and the write-vs-rule check is unwired,
so an illegal boot transition compiles silently. This is an unimplemented NORMATIVE
SHALL, not new behavior.

## SPEC (normative — verified, do not re-derive)

- **SPEC.md §51.0.H Form 3, lines 25741-25745** (verbatim): *"Writes are statically
  checked. The from-state of the implicit edge is statically the `initial=` variant, so
  a `@<engineVar> = .X` write inside the opener `effect=` is compile-time-validated
  against `.<initial>.rule` exactly as an in-state-child-body write is (§51.0.F)."*
- **SPEC.md engine attribute table, line 24871**: opener `effect=` — *"Writes to the
  engine variable inside it are checked against `.<initial>.rule`."*
- The diagnostic code is the EXISTING **`E-ENGINE-INVALID-TRANSITION`** (§34 catalog).
  Do NOT mint a new code.

## Landing site — SYM, NOT type-system.ts

`compiler/src/symbol-table.ts`, function **`validateEngineA5Extensions`** (~line 9259,
PASS 16; called on the runSYM path at ~9762). DO NOT land this in type-system.ts —
the test (`engine-opener-effect-c1.test.js` §3) drives it through `runSYM` ONLY
(`symErrorCodes` helper, ~line 54), so the check MUST fire at the SYM stage.

Add a NEW once-per-engine fire-site (call it **fire-site #11 — opener-effect boot write**).
Place it at engine scope (NOT inside the per-state-child `for (const sc of stateChildren)`
loop) — e.g. immediately AFTER that loop, where `meta`, `stateChildren`, `variants`,
`variantSet`, `forType` are all in scope.

## Implementation — reuse the existing machinery (do not invent)

The exact extraction helper and membership-switch already exist in this file:

1. **Guards** (skip silently if any fails):
   - `meta.derivedExpr === null` — derived engines already fire `E-ENGINE-EFFECT-ON-DERIVED`
     for the opener effect (at ~line 7540); do NOT double-fire / do not boot-validate them.
   - `typeof meta.openerEffect === "string" && meta.openerEffect.length > 0`.
   - `varName.length > 0` (the existing `const varName = ... meta.varName` shape) and
     `variants.length > 0`.
   - `typeof meta.initialVariant === "string" && meta.initialVariant.length > 0`.
2. **Find the initial state-child**:
   `const initialSc = stateChildren.find(sc => sc && sc.tag === meta.initialVariant);`
   If not found, skip (a separate `E-ENGINE-INITIAL-INVALID-VARIANT` already fires).
   `const r = initialSc.rule;` — if falsy, skip.
3. **Extract boot writes** (REUSE the existing helper — it already scans raw text for
   `@varName = .Variant` and `@varName.advance(.Variant)`):
   `const writes = scanDirectWritesInStateChildBody(meta.openerEffect, varName);`
4. For each `dw` of `writes`:
   - Skip if `!variantSet.has(dw.target)` (non-variant tokens like `.length`; a separate
     check owns those — mirror fire-site #9's `variantSet.has` gate).
   - Skip if `dw.target === meta.initialVariant` (self-write to the boot/initial variant
     is an idempotent no-op per §51.0.F — mirror fire-site #10's self-write skip; keep it
     a plain skip, no new lint needed for this dispatch).
   - Otherwise run the SAME `switch (r.kind)` membership check as **fire-site #9
     (lines 9661-9719)**:
     - `absent`  → fire (initial state is terminal — no legal boot transition).
     - `wildcard`→ legal; do nothing.
     - `single`  → fire iff `r.target !== dw.target`.
     - `multi`   → fire iff `!r.targets.includes(dw.target)`.
     - `legacy-arrow` / `parse-error` → skip (B15 already fired).
   - Fire via `fireA5Diagnostic(errors, "E-ENGINE-INVALID-TRANSITION", <msg>, engineDecl,
     filePath, "error")`.
5. **Message** — mirror fire-site #9's framing but name the BOOT context. Shape:
   `` `E-ENGINE-INVALID-TRANSITION: `@${varName} = .${dw.target}` inside the engine opener `effect=` (boot-only init effect, §51.0.H Form 3) is invalid. The boot effect runs as the implicit init→.${meta.initialVariant} transition, so writes are checked against `.${meta.initialVariant}.rule` ` `` + (the single/multi/absent-specific permitted-targets clause + resolution hint, mirroring fire-site #9's wording). Use `.advance(...)` framing when `dw.shape === "advance"`.

### Why the flagship does NOT false-fire (do not break it)
`FLAGSHIP_SRC` (the §2/§4 happy-path) boot effect writes
`@phase = @tasks.length == 0 ? .Empty : .Editing` — a TERNARY whose RHS does NOT begin
with `.`, so `scanDirectWritesInStateChildBody`'s `@varName\s*=\s*\.(Variant)` regex does
NOT capture it → no fire. (And `.Empty`/`.Editing` are in `.Loading.rule` anyway.) Your
change MUST keep all of §1/§2/§4 green. The heuristic boundary — only writes whose RHS
*starts* with a literal `.Variant` (or `.advance(.Variant)`) are validated — is the
intended scope for this dispatch (matches the existing fire-site #9 state-child behavior;
broader RHS-expression analysis is out of scope).

## Test — un-skip + extend

In `compiler/tests/unit/engine-opener-effect-c1.test.js`:
1. **Un-skip line 242**: `test.skip(...)` → `test(...)`. Its body already asserts the
   illegal `@phase = .Saved` (`.Saved ∉ .Loading rule=.Empty`) fires
   `/INVALID-TRANSITION|ENGINE-INVALID/`.
2. Add to the §3 describe block (or a sibling describe):
   - **legal boot write passes**: `effect=${ @phase = .Empty }` with `<Loading rule=.Empty>`
     → `symErrorCodes` does NOT contain `E-ENGINE-INVALID-TRANSITION`.
   - **multi-target initial rule, legal target**: `<Loading rule=(.Empty | .Editing)>`,
     `effect=${ @phase = .Editing }` → no fire.
   - **multi-target initial rule, illegal target**: same, `effect=${ @phase = .Saved }`
     (with `.Saved` a real variant) → fires.
   - **self-write no-op**: `initial=.Loading`, `effect=${ @phase = .Loading }` → NO fire.
   - **derived engine still only fires E-ENGINE-EFFECT-ON-DERIVED** (no crash / no
     boot-write double-fire) for a derived opener effect.
   These are coupled with the code → ONE commit.

## VERIFICATION (R26 empirical — required before DONE)

1. `bun test compiler/tests/unit/engine-opener-effect-c1.test.js` — ALL green, including
   the newly-active §3 and your new cases. Paste the run summary.
2. **Full `bun run test`** (incl. browser) — 0 regressions. If a corpus/fixture/example
   file with an opener `effect=` now newly errors, that is potentially a REAL illegal
   boot write being surfaced — DO NOT suppress. Per R26, verify by hand whether the
   flagged write is genuinely illegal (target ∉ initial rule). If genuinely illegal,
   report it in your deliverable as a surfaced corpus bug (the sPA escalates to the PA);
   if it is a FALSE-FIRE (e.g. a write the heuristic mis-captures), that is a bug in your
   implementation — fix it. Distinguish the two explicitly.
3. Re-baseline any test whose engine-diagnostic counts legitimately shift; note each
   old→new in progress.md (within-node re-baseline; flag every count you change).

## DELIVERABLE

Report: files changed (line ranges), the verification gate outputs verbatim (the
unit-test run + the full `bun run test` summary pass/skip/fail), every baseline you
re-based with old→new numbers, any surfaced corpus illegal-boot-write (file + the write +
your legality reasoning), and your HEAD SHA + branch name. Commit everything to your
worktree branch; leave `git status` clean. I (the sPA) will file-delta your changed files
onto `spa/ss2`.

Do NOT push. Do NOT touch main. Do NOT land in type-system.ts.
