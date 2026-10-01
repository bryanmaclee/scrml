PA (S448) — ROUND 3 for s446-bootstrap-u0-when-effects. Same worktree, same rules as your round-2 brief, with ONE correction to rule 5: TMPDIR must be OUTSIDE any git repo (your import-host finding was right) — use /home/bryan/.cache/scrml-agent-tmp/u0-r3/ (mkdir -p; set per command; scratch there too; delete at the end). Archive this message verbatim as docs/changes/s446-bootstrap-u0-when-effects/BRIEF-r3.md.

An independent re-review at dc348412b returned LAND-WITH-NITS with two MEDIUM findings. Treat them as claims: reproduce both by execution before changing anything.

R2-1 (MEDIUM, a regression from round 2): the chain cap counts EVERY run of a When in a chain, not only re-triggers the When itself caused, so non-looping runs get dropped. Runtime repro (slice-m1 runtime):
  rt.when(sc,[q],(t)=>{ st.set("loading"); rt.suspend(t,1,()=>{ st.set("parsing"); rt.suspend(t,2,()=>st.set("done")) }) });
  rt.when(sc,[st],()=>d.push(st.peek()));
  q.set(1); // drain
Observed d = ["loading","parsing"] + a false "E-LIFECYCLE-006 … re-triggered during its re-run; dropped". At 42641506c: ["loading","parsing","done"], 0 errors. The observer writes nothing; there is no cycle. Governing: SPEC §6.7.4 "The body executes whenever any listed dependency changes value"; the cap exists only for self/cyclic re-triggers.

R2-2 (MEDIUM, pre-existing, REACHABLE FROM SOURCE today): a When created during a chain starts fresh, so a row `when` that grows its own collection is never capped → uncaught "Maximum call stack size exceeded", no diagnostic. 0 diags at compile:
  <rows:Row[replace, free]=([{ id: 1 }])/>  <let k:int=0/>
  function grow() { @k = @k + 1  @rows.push({ id: @k + 1 }) }
  <each in=@rows key=@.id as r><li>${ when @k changes { @hits = @hits + 1  grow() } }</li></each>
  <button onclick=(@k = @k + 1)>go</button>
One click → 4189 whens then the stack overflow. Your DESIGN §5 claim "total runs are bounded by (events × Whens × 2)" is false; correct it.

THE DIRECTION: change the mechanism, don't adjust the counter. Two rounds have now each found a new shape of the same class, so a third counter tweak is the wrong move.
(1) A re-run is CYCLIC iff the triggering write's causal ancestry already contains this same When. Track provenance: each run carries the ancestry of When-runs that caused it, so a run's continuations and the writes under them inherit it. Cap or drop and report ONLY cyclic re-triggers. Keep impl#1 parity on what a cycle does (re-run once, then drop and report with the same text). A non-cyclic downstream When always runs, which fixes R2-1. Ruling (b), newest wins, must still hold: an external write starts with empty ancestry.
(2) A fail-closed BACKSTOP for runaway non-cyclic growth (R2-2 and anything like it): a per-external-event budget on total When runs plus Whens created. When it's exceeded, stop the chain and REPORT, never crash. Pick the number, justify it in DESIGN §5, and record it as SPEC question (7): §6.7.4 doesn't specify runaway bounds, and impl#1 crashes the same way. Also check whether the R2-2 program should get a compile-time diagnostic. If no governing sentence exists, record that search in DESIGN and keep the runtime backstop as the floor.
(3) Tests: R2-1 (observer sees "done", 0 errors), R2-2 at runtime AND e2e from the source program (bounded, reported, page alive), all round-1 and round-2 tests still green, the 5-external-writes newest-wins test, the self and cross-when cycle tests. Bite proofs for (1) and (2).
(4) Also file in DESIGN §5 the reviewer's LOW notes: a host microtask/timer write escapes the chain (queueMicrotask). Whether scrml source can express it is UNVERIFIED, so state that. A derived-field cycle (<a=(@b+1)/><b=(@a+1)/>) raises no diagnostic (pre-existing).

Gates as in round 2, with TMPDIR outside the repo; core gate 0 fail. Report the same block format: FINAL_SHA, files, per-finding reproduced/fixed/bite, gates. Do not push.

Address this before completing your current task.
