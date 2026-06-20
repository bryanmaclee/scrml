# sPA ss5 — channel-codegen

**Launch:** `read spa.md ss5` · **Branch:** `spa/ss5` · **Worktree:** `../scrml-spa-ss5`

**Fill:** ~30% · `at-ceiling` (only one clean sPA item survives post-S210; cross-file P3.A + Enhanced-A → Bucket B)

## Shared ingestion
Channel codegen + server-fn typed-return interaction: `type-system.ts` server-fn body type-scoping arm
+ emit-server. The server-fn typed-object-literal-return bug keys on the same
server-fn/object-literal-field-key understanding. (Channel cross-file P3.A + Enhanced-A auto-migrate
routed to Bucket B as design-open/S189-reversal.) Small natural ceiling — only one clean sPA item
survives in this cluster post-S210.

## Core files
`compiler/src/type-system.ts` · `compiler/src/codegen/emit-server.ts`

## Items (least-ingestion-first)
1. **`g-server-fn-typed-object-literal-return`** `[status=open]` MED · tier med — `return { field: ... }` in a server function trips `E-SCOPE-001` on the field name. A typed object-literal returned from a server function body fires `E-SCOPE-001` on the FIELD NAME — object-literal field key mis-resolved as an identifier in server-fn scope. Locus = server-fn body type-scoping / object-literal field-key resolution (type-system.ts server-fn arm). ss3-surfaced S209 item7 + independent async reproducer; not root-caused; PA-repro pending. status=open.
   > **Brief seed:** Prevent the server-fn type-scoping arm from treating object-literal field keys as scope identifiers (mirror the client-fn/object-literal field-key handling). PA-repro first to pin the locus; R26 the `E-SCOPE-001` over-fire on the field name.

## Progress
`ss5.progress.md`. Land on `spa/ss5`; ping PA inbox when ready. Do not advance main / do not push.
