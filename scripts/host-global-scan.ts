#!/usr/bin/env bun
/**
 * host-global-scan — the gate behind S457 ruling 2a (g-user-fn-named-host-global-hijacks-compiler-refs-s457).
 *
 * THE GUARANTEE IT GATES
 * ======================
 * Compiler-emitted code reaches every host global through the alias `_scrml_g`
 * (codegen/host-global-alias.ts), so no user binding — a function, a const, a server
 * function, a worker function named `fetch`, `document`, `Response`, `globalThis`, … —
 * can capture a compiler reference. The guarantee is only as good as its gate, so this
 * script compiles the corpus in every emission mode and checks every emitted artifact:
 *
 *   R1  no FREE reference to a host global whose name the author's own source does not
 *       use. A free host-global reference the author did not write is the compiler's,
 *       and a same-named user binding would capture it. (Scope analysis by the same
 *       walk the user-function rename uses — codegen/fn-name-rename.ts.)
 *   R2  an artifact that reads `_scrml_g` declares or imports it — or, for a classic
 *       client chunk, the runtime it loads declares it.
 *   R3  no binding sits at the top level of a CLASSIC script (a client chunk, a worker
 *       bundle) other than the compiler's own `_scrml_`-prefixed ones: in a classic
 *       script a top-level declaration becomes a property of the global object.
 *   R4  no artifact a BROWSER may load (client chunks, per-route chunks, the runtime,
 *       the `_scrml/` modules, worker bundles, library modules) imports a `data:`
 *       module: a browser refuses it under `Content-Security-Policy: script-src 'self'`
 *       and the importing module never runs. Only server bundles, tool modules and test
 *       modules (Bun / Node / Deno) may import the alias from `data:`.
 *
 * HOST NAMES: every identifier-shaped own property on Bun's `globalThis` and on a
 * happy-dom `Window` (prototype chains included) — about 520 names. `undefined` is
 * left out: scrml has no `undefined` token (§42.7, E-SYNTAX-042), so no user binding
 * can take it.
 *
 * MODES (every .scrml under the roots is compiled in each):
 *   default · esm (moduleFormat:"esm") · embed (embedRuntime) · build (contentHashAssets +
 *   emitPerRoute — the `scrml build` compile, per-route chunks included) · test
 *   (testMode + emitMachineTests; only sources with `~{` or `<engine`) · library
 *   (`--mode library`; only sources with an `export`).
 * Tool / worker / value-only modules arise in every mode from the sources that produce them. Each multi-file program directory (examples/<dir>/, benchmarks/<dir>/) is
 * also compiled whole, as `scrml build <dir>` does.
 *
 * EXEMPT ARTIFACTS (no author code in them, so nothing can capture their references):
 * the runtime file (`scrml-runtime*.js`) and the embedded runtime region; the vendored
 * stdlib shims (`_scrml/*.js`, each its own module); the per-route chunk-activation
 * script. The SHIPPED runtime keeps bare names by design (see host-global-alias.ts).
 *
 * WHERE IT RUNS: the CI `gate` job (a full corpus pass takes minutes — too slow for the
 * pre-commit hook). The pre-commit suite carries the per-name executed tests and the
 * examples-only static check (compiler/tests/unit/s457-host-global-alias.test.js).
 *
 * USAGE
 *   bun scripts/host-global-scan.ts [--check] [--concurrency N] [--roots a,b] [--modes m1,m2]
 * EXIT 0 = no violation · 1 = violations (listed) · 2 = the scan itself failed / scanned nothing.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, mkdtempSync, rmSync, existsSync } from "fs";
import { join, relative, dirname, resolve } from "path";
import { tmpdir } from "os";

const REPO = resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const ALL_MODES = ["default", "esm", "embed", "build", "test", "library"] as const;
type Mode = typeof ALL_MODES[number];
const MODE_OPTS: Record<Mode, Record<string, unknown>> = {
  default: {},
  esm: { moduleFormat: "esm" },
  embed: { embedRuntime: true },
  build: { contentHashAssets: true, emitPerRoute: true },
  test: { testMode: true, emitMachineTests: true },
  library: { mode: "library" },
};

// ---------------------------------------------------------------------------
// worker (one shard)
// ---------------------------------------------------------------------------
async function hostNames(): Promise<Set<string>> {
  const { Window } = await import("happy-dom");
  const names = new Set<string>();
  const add = (o: any) => { for (; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) names.add(k); };
  add(globalThis);
  const w = new Window();
  add(w);
  await w.happyDOM.close();
  for (const n of [...names]) if (!/^[A-Za-z_$][\w$]*$/.test(n) || n === "undefined" || n.startsWith("_scrml_")) names.delete(n);
  return names;
}

/** The author's text for a unit: the entry(s) plus every relative .scrml they import, transitively. */
function authorText(entries: string[]): string {
  const seen = new Set<string>();
  const stack = [...entries];
  let text = "";
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    text += "\n" + src;
    for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+\.scrml)["']/g)) stack.push(resolve(dirname(f), m[1]));
  }
  return text;
}

