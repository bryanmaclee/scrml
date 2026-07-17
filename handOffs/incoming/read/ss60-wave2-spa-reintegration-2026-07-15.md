# sPA ss60 Wave-2 — REINTEGRATE (tier-1 security/serialization codes)

**From:** sPA ss60 (resume session, 2026-07-15) · **To:** PA
**List:** `spa-lists/ss60-conformance-ssr-protect-floor.md` → **Wave-2** (items 7-17; items 1-6 were the earlier ss60 session, untouched)
**Branch:** `spa/ss60` · **worktree:** `../scrml-spa-ss60`
**Branch tip:** `5ae2d961` · **base (merge-base):** `bdb9b6ac`

## TL;DR
All **11 Wave-2 tier-1 security/serialization codes** pinned (codes-half: reject pos + clean neg per code,
plus cross-stream-honest severity assertions on every W-/I- lint). Conformance **522 → 544 (+22 cases)**, all green.
**Zero parked, zero dropped.** Two escalations for you (below) — both are RULINGS I must not make.

## Landed (per-item SHAs)
| items | codes | SHA | category |
|-------|-------|-----|----------|
| 11-14 | E-PROTECT-003, E-PA-002, E-PA-005, E-PA-006 | `d3193b7d` | `conformance/cases/protect/` |
| 15-16 | E-ROUTE-003, E-ROUTE-004 | `c0db8c70` | `conformance/cases/server-fn/` |
| 7-10,17 | W-AUTH-CONTENT-NOT-GATED, W-SERVERLOAD-UNGATED, W-SSR-PRERENDER-UNSCOPED, W-AUTH-LOGIN-MISSING, I-AUTH-REDIRECT-UNRESOLVED | `46e1e6a4` | `conformance/cases/auth/` + `conformance/cases/ssr/` |
| bookkeeping | list markers + progress log | `5ae2d961` | `spa-lists/` |

New case dirs (24 files, 11 codes × pos/neg):
- `protect/{e-pa-002,e-pa-005,e-pa-006,e-protect-003}-{pos,neg}`
- `server-fn/{e-route-003,e-route-004}-{pos,neg}`
- `auth/{w-serverload-ungated,w-auth-content-not-gated,w-auth-login-missing,i-auth-redirect-unresolved}-{pos,neg}`
- `ssr/{w-ssr-prerender-unscoped}-{pos,neg}`

## Verification
- `bun conformance/run.ts` → **544/544 pass** (was 522 at my base). Each cluster re-verified green before its commit.
- Every commit ran the full pre-commit suite (20360 tests / ~150s) green, except the docs-only bookkeeping (auto-skipped).
- Reproducers lifted from the impl's own tests where the trigger was non-obvious: E-ROUTE-003/004 ←
  `route-wire-serializability.test.js`; E-PROTECT-003 batch-hoist ← `sql-batch-5b-guards.test.js`;
  W-SERVERLOAD-UNGATED / W-SSR-PRERENDER-UNSCOPED ← `server-load-authority.test.js` (full-compile shapes).

## ⚠️ ESCALATIONS (PA/user rulings — I did NOT decide these)
1. **error-vs-warning for the security trio** (the list's TOP FINDING, "security trio"). These three fire only
   `warning` today and are now pinned at `warning`:
   - `W-AUTH-CONTENT-NOT-GATED` — `<auth role>` ships gated HTML to all viewers (content-secrecy footgun)
   - `W-SERVERLOAD-UNGATED` — a server-authority read route reachable anonymously under an auth-aware app
   - `W-SSR-PRERENDER-UNSCOPED` — auth-scoped Tier-1 SELECT * bakes cross-user rows into the first paint
   **Ruling needed:** should any of these be a freeze-blocking **error**? If re-ruled, the `severity` assertion
   in that code's pos case flips (a one-line edit per code) — flag me or do it at reintegration.

2. **DIVERGENCE — item 10 (W-SSR-PRERENDER-UNSCOPED) is NOT the info-lint the list expected.** The W2 list note
   said "the SSR fix in flight converts this into a fixed+pinned info-lint — author against info". That SSR fix
   was **HELD** (`8cb00161`: "SSR fix HELD (#50)"), so the LIVE severity is still **`warning`**. I authored +
   pinned against live `warning` (verified empirically — the `"warning"` severity assertion passes; an `"info"`
   assertion would have failed the cross-stream check). **Re-pin to `info` if/when the held SSR fix lands.**

No impl#1-vs-SPEC divergence found for the 11 codes; every trigger matches its cited §.

## Reintegration notes
- **Concurrency:** a live **ss73 sPA owns the main checkout** (`spa/ss73`, actively committing channel §38 cases).
  I worked entirely in the `../scrml-spa-ss60` worktree and **never touched the main checkout / main branch**.
  This ping is the only file I wrote outside the worktree (into your inbox, untracked — matching the ss71/ss72 pings).
- **Base is 1 behind main:** origin/main advanced to `211dc076` (your ss61/ss68/ss72 batch, PR #58) after I branched
  off `bdb9b6ac`. My cases are purely **additive new dirs** → cherry-pick / file-delta onto current main cleanly.
  Low-risk check: confirm `211dc076` did not already create any of my 12 case dir names (it shouldn't — disjoint
  code families).
- **Do NOT push / no main advance** (sPA discipline). Reintegrate via your normal file-delta + `run.ts` green.
- **DoD met:** all 11 codes pinned (codes + severity partition); the error-vs-warning questions escalated per code,
  not silently enshrined.
