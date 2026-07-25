# BRIEF — DB-authoritative security · Milestone 1 (reads-authoritative, one table, atomic)

**Dispatched:** S287-bryan, 2026-07-25 · agent `scrml-js-codegen-engineer` · `isolation: worktree`
**Authority docs (READ FIRST, in full):**
- `../../../scrml-support/docs/deep-dives/db-authoritative-security-PHASING-PLAN-2026-07-25.md` (plan of record — §6 "Recommended first concrete milestone" + the "Milestone 1 — P0 spike RESULT" section are load-bearing)
- `../../../scrml-support/docs/deep-dives/db-authoritative-security-design-2026-07-25.md` (the evidence DD — the emitted-SQL targets + per-ask feasibility table + Prior Art `SET LOCAL`/pooling/SECDEF discipline)

This brief is the ground-truth fire-site map (PA-verified against current source this session — the DD's line numbers had drifted; trust THIS brief's lines). The design is RULED; do not re-litigate. Build the atomic unit.

---

## 0. What is ruled (do NOT re-open)
bryan ruled (S286 user-voice): **add the opt-in DB-authoritative tier**, **reads-first phasing**, **A1 = pooled + `SET LOCAL ROLE` + `set_config(…,true)` in a per-request txn**, **SQLite = hard-fail `E-DBAUTH-SQLITE`**, **managed-plpgsql-text (not a mini-compiler)** — the last is P2+, not M1. The tier **stacks with §14.8.10** as defense-in-depth; it does NOT replace it. M1 is the **reads half only** and stays on the invariant side of the §14.8.10 firewall (RLS keyed on the already-pinned tenant scalar; scrml decides no policy).

## 1. Milestone-1 acceptance unit (NON-NEGOTIABLE — all parts or it is not landed)
One atomic unit on ONE table (`invoices` with a `tenant_id uuid`):
1. **Declaration surface** (net-new, M1-PROVISIONAL — see §3): a per-table opt-in that marks a table DB-authoritative, Postgres-target only.
2. **S7-minimal fence** (§4): on a Postgres target, do NOT run the SQLite 12-step DROP/recreate; never-clobber security objects (policies/roles) scrml did not author on re-migration.
3. **S1 RLS DDL** + **S6 bounded-role DDL** (§5): emit the FORCE-RLS policy + the `NOBYPASSRLS` role, applied once at startup/migration.
4. **A1/S2 principal txn-wrapper** (§6): conditionally engaged — reverse the ambient handle so every `?{}` in a db-authoritative app runs inside a reserved-connection txn that injects the principal.
5. **The negative test** (§7): a raw connection with no GUC / not the bounded role reads **0 rows** of the scoped table — green, against a real Postgres 16.

**Half of this is worse than none.** A policy that emits but is dropped on migration, or keys off a GUC never set, "looks enforced and isn't." The negative test is the ONLY proof the reversal is real.

## 2. The P0 spike already validated the mechanism (5/5 vs real PG16) — build to these findings
From the plan's "Milestone 1 — P0 spike RESULT" section (authoritative; the spike script itself is a dropped per-session scratchpad — do not hunt for it):
- **F1 — superuser/table-owner BYPASSES `FORCE ROW LEVEL SECURITY`.** The per-request principal MUST drop to a bounded **`NOBYPASSRLS`** role (`SET LOCAL ROLE scrml_app`). ⇒ **S6 is MANDATORY in M1**, not optional. A1-without-S6 is a silent no-op (the exact "looks enforced and isn't" trap).
- **F2 — `SET LOCAL` cannot be parameterized.** Emit `SELECT set_config('scrml.tenant', $pinned, true)` (the txn-scoped parameterizable form) + `SET LOCAL ROLE scrml_app`. Confirmed txn-scoped: a later txn with no GUC sees 0 rows (auto-reset, no pooled bleed).
- **F3 — a `USING`-only policy doubles as `WITH CHECK` for INSERT** (PG default) ⇒ M1 blocks cross-tenant INSERTs for free (a bonus; full write-authority is still P2).
- **Bun.SQL:** unix-socket peer auth = `new SQL({ path: "/var/run/postgresql", database, username })` (NOT `hostname`). `sql.begin(async tx => …)` binds ONE reserved connection — `SET LOCAL ROLE` + `set_config` + the query must ALL run on that `tx` (a shared-handle statement-level `BEGIN` under a pool does NOT hold the principal).

