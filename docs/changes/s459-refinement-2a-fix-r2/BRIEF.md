# s459-refinement-2a-fix-r2 — close the S459 review findings on refinement slice 2a before it lands

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do first; stop and report if any check fails)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Call it WT.
2. `git -C "$WT" rev-parse --show-toplevel` == WT; `git -C "$WT" status --porcelain` empty.
3. `bun install` in WT; `bun run pretest` run PLAINLY from WT (never `bun --cwd <path> run`); confirm `samples/compilation-tests/dist/` exists.
4. Every Read/Write/Edit uses an ABSOLUTE path under WT. NEVER `cd` into /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WT"`.
5. NEVER `git stash`. NEVER `pkill -f`/`killall` by pattern — kill only PIDs you started.
6. TMPDIR=$HOME/.cache/scrml-agent-tmp/s459-ref2a-r2 per command; delete scratch before the final report.
7. First commit: `WIP(s459-ref2a-r2): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
`$WT/.claude/maps/primary.map.md` (stamp `8ce6d61b5`, 2026-10-08; main moved since only by docs/SPEC text) — follow its routing for codegen/runtime + type-system. Verify against source. Report whether load-bearing.

## Brief archival + crash recovery
Copy this brief verbatim to `$WT/docs/changes/s459-refinement-2a-fix-r2/BRIEF.md` (second commit). Append timestamped lines to `progress.md` beside it. Commit after EVERY meaningful change. Context budget: at ~650k tokens, commit, write progress.md, report.

## Base
`git -C "$WT" checkout -B s459-ref2a-r2 worktree-agent-a956eaa623dd550e4` (tip 11f456a8a, refinement slice 2a fix round 1), then `git merge origin/main`. Read `docs/changes/s458-refinement-every-position/{PLAN,progress}.md` and `docs/changes/s458-refinement-2a-fix/{BRIEF,progress}.md` first — they carry the design (checks at the runtime cell setter; judges hoisted per type; slice 1's one reader / base-type-first judge that fails closed).

## The S459 differential review (LAND-WITH-NITS; F1–F4 of the prior round all CLOSED). Fix these.
Reviewer reproducers live under `/home/bryan-maclee/.cache/scrml-agent-tmp/s459-rev-ref2a/repro/` (read-only for you — copy what you need into your scratch). Findings are CLAIMS: reproduce each before fixing; report held / refined / wrong.

1. **MED-2 — a refused SSR hydration seed aborts boot (REGRESSION vs main).** `_scrml_ssr_seed_apply_scoped` (runtime-template.js) calls `_scrml_reactive_set` per seeded cell with no guard; on a refined cell a refused value throws E-CONTRACT-001-RT from top-level client code → handlers never wired, later cells never seeded, page dead. Reviewer executed: `<program db=…>` + `<n server>: number(>0) = 1` + `window.__scrml_ssr_state = {n:-5}`. SPEC searched by reviewer (§52.8, §53) — no governing sentence. **Implement the PA recommendation (bryan has a veto window on it):** treat a seed like a `persist=` restore (§6.14.2 r3 — "take the default on refusal … not throw"): judge the seeded value; on refusal keep the cell's initial/default value, report the refusal to the §19.6.8 logging surface (same reporter refusals already use), and CONTINUE seeding the remaining cells and booting. Provenance for the SPEC note you add at §52.8: `analogy:§6.14.2 r3` + `ruling-pending: S459 PA rec`. Also cover the related same-on-both-trees case: a refined cell whose own initializer is invalid throws at boot — that one stays a throw only if SPEC says so; check §53.3/§53.4 and report what it says before changing it (do not change it without a governing sentence).
2. **MED-1 — refined collection writes re-judge the whole value (quadratic).** A push / element write / field write on a refined array or struct judges the ENTIRE value twice (proxy trial copy+apply+judge-all, then the trailing `_scrml_cs_reactive_set` the push lowering emits). 16k pushes: 10.8 s vs 0.22 s on main. Governing: §53.1 "minimal runtime overhead — an O(1) boolean expression". Fix: judge only what changed (the appended/inserted elements, the written element, the written field path), and do not re-judge the whole value on the trailing set when the proxy already judged the delta. Must still fail closed: when the delta cannot be identified, fall back to judging the whole value. Prove with the reviewer's bench (`bench*.mjs`): report before/after numbers; target near-linear.
3. **LOW-MED-3 — union judges fail OPEN for some members.** `number(>0) | date` (also `timestamp`, `asIs`, map, function members) emits a judge ending in `|| true`, so `@u = -5` is admitted. Governing: §53.11 "SHALL emit a runtime check for every boundary-zone assignment that it cannot statically elide" + slice 1's fail-closed rule. `date`/`timestamp` are registered string-shaped primitives (SPEC ~line 2807 — find it by grep and quote it) → judge them as such. For a member the judge genuinely cannot express, REFUSE at compile time with a diagnostic (fail closed) rather than emit `|| true`; measure corpus impact first and report the count (if non-zero, stop and report instead of refusing).
4. **LOW-4 — an array shared by two refined cells keeps a refused in-place mutation.** `<y>: number(>5)[] = [6,7]; <x>: number(>0)[]; @x = @y; @y.push(3)` → the proxy owner map says `x`, the trial passes, the trailing setter on `y` refuses, but the push is never undone → `@y = [6,7,3]` + a report. §53.3.3 "The variable retains its prior value". Fix so the refusal leaves the array unchanged (judge against every owning cell's type, or undo on refusal — pick the one that is ONE reader, explain).

Out of scope (do NOT touch): the pre-existing `splice` multi-arg comma-expression miscompile (filed separately); derived-recompute / R3 (slice 2b); residuals 1–3 in the 2a progress.md.

## Verify
- Core suite `bun test compiler/tests/{unit,integration,conformance} --bail` = 0 fail; browser tier exactly as `.github/workflows/ci.yml` runs it; `bun conformance/run.ts` no regressions.
- Add conformance/unit coverage for each finding (negative + legitimate twin).
- Corpus differential (samples, examples, conformance/cases) base 11f456a8a-merged vs your tip: every outcome/artifact change explained.
- Pre-commit runs the core suite — never `--no-verify`, never touch core.hooksPath.

## Final report
WT · final SHA · branch · per finding: held/refined/wrong + what you did + executed evidence · bench numbers · differential summary · the §53 initializer-throw finding · anything not done. Do NOT push.

## S459 round 3 addendum

PA: S459 re-review of your round 2 (062b0b6ac) = DO-NOT-LAND on one HIGH (PA-reproduced). Prior MED-1/MED-2/LOW-MED-3/LOW-4 all CLOSED; benches at main parity; no holder leak. Round 3, same branch s459-ref2a-r2, same rules (commit after each change, progress.md "Round 3", no push). Append this message verbatim to your BRIEF.md as "S459 round 3 addendum". Reviewer probes (read-only; copy what you need): /home/bryan-maclee/.cache/scrml-agent-tmp/s459-rev-ref2b/repro/ — `TMPDIR=<scratch> TAGN=x SC=$PWD/<file>.mjs bun g.mjs <tree>`. Reproduce each first.

1. HIGH-1 (regression vs 11f456a8a, fail-OPEN): `_scrml_refine_last_path` is set by EVERY `_scrml_deep_set` (refined or not) and cleared only in `_scrml_refine_check`, so it survives unrelated writes/events; a later whole write to a refined cell whose value is that old deep-set result is judged only at the stale path. Repro lp2.mjs: `<ls>: number(>0)[] = [1,2]; <draft>: number[] = []; edit(){ @draft = @ls; @draft[0] = 5 }; add(){ @draft.push(@m) /* -5 */ }; commit(){ @ls = @draft }` → HEAD `[5,2,-5]` no report; BASE refuses. Fix at the ROOT, not the position: the "what changed" fact must be bound to the exact value it describes, consumed once, and valid only if nothing could have changed in between — e.g. a WeakMap keyed by the deep-set RESULT object recording {base value, path}, honoured only when base === the cell's current value AND the result object has not been mutated since (or simply: never trust a delta across a set boundary — clear on every `_scrml_reactive_set`, refined or not). If the delta cannot be PROVEN, judge the whole value (fail closed). State in progress.md why your choice cannot go stale.
2. MED-2 (regression, over-refusal): `@arr.length = n` lowers to `_scrml_deep_set(@arr, ["length"], n)`; `_scrml_refine_child` returns `d.el` for ANY array property, so the element judge runs on `n` (`L[]` refuses every length write; `number(>0)[]` refuses length=0). Fix: an array's element descriptor applies only to `_scrml_refine_is_index(prop)`; `length` (and any other non-index prop) → judge the resulting whole value (shrink is then admitted; GROWTH creates holes — confirm holes are refused for a refined element type, or judged as the SPEC requires; report what §53 says).
3. LOW-MED-3 (over-refusal): holder entries are released only when the cell's epoch moves (whole write), so an element removed IN PLACE (shift/splice/pop/length/moved to another cell) is still judged against the cell: `const r = @rows[0]; @rows.shift(); r.n = @m` refused. Fix so in-place removal releases the holder (or verify membership at judge time — prefer whichever is ONE reader).
4. LOW-4 (transient fail-open with `debounced=`): `_scrml_refine_check` bumps the epoch when the write is JUDGED, before the debounced commit; during the window in-place writes to the still-committed value are unjudged (deb.mjs). Bump at commit, not at judge. Check `throttled=` too.
5. Note (optional, report a decision): residual (d) — on 11f456a8a the next unrelated write re-judged the whole value and caught a raw-reference mutation; delta judging lost that later detection. If a cheap way exists to keep it without reintroducing the quadratic cost, take it; otherwise record it as carried.
6. Then `git merge origin/main` (49b7fcc1d, includes #1359; reviewer trial merge conflicts only in generated SPEC-INDEX/FACTS/bootstrap-conformance → regenerate).
Final report: SHA, per item held/refined/wrong + evidence, benches (3×), full gates (core, browser tier, conformance), corpus differential vs 062b0b6ac.
