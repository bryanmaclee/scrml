# scrml — Session 392 (peter · P-Tech1 Windows) — WRAP

**Date:** 2026-08-31. Booted `/boot` Profile A onto clean main `76f97a59`. SOLO (S391-bryan +
S391-peter both WRAPPED at boot). Registered the board FIRST this session. Two code fixes shipped
on PR #805 (gate-green), a stale-ledger currency drain, and the finding that the peter-lane HIGH
pool is now largely bryan-owned + inflated with already-closed gaps.

---

## ⏭ NEXT-SESSION PICKUP (read this FIRST)

### A. S392-peter — in flight (mine)

- **PR #805** (`fix/each-match-in-if-else-chain-collector-descent`) is OPEN, **gate ✅ + windows ✅**,
  awaiting bryan's merge. Two commits: (1) HIGH — `<each>`/`<match>` under `if`/`else` silently
  dropped, the `if-chain` blind-spot class across six walks; (2) MED — value-form `if` markup-fn
  branch mounts. Both gaps marked resolved in `docs/known-gaps.md`. `tracking` red on the PR is the
  pre-existing advisory dev-watcher+§52.13 set (see B); a §59-HAMT timing flake was re-run green.
  **Next action: nothing owed unless bryan requests changes — it is clean and needs only a merge.**
- **RECOMMENDED NEXT SESSION — a reconciliation sweep, not another cluster hunt.** Five stale/
  mis-scoped ledger findings this session (Cluster 1 drained · markup-fn 2/5 drained · delta-lint
  3/3 already fixed) say the open-count is inflated with already-closed gaps. Verify-and-flip
  stale-open markers across the HIGH pool, conservatively (code + resolution commit + passing test
  before flipping). The reliable open-set source is the `<!-- @gap … status=Z -->` MARKER, not the
  prose header: `grep -oE '<!-- @gap[^>]*-->' docs/known-gaps.md | grep -oE 'sev=[A-Z]+ status=[a-z-]+' | sort | uniq -c`.
  See [[scrml-med-shortlist-gaps-stale-verify-first]].
- **Re-priced, left OPEN honestly:** `g-each-nested-in-fn-body-markup-fn-stringifies` (MED) — the
  obvious "descend fn bodies" fix is explicitly WRONG (name-collision); needs scope-aware resolution
  + pass-window rewire, a bigger arc. Its ledger entry documents both roots.

### B. bryan's SIX owed rulings — CARRIED FORWARD (untouched this session; still his)

These are S391-bryan's and remain open — I did not touch them. Full context: commit #804 +
delta-log [1992]-[1995].

| item | why it's bryan's |
|---|---|
| **dpa-037** (from S390) | ADVISORY, unratified. *"ok hold on I am not ratifying NaN! TBC"* stands. |
| **`g-dev-root-path-fallback-serves-a-protected-document-unauthenticated`** (HIGH) | Fix fork: (a) gate the root fallback, or (b) delete it and route `/` through the gated loop as prod does. |
| **`g-conformance-runanchored-silently-drops-…`** (HIGH) | 18 dropped assertions, each adjudicated ONE AT A TIME. |
| **`g-recent-sessions-index-drops-named-session-wraps`** (MED) | Filed with no limb — a session anchor is a fact the wrap could record as a trailer/tag. |
| **4(b) condition 3** | Measured-zero necessary-not-sufficient; changing the class is bryan's by its own terms. |
| **The `@`-sigil normative line** | No code until it is drawn. |

Plus the four corrected S389-peter route forks (see [1992]-[1995] / commit #804 verification blocks).

### C. `tracking` gate (advisory, pre-existing — not a merge blocker)

Red across recent merges: 5 dev-watcher cases (flakes — pass locally in ~4s; shared deadline-
sensitive mechanism) + §52.13 (REAL, but a TEST defect — the 404-vs-302 is FS-dependent; the
security property holds; one-line test fix wants its own dispatch). Both families live in
`compiler/tests/commands/` which runs in NO blocking job — `tracking` is its only coverage and it
is advisory. Promotion is a SEQUENCE (fix §52.13, quarantine the watcher family, THEN promote).

---

## What landed (S392-peter)

- **PR #805** — two `<each>`-interp codegen fixes (HIGH if-chain class + MED value-form-if markup-fn),
  6 walks + a DG reader sweep, 2 bite-proven regression tests, FACTS regenerated. Gate-green.
- **Ledger currency** — delta-lint trio (3 HIGH) confirmed ALREADY FIXED (S365, #646/#652) with
  passing regression tests; flipped 3 stale-open markers + heading tails to resolved; regenerated
  `@generated:gap-counts`. Honest HIGH-open **65 → 61** this session.
- **Continuity** — board registered (S392-peter), delta-log [1996]-[2002], this hand-off, changelog,
  master-list recent-sessions regen. 3 memories written/updated.

## In flight / held (unchanged from S391)

- **Arc (b)** (`worktree-agent-add7025319a51cbb9`) + the **r8 Windows patch** — pre-existing holds,
  untouched.
- Two S391 worktrees retained dirty (`agent-a96528615f5c41280`, `agent-adf40fe5528687920`) — content
  landed via #801/#802; DIRTY is never swept. Not mine to clear.

## Gaps

HIGH 61 · MED 195 · LOW 84 (open, per `@gap` markers after this session's flips). Counts in the
`@generated:gap-counts` block of `docs/known-gaps.md` are authoritative.