## 3. Declaration surface (M1-PROVISIONAL — flagged to bryan as a later syntax pass)
The real surface-syntax design is a separate bryan-owned pass; M1 needs a minimal, reversible trigger. **Use the DD's illustrative per-table form:**
```scrml
<schema db="postgres://…">
  invoices {
    id: uuid primary key
    tenant_id: uuid not null
    amount: decimal not null
  } db-authoritative        // ← M1 opt-in marker: relocate tenant-isolation to the DB
</schema>
```
- Parse site: `compiler/src/schema-differ.js` `parseSchemaBlock` (**line 16**, regex `/(\w+)\s*\{([^}]*)\}/g` at line 21 — extend to capture a trailing `db-authoritative` keyword after the closing `}`; carry a `dbAuthoritative: true` flag on the `TableDecl`). If an in-block directive line parses more cleanly than a trailing keyword, that's acceptable — document whichever you pick in the SPEC section. Keep it thin; the emitted SQL (not the surface) is the load-bearing artifact.
- **`E-DBAUTH-SQLITE` hard-fail:** if a table is marked `db-authoritative` and the resolved driver is not `postgres` (`resolveDbDriver`, `compiler/src/codegen/db-driver.ts:68`) → fatal compile error `E-DBAUTH-SQLITE` ("db-authoritative requires a Postgres target"). Fail-closed.

