# ss60 sPA re-integration → PA

**List:** `spa-lists/ss60-conformance-ssr-protect-floor.md` (6 items — SSR §52.8 + protect-floor §14.8.9)
**Branch:** `spa/ss60` · **tip:** `d8368589` · **base:** `origin/main` @ `cfba6295` (1 commit ahead, 0 behind)
**Date:** 2026-07-03 · **Built:** sPA-DIRECT in worktree `../scrml-spa-ss60` (disjoint additive `conformance/cases/` data)

## TL;DR — the item-1 harness gate resolved NO, and the gap is bigger than item 1
The list flagged item 1 (SSR runtime) as harness-verify-first. Verified: the conformance adapter **mocks the
server** (fetch-mock returns `serverStub` verbatim; the compiler-emitted server handler never runs). ALL
§14.8.9 redaction + §52.8 SSR compose are **server-side**, so the RUNTIME halves of items 1-4 are NOT soundly
observable, and item 6's WS/SSE runtime has no driver. I landed the **compile-time codes** (the sound surface)
and escalated a **track-B adapter extension**. **The PA footprint's "items 2/4 harness-clean via fetch-mock"
is corrected — the fetch-mock BYPASSES the redaction sink.**

## Landed @ `d8368589` (7 cases; oracle 72→79 green)
| # | item | landed | gated (escalated) |
|---|------|--------|-------------------|
| 1 | SSR §52.8 first-paint render | `ssr/ssr-first-paint-render` (compile-clean, runtime-half-pending) | RUNTIME — SSR compose |
| 2 | §14.8.9 server-fn return redaction | `protect/strip-info-select-star` (I-PROTECT-STRIP-001) | RUNTIME — client-visible absence |
| 3 | §14.8.9 SSR redaction | folded (protect+SSR combo hits E-AUTH-005; essence is runtime) | RUNTIME — SSR compose |
| 4 | `reveal` declassification | `protect/reveal-suppresses-e004` | RUNTIME — client-visible presence |
| 5 | protect codes | `protect/{raw-egress-e004, safe-projection-no-strip}` (+ strip/reveal above) — **FULL** | — |
| 6 | channel/SSE protect egress | `protect/{channel-broadcast-strip, sse-yield-strip}` (I-PROTECT-STRIP-001) | RUNTIME — no WS/EventSource driver |

**Parked (runtime, adapter-gated):** items 1,2,3,4 client/SSR runtime + item 6 WS/SSE runtime. **Dropped:** none.
severity assertions pin the §34 partition (E-PROTECT-004=error, I-PROTECT-STRIP-001=info).

## What landed (the sound compile-time §14.8.9 floor)
The protect-floor's compile-time surface is now conformance-pinned across every egress context: server-fn
return (I-PROTECT-STRIP-001 on SELECT*), raw/foreign egress fail-closed (E-PROTECT-004 on `new Response`),
`reveal("col")` declassification (suppresses E-PROTECT-004), the safe-projection negative control (no code),
and the channel `broadcast()` + SSE `server function*` egress sinks (I-PROTECT-STRIP-001). Plus the SSR
canonical source compiles clean (runtime-half-pending, ref → the D2 browser test).

## Verification
- `bun conformance/run.ts` = **79/79 green** on impl#1 (independently re-runnable).
- The one commit passed the full pre-commit hook (green landing). Coherence `origin/main...HEAD` = `0 1`.
- Empirical-first: every code captured from impl#1 via probe, cross-checked against §14.8.9 / §52.8 read in
  full + the impl test `compiler/tests/integration/g-sql-row-protect-leak.test.js`. **No impl#1-vs-SPEC
  divergence** — the protect codes + SSR compile behavior all match spec.

## Escalations (PA/infra — NOT decided by sPA)
- **E-ADAPTER (blocks all runtime halves — the central ask).** Extend `conformance/adapters/impl1-ts.ts` to
  (a) run the actual compiled **server route handler** (not the fetch-mock) so the §14.8.9 redaction sink
  executes and item-2/4 client-visible redaction becomes observable; (b) invoke **`_scrml_ssr_compose_handler`
  + seed `window.__scrml_ssr_state`** for SSR first-paint (items 1/3) — borrow the D2 browser harness
  `compiler/tests/browser/ssr-a-terminus-hydration.browser.test.js`. Then the parked runtime halves are all
  authorable. This is the real shape of the list's item-1 gate.
- **E-CSRF-HELPER.** The harness runtime template lacks `_scrml_fetch_with_csrf_retry`; a protect-`<db>`
  client mount throws `ReferenceError` on load. Add it to the harness runtime (sub-item of E-ADAPTER).
- **Design note (no action).** Item 3's SSR+protect source hit `E-AUTH-005` when the authority type sits inside
  a `<db protect=>` block (server-context resolution). Not a bug — the canonical SSR shape is `<program db=...>`
  + authority type; combining protect= with it needs the right structure, which is moot until E-ADAPTER lands.

## Notes for the PA (re-integration)
- Re-integrate via S67 file-delta: pure-additive `conformance/cases/protect/*` (6 dirs) + `conformance/cases/ssr/*`
  (1 dir). Clean.
- Worktree `../scrml-spa-ss60` left in place (clean tree); `node_modules` are SYMLINKS into main — don't copy.
- `spa-lists/ss60-conformance-ssr-protect-floor.md` markers + `spa-lists/ss60.progress.md` written in MAIN's
  working tree (uncommitted) for you to fold in.
- Confirm `bun conformance/run.ts` = 79/79 independently before folding.
