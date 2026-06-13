# g-legacy-derived-projection-plain-cell — progress

change-id: legacy-derived-projection-plain-cell-2026-06-13
agent: scrml-js-codegen-engineer (isolation:worktree)

## 2026-06-13 — Startup + bug confirmation
- Startup verification PASS: worktree root, tree clean, bun install, bun run pretest.
- HEAD f0030049; maps watermark a00624f5.
- CONFIRMED full-pipeline: plain-cell `@order: Phase` + `<engine for=Health derived=@order>` fires
  E-ENGINE-004 ("no machine-bound reactive with that name was found in scope") via validateDerivedMachines
  (type-system.ts:5351-5360). `@order` is a plain enum cell; the sibling `<engine for=Phase>` binds
  the auto-cell `@phase`, NOT `@order` — so the legacy §51.9.3 1:1 projection has no machine source.
- CONFIRMED modern `derived=match @order { ... }` over the SAME plain enum cell compiles clean.
- CONFIRMED machine-bound legacy form (examples/14-mario, `derived=@marioState`) compiles clean
  (@marioState IS the auto-cell of `<engine for=MarioState>`).
- Canonical §51.0.J modern spelling (SPEC.md:25458): `derived=match @marioState { ... }`.

## Decisions
- Fix 1: extend E-ENGINE-004 message at type-system.ts:5354-5357 to ALSO steer to `derived=match @var {...}`.
- Fix 2 approach: (b). Approach (a) is unclean — making the source machine-bound (`derived=@phase`)
  forces the engine body to legacy projection-RULES and trips E-ENGINE-018, which would distort the
  `legacy-source-var` identity-projection codegen the c14 tests target. (b) keeps the codegen-direct
  unit tests (correct in isolation) AND adds a full-pipeline test documenting the §51.9.3 boundary.

## 2026-06-13 — Landed
- Fix 1 committed 3d3d91ef: E-ENGINE-004 message extended (type-system.ts:5354-5360) — steers to BOTH
  machine-source form AND modern §51.0.J `derived=match @order { .Source => .Target, ... }`. No behavior change.
- Fix 2 committed 0be2c634 (approach (b)): c14 §C14.15 full-pipeline boundary describe block
  (compileScrml-driven) — plain-cell `derived=@order` fires E-ENGINE-004 (asserts §51.9.3 + `derived=match @order`
  + SomeMachine in message); modern `derived=match @order {...}` over same plain cell compiles clean.
  Stale 'NOT YET PARSED' docstring retired; cross-ref notes on §C14.8/§C14.9/§C14.10. Mutation-verified new asserts run.
- R26 PASS: plain-cell → improved E-ENGINE-004; Mario machine-bound legacy → clean; modern match → clean valid JS
  (_scrml_derived_declare/subscribe("health","order")/get).
- Full gate (unit+integration+conformance): 16873 pass / 90 skip / 1 todo / 0 fail / 919 files.
- NO SPEC edit (per brief — PA has uncommitted §52 edit in flight). NO §34/§51.9 tweak flagged.
