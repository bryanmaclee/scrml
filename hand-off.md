# scrmlTS — Session 106 (CLOSE)

**Date:** 2026-05-19
**Previous:** `handOffs/hand-off-108.md` (S105 CLOSE — rotated at S106 OPEN)
**Machine:** single-machine (per S100 directive; cross-machine inbox surface re-emerged for one cycle via side-session dogfood bug reports — user re-confirmed single-machine framing holds)
**HEAD at S106 CLOSE (pre-wrap):** `c491b12` (post-rebase onto `30d9b7b` website content sweep)
**HEAD at S106 CLOSE (post-wrap):** `<wrap-sha>` (this hand-off + master-list + changelog wrap commit)
**Origin sync at CLOSE:** scrmlTS pushed at close; scrml-support 0/0 (no changes this session)

---

## S106 net outcome — AFK-mode 4-commit arc + origin pull (website + 6 dogfood bugs)

Session-open hand-off opened S106 as a SCOPING-and-direct session for the mid-tier carry-forward. User direction at session-open: "once done, go straight into high impact work that is ratified and scoped or ready to scope. AFK." Net result: **4 substantive PA-direct commits ratified+scoped from the S105 carry-forward** (B2 + OQ-TF-13 + C1, plus the maps/non-compliance bookkeeping) + **origin pull at wrap bringing down website content sweep + 6 dogfood bug reports** from the other machine's side session.

Tracks landed (in order):

1. **S106 OPEN bookkeeping** (`4842eea` post-rebase) — hook gate restoration (Configuration A; anomaly recurrence); maps refresh 84c736e → d8427f2 (34-commit drift; 6 maps updated via PA-direct landing after project-mapper agent surfaced findings but hit write-permission block); 2 non-compliance fixes folded (runtime-perf-scoping SCOPING status flip + SPEC §48.6.4 3-site implementation-pending → SHIPPED reference); 16 stale `worktree-agent-*` branches cleaned per S83 protocol.

2. **Phase 3.B B2 same-keys-in-same-order fast-path** (`b267d36` post-rebase, PA-direct ~1h) — surgical `_scrml_reconcile_list` fast-path; 11 unit tests. Q-RT3B-OPEN-1..5 ratified S105 → B2 PA-direct per Q-RT3B-OPEN-2. Bench validation: partial-update 2.28ms → 1.34ms = -42% (in SCOPING-anticipated 30-50% band — hypothesis VALIDATED); swap-rows 3.59ms → 2.45ms = -32% (bonus). Caveat: Bun version differs (S103 1.3.13 vs S106 1.3.6) — runtime-results.json change reverted to keep cross-Bun comparison from polluting published baseline.

3. **OQ-TF-13 _resolveAndCheckL22TypeName helper extraction** (`6faf7a6` post-rebase, PA-direct ~1h) — S104 third-caller threshold (tableFor S105 was the 4th). Pure refactor across 4 L22 callers (parseVariant + formFor + schemaFor + tableFor); error message bytes preserved exactly; +9 lines net. 149 L22-family tests pass with 0 fail.

4. **PGO Phase 3 follow-up C1 hasEqualityExpr flag** (`c491b12` post-rebase, PA-direct ~1.5h) — sibling Option-2 pattern to S102's `hasResetExpr` P3.B-followup. NEW `detectEqualityExprPresence` walker in ast-builder.js; cached on `FileAST.hasEqualityExpr`; consumed in emit-client.ts at same gate sites as `hasResetExpr`. 15 unit tests. Self-host AST parity strip updated.

5. **Origin pull at wrap** — 1 behind / 4 ahead → rebase 4/4 clean; S95 silently-dropped-commits-check passed (all 4 messages preserved verbatim). Origin commit `30d9b7b` was a side-session website content sweep: 50 stub pages closing 277 broken-links + dark theme + flesh-out for 9 pages + 5 error-code reference pages + audit artifact at `docs/audits/scrml-dev-content-spec-fidelity-2026-05-19.md` + 6 dogfood bug reports filed to handOffs/incoming/.

