/**
 * S465 — the SERVER callee map carries the importing file's cross-module async facts
 * (`_asyncImportedLocals`, stashed by codegen/index.ts from the IMPORTED
 * module's own analysis), and `isPromiseReturningImportedCallee` — the one
 * classifier every auto-await site asks (#1399 mechanism) — answers true for
 * them. Executed end-to-end proof: integration/s465-await-imported-server-fn.
 */
import { describe, test, expect } from "bun:test";
import { buildCalleeImportMap, buildServerCalleeImportMap } from "../../src/codegen/scheduling.ts";
import { isPromiseReturningImportedCallee } from "../../src/module-resolver.js";

const IMPORTS = [
  { kind: "import-decl", source: "./lib.scrml", specifiers: [{ imported: "check", local: "ck" }, { imported: "pure", local: "pure" }] },
];
const REGISTRY = new Map([["/p/lib.scrml", new Map([["check", { kind: "function", category: "fn", isComponent: false }], ["pure", { kind: "function", category: "fn", isComponent: false }]])]]);

describe("S465 — server callee map asyncImportedLocals", () => {
  test("a local the file's async facts name is Promise-returning; a sync import is not", () => {
    const fileAST = { filePath: "/p/app.scrml", imports: IMPORTS, _asyncImportedLocals: new Set(["ck"]) };
    const map = buildServerCalleeImportMap(fileAST);
    expect(map.asyncImportedLocals?.has("ck")).toBe(true);
    expect(isPromiseReturningImportedCallee("ck", map, REGISTRY)).toBe(true);
    expect(isPromiseReturningImportedCallee("pure", map, REGISTRY)).toBe(false);
  });

  test("the facts are read through a TABResult's `.ast` too", () => {
    const ast = { filePath: "/p/app.scrml", imports: IMPORTS, _asyncImportedLocals: new Set(["ck"]) };
    const map = buildServerCalleeImportMap({ filePath: "/p/app.scrml", ast });
    expect(isPromiseReturningImportedCallee("ck", map, REGISTRY)).toBe(true);
  });

  test("the CLIENT map never carries them (client emitters read the classifier as stdlib-owned)", () => {
    const map = buildCalleeImportMap({ filePath: "/p/app.scrml", imports: IMPORTS, _asyncImportedLocals: new Set(["ck"]) });
    expect(map.asyncImportedLocals).toBeUndefined();
    expect(isPromiseReturningImportedCallee("ck", map, REGISTRY)).toBe(false);
  });

  test("without the stash (before codegen) nothing changes", () => {
    const map = buildServerCalleeImportMap({ filePath: "/p/app.scrml", imports: IMPORTS });
    expect(map.asyncImportedLocals).toBeUndefined();
    expect(isPromiseReturningImportedCallee("ck", map, REGISTRY)).toBe(false);
  });
});
