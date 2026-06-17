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

import { resolve } from "node:path";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { compileScrml } from "../../src/api.js";
import { runDetectors } from "./render-detectors.js";

const TMP_ROOT = resolve("/tmp", "scrml-e2e-render-map");

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
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(TMP_ROOT, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });

  // Determine the entry base-name (drives the emitted .html / .client.js names).
  const entryBase = app.relpath.split("/").pop().replace(/\.scrml$/, "");

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
    // mirrorTree copies ALL files (incl. .db/.sql), preserving the layout.
    const dirRoot = findAppDirRoot(app);
    const mirrored = mirrorTree(dirRoot, tmpDir);
    inputFilesForCompile = mirrored.filter((p) => p.endsWith(".scrml"));
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

  const out = {
    errors: result ? (result.errors ?? []) : [],
    html: "",
    clientJs: "",
    runtimeJs: "",
    compileThrew,
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

/** Resolve the app-dir root for a multi-file app (the dir holding the entry). */
function findAppDirRoot(app) {
  // The enumerator's appDir is repo-relative; reconstruct the absolute root by
  // stripping the entry's relpath tail from its absolute path.
  // entry path = <repoRoot>/<appDir>/.../<entry>.scrml. The shallowest common
  // dir of all inputFiles is the app root.
  let common = app.inputFiles[0].split("/");
  for (const f of app.inputFiles.slice(1)) {
    const parts = f.split("/");
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
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
  htmls.sort((a, b) => a.split("/").length - b.split("/").length);
  const chosen =
    htmls.find((h) => h.endsWith(`${entryBase}.html`)) ??
    htmls.find((h) => h.endsWith("index.html")) ??
    htmls[0];
  result.html = readFileSync(chosen, "utf8");
  const siblingClient = chosen.replace(/\.html$/, ".client.js");
  if (existsSync(siblingClient)) result.clientJs = readFileSync(siblingClient, "utf8");
  return result;
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
 * @returns {{ cellKey, state, smells, detail, seeded }}
 */
export function observeApp(app, seed, seedLabel) {
  const artifacts = compileApp(app);
  const cellKey = `${app.relpath}#${seedLabel}`;

  // D0: compile failed (or threw) — record without mounting.
  if (artifacts.compileThrew) {
    cleanup(artifacts);
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
    cleanup(artifacts);
    return { cellKey, state: det.state, smells: det.smells, detail: det.detail, seeded: seed != null };
  }
  if (!artifacts.html) {
    // Compiled clean but produced no html to mount (e.g. a library-mode file
    // that slipped the <program filter, or a per-route app with no entry html
    // located). Record as renders-empty (no UI to assert) — NOT suppressed.
    cleanup(artifacts);
    return {
      cellKey,
      state: "renders-empty",
      smells: ["NO-HTML-EMITTED"],
      detail: { note: "compiled clean but no entry html located" },
      seeded: seed != null,
    };
  }

  const obs = mountAndObserve(artifacts);

  // POPULATED seed: set each fixture cell, then re-read the DOM.
  if (seed != null && obs.set) {
    try {
      for (const [name, value] of Object.entries(seed)) {
        obs.set(name, value);
      }
    } catch (e) {
      obs.consoleErrors.push(`[seed-set] ${String(e && e.message ? e.message : e)}`);
    }
  }

  const det = runDetectors({
    compileErrors: [],
    throwMessage: obs.throwMessage,
    consoleErrors: obs.consoleErrors,
    document,
    seeded: seed != null,
  });

  cleanup(artifacts);
  return { cellKey, state: det.state, smells: det.smells, detail: det.detail, seeded: seed != null };
}

function cleanup(artifacts) {
  if (artifacts && artifacts.tmpDir && existsSync(artifacts.tmpDir)) {
    try { rmSync(artifacts.tmpDir, { recursive: true, force: true }); } catch (_) { /* noop */ }
  }
}
