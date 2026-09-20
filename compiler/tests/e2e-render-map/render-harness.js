/**
 * render-harness.js — the L1 e2e render harness core (R26 industrialized).
 *
 * Per the e2e-known-failure-map deep dive (docs/deep-dives/
 * e2e-known-failure-map-2026-06-17.md §thin-build steps 2–3): for each corpus
 * app, compileScrml({write:true}) -> mount in happy-dom -> run the D0–D7
 * detectors -> record per-app/per-seed state + smells. This is the standing,
 * whole-corpus version of the hand-run R26 that caught acceptance bugs 2+3.
 *
 * Driving (DD §"Driving corpus apps"): class-1 (pure-client) apps mount + fire
 * DOMContentLoaded. class-2/3a (`<db>`/server-fn) apps are additionally driven
 * with a one-line fixture cell-set so they reach a POPULATED render — and EMPTY
 * and POPULATED are recorded as SEPARATE cells (the board bug lives ONLY in
 * populated; an empty-db board renders `<empty>` clean + looks green).
 *
 * Substrate: clones the mount pattern from
 * compiler/tests/browser/each-runtime-bug-57.test.js — compile via the real
 * path, read html/client.js/runtime.js (via result.runtimeFilename), then
 * `document.documentElement.innerHTML = html; new Function(...)(window,document);
 * document.dispatchEvent(new Event("DOMContentLoaded"))`.
 *
 * NO error-class suppression anywhere (DD §"DO NOT SUPPRESS ANY ERROR CLASS").
 * The harness CLASSIFIES (compile-fail / throw / smell) but never hides.
 *
 * The caller owns happy-dom registration (GlobalRegistrator.register/unregister)
 * — this module assumes a global `document`/`window` are live when observeApp is
 * called, exactly like the browser test suite's beforeEach/afterEach.
 */

import { resolve, relative, basename, isAbsolute, sep, join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { compileScrml } from "../../src/api.js";
import { runDetectors, renderedContentSignature, signatureGained } from "./render-detectors.js";
import { REPO_ROOT } from "./render-corpus-enumerator.js";

// ⛑ S419 residuals (g-e2e-render-map-baseline-keys-have-drifted-and-orphan-cells-are-never-flagged)
// — the staging root was `resolve("/tmp", "scrml-e2e-render-map")`, which is `C:\tmp\…` on
// Windows (a directory nothing else owns or cleans; 1495 leaked case dirs were found there).
// Each case now gets its own `mkdtemp` directory directly under the OS temp dir, so there is
// no shared root left behind, and the directory is removed on every exit path (compileApp
// on a throw, observeApp in a `finally`, the §1b test in its own `finally`).
export const TMP_PREFIX = join(tmpdir(), "scrml-e2e-render-map-");

/**
 * Compile one corpus app via the real compile path (write:true) and return the
 * emitted html / client.js / content-hashed runtime.js, plus result.errors.
 *
 * SINGLE-file apps compile alone. MULTI-file apps copy the whole app dir into a
 * tmp tree (preserving the relative layout so cross-file imports resolve) and
 * pass every .scrml as inputFiles, gathering the import graph the same way the
 * trucking-dispatch smoke test does (findScrml -> inputFiles).
 *
 * @param {object} app — an enumerateRenderCorpus() row.
 * @returns {{ errors, html, clientJs, runtimeJs, compileThrew: string|null }}
 */
export function compileApp(app) {
  const tmpDir = mkdtempSync(TMP_PREFIX);
  const outDir = resolve(tmpDir, "out");

  // ⛑ S419 review (L3) — on the success path the CALLER owns cleanup (it gets
  // `tmpDir` back). On a throw it gets nothing back, so a staging/mirror/locate
  // failure used to leak the whole mirrored tree. Clean up here, then re-throw.
  try {
    return compileAppInTmp(app, tmpDir, outDir);
  } catch (e) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* noop */ }
    // Diagnostic: name the (now removed) staging dir on the error.
    if (e && typeof e === "object") e.harnessTmpDir = tmpDir;
    throw e;
  }
}

