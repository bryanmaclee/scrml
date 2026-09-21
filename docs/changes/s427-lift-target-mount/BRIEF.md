# BRIEF — s427-lift-target-mount: a lift whose host sits inside a mount `<template>` binds `null` at top level

change-id: `s427-lift-target-mount` · dispatched S427 (peter / P-Tech1, Windows) · base: `origin/main` @ ccd94817
Gap: `g-todomvc-benchmark-app-dead-on-arrival-lift-target-inside-template` (HIGH) in `docs/known-gaps.md` — read it in full.
Sibling (resolved S400-peter, read its entry): `g-call-expression-interpolation-in-if-chain-branch-renders-empty` — the same class for STATIC-DISPLAY sites, fixed by stamping `insideMountTemplate` and routing through `pushRebindableDisplay`.

## 0. Startup (mandatory, in order)
1. `pwd` MUST be your worktree (`.../scrml/.claude/worktrees/agent-...`); `git merge-base HEAD origin/main` == `git rev-parse origin/main`; clean tree. Else STOP and report.
2. `PUPPETEER_SKIP_DOWNLOAD=1 bun install`, then `bun run pretest` run plainly from the worktree CWD (NOT `bun --cwd <path> run`, which silently no-ops) — verify it produced `samples/compilation-tests/dist/`.
3. `git fetch origin brief/s427-lift-target-mount` then `git checkout FETCH_HEAD -- docs/changes/s427-lift-target-mount/`; commit `WIP(s427-lift-target-mount): start at <pwd>`.
4. Baselines: `bun test compiler/tests/unit compiler/tests/conformance` and `bun test compiler/tests/e2e-render-map/` (expect 259/0) — record counts.
5. NEVER `git stash`; NEVER `pkill -f` a shared string; Edit/Write on worktree-absolute paths only; commit after each meaningful change; append timestamped lines to `docs/changes/s427-lift-target-mount/progress.md`. WIP commits expected.

## 1. The defect (PA-reproduced on HEAD ccd94817)
`bun compiler/bin/scrml.js compile benchmarks/todomvc/app.scrml --output-dir <tmp>` exits 0; the emitted client has
`const _scrml_lift_tgt_45 = document.querySelector('[data-scrml-logic="_scrml_logic_7"]')` followed by `_scrml_lift_tgt_45.innerHTML = ""`.
Loaded in happy-dom, that selector matches NOTHING at the document level and matches inside the `.content` of 1 of the page's `<template>` elements — `document.querySelector` does not descend into template content, so the bind is `null` and the next statement throws. The app renders zero rows.
Source shape (`benchmarks/todomvc/app.scrml:174-191`): a `${ for (…) { lift <li>…</li> } }` logic block inside `<ul>` inside `<section class="main" if=@todos.length>`. Since `cdf4f4de` (if= Phase 2 — `if=` REMOVES from the DOM, §17.1) the `if=` body is emitted into a mount `<template>` and inserted when the condition holds; the lift-target bind stayed a top-level, eager `document.querySelector`.
A smaller shape that ALSO emits a top-level bind for a host inside a mount template is `docs/changes/s427-lift-target-mount/repro-min.scrml` (`<ul if=@items.length> ${ for … lift <li> } </ul>`) — it emits the NON-const form `_scrml_lift_target = document.querySelector(...)`. Determine by execution whether it renders its rows; do not assume.

## 2. Locus (PA-located-verify — I searched, I did not trace)
`compiler/src/codegen/emit-reactive-wiring.ts` ~l.674 (`_scrml_lift_target = document.querySelector(...)`), ~l.678 (`genVar("lift_tgt")`), ~l.730 (a second `_scrml_lift_target =` site). None consults `insideMountTemplate` (`binding-registry.ts` ~l.163/605/645 stamps it; `emit-event-wiring.ts` ~l.1494/2332 consume it for display sites). State whether this hypothesis held, and the path from the `if=` Phase-2 lowering to the decision that the bind is top-level.

## 3. Required outcome — FIX THE CLASS, NOT THE SITE
- Every lift target whose host element ends up inside a mount `<template>` binds against the LIVE, mounted node, and re-binds on each re-mount (an `if=` that goes false then true inserts a fresh clone). Mirror the mechanism the S400 display fix used rather than inventing a second one, unless you show by execution why it cannot apply.
- ⚑ **Enumerate the population before you fix** (base §8: "a fix recreates its class one level away"): list EVERY emit site in `compiler/src/codegen/` that produces an eager top-level `document.querySelector` / `getElementById` for a host element that a mount template (if= Phase 2, `<each>` mount, engine/match arm mount — check which exist) can capture. For each: covered by the existing rebind mechanism / fixed by you / not reachable (with the reason). Report the table.
- Nesting: cover lift hosts inside a mount template inside another mount template, and a lift inside an `<each>` row inside an `if=` body — measure, don't assume.
- A program whose lift host is NOT inside any mount template must emit byte-identically to before.

## 4. Governing sentence (Rule 4 gate)
This is conformance restoration (a valid program compiles and renders nothing). Quote in your report the SPEC sentences that govern it: §10 (`lift` semantics) and §17.1 (`if=` removes from / inserts into the DOM). If you find no sentence that makes the current output wrong, STOP and report — that would make it a ruling, not a fix.

## 5. Tests
- Unit/integration pins on the EMITTED shape for each enumerated site.
- A behavioural pin that MOUNTS the output (happy-dom) and asserts rows render: the min repro, the todomvc shape, the nested shapes, and an `if=` false→true→false→true cycle re-rendering correctly.
- ⚑ The gap records that `compiler/tests/browser/browser-todomvc.test.js` is GREEN against the dead build (36 pass / 8 skip) because the harness swallows the init throw into `initError` and no test asserts a row rendered. Add an assertion there that FAILS on the pre-fix build (prove it: run it against origin/main's compiler) and passes after. Report both runs.
- `bun test compiler/tests/e2e-render-map/`: `benchmarks/todomvc/app.scrml#empty` has been drifting green→red (D1 mount throw on `_scrml_lift_tgt_45.innerHTML`). After the fix it should score its committed-baseline state again. Report its state; do NOT edit the baseline.

## 6. Gate — DO NOT report DONE without these
- `bun test compiler/tests/unit compiler/tests/conformance compiler/tests/*.test.js` and `bun test compiler/tests/e2e-render-map/` all green (counts vs baseline).
- The browser tier: `bun scripts/browser-baseline.ts --check` must pass (its failure NAME-SET must not grow).
- Emit differential: compile every `examples/*.scrml` and `benchmarks/**/*.scrml` on origin/main vs your HEAD; report which artifacts changed and confirm every change is an intended lift-target site (anything else = STOP and report). Direction-of-change: expect semantics-changed ONLY for programs that were broken; list them.
- Run `bun scripts/facts.ts --write` and `bun scripts/state.ts --write` if FACTS LOC / state moved (strip CR first if a regen script chokes on CRLF), and include the regenerated files.
- Mutation bite: revert the fix → the new pins red; restore → green. Report numbers.

## 7. Report
Worktree path · final SHA · files touched · locus hypothesis held/refined/wrong + the traced path · the enumeration table · governing sentences quoted · each test and its pre-fix/post-fix result · browser-todomvc pre/post runs · e2e-render-map todomvc cell state · emit differential summary · mutation numbers · anything deferred.

## MAPS
`.claude/maps/` is stale; treat as hypotheses. Source is the authority. Anti-pattern briefing: you write test `.scrml` only; keep to canonical scrml (see `docs/articles/llm-kickstarter-v2-2026-05-04.md` if unsure).
