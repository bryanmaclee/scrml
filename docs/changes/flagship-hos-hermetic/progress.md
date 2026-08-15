# progress — flagship-hos-hermetic (S346 dispatch)

Append-only. Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0d6f2e5fea24f0e6`,
branch `fix/flagship-hos-hermetic`, base `2709e540`.

## 1. Startup + baseline (done)
- pwd / toplevel / clean tree verified; `bun install`; `bun run pretest` (13 samples).
- Victim alone: 7 pass. Sorted tier (`bun test $(ls compiler/tests/browser/*.test.js | sort)`):
  729 pass / 50 fail / flagship NOT among the fails (the 50 = the 48 baseline names + 2 TodoMVC
  env-excluded).
- Fresh-process compile of the app is deterministic (two runs byte-identical, html=7993B,
  5 templates, engine mount inside a template = true).

## 2. H1 pairwise sweep — 91 × `bun test <X> <victim>` (done)
- 13 pairs RED — EVERY one is `^ this test timed out after 5000ms.` on the FIRST test
  (5.0–8.6 s). ZERO assertion failures. The emitted html was never wrong.
- Duration sweep (`--timeout 2500` so the first test always prints its duration): alone
  ~2.7–3.3 s; after most writers 3–4.8 s; after 13 specific writers 7.6–10.4 s.
- `bunfig.toml [test] timeout = 10000` is NOT honoured by bun 1.3.14 (a 6 s sync spin test
  times out at 5000 ms; the `root` key IS honoured, so the file loads) — the effective per-test
  budget is bun's default 5000 ms everywhere. CLI `--timeout` works.

## 3. Why the compile doubles after certain writers (done)
- `process.cpuUsage()` around the flagship compile: fresh 5.4–6.5 s CPU; after ANY prior
  compile of a source with NO string literal / comment: 10.4–12.5 s CPU. After a prior compile
  WITH a string literal: fresh-speed. Reproducible 4/4.
- `bun --cpu-prof`: `lint-ghost-patterns.js:239 skipPastRanges` self time 343 ms (8%) fresh
  vs 5.91 s (61%) after a no-string prior compile. Same input, same call count → per-call cost
  ~17×. `findMatchingClose` calls it once per CHARACTER and it rescans the sorted range list
  from index 0 each call (O(chars × ranges)); when the function is first JIT-tiered on an EMPTY
  range list the later non-empty runs sit on a pathological tier. Output is byte-identical.

## 4. Plan
1. `scripts/browser-baseline.ts` — print the failure REASON excerpt for each NEW failure name
   (would have said "timed out after 5000ms" three sessions ago).
2. `compiler/src/lint-ghost-patterns.js` — monotone cursor in `findMatchingClose` (O(chars +
   ranges)); unit pin (behaviour + a generous cost pin); corpus emit differential must be 0.
3. `flagship-hos-engine-under-if.browser.test.js` — compile in `beforeAll` with an EXPLICIT
   60 s budget (precedent: `integration/w3-splitter-trucking-characterization.test.js`).
4. `bunfig.toml` — remove the dead `timeout` key, say why.
5. Gates + FINDINGS.md.
