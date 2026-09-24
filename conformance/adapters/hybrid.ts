/**
 * Conformance adapter — HYBRID variant (s430-stage-swap, bryan S430 P5).
 *
 * impl#1 (`impl1-ts.ts`) with one or more pipeline stages substituted through the stage seam
 * (`compiler/src/pipeline-seam.ts`). It is not a second adapter implementation: it re-exports
 * impl#1's `compile` / `run` / `runServer` / `runTool` unchanged and sets impl#1's compile-options
 * overlay to `{ stageOverrides }`, so every compile the suite makes — codes half, runtime half,
 * server half, tool half — goes through the hybrid pipeline. The runner (`conformance/run.ts`)
 * is reused as-is.
 *
 * P5: a bootstrap module is DONE when the hybrid with that one stage swapped passes the FULL
 * conformance suite. Driver: `bun scripts/hybrid.ts --swap <STAGE>=<module> --conformance`.
 *
 * Because the overlay is module state in impl#1, installing a hybrid affects every importer of
 * impl#1 in the same process. `uninstallHybrid()` restores pure impl#1.
 */
import { setCompileOverlay } from "./impl1-ts.ts";

export { compile, run, runServer, runTool } from "./impl1-ts.ts";

export function installHybrid(stageOverrides: Record<string, unknown>): void {
  setCompileOverlay({ stageOverrides });
}

export function uninstallHybrid(): void {
  setCompileOverlay(null);
}
