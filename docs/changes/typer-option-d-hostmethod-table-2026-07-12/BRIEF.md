# BRIEF — typer Option-D: curated host-method return-type table (freeze-blocker)

**Change-id:** `typer-option-d-hostmethod-table-2026-07-12` · **Dispatched:** S252 · **Agent:** scrml-js-codegen-engineer (iso:worktree)
**Gap:** `g-typer-hostmethod-return-asis-and-anon-struct-poison` (MED, freeze-blocker) · **Base:** main @ `40b580c5`

## THE RULING AUTHORITY — read it IN FULL first
`../scrml-support/docs/deep-dives/typer-soundness-poison-2026-07-12.md` (346 L) is the ratified design (bryan S251).
It carries the option space, the Option-D fix, and the source line-refs. **Read it completely before any edit.**
Also verify against SPEC §48 (`fn`/cross-fn boundary) · §14.1.1 (`asIs` escape hatch, line ~7580) · §45 (equality).

## SCOPE — hostmethod-return-asis ONLY (the anon-struct half is a PROVEN misdiagnosis)
- **The root (build this):** the typer has NO host-method return-type model — every `x.method(...)` resolves to
  `asIs`, and `asIs` is a checking-DISABLED escape hatch (§14.1.1). So host-derived values silently satisfy type
  checks they should fail (E-EQ-001's guard exempts `asIs`; E-TYPE-025 lets a typed match through only for
  non-`asIs`). A host-method result flows through equality + match checks unchecked → **unsound-permissive**.
- **Option D = a CURATED invariant-return host-method table.** For the known-shape host methods (`charCodeAt`→int,
  `substring`/`slice`/`toUpperCase`/`toLowerCase`→string, `.length`→int, etc. — enumerate from the DD + the
  reactivity/string corpus the DD cites), the typer returns the KNOWN type instead of `asIs`; keep `asIs` as the
  narrowed SILENT fallback for un-tabled methods (do NOT error on unknown — that breaks the §14.1.1 hatch).
- **HARD-1 (do not miss):** `E-EQ-001`/GCP3 runs BEFORE type resolution (NR) — `api.js:1305-1314`. So the table must
  ALSO be mirrored on the GCP3 side (`gauntlet-phase3-eq-checks.js`) to close the equality silent-accept; a
  type-system-only table leaves the GCP3 equality path still blind. Build BOTH the type-system table + the GCP3 mirror.
- **F5 closes for free:** the loud `E-TYPE-025 "cannot match on asIs-typed subject"` on `const ch = c.source.substring(...)`
  disappears once `substring`→string is tabled. Confirm F5 closes; do NOT add a separate fix for it.
- **DO NOT** touch anon-struct-poison / F8 cross-fn — the DD proved it NON-REPRODUCIBLE on HEAD+base. Out of scope.
- Source loci (DD-cited): `compiler/src/type-system.ts` (member-call return-type resolution ~9721-9871; the call-result
  upgrade gated to `callee.kind==="ident"` — extend to member calls via the table) · `compiler/src/gauntlet-phase3-eq-checks.js`
  (~610, the E-EQ-001 `asIs` guard — the GCP3 mirror) · `compiler/src/expression-parser.ts` (~4369-4407 `classifyLiteralFromExprNode`).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full (~100 L) before other context; follow its Task-Shape Routing for a
compiler-source typer fix. Map currency: maps reflect HEAD `fbb4d9fd` as of 2026-07-09 — HEAD is `40b580c5`; treat
map content as a hypothesis to verify against current source (the typer has moved since). Report which maps were load-bearing.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (S99 has had path-leaks; this must not be the next)
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it's under scrml-support or
   anywhere else, STOP + report (the S90 CWD-routing failure). Save it as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT. 3. `git status --short` clean. 4. `bun install` (worktrees don't inherit node_modules).
5. `bun run pretest` (populates the gitignored `samples/compilation-tests/dist/` — else ~130 ECONNREFUSED). For baselines use `bun run test`.
- **Edits via Bash on WORKTREE_ROOT-absolute paths** (perl/python/heredoc), echo the path before each write, `git diff`/`grep` after.
  NEVER Edit/Write to a main-rooted path; NEVER `cd` into the main repo or anywhere (use `git -C "$WORKTREE_ROOT"`, `--cwd "$WORKTREE_ROOT"`).
- First commit message includes your `pwd`: `WIP(typer-option-d): start at $(pwd)`.

## DISCIPLINE
- **Incremental commits** (don't batch) + append to `docs/changes/typer-option-d-hostmethod-table-2026-07-12/progress.md` after each step. WIP commits expected. Your branch + progress.md = crash-recovery.
- **Coupled code+test = ONE commit** (no transiently-red window).
- **§34 rows land WITH the impl** (Rule 4) — if the fix introduces/changes any diagnostic, its §34 row lands in the same commit. (Option-D likely fires NO new code — it's a soundness-tightening; confirm.)
- **R26 empirical (mandatory — this is soundness-critical):** after the fix, recompile real adopter source (the reactivity/string-heavy `.scrml` the DD cites + `../scrml-support/docs/gauntlets/*` sources) and confirm: (a) `charCodeAt`/`substring` results now type as int/string (F5 match case compiles WITHOUT the `const ch: string =` workaround); (b) an equality between a tabled-host-method result and a mismatched type now fires `E-EQ-001` (was silent). Record the before/after in progress.md.
- **Conformance:** add case(s) under `conformance/cases/` pinning the tightened behavior (a host-method result satisfying/failing a type check). Follow `conformance/README.md`.
- **Gate:** full `bun run test` green before "DONE" (foreground; the pre-commit hook runs unit+integration+conformance). NEVER `--no-verify`.
- **Land on your branch; DO NOT push; DO NOT touch main.** When ready, ping the PA inbox `handOffs/incoming/` with: change-id · files touched · branch tip SHA · the R26 before/after · any residual. The PA runs the S239 adversarial review + re-integrates.
