# progress — s441-failable-arm-binding
- merged worktree-agent-a2a4cf60776b0f7f7 (tip 635f99c6d) into the worktree branch (merge 392fa747f).
- bun install + pretest OK.
- D1 governing-sentence gate: SPEC SILENT on a bare-identifier `!{}` arm (§18.2 arm-pattern has no identifier alternative; §19.4.3 / App. B show only `::Variant` forms). STOPPED per brief; reproduced only (repro/d1-bare-ident-arm.scrml). Probe: binding `err` to the whole envelope makes all 4 09 error paths render.
- D2 reproduced (repro/d2-server-fail-single-field.scrml): server `data: "queue full"` vs client `.data.reason`. Root: setVariantFieldsForFile set on client pass only. Fix: emit-server.ts publishes the registry on the server pass too.
- D3 found: 09 read `result.changes` off `?{}.run()` (void per §8.5.1) -> SubmitFailed never fired. 09 migrated to INSERT ... RETURNING id + `.get()` + `is not`.
- corpus diff base vs fix (examples/ samples/ conformance/cases, 2021 files): only examples/09 changed.
