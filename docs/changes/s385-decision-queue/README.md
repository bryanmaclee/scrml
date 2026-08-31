---
status: current
last-reviewed: 2026-08-30
---

# The S385 operator decision queue — recovered from a session scratchpad

**Why this directory exists.** The S385 sweep enumerated **84 operator decisions** across 7 channels
and ran a **host-fallback census** across four adopters. Both artifacts were written to a session
scratchpad under `/tmp` and **never landed**. No file in either repo carried the letter map, so the
only copy of a full-day sweep was one `/tmp` reap away from gone. Recovered and landed at S390,
byte-identical (md5-verified against the source before the source was left behind).

| file | what it is | provenance |
|---|---|---|
| `DECISION-QUEUE.md` | the complete 84-item enumeration, A1-A10 / B1-B8 / C1-C48, every fork's limbs turnkey | S385 sweep agent, 2026-08-30 07:22 |
| `HOST-FALLBACK-CENSUS.md` | the adopter host-fallback census across giti / flogence / assetManagement / RediLedger | S385 census agent, 2026-08-30 08:08 |
| `S390-VERIFICATION-PASS.md` | the S390 re-verification: which items are still LIVE, which were already ruled (with citations), which are undetermined | S390 verification agent, 2026-08-30 |

## Read the verification pass before acting on the queue

`DECISION-QUEUE.md` is a **snapshot dated 2026-08-30 07:22** and items were ruled against it the same
day. Treating it as live would re-surface decisions bryan has already made — the exact failure the
S385 sweep itself measured (12 of its own candidates were rulings already given, three of them given
that same day). `S390-VERIFICATION-PASS.md` carries the re-check: **66 live, 59 already-ruled with
citations, 7 classes undetermined.**

⚑ **The already-ruled half is load-bearing, not filler.** 37 of those 59 were ruled in sessions BEFORE
S385 while the gap entry, dpa status cell, or deep-dive frontmatter still read "RULING OWED". The
ledger going stale in the open-direction is what manufactures phantom queue depth.

## Known corrections this directory makes to other docs

- **`hand-off.md:45` overstates the C group.** It reads "the C-group HIGHs are surfaced and ruled";
  only C3-C8 were. C1, C2 and C9-C16 were enumerated and never shown.
- **A10's hold condition is MET.** S385 held A10 "until that number exists" — the census in this
  directory IS that number, and it completed the same day.
- **B6 was never surfaced.** The S385 batch ratified B2/B3/B4/B5/B7 with B1 excepted; B6 is in neither
  the ruled set nor the surfaced set.

## Coverage limits, stated rather than implied

`scrml-support/docs/deep-dives/` was swept only PARTIALLY — 289 files, ~119 `status: current`, and
**47 pre-S300 "PA action requested" files were never individually verified** by either the S385 sweep
or the S390 pass. That is the largest un-swept surface. `SPEC-ISSUE-*` (D4-D9) rows are RELAYED, not
independently re-derived. Rows carrying **RELAYED-UNVERIFIED** in the verification pass mean exactly
that: believe the pointer, re-derive the claim.
