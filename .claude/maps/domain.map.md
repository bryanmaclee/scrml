# domain.map.md
# project: scrml
# updated: 2026-07-30T07:41:02Z  commit: d0763cff
# NOTE (S299): TARGETED — two NEW sections added (§12.2 Trigger 3 escalation; node identity as a
# codegen contract) and the §12.2 boundary paragraph corrected. Nothing else re-walked; the rest of
# this map carries its `115e8b1b` verification.

scrml is a single-file full-stack language + compiler (not a web app with a runtime business domain). "Domain concepts" here are the language's own primitives, normatively defined in `compiler/SPEC.md` (§1-§65+). This map is a navigation index into that spec, grouped by concern — not a restatement of the normative text.

**Currency note (S297, `c700c435` -> `115e8b1b`):** this pass made THREE targeted changes and did
NOT re-walk the rest of the file. (1) The third-party adopter's identity was scrubbed to match the
`89db7981` privacy landing. (2) A NEW section — **"Coordinate space: SOURCE vs DIST"** — was added
below the one-landmark section; it is a cross-cutting CLASS, not a bug, and no map row covered it,
which is why an S296 dispatch found this map set "not load-bearing" for that arc. (3) A NEW section
on **cross-chunk soft navigation (§20.8.2/§20.8.7)** was added, because navigate-wave1c moved that
surface from "held/parked" to shipped. Everything else here is carried at its prior verification —
see error.map.md / schema.map.md / migrations.map.md / dependencies.map.md for the fully re-verified
account of what changed this window.

**PRIOR currency note (S288/S289):** two targeted corrections (the M1 mechanism note + the "Known
open gaps" paragraph); the rest was not re-walked then either.

## Core Concepts (by SPEC section)

**Reactivity** — `@cell` reactive declarations (§6, V5-strict access model); a cell auto-subscribes every read site. Value-native maps/sets (§59) give `@cell:[K]V` / `set[K]` first-class reactive collection types. §6.6.9: server-fn / client-cell read — "THE SPLIT" — a server function reading a client cell gets an explicit CPS-marshal boundary (E-REACTIVE-003 + W-SERVER-DERIVED-MARSHAL) instead of a silent value smuggle.
**State machines** — `<engine for=Type>` (§51) governs variant-graph progression via `rule=`/`initial=`/`<onTransition>`/`<onTimeout>`/`<onIdle>`; `<engine server=@source>` gives server-authoritative hydration (§52.4.4). Sibling: §54 nested substates. 44 E-ENGINE-* diagnostic codes (largest single family — see error.map.md).
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

## Business Invariants (language axioms, not app rules)
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

## Domain Events (compiler-pipeline analogs)
`RowChange` — synthesized per §38.13 watched-table row mutation (INSERT/UPDATE/DELETE), dispatched client-side via the `__change` frame to `<onchange>` handlers.
Engine variant transition — an `<engine>` cell's `rule=`-governed state change, optionally observed via `<onTransition>`/`<onTimeout>`/`<onIdle>`.
Soft navigation — a route swap into the `[data-scrml-outlet]` region (fetch → swap → hydrate → transition), NOT a shell re-boot (§20.8.2).
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
#scrml #map #domain #trigger-3 #escalation-server-only #two-set-distinction #confidentiality-boundary #node-identity #node-id-freshness #component-expander #language-primitives #css65 #theme #realtime #channel-watches #auth #baas #reactivity #engine #not-absence #e-style-conflict #outlet #soft-nav #server-shape #tool-serve #link-boost #css-wave1 #theme-token #content-hash #colorless-async #giti-037 #giti-038 #writer-ownership #session-establishment #position-invariant-await #one-landmark #shell-composition #e-outlet-and-main #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes #landmark-tag #component-expansion #total-walk #nested-program-isolation #e-script-001 #decl-scoped-diagnostics #dbauth #db-authoritative #rls #secdef #immutable-column #privilege-separation #db-migrate #trust-boundary-reversal #half-rls-honesty-bar #auto-immutable #is-effectively-immutable #session-principal-wiring #e-match-invalid-arm #ghost-pattern #w-dead-function #resolved-gaps #tenant-context-union #dist-space #source-space #coordinate-space #d4 #pages-prefix-strip #forward-index #w-server-import-unemitted #oracle-blind-spot #runtime-chunks #detect-runtime-chunks #post-emit-chunk-gates #chunk-dependencies #gh234 #navigate-wave1c #cross-chunk-nav #w-nav-chunk-load-failed #chunk-loading-depth-counter #boot-dispatch #last-nav-wins

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
