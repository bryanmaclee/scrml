# §13.2 Sub-Phase A — SPEC amendment progress

## 2026-05-13 — Phase A start

- Worktree: `agent-a98a3bac6fcc87a01`
- Base SHA: `9b98118`
- Maps consulted: primary.map.md, domain.map.md, error.map.md
- SCOPING source: `/home/bryan-maclee/scrmlMaster/scrmlTS/docs/changes/§13.2-auto-await-stdlib-scoping/SCOPING.md`
- OQs ratified: Q1 BROAD, Q2 Position C AMEND, Q5 stdlib special, Q6 stdlib API rule, plus Q3 + Q4 per task brief.

## Locations confirmed

- SPEC §13.1 at line 6483
- SPEC §13.2 at line 6487 (current normative bullets at 6499-6502)
- SPEC §13.3 at line 6504
- SPEC E-PROG-004 §34 catalog row at line 14872
- SPEC E-PROG-004 prose at line 18558 (§43.5.1)
- SPEC §43.7 catalog at line 18583 (lists E-PROG-004 Error)
- SPEC §41 import system at line ~17898
- SPEC-INDEX §13 row at line 39

## Commit 1 landed — f3974cd

- §13.2.1 inserted (auto-await for statically-known Promise<T> callees, Q1 BROAD).
- §13.2.2 inserted (cross-program calls + E-PROG-004 prose; Q2 Position C).
- Pre-commit hook passed (full unit + integration + conformance + gauntlet + browser checks).

## Commit 2 — E-PROG-004 amendment (Q2 Position C) — 6cd9759

- §34 catalog row §13.2.2 / §43.5.1 — Info severity, not retired.
- §43.5.1 prose updated — auto-await fires, explicit await idempotent.
- §43.7 row — Info severity, amended note attached.

## Commit 3 — §13.1 stdlib carve-out + §41.4.1 stdlib API rule (Q5+Q6)

- §13.1: stdlib carve-out paragraph (`scrml:*` modules MAY use `export async function`).
- §41.4.1: new sub-section — stdlib Promise<T>-returning functions SHALL always return Promise<T>.
- SPEC-INDEX: §13 row + §41 row updated with S89 amendment notes.
