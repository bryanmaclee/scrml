# Native engine-decl: share ONE instance across nodes + machineDecls (the §51.0 substrate-drop fix)

**Dispatch:** S163, 2026-06-04. **Agent:** scrml-js-codegen-engineer. **Model:** opus. **Isolation:** worktree.
**Change-id:** native-engine-machinedecls-instance-share-2026-06-04.

## The bug (root-caused — do NOT re-survey; full trace in the survey below)

Under `--parser=scrml-native`, engine-bearing files silently DROP the entire §51.0 engine substrate (transition table, §51.0.F `_scrml_engine_direct_set` rule-validation, §51.0.C var-init, §51.0.D mount/body-render) — they compile clean but emit `<engine>` as a dumb reactive cell (`_scrml_reactive_set`). Affects EVERY engine file under native (the dominant native-parser-swap silent miscompile).

**Root cause (empirically proven — `docs/changes/native-engine-substrate-bridge-survey-2026-06-04/SURVEY.md`):** native synthesizes **two distinct `engine-decl` objects** — one in `FileAST.nodes` (`parse-file.js:584 synthEngineNode`, from `mapOneBlock`) and a SEPARATE one in `FileAST.machineDecls` (`collect-hoisted.js:132` calls `synthEngineDecl` AGAIN). SYM stamps `_record`/`engineMeta` onto the `nodes` copy ONLY. Codegen's `collectC12EngineDecls` (`emit-engine.ts:285`) reads `machineDecls`-FIRST → the un-stamped copy → `isC12EngineDecl` (`emit-engine.ts:265-274`, gates on `node._record?.engineMeta`) returns false → engine out of codegen scope → substrate dropped. Live shares ONE instance (`ast-builder.js:13616 machineDecls.push(node)` — same object in both arrays), so SYM's stamp is visible to codegen.

## The fix — size S, ONE cohesive change

Make the native pipeline put the **SAME** engine-decl instance into both `FileAST.nodes` and `FileAST.machineDecls`, mirroring live `ast-builder.js:13616 machineDecls.push(node)`.

**Recommended shape (i) — verify it's the cleanest against current source:** have `parse-file.js` build `machineDecls` from the already-mapped `nodes` engine-decl instances (the objects produced by `synthEngineNode`/`mapOneBlock`), and DELETE/neuter the duplicate `synthEngineDecl` call in `collect-hoisted.js:132` (or have it return/reference the shared node rather than synthesizing a second object). The result: `fileAST.nodes`-engine-decl === the corresponding `fileAST.machineDecls` entry (object identity), exactly as live.

