# BRIEF — DB-authoritative P2: writes-authority (S3 immutable columns + S4 SECDEF mutation-choke)

**Dispatched:** S287-bryan, 2026-07-26 · agent `scrml-js-codegen-engineer` · `isolation: worktree`
**DONE-PROBE:** grep -q generateSecdefDDL compiler/src/schema-differ.js
**Authority (READ FIRST, in full — absolute paths, sibling scrml-support repo, read-only):**
- `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/db-authoritative-p2-writes-authority-2026-07-26.md` — the RULED DD. bryan ruled **S4-A (fn-in-`<schema>`, co-location) + "your recs" on the other 5 forks + the M1-grant reshape** (S287, 2026-07-26).
- The M1 + M2 + apply-seam DDs (same dir) for the tier context. P2 CONTINUES them; it is the first §14.8.10-firewall-crossing milestone (scrml emitting *authorization*).

Fire-sites PA-verified against `main @ 79cd79ce` — trust them over the DD's line numbers.

## 0. The ruling (do NOT re-open)
- **S3 surface:** a per-column `immutable` keyword. **+ RESHAPE the M1 blanket GRANT** (must-fix in landed code — see §2).
- **S4 surface:** `fn NAME(args) security definer owner(<role>) requires cap("x") { """<plpgsql body>""" }` **inside `<schema>`** (co-location) → requires the `parseSchemaBlock` parser upgrade (§3). Body is **managed plpgsql-text** (verbatim, NOT compiled — the mini-compiler is the ruled-out XL trap).
- **SECDEF hardening = a codegen INVARIANT (gate-verified):** every emitted SECDEF function carries `SECURITY DEFINER SET search_path = pg_catalog, public` + `REVOKE EXECUTE … FROM PUBLIC` + `GRANT EXECUTE … TO scrml_app`, owned by a bounded **SECDEF owner role** distinct from `scrml_app`. A SECDEF missing `search_path` is a CVE-2020-25695 privesc hole — worse than none.
- **Capability-GUC:** a single JSON `scrml.principal.caps` GUC + a `scrml_has_cap(text)` plpgsql helper, injected alongside M1's `set_config('scrml.tenant', …)`.
- **Composition:** STACK, not supersede — direct writes stay banned (§14.8.10 `E-TENANT-WRITE` + the column REVOKE); the SECDEF **call** is the sole sanctioned mutation path.
- **Phasing:** P2 = S3 + S4 ONLY. The S5 double-entry balance trigger stays **P3** (do NOT build it).
- **Postgres-only** (like M1/M2); a `db-authoritative`/SECDEF construct on a non-PG target → `E-DBAUTH-SQLITE`.

## 1. The atomic-milestone unit (acceptance gate — NON-NEGOTIABLE, live PG16 through the CLI)
On the Adopter-A shape (`invoices` with an `immutable` column + a SECDEF `fn`), after `scrml db-migrate` applies as owner, a 4-assertion live-PG negative test:
1. a bounded `scrml_app` **direct `UPDATE` of an immutable column → DENIED** (permission denied);
2. a bounded `scrml_app` mutation of the locked table **NOT through the SECDEF → DENIED**;
3. the SECDEF `fn` **enforces the capability check** — CALL with `scrml.principal.caps` containing the cap → succeeds; without → raises `denied`;
4. the emitted SECDEF is **hardened** — assert via `pg_proc` that `prosecdef` is true AND `proconfig` contains `search_path=pg_catalog, public`.
Skip-graceful when PG unreachable (socket probe, like M1/M2). This is the ONLY proof that separates real write-authority from "looks enforced and isn't."

## 2. S3 — immutable columns + the mandatory GRANT reshape (`schema-differ.js`)
- **`parseColumns` (`:63`):** recognize a per-column `immutable` keyword → `col.immutable = true`.
- **`generateDbAuthoritativeDDL` (`:531`, the blanket GRANT at `:555`) — RESHAPE (must-fix in landed M1 code):** M1 emits `GRANT SELECT, INSERT, UPDATE, DELETE ON t TO scrml_app`. A Postgres column-level REVOKE canNOT narrow a table-level GRANT, so an `immutable` column is a **silent no-op** until this is reshaped. Emit instead: `GRANT SELECT, INSERT, DELETE ON t TO scrml_app;` + `GRANT UPDATE (<mutable cols>) ON t TO scrml_app;` (only the non-`immutable` columns; if a table has NO immutable columns, keep the table-level UPDATE grant to stay byte-identical for existing M1 apps). This is Adopter-A's shipped immutable-by-omission pattern. **Anti-regression:** a `db-authoritative` table with zero `immutable` columns must emit byte-identical to M1 today.

