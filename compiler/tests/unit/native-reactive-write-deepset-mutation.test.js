// native-reactive-write-deepset-mutation.test.js — native-parser-swap parity-closer.
//
// change-id: native-translate-bridge-gaps-2026-06-06 (FIX A)
//
// THE BUG (native-only): under `--parser=scrml-native`, a reactive deep-set
// (`@a.ref = "p"` / `@arr[i] = x`) or an array-mutation (`@arr.push(5)`) at
// statement position routed through the generic `makeBareExpr` path in the
// translate bridge (translate-stmt.js). Its translated `exprNode` carried an
// `assign` with a MEMBER target (or a `call` on a member), so codegen emitted an
// IN-PLACE mutation with NO copy-on-write and NO reactive trigger:
//     _scrml_reactive_get("a").ref = "p"            (deep-set)
//     _scrml_reactive_get("arr").push(5)            (array-mutation)
// The `${@a.ref}` / `${@arr}` bindings therefore never updated — a reactivity
// break. The default (LIVE) pipeline synthesizes dedicated `reactive-nested-
// assign` / `reactive-array-mutation` AST kinds (ast-builder.js:5620-5673) which
// emit-logic.ts lowers to the COW deep-set / triggered form.
//
// THE FIX (translate-stmt.js `tryReactiveWrite`): recognize the same two forms
// at ExprStmt position, gated STRICTLY on the path being rooted at an `@`-cell,
// and synthesize the live node kinds — so the native path produces the COW /
// triggered emit. A non-`@`-cell-rooted write (`obj.x = y` on a plain local)
// stays in-place (parity with LIVE).
//
// VERIFIED HERE: native client.js byte-matches the default (LIVE) client.js for
// the deep-set / array-mutation forms (dotted, computed-index, string-index,
// single-arg, multi-arg, @cell-arg) AND for the non-cell negative case. The
// S139 "emit-string-only test masks runtime miscompiles" lower bound: byte-
// parity with the already-green LIVE emit is the strongest static proof here.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

// compileWith — full-compile `source` under `parser` (null = default LIVE
// BS+TAB; "scrml-native" = native pipeline). Returns errors + client.js.
function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-rwdm-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Extract a named generated function body for a focused comparison.
function fnBody(clientJs, fnName) {
  const re = new RegExp(`function _scrml_${fnName}_\\d+\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = clientJs.match(re);
  return m ? m[1] : null;
}

describe("native reactive-write deep-set + array-mutation node synthesis (FIX A)", () => {
  test("deep-set + array-mutation: native emits COW / triggered form (not in-place)", () => {
    const src = [
      '<a> = { ref: "" }',
      "<c> = 0",
      "<arr> = []",
      "function multi() {",
      "    @c = 1",
      '    @a.ref = "p"',
      "    @arr.push(5)",
      "}",
      "<button onclick=multi()>go</button>",
      "<p>${@c} ${@a.ref} ${@arr}</p>",
    ].join("\n") + "\n";

    const native = compileWith(src, "scrml-native", "ds-mut");
    expect(native.errors).toHaveLength(0);
    const body = fnBody(native.clientJs, "multi");
    expect(body).not.toBeNull();

    // The COW deep-set form — NOT the in-place `_scrml_reactive_get("a").ref = `.
    expect(body).toContain(
      '_scrml_reactive_set("a", _scrml_deep_set(_scrml_reactive_get("a"), ["ref"], "p"))',
    );
    expect(body).not.toContain('_scrml_reactive_get("a").ref =');

    // The triggered array-mutation form — push + a follow-up reactive_set.
    expect(body).toContain('_scrml_reactive_get("arr").push(5)');
    expect(body).toContain('_scrml_reactive_set("arr", _scrml_reactive_get("arr"))');
  });

  // Byte-parity against the already-green LIVE emit across the reactive-write
  // variant matrix. Each row is its own `function` body so a single divergence
  // localizes.
  const matrix = [
    {
      name: "dotted deep-set",
      decls: ['<a> = { ref: "" }'],
      lines: ['@a.ref = "p"'],
    },
    {
      name: "nested dotted deep-set",
      decls: ["<obj> = { cfg: { deep: 0 } }"],
      lines: ["@obj.cfg.deep = 9"],
    },
    {
      name: "computed-index write (@cell index)",
      decls: ["<arr> = [1, 2, 3]", "<sel> = 0"],
      lines: ["@arr[@sel] = 9"],
    },
    {
      name: "literal-index write",
      decls: ["<arr> = [1, 2, 3]"],
      lines: ["@arr[0] = 9"],
    },
    {
      name: "string-index write",
      decls: ["<m> = { DAL: 0 }"],
      lines: ['@m["DAL"] = 8'],
    },
    {
      name: "single-arg push",
      decls: ["<arr> = []"],
      lines: ["@arr.push(5)"],
    },
    {
      name: "push @cell arg",
      decls: ["<arr> = []", "<x> = 7"],
      lines: ["@arr.push(@x)"],
    },
    {
      name: "multi-arg splice",
      decls: ["<arr> = [1, 2, 3, 4]"],
      lines: ["@arr.splice(0, 2)"],
    },
    {
      name: "arg-less pop",
      decls: ["<arr> = [1, 2, 3]"],
      lines: ["@arr.pop()"],
    },
    {
      name: "unshift / sort / reverse / fill",
      decls: ["<arr> = [3, 1, 2]"],
      lines: ["@arr.unshift(0)", "@arr.sort()", "@arr.reverse()", "@arr.fill(0)"],
    },
    {
      // NEGATIVE — a plain-local non-cell write must stay in-place (no re-shape).
      name: "non-cell local write (negative)",
      decls: ["<arr> = []"],
      lines: [
        "let obj = { x: 0 }",
        "obj.x = 5",
        "obj.list = []",
        "obj.list.push(9)",
        "@arr.push(obj.x)",
      ],
    },
  ];

  for (const { name, decls, lines } of matrix) {
    test(`${name}: native client.js byte-matches default`, () => {
      // Read the FIRST declared cell in markup so the page has a valid reactive
      // read (the read-side E-STATE-UNDECLARED fire, S192, surfaces a markup read
      // of an undeclared cell — earlier this hardcoded `@arr`, which is undeclared
      // in the dotted/nested/string-index cases that declare `<a>`/`<obj>`/`<m>`).
      const firstCell = (decls[0].match(/^<([A-Za-z_$][\w$]*)>/) || [])[1] || "arr";
      const src = [
        ...decls,
        "function op() {",
        ...lines.map((l) => "    " + l),
        "}",
        "<button onclick=op()>go</button>",
        `<p>\${@${firstCell}}</p>`,
      ].join("\n") + "\n";

      const live = compileWith(src, null, "live");
      const native = compileWith(src, "scrml-native", "native");
      expect(live.errors).toHaveLength(0);
      expect(native.errors).toHaveLength(0);

      const liveBody = fnBody(live.clientJs, "op");
      const nativeBody = fnBody(native.clientJs, "op");
      expect(liveBody).not.toBeNull();
      expect(nativeBody).not.toBeNull();
      expect(nativeBody).toBe(liveBody);
    });
  }
});
