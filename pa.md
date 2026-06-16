# scrml — PA pointer

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
  user-voice tail). Signals: "start full session", "full session", or any design ask.

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
