# s452-boot-rulings progress (append-only)

- 2026-10-04T09:20-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa2d89b9342ffbdbb,
  base 488abeedc (== origin/main). bun install + pretest OK.
- 2026-10-04T09:40 baseline counter (`bun scripts/bootstrap-conformance.ts`): PASS 119 · FAIL 41 · NOT-TWINNED 511 ·
  UNSUPPORTED 629 (bootstrap-unsupported 436 · parse-reject 193) of 1300.
- 2026-10-04T09:44 probes on the current bootstrap: value-position write arm / falling block arm → Ue2 refusals;
  `const r = load("x") !{ | _ :> noop() }` (noop yields nothing) is ACCEPTED (r would hold JS undefined — a bug this
  dispatch closes as E-ERROR-012); `!{}` on a non-failable call → generic refusal; markup `!{` → "not in the
  bootstrap (§3.1)" inside an element, three E-PARSE-ITEM at the program-body level; `| err :>` → three E-PARSE-ARM +
  E-SCOPE-001; `| _ err :>` / `else err :>` → binder refusal; `<db src>` → structural-tag refusal.
- 2026-10-04T09:50 DESIGN.md written (governing sentences per item; loci). OUT OF SCOPE noted: E-SQL-011 needs U1e
  (transactions) — not touched.
- 2026-10-04T10:50 items 5+6 committed (0efb87936): whole-error binder + E-MATCH-BARE-BINDER.
- 2026-10-04T11:05 item 1 committed (c97ffe37d): E-ERROR-012; block arm values (§18.5) lowered; print assigns the
  result inside the branch block (defer-safe). Closed a silent bug: a void call as a value arm was accepted.
- 2026-10-04T11:25 items 2-4 committed (1bbb5b58a): E-ERROR-013 (fail-closed U1b refusal for a may-be-server
  callee), E-ERROR-014 (parse), E-ERROR-015 (sql.scrml txControl + placePass).
- 2026-10-04T11:45 item 7 committed (a28b3eb66): `<db src>` scopes. Counter (pre-ruling-c) PASS 119 · FAIL 48 ·
  UNSUPPORTED 622 · NOT-TWINNED 511 — no PASS lost.
- 2026-10-04T11:50 PA relayed S452 ruling c ("c looks right"): `!{}` arms = `match` arm grammar; leading `|` and
  paren-free binder are soft-deprecated legacy, parse identically, no W-lint yet. Found: the arm parser was ALREADY
  shared (parseArms) and `|` already optional in both forms; added the legacy paren-free binder (in `!{}` only,
  ruling-2 arity) — DESIGN.md §2. Tests converted to the canonical form + a legacy-equivalence block.
- OUT OF SCOPE reminder: E-SQL-011 (cross-database envelope) needs U1e — untouched.
- 2026-10-04T12:20 PHASE 3 verification.
  (a) one reproducer per code through the bootstrap (front end), each fires and leaves NO Core: E-ERROR-012,
      E-ERROR-013, E-ERROR-014, E-ERROR-015, E-MATCH-BARE-BINDER (bare / `else err` / `_ rest` on a non-failable
      match — the last beside the §18 refusal), E-SQL-004 (two direct-child `<db src>`, none supplies).
  (b) near-misses compile (and run where printable): statement-position fall-through, `_ :>`, `_ err :>` (runtime:
      the bound value is `{ variant, data }` / the tag), a `<db src>` direct-child program (runtime: children render,
      no connection string in the client artifact), the same with a query (Core; print refused — U1c).
  (c) counter: PASS 119 → 119 · FAIL 41 → 48 · UNSUPPORTED 629 → 622 · NOT-TWINNED 511. No case left PASS.
      UNSUPPORTED → FAIL (7): control-flow/s437-braceless-else-in-failable-arm (E-ERROR-012 now named — one of the
      13 SPEC-listed fall-through files; + its pre-existing E-SCOPE-001); parse-variant/{error-invalid-payload,
      error-malformed-json, error-missing-discriminator, error-unknown-variant, misuse-non-enum-type,
      single-field-payload-bind} (the old "handler on parseVariant(…) cannot fail" refusal was WRONG — parseVariant
      is a built-in failable, §41.13; what remains is the honest gap: the bootstrap has no `parseVariant`, E-SCOPE-001).
      docs/bootstrap-conformance.md regenerated; `--check` current.
  (d) `bun scripts/gen-bootstrap-severity.ts --check`: current (107 codes with a §34 severity, 69 without).
  The 13 SPEC-listed fall-through files: 7 UNSUPPORTED (other refusals; E-ERROR-012 now fires in each), 3 FAIL
  twin-extra-error E-SCOPE-001 (`log` — no stdlib, so the `log(m)` arm cannot be judged), 2 parse-variant UNSUPPORTED
  (`<match>` / other refusals), 1 FAIL (s437, above). None migrated (brief).

## fix round r2

