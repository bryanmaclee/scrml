# progress — s441-failable-arm-binding
- merged worktree-agent-a2a4cf60776b0f7f7 (tip 635f99c6d) into the worktree branch (merge 392fa747f).
- bun install + pretest OK.
- D1 governing-sentence gate: SPEC SILENT on a bare-identifier `!{}` arm (§18.2 arm-pattern has no identifier alternative; §19.4.3 / App. B show only `::Variant` forms). STOPPED per brief; reproduced only (repro/d1-bare-ident-arm.scrml). Probe: binding `err` to the whole envelope makes all 4 09 error paths render.
- D2 reproduced (repro/d2-server-fail-single-field.scrml): server `data: "queue full"` vs client `.data.reason`. Root: setVariantFieldsForFile set on client pass only. Fix: emit-server.ts publishes the registry on the server pass too.
- D3 found: 09 read `result.changes` off `?{}.run()` (void per §8.5.1) -> SubmitFailed never fired. 09 migrated to INSERT ... RETURNING id + `.get()` + `is not`.
- corpus diff base vs fix (examples/ samples/ conformance/cases, 2021 files): only examples/09 changed.
- merged origin/main (1cf7cc93d; FACTS conflict taken from main, regenerated at the end).
- D1 RULED (user-voice-scrml.md S441, verified): `| err :>` binds the error value. Implemented: ast-builder parseErrorTokens flags `identifierArm`; emit-logic binds `R.data == null ? R.variant : { variant, data }`; native parse-error-body.js (+ .scrml mirror) recognizes the arm. `| _ e :>` (explicit wildcard + name) left binding the payload (flogence reads `e.message` through it) — surfaced.
- SPEC: §18.2 note + new §19.4.3.1 (grammar + normative bullets + provenance).
- corpus diff (base2 = post-merge pre-D1): examples/09, 16, 29 + samples/login.scrml (pre-existing compile failure).
- REVIEW ROUND (PA review of af62bce5a): merged origin/main (6ea34b5c6; fail-shorthand SPEC/type-system/test conflicts → main's version).
  F1/F3/F5 fixed at one root (imported enum decls in buildVariantFieldsRegistry, both passes). F4 fixed (data:{} unit normalize).
  F2 → carried-gap note in SPEC §19.4.3.1 + witness on g-bang-brace-arm-bodies-have-no-tree-form + test.failing/sibling.
  F7 SPEC table of arm forms. F6 filed. F8 09 comment + ledger line refreshed. 8 gaps filed under §S441.
- REVIEW ROUND 3 (re-review of c4b0d8db9, DO-NOT-LAND): merged origin/main (57b144549; §19.4.3.1 moved after main's rewritten event-handler text).
  R2-1 fixed (type-directed registry: fail by target enum, !{} arms by typer-annotated errorTypeName or runtime envelope `type`; own enum wins bare-name).
  R2-2: arms + `| err :>` fixed; `match` reader residual NOT fixed (pinned test.failing; gap filed) — a permission denial blocked inspecting the match-reader call sites.
  R2-3 fixed (renamed/`*` re-exports). R2-4 fixed (unit only by declared schema). R2-5 SPEC row limited + ⚑ carried gap + filed.
