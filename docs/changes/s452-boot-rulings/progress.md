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
