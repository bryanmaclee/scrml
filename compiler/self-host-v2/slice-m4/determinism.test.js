// determinism.test.js — s452-boot-determinism: the bootstrap compile is a PURE
// function of (the SET of source files, each a project-relative path + its
// text; the compiler; the explicit options — the entry and the printer's file
// names). SPEC §58.1: "No build axis outside `(source, buildStory)` —
// wall-clock time, environment variables, build-host identity, telemetry —
// SHALL participate in artifact content." §58.12 `*` gap 1 names the
// whole-compiler determinism audit this gate holds the bootstrap to.
//
// The gate:
//   (i)   one multi-file program compiled twice → byte-identical artifacts
//         (client JS + HTML), Core, ASTs, and diagnostics (order included);
//   (ii)  the same file set listed in every order → identical;
//   (iii) the same project on disk under two different absolute roots, each
//         compiled from its own working directory → identical, and no
//         absolute path in any artifact or diagnostic;
//   (iv)  a program with diagnostics in every file → one diagnostic order.
// The program has FOUR files whose path order (app, lib/accent, lib/dropdown,
// lib/openness) is NOT their link order (lib/accent, lib/openness,
// lib/dropdown, app), and two of whose libraries are independent (the import
// graph alone does not order them), so a driver that trusts the listed order,
// or sorts by path alone, is caught.

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadM2 } from "../slice-m2/harness.js";
import { frontEnd, projectSources, readSlice } from "../slice-m2/lowered.js";

const TYPE_LINE = "export type Openness:enum = { Closed, Opened }";

/** The §66.19.3 dropdown program, split so its link order differs from its path order. */
function program() {
  const lib = readSlice("src/lib/dropdown.scrml");
  const app = readSlice("src/app.scrml");
  if (!lib.includes(TYPE_LINE)) throw new Error("fixture drift: lib/dropdown.scrml no longer declares Openness");
  const appImport = 'import { dropdown, Openness } from "./lib/dropdown.scrml"';
  if (!app.includes(appImport)) throw new Error("fixture drift: app.scrml no longer imports from ./lib/dropdown.scrml");
  return [
    {
      path: "app.scrml",
      src: app.replace(appImport, 'import { dropdown } from "./lib/dropdown.scrml"\n    import { Openness } from "./lib/openness.scrml"\n    import { Tone } from "./lib/accent.scrml"'),
    },
    { path: "lib/accent.scrml", src: "// lib/accent.scrml\n${ export type Tone:enum = { Warm, Cool } }\n" },
    { path: "lib/dropdown.scrml", src: lib.replace(TYPE_LINE, '${ import { Openness } from "./openness.scrml" }') },
    { path: "lib/openness.scrml", src: "// lib/openness.scrml\n${ " + TYPE_LINE + " }\n" },
  ];
}

/** The same program with an unresolved name in every file — a diagnostic per file. */
function programWithDiags() {
  return program().map((f, i) => ({ path: f.path, src: `${f.src}\n\${ fn broken${i}() -> int { return missing${i} } }\n` }));
}

const ENTRY = "app.scrml";

/** Everything a compile produces, serialized: the comparison is byte-for-byte. */
function compile(mods, files) {
  const r = frontEnd(mods, files, ENTRY);
  const out = r.core == null ? null : mods.print.printProgram(r.core, "app.client.js", "scrml-runtime.js");
  return {
    order: r.asts.map((a) => a.path),
    diags: JSON.stringify(r.diags),
    infos: JSON.stringify(r.infos),
    asts: JSON.stringify(r.asts),
    core: JSON.stringify(r.core),
    js: out == null ? null : out.js,
    html: out == null ? null : out.html,
  };
}

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

let mods;
beforeAll(() => { ({ mods } = loadM2()); }, { timeout: 120000 });

describe("determinism (i) — the same input twice", () => {
  test("a clean four-file program: byte-identical artifacts, Core, ASTs and (no) diagnostics", () => {
    const a = compile(mods, program());
    const b = compile(mods, program());
    expect(JSON.parse(a.diags)).toEqual([]);
    expect(a.js).toBeString();
    expect(a.js.length).toBeGreaterThan(1000);
    expect(b).toEqual(a);
    // the compile placed the files in LINK order, not path order
    expect(a.order).toEqual(["lib/accent.scrml", "lib/openness.scrml", "lib/dropdown.scrml", "app.scrml"]);
  });
});

describe("determinism (ii) — the file SET, listed in any order", () => {
  test("all 24 orders of the clean program → one result", () => {
    const base = compile(mods, program());
    for (const p of permutations(program())) {
      const r = compile(mods, p);
      expect({ listed: p.map((f) => f.path), r }).toEqual({ listed: p.map((f) => f.path), r: base });
    }
  });
});

