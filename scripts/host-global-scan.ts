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
 *   R1  no FREE reference to a host global whose name the author's own CODE does not
 *       use. A free host-global reference the author did not write is the compiler's,
 *       and a same-named user binding would capture it. (Scope analysis by the same
 *       walk the user-function rename uses — codegen/fn-name-rename.ts.) "The author's
 *       code" is read by the compiler's own block splitter + tokenizer (authorCodeNames):
 *       a name in a comment, a string literal, markup text or a plain attribute value
 *       does not count. Residual: markup lifted INSIDE a logic body is tokenized as
 *       logic, so its text words count as code (under-reports only there).
 *   A compile that THROWS leaves its unit unchecked: listed, and any `[mode] <unit>` that
 *   throws but is not pinned in KNOWN_THROWS (host-global-scan.known-throws.txt) makes the
 *   scan incomplete (exit 2). Pinned by NAME, not a count: a count lets a new thrower hide
 *   behind a known one getting fixed.
 *   Debug: `--author-names <file.scrml>` prints the identifiers R1 counts for one file.
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
 *   bun scripts/host-global-scan.ts [--check] [--prune] [--concurrency N] [--roots a,b] [--modes m1,m2]
 *   --prune  rewrite the known-throws file without the in-scope entries that no longer throw
 *            (the list may only shrink by tooling; adding a key is a deliberate hand edit).
 * EXIT 0 = no violation · 1 = violations (listed) · 2 = the scan itself failed / scanned nothing / a compile threw that is not in KNOWN_THROWS.
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

/** The source files of a unit: the entry(s) plus every relative .scrml they import, transitively. */
function authorFiles(entries: string[]): { file: string; src: string }[] {
  const seen = new Set<string>();
  const stack = [...entries];
  const out: { file: string; src: string }[] = [];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    out.push({ file: f, src });
    for (const m of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+\.scrml)["']/g)) stack.push(resolve(dirname(f), m[1]));
  }
  return out;
}

