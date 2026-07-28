/**
 * mpa-shell-child-dep-scripts-gh235.test.js — GH #235: a composed route page
 * must load the transitive `.scrml` dependency bundles its scripts destructure.
 *
 * Adopter symptom (scrml 0.7.1): every page EXCEPT the shell's own route threw
 * at the top of the bundle IIFE and client boot was dead app-wide:
 *
 *     TypeError: Cannot destructure property 'rolePath' of
 *     '_scrml_modules.models/auth.client.js' as it is undefined
 *         at app.client.js:5:9
 *
 *     dist/app.html    ->  runtime · models/auth.client.js · app.client.js        OK
 *     dist/login.html  ->  runtime ·                         app.client.js · login.client.js
 *
 * `dist/models/auth.client.js` was emitted correctly and served 200 — it was
 * simply never LOADED on a child page. The shell's own document goes through
 * the per-file envelope path, which emits the dependency `<script>`s; the MPA
 * shell composition rebuilds the whole script set from scratch and emitted only
 * the two BUNDLES, dropping both the shell's and the page's dependency sets.
 *
 * ORDER IS THE CONTRACT, NOT PRESENCE. Classic `<script>` eval is sequential,
 * so each dependency's `_scrml_modules[...] = {...}` footer has to run BEFORE
 * the bundle whose top-level destructure reads it. Every assertion below pins
 * relative INDEX, never mere inclusion.
 *
 * These tests EXECUTE the emitted bundles in the HTML's declared script order.
 * A presence-only grep is a false green here: the pre-fix output is well-formed
 * HTML referencing files that all exist, and it still dies on load.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

if (!globalThis.document) GlobalRegistrator.register();

let TMP;
beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "gh235-mpa-dep-scripts-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function buildDir(caseId, files) {
  const ROOT = join(TMP, caseId);
  mkdirSync(ROOT, { recursive: true });
  const inputFiles = [];
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, src);
    inputFiles.push(abs);
  }
  const outDir = join(ROOT, "dist");
  const result = compileScrml({ inputFiles, write: true, outputDir: outDir, log: () => {} });
  const read = (rel) => {
    const p = join(outDir, rel);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    outDir,
    read,
  };
}

/** The `<script src>` values, in document order. */
function scriptSrcs(html) {
  return [...(html ?? "").matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>\s*<\/script>/g)].map((m) => m[1]);
}

/**
 * Load every `<script src>` of `htmlRel` in the order the document declares,
 * resolving each src relative to the document's own directory — which is what a
 * browser does and what makes a nested route's `../` prefixes load-bearing.
 * Returns the thrown error, or null.
 */
function bootDocument(outDir, htmlRel) {
  const htmlPath = join(outDir, htmlRel);
  const html = readFileSync(htmlPath, "utf8");
  const docDir = dirname(htmlPath);

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .trim();

  const parts = [];
  for (const src of scriptSrcs(html)) {
    const p = join(docDir, src);
    if (!existsSync(p)) return new Error(`404: ${htmlRel} references a missing ${src}`);
    parts.push(readFileSync(p, "utf8"));
  }
  try {
    new Function("window", "document", parts.join("\n"))(window, document);
  } catch (e) {
    return e;
  }
  return null;
}

// `models/auth.scrml` — the shell's dependency. Exports a pure helper the shell
// destructures at the top of its bundle.
const AUTH = `export function rolePath(role: string) -> string {
  match role {
    "admin" :> "/admin"
    _       :> "/patron"
  }
}
`;

// `models/fmt.scrml` — a SECOND module, imported by a route page rather than by
// the shell, so the page's own dependency set is exercised independently.
const FMT = `export function shout(s: string) -> string {
  s
}
`;

const SHELL = `<program>
  import { rolePath } from './models/auth.scrml'

  <role> = "admin"

  <h1>Shell</h1>
  <nav><a href="\${rolePath(@role)}">Dashboard</a></nav>
  <outlet/>
</program>
`;

// A leaf route with NO imports of its own — the adopter's failing shape.
const LOGIN = `<page>
  <email> = ""
  <h2>Login</h2>
  <input type="email" value="\${@email}"/>
</page>
`;

// A root-level route that brings its OWN cross-file dependency.
const REPORT = `<page>
  import { shout } from '../models/fmt.scrml'

  <label> = "report"

  <h2>\${shout(@label)}</h2>
</page>
`;

// A NESTED route with its own dependency — every emitted src needs a `../`.
const SETTINGS = `<page>
  import { shout } from '../../models/fmt.scrml'

  <label> = "settings"

  <h2>\${shout(@label)}</h2>
</page>
`;

// A route importing the SAME module the shell imports — the dedup case.
const PROFILE = `<page>
  import { rolePath } from '../models/auth.scrml'

  <who> = "admin"

  <h2>\${rolePath(@who)}</h2>
</page>
`;

