# sPA ss5 · item 2 — `g-export-channel-body-text` (Option 2b: parse `export <channel>` bodies STRUCTURALLY at TAB)

> Archived verbatim per S136. Dispatched 2026-06-19 to `scrml-js-codegen-engineer` (isolation:worktree, opus, background; agentId aa82dde12efca7d61). sPA-ss5, branch base `spa/ss5` @ 85ff5b85.

You are a compiler-source dev agent dispatched by sPA-ss5 (channel-codegen). You work in your OWN `isolation: worktree`. Land your work on YOUR agent branch with incremental commits; the sPA file-deltas your result onto `spa/ss5` and re-integrates. Do NOT push. Do NOT advance main.

## F4 — STARTUP VERIFICATION (do this FIRST, before any edit)
1. `pwd` and `git rev-parse --abbrev-ref HEAD` — confirm you are in YOUR provisioned agent worktree (a path under `.claude/worktrees/`), NOT the main checkout `/home/bryan-maclee/scrmlMaster/scrml` and NOT `../scrml-spa-ss5`.
2. ALL Write/Edit/Bash file mutations MUST target your worktree-absolute path. NEVER write to `/home/bryan-maclee/scrmlMaster/scrml/...` (main) or `/home/bryan-maclee/scrmlMaster/scrml-spa-ss5/...` (the sPA branch). Before editing a file, `stat` it to confirm it is your worktree copy; after editing, read it back to confirm the change landed in your tree.
3. Do NOT `cd` into the main checkout. Use Bash edits with worktree-absolute paths. `git -C` does not change CWD.
4. `git status` must be CLEAN before you report DONE (all work committed incrementally).
5. Symlink check: if `bun test` can't resolve modules, symlink from main: `ln -s /home/bryan-maclee/scrmlMaster/scrml/node_modules ./node_modules && ln -s /home/bryan-maclee/scrmlMaster/scrml/compiler/node_modules ./compiler/node_modules`.

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; follow §"Task-Shape Routing" for a compiler-source codegen change.
Map currency: maps reflect HEAD `9afc746e` as of 2026-06-12; verify post-watermark files against source.

## The bug (REPRODUCED by the sPA — R26 confirmed)
`export <channel name="X">` body collapses to a RAW TEXT child at TAB; a NON-export `<channel>` body parses structurally (state-decl/logic). non-export → child kinds ["logic"], state-decl child TRUE; export (`_p3aIsExport:true`) → ["text"], raw-text child TRUE, no state-decl. Repro at `/tmp/repro-ss5-item2.mjs` (adapt paths to your worktree).

## The fix — Option 2b (DECIDED; do not re-litigate)
Make `export <channel>` bodies parse STRUCTURALLY at TAB like non-export channels, retiring the export-keyword text-collapse. Update emit-channel's reparse (assumes raw-text body) to consume the structural form (or retire where redundant).

## Footprint (verify against current source)
- `compiler/src/ast-builder.js:1154-1224` — P3.A export-channel path; :1217-1221 pushes channel block `_p3aIsExport:true` without structural lift. Non-export lift: ~974 + ~14064. Apply the same lift to the export path.
- `compiler/src/codegen/emit-channel.ts` :55-76, :462 — exporter-side handling; trace cell+server-fn extraction from raw text, adapt to structural.

## R4 — SPEC normative
Read SPEC §38.4 / §38.12 (incl. §38.12.6 pure-channel-file) / §34 E-CHANNEL-EXPORT-001 IN FULL before changing the contract. If spec silent/ambiguous on a needed decision → STOP, report escalate.

## Verify (R26)
1. Repro: export body now structural.
2. Full channel+cross-file surface green: channel.test.js, cross-file-channel-import-emit, cross-file-channel-mount-e-ri-002, p3a-tab-channel-export-recognition, p3a-chx-cross-file-inline, p3a-chx-same-file-passthrough, p3a-mod-channel-registry, p3a-name-collision-error, p3a-diagnosis, p3a-cross-file-multi-page-broadcast, p3a-pure-channel-file, channel-server-fn-write, channel-broadcast-escalation-trigger7.
3. Full `bun run test` pass/skip/fail delta. Cross-file channel emit regression = primary risk; if unfixable within ast-builder+emit-channel → STOP/report (item-4 coupling; item 4 is the cross-file channel suite, design-deferred).
4. `node --check` emitted JS from a cross-file channel fixture.

## Commit discipline
Incremental commits; coupled code+test = one commit; `git status` clean before DONE; never `--no-verify`. Progress file `docs/changes/g-export-channel-body-text-structural-tab-2026-06-19/progress.md` appended per step.

## Final report
Maps line · root cause (1-2 sentences) · files changed + agent branch + FINAL_SHA · test deltas (channel/p3a surface + full suite before→after) · reparse retired-or-adapted + any cross-file/item-4 coupling · any SPEC ambiguity/escalate.
