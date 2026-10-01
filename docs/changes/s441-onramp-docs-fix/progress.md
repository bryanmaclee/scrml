# s441-onramp-docs-fix — progress

- [x] 5 package.json homepage → https://scrml.dev (200); keywords typescript/no-build dropped
- [x] 3 docs/lin.md — `=>` arms → `:>` (W-MATCH-ARROW-LEGACY confirmed); "one-shot promise" dropped
- [x] 4 examples/README.md + VERIFIED.md (33/34 compile at cf62b4154; 09 = 4x E-ERROR-009) + examples/17 header → `scrml db-migrate`
- [x] 2 docs/external-js.md — every `<program>` block compiles; rest labelled fragment / specified-not-shipped
- [x] 1 kickstarter v2 — 17/17 `<program>` blocks compile (exit 0 + node --check); OAuth = labelled fragment

Not done: gated snippet files. Adding .scrml under docs/readme-snippets or
docs/tutorial-snippets changes the FACTS "public code samples under the compile
gate" count, so CI `bun scripts/facts.ts --check` would fail unless docs/FACTS.md
is regenerated — outside this change's file ownership. Blocks were compiled in
scratch instead.