/** The body of compileApp, run inside an already-created `tmpDir`. */
function compileAppInTmp(app, tmpDir, outDir) {
  // Determine the entry base-name (drives the emitted .html / .client.js names).
  // Taken from the native `path` via the path API — never from a separator split
  // (see the ⛑ S419 note on resolveMultiFileCompileInputs).
  const entryBase = basename(app.path).replace(/\.scrml$/, "");

  let inputFilesForCompile;
  if (app.kind === "single") {
    // Copy the single file in; compile it alone. Also copy sibling support
    // files the app's `<db src="x.db">` may reference (`.db`/`.sql`) so a
    // pre-existing db-file isn't a spurious E-PA-002 fails-compile (the db
    // EXISTS in the corpus — the harness must reproduce that, not invent a
    // missing-file failure that isn't real). Apps whose db is genuinely
    // create-on-demand have no sibling .db and remain unaffected.
    const dest = resolve(tmpDir, `${entryBase}.scrml`);
    copyFileSync(app.path, dest);
    copySiblingSupportFiles(resolve(app.path, ".."), tmpDir);
    inputFilesForCompile = [dest];
  } else {
    // Multi-file: mirror the app dir under tmp so relative imports resolve.
    // mirrorTree copies ALL files (incl. .db/.sql), preserving the layout; the
    // compile inputs are exactly the enumerator's inputFiles, re-rooted.
    const { root, relInputs } = resolveMultiFileCompileInputs(app);
    mirrorTree(root, tmpDir);
    inputFilesForCompile = relInputs.map((rel) => resolve(tmpDir, rel));
    const missing = inputFilesForCompile.filter((p) => !existsSync(p));
    if (missing.length > 0) {
      // Loud, not silent: a compile over a partial tree is the false-green class
      // this function exists to close. observe-one records it as HARNESS-ERROR.
      throw new Error(
        `multi-file app ${app.relpath}: ${missing.length} input(s) not mirrored from ${root}`,
      );
    }
  }

  let result = null;
  let compileThrew = null;
  try {
    result = compileScrml({
      inputFiles: inputFilesForCompile,
      write: true,
      outputDir: outDir,
      // Multi-file apps in the corpus use per-route emission (the trucking
      // board). Single-file apps do not. Let the compiler decide; we only read
      // the entry html/client below and tolerate per-route layouts via search.
      log: () => {},
    });
  } catch (e) {
    compileThrew = String(e && e.message ? e.message : e);
  }

  // serverDependent: does this app have a server side? Primary signal = the
  // compile emitted serverJs for any output (a `<program db=>` / server-fn /
  // auth app). Secondary = the source uses a `?{...}` SQL block (the client
  // reads server-provided data via a server-var, with no separate serverJs
  // file). Either way, mounting with NO server leaves a server-only binding /
  // data source null — which the detectors classify as `needs-server` (a
  // harness-realism non-gap per the S203 b+c disposition), NOT a codegen bug.
  let serverDependent = false;
  if (result && result.outputs) {
    for (const o of result.outputs.values()) {
      if (o && o.serverJs && o.serverJs.length > 0) {
        serverDependent = true;
        break;
      }
    }
  }
  if (!serverDependent) {
    for (const f of inputFilesForCompile) {
      try {
        if (readFileSync(f, "utf8").includes("?{")) {
          serverDependent = true;
          break;
        }
      } catch (_) {
        /* best-effort source scan */
      }
    }
  }

  const out = {
    errors: result ? (result.errors ?? []) : [],
    html: "",
    clientJs: "",
    runtimeJs: "",
    compileThrew,
    serverDependent,
    tmpDir, // caller cleans up
    outDir,
    entryBase,
    runtimeFilename: result ? result.runtimeFilename : null,
  };

  if (result && !compileThrew) {
    // Locate the emitted entry artifacts. Single-file: <outDir>/<base>.html.
    // Multi-file/per-route: search the out tree for the first .html + its
    // sibling .client.js (the entry-point chunk).
    const found = locateEntryArtifacts(outDir, entryBase);
    out.html = found.html;
    out.clientJs = found.clientJs;
    const runtimePath = found.runtimeJsPath
      ? found.runtimeJsPath
      : resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
    out.runtimeJs = existsSync(runtimePath)
      ? readFileSync(runtimePath, "utf8")
      : "";
  }

  return out;
}

/**
 * Resolve a multi-file app's absolute root and its compile inputs relative to it.
 *
 * ⛑ S419 — THE ROOT IS DECLARED, NOT INFERRED, AND PATHS GO THROUGH THE PATH API.
 * This replaced `findAppDirRoot`, which INFERRED the root as the common prefix of
 * `app.inputFiles` split on "/". That failed two ways, both silently green:
 *   - on Windows `inputFiles` are native absolute paths (`C:\...`), so the split
 *     yielded one segment per file, the common prefix was `""`, and `mirrorTree("")`
 *     mirrored the process CWD. observe-one runs with cwd = this directory, so
 *     `benchmarks/per-route-roles`, `examples/22-multifile` and
 *     `examples/23-trucking-dispatch` all compiled THIS tier's fixtures, produced
 *     identical output, and scored `renders-empty` (green) — reported as an
 *     "improvement" over the flagship's real baseline state
 *     (g-e2e-render-map-multi-file-apps-compile-an-empty-root-on-windows).
 *   - on EVERY OS, an app with ONE input file had a common prefix equal to the
 *     FILE, `mirrorTree(file)` copied nothing, and the cell recorded
 *     `NO-HTML-EMITTED` -> `renders-empty` (green) for `benchmarks/fullstack-scrml`
 *     (g-e2e-render-map-single-input-multi-app-mirrors-nothing).
 * #964 normalised `relpath` at the enumerator's mint site; that site mints TWO path
 * families. `relpath` / `appDir` are repo-relative DISPLAY KEYS and are `/`-shaped;
 * `path` / `inputFiles` are native FILESYSTEM paths and must only ever be consumed
 * through `node:path` — never by splitting on a separator. The enumerator already
 * declares each app's root (`appDir`, from MULTI_FILE_APP_DIRS), so it is used
 * directly rather than re-derived.
 *
 * Throws (-> HARNESS-ERROR, loud) if the row has no appDir or an input lies outside
 * the root.
 *
 * @returns {{ root: string, relInputs: string[] }}
 */