6. **6 DOGFOOD BUG REPORTS** processed to handOffs/incoming/read/ (full report retained as canonical reproducer + workaround record):

   | # | Severity | Class | One-line |
   |---|---|---|---|
   | 1 | HIGH | BUG | Tailwind layer no-ops arbitrary-value classes (`grid-cols-[auto_1fr_auto]`) silently |
   | 2 | MED-HI | BUG | Multi-line `<a>` opener + entity-encoded element-name body → phantom E-SYNTAX-050 + 4-cascade |
   | 3 | MED | BUG | `[BS]` diagnostics omit file paths (sibling `[W-LINT-*]` includes them) |
   | 4 | LOW-MED | ERGONOMIC | Bare `?{` / `/` in markup copy parsed as tokens — no docs-mode escape |
   | 5 | HIGH | BUG | `${VERSION}` of a `const` emits empty placeholder + no-op JS — markup-as-value misfire on simplest shape |
   | 6 | MED | DOC-DRIFT | Shipped reference pages link to retired error codes (E-CHANNEL-INSIDE-PROGRAM + 4 others) |

   Triage order from side-session report: Bug 5 → Bug 3 → Bug 6 → Bug 1 → Bug 2 → Bug 4.

## Tests at S106 CLOSE

- **Pre-commit subset** (unit + integration + conformance): **13,024 pass / 92 skip / 1 todo / 0 fail / 677 files / 44,306 expect**
- **Full `bun test compiler/tests/`**: **15,867 pass / 173 skip / 1 todo / 0 fail / 710 files / 46,721 expect**
- Delta vs S105 close (full suite 15,841 / 708 files): **+26 pass / +2 files / +58 expect / 0 fail / 0 regressions**
- New tests by track: 11 B2 reconcile-list-same-keys-fast-path + 15 C1 has-equality-expr-flag = 26 (matches exactly)

## S106 commit ledger

| # | Commit (post-rebase) | Repo | What |
|---|---|---|---|
| 1 | `4842eea` | scrmlTS | chore(s106-open) maps refresh + 2 non-compliance fixes (10 files / +466 / -376) |
| 2 | `b267d36` | scrmlTS | feat(runtime) Phase 3.B B2 same-keys-in-same-order fast-path (+11 tests) |
| 3 | `6faf7a6` | scrmlTS | refactor(type-system) OQ-TF-13 _resolveAndCheckL22TypeName helper (pure refactor; 76 ins / 67 del) |
| 4 | `c491b12` | scrmlTS | feat(pgo) C1 hasEqualityExpr flag — sibling Option-2 pattern (+15 tests) |
| 5 | `<wrap-sha>` | scrmlTS | chore(s106-close) wrap — hand-off + master-list + changelog |
| (origin pull) | `30d9b7b` | scrmlTS | docs(website) scrml.dev content sweep (NOT this session — pulled from other-machine side session) |

Both repos pushed at close.

## State-as-of-CLOSE

