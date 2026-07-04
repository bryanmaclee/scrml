// native-attrvalue-exprnode-population.test.js — native-parser-swap parity-closer.
//
// THE GAP (cross-cutting ~162 corpus files): under `--parser=scrml-native`, the
// native parser (tag-frame.js) builds markup attribute VALUES without the parsed-
// expression fields codegen consumes:
//   - `expr` / `variable-ref` values lacked `exprNode`
//       (live ast-builder.js parseAttributes 1834/1857/1878/2217)
//   - `call-ref` values lacked `argExprNodes`
//       (live ast-builder.js parseAttributes 1831-1832)
// emit-html.ts reads `val.exprNode` (handlers 1735, if=/show= 1718/1756, body 1015)
// and call-ref args lower from `argExprNodes`; absent on native -> codegen string-
// fallback -> e.g. an `onclick=@x.advance(.Inc)` handler emits raw `@x.advance(...)`
// (the `.advance` lowering never fires) -> E-CODEGEN-INVALID-LOGIC ("Unexpected
// character '@'").
//
// THE FIX: `compiler/src/native-walker/attrvalue-exprnode-walker.ts`
// (`populateNativeAttrValueExprNodes`) walks the assembled native FileAST and
// stamps `exprNode` (expr/variable-ref) + `argExprNodes` (call-ref) using the
// SAME live `safeParseExprToNodeGlobal` with the SAME `(raw, span.start)` pairing
// the live path uses -> the emitted ExprNode is byte-identical to live's. api.js
// runs it on the native `_buildAST` path only; the default pipeline is untouched.
//
// These tests assert (1) the walker populates the fields directly, and (2) the
// downstream codegen lowers the handler/if= correctly under native — no raw `@`,
// no E-CODEGEN-INVALID-LOGIC, byte-parity with default (R26 byte-presence, not the
// S139 fatal-error-absence trap).

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { nativeParseFile } from "../../native-parser/parse-file.js";
import { populateNativeAttrValueExprNodes } from "../../src/native-walker/attrvalue-exprnode-walker.ts";

// compileWith — compile `source` under `parser` (null = default live BS+TAB;
// "scrml-native" = native pipeline). Returns errors + warnings + client.js text.
// Mirrors native-engine-substrate-instance-share.test.js's helper.
function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-exprnode-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    const clientJs = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "";
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// parseNative — run the native parser + the exprNode population pass and return
// the FileAST (no write). Used by the direct field-population assertions.
function parseNative(source) {
  const fp = "/test/exprnode.scrml";
  const res = nativeParseFile(fp, source);
  populateNativeAttrValueExprNodes(res.ast, fp, res.errors);
  return res.ast;
}

// findAttrValues — collect every markup attr `value` object in a FileAST whose
// attr name matches `predicate(name)`. Iterative walk (engine bodies share value
// objects; a seen-set guards cycles).
function findAttrValues(ast, predicate) {
  const out = [];
  const stack = [ast.nodes, ast.machineDecls];
  const seen = new Set();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === null || cur === undefined || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    if (Array.isArray(cur.attrs)) {
      for (const attr of cur.attrs) {
        if (attr && typeof attr === "object" && predicate(attr.name)) {
          out.push(attr.value);
        }
      }
    }
    for (const k of Object.keys(cur)) {
      if (k === "_nativeEngineBlock" || k === "_source") continue;
      const v = cur[k];
      if (v !== null && typeof v === "object") stack.push(v);
    }
  }
  return out;
}

// A minimal, non-each, plain-handler engine program — the only variable is the
// attr-value parsed-expr-field population (no per-item reactivity / each-ctx).
const ENGINE_HANDLER = [
  "${",
  "    type Counter : enum = { Idle, Counting }",
  "    type CtrMsg  : enum = { Inc, Reset }",
  "}",
  "",
  "<count> = 0",
  "",
  "<engine for=Counter initial=.Idle accepts=CtrMsg>",
  "    <Idle rule=.Counting>",
  "        | .Inc   :> { @count = @count + 1; .Counting }",
  "        | _      :> @counter",
  "    </>",
  "    <Counting rule=.Idle>",
  "        | .Inc   :> { @count = @count + 1; .Counting }",
  "        | .Reset :> { @count = 0; .Idle }",
  "        | _      :> @counter",
  "    </>",
  "</>",
  "",
  "<div>",
  "    <button onclick=@counter.advance(.Inc)>tick</button>",
  "    <button onclick=@counter.advance(.Reset)>reset</button>",
  "    <span if=(@count > 0)>positive</span>",
  "</div>",
].join("\n");