export function resolveMultiFileCompileInputs(app) {
  if (typeof app.appDir !== "string" || app.appDir === "") {
    throw new Error(`multi-file app ${app.relpath} has no appDir`);
  }
  const root = resolve(REPO_ROOT, app.appDir);
  const relInputs = app.inputFiles.map((f) => {
    const rel = relative(root, f);
    // ⛑ S419 review (L4): `..` must be a whole path SEGMENT — a bare
    // `startsWith("..")` also rejected an in-root file named `..draft.scrml`.
    // `isAbsolute` catches a cross-drive input on win32 (relative returns it absolute).
    if (rel === "" || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
      throw new Error(`multi-file app ${app.relpath}: input ${f} is not under its root ${root}`);
    }
    return rel;
  });
  return { root, relInputs };
}

/**
 * Copy a single-file app's sibling SUPPORT files (`.db`, `.sql`) into `destDir`
 * so a `<db src="x.db">` whose db EXISTS in the corpus resolves the same way it
 * does in-repo. Only top-level siblings (not the whole examples/ tree) — and
 * only support files, never sibling .scrml (those are unrelated single-file
 * apps in the same dir; copying them would pull foreign <program>s into the
 * compile).
 */
function copySiblingSupportFiles(srcDir, destDir) {
  let entries;
  try {
    entries = readdirSync(srcDir, { withFileTypes: true });
  } catch (_e) {
    return;
  }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (/\.(db|sql)$/.test(ent.name)) {
      try {
        copyFileSync(resolve(srcDir, ent.name), resolve(destDir, ent.name));
      } catch (_) {
        /* best-effort: a locked/absent support file is not the harness's bug */
      }
    }
  }
}

/** Recursively copy a .scrml/.db/.sql tree from `src` into `destBase`. */
function mirrorTree(srcRoot, destBase) {
  const copied = [];
  function walk(dir, relBase) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const ent of entries) {
      const full = resolve(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name.startsWith(".") || ent.name === "dist" || ent.name === "node_modules") continue;
        mkdirSync(resolve(destBase, rel), { recursive: true });
        walk(full, rel);
      } else if (ent.isFile()) {
        const dest = resolve(destBase, rel);
        mkdirSync(resolve(dest, ".."), { recursive: true });
        copyFileSync(full, dest);
        copied.push(dest);
      }
    }
  }
  walk(srcRoot, "");
  return copied;
}

/**
 * Find the entry html + its client.js + the runtime bundle under `outDir`.
 * Single-file: <outDir>/<base>.html exists directly. Per-route: search the
 * tree for the entry-base html (or the first html that is not a sub-page) and
 * its sibling .client.js.
 */
function locateEntryArtifacts(outDir, entryBase) {
  const result = { html: "", clientJs: "", runtimeJsPath: null };
  // Preferred: the flat single-file shape.
  const directHtml = resolve(outDir, `${entryBase}.html`);
  const directClient = resolve(outDir, `${entryBase}.client.js`);
  if (existsSync(directHtml)) {
    result.html = readFileSync(directHtml, "utf8");
    result.clientJs = existsSync(directClient) ? readFileSync(directClient, "utf8") : "";
    return result;
  }
  // Search the tree for the first .html (entry preferred) + sibling client.js.
  const htmls = [];
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
    for (const ent of entries) {
      const full = resolve(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".html")) htmls.push(full);
    }
  }
  walk(outDir);
  if (htmls.length === 0) return result;
  // Prefer an html whose base matches the entry; else the shallowest path.
  // ⛑ S419 — depth and name through the path API. `h` is a native path (`resolve`),
  // so the old `split("/")` depth was 1 for every file on Windows (the "shallowest"
  // preference silently degraded to readdir order), and `endsWith("app.html")` also
  // matched `myapp.html`. Depth is counted on the out-dir-relative path, split on
  // either separator; names compare by basename equality.
  const depth = (h) => relative(outDir, h).split(/[\\/]/).length;
  htmls.sort((a, b) => depth(a) - depth(b));
  const chosen =
    htmls.find((h) => basename(h) === `${entryBase}.html`) ??
    htmls.find((h) => basename(h) === "index.html") ??
    htmls[0];
  result.html = readFileSync(chosen, "utf8");
  const siblingClient = chosen.replace(/\.html$/, ".client.js");
  if (existsSync(siblingClient)) result.clientJs = readFileSync(siblingClient, "utf8");
  return result;
}

