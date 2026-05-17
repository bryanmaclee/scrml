# scrmlTS — Session 100 (OPEN-pickup-pending)

**Date:** 2026-05-17 (rolled forward; first commit of S100 fixes this)
**Previous:** `handOffs/hand-off-101.md` (S99 CLOSE — comprehensive end-to-end summary; Machine-B-wrap-content + Machine-A-consolidation-section both present)
**Machine:** TBD at session-open (either A or B; cross-machine state is symmetric)

---

## S100 first action — FIRE-NOW (user-authorized at S99 CLOSE)

**Tailwind engine gap — option (a)** locked for next-session pickup. User verbatim S99 CLOSE: *"A the tailwid dir"*.

**Dispatch shape:**

| | |
|---|---|
| **Task** | Extend the built-in Tailwind engine to cover typography plugin + missing core utilities |
| **Audit-surface utilities** (minimum) | `font-mono`, `prose` family (incl. `prose-slate`, `prose-lg`, `not-prose`, etc), `border-collapse` + spot-check pass across `docs/website/` for other missing utilities |
| **SPEC impact** | Likely add §26.6 NEW "Typography Plugin" subsection. SPEC §26 currently covers integration model + variant prefixes (S49) + arbitrary values (S49) + Open Items (group-* / peer-* / custom-theme deferred). Typography plugin is NOT in scope today; this dispatch is BOTH compiler change AND SPEC amendment. |
| **Likely files** | `compiler/src/codegen/emit-tailwind.ts` (or equivalent — verify location) + `compiler/SPEC.md` §26.6 + tests |
| **Scope** | ~8-15h depending on typography plugin coverage breadth (full vs scoped-to-docs-usage) |
| **Rationale** | Flagship-claim alignment per `docs/website/pages/articles/css-without-build-step.scrml` ("scrml has a built-in Tailwind engine ... No `tailwind.config.js`, No PostCSS. The engine is in the compiler."). Adopter-visible drift — Machine B's docs site uses `prose` family heavily; compiled output omits them; Tailwind Play CDN injection is the band-aid Machine B applied. |
| **Authority** | pa.md Rule 2 (full-production fidelity) + Rule 3 (right answer beats easy 99.999%) + flagship-claim alignment |
| **Bug-report context** | See archived `handOffs/incoming/read/2026-05-17-1815-machine-B-to-machine-A-dev-server-routing-bug.md` (S99 ADDENDUM section — Tailwind-engine-gap detail + repro + workaround + 3 fix-shape options + PA recommendation A) |

**Fire as scrml-dev-pipeline isolation:worktree dispatch on session-open** after standard session-start checklist completes.

---

## Standard S100 session-open checklist (per pa-scrmlTS.md)

1. Read pa.md pointer at `scrmlTS/pa.md` → `scrml-support/pa-scrmlTS.md` IN FULL
2. Read `docs/PA-SCRML-PRIMER.md` IN FULL (Pillar 5b applies)
3. Read `compiler/SPEC-INDEX.md` IN FULL
4. Read `master-list.md` §0 LIVE DASHBOARD IN FULL (load-bearing)
5. Read this `hand-off.md` + S99 CLOSE rotation at `handOffs/hand-off-101.md`
6. Read last ~10 contentful entries from `../scrml-support/user-voice-scrmlTS.md` (S99 has 7 new entries — 3 from Machine B + 4 from Machine A; all load-bearing)
7. Cross-machine sync hygiene: fetch + ahead/behind both repos
8. Check `handOffs/incoming/*.md` for unread messages
9. Verify `git worktree list` shows only main
10. Report: caught up + next priority

---

## State at S99 CLOSE (S100 starting baseline)

- **scrmlTS HEAD:** Machine A consolidation wrap (after Machine B's `a6dd6af` + Machine A's `fc27960` MPA fix + `7fa0dab` inbox housekeeping + the wrap commit landing this file)
- **scrml-support HEAD:** `e149662` (S99 Machine-A user-voice entries + user DRAFT refinements)
- **Tests (full suite):** 15,342 pass / 133 skip / 1 todo / 2 fail / 1 error / 687 files / 44,255 expect
- **Tests (pre-commit subset):** 12,555 pass / 92 skip / 1 todo / 0 fail / 654 files
- **Worktrees:** main only (both machines per per-dispatch cleanup discipline)
- **Inbox:** state per `handOffs/incoming/` — Machine B's MPA-revert reply pending; Machine A's S100 pickup awaits that

---

## Carry-forward priorities (sequenced for S100)

### Fire-now

1. **Tailwind engine gap (option a)** — see top of this file. Estimated ~8-15h. SPEC §26.6 amendment likely.

