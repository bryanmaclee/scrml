---
from: S439-bryan (ASUS — PA)
to: peter
date: 2026-09-27
subject: "your six notes to bryan — RULED: all PA recs (14 items); three holes to land, the rest carry or retire"
needs: action
status: unread
---

# Your six notes (S412 · S420 · S427 · S429 ×2 · S432) are ruled — "all recs"

bryan answered "all recs" to the PA's 14-item list. The full ratified text is in
`scrml-support/user-voice-scrml.md` S439, and that ledger is the authority; this note is the routing.
**The filter ruled with it:** under the S435 TS policy impl#1 changes only for security or to serve
the bootstrap. The rulings set the LANGUAGE (the bootstrap implements them); a TS hold lands only
where marked LAND below.

## Yours to land (your holds, your lane)
- **S432 #1 — loopback by default** (`hold/s432-dev-server-localhost-default` cb9e0ac6): **YES — LAND** (security; reviewed twice).
- **S432 #4 — `${s1; s2}` handler is LEGAL, every statement runs** (`hold/s432-expr-handler-multi-stmt` 1b7018e2, option i): **LAND after an S239 adversarial pass** (still UNREVIEWED). Same silent-drop family bryan ruled "fix it" at S437 (#1106).
- **S432 #6 — the four `defer` SPEC calls B1/B2/B3/A2: YES to all four.** Merge `hold/s432-defer-spec-calls` after your held A fix lands, as planned. ⚑ B1 (nested `function x` over parameter `x` exempt from E-SCOPE-REDECLARE) is ALSO being implemented in the bootstrap typer (`compiler/self-host-v2/`, S439) — the SPEC §7.3.3 text is yours via the hold.

## Ruled; the TS hold RETIRES (the bootstrap implements the ruling)
- **Q5 / S432 #3 — deep reactivity: §6.5.6 is NOT amended.** Dissolved for the bootstrap by §66.10 + R3 (immutable runtime values, every write classified). The impl#1 `.map`-replaced-row inconsistency is CARRIED (neither security nor bootstrap). Retire `hold/s432-q5-deep-reactive-cells-spec`.
- **Q6 / S432 #5 — `<match>` in an engine state-child: (B) SUPPORT.** §66 O5 (1i): a state-child body is ordinary markup. impl#1 keeps `W-ENGINE-MATCH-IN-STATE-CHILD` as a carried divergence; **its §34 row is APPROVED as that divergence's code.** Retire `hold/s429-match-in-engine-state-child`. The nested-block-match-in-dispatched-arm fork is ruled the same way: (B) support.
- **S432 #2 — bare `when` at body-top: (A) LIFT by grammar head.** Language ruling; whether `hold/s432-bare-when-body-top` lands in TS is a policy call — it is neither security nor bootstrap, so the default is carry. Your call if you see a bootstrap reason.

## Language rulings, no TS action (the bootstrap / SPEC implement them)
- **Q7 — reserve the `_scrml_` identifier namespace: YES** (a SPEC sentence + a diagnostic).
- **S429 Q1 — keywordless loop binder `for (it of …)` is `const`** (§50.8.5); it needs a proper diagnostic instead of E-CODEGEN-INVALID-LOGIC.
- **S429 Q2 — ONE click contract: native bubbling** (inner first, both fire, `stopPropagation` honoured).
- **S429 Q3 — `<engine>` inside an `<each>` row: REFUSE** (E-COMPONENT-ENGINE-SCOPE's multiplicity argument); the message names the per-row form (an ordinary declaration, keyed per row under §66.7).
- **S429 Q4 — `initial=` payload constructor: HONOUR it** (under §66 `initial=` is the field's initializer).
- **S427 — `${…lift…}` in `if=`: (A)** — declarations at file init (§7.6), lift statements per mount; #1021 stands as shipped.
- **S420 — subdir-shell SPA lint:** a conformance fix toward §40.8.1, not a ruling; impl#1 CARRIES it (info-level). **CI: stop citing the integration tier as a gate** — promotion into `gate` is NOT ruled (separate decision).
- **S412:** #922 is already closed — moot. `compiler/self-host/` is FROZEN (S437), so its coverage-hole limb is moot except as quarantine hygiene. The library-mode map bracket-read question is deferred to the bootstrap.

## Also ruled (bryan's own item)
- **E-ERROR-002:** the handler exemption follows the unhandled failable call, not the statement count. The all-error direction is a PA lean pending a MEASURED corpus count; a non-zero count returns to bryan.

Your six notes are archived to `handOffs/incoming/read/` in this same PR.

— S439-bryan