/**
 * Parse the per-chunk CELL SCOPES out of an emitted client bundle.
 *
 * ⛑ S420 (g-e2e-render-map-populated-seed-is-inert-so-d6-has-no-live-subject) —
 * THE SEED MUST BE WRITTEN UNDER THE KEY THE APP ACTUALLY READS, AND ONLY IF THE APP
 * ACTUALLY HAS THAT CELL.
 *
 * `codegen/index.ts buildCellScopePrologue` renames every cell-accessor call in a chunk body
 * to a chunk-local wrapper and emits a prologue that namespaces the key space:
 *
 *     // --- chunk cell scope (01hrlbd8) ---
 *     const _scrml_cs_key = (n) => { ...; return raw ? "01hrlbd8$" + raw : raw; };
 *     const _scrml_cs_reactive_set = (n, ...r) => _scrml_reactive_set(_scrml_cs_key(n), ...r);
 *
 * so the app's real store key for `<contacts>` is `01hrlbd8$contacts`. The harness used to
 * seed through the BARE `_scrml_reactive_set`, writing an un-namespaced `contacts` that
 * nothing subscribes to: no effect fired, the DOM never changed, and all four seeded cells
 * scored byte-identical to their unseeded twin. D6 (S-EMPTY-WITH-DATA) therefore never had a
 * live subject on the corpus.
 *
 * ⚑ The `_scrml_cs_*` wrappers CANNOT simply be preferred by name. The whole client bundle is
 * wrapped in `(function() { ... })()`, so those `const`s are IIFE-local and `typeof
 * _scrml_cs_reactive_set` is `"undefined"` at the harness's capture point (which appends
 * statements to the same `new Function` body, OUTSIDE that IIFE). The key space has to be
 * reconstructed and applied to the bare accessor instead.
 *
 * ⚑⚑ AND A WRITE MUST BE VALIDATED BEFORE IT HAPPENS, NOT INFERRED FROM A READ-BACK.
 * `_scrml_state` is a plain `{}` and `_scrml_reactive_set`/`_scrml_reactive_get` are a bare
 * property write/read (runtime-template.js:548/819/853), so **every invented key reads back**.
 * A read-back therefore certifies nothing: it cannot tell a real cell from a typo, and an
 * earlier revision of this bridge used "first key that reads back wins" — which is just
 * "first candidate wins", leaving the documented fallback unreachable. Worse, a speculative
 * `_scrml_reactive_set` is not free: it runs `_scrml_propagate_dirty` and notifies
 * subscribers, so probing can fire effects on the very subject the detectors then read.
 *
 * So this resolves the seed name STATICALLY, against the call sites the chunk really emits,
 * and writes exactly one key — or none at all.
 *
 * Each returned scope carries:
 *   - `token` / `prefix` — the chunk's namespace (`"01hrlbd8"` / `"01hrlbd8$"`).
 *   - `owners`           — the `_scrml_cs_owners` map of the dotted-root OWNER form, where an
 *                          IMPORTED cell keys under the EXPORTER's token (§51.0.A/§51.0.D).
 *   - `cells`            — every name the chunk passes to a `_scrml_cs_*` accessor. This is
 *                          the app's real cell set for the chunk; a seed name absent from it
 *                          names no cell in this app and must NOT be written.
 *   - `derived`          — names declared via `_scrml_cs_derived_declare`. A derived cell is
 *                          read through `_scrml_derived_fns`/`_scrml_derived_get`, NOT out of
 *                          `_scrml_state`, so writing its slot is discarded — and leaves junk
 *                          in a slot the runtime itself never writes. Never write one.
 *
 * Anchored on the `// --- chunk cell scope (<token>) ---` header, which `buildCellScopePrologue`
 * emits for BOTH prologue shapes (the compact no-owner form and the dotted-root owner form).
 * Matching the key-fn BODY instead would silently miss the owner form, whose key fn ends in a
 * plain `return "<prefix>" + raw;` with no ternary.
 *
 * ⚑ An unrecognised prologue FAILS LOUD (throws) rather than returning `[]`. Returning an
 * empty list would silently degrade to bare-key seeding — which is precisely the bug this
 * function exists to fix, one level away.
 *
 * @param {string} clientJs
 * @returns {Array<{token,prefix,owners,cells:Set<string>,derived:Set<string>}>} one entry per
 *   chunk, in emission order. A bundle with NO chunk scope at all yields a single synthetic
 *   bare scope (`prefix: ""`) whose cells are read off the un-namespaced accessor call sites.
 */
