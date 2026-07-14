/**
 * Bug 16 — bare `import` at v0.3 `<program>`/`<page>` body top level auto-lifts.
 *
 * SPEC anchors: §40.8 (default-logic body), §21.3 (import in logic context).
 *
 * Pre-fix repro produced an opaque E-ENGINE-004 cascade because the
 * BS-merged text block beginning with `import { ... } from '...'` failed
 * the BARE_DECL_RE match — and because BS folds adjacent text fragments
 * into one block, subsequent declarations (e.g. `type Foo`) inside the
 * same merged text were also dropped on the floor.
 *
 * The fix admits `import` to BARE_DECL_RE so the whole merged text lifts
 * into a synthetic `${...}` logic block and parseLogicBody handles each
 * statement in sequence.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileBsTab(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  return buildAST(bs);
}

function collectNodes(root, kind) {
  const out = [];
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === kind) out.push(n);
    if (Array.isArray(n.children)) walk(n.children);
    if (Array.isArray(n.body)) walk(n.body);
    if (Array.isArray(n.nodes)) walk(n.nodes);
  }
  walk(root);
  return out;
}

function compileWhole(sources, { entryName = "app.scrml" } = {}) {
  const tmpDir = resolve(testDir, `_tmp_bug16_${++tmpCounter}`);
  mkdirSync(tmpDir, { recursive: true });
  const writtenPaths = [];
  let entryPath = "";
  try {
    for (const [relPath, content] of Object.entries(sources)) {
      const abs = resolve(tmpDir, relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      writtenPaths.push(abs);
      if (relPath === entryName) entryPath = abs;
    }
    if (!entryPath) entryPath = writtenPaths[0];
    const result = compileScrml({
      inputFiles: [entryPath],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    return result;
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function codes(errors) {
  return (errors || []).map(e => e.code).filter(Boolean).sort();
}

// ===========================================================================
// 16a — bare `import` auto-lifts under v0.3 default-logic mode
// ===========================================================================

describe("Bug 16a — bare `import` auto-lifts inside <program> / <page>", () => {

  test("bare `import { name } from 'src'` inside <program> produces import-decl", () => {
    const src = [
      `<program>`,
      `  import { sortBy } from './data.scrml'`,
      `  <div>x</div>`,
      `</program>`,
    ].join("\n");
    const { ast } = compileBsTab(src);
    const imports = collectNodes(ast, "import-decl").filter(i => i.source === "./data.scrml");
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports[0].names).toContain("sortBy");
  });

  test("bare `import name from 'src'` (default) inside <program> produces import-decl", () => {
    const src = [
      `<program>`,
      `  import defaultExp from './mod.scrml'`,
      `  <div>x</div>`,
      `</program>`,
    ].join("\n");
    const { ast } = compileBsTab(src);
    const imports = collectNodes(ast, "import-decl").filter(i => i.source === "./mod.scrml");
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports[0].isDefault).toBe(true);
  });

  test("bare `import` followed by a bare `type` decl — BOTH land in the AST", () => {
    // This is the original Bug 16 cascade shape: BS merges adjacent text
    // fragments into one text block. The leading `import` must not block
    // the trailing `type` from reaching the type-decl parser.
    const src = [
      `<program title="Bug 16 repro">`,
      ``,
      `    import { sortBy } from './data.scrml'`,
      ``,
      `    type DragPhase:enum = { Idle, Dragging }`,
      ``,
      `    <div>placeholder</div>`,
      ``,
      `</program>`,
    ].join("\n");
    const { ast } = compileBsTab(src);
    const imports = collectNodes(ast, "import-decl");
    const types = collectNodes(ast, "type-decl");
    expect(imports.some(i => i.source === "./data.scrml")).toBe(true);
    expect(types.some(t => t.name === "DragPhase")).toBe(true);
  });

  test("bare `import` inside <page> body produces import-decl", () => {
    const src = [
      `<program>`,
      `  <page auth="required">`,
      `    import { fetchUser } from './users.scrml'`,
      `    <div>user</div>`,
      `  </page>`,
      `</program>`,
    ].join("\n");
    const { ast } = compileBsTab(src);
    const imports = collectNodes(ast, "import-decl").filter(i => i.source === "./users.scrml");
    expect(imports.length).toBeGreaterThanOrEqual(1);
  });

  test("end-to-end: full Bug 16 reproducer compiles without E-ENGINE-004 cascade", () => {
    // Mirror the brief's reproducer minus the external import path so the
    // module-resolver doesn't reject the unknown source. The engine references
    // a bare `type DragPhase:enum` that — pre-fix — never landed in the AST
    // because the BS-merged text block beginning with `import` was dropped.
    const result = compileWhole({
      "app.scrml": [
        `<program title="Bug 16 repro">`,
        ``,
        `    import { sortBy } from './data.scrml'`,
        ``,
        `    type DragPhase:enum = { Idle, Dragging }`,
        ``,
        `    <engine for=DragPhase initial=.Idle>`,
        `        <Idle     rule=.Dragging></>`,
        `        <Dragging rule=.Idle></>`,
        `    </>`,
        ``,
        `</program>`,
      ].join("\n"),
      "data.scrml": `\${ export function sortBy(arr, key) { return arr } }`,
    });
    const errCodes = codes(result.errors);
    expect(errCodes).not.toContain("E-ENGINE-004");
    expect(errCodes).not.toContain("E-TYPE-025");
    expect(errCodes).not.toContain("E-VARIANT-AMBIGUOUS");
  });
});

// ===========================================================================
// Back-compat — explicit `${ import ... }` wrapping still works
// ===========================================================================

describe("Bug 16 — back-compat with explicit ${ } wrapping", () => {

  test("explicit `\${ import { x } from 'src' }` inside <program> still produces import-decl", () => {
    const src = [
      `<program>`,
      `  \${ import { sortBy } from './data.scrml' }`,
      `  <div>x</div>`,
      `</program>`,
    ].join("\n");
    const { ast } = compileBsTab(src);
    const imports = collectNodes(ast, "import-decl").filter(i => i.source === "./data.scrml");
    expect(imports.length).toBeGreaterThanOrEqual(1);
  });

  test("explicit `\${ import ... }` fires W-PROGRAM-REDUNDANT-LOGIC (v0.3 deprecation lint)", () => {
    const src = [
      `<program>`,
      `  \${ import { sortBy } from './data.scrml' }`,
      `  <div>x</div>`,
      `</program>`,
    ].join("\n");
    const { errors } = compileBsTab(src);
    const codes = (errors || []).map(e => e?.code);
    expect(codes).toContain("W-PROGRAM-REDUNDANT-LOGIC");
  });
});

// ===========================================================================
// Negative — `import` inside markup prose is NOT lifted (regression guard)
// ===========================================================================

describe("Bug 16 — `import` inside markup prose remains prose", () => {

  test("text inside <p> that contains `import` keyword is NOT lifted", () => {
    const src = [
      `<program>`,
      `  <p>To bring sortBy into scope, write import { sortBy } from './data.scrml'</p>`,
      `</program>`,
    ].join("\n");
    const { ast } = compileBsTab(src);
    const imports = collectNodes(ast, "import-decl");
    // No import-decl should be produced from prose text.
    expect(imports.length).toBe(0);
  });
});

// ===========================================================================
// Negative — false-positive guards on `import`-look-alike identifiers
// ===========================================================================

describe("Bug 16 — false-positive guards on `import`-prefix identifiers", () => {

  test("text starting with `imports` (plural) does NOT lift", () => {
    // `imports` is an ordinary identifier; bare top-level use is unusual but
    // must not be promoted to a synthetic logic block.
    const src = [
      `<program>`,
      `  <p>imports is a noun here</p>`,
      `</program>`,
    ].join("\n");
    const { ast } = compileBsTab(src);
    const imports = collectNodes(ast, "import-decl");
    expect(imports.length).toBe(0);
  });
});
