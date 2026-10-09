# s460-gaps-b progress

- [x] Branch `gaps/s460b` from origin/main `3d0e54e21`; bun install.
- [x] BRIEF archived (22596faa4).
- [x] Verified + filed items 1-12 (new section `## §S460-b` at the end of docs/known-gaps.md; 12 new entries, 2 S460-also notes, 1 cross-link).
- [x] `bun scripts/state.ts --write` (gap-counts MED 561→564, LOW 318→327; master-list recent-sessions already current) + `--check` PASS.

Notes:
- Item 5 merged into existing g-component-body-given-match-unusable-s459 (S460 also). g_match.scrml uses legacy `=>` arms;
  canonical `:>` → E-CODEGEN-INVALID-LOGIC; given/match in a block-bodied handler arrow also fails OUTSIDE components.
- Item 7: match-arm locus now presence-narrowing.ts walkBodyNarrowed match-stmt branch ~:233 (traced by reading); f10b still compiles clean.
- Item 8: on main the bootstrap refuses the method call itself (E-BOOTSTRAP-UNSUPPORTED) + E-COND-NOT-BOOLEAN cascade.
- Item 10: compiled against PR #1370 head 37095451c via git archive (not merged). `<object>` breakout half is already on main.
  R2 + svg-use runtime halves relayed (puppeteer harness not re-run).
- Item 11: verified from CI attempt-1 logs.
- Item 4 brief said LOW-MED; filed LOW (warning, correct output).
