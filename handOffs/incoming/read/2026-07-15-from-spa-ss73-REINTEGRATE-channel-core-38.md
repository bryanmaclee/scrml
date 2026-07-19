# REINTEGRATE — sPA ss73 · conformance channel-core §38 (codes-half)

**From:** sPA ss73 (`spa-lists/ss73-conformance-channel-core-38.md`)
**Date:** 2026-07-15
**Branch:** `spa/ss73` · **tip:** `adb7272f` · **base:** `origin/main@8cb00161`
**Status:** COMPLETE — all 7 items landed, 0 parked. `bun conformance/run.ts` → **534/534 green** (was 519 at base).

## What landed

The S256 audit found the channel pillar covered only the §38.13 `watches=` Nominal extension;
the ~7 core `E-CHANNEL-*` placement/naming/scope codes were uncovered. All 7 now pinned
(reject-path pos + clean neg per code; item 5 carries 2 negs). **Codes-half only** — compile-time
placement/naming contract (harness-clean). Multi-client V5-strict cell-sync RUNTIME stays the
accept-with-note freeze DECISION (not this list); the `watches=` server-feed runtime half is ss67's.

| # | code | §    | cases (pos / neg) | per-item SHA |
|---|------|------|-------------------|--------------|
| 1 | E-CHANNEL-001 | §38.9 | channel/name-missing · name-present | `cb48a25d` |
| 2 | E-CHANNEL-007 | §38.11 | channel/name-interpolated · name-static-literal | `c9411b7d` |
| 3 | E-CHANNEL-008 | §38.12.8 | channel/dup-name-cross-file · same-source-two-aliases | `ffb6b15c` |
| 4 | E-CHANNEL-EXPORT-001 | §38.12 | channel/export-reactive-ref-name · export-string-literal-name | `c6474f9b` |
| 5 | E-CHANNEL-OUTSIDE-PROGRAM | §38.1 | channel/outside-program · inside-program + module-file-top-level | `f44ae6de` |
| 6 | E-CHANNEL-SERVER-CELL-READ | §38.4/§38.6.1 | channel/server-cell-read · server-fn-uses-arg | `d61718bc` |
| 7 | E-CHANNEL-SHARED-MODIFIER | §38.4 | channel/shared-modifier · shared-modifier-absent | `7827e208` |

Tracking commit: `adb7272f` (list status markers + `spa-lists/ss73.progress.md`).
**15 cases, 33 new files** — all under `conformance/cases/channel/`.

## Divergences ESCALATED

**None.** Every code was cross-checked against its §38 normative statement (SPEC read per code);
all matched. No impl#1-vs-SPEC divergence surfaced — nothing to rule on.

## Re-integration notes (file-delta is provably clean)

- All 33 files are **additive, new files** in disjoint per-code dirs under `conformance/cases/channel/`.
  The only NON-additive file in the delta is `spa-lists/ss73-conformance-channel-core-38.md` (my own
  status markers — sPA-owned tracking).
- origin/main advanced `8cb00161 → 211dc076` during the session (3 commits: #58 ss61/ss68/ss72
  reintegration, #57 E-MATCH-012, #54 markup fix). **None touch `conformance/cases/channel/`,
  `conformance/run.ts`, or `conformance/adapters/`** — verified. File-delta onto current main is
  conflict-free; re-run `bun conformance/run.ts` to confirm green against 211dc076.
- Suggested file-delta: `git checkout spa/ss73 -- conformance/cases/channel/` then confirm green.
  (The spa-list/progress tracking files are sPA-owned — restore-HEAD + author from this ping per
  the PA-shared-docs exclusion rule; don't wholesale-clobber PA session versions.)

## Design notes worth a glance

- **Item 5** adds a 2nd neg (`channel/module-file-top-level`) proving the `fileHasProgram` guard is
  load-bearing: a file-top `<channel>` is a violation ONLY when a `<program>` sibling exists;
  the PURE-CHANNEL-FILE dispensation (S87 Insight 30) stays silent.
- **Item 4** pos (`export <channel name=@topic>`) carries an incidental `E-SCOPE-001` (unresolved
  `@topic` after the export fail-open drop). The superset codes-check pins only E-CHANNEL-EXPORT-001;
  noted in the case description.
- **Item 6** neg is the SPEC-recommended fix shape (server fn broadcasts a value derived from its
  ARG, not a channel-cell read); client-side channel-cell reads remain permitted.
