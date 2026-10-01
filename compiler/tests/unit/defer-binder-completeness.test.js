/**
 * defer-binder-completeness.test.js — S432 review B-1.
 *
 * E-DEFER-AMBIGUOUS-LEAD (§19.16.1) needs to know whether a binding named
 * `defer` is visible at a `defer [`. The first cut listed binder constructs by
 * hand and missed match-arm PAYLOAD binders (`.A(defer) :> { defer [1]… }`
 * compiled clean as a defer statement; before `defer` existed it indexed the
 * payload). The binder table (`DEFER_BINDER_FIELDS`, lint-defer.ts) is now
 * CHECKED: this test parses the conformance / samples / examples corpus with
 * both front-ends, collects every binder-like field of the live-shaped AST
 * (including fields of kind-less sub-objects such as `arms[]`), and requires
 * each to be in the table or in EXCLUDED with the reason. A new binder
 * construct fails here until someone decides.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { DEFER_BINDER_FIELDS } from "../../src/validators/lint-defer.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const BINDER_RE = /binding|Binding|param|Param|variable|Variable|asName|names|Names|bind|Bind|local|Local|catch|Catch|alias|Alias|Var$/;

const EXCLUDED = {
  "name.bindName": "a destructuring-pattern element; its owning declaration / parameter reads it through iterDestructuredNames",
  "export-decl.renames": "`export { a as b }` names an EXISTING local and an exported alias; it introduces no local binding",
  "export-decl.renames[].local": "the existing local being exported (a reference, not a binding)",
  "engine-decl.sourceVar": "the engine's source cell (a reference to a declared cell, not a new binding)",
  "engine-decl.varName": "the engine's own `@cell` name — reactive cells are `@`-sigilled, never the bare identifier `defer`",
  "engine-decl.varNameOverride": "as engine-decl.varName",
  "for-stmt.letBinder": "a boolean flag (`let` vs `const` binder), not a name",
  "for-stmt.constBinder": "a boolean flag, not a name",
  "const-decl._handlerParamPrelude": "a boolean flag marking the synthesized `const <param> = event` of an arrow-valued handler attribute; the binding itself is the const-decl's `name` (in the table)",
  "props-block.propsDecl[].bindable": "a boolean flag, not a name",
  "theme-decl.mediaBinds": "CSS media-query bindings of a theme (§65), not scrml logic identifiers",
  "try-stmt.catchNode": "container object; its binder text is `catchNode.header` (in the table)",
};

function walkFiles(dir, out) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (p.endsWith(".scrml")) out.push(p);
  }
  return out;
}

function census() {
  const found = new Map(); // "owner.path" -> example file
  const visit = (root, file) => {
    const seen = new WeakSet();
    const walk = (n, owner) => {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (Array.isArray(n)) { for (const c of n) walk(c, owner.endsWith("[]") ? owner : owner + "[]"); return; }
      const kinded = typeof n.kind === "string";
      if (kinded && !/^[a-z]/.test(n.kind)) return; // the native parser's own retained tree
      const here = kinded ? n.kind : owner;
      for (const k of Object.keys(n)) {
        if (k === "span") continue;
        const v = n[k];
        if (BINDER_RE.test(k) && v != null && !(Array.isArray(v) && v.length === 0)) {
          if (!found.has(`${here}.${k}`)) found.set(`${here}.${k}`, file);
        }
        walk(v, `${here}.${k}`);
      }
    };
    walk(root, "file");
  };
  const files = ["samples", "examples", "conformance/cases"].flatMap((d) => walkFiles(join(ROOT, d), []));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    try { visit(buildAST(splitBlocks(f, src)).ast, f); } catch { /* rejected outright by one front-end */ }
    try { visit(nativeParseFile(f, src).ast, f); } catch { /* ditto */ }
  }
  return found;
}

describe("every binder construct is classified for E-DEFER-AMBIGUOUS-LEAD", () => {
  const found = census();
  const inTable = new Set(DEFER_BINDER_FIELDS.map((f) => `${f.kind}.${f.path}`));

  test("the census is not vacuous", () => {
    expect(found.size).toBeGreaterThan(15);
    expect(found.has("match-arm-block.payloadBindings")).toBe(true);
    expect(found.has("function-decl.params")).toBe(true);
  });

  test("no unclassified binder-like field", () => {
    const unclassified = [...found.keys()].filter((k) => !inTable.has(k) && !(k in EXCLUDED)).sort();
    // A failure means a construct now binds (or looks like it binds) a name that
    // E-DEFER-AMBIGUOUS-LEAD does not know about: add it to DEFER_BINDER_FIELDS
    // (lint-defer.ts) with its scope, or to EXCLUDED with the reason.
    expect(unclassified).toEqual([]);
  });

  test("table and exclusions do not overlap", () => {
    expect([...inTable].filter((k) => k in EXCLUDED)).toEqual([]);
  });
});
