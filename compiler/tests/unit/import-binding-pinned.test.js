/**
 * Phase A1b Step B4 — Import binding registration + source-position
 * `pinned` forward-ref check + best-effort E-IMPORT-PINNED-INVALID.
 *
 * SPEC anchors:
 *   §6.9.3, §6.10.2, §6.10.5, §7.6.1 — E-STATE-PINNED-FORWARD-REF
 *     (source-position rule: read of a pinned cell BEFORE its decl-span end
 *     is the error; including read inside the cell's own initializer)
 *   §21.8.1 — pinned imports inherit same-file pinned semantics; pinned on
 *     a non-cell-non-engine import is E-IMPORT-PINNED-INVALID
 *   §34 — error catalog rows
 *
 * Per the re-scoped dispatch (S66 Phase 0 STOP findings):
 *   - Algorithm is a SOURCE-POSITION forward-ref rule, NOT cycle/SCC detection.
 *   - E-IMPORT-PINNED-INVALID fires only on definitively-not-cell-not-engine
 *     kinds (function/fn/type/channel). const/let imports are accepted with
 *     a documented B14 deferral (engine vs. arbitrary-const distinction is
 *     not knowable today).
 *
 * Test layout:
 *
 *   §B4.1.x — Phase 1 (registration only). Verifies import specifiers land
 *             in the file scope's importBindings map with correct shape.
 *   §B4.2.x — Phase 2: E-STATE-PINNED-FORWARD-REF source-position check.
 *   §B4.3.x — Phase 3: E-IMPORT-PINNED-INVALID best-effort fire.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  runSYM,
  runSYMBatch,
  lookupImportBinding,
} from "../../src/symbol-table.ts";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function buildSym(source) {
  const { ast, errors } = parse(source);
  const sym = runSYM({ filePath: "test.scrml", ast });
  return { ast, errors, sym };
}

function symErrorsByCode(sym, code) {
  return sym.errors.filter((e) => e.code === code);
}

// ===========================================================================
// §B4.1 — Phase 1: Import binding registration
// ===========================================================================

describe("§B4.1.1 named-import without pinned registers in file scope", () => {
  test("import { foo } from './m.scrml' — single binding, pinned:false", () => {
    const src = `<program>\${ import { foo } from './m.scrml' }</program>`;
    const { sym } = buildSym(src);
    expect(sym.fileScope.kind).toBe("file");
    expect(sym.fileScope.importBindings.size).toBe(1);
    const rec = sym.fileScope.importBindings.get("foo");
    expect(rec).toBeDefined();
    expect(rec.localName).toBe("foo");
    expect(rec.exportedName).toBe("foo");
    expect(rec.sourcePath).toBe("./m.scrml");
    expect(rec.pinned).toBe(false);
    expect(rec.declNode).toBeDefined();
    expect(rec.declNode.kind).toBe("import-decl");
  });
});

describe("§B4.1.2 named-import with pinned registers pinned:true", () => {
  test("import { foo pinned } from './m.scrml' — pinned:true", () => {
    const src = `<program>\${ import { foo pinned } from './m.scrml' }</program>`;
    const { sym } = buildSym(src);
    const rec = sym.fileScope.importBindings.get("foo");
    expect(rec).toBeDefined();
    expect(rec.pinned).toBe(true);
    expect(rec.exportedName).toBe("foo");
  });
});

describe("§B4.1.3 alias + pinned registers under LOCAL name", () => {
  test("import { foo as bar pinned } registers under 'bar' with exportedName:'foo'", () => {
    const src = `<program>\${ import { foo as bar pinned } from './m.scrml' }</program>`;
    const { sym } = buildSym(src);
    expect(sym.fileScope.importBindings.has("foo")).toBe(false);
    const rec = sym.fileScope.importBindings.get("bar");
    expect(rec).toBeDefined();
    expect(rec.localName).toBe("bar");
    expect(rec.exportedName).toBe("foo");
    expect(rec.pinned).toBe(true);
  });
});

describe("§B4.1.4 multi-specifier mixed pinned flags", () => {
  test("import { a pinned, b, c pinned } — three records, mixed flags", () => {
    const src = `<program>\${ import { a pinned, b, c pinned } from './m.scrml' }</program>`;
    const { sym } = buildSym(src);
    expect(sym.fileScope.importBindings.size).toBe(3);
    expect(sym.fileScope.importBindings.get("a").pinned).toBe(true);
    expect(sym.fileScope.importBindings.get("b").pinned).toBe(false);
    expect(sym.fileScope.importBindings.get("c").pinned).toBe(true);
  });
});

describe("§B4.1.5 default import registers single binding, pinned:false", () => {
  test("import foo from './m.scrml' — single binding under default name", () => {
    const src = `<program>\${ import foo from './m.scrml' }</program>`;
    const { sym } = buildSym(src);
    expect(sym.fileScope.importBindings.size).toBe(1);
    const rec = sym.fileScope.importBindings.get("foo");
    expect(rec).toBeDefined();
    expect(rec.pinned).toBe(false);
    expect(rec.exportedName).toBe("foo");
    expect(rec.sourcePath).toBe("./m.scrml");
  });
});

describe("§B4.1.6 lookupImportBinding helper", () => {
  test("lookupImportBinding returns null for unregistered name", () => {
    const src = `<program>\${ import { foo } from './m.scrml' }</program>`;
    const { sym } = buildSym(src);
    expect(lookupImportBinding(sym.fileScope, "foo")).not.toBeNull();
    expect(lookupImportBinding(sym.fileScope, "nope")).toBeNull();
    expect(lookupImportBinding(null, "foo")).toBeNull();
  });
});

describe("§B4.1.7 stats.totalImportBindings reflects registration count", () => {
  test("3 specifiers + 0 default → totalImportBindings === 3", () => {
    const src = `<program>\${ import { a, b, c } from './m.scrml' }</program>`;
    const { sym } = buildSym(src);
    expect(sym.stats.totalImportBindings).toBe(3);
  });
});

describe("§B4.1.8 no-imports file has empty registry", () => {
  test("totalImportBindings === 0 when no imports present", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { sym } = buildSym(src);
    expect(sym.stats.totalImportBindings).toBe(0);
    expect(sym.fileScope.importBindings.size).toBe(0);
  });
});

// ===========================================================================
// §B4.2 — Phase 2: E-STATE-PINNED-FORWARD-REF source-position check
// ===========================================================================

describe("§B4.2.1 read AFTER pinned decl — no fire (control)", () => {
  test("`<count pinned> = 0` then `function f() { return @count }` — no fire", () => {
    const src = `<program>\${
      <count pinned> = 0
      function f() { return @count }
    }</program>`;
    const { sym } = buildSym(src);
    expect(symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF")).toHaveLength(0);
  });
});

describe("§B4.2.2 read BEFORE pinned decl — fires", () => {
  test("function reads @count before `<count pinned> = 0` decl-line", () => {
    const src = `<program>\${
      function f() { return @count }
      <count pinned> = 0
    }</program>`;
    const { sym } = buildSym(src);
    const errs = symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toContain("count");
    expect(errs[0].message).toContain("pinned");
    expect(errs[0].severity).toBe("error");
  });
});

describe("§B4.2.3 read BEFORE non-pinned decl — no fire (hoisting allowed)", () => {
  test("non-pinned cell preceded by a forward-read does NOT fire", () => {
    const src = `<program>\${
      function f() { return @count }
      <count> = 0
    }</program>`;
    const { sym } = buildSym(src);
    expect(symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF")).toHaveLength(0);
  });
});

describe("§B4.2.4 read AFTER non-pinned decl — no fire (control)", () => {
  test("`<count> = 0` then function — no fire", () => {
    const src = `<program>\${
      <count> = 0
      function f() { return @count }
    }</program>`;
    const { sym } = buildSym(src);
    expect(symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF")).toHaveLength(0);
  });
});

describe("§B4.2.5 self-init read of pinned cell — fires", () => {
  test("`<x pinned> = @x + 1` reads @x inside its own initialiser", () => {
    // The read sits inside the decl's initExpr (between decl.span.start and
    // decl.span.end). Pinned makes that hard: the cell is not "fully declared"
    // until decl-span end.
    const src = `<program>\${
      <x pinned> = @x + 1
    }</program>`;
    const { sym } = buildSym(src);
    const errs = symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF");
    expect(errs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("§B4.2.6 self-init read of NON-pinned cell — no fire", () => {
  test("`<x> = @x + 1` (non-pinned) does not fire pinned-forward-ref", () => {
    // Note: this may or may not be a valid TDZ pattern depending on other
    // checks; what we assert here is the NEGATIVE — E-STATE-PINNED-FORWARD-REF
    // does NOT fire for non-pinned self-init.
    const src = `<program>\${
      <x> = @x + 1
    }</program>`;
    const { sym } = buildSym(src);
    expect(symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF")).toHaveLength(0);
  });
});

describe("§B4.2.7 multiple reads BEFORE pinned decl — fires for each occurrence", () => {
  test("two early reads of @count produce two diagnostics", () => {
    const src = `<program>\${
      function a() { return @count }
      function b() { return @count + 1 }
      <count pinned> = 0
    }</program>`;
    const { sym } = buildSym(src);
    const errs = symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF");
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("§B4.2.8 mixed pinned + non-pinned with mixed source order", () => {
  test("only the pinned forward-ref fires; non-pinned forward-read is fine", () => {
    const src = `<program>\${
      function f() { return @count + @other }
      <count pinned> = 0
      <other> = 0
    }</program>`;
    const { sym } = buildSym(src);
    const errs = symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF");
    // Exactly one fire — for @count (pinned). @other is non-pinned forward-ref,
    // legal under hoisting.
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("count");
    expect(errs[0].message).not.toContain("<other>");
  });
});

describe("§B4.2.9 pinned import — read BEFORE import line fires", () => {
  test("@imported read precedes the import statement, pinned import → fires", () => {
    // Note: imports hoist to FileAST.imports[] but their span is recorded at
    // their original position in the logic block. The import is INSIDE the
    // logic block here; the function reads @imported earlier in the same
    // block. The decl-span (import statement's span) starts mid-logic-block;
    // the read is before it.
    const src = `<program>\${
      function f() { return @imported }
      import { imported pinned } from './m.scrml'
    }</program>`;
    const { sym } = buildSym(src);
    const errs = symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].message).toContain("imported");
    expect(errs[0].message).toMatch(/import|pinned/i);
  });
});

describe("§B4.2.10 pinned import — read AFTER import line — no fire", () => {
  test("@imported read after import line does not fire", () => {
    const src = `<program>\${
      import { imported pinned } from './m.scrml'
      function f() { return @imported }
    }</program>`;
    const { sym } = buildSym(src);
    expect(symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF")).toHaveLength(0);
  });
});

describe("§B4.2.11 NON-pinned import — read BEFORE import line — no fire", () => {
  test("non-pinned import accepts forward-references", () => {
    const src = `<program>\${
      function f() { return @imported }
      import { imported } from './m.scrml'
    }</program>`;
    const { sym } = buildSym(src);
    expect(symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF")).toHaveLength(0);
  });
});

describe("§B4.2.12 diagnostic carries file + severity + names the cell", () => {
  test("err has correct file, severity:error, and message names the cell", () => {
    const src = `<program>\${
      function f() { return @count }
      <count pinned> = 0
    }</program>`;
    const { sym } = buildSym(src);
    const errs = symErrorsByCode(sym, "E-STATE-PINNED-FORWARD-REF");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0].severity).toBe("error");
    expect(errs[0].span.file).toBe("test.scrml");
    expect(errs[0].message).toMatch(/<count>/);
    // Note: IdentExpr span absolute-offset is not reliable today (see
    // resolveAtNameOnExprNode doc on read-position); a future B-step will
    // upgrade this to source-exact positions. For now we report the file
    // correctly and leave start/end approximate.
  });
});