const PROJECT = {
  "app.scrml": SHELL,
  "models/auth.scrml": AUTH,
  "models/fmt.scrml": FMT,
  "pages/login.scrml": LOGIN,
  "pages/report.scrml": REPORT,
  "pages/profile.scrml": PROFILE,
  "pages/admin/settings.scrml": SETTINGS,
};

describe("GH #235 — composed route pages load the shell's transitive dep bundles", () => {
  test("the project compiles clean", () => {
    const { errors } = buildDir("compiles", PROJECT);
    expect(errors).toEqual([]);
  });

  test("the SHELL's own document is unchanged: dep before bundle", () => {
    const { read } = buildDir("shell-doc", PROJECT);
    const srcs = scriptSrcs(read("app.html"));
    expect(srcs).toContain("models/auth.client.js");
    expect(srcs.indexOf("models/auth.client.js")).toBeLessThan(srcs.indexOf("app.client.js"));
  });

  test("a leaf child page loads the SHELL's dep BEFORE the shell bundle", () => {
    const { read } = buildDir("leaf-child", PROJECT);
    const srcs = scriptSrcs(read("login.html"));
    // The regression: `models/auth.client.js` was absent entirely.
    expect(srcs).toContain("models/auth.client.js");
    expect(srcs.indexOf("models/auth.client.js")).toBeLessThan(srcs.indexOf("app.client.js"));
    // The two bundles keep their pre-existing relative order.
    expect(srcs.indexOf("app.client.js")).toBeLessThan(srcs.indexOf("login.client.js"));
  });

  test("a child page's OWN dep loads before its own bundle", () => {
    const { read } = buildDir("own-dep", PROJECT);
    const srcs = scriptSrcs(read("report.html"));
    expect(srcs).toContain("models/fmt.client.js");
    expect(srcs.indexOf("models/fmt.client.js")).toBeLessThan(srcs.indexOf("report.client.js"));
    // ...and the shell's dep is still there, ahead of the shell bundle.
    expect(srcs.indexOf("models/auth.client.js")).toBeLessThan(srcs.indexOf("app.client.js"));
  });

  test("a NESTED route resolves every dep relative to its own dist dir", () => {
    const { read } = buildDir("nested", PROJECT);
    const srcs = scriptSrcs(read("admin/settings.html"));
    expect(srcs).toContain("../models/auth.client.js");
    expect(srcs).toContain("../models/fmt.client.js");
    expect(srcs).toContain("../app.client.js");
    // The page's own bundle is a same-dir sibling — no prefix.
    expect(srcs).toContain("settings.client.js");
    expect(srcs.indexOf("../models/auth.client.js")).toBeLessThan(srcs.indexOf("../app.client.js"));
    expect(srcs.indexOf("../models/fmt.client.js")).toBeLessThan(srcs.indexOf("settings.client.js"));
  });

  test("a dep shared by the shell AND the page is emitted exactly once", () => {
    const { read } = buildDir("dedup", PROJECT);
    const srcs = scriptSrcs(read("profile.html"));
    const hits = srcs.filter((s) => s === "models/auth.client.js");
    expect(hits.length).toBe(1);
    // The single surviving copy still precedes BOTH bundles that read it.
    expect(srcs.indexOf("models/auth.client.js")).toBeLessThan(srcs.indexOf("app.client.js"));
    expect(srcs.indexOf("models/auth.client.js")).toBeLessThan(srcs.indexOf("profile.client.js"));
  });

  test("every composed document carries exactly ONE runtime <script>", () => {
    // Pre-existing defect surfaced by the #235 reproducer: the page-envelope
    // strip removed a fixed TWO trailing tags, which is one short the moment a
    // page has its own dependency, so the page's un-prefixed runtime tag
    // survived alongside the composition's own. At dist root that is the same
    // URL twice (the second classic <script> dies redeclaring `_scrml_state`);
    // from a nested dir the survivor 404s.
    const { read } = buildDir("one-runtime", PROJECT);
    for (const rel of ["app.html", "login.html", "report.html", "profile.html", "admin/settings.html"]) {
      const runtimes = scriptSrcs(read(rel)).filter((s) => /scrml-runtime\.[^/]*\.js$/.test(s));
      expect([rel, runtimes.length]).toEqual([rel, 1]);
    }
  });

  test("EXECUTION: every composed document boots with no error", () => {
    const { outDir } = buildDir("execute", PROJECT);
    for (const rel of ["app.html", "login.html", "report.html", "profile.html", "admin/settings.html"]) {
      const err = bootDocument(outDir, rel);
      expect([rel, err === null ? null : String(err && err.message)]).toEqual([rel, null]);
    }
  });
});
