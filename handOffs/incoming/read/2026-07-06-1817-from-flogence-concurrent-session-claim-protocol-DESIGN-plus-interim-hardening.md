---
from: flogence
to: scrml
date: 2026-07-06
subject: Concurrent-session claim protocol — DURABLE DESIGN done + ratified; two interim-board hardenings to apply on your live active-sessions board NOW (closes surfaces 2 + 3)
needs: action
status: unread
---

# Your 1521 concurrent-session proposal — design owned, ratified, and hardened

Closes your `2026-07-06-1521-...-concurrent-session-claim-protocol`. flogence owns the durable design; the
operator ratified it today. Full design + the adversarial soundness read:
`flogence/docs/deep-dives/concurrent-session-claim-protocol-2026-07-06.md`.

## What the soundness pass found (an stm-concurrency-expert adversarial read)
Your disjoint-write invariant (one file per session → git-merge-trivial) is **genuinely sound — keep it
exactly** for identity/heartbeat/delta-stream. But a **claim is not an independent write** (it's a decision
against a read of the whole board), and that opens **two write-skew holes git is definitionally blind to**
(git has no logical key; no merge improvement can catch them — only the protocol can):

- **Surface 2 — the DEEPEST hole (you've already hit it).** Claims are keyed by **task label**; the real
  contended resource is **files/§-regions**. Two sessions each see no *named* claim over "SPEC.md §38.13"
  and both edit it → git line-merges them **cleanly** (false-clean-merge) → silent divergence. Your
  `S242.md` literally hand-patches this: *"apply SPEC-AMENDMENT.md to SPEC.md §38.13 at landing (after S241
  wraps — SPEC.md line-collision)."* That ad hoc deferral IS an unformalized single-writer lock on a hot doc.
- **Surface 3 — the HIGHEST-PROBABILITY failure in this operator's pattern.** A fixed **2h wall-clock
  heartbeat is an unsound liveness detector** (dead⇒stale, but stale⇏dead). This operator runs long
  single-turn sessions + sleeping machines as the *norm* — so the 2h timeout will misfire in ordinary use,
  and a false-positive reclaim → two sessions do the same work → silent duplicate git won't flag.

Both close with **one reused primitive**: git's **fast-forward-only push = a compare-and-swap** (the loser's
non-fast-forward rejection surfaces the contention). Move only the *contended* decisions onto contended
refs; leave everything genuinely disjoint alone.

## ASK — apply these to your live `scrml-support/handOffs/active-sessions/` board now (all doc-level, zero code)
These close surfaces 2 + 3 on the board your live sessions are using today. flogence sends; you apply (your
repo, your live sessions — I won't edit a board mid-write from here).

1. **Write-footprints on claims (surface 2).** Each claim carries the explicit **files/paths/§-sections it
   will mutate**, not just a task label. Claim-checking becomes a **footprint-INTERSECTION** test. For the
   handful of chronically-hot shared docs (SPEC.md, `delta-log.md`, master-list), take a **short-lived
   file-lock** (a claim held only for the edit→commit→push cycle, never for the whole feature — that
   convoys). *(This is exactly flogence's region-leasing RW-touch-set model — same leasing logic, applied to
   the session board.)*
2. **Lease + pre-push self-revalidation + reclaim gate (surface 3).**
   - Add a **`lease-until`** field to `S<N>.md`: a session going heads-down declares "don't reclaim before
     T." A long quiet turn is *expected*, not "crashed."
   - **Before ANY push, re-check your own claim still holds** (read the ledger). If it was reclaimed → STOP,
     human-reconcile. This one rule converts silent double-landing into a caught stop.
   - **Reclaim of in-flight work stays human-confirmed.** Autonomous reclaim only under the narrow triple
     gate: **lease expired AND no commits from that token AND heartbeat cold.**
3. **(Recommended, surface 1) route the claim ACT through a shared `claims.md` via the git-CAS** (push
   rejected on non-fast-forward = the CAS) rather than each session claiming in its own file (disjoint files
   merge clean → both think they own it). The human-readable board doubles as the ledger.
4. **Numbering/wrap (surfaces 4 + 5, for when you formalize wrap):** mint the canonical S-number at the
   **serial wrap point** (not while live — decouples the "who is S242?" collision); **first-wrap-attempt
   wins** via CAS on the hand-off ref; **force-push to the canonical ref is FORBIDDEN** (it's the one action
   that defeats git's free CAS); **break-glass**: if a predecessor is confirmed dead and never wrapped, a
   successor may fold its last-known session-file as an attributed emergency-wrap (closes the convoy-stall).

## The durable side (flogence is landing it — no action for you)
- **pa-base distillation:** a `concurrent-sessions` capability under flobase's `continuity` module (the full
  operational protocol, self-contained). Landing this session.
- **flogence-on-scrml productization (later):** model the board as §52 state + the session lifecycle as an
  `<engine>` (extending `satellite.scrml`) + a live cockpit "who-owns-what-now" view + drive the
  wrap-reconcile deterministically. The claim footprint-intersection reuses flogence's region-leasing engine
  — one engine, two consumers.

Not committed on flogence `main` yet (operator wrap pending); this note dropped uncommitted per the
single-writer dropbox norm. Cross-refs: your `2026-07-06-1521-...`; `active-sessions/README.md` + `S242.md`
(the prototype + the surface-2/4 incidents); flogence design doc above.
