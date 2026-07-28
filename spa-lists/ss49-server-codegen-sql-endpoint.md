# ss49 — server-side codegen: SQL placement/escalation + endpoint arm — VERIFY-FIRST

**Fill-note:** two MED server-side codegen-correctness gaps from the rotting backlog, clustered by the server-emit ingestion. Both make a *legal* program emit wrong/missing output on the server side. **VERIFY-FIRST** (S138 R26-reverse — reproduce the symptom on real source at the current baseline before fixing) + **S215 adversarial** (these touch the server/client partition + a new primitive; probe adjacent shapes).

**Shared ingestion:** server-fn placement inference (§12 auto-escalation), the `_scrml_sql` server/client bundle partition (`E-CG-006`), and `<endpoint>` arm emit (§61). The sPA needs the server-placement + server-fn-emit machinery for both.

**coreFiles:** `compiler/src/type-system.ts` (server-placement inference / fn-escalation walk) · the `E-CG-006` server-only-node detection · `compiler/src/codegen/emit-server.ts` + the `<endpoint>` arm emit. ⚠️ check vs ss47 (#12, `?{}`-in-arrow) if it's in flight — shared server/SQL emit surface.

**Brief reminders:** VERIFY-FIRST per gap (compile the real repro + grep the symptom + `node --check`). Reactive-cell carve-outs / server-vs-client partition are load-bearing — don't widen escalation so far it pulls client code server-side. R26 + full `bun run test`; re-baseline within-node parity if fixtures shift.

## Items

1. **g-sql-in-nested-function-client-leak** (MED, `known-gaps §S225`) `[status=open]` **VERIFY-FIRST**
   - A nested `function ins(x){ ?{…} }` declared inside another function isn't server-escalated (§12) → its `?{}` SQL is treated client-side → loud `E-CG-006` (the server `_scrml_sql` leak is *caught*, not silently emitted). A *legal* nested-fn-with-SQL is rejected; the sibling top-level-hoist compiles clean.
   - Fix = extend server-placement inference to recurse into nested function declarations (escalate the enclosing fn when a nested fn touches a server-only resource). Verify the partition still holds (don't escalate a genuinely-client nested fn).
   - Footprint: `type-system.ts` server-escalation walk + the E-CG-006 fire-site. Surfaced by the S224 the adopter #12 agent (adjacent, not its named bug).

2. **g-endpoint-at-led-arm-trailing-expr-dropped** (MED) `[status=open]` **VERIFY-FIRST**
   - An `@`-led bare-body `<endpoint>` arm silently drops its trailing value-expr (the arm's return value never emits). Surfaced by ss34.
   - Fix = the `<endpoint>` arm emit must capture + emit the trailing value-expr for the `@`-led bare-body form (mirror the brace-body arm). Adversarial: brace-body vs `@`-led bare-body vs `:`-shorthand arm; self-closing `<Variant/>` (204) unchanged.
   - Footprint: `emit-server` / endpoint arm emit (§61.5 envelope). Check the §61.5 success-envelope (direct-serialize) is preserved.
