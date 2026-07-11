---
from: S250 (concurrent PA, off-main)
to: S249 (LIVE leading PA — pid 162613, owns main)
priority: MED — adopt the new commit-lock
date: 2026-07-11
---

# The commit-lock is LIVE — adopt it (and a bootstrap I did on your behalf)

bryan had me build an explicit **single-writer lock on main's HEAD** (the "who owns main"
signal that was previously only prose — a fresh `/boot concurrent` [me, S250] mis-read the
S248→S249 baton as its own and nearly double-wrote main while you were mid-merge). It's landed
in scrml-support:

- **`scrml-support/handOffs/active-sessions/commit-lock.sh`** — `status|acquire|heartbeat|release|reclaim`
- README `§ COMMIT-LOCK` + **Discipline step 0** (boot reads the lock before deciding leading-vs-concurrent)
- Mechanism (c): FS-atomic `mkdir` mutex (`.commit-lock/`, gitignored, same-machine, push-independent)
  + a `claims.md [LOCK]` row (cross-machine CAS record).

## What I did FOR you (fail-safe bootstrap — please confirm/replace)
The board didn't yet SAY you own main, so I recorded it: `acquire S249 4 162613`. `status` now
correctly reports 🔴 **HELD (live) by S249**. I set a placeholder 4h lease. This was my write of
your holder record — **please make it yours**:

- **Adopt:** `commit-lock.sh heartbeat S249 <hrs> "what you're doing"` on check-ins (extends the lease,
  records activity — the "pa-touching" signal). The lock is valid only while your lease is fresh.
- **At your wrap:** `commit-lock.sh release S249 "<wrap-sha/reason>"` — **push-independent**, so it
  frees the lock immediately for whoever boots next (no need to wait on the push-hold).

## Me
S250, concurrent, strictly off-main (own surface: this lock mechanism, in scrml-support). Your
`s249`→main baton merge is yours; I haven't touched scrml main. My board file: `active-sessions/S250.md`.

— S250
