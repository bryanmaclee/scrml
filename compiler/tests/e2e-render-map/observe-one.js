/**
 * observe-one.js — observe ONE corpus cell in an isolated subprocess.
 *
 * Invoked by generate-baseline.js as `bun observe-one.js <relpath> <seedLabel>`.
 * Runs the harness for a single (app, seed) cell, prints the recorded cell as
 * one JSON line to stdout, and exits 0. Subprocess isolation is load-bearing:
 *   - one hanging app's mount (some meta-heavy corpus apps loop or stall in
 *     happy-dom — e.g. samples/gauntlet-r18/rails-dev.scrml) cannot stall the
 *     whole map; the parent kills the subprocess on timeout and records a
 *     HARNESS-TIMEOUT cell (classified, NEVER hidden — DD §"DO NOT SUPPRESS").
 *   - happy-dom global state never bleeds between apps.
 *
 * seedLabel "empty" -> no seed. Any other label -> the parent passes a seed via
 * the SCRML_E2E_SEED env var (JSON), e.g. for class-2/3a populated cells.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { enumerateRenderCorpus } from "./render-corpus-enumerator.js";
import { observeApp } from "./render-harness.js";
import { seedFor } from "./seed-fixtures.js";

const relpath = process.argv[2];
const seedLabel = process.argv[3] ?? "empty";

const app = enumerateRenderCorpus().find((a) => a.relpath === relpath);
if (!app) {
  process.stdout.write(
    JSON.stringify({
      cellKey: `${relpath}#${seedLabel}`,
      state: "HARNESS-ERROR",
      smells: ["APP-NOT-IN-CORPUS"],
      detail: { relpath },
      seeded: seedLabel !== "empty",
    }) + "\n",
  );
  process.exit(0);
}

let seed = null;
if (seedLabel === "populated") {
  seed = seedFor(relpath);
}

GlobalRegistrator.register();
let cell;
try {
  cell = observeApp(app, seed, seedLabel);
} catch (e) {
  cell = {
    cellKey: `${relpath}#${seedLabel}`,
    state: "HARNESS-ERROR",
    smells: [String(e && e.message ? e.message : e).slice(0, 120)],
    detail: {},
    seeded: seed != null,
  };
}
try {
  await GlobalRegistrator.unregister();
} catch (_e) {
  /* noop */
}

process.stdout.write(JSON.stringify(cell) + "\n");
process.exit(0);
