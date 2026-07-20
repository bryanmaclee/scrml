# STAGE2-BRIEF — V1-minimal tenant redact-floor impl (§14.8.10)

**Dispatched:** S273 (bryan) 2026-07-20 · **Agent:** scrml-js-codegen-engineer (iso:worktree, opus, bg) · **Base:** efe58f82.
**Archival of the verbatim dispatch prompt** (forensic instruction record; the WORK is in the agent's branch + progress.md).

---

You are implementing the **V1-minimal tenant-row isolation floor** (SPEC §14.8.10) in the scrml compiler. The SPEC contract landed on `main` this session (commit efe58f82); your job is the impl wave that fires the codes and flips the Nominal banner.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST (map stamp: commit `df2ac831`; current base `efe58f82`. The ONLY compiler/src change between them is #115 each-table-foster lint [`lint-w-each-table-foster.js` + `api.js`], DISJOINT from the SQL-lowering / egress region you touch — treat the map as CURRENT for this arc). Follow its "Task-Shape Routing" to the codegen + SQL maps. Report the load-bearing map finding (including "not load-bearing" if so).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)  [path-discipline incident counter: 0]
1. FIRST action: `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` MUST equal your worktree root. `git status` clean. If ANY check fails: STOP, report, exit — do not proceed.
2. `bun install` (a fresh worktree does NOT inherit node_modules; the suite fails "cannot find package 'acorn'" otherwise). Then `bun run pretest` (populates gitignored `samples/compilation-tests/dist/` browser fixtures). Use `bun run test` (chains pretest) for baselines, NOT bare `bun test`.
3. Every write targets an ABSOLUTE path UNDER your worktree root. NEVER `cd` into the main checkout. Use `git -C "$WORKTREE_ROOT" …`, `bun --cwd "$WORKTREE_ROOT" …`, worktree-absolute paths only. Prefer editing via Bash on absolute worktree paths (echo the path before, `git diff` after) so a write can never leak into the main checkout.
4. First commit: `WIP(tenant-floor-impl): start at $(pwd)`.
5. Commit after EACH meaningful change (WIP commits expected). Maintain an append-only `progress.md` (timestamped: what was just done / what's next / blockers). The branch + progress.md are your crash-recovery anchor.

## READ FIRST (the normative source — Rule 4)
- **`compiler/SPEC.md` §14.8.10** (Server→client confidentiality — tenant-row isolation floor) IN FULL — this is the contract you implement. It is Nominal/spec-ahead; your impl flips the banner.
- **`compiler/SPEC.md` §14.8.9** (the protected-COLUMN twin) IN FULL — this is the impl you MIRROR. Your row-floor is "§14.8.9, one predicate deeper."
- **§52.15.1** (`@currentUser` ambient cell) — you add the `.tenantId` projection.
- The RULING authority (design context, all forks): `../scrml-support/docs/deep-dives/tenant-floor-design-2026-07-19.md` (bryan RULED S271). The BRIEF/record: `docs/changes/tenant-floor/SPEC-AMENDMENT.md`.

## THE §14.8.9 IMPL TO MIRROR (verified loci on your base)
- `compiler/src/codegen/protect-egress.ts` — `_scrml_protect_tag` (~L203), `_scrml_protect_redact` (~L223), `_scrml_protect_reveal` (~L214), `buildProtectTagWrap` (~L243-250), `detectProtectedRawEgress` (~L274), the `fromTables` consumer.
- `compiler/src/codegen/rewrite.ts:139` — `protectTagSqlResult(inner, sqlContent)` — the SHARED lowering choke (both the text-rewrite path and the structured `emit-logic.ts case "sql"` path tag here).
- `compiler/src/sql-projection.ts:278` — `extractSelectProjection(query)` → `.fromTables` (the read's source tables) — the tenant-scoped-table detector. (NB the DD miscited this as `codegen/sql-projection.ts`; the real path is `compiler/src/sql-projection.ts`.)
- `compiler/src/codegen/emit-server.ts` (~L1273-1349) — `_protectActive` master gate + `setProtectContextForRewriter` + the redact application at the egress sinks (server-fn response, SSR `/__serverLoad`, channel broadcast ~L1491-1493, SSE). The `@currentUser` resolver is emitted here too (~L1558 middleware userId/role + resolver; ~L1874 `@currentUser.isAuth`).

## WHAT TO BUILD — V1-minimal = the REDACT floor + the hard-fails (SPEC §14.8.10 "Implementation status")
1. **`@currentUser.tenantId` projection** — `.tenantId : string | not`, server-resolved from `session.get("tenantId")`, mirroring `.id`/`.role`/`.isAuth`. Never client-supplied.
2. **Tenant-scoped detection** — a `<schema>` table with a `tenant_id` column IS tenant-scoped (presence = declaration; no opt-in). Build `tenantScopedTables` (analogous to protect's `protectedByTable`). At `?{}` lowering, `extractSelectProjection(query).fromTables ∩ tenantScopedTables ≠ ∅` → floor applies. `_tenantActive = tenantScopedTables.size > 0` → non-tenant apps emit byte-identically.
3. **Read redact-floor** — key on each row's `tenant_id` VALUE. Recommended: if the projection lacks `tenant_id`, ADD it (a projection-column add, NOT a WHERE-parse) marked floor-added; tag; at the sink `_scrml_tenant_redact(value, ambientTenantId)` drops rows where `row.tenant_id !== ambientTenantId` and strips the floor-added column. Gate on `_tenantActive`. Fail-closed: `@currentUser.tenantId is not` → null → zero rows (§52.15.3 shape). Fires `I-TENANT-STRIP`. Unresolvable dynamic read → wholesale strip (mirror protect), NOT a compile error.
4. **Hard-fails** — `E-TENANT-AGG` (aggregate over scoped table, no output tenant discriminator → can't redact); `E-TENANT-WRITE` (write to scoped table: INSERT injects `tenant_id` column [no WHERE]; UPDATE/DELETE hard-fail unless `.acrossTenants()` — SURFACE + confirm tightest fail-closed reading); `E-TENANT-RAW-EGRESS` (mirror `detectProtectedRawEgress`; suppressed by `.acrossTenants()`).
5. **`.acrossTenants()`** — method on the `?{}` result (mirror `.reveal()`), suppresses the floor for that query, fires `I-TENANT-ACROSS`. The ONLY unscoped path.
6. **§34 catalog rows** — add the 5 rows (E-TENANT-AGG/-WRITE/-RAW-EGRESS Error; I-TENANT-STRIP/-ACROSS Info) + wire fire sites. Flip the §14.8.10 Nominal banner → Implemented.
7. **Conformance case** — pin BOTH halves (codes fire on shapes + runtime redacts cross-tenant / fail-closed-unpinned / acrossTenants-unscoped). DATA-not-TS. The merge-blocker.
8. **Tests** — unit + integration.

## SCOPE BOUNDARIES (do NOT exceed V1-minimal)
- NO SQL-WHERE-parser, NO read predicate injection (v1.next). INSERT column-add is allowed. Non-tenant apps → byte-identical. Do NOT change §14.8.9 protect behavior (compose at the same sink; both must run correctly together).

## VERIFY GATES — MANDATORY (SECURITY floor; a bug = a cross-tenant leak)
- **Phase 3 R26 empirical — EXECUTE the bundle, do not grep.** Author a ≥2-tenant repro + recompile a real adopter source (non-tenant byte-identity). Compile via `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>`, EXECUTE, confirm: (a) tenant-A request sees ONLY A rows; (b) unpinned sees ZERO; (c) `.acrossTenants()` sees all; (d) non-tenant app byte-identical. (Standing lesson: green suites shipped DOA code 3× because verified by grep not execution.)
- Full suite `bun run test` green. DO NOT mark DONE without all 5 codes firing + redact empirically stripping + fail-closed-unpinned + conformance case (both halves) + non-tenant byte-identity.

## Report back
FINAL branch SHA, files-touched, each code's fire-site file:line, conformance case path, the R26 executed-bundle observations, full-suite counts, any SPEC-contract ambiguity resolved (choice + why), deferred/uncertain items. Commit incrementally; clean `git status` before DONE is mandatory.
