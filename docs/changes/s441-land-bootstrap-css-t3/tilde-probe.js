// tilde-probe.js — s441 evidence that impl#1 now compiles the plain "~" literal in css-ingest's combOf
// (F18, fixed by #1131). Run from the repo root: bun docs/changes/s441-land-bootstrap-css-t3/tilde-probe.js
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileScrml } from "../../../compiler/src/api.js";
import { CSS_MODULES } from "../../../compiler/self-host-v2/slice-m3/css-substitute.js";
import { SELF_HOST_V2 } from "../../../compiler/self-host-v2/slice-m1/harness.js";

const outDir = mkdtempSync(join(tmpdir(), "s441-tilde-"));
const inputFiles = [join(SELF_HOST_V2, "slice-m3", "css-bundle.scrml"), ...CSS_MODULES.map((m) => join(SELF_HOST_V2, m))];
const r = compileScrml({ inputFiles, outputDir: outDir, write: true, log: () => {} });
console.log("errors:", (r.errors ?? []).filter((e) => e && e.code).map((e) => e.code));
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const file = walk(outDir).find((f) => f.endsWith("css-ingest.client.js"));
const src = readFileSync(file, "utf8");
const at = src.search(/function _scrml_combOf_\d+\(/); // impl#1 mangles fn names
console.log(src.slice(at, src.indexOf("\n}", at) + 2));
console.log("any __scrml_tilde__ in css-ingest output:", src.includes("__scrml_tilde__"));
rmSync(outDir, { recursive: true, force: true });
