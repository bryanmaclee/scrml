/**
 * typed-array-no-rhs-default.test.js — SPEC §6.2 Shape 4 (S152 array; S160 generalized)
 *
 * Typed state-cell declaration with NO right-hand-side (`<x>: T`). Generalized
 * S160 (§6.2 Shape 4): defaults to the type's CANONICAL EMPTY where one exists
 * (int/integer/number→0, bool/boolean→false, string→"", T[]→[]); to `not` (with
 * an implicit `(not to T)` lifecycle, §14.12.3) where the type is a bare `T` with
 * no canonical empty (named :struct / :enum / date / timestamp / opaque); to `not`
 * (NO lifecycle) where the type already admits absence (`T | not` / `T?`); a
 * refinement-typed cell (`number(>0)`) synthesizes its base canonical-empty and
 * checks it against the §53 predicate (SATISFIES → use; VIOLATES → E-REFINEMENT-
 * NO-DEFAULT). E-DECL-NEEDS-INITIALIZER is RETIRED for the plain-cell case and now
 * survives ONLY for the const-derived no-RHS sub-case (a derived-with-no-expression
 * error, NOT Shape 4 per §6.2).
 *
 *   §1  AST: no-RHS array decl (top-level)        → state-decl, init "[]", array initExpr
 *   §2  AST: no-RHS array decl (<state> block)    → same shape, nested in compound
 *   §3  AST: explicit `= []` array decl           → unchanged (regression guard)
 *   §4  AST: no-RHS primitive array (number[])    → defaults to []
 *   §5  AST: no-RHS multi-dim array (Todo[][])    → defaults to []
 *   §6  AST: no-RHS non-array (int)               → 0, NO error (S160 inversion)
 *   §7  AST: no-RHS non-array (string)            → "", NO error (S160 inversion)
 *   §8  AST: no-RHS non-array struct (User)       → not + implicitNotLifecycle, NO error
 *   §9  AST: no-RHS non-array (int) in <state>    → 0, NO error (S160 inversion)
 *   §10 Codegen: no-RHS array emits _scrml_reactive_set(name, ...[])
 *   §11 Codegen: no-RHS array + reset → _scrml_init_set(name, () => [])
 *   §12 Codegen: no-RHS array output IDENTICAL to explicit `= []`
 *   §13 Compile: scalar no-RHS does NOT surface E-DECL-NEEDS-INITIALIZER (S160 inversion)
 *   §14 Runtime (happy-dom): empty defaulted array renders empty list (no crash)
 *   §15 Runtime (happy-dom): subsequent @todos = [...] write populates the list
 *   ── S160 generalization coverage ──
 *   §16 AST: canonical-empty synth — int→0, integer→0, number→0, bool→false, boolean→false, string→""
 *   §17 AST: bare-T no-canonical-empty → not + implicitNotLifecycle (struct/enum/date/timestamp/opaque)
 *   §18 AST: union/optional (`T | not` / `not | T` / `T?`) → not, NO implicitNotLifecycle marker
 *   §19 AST: refinement SATISFIES (number(>=0)→0) → 0, refinementNoRhsBase set, NO error
 *   §20 AST: const-derived no-RHS (`const <x>: int`) → E-DECL-NEEDS-INITIALIZER (sub-case preserved)
 *   §21 Compile: bare-T read-before-assign → E-TYPE-001 (implicit lifecycle); pass after assignment
 *   §22 Compile: bare-T pass after presence-discrimination (`given` / `is not`)
 *   §23 Compile: union `T | not` no-RHS → no E-TYPE-001 (not inhabits the type)
 *   §24 Compile: refinement VIOLATES (number(>0)→0) → E-REFINEMENT-NO-DEFAULT; SATISFIES (>=0) → none
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

function parse(source, filePath = "/test/app.scrml") {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs);
}

function collectStateDecls(tab) {
  const found = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.kind === "state-decl" && n.name !== "state") found.push(n);
    for (const k of Object.keys(n)) if (Array.isArray(n[k])) n[k].forEach(walk);
  }
  walk(tab.ast);
  return found;
}

function errorCodes(tab) {
  return (tab.errors || tab.diagnostics || []).map((d) => d.code);
}

function compileToTmp(source, baseName = "app") {
  const dir = mkdtempSync(join(tmpdir(), "scrml-array-default-"));
  const input = join(dir, `${baseName}.scrml`);
  const out = join(dir, "out");
  writeFileSync(input, source);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: out });
  return { dir, out, baseName, result };
}

function readClient(out, baseName) {
  return readFileSync(join(out, `${baseName}.client.js`), "utf-8");
}

describe("§6.2 Shape 4 — typed-array no-RHS default to [] (AST)", () => {
  test("§1 no-RHS array decl (top-level) → state-decl with [] init", () => {
    const tab = parse("<program>\n<todos>: Todo[]\n</program>");
    const todos = collectStateDecls(tab).find((d) => d.name === "todos");
    expect(todos).toBeTruthy();
    expect(todos.init).toBe("[]");
    expect(todos.initExpr).toBeTruthy();
    expect(todos.initExpr.kind).toBe("array");
    expect(todos.initExpr.elements).toEqual([]);
    expect(todos.typeAnnotation).toBe("Todo[]");
    expect(todos.shape).toBe("plain");
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§2 no-RHS array decl (<state> block) → same shape, nested in compound", () => {
    const tab = parse("<program>\n<state>\n<todos>: Todo[]\n</state>\n</program>");
    const todos = collectStateDecls(tab).find((d) => d.name === "todos");
    expect(todos).toBeTruthy();
    expect(todos.init).toBe("[]");
    expect(todos.initExpr.kind).toBe("array");
    expect(todos.typeAnnotation).toBe("Todo[]");
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§3 explicit `= []` array decl → unchanged (regression guard)", () => {
    const tab = parse("<program>\n<todos>: Todo[] = []\n</program>");
    const todos = collectStateDecls(tab).find((d) => d.name === "todos");
    expect(todos).toBeTruthy();
    expect(todos.initExpr.kind).toBe("array");
    expect(todos.typeAnnotation).toBe("Todo[]");
    expect(todos.shape).toBe("plain");
  });

  test("§4 no-RHS primitive array (number[]) → defaults to []", () => {
    const tab = parse("<program>\n<xs>: number[]\n</program>");
    const xs = collectStateDecls(tab).find((d) => d.name === "xs");
    expect(xs).toBeTruthy();
    expect(xs.init).toBe("[]");
    expect(xs.initExpr.kind).toBe("array");
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§5 no-RHS multi-dim array (Todo[][]) → defaults to []", () => {
    const tab = parse("<program>\n<grid>: Todo[][]\n</program>");
    const grid = collectStateDecls(tab).find((d) => d.name === "grid");
    expect(grid).toBeTruthy();
    expect(grid.init).toBe("[]");
    expect(grid.initExpr.kind).toBe("array");
    expect(grid.typeAnnotation).toBe("Todo[][]");
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§6 no-RHS non-array (int) → 0, NO E-DECL-NEEDS-INITIALIZER (S160 inversion)", () => {
    const tab = parse("<program>\n<x>: int\n</program>");
    const x = collectStateDecls(tab).find((d) => d.name === "x");
    expect(x).toBeTruthy();
    expect(x.init).toBe("0");
    expect(x.implicitNotLifecycle).toBeUndefined();
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§7 no-RHS non-array (string) → \"\", NO E-DECL-NEEDS-INITIALIZER (S160 inversion)", () => {
    const tab = parse("<program>\n<name>: string\n</program>");
    const name = collectStateDecls(tab).find((d) => d.name === "name");
    expect(name).toBeTruthy();
    expect(name.init).toBe('""');
    expect(name.implicitNotLifecycle).toBeUndefined();
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§8 no-RHS non-array struct (User) → not + implicitNotLifecycle, NO E-DECL (S160 inversion)", () => {
    const tab = parse("<program>\n<u>: User\n</program>");
    const u = collectStateDecls(tab).find((d) => d.name === "u");
    expect(u).toBeTruthy();
    expect(u.init).toBe("not");
    expect(u.implicitNotLifecycle).toBe(true);
    expect(u.typeAnnotation).toBe("User");
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§9 no-RHS non-array (int) inside <state> block → 0, NO E-DECL (S160 inversion)", () => {
    const tab = parse("<program>\n<state>\n<x>: int\n</state>\n</program>");
    const x = collectStateDecls(tab).find((d) => d.name === "x");
    expect(x).toBeTruthy();
    expect(x.init).toBe("0");
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });
});

const ARRAY_SRC = `type Todo {
  text: string
}

<program>
  <todos>: Todo[]

  <view>
    <each in=@todos>
      <p>\${@text}</p>
    </each>
  </view>
</program>`;

const EXPLICIT_SRC = ARRAY_SRC.replace("<todos>: Todo[]", "<todos>: Todo[] = []");

describe("§6.2 Shape 4 — codegen", () => {
  test("§10 no-RHS array emits _scrml_reactive_set with empty array init", () => {
    const { dir, out, baseName } = compileToTmp(ARRAY_SRC, "arr");
    try {
      const client = readClient(out, baseName);
      expect(client).toMatch(/_scrml_reactive_set\("todos",\s*_scrml_deep_reactive\(\[\]\)\)/);
      expect(client).not.toMatch(/_scrml_reactive_set\("todos",\s*undefined\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("§11 no-RHS array reset re-evaluates init to []", () => {
    const { dir, out, baseName } = compileToTmp(ARRAY_SRC, "arr");
    try {
      const client = readClient(out, baseName);
      expect(client).toMatch(/_scrml_init_set\("todos",\s*\(\)\s*=>\s*\[\]\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("§12 no-RHS array codegen IDENTICAL to explicit `= []`", () => {
    const a = compileToTmp(ARRAY_SRC, "arr");
    const b = compileToTmp(EXPLICIT_SRC, "arr");
    try {
      const linesA = readClient(a.out, "arr").split("\n").filter((l) => /todos/.test(l));
      const linesB = readClient(b.out, "arr").split("\n").filter((l) => /todos/.test(l));
      expect(linesA).toEqual(linesB);
    } finally {
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  });

  test("§13 scalar no-RHS does NOT surface E-DECL-NEEDS-INITIALIZER (S160 inversion)", () => {
    const src = `<program>\n  <count>: int\n  <view><p>\${@count}</p></view>\n</program>`;
    const { dir, result } = compileToTmp(src, "scalar");
    try {
      const codes = (result.errors || []).map((e) => e.code);
      expect(codes).not.toContain("E-DECL-NEEDS-INITIALIZER");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("§6.2 Shape 4 — runtime (happy-dom)", () => {
  beforeAll(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterAll(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  // NOTE: there is a PRE-EXISTING, OUT-OF-SCOPE codegen emit-ordering bug that
  // is INDEPENDENT of this change: the auto-generated `<each>` render call and
  // its `_scrml_effect_static(...)` wrapper are emitted BEFORE the cell-init
  // `_scrml_reactive_set("todos", ...)` line — so the render runs against an
  // uninitialized cell. This affects the explicit `<todos>: Todo[] = []` form
  // AND the untyped `<todos> = []` form IDENTICALLY (verified — both crash with
  // `newItems.length` of undefined). It is NOT caused by Shape 4. To test what
  // Shape 4 actually guarantees (the cell init synthesizes to a DEFINED `[]`,
  // not `undefined`), this harness runs the compiled cell-init statements FIRST
  // and then drives the render — the correct ordering the codegen bug subverts.
  function execClientInitFirst(out, baseName, result) {
    const html = readFileSync(join(out, `${baseName}.html`), "utf-8");
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(readFileSync(join(out, `${baseName}.client.js`), "utf-8")));
    const runtimeJs = readFileSync(
      join(out, result.runtimeFilename ?? "scrml-runtime.js"),
      "utf-8",
    );
    // Partition the client into (a) the cell-init/declare statements (the
    // tail block this change emits) and (b) the render-invocation lines that
    // the emit-ordering bug places too early. Re-order: defs + init first,
    // then the render invocations.
    const lines = clientJs.split("\n");
    const initLines = [];
    const renderInvokeLines = [];
    const defLines = [];
    for (const l of lines) {
      if (/^_scrml_(reactive_set|init_set|derived_declare|derived_subscribe)\(/.test(l)) {
        initLines.push(l);
      } else if (/^_scrml_each_render_\d+\(\);/.test(l) || /^_scrml_effect_static\(/.test(l)) {
        renderInvokeLines.push(l);
      } else {
        defLines.push(l);
      }
    }
    const reordered = [...defLines, ...initLines, ...renderInvokeLines].join("\n");
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n` + captureInsideChunkScope(reordered, `globalThis.__scrml_reactive_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_reactive_get__ = _scrml_reactive_get;\n`),
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  }

  test("§14 empty defaulted array is a DEFINED [] at runtime; renders empty list", () => {
    const { dir, out, baseName, result } = compileToTmp(ARRAY_SRC, "arr");
    try {
      // With init-before-render ordering, no reconcile crash and the cell is [].
      expect(() => execClientInitFirst(out, baseName, result)).not.toThrow();
      const todos = globalThis.__scrml_reactive_get__("todos");
      expect(Array.isArray(todos)).toBe(true);   // DEFINED array, NOT undefined
      expect(todos.length).toBe(0);              // empty
      const items = Array.from(document.querySelectorAll("p"));
      expect(items.length).toBe(0);              // empty list renders no items
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("§15 subsequent @todos = [...] write populates the list", () => {
    const { dir, out, baseName, result } = compileToTmp(ARRAY_SRC, "arr");
    try {
      execClientInitFirst(out, baseName, result);
      globalThis.__scrml_reactive_set__("todos", [{ text: "a" }, { text: "b" }]);
      const items = Array.from(document.querySelectorAll("p"));
      expect(items.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S160 generalization — §6.2 Shape 4 for ALL typed cells (not just arrays).
// ───────────────────────────────────────────────────────────────────────────

describe("§6.2 Shape 4 — S160 canonical-empty synthesis (AST)", () => {
  test("§16 canonical-empty synth — int/integer/number→0, bool/boolean→false, string→\"\"", () => {
    const cases = [
      ["int", "0"],
      ["integer", "0"],
      ["number", "0"],
      ["bool", "false"],
      ["boolean", "false"],
      ["string", '""'],
    ];
    for (const [ty, expected] of cases) {
      const tab = parse(`<program>\n<c>: ${ty}\n</program>`);
      const c = collectStateDecls(tab).find((d) => d.name === "c");
      expect(c, `decl for ${ty}`).toBeTruthy();
      expect(c.init, `init for ${ty}`).toBe(expected);
      expect(c.implicitNotLifecycle, `no lifecycle marker for ${ty}`).toBeUndefined();
      expect(c.refinementNoRhsBase, `no refinement flag for ${ty}`).toBeUndefined();
      expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
    }
  });

  test("§17 bare-T no-canonical-empty → not + implicitNotLifecycle", () => {
    // Named struct, enum, registered string-shaped primitives, opaque type.
    for (const ty of ["User", "Phase", "date", "timestamp", "OpaqueThing"]) {
      const tab = parse(`<program>\n<c>: ${ty}\n</program>`);
      const c = collectStateDecls(tab).find((d) => d.name === "c");
      expect(c, `decl for ${ty}`).toBeTruthy();
      expect(c.init, `init for ${ty}`).toBe("not");
      expect(c.implicitNotLifecycle, `lifecycle marker for ${ty}`).toBe(true);
      expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
    }
  });

  test("§18 union/optional → not, NO implicitNotLifecycle marker", () => {
    for (const ty of ["User | not", "not | User", "string?", "User | not"]) {
      const tab = parse(`<program>\n<c>: ${ty}\n</program>`);
      const c = collectStateDecls(tab).find((d) => d.name === "c");
      expect(c, `decl for ${ty}`).toBeTruthy();
      expect(c.init, `init for ${ty}`).toBe("not");
      // `not` inhabits the type — NO implicit lifecycle (reads do not fire E-TYPE-001).
      expect(c.implicitNotLifecycle, `no marker for ${ty}`).toBeUndefined();
      expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
    }
  });

  test("§19 refinement SATISFIES (number(>=0)→0) → 0 + refinementNoRhsBase, NO error", () => {
    const tab = parse("<program>\n<n>: number(>=0)\n</program>");
    const n = collectStateDecls(tab).find((d) => d.name === "n");
    expect(n).toBeTruthy();
    expect(n.init).toBe("0");
    expect(n.refinementNoRhsBase).toBe("number");
    expect(errorCodes(tab)).not.toContain("E-DECL-NEEDS-INITIALIZER");
  });

  test("§20 const-derived no-RHS (`const <x>: int`) → E-DECL-NEEDS-INITIALIZER (sub-case preserved)", () => {
    const tab = parse("<program>\nconst <x>: int\n</program>");
    expect(errorCodes(tab)).toContain("E-DECL-NEEDS-INITIALIZER");
  });
});

describe("§6.2 Shape 4 — S160 implicit-(not to T) lifecycle + refinement (compile)", () => {
  function codesOf(result) {
    return (result.errors || []).map((e) => e.code);
  }

  test("§21 bare-T read-before-assign → E-TYPE-001; pass after assignment", () => {
    // Read-before-assign: `<u>: User` then `@u.name` read with no assignment.
    const failSrc =
      `type User { name: string }\n` +
      `<program>\n  <u>: User\n  <view><p>\${@u.name}</p></view>\n</program>`;
    const fail = compileToTmp(failSrc, "u1");
    try {
      const c = codesOf(fail.result);
      expect(c).toContain("E-TYPE-001");
      expect(c).not.toContain("E-DECL-NEEDS-INITIALIZER");
    } finally {
      rmSync(fail.dir, { recursive: true, force: true });
    }

    // After a T-shaped assignment, the read is post-transitioned → no E-TYPE-001.
    const passSrc =
      `type User { name: string }\n` +
      `<program>\n  <u>: User\n` +
      `  ${"${"}\n    @u = make()\n    print(@u.name)\n  }\n` +
      `  function make() -> User { return { name: "x" } }\n` +
      `</program>`;
    const pass = compileToTmp(passSrc, "u2");
    try {
      expect(codesOf(pass.result)).not.toContain("E-TYPE-001");
    } finally {
      rmSync(pass.dir, { recursive: true, force: true });
    }
  });

  test("§22 bare-T pass after presence-discrimination (`if (@u is not) return`)", () => {
    const src =
      `type User { name: string }\n` +
      `<program>\n  <u>: User\n` +
      `  function show() {\n    if (@u is not) return\n    print(@u.name)\n  }\n` +
      `</program>`;
    const { dir, result } = compileToTmp(src, "u3");
    try {
      // Discrimination IS transition for presence-progression (§14.12.6.1).
      expect(codesOf(result)).not.toContain("E-TYPE-001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("§23 union `T | not` no-RHS → no E-TYPE-001 (not inhabits the type)", () => {
    const src =
      `type User { name: string }\n` +
      `<program>\n  <u>: User | not\n  <view><p>\${@u}</p></view>\n</program>`;
    const { dir, result } = compileToTmp(src, "u4");
    try {
      // A cell that legitimately holds `not` — no implicit lifecycle, no E-TYPE-001.
      expect(codesOf(result)).not.toContain("E-TYPE-001");
      expect(codesOf(result)).not.toContain("E-DECL-NEEDS-INITIALIZER");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("§24 refinement VIOLATES (number(>0)→0) → E-REFINEMENT-NO-DEFAULT; SATISFIES (>=0) → none", () => {
    const violate = compileToTmp(
      `<program>\n  <n>: number(>0)\n  <view><p>\${@n}</p></view>\n</program>`,
      "r1",
    );
    try {
      expect(codesOf(violate.result)).toContain("E-REFINEMENT-NO-DEFAULT");
    } finally {
      rmSync(violate.dir, { recursive: true, force: true });
    }

    const satisfy = compileToTmp(
      `<program>\n  <n>: number(>=0)\n  <view><p>\${@n}</p></view>\n</program>`,
      "r2",
    );
    try {
      const c = codesOf(satisfy.result);
      expect(c).not.toContain("E-REFINEMENT-NO-DEFAULT");
      expect(c).not.toContain("E-DECL-NEEDS-INITIALIZER");
    } finally {
      rmSync(satisfy.dir, { recursive: true, force: true });
    }
  });

  test("§25 reset reverts the synthesized not-init to pre → post-reset read re-fires E-TYPE-001", () => {
    // §6.8.3 No-RHS implicit-(not to T) cell reset note: reset re-evaluates the
    // synthesized `not` init → reverts the per-access state to pre, re-firing
    // E-TYPE-001 on a subsequent read (identical to the explicit
    // `<u>: (not to User) = not` form).
    const src =
      `type User { name: string }
` +
      `<program>
  <u>: User
` +
      `  function go() {
` +
      `    @u = make()
` +
      `    print(@u.name)
` +     // OK — post-transitioned
      `    reset(@u)
` +
      `    print(@u.name)
` +     // E-TYPE-001 — reverted to pre
      `  }
` +
      `  function make() -> User { return { name: "x" } }
` +
      `</program>`;
    const { dir, result } = compileToTmp(src, "u5");
    try {
      expect(codesOf(result)).toContain("E-TYPE-001");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
