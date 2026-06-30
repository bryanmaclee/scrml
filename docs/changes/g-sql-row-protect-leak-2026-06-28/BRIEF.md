# BRIEF — g-sql-row-protect-leak-2026-06-28

JS Codegen Engineer dispatch (isolation:worktree). Archived verbatim per S133 (archive dispatch BRIEF.md at dispatch time).

## TASK — Build the §14.8.9 protect-floor: server→client confidentiality redaction for `protect=` columns

SECURITY-CRITICAL. Confidentiality-redaction floor: a `protect=` column must NEVER reach the client unredacted. DEFAULT must be SAFE (strip protected-origin columns at egress; `reveal("col")` is the SOLE opt-in). Fail-closed everywhere.

### Authority (read IN FULL first)
- docs/changes/g-sql-row-protect-leak-2026-06-28/RULING.md — BUILD scope + 7-step decomposition + OQ-1 audit + verification attack-matrix. THE SPEC FOR THE BUILD.
- SPEC §14.8.9 (compiler/SPEC.md ~8140-8185, the Nominal section) — normative contract + E-PROTECT-004 / I-PROTECT-STRIP-001 prose.
- Ruling one-liner: structural redaction by column-ORIGIN (table,column) at the SINGLE compiler-emitted egress sink (server-fn return + SSR /__serverLoad), descriptor-propagated through every compiler-emitted construction step (no value-flow obligation). `reveal("col")` = sole sink-checked declassification. The static-prove (A) layer is DEFERRED.

### REUSE (not new analysis)
- resolveSqlRowType (type-system.ts, §14.8.7 Tranche-1) — resolves every SELECTed column to (table,column) through FROM/JOIN alias map (alias-safe). Net-new = CARRY the protected bit + origin one stage further onto a runtime descriptor.
- compiler/src/protect-analyzer.ts (fullSchema/clientSchema/protectedFields) — the protected-column set.
- The boundary-gate infra (type-system.ts ~3791-4006) runs E-ROUTE-003/004 at the server-fn return — the DEFERRED A-layer's home (not yours).

### STEP 0 — OQ-1 (descriptor-lifetime audit) FIRST. Report it before building the rest.
Enumerate EVERY compiler-emitted construction step the origin descriptor must survive: {...row} spread, helper return, .map/iteration, JOIN row assembly, struct construction. Confirm each is a tag-preserving emit site (or identify where the descriptor would be lost). Enumerate the RAW-EGRESS escapes that must be gated/fail-closed: _{} foreign code (§23), manual Response/handle() body (§40), asIs-typed values (§14.1.1). This audit GATES the build.

### The 7-step build (per the RULING)
1. Origin descriptor at query-lowering. At ?{} lowering, attach the resolved (table, column, protected) origin to each output column as a runtime descriptor on the row (reuse the resolveSqlRowType alias map).
2. Descriptor propagation. Thread the descriptor through the OQ-1 construction sites (spread/helper/map/JOIN/struct). Tag-UNION on JOIN; PRESERVE on spread.
3. Egress-serializer strip. At the compiler-emitted server-fn response serializer, DROP every column whose descriptor origin ∈ protectedFields, UNLESS it bears a reveal stamp. Emit I-PROTECT-STRIP-001 (Info) naming each stripped column.
4. reveal("col") construct. Field-level. Stamps the named column's descriptor as declassified-at-this-value; the serializer admits a protected-origin column IFF stamped at the sink. Greppable in source + emitted handler. Composes with pick/omit + the §14.8.8 width-contract (operates pre-serialization).
5. Fail-closed gates. (a) Raw/FFI egress (the OQ-1 list) carrying a protected-origin column that can't be proven redacted → E-PROTECT-004 (Error). (b) Unresolvable dynamic SQL (origin not statically resolvable) → STRIP-ALL wholesale + I-PROTECT-STRIP-001; NEVER accept-unknown.
6. SSR coverage. The SAME egress filter applies to the SSR /__serverLoad prerender payload. Coordinate with g-tier1-ssr-prerender.
7. Flip + fire. Flip the SPEC §14.8.9 Nominal banner to Implemented; confirm E-PROTECT-004 + I-PROTECT-STRIP-001 FIRE. Regen SPEC-INDEX if banner edit shifts line counts.

### DEFERRED — do NOT build
The A-layer (early static-prove error); derived/implicit flows + covert channels (e.g. {hasPw: u.pw != null} — DOCUMENT as out-of-scope, do NOT claim to catch it).

### MANDATORY S215 ADVERSARIAL VERIFICATION
- A1 — bare `return u` over SELECT * → protected column STRIPPED at egress.
- A2 — SELECT pw AS h (aliased) → STILL stripped (alias-safe).
- A3 — launder-through-helper + {...spread} → STILL stripped (descriptor propagated).
- A4 — derived { hasPw: u.pw != null } → DOCUMENTED out-of-scope.
- reveal round-trip — reveal("col") → column IS admitted.
- raw-egress fail-closed — protected-origin column to _{}/manual-Response → E-PROTECT-004 fires.
- /code-review at HIGH on diff.
- Full `bun run test` — zero regressions.
- R26 — compile a REAL adopter source with a protect= column; confirm absent from emitted server-fn response JS + SSR payload; node --check.

### known-gaps
Report g-sql-row-protect-leak status change (open → resolved). PA owns the @gap token; REPORT it.