## 4. S7-minimal fence — fire-sites
`compiler/src/schema-differ.js` (1214 LOC; driver param already exists — `options.driver ?? "sqlite"` at **line 287**, and postgres lowering already branches at line 479):
- The SQLite 12-step DROP/recreate is `generate12StepRebuild` (called at **:327/:340**, the DROP at **~:630**, region **:600-635**). On a Postgres driver this must NOT run — emit real PG `ALTER TABLE … ADD/DROP COLUMN` instead (Postgres has real ALTER; the 12-step is a SQLite limitation).
- Actual-state reader is SQLite-`PRAGMA`-only (**:242-249**); an `information_schema` path exists partially (**:841/:875/:884**). For M1 you do NOT need a full object-aware differ (that's the deferred S7-full XL tail) — you need: (a) don't DROP/CASCADE the table (which would drop its RLS policy), (b) a never-clobber fence so a re-migration leaves `scrml_*` policies/roles intact. Emit forward DDL; do not attempt to diff policy state.

## 5. S1 + S6 DDL emitters — the validated target shape
Emit (once, at startup/migration for the db-authoritative table + app):
```sql
-- S6 bounded role (idempotent; cluster-global — namespacing is a deferred concern, use a stable name for M1)
DO $$ BEGIN CREATE ROLE scrml_app NOLOGIN NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO scrml_app;

-- S1 RLS (FORCE so the table owner is subject to it too)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY scrml_tenant_iso ON invoices
  USING (tenant_id = current_setting('scrml.tenant', true)::uuid);
```
- New emitter functions (mirror `generateCreateTable` at `schema-differ.js:366`). Grep-confirmed: ZERO prior art for any of these in-tree — you are building the first.
- The DDL must be applied at runtime once (where `<schema>` migrations apply — map the `_scrml_migrations` path). `current_setting('scrml.tenant', true)` — the `true` = missing-GUC-returns-NULL (not error); a NULL tenant then matches no row (0 rows) — that IS the fail-closed read.

## 6. A1/S2 principal txn-wrapper — the hot-path reversal (highest-risk)
`compiler/src/codegen/emit-server.ts` (5260 LOC):
- **Handle decl (current lines):** `const _scrml_sql = new SQL(<connStr>)` is injected at **:4849** (region :4738-4856; the DD's ":4738-4764" is stale). Every `?{}` emits `await _scrml_sql\`…\`` (see the `postgres-program-driver` baseline: handle at emitted `:8`, query at emitted `:45`). Existing txn path: `_scrml_sql.unsafe("BEGIN DEFERRED"/"COMMIT"/"ROLLBACK")` at **:3111/:3255/:3294** (§44.6).
- **The pinned scalar already exists per-request:** `_scrml_active_tenant(req)` (used by the §14.8.10 egress redact at **:1311**) resolves the ambient tenant — this is the value that goes into `set_config('scrml.tenant', <that>, true)`. `_scrml_current_user(req)` (**:2053**) is the fuller identity if needed.
- **Conditional engagement (THE de-risk):** the wrapper engages ONLY when the app declares ≥1 db-authoritative table. Thread the `dbAuthoritative` flag from the parsed schema to emit-server (extend/mirror `collectDbScopes`, `emit-server.ts:~544-571`). When zero db-authoritative tables → **emit byte-identical to today** (the ambient fast path). This bounds the blast radius to opt-in apps.
- **For a db-authoritative app,** every `?{}` execution runs on a reserved connection carrying the principal:
```js
await _scrml_sql.begin(async (tx) => {
  await tx`SELECT set_config('scrml.tenant', ${_scrml_active_tenant(_scrml_req)}, true)`;
  await tx.unsafe("SET LOCAL ROLE scrml_app");
  return await tx`…the original query…`;   // same tagged-template body, on tx not _scrml_sql
});
```
  Compose with the existing §44.6 txn path (a server fn already in a transaction must inject the principal at the TOP of that same reserved txn, not open a nested one).

## 7. The negative test — the acceptance gate
- Write an integration test that: provisions a scratch PG16 DB (socket `/var/run/postgresql` is available on this machine), applies the M1-emitted DDL for `invoices`, inserts rows for two tenants, then opens a **raw** connection (bounded role, NO `set_config`) and asserts it reads **0 rows**; and that a connection WITH `set_config('scrml.tenant', <tenantA>)` reads only tenant-A rows. This mirrors the spike exactly.
- **CI reality (important):** the cloud `gate` (unit+conformance+gauntlet) canNOT depend on a live Postgres — a live-PG test there is infra-flaky. So the negative test must **skip-gracefully when PG is unreachable** (detect the socket / a `SCRML_PGTEST` env gate) and run for real locally. It is the LOCAL acceptance proof; do not let it red the cloud gate. Document this in the test header.
- Also add a **byte-identical anti-regression guard**: recompile `samples/compilation-tests/postgres-program-driver.scrml` (has NO db-authoritative table) and assert its `.server.js` is unchanged vs the committed baseline — proof the conditional engagement is a true no-op for non-authoritative apps.

## 8. SPEC + conformance (land WITH the impl — §5 discipline)
- Add a focused SPEC section for the M1 tier (a new `<schema>`/security subsection). State EXACTLY what M1 enforces: **reads-authoritative invariant-relocation only** (RLS keyed on the pinned tenant scalar), Postgres-only, opt-in per table, `E-DBAUTH-SQLITE` on a SQLite target, S6 bounded-role mandatory. Do NOT over-claim write-authority/SECDEF/triggers (those are P2+). Register `E-DBAUTH-SQLITE` in the error index.
- Add a conformance case pinning `E-DBAUTH-SQLITE` (codes-half) + a compile-shape case asserting the emitted DDL for a db-authoritative table (the SQL-shape half). The live-PG negative test is the runtime-half but is local-gated (§7).

## 9. Constraints / discipline (MANDATORY)
- **NEVER `--no-verify`** and never disable/override the git hooks. If the pre-commit gate is slow, wait it out (full suite ~110-125s). Commit INCREMENTALLY (your branch + commits are crash-recovery) — do not batch the whole arc into one commit.
- `bun scripts/facts.ts --write` before any commit that touches `compiler/src`, tests, or `SPEC.md` (the FACTS gate will red the push otherwise).
- Run the existing suite green before claiming done: `bun test compiler/tests/{unit,integration,conformance}`.
- Keep everything on your worktree branch; do NOT push to main (branch-protected; the PA lands via PR after an adversarial review). Leave the branch + a short `docs/changes/db-authoritative-m1/PROGRESS.md` as your recovery anchor.
- **Return:** report the branch name + tip SHA, the emitted-SQL you produced, the negative-test result (with the actual PG run output), the byte-identical guard result, and any place you deviated from this brief or found it wrong. The PA runs an adversarial `/code-review high` + re-runs the negative test independently before landing — write for that scrutiny.