| Item | Status |
|---|---|
| Tests pre-commit subset | 13,024 / 92 / 1 / 0 fail / 677 files |
| Tests full pre-push gate | 15,867 / 173 / 1 / 0 fail / 710 files / 46,721 expect |
| Test delta from S105 | +26 pass / +2 files / 0 fail / 0 regressions |
| Worktree list | main only (16 stale `worktree-agent-*` branches cleaned at session-open) |
| Origin sync (scrmlTS) | post-wrap push: 0/0 |
| Origin sync (scrml-support) | 0/0 (no changes this session) |
| Inbox `handOffs/incoming/` | empty (1 dogfood bug-report file moved to `read/` at wrap) |
| Path-discipline hook | active (Configuration A restored S106 OPEN; `scripts/git-hooks/pre-commit` + `pre-push` source-controlled baseline) |
| Post-commit hook | NOT INSTALLED (machine-local-only on other machine; not source-controlled) |
| Self-host bootstrap | unchanged (S102 broken-import-path persists; gitignored; pre-commit subset doesn't run self-host parity) |
| Maps watermark | `d8427f2` (S105) — **4 commits behind HEAD** (the 4 session landings). **S107 session-start MUST refresh BEFORE any dev-agent dispatch.** |
| scrml-support untracked | unchanged from S105 OPEN (voice articles + tools/ — user's territory) |
| 6 dogfood bug reports | in handOffs/incoming/read/; triage list at top of carry-forward S107 |

## Carry-forwards for S107

### High priority (6 dogfood bugs — adopter-friction-surfaced)

| # | Severity | Item | Cost |
|---|---|---|---|
| Bug 5 | HIGH | `${const}` interpolation empty-placeholder + no-op JS (markup-as-value pillar misfire on simplest shape) | needs scoping — pillar L4 implications |
| Bug 3 | MED | `[BS]` compiler diagnostics omit file paths | trivial fix; QoL win; ~1-2h |
| Bug 6 | MED | retired error-code references in shipped reference pages (sweep needed) | ~2-3h sweep across docs/website/pages/ |
| Bug 1 | HIGH | Tailwind arbitrary-value classes silent no-op | floor: lint unrecognized class names (~2-3h); full fix: support standard Tailwind arbitrary-value syntax (medium) |
| Bug 2 | MED-HI | Phantom E-SYNTAX-050 + 4-cascade on multi-line `<a>` + entity-encoded body | needs bisecting reducer first |
| Bug 4 | LOW-MED | Bare `?{` / `/` in markup copy — no docs-mode escape | deep-dive on design space (docs hardening / docs-mode lint / markup-text-mode tokenizer) |

### Substantive (mid-tier remaining from S105)

| Track | Item | Cost |
|---|---|---|
| Phase 3.B | B4 count-derived dep precision (agent-dispatched; Q-RT3B-OPEN-2 ratified) | ~3-5h |
| formFor v1.next | B2 per-type renderer registry `data.registerRenderer` | ~3-5h |
| formFor v1.next | B3 `@label("...")` type-field annotation | ~3-5h |
| formFor v1.next | B4 auto-recurse into nested struct fields | ~5-8h |
| formFor follow-on | B5 L2 label-store consultation IN expander | ~3-5h |
| PGO Phase 3 followup | C2 Markup/for-stmt double-walk fold in detectRuntimeChunks | ~2-3h |
| Phase 3 detector ext | C3 `in` / `.includes()` / deep-path-key | ~3-5h each |
| Pre-existing detector bug | C4 equality runtime-chunk detector inline-stub cleanup | ~2-3h |
| Native parser | M2 expression parser (~2-4 sessions per DD §D7) | ~2-4 sessions |
| Self-host bootstrap | broken-import-path investigation (S102 carry; still unaddressed S103-S106) | ~2-4h |

### tableFor v1.next follow-ups (6 newly-surfaced S105 — minus #1 which is closed by OQ-TF-13)

| # | Item | Cost |
|---|---|---|
| 2 | §41.16.7 sort-state cell as explicit state-decl (currently inline writes) | small |
| 3 | §41.16.8 `E-TABLEFOR-SELECTABLE-CELL-WRONG-TYPE` strict-mode fire-site | small |
| 4 | OQ-TF-7 positional/computed `<column>` slots (for non-struct columns like Delete buttons) | medium |
| 5 | §17.4a for/else codegen (pre-existing gap; affects all `<empty>` slot text emission) | medium |
| 6 | `date`/`timestamp` BUILTIN_TYPE entries (cross-L22 normalization story needs scoping — formFor's `inputShapeForFieldType` switch differs from schemaFor + tableFor type-name dispatch) | small but needs cross-L22 scoping |
| 7 | Inline event handler shape with non-`event` arrow param | small |

### v1.0+ follow-up (carry from S105)

- Structural cleanup of browser-test effect-leak pattern (G1 close residue)

### Light (cleanup)

- **Maps incremental refresh required at S107 session-start** — 4 commits behind watermark (this session's commits)
- OQ-TF-11 sub-debate (if user contests MEDIUM verdict on row binding `:let` vs implicit `@row`)
- Puppeteer dep cleanup (Q-PW-PORT-OPEN-1 ratified DEFER; awaiting 1-2 release cycles)
- LEGACY `_scrml_subscribers` retirement (v0.4+; Q-RT3-SR-OPEN-3 ratified DEFER post-impl)

### Marketing-shaped (per pa.md Rule 1 — DEFER unless raised)

- formFor + schemaFor + tableFor combined sample app + scrml.dev refresh + README compile-gate block
- L22 family 4-of-6-shipped narrative + tableFor admin-UI-lift adoption pitch
- v0.4 announce content
- Side-session-website-content-sweep adoption story (50 stubs + 9 fleshed-out pages + 5 error refs)

## Things S107 PA must NOT screw up

In addition to S96-S105 carry-forwards:

- **Maps refresh BEFORE any dev-agent dispatch** — 4 commits behind watermark. Invoke project-mapper incremental at session-start. (project-mapper at this session hit a write-permission block; check if that's resolved at S107.)
- **6 dogfood bug reports are NOT to be silently dropped** — they're high-value adopter-friction-surfaced bugs from real dogfooding. The triage order from the side-session report stands unless user re-directs.
- **Bug 5 is load-bearing on markup-as-value pillar L4** — when scoping the fix, verify against SPEC §1.4 + §7.4.1 (markup-as-expression). Don't decide from PRIMER summary per pa.md Rule 4.
- **Bug 6 sweep needs current SPEC §34 catalog as reference** — don't grep-match against PRIMER paraphrasing; pull the canonical code list from compiler/SPEC.md.
- **Hook gate is restored to Configuration A** — if `core.hooksPath` is unset OR points to `.git/hooks` empty-dir again at S107 open, restore with the one-liner per the established pattern.
- **runtime-results.json drift** — bench output during this session was on Bun 1.3.6; the committed baseline is on Bun 1.3.13. If S107 does runtime perf work, re-measure on matched Bun for clean comparison.

## Session-start checklist for S107 PA

1. Read `pa.md` pointer → `../scrml-support/pa-scrmlTS.md` IN FULL
2. Read `docs/PA-SCRML-PRIMER.md` IN FULL (Pillar 5b applies)
3. Read `compiler/SPEC-INDEX.md` IN FULL — no new SPEC sections landed S106 (the §48.6.4 status-flip in §34 + body was the only SPEC change)
4. Read `master-list.md` §0 LIVE DASHBOARD IN FULL — note S106 CLOSE addendum at top
5. Read this `hand-off.md` (S106 CLOSE) — will be rotated to `handOffs/hand-off-109.md` at S107 open
6. Read last ~10 contentful user-voice entries — no new entries this session
7. Sync hygiene: `git fetch origin && git rev-list --left-right --count origin/main...HEAD` should be 0/0
8. Inbox check — `handOffs/incoming/*.md` should be empty (1 dogfood bug file in `read/` from S106)
9. Verify worktrees: `git worktree list` shows main only
10. Verify hook gate: `git config --get core.hooksPath` should be `scripts/git-hooks` (Configuration A; restored S106 OPEN). If anomaly recurs, restore with `git config core.hooksPath scripts/git-hooks`.
11. Self-host bootstrap state check — `ls -la compiler/dist/self-host/`; partial-broken state persists from S102; decide whether to investigate OR delete to skip cleanly
12. **Maps currency check + REFRESH** — `head -3 .claude/maps/primary.map.md` will show `d8427f2` watermark; HEAD is now `<wrap-sha>` (4+ commits ahead). REFRESH BEFORE any scrml-source-shape dispatch.
13. **Surface carry-forward list** — top priority is the 6 dogfood bugs (Bug 5 + Bug 3 + Bug 6 lead the triage); mid-tier Phase 3.B B4 unblocked for agent-dispatch.
14. Report: caught up + next priority

## Tags

#session-106 #CLOSE #AFK-arc #phase-3b-b2-SHIPPED #oq-tf-13-SHIPPED #pgo-c1-SHIPPED #maps-refreshed #non-compliance-fixes-folded #origin-pull-rebase-clean #website-content-sweep-PULLED #6-dogfood-bugs #worktree-cleaned #pre-commit-13024 #full-suite-15867 #+26-from-S105 #hook-gate-recurrence-restored
