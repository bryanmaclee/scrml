# BRIEF — s427-lift-body-lowering: two lift-block lowering defects that compile at exit 0 and kill the page at boot

change-id: `s427-lift-body-lowering` · dispatched S427 (peter / P-Tech1, Windows) · base: `origin/main` @ b497b892 (includes #1021 + #1022)
Gap: `g-lift-body-assignment-lowered-to-const-and-destructured-const-invisible-to-keyed-setup` (HIGH) in `docs/known-gaps.md` — read it, including its S427 PA-verification banner.

## 0. Startup (mandatory, in order)
1. `pwd` MUST be your worktree (`.../scrml/.claude/worktrees/agent-...`); `git merge-base HEAD origin/main` == `git rev-parse origin/main`; clean tree. Else STOP and report.
2. `PUPPETEER_SKIP_DOWNLOAD=1 bun install`; then `bun run pretest` plainly from the worktree CWD (never `bun --cwd <path> run`); verify `samples/compilation-tests/dist/` exists.
3. `git fetch origin brief/s427-lift-body-lowering` then `git checkout FETCH_HEAD -- docs/changes/s427-lift-body-lowering/`; commit `WIP(s427-lift-body-lowering): start at <pwd>`.
4. Baselines: unit + conformance, top-level `compiler/tests/*.test.js`, e2e-render-map — record counts.
5. NEVER `git stash`; NEVER `pkill -f` a shared string; Edit/Write on worktree-absolute paths only; commit after each meaningful change; append timestamped lines to `docs/changes/s427-lift-body-lowering/progress.md`.

## 1. The defects (PA-reproduced on b016352d at TOP LEVEL, no `if=`; re-reproduce on your base first)
- `repro-counter.scrml`: `${ let n = 0; for (let it of @items) { n = n + 1; lift <li>${n}:${it}</li> } }` inside `<ul>` — compiles exit 0; emits `const n = n + 1;` → at boot `ReferenceError: Cannot access 'n' before initialization`; the whole page is dead.
- `repro-destructure.scrml`: `${ const { prefix, suffix } = @cfg; for (let it of @items) { lift <li>${prefix}${it.name}${suffix}</li> } }` — compiles exit 0; at boot `ReferenceError: prefix is not defined` (reported as: the keyed-list setup the compiler hoists outside the effect cannot see the destructured names); the whole page is dead.

## 2. Governing sentences (Rule 4 gate) — FIRST, before any fix
- Counter: an assignment to an existing `let` binding is an assignment, not a declaration (§7 logic contexts; §50 assignment-as-expression; the JS-subset bound). Quote what you find.
- Destructuring: determine from SPEC whether a destructuring `const { a, b } = expr` declaration is part of the scrml logic-context language at all. **If SPEC admits it** → the fix makes it work. **If SPEC is silent or excludes it** → the correct fix is a compile-time DIAGNOSTIC (an existing code if one fits; if none fits, STOP and report — minting a code is a language decision for bryan), NOT making it work. Report the sentence either way.
- A clean compile that ships a dead page is wrong under every reading; the only question is render-vs-reject.

## 3. Locus (PA-located-verify, not traced)
The lift-group lowering in `compiler/src/codegen/emit-reactive-wiring.ts` (Step 4b) and whatever lowers a lift loop body's statements (search for where an assignment statement in a `for … lift` body is re-emitted as `const`); the keyed-list setup hoist that is emitted outside the per-group effect. Trace from the AST node to the emitted `const n = n + 1` and state the path.

## 4. Required outcome — FIX THE CLASS
- Enumerate first: every statement kind that can appear inside a lift loop body or a lift block (assignment `=`, compound `+=`/`-=`/`++`, `let` redeclare, destructuring object/array, nested destructuring, a `let` declared before the loop and mutated inside, mutated inside a nested block/if) × the lift-group paths (non-reactive, keyed-reconcile, effect-wrapped, and — since #1021/#1022 — the `if=`-mounted and each-row/arm nested variants). Table which lower correctly today and which do not.
- Fix every mis-lowering so the emitted JS has the same binding semantics as the source. The keyed-list setup must see every name the block declares before it (or the setup must move to where they are in scope) — whichever preserves render correctness on every path.
- Programs not using a mis-lowered shape emit byte-identically.

## 5. Tests
- Emitted-shape pins per fixed shape + behavioural pins that MOUNT the output (happy-dom): the page boots, rows render with the right counter/prefix, a reactive update re-renders correctly (counter restarts per render, destructured names follow `@cfg` changes), across the top-level, `if=`-mounted and each-row variants.

## 6. Gate — DO NOT report DONE without these
- unit + conformance + top-level + e2e-render-map green (counts vs baseline); `bun scripts/browser-baseline.ts --check` name set must not grow (the Windows-only `C:\C:\` ENOENT names are pre-existing on base).
- Full-corpus emit differential base b497b892 vs HEAD: every changed artifact must be a mis-lowered-shape site; anything else → STOP and report.
- `bun scripts/facts.ts --write` + `bun scripts/state.ts --write` (strip CR first if a regen chokes); include regenerated files.
- Mutation bite per fix; report numbers.

## 7. Report
Worktree · final SHA · files · traced path + locus held/refined/wrong · governing sentences + the render-vs-reject decision for destructuring · enumeration table · tests pre/post · differential summary · mutation numbers · anything newly found (with repro).

## MAPS
`.claude/maps/` is stale; hypotheses only. Test `.scrml` must be canonical scrml.