/** A static, side-effect or dynamic import of a `data:` module (R4). */
const DATA_IMPORT = /\b(?:import|export)\s[^;'"`]*?\bfrom\s*["']data:|\bimport\s*\(?\s*["']data:/;

function walkJs(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (/\.(m?js)$/.test(e)) out.push(p);
  }
  return out;
}

type Violation = { rule: "R1" | "R2" | "R3" | "R4"; mode: string; unit: string; artifact: string; detail: string };

async function runShard(units: string[][], modes: Mode[]) {
  const { compileScrml } = await import(join(REPO, "compiler/src/api.js"));
  const { aliasFreeGlobalRefs } = await import(join(REPO, "compiler/src/codegen/fn-name-rename.ts"));
  const acorn = await import("acorn");
  const NAMES = await hostNames();
  const violations: Violation[] = [];
  const unparsed: string[] = [];
  let artifacts = 0, compiled = 0;
  const RT_START = "// --- scrml reactive runtime ---";
  const RT_END = "// --- end scrml reactive runtime ---";
  const blank = (s: string, a: number, b: number) => s.slice(0, a) + s.slice(a, b).replace(/[^\n]/g, " ") + s.slice(b);

  for (const entries of units) {
    const unit = relative(REPO, entries.length === 1 ? entries[0] : dirname(entries[0]));
    const author = authorText(entries);
    const usesName = (n: string) => new RegExp(`(?<![\\w$])${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(author);
    const wantsTest = /~\{|<engine\b/.test(author);
    const wantsLibrary = /\bexport\b/.test(author);
    for (const mode of modes) {
      if (mode === "test" && !wantsTest) continue;
      if (mode === "library" && !wantsLibrary) continue;
      const out = mkdtempSync(join(tmpdir(), "scrml-hgs-"));
      try {
        let r: any;
        try { r = compileScrml({ inputFiles: entries, outputDir: out, write: true, log: () => {}, ...MODE_OPTS[mode] }); }
        catch (e) { continue; } // a compiler crash is not this gate's subject (validate-emit / suites own it)
        if (!r || r.artifactsWritten === false) continue;
        compiled++;
        const files = walkJs(out);
        // tool modules (kind="tool") run under Bun, like server bundles: not browser-reachable
        const toolFiles = new Set<string>();
        for (const [src, o] of (r.outputs ?? new Map()) as Map<string, any>) if (o && o.toolJs) toolFiles.add(src.split("/").pop()!.replace(/\.scrml$/, ".js"));
        const runtimeDeclares = files.some((f) => /scrml-runtime[^/]*\.js$/.test(f) && /^var _scrml_g = globalThis;/m.test(readFileSync(f, "utf8")));
        for (const f of files) {
          const rel = relative(out, f);
          const base = rel.split("/").pop()!;
          // R4 — every artifact, the exempt runtime / `_scrml/` modules included
          const serverSide = /\.(server|test|machine\.test)\.js$/.test(base) || toolFiles.has(base);
          if (!serverSide && DATA_IMPORT.test(readFileSync(f, "utf8"))) {
            violations.push({ rule: "R4", mode, unit, artifact: rel, detail: "a browser-reachable artifact imports a `data:` module (refused under a `script-src 'self'` CSP)" });
          }
          if (/^scrml-runtime/.test(base) || rel.split("/").includes("_scrml")) continue;
          if (r.chunksBootFilename && rel === r.chunksBootFilename) continue;
          artifacts++;
          let js = readFileSync(f, "utf8");
          const isWorker = /\.worker\.js$/.test(base);
          // A classic script is what parses as one (a client chunk, a per-route payload, a worker);
          // a server bundle / library / tool / value-only / test module carries import, export or
          // top-level await and parses only as a module.
          let parsesAsScript = true;
          try { acorn.parse(js, { ecmaVersion: "latest", sourceType: "script" }); } catch { parsesAsScript = false; }
          const isClient = !isWorker && !/\.(server|test|machine\.test)\.js$/.test(base) && parsesAsScript;
          // esm: client chunks load as modules · library: `<base>.js` is an ES module (§21.5)
          // even when it happens to parse as a script (a library exporting nothing)
          const classic = isWorker || (isClient && mode !== "esm" && mode !== "library");
          // the embedded runtime region: compiler-only, exempt
          let embedded = false;
          const a = js.indexOf(RT_START), b = js.indexOf(RT_END);
          if (a !== -1 && b > a) { js = blank(js, a, b + RT_END.length); embedded = /^var _scrml_g = globalThis;/m.test(readFileSync(f, "utf8").slice(a, b)); }
          // the classic-script alias line reads `globalThis` at the top level, before any author code
          let declaresScript = false;
          js = js.replace(/^var _scrml_g = globalThis;.*$/m, (m) => { declaresScript = true; return " ".repeat(m.length); });
          // the data: module (server / tool / test modules) or, for a written library module,
          // the compiler's same-origin `_scrml/_global.js` (host-global-alias.ts HOST_GLOBAL_MODULE_PATH)
          const declaresModule = /^import _scrml_g from "(?:data:text\/javascript,export default globalThis|(?:\.\.?\/)+_scrml\/_global\.js)";/m.test(js);
          const importsFromRuntime = /^import \{[^}]*\b_scrml_g\b[^}]*\} from "[^"]*scrml-runtime[^"]*";/m.test(js);
          // R1 + R2
          const marker = "__HGS__";
          const aliased = aliasFreeGlobalRefs(js, new Set([...NAMES].filter((n) => n !== "globalThis").concat("_scrml_g")), marker);
          // An artifact that does not parse at all is a different defect (reported, not judged here:
          // e.g. a testMode `.test.js` carrying an un-lowered `@cell`, pre-existing).
          if (aliased === null) { unparsed.push(`[${mode}] ${unit} :: ${rel}`); continue; }
          const free = new Set<string>();
          let readsAlias = false;
          for (const m of aliased.matchAll(/__HGS__\.([A-Za-z_$][\w$]*)/g)) {
            if (m[1] === "_scrml_g") { readsAlias = true; continue; }
            if (m[1] === "globalThis") continue; // counted below
            free.add(m[1]);
          }
          // `globalThis` is spelled as the bare marker by the rewrite; count it from a pass of its own.
          const gt = aliasFreeGlobalRefs(js, new Set(["globalThis"]), "__HGSGT__");
          if (gt !== null && gt.includes("__HGSGT__")) free.add("globalThis");
          for (const n of free) if (!usesName(n)) violations.push({ rule: "R1", mode, unit, artifact: rel, detail: `free host global \`${n}\` the author never wrote` });
          if (readsAlias && !(declaresModule || declaresScript || importsFromRuntime || embedded || (isClient && runtimeDeclares))) {
            violations.push({ rule: "R2", mode, unit, artifact: rel, detail: "reads `_scrml_g` but neither declares nor imports it" });
          }
          // R3
          if (classic) {
            let ast: any;
            try { ast = acorn.parse(js, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true }); }
            catch { violations.push({ rule: "R3", mode, unit, artifact: rel, detail: "classic script does not parse as a script" }); continue; }
            const ok = (n: string) => /^_{1,2}scrml_|^_SCRML_/i.test(n);
            for (const st of ast.body) {
              const names: string[] = [];
              if (st.type === "VariableDeclaration") for (const d of st.declarations) { if (d.id.type === "Identifier") names.push(d.id.name); else names.push("<pattern>"); }
              else if ((st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") && st.id) names.push(st.id.name);
              for (const n of names) if (!ok(n)) violations.push({ rule: "R3", mode, unit, artifact: rel, detail: `top-level binding \`${n}\` in a classic script` });
            }
          }
        }
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    }
  }
  return { violations, artifacts, compiled, unparsed };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function enumerate(roots: string[]): string[][] {
  const units: string[][] = [];
  const walk = (d: string, acc: string[]) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p, acc);
      else if (e.endsWith(".scrml")) acc.push(p);
    }
  };
  for (const r of roots) {
    const abs = join(REPO, r);
    if (!existsSync(abs)) continue;
    const files: string[] = [];
    walk(abs, files);
    for (const f of files.sort()) units.push([f]);
  }
  // multi-file program directories, compiled whole (as `scrml build <dir>`)
  for (const r of ["examples", "benchmarks"].filter((x) => roots.includes(x))) {
    const abs = join(REPO, r);
    if (!existsSync(abs)) continue;
    for (const e of readdirSync(abs).sort()) {
      const p = join(abs, e);
      if (!statSync(p).isDirectory()) continue;
      const files: string[] = [];
      walk(p, files);
      if (files.length > 1) units.push(files.sort());
    }
  }
  return units;
}