- **Touch:** `compiler/native-parser/parse-file.js` (the assembly seam ~L166-185 where `machineDecls: hoisted.machineDecls` is set + the engine branch in `mapOneBlock`), `compiler/native-parser/collect-hoisted.js` (the L132 synthEngineDecl push). ~20-40 lines net.
- **Fix the misleading comment** at `parse-file.js:575-583` — it currently claims the two-instance shape "matches the live pipeline" (WRONG) and even names this fix ("a deep follow-up could share ONE node instance"). Replace it with the corrected truth (live shares one instance; this fix now does too).
- **Nested engines:** the `bodyChildren` recursion exists on both sides — ensure nested engine-decls are ALSO shared-instance (don't fix only top-level).

This is NOT the S162 each/match structural-promotion pattern (that added a new node kind). The engine node kind already exists + is correctly shaped — this is pure instance-sharing / hoist-collection.

## SCOPE — tightly bounded

- **IN scope:** the instance-sharing fix ONLY. The §51.0 substrate (transition table + `_scrml_engine_direct_set` + var-init + mount/body-render) for basic + transition-validated engines.
- **OUT of scope (separate follow-up dispatches — do NOT fix here):** B2 (§51.0.S `accepts=` message-arm parser — native synthEngineDecl has zero accepts handling + `native-walker/engine-statechild-walker.ts:516` hard-codes `messageArms: []`); `effect=` opener (§51.0.H Form 3 `openerEffect` — not read by native synthEngineDecl). Do NOT touch these.
- **Verification sweep is REPORT-ONLY, not fix-all:** after the primary fix, byte-compare a SPREAD of engine files under native vs default and REPORT which sub-features recover vs still diverge — `engine-modern-001-basic` (basic), `engine-009-hierarchy-basic` (nested), `engine-005-ontimeout-basic`, `engine-008-onidle-watchdog`, `engine-010-history`, `engine-modern-002-effects`, and a derived-engine sample if present. Report the per-file native-vs-default substrate parity (recovered / still-diverges + which feature). Do NOT chase per-feature fixes — just report so the PA can scope the follow-up sweep.

## MANDATORY VERIFICATION (R26 — byte-compare, NOT fatal-error-absence)

The prior survey fell for the S139 "compiles clean ≠ correct" trap. You MUST byte-compare emitted output:
1. Compile `samples/compilation-tests/engine-modern-001-basic.scrml` + `examples/14-mario-state-machine.scrml` under native (absolute worktree paths) AND default. `diff` the `*.client.js`.
2. **Confirm native now emits, identical to default:** the `__scrml_engine_<var>_transitions` table, the §51.0.C var-init (`_scrml_reactive_set("phaseTag","Idle")` / engine var), the §51.0.F transition writes as `_scrml_engine_direct_set(...)` (NOT plain `_scrml_reactive_set`), and the mount/body-render. The `_scrml_engine_` occurrence count in native client.js must MATCH default (was 0 vs 7 for engine-modern-001).
3. `node --check` the emitted JS (exit 0).
4. Run the relevant default-pipeline test subset — 0 regressions.
5. **Within-node parity canary:** this changes the native FileAST machineDecls shape; the within-node parity test may shift. Run it. If it trips, investigate — a BENIGN shift (native machineDecls now matches live more closely) needs a rebump with rationale; a real regression must be fixed. Report what you find.
6. **Parse-file structural canary:** the survey notes nodes/machineDecls engine ids become equal after the fix (was 20 vs 43). The canary "counts nodes, never compares ids" — confirm it still passes.
7. **Add a positive test:** compile an engine under native, assert the emitted JS contains `__scrml_engine_<var>_transitions` + `_scrml_engine_direct_set` (i.e. the substrate is present + identical to default). A behavior fix WITHOUT a test is the S140/S152 blind-spot trap.

DO NOT mark DONE without steps 2 + 5 passing (the substrate present byte-identical + the parity canary dispositioned).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full. The "Native-Parser File Table" (structure.map.md) + "Codegen each/match/engine Emit Map" (domain.map.md) name the loci. Maps reflect HEAD `e6782917` (2026-06-04). NB the maps frame this bug as F1 arm-body-parse (E-UNQUOTED-DISPLAY-TEXT) — that is INACCURATE for this defect (the true cause is the machineDecls two-instance identity); treat the F1 framing as superseded by the survey. Report: "Maps consulted: [list]; load-bearing finding: <one sentence>" OR "not load-bearing."

## STARTUP + PATH DISCIPLINE (isolation: worktree)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-`. If under another repo, STOP (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. **S112 merge-startup:** `git -C "$WORKTREE_ROOT" merge --ff-only main 2>/dev/null || git -C "$WORKTREE_ROOT" merge main` (worktree base is behind current main `e6782917`+). Confirm clean.
4. `bun install`. 5. `bun run pretest`. 6. Baseline green.
If ANY check fails: STOP.

**Path discipline (S99/S126):** edit via Bash on worktree-ABSOLUTE paths (incl. the `.claude/worktrees/agent-<id>/` segment) — `perl`/`python`/heredoc, NOT Edit/Write (the S100 hook rejects Edit/Write resolving into MAIN). Echo the target before each write; re-verify via `git -C "$WORKTREE_ROOT" diff`. **NEVER `cd` into main** — use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths.

## COMMIT DISCIPLINE + CRASH RECOVERY
- Commit after EACH meaningful change (don't batch). FIRST commit message includes verbatim `pwd` (S99): `WIP(engine-instance): start at <pwd>`. Code + coupled test = ONE commit.
- Before DONE: `git -C "$WORKTREE_ROOT" status` clean. "work in worktree, no commits" is NOT acceptable.
- Update `docs/changes/native-engine-machinedecls-instance-share-2026-06-04/progress.md` (in your worktree) after each step — append-only, timestamped.

## FINAL REPORT
WORKTREE_PATH, FINAL_SHA, FILES_TOUCHED, the exact fix (which file/function, the instance-sharing shape), the R26 byte-compare results (step 2 — the substrate-present grep/diff output for engine-modern-001 + mario), within-node parity disposition (step 5), the per-file verification-sweep table (step 6 of scope — which engine sub-features recover vs still diverge), test deltas, deferred items (B2 + effect= confirmed untouched), maps-feedback line.
