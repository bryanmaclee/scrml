// Print the security-await-pack classification table for the compiler in THIS checkout.
//
//   TMPDIR=$HOME/.cache/<scratch> bun compiler/tests/integration/security-await-pack/classify.js [--json] [filter]
//
// Not a test (no `.test.` in the name): it is the instrument for refreshing known-fail.js and
// for grading a branch. `--json` prints { "<family>/<shape>": { cls, detail } } on stdout;
// otherwise one line per shape plus a per-class count. `filter` matches a substring of the id.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFamilies, makeTemplateDb, runShape, CLASSES } from "./pack.js";
import { KNOWN_FAIL } from "./known-fail.js";

const args = process.argv.slice(2);
const json = args.includes("--json");
const filter = args.find((a) => !a.startsWith("--"));

const root = mkdtempSync(join(tmpdir(), "scrml-await-pack-"));
const out = {};
const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]));
const t0 = performance.now();
try {
  const templateDb = makeTemplateDb(root);
  let i = 0;
  for (const { family, shapes, defaultLib } of await loadFamilies()) {
    for (const [name, s] of Object.entries(shapes)) {
      const id = `${family}/${name}`;
      if (filter && !id.includes(filter)) continue;
      const r = await runShape(s, defaultLib, join(root, String(i++)), templateDb);
      out[id] = { cls: r.cls, detail: r.detail };
      counts[r.cls]++;
      if (!json) {
        const known = KNOWN_FAIL[id] ? " [known-fail]" : "";
        console.log(`${r.cls.padEnd(12)} ${id}${known}  ${r.detail}`);
      }
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log("\n" + CLASSES.map((c) => `${c}=${counts[c]}`).join("  ") +
    `  total=${Object.keys(out).length}  ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}
process.exit(0);