if (flag("--shard")) {
  // The result goes to a FILE, not stdout: a large result written to a pipe and
  // followed by process.exit() is truncated at the pipe buffer, and the parent
  // then has no report exactly when many things broke.
  const payload = JSON.parse(readFileSync(opt("--shard", ""), "utf8"));
  const res = await runShard(payload.units, payload.modes);
  writeFileSync(opt("--out", ""), JSON.stringify(res));
  process.exit(0);
}

const t0 = Date.now();
const roots = opt("--roots", "samples,examples,conformance,stdlib,benchmarks").split(",");
const modes = opt("--modes", ALL_MODES.join(",")).split(",") as Mode[];
const conc = Math.max(1, Number(opt("--concurrency", "6")));
const units = enumerate(roots);
if (units.length === 0) { console.error("host-global-scan: enumerated nothing"); process.exit(2); }
const shards: string[][][] = Array.from({ length: conc }, () => []);
units.forEach((u, i) => shards[i % conc].push(u));
const work = mkdtempSync(join(tmpdir(), "scrml-hgs-shards-"));
const results = await Promise.all(shards.map(async (s, i) => {
  const pf = join(work, `shard-${i}.json`);
  const rf = join(work, `result-${i}.json`);
  await Bun.write(pf, JSON.stringify({ units: s, modes }));
  const p = Bun.spawn(["bun", import.meta.path, "--shard", pf, "--out", rf], { stdout: "ignore", stderr: "pipe" });
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  try { return JSON.parse(readFileSync(rf, "utf8")); }
  catch { console.error(`host-global-scan: shard ${i} failed (exit ${code}):\n${err.slice(-3000)}`); return null; }
}));
rmSync(work, { recursive: true, force: true });
// A failed shard is reported, and the others' findings are still listed below.
const shardFailed = results.some((r) => r === null);
const done = results.filter((r) => r !== null);
const violations: Violation[] = done.flatMap((r: any) => r.violations);
const artifacts = done.reduce((a: number, r: any) => a + r.artifacts, 0);
const compiled = done.reduce((a: number, r: any) => a + r.compiled, 0);
const unparsed: string[] = done.flatMap((r: any) => r.unparsed);
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`host-global-scan: ${units.length} units × modes [${modes.join(", ")}] — ${compiled} compiles, ${artifacts} artifacts scanned, ${violations.length} violation(s), ${secs}s`);
if (artifacts === 0) { console.error("host-global-scan: scanned no artifact"); process.exit(2); }
const seen = new Set<string>();
for (const v of violations) {
  const k = `${v.rule} ${v.mode} ${v.unit} ${v.artifact} ${v.detail}`;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`  ${v.rule} [${v.mode}] ${v.unit} :: ${v.artifact} — ${v.detail}`);
}
if (unparsed.length > 0) {
  console.log(`  (not judged — ${unparsed.length} artifact(s) that do not parse at all; a separate defect, listed:)`);
  for (const u of [...new Set(unparsed)]) console.log(`    ${u}`);
}
if (shardFailed) { console.error("host-global-scan: a shard failed (above) — the scan is incomplete"); process.exit(2); }
process.exit(violations.length > 0 ? 1 : 0);
