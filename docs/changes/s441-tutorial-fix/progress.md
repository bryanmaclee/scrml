# s441-tutorial-fix progress

- [x] drift gate in scripts/snippet-gate.js (+ scripts/snippet-drift.js, unit test) — 596b63748
- [x] tutorial markers + snippet reconciliation (18 marked blocks, 15 files + 3 excerpts)
- [x] §0/§2.2/§2.3/§3/§4/§5/§6/§7/§9/§10/prose fixes
- [x] verify: snippet-gate 114/114 + drift 18/0; every block compiled + node --check; runtime-rendered in happy-dom
- [ ] push

Findings beyond the brief (compiler, not fixed here):
- `<db>` body without `${}`: everything inside silently dropped, exit 0 (old 06-failable shipped an empty app).
- JS-style `match` + multi-line `lift <form>` with decl-coupled fields renders garbage (old §5/§6);
  single-line `lift <p>Got ${n} rows.</p>` loses whitespace ("Got42rows."). Block-form `<match>` is correct.
- `@prop` inside a component compiles clean and crashes at runtime (old 03-todos `@item.done`).
- `<engine derived=@x>` + arrow body is an identity projection (body dropped); examples/14 relies on it.
- E-TYPE-041 (`not` into a non-optional cell) does not fire.
- Trailing `// comment` on a compound-state opener line breaks the compound (E-STATE-UNDECLARED).
- SPEC §6.5 contradicts itself on `@arr.push` reactivity (DQ-2 note vs normative rewrite); runtime does update.
