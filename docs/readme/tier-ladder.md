# The tier ladder

State rarely starts as a state machine. scrml lets it *become* one. You start with a rough prototype and add structure as the design hardens, **without rewriting the markup tree.** The state-children carry forward verbatim between tiers; swapping the wrapper is the only commitment.

| Tier  | Form                                       | What you get                                                           |
|-------|--------------------------------------------|------------------------------------------------------------------------|
| **0** | `if=` chains / `${ if (...) lift ... }`    | prototype, no exhaustiveness check                                     |
| **1** | `<match for=Type [on=expr]>` + `<each>`    | compile-time exhaustiveness; `rule=` is accepted but does nothing yet (a lint nudges promotion) |
| **2** | `<engine for=Type initial=.Variant>`       | exhaustiveness + transition rules + per-state effects (`<onTransition>` / `<onTimeout>` / `<onIdle>`) + nested engines + `history` restore |

The engine surface beyond the demo (nested sub-engines, `history` restore on re-entry, named timeouts with `cancelTimer()`, idle watchdogs) is exercised in [`examples/14-mario-state-machine.scrml`](../../examples/14-mario-state-machine.scrml), and explained in [NERDME.md → Realtime and workers / engines](../../NERDME.md#realtime-and-workers).
