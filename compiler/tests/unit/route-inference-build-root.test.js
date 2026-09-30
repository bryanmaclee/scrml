/**
 * S445 — the build-root rule (SPEC §40.8 "The build root"; route-inference.ts
 * `resolveBuildRoot`). Route files are classified relative to the build root; a
 * given root is used as is, and with none the root is the directory of the
 * application's entry file. With no single entry file the pre-S445 classification
 * (a pages/ or routes/ component anywhere in the path) stands.
 *
 * g-app-root-route-prefix-matched-on-absolute-path: before S445 `/pages/` and
 * `/routes/` were searched in the ABSOLUTE path, so a directory named `pages` or
 * `routes` above the project turned the entry file into a route file.
 * End-to-end coverage: compiler/tests/integration/app-root-build-relative.test.js.
 */

import { describe, test, expect } from "bun:test";
import { runRI, buildPageRouteTree, resolveBuildRoot } from "../../src/route-inference.js";

// A page (no <program>) or, with `program: true`, a file whose first top-level
// node is a <program> — the application-entry shape.
function makeFileAST(filePath, { program = false } = {}) {
  const span = { file: filePath, start: 0, end: 0, line: 1, col: 1 };
  return {
    filePath,
    nodes: program
      ? [{ id: 1, kind: "markup", tag: "program", attrs: [], children: [], span }]
      : [{ id: 1, kind: "logic", body: [], span }],
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    spans: new Map(),
  };
}
const prog = (p) => makeFileAST(p, { program: true });
const page = (p) => makeFileAST(p);
const urls = (pages) => Object.fromEntries([...pages].map(([k, v]) => [k, v.urlPattern]));

describe("resolveBuildRoot", () => {
  test("given root: used as is", () => {
    const r = resolveBuildRoot([prog("/x/pages/f2/app.scrml")], "/x/pages/f2/");
    expect(r).toMatchObject({ origin: "given", root: "/x/pages/f2" });
    expect(r.candidates.map((f) => f.filePath)).toEqual(["/x/pages/f2/app.scrml"]);
  });

  test("one entry outside any pages/routes directory: the root is its directory", () => {
    const r = resolveBuildRoot([prog("/p/app.scrml"), page("/p/pages/a.scrml")]);
    expect(r).toMatchObject({ origin: "inferred", root: "/p" });
  });

  test("the entry under a pages/ ANCESTOR: still the entry (shallowest <program>)", () => {
    const r = resolveBuildRoot([prog("/x/pages/f2/app.scrml"), page("/x/pages/f2/pages/a.scrml")]);
    expect(r).toMatchObject({ origin: "inferred", root: "/x/pages/f2" });
  });

  test("a deeper route file's own <program> does not compete with the shallowest", () => {
    const r = resolveBuildRoot([prog("/x/pages/f/app.scrml"), prog("/x/pages/f/pages/tool.scrml")]);
    expect(r.candidates.map((f) => f.filePath)).toEqual(["/x/pages/f/app.scrml"]);
  });

  test("no <program>: no root (legacy classification)", () => {
    expect(resolveBuildRoot([page("/e/pages/customer/home.scrml")])).toMatchObject({ origin: "none", root: "" });
  });

  test("several <program>s at the same depth: no root (§40.2 ambiguity)", () => {
    const r = resolveBuildRoot([prog("/p/routes/index.scrml"), prog("/p/routes/loads.scrml")]);
    expect(r.origin).toBe("none");
    expect(r.candidates.length).toBe(2);
  });
});