describe("determinism (iv) — diagnostics in several files keep one order", () => {
  test("a diagnostic in every file; all 24 orders → one diagnostic list (order + text)", () => {
    const base = compile(mods, programWithDiags());
    const ds = JSON.parse(base.diags);
    // the gate is not vacuous: every file reports
    expect(new Set(ds.map((d) => d.file))).toEqual(new Set(["app.scrml", "lib/accent.scrml", "lib/dropdown.scrml", "lib/openness.scrml"]));
    expect(ds.filter((d) => d.code === "E-SCOPE-001").length).toBeGreaterThanOrEqual(4);
    for (const p of permutations(programWithDiags())) {
      expect(compile(mods, p)).toEqual(base);
    }
  });
});

describe("determinism (iii) — two absolute roots, two working directories", () => {
  const roots = [];
  const cwd0 = process.cwd();

  /** Write the program under a fresh root `depth` directories deep. */
  function layOut(files, depth) {
    let root = mkdtempSync(join(tmpdir(), "boot-determinism-"));
    roots.push(root);
    for (let i = 0; i < depth; i++) root = join(root, `nest${i}`);
    for (const f of files) {
      const p = join(root, ...f.path.split("/"));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.src);
    }
    return root;
  }

  /** Compile the project at `root` from inside `root` (the cwd is not an input). */
  function compileAt(root) {
    process.chdir(root);
    try {
      return compile(mods, projectSources(root));
    } finally {
      process.chdir(cwd0);
    }
  }

  afterAll(() => {
    process.chdir(cwd0);
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  for (const [label, make] of [["clean", program], ["with diagnostics", programWithDiags]]) {
    test(`${label}: identical from two roots, and identical to the in-memory compile`, () => {
      // written in opposite orders, so creation order cannot line the listings up
      const r1 = layOut(make(), 0);
      const r2 = layOut([...make()].reverse(), 3);
      const a = compileAt(r1);
      const b = compileAt(r2);
      expect(b).toEqual(a);
      expect(a).toEqual(compile(mods, make()));
      // no build-host path in any artifact or diagnostic
      const everything = Object.values(a).join("\n");
      for (const r of [r1, r2, tmpdir(), cwd0]) expect(everything.includes(r)).toBe(false);
    });
  }

  test("an absolute path is refused at the driver (the compiler takes project-relative names only)", () => {
    const files = program();
    files[0] = { path: join(tmpdir(), "app.scrml"), src: files[0].src };
    expect(() => frontEnd(mods, files, files[0].path)).toThrow(/project-relative/);
  });
});

describe("link.scrml — the canonical order's parts", () => {
  test("codeUnitCompare is UTF-16 code-unit order, not locale order", () => {
    const c = mods.link.codeUnitCompare;
    expect(c("B.scrml", "a.scrml")).toBe(-1); // "B" (66) < "a" (97); a locale compare says otherwise
    expect(c("a-b", "a_b")).toBe(-1); // "-" (45) < "_" (95)
    expect(c("a", "a")).toBe(0);
    expect(c("a", "ab")).toBe(-1);
    expect(c("é", "f")).toBe(1); // U+00E9 after "f"
  });

  test("resolveFrom: relative sources resolve against the importer's directory; others add no edge", () => {
    const r = mods.link.resolveFrom;
    expect(r("", "./lib/a.scrml")).toBe("lib/a.scrml");
    expect(r("lib", "./a.scrml")).toBe("lib/a.scrml");
    expect(r("x/y", "../lib/./a.scrml")).toBe("x/lib/a.scrml");
    expect(r("", "../a.scrml")).toBe("");
    expect(r("", "scrml:ui")).toBe("");
    expect(r("lib", "a.scrml")).toBe("");
  });

  test("canonicalSources orders by path then text, whatever the input order", () => {
    const xs = [{ path: "b", src: "1" }, { path: "a", src: "2" }, { path: "a", src: "1" }];
    const want = [{ path: "a", src: "1" }, { path: "a", src: "2" }, { path: "b", src: "1" }];
    for (const p of permutations(xs)) expect(mods.link.canonicalSources(p)).toEqual(want);
  });

  test("an import cycle is broken at the first file in path order — the same for every listing", () => {
    const cyc = [
      { path: "a.scrml", src: '${ import { B } from "./b.scrml"\n export type A:enum = { X } }\n' },
      { path: "b.scrml", src: '${ import { A } from "./a.scrml"\n export type B:enum = { Y } }\n' },
      { path: "main.scrml", src: "<program>\n</program>\n" },
    ];
    const orders = permutations(cyc).map((p) => mods.link.parseProgram(p, "main.scrml").files.map((f) => f.path));
    for (const o of orders) expect(o).toEqual(["a.scrml", "b.scrml", "main.scrml"]);
  });
});
