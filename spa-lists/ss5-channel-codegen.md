# sPA ss5 — channel-codegen

**Launch:** `read spa.md ss5` · **Branch:** `spa/ss5` · **Worktree:** `../scrml-spa-ss5`

## Shared ingestion
The channel pipeline: `emit-channel.ts` codegen (reparses the raw text body), `ast-builder.js`
`liftBareDeclarations` export-channel P3.A path (~1140, `_p3aIsExport` marker), `route-inference.ts`
channel classification (`detectServerContextChannelCellRead` ~3407), `commands/migrate.js` Migration 4
(server-keyword-eliminate :657-851), and §38 channel placement/sync rules (v0.3 reversal: file-top
channel now fires E-CHANNEL-OUTSIDE-PROGRAM). Threads: the structural-vs-raw-text body-parse divergence;
the §38.6 broadcast/disconnect injection contract; RULING-A cell-write-is-client.

## Core files
`compiler/src/codegen/emit-channel.ts` · `compiler/src/ast-builder.js` · `compiler/src/route-inference.ts` · `compiler/src/commands/migrate.js` · `docs/known-gaps.md`

## Items (least-ingestion-first)
1. **`channel-v03-fixture-shape-migration`** `[landed-on-branch 85ff5b85]` bug LOW · tier med — channel broadcast/disconnect + file-top-channel tests skipped; fixtures use pre-v0.3 file-top `<channel>` now firing E-CHANNEL-OUTSIDE-PROGRAM. Pure fixture migration: wrap in `<program>`; injection contract unchanged. Entry: `channel.test.js:1291,1514` + emit-channel.ts.
2. **`g-export-channel-body-text`** `[landed-on-branch — Option 2b]` feature LOW · tier med — Bug 12.b: `export <channel>` body collapses to raw text pre-codegen (liftBareDeclarations ~1140); emit-channel reparses. Option 2b = parse export-channel bodies structurally at TAB (codegen-contract blast radius). Entry: ast-builder.js + emit-channel.ts.
3. **`g-channel-server-keyword-auto-migrate`** `[PARKED — escalate: reverses user S189 ruling]` feature LOW · tier high — `bun scrml migrate` doesn't auto-strip a deprecated `server function` channel-cell-write publisher under RULING A (Enhanced-A). migrate text-rewrite + route-inference classification must agree. Entry: migrate.js Migration 4 (:657-851) + route-inference.ts (:3407).
4. **`p3a-cross-file-channel-v03-deferred`** `[PARKED — escalate: unimplemented v0.3 A8 + design-open]` bug LOW · tier high — P3.A cross-file `<channel>` export/import/inline/passthrough/broadcast suite (5 describe.skip) blocked on the unimplemented v0.3 A8 cross-file route-emission contract; design-open PURE-CHANNEL-FILE dispensation. Entry: p3a-*.test.js + component-expander.ts + emit-channel.ts + module-resolver.js.

## Progress
`ss5.progress.md`. Land on `spa/ss5`; ping PA inbox when ready. Do not advance main / do not push.
