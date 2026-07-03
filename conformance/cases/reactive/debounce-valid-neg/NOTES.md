# §6.13 debounce/throttle — conformance coverage notes

**Codes** (this item): the three §6.13 reject diagnostics are covered as sibling cases —
`reactive/debounce-on-derived` (E-DEBOUNCED-WITH-DERIVED), `reactive/reactivity-attr-conflict`
(E-REACTIVITY-ATTR-CONFLICT), `reactive/debounce-on-server` (E-DEBOUNCED-WITH-SERVER). This
case is the codes-negative: a valid `debounced=` Shape-1 decl fires none of them.

**Runtime coverage state (currency-corrected — the ss59 list premise is stale):**
- The virtual clock has LANDED (`conformance-virtual-clock-2026-07-03`): `driver.ts` documents
  the ratified `{ "advance-time": N }` verb. So §6.13 timing is NO LONGER harness-gated.
- **Throttle LEADING edge** runtime IS covered — `reactive/throttle-leading` (a synchronous
  leading fire, drains via settle, no advance-time needed).
- **Debounce / throttle TRAILING (coalesced) commit** runtime is BLOCKED by an OPEN bug:
  **G-DEBOUNCE-THROTTLE-TRAILING-NO-COMMIT** (docs/known-gaps.md, MED, S235). The
  reactivity-bypass re-route means the expiry closure's `_scrml_reactive_set` re-enters the
  debounce/throttle wrapper and re-arms indefinitely instead of committing the trailing value —
  confirmed with REAL timers, NOT a virtual-clock artifact. So a trailing-fire runtime case
  would assert a never-committing (buggy) value; it is DELIBERATELY NOT authored (would enshrine
  a known bug). Once the bug is fixed, add a debounce-trailing + throttle-trailing sibling via
  the `advance-time` verb (the known-gaps entry already notes this conformance follow-on).