/** Bodies whose bare text is code (§40.8 default-logic bodies; ast-builder.js isProgramRoot / isPageRoot / isChannelRoot). */
const CODE_DEFAULT_TAGS = new Set(["program", "page", "channel"]);
/** A bare declaration the AST builder lifts out of any body — ast-builder.js BARE_DECL_RE, per line. */
const BARE_DECL_LINE = /^\s*(?:export\s+)?(server\s+(?:fn|function)[*\s]|type\s+\w|fn[*\s]\w?|function[*\s]\w?|let\s+[A-Za-z_]|const\s+[A-Za-z_]|import\s+[{a-zA-Z_*"'])/m;

/**
 * The identifiers the author wrote AS CODE in one source file — read by the compiler's own
 * front end (block-splitter.js `splitBlocks` + tokenizer.ts `tokenizeBlock`), so a name that
 * appears only in a comment, a string literal, markup text, or a plain attribute value is NOT
 * counted (R1 judged "the author wrote `document`" from raw text before: a `document` in a
 * paragraph or a comment exempted every compiler `document` reference in that unit).
 *
 *   - logic / meta / test / error-effect bodies: IDENT tokens; a template literal's `${…}`
 *     interpolations and every BLOCK_REF (nested logic, `?{}` slots, `^{}`) are read the same way;
 *     a plain string literal's text is data.
 *   - markup / state tags: the expression an attribute value carries (`{…}`, `${…}`, `(…)`,
 *     a bare identifier, a call's name and arguments, the `${…}` inside a quoted value); the
 *     tag's children are read as blocks. Markup text and comments are not code.
 *   - `?{}` / `#{}`: only their `${…}` interpolation blocks.
 *   - a foreign-code block (`_={ … }=`): its identifier-shaped words — the author's code in
 *     another language, emitted as written.
 *
 * Returns `null` when the front end refuses the file (the caller reports it and falls back).
 */
function authorCodeNames(file: string, src: string, fe: { splitBlocks: any; tokenizeBlock: any; tokenizeLogic: any }): Set<string> | null {
  const names = new Set<string>();
  const IDENT_RE = /[A-Za-z_$][\w$]*/g;
  const addLogicText = (text: string) => {
    let toks: any[];
    try { toks = fe.tokenizeLogic(text, 0, 1, 1, []); }
    catch { for (const m of text.matchAll(IDENT_RE)) names.add(m[0]); return; } // unreadable expression text: count every word (never under-counts code)
    readTokens(toks, []);
  };
  /** The `${…}` interiors of a quoted attribute value / template text (balanced braces). */
  const interpolations = (text: string): string[] => {
    const out: string[] = [];
    for (let i = text.indexOf("${"); i !== -1; i = text.indexOf("${", i + 2)) {
      let depth = 1, j = i + 2;
      for (; j < text.length && depth > 0; j++) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; }
      out.push(text.slice(i + 2, j - 1));
    }
    return out;
  };
  const readTokens = (toks: any[], children: any[]): void => {
    for (const t of toks) {
      switch (t.kind) {
        case "IDENT": names.add(t.text); break;
        case "STRING":
          if (t.isTemplate) {
            // A template literal's interpolations are code: read the child blocks inside its span
            // (the splitter's view), or its `${…}` text when no child block is there.
            const inside = children.filter((c: any) => c.span && t.span && c.span.start >= t.span.start && c.span.end <= t.span.end);
            if (inside.length > 0) for (const c of inside) readBlock(c, false);
            else for (const e of interpolations(t.text)) addLogicText(e);
          }
          break;
        case "BLOCK_REF": if (t.block) readBlock(t.block, false); break;
        case "ATTR_BLOCK": case "ATTR_EXPR": case "ATTR_IDENT": addLogicText(t.text); break;
        case "ATTR_CALL": {
          try { const c = JSON.parse(t.text); addLogicText(String(c.name)); addLogicText(String(c.args ?? "")); }
          catch { addLogicText(t.text); }
          break;
        }
        case "ATTR_TYPED_DECL": {
          try { const c = JSON.parse(t.text); addLogicText(String(c.typeExpr ?? "")); } catch { addLogicText(t.text); }
          break;
        }
        case "ATTR_STRING": for (const e of interpolations(t.text)) addLogicText(e); break;
        default: break; // keywords, punctuation, numbers, comments, markup text, SQL / CSS text
      }
    }
  };
  const readBlock = (b: any, codeBody: boolean) => {
    if (!b || b.type === "comment") return;
    if (b.type === "text") {
      // Bare text is CODE in a code-default body — the file root and the direct children of
      // `<program>` / `<page>` / `<channel>` (§40.8; ast-builder.js liftBareDeclarations), where a
      // display string is a `"…"` literal (a STRING token, not counted) — and a bare declaration
      // lifted out of any other body (ast-builder.js BARE_DECL_RE). Elsewhere it is markup text.
      if (codeBody || BARE_DECL_LINE.test(String(b.raw))) addLogicText(String(b.raw));
      return;
    }
    if (b.type === "foreign") { for (const m of String(b.raw).matchAll(IDENT_RE)) names.add(m[0]); return; }
    const toks: any[] = fe.tokenizeBlock(b, file);
    const kids: any[] = b.children ?? [];
    readTokens(toks, kids);
    // A tag's children, and the `${…}` blocks of `?{}` / `#{}`, are blocks of their own. A logic
    // body's children are reached through its tokens (BLOCK_REF, template literals) only — its
    // child `text` blocks repeat the body's raw text, strings and comments included.
    if (b.type === "markup" || b.type === "state" || b.type === "sql" || b.type === "css") {
      const kidsAreCode = (b.type === "markup" || b.type === "state") && CODE_DEFAULT_TAGS.has(String(b.name));
      for (const c of kids) readBlock(c, kidsAreCode);
    }
  };
  try {
    const r = fe.splitBlocks(file, src);
    for (const b of (r?.blocks ?? [])) readBlock(b, true);
  } catch {
    return null;
  }
  return names;
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

/**
 * A short, position-free class for a compile throw — the trailing comment on a KNOWN_THROWS line
 * (informational; the gate matches the `[mode] <unit>` key only).
 */
function errorClass(e: unknown): string {
  const msg = String((e as Error)?.message ?? e).split("\n")[0];
  const m = /^\[scrml ([\w-]+)\][^:]*:\s*(.*?)\s*\(\d+:\d+\)/.exec(msg);
  if (m) return `${m[1]}: ${m[2]}`;
  const name = (e as Error)?.name ?? "Error";
  return `${name}: ${msg.slice(0, 120)}`;
}

type Violation = { rule: "R1" | "R2" | "R3" | "R4"; mode: string; unit: string; artifact: string; detail: string };

async function runShard(units: string[][], modes: Mode[]) {
  const { compileScrml } = await import(join(REPO, "compiler/src/api.js"));
  const { aliasFreeGlobalRefs } = await import(join(REPO, "compiler/src/codegen/fn-name-rename.ts"));
  const acorn = await import("acorn");
  const NAMES = await hostNames();
  const fe = {
    splitBlocks: (await import(join(REPO, "compiler/src/block-splitter.js"))).splitBlocks,
    ...(await import(join(REPO, "compiler/src/tokenizer.ts"))),
  };
  const violations: Violation[] = [];
  const unparsed: string[] = [];
  const thrown: { key: string; error: string }[] = [];
  const unreadAuthor: string[] = [];
  let artifacts = 0, compiled = 0;
  const RT_START = "// --- scrml reactive runtime ---";
  const RT_END = "// --- end scrml reactive runtime ---";
  const blank = (s: string, a: number, b: number) => s.slice(0, a) + s.slice(a, b).replace(/[^\n]/g, " ") + s.slice(b);

  for (const entries of units) {
    const unit = relative(REPO, entries.length === 1 ? entries[0] : dirname(entries[0]));
    const files0 = authorFiles(entries);
    const author = files0.map((f) => f.src).join("\n");
    // R1's "the author wrote this name": the identifiers in the author's CODE (authorCodeNames).
    // A file the front end refuses falls back to its raw words — reported below, never silent.
    const authorNames = new Set<string>();
    for (const { file, src } of files0) {
      const got = authorCodeNames(file, src, fe);
      if (got === null) { unreadAuthor.push(relative(REPO, file)); for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) authorNames.add(m[0]); }
      else for (const n of got) authorNames.add(n);
    }
    const usesName = (n: string) => authorNames.has(n);
    const wantsTest = /~\{|<engine\b/.test(author);
    const wantsLibrary = /\bexport\b/.test(author);
    for (const mode of modes) {
      if (mode === "test" && !wantsTest) continue;
      if (mode === "library" && !wantsLibrary) continue;
      const out = mkdtempSync(join(tmpdir(), "scrml-hgs-"));
      try {
        let r: any;
        try { r = compileScrml({ inputFiles: entries, outputDir: out, write: true, log: () => {}, ...MODE_OPTS[mode] }); }
        catch (e) {
          // A compiler crash means this unit's artifacts went unchecked: counted and listed, and
          // the scan does not report clean while any unit threw (fail toward reporting).
          thrown.push({ key: `[${mode}] ${unit}`, error: errorClass(e) });
          continue;
        }
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
  return { violations, artifacts, compiled, unparsed, thrown, unreadAuthor };
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

if (flag("--author-names")) {
  // Debug: the identifiers R1 counts as author-written for one source file.
  const f = resolve(opt("--author-names", ""));
  const fe = { splitBlocks: (await import(join(REPO, "compiler/src/block-splitter.js"))).splitBlocks, ...(await import(join(REPO, "compiler/src/tokenizer.ts"))) };
  const got = authorCodeNames(f, readFileSync(f, "utf8"), fe);
  console.log(got === null ? "(front end refused the file)" : [...got].sort().join(" "));
  process.exit(0);
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
const thrown: { key: string; error: string }[] = done.flatMap((r: any) => r.thrown);
const unreadAuthor: string[] = [...new Set<string>(done.flatMap((r: any) => r.unreadAuthor))];
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`host-global-scan: ${units.length} units × modes [${modes.join(", ")}] — ${compiled} compiles, ${thrown.length} threw, ${artifacts} artifacts scanned, ${violations.length} violation(s), ${secs}s`);
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
if (unreadAuthor.length > 0) {
  console.log(`  (author source the front end refused — R1 judged it by raw words, which can under-report: ${unreadAuthor.length})`);
  for (const u of unreadAuthor) console.log(`    ${u}`);
}
if (thrown.length > 0) {
  console.error(`host-global-scan: ${thrown.length} compile(s) THREW — their artifacts were not checked:`);
  for (const t of thrown) console.error(`    ${t.key}  # ${t.error}`);
}
// A compile that throws leaves its unit unchecked. Every throw the full default run sees is
// pinned BY NAME in KNOWN_THROWS (one `[mode] <unit>` key per line, the error class as a trailing
// `#` comment), each pre-existing and reproducing on main. A throw whose key is not pinned is a
// compiler regression shrinking this gate's coverage: the scan is incomplete, exit 2 — even when
// the total count went down (a count let a new thrower hide behind a fixed one). A pinned key that
// no longer throws is reported, not failed: remove it (or run with --prune). The list only shrinks.
const KNOWN_THROWS = join(import.meta.dir, "host-global-scan.known-throws.txt");
const knownLines = existsSync(KNOWN_THROWS) ? readFileSync(KNOWN_THROWS, "utf8").split("\n") : [];
const keyOf = (line: string) => line.replace(/\s+#.*$/, "").trim();
const known = new Set(knownLines.map(keyOf).filter((k) => k && !k.startsWith("#")));
const thrownKeys = new Set(thrown.map((t) => t.key));
const newThrows = thrown.filter((t) => !known.has(t.key));
// "no longer throws" is only judged for keys this run covered (its modes, its enumerated units).
const unitKeys = new Set(units.map((e) => relative(REPO, e.length === 1 ? e[0] : dirname(e[0]))));
const inScope = (k: string) => {
  const m = /^\[(\w+)\] (.+)$/.exec(k);
  return !!m && (modes as string[]).includes(m[1]) && unitKeys.has(m[2]);
};
const fixedKeys = [...known].filter((k) => !thrownKeys.has(k) && inScope(k)).sort();
if (fixedKeys.length > 0 && !shardFailed) {
  console.log(`  (fixed — ${fixedKeys.length} pinned throw(s) no longer throw; remove from ${relative(REPO, KNOWN_THROWS)}${flag("--prune") ? " — pruned" : " or run with --prune"}:)`);
  for (const k of fixedKeys) console.log(`    ${k}`);
  if (flag("--prune")) {
    const drop = new Set(fixedKeys);
    writeFileSync(KNOWN_THROWS, knownLines.filter((l) => !drop.has(keyOf(l))).join("\n"));
  }
}
if (shardFailed) { console.error("host-global-scan: a shard failed (above) — the scan is incomplete"); process.exit(2); }
if (violations.length > 0) process.exit(1);
if (newThrows.length > 0) {
  console.error(`host-global-scan: incomplete — ${newThrows.length} compile(s) threw that ${relative(REPO, KNOWN_THROWS)} does not pin (their artifacts went unchecked):`);
  for (const t of newThrows) console.error(`    ${t.key}  # ${t.error}`);
  process.exit(2);
}
process.exit(0);