export function parseChunkCellScopes(clientJs) {
  const src = typeof clientJs === "string" ? clientJs : "";
  if (src === "") return [];

  const headerRe = /\/\/ --- chunk cell scope \(([^)\s]+)\) ---/g;
  const heads = [];
  let h;
  while ((h = headerRe.exec(src)) !== null) heads.push({ token: h[1], at: h.index });

  if (heads.length === 0) {
    // No chunk scope. Either a genuinely un-namespaced emit (valid — a chunk with no reactive
    // state carries no prologue) or a prologue shape this parser no longer recognises. The
    // `_scrml_cs_` marker discriminates the two, and the second is a hard error.
    if (src.includes("_scrml_cs_key") || src.includes("_scrml_cs_reactive_")) {
      throw new Error(
        "render-harness: emitted bundle defines _scrml_cs_* wrappers but carries no " +
          "`// --- chunk cell scope (<token>) ---` header — the prologue shape changed and the " +
          "seed bridge can no longer resolve the app's key space. Update parseChunkCellScopes.",
      );
    }
    return [{
      token: "",
      prefix: "",
      owners: {},
      cells: collectAccessorNames(src, /(?<![\w$])_scrml_(?:reactive_get|reactive_set|init_set|reset)\(\s*"((?:[^"\\]|\\.)*)"/g),
      derived: collectAccessorNames(src, /(?<![\w$])_scrml_derived_declare\(\s*"((?:[^"\\]|\\.)*)"/g),
    }];
  }

  return heads.map((head, i) => {
    // A chunk's region runs from its header to the next chunk's header (or EOF).
    const end = i + 1 < heads.length ? heads[i + 1].at : src.length;
    const region = src.slice(head.at, end);
    let owners = {};
    const om = /const _scrml_cs_owners = (\{[\s\S]*?\});/.exec(region);
    if (om) {
      try { owners = JSON.parse(om[1]); } catch (_e) { owners = {}; }
    }
    return {
      token: head.token,
      prefix: `${head.token}$`,
      owners,
      cells: collectAccessorNames(region, /(?<![\w$])_scrml_cs_\w+\(\s*"((?:[^"\\]|\\.)*)"/g),
      derived: collectAccessorNames(region, /(?<![\w$])_scrml_cs_derived_declare\(\s*"((?:[^"\\]|\\.)*)"/g),
    };
  });
}

/** Every first-string-argument captured by `re` over `src`, as a Set. */
function collectAccessorNames(src, re) {
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== "") out.add(m[1]);
  }
  return out;
}

/**
 * The store key a chunk resolves `name` to — a faithful mirror of the emitted `_scrml_cs_key`
 * (codegen/index.ts cellScopeKeyFn), INCLUDING the dotted-root owner lookup, so an imported
 * cell keys under the exporter's token rather than this chunk's.
 */
export function cellKeyIn(scope, name) {
  const raw = String(name == null ? "" : name);
  if (!raw) return raw;
  if (scope.owners && Object.keys(scope.owners).length > 0) {
    const d = raw.indexOf(".");
    const owned = scope.owners[d === -1 ? raw : raw.slice(0, d)];
    if (owned) return d === -1 ? owned : owned + raw.slice(d);
  }
  return scope.prefix + raw;
}

/**
 * Apply a POPULATED seed through the key space the app actually reads, and REPORT whether the
 * seed was OBSERVABLE — i.e. whether it moved the render.
 *
 * Per seed cell, exactly one of:
 *   - `no-such-cell`  — no chunk emits an accessor for this name. The fixture names a cell the
 *                       app does not have. NOTHING IS WRITTEN.
 *   - `derived-cell`  — the name is declared derived; the runtime recomputes it and would
 *                       discard the write. NOTHING IS WRITTEN.
 *   - `written`       — resolved to a real, settable cell; one key written.
 *   - `set-threw`     — the accessor threw.
 *
 * `domChanged` is the load-bearing signal. A read-back is deliberately NOT consulted: the store
 * is a plain object, so a read-back is true for any key whatsoever and proves nothing.
 *
 * ⚑ THE REPORT IS DETERMINISTIC AND CARRIES NO CHUNK TOKEN. It rides on `cell.detail`, and
 * `generate-baseline.js` PERSISTS `detail` for every RED cell straight into the committed
 * baseline JSON. The chunk token is `fnv1aHash(projectRelativeSourcePath)` over a fresh
 * `mkdtemp` staging dir, so it differs on every run and every machine; letting one reach
 * `detail` would put a per-run random value in a committed artifact the moment a seeded cell
 * goes red — which is exactly what D6 exists to make happen. Names, booleans and reason codes
 * only: no keys, no prefixes, no tokens, and no lengths.
 *
 * @returns {{ chunks:number, writes:Array<{name,reason,namespaced,wrote}>,
 *             domChanged:boolean, observable:boolean, errors:string[] }}
 */
