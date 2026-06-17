# BRIEF — fix Class A: <each> over a match/engine arm PAYLOAD BINDING emits the binding UNBOUND at mount

Change-id: each-over-arm-payload-binding-unbound-2026-06-17. Gap: g-each-over-arm-payload-binding-unbound (HIGH).
scrml-js-codegen-engineer · isolation:worktree · opus · bg. RE-DISPATCH (1st agent a60fbed STALLED in
investigation, env stream-watchdog, 0 commits; approach baked in for re-dispatch acfe15d2).

## Bug (PA-characterized)
<each> over a match/engine arm payload binding (.Loaded(rows) → arm <each> over rows): the arm render fn
receives the binding (_render_Loaded(rows)) but the each mount-setup emits `const _items = rows;` in a
scope WITHOUT it → ReferenceError at happy-dom mount. Repros: examples/16-remote-data.scrml (rows, match)
+ examples/29-engine-vs-flags.scrml (items, engine). Compile exit 0 + node --check OK; throw at mount.

## Fix approach (prior agent's converged plan — IMPLEMENT, don't re-investigate)
Each loses arm-association after flattening (match: matchBlock.bodyChildren; engine: match.children via
collectEachBlocks). FIX: (1) stamp the each-block node with armPayloadFieldName (binding→field) at LIFT
time where arm payload bindings are known — match: buildMatchArms after restampEachBlockIds; engine:
equivalent state-child lift point. (2) emit-each.ts reads the stamp + threads the binding into the each
mount-setup scope. One shared mechanism for match+engine; likely also emit-variant-guard.ts.

## R26 + render-map dog-food
Re-compile both repros (in-scope; node --check 0; mount no `is not defined`). Re-run the L1 render-map;
16-remote-data + 29-engine-vs-flags flip compiles-but-throws → renders-clean; update the baseline JSON.

## Gates + landing
+regression browser test (match-arm + engine-arm payload-binding each). FULL bun run test; within-node
OVER-BUDGET → re-baseline allowlist in-place (S198). Flip the gap → resolved + state.ts --write.

## Discipline
COMMIT INCREMENTALLY (prior stalled 0 commits). No SPEC change. F4/path-discipline standard.
