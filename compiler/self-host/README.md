# compiler/self-host/ — FROZEN (S437, 2026-09-27)

**This tree is frozen. It is reference material, not the bootstrap source.** Do not add features, fix
bugs, or migrate code here, and do not count a defect here as a bootstrap blocker.

**Ruling** (bryan, S437 — `scrml-support/user-voice-scrml.md` S437: *"a, freeze self-host"*): the
native bootstrap compiler follows the **S233 four-phase re-cut** (lex · parse · analyze · lower+emit,
each phase with its own IR), not a one-module-per-TS-stage mirror. This tree is the stage-mirror shape
(dpa-051 option (b)): each `.scrml` module mirrors a TS stage and consumes impl#1's decorated `FileAST`,
and its codegen is `cg.scrml` (21 lines) importing ~9,765 LOC of JavaScript in `cg-parts/`.

**Where the bootstrap design lives:** `scrml-support/docs/deep-dives/bootstrap-codegen-architecture-dpa-051-2026-09-26.md`
(the architecture) and `compiler/SPEC.md` §66 (the declaration model it compiles). "Done" for a
bootstrap module = its conformance footprint passes; track-done = zero `import:host`, a B2≡B3 fixed
point, 100% conformance (S430 P5, unchanged).

**What still reads this tree:** `scripts/hybrid.ts` (the S430 P5 stage-swap harness — under the S437
ruling its per-stage swap applies only at the LEX seam and the whole compiler) and the
`scripts/rebuild-*-dist.ts` builders. They are kept so existing measurements stay reproducible.
