/**
 * S458 — review fixes on the s457 `.scrml` re-export work (§21.3 / §21.4).
 *
 *   F1  A re-export (`export { X } from`, `export * from`) is an edge of the import graph:
 *       a cycle it closes is E-IMPORT-002. §21.3: "Circular imports SHALL be a compile
 *       error (E-IMPORT-002). The compiler SHALL detect cycles in the import graph before
 *       any stage runs and report all files in the cycle." Before: such a program compiled
 *       clean and broke at run time (page chunks in an unsatisfiable order; `_server.js`
 *       SyntaxError at boot).
 *   F2  Re-exporting a name the source does not export is E-IMPORT-004 at the re-export.
 *       §21.3: "Importing a name that is not exported by the target file SHALL be a
 *       compile error (E-IMPORT-004 …)". Before: silent.
 *   F3  `resolveExportedBinding` is memoized; an `export *` lattice no longer costs
 *       2^depth (depth 16 × 11 names took ~35 s).
 *   F4  A name two `export *` bind DIFFERENTLY is reported as ambiguous (both stars named),
 *       and the derived W-SERVER-IMPORT-UNEMITTED on that pair is not emitted.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import {
  detectCircularImports,
  resolveExportedBinding,
  buildExportRegistry,
  validateReExports,
  ambiguousStarSources,
  localReExportEdges,
} from "../../src/module-resolver.js";

const D = "$";
let ROOT;
beforeAll(() => { ROOT = mkdtempSync(join(tmpdir(), "s458-reexport-")); });
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

function compile(name, files, entry = "a.scrml") {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, src] of Object.entries(files)) writeFileSync(join(dir, f), src);
  const r = compileScrml({ inputFiles: [join(dir, entry)], outputDir: join(dir, "dist"), write: false, log: () => {} });
  const diags = [...(r.errors ?? []), ...(r.warnings ?? [])];
  return {
    errors: diags.filter((e) => (e.severity ?? "error") === "error").map((e) => e.code),
    codes: diags.map((e) => e.code),
    msg: (code) => diags.filter((e) => e.code === code).map((e) => e.message),
  };
}

const page = (imp, from, use) => `<program>\n${D}{\n    import { ${imp} } from "${from}"\n}\n<p>${D}{${use}}</p>\n</program>\n`;

const fn = (name) => ({ name, localName: name, kind: "function", reExportSource: null });
const cnst = (name) => ({ name, localName: name, kind: "const", reExportSource: null });
const re = (name, src, local = name) => ({ name, localName: local, kind: "re-export", reExportSource: src, reExportSpecifier: "." + src });
const star = (src) => ({ name: "*", kind: "re-export-all", isReExportAll: true, reExportSource: src, reExportSpecifier: "." + src });
function graphOf(obj) {
  const g = new Map();
  for (const [k, exports] of Object.entries(obj)) g.set(k, { imports: [], exports });
  return g;
}

describe("F1 — a re-export closes an import cycle (E-IMPORT-002)", () => {
  test("named re-export cycle with local exports on both sides (the review's reproducer)", () => {
    const r = compile("f1-named", {
      "x.scrml": `${D}{\n    export const A = "aa"\n    export { B } from "./y.scrml"\n}\n`,
      "y.scrml": `${D}{\n    export const B = "bb"\n    export { A } from "./x.scrml"\n}\n`,
      "a.scrml": page("A, B", "./x.scrml", "A + B"),
    });
    expect(r.errors).toContain("E-IMPORT-002");
    const m = r.msg("E-IMPORT-002").join("\n");
    expect(m).toContain("x.scrml -> y.scrml -> x.scrml");
    expect(m).toContain("re-export");
  });

  test("pure `export { K } from` cycle", () => {
    const r = compile("f1-pure", {
      "x.scrml": `${D}{\n    export { K } from "./y.scrml"\n}\n`,
      "y.scrml": `${D}{\n    export { K } from "./x.scrml"\n}\n`,
      "a.scrml": page("K", "./x.scrml", "K"),
    });
    expect(r.errors).toContain("E-IMPORT-002");
    // the cycle is the error; the unresolvable name is not reported a second time
    expect(r.errors).not.toContain("E-IMPORT-004");
  });

  test("`export *` cycle", () => {
    const r = compile("f1-star", {
      "x.scrml": `${D}{\n    export const A = "aa"\n    export * from "./y.scrml"\n}\n`,
      "y.scrml": `${D}{\n    export const B = "bb"\n    export * from "./x.scrml"\n}\n`,
      "a.scrml": page("A, B", "./x.scrml", "A + B"),
    });
    expect(r.errors).toContain("E-IMPORT-002");
  });

  test("mixed: x re-exports from y, y imports from x", () => {
    const r = compile("f1-mixed", {
      "x.scrml": `${D}{\n    export const A = "aa"\n    export { B } from "./y.scrml"\n}\n`,
      "y.scrml": `${D}{\n    import { A } from "./x.scrml"\n    export const B = A + "bb"\n}\n`,
      "a.scrml": page("A, B", "./x.scrml", "A + B"),
    });
    expect(r.errors).toContain("E-IMPORT-002");
  });

  test("a re-export chain without a cycle is clean; cycleFiles names every file in the cycle", () => {
    const r = compile("f1-chain", {
      "c.scrml": `${D}{\n    export const K = "kay"\n}\n`,
      "b.scrml": `${D}{\n    export { K } from "./c.scrml"\n}\n`,
      "a.scrml": page("K", "./b.scrml", "K"),
    });
    expect(r.errors).toEqual([]);
    const g = graphOf({ "/x.scrml": [re("K", "/y.scrml")], "/y.scrml": [re("K", "/z.scrml")], "/z.scrml": [star("/x.scrml")] });
    const errs = detectCircularImports(g);
    expect(errs.map((e) => e.code)).toEqual(["E-IMPORT-002"]);
    expect([...errs[0].cycleFiles].sort()).toEqual(["/x.scrml", "/y.scrml", "/z.scrml"]);
  });
});

describe("F2 — re-exporting a name the source does not export (E-IMPORT-004)", () => {
  test("named re-export of a missing name is reported at the re-export", () => {
    const r = compile("f2-missing", {
      "c.scrml": `${D}{\n    export const K = "kay"\n}\n`,
      "b.scrml": `${D}{\n    export { K, Nope } from "./c.scrml"\n}\n`,
      "a.scrml": page("K", "./b.scrml", "K"),
    });
    expect(r.errors).toEqual(["E-IMPORT-004"]);
    expect(r.msg("E-IMPORT-004")[0]).toContain("`Nope` is not exported by `./c.scrml`, so it cannot be re-exported");
  });

  test("a renamed re-export names the source-side name", () => {
    const g = graphOf({ "/c.scrml": [cnst("K")], "/b.scrml": [re("alias", "/c.scrml", "Gone")] });
    const errs = validateReExports(g);
    expect(errs.map((e) => e.code)).toEqual(["E-IMPORT-004"]);
    expect(errs[0].message).toContain("`Gone` is not exported by `./c.scrml`");
    expect(errs[0].message).toContain("export { Gone as alias }");
  });

  test("`export *` binds only what exists — never E-IMPORT-004; a source outside the graph is not judged", () => {
    const g = graphOf({ "/c.scrml": [cnst("K")], "/b.scrml": [star("/c.scrml"), re("ext", "/vendor.js")] });
    expect(validateReExports(g)).toEqual([]);
  });
});

describe("F3 — resolution is memoized (no 2^depth over an `export *` lattice)", () => {
  // level i has modules a/b; each stars both modules of level i+1; the leaf declares 11 names.
  function lattice(depth) {
    const obj = {};
    const names = Array.from({ length: 11 }, (_, i) => `N${i}`);
    obj[`/l${depth}a.scrml`] = names.map(cnst);
    obj[`/l${depth}b.scrml`] = [star(`/l${depth}a.scrml`)];
    for (let i = depth - 1; i >= 0; i--) {
      for (const s of ["a", "b"]) obj[`/l${i}${s}.scrml`] = [star(`/l${i + 1}a.scrml`), star(`/l${i + 1}b.scrml`)];
    }
    return { g: graphOf(obj), names, depth };
  }

  test("depth 16 × 11 names resolves and builds a registry quickly (was ~35 s)", () => {
    const { g, names, depth } = lattice(16);
    const t0 = performance.now();
    const reg = buildExportRegistry(g);
    for (const n of names) expect(resolveExportedBinding(g, "/l0a.scrml", n)?.filePath).toBe(`/l${depth}a.scrml`);
    const ms = performance.now() - t0;
    expect([...reg.get("/l0a.scrml").keys()].filter((k) => k !== "*").sort()).toEqual([...names].sort());
    expect(ms).toBeLessThan(5000);
  });

  test("an answer that passed through a cycle is not memoized for a different start", () => {
    // x: export * from y, export * from z; y: export * from x; z declares N.
    const g = graphOf({ "/x.scrml": [star("/y.scrml"), star("/z.scrml")], "/y.scrml": [star("/x.scrml")], "/z.scrml": [cnst("N")] });
    expect(resolveExportedBinding(g, "/x.scrml", "N")?.filePath).toBe("/z.scrml");
    expect(resolveExportedBinding(g, "/y.scrml", "N")?.filePath).toBe("/z.scrml");
  });
});

describe("F4 — a name two `export *` bind differently is AMBIGUOUS", () => {
  test("message names both stars; no derived W-SERVER-IMPORT-UNEMITTED", () => {
    const r = compile("f4-ambiguous", {
      "c.scrml": `${D}{\n    export server fn w() -> string {\n        return "c"\n    }\n}\n`,
      "d.scrml": `${D}{\n    export server fn w() -> string {\n        return "d"\n    }\n}\n`,
      "b.scrml": `${D}{\n    export * from "./c.scrml"\n    export * from "./d.scrml"\n}\n`,
      "a.scrml": `<program>\n${D}{\n    import { w } from "./b.scrml"\n}\nserver fn go() -> string {\n    return w()\n}\n<msg> = ""\n<button onclick=${D}{ @msg = go() }>go</button>\n</program>\n`,
    });
    expect(r.errors).toEqual(["E-IMPORT-004"]);
    const m = r.msg("E-IMPORT-004")[0];
    expect(m).toContain("`w` is ambiguous in `./b.scrml`");
    expect(m).toContain('`export * from "./c.scrml"` and `export * from "./d.scrml"`');
    expect(m).not.toContain("add `export w`");
    expect(r.codes).not.toContain("W-SERVER-IMPORT-UNEMITTED");
  });

  test("the same binding reached through two stars (a diamond) is not ambiguous", () => {
    const g = graphOf({
      "/c.scrml": [cnst("K")],
      "/d.scrml": [star("/c.scrml")],
      "/e.scrml": [star("/c.scrml")],
      "/b.scrml": [star("/d.scrml"), star("/e.scrml")],
    });
    expect(ambiguousStarSources(g, "/b.scrml", "K")).toBeNull();
    expect(resolveExportedBinding(g, "/b.scrml", "K")?.filePath).toBe("/c.scrml");
  });

  test("a named re-export of an ambiguous name says ambiguous too", () => {
    const g = graphOf({
      "/c.scrml": [fn("w")],
      "/d.scrml": [fn("w")],
      "/b.scrml": [star("/c.scrml"), star("/d.scrml")],
      "/x.scrml": [re("w", "/b.scrml")],
    });
    const errs = validateReExports(g);
    expect(errs.map((e) => e.code)).toEqual(["E-IMPORT-004"]);
    expect(errs[0].message).toContain("`w` is ambiguous in `./b.scrml`");
  });
});

// ---------------------------------------------------------------------------
// S458 re-review (N1 / N2 / N2b)
// ---------------------------------------------------------------------------

describe("N1 — a re-export whose file does not exist is E-IMPORT-006 at the re-export", () => {
  test("named: E-IMPORT-006 names the missing file at the re-exporter; no cascade E-IMPORT-004", () => {
    const r = compile("n1-named", {
      "m.scrml": `${D}{\n    export { M1 } from "./missing.scrml"\n}\n`,
      "a.scrml": page("M1", "./m.scrml", "M1"),
    });
    expect(r.errors).toEqual(["E-IMPORT-006"]);
    expect(r.msg("E-IMPORT-006")[0]).toContain("Cannot resolve re-export `./missing.scrml`");
  });

  test("`export *`: the missing star source is named (not only an E-IMPORT-004 at the importer)", () => {
    const r = compile("n1-star", {
      "m.scrml": `${D}{\n    export * from "./missing2.scrml"\n}\n`,
      "a.scrml": page("M2", "./m.scrml", "M2"),
    });
    expect(r.errors).toEqual(["E-IMPORT-006"]);
    expect(r.msg("E-IMPORT-006")[0]).toContain("`./missing2.scrml`");
  });

  test("the page script order / re-export edges never include a module outside the graph", () => {
    const g = graphOf({ "/m.scrml": [re("M1", "/missing.scrml"), star("/gone.scrml"), re("K", "/c.scrml")], "/c.scrml": [cnst("K")] });
    expect(localReExportEdges(g, "/m.scrml").map((e) => e.absSource)).toEqual(["/c.scrml"]);
  });
});

describe("N2 — a name reachable only through an unexpanded stdlib star says so", () => {
  test("`export * from \"scrml:data\"` then a named re-export of one of its names", () => {
    const r = compile("n2-stdlib-star", {
      "mine.scrml": `${D}{\n    export * from "scrml:data"\n}\n`,
      "b.scrml": `${D}{\n    export { tableFor, parseVariant } from "./mine.scrml"\n}\n`,
      "a.scrml": page("tableFor", "./b.scrml", "1"),
    });
    expect(r.errors).toEqual(["E-IMPORT-004", "E-IMPORT-004"]);
    const m = r.msg("E-IMPORT-004").find((x) => x.includes("parseVariant"));
    expect(m).toContain('only through `export * from "scrml:data"`, which is not expanded');
    expect(m).not.toContain("add `export parseVariant`");
  });
});

describe("N2b — no W-SERVER-IMPORT-UNEMITTED on a pair that already has a missing-name E-IMPORT-004", () => {
  const SERVER_PAGE = (from) => `<program>\n${D}{\n    import { nope } from "${from}"\n}\nserver fn go() -> string {\n    return nope()\n}\n<msg> = ""\n<button onclick=${D}{ @msg = go() }>go</button>\n</program>\n`;
  test("direct import of a missing name", () => {
    const r = compile("n2b-direct", {
      "c.scrml": `${D}{\n    export server fn w() -> string {\n        return "c"\n    }\n}\n`,
      "a.scrml": SERVER_PAGE("./c.scrml"),
    });
    expect(r.errors).toEqual(["E-IMPORT-004"]);
    expect(r.codes).not.toContain("W-SERVER-IMPORT-UNEMITTED");
  });
  test("import through a re-export of a missing name", () => {
    const r = compile("n2b-reexport", {
      "c.scrml": `${D}{\n    export const K = "k"\n}\n`,
      "b.scrml": `${D}{\n    export { K, nope } from "./c.scrml"\n}\n`,
      "a.scrml": SERVER_PAGE("./b.scrml"),
    });
    expect(r.errors).toEqual(["E-IMPORT-004"]);
    expect(r.codes).not.toContain("W-SERVER-IMPORT-UNEMITTED");
  });
});
