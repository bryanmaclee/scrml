# domain.map.md
# project: scrml
# updated: 2026-08-05T00:00:00Z  commit: 15e5e070
# NOTE (S321 INCREMENTAL pass): over `b929b9c9` -> `15e5e070` (S320-tail + S319 + S321, ~19 commits).
# **CORRECTION to the prior pass's framing: PR #405 (CPS auto-await consolidation) is NO LONGER HELD —
# it LANDED at `649d6fce` (#405) and was reviewed clean at `bbd77bec` (#413).** Every "#405 HELD /
# unmerged" statement this map carried is now stale and is corrected below (see "The `<machine>`
# keyword" section's neighbor, the auto-await sections, and Business Invariants). TWO new sections
# this pass: `W-IF-IN-EACH` (§17.1, #416) and the reset-init-thunk reassignment skip (§6.8, #417).
# Also folded in, having landed in the S320 tail after the PRIOR pass's cutoff: `g-runtime-script-tag-
# not-depth-prefixed` (#408) and `g-bare-variant-mask-leaks-into-string-literals` (#410) — both
# already had domain-relevant detail captured in dependencies.map.md/error.map.md at the prior pass;
# nothing further owed here. History stays in `docs/changelog.md` + `handOffs/delta-log.md`.
scrml is a single-file full-stack language + compiler (not a web app with a runtime business domain). "Domain concepts" here are the language's own primitives, normatively defined in `compiler/SPEC.md` (§1-§65+). This map is a navigation index into that spec, grouped by concern — not a restatement of the normative text.

## Core Concepts (by SPEC section)

