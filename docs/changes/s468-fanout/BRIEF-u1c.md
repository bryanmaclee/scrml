# unit-id: s468-bootstrap-u1c
BOOTSTRAP build (compiler/self-host-v2, written in scrml) — S435 policy: language work goes HERE, not impl#1.
Unit **U1c — the server half of the server boundary**: server artifact emission (print-server), server Fn bodies as
native `async function`, the route the U1b client stub calls, and the conformance server-db cases it unlocks.
READ IN FULL before any code:
- scrml-support/docs/deep-dives/bootstrap-u1-server-boundary-design-2026-10-03.md — esp. §3(a) and the BINDING
  **§13 amendment (S467) "U1c gate: the server half awaits by construction"**: no per-call classification in the
  printer; a Core `waits` fact on server Fns computed over Syms transitively in ONE place, re-verified by checkCore
  (C-S8s / C-S8 widened); the printer emits `await` exactly at each Suspend. Fallback (await every scrml-level call)
  only if `waits` proves impractical, recorded with a measured cost. Value positions that would wait → refused per
  SPEC §13.8 "one rule" (S467).
- scrml-support/docs/deep-dives/bootstrap-server-boundary-arc-plan-2026-09-30.md (U1 row; the conformance harness stub
  matches impl#1's `/_scrml/__ri_route_<name>_<n>` [conformance/adapters/impl1-ts.ts] — emit that URL shape or give the
  bootstrap its own matcher, and say which).
- scrml-support/docs/deep-dives/bootstrap-u1b-client-server-call-design-2026-10-04.md + what landed in #1303 (U1b),
  #1263 (U1a), #1265 (Ue), #1290 (dpa-066 one effect summary per callable — reuse it; do not add a fourth walker).
- SPEC §12 (placement), §13.2/§13.8/§13.9.6, §19.9.10 (ServerCallError / Transport), §57/§57.8 (wire codec), §8.
- scrml-writing anti-pattern briefing (MANDATORY, re-read before each feature):
  scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md + docs/articles/llm-kickstarter-v2-2026-05-04.md. The
  bootstrap is scrml source; no React/JS reflexes; state-shape first (Pillar 5b).
- the security-await pack (compiler/tests/integration/security-await-pack/) and the S467 reviewer harnesses in
  $HOME/.cache/scrml-review-s467-await-r10/ + scrml-review-s467-cps-r4/ (absolute paths reference /home/bryan) —
  U1c MUST be run against the wrong-password shapes the bootstrap can express: none may accept a wrong password.
Scope: CPS splitting is OUT unless the design doc puts it in U1c (say which). If the design doc leaves a decision
open that is not the §13 default, STOP and report it as a ruling — do not guess (the "never guess" rule in
ingest.scrml's header).
Done = server-db conformance cases the bootstrap now passes (count, by name), checkCore green, the bootstrap slices as
CI runs them (m1/m2/m3/m4/codec/v2 lexer + lint-no-default-arm) all 0 fail, bootstrap-conformance --check, and the
await-shape run. Large unit: commit + push after each meaningful step; progress.md is your crash anchor.