## 3. S4 — the parseSchemaBlock parser upgrade + SECDEF emission
- **`parseSchemaBlock` (`:16-31`) — upgrade the regex to a real block parser.** Today: `/(\w+)\s*\{([^}]*)\}/g` (non-nested `[^}]*` — breaks on a `fn { … }` whose plpgsql body has braces). Replace with a brace-depth-aware scan that recognizes BOTH `tableName { … }` table decls AND `fn NAME(args) … { """body""" } / fn … plpgsql { … }` function decls. **BACKWARD-COMPAT (hard requirement):** keep returning `{ tables: [...] }` (all 6 consumers read `.tables ?? []` — `protect-analyzer.ts:533/724`, `channel-watches.ts:164`, `gauntlet-phase1-checks.js:753`, `codegen/index.ts:1508`, `db-authoritative.ts`); ADD `fns: [...]` additively. A regression test: existing multi-table `<schema>` blocks parse identically; a `<schema>` with an `fn` yields the tables AND the fn.
- **`generateSecdefDDL` (new, in `schema-differ.js`) — emit per `fn` decl:**
  - the bounded SECDEF **owner role** (idempotent DO-block `CREATE ROLE <owner> NOLOGIN NOBYPASSRLS`; it must hold the privileges the function body exercises — e.g. UPDATE on the locked columns; grant those to the owner);
  - `CREATE OR REPLACE FUNCTION <name>(<args>) RETURNS <ret> LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$ <body, verbatim managed text; if `requires cap("x")` prepend the `IF NOT scrml_has_cap('x') THEN RAISE EXCEPTION 'denied'; END IF;` guard> $$;` — owned by `<owner>` (`ALTER FUNCTION … OWNER TO <owner>`);
  - `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC;` + `GRANT EXECUTE ON FUNCTION … TO scrml_app;`
  - identifier-escape everything via `quoteIdent` (the M2-HIGH lesson — never interpolate a name raw).
- **`scrml_has_cap(text)` helper** — emit ONCE (idempotent `CREATE OR REPLACE FUNCTION scrml_has_cap(cap text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('scrml.principal.caps', true)::jsonb ? cap, false) $$;` — reads the caps GUC as a JSON array/object, checks membership). Hardened (`search_path`).

## 4. The capability-GUC injection (`compiler/src/codegen/db-authoritative.ts`)
- `wrapPrincipalTxn` injects `set_config('scrml.tenant', _scrml_active_tenant(_scrml_req), true)` + `SET LOCAL ROLE scrml_app` at `:414-416`. **ADD** `set_config('scrml.principal.caps', <caps-json>, true)` in the same reserved txn, so a SECDEF called during the request sees the principal's caps.
- **The caps SOURCE:** resolve from the per-request principal — mirror `_scrml_active_tenant`. `_scrml_current_user(req)` (`emit-server.ts:~2053`) yields `{id,role,isAuth,tenantId}`; add a caps resolver (`_scrml_active_caps(req)` → a JSON string of the principal's capabilities, app/session-provided like `tenantId`). If no caps source exists yet, emit an empty-array default + FLAG it: the caps SOURCE (how an app declares a principal's capabilities) is an M1-PROVISIONAL detail — session-provided, resolved server-side, never client-supplied (mirror the `tenantId` E-REACTIVE-003 discipline). Note it in the report; do NOT invent a client-trusting path.

## 5. The M2 apply seam (`compiler/src/commands/db-migrate.js`) — the "2 one-line gaps"
`db-migrate` must apply the new S4 DDL (CREATE FUNCTION + the owner role + the reshaped grants). Verify: the desired→apply flow emits them via `generateDbAuthoritativeDDL`/`generateSecdefDDL`; the `classifyStatement` ledger authorship handles CREATE FUNCTION/CREATE ROLE (extend if needed); the never-clobber fence must not DROP a scrml-managed function/owner-role. `--dry-run` shows the SECDEF plan.

## 6. SPEC + conformance
- SPEC §14.8.11.2 (a new subsection): the P2 writes-authority normative model — immutable columns (grant-narrowed), the SECDEF mutation-choke, the mandatory hardening (`search_path` + `REVOKE PUBLIC` + bounded owner), the `scrml.principal.caps` GUC + `scrml_has_cap`, the STACK-with-§14.8.10 composition, and the firewall-crossing statement (scrml now emits authorization). Register new codes/warnings.
- Conformance: a compile-shape case (the emitted S3 grant-reshape + S4 SECDEF hardened DDL) + the live-PG 4-assertion gate (§1, local-gated).

## 7. Explicitly OUT (do NOT build): the S5 double-entry balance / DEFERRED-constraint trigger (P3); the general non-provisional surface-syntax pass; S7-full object-aware diff.

## 8. Discipline (MANDATORY)
- **NEVER `--no-verify`; never disable hooks.** Full-suite pre-commit (~110-125s) — wait it out. Commit INCREMENTALLY (suggested order: parser upgrade + backward-compat test → S3 immutable + grant reshape → S4 SECDEF emit + owner role + scrml_has_cap → caps-GUC injection → M2 apply wiring → acceptance gate + SPEC). Keep `docs/changes/db-authoritative-p2/PROGRESS.md` updated.
- `bun scripts/facts.ts --write` before any commit touching compiler/src/tests/SPEC.
- Existing suite green: `bun test compiler/tests/{unit,integration,conformance}`. Local PG16 at socket `/var/run/postgresql` (your OS user has CREATEDB/CREATEROLE) for the acceptance test — bootstrap a password migrator role over TCP like the M2 test does.
- WORKTREE: gitignored `dist/` absent — recompile as needed.
- **This is authorization emission — the "looks enforced and isn't" risk is doubled.** Land on your branch only. **Report:** branch + tip SHA, the emitted S3-reshaped-GRANT + S4 SECDEF DDL (paste), the 4-assertion acceptance result WITH the live PG run, the parser backward-compat regression result, the caps-source disposition, full-suite counts, and any place this brief was WRONG. The PA runs an adversarial `/code-review high` (a security-focused finder briefed to BREAK the write-authority — direct-write bypass, SECDEF privesc, caps-check bypass, injection) + re-runs the acceptance test against PG16 independently before landing.
