# progress — handle-onion CSP + onion composition

Branch: `handle-onion-top-level-dispatch`
Base at dispatch: `46ca6d63` (F1 ratelimit fix)

## Log

- [x] Startup gate: worktree/branch/clean/SHA all verified.
- [x] STEP 0: `git fetch origin` + `git merge origin/main` (origin/main @ `11966341`).
      One conflict: `docs/FACTS.md` (@generated) — resolved by REGENERATING
      (`bun scripts/facts.ts --write`, `bun scripts/state.ts --write`), not hand-merged.
      `handOffs/delta-log.md` merged clean, no renumbering.
      Merge commit `40f48f74`. Pre-commit suite green (28907 pass / 0 fail).
- [x] Anchor commit: BRIEF.md verbatim + this file.
- [ ] Ruling 1 — CSP / SSR-seed: `<script type="application/json">` + `JSON.parse`;
      transition keyframes into the emitted stylesheet instead of inline `<style>`.
- [ ] Ruling 1 verification by EXECUTION (headless Chromium: seed parses, 0 CSP
      violations; `headers=` absent unchanged; transitions still animate).
- [ ] Ruling 2 — one onion per request, precedence declared in source not filename.
- [ ] Ruling 2 verification by EXECUTION (two modules w/ `handle()` + `log=`;
      one onion per request; precedence survives a rename that flips alpha order).
- [ ] Gate: `bun run test` + `conformance/run.ts`; NEW-failure name set vs 53-failure baseline.
