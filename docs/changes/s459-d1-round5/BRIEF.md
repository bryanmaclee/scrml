# s459-d1-round5 — one component scope: a body-level declaration shadows a prop everywhere after it

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do first; stop and report if any check fails)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Call it WT.
2. `git -C "$WT" rev-parse --show-toplevel` == WT; `git -C "$WT" status --porcelain` empty.
3. `bun install` in WT; `bun run pretest` run PLAINLY from WT (never `bun --cwd <path> run`); confirm `samples/compilation-tests/dist/` exists.
4. Every Read/Write/Edit uses an ABSOLUTE path under WT. NEVER `cd` into /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WT"`.
5. NEVER `git stash`. NEVER `pkill -f`/`killall` by pattern — kill only PIDs you started.
6. TMPDIR=$HOME/.cache/scrml-agent-tmp/s459-d1-r5 per command; delete scratch before the final report.
7. First commit: `WIP(s459-d1-r5): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
`$WT/.claude/maps/primary.map.md` (stamp `8ce6d61b5`, 2026-10-08; main moved since only by docs/SPEC text + PR #1359 the `^{}` allow-list, which may merge while you work) — follow its routing for components / component-expander. Verify against source. Report whether load-bearing.

## Brief archival + crash recovery
Copy this brief verbatim to `$WT/docs/changes/s459-d1-round5/BRIEF.md` (second commit); append timestamped lines to `progress.md` beside it. Commit after EVERY meaningful change. Context budget: at ~650k tokens, commit, write progress.md, report. (Two earlier D1 agents ran out of context — budget it.)

## Base
`git -C "$WT" checkout -B s459-d1-r5 worktree-agent-a2dd4a6ac2e78db31` (tip 8e7bd4a2c, D1 round 4), then `git merge origin/main`. Read `docs/changes/s458-declared-props-d1/{BRIEF,progress}.md` and `docs/changes/s458-d1-round4/{BRIEF,progress}.md` first — the D1 design (ruled S458: declared props never reach the root; ONE binding model; `E-COMPONENT-PROP-WRITE`). DD: `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/declared-props-reach-root-2026-10-07.md`.

## The S459 differential review: DO-NOT-LAND on one HIGH; all round-4 items CLOSED. Fix these.
Reviewer probes: `/home/bryan-maclee/.cache/scrml-agent-tmp/s459-rev-d1/keep/` and `.../q/` (read-only — copy into your scratch). Reviewer harness: `$SCRATCH/runprobes.ts` there imports `<tree>/conformance/run.ts` `evaluateCase`. Findings are CLAIMS: reproduce each; report held / refined / wrong. (H1 is PA-reproduced: emitted `f()` writes `_scrml_cs_reactive_set("v", 5)`.)

**H1 HIGH — two scope models across the component body (new on HEAD, silent).**
```scrml
<v> = 7
<o> = ""
const C = <div class="c" props={ bind n: number }>
    ${ let n = 0 }
    <i>x</i>
    ${ function f() { n = 5; @o = String(n) } }
    <button class="k" onclick=f()>k</button>
</>
<C bind:n=@v/>
<p id="o">${@v}/${@o}</p>
```
`n` declared at component-body top level shadows the prop only inside its own `${}` statement list; later `${}` blocks and markup (incl. handler expressions like `onclick=${() => n = 50}`) still resolve `n` to the prop → the parent's `@v` is written. Governing (quote in your SPEC/code comments): §15.10.1 "From the point of declaration onward in the same scope, the local binding shadows the prop." + §15.11.1 "A local declaration, parameter or loop binder named like the prop is not the prop … and is writable." + §15.10.1's Greeter example (markup after a component logic block is the same scope). PA-located-verify locus: `substitutePropsInLogicStmts` (component-expander.ts ~2225) keeps `localShadowed` per statement list. **Fix = ONE component scope:** a declaration at component-body scope enters the shadow set for EVERYTHING after it in the body (later `${}` blocks, markup text interpolation, attribute values, handler expressions, lifted markup), in source order. Not a refusal — the SPEC says the local shadows.
**M1 MED — same root, by-value props.** `${ const label = "S"; function r(){ return label } }` + `<p>${label}</p>` with `<C label="L"/>` renders `L` in markup while `r()` returns `S` (pre-existing, both trees). And `onclick=${() => label = "Z"}` after `${ let label = "S" }` is falsely refused with E-COMPONENT-PROP-WRITE (new on HEAD). Both fall out of the H1 fix; verify.
**M2 MED — callback prop in the bare event-attribute call form is never substituted (pre-existing, silent).** SPEC §15.11.4's own worked example — `props={ message: string, onDismiss: () => void }` + `<button onclick=onDismiss()>` — emits `function(event) { onDismiss(); }` → ReferenceError on click. Also `onclick=onGo(event)`, top level and inside `lift`. Flagship example 23 ships it (address-form `oninput=onAddressInput(event)`, assignment-picker `onAssign(event)`). This is a third prop reader outside the ONE binding model — route it through the same structural substitution (no text fallback, no second reader).
**L1 LOW — rest parameter named like a prop:** `function g(...n){ return n.length }` → HEAD E-SCOPE-001 (the later scope check never binds rest params). Bind rest params in that scope check (one reader with the expander's binder rule).
**L2 LOW — single-quoted attribute value in a component body** (`title='${label}x'`) → HEAD emits garbage valueless attributes `<i class="a" title x>` silently; BASE rendered it; outside a component it is E-ATTR-001. SPEC ~L1790 "single-quote is not an attribute-string delimiter." → refuse with E-ATTR-001 in component bodies too.
**L4 LOW — message nits:** E-COMPONENT-PROP-WRITE on a prop already declared `bind` still says "Declare `bind visible: T`…" (should say: bind it at the call site); an omitted prop is described as "passed by value" (say "not bound at the call site"); `bind:n=${@v}` is refused as "`@v` is an expression, not a cell" (say: write `bind:n=@v`).

Out of scope (carried, do NOT fix): destructured-param / param defaults dropped (`{ n = 5 }`, `k = 2`); destructuring assignment unsupported; C-style `for` in component fns; `<each>` in lifted components; block-arrow handler in `<each>` never invoked; `<Card id=…>` E-COMPONENT-011 vs §15.5. List them in progress.md as carried.

## Verify
- Core suite `bun test compiler/tests/{unit,integration,conformance} --bail` = 0 fail; browser tier exactly as `.github/workflows/ci.yml` runs it; `bun conformance/run.ts` no regressions (HEAD baseline 1391/1441 + 50 xfail).
- Conformance cases for H1 (later-block write, markup handler write, markup text read — each with the parent cell asserted UNCHANGED), M1, M2 (the §15.11.4 example verbatim, click works), L1, L2.
- Corpus differential (samples, examples, conformance/cases) at the merged base vs your tip; every change explained. Example 23 must now wire its callback props.
- Pre-commit runs the core suite — never `--no-verify`, never touch core.hooksPath.

## Final report
WT · final SHA · branch · per finding: held/refined/wrong + what you did + executed evidence · differential summary · anything not done. Do NOT push.
