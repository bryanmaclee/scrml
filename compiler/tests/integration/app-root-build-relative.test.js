/**
 * §40.2 / §40.8 — route files are classified RELATIVE TO THE BUILD ROOT (S445).
 *
 * Governing: §40.2 "the application's top-level `<program>` … is the `<program>` of
 * the application's entry file (§40.8): the one web-application file of the build
 * (not a §64 tool) that has a top-level `<program>` and is not a route file under
 * `pages/` or `routes/`"; §40.8 "The entry file is the file resolved by the build
 * root". `pages/` is the BUILD ROOT's `pages/` — a directory component of the path
 * relative to the build root, never a directory above it.
 *
 * Before S445 (g-app-root-route-prefix-matched-on-absolute-path, HIGH, fail-open)
 * route-inference searched `/pages/` / `/routes/` anywhere in the ABSOLUTE path. A
 * project checked out under any directory named `pages` or `routes` made every file
 * a route file: no application `<program>` was identified, the member pages of an
 * `auth="required"` application were served anonymously (`/about` 200 with the
 * body), and W-AUTH-LOGIN-MISSING fired falsely. PA-reproduced on c53b297a7.
 *
 * Also pinned (g-required-program-with-no-identified-app-root-is-silent, MED):
 * W-AUTH-REQUIRED-NOT-INHERITED — a required `<program>` that is a route file's own
 * gates only its own file (§40.2), and when no required application `<program>`
 * covers the member pages they are public; that is now said out loud.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml, scanDirectory } from "../../src/api.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(testDir, "../../src/cli.js");
const _tmp = perRunTmp(resolve(testDir, "_tmp_app_root_build_relative"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

const APP = {
  "app.scrml": `<program auth="required">\n<p>home-marker</p>\n</program>\n`,
  "pages/about.scrml": `<page>\n<p>about-marker</p>\n</page>\n`,
  "pages/login.scrml": `<page auth="none">\n<p>login-marker</p>\n</page>\n`,
};

function writeProject(projectRel, files) {
  const root = join(_tmp.root, projectRel);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

function compile(root, extra = {}) {
  return compileScrml({
    inputFiles: scanDirectory(root),
    write: false,
    log: () => {},
    ...extra,
  });
}

const codes = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])].map((d) => d.code);
const diag = (r, code) => [...(r.errors ?? []), ...(r.warnings ?? [])].filter((d) => d.code === code);
const serverOf = (r, root, rel) => r.outputs.get(join(root, rel))?.serverJs ?? "";
const isGuarded = (r, root, rel) => serverOf(r, root, rel).includes("export const _scrml_protected_document");

// ---------------------------------------------------------------------------
// The build root's ancestors are never consulted
// ---------------------------------------------------------------------------

describe("a pages/ or routes/ directory ABOVE the build root is not a route directory", () => {
  const LAYOUTS = [
    ["control (no route-named ancestor)", "ctl/f1"],
    ["project under …/pages/<x>/", "anc/pages/f2"],
    ["project under …/routes/<x>/", "anc/routes/f3"],
    ["project directory itself named pages (depth 1)", "d1/pages"],
    ["project directory itself named routes (depth 1)", "d1r/routes"],
    ["deep: …/pages/a/routes/b/", "deep/pages/a/routes/b"],
  ];
  for (const [label, rel] of LAYOUTS) {
    test(`${label}: the unannotated member page is gated; the login page is not`, () => {
      const root = writeProject(rel, APP);
      const r = compile(root);
      expect(r.errors.filter((e) => e.severity !== "warning")).toEqual([]);
      expect(isGuarded(r, root, "pages/about.scrml")).toBe(true);
      expect(isGuarded(r, root, "app.scrml")).toBe(true);
      expect(isGuarded(r, root, "pages/login.scrml")).toBe(false);
      // The /login page IS in the compile unit — no false W-AUTH-LOGIN-MISSING.
      expect(codes(r)).not.toContain("W-AUTH-LOGIN-MISSING");
      expect(codes(r)).not.toContain("W-AUTH-REQUIRED-NOT-INHERITED");
    });
  }

  test("an explicit buildRoot option gives the same answer as the implicit one", () => {
    const root = writeProject("explicit/pages/f4", APP);
    const r = compile(root, { buildRoot: root });
    expect(isGuarded(r, root, "pages/about.scrml")).toBe(true);
  });

  test("compileScrml with RELATIVE input paths classifies from the same root", () => {
    const root = writeProject("relpaths/pages/f5", APP);
    const rel = scanDirectory(root).map((f) => relative(process.cwd(), f));
    expect(rel.every((p) => !p.startsWith("/"))).toBe(true);
    const r = compileScrml({ inputFiles: rel, write: false, log: () => {} });
    expect(isGuarded(r, root, "pages/about.scrml")).toBe(true);
  });

  test("an import reaching OUTSIDE the project does not move the build root up to a pages/ ancestor", () => {
    const base = join(_tmp.root, "gather");
    mkdirSync(join(base, "shared"), { recursive: true });
    writeFileSync(join(base, "shared", "banner.scrml"), "${\n  export const Banner = <div>banner-marker</div>\n}\n");
    const root = writeProject("gather/pages/f6", {
      ...APP,
      "app.scrml": `<program auth="required">\n\${ import { Banner } from '../../shared/banner.scrml' }\n<Banner/>\n<p>home-marker</p>\n</program>\n`,
    });
    const r = compile(root);
    // The gathered file IS in the compile set (common directory = …/gather) …
    expect([...r.outputs.keys()].some((k) => k.endsWith("banner.scrml"))).toBe(true);
    // … and the build root stays the project directory.
    expect(isGuarded(r, root, "pages/about.scrml")).toBe(true);
  });

  test("a _layout.scrml wrapper is still not gated as a page (under a pages/ ancestor)", () => {
    const root = writeProject("layout/pages/f7", {
      ...APP,
      "pages/_layout.scrml": `<div class="shell"><p>layout-marker</p></div>\n`,
    });
    const r = compile(root);
    expect(isGuarded(r, root, "pages/about.scrml")).toBe(true);
    expect(isGuarded(r, root, "pages/_layout.scrml")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real route directories inside the build root keep working
// ---------------------------------------------------------------------------

describe("route directories INSIDE the build root", () => {
  test("a nested pages/admin/pages/x.scrml (a repeated route-dir name) stays a gated route file", () => {
    const root = writeProject("nested/pages/f8", {
      ...APP,
      "pages/admin/pages/x.scrml": `<page>\n<p>x-marker</p>\n</page>\n`,
    });
    const r = compile(root);
    expect(isGuarded(r, root, "pages/admin/pages/x.scrml")).toBe(true);
    expect(isGuarded(r, root, "pages/about.scrml")).toBe(true);
  });

  test("a legacy routes/ directory inside the build root is a route directory", () => {
    const root = writeProject("legacy/pages/f9", {
      "app.scrml": APP["app.scrml"],
      "routes/about.scrml": APP["pages/about.scrml"],
      "routes/login.scrml": APP["pages/login.scrml"],
    });
    const r = compile(root);
    expect(isGuarded(r, root, "routes/about.scrml")).toBe(true);
    expect(isGuarded(r, root, "routes/login.scrml")).toBe(false);
  });

  test("an entry file inside the build root's pages/ is a route file (not the application program)", () => {
    const root = writeProject("entry-in-pages", {
      "pages/index.scrml": APP["app.scrml"],
      "pages/about.scrml": APP["pages/about.scrml"],
      "pages/login.scrml": APP["pages/login.scrml"],
      "side.scrml": `<p>side-marker</p>\n`,
    });
    const r = compile(root, { buildRoot: root });
    // §40.2: a <program> in a route file governs that file only; nothing is inherited.
    expect(isGuarded(r, root, "pages/index.scrml")).toBe(true);
    expect(isGuarded(r, root, "pages/about.scrml")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The auth warnings no longer false-fire under a pages/ ancestor
// ---------------------------------------------------------------------------

describe("auth warnings under a pages/ ancestor", () => {
  test("W-AUTH-LOGIN-REDIRECT-AMBIGUOUS: the application program answers; a route file's own program does not make it ambiguous", () => {
    const root = writeProject("ambig/pages/f10", {
      "app.scrml": `<program auth="required" loginRedirect="/signin">\n<p>home-marker</p>\n</program>\n`,
      "pages/about.scrml": APP["pages/about.scrml"],
      "pages/signin.scrml": `<page auth="none">\n<p>signin-marker</p>\n</page>\n`,
      "pages/tool.scrml": `<program loginRedirect="/elsewhere">\n<p>tool-marker</p>\n</program>\n`,
    });
    const r = compile(root);
    expect(codes(r)).not.toContain("W-AUTH-LOGIN-REDIRECT-AMBIGUOUS");
    expect(codes(r)).not.toContain("W-AUTH-LOGIN-MISSING");
    expect(serverOf(r, root, "pages/about.scrml")).toContain("/signin");
  });

  test("W-AUTH-REDIRECT-LOOP fires for a real loop (an unannotated login page under a required app) — and only then", () => {
    const loop = writeProject("loop/pages/f11", {
      ...APP,
      "pages/login.scrml": `<page>\n<p>login-marker</p>\n</page>\n`,
    });
    const r = compile(loop);
    const d = diag(r, "W-AUTH-REDIRECT-LOOP");
    expect(d.length).toBe(1);
    expect(d[0].filePath ?? d[0].span?.file).toContain("login.scrml");

    const ok = writeProject("noloop/pages/f12", APP);
    expect(codes(compile(ok))).not.toContain("W-AUTH-REDIRECT-LOOP");
  });
});

// ---------------------------------------------------------------------------
// W-AUTH-REQUIRED-NOT-INHERITED (g-required-program-with-no-identified-app-root-is-silent)
// ---------------------------------------------------------------------------

describe("W-AUTH-REQUIRED-NOT-INHERITED", () => {
  const ENTRY_IN_PAGES = {
    "pages/index.scrml": APP["app.scrml"],
    "pages/about.scrml": APP["pages/about.scrml"],
    "pages/login.scrml": APP["pages/login.scrml"],
  };

  test("no application <program> identified: warns on the route file's required <program>, naming the public page and the build root", () => {
    const root = writeProject("w-noroot", ENTRY_IN_PAGES);
    const r = compile(root, { buildRoot: root });
    const d = diag(r, "W-AUTH-REQUIRED-NOT-INHERITED");
    expect(d.length).toBe(1);
    expect(d[0].severity).toBe("warning");
    expect(d[0].message).toContain("No application <program> is identified");
    expect(d[0].message).toContain("about.scrml");
    expect(d[0].message).not.toContain("login.scrml"); // declares auth="none" — not a member it names
    expect(d[0].message).toContain(root.replace(/\\/g, "/"));
    expect(r.errors.filter((e) => e.severity !== "warning")).toEqual([]); // a warning: the build succeeds
  });

  test("a public application <program> elsewhere: the message names it", () => {
    const root = writeProject("w-publicroot", { ...ENTRY_IN_PAGES, "lib/x.scrml": `<program>\n<p>lib-marker</p>\n</program>\n` });
    const r = compile(root, { buildRoot: root });
    const d = diag(r, "W-AUTH-REQUIRED-NOT-INHERITED");
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("does not declare auth=\"required\"");
    expect(d[0].message).toContain("x.scrml");
  });

  test("silent when the application program is required (members are gated) — the control", () => {
    const root = writeProject("w-ctl", APP);
    expect(codes(compile(root))).not.toContain("W-AUTH-REQUIRED-NOT-INHERITED");
  });

  test("silent when every other page declares its own auth= (nothing is served by omission)", () => {
    const root = writeProject("w-allannotated", {
      "pages/index.scrml": APP["app.scrml"],
      "pages/login.scrml": APP["pages/login.scrml"],
      "pages/about.scrml": `<page auth="optional">\n<p>about-marker</p>\n</page>\n`,
    });
    expect(codes(compile(root, { buildRoot: root }))).not.toContain("W-AUTH-REQUIRED-NOT-INHERITED");
  });
});

// ---------------------------------------------------------------------------
// S445 review F1: a FLAT multi-page app living in a directory named `pages`
// (app.scrml + about.scrml + login.scrml side by side, no pages/ below). Before the
// fix every entry form but `compile <dir>` / `build <dir>` inferred the root one
// level up, made app.scrml a route file, and served /about anonymously.
// ---------------------------------------------------------------------------

const FLAT = {
  "app.scrml": APP["app.scrml"],
  "about.scrml": APP["pages/about.scrml"],
  "login.scrml": APP["pages/login.scrml"],
};

function cli(cwd, args) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

describe("a flat multi-page app in a directory named pages (every entry form)", () => {
  test("compileScrml with a file list and no buildRoot", () => {
    const root = writeProject("flat-api/x/pages", FLAT);
    const r = compileScrml({ inputFiles: Object.keys(FLAT).map((f) => join(root, f)), write: false, log: () => {} });
    expect(isGuarded(r, root, "about.scrml")).toBe(true);
    expect(isGuarded(r, root, "login.scrml")).toBe(false);
    expect(codes(r)).not.toContain("W-AUTH-REQUIRED-NOT-INHERITED");
  });

  const FORMS = [
    ["files", ["compile", "app.scrml", "about.scrml", "login.scrml"]],
    ["file-and-dir", ["compile", "./app.scrml", "."]],
    ["dir", ["compile", "."]],
    ["build", ["build", "."]],
  ];
  for (const [label, args] of FORMS) {
    test(`scrml ${args.join(" ")}`, () => {
      const root = writeProject(`flat-cli-${label}/x/pages`, FLAT);
      const out = join(root, "out");
      const r = cli(root, [...args, "-o", out]);
      expect(r.code).toBe(0);
      expect(readFileSync(join(out, "about.server.js"), "utf8")).toContain("export const _scrml_protected_document");
      expect(r.out).not.toContain("W-AUTH-REQUIRED-NOT-INHERITED");
    });
  }

  test("the <page> files of a pages/ directory compiled on their own still root one level up", () => {
    const root = writeProject("flat-pages-only", {
      "app.scrml": APP["app.scrml"],
      "pages/about.scrml": APP["pages/about.scrml"],
      "pages/login.scrml": APP["pages/login.scrml"],
    });
    // Only the two pages — no application entry among them — so their root is the
    // project, pages/login.scrml is the route /login, and /login resolves.
    const r = compileScrml({
      inputFiles: [join(root, "pages/about.scrml"), join(root, "pages/login.scrml")],
      write: false,
      log: () => {},
    });
    expect(codes(r)).not.toContain("W-AUTH-LOGIN-MISSING");
  });
});

describe("W-AUTH-REQUIRED-NOT-INHERITED names the build root actually used and how it was chosen", () => {
  const ENTRY_IN_PAGES = {
    "pages/index.scrml": APP["app.scrml"],
    "pages/about.scrml": APP["pages/about.scrml"],
  };
  test("a given root", () => {
    const root = writeProject("w-given", ENTRY_IN_PAGES);
    const [d] = diag(compile(root, { buildRoot: root }), "W-AUTH-REQUIRED-NOT-INHERITED");
    expect(d.message).toContain("the build root the compiler was given");
    expect(d.message).toContain(`"${root.replace(/\\/g, "/")}"`);
    expect(d.message).toContain(`the route file "pages/index.scrml"`);
    expect(d.message).toContain("compile the project directory");
  });
  test("an inferred root", () => {
    // side.scrml (bare markup at the top) keeps the inferred root at the project
    // directory; with only the pages/ files the inferred root would be pages/ itself
    // and index.scrml — an entry file directly in it — would be the application's.
    const root = writeProject("w-inferred", { ...ENTRY_IN_PAGES, "side.scrml": `<p>side-marker</p>\n` });
    const [d] = diag(compile(root), "W-AUTH-REQUIRED-NOT-INHERITED");
    expect(d.message).toContain("the build root inferred from the input files");
  });
});

// ---------------------------------------------------------------------------
// Served over HTTP: `scrml build <dir>` from a …/pages/<x>/ path
// ---------------------------------------------------------------------------

const PROBE = `
const dist = process.argv[2];
process.chdir(dist);
const store = (globalThis.__scrml_session_store ??= new Map());
store.set("sid-alice", { userId: 1, role: "user" });
const s0 = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = s0.port; s0.stop(true);
process.env.PORT = String(port);
await import(dist + "/_server.js");
const base = "http://localhost:" + port;
const serverSrc = await Bun.file(dist + "/about.server.js").text();
const cookieName = serverSrc.includes("__Host-scrml_sid") ? "__Host-scrml_sid" : "scrml_sid";
const get = async (path, cookie) => {
  const r = await fetch(base + path, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  const t = await r.text();
  const m = t.match(/([a-z]+-marker)/);
  return { status: r.status, location: r.headers.get("location"), marker: m ? m[1] : null };
};
const out = {
  anonAbout: await get("/about"),
  anonLogin: await get("/login"),
  authedAbout: await get("/about", cookieName + "=sid-alice"),
};
console.log(JSON.stringify(out));
process.exit(0);
`;

describe("served over HTTP from a …/pages/<x>/ project path (scrml build)", () => {
  let res;
  beforeAll(() => {
    const root = writeProject("http/pages/f2", APP);
    const dist = join(root, "dist");
    const b = Bun.spawnSync(["bun", CLI, "build", root, "-o", dist], { stdout: "pipe", stderr: "pipe" });
    if (b.exitCode !== 0) throw new Error(`scrml build failed:\n${b.stdout}\n${b.stderr}`);
    res = { build: b.stdout.toString() + b.stderr.toString() };
    writeFileSync(join(root, "probe.mjs"), PROBE);
    const p = Bun.spawnSync(["bun", join(root, "probe.mjs"), dist], { stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`probe failed:\n${p.stdout}\n${p.stderr}`);
    const lines = p.stdout.toString().trim().split("\n");
    res.http = JSON.parse(lines[lines.length - 1]);
  }, 90_000);

  test("anonymous GET /about → 302 to /login with no body (was 200 with the page)", () => {
    expect(res.http.anonAbout).toEqual({ status: 302, location: "/login", marker: null });
  });

  test("GET /login → 200 (the login page stays reachable)", () => {
    expect(res.http.anonLogin).toEqual({ status: 200, location: null, marker: "login-marker" });
  });

  test("an authenticated viewer gets /about", () => {
    expect(res.http.authedAbout).toEqual({ status: 200, location: null, marker: "about-marker" });
  });

  test("the build reports no false W-AUTH-LOGIN-MISSING", () => {
    expect(res.build).not.toContain("W-AUTH-LOGIN-MISSING");
  });
});