export function applySeed(seed, obs, scopes, doc) {
  const writes = [];
  const errors = [];
  const readBody = () => {
    try { return doc && doc.body ? doc.body.innerHTML : ""; } catch (_e) { return ""; }
  };
  // ⛑ S423 fix round — the RENDERED-content fingerprint either side of the write, so the
  // report can answer "did anything NEW appear?" (D6's F1/F2 discriminator). Same
  // "rendered" definition as the detectors (S419 invariant). Held locally and reduced to
  // a BOOLEAN before it reaches the report: the signature holds raw page text, and the
  // report is committed to the baseline.
  //
  // ⛑ S423 fix round 2 (finding 3) — a THROW here is recorded, never silently folded into
  // "nothing gained". Swallowing it resolved to the FIRE direction: an unmeasured snapshot
  // yielded `gainedContent:false`, which does not veto, so a page with all-empty leaves was
  // scored red on a measurement that never happened — and the fabricated `false` was
  // committed to the baseline as though it had been measured.
  let sigFailed = null;
  const readSig = () => {
    try {
      return renderedContentSignature(doc && doc.body ? doc.body : null);
    } catch (e) {
      sigFailed = String(e && e.message ? e.message : e);
      return null;
    }
  };
  const before = readBody();
  const beforeSig = readSig();

  for (const [name, value] of Object.entries(seed)) {
    const scope = scopes.find((s) => s.cells.has(name));
    if (!scope) {
      writes.push({ name, reason: "no-such-cell", namespaced: false, wrote: false });
      continue;
    }
    if (scope.derived.has(name)) {
      writes.push({ name, reason: "derived-cell", namespaced: false, wrote: false });
      continue;
    }
    const key = cellKeyIn(scope, name);
    try {
      obs.set(key, value);
      writes.push({ name, reason: "written", namespaced: key !== name, wrote: true });
    } catch (e) {
      // The NAME, never the key — the key carries the per-run chunk token.
      errors.push(`[seed-set ${name}] ${String(e && e.message ? e.message : e)}`);
      writes.push({ name, reason: "set-threw", namespaced: key !== name, wrote: false });
    }
  }

  const after = readBody();
  const domChanged = after !== before;
  const afterSig = readSig();
  // ⛑ S423 fix round — did the write make anything NEW render? A pure LOSS (25-triage,
  // whose seed empties every column) is deliberately NOT a gain.
  // ⛑ fix round 2 (finding 3) — `null` when either snapshot failed: UNMEASURED, which the
  // detector treats as a veto (fail-quiet) rather than as "nothing gained". Recorded as an
  // error too, so a broken measurement is loud instead of silently wrong.
  const gainedContent =
    beforeSig === null || afterSig === null ? null : signatureGained(beforeSig, afterSig);
  if (sigFailed !== null) errors.push(`[seed-signature] ${sigFailed}`);
  return {
    chunks: scopes.length,
    writes,
    domChanged,
    gainedContent,
    observable: writes.some((w) => w.wrote) && domChanged,
    errors,
  };
}

/**
 * The F4 loudness notice for a seed whose accessor(s) THREW — or `null` for silence.
 *
 * ⛑ S424 item 3, and this condition's THIRD attempt. Extracted from `observeCompiled` on
 * purpose: the two previous rounds were pinned only by a MIRROR of the predicate re-typed
 * into the test file plus a `toContain` over the source text, and a mirror asserts nothing
 * about the code that actually runs (the §8 hollow-gate shape — a test can go green while
 * production says the opposite, which is precisely how rounds 1 and 2 both shipped). This
 * is the real function the harness calls, so the tests drive production.
 *
 * ⚠ THE CARVE-OUT, UNCHANGED AND LOAD-BEARING: `derived-cell` and `no-such-cell` are the
 * KNOWN, TABLED fixture bugs (see SEED_OBSERVABILITY in e2e-render-map.test.js). They are
 * fixture defects on a scheduled fix, not emit regressions, and must stay QUIET — reddening
 * them here would break the additive bar and pre-empt that arc. They stay quiet by
 * CONSTRUCTION rather than by an exclusion list: neither reason can ever make `threw > 0`.
 *
 * ⚠ HISTORY OF THIS PREDICATE, so a fourth round does not re-derive it:
 *   round 1 — `writes.every((w) => w.reason === "set-threw")`. A 2-key fixture of
 *             `[{set-threw},{no-such-cell}]` failed `every` and the throw vanished.
 *   round 2 — `!writes.some((w) => w.wrote) && writes.some((w) => w.reason === "set-threw")`,
 *             i.e. "NOTHING was delivered AND something threw". This is the S424 item-3 bug:
 *             on a >=2-key fixture where the key DRIVING the list throws and an unrelated key
 *             LANDS, the first conjunct is false, so a genuine accessor throw was silent,
 *             `seedWasDelivered` was true anyway, and the cell reddened as
 *             `renders-empty-with-data` — blaming the COMPILER for a write the HARNESS
 *             failed to make.
 *   round 3 (here) — a throw is a harness/emit failure ON ITS OWN TERMS. Whether a SIBLING
 *             key happened to land is irrelevant to whether THIS key threw, so it is not a
 *             conjunct at all. The landed count belongs in the MESSAGE, not in the gate.
 *
 * The message states the real counts either way, and never claims "none landed" when some
 * did — the round-2 wording was only ever true in the all-threw case.
 *
 * @param {{writes?: Array<{reason?: string, wrote?: boolean}>}|null|undefined} seedReport
 * @returns {string|null}
 */
export function seedThrewNotice(seedReport) {
  if (!seedReport) return null;
  const writes = Array.isArray(seedReport.writes) ? seedReport.writes : [];
  const threw = writes.filter((w) => w && w.reason === "set-threw").length;
  if (threw === 0) return null;
  const landed = writes.filter((w) => w && w.wrote === true).length;
  return landed === 0
    ? `[seed-bridge] ${threw} of ${writes.length} seed write(s) threw and none landed — the seed cannot be live`
    : `[seed-bridge] ${threw} of ${writes.length} seed write(s) threw while ${landed} landed — the seed is only PARTLY live`;
}


