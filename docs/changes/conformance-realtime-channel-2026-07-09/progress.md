# progress — conformance-realtime-channel-2026-07-09

## VERIFY-FIRST ground truth (established, not from a planning doc)
- `grep -rlF '<channel' conformance/cases/` → ONLY `protect/channel-broadcast-strip`
  (the §14.8.9 broadcast() egress redaction — I-PROTECT-STRIP-001). No §38.13 coverage.
- `grep -rlF 'watches=' conformance/cases/` → NONE.
- `grep -rlF '<onchange' conformance/cases/` → NONE.
- `bun conformance/run.ts` baseline → **236/236 pass**.
- Conclusion: the ENTIRE §38.13 `<channel watches=>` + `<onchange>`/RowChange codes surface
  is uncovered by the agnostic corpus. All authored cases are genuine + non-duplicative.

## SPEC read (§38.13 IN FULL, SPEC.md:20252-20389) + §34 catalog (SPEC.md:17829-17834)
- §38.13 IMPLEMENTED S245 (Phase 1 front-end + Phase 2 runtime, Postgres-only).
- Six named codes: E-CHANNEL-WATCHES-{DRIVER,UNKNOWN-TABLE,CLIENT-WRITE,BROADCAST} (Error) +
  W-CHANNEL-WATCHES-{NO-PK,NO-CONSUMER} (Warning).
- `<onchange>` exhaustiveness reuses E-MATCH-NOT-EXHAUSTIVE (§18 family); misplacement reuses
  E-STRUCTURAL-ELEMENT-MISPLACED (§4.15/§24.4). No dedicated codes.
- §38.13.5 composition: a §52 `authority="server" table=` decl in canonical `${...}` placement
  (§52.3.5) resolves the watched table's shape (front-end); `<schema>` wins when both declare.

## EMPIRICAL-FIRST probe (impl#1 actual codes per shape) — scratchpad/probe.ts + probe2.ts
Confirmed each fire/no-fire against impl#1 before writing expected.json. `print(row)` in arms
= cleanest (only incidental W-PROGRAM-SPA-INFERRED). §52-authority shape source resolves (no
E-CHANNEL-WATCHES-UNKNOWN-TABLE) — matches SPEC §38.13.1/§38.13.5 (table resolvable from §52 decl).

## Cases authored (14, all under conformance/cases/channel/) — codes + compile-shape
POSITIVE (code fires):
1. watches-driver-non-postgres      → E-CHANNEL-WATCHES-DRIVER (sqlite)         [error]
2. watches-unknown-table            → E-CHANNEL-WATCHES-UNKNOWN-TABLE           [error]
3. watches-client-write             → E-CHANNEL-WATCHES-CLIENT-WRITE            [error]
4. watches-broadcast-forbidden      → E-CHANNEL-WATCHES-BROADCAST               [error]
5. watches-no-pk                    → W-CHANNEL-WATCHES-NO-PK                   [warning]
6. watches-no-consumer              → W-CHANNEL-WATCHES-NO-CONSUMER             [warning]
7. onchange-not-exhaustive          → E-MATCH-NOT-EXHAUSTIVE                    [error]
8. onchange-misplaced               → E-STRUCTURAL-ELEMENT-MISPLACED            [error]
NEGATIVE / compile-shape (codes stay silent — the fidelity boundaries):
9.  watches-clean                    → whole family silent; RowChange synth recognized + arms
                                       type-check + exhaustive + placement OK
10. watches-key-override             → key=label suppresses W-CHANNEL-WATCHES-NO-PK (§38.13.2)
11. onchange-wildcard-exhaustive     → wildcard `<_>` satisfies exhaustiveness (§38.13.3)
12. watches-52-authority-shape       → §52 authority provides shape; no UNKNOWN-TABLE (§38.13.5)
13. watches-broadcast-member-call-ok → member call `audit.broadcast()` != primitive (§38.13.4)
14. watches-derived-const-ok         → derived const is not a synced cell (§38.13.4)

## Verify
- `bun conformance/run.ts` → **250/250 pass** (236 → 250, +14).
- `bun test compiler/tests/conformance/corpus-bridge.test.js` → 251 pass / 0 fail.

## HARNESS-GATED runtime cases FLAGGED (track B — NOT authored, escalated to PA)
The §38.13 runtime half (server-boot trigger install → real Postgres commit → pg_notify →
per-instance LISTEN bridge re-SELECT → `{__type:"__change", op, row|key}` WS frame → client
`__change`→`<onchange>`-arm dispatch → §14.8.9 protect-egress redaction of the published row)
has NO sound driver in the conformance adapter:
- no real Postgres LISTEN/NOTIFY, no WebSocket driver, and no input verb that injects a server-push
  `__change` frame (the 8 driver verbs are DOM-event verbs only; serverStub mocks HTTP server-fn
  routes, serverDb eval's the emitted serverJs over table-seeded rows — neither carries a WS push).
Track-B cases that need live-PG + WS (do NOT author now — would only assert a stub, the ss60 trap):
- R1 Inserted delta patches @orders; R2 Updated replaces by PK; R3 Deleted removes by key
  (the three `<onchange>`-arm runtime dispatches).
- R4 §14.8.9 protect-egress redaction of the published `__change` row (the watches= analog of the
  existing protect/channel-broadcast-strip; needs the LISTEN bridge to re-SELECT + publish).
- R5 §38.13.6 delivery guarantee (at-most-once / commit-ordered-per-table); R6 §38.13.7
  multi-instance NOTIFY fan-out. All require a live commit stream.
Escalation: same class as the S245 "one thing no test env covers." Needs a real-PG + WS adapter
seam (or a synthetic `__change`-frame injection verb, a normative-contract-verb design question
for the PA) before these are soundly testable.

## impl#1-vs-SPEC §38.13 divergence check
- NONE at the codes-half. §38.13.1/§38.13.5 mandate resolving the watched table from EITHER a
  `<schema>` block OR a §52 `authority="server" table=` decl; impl#1 does exactly that (case 12
  passes with no UNKNOWN-TABLE). The SPEC §38.13.9 follow-up (i) — `_rowChangeSynth` codegen
  reading only `<schema>` — is a RUNTIME (Phase-2 codegen) limitation, already documented as a
  known non-v1-blocking follow-up; it is harness-gated (track B) and not observable at the
  codes half, so no escalation. Front-end diagnostic resolution of §52 tables is correct + tested.

## Discipline
- Isolated worktree; committed per-item on branch; did NOT land/push main.
