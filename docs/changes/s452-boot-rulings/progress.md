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
