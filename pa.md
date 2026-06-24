# scrml — PA pointer

## ⛔ BOOT GATE — decide this BEFORE reading further or taking any action

You are reading this file because the global convention says *"read `pa.md` in the
project root first."* **Reading this file is NOT the same as booting the scrml PA.**
Booting the PA is a DELIBERATE, EXPLICITLY-TRIGGERED operation. Apply this gate now,
before anything else:

### Rule 1 — Boot ONLY on an explicit boot command as the user's FIRST message.

The boot command is an explicit instruction to start the PA session — canonically
`read pa.md and start session`, or any of: `start session` · `start full session` ·
`thin start` · `execution session` · `Profile B` · an explicit *"boot the PA"* /
*"be the scrml PA"*. If the FIRST user message is one of these → proceed to boot
(read on, follow `pa-scrml.md` session-start).

**If the first message is ANYTHING ELSE** — a question, a bug report, a code request,
a "can you…", a pasted error, a one-off task — **DO NOT BOOT AS PA.** Do not read
`pa-scrml.md`, do not run the session-start checklist, do not rotate hand-offs, do not
read the PRIMER/SPEC-INDEX, do not assume PA identity or authority. **Just answer the
actual request as a normal assistant.** The user will issue the boot command when they
want the PA. A fresh instance that presumptively boots burns ~20% of context and then
acts with half-loaded context on a request that never asked for the PA. The repo being
scrml, or this file existing, is NOT a boot signal — only the explicit command is.

### Rule 2 — Boot is ATOMIC. Once you start session-start, FINISH it completely before acting on anything else.

If the user sends a substantive message *while you are mid-boot*, acknowledge it in one
line and **KEEP BOOTING** — complete the ENTIRE session-start checklist (the expert
reads, the git sync, the inbox, the hand-off rotation, the caught-up report) FIRST,
THEN act on the injected message with full context. Do NOT abandon the boot to chase the
new input. A half-booted PA has stale or missing context (unread hand-off, unread inbox,
no sync check, no spec map) and will make context-blind decisions. **The boot completes;
then you work.** (The only thing that interrupts a boot is an explicit stop/abort —
that's a control signal, always honored. A typed task is not a stop.)

> **Precedent (the reason this rule exists):** a mid-boot user message derailed a boot —
> Claude stopped session-start and began working on the injected prompt. The user had to
> esc-stop and say *"always finish session start completely."* It complied that session
> but the rule never hardened into the contract. This gate hardens it.

Both rules are **universal-methodology class** (they apply to ANY PA instance, not just
scrml) — when the `pa-base.md` migration lands (S217 multi-user PA), they belong in
`pa-base.md`; until then the authority copy lives in `pa-scrml.md` § "Session start" and
this stub carries the trigger-point gate. See also `pa-scrml.md` § "Session profiles".

---

The Primary Agent directives for this repo live at:

    ../scrml-support/pa-scrml.md

That file is the authoritative two-party-exchange contract between the user
and the scrml PA. It carries the session-start checklist, the five permanent
Rules (no marketing without prompt / full-production fidelity / right answer
beats easy / SPEC is normative / shoot straight), the hardened addenda
covering worktree isolation, commit discipline, cross-machine sync hygiene,
agent dispatch protocols, and every memory-rule precedent.

## Two session profiles (S156 ratification)

The user picks the profile at session open. Default to **A** when no signal is given.

- **Profile A — FULL** (design / deliberation / multi-arc / spec-from-scratch /
  debate / DD). **Read `../scrml-support/pa-scrml.md` IN FULL**, then the rest
  of the full session-start (PRIMER + SPEC-INDEX + master-list §0 + hand-off +
  user-voice tail). Signals (these pick A-vs-B *once a boot command has been given* per
  the BOOT GATE — they are NOT themselves boot triggers): "start full session",
  "full session". A design-shaped first message is ANSWERED DIRECTLY, not booted
  (BOOT GATE Rule 1); a design ask selects Profile A only after you've been told to boot.

- **Profile B — THIN / EXECUTION** (one already-designed, spec-landed arc whose
  hand-off + brief carry the context-sweep). **Read `../scrml-support/pa-core-scrml.md`**
  (the condensed thin read — ~140L: 5 Rules + dispatch checklist + wrap + sync/push +
  Profile-B operating rules) instead of the full pa.md, and skip the bulk reads.
  Signals: "thin start", "execution session", "Profile B", or a hand-off-staged
  execution bootstrap the user confirms. `pa-core-scrml.md` is to `pa-scrml.md`
  what `SPEC-INDEX.md` is to `SPEC.md` — thin copy; the full file is authority.
  If a thin session hits work needing design/context the thin reads don't carry,
  escalate to Profile A (scope_blindness guardrail).

**Why pa.md lives in scrml-support, not here** (S96 ratification): pa.md is
*not* language or compiler content. It's about how the user and PA interact
to build the language. scrml is public/MIT; this two-party-exchange contract
is the wrong audience for the public repo. scrml-support is the storage hub
for cross-cutting PA-user content (user-voice, design-insights, deep-dives —
and now PA directives). This stub exists only so the global "read pa.md in
project root first" convention still resolves mechanically.

This file is intentionally tiny. If you find yourself reading PA directives
HERE, you have the wrong file — go to `../scrml-support/pa-scrml.md`.
