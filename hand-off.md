# scrmlTS — Session 107 (OPEN)

**Date:** 2026-05-19
**Previous:** `handOffs/hand-off-109.md` (S106 CLOSE — rotated this session-open)
**Machine:** single-machine (S100 directive holds; S106 cross-machine inbox surface was a one-cycle dogfood pass that is now back to single-machine framing)
**HEAD at S107 OPEN:** `0534c18` (S106 close wrap commit; post-rebase onto origin's `30d9b7b` website-content-sweep)
**Origin sync at OPEN:** scrmlTS 0/0; scrml-support 0/0

---

## Session-start status (S107 OPEN)

| Check | Result |
|---|---|
| pa.md → pa-scrmlTS.md | read in full |
| PA-SCRML-PRIMER.md | §1-§8 read (framing + pillars + V5-strict + 3-shape + compound + error model + engines); §9-§13 indexed via header grep |
| SPEC-INDEX.md | read in full (358L; §57 wire-format is latest section landing) |
| master-list.md §0 LIVE DASHBOARD | read in full (incl. S106 + S105 addenda at top) |
| hand-off.md (S106 CLOSE) | read in full; rotated → `handOffs/hand-off-109.md` |
| user-voice tail | S99-S103 read (~10 contentful entries; S100 ratified single-machine; S102 ratified deep-dive-skip-when-MED-HIGH; S103 ratified surface-form-debate-mandatory + STASH-with-revival-triggers + Playwright-standard) |
| Cross-machine sync (scrmlTS) | fetch clean; 0/0 |
| Cross-machine sync (scrml-support) | fetch clean; 0/0 |
| Inbox | 1 stale dogfood-bug file from S106 (claimed moved at S106 wrap but wasn't) → moved to `read/` this session-open |
| Worktree state | main only (16 stale `worktree-agent-*` branches were cleaned at S106 OPEN) |
| Hook gate | Configuration B installed (`core.hooksPath` = `.git/hooks` with `pre-commit`, `post-commit`, `pre-push`, plus `.bak` siblings). NOTE: S106 hand-off framed gate as Configuration A — actual install is the richer local-rich Configuration B per pa.md §"Per-machine setup — git hooks (S78 baseline + S88 amendment)". `--no-verify` on `git push` is a process violation per S88 amendment unless explicitly authorized. |
| Maps watermark | `d8427f2` (S105) — **4 commits behind HEAD** (`0534c18`). Refresh required BEFORE any dev-agent dispatch per S106 carry. |
| Self-host bootstrap | unchanged (S102 broken-import-path persists; gitignored; pre-commit subset skips self-host parity) |
| scrml-support untracked | unchanged (voice articles + tools/ — user's territory) |

## Carry-forward (from S106 CLOSE)

### High priority — 6 dogfood bugs (adopter-friction-surfaced; in `handOffs/incoming/read/`)

| # | Severity | Item | Triage cost |
|---|---|---|---|
| Bug 5 | HIGH | `${const}` interpolation empty placeholder + no-op JS (markup-as-value pillar L4 misfire on simplest shape) | needs scoping — pillar L4 implications; SPEC §1.4 + §7.4.1 verification per pa.md Rule 4 |
| Bug 3 | MED | `[BS]` compiler diagnostics omit file paths (sibling `[W-LINT-*]` includes them) | trivial fix; QoL win; ~1-2h |
| Bug 6 | MED | retired error-code references in shipped reference pages (sweep needed across `docs/website/pages/`) | ~2-3h sweep; pull canonical §34 catalog from `compiler/SPEC.md` directly (not PRIMER paraphrasing) per Rule 4 |
| Bug 1 | HIGH | Tailwind layer no-ops arbitrary-value classes (`grid-cols-[auto_1fr_auto]`) silently | floor (lint unrecognized class names): ~2-3h; full fix (support Tailwind arbitrary-value syntax): medium |
| Bug 2 | MED-HI | Multi-line `<a>` opener + entity-encoded element-name body → phantom E-SYNTAX-050 + 4-cascade on line containing no `/` | needs minimal bisecting reducer first |
| Bug 4 | LOW-MED | Bare `?{` / `/` in markup copy parsed as tokens — no docs-mode escape | deep-dive on design space (docs hardening / docs-mode lint / markup-text-mode tokenizer awareness) |

Triage order from side-session report: Bug 5 → Bug 3 → Bug 6 → Bug 1 → Bug 2 → Bug 4. Stands unless user re-directs.

### Substantive (mid-tier remaining from S105 carry)

| Track | Item | Cost |
|---|---|---|
| Phase 3.B | B4 count-derived dep precision (agent-dispatched; Q-RT3B-OPEN-2 ratified) | ~3-5h |
| formFor v1.next | B2 per-type renderer registry `data.registerRenderer` | ~3-5h |
| formFor v1.next | B3 `@label("...")` type-field annotation | ~3-5h |
| formFor v1.next | B4 auto-recurse into nested struct fields | ~5-8h |
| formFor follow-on | B5 L2 label-store consultation IN expander | ~3-5h |
| PGO Phase 3 follow-up | C2 Markup/for-stmt double-walk fold in detectRuntimeChunks | ~2-3h |
| PGO Phase 3 follow-up | C3 `in` / `.includes()` / deep-path-key detector extensions | ~3-5h each |
| PGO Phase 3 follow-up | C4 equality runtime-chunk detector inline-stub cleanup (pre-existing bug) | ~2-3h |
| Native parser | M2 expression parser (~2-4 sessions per DD §D7) | ~2-4 sessions |
| Self-host bootstrap | broken-import-path investigation (S102 carry; still unaddressed S103-S106) | ~2-4h |

### tableFor v1.next follow-ups (6 newly-surfaced S105 — minus #1 closed by OQ-TF-13 in S106)

| # | Item | Cost |
|---|---|---|
| 2 | §41.16.7 sort-state cell as explicit state-decl (currently inline writes) | small |
| 3 | §41.16.8 `E-TABLEFOR-SELECTABLE-CELL-WRONG-TYPE` strict-mode fire-site | small |
| 4 | OQ-TF-7 positional/computed `<column>` slots (for non-struct columns like Delete buttons) | medium |
| 5 | §17.4a for/else codegen (pre-existing gap; affects all `<empty>` slot text emission) | medium |
| 6 | `date`/`timestamp` BUILTIN_TYPE entries (cross-L22 normalization story needs scoping) | small but needs cross-L22 scoping |
| 7 | Inline event handler shape with non-`event` arrow param | small |

### v1.0+ follow-up

- Structural cleanup of browser-test effect-leak pattern (G1 close residue)

### Light (cleanup)

- **Maps incremental refresh required BEFORE any dev-agent dispatch this session** — 4 commits behind watermark `d8427f2` (S106's 4 substantive commits + 1 wrap). S106 project-mapper agent hit a write-permission block at OPEN; check whether resolved this session OR plan PA-direct fold-in.
- OQ-TF-11 sub-debate (if user contests MEDIUM verdict on row binding `:let` vs implicit `@row`)
- Puppeteer dep cleanup (Q-PW-PORT-OPEN-1 ratified DEFER; awaiting 1-2 release cycles post-S103 Playwright cutover)
- LEGACY `_scrml_subscribers` retirement (v0.4+; Q-RT3-SR-OPEN-3 ratified DEFER post-impl)

### Marketing-shaped (per pa.md Rule 1 — DEFER unless raised)

- formFor + schemaFor + tableFor combined sample app + scrml.dev refresh + README compile-gate block
- L22 family 4-of-6-shipped narrative + tableFor admin-UI-lift adoption pitch
- v0.4 announce content
- Side-session-website-content-sweep adoption story (50 stubs + 9 fleshed-out pages + 5 error refs)

## Tests at S107 OPEN (carried from S106 CLOSE)

- **Pre-commit subset** (unit + integration + conformance): **13,024 pass / 92 skip / 1 todo / 0 fail / 677 files / 44,306 expect**
- **Full `bun test compiler/tests/`**: **15,867 pass / 173 skip / 1 todo / 0 fail / 710 files / 46,721 expect**

## Things S107 PA must NOT screw up (carried from S106 CLOSE)

- **Maps refresh BEFORE any dev-agent dispatch** — 4 commits behind watermark. PA-direct fold-in OR re-attempt project-mapper agent.
- **6 dogfood bug reports are NOT to be silently dropped** — high-value adopter-friction-surfaced bugs from real dogfooding.
- **Bug 5 is load-bearing on markup-as-value pillar L4** — when scoping, verify SPEC §1.4 + §7.4.1 in full, not PRIMER summary per pa.md Rule 4.
- **Bug 6 sweep needs current SPEC §34 catalog** — don't grep-match against PRIMER paraphrasing; pull canonical code list from `compiler/SPEC.md` directly.
- **Hook gate is Configuration B** — local-rich (pre-commit + post-commit + pre-push). `--no-verify` on `git push` extends S88 process-violation surface; never bypass without explicit authorization.
- **runtime-results.json drift** — committed baseline is on Bun 1.3.13; S106 measurement was on 1.3.6. If S107 does runtime-perf work, re-measure on matched Bun for clean comparison.
- **Stated single-machine framing** — user reconfirmed S100 single-machine at S106 wrap; cross-machine sync hygiene (S43) is dormant but `git fetch` at session-start is still standing.

## Open questions to surface IMMEDIATELY at S107 OPEN

1. **Next-priority direction.** Two natural shapes: (a) start dogfood-bug triage from the top (Bug 5 scoping); (b) drain mid-tier carry-forward (Phase 3.B B4 agent-dispatch + PGO C2/C3/C4 PA-direct). User direction at S106 OPEN was "AFK — go straight into high impact work that is ratified and scoped or ready to scope." S107 may or may not still be in that mode.
2. **Maps refresh approach.** S106 project-mapper agent hit a write-permission block. Two options: (a) re-attempt with permissions sorted; (b) PA-direct fold-in (~5-15min per non-compliance precedent).
3. **Bug 5 scoping shape.** If user picks Bug 5, the SCOPING SHALL read SPEC §1.4 + §7.4.1 + §7.4 in full first — load-bearing on markup-as-value pillar; cannot make decisions from PRIMER summary per Rule 4.

## Tags

#session-107 #OPEN #s106-carry-forward #6-dogfood-bugs #maps-refresh-pending
