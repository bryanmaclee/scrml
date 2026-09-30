/**
 * S445 — route files are classified RELATIVE TO THE BUILD ROOT (§40.2 / §40.8).
 *
 * g-app-root-route-prefix-matched-on-absolute-path: before S445 `findRoutePrefix`
 * searched `/pages/` and `/routes/` in the ABSOLUTE path, so a directory named
 * `pages` or `routes` above the project turned every file into a route file (no
 * application `<program>` identified → the member pages of a required app public).
 * End-to-end coverage: compiler/tests/integration/app-root-build-relative.test.js.
 */

import { describe, test, expect } from "bun:test";
import { runRI, buildPageRouteTree, computeBuildRoot } from "../../src/route-inference.js";

function makeFileAST(filePath) {
  return {
    filePath,
    nodes: [{ id: 1, kind: "logic", body: [], span: { file: filePath, start: 0, end: 0, line: 1, col: 1 } }],
    imports: [],
    exports: [],
    components: [],
    typeDecls: [],
    spans: new Map(),
  };
}

describe("buildPageRouteTree — the build root's ancestors are never route directories", () => {
  test("a project under /x/pages/f2/: app.scrml is not a route file; pages/about.scrml is /about", () => {
    const files = [makeFileAST("/x/pages/f2/app.scrml"), makeFileAST("/x/pages/f2/pages/about.scrml")];
    const pages = buildPageRouteTree(files, "/x/pages/f2");
    expect(pages.get("/x/pages/f2/app.scrml").urlPattern).toBe("/");
    // Before S445: "/f2/pages/about" (the relative path was taken after the FIRST /pages/).
    expect(pages.get("/x/pages/f2/pages/about.scrml").urlPattern).toBe("/about");
  });

  test("the implicit build root (no argument) gives the same answer", () => {
    const files = [makeFileAST("/x/routes/f3/app.scrml"), makeFileAST("/x/routes/f3/pages/about.scrml")];
    const pages = buildPageRouteTree(files);
    expect(pages.get("/x/routes/f3/app.scrml").urlPattern).toBe("/");
    expect(pages.get("/x/routes/f3/pages/about.scrml").urlPattern).toBe("/about");
  });

  test("a nested pages/admin/pages/x.scrml inside the build root stays a route (first route dir wins)", () => {
    const files = [makeFileAST("/x/pages/f2/app.scrml"), makeFileAST("/x/pages/f2/pages/admin/pages/x.scrml")];
    const pages = buildPageRouteTree(files, "/x/pages/f2");
    expect(pages.get("/x/pages/f2/pages/admin/pages/x.scrml").urlPattern).toBe("/admin/pages/x");
  });

  test("the routes/ tiebreak still applies inside the build root", () => {
    const files = [makeFileAST("/x/pages/proj/pages/routes/foo.scrml")];
    const pages = buildPageRouteTree(files, "/x/pages/proj");
    // relative "pages/routes/foo.scrml": routes/ is looked up first → /foo
    expect(pages.get("/x/pages/proj/pages/routes/foo.scrml").urlPattern).toBe("/foo");
  });

  test("Windows separators: C:\\pages\\proj is an ancestor, C:\\pages\\proj\\pages the route dir", () => {
    const files = [makeFileAST("C:\\pages\\proj\\app.scrml"), makeFileAST("C:\\pages\\proj\\pages\\users\\[id].scrml")];
    for (const root of ["C:\\pages\\proj", "C:/pages/proj", "C:\\pages\\proj\\", undefined]) {
      const pages = buildPageRouteTree(files, root);
      expect(pages.get("C:\\pages\\proj\\app.scrml").urlPattern).toBe("/");
      expect(pages.get("C:\\pages\\proj\\pages\\users\\[id].scrml").urlPattern).toBe("/users/:id");
    }
  });

  test("_layout.scrml under the real route dir is still excluded and still binds (ancestor pages/ present)", () => {
    const files = [
      makeFileAST("/x/pages/f2/pages/_layout.scrml"),
      makeFileAST("/x/pages/f2/pages/index.scrml"),
      makeFileAST("/x/pages/f2/app.scrml"),
    ];
    const pages = buildPageRouteTree(files, "/x/pages/f2");
    expect(pages.has("/x/pages/f2/pages/_layout.scrml")).toBe(false);
    expect(pages.get("/x/pages/f2/pages/index.scrml").urlPattern).toBe("/");
    expect(pages.get("/x/pages/f2/pages/index.scrml").layoutFilePath).toBe("/x/pages/f2/pages/_layout.scrml");
  });

  test("a file outside an explicit build root is not a route file", () => {
    const files = [makeFileAST("/elsewhere/pages/x.scrml"), makeFileAST("/proj/app.scrml")];
    const pages = buildPageRouteTree(files, "/proj");
    expect(pages.get("/elsewhere/pages/x.scrml").urlPattern).toBe("/");
  });

  test("runRI takes the build root from its input", () => {
    const files = [makeFileAST("/x/pages/f2/pages/about.scrml"), makeFileAST("/x/pages/f2/app.scrml")];
    const { routeMap } = runRI({ files, protectAnalysis: { views: new Map() }, buildRoot: "/x/pages/f2" });
    expect(routeMap.pages.get("/x/pages/f2/pages/about.scrml").urlPattern).toBe("/about");
    expect(routeMap.pages.get("/x/pages/f2/app.scrml").urlPattern).toBe("/");
  });
});

