# Deferred gaps surfaced by Realtime `<channel watches=>` Phase 2 (S245)

> Land-time staging for `docs/known-gaps.md`. These are NOT fixed in Phase 2 — surfaced for the PA to file
> as gaps + route. Fold into known-gaps.md at the Phase-2 landing (defers behind live S244).

## g-channel-watches-schema-vs-52-authority-composition (MED — feature-completeness + SPEC self-consistency)
The SPEC §38.13 flagship worked example (SPEC.md:20239-20257) composes `<channel watches=orders>` with a §52
`<orders authority="server" table=orders>` collection. **It does not compile:**
- `_rowChangeSynth` is stamped only from `<schema>`-declared tables (`collectSchemaTables` reads
  `stateType==="schema"` blocks, NOT §52 `authority="server" table=` decls). So a `watches=` table declared ONLY
  via the §52 authority form is unknown → the feed can't synthesize `RowChange`.
- Independently, the §52 authority form in the example fires pre-existing front-end errors: `<orders> @orders`
  → E-CTX-001/E-CTX-003; a bare `<orders authority="server" table=orders>` → E-SCOPE-001. (Pre-existing §52
  surface gaps, unrelated to watches.)
- **Today the feature works only with a `<schema>` block** declaring the watched table (see
  `sample-compiling.scrml`).
- **Disposition:** (a) fix the SPEC §38.13 worked example to a compiling shape (Rule 4 — the spec's own example
  must compile), AND (b) a §52-surface arc to make `authority="server" table=` compose (either teach
  `collectSchemaTables` to read §52 `table=` shapes, or require+document a paired `<schema>` — a design call).
  Route (b) to a §52 deep-dive; (a) rides a SPEC touch.

## g-channel-watches-pg-not-bundled-in-standalone-build (MED — production-deploy)
User ruled scrml BUNDLES `pg` (compiler owns it; adopter installs nothing). Done for the DEV path: `pg@^8.22.0`
in root `package.json`, emitted server `import("pg")` resolves from scrml's node_modules. **But `scrml build`
(standalone deploy) does NOT bundle it:** `commands/build.js` has no `Bun.build` step (`generateServerEntry`
composes `_server.js` from raw ES modules) and the deploy adapters (`applyRailwayAdapter` et al.) write a
deploy `package.json` with scripts only, no `dependencies`. So a deployed standalone realtime app's `import("pg")`
won't resolve until the build pipeline either bundles pg or emits it into the deploy `package.json` dependencies.
- **Disposition:** a build-pipeline follow-on — add `pg` (and any future emitted-runtime dep) to the emitted
  deploy `package.json` dependencies, OR add a `Bun.build` bundling step. Realtime is dev-verifiable now;
  production-deployable after this. File MED; gate the "realtime GA / VERIFIED" claim on it.

## Edge (documented, not a v1 gap): protected PK over the DELETE frame
The `Deleted` frame carries only the PK VALUE (`key`) — structurally required for the client to identify the
deleted row. If an adopter marks the PK column `protect=` AND overrides `key=` to it, the PK value still ships
on DELETE (a self-contradictory adopter choice — you can't key a delta by a value you refuse to send). Documented
in the emitted comment; not v1-guarded. Note in §38.13 if a reviewer wants it explicit.

## Adversarial review LOW follow-ups (PA manual review 2026-07-07 — NO land-blockers)
All 7 attack surfaces cleared (parser fix non-regressing · SQL identifier quoting · frame op-string server↔client
match · protect tag+redact gated + correct table · byte-identical guards structural · JS escaping via JSON.stringify).
Three LOW residuals, none block landing:
- **L1 — LISTEN retry doesn't `.end()` the old pg client** (`emit-channel.ts` `_retry`, ~:990). On repeated `error`
  events a new `pg.Client` is created but the old one is only `removeAllListeners`'d, not `.end()`'d → a marginal
  socket leak under pathological repeated-failure. Trivial fix (`_client.end().catch(()=>{})` in `_retry`). LOW.
- **L2 — multi-instance boot-time trigger-install race.** Every instance runs `DROP TRIGGER IF EXISTS` + `CREATE
  TRIGGER` at boot (chosen for PG<14 support over the atomic PG14+ `CREATE OR REPLACE TRIGGER`). Concurrent boots
  have a brief no-trigger window → a commit in that window misses its NOTIFY. Tolerated by §38.13.6 at-most-once +
  re-fetch backstop; the install `try/catch` swallows the loser's CREATE conflict. Keep DROP+CREATE for the broader
  PG floor. LOW (an advisory-lock wrap is the hardening if ever witnessed).
- **L3 — arm-scanner (`scanToOpenerClose`) blind to backtick/regex/`//`-comment interiors** (`match-statechild-
  parser.ts`). PRE-EXISTING (Phase 2 only added `{}`/`()`/`[]` codeDepth + kept string/`${}` awareness — improved,
  didn't regress). An arm body with an UNBALANCED `{`/`(`/`[` inside a backtick/regex/comment could mis-scan. Same
  class as S244's `literal-scan.ts` — candidate to reuse that module once it lands. LOW.

**VERDICT: LAND-CLEAN** (no correctness/security land-blockers; the one real security issue — protect-egress — was
closed in the follow-on). The 3 LOWs are documented follow-ups, not gates.