describe("native attr-value exprNode/argExprNodes population (parity-closer)", () => {
  test("call-ref handler value gets argExprNodes (every arg parsed)", () => {
    const ast = parseNative(ENGINE_HANDLER);
    const handlers = findAttrValues(ast, (n) => n === "onclick");
    expect(handlers.length).toBe(2);
    for (const v of handlers) {
      expect(v.kind).toBe("call-ref");
      // The arg `.Inc` / `.Reset` parsed -> argExprNodes is a one-element array
      // of ExprNodes (NOT undefined — undefined would mean an arg failed to parse).
      expect(Array.isArray(v.argExprNodes)).toBe(true);
      expect(v.argExprNodes.length).toBe((v.args ?? []).length);
      expect(v.argExprNodes.length).toBeGreaterThan(0);
      expect(v.argExprNodes[0]).toBeTruthy();
      expect(typeof v.argExprNodes[0].kind).toBe("string");
    }
  });

  test("if= expr value gets exprNode", () => {
    const ast = parseNative(ENGINE_HANDLER);
    const ifVals = findAttrValues(ast, (n) => n === "if");
    expect(ifVals.length).toBe(1);
    expect(ifVals[0].kind).toBe("expr");
    expect(ifVals[0].exprNode).toBeTruthy();
    expect(typeof ifVals[0].exprNode.kind).toBe("string");
  });

  test("native client.js lowers the call-ref handler — no raw @, no E-CODEGEN-INVALID-LOGIC", () => {
    const nat = compileWith(ENGINE_HANDLER, "scrml-native", "handler-nat");
    // The file compiled clean (the E-CODEGEN-INVALID-LOGIC symptom is gone).
    const codegenErr = nat.errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC");
    expect(codegenErr.length).toBe(0);
    expect(nat.errors.length).toBe(0);
    // The handler body lowered the `.advance(.Inc)` dispatch — the engine message
    // dispatch helper is present and there is NO raw `@counter.advance` literal in
    // the emitted JS (the string-fallback symptom).
    expect(nat.clientJs).not.toContain("@counter.advance");
    expect(nat.clientJs).not.toContain("@count >");
  });

  test("native client.js is byte-identical to default (R26 byte-presence parity)", () => {
    const nat = compileWith(ENGINE_HANDLER, "scrml-native", "parity-nat");
    const def = compileWith(ENGINE_HANDLER, null, "parity-def");
    expect(def.errors.length).toBe(0);
    expect(nat.errors.length).toBe(0);
    expect(nat.clientJs).toBe(def.clientJs);
  });

  test("string-literal / props-style values are NOT given exprNode/argExprNodes (live parity)", () => {
    const SRC = [
      "<div>",
      '    <button class="grab" id="btn">go</button>',
      "</div>",
    ].join("\n");
    const ast = parseNative(SRC);
    const classVals = findAttrValues(ast, (n) => n === "class" || n === "id");
    expect(classVals.length).toBe(2);
    for (const v of classVals) {
      expect(v.kind).toBe("string-literal");
      // Live sets neither field on string literals.
      expect(Object.prototype.hasOwnProperty.call(v, "exprNode")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(v, "argExprNodes")).toBe(false);
    }
  });

  test("population is idempotent — a second pass leaves an already-populated value untouched", () => {
    const ast = parseNative(ENGINE_HANDLER);
    const before = findAttrValues(ast, (n) => n === "onclick")[0];
    const firstArgNodes = before.argExprNodes;
    // Re-run the pass; the hasOwnProperty guard must not re-parse / replace.
    populateNativeAttrValueExprNodes(ast, "/test/exprnode.scrml", []);
    const after = findAttrValues(ast, (n) => n === "onclick")[0];
    expect(after.argExprNodes).toBe(firstArgNodes); // same array reference
  });
});