describe("buildPageRouteTree under the build-root rule", () => {
  test("a project under /x/pages/f2/: app.scrml is /, pages/about.scrml is /about", () => {
    const pages = buildPageRouteTree([prog("/x/pages/f2/app.scrml"), page("/x/pages/f2/pages/about.scrml")]);
    // Before S445: "/f2/app" and "/f2/pages/about".
    expect(urls(pages)).toEqual({ "/x/pages/f2/app.scrml": "/", "/x/pages/f2/pages/about.scrml": "/about" });
  });

  test("a flat route directory with its entry beside its pages: /about, /login", () => {
    const pages = buildPageRouteTree([
      prog("/x/pages/app.scrml"),
      page("/x/pages/about.scrml"),
      page("/x/pages/login.scrml"),
    ]);
    expect(pages.get("/x/pages/about.scrml").urlPattern).toBe("/about");
    expect(pages.get("/x/pages/login.scrml").urlPattern).toBe("/login");
  });

  test("a project directory named pages holding its own pages/: /about (not /pages/about)", () => {
    const pages = buildPageRouteTree([prog("/x/pages/app.scrml"), page("/x/pages/pages/about.scrml")]);
    expect(pages.get("/x/pages/pages/about.scrml").urlPattern).toBe("/about");
  });

  test("a nested pages/admin/pages/x.scrml stays /admin/pages/x (first route dir below the root)", () => {
    const pages = buildPageRouteTree([prog("/x/pages/f2/app.scrml"), page("/x/pages/f2/pages/admin/pages/x.scrml")]);
    expect(pages.get("/x/pages/f2/pages/admin/pages/x.scrml").urlPattern).toBe("/admin/pages/x");
  });

  test("the routes/ tiebreak still applies below the root", () => {
    const pages = buildPageRouteTree([prog("/x/pages/proj/app.scrml"), page("/x/pages/proj/pages/routes/foo.scrml")]);
    expect(pages.get("/x/pages/proj/pages/routes/foo.scrml").urlPattern).toBe("/foo");
  });

  test("no <program>: pre-S445 classification (a lone nested page keeps its URL)", () => {
    const pages = buildPageRouteTree([page("/e/23/pages/customer/home.scrml")]);
    expect(pages.get("/e/23/pages/customer/home.scrml").urlPattern).toBe("/customer/home");
  });

  test("Windows separators", () => {
    const files = [prog("C:\\pages\\proj\\app.scrml"), page("C:\\pages\\proj\\pages\\users\\[id].scrml")];
    for (const root of ["C:\\pages\\proj", "C:/pages/proj", "C:\\pages\\proj\\", undefined]) {
      const pages = buildPageRouteTree(files, root);
      expect(pages.get("C:\\pages\\proj\\app.scrml").urlPattern).toBe("/");
      expect(pages.get("C:\\pages\\proj\\pages\\users\\[id].scrml").urlPattern).toBe("/users/:id");
    }
  });

  test("_layout.scrml under the real route dir is excluded and binds (ancestor pages/ present)", () => {
    const pages = buildPageRouteTree([
      page("/x/pages/f2/pages/_layout.scrml"),
      page("/x/pages/f2/pages/index.scrml"),
      prog("/x/pages/f2/app.scrml"),
    ]);
    expect(pages.has("/x/pages/f2/pages/_layout.scrml")).toBe(false);
    expect(pages.get("/x/pages/f2/pages/index.scrml").urlPattern).toBe("/");
    expect(pages.get("/x/pages/f2/pages/index.scrml").layoutFilePath).toBe("/x/pages/f2/pages/_layout.scrml");
  });

  test("a file outside a given build root is not a route file", () => {
    const pages = buildPageRouteTree([page("/elsewhere/pages/x.scrml"), page("/proj/app.scrml")], "/proj");
    expect(pages.get("/elsewhere/pages/x.scrml").urlPattern).toBe("/");
  });

  test("runRI takes a given build root from its input", () => {
    const files = [page("/x/pages/f2/pages/about.scrml"), page("/x/pages/f2/app.scrml")];
    const { routeMap } = runRI({ files, protectAnalysis: { views: new Map() }, buildRoot: "/x/pages/f2" });
    expect(routeMap.pages.get("/x/pages/f2/pages/about.scrml").urlPattern).toBe("/about");
    expect(routeMap.pages.get("/x/pages/f2/app.scrml").urlPattern).toBe("/");
  });
});
