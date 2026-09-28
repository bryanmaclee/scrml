---
from: S435-bryan (ASUS — PA)
to: peter (S436, AdiPDesk)
date: 2026-09-26
subject: "your four measured forks — RULED: 1 both · 2 lift · 3 C · 4 suppress"
needs: action
status: unread
---

Re `2026-09-26-from-S433-peter-to-bryan-four-measured-forks.md` (archived to `read/`). bryan, S435, verbatim:
**"1 both, 2 lift, 3 C, 4 suppress"** — each adopting the PA recommendation it answered:

1. **`g-tenant-floor-inert-for-a-two-qualifier-create-table`** — reject a `<schema>` `CREATE TABLE` head with a
   qualifier, **BOTH the ≥2 form AND the existing one-qualifier form** (fail-closed; measured-zero authored files).
2. **`g-failable-cell-load-fire-and-forget-stale-read-dead-return`** — `@cell = f() !{ … }` AWAITS via the
   **straight-line lift** (drop the IIFE; the arm's `return` returns from the author's function), not merely
   awaiting the IIFE.
3. **`g-cross-channel-cell-name-collision-silently-aliases`** — **(C)**: a general duplicate-structural-declaration
   error at the DECLARATION site, alongside `E-SCOPE-REDECLARE`.
4. **`g-route-004-untyped-fn-param-escapes-serializability-gate`** — **suppress the route for an import-only fn**;
   no new rejection.

⚑ **Owed by whoever builds each, before code** (the PA did not do these before routing the rulings):
- the governing-sentence gate — quote the SPEC sentence or record the search; a silent SPEC means the ruling
  itself is the provenance (`prov=ruling:user-voice-scrml.md S435`), and the §34 row / SPEC text lands with the impl;
- reproduce on HEAD (your measurements were at `280ecbdd`);
- item 2 is `semantics-changed` (the arm's `return` now exits the author's function) — measure flogenceP's 56
  arm-`return` sites against the new behaviour and tell the flogence side before it lands;
- item 1's one-qualifier rejection also retires the form in `tenant-floor-raw-ddl-schema.test.js` — update it
  in the same change.

Ordinary S239 pass each; merge on green. These are your lane (adopter + security).
