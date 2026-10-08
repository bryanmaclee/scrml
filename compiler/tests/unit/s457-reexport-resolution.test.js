/**
 * s457 (§21.4) — re-export resolution follows ES rules ("Re-export follows standard ES
 * module `export { name } from 'source'` syntax"): an explicit export wins over every
 * `export *`; `export *` never carries `default`; a name two stars bind DIFFERENTLY is
 * ambiguous (not exported); a cycle binds nothing. `buildExportRegistry` enumerates a
 * star's names so `import { x } from` a star re-exporter validates (no false E-IMPORT-004).
 */

import { describe, test, expect } from "bun:test";
import {
  resolveExportedBinding,
  exportedNamesOf,
  localReExportEdges,
  isReExportedByAnother,
  buildExportRegistry,
  validateImports,
} from "../../src/module-resolver.js";

const fn = (name) => ({ name, localName: name, kind: "function", reExportSource: null });
const re = (name, src, local = name) => ({ name, localName: local, kind: "re-export", reExportSource: src, reExportSpecifier: "./" + src.slice(1) });
const star = (src) => ({ name: "*", kind: "re-export-all", isReExportAll: true, reExportSource: src, reExportSpecifier: "./" + src.slice(1) });

// keys are posix absolute paths ("/x.scrml")
function graphOf(obj) {
  const g = new Map();
  for (const [k, exports] of Object.entries(obj)) g.set(k, { imports: [], exports });
  return g;
}

describe("resolveExportedBinding", () => {
  const g = graphOf({
    "/c.scrml": [fn("w"), fn("dup"), fn("default")],
    "/d.scrml": [fn("dup"), fn("only_d")],
    "/b.scrml": [re("helper", "/c.scrml", "w"), star("/c.scrml"), star("/d.scrml"), fn("own")],
    "/x.scrml": [re("loop", "/y.scrml")],
    "/y.scrml": [re("loop", "/x.scrml")],
  });

  test("a named re-export chases to the declaring module", () => {
    expect(resolveExportedBinding(g, "/b.scrml", "helper")).toEqual({ filePath: "/c.scrml", name: "w", localName: "w", kind: "function" });
  });
  test("a star name resolves; an explicit export wins", () => {
    expect(resolveExportedBinding(g, "/b.scrml", "only_d")?.filePath).toBe("/d.scrml");
    expect(resolveExportedBinding(g, "/b.scrml", "own")?.filePath).toBe("/b.scrml");
  });
  test("two stars, two bindings: ambiguous; `default` never through a star; a cycle binds nothing", () => {
    expect(resolveExportedBinding(g, "/b.scrml", "dup")).toBeNull();
    expect(resolveExportedBinding(g, "/b.scrml", "default")).toBeNull();
    expect(resolveExportedBinding(g, "/x.scrml", "loop")).toBeNull();
  });
  test("exportedNamesOf / localReExportEdges expand the stars and drop the ambiguous name", () => {
    const names = [...exportedNamesOf(g, "/b.scrml")].sort();
    expect(names).toEqual(["helper", "only_d", "own", "w"]);
    const edges = localReExportEdges(g, "/b.scrml");
    expect(edges.map((e) => [e.absSource, e.names.map((n) => `${n.imported}->${n.exported}`)])).toEqual([
      ["/c.scrml", ["w->helper", "w->w"]],
      ["/d.scrml", ["only_d->only_d"]],
    ]);
    expect(isReExportedByAnother(g, "/c.scrml")).toBe(true);
    expect(isReExportedByAnother(g, "/b.scrml")).toBe(false);
  });
});

describe("buildExportRegistry enumerates `export *` (no false E-IMPORT-004)", () => {
  test("an import of a star-re-exported name validates; an ambiguous one does not", () => {
    const g = graphOf({
      "/c.scrml": [fn("w"), fn("dup")],
      "/d.scrml": [fn("dup")],
      "/b.scrml": [star("/c.scrml"), star("/d.scrml")],
    });
    g.set("/a.scrml", { imports: [{ names: ["w", "dup"], source: "./b.scrml", absSource: "/b.scrml", span: null }], exports: [] });
    const reg = buildExportRegistry(g);
    expect(reg.get("/b.scrml").get("w")).toMatchObject({ kind: "function", category: "function" });
    expect(reg.get("/b.scrml").has("dup")).toBe(false);
    expect(validateImports(g, reg).map((e) => e.message.match(/`(\w+)`/)[1])).toEqual(["dup"]);
  });
});
