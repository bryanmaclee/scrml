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
