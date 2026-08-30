# ROUTE → bryan (S389-peter): two `<channel>` semantics gaps from the S389 dog-food

Both found dog-fooding the `<channel>` surface (flogenceP), alongside the echo-storm HIGH already
fixed and landed (#782). Neither is fixed here — both hinge on a channel-semantics decision that is
your lane. PA-confirmed by execution on HEAD.

---

## 1. Cross-channel cell-name collision silently aliases + leaks (MED)

Two channels that each declare a synced cell of the **same name** (`<count>`), mounted in one
`<program>`, share the SAME reactive cell — a write on one publishes a `__sync` on **both** channels'
topics, and an inbound sync on either writes the shared cell. **Zero diagnostics.**

**PA-confirmed:** the emitted client keys channel cells by the BARE cell name in the chunk-global
reactive store (`emit-channel.ts` — the onmessage `__key` match and the `syncShared` effect both use
the verbatim cell name), so two channels' `count` resolve to one cell. flogence's own channel sources
call this out ("two channels mount in one cockpit scope so cast names must not collide") and avoid it
only by manual naming discipline — the compiler gives no guardrail.

**Fork (your call):**
- **A — DIAGNOSTIC (compute half, PA-buildable once ruled).** Fire a diagnostic when two mounted
  channels in one consumer declare the same synced-cell name. Minting the code is a language-surface
  call (it decides what the language refuses), hence routed — but the detection itself is
  straightforward compute.
- **B — AUTO-NAMESPACE.** Namespace channel cells per channel in the store + wire `__key`
  (`chName.cell`), so same-named cells on different channels are independent. Semantics-changed; larger;
  removes the footgun entirely rather than refusing it.

PA lean: **A** (limit-primitives — refuse the collision, don't silently grow a namespacing model nobody
asked for), unless you intend channels to compose freely in one scope, in which case B.

## 2. A channel does not re-sync a cell's current value on socket (re)open — late-join state (design)

The auto-sync effect fires once at mount; if the socket is still CONNECTING (the real-browser case),
`syncShared` returns false and the effect never re-runs on `onopen`, so a cell's current value is
**never pushed after the socket opens**. A subscriber that holds state before connecting, or reconnects
after a drop, does not propagate its current value until the next local change.

⚑ **Surfaced BY the echo-storm fix (#782), not caused by it.** The old ≥2-subscriber storm accidentally
re-converged state by bouncing frames; killing the storm removes that masking. **Not a regression** —
the channel was unusable with 2 subscribers before #782, and casts (the actual signals) propagate
correctly after it. But "what state does a late-joining or reconnecting subscriber see?" is now an
open, honest question.

**Fork (your call):** (a) client `onopen` re-sync — re-fire the sync effects on open, pushing current
values (dedup-aware, cheap, PA-buildable); (b) server sends current shared state to a NEW subscriber on
subscribe (a fuller "shared state" model); (c) both. This is a channel-semantics ruling (§38.4 late-join
contract), so it lands on you before a build.

**Related (same root, noted in #782, not re-filed):** the general echo cause — no value-dedup in
`_scrml_reactive_set` + the server's unconditional `__sync` re-broadcast — could be closed once in the
reactive core instead of per-channel. A runtime-semantics decision, also yours.

— filed as `g-cross-channel-cell-name-collision-silently-aliases` (MED) and
`g-channel-no-resync-on-socket-open-late-join-state` (MED) in `docs/known-gaps.md`.
Repros in `scratchpad/channel-dogfood/` (collide/) + the S389 dog-food harnesses.
