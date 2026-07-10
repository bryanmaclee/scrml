# progress — conformance-endpoint-2026-07-09

## VERIFY-FIRST ground truth (established, not from a planning doc)
- `grep -rlF '<endpoint' conformance/cases/` → NONE.
- `grep -rli endpoint conformance/cases/` → NONE.
- `bun conformance/run.ts` baseline → **250/250 pass**.
- Conclusion: the ENTIRE §61 `<endpoint>` codes surface is uncovered by the agnostic corpus.
  All authored cases are genuine + non-duplicative.

## SPEC read (§61 IN FULL, SPEC.md:34233-34391) + §34 catalog (SPEC.md:18304-18309)
- §61 IMPLEMENTED S219 (default pipeline W2 parser + W3 typer + W4 codegen). The primitive is
  the typed INBOUND mirror of §60 `<api>`: scrml owns the request decode (parseVariant §41.13
  over the body against `accepts=:enum`), the exhaustive dispatch (§61.4), and the JSON envelope
  (§61.5). The author fills per-variant arms (the §18.0.1 `<match>` arm grammar, reused).
- Six named codes (§61.9, catalogued §34):
  - E-ENDPOINT-PATH-MISSING     — no `path=`             (W2 parse-time)  [error]
  - E-ENDPOINT-METHOD-INVALID   — bad/missing `method=`  (W2 parse-time)  [error]
  - E-ENDPOINT-ACCEPTS-MISSING  — no `accepts=`          (W2 parse-time)  [error]
  - E-ENDPOINT-NOT-EXHAUSTIVE   — an accepts= variant has no arm (W3 typer) [error]
  - E-ENDPOINT-ACCEPTS-NOT-ENUM — accepts= resolves to a non-enum (W3 typer) [error]
  - E-ENDPOINT-MULTI-STATEMENT-ARM — a multi-statement bare-body arm (W4 codegen) [error]
- REUSED codes (no parallel E-ENDPOINT-* minted):
  - E-TYPE-UNKNOWN-NAME — an UNDECLARED accepts= ref (§14.1.2 reuse).
  - §18.0.1 arm-validity — a DUPLICATE arm / an arm naming a variant not in accepts=
    (§61.4/§61.9 say these follow the §18.0.1 rules, NOT an E-ENDPOINT-* code).
- Server-handler-only codegen (§61.6 — no client fetch-stub); CSRF-exempt by construction (§61.7).

## EMPIRICAL-FIRST probe (impl#1 actual codes per shape) — scratchpad probes
Confirmed each fire/no-fire against impl#1 before writing expected.json. `<program>`-wrapped
inline JSON-RPC arm bodies = cleanest (only incidental W-PROGRAM-SPA-INFERRED info; matches
example 33 + endpoint-conformance-integration.test.js). Findings:
- path-missing → E-ENDPOINT-PATH-MISSING; method="HEAD" → E-ENDPOINT-METHOD-INVALID;
  no method= → E-ENDPOINT-METHOD-INVALID (missing literal reported here too); no accepts= →
  E-ENDPOINT-ACCEPTS-MISSING; missing-arm → E-ENDPOINT-NOT-EXHAUSTIVE; wildcard `<_>` →
  none; accepts=struct/primitive → E-ENDPOINT-ACCEPTS-NOT-ENUM (no double NOT-EXHAUSTIVE);
  accepts=undeclared → E-TYPE-UNKNOWN-NAME (no ACCEPTS-NOT-ENUM); multi-statement bare body →
  E-ENDPOINT-MULTI-STATEMENT-ARM (no E-CODEGEN-INVALID-LOGIC); duplicate arm → E-TYPE-023.
- SURPRISE (impl#1-vs-SPEC divergence): an arm naming a variant NOT in accepts= (all real
  variants also present — a genuinely DEAD/UNKNOWN arm) fires **NOTHING**. SPEC §61.4/§61.9 say a
  dead/unknown arm SHALL follow the §18.0.1 arm-validity rules (a §18.0.1 diagnostic). Duplicate
  arms DO fire (E-TYPE-023); unknown-variant arms do NOT. FLAGGED + escalated; NOT authored as a
  case (a SPEC-correct assertion would be red; a no-code assertion would bless impl divergence).

