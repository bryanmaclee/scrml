# s451-spec-open-items — progress

Authority: ruling:user-voice-scrml.md S451 "your recs on all five" (the last entry of the S451 block).
Branch: spec/s451-open-items (cut from origin/main 2fb41d8b7, which contains #1253).

- 2026-10-03 start. Read the ruling entry in full, the #1253 progress.md, and §13.7, §19.4.3, §19.6, §19.7, §19.8,
  §19.9.1–§19.9.5, §6.7.7, §52 (intro, §52.4, §52.5, §52.6), §55.5.3, §57, §2, §34.0 in full before amending.
- 2026-10-03 ITEM 4 — §57.5 rewritten: R10 wins. Internal routes strict now and from v1.0; `<api>` responses and
  `<endpoint>` requests keep the dual decoder past v1.0. Struck (quoted in the provenance): the "retires at v1.0"
  ratification line, the scaffold-lifetime bullet, the v1.0 canonical-only bullet, the "v1.0+ decoders MAY refuse"
  half, and the OPEN. §12.5.1's "the v1.0 clean-break schedule" pointer updated. Direction: newly-accepting on
  foreign endpoints vs the struck v1.0 schedule; nothing changes today. impl#1: no new gap.
  NOT TOUCHED, flagged: §6.14.4 O-061-12 asks whether persisted storage values bind to "the §57.5 canonical-only
  decoder at v1.0" — that decoder no longer retires at v1.0, so the question's premise moved; still OPEN (not ruled).
- 2026-10-03 ITEMS 1 + 3 — §13.7 (one rule keyed on "would this position have to wait": items 1 server call · 2
  async-colored client helper · 3 a `?{}` · 4 a Promise-returning stdlib call; O-R1-1/-2/-3 replaced by a "Resolved
  S451" block with provenance + supersedes quotes + newly-rejecting note; normative statements + message; an
  `<errorBoundary>` does not exempt). §6.15 pointer paragraph widened. §34 E-VALUE-SERVER-CALL row widened (stays
  Nominal). §19.4.3: item 4 narrowed to CLIENT calls; NEW item 5 — a `<request>` body's call is handled by the request
  (failure → `<#id>.error`). READING (flagged): the ruling routes the failure to `.error`; that the request therefore
  satisfies E-ERROR-002 is my consequence of it. §19.6.1 Scope paragraph; §19.6.2 example rewritten (a CLIENT `!`
  `checkCode` in the boundary + `loadUser` via `<request>` and `.error is some`); §19.6.4 nesting example renamed to
  client `build…()` functions; §19.6.6 Scope bullet + E-ERROR-005 note (rule unchanged, "reachable" narrower: render-time
  client calls + the `<formFor>` route; a `<request>`'s `.error` is not checked by E-ERROR-005 — reads coherently);
  §19.6.7 per-batch failure now reaches the caller's handling / `<request>` `.error`, not a boundary; §19.8.3 item 3 +
  the boundary paragraph ("render the call" → "load it with a `<request>`"); §19.9.1 item 4; §19.9.5 D2 condition 2
  (boundary → `<request>` body), worked example (`notifyOrder` now `return orderId`, called from
  `<request id="notify" deps=[@currentOrderId]>`, Retry via `refetch()`), migration path 1 (`fetchProfile`! +
  `<request>`); §19.14.4 note (the `load…()` functions must be client functions). W-CPS-NEEDS-FAILABLE rows (§19.13 +
  §34) updated: boundary limb → `<request>` limb (Nominal; emitter `compiler/src/type-system.ts:10936`).
- Conformance: NEW `server-fn/error-boundary-value-server-call-neg` (source identical to `error-boundary-fallback`;
  expects E-VALUE-SERVER-CALL; xfail impl1-ts `g-impl1-value-server-call-s451`, signature recorded mechanically) and
  NEW `server-fn/error-boundary-request-error-twin` (the `<request>` twin; `.error is some` renders the fallback).
  The twin FAILS on impl#1 at run time: a `<request>` body whose server `!` call `fail`s writes the `fail` envelope
  into the cell and `.data`; `.error` stays `not`. Filed NEW carried gap `g-impl1-request-fail-envelope-lands-in-cell-s451`
  (HIGH, silent wrong output) and pinned it with the twin's xfail. `g-impl1-value-server-call-s451` status open →
  carried (an xfail mark requires a carried gap; §34.0 / S440 #12 already says impl#1 carries newly named errors).
  SUPERSEDED: `conformance/cases/server-fn/error-boundary-fallback` is superseded by the two cases above. conformance/
  README.md defines no superseded-by field, so the old case is left untouched (it still passes on impl#1 and will
  FAIL on the bootstrap, which emits E-VALUE-SERVER-CALL for it — retiring it is owed with the bootstrap's §13.7).
  Full run: 1250/1295 pass, 45 xfail, exit 0.
  NOT TOUCHED, flagged: §19.14.1 shows `<errorBoundary>` catching a server error raised in an `onsubmit=` handler —
  already contradicted by S440 #22 (boundaries catch render-time only); pre-existing, not this ruling. §19.11.2/§19.11.3
  (a boundary catching a HELD error value) vs §19.15 ("purely a CATCH primitive for live `!`-calls") — pre-existing.
  The §19.9.5 function bodies (`loadProfile`, `notifyOrder`) still hold `?{}` with no handler in a CPS-implicit `!`
  function — R11 migration debt measured by #1253 (69 SPEC sites), not migrated here.
- 2026-10-03 ITEM 2 — §19.8.3 OPEN replaced ("A `<x server>` hydration load is exempt"; supersedes quote; direction
  inert vs pre-R11 / newly-accepting vs a literal R11) + §19.8.4 bullet; §52.4.2 item 1 + §52.4.4 bullet + Pattern C
  pointer; NEW §52.6.8 "A Failed Hydration Load — `@x.error`" (Nominal): covers the compiler-generated loads
  (Pattern C `?{}`, the Pattern A inferred call, a call on the declaration RHS / `/__mountHydrate`); Pattern B is the
  author's `<request>` (its `.error`; `@x.error` stays `not`). Rules: exempt from E-ERROR-002 · server log line ·
  placeholder kept · `@x.error : Error | not`, set on failure, cleared only by the next successful hydration load,
  read-only (E-SYNTHESIZED-WRITE, Nominal limb) · `error` reserved.
  COLLISION found and resolved by the §55.5.3 precedent: a `<x server>` cell whose struct type has a field `error`
  (or a child field / attribute named `error`) would put the field and `@x.error` behind one `.` (the §55.5.3
  F12 silent-shadowing class). Resolved: `error` is reserved on a `<x server>` cell — NEW code
  E-SERVER-CELL-RESERVED-NAME (§34 row + §52.11 row, Nominal). E-VALIDITY-RESERVED-NAME's four names are unaffected
  (no clash with `error`). Corpus impact measured ZERO: 28 files under examples/ samples/ conformance/ docs/ stdlib/
  declare a `<x server>` cell; the one typed one (`Driver`) has no `error` field; no child field named `error`.
  READINGS flagged for veto (also stated in §52.6.8): (a) the log line is written in production (not the stripped
  `log()`); (b) only a successful load clears `@x.error` (not an assignment, not a §52.6.7 push); (c) Tier 1 type-level
  authority's generated load gets no `.error` (the ruling names `<x server>` only) — what a failed Tier 1 load
  reports is NOT ruled; (d) the reserved name + its code are this landing's resolution, not named by the ruling.
  impl#1 probe (`2fb41d8b7`, compiled, JS read): the Pattern C client load sets the cell from `await res.json()` with no
  status check; `@driver.error` compiles as a member read. Filed `g-impl1-server-cell-load-error-surface-s451` (MED, open).
- 2026-10-03 R11 MIGRATION POINTER — §19.8.3 "Migrating R11 code (tooling, not language)" paragraph + §19.8.4
  informative bullet: the `scrml fix` rule is owed; no normative weight.
- 2026-10-03 ITEM 5 — §2.2.1 new paragraph: a compile reporting any Error-severity diagnostic SHALL NOT produce a
  runnable artifact (no output file of that compile exists, or it wrote none; an earlier output dir is left as it
  was; whole compile, not per file). The parse gate, E-REACTIVE-005 (§6.6) and E-COMPONENT-035 (§15.14.2) restated as
  instances (notes added at both). §34 intro: a "Severity" sentence (Error fails the compile → §2.2.1). Direction:
  inert for acceptance. impl#1 measured (`2fb41d8b7`): a derived cycle reports E-DERIVED-CIRCULAR-DEP (impl#1's code
  for §6.6's cycle, not E-REACTIVE-005) and still writes client/html/css/runtime; a bare `@x` reports
  E-STATE-UNDECLARED, prints FAILED, and writes the same files. Filed `g-impl1-artifacts-written-on-error-s451`
  (sev=NOMINAL status=nominal, locus=compiler/src/commands/refusal-gate.js + codegen/validate-emit.ts).
  `bun scripts/state.ts --write` / `--check` PASS.
- Gates: `regen-spec-index.ts` + `--check` OK (S451 open-items notes added on rows §2, §13, §19, §52, §57);
  `s34-census.ts --check-new --base origin/main` PASS (6 new/changed rows); `facts.ts --write` then `--check` PASS.
- 2026-10-03 SCOPE ADDITION (PA) — ruling:user-voice-scrml.md S451 "your rec, a" (O-061-5 cross-tab failure halves).
  §6.14.2 rule 5: an undecodable / contract-failing cross-tab value, or a key removed in another tab (a reset there,
  rule 9, or `clear()`), → the cell takes its default and never writes back (no store, no remove). Rule 9's "Coupled,
  not decided here" note updated. §6.14.5 O-061-5: failure halves struck + CLOSED pointer; the write-contract-vs-
  hydration half stays OPEN (and so does whether the default-taking fires effects / `reset-on=`).
  O-061-12 restated for consistency with item 4 (no v1.0 retirement remains; storage is neither an internal route nor
  a foreign endpoint — strict vs dual is the open question); §57.1's pointer to it reworded and its stale "§6.14.4"
  fixed to §6.14.5. Not decided. Gates: spec-index --check OK, facts PASS, state PASS, census PASS.
