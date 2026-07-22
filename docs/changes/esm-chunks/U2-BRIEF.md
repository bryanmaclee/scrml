# U2 dispatch brief (archived verbatim, S278) — ESM chunks: client chunk import/export emit

Agent: scrml-js-codegen-engineer · opus · isolation:worktree · run_in_background · dispatched S278 on HEAD 970d3e1f (after U1 #132 landed).
Arc: docs/changes/esm-chunks/BRIEF.md. Verbatim instruction record (agent's progress.md captures the WORK).

SCOPE (under --module-format=esm only; classic byte-identical): emit each client chunk (.client.js) as an ES module —
(1) registration footer `_scrml_modules[key]={publicName:emitted,...}` → `export {emitted as publicName,...}`;
(2) import header `const {x}=_scrml_modules[key]` → `import {x} from "<relative dep.client.js url>"` (reuse the
existing <script src> upToRoot/dist-relative resolver); (3) add `import {<runtime import surface>} from "<relative
scrml-runtime.<hash>.js>"` for runtime symbols the chunk references (intersect against U1's deriveTopLevelExportNames
export set); (4) enum reps stay top-level const — module-local under esm, so g-nav-chunk-lexical-collision dissolves.
Loci (verify): emit-client.ts registry footer ~L205, importer ~L1487/1495-1512, enum-rep emitters emitEnumLookupTables
~L1515 / emitEnumVariantObjects ~L1524. OUT OF SCOPE: type=module script tags (U3), import() loader (U4), harness (U5),
default-flip (U6). ACCEPTANCE: classic byte-identical (diff proof); esm chunks are valid ES modules (no _scrml_modules,
import/export, parse as module); module linkage EXECUTES in real Chromium (runtime+cross-chunk imports resolve +
reactivity works — the emitted≠runs proof); collision dissolved (shell+route same-type coexist under esm, no SyntaxError);
full gate 0 fail. F4 + MAPS(9481bc69→970d3e1f, U1-since) + refusal-welcome + crash-recovery(progress.md). PA runs S239 +
R26(real-Chromium) at land. Do NOT touch BRIEF.md/U1-BRIEF.md.
