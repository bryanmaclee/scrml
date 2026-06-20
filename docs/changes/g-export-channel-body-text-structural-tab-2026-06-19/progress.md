# g-export-channel-body-text — Option 2b (structural TAB parse of `export <channel>` body)

Branch: agent/g-export-channel-body-text (worktree under .claude/worktrees/)
Base: spa/ss5 @ 85ff5b85

## Steps (append-only, timestamped)

- 2026-06-19 ~21:55 — F4 startup: dispatched into MAIN (no worktree provisioned). Provisioned own
  worktree `.claude/worktrees/g-export-channel-body-text` on branch `agent/g-export-channel-body-text`
  based on `spa/ss5`. Symlinked node_modules from main. Read primary.map.md routing (S186 channel
  codegen + LIVE-pipeline parser-fix blocks). Read SPEC §38.4 / §38.12 / §38.12.6 / §38.12.7 in full —
  §38.12.2 normative: inlined channel node MUST "match the shape of locally-declared channels exactly",
  so structural parity is SPEC-mandated (no ambiguity / no escalate).
- 2026-06-19 ~21:58 — Reproduced bug in worktree via /tmp/repro: NON-export channel child kinds=["logic"]
  state-decl=true; EXPORT channel child kinds=["text"] raw-text=true, NO state-decl.
- 2026-06-19 ~22:00 — Root cause: P3.A export path (ast-builder.js liftBareDeclarations, ~1216) pushes
  the channel block with `_p3aIsExport:true` WITHOUT running its children through the channel-root
  structural lift that the `block.type==="markup"` branch (isChannelRoot → childContext="state") applies
  to non-export channels. FIX: lift `next.children` via liftBareDeclarations(..., "state", ..., true)
  before tagging. Repro now: EXPORT channel child kinds=["logic"], state-decl=true — matches non-export.
- NEXT: emit-channel.ts reparse adaptation (does it still assume raw-text body?).

- 2026-06-19 ~22:05 — emit-channel investigation: NO raw-text reparse in emit-channel to retire/adapt.
  collectors (extractSharedVars/collectChannelFunctionMap/collectChannelCellMap) already walk STRUCTURAL
  nodes (state-decl / function-decl / logic.body). Pre-fix they returned EMPTY for a bare-body export
  channel (no state-decl children); CHX deep-clones the channelDecls node verbatim, so the consumer also
  collapsed. The fix at TAB makes channelDecls structural → clone is structural → consumers emit cells.
  No getCrossFileChannelCellNames / Class-B text-scan exists in current source (already retired; SPEC
  E-STATE-UNDECLARED row confirms "SYM-stage Class-B channel-body scan is RETIRED").
- 2026-06-19 ~22:08 — EMPIRICAL VERIFY: compiled a cross-file BARE-body export-channel project
  (/tmp/xfchan: channels/dispatch.scrml export <channel> w/ bare `<messages> = []`/`<count> = 0` +
  pages/board.scrml mounting <chat/>). `--validate-emit` PASS (no E-CODEGEN-INVALID-JS). board.client.js
  emits BOTH cells reactive-init + the _scrml_ws_chat IIFE w/ __sync dispatch for messages+count +
  syncShared effects. node --check PASS on board.client.js / board.server.js / dispatch.client.js.
- 2026-06-19 ~22:10 — Added 3 regression tests to p3a-tab-channel-export-recognition.test.js locking
  the BARE-body structural parse (existing tests all used explicit `${ @shared ... }` bodies → blind to
  the bug). 9 pass / 0 fail.
- Targeted channel+cross-file surface (13 named files): 137 pass / 15 skip / 0 fail.