### High-impact compiler / docs work

2. **MPA workaround revert** (Machine B territory). Once Machine B pulls Machine A's MPA fix landing, revert the hard-coded `/pages/` workaround in 8 files (`docs/website/app.scrml` + 7 page files). See `handOffs/incoming/2026-05-17-1900-machine-A-to-machine-B-mpa-fix-landed.md` for the checklist.

3. **SPEC §47.9.5 worked-example amendment** — dist paths in §47.9.5 show the un-stripped `pages/` shape; should reflect the MPA fix's strip. Small editorial dispatch.

4. **bug-k-sync-effect-throw investigation** — pre-existing orthogonal pre-push failure since S98. Each push needs `--no-verify` + explicit authorization until closed. ~1-2h dispatch candidate.

5. **Continue Day-30 reference build-out.** Remaining ~22-30 pages: `<onTimeout>` + `<onIdle>` (closes elements); `#{}` + `^{}` + `_{}` contexts; ~11 keyword pages; ~30 error code pages. Each follows the 8-section template. ~3 pages per batch is sustainable.

### Held by user

6. **lin redesign Phase 1** — user paused S98.
7. **Typestate-primitive meta-shape** — design horizon stub at scrml-support `124204e`.
8. **Voice corpus curation pass** — 1,577 candidates across 3 streams awaiting selective promotion to canonical `quote-library.json`.
9. **State-vs-logic essay finalization** — user-authored; PA's role is substrate per S95 voice-author redesign.

### v0.5+ horizon

10. **CG hotspot deep characterization**.
11. **BS-level `/* */` bug** — sub-anomaly from S98 A1 fix.
12. **Path-discipline platform-level fix** (PreToolUse hook rejecting absolute writes outside active worktree). 6 incidents in S99; escalating-urgency case. Filed since S42; still deferred (needs context-aware "is this PA or subagent" signal).
13. **Phase B-2 pure-getter-elision optimization** — marginal output-bloat reduction for is-some/is-not LHS that's known-safe to inline (specific MemberExpr/IndexExpr shapes type-system can prove no getter/Proxy). Not blocking.
14. **Legacy STRING pipeline retirement** (`rewrite.ts _rewriteParenthesizedIsOp`) — composes with Phase 3.5 escape-hatch elimination.

---

## Open observations for S100 PA awareness

### gingerBill window context

S99 surfaced the first peer-language-designer attention event (gingerBill DM mid-session). Triggered README + master-list + hand-off state-refresh so the README link chain reads current-truth. Voice-author cross-essay tie-in: Machine B's state-vs-logic essay rev-2 swapped Quote 3 → public reply to @TheGingerBill on twitter/X 2026-05-15. See user-voice S99 Machine-A entry "gingerBill DM event" for full context.

### Path-discipline pattern (6 incidents in S99)

`pa-scrmlTS.md` S99 addendum (scrml-support `65eaab7`) documents the 4 operational tightenings. Empirical-record convention: every PA-authored landing that hit a leak includes `PATH-DISCIPLINE INCIDENT` in commit body for grep-based audit. Rate of incidence makes the platform-level PreToolUse-hook fix (#12 above) load-bearing for v0.4+ dispatch quality.

### Context budget operational datum (S99 Machine A)

Per user-voice S99 Machine-A entry: session-start checklist consumes ~20% of the 1M-token context (pa.md + PRIMER + SPEC-INDEX + master-list §0 + hand-off + user-voice). Effective working budget = ~80% nominal. Wrap-suggestion threshold should subtract session-start overhead from the calculation.

---

## Things S100 PA must NOT screw up (carry-forwards from S99 CLOSE)

### Permanently load-bearing
- pa.md Rules 1-5
- All S96-S99 PA-memory rules in `~/.claude/projects/-home-bryan-*scrmlMaster-scrmlTS/memory/`
- Cross-machine sync hygiene (S43)
- S83 commit discipline two-sided rule
- S88 isolation:worktree mandatory on every dev-agent Agent() call + `--no-verify` requires explicit user authorization
- S91 CWD-routing rule
- S95 communication norms (shoot straight)
- S96 SPEC-at-session-start
- S98 Pillar 5b (Reach discipline — state-shape first)
- S99 path-discipline addendum (echo-pwd-in-first-commit + S99 leak-counter in briefs + PA-side dual-verify)
- S99 voice-author "reuse-over-reinvent" rule

### S100 NEW (fresh)

(none yet — this is OPEN-pickup state)

---

## Tags

#session-100 #OPEN-pickup-pending #s100-fire-now-tailwind-option-a #post-s99-close #ginger-bill-window-context #path-discipline-pattern-tracking #v0.3.x-patch-arc-active