- 2026-10-04 BRIEF-r2.md archived. Merged origin/main (df6dad5ac, #1272, SPEC-only); no conflicts;
  severity regenerated (now 108 codes with a §34 severity, 69 without).
- HIGH-1 fixed: E-DEFER-UNSUPPORTED-SITE for a `defer` directly in a value-position `!{}` / `match` arm, including a
  leaving arm (PA readings, DESIGN §3). The `branchJs` value-then-defer lowering was removed.
- MED-1 fixed: `txControl` reads every `;`-separated statement, skipping empty ones, strings and comments.
- LOW-1 fixed: ABORT, START TRANSACTION, PREPARE TRANSACTION, COMMIT/ROLLBACK PREPARED are now recognised; RELEASE
  [SAVEPOINT] was already covered.
- MED-2 fixed: a callee must yield a value on every path (the syntactic rule is in DESIGN §3).
- LOW-3: fixed per the SPEC, not per the PA's wording. An arm after `_ err` is E-SYNTAX-010 with a true message, not
  accepted (§18.6.1). An arm after a plain wildcard is E-SYNTAX-010 too (was a refusal).
- DB-LOW-1 fixed: `redactDsn` in E-SQL-005 (`scheme://***@host`); the other db diagnostics echo no value.
- NIT fixed: `if=` / `else*` / `show=` on `<db>` are reported once (by the chain / show rules).
- Addendum fixed: a leading `|` on a `match` arm is E-PARSE-ARM; the paren-free binder is read only after a `!{}`
  arm's `|`. Engine message arms are not parsed by `parseArms`.
- LEFT, as instructed:
  - LOW-2 (`?{/* ${x} */ BEGIN}`): the statement-list scanner now joins chunks with an opaque ` ? `, so this case is
    detected incidentally. It is not separately pinned.
  - LOW-4 (`.V _` / `_ _` give E-PARSE-ARM): fails closed.
- Verification:
  - slices m1 99, m2 462, m3 60, m4 1084, codec 92, m1-lowered 99, all 0 fail;
  - error-rulings.test.js 74 tests;
  - counter PASS 119 · FAIL 48 · UNSUPPORTED 622 · NOT-TWINNED 511 — identical to 311b590ef (no bucket moved; the
    report is unchanged; `--check` current);
  - `gen-bootstrap-severity --check` current.

## fix round r3

- 2026-10-04 BRIEF-r3.md archived. origin/main had not moved since the r2 merge.
- MED-A fixed (fail closed: aware scan + plain `;` split when the text is dialect-dependent); the false comment is
  corrected; the binding U1e requirement is recorded in DESIGN.md §4. Noted gaps: `XA …`, `SET autocommit`.
- MED-B fixed (a bare `return` at any depth means "may yield no value").
- LOW-C: an unconditional earlier `return <value>` now decides. A `fn` tail expression is NOT counted as a value,
  because the bootstrap has no implicit tail return (verified by printing it). Found: a pre-existing gap — a declared
  `-> T` `fn` ending in a tail expression compiles and returns undefined (§48 / LOW-A territory).
- LOW-B fixed at the root: no db diagnostic echoes the value; `redactDsn` deleted; 7 credential shapes are tested in
  both `<db src=>` and `<program db=>`.
- LOW-D: an alternation-specific E-PARSE-ARM message. Implementing `.A | .B :>` is DEFERRED.
- LEFT, as instructed: LOW-A (a declared return type is trusted); LOW-E.
- Verification:
  - slices m1 99, m2 462, m3 60, m4 1092, codec 92, m1-lowered 99, all 0 fail;
  - error-rulings.test.js 82 tests;
  - counter PASS 119 · FAIL 48 · UNSUPPORTED 622 · NOT-TWINNED 511 (unchanged; report unchanged; `--check` current);
  - severity `--check` current.

## fix round r4

- 2026-10-04 BRIEF-r4.md archived.
- MED-A root fix: the plain `;` split ALWAYS runs. The `txDialectDependent` gate is removed. Every character ≤ U+0020
  is whitespace for the tx scans (`isSpace` stays the read-only scanner's whitelist, unchanged).
- When only the plain split finds transaction control, the message says the word may be inside a quoted string or a
  comment, and names the ways out: a `!` function, or `${…}`.
- Tests:
  - the four repros fire (bracketed `[it's]` / `[a"b]`, `\f`, `\v`, a lone `\r` after `--`);
  - the accepted false positive `INSERT … ('done; commit later')` fires;
  - the r2/r3 "string or comment hides it" near-misses are now accepted false positives (updated).
- NIT: after the alternation E-PARSE-ARM, the parser now skips through the arm separator, so no follow-on
  E-PARSE-EXPR is reported. E-TYPE-080 can still follow, because the lone `.A` pattern does not cover the enum.
- Verification:
  - slices m1 99, m2 462, m3 60, m4 1093, codec 92, m1-lowered 99, all 0 fail;
  - counter PASS 119 · FAIL 48 · UNSUPPORTED 622 · NOT-TWINNED 511 (unchanged; report `--check` current);
  - severity current.