/**
 * Mount the compiled artifacts in the (caller-registered) happy-dom global and
 * observe it. Captures: a mount throw (D1/D7), console.error during mount+settle
 * (D2), and exposes the reactive set/get side-channel so the caller can seed a
 * fixture (class-2/3a driving).
 *
 * @param {{html,clientJs,runtimeJs}} artifacts
 * @returns {{ throwMessage: string|null, consoleErrors: string[],
 *             set: fn|null, get: fn|null }}
 */
function mountAndObserve(artifacts) {
  const consoleErrors = [];
  let throwMessage = null;

  // Shim console.error so D2 sees the soft-throw class without suppressing it.
  const realConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args.map((a) => (a && a.message ? a.message : String(a))).join(" "));
  };

  // Capture an uncaught error fired on window during mount (some runtime paths
  // dispatch rather than throw synchronously).
  const onWindowError = (ev) => {
    const msg = ev && ev.error && ev.error.message
      ? ev.error.message
      : ev && ev.message
        ? ev.message
        : String(ev);
    consoleErrors.push(`[window.onerror] ${msg}`);
  };

  let setFn = null;
  let getFn = null;

  try {
    document.documentElement.innerHTML = artifacts.html || "<body></body>";
    if (typeof window.addEventListener === "function") {
      window.addEventListener("error", onWindowError);
    }
    const exec = new Function(
      "window",
      "document",
      `${artifacts.runtimeJs}\n${artifacts.clientJs}\n` +
        `try { globalThis.__scrml_set__ = (typeof _scrml_reactive_set !== "undefined") ? _scrml_reactive_set : null; } catch(_) { globalThis.__scrml_set__ = null; }\n` +
        `try { globalThis.__scrml_get__ = (typeof _scrml_reactive_get !== "undefined") ? _scrml_reactive_get : null; } catch(_) { globalThis.__scrml_get__ = null; }\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    setFn = globalThis.__scrml_set__ ?? null;
    getFn = globalThis.__scrml_get__ ?? null;
  } catch (e) {
    throwMessage = String(e && e.message ? e.message : e);
  } finally {
    console.error = realConsoleError;
    if (typeof window.removeEventListener === "function") {
      try { window.removeEventListener("error", onWindowError); } catch (_) { /* noop */ }
    }
  }

  return { throwMessage, consoleErrors, set: setFn, get: getFn };
}

/**
 * Observe ONE app at ONE seed-state and return the recorded cell.
 *
 * seed === null  -> EMPTY observation (mount + DOMContentLoaded only).
 * seed === {...} -> POPULATED observation: after mount, set each
 *                   `seed[cellName] = value` via the reactive side-channel, then
 *                   re-observe. Records `seeded:true` so D6 (empty-with-data) is
 *                   live.
 *
 * The caller (the test) registers happy-dom and resets the document per call.
 *
 * @param {object} [hooks]
 * @param {(tmpDir: string) => void} [hooks.onTmpDir] — told the staging dir once it
 *   exists (test-only: lets a test assert the dir is gone afterwards, on success or throw).
 * @returns {{ cellKey, state, smells, detail, seeded }}
 */
export function observeApp(app, seed, seedLabel, hooks = {}) {
  const artifacts = compileApp(app);
  // ⛑ S419 residuals — every return path below cleaned up, but a throw from the mount
  // or the detectors skipped cleanup and leaked the staging dir. One `finally` now owns it.
  try {
    if (typeof hooks.onTmpDir === "function") hooks.onTmpDir(artifacts.tmpDir);
    return observeCompiled(app, seed, seedLabel, artifacts);
  } catch (e) {
    if (e && typeof e === "object") e.harnessTmpDir = artifacts.tmpDir;
    throw e;
  } finally {
    cleanup(artifacts);
  }
}

/** The body of observeApp, given compiled artifacts. The caller owns cleanup. */
function observeCompiled(app, seed, seedLabel, artifacts) {
  const cellKey = `${app.relpath}#${seedLabel}`;

  // D0: compile failed (or threw) — record without mounting.
  if (artifacts.compileThrew) {
    return {
      cellKey,
      state: "fails-compile",
      smells: ["D0-COMPILE-THREW"],
      detail: { compileThrew: artifacts.compileThrew.slice(0, 400) },
      seeded: seed != null,
    };
  }
  if (artifacts.errors.length > 0) {
    const det = runDetectors({ compileErrors: artifacts.errors, seeded: seed != null });
    return { cellKey, state: det.state, smells: det.smells, detail: det.detail, seeded: seed != null };
  }
  if (!artifacts.html) {
    // Compiled clean but produced no html to mount (e.g. a library-mode file
    // that slipped the <program filter, or a per-route app with no entry html
    // located). Record as renders-empty (no UI to assert) — NOT suppressed.
    return {
      cellKey,
      state: "renders-empty",
      smells: ["NO-HTML-EMITTED"],
      detail: { note: "compiled clean but no entry html located" },
      seeded: seed != null,
    };
  }

  const obs = mountAndObserve(artifacts);

  // POPULATED seed: resolve each fixture cell against the chunk scopes the app really emits
  // and write only the ones that name a real, settable cell (⛑ S420 — see
  // parseChunkCellScopes), then re-read the DOM.
  let seedReport = null;
  if (seed != null) {
    if (obs.set) {
      try {
        seedReport = applySeed(seed, obs, parseChunkCellScopes(artifacts.clientJs), document);
      } catch (e) {
        // Includes the LOUD unrecognised-prologue throw. Recorded, never swallowed into a
        // silent bare-key fallback.
        seedReport = {
          chunks: 0, writes: [], domChanged: false, gainedContent: null, observable: false,
          errors: [`[seed-bridge] ${String(e && e.message ? e.message : e)}`],
        };
        obs.consoleErrors.push(`[seed-bridge] ${String(e && e.message ? e.message : e)}`);
      }
      // ⛑ S423 fix round (F4), second half: "same path when every write throws". A
      // per-write `set-threw` is recorded in `seedReport.errors` and nowhere else, so a
      // seed whose every write threw ALSO scored green. Raised only for `set-threw` —
      // NOT for `derived-cell` / `no-such-cell`, which are the three KNOWN, TABLED
      // fixture bugs (see SEED_OBSERVABILITY in e2e-render-map.test.js). Those are
      // fixture defects on a scheduled fix, not emit regressions, and reddening them
      // here would both break the additive bar and pre-empt that arc.
      //
      // ⛑ S424 item 3 — the predicate now lives in `seedThrewNotice` (see its header for
      // the full three-round history and the derived-cell / no-such-cell carve-out). It
      // used to be inlined here gated on `!writes.some((w) => w.wrote)`, i.e. "NOTHING was
      // delivered", which silenced a genuine throw whenever any SIBLING key landed.
      const threwNotice = seedThrewNotice(seedReport);
      if (threwNotice) obs.consoleErrors.push(threwNotice);
      // ⛑ fix round 2 (finding 3) — a failed render snapshot makes `gainedContent`
      // UNMEASURED. It already vetoes D6; surface it so it is loud, not merely quiet.
      // ⛑ final round — keyed on the SIGNATURE error, not on `gainedContent === null`
      // alone: the `catch` above now also reports `null` (it never took a snapshot either),
      // and it has already pushed its own accurate message. Keying on null would add a
      // second, untrue "the snapshot failed" line on top of it.
      if (seedReport && seedReport.errors.some((e) => String(e).startsWith("[seed-signature]"))) {
        obs.consoleErrors.push(
          "[seed-bridge] the render-content snapshot failed — gainedContent is UNMEASURED, D6 suppressed",
        );
      }
    } else {
      // Loud, not silent: no reactive side-channel at all means the seed CANNOT be live.
      //
      // ⛑ S423 fix round (F4) — THIS COMMENT SAID "LOUD" AND THE BRANCH WAS SILENT. It
      // recorded the reason in `seedReport.errors` only, and unlike the sibling `catch`
      // above it never pushed into `obs.consoleErrors` — so nothing downstream could see
      // it. That became FAIL-OPEN the moment D6 started gating on a real write: if an
      // emit regression drops `_scrml_reactive_set`, every write is skipped,
      // `seedWasDelivered` is false, and EVERY populated cell scores green however empty
      // it renders — D6 blind, with `generate-baseline.js` stripping `detail` from green
      // cells so the explanation never reaches the baseline either. A D2 console error
      // makes the cell red and keeps the reason attached.
      const msg = "no _scrml_reactive_set side-channel exposed by this emit";
      seedReport = {
        chunks: 0, writes: [], domChanged: false, gainedContent: null, observable: false,
        errors: [msg],
      };
      obs.consoleErrors.push(`[seed-bridge] ${msg}`);
    }
  }

  const det = runDetectors({
    compileErrors: [],
    throwMessage: obs.throwMessage,
    consoleErrors: obs.consoleErrors,
    document,
    seeded: seed != null,
    // ⛑ S423 limb 2 — D6 needs to know whether the seed was actually WRITTEN, not
    // merely registered. Two of the four corpus fixtures resolve to `derived-cell` /
    // `no-such-cell` and write nothing while still carrying `seeded:true`; scoring
    // such a cell red for an empty render would blame the compiler for a broken
    // fixture. The report is already computed above, so this is a pass-through.
    seedReport,
    serverDependent: artifacts.serverDependent,
  });

  // ⛑ S420 — the seed report rides on `detail` so a populated cell can never again claim a
  // seed it did not actually deliver. generate-baseline.js keeps `detail` only for RED
  // cells, so this does not perturb the recorded baseline of the (green) seeded cells.
  const detail = seedReport ? { ...det.detail, seed: seedReport } : det.detail;
  return { cellKey, state: det.state, smells: det.smells, detail, seeded: seed != null };
}

function cleanup(artifacts) {
  if (artifacts && artifacts.tmpDir && existsSync(artifacts.tmpDir)) {
    try { rmSync(artifacts.tmpDir, { recursive: true, force: true }); } catch (_) { /* noop */ }
  }
}
