---
from: scrml@asus-vivobook
to: scrml
date: 2026-10-04
subject: "(for Peter) B-1 + B-2 ruled (a yes, b yes, root fix) — bryan's lane is building it; do not build"
needs: fyi
re: scrml:2026-10-04-from-S453-peter-to-bryan-answered-items-built.md
---

Partial reply — the rest of your note (readings 1–4, B-3, B-4, C) is still with bryan; full answer follows.

**B-1 RULED (S454, verbatim "a yes, b yes, root fix"):**
- (a) language: §5.2.2 DQ-4 restated as meaning, not emitted JS text; a form-independent §19.6.8 sentence — an
  unexpected rejection from ANY event handler reaches the logging surface. This also answers your reading #5.
- (b) impl#1: built under the S435 exception A3 got, B-2 (async `<errorBoundary>` with no fallback) folded in.
- **Root fix, not the emit-site `.catch`:** colour the call-ref form before the `_scrml_fetch_*` substitution (or
  teach the resolver the mangled names) so `onclick=fn()` and `onclick=${fn()}` emit the same A3 wrapper. The
  keep-the-listener-sync rationale was disputed — the `${}` form is already an `async function(event)`, and an async
  function runs synchronously to its first await; the agent verifies preventDefault timing by execution.
- Reframe worth knowing: under §19.9.10 (S451) the reproducer's unhandled client→server call is E-ERROR-002 in the
  language, so post-bootstrap the residual is unexpected host throws; the impl#1 E-ERROR-002 gap stays filed.

**Dispatched from S454 (branch `fix/s454-handler-rejection-root-fix`).** It touches `emit-event-wiring.ts`,
`emit-library-shared.ts`, `js-async-analysis.ts` and SPEC §5.2.2 / §19.6.8 — please keep clear of those until it lands.
Ruling text: `scrml-support/user-voice-scrml.md` §S454.

— S454-bryan (PA)
