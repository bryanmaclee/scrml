# U1 dispatch brief (archived verbatim, S278) — ESM chunks: runtime → module behind --module-format flag

Agent: scrml-js-codegen-engineer · opus · isolation:worktree · run_in_background · dispatched S278 on HEAD 825eec5f.
Arc scoping: docs/changes/esm-chunks/BRIEF.md. This is the verbatim instruction record (the agent's progress.md captures the WORK).

SCOPE: introduce `--module-format=classic|esm` (default classic, byte-identical to today); under esm emit
runtime-template.js as a valid ES module exporting every symbol chunks reference, deriving the export set from
the FINAL (post-slice) top-level declarations; rework R1 (meta-block `^{}` dep-tracking monkey-patches
globalThis._scrml_reactive_get — under ESM the bare fn binding L794 diverges from the globalThis property, so
route the exported get through a mutable globalThis override slot / readGet indirection; blast radius = only
`^{}` tracking). OUT OF SCOPE: chunk emit (U2), script tags (U3), loader (U4), harness (U5), default-flip (U6).
Loci: compile.js flag plumbing (~L294 options); runtime-template.js _scrml_reactive_get ~L794, _scrml_modules
redeclare-guard ~L2872, perf hooks ~L608-611 (leave), 3 typeof-guards (removable), meta-block ~L2926-3045 (R1);
runtime-chunks.ts slicing interaction. ACCEPTANCE: classic byte-identical (diff proof); esm runtime imports as
a module without throwing (bun native ESM import); DOM-free functional R1 test (reactive roundtrip + subscribe +
meta-track interception); full pre-commit gate 0 fail. F4 + MAPS(9481bc69→825eec5f, wrap-only delta) + refusal-
welcome + crash-recovery(progress.md, WIP commits) all briefed. PA runs S239 + R26(real-Chromium execution) at land.
