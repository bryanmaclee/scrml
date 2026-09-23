# BRIEF — s427-lift-in-each-row: a `${ for … lift }` inside an `<each>` row (or an engine/match arm) emits no lift code at all

change-id: `s427-lift-in-each-row` · dispatched S427 (peter / P-Tech1, Windows) · base: `origin/main` @ b016352d (includes #1021, the if=-mount lift fix)
Gap: `g-lift-inside-each-row-or-match-arm-silently-dropped` (HIGH) in `docs/known-gaps.md` — read it, and read the resolved sibling `g-todomvc-benchmark-app-dead-on-arrival-lift-target-inside-template` + its S427 banner (the mechanism #1021 added is the nearest precedent).

## 0. Startup (mandatory, in order)
1. `pwd` MUST be your worktree (`.../scrml/.claude/worktrees/agent-...`); `git merge-base HEAD origin/main` == `git rev-parse origin/main`; clean tree. Else STOP and report.
2. `PUPPETEER_SKIP_DOWNLOAD=1 bun install`; then `bun run pretest` plainly from the worktree CWD (never `bun --cwd <path> run`) — verify `samples/compilation-tests/dist/` exists.
3. `git fetch origin brief/s427-lift-in-each-row` then `git checkout FETCH_HEAD -- docs/changes/s427-lift-in-each-row/`; commit `WIP(s427-lift-in-each-row): start at <pwd>`.
4. Baselines: `bun test compiler/tests/unit compiler/tests/conformance`, `bun test compiler/tests/*.test.js`, `bun test compiler/tests/e2e-render-map/` — record counts.
5. NEVER `git stash`; NEVER `pkill -f` a shared string (kill by captured PID); Edit/Write on worktree-absolute paths only; commit after each meaningful change; append timestamped lines to `docs/changes/s427-lift-in-each-row/progress.md`.

## 1. The defect (PA-reproduced on ccd94817; re-reproduce on b016352d first)
`docs/changes/s427-lift-in-each-row/repro-each-row.scrml`:
```
<groups> = [{ id: 1, items: ["a", "b"] }]
<div> <each in=@groups key=@.id as g> <ul class="g"> ${ for (let it of g.items) { lift <li class="row">${it}</li> } } </ul> </each> </div>
```
compiles at **exit 0**; the emitted client contains **zero** `_scrml_lift` occurrences — the rows are silently dropped. The S427 adversarial reviewer reproduced the same drop for a lift inside an engine / `<match>` arm (on base and head). No `if=` involved.

## 2. Governing sentence (Rule 4 gate) — quote it back in your report
§10.1 (SPEC.md ~7092): *"When `lift` appears in an anonymous `${}` block whose parent is a markup or style context, `lift` appends the value to the block's accumulator array. The accumulated array is coerced when the logic block exits, according to the parent context type (§10.2)."* An `<each>` row template (§17.7) and an engine/match arm body are markup. Read §17.7 and §18.0.1 / §51.0 arm-body rules too: if either section restricts `${}`/`lift` in those bodies (e.g. the §4.18 code-default body mode for arms), the answer for THAT locus may be a DIAGNOSTIC rather than rendering — in which case STOP for that locus and report the sentence; do not choose. A silent drop is wrong under every reading.

## 3. Locus (PA-located-verify — searched, not traced)
Candidates: `emit-reactive-wiring.ts` Step 4b groups lift statements by `_placeholderId` — a logic node inside an `<each>` row may never get one, or its group may be skipped; `emit-each.ts` (per-item render fn — does it emit logic-block children at all?); `emit-variant-guard.ts` (arm render). Trace from the AST node to where the lift disappears and state the path.

## 4. Required outcome — FIX THE CLASS
- Enumerate first: every container whose body is rendered by a per-instance render function rather than the static page body (each row, engine arm, match arm, component body instantiated per-use, nested each, each inside if=, if= inside each row…). For each, compile the repro shape and record whether a lift inside it renders. Table it.
- Fix every dropped locus so the lifted content renders inside the correct row/arm instance, re-renders when the row's data changes, and is torn down with the row (reconcile remove / arm switch). Each row instance must get its OWN target — two rows must not share or cross-bind.
- Where #1021's `lift-host` / `_scrml_lift_mount_<pid>` mechanism fits, REUSE it; if a per-row render needs a different mechanism, explain why by execution.
- Programs without a lift in these loci must emit byte-identically.

## 5. Tests
- Emitted-shape pins for each fixed locus.
- Behavioural pins that MOUNT the output (happy-dom): rows render inside the right `<ul>`; adding/removing/reordering items in the outer list keeps each row's lifted content correct; mutating the inner list re-renders only that row; engine arm switch renders/tears down; nested each; each inside if= with toggles.
- `bun test compiler/tests/e2e-render-map/` — report whether any corpus cell changes state.

## 6. Gate — DO NOT report DONE without these
- unit + conformance + top-level `compiler/tests/*.test.js` + e2e-render-map green (counts vs baseline).
- `bun scripts/browser-baseline.ts --check` — name set must not grow (the one Windows-only `g-if-attr-synth-cell-toggle` ENOENT on `C:\C:\` is pre-existing on base; say so if you see it).
- Emit differential over the whole corpus (examples, samples, benchmarks, conformance, stdlib) base b016352d vs your HEAD: list every changed artifact and show each is an intended lift site in a previously-dropping locus. Anything else = STOP and report.
- `bun scripts/facts.ts --write` and `bun scripts/state.ts --write` (strip CR first if a regen script chokes on CRLF); include regenerated files.
- Mutation bite per fix; report numbers.

## 7. Report
Worktree · final SHA · files · traced path + locus hypothesis held/refined/wrong · the enumeration table · governing sentences quoted (and any locus where the SPEC points to a diagnostic instead) · tests pre/post · e2e-render-map result · emit differential summary · mutation numbers · anything deferred or newly found (file-worthy, with repro).

## MAPS
`.claude/maps/` is stale; treat as hypotheses. Test `.scrml` must be canonical scrml (see `docs/articles/llm-kickstarter-v2-2026-05-04.md`).
