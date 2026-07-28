# primary.map.md
# project: scrml
# updated: 2026-07-28T17:45:00Z  commit: 115e8b1b
# NOTE (S297): manual PA-dispatched refresh over `c700c435` -> `115e8b1b` — **39 commits**, carrying
# forward landings owed since S292, S295 and S296. Maps FULLY rewritten this pass: primary,
# structure, dependencies, error, test, non-compliance. TARGETED corrections: schema, migrations,
# domain, build, config, infra (each states in its own header what was and was not re-walked).
# NOT touched: auth (no auth/session surface changed — see the Map Index). Two things this refresh
# closes that are worth naming up front: (1) the `g-maps-error-map-missing-diagnostics-and-emit-client`
# ROUTING gap, both halves — see §Task-Shape Routing; (2) the map set's own carry of a third-party
# adopter identity the repo scrubbed at `89db7981`. For per-session history read `docs/changelog.md`,
# not this file.

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs throughout — `Bun.serve`, `bun:sqlite`, `Bun.$`, `Bun.SQL`, `Bun.hash`)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       **7109** git-tracked files. `compiler/src/` **188** (143 .ts + 43 .js + 2 other) — **+1 this window** (`sql-table-refs.js`). `compiler/tests/` **1278** `*.test.js` — **+20 this window**. `compiler/SPEC.md` **36,641** lines. Conformance **747** cases.
Version:    v0.7.1 (root package.json — now the SOLE manifest)
Packaging:  **CHANGED THIS WINDOW — scrml is PUBLISHABLE and is NO LONGER a workspace monorepo.** `171f5f23` deleted `compiler/package.json`, removed `"workspaces": ["compiler"]`, dropped `"private": true`, hoisted `acorn`+`astring` into the root deps, and added a `files` ALLOWLIST (`compiler/{bin,src,native-parser,runtime}/`, `stdlib/`, `README.md`, `LICENSE` — anything new excluded by default). `stdlib/` is REQUIRED at runtime, not documentation. stdlib/, editors/, lsp/ remain integral first-party surfaces. **Any doc describing a `compiler/` workspace at v0.2.0 is stale.**
CI:         GitHub Actions — **three** workflows on `main`: `ci.yml` (gate/tracking/windows; `gate` gained a 7th step this window), `advisory-review.yml`, and **`cloud-maps.yml` (scheduled daily, CURRENTLY FAILING 17/17 runs — see build.map.md)**.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`). It
is the authority for published counts (compiler LOC, test files, SPEC lines, conformance cases,
stdlib modules, CLI verbs, LSP capabilities, gated snippets). **Do not hardcode any of those figures
in a doc — cite FACTS.md.** This window: `live compiler source` 229,952 -> **231,974** lines across
186 files; `test files` 1,258 -> **1,278**; `specification lines` 36,575 -> **36,641**; `conformance
cases` 746 -> **747**. stdlib modules (21), CLI verbs (11), LSP capabilities (7) unchanged.

**Second generated authority, NEW this window:** `compiler/SPEC-INDEX.md`'s totals block is now
`@generated` by `scripts/regen-spec-index.ts` and gated by `--check` in CI `gate` AND the local
pre-push hook. Its line count deliberately matches `scripts/facts.ts`'s `specLines()` exactly — two
generated figures for one quantity disagreeing by one makes a reader distrust both.

**FACTS.md deliberately does NOT publish a §34 diagnostic-code total** ("load-bearing but not
reliably extractable… a wrong number is worse than an absent one"). error.map.md carries the
reconciled count — **799 at this HEAD** — with its own re-derivable `comm`-set-diff methodology and
a documented `grep -oP` tooling caveat.

## Landings folded in THIS window (`c700c435` -> `115e8b1b`) — three arcs

### Arc 1 — the coordinate-space class (S296, D-4) — the one no map row covered
**`compiler/src/codegen/emit-server.ts` + `compiler/src/api.js`.** Server import specifiers are now
emitted in **DIST** coordinate space, not source space (`distRelativeServerSpecifier`, with
`isOutsideBase` and `distServerPathOf`). SPEC §47.9.5 strips a leading `pages/` from the DIRNAME, so
the dist tree is not a mirror of the source tree, and a source-space specifier overshoots by exactly
one segment at every depth for every importer under `pages/` — compile GREEN, bundle dead at runtime
with `Cannot find module`. Reversal in `api.js` is a **dist-keyed FORWARD index**
(`distServerKeyToSource` + `distDirOfSource` -> `serverImportTargetSource`), because the inverse
transform is AMBIGUOUS; **both** reversal sites route through it (`checkServerImportInvariant` and
`emitValueOnlyServerJsForDanglingImports`). `W-SERVER-IMPORT-UNEMITTED` had been SILENT on this
class because it validated in the one space where the path is always self-consistent — the oracle
inherited the implementation's coordinate assumption. **S296's dispatched agent reported these maps
"not load-bearing" for that arc precisely because no row covered any of it. That is fixed:**
domain.map.md has a new "Coordinate space: SOURCE vs DIST" section, dependencies.map.md has the
module-graph rows, structure.map.md names both files.

Same arc: **D-5** (`emitReferencedModuleConstLines`, emit-server.ts) — a module-level `const`/`let`
the server bundle CLOSES OVER is now emitted into `.server.js`. Before, `return ROLES[i];` reached
the server bundle with no `ROLES` anywhere in it: a runtime `ReferenceError` with ZERO errors and
ZERO warnings. ADDITIVE — the client bundle is byte-unchanged, so the §14.8.9 protect-floor surface
is untouched. Fail-closed: a candidate whose initializer's free identifiers do not ALL resolve at
server module scope is SKIPPED, not guessed (a module-load ReferenceError is strictly worse than the
call-time one, and the honest answer for that shape is a diagnostic).

### Arc 2 — the three-lane adopter arc (S293/S294/S295, ~1,400 lines)
- **GH #234 — `<errors>` demand-marks the `messages` chunk.** `emit-client.ts`
  `POST_EMIT_HELPER_CHUNK_GATES` gained `["_scrml_message_for", "messages"]`. The `<errors of=…/>`
  wiring captures the helper as a VALUE behind a `typeof` guard, so a call-form entry could not
  match; and the guard did not save it, because the accessor rename rewrites BOTH occurrences —
  including the one inside `typeof` — to a wrapper the prologue always defines. The ReferenceError
  fired at the top of `_scrml_boot`, aborting boot before any handler bound.
- **GH #235 — child pages load the shell's transitive module scripts.** `codegen/index.ts`:
  `computeDependencyClientScripts` gained a `hostFilePath` param; the trailing-script strip became a
  repeated-group regex; the composed script set is rebuilt as shell-deps → shell-bundle → page-deps
  → page-bundle, de-duplicated. **Ordering is the contract**, not presence — classic `<script>` eval
  is sequential and each dep's `_scrml_modules[…]` footer must run before the bundle that reads it.
- **GH #237 — `on mount` server calls get the §13.2 async scope.** `codegen/scheduling.ts` gained
  **283 lines and 8 new functions** (`scanEmittedCode`, `precedesBlockBrace`,
  `continuesEmittedStatement`, `splitEmittedStatements`, `liftEmittedStatementAwaits`,
  `liftOneEmittedStatement`, `recurseEmittedBraceGroups`, `emittedCodeCallsServerFn`), consumed by
  `emit-reactive-wiring.ts:536-537`. A mount block's server calls were bare pending Promises, so an
  `if (u is not) { redirect("/login") }` sign-in guard could never take its deny branch — **fail-OPEN**.
- **navigate-wave1c — cross-chunk soft nav SHIPPED.** `runtime-template.js` (+218) +
  `emit-event-wiring.ts` + `emit-variant-guard.ts`. Absolute-URL chunk keying, deps-first load
  order, hard-nav fallback on failure/timeout, and the `_scrml_chunk_loading` **DEPTH COUNTER** (not
  a boolean — two overlapping navigations otherwise leave the second chunk unbooted and inert).
  First `W-NAV-CHUNK-LOAD-FAILED` fire site.
- **Per-item reconcile family (S293/S294).** `emit-lift.js` (+193, `computeItemDerivedReplay`,
  `_collectDeclNodesInScope`) and `emit-each.ts` (+125, `pickReferencedEnclosingCtxs`,
  `enclosingResolvePreludeLines`/`ForHandler`, `referencesFreeIdent`): per-item text / class: /
  attribute / `if=` / event bindings re-resolve the live item BY KEY and replay item-derived locals
  on REPLACE. Shadow-safe by construction.
- **i225 — form-control `value=` inside a `<match>`/`<engine>` arm** writes the caret-safe `.value`
  PROPERTY. `LogicBinding.directiveIsFormValue` is computed at REGISTRATION in `emit-html.ts` (the
  arm wire fn never sees the markup node) and consumed in `emit-variant-guard.ts`.
- **D-3 — the Tailwind `outline-*` family registered** (`tailwind-classes.js` `registerOutline`).
  The whole family was absent, so every real `outline-*` utility false-fired
  `W-TAILWIND-UNRECOGNIZED-CLASS`. **v3 semantics deliberately** — v4's `outline-none:
  outline-style: none` would silently delete the forced-colors accessibility affordance.
- **Diagnostic quality:** `E-PA-002`'s message now leads with `<schema>` + `scrml db-migrate`;
  `tabSpan → span` lift in `api.js` restores `:line:col` on every TABError in the build/dev path.

### Arc 3 — DB/schema hardening (S290/S292)
- **`compiler/src/sql-table-refs.js` — NEW FILE.** A bounded `?{}`-table identifier SCANNER,
  **explicitly not a SQL parser**. Two-valued contract `{tables, privileges, undetermined}`, and the
  second value is the load-bearing one.
- **Queried-table grants** (`schema-differ.js` `diffSchema` + `commands/db-migrate.js` scanner
  wiring + the WIDENED `runPgApply` signature). The bounded-role GRANT is per-TABLE but the
  `SET LOCAL ROLE scrml_app` drop is per-QUERY, so once ONE table is db-authoritative, an unmarked
  identity-table read fails `permission denied` at login — **and §14.8.10's corollary PRESCRIBES
  leaving the identity table unmarked.** The documented shape was the broken one. Least-privilege by
  construction (SELECT fallback, never blanket CRUD).
- **Constraint drift on existing columns** (§38.6.2 rows 6/7/8) — NEW `columnConstraintDrift`,
  PK-aware and default-tolerant, plus `W-SCHEMA-CONSTRAINT-TIGHTENED` /
  `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` and a `printPlan` that distinguishes an EMPTY plan from a
  WITHHELD one.
- **`E-SCHEMA-011`** (§39.5.5) — a `references` clause that parses to no foreign key is now a
  compile error. An adopter declared 34 foreign keys and got **zero rows in `pg_constraint`**, with
  no diagnostic.
- **§34 catalog: 795 → 799**, +4/-0.

### Infrastructure + hygiene this window
`gate` gained the SPEC-INDEX totals check; `pre-push` gained a ~261ms generated-doc currency gate
(deliberately excluding the ~48s snippet gate — a hook that expensive gets bypassed, and a bypassed
gate gets deleted); the snippet corpus widened to `docs/website` (98 files); SPEC-INDEX's ~72 KB
inline amendment history was dereffed to `scrml-support`; §23.2.4a ratified the multi-statement
inline `_{}` slice; and `89db7981` anonymized a third-party adopter identity across 47 files, moving
9 correspondence files out of the public tree.

## Map Index

| Map | Stamp | Contents |
|---|---|---|
| **primary.map.md** | **`115e8b1b`** | this file — fingerprint, routing, key facts |
| **structure.map.md** | **`115e8b1b`** | FULL rewrite. 188 src files, 1278 tests, 5 entry points, per-file ownership incl. every file this window touched; the de-workspaced monorepo note |
| **dependencies.map.md** | **`115e8b1b`** | FULL rewrite. 6 runtime + 5 dev deps (ONE manifest now), full module graph, + two new cross-cutting sections: "Runtime-chunk gating" and "Coordinate space" |
| **error.map.md** | **`115e8b1b`** | FULL rewrite. **799** §34 codes (+4), a HOW-TO-LOOK-UP-A-CODE preamble, and family rows for `E-PA-*` and `*-TAILWIND-*` that previously had ZERO coverage |
| **test.map.md** | **`115e8b1b`** | FULL rewrite. **1278** files recounted per category, all 20 new files attributed to their landing, + the coverage-shape traps (runtime-only diagnostics, the `lintDiagnostics[]` third stream, execute-don't-grep) |
| **non-compliance.report.md** | **`115e8b1b`** | FULL rewrite. 5 NEW findings incl. the map set's own privacy leak and the cloud-maps failure |
| **schema.map.md** | **`115e8b1b`** | TARGETED — `columnConstraintDrift`/`referencesHint`/`E-SCHEMA-011`, the D-5 `initExpr` dependency, `LogicBinding.directiveIsFormValue`. AST-shape inventory carried (no new `ast.ts` shape this window) |
| **migrations.map.md** | **`115e8b1b`** | TARGETED — queried-table grants, constraint-drift reconcile, `E-SCHEMA-011`, the `runPgApply` signature, withheld-vs-empty plan reporting |
| **domain.map.md** | **`115e8b1b`** | TARGETED — three NEW sections (coordinate space, runtime-chunk tree-shaking, cross-chunk soft nav) + the privacy scrub. The rest (language primitives, one-landmark, invariants) NOT re-walked |
| **build.map.md** | **`115e8b1b`** | TARGETED — packaging, the 7-step gate, the widened snippet corpus, the SPEC-INDEX gate, the pre-push currency gate, and a full rewrite of the `cloud-maps` section (it was described as unmerged; it is merged, scheduled, and failing) |
| **config.map.md** | **`115e8b1b`** | TARGETED — env-var set RE-VERIFIED unchanged; + the `compilerSettings` lint-knob family and the CI-secret table (names only) |
| **infra.map.md** | **`115e8b1b`** | TARGETED — three workflows (was two), the cloud-maps status, the retired `scrml-maps-bot` framing |
| auth.map.md | `df2ac831` | **deliberately older.** scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out + §20.5 session builtin. NOTHING in this window touched that surface; `E-PA-002`'s message change is diagnostic-quality, mapped in error/structure, matching the precedent that §14.8.10/§14.8.11 principal machinery lives in domain/dependencies |
| api.map.md | absent | no REST/GraphQL/gRPC surface owned by this repo — the compiler EMITS API routes for generated apps (§60/§61, domain.map.md) |
| state.map.md | absent | no redux/zustand/jotai — not a frontend app |
| events.map.md | absent | no EventEmitter/pubsub in the compiler's own src — §38 channel semantics are a language feature |
| style.map.md | absent | Tailwind + §65 CSS-native are compiler FEATURES (domain.map.md + error.map.md's Tailwind row) |
| i18n.map.md | absent | no locales/i18n dirs |
| jobs.map.md | absent | `scrml:cron` is a stdlib module FOR GENERATED APPS, not a job system this repo runs |

An honest older stamp beats a false "verified at HEAD". The one carried row (auth) is a decision,
not an omission.

## Task-Shape Routing

> **Fixed this pass (`g-maps-error-map-missing-diagnostics-and-emit-client`, MED, filed
> independently by two lanes at S295).** (a) "diagnostic codes" used to route to error.map.md, which
> had ZERO hits for `E-PA-002` or `TAILWIND` — both loci had to be found by grep. error.map.md now
> opens with an explicit lookup procedure and its family table is keyed by PREFIX, so a code it does
> not name individually is still routed. (b) The chunk rows pointed at `codegen/index.ts` and named
> nothing in `codegen/emit-client.ts`, **where the gates actually live** — the same blind spot that
> produced a wrong fix-locus in the GH #234 brief. Corrected below.

| If your task is about… | Read |
|---|---|
| **a `ReferenceError: _scrml_* is not defined` in a shipped bundle · runtime-chunk tree-shake gates · a helper that is called/referenced but never defined** | **`codegen/emit-client.ts` — `detectRuntimeChunks` (:273, the PRE-EMIT AST walk) + `POST_EMIT_HELPER_CHUNK_GATES` (:2167, the POST-EMIT reference scan) — AND `codegen/runtime-chunks.ts` `CHUNK_DEPENDENCIES` (:384) + `applyChunkDependencies` (:392, called at emit-client.ts:1290).** Mapped in dependencies.map.md ("Runtime-chunk gating") + domain.map.md ("Runtime-chunk tree-shaking") + structure.map.md. **NOT `codegen/index.ts`.** Post-emit entries match as SUBSTRINGS (trailing `(` = call site, bare name = value/`typeof` reference) and the scan runs BEFORE `cell-accessor-rename.ts`'s `_scrml_cs_` rename. |
| chunk NAMESPACING / multi-chunk token isolation (a DIFFERENT concern from the gates above) | `codegen/chunk-namespace.ts` + `codegen/cell-accessor-rename.ts` + `codegen/index.ts` (the bundle-assembly wiring only) — dependencies.map.md + structure.map.md |
| chunk / module-format EMIT (esm vs classic) | `codegen/runtime-esm.ts` + `codegen/emit-client-esm.ts` + `codegen/index.ts` (the `<script type="module">` wiring) — dependencies.map.md + build.map.md. For which CHUNKS ship, see the runtime-chunk row above. |
| **an emitted path that resolves at one nesting depth and not another · `Cannot find module` from a `.server.js` · a path oracle that stays silent** | **domain.map.md "Coordinate space: SOURCE vs DIST"** + `codegen/emit-server.ts` `distRelativeServerSpecifier` + `api.js` `serverImportTargetSource` / `distServerKeyToSource`. SPEC §47.9.5. |
| **a diagnostic code — ANY code, any prefix** | **error.map.md** — start at its "HOW TO LOOK UP A DIAGNOSTIC CODE" preamble, then the family table (keyed by prefix, so an unnamed code is still routed), then `grep -rn "<CODE>" compiler/src/`, then `grep` SPEC.md for the normative definition |
| **`E-PA-*` / a spurious "no CREATE TABLE found" / protect-floor shadow-DB resolution** | error.map.md's `E-PA-*` row -> `compiler/src/protect-analyzer.ts` (SOLE fire site). Read the false-fire comments at :415 / :493 / :626 / :948 before "fixing" one. |
| **`W-TAILWIND-*` / `E-TAILWIND-001` / a utility class that lints as unrecognized** | error.map.md's Tailwind row -> `compiler/src/tailwind-classes.js` (SOLE fire site: `findUnsupportedTailwindShapes` / `findUnrecognizedClasses` / `validateArbitraryCss`), wired from `api.js`'s lint pre-pass (~:1025-1050), suppressible via `compilerSettings.lintTailwindUnrecognizedClass`. **Returns into `lintDiagnostics[]`, NOT `errors[]`.** |
| **`on mount` / a server call that returns a pending Promise / §13.2 auto-await placement** | `codegen/scheduling.ts` (`emittedCodeCallsServerFn`, `liftEmittedStatementAwaits`, `scanEmittedCode`) + `codegen/emit-reactive-wiring.ts:536` — dependencies.map.md |
| **cross-chunk soft navigation / a soft-nav that renders correct-but-inert markup / boot timing** | domain.map.md "Cross-chunk soft navigation" + `runtime-template.js` (`_scrml_nav_missing_chunks`, `_scrml_nav_chunk_failed`, the `_scrml_chunk_loading` depth counter) + `codegen/emit-event-wiring.ts` (the `_scrml_boot` dispatch) |
| **a per-item binding that goes stale when a list item is REPLACED** | `codegen/emit-lift.js` (`computeItemDerivedReplay`) + `codegen/emit-each.ts` (`pickReferencedEnclosingCtxs`, `enclosingResolvePrelude*`) — dependencies.map.md |
| **a form control whose `value=` won't clear / caret jumps while typing** | `codegen/emit-bindings.ts` (file scope, i174) OR `emit-html.ts` -> `binding-registry.ts` `directiveIsFormValue` -> `emit-variant-guard.ts` (inside a `<match>`/`<engine>` arm, i225) — schema.map.md's binding-shape section |
| MPA shell composition / child-page `<script>` sets / dependency ordering | `codegen/index.ts` (`computeDependencyClientScripts` — 4-arg since GH #235, `pushScript`/`seenScriptSrc`) + domain.map.md's one-landmark section |
| the DB-authoritative security tier — RLS/roles/SECDEF/db-migrate/grants | domain.map.md (concept + threat model) + migrations.map.md (apply model, queried-table grants, constraint drift) + schema.map.md (`TableDecl`/`ColumnDecl`/`SecdefFnDecl`/`isEffectivelyImmutable`/`columnConstraintDrift`) + error.map.md (the code families) + build.map.md (`scrml db-migrate` flags) |
| which tables a `?{}` touches / a `permission denied` at request time | `compiler/src/sql-table-refs.js` + migrations.map.md's "Queried-table grants". **Never read an empty `tables` as "touches nothing"** — check `undetermined`. |
| `<schema>` foreign keys / constraint drift / `oneOf`/`notIn`/`default()` lowering | schema.map.md (the lowering + constraint-drift sections) + error.map.md (`E-SCHEMA-010`, `E-SCHEMA-011`, `W-SCHEMA-CONSTRAINT-*`) + migrations.map.md |
| types / interfaces / AST node shapes | schema.map.md |
| environment variables / config keys / lint suppression knobs | config.map.md |
| test patterns / fixtures / which tier a test runs in | test.map.md |
| build commands / CI stages / CLI flags / packaging + publish surface | build.map.md |
| CI provider / workflows / secrets / why cloud-maps is red | infra.map.md + build.map.md |
| directory layout / entry points / where a file lives | structure.map.md |
| external packages / module graph | dependencies.map.md |
| language primitives / SPEC navigation / business invariants | domain.map.md |
| auth flows / JWT / OAuth / protect-floor / session builtin | auth.map.md (stamp `df2ac831` — honest, unchanged surface) |
| outlet / `<main>` landmark / MPA shell composition | domain.map.md (four-case table) + error.map.md (E-OUTLET-AND-MAIN) |
| tenant-row isolation floor (§14.8.10) | domain.map.md + error.map.md (E-TENANT-*/I-TENANT-*) + dependencies.map.md (tenant-egress.ts) |
| SSR auto-make-safe (§52.15.5) / sql-lex | domain.map.md + error.map.md + dependencies.map.md |
| colorless-async classification (Q1/Q2) | dependencies.map.md (mechanism) + error.map.md (E-ASYNC-STDLIB-IN-SYNC-CALLBACK) |
| content-hash / cache-header build contract | build.map.md (mechanism) + domain.map.md (§47.9.8 concept) |
| public-claim gates (snippets, derived figures, SPEC-INDEX totals) | build.map.md (the four scripts + CI + pre-push wiring); `docs/FACTS.md` is the figure authority |
| DB migration / schema-apply / privilege model | migrations.map.md |
| non-compliant / stale docs | non-compliance.report.md |

**Routing self-check (the four historical bugs the S295 gap entry named):** all four route correctly
under the runtime-chunk row above. `6nz Bug P` (`d570341d`, S123) — `_scrml_destroy_scope` called
into the tree-shaken `timers`/`animation` chunks; fixed by `CHUNK_DEPENDENCIES` +
`applyChunkDependencies` in `runtime-chunks.ts`, wired into `detectRuntimeChunks`'s tail → the row's
third clause. `Bug 57` (`e4859a5f`, S140) — `detectRuntimeChunks` had no `each-block` case, so
`_scrml_reconcile_list` was tree-shaken → clause one. `GITI-036` (#59) — `_scrml_structural_eq`
tree-shaken from a CG-deferred `<match>` arm, fixed via the post-emit reference scan → clause two.
`GH #234` (#244) — the `messages` chunk, post-emit reference gate → clause two.

## Key Facts

- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (11 subcommands); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **The dist tree is NOT a mirror of the source tree.** SPEC §47.9.5 strips a leading `pages/` segment from the DIRNAME, so `pages/login.scrml` emits to `dist/login.*`. Any code relating two files must pick ONE space and stay in it; reversal from dist back to source needs a FORWARD INDEX because the inverse is ambiguous. **A path oracle written in the implementation's own coordinate space proves nothing** — that is why `W-SERVER-IMPORT-UNEMITTED` was silent on D-4.
- **Runtime-chunk inclusion is decided in `codegen/emit-client.ts`, in two phases, not in `codegen/index.ts`.** Pre-emit AST walk (`detectRuntimeChunks`) + post-emit reference scan (`POST_EMIT_HELPER_CHUNK_GATES`) + a transitive closure over `runtime-chunks.ts`'s `CHUNK_DEPENDENCIES`. A missed gate ships a green compile and a bundle that dies at load — historically the single highest-blast-radius defect class in this compiler (four separate adopter-blocking instances).
- **`null` and `undefined` do not exist in scrml source in ANY position (§42)** — `not` is the sole absence value.
- **`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. Every consumer matches structurally; a pass expecting a typed node silently finds nothing. Likewise `TableDecl`/`SecdefFnDecl`/`ThemeContext` are codegen-internal, not `ast.ts` types.
- **The DB-authoritative security tier is OPT-IN and CONDITIONALLY ENGAGED**, gated by `appDeclaresDbAuthoritative(fileAST)`. But **conditional engagement is not conditional BLAST RADIUS**: once ONE table opts in, the `SET LOCAL ROLE scrml_app` drop is emitted per-QUERY in any request scope, so every unmarked table read at request time also needs a grant (S292). And the narrower "zero-immutable-columns emits byte-identically to M1" sub-guarantee was formally RETIRED at S288 — do not assume an old byte-identity claim still holds.
- **A superuser/table-owner BYPASSES Postgres `FORCE ROW LEVEL SECURITY`** — the bounded `NOLOGIN NOBYPASSRLS` role is MANDATORY, not a hardening nicety. Without it the RLS policy is a silent no-op that LOOKS enforced. `scrml db-migrate` runs under a DIFFERENT, more-privileged principal than the app; auto-apply-on-boot is eliminated for Postgres by design.
- **The GUC-based principal (`scrml.tenant`/`scrml.principal.caps`) is self-settable by `scrml_app`** — it protects a non-compromised app, not one with an injectable SQL channel. What DOES survive a fully-compromised `scrml_app`: the immutable-column REVOKE, the SECDEF-only choke, and `NOBYPASSRLS`. Never claim more.
- **`scrml db-migrate` and `scrml migrate` are DIFFERENT commands** — `migrate` is the scrml-SOURCE syntax codemod; `db-migrate` applies `<schema>` to a real database. Do not conflate them.
- **scrml carries no compile-time SQL parser.** `sql-table-refs.js` is a bounded identifier SCANNER with a two-valued contract; a caller must never read an empty `tables` as "touches nothing" — the `undetermined` list is the honest boundary and is REPORTED to the operator.
- Server/client execution boundary is fully INFERRED from usage (no author annotation; a `session` reference is a server-escalation trigger); a fail-closed acorn-exact scan (E-CG-001) backstops the §14.8.9 protect-floor. **§13.2's auto-await obligation has THREE destinations** — a `function` body, a reactive-cell initializer, and (since GH #237) a desugared `on mount` block; missing one is fail-OPEN, not merely wrong.
- **SPEC.md is the sole normative source.** PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4. `SPEC-INDEX.md` is now partly generated and CI-gated — but its TOPIC table still has zero entries for the DB-authoritative tier (non-compliance.report.md C3).
- The compiler ships TWO parsers: the live pipeline and `compiler/native-parser/` (`--parser=scrml-native`). **Zero native-parser diff this window and none owed** — every landing is emit-time, runtime, CLI or diagnostic-message.
- **`.claude/` is gitignored; `.claude/maps/` and `.claude/agents/project-mapper.md` are FORCE-tracked.** Staging a map refresh requires `git add -f`. Because the maps publish with the public repo, a map generation must not reintroduce third-party adopter identity (scrubbed at `89db7981`; the map set itself was still carrying it at the start of this pass).
- **The automated map refresh is DOWN.** `cloud-maps` has failed 17/17 runs; since 2026-07-17 the agent errors on turn 1 in ~0.6s at $0 cost, which is an API-level rejection of the first request, not a mapper fault. It is off the required-checks list, so it blocks no merge — its only cost is silent map staleness, which is exactly how this watermark stranded for 39 commits across three sessions.

## Tags
#scrml #map #primary #index #compiler #bun #dist-space #source-space #coordinate-space #d4 #d5 #forward-index #w-server-import-unemitted #runtime-chunks #detect-runtime-chunks #post-emit-chunk-gates #chunk-dependencies #gh234 #gh235 #gh237 #on-mount #scheduling #navigate-wave1c #cross-chunk-nav #w-nav-chunk-load-failed #chunk-loading-depth-counter #boot-dispatch #per-item-reconcile #emit-lift #emit-each #i225 #directive-is-form-value #tailwind-outline #e-pa-002 #tab-span-lift #sql-table-refs #queried-table-grants #least-privilege #column-constraint-drift #e-schema-011 #w-schema-constraint-tightened #dbauth #db-authoritative #db-migrate #rls #secdef #privilege-separation #chunk-namespace #cell-accessor-rename #esm-chunks #module-format #each-fence #outlet #one-landmark #shell-composition #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes #colorless-async #content-hash #facts-gate #snippet-gate #spec-index-gate #generated-doc-currency #cloud-maps #ci-red #npm-publishable #files-allowlist #no-workspaces #privacy-scrub #native-parser #self-host #stdlib #maps-routing-gap

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [infra.map.md](./infra.map.md)
- [migrations.map.md](./migrations.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
