// Bug B (structural-compound deep-set codegen mistarget) — emit-shape regression.
//
// BUG (HIGH): a dotted-path deep-set `@a.ref = value` where `a` is a Variant C
// STRUCTURAL COMPOUND cell (`<a> <ref>="" </>`) wrote the DERIVED COMPOSITE `a`
// instead of the backing LEAF `a.ref`. The composite `a` is emitted as a
// `_scrml_derived_declare("a", () => ({ ref: _scrml_reactive_get("a.ref") }))`
// that recomputes from the unchanged leaf on the next read — so the write was
// silently clobbered, a lost mutation with no diagnostic. It failed even for a
// SINGLE deep-set (distinct from the S167 multi-statement parser bug, which is
// about FLAT object cells).
//
// SPEC §6.3.2 (line 2229) is normative: `@formRes.name = "Alice"` writes to the
// field's backing storage. So the write MUST target the backing leaf cell.
//
// FIX: reactive-deps.ts:stampCompoundDeepSetTargets (run once per file at runCG)
// stamps each `reactive-nested-assign` whose target is a compound parent with
// `_deepSetLeafKey` (the deepest statically-resolvable backing leaf) +
// `_deepSetResidualPath`; emit-logic.ts honors the stamp.
//
// This file asserts the EMIT SHAPE. The happy-dom RUNTIME proof (clicking leaves
// @a.ref === "q") lives in tests/browser/browser-structural-compound-deepset.test.js.
//
// CONTRAST (must NOT regress): a FLAT object cell `<a> = { ref: "" }` is a PLAIN
// reactive cell (NOT a compound parent), so `@a.ref = v` keeps the cell-targeted
// `_scrml_deep_set` on the value object.

import { describe, test, expect } from "bun:test";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compile(scrmlSource) {
  const tag = `scd-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_scd_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    let clientJs = "";
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? "";
    }
    return { errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"), clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function fnBody(clientJs, name) {
  const m = clientJs.match(new RegExp(`function _scrml_${name}_\\d+\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  return m ? m[1] : null;
}

describe("structural-compound deep-set retargets the backing leaf cell (Bug B)", () => {
  test("single-segment compound field `@a.ref = v` → _scrml_reactive_set(\"a.ref\", v) — NOT the composite", () => {
    const { errors, clientJs } = compile([
      "<a>",
      "    <ref> = \"\"",
      "</>",
      "<c> = 0",
      "function multi() {",
      "    @c = 1",
      "    @a.ref = \"p\"",
      "    @c = 2",
      "    @a.ref = \"q\"",
      "}",
      "<button onclick=multi()>go</button>",
      "<p>${@c} ${@a.ref}</p>",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "multi");
    expect(body).toBeTruthy();
    // BOTH writes target the leaf cell with a plain reactive_set.
    expect(body).toContain('_scrml_reactive_set("a.ref", "p");');
    expect(body).toContain('_scrml_reactive_set("a.ref", "q");');
    // The bug shape MUST be gone: no deep-set against the composite "a".
    expect(body).not.toMatch(/_scrml_reactive_set\("a",\s*_scrml_deep_set/);
  });

  test("nested structural compound `@a.b.ref = v` → _scrml_reactive_set(\"a.b.ref\", v) (deepest leaf)", () => {
    const { errors, clientJs } = compile([
      "<a>",
      "    <b>",
      "        <ref> = \"\"",
      "    </>",
      "</>",
      "function setIt() { @a.b.ref = \"q\" }",
      "<button onclick=setIt()>go</button>",
      "<p>${@a.b.ref}</p>",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "setIt");
    expect(body).toBeTruthy();
    expect(body).toContain('_scrml_reactive_set("a.b.ref", "q");');
    expect(body).not.toMatch(/_scrml_reactive_set\("a",\s*_scrml_deep_set/);
    expect(body).not.toMatch(/_scrml_reactive_set\("a\.b",\s*_scrml_deep_set/);
  });

  test("compound field holding a plain object `@a.cfg.deep = v` → COW the residual into the leaf `a.cfg`", () => {
    const { errors, clientJs } = compile([
      "<a>",
      "    <cfg> = { deep: \"\" }",
      "</>",
      "function setIt() { @a.cfg.deep = \"p\" }",
      "<button onclick=setIt()>go</button>",
      "<p>${@a.cfg.deep}</p>",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "setIt");
    expect(body).toBeTruthy();
    // Retargets to the backing leaf `a.cfg`, deep-sets the residual `["deep"]`.
    expect(body).toContain(
      '_scrml_reactive_set("a.cfg", _scrml_deep_set(_scrml_reactive_get("a.cfg"), ["deep"], "p"));',
    );
    expect(body).not.toMatch(/_scrml_reactive_set\("a",\s*_scrml_deep_set/);
  });

  test("computed-index segment on a compound array field `@a.items[@sel] = v` → COW computed index into the leaf `a.items`", () => {
    const { errors, clientJs } = compile([
      "<a>",
      "    <items> = []",
      "</>",
      "<sel> = 0",
      "function setIt() { @a.items[@sel] = \"x\" }",
      "<button onclick=setIt()>go</button>",
      "<p>${@sel}</p>",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "setIt");
    expect(body).toBeTruthy();
    expect(body).toContain(
      '_scrml_reactive_set("a.items", _scrml_deep_set(_scrml_reactive_get("a.items"), [_scrml_reactive_get("sel")], "x"));',
    );
    expect(body).not.toMatch(/_scrml_reactive_set\("a",\s*_scrml_deep_set/);
  });

  test("FLAT object cell `<a> = { ref: \"\" }` does NOT regress — keeps the cell-targeted deep-set", () => {
    const { errors, clientJs } = compile([
      "<a> = { ref: \"\" }",
      "<c> = 0",
      "function multi() {",
      "    @c = 1",
      "    @a.ref = \"p\"",
      "    @c = 2",
      "    @a.ref = \"q\"",
      "}",
      "<button onclick=multi()>go</button>",
      "<p>${@c} ${@a.ref}</p>",
    ].join("\n"));
    expect(errors.length).toBe(0);
    const body = fnBody(clientJs, "multi");
    expect(body).toBeTruthy();
    // FLAT cell: the field write COWs the VALUE object on the cell `a` — unchanged.
    expect(body).toContain('_scrml_reactive_set("a", _scrml_deep_set(_scrml_reactive_get("a"), ["ref"], "p"));');
    expect(body).toContain('_scrml_reactive_set("a", _scrml_deep_set(_scrml_reactive_get("a"), ["ref"], "q"));');
    // It must NOT be retargeted to a non-existent leaf "a.ref".
    expect(body).not.toContain('_scrml_reactive_set("a.ref", "p");');
    expect(body).not.toContain('_scrml_reactive_set("a.ref", "q");');
  });
});