describe("computeBuildRoot", () => {
  test("one file → its directory; N files → their segment-aligned common directory", () => {
    expect(computeBuildRoot(["/a/b/c.scrml"])).toBe("/a/b");
    expect(computeBuildRoot(["/a/b/c.scrml", "/a/b/sub/d.scrml"])).toBe("/a/b");
    expect(computeBuildRoot(["/a/bc/x.scrml", "/a/b/y.scrml"])).toBe("/a");
    expect(computeBuildRoot(["/p/x.scrml", "/q/y.scrml"])).toBe("");
    expect(computeBuildRoot([])).toBe("");
  });

  test("a project that LIVES in a directory named pages keeps its own root", () => {
    expect(computeBuildRoot(["/x/pages/app.scrml", "/x/pages/pages/about.scrml"])).toBe("/x/pages");
    expect(computeBuildRoot(["/x/pages/f2/app.scrml", "/x/pages/f2/pages/about.scrml"])).toBe("/x/pages/f2");
  });

  test("the files of one route directory compiled on their own: the root is its parent", () => {
    expect(computeBuildRoot(["/p/routes/index.scrml", "/p/routes/loads.scrml"])).toBe("/p");
    expect(computeBuildRoot(["/p/pages/about.scrml"])).toBe("/p");
    expect(computeBuildRoot(["/p/pages/about.scrml", "/p/pages/users/[id].scrml"])).toBe("/p");
  });

  test("an application entry file directly in a pages/-named common dir keeps the root there (S445 review F1)", () => {
    const flat = ["/x/pages/app.scrml", "/x/pages/about.scrml", "/x/pages/login.scrml"];
    const isEntry = (p) => p.endsWith("/app.scrml");
    expect(computeBuildRoot(flat, isEntry)).toBe("/x/pages");
    // No entry among them: the route-set rule applies.
    expect(computeBuildRoot(flat)).toBe("/x");
    // An entry BELOW the common dir does not block the rule (it is under the route dir).
    expect(computeBuildRoot(["/p/pages/a.scrml", "/p/pages/sub/app.scrml"], (p) => p.endsWith("app.scrml"))).toBe("/p");
  });

  test("only the root's OWN last segment is inspected — never a farther ancestor", () => {
    expect(computeBuildRoot(["/x/pages/f2/app.scrml", "/x/pages/f2/side.scrml"])).toBe("/x/pages/f2");
  });

  test("Windows separators are normalized", () => {
    expect(computeBuildRoot(["C:\\pages\\proj\\app.scrml", "C:\\pages\\proj\\pages\\a.scrml"])).toBe("C:/pages/proj");
  });
});
