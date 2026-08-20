// Re-verify the arc's FOUR standing guarantees across the build-mode matrix.
//
//   G1  every `new Worker("…")` names a file that EXISTS in the dist
//   G2  every `.worker.js` on disk is REFERENCED by some emitted bundle
//   G3  every client channel dial has a matching server route
//   G4  every `_scrml_worker_X` USED is DECLARED   <- added round 3
//
//   bun docs/changes/nested-program-artifact-emission-2026-08-19/probes/build-matrix.mjs
// (run from the repo root)
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileScrml } from "../../../../compiler/src/api.js";

const ROOT = ".tmp/nested-program-matrix";
rmSync(ROOT, { recursive: true, force: true });

const FIXTURES = {
  // §4.12.4 inline worker under a `<program>` root — the canonical shape.
  "worker-program-root": `<program>
  <program name="doubler">
    \${ when message(data) { send({ result: data.value * 2 }) } }
  </program>
  \${
    <value> = 21
    function run() { <#doubler>.send({ value: @value }) }
  }
  <button onclick=run()>go</button>
</program>
`,
  // The HIGH-1 shape: the same worker under a `<page>` root.
  "worker-page-root": `<page>
  <program name="w">
    \${ when message(data) { send({ v: data.v * 2 }) } }
  </program>
  \${
    <v> = 1
    function go() { <#w>.send({ v: @v }) }
  }
  <button onclick=go()>go</button>
</page>
`,
  // Two workers, so a partial-emission bug cannot hide behind a single ref.
  "worker-two": `<program>
  <program name="alpha">
    \${ when message(data) { send({ v: data.v + 1 }) } }
  </program>
  <program name="beta">
    \${ when message(data) { send({ v: data.v - 1 }) } }
  </program>
  \${
    <v> = 1
    function go() { <#alpha>.send({ v: @v }) }
    function go2() { <#beta>.send({ v: @v }) }
  }
  <button onclick=go()>a</button>
  <button onclick=go2()>b</button>
</program>
`,
  // A channel under the root — G3's subject.
  "channel-root": `<program db="sqlite://./app.db">
  <channel name="feed"/>
  \${ <v> = 1 }
  <button>go</button>
</program>
`,
  // A channel inside a §4.12.6 scoped-DB context — legal, must keep BOTH halves.
  "channel-scoped-db": `<program db="sqlite://./app.db">
  <program name="analytics" db="sqlite://./metrics.db">
    <channel name="metrics_feed"/>
  </program>
  \${ <v> = 1 }
  <button>go</button>
</program>
`,
};

const MODES = {
  flat: {},
  "content-hash": { contentHashAssets: true },
  "emit-per-route": { emitPerRoute: true },
  "hash+per-route": { contentHashAssets: true, emitPerRoute: true },
};

/** Recursively list every file under `dir`, as paths relative to `dir`. */
function walkFiles(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

const rows = [];

for (const [fixName, src] of Object.entries(FIXTURES)) {
  for (const [modeName, opts] of Object.entries(MODES)) {
    // "nested-dir" is exercised by putting the source under pages/ for one mode.
    for (const nested of [false, true]) {
      const dir = join(ROOT, `${fixName}__${modeName}__${nested ? "nested" : "flat"}`);
      const srcDir = nested ? join(dir, "pages") : dir;
      mkdirSync(srcDir, { recursive: true });
      const file = join(srcDir, "app.scrml");
      writeFileSync(file, src);
      const outDir = join(dir, "dist");

      let result;
      try {
        result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {}, ...opts });
      } catch (err) {
        rows.push({ fix: fixName, mode: modeName, nested, fatal: `${err.name}: ${err.message}` });
        continue;
      }

      const files = walkFiles(outDir);
      const jsFiles = files.filter((f) => f.endsWith(".js"));
      // NOTE: under `contentHashAssets` the bundle is `<base>.<name>.worker.<hash>.js`,
      // so a bare `.endsWith(".worker.js")` finds ZERO and every worker assertion
      // passes vacuously. Match the hashed form too.
      const IS_WORKER = /\.worker(\.[a-z0-9]+)?\.js$/;
      const workerFiles = files.filter((f) => IS_WORKER.test(f));
      const clientBundles = jsFiles.filter((f) => !IS_WORKER.test(f) && !f.includes("scrml-runtime"));

      const allJs = jsFiles.map((f) => readFileSync(join(outDir, f), "utf8")).join("\n");

      // G1 — every `new Worker("spec")` resolves to a file on disk.
      const specs = [...allJs.matchAll(/new Worker\("([^"]+)"\)/g)].map((m) => m[1]);
      const g1 = specs.filter((s) => !files.some((f) => f === s || f.endsWith("/" + s)));

      // G2 — every `.worker.js` on disk is named by some specifier.
      const g2 = workerFiles.filter((w) => {
        const base = w.split("/").pop();
        return !specs.some((s) => s === w || s.endsWith(base));
      });

      // G3 — every client dial has a server route.
      const dials = [...new Set([...allJs.matchAll(/_scrml_ws\/([a-z0-9_]+)/gi)].map((m) => m[1]))];
      const routes = [...new Set([...allJs.matchAll(/_scrml_route_ws_([a-z0-9_]+)/gi)].map((m) => m[1]))];
      const g3 = dials.filter((d) => !routes.includes(d));

      // G4 — every worker binding USED is DECLARED. Checked per BUNDLE, because
      // a declaration in one chunk does not scope into another.
      const g4 = [];
      for (const f of clientBundles) {
        const js = readFileSync(join(outDir, f), "utf8");
        const declared = new Set(
          [...js.matchAll(/(?:const|let|var)\s+(_scrml_worker_[A-Za-z0-9_$]+)\s*=/g)].map((m) => m[1]),
        );
        for (const u of new Set([...js.matchAll(/(_scrml_worker_[A-Za-z0-9_$]+)/g)].map((m) => m[1]))) {
          if (!declared.has(u)) g4.push(`${f}:${u}`);
        }
      }

      const hardErrors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
      rows.push({
        fix: fixName, mode: modeName, nested,
        errors: hardErrors.map((e) => e.code),
        workers: workerFiles.length,
        refs: specs.length,
        dials: dials.length,
        routes: routes.length,
        G1: g1, G2: g2, G3: g3, G4: g4,
      });
    }
  }
}

const bad = rows.filter((r) => r.fatal || (r.G1?.length || r.G2?.length || r.G3?.length || r.G4?.length));

console.log("fixture                 mode            dir     err  wkr ref dial rte  G1 G2 G3 G4");
for (const r of rows) {
  if (r.fatal) { console.log(`${r.fix.padEnd(23)} ${r.mode.padEnd(15)} ${(r.nested ? "nested" : "flat").padEnd(7)} FATAL ${r.fatal}`); continue; }
  const v = (a) => (a.length ? "!!" : "ok");
  console.log(
    `${r.fix.padEnd(23)} ${r.mode.padEnd(15)} ${(r.nested ? "nested" : "flat").padEnd(7)} ` +
    `${String(r.errors.length).padEnd(4)} ${String(r.workers).padEnd(3)} ${String(r.refs).padEnd(3)} ` +
    `${String(r.dials).padEnd(4)} ${String(r.routes).padEnd(3)}  ${v(r.G1)} ${v(r.G2)} ${v(r.G3)} ${v(r.G4)}`,
  );
}

console.log(`\n${rows.length} builds. VIOLATIONS: ${bad.length}`);
for (const r of bad) console.log("  ", JSON.stringify(r));
process.exit(bad.length ? 1 : 0);