**Reactivity** — `@cell` reactive declarations (§6, V5-strict access model); a cell auto-subscribes every read site. Value-native maps/sets (§59) give `@cell:[K]V` / `set[K]` first-class reactive collection types. §6.6.9: server-fn / client-cell read — "THE SPLIT" — a server function reading a client cell gets an explicit CPS-marshal boundary (E-REACTIVE-003 + W-SERVER-DERIVED-MARSHAL) instead of a silent value smuggle.
**State machines** — `<engine for=Type>` (§51) governs variant-graph progression via `rule=`/`initial=`/`<onTransition>`/`<onTimeout>`/`<onIdle>`; `<engine server=@source>` gives server-authoritative hydration (§52.4.4). Sibling: §54 nested substates. E-ENGINE-* is the largest single family (see error.map.md). **`<machine>` is GONE as of S307 — see "The `<machine>` keyword is REMOVED" below.**
**Client Router / soft navigation — §20.8, LANDED (Wave-1a soft-nav + Wave-1c PR-1 composition).** `<program>` is the persistent application shell (single-file `<page>` children or multi-file `pages/*.scrml`); it MAY contain exactly one `<outlet>` — the region into which the current route's SSR-fetched content swaps on navigation. §20.8.3 link-boost (a delegated document-level `click` listener in `compiler/src/runtime-template.js`, boot-wired only on an app with an `<outlet>`) intercepts internal same-origin cross-page `<a href>` clicks and routes them through the soft-nav engine instead of a full reload; `hard` opts a specific link out. See "The one-landmark invariant" below for the §20.8.1.1 / §40.8.2 emission + composition contract.
**Standalone tools — §64** — `<program kind="tool">` compiles to a CLI-style module with one `function main(args)` entry (E-TOOL-001..006). `<program kind="tool" serve=PORT>` emits a compiler-owned `Bun.serve` harness hosting the tool's `<endpoint>`/SSE routes headlessly (no CSRF, no cookie-session, no SSR); cookie-session `auth=` on a `serve=` tool is fail-closed rejected (E-TOOL-SERVE-AUTH-UNSUPPORTED). `<foreign lang="ts">` (§23.6) gives a library file its own foreign-language declaration.
**Pattern matching / enums** — `match`/`is` over closed enum unions (§18); shorthand `.Variant` forms (§14.5); exhaustiveness is a compile error, not a runtime default. E-TYPE-082 fail-arity ruling for enum-variant construction payload arity. **§18.0.1 block-form arm validity (NEW S288, #192):** a tag opener at a block-form `<match>` arm position that is neither a variant-named arm nor the wildcard `<_>` catch-all is `E-MATCH-INVALID-ARM` (the Ghost-Pattern `<when is="…">` an LLM/framework-refugee reaches for) — see error.map.md. A KNOWN residual: a no-`for=` block-form `<match on=@cell>` still skips exhaustiveness entirely (`g-match-nofor-block-form-skips-exhaustiveness`, MED, open, flagged for bryan — a SPEC/impl divergence, not yet reconciled).
**Absence** — `not` is the ONE canonical absence value (§42). `null` and `undefined` are NOT valid scrml tokens in ANY position (expression/attribute/type/identifier) — hard rule, W-ABSENCE-IN-SCRML-SOURCE lint + E-SYNTAX-042 hard error. Defined-but-empty values (`""`, `0`, `false`, `[]`, `{}`) are NOT absence.
**Logic contexts** — `${}` (logic), `?{}` (SQL), `#{}` (CSS), `_{}` (foreign/escape-hatch, §23), `^{}` (meta/compile-time eval, §22), `~{}` (test, §19.13), `!{}` (error-arm, §19). Each is a distinct parse context (§3-§4, §7-§9).
**SQL** — `?{}` inline SQL blocks (§8) resolve against `<db>`/`<schema>` (§39); `?{}` in a library context emits reactive-deps-aware client SQL (W5b). E-SCHEMA-001/002/004 + W-SCHEMA-001 strict §39.4 `<schema>` column-type checks wired; a real-DB conformance adapter (Bun.SQL in-memory seam, `sqlEngine` opt-in) exercises live-DB behavior in the D3 corpus. **`codegen/sql-lex.ts` (#120) is the SINGLE source of truth for which `${…}` inside a `?{}` body is LIVE (code context) vs INERT** (inside a string literal, `""`-quoted identifier, `E'…'`, `$tag$…$tag$` dollar-quote, `--` line comment, or a NESTED `/* */` block comment). The same function feeds BOTH the classifier (`collect.ts` load-kind / row-scope predicate) and the emitter (`rewrite.ts` `extractSqlParams`).
**Confidentiality — the four axes (§52.15.4).** route-admission (§52.15.2) ⟂ tenant-scope (§14.8.10) ⟂ per-user row-selection (§52.15.3) ⟂ column-redaction (§14.8.9). These STACK; none substitutes for another. The two compiler-enforced floors:
  - **§14.8.9 column floor** — a protected `<schema>` column can never reach the client bundle (E-CG-001, acorn-exact egress scan, `codegen/egress-field-scan.ts` + `codegen/protect-egress.ts`).
  - **§14.8.10 tenant-row isolation floor (#117/#118)** — the ROW-level twin of §14.8.9, one predicate deeper on the SAME schema registry and the SAME egress sinks. It owns ONLY the isolation INVARIANT ("a row of tenant A never reaches a request whose ambient tenant is B"), never policy (roles/grants/who-may-act-as stay app-owned). `tenant_id` is a CONVENTION, not a declaration keyword — a `<schema>` table carrying that column IS tenant-scoped, fail-closed by default. The ambient tenant is CONSUMED, never derived: the app pins `session.set("tenantId", t)` and the floor reads `@currentUser.tenantId`. REDACTION is the guaranteeing mechanism; INJECTION is mandatory only where redaction cannot cover (aggregates `E-TENANT-AGG`, writes `E-TENANT-WRITE`, raw/foreign egress `E-TENANT-RAW-EGRESS`). `.acrossTenants()` is the sole loud opt-out (`I-TENANT-ACROSS`). Implementation: `codegen/tenant-egress.ts`, consumed by `codegen/emit-server.ts`. **S288: `tenant-egress.ts`'s `buildTenantContext` now ALSO unions the `<schema>`-declared tables (`extractDesiredSchema`), not just the `<db>`-derived registry — see the §14.8.11 section below for why the `<db>`-only reading was a defect for a `<schema>`-only app.** **§14.8.11 below relocates this SAME invariant into the database, as an opt-in escalation — see "STACK, not supersede" there.**
**SSR sequencing — auto-make-safe, §52.15.5 (#120).** The SSR compose route is an ANONYMOUS-REACHABLE GET. Seeding an auth-scoped, UNSCOPED cell into that paint would bake one query result into every viewer's HTML. The compiler **auto-makes-safe rather than hard-erroring**: such a cell is OMITTED from the SSR seed entirely and hydrates client-side post-mount behind its already-gated `/__serverLoad` fetch. `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` (Info, per-var) records the omission. Row-scope identity is decided by the shared `sql-lex` LIVE-interpolation predicate.
**CSS — the §65 scrml-native model — Wave-1 EMISSION LANDED.** Deletes cascade specificity. `<theme>` + `<defaults>` are structural elements (NOT HTML). `:where()`-flat emission, the `@layer reset, global;` order, `<theme>` token → `:root` custom-property lowering via a `@`-sigil use-site syntax, and the §65.6 runtime theme-switch reflection are implemented. Diagnostic: `E-THEME-TOKEN-UNKNOWN`.
**Realtime — §38.13 `<channel watches=table>`** — a change-feed-over-external-DB-writes primitive, distinct from the general §38 WebSocket `<channel>`. Front-end recognition + `RowChange` synthesis (`channel-watches.ts`) + Postgres trigger DDL install + the bundled-`pg` LISTEN bridge + client `__change` frame dispatch are all landed. `<onchange>` is the client-side handler element.
**Auth / BaaS** — `scrml:auth` stdlib module: magic-link / email-verify / password-reset flows + HS256 JWT + JWKS RS256 verification + `generatePassword`. §20.5 session-establishment (`session.set`/`.destroy`/`.userId`/`.role`/`.get`/`.isAuth`) is the write half of the session model; `session.set("tenantId", t)` is also the §14.8.10 tenant-key establishment point AND the identity source the §14.8.11 DB-authoritative A1 wrapper's `_scrml_active_tenant`/`_scrml_active_caps` resolvers read. See auth.map.md.
**Server/client boundary** — inferred, not annotated: a function that REFERENCES a binding imported from a server-only stdlib module (or performs DB/crypto/host access) escalates to server-only (§12.2 Triggers 1+3 — **Trigger 3 was RULED at S280 and only BUILT at S299; any doc dated between those describing it as live was wrong**); referencing `session` also escalates (§20.5). Note the precise subject: **an import is FILE-scoped and cannot itself escalate anything** — the unit of escalation is the FUNCTION that uses the binding. `E-CG-001` is the fail-closed backstop that blocks any protected DB column from reaching the emitted client bundle (acorn-exact scan, §14.8.9). **§12.2 Trigger 6 clarified S288 (#195/#200, Peter):** a first-class function reference (not a call) keeps a function reachable, and reachability descends into nested closure bodies — closes a `W-DEAD-FUNCTION` false-positive class; no placement change. See error.map.md.
**Colorless async — §13.1/§13.2, ratified S258, Seam-A LANDED.** scrml source has no `async`/`await` keywords; the compiler infers async-ness by tracing calls to Promise-returning host primitives. See dependencies.map.md for the landed unit breakdown.
**Writer-ownership Axiom ① — §5.5.3/§5.5.4 (#81).** A physical DOM surface has AT MOST ONE wholesale reactive writer; a contending second writer fires `E-ATTR-WRITER-CONFLICT` naming both sites.
**Typed API surfaces** — `<api>` (§60, typed EXTERNAL API consumption) vs `<endpoint>` (§61, typed INBOUND endpoint — the serve-side mirror).
**Linear types** — `lin` (§35) + the `~` pipeline-accumulator keyword (§32) for exactly-once-consumed values.
**Input state** — `<keyboard>`/`<mouse>`/`<gamepad>` (§36) are LIVE-READ, not reactive-subscribed.
**Build/deploy asset addressing — §47.9.8.** Content-addressed per-page client bundles/CSS on `scrml build`. See build.map.md.

## §14.8.11 / §14.8.11.1 / §14.8.11.2 — the opt-in DB-authoritative security tier (M1/M2/P2)

**Read this before touching `schema-differ.js`, `codegen/db-authoritative.ts`, `codegen/sql-ident.ts`,
`commands/db-migrate.js`, or the §14.8.10 tenant floor's `tenant-egress.ts`.**

**What it IS — a trust-boundary REVERSAL, opt-in per table, that STACKS with §14.8.10 rather than
superseding it.** §14.8.10 owns the isolation invariant at scrml's compiler-owned client-egress
sink — a direct `psql` connection reads unredacted rows BY DESIGN. A `db-authoritative` table
relocates the SAME isolation invariant INTO the database (Postgres row-level security), so it holds
against ANY connection. It stays on the invariant side of the §14.8.10 "consume, never derive"
firewall through M1 (the RLS policy is keyed on the SAME app-pinned `@currentUser.tenantId` scalar);
P2 (below) is the first milestone that deliberately CROSSES that firewall. The two tiers compose as
defense-in-depth: an `invoices`-style `db-authoritative` table also carries a `tenant_id` column, so
it is ALSO a §14.8.10 tenant-scoped table and the §14.8.10 compile-time hard-fails (`E-TENANT-WRITE`/
`E-TENANT-AGG`) still apply on top.

**Milestone 1 — reads-authoritative (Postgres RLS).** A table opts in with a bareword
`db-authoritative` immediately after its closing `}` (Postgres-only; M1-PROVISIONAL surface). Emits,
idempotently (never clobbers a live policy on re-migration): a bounded `scrml_app` role (`NOLOGIN
NOBYPASSRLS` — MANDATORY, because a superuser/owner BYPASSES `FORCE ROW LEVEL SECURITY`, so A1
without this bounded role is a SILENT NO-OP, the "looks enforced and isn't" trap); `ENABLE`+`FORCE
ROW LEVEL SECURITY`; a `scrml_tenant_iso` policy keyed on `current_setting('scrml.tenant', true)`
(missing GUC -> NULL -> matches NO row -> fail-closed). **A1 — the per-request principal (S2 GUC
injection):** for an app with ≥1 `db-authoritative` table, EVERY `?{}` query runs inside a
`_scrml_sql.begin(async (tx) => …)` transaction that pins `scrml.tenant` (txn-scoped `set_config`,
so it auto-resets on commit — no cross-request bleed under a pool) then `SET LOCAL ROLE scrml_app`,
then runs the original query on `tx`. Conditional engagement: zero `db-authoritative` tables emits
BYTE-IDENTICAL to today. Mechanism: `schema-differ.js` (`generateDbAuthoritativeDDL`) +
`codegen/db-authoritative.ts` (`wrapPrincipalTxn`, `appDeclaresDbAuthoritative`).

**S288 fix — the session principal wasn't actually reaching a request (`g-dbauth-session-principal-
not-wired`, was HIGH, RESOLVED).** Two compounding defects made the tier non-functional end-to-end
for a `<schema>`-only app (no `<db>` block) — the exact shape it targets. Found by an adopter's
BEHAVIORAL run (real PG16, real Argon2id credentials, real cookie sessions over HTTP), not by any
suite (the tier's own tests hand-execute `set_config` inside a transaction and never issue a
request). **(C)** the RI-route handler a plain server `function` compiles to interpolated
`_scrml_currentUser` with ZERO bindings — a `ReferenceError` on every call; fixed by a NEW
`astSqlQueryUsesCurrentUser` walker in `emit-server.ts` (widens `_needsSessionInfra`'s gate to this
third shape) plus a handler-scope-entry splice of `const _scrml_currentUser = _scrml_current_user
(_scrml_req)` when the emitted body actually references it. **(D)** `@currentUser.tenantId` was
never projected for a `<schema>`-only app — `buildTenantContext` read ONLY the `<db>`-derived
registry, so `_tenantActive` was false and `_scrml_active_tenant()` returned null on every request,
even though §14.8.11 (which gates on the DIFFERENT `db-authoritative` marker) engaged anyway and
faithfully pinned a null tenant — each half internally consistent, the composition dead, and SILENT
(no diagnostic). Fixed: `buildTenantContext` now takes the `<schema>`-declared tables as a second
arg and unions them in. Regression lock: `compiler/tests/integration/schema-only-tenant-principal.
test.js` (verified to FAIL on pre-fix source). See schema.map.md for the `buildTenantContext` shape
detail.

**Milestone 2 — the migration-apply seam (`scrml db-migrate`).** M1 EMITTED the DDL but nothing
applied it — a shipped db-authoritative app never installed its own RLS policy. M2 closes that gap
with a PRIVILEGED OUT-OF-APP CLI, never auto-apply-on-boot: the running app is, by construction, the
bounded `scrml_app` role with NO DDL rights (a role that could install the RLS policy could also
`DROP` it), so applying the security DDL requires a DIFFERENT, more-privileged migrator/owner
principal, run out-of-process (`scrml db-migrate <project> --db <migrator-url>` — mirrors
PostgREST's migrator-vs-authenticator discipline). Under the migrator connection, in ONE
transaction: `pg_advisory_xact_lock` (serializes concurrent migrators, auto-releases on
commit/rollback) -> ensure the thin `_scrml_migrations` ledger (apply-atomicity + object-authorship,
NOT a versioned migration-file history) -> read actual state (`readActualSchemaPg` + a narrow
scrml-managed policy/role PRESENCE read) -> `diffSchema` -> apply + record. **S288: a statement
failure during apply is now ATTRIBUTED to its exact index + SQL text and echoed by the CLI** — see
migrations.map.md. The never-clobber fence:
a bare `DROP TABLE` for an actual-but-not-desired table is REFUSED by default
(`W-SCHEMA-DESTRUCTIVE-DROP`) because a Postgres DROP CASCADEs the attached RLS policy/grants —
`--allow-destructive` opts in. `scrml db-migrate` is ALSO general (Fork 5): it applies a plain
`<schema>` to SQLite too (no roles/policies), finally making `<schema>` do-something-at-deploy for
every adopter, not just db-authoritative ones. Identifier escaping (`codegen/sql-ident.ts`'s
`quoteIdent`) is a SECURITY INVARIANT here, not a nicety — names read from the live DB via
`readActualSchemaPg` are attacker-influenceable, and the seam applies each statement as the MIGRATOR
(the most-privileged principal) via `tx.unsafe(stmt)`.

**Milestone 2 / P2 — writes-authority (immutable columns + the SECURITY-DEFINER mutation choke).**
P2 DELIBERATELY CROSSES the §14.8.10 "consume, never derive" firewall — scrml now COMPUTES an
authorization decision in DDL it authored, not just relocates an isolation invariant. Two pieces:
- **S3 — the `immutable` column keyword.** A per-column bareword (mirrors `not null`/`unique`)
  marks a column `scrml_app` may INSERT but never UPDATE. Because a Postgres column-level `REVOKE`
  CANNOT narrow a table-level `GRANT`, a table with ≥1 EFFECTIVELY-immutable column gets its M1
  blanket `GRANT … UPDATE …` RE-SHAPED to `GRANT SELECT,INSERT,DELETE` + `REVOKE UPDATE` + a
  column-scoped `GRANT UPDATE (<mutable cols>)`. **S288 — auto-immutable PK/`tenant_id`, RULED
  bryan.** A `db-authoritative` table's PRIMARY KEY column(s) and `tenant_id` are now ALSO treated
  as immutable whether or not the author wrote the bareword (`isEffectivelyImmutable`,
  schema-differ.js) — before this, a WITHIN-tenant PK UPDATE succeeded (only a CROSS-tenant re-point
  was RLS-blocked), and silently re-pointing a row's identity under its own tenant is exactly the
  class the tier's audit-defensibility claim rests on. No per-column opt-out. **The PRIOR
  anti-regression guarantee — "zero `immutable` columns emits BYTE-IDENTICAL to M1" — is RETIRED**:
  a `db-authoritative` table always carries a PK, so it now ALWAYS takes the column-scoped grant
  path; SPEC §14.8.11.2 records the supersession explicitly. Non-`db-authoritative` tables are
  entirely unaffected. See schema.map.md.
- **S4 — the SECURITY-DEFINER `fn`, co-located in `<schema>`.** `fn NAME(args) security definer
  owner(<role>) requires cap("x") { """ <plpgsql> """ }` — the SOLE sanctioned mutation path for a
  column `scrml_app` was revoked from. The `fn` body is managed-migratable TEXT (opaque to the
  compiler, never compiled — the scrml→plpgsql mini-compiler is a deliberately-rejected trap, §23.5
  `_{}` precedent). SECDEF hardening is a CODEGEN INVARIANT, mandatory and gate-verified: `SET
  search_path = pg_catalog, public` (pins built-ins against shadowing — a missing search_path pin is
  a CVE-2020-25695-class privilege-escalation hole, WORSE than no enforcement, not merely
  unenforced); a bounded NOLOGIN owner role DISTINCT from `scrml_app` and from a superuser;
  `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO scrml_app`. The compiler emits the `requires
  cap("x")` check as the FIRST statement inside its OWNED `BEGIN…END` envelope (un-bypassable). The
  capability GUC: a single txn-scoped `scrml.principal.caps` (JSON array), pinned by the A1 wrapper
  in the SAME reserved txn as `scrml.tenant`, read by ONE checked helper `scrml_has_cap(text)`
  (unpinned -> `false`, fail-closed). Source: `tenant-egress.ts`'s `_scrml_active_caps(req)` —
  reads `@currentUser.caps` (M1-PROVISIONAL; an empty array when no caps source exists yet).

**The threat-model honesty bar (tier-wide, not just P2 — do not over-claim).** The GUC-based
principal (`scrml.tenant` + `scrml.principal.caps`) is server-resolved per request, but the GUCs are
SELF-SETTABLE by the `scrml_app` role: a `scrml_app` connection with an INJECTABLE SQL channel could
forge either and then invoke a SECDEF. What survives EVEN a fully-compromised `scrml_app` SQL
channel: the S3 immutable-column `REVOKE` (a Postgres privilege grant, not GUC-gated), the
SECDEF-only mutation choke, and the `NOBYPASSRLS` bound. What does NOT survive that compromise: the
GUC-gated tenant scope and cap check — those hold only for a non-compromised app (i.e., as long as
scrml's own parameterized-query emission, §8.2, keeps the SQL channel un-injectable). This is the
same self-settable-GUC model M1's `scrml.tenant` already uses.

**The atomic-milestone acceptance gate (the negative test, doubled at P2).** No milestone counts as
landed except as ONE atomic unit proven via a DIRECT-CONNECTION NEGATIVE test against a real
Postgres — a bounded `scrml_app` connection with NO `set_config` reads ZERO rows; WITH the tenant
pinned it reads ONLY that tenant's rows; at P2, additionally: a direct `scrml_app` UPDATE of an
immutable column is DENIED, a locked-column mutation NOT via the SECDEF is DENIED, the SECDEF
enforces its cap check both ways, and `pg_proc.prosecdef`/`proconfig`/`EXECUTE`-grantee are asserted
hardened. A half-shipped RLS "looks enforced and isn't" — worse than none. **S288 adds a REQUEST-PATH
lock alongside the direct-connection negative test** (`schema-only-tenant-principal.test.js`) — the
DDL negative test proves the floor exists; only the request path proves the app is standing on it. A
stronger, full login-over-HTTP form is still open (`g-dbauth-no-request-path-test`, MED).

**Known open gaps** (`docs/known-gaps.md`; none blocking). **RESOLVED THIS WINDOW (S288):**
`g-db-migrate-check-constraint-oneof-pattern` (all three original sub-bugs verdicted against real
PG16 — see error.map.md/schema.map.md/migrations.map.md); `g-dbauth-p2-pk-tenant-not-auto-immutable`
(auto-immutable PK/`tenant_id`, above); `g-dbauth-session-principal-not-wired` (above, was HIGH).
**Still open:** `g-dbauth-p2-caps-provenance` (MED — `_scrml_active_caps` has no real session-caps
source yet, `@currentUser.caps` is always `[]`, so any `requires cap` SECDEF is inert-deny until
wired; couples to S8 live revocation); `g-dbauth-secdef-owner-crud-all-tables` (LOW, over-grant);
`g-schema-predicate-arg-parse-edges` (MED, NEW S288 — `oneOf([])` empty-array + a latent MySQL
`escapeSqlString` backslash gap); `g-dbauth-no-request-path-test` (MED, NEW S288 — the regression
lock asserts emission, not a full login-over-HTTP round trip); `g-dbauth-docs-no-do-not-mark-users-
example` (LOW, NEW S288 — the marker reads as "apply to everything"; ask is a worked
don't-mark-`users` counter-example in the docs). S5 (double-entry / DEFERRED-constraint balance
triggers) is a separate P3 milestone; S7-full object-aware policy diffing and the non-provisional
surface-syntax pass are separately scoped.

**Cross-references:** §14.8.10 (the egress-redaction floor this tier stacks with); §44.2 (driver
resolution, `resolveDbDriver`); §39 (`<schema>` tables); §20.5.1 (`session.set("tenantId", …)`, the
pinned scalar `set_config` injects); §23.5 (`_{}` managed-foreign-text precedent for the plpgsql
body). Authority: bryan RULED (S286 threshold + phasing; S287 migration-apply-seam DD all-five-forks;
S287 P2 writes-authority DD S4-A co-location + "your recs"; S288 auto-immutable PK/tenant_id +
E-SCHEMA-010 reject-bareword ruling). See error.map.md (the §34 codes), dependencies.map.md (module
graph), schema.map.md (`TableDecl`/`SecdefFnDecl`/`isEffectivelyImmutable`/the lowering functions),
build.map.md (`scrml db-migrate` flags), migrations.map.md (the whole apply model).

## The one-landmark invariant + multi-file shell composition (§20.8.1.1 / §40.8.2, #124 Wave-1c PR-1; widened #126/#128)

**Read this before touching outlet, `<main>`, or MPA composition anywhere in codegen.**

**`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. There is no typed edge set, no `OutletNode` interface in `types/ast.ts`, and no ast-builder case that constructs one. Every consumer matches structurally (`n.kind === "markup" && n.tag === "outlet"`). This is the single most load-bearing fact about this surface: any pass that expects a typed node will silently find nothing.

**The invariant (§20.8.1.1):** exactly one `<main>` landmark per COMPOSED document, and the route slot is identified by the `data-scrml-outlet` attribute NAME — never by tag. The marker-not-tag rule is what keeps codegen and the runtime (`querySelector("[data-scrml-outlet]")`, runtime-template.js) in agreement even though the slot's tag varies between `<main>` and `<div>`.

**Four arrangements, three legal:**

| # | Shell shape | Outcome |
|---|---|---|
| 1 | `<outlet>` alone | outlet emits AS `<main data-scrml-outlet tabindex="-1">` |
| 2 | `<main><outlet/></main>` (wrapping) | author's `<main>` is the landmark; outlet demotes to marked `<div>` |
| 3 | `<page>`-scoped / `pages/*.scrml` `<main>` | route content owns the landmark; slot demotes to marked `<div>` |
| 4 | BARE / SIBLING `<main>` next to the outlet | **`E-OUTLET-AND-MAIN`** — ambiguous, only the author can resolve |
| 3b | `<main>` arriving via **COMPONENT EXPANSION** | **content-owned — the case-3 family (#126).** The SYM pass provably cannot see it (component bodies are raw text pre-expansion); the emitter can, and decides there. NO diagnostic fires — BY DESIGN |

**Where each decision actually lives — three files, three different stages:**

- **`codegen/emit-html.ts` — the LANDMARK decision (per-file, emit time).** `treeHasAuthorMain(root)` is a deliberately BROAD walk over every array/object-valued property, WeakSet-cycle-guarded. Breadth is the point: a false positive costs a `<div>` where `<main>` would also have been valid (invisible), a false NEGATIVE emits two `<main>`s (the exact defect the invariant prevents).
- **`codegen/index.ts` — the COMPOSITION SLOT (cross-file, composition time).** Slot = the FIRST marked element, falling back to the FIRST bare `<main>` for the pre-§20.8 back-compat path. `findMatchingCloseIdx` is a DEPTH-COUNTING close-tag scanner (skips comments and raw-text elements). `routeOwnsLandmark`/`slotShouldPromote` DEMOTE/RE-PROMOTE per composed document.
- **`compiler/src/symbol-table.ts` — the DIAGNOSTIC (SYM PASS 15.5).** `walkValidateOutlets` -> `collectOutlets` groups outlets by nearest enclosing `<program>` (orphans -> `E-OUTLET-OUTSIDE-SHELL`; 2nd..nth -> `E-OUTLET-DUPLICATE`); `E-OUTLET-AND-MAIN` fires on case 4 only, naming all three resolutions.

**ONE shared `<main>` predicate — `compiler/src/landmark-tag.ts`.** `isAuthorMainTag(node)` — case-INSENSITIVE (HTML is case-insensitive) but NR-`resolvedKind`-guarded (a user component named `Main` is not mistaken for the HTML element). Imported by BOTH `collectOutlets` and `treeHasAuthorMain`, so they cannot disagree.

**Outlet diagnostic family (4 codes):** `E-OUTLET-DUPLICATE`, `E-OUTLET-OUTSIDE-SHELL`, `E-OUTLET-AND-MAIN`, `W-OUTLET-ABSENT-SOFT-NAV-DISABLED`. See error.map.md.

## Coordinate space: SOURCE vs DIST (§47.9.5) — a CLASS, not a bug (NEW section, S296 D-4)

**Read this before touching any path computation in codegen, api.js, or a path-shaped oracle.**

scrml's emitted tree is **not** a mirror of its source tree. SPEC §47.9.5 strips a leading `pages/`
segment from `dirname(relative(outputBaseDir, source))`, so:

| source | dist artifact |
|---|---|
| `pages/login.scrml` | `dist/login.server.js`, `dist/login.client.js`, `dist/login.html` |
| `pages/customer/home.scrml` | `dist/customer/home.server.js` |
| `models/auth.scrml` | `dist/models/auth.server.js` |
| `pages.scrml` (root-level file, not a dir) | `dist/pages.server.js` |

**The strip applies to the DIRNAME only; the basename is untouched.** `api.js`'s `pathFor` is the
reference implementation; `emit-server.ts`'s `distServerPathOf` and `computeServedPath`, and
`api.js`'s own forward-index builder, each mirror it explicitly.

**The failure mode this creates.** Any code that reasons about a relationship between two files in
SOURCE space and then emits or validates it against the DIST tree is off by **exactly one segment**
— constant at every nesting depth, because the strip removes exactly one — for every file under
`pages/`. It is off by ZERO on a project with no `pages/` segment, which is why it survives most
fixtures. D-4's instance: a source-space `../models/auth.scrml` import emitted as
`../models/auth.server.js`, which from `dist/login.server.js` points ABOVE `dist/`. **The compile
stays GREEN** (a missing FILE is not a syntax error) and the bundle dies at runtime with
`Cannot find module`.

**Three lessons that generalize past D-4:**
1. **A relationship between two files must be expressed in ONE space, consistently.** The fix is not
   a `../` adjustment; it is to express BOTH endpoints in post-strip dist space and take the
   relative path between them (`emit-server.ts` `distRelativeServerSpecifier`). `emit-client-esm.ts`
   already did this for the client half — which is precisely why the client half resolved at every
   depth while the server half did not.
2. **The inverse transform is AMBIGUOUS; reversal must be a FORWARD INDEX.** A dist
   `models/auth.server.js` could have come from `models/auth.scrml` OR from
   `pages/models/auth.scrml`. `api.js` therefore maps every compiled source to the dist path it
   WRITES (`distServerKeyToSource`) and looks the specifier up, rather than inverting.
3. **An oracle validating in the implementation's own coordinate space inherits its blind spot.**
   `W-SERVER-IMPORT-UNEMITTED` exists specifically to catch a cross-file `Cannot find module`, and
   it was SILENT on the D-4 reproducer because it reversed in SOURCE space — the one space where the
   path is always self-consistent. This is the S276 shape restated: *a guard written from the same
   assumption as the code it guards proves nothing.* Both reversal sites in `api.js`
   (`checkServerImportInvariant` and `emitValueOnlyServerJsForDanglingImports`) now route through
   the same two-tier `serverImportTargetSource`, mirroring emit-server's two emission modes
   one-for-one so guard and emitter cannot drift apart.

Adjacent, same family: `rewriteRelativeImportPaths` (`api.js`) skips `.server.js`/`.client.js`
specifiers. The SKIP is still correct — but its old justification ("they live in the dist tree at
the same relative position as their `.scrml` source") was **FALSE**, and is now annotated as such.
It is correct only because the emitter speaks dist space.

**Platform note.** `isOutsideBase` and `distRelativeServerSpecifier` split on the PLATFORM `sep` and
normalize to `/` — never on a hardcoded backslash, because on POSIX a literal `\` is a legal
filename character. Same rationale `stripPagesPrefix` documents. This is exactly the class the
non-blocking `windows` CI job exists to surface.

## §12.2 Trigger 3 — a server-only stdlib import escalates its USER (NEW section, S299)

**The concept.** Placement is inferred. A function whose body reaches a stdlib module that cannot
run in a browser must be relocated to the server, or the module — and whatever secret it handles —
ships to the client. This is a **CONFIDENTIALITY boundary**, and every design choice below follows
from which direction is safe to be wrong in.

**Two server-only module sets exist, in ONE file, and they are deliberately different.** This is the
single most important fact in this section, because conflating them is the mistake the S299 arc had
to correct mid-flight.

| Set | Feeds | Direction that is SAFE to be wrong |
|---|---|---|
| `SERVER_ONLY_SCRML_MODULES` (`route-inference.ts:578`) | the async fail-closed backstop (`api.js` STDLIB-EXPORT-SEED) | **OVER-inclusion.** Defaulting an unresolvable re-export to async costs nothing. |
| `ESCALATION_SERVER_ONLY_MODULES` (`route-inference.ts:655`) | **PLACEMENT** | **NEITHER, symmetrically-badly.** Under-include -> a server-only module ships to the browser (silent leak). Over-include -> correct CLIENT code is relocated to the server (a correctness/latency cost). |

Reusing the async set for placement was MEASURED at S299 to escalate **72** corpus import sites that
are correct client code today; `scrml:data` alone (`sortBy`/`schemaFor`/`tableFor`) is 72 of the 116
server-only-module imports in the corpus and ships a real client implementation in the runtime
bundle. The sets cannot be unified.

**Membership is TWO-limbed, and the second limb is the one that gets forgotten.** A module is
escalation-server-only if EITHER: **(a) HOST REACH** — its implementation touches `Bun.*`,
`process.*`, or imports `bun` / `bun:*` / `node:*` (note the BARE `bun` specifier with no colon —
`scrml:redis` is reached only that way, and a `bun:`-only scan misses it); **or (b) CREDENTIAL
HANDLING** — it accepts or transmits a secret that must not reach a client, *even with zero host
reach*. Limb (b) exists because a host-reach-only criterion was FALSIFIED in review: `scrml:oauth`
has zero host reaches and was cleared as client-safe on that basis, while putting `client_secret` in
its token-exchange body three times and carrying a module header that reads "SERVER-SIDE ONLY". **A
derived list is only as good as the property it derives from** — the criterion was the defect, not
the list, which is why both limbs are recorded beside the ten members rather than only the members.

**Reference, not call. Depth, not top level.** Escalation fires on ANY REFERENCE to an imported
binding, at ANY depth — inside a lambda body, inside a nested `function` declaration, inside
escape-hatch raw text. Matching only top-level CALLS was proven evadable four ways, each shipping
the module and its secrets to the browser at exit 0: `["PEPPER"].map(p => hashPassword(p))`, a
nested `function` decl, a bare callback reference `["x"].map(hashPassword)`, and
`let f = hashPassword; f(x)`. On a confidentiality boundary, over-firing costs a relocation and
under-firing costs a leak, so the fail-closed choice is the right one.

**Trigger 3 emits NO diagnostic — that is by design, and it is a debugging trap worth stating.** A
function silently moving to the server is the SUCCESS path. "My function vanished from the client
bundle and there are zero errors and zero warnings" is the expected shape, not a bug report.

**It reuses the EXISTING `server-only-resource` reason kind rather than adding an
`EscalationReason` variant.** §12.2 Trigger 1 is "accesses a resource not accessible from the
client", which a server-only module import IS. Two live consumers already encode that expectation:
`emit-server.ts`'s `isBodyOnlyEscalation` (§12.6 library mode) gates on EVERY reason being
`server-only-resource` — a fresh kind fails that `.every()` and silently re-attaches an HTTP wrapper
§12.6 says to drop — and `describeServerTrigger` renders it verbatim, so
`W-DEPRECATED-SERVER-MODIFIER` correctly reports an explicit `server` keyword as redundant for this
class. `resourceType` carries the module specifier, so nothing is lost for diagnostics and the union
stays small.

**Accepted residual, named rather than hidden:** a binding shadowed ONLY inside a nested lambda
still fires (an over-fire, never a leak), and a word-boundary scan of escape-hatch raw text can match
inside a string literal in that text (same direction).

## Node identity is a CODEGEN CONTRACT, not a debugging convenience (NEW section, S299)

`node.id` on an AST node is not incidental. Codegen DERIVES emitted tokens from it — an `<each>`
fence comment (`<!--scrml-each:N-->`), the `_scrml_each_renderers[key]` registry key, the
`_scrml_find_each_anchor` lookup, chunk-namespace tokens. **Two nodes sharing an id therefore share
an emitted identity, and the second write wins.**

**The failure mode has no diagnostic and no visible symptom until runtime.** The S299 instance:
`component-expander.ts` expanded from `def.nodes` — the registry's SHARED parsed body, whose ids
come from a per-component parse that numbers from ZERO. So the same component instantiated twice
reused one id set, AND two different components each started at the same low numbers and collided
with each other. Two list components emitted ONE fence id; every anchor lookup resolved to the
first fence; the executed result was panel 0 rendering panel 1's data and panel 1 rendering empty.
**Compile: exit 0, zero errors, zero warnings.** Fixed by deep-cloning per expansion from the
FILE-level `NodeCounter`.

**The invariant, stated so it can be checked:** within one FileAST after component expansion, every
node id is unique. Across files, `chunk-namespace.ts` (S280/S282) prefixes every id-derived token
with a hash of the source path, so the two halves compose — but the cross-file namespace does NOT
save you from a within-file collision, and vice versa.

**Not fully restored at this HEAD, and the gap is specific.** A post-fix duplicate-id sweep over 877
corpus files went 28 files -> 16 (12 closed, 4 reduced, 0 newly broken). The residual families are
`def.defChildren` (returned by reference / shallow-spread with the id kept), `${children}`/slot-fill,
channel-inline, and for/match. The duplicated kinds there are only `text`/`li`/`p`/`logic` —
**zero `each-block`** — so nothing id-DERIVED collides today. Read that as "the live blast radius is
closed", not "duplicate ids are gone".

**One invariant deliberately MOVED:** native markup-value ids live in a high band
(`translate-expr.js` `{ next: 900_000_000 }`, chosen so they "can never collide with a sibling
FileAST node id"). Cloning a component body renumbers them DOWN into the per-file range. Harmless —
one monotone counter seeded above `maxExistingId`, and that comment itself states the embedded id is
not load-bearing for codegen — but the guarantee is no longer what the comment claims, so do not
rely on the band.

## §17.1.2 — `if=` on `<engine>` / `<match>` / `<each>` (NEW section, S302). A FENCED widening.

`if=` is honored on exactly THREE scrml-defined structural elements. Before S302 it *parsed* on them,
was DISCARDED at AST-build, and the element rendered unconditionally and permanently — green compile,
zero diagnostics. On an `<engine>` that meant the `initial=` arm rendered forever. The widening was
ratified on the consistency argument: a first-class compiler-supported element that cannot take a
directive every HTML element takes reads as toy-status, not as discipline.

**PROHIBITION 1 — the widening is exactly three elements wide and SHALL NOT be generalized to the
registry.** `<onTransition>` / `<onTimeout>` / `<onIdle>` / `<errors>` / `<channel>` / `<page>` are
declarations and lifecycle hooks, not rendered subtrees; a structural conditional on them has no
defined meaning and SHALL be rejected. **Enforcement is PARTIAL at this HEAD and §17.1.2 says so
rather than asserting a SHALL the impl does not keep:** `<page if=>` rejects
(`E-PAGE-INVALID-ATTR`) — conformant; `<channel>` and `<errors>` emit only a `W-ATTR-001` advisory
and ignore the attribute; `<onTimeout>` and `<onIdle>` ignore it with **zero** diagnostics. Tracked
as `g-if-reject-unenforced-on-structural-declaration-elements`. **`<auth>` is deliberately NOT on the
reject list** — it is a `kind:"markup"` node, takes the ordinary markup path, and gates its subtree
correctly (verified by execution: a real `scrml-if-marker` + `<template>` are emitted). The
`W-ATTR-001` the compiler nonetheless emits for `<auth if=>` — claiming the attribute "has no
compile-time effect" — is **FALSE**; that is its own defect
(`g-w-attr-001-false-on-auth-if-gate-is-applied`).

**PROHIBITION 2 — `if=` gates RENDERED OUTPUT, never the element's declaration, state or lifecycle
(§17.1.2.1, the load-bearing rule).** For `<engine if=expr>`:
- the auto-declared engine variable (§51.0.C) is declared and readable **regardless** of `expr` —
  including from other files that mount the singleton via `<EngineName/>` (§51.0.D);
- `rule=` contract enforcement (§51.0.F), `effect=` (§51.0.H), `<onTransition>`, `<onTimeout>`
  (§51.0.M) and `<onIdle>` (§51.0.R) remain **LIVE** while `expr` is false. Transitions continue to
  occur; only their rendering is withheld;
- the boot-only opener `effect=` (§51.0.H Form 3) fires **once at module-init** and is NOT re-fired
  on a false→true flip.

Tying an engine's lifecycle to a render predicate would make `if=` a state-destroying operator and
break the §51.0.A singleton invariant — a cross-file `<EngineName/>` mount would observe a different
engine depending on an unrelated page's conditional. **This is enforced STRUCTURALLY, not merely
documented:** `ifCond` lives on the AST node, where the JS-substrate emitters that build the engine's
cell and rules cannot reach it at all. For `<each if=>` the collection is not read and no rows are
reconciled while false (reconciler state rebuilds on re-entry); for `<match if=>` no arm dispatches.
Neither carries independent state, so the distinction is vacuous for them.

**PROHIBITION 3 — a structural `if=` INSIDE an `<each>` row template is NOT honored and fails OPEN
(§17.1.2.3).** Four positions, and markup vs structural fail in OPPOSITE directions:

| position | behaviour |
|---|---|
| structural element in ordinary markup | gated correctly, reactively — the §17.1.2 surface |
| markup `if=` on the ROW-ROOT of an `<each>` row | gated correctly (`_scrml_ifrow_apply`) |
| markup `if=` on a NON-ROOT element inside a row template | emits nothing — fails **CLOSED** (never renders) |
| **structural `if=` inside a row template** | emits nothing — fails **OPEN** (**never gated**) |

A fail-CLOSED miss is loud: the author sees content missing immediately. A fail-OPEN miss silently
ships content the author wrote a predicate to withhold, and is invisible during development whenever
that predicate is usually true. Inherited from §17.1's row-template lowering, NOT introduced by the
widening; the durable fix is ONE diagnostic covering both positions
(`g-structural-if-inside-each-row-template-fails-open`).

**PROHIBITION 4 — `E-IF-IN-DISPATCHED-ARM` still guards ARM BODIES, and the guard must be reverted
as a UNIT, not eroded.** An `if=` INSIDE a dispatched arm (a `<match>` block-form arm, an `<engine>`
state-child) is a **separate and REJECTED** surface — the arm body is injected with `innerHTML` on
dispatch and wired by a per-arm wire function that cannot see into a `<template>`. Omitting the guard
on the new structural path was a measured **REGRESSION**, not a missing nicety: a
`<each … if=@shown>` inside a `<match>` arm rendered 2 rows on main and 0 on the branch after one arm
round-trip, with `@shown` never changing and no diagnostic — working code went silently blank.
Refusing **DROPS** the element rather than emitting it ungated; emitting ungated would silently
ignore the author's predicate, which is the §17.1.2 defect the whole arc removed. Guard:
`refuseConditionalInDispatchedArm` (`emit-html.ts:780`), **THREE** call sites — `:1508` structural,
`:1737` if/else-if/else chain, `:2727` markup. **The revert SHA `2fbe6520` named in `hand-off.md` is
NOT in this repo's history** (`git cat-file -t 2fbe6520` → *Not a valid object name*); revert by
symbol, in lockstep across all three call sites.

**PROHIBITION 5 — ONE `if=` lowering, and no second one.** `if=` used to have TWO lowerings with
different DOM semantics — a `<template>`+marker for a "clean" subtree, a `display` toggle for
anything carrying wiring — chosen silently by a purity test, so a single `${…}` flipped the attribute
between *removes* and *hides*. #289 (S301) deleted the second. `emitIfMountGate`
(`emit-html.ts:1421`) is now the sole lowering and all FOUR hosts call it; `isGateableIfValue`
(:1472) mirrors the markup kind test so a value shape the markup path ignores is ignored identically
on a structural element; `emitGatedStructural` (:1498) is the structural adapter (no `ifCond` field ⇒
byte-identical to the pre-§17.1.2 emitter). Hand-rolling the wrap at a new host is exactly how the
divergence grows back.

**The runtime mount contract WIDENED — and the unmount is a LIVE SPAN, not a node list.**
`_scrml_mount_template` (`runtime-template.js:1429`) went from "exactly one element child" to "one or
more top-level nodes", because a gated `<each>` has no element to wrap: its mount is a COMMENT FENCE
(`<!--scrml-each:ID-->…<!--/scrml-each:ID-->`), and an element wrapper is not available to it —
`<each>` is legal directly inside `<ul>`, `<tbody>` and `<select>`, where a wrapper `<div>` is invalid
HTML the parser would foster-parent out. The clone's top-level nodes are recorded on the returned
handle as `_scrml_if_range` (recorded ONLY when the handle alone does not describe the mount, so the
single-element case is byte-identical to before).

`_scrml_unmount_scope` (:1468) then removes **first recorded node through last recorded node, walking
siblings AT REMOVAL TIME** — *not* the recorded list. MEASURED, not theorised: a gated `<each>`'s
recorded range is exactly its two fence comments, and the renderer inserts every row BETWEEN them
AFTER the mount, so removing the recorded list alone left all rows (and the `<empty>` fallback) in the
DOM and **four open/close cycles accumulated 12 rows where 2 belong**. A per-node backstop still
removes anything an adopter re-parented out of the span.

`_scrml_mount_wire` (:1599) binds a multi-node mount **node by node** across the recorded range.
Widening to the shared parent instead would re-bind SIBLING wiring that was never unmounted
(double-attached handlers), and a `TreeWalker` rooted at a fence comment never returns that comment
(a TreeWalker excludes its own root) — so `_scrml_remount_each` cannot see a TOP-LEVEL fence at all.
That is why `_scrml_remount_each_fence` (:1639) exists as a separate lookup: same
`_scrml_each_renderers` registry, same idempotence, different reach.

## Runtime-chunk tree-shaking — a two-phase decision (§47.5, GH #234 / Bug 57 / GITI-036 class)

The client runtime ships as CHUNKS, and a chunk is included only if something proves it is needed.
The decision lives in **`codegen/emit-client.ts`**, in two phases, plus a declarative closure:

1. **Pre-emit** — `detectRuntimeChunks(fileAST, ctx)` walks the AST. Sound for anything a walkable
   node shape proves (an `<each>` needs `_scrml_reconcile_list`; a `==` on a structural value needs
   `equality`).
2. **Post-emit** — `POST_EMIT_HELPER_CHUNK_GATES` scans the EMITTED lines for helper references.
   Necessary because some wiring is minted from the binding registry at emit time and has no
   walkable pre-emit shape at all.
3. **Closure** — `runtime-chunks.ts`'s `CHUNK_DEPENDENCIES` is transitively closed at the END of
   `detectRuntimeChunks`, before the chunk set is frozen.

**The failure mode is always the same shape and always ships silently:** the compile is green, the
bundle references a helper nothing defined, and the app dies at load with
`ReferenceError: _scrml_* is not defined` — which, when it lands at the top of `_scrml_boot`, aborts
boot before ANY event handler binds. The adopter symptom is a page that renders correctly and does
nothing.

**Two traps specific to the post-emit phase.** (a) Entries match as SUBSTRINGS: a trailing `(` pins
a CALL site, a bare name also catches a VALUE or `typeof` reference. GH #234 needed the bare form
because `<errors of=…/>` captures `_scrml_message_for` as a value, never calling it. (b) A `typeof`
guard around the reference does NOT make it safe: `_scrml_message_for` is a `CELL_SCOPE_ACCESSOR`, so
`cell-accessor-rename.ts` rewrites BOTH occurrences — including the one inside `typeof` — to
`_scrml_cs_message_for`, whose wrapper the chunk prologue always defines, so the guard always takes
the true branch and the ReferenceError fires inside the wrapper body. The post-emit scan runs BEFORE
that rename, which is what keeps the bare-name entry exact.

## Cross-chunk soft navigation (§20.8.2 / §20.8.7) — SHIPPED (navigate-wave1c)

Previously HELD/parked. Now implemented and SPEC-ratified, with `W-NAV-CHUNK-LOAD-FAILED` cataloged.

A route served by a separate `pages/` file rides its OWN client chunk, and its reactive wiring lives
THERE — so hydrating a soft-nav target without that chunk swaps in correct markup that is completely
unwired. §20.8.2 step 3 therefore requires the runtime to LOAD the missing chunk(s) before swapping,
**in the fetched document's own script order** (deps-first — a dependency chunk precedes its
importer) and resolving URLs from that document's `<script src>` list rather than reconstructing
them by convention.

**"Already loaded" SHALL be decided by RESOLVED ABSOLUTE URL, never by file name.** A route's own
chunk is emitted with NO directory component, so `pages/reports` and `pages/admin/reports` both
reference `reports.client.js` while resolving to two distinct files
(`g-nav-chunk-basename-collision-key`, PA-reproduced). Content hashing does not disambiguate them
either — §47.9.8 hashing is build-path only, so `scrml compile`/`scrml dev` keep the un-hashed
suffix.

**On failure or timeout: hard-navigate, do not swap.** SSR-first is preserved; the destination still
loads, as a full document. A failure arriving AFTER a newer navigation superseded this one bails
SILENTLY — the newer navigation owns the outcome (last-nav-wins, §20.8.5).

**The boot-timing consequence, which is the subtle half.** An INITIAL page load defers to
`DOMContentLoaded` exactly as before. A chunk INJECTED after boot runs when DCL has already fired
and will not fire again, so it must boot IMMEDIATELY. The emitted boot dispatch
(`emit-event-wiring.ts`, mirrored in `emit-variant-guard.ts`) is therefore an IIFE around
`function _scrml_boot()` plus a branch on the runtime flag `_scrml_chunk_loading`.
**That flag is a DEPTH COUNTER, not a boolean** — the name is retained because the emitted dispatch
tests it for truthiness, which reads a non-negative count correctly. It must COUNT because two
OVERLAPPING navigations (an impatient double-click) each inject a script: with a shared boolean, the
first chunk's settle cleared the flag out from under the second, which then registered `_scrml_boot`
on a `DOMContentLoaded` that had already fired — so it never booted, never registered its
rehydrator, and the newer nav still swapped, producing correct SSR markup that was completely inert,
with no diagnostic and no hard-nav fallback.

## The route region is a THIRD lifecycle owner (§6.7.2.1 / §20.8.8, ratified S313 — Pole C)

**Read this before touching soft navigation, `<outlet>`, or anything that "runs when a route loads".**

**The false sentence that was struck.** §6.7.2 used to say the `<program>` scope "destroys once (on
page unload **or navigation**)". That was false under soft navigation and contradicted §20.8.1's
"boots once and stays live across soft navigations". All three deliberation poles agreed it had to
go. §6.7.2 now says plainly: **a soft navigation SHALL NOT mount or destroy any scope.**

**Scopes are of exactly TWO kinds, and the outlet region is NEITHER.** A lifecycle **scope** is the
`<program>` root or an `if=`-conditional element. **Scopes have no identity beyond their position in
the element tree**, and the memoryless-remount requirement — re-run all bare expressions, re-start
all `<timer>`/`<poll>` exactly as if mounting for the first time — **binds scopes only.** The region
governed by an `<outlet>` is a **route region**, whose **identity is the committed `(route, params)`
pair**. *Identity is the discriminating axis*: it is what makes `keep-alive` (§20.8.4) expressible
without carving an exception into a normative SHALL.

**Lifecycle edges SHALL be produced by exactly three events and no others:** document load/unload
(the `<program>` scope), an `if=` transition (a conditional scope), and a **committed** soft
navigation (a route region). A route region nests as the OUTERMOST lifecycle owner inside the
`<outlet>`; `if=` scopes in route content are its children and destroy depth-first at route-leave.

**The §20.8.8 edge contract, in the order it must hold:**
1. **Commit gate.** A navigation that fails, aborts, or is superseded before commit emits **NO
   lifecycle edge whatsoever**, and the live region stays fully live through the in-flight window.
2. **`route-leave`** fires after step 1 (Fetch) commits and **before** step 2 (Swap) — while the
   outgoing DOM is still ATTACHED. Order: dispose region display effects/subscriptions → stop
   `<timer>`/`<poll>` → abort in-flight `<request>`s → destroy `if=` scopes depth-first under §6.7.2's
   four steps → run author `cleanup()` **LIFO** → cancel pending `animationFrame()`. Steps 4 and 5
   SHALL observe live, attached DOM.
3. **`route-enter`** fires after step 4 (Hydrate/Adopt) — after SSR re-seed AND after `each`
   re-materialisation — and **before** step 5 (Transition), so enter-time paint is captured inside
   the View Transition instead of flashing after it.
4. Notification is **pre-order**; disposal is **post-order**.
5. **Ownership:** cells declared in route content are region-owned and re-seed from the incoming
   payload; cells declared in the shell are program-owned and survive the swap with author mutations
   intact.
6. **Initial load IS a `route-enter`.** Region bodies run exactly once on first paint — never zero,
   never twice.

**Spec-ahead, and it says so.** §20.8.8 is marked Nominal: the compiler wiring lands with the impl
(`docs/changes/route-region-teardown/`, `g-route-timer-poll-not-stopped-on-soft-nav`, HIGH/open) and
conformance CN-1..CN-10 land with it. **Two codes are NAMED but carry no §34 row at all** —
`W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD` (§20.8.7) and `E-ERROR-011` (§19.4.4.1) — because §34.0
outcome 2 plus the named-codes-land-with-impl rule puts the row in the same landing as the emitter.
**Do not grep §34 for them and conclude they do not exist; grep the prose section.**

**The ruling knowingly ships a footgun and therefore OWES a v1 diagnostic.** Pole C's failure mode is
redundant work (a double fetch, a duplicated analytics event, a re-POST on back/forward) — loud on
the bill, silent in the UI. The rejected alternative pays **staleness**, which is silent-wrong-UI and
is the failure that actually occurred in the field. Choosing a knowingly-undiagnosable-by-default
failure mode is what makes `W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD` an obligation rather than a
nice-to-have.

**WHAT THE IMPLEMENTATION ACTUALLY DOES TODAY — verify against this, not against the contract.**
- `_scrml_destroy_scope` (`runtime-template.js:1339`) performs the §6.7.2 four steps and is reachable
  **ONLY** through `_scrml_unmount_scope` (:1469) — the `if=` path. The navigation path never calls
  it.
- `_scrml_nav_apply_html` (:2996) calls `_scrml_teardown_region(liveOutlet)` (:3026), which drains
  **only** `_scrml_region_cleanups` (:3122). Its doc-comment (:3114) claims it tears down "timers";
  that is true only for a `<timer>` **lexically inside the shell's `<outlet>` element**, and false for
  every route-chunk timer.
- **Why: the association is made at EMIT time and it is LEXICAL.**
  `codegen/emit-reactive-wiring.ts` `classifyMarkupNodes` (:1081) stamps `node._outletResident` when
  a `<timer>`/`<poll>` (:1105) or `<keyboard>`/`<mouse>`/`<gamepad>` (:1114) sits inside an
  `<outlet>` **in the same file**. Route content is in a different file from the shell, so the flag
  is never set and the stop lands on the boot-once `_scrml_register_cleanup` (beforeunload) path.
- **A route timer therefore starts exactly ONCE, at chunk module-init, and is never stopped OR
  restarted by navigation.** Beyond the leak, that also fails §20.8.8 step 3 (route-enter re-runs
  region-associated bodies), which is why the leave-edge and enter-edge halves are one arc.
- **A runtime-only fix cannot work.** `_scrml_timer_start(scopeId, timerId, ms, bodyFn)` takes no
  element and `<timer>` emits no DOM node, so `_scrml_teardown_region` — which holds only the outlet
  element — cannot discover which scope ids belong to the outgoing route. DOM query is impossible;
  `_scrml_region_track`'s `el.closest("[data-scrml-outlet]")` pattern does not transfer; and a
  boot-time snapshot ("scopes present after shell wiring are shell scopes") is REJECTED as fragile —
  an `if=` inside the shell can register a timer later and would be misclassified, i.e. a shell timer
  silently killed by a navigation, which is worse than the leak.
- **An active-region flag wrapped around the rehydrator loop captures NOTHING** — the timer already
  ran, at module-init, before any rehydrator. See structure.map.md's execution-boundary section and
  dependencies.map.md's module-init table for the exact producer chain.

## `<page keep-alive>` — the FIFTH per-route attribute (§4.15/§40.8/§20.8.4, ruled S314, #378)

`<page>`'s per-route attribute set widened from four to five: `db=`, `auth=`, `csrf=`, `ratelimit=`,
**`keep-alive`** (a bareword, no value). Before S314 it fired `E-PAGE-INVALID-ATTR`; the SPEC's own
four-set enumeration (§0.3, `dd:page-helper-element-design-2026-05-12`) was a CLASSIFICATION of the
`<program>`/`<page>` attribute surface as it stood at authoring time, not a designed bound — the DD's
governing rule is an app-wide-vs-per-route PARTITION, and `keep-alive` is per-route by construction
(§20.8.4: a route opts in; §20.8.8 keys the region by `(route, params)`). Admitting it is a
CONFORMANCE FIX ("newly-accepting toward the contract"), not a widening decision.

**Read this before assuming `keep-alive` caches anything.** Only the AUTHORING surface is admitted at
this HEAD — the attribute is recognized (`attribute-registry.js`) and validated
(`ast-builder.js` `validatePageAttrs`) — but **there is still NO runtime cache and NO §52/§38
invalidation wiring**. §20.8.4's design (once built) is SQL-server-load-scoped: keyed by only the
params that reach SQL, each sub-payload's table read-set derived via `extractSelectProjection()`,
invalidated by one Postgres `AFTER INSERT/UPDATE/DELETE` trigger per read table.

**`W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD`'s guidance was corrected in the same window it was named.**
The message steers to (a) reading the server-load payload directly, and — where that work is
genuinely per-visit but expensive — **(a) followed by (b) `<page keep-alive>`. (b) is a follow-on to
(a), never an alternative.** §20.8.4's cache does NOT cover a `<request>` (an HTTP fetch, §6.7.7/§60,
with no table read-set and no trigger), so an adopter who applies (b) alone still has the `<request>`
firing on every route-enter per §6.7.2.1 — now over a cached server load — and the two halves can
disagree. Both codes remain NAMED / spec-ahead — no emitter yet; the §34 row lands with the impl.

## `<timer>` / `<poll>` — the first-tick asymmetry is now normative (§6.7.5/§6.7.6, S314)

A `<timer>`'s first execution is **one interval AFTER arming** — it does not fire immediately. A
`<poll>`'s first execution **fires IMMEDIATELY on arming** — the deliberate divergence, because a
`<poll>` exists to keep a value fresh (the §6.7.6 worked example, `<poll interval=10000>` fetching
`@serverTime`, would otherwise render nothing for a full 10s) while a `<timer>` makes no such promise.
Both amendments state behavior the SPEC was previously SILENT on, and the silence was masked by a
`collect.ts:205` defect that accidentally emitted the poll body at module-init (an accidental
first-tick-ish run) — removing the defect without the amendment would have been a visible regression
for every `<poll>` in the field. The S313 "a bug fix is not automatically inert" shape, restated: the
fix and the amendment landed together.

Two sub-rules worth carrying: the immediate poll tick runs through the SAME tick path as every later
tick (inherits async queuing, error handling, `<#id>.tickCount` accounting — not a special-cased
pre-run); and it is **gated by `running=`** and fires **once per ARMING, not once per resume** (a
`running` false→true transition resumes the interval without re-firing the immediate tick — the
alternative turns a boolean write into a fetch trigger, a side effect at a distance).

## A cross-module ASYNC import consumed in a markup interpolation is now awaited (#391)

`g-crossmodule-async-in-markup-position-not-awaited`: a cross-file import classified `async`
(colorless-async, §13.1/§13.2) and read directly inside a markup `${…}` interpolation previously
shipped as a bare unawaited Promise in that position — the interpolation rendered `[object Promise]`
or similar, silently. Fixed in `emit-client.ts`/`emit-reactive-wiring.ts`. **The wrap decision is made
off the injector's OWN EMITTED OUTPUT, not a re-derived predicate** — an S239 catch during the same PR
surfaced a page-breaking SyntaxError from an earlier version of the fix (an async fn used as a bare
combinator callback), which is why the landed shape decides off actual emitted text rather than
re-inferring async-ness a second time at a different stage. See dependencies.map.md's
Colorless-async section for the producer/consumer chain.


## `W-IF-IN-EACH` — a nested per-row `if=` inside `<each>` is create-time-only, not reactive (§17.1, NEW #416, GH adopter #409)

**The gap.** §17.1's per-row `if=` reactivity applies to exactly ONE position: the each body's SOLE
structural item root, lowered via `_scrml_ifrow_apply` (the element⇄comment structural swap). A per-row
`if=` on a NESTED (non-item-root) element inside the row is compiled to a plain CREATE-TIME append
gate — evaluated once when the row is first built, never re-evaluated on a SAME-KEY reconcile. When the
row's own item data later changes under that same key, the gated element is never re-added or removed
and silently goes stale — while sibling `class`/`${…}` text bindings on the identical row DO update,
which is what makes the frozen `if=` a footgun with no other build-time signal.

**The fix ships a build WARNING, not the reactive fix.** `emit-each.ts`'s deferred nested-per-row-`if=`
branch (inside `renderTemplateChildToJs`) now pushes `W-IF-IN-EACH` when the condition REFERENCES the
iteration item — an outer-state-only condition re-evaluates through the each render fn's own collection
effect and is not this footgun, so it is deliberately not warned. Two new helpers do the detection:
`_eachIfCondReferencesItem(rawCond, itemNames)` strips quoted string-literal interiors FIRST (so an
item-name-shaped word or an `@.`-substring inside a string literal cannot false-fire — the same
string/comment-fencing lesson `g-bare-variant-mask-leaks-into-string-literals` already forced onto
`preprocessForAcorn`) then matches `@.` or any item-binding name as a standalone identifier;
`_eachItemBindingNames(iterVarName)` widens the match set to a `as (k, v)` destructure pair via the live
each-reconcile context, not just the bare `as X` iter var. **The reactive fix is DEFERRED and ROUTED TO
BRYAN** (§17.1 nested per-row-`if=` reactive-surface extension — it needs a per-child anchor + a
reconcile-core interaction the original per-row-`if=` arc deliberately avoided). The warning surfaced
**37 real instances** in the trucking example's card components (nested item-`if=`, inlined into
`<each>`) — read as validation that the shape is common, not as a regression the warning introduced.

**Resolution advice the diagnostic itself gives:** drive per-row visibility with a reactive `class`
toggle instead (`class=(cond ? "" : "hide")` with a `.hide { display: none }` rule), or lift the `if=`
to the row's sole item root where it IS reactive today.

## Reset init-thunk no longer clobbers on a structural-cell reassignment (§6.8, NEW #417, HIGH)

**The defect, `g-assignment-emits-init-set-inverting-reset`, now FIXED.** The ast-builder emits the
same `state-decl` node SHAPE for both a genuine `<name> = expr` DECLARATION (`structuralForm:true`)
and a later `@name = expr` REASSIGNMENT of that already-declared cell (`structuralForm:false`,
`shape:"plain"`). Because the runtime's `_scrml_init_fns[name]` reset-thunk registry is LAST-WRITE-WINS
and `_scrml_reset` calls it, a top-level reassignment reaching `_emitInitThunkSidecar` used to
OVERWRITE the decl's init-thunk with the assignment's own expression — so `reset(@ticks)` after
`${ @ticks = @ticks + 1 }` re-ran the INCREMENT instead of restoring the declared initial value. Silent
wrong output on two documented primitives (originally surfaced as a `<timer>`/`<poll>` scoping defect,
S314; re-scoped S321 as the general top-level-assignment case).

**The fix, safe-by-construction.** `emit-logic.ts`'s `_emitInitThunkSidecar` now skips registering the
reset init-thunk when a node is a `structuralForm:false` / `shape:"plain"` / non-const write AND its
name is a member of `collectStructuralDeclNames(fileAST)` (`reactive-deps.ts`, NEW — walks logic bodies
incl. `if`/`for`/`while`/`match`/`try` for `state-decl` nodes carrying `structuralForm:true`). A write
NOT in that set is an IMPLICIT `@`-declaration (e.g. an SSE/channel bind `@latest = ticks()`) and
correctly KEEPS its thunk — reset must still re-establish that binding. **S239 caught a control-flow
gap (F1) before land:** a reassignment nested inside a TOP-LEVEL `if`/`for`/`while` body still clobbered,
because that dispatch re-emits through a hand-picked `opts` object that omits `structuralDeclNames` —
fixed with a module-level fallback, `setStructuralDeclNamesForFile` (emit-logic.ts), populated once per
file by `emit-reactive-wiring.ts` (mirrors the existing `_eachBindSupportCtx` module-fallback pattern;
file-immutable, so the fallback can never disagree with the opts value when both are present). Threaded
through `codegen/index.ts`'s two `EmitLogicOpts` construction sites too.

**Residual, explicitly out of this fix's scope — `g-implicit-cell-double-write-clobbers-reset-init`
(MED, NEW).** An IMPLICITLY-declared cell (`@x = 0`, no `<x>`) written a SECOND time at top level
(`@x = @x + 1`) still clobbers, because the static structural-decl set cannot distinguish the first
implicit write (the decl, must keep its thunk) from a later one (a reassignment, should skip) — that
needs emission-ORDER tracking, a larger change. Pre-existing; the S321 fix neither introduced nor
worsened it. Rarity: an implicit `@`-declaration is unusual (adopters conventionally `<x>`-declare),
double-writing one at top level rarer still.

## The `<machine>` keyword is REMOVED (§63.7 / §51.0.L, ruled S305, landed S307)

**`<machine>` is not a deprecated alias any more. It does not compile.** `E-DEPRECATED-001` (Error)
fires from `ast-builder.js:16839`; `W-DEPRECATED-001` is a §34 tombstone. Any doc presenting it as
"deprecated but still compiles / hard-removal at v0.3.0" is stale — `docs/PA-SCRML-PRIMER.md`,
`compiler/PIPELINE.md` and `compiler/SPEC-INDEX.md`'s authored half all still do.

**Three properties of the removal worth carrying:**

1. **It still PARSES (§63.5).** The builder accepts `block.name === "machine"`, pushes the one
   diagnostic, and BUILDS the `engine-decl` anyway, so a `<machine>` source reports exactly ONE error
   naming the migration instead of a cascade of secondary errors from an unbuilt node. Nothing
   downstream consumes the node — the compile fails on the error.
2. **It is NOT a §63.3(2) MAJOR-boundary removal.** The keyword was never in a released contract
   (§62.2), the codemod is verified-landed, and corpus migration measured ZERO. That is the standing
   template for removing a pre-1.0 form.
3. **The codemod is the load-bearing half, and a blind keyword swap would have been a silent
   semantics change.** `<machine … derived=@x>` + a `.A => .B` body compiles to a real MAPPING
   function; `<engine … derived=@x>` is an IDENTITY projection **that drops the rules body with no
   diagnostic**. `commands/migrate.js` Migration 2a therefore lifts the body into §51.0.J
   `derived=match @x { … }`, normalizes `=>` → `:>`, replaces `name=` with an explicit `var=` (on a
   derived engine `name=` marks the legacy NAMED form, which auto-declares no cell), and synthesizes
   a state-child per projected-TO variant. **It fails CLOSED — any unparseable body line leaves the
   declaration untouched** rather than half-migrating it. Migration 2b rewrites the `</machine>`
   CLOSER, without which the opener swap alone yields a mismatched tag.

**Both subsystems the keyword fronted were PORTED onto `<engine>`, not retired.**
- **§51.11 `audit`** — `emit-engine.ts` registers a per-engine recorder CLOSURE into the runtime's
  `_scrml_engine_audit_targets`; the runtime pushes the §51.11.4 entry on every committed transition.
  The make-it-loud placeholder `E-ENGINE-AUDIT-UNSUPPORTED-BODY` existed for exactly one arc and is
  now a tombstone — a code rejecting the clause would reject a working form.
- **§51.13 auto-generated property tests** — `projectStateChildRules` maps a modern `<engine>`'s
  state-child `rule=` graph into the `TransitionRule[]` shape the generator already consumed. The
  vacuous `test("no qualifying machines", () => expect(true).toBe(true))` is now `test.skip(...)`.
  **That artifact is AUTO-GENERATED into an adopter's suite, which is why a false green there is
  worse than usual — and it fired precisely for the canonical form we tell people to write.**

## §19.4.4.1 — a failable function's error type SHALL be an ENUM (ruled S313)

`fn f() ! E` : **`E` SHALL be an enum type** — a `:enum` declaration, or the built-in default `Error`
enum when the annotation is omitted (§19.4.2). A non-enum error type is **`E-ERROR-011`**, covering
scalar (`! string`), array (`! string[]`), generic (`! Map<K,V>`) and paren/union (`! (A|B)`) forms
**uniformly — they fail for one reason, not several**. Reserved / spec-ahead: no emitter yet, and per
§34.0 outcome 2 the §34 row lands WITH the implementation.

**Why the requirement is load-bearing rather than ceremony:** only a VARIANT can carry a `renders`
clause (§19.2), and that clause is what lets the compiler statically prove every error reachable
inside an `<errorBoundary>` is displayable (`E-ERROR-005`, §19.6.6). A non-enum error type has no
variants, carries no `renders`, and such a function sits **silently outside** the display guarantee.
Verified by execution at S313: inside an `<errorBoundary>` with no `fallback`, a `! LoadError` whose
variant lacks `renders` fires `E-ERROR-005`; a `! string` in the identical position compiles clean.

**Two process facts this ruling is now the worked example of:**
- **The corpus migrated FIRST, so the rejection lands inert.** Six sites carried a non-enum error
  type; all six were migrated at S313 *before* any rejection was specified (five
  `conformance/cases/form-for/formfor-*`, where `! string` was incidental, plus
  `examples/29-engine-vs-flags.scrml`, which additionally TAUGHT the wrong form in a comment and now
  teaches why the enum is required). Conformance held at 850/850 across the migration. **Per §62.2
  the corpus IS the versioned contract, so that migration — not the SPEC sentence — is what moved
  it.**
- **It carries the first `provenance:` field in SPEC (pa-base v2.10 Rule 4b).** The provenance block
  explicitly SUPERSEDES a PA-authored scalar/compound split that had no design provenance and
  sanctioned the very form the recorded 2026-04-04 reasoning condemns. *A parser defect (`! string[]`
  broke #228) is not a language-design reason* — and that was invisible until it had to be written
  down.

## §6.7.1a — "bare expression" is a LIFECYCLE CATEGORY, not an arity limit (clarified, PR #359)

`on mount { body }` desugars into the §17.3 bare-expression-at-mount position. **"Bare expression"
there names the §7.3 lifecycle category** (executes at initial render, as against `function`/`fn`,
which execute only when called) — it does **NOT** constrain `body` to a single expression. `body` is
`logic-content` (§7.2), and **any construct valid in a `${ }` logic context SHALL be valid in an
`on mount { }` body**; `on mount` is sugar for that position and adds no restriction of its own.

**The sugar-equivalence SHALL is NOT met by impl #1, and §6.7.1a says so in place rather than
asserting it.** Measured on `a4a4d55f`: multi-statement bodies, `const`/`function` declarations, `@`
writes and `match` all lower correctly; **`lift`, markup-as-expression, `?{}` and a `!{}` error arm
each fail with `E-CODEGEN-INVALID-LOGIC`.** All four fail CLOSED — nothing broken ships. Tracked at
`g-onmount-multistatement-bypasses-statement-codegen` (the gap's NAME predates the measurement; the
real discriminator is the §7.2 extension set, not statement count). Direction of change: clarifying —
when the gap closes those programs become newly ACCEPTED, a conformance restoration rather than a
widening, so it is not a §62 version event.

**Adjacent implementation fact worth knowing before touching the mount path:** a multi-statement
mount body is lowered through the STRING pipeline, not a statement list, because
`safeParseExprToNode` parses exactly one expression. `ast-builder.js`'s `mountBodyExprNode` (:355)
drops a TRUNCATED parse so all statements survive — before it, a body whose first statement happened
to parse had **every following statement silently dropped, with zero diagnostics** (GH #264 Defect 2).

## A `fn`/`function` body admits exactly ONE shape — `E-FN-EQUALS-BODY` (§48.2, NEW, #396)

`fn`/`function` bodies are `{ … }` blocks ONLY. The `=`-expression shorthand —
`fn <name>(args) [-> T] = <expr>`, e.g. `fn pick(k:int) -> bool = match k { 1 :> true  _ :> false }`
— is **NOT a sanctioned scrml form** and is rejected at parse with `E-FN-EQUALS-BODY`, the sibling of
the `=>`-arrow reject `E-FN-ARROW-BODY` (§48.2.1). Fix: a block body (`fn f(args) { return <expr> }`)
or the implicit tail-return form (`fn f(args) { <expr> }` — a block body already returns its tail
expression, so the shorthand added no expressive power the block form lacks).

**Before the reject, the shape SILENTLY MISCOMPILED, and the mechanism is worth knowing beyond this
one code.** The `-> T` / `: T` return-type consumer breaks at a depth-0 bare `=` (the same consumer
that handles `route=` and other trailing attributes), so it swallowed `= match k {…}` whole and the
match's own `{` was misread as the FUNCTION body brace — the entire match collapsed to
`function _scrml_pick(k){ 1; }` (the first arm's TEST literal as a bare statement, every arm RESULT
dropped, the function returning `undefined`), with **zero diagnostics**. `= if …` tail forms instead
hit `E-CODEGEN-INVALID-LOGIC` (a different, louder failure, which is why only the `match`-tail shape
went undetected long enough to reach a filed gap).

**Topology: `rejectFnEqualsBody` (`ast-builder.js:3755`) fires at FOUR duplicated decl-body call
sites** (`:9310` / `:9592` / `:12645` / `:12946` — the same four-site duplication `E-FN-ARROW-BODY`
already lives at) **plus a FIFTH site that behaves differently on purpose: the `export` re-parse**
(`:11625-11654`). Before this fix, that re-parse SWALLOWED every sub-error from its inner parse
(including this one) — an exported form of the shorthand compiled to a silently-empty exported
function rather than reporting anything. The fix surfaces ONLY `E-FN-EQUALS-BODY` from the sub-parse
(other sub-errors stay suppressed, deliberately — widening what the re-parse surfaces is a separate,
unscoped change), so an exported form now gets the same diagnostic a top-level one does. **Any future
fn-decl parse fix owes all five sites, not the four `rejectFnEqualsBody` call sites alone** — see the
`scrml-fn-decl-parse-sites-topology` memory note for the general shape (route= trailing-attribute
over-consumption at the same consumer is a documented sibling risk).

**One residual, explicitly out of this fix's scope:** an ANONYMOUS `let f = fn(x) = expr` still routes
to `E-CODEGEN-INVALID-LOGIC` rather than `E-FN-EQUALS-BODY` — a different parse path
(`expression-parser.ts`, not `ast-builder.js`'s decl-body sites) — tracked as
`g-fn-anon-expr-equals-body-emits-invalid-js` (LOW, open).


## Business Invariants (language axioms, not app rules)
- **`if=` on a scrml-defined structural element is admitted on exactly THREE (`<engine>`/`<match>`/`<each>`) and SHALL NOT be generalized to the registry (§17.1.2).**
- **`if=` gates RENDER, never LIFECYCLE (§17.1.2.1)** — a gated `<engine>`'s cell, `rule=`, `effect=` and timers stay live; only the rendering is withheld. The alternative reading is state-destroying and breaks the §51.0.A singleton invariant.
- **A structural `if=` inside an `<each>` row template fails OPEN (§17.1.2.3)** — carved out explicitly because markup fails CLOSED in the same position and the two are therefore inconsistent in the dangerous direction.
- **One `if=` lowering serves all four hosts** — the second (display-toggle) lowering was deleted at #289 because a purity test chose between *removes* and *hides* silently.
- **A soft navigation SHALL NOT mount or destroy any SCOPE (§6.7.2).** Lifecycle edges come from exactly three events: document load/unload, an `if=` transition, and a COMMITTED soft navigation. An aborted or superseded navigation emits NO edge at all.
- **The `<outlet>` region is NOT a scope — it is a route region identified by `(route, params)` (§6.7.2.1).** Scopes are positional and memoryless; the region has identity, which is what makes `keep-alive` expressible without an exception to a SHALL.
- **A body associated with a route region runs on EVERY route-enter INCLUDING THE FIRST — never zero times, never twice — and its `cleanup()` runs on the matching route-leave, LIFO, against still-attached DOM (§20.8.8).**
- **A failable function's error type SHALL be an ENUM (§19.4.4.1)** — because only a variant can carry `renders`, and without `renders` the function sits silently outside the `<errorBoundary>` display guarantee that `E-ERROR-005` enforces.
- **`<machine>` does not compile (§63.7).** `E-DEPRECATED-001`, Error. It still PARSES so the report is one diagnostic rather than a cascade; the two subsystems it fronted (§51.11 audit, §51.13 property tests) were PORTED onto `<engine>`, not retired.
- **A NEW or TOUCHED §34 catalog row SHALL state where it fires, or honestly declare that it does not (§34.0)** — a catalogued code that cannot fire is a false claim inside the §62.2 versioned contract. Diff-scoped by construction; never retrofitted as a hard gate over the legacy corpus.
- `null`/`undefined` do not exist in scrml source, in ANY position (§42). Absence is `not`.
- **A server-only stdlib module never reaches the client bundle (§12.2 Trigger 3, S299)** — enforced by REFERENCE at any depth, fail-closed; the escalation set is separate from the async-classification set precisely because the two have opposite safe-error directions.
- **Within one FileAST after component expansion, every `node.id` is unique (S299).** Codegen derives emitted identity from it; a collision is a green compile with wrong rendered output.
- Specificity is deleted under §65: an unconditional same-property overlap on a provably-shared element is a COMPILE ERROR (E-STYLE-CONFLICT), never a silent cascade pick.
- A protected DB column can never reach the client bundle — fail-closed, acorn-exact (E-CG-001, §14.8.9).
- A row of tenant A never reaches a request whose ambient tenant is B (§14.8.10) — a FLOOR (isolation invariant only), not a policy engine; the ambient tenant is CONSUMED from `session`, never derived by the compiler.
- **A `db-authoritative` table's tenant-isolation invariant holds against ANY connection, not just scrml's own egress sink (§14.8.11) — but the bounded `scrml_app` role is MANDATORY, because a superuser/owner BYPASSES `FORCE ROW LEVEL SECURITY` (a silent no-op trap without it).**
- **The security DDL an app declares is applied by a DIFFERENT, more-privileged principal than the app runtime, out-of-process, NEVER auto-apply-on-boot (§14.8.11.1) — a role that could install its own RLS policy could also drop it.**
- **A Postgres column-level REVOKE cannot narrow a table-level GRANT — an EFFECTIVELY-immutable column (author-marked, OR the table's PK, OR `tenant_id` — auto-immutable as of S288) requires the WHOLE grant to be re-shaped, never a partial per-column subtraction (§14.8.11.2 S3).**
- **A SECURITY-DEFINER function missing `SET search_path` is a privilege-escalation HOLE (CVE-2020-25695 class), not merely unenforced — the pin is a mandatory codegen invariant, not a nicety (§14.8.11.2 S4).**
- An auth-scoped UNSCOPED cell is never SSR-seeded into the anonymous-reachable compose route (§52.15.5) — auto-omitted + Info-lint, never a hard error and never a silent leak.
- Server/client execution boundary is INFERRED from usage (import/API surface, or `session` reference), never author-annotated.
- Match/enum coverage must be exhaustive at compile time (§18) — no runtime default-arm fallthrough. **Known residual:** a no-`for=` block-form `<match on=@cell>` currently skips this exhaustiveness check entirely (open gap, see the §14.8.11-adjacent match note above — NOT a §14.8.11 concept, cross-referenced here only because it's a live exhaustiveness hole).
- `async`/`await` are not scrml keywords (§19.9.8/§13.1) — async is an inferred/desugared codegen concern.
- Auth tokens (magic-link/verify/reset) are single-use (get-then-delete) and namespace-scoped per purpose — a reset token cannot replay as a magic link.
- A shell SHALL contain at most one `<outlet>` (§20.8) — no nested/multiple outlets in V1.
- **A composed document SHALL carry at most one `<main>` landmark, and the route slot is identified by the `data-scrml-outlet` attribute NAME, never by tag (§20.8.1.1).**
- **A `<main>` arriving through COMPONENT EXPANSION is content-owned, never a competing shell landmark (§20.8.1.1).** The SYM pass provably cannot see it; the emitter can, and decides there.
- **One predicate decides "is this element a `<main>` landmark" for the whole compiler** (`src/landmark-tag.ts`, §20.8.1.1).
- **A nested `<program>` inherits NOTHING from its parent — including route scope (§4.12.1).**
- **A diagnostic whose rule SPEC states as a property of a DECLARATION fires at the declaration, not at a use site (§6.2 Shape 2, `E-CELL-RENDER-SPEC-NOT-BINDABLE`).**
- **scrml admits neither `<style>` nor `<script>` as elements (§4.17).** Both are rejected at the block-splitter with a scan-past-close recovery; CSS lives in `#{...}`, scrml logic in `${...}`, genuine foreign JS in `_{...}` (§23).
- A `serve=` headless tool target has NO cookie-session auth surface — fail-closed rejected, not silently unguarded (§64.9).
- An unresolved server-only `scrml:*` re-export's async classification defaults to async (fail-closed), never sync.
- A `@`-sigil is required at a CSS value use site to reference a `<theme>` token or a reactive cell (§65.3.2/§25).
- Cache immutability for a build artifact is decided by EXACT set membership in the compiler's own content-addressed output (§47.9.8).
- Each physical DOM surface has at most ONE wholesale reactive writer (§5.5.3/§5.5.4, Axiom ①).
- `session` is reachable ONLY from a server-escalated function body (§20.5) — a client-side/top-level `session` reference is E-SCOPE-012.
- `session.set("csrfToken", …)` is a reserved-key write and is rejected at compile time when literal (§20.5.1).
- LIVE-vs-INERT identity for a `?{}` `${}` interpolation is decided by ONE shared lexer (§52.15.5, `codegen/sql-lex.ts`).

- **A `fn`/`function` body admits exactly ONE shape, `{ … }` — the `=`-expression shorthand SHALL be rejected (§48.2, `E-FN-EQUALS-BODY`).** Sibling of the `=>`-arrow reject `E-FN-ARROW-BODY`. Pre-reject, the shape silently miscompiled a `match`-tail body to a degenerate function returning `undefined`.
- **`<page>` admits a FIFTH per-route attribute, `keep-alive` (§4.15/§20.8.4)** — but only the authoring surface is wired; there is no runtime cache or invalidation yet. `<page keep-alive>` is a follow-on to reading the server-load payload directly, never an alternative to it.
- **A `<poll>` fires its first tick IMMEDIATELY on arming; a `<timer>` does not (§6.7.5/§6.7.6)** — the deliberate asymmetry (freshness vs periodicity), gated once-per-arming, not once-per-resume.
- **A per-row `if=` on a NESTED (non-item-root) element inside `<each>` is a CREATE-TIME append gate, NOT reactive on a same-key reconcile (§17.1)** — only the row's sole item-root `if=` reactively swaps. The compiler WARNS (`W-IF-IN-EACH`) when the condition references the item; the reactive fix itself remains open, routed to bryan.
- **A top-level `@name = expr` REASSIGNMENT of a structurally-declared (`<name>`) cell SHALL NOT re-register the cell's reset init-thunk (§6.8)** — `_scrml_init_fns` is last-write-wins, so a naive re-registration inverts `reset()`. An IMPLICIT `@`-declared cell (no `<name>`) still keeps its thunk on write, by necessity (SSE/channel binds must re-establish on reset).

## Domain Events (compiler-pipeline analogs)
`RowChange` — synthesized per §38.13 watched-table row mutation (INSERT/UPDATE/DELETE), dispatched client-side via the `__change` frame to `<onchange>` handlers.
Engine variant transition — an `<engine>` cell's `rule=`-governed state change, optionally observed via `<onTransition>`/`<onTimeout>`/`<onIdle>`.
Soft navigation — a route swap into the `[data-scrml-outlet]` region (fetch → swap → hydrate → transition), NOT a shell re-boot (§20.8.2).
**`route-leave` / `route-enter`** — the two REGION lifecycle edges (§20.8.8, ratified S313). Emitted only for a COMMITTED navigation; `route-leave` between Fetch and Swap against attached DOM, `route-enter` between Hydrate/Adopt and Transition. Spec-ahead: the compiler wiring lands with the impl.
Engine transition AUDIT entry — `_scrml_engine_audit_push(varName, from, to)` appends a frozen `{from, to, at, rule, label}` record to the engine's `audit` cell on every COMMITTED transition (§51.11.4, ported onto `<engine>` at S307).
Shell composition — a BUILD-time (not runtime) event: each `pages/*.scrml` route body is spliced into the shell's slot (§40.8.2).
Theme-switch reflection — a `<theme for=@cell>` binding re-runs a `_scrml_effect` on every `@cell` change (§65.6).
Diagnostic emission — every pipeline stage emits `{code, message, severity, span}` records partitioned into `result.errors`/`result.warnings` (see error.map.md).
**DB-authoritative migration apply — a DEPLOY-time (not build-time, not runtime) event: `scrml db-migrate` reconciles a project's `<schema>` (incl. the M1/P2 security DDL) against a live Postgres, recording object-authorship in the `_scrml_migrations` ledger (§14.8.11.1).**

## Aggregates (structural elements that own a bounded body)
`<engine>` in compiler/src/ast-builder.js — owns its variant-graph rules + state-child bodies (EngineDeclNode.bodyChildren).
`<channel>` in compiler/src/ast-builder.js — owns its watches= table binding + message/broadcast handlers (ChannelDeclNode).
`<theme>` in compiler/src/theme-body-parser.ts — owns its named-token bindings + `.Variant`/`@media` re-bind blocks (§65.6); its emission is owned by `compiler/src/codegen/emit-theme-reset.ts`.
`<schema>` — owns its table/column DDL surface (§39), consumed by protect-analyzer.ts for the §14.8.9 protect-floor, by codegen/tenant-egress.ts for the §14.8.10 tenant floor (a `tenant_id` column IS the tenant declaration), and by schema-differ.js's `parseSchemaBlock`/`generateDbAuthoritativeDDL`/`generateSecdefDDL` for the §14.8.11 DB-authoritative tier (a `db-authoritative` bareword after `}` IS the opt-in; a co-located `fn … security definer …` block IS the writes-authority mutation choke).
`<outlet>` — owns the swappable route-content region inside a `<program>` shell (§20.8.1). **NOT a dedicated AST node** — a `kind: "markup"` node with `tag: "outlet"`; the emitted region is identified downstream by the `data-scrml-outlet` ATTRIBUTE, not by tag.
A returned function-expression closure (`return function name(){…}`, GITI-038) — owns its own body's scope/type/async analysis independent of its enclosing factory (`ReturnStmtNode.fnExprNode`, see schema.map.md).

## Tags
#scrml #map #domain #trigger-3 #escalation-server-only #two-set-distinction #confidentiality-boundary #node-identity #node-id-freshness #component-expander #language-primitives #css65 #theme #realtime #channel-watches #auth #baas #reactivity #engine #not-absence #e-style-conflict #outlet #soft-nav #server-shape #tool-serve #link-boost #css-wave1 #theme-token #content-hash #colorless-async #giti-037 #giti-038 #writer-ownership #session-establishment #position-invariant-await #one-landmark #shell-composition #e-outlet-and-main #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes #landmark-tag #component-expansion #total-walk #nested-program-isolation #e-script-001 #decl-scoped-diagnostics #dbauth #db-authoritative #rls #secdef #immutable-column #privilege-separation #db-migrate #trust-boundary-reversal #half-rls-honesty-bar #auto-immutable #is-effectively-immutable #session-principal-wiring #e-match-invalid-arm #ghost-pattern #w-dead-function #resolved-gaps #tenant-context-union #dist-space #source-space #coordinate-space #d4 #pages-prefix-strip #forward-index #w-server-import-unemitted #oracle-blind-spot #runtime-chunks #detect-runtime-chunks #post-emit-chunk-gates #chunk-dependencies #gh234 #navigate-wave1c #cross-chunk-nav #w-nav-chunk-load-failed #chunk-loading-depth-counter #boot-dispatch #last-nav-wins #structural-if #§17.1.2 #render-not-lifecycle #fenced-widening #each-row-template-fails-open #fail-open-vs-fail-closed #e-if-in-dispatched-arm #one-if-lowering #emit-if-mount-gate #emit-gated-structural #is-gateable-if-value #if-cond #live-span-unmount #scrml-if-range #remount-each-fence #mount-contract-widening #w-attr-001-false-on-auth #route-region #§6.7.2.1 #§20.8.8 #pole-c #third-lifecycle-owner #route-leave #route-enter #commit-gate #keep-alive #outlet-resident #region-cleanups #module-init #rehydrator-boundary #machine-retired #e-deprecated-001 #§63.7 #projection-codemod #engine-audit #§51.11 #§51.13 #property-tests #enum-only #§19.4.4.1 #e-error-011 #renders-clause #e-error-005 #corpus-first-migration #provenance-field #§34.0 #named-codes-land-with-impl #§6.7.1a #bare-expression-category #sugar-equivalence #mount-body-expr-node #e-fn-equals-body #e-fn-arrow-body #fn-decl-parse-sites #export-reparse-swallow #keep-alive #§4.15 #§20.8.4 #§40.8 #page-fifth-attribute #w-route-request-duplicates-server-load #follow-on-not-alternative #timer-poll-first-tick #§6.7.5 #§6.7.6 #immediate-poll-tick #crossmodule-async-markup #s239-catch #pr-405-landed #cps-choke-point-landed #w-if-in-each #each-nested-if-not-reactive #reset-init-thunk-reassignment #collect-structural-decl-names #§6.8 #g-implicit-cell-double-write-clobbers-reset-init

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [auth.map.md](./auth.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [structure.map.md](./structure.map.md)
- [migrations.map.md](./migrations.map.md)
