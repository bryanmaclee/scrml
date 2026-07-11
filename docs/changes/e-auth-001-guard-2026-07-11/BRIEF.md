# BRIEF — Build the E-AUTH-001 guard (SECURITY diagnostic, SPEC-normative but unimplemented)

Isolated worktree — do NOT land to main; commit on branch; PA reviews (S239 + security scrutiny) + lands.
Security guard: a false-negative LEAKS (client-controlled value silently reaches a server DB write);
a false-positive blocks valid code. Be precise + adversarially self-verify.

## The divergence (reproduce FIRST)
SPEC §52.4.4 / §52.3.4 / §52.11 mandate `E-AUTH-001`: the compiler SHALL fire it when a
**client-local `@var`** is used as a **bound param in a server-side `?{}` INSERT/UPDATE/DELETE**
OUTSIDE a server function — a client-controlled value flowing into a DB write with no
server-authority mediation. The worked example is SPEC §52.4.6. Empirically today: ZERO fire-site
in `compiler/src/` (grep clean), and the §52.4.6 example compiles to `E-DG-002` ("declared but never
consumed") instead — the value isn't even recognized as consumed by the write. Reproduce the §52.4.6
shape first (a scratch file) and confirm the current wrong/absent behavior before building.

## Rule 4 — read the SPEC IN FULL
`compiler/SPEC.md` §52.3 + §52.4 (esp §52.4.4 the E-AUTH-001 rule + §52.4.6 the worked example) +
§52.11 + the §34 E-AUTH-001 row. Understand EXACTLY the condition: which @var kinds (client-local,
not @currentUser / not server-authority), which `?{}` operations (INSERT/UPDATE/DELETE — writes, not
SELECT), and the "outside a server fn" boundary. Also read the existing E-AUTH-002/003/004/005
fire-sites — E-AUTH-001 is the sibling that's missing; mirror the family's detection machinery.

## Build
Implement E-AUTH-001 detection + fire, following the E-AUTH-00x family pattern (§52 authority/DG
analysis). Handle the E-DG-002 interaction: decide per SPEC whether E-AUTH-001 REPLACES the E-DG-002
or co-fires. Add the §34 E-AUTH-001 catalog row if not already present.

## Adversarial self-verification (SECURITY)
(a) the leak fires; (b) does NOT false-fire on SAFE forms — write INSIDE a server fn ·
@currentUser / server-authority value · SELECT (read) · client-local var in client-only logic;
(c) edge cases: @var through an intermediate before the write; a compound/derived value. Report
which you covered.

## Author the conformance case (conformance/cases/auth/)
`auth-001-pos` (the §52.4.6 leak → E-AUTH-001) + `auth-001-neg` (same write inside a server fn /
server-authority → no E-AUTH-001).

## Verify + land (branch only)
Reproduce-first. `bun conformance/run.ts` all green + FULL pre-commit gate — 0 fail (a NEW security
error could red pre-existing samples/cases that unknowingly had the leak shape — check + reconcile
each; if a real sample HAS the leak, that's a find to surface, not silence). Commit per-item on
branch; do NOT push/advance main.

## Deliverables
- S136: `docs/changes/e-auth-001-guard-2026-07-11/BRIEF.md` + progress.md.
- Return: fire-site + condition; E-DG-002 interaction resolution; adversarial-verification matrix;
  any pre-existing sample/case that flipped; conformance case-ids; oracle before→after; full-gate
  result; branch tip SHA. Do NOT claim done without the gate + oracle output + the adversarial
  matrix. Do NOT land.
