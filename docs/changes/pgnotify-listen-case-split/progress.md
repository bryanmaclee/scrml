# progress — g-pgnotify-listen-case-split (S346 re-dispatch)

Append-only. Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-adc424afa02735191`
Branch: `fix/pgnotify-listen-case-split` off `2709e540` (== origin/main at dispatch).

## 2026-08-15 — startup + DONE-PROBE

- pwd/toplevel/clean: OK. `bun install`: OK.
- The brief's own DONE-PROBE HITS on both halves at HEAD:
  - `grep -qE 'LISTEN "?scrml_|LISTEN \$\{' compiler/src/codegen/emit-channel.ts` -> hit
  - `grep -rqiE 'camelCase|ordersFeed' compiler/tests/unit/*channel*` -> hit
- **THE FIX ALREADY LANDED**: `e2c0f9fc fix(codegen): quote the LISTEN channel name — a camelCase
  <channel watches=> delivered zero rows, silently (#281)`, 2026-07-30 (S301 dispatch; earlier brief archived
  at `docs/changes/pgnotify-listen-case-split-2026-07-30/BRIEF.md`). `git log 4f034e13..origin/main --
  compiler/src/codegen/emit-channel.ts` is EMPTY (no post-map landings); e2c0f9fc predates the map stamp.
- The ledger entry `G-PGNOTIFY-LISTEN-CASE-SPLIT` still reads `open` at HEAD — STALE (ledger is PA-owned; not
  touched here). The S282 loci (`:903/:987/:1028`) are WRONG for HEAD: current sites are `:918`
  (one derivation, `buildWatchesTriggerDDL`), `:925` (pg_notify literal), `:1009` (threaded read), `:1059` (LISTEN emit).

## Verification of the landed fix against every brief item (no code change made)

- (a) ONE derivation: `emit-channel.ts:918` `const notifyChannel = \`scrml_${safeName}\`` inside
  `buildWatchesTriggerDDL`; the LISTEN site reads `ddl.notifyChannel` (`:1009`) — the second derivation is gone.
- (b) Quoted: `:1059` emits `LISTEN ${pgQuoteIdent(notifyChannel)}` -> `LISTEN "scrml_ordersFeed"`.
- (c) `sqlSafeIdent` docstring corrected to "Case is PRESERVED" (`:879-889`); behaviour unchanged. Callers:
  exactly ONE — `emit-channel.ts:984` (`grep -rn sqlSafeIdent compiler/src`).
- (d) camelCase fixture: `compiler/tests/unit/channel-watches-phase2-runtime.test.js:193-297` (`SAMPLE_CAMEL`,
  `resolveNotifyAndListenTargets` applies PG's own fold rule to the emitted pair). BITE PROVEN this dispatch:
  `git checkout e2c0f9fc^ -- compiler/src/codegen/emit-channel.ts` then `bun test` that file ->
  **19 pass / 5 fail** (`Expected: "scrml_ordersFeed" Received: "scrml_ordersfeed"`; emitted
  `_client.query("LISTEN scrml_ordersFeed")` vs `pg_notify('scrml_ordersFeed'`). Restored -> 24 pass / 0 fail.
- CLI compile of `repro/ordersFeed.scrml` at HEAD: `pg_notify('scrml_ordersFeed'` + `LISTEN "scrml_ordersFeed"`;
  client.js contains 0 of {pg_notify, LISTEN, postgres://, _scrml_sql}.
- Differential (`scripts/corpus-emit-differential.ts`, base `1b978fe8` = e2c0f9fc^ vs head `e2c0f9fc`,
  `--roots conformance/cases/channel`, 32 sources / 149 artifacts): **10 artifact content diffs**, all
  `case.server.js`, each exactly ONE changed line — `LISTEN scrml_<kebab>` -> `LISTEN "scrml_<kebab>"`
  (+4 bytes). All 10 names are lowercase, so PG-semantically INERT. 0 compile-failure delta, 0 diagnostic
  delta, 0 syntax delta. The 3 watches= sources NOT in the 10 (driver-non-postgres, unknown-table, no-pk)
  emit no LISTEN block on either side. Corpus has ZERO uppercase channel names.
- Gate at HEAD: `bun test compiler/tests/{unit,integration,conformance}` -> 22335 pass / 70 skip / 1 todo / 0 fail.

STATUS: ALREADY-LANDED (#281). Nothing to fix; nothing to harden found. Report to PA: mark ledger RESOLVED.