## Cases authored (14, all under conformance/cases/endpoint/) — codes + compile-shape
POSITIVE (code fires):
1.  path-missing                → E-ENDPOINT-PATH-MISSING           [error]  §61.7/§61.9
2.  method-invalid              → E-ENDPOINT-METHOD-INVALID (HEAD)   [error]  §61.7/§61.9
3.  method-missing              → E-ENDPOINT-METHOD-INVALID (absent) [error]  §61.7/§61.9
4.  accepts-missing             → E-ENDPOINT-ACCEPTS-MISSING         [error]  §61.3/§61.9
5.  not-exhaustive              → E-ENDPOINT-NOT-EXHAUSTIVE          [error]  §61.4/§61.9
6.  accepts-not-enum-struct     → E-ENDPOINT-ACCEPTS-NOT-ENUM        [error]  §61.3/§61.9
7.  accepts-not-enum-primitive  → E-ENDPOINT-ACCEPTS-NOT-ENUM        [error]  §61.3/§61.9
8.  accepts-unknown-name        → E-TYPE-UNKNOWN-NAME                [error]  §61.3/§14.1.2
9.  multi-statement-arm         → E-ENDPOINT-MULTI-STATEMENT-ARM     [error]  §61.2/§61.10/§61.9
10. duplicate-arm               → E-TYPE-023 (§18.0.1 reuse)         [error]  §61.4/§61.9
NEGATIVE / compile-shape (codes stay silent — the fidelity boundaries):
11. endpoint-clean              → whole E-ENDPOINT-* family silent; exhaustive dispatch recognized
12. wildcard-exhaustive         → wildcard `<_>` satisfies exhaustiveness (§61.4)
13. method-bareword-get-clean   → bareword GET method literal gates clean (§61.7)
14. self-closing-arm-exhaustive → self-closing `<Ping/>` no-op (204) arm counts to exhaustiveness (§61.2/§61.5)

## FLAGGED — track-B harness-gated (NOT authored; escalated to PA)
The RUNTIME half of `<endpoint>` (foreign inbound HTTP request → parseVariant decode → arm
dispatch → 200 direct-serialize / 400 decode-envelope / route registration) has NO sound driver
in the conformance contract:
- The ratified 8-verb input vocabulary drives DOM events through CLIENT handlers; an `<endpoint>`
  emits NO client bundle + NO DOM (§61.6), so `run()` observes nothing.
- The `serverDb`/`installServerDispatchFetch` seam only routes CLIENT-originated `/_scrml/*`
  fetches; the endpoint route mounts at the author-declared `path=` (e.g. `/fsp`, NOT `/_scrml/*`)
  and has no client caller — the dispatch fetch never reaches it.
- No `expected.json` assertion axis observes an HTTP Response (status + JSON body).
Driving it (as endpoint-conformance-integration.test.js does) requires importing impl#1's
`mod.fetch`/`routes` export encoding — baking impl#1 internals into an agnostic case (D3
impl-freedom violation). A sound runtime endpoint case needs a NEW ratified contract verb (a
foreign-inbound-request driver + a response-envelope assertion axis) — a track-B harness
extension, parallel to the flagged SSE-drive extension.

## ESCALATION — impl#1-vs-SPEC §61.4/§61.9 divergence (dead/unknown arm)
SPEC §61.4: "an arm naming a variant not in the `accepts=` enum ... follows the §18.0.1
arm-validity rules (a dead/unknown arm is the §18.0.1 diagnostic, not an E-ENDPOINT-* code)."
§61.9 repeats it. Empirically: a DUPLICATE arm fires E-TYPE-023 (conformant); an arm naming a
variant NOT in accepts= (with all real variants covered) fires NOTHING (non-conformant — no
§18.0.1 dead/unknown-arm diagnostic). Authored the duplicate-arm case (SPEC-conformant, green);
did NOT author the unknown-variant-arm case (can't be authored green-to-SPEC). PA to dispose:
either (a) fix the typer to diagnose the dead/unknown arm, then add the SPEC-correct case, or
(b) amend SPEC's §61.4/§61.9 dead/unknown-arm clause.
