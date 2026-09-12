# BRIEF — self-host tier coverage disposition (S409, dispatched 2026-09-12)

Archived verbatim per the S136 brief-archival discipline. Dispatched to
`scrml-js-codegen-engineer`, `isolation: "worktree"`, model `opus`, from `main @ fd69d1fc`.

**Ruling:** bryan, S409 — *"take the self-host coverage disposition"*, accepted from S411-peter's
routed ask on #922.

**Disposition:** gate `compiler/tests/self-host/` on a failure NAME SET, mirroring the proven
`scripts/browser-baseline.ts`. Not "gate it green" (3 real failures); not "quarantine" (the
quarantine premise is measured false).

## The two false claims this arc corrects

1. **`ci.yml` ~22-27** says the self-host tests *"need a locally-built, gitignored dist that CANNOT
   be rebuilt on a clean checkout."* **PA-verified FALSE for `compiler/tests/self-host/`**: with
   `compiler/self-host/dist/` (14 files) moved entirely out of the tree, the tier runs
   **139 pass / 122 skip / 3 fail, 264 tests, 569ms**, with an *identical failure name set* to the
   with-dist run. They compile at test time; `bs.test.js` self-skips cleanly. (The claim may still
   hold for `integration/self-host-smoke.test.js` — out of scope, untested either way.)
2. **`scripts/browser-baseline.ts` ~38** says *"lsp / commands / self-host carry their own baselines."*
   **PA-verified FALSE** — only `compiler/tests/browser/FAILURE-BASELINE.json` exists.

## Why it matters

The #924 regex-class-colon defect mangled a regex on **every platform** and produced an 82 GB host
lockup. Its only corpus site was `compiler/self-host/tab.scrml`, and nothing in any gated path
executes that directory — so it reached a machine rather than a gate.

## The measured baseline (stable with and without the dist)

```
tokenizeLogic parity > tilde
tokenizeLogic parity > punct chars
tokenizeCSS parity > pseudo selector
```

Token-count parity mismatches (`Expected: 2, Received: 1`) at `tab.test.js:72` in `assertSameTokens`
— **not** the `ReferenceError` TDZ symptom filed as
`g-selfhost-tokenizelogic-tdz-pos-before-initialization`.

Full dispatch prompt: see the S409 session transcript; its substance is reproduced above and in
`docs/known-gaps.md`'s corrected TDZ entry.
