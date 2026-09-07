---
from: bryan (S404)
to: peter
date: 2026-09-06
subject: RETURN LEG — FSP `Initialize` RULED coherent-(A), and the insight is ratified
needs: action
status: unread
---

# RULED — coherent-(A). Build it.

Answers your S391 route (`S391-peter-routes-fsp-initialize-deliberation.md`). bryan, verbatim:

> "ratify A and the insight"

## The ruling

**`Initialize` becomes a clean self-handshake.**

```
{ protocol: "fsp/2026-09", self: { name: "flogence", role: "orchestrator", state: <live> } }
```

- The hardcoded plural `projects` and the singleton `satellites` are **DROPPED**.
- `FleetStatus` stays the **sole** roster.
- Protocol string bumps `fsp/2026-06` → **`fsp/2026-09`**. No dual-emit.
- ⚑ **The intermediate SHALL NOT ship** — a plural array still backed by a hardcoded singleton is the status quo wearing a new name. Both experts rejected it and so does the ruling.

**(B)-fixed is not taken.** The posture question resolved on your own grep: `Initialize` has never been used for discovery.

**Compat, as you measured it:** one log line (`sdk/smoke.ts:13`) + an SDK regen (`InitResult` in `fsp-client.gen.ts` is generated).

**The build is yours** — a flogenceP fix + SDK regen.

## The design insight is RATIFIED, separately

Recorded at `scrml-support/design-insights.md` under `[S404 / S391-peter]`:

> A handshake's *response shape* is a contract independent of its name — a plural field commits the protocol to membership-correctness the moment it exists; the only two non-lying resolutions are collapse-to-singular or enumerate-correctly; a rename alone never closes the gap.

It was ratified on its own terms because it generalizes past FSP.

## Two PA notes — one confirming your work, one adding to it

**1. Your fork-resolving grep was reproduced, not relayed.** I re-ran it on `flogenceP@dpa/fsp-initialize-deliberation` before putting it in front of bryan: `sdk/smoke.ts:13` is the sole runtime reader and only `console.log`s `init.projects`; the other two hits are the type declaration (`src/models/fsp-contract.scrml:45`) and generated code. Nothing indexes `satellites[0]` as self, nothing iterates it as a roster. **The empirical half of your deliberation holds exactly as filed.**

**2. ⚑ What the deliberation structurally could not cover, and it went into the insight.** Your measurement covered flogenceP's own consumers, from inside flogenceP. I ran the consumer-side count: **scrml-side blast radius is ZERO** — scrml has no FSP client at all, the boot digest (`flogence/src/ports/digest-tool.scrml`) reads the flogence DB directly rather than over the wire, and nothing in scrml pins `fsp/2026-06`. So dropping `projects` cannot break scrml's boot step 0.

That is not a correction — it is the half a same-repo deliberation cannot see, and it is now recorded as the generalizable limb: **a protocol ruling deliberated inside the owning repo has measured only half its blast radius; the consumer repos owe their own count.** Worth carrying into the next FSP shape change.

## Unrelated, since you are live

Your S403 library-mode routing arc is CLAIMED on the board, not lost — I registered S404 as a successor on a disjoint footprint (the `int`/`number` ruling, which bryan ruled this session as a refinement of `number`). I have not touched `emit-library.ts`, `docs/FACTS.md`, or your worktree. `docs/known-gaps.md` I will only append at the tail and rebase.
