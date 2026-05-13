/**
 * AST Builder + Codegen — match-arm-block named-binding (Bug 6.5.1).
 *
 * Block-form match arms (`.Variant(args) => { ... }`) collect payload
 * binding names from the args list into `payloadBindings: string[]` on the
 * `match-arm-block` AST node. The pre-fix Form 1b parser used a "first
 * IDENT after `(` or `,`" heuristic that picked the FIELD name for named
 * form (`.V(field: local)`) instead of the LOCAL name. Per SPEC §18.7,
 * named form binds the LOCAL (after the colon), not the field (before).
 *
 * Coverage:
 *   §1  AST: positional-only `.V(a, b)` → bindings = ["a", "b"]
 *   §2  AST: named-only `.V(field: local)` → bindings = ["local"]
 *   §3  AST: multi-named `.V(f1: l1, f2: l2)` → bindings = ["l1", "l2"]
 *   §4  AST: mixed positional + named `.V(a, field: local)` → ["a", "local"]
 *   §5  AST: discard `_` preserved as binding (so codegen can skip it)
 *   §6  AST: `binding` raw text captured for codegen consumption
 *   §7  AST: empty paren list `.V()` → bindings = []
 *   §8  E2E: positional binding emits `const a = subject.data.field`
 *   §9  E2E: named binding emits `const local = subject.data.field`
 *  §10  E2E: typer no longer fires E-SCOPE-001 on named-form locals
 *  §11  E2E: discard `_` emits no `const` line
 *  §12  E2E: regression — Bug 6.5 lift-markup-arm body still compiles
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(source) {
  const bsOut = splitBlocks("test.scrml", source);
  return buildAST(bsOut);
}

function findNodeDeep(nodes, predicate) {
  for (const node of nodes) {
    if (!node) continue;
    if (predicate(node)) return node;
    if (node.children) {
      const found = findNodeDeep(node.children, predicate);
      if (found) return found;
    }
    if (node.body) {
      const found = findNodeDeep(node.body, predicate);
      if (found) return found;
    }
    if (node.matchExpr) {
      const found = findNodeDeep([node.matchExpr], predicate);
      if (found) return found;
    }
    if (node.functions) {
      const found = findNodeDeep(node.functions, predicate);
      if (found) return found;
    }
  }
  return null;
}

function findAllDeep(nodes, predicate, acc = []) {
  for (const node of nodes) {
    if (!node) continue;
    if (predicate(node)) acc.push(node);
    if (node.children) findAllDeep(node.children, predicate, acc);
    if (node.body) findAllDeep(node.body, predicate, acc);
    if (node.matchExpr) findAllDeep([node.matchExpr], predicate, acc);
    if (node.functions) findAllDeep(node.functions, predicate, acc);
  }
  return acc;
}

/**
 * Wrap a match-block body in a function so `match-arm-block` parses
 * instead of `match-arm-inline`. The body needs to be statements, not a
 * single expression — function bodies fit that.
 */
function parseMatchBlockArms(armSource) {
  const source = `<program>
\${
  type S:enum = {
    Loading
    Ready(name: string, count: int)
    Error(reason: string)
  }
  @state: S = .Loading
  @result = ""
  function run() {
    match @state {
      ${armSource}
    }
  }
}
<p>\${@result}</p>
</program>`;
  const { ast } = parse(source);
  const matchNode = findNodeDeep(ast.nodes, n => n.kind === "match-stmt" || n.kind === "match-expr");
  return matchNode?.body ?? [];
}

const tmpRoot = resolve(tmpdir(), "scrml-match-arm-named-binding");
let tmpCounter = 0;

function compile(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    // Read the emitted client JS so tests can assert on codegen output.
    let clientJs = "";
    if (existsSync(outDir)) {
      const fs = require("fs");
      const files = fs.readdirSync(outDir);
      const clientFile = files.find(f => f.endsWith(".client.js"));
      if (clientFile) clientJs = fs.readFileSync(resolve(outDir, clientFile), "utf8");
    }
    return {
      errors: (result.errors ?? []).filter(e => e.severity !== "warning"),
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1–§7: AST structure
// ---------------------------------------------------------------------------

describe("match-arm-block payloadBindings — AST structure (Bug 6.5.1)", () => {
  test("§1 positional-only `.V(a, b)` → bindings = local names in order", () => {
    const arms = parseMatchBlockArms(`
      .Ready(a, b) => { @result = a }
      .Loading => { @result = "" }
      .Error(r) => { @result = r }
    `);
    const readyArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Ready");
    expect(readyArm).toBeDefined();
    expect(readyArm.payloadBindings).toEqual(["a", "b"]);
  });

  test("§2 named-only `.V(field: local)` → bindings = LOCAL (post-colon), NOT field", () => {
    const arms = parseMatchBlockArms(`
      .Ready(name: who, count: n) => { @result = who }
      .Loading => { @result = "" }
      .Error(reason: why) => { @result = why }
    `);
    const readyArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Ready");
    expect(readyArm).toBeDefined();
    // Pre-fix: ["name", "count"]. Post-fix: ["who", "n"].
    expect(readyArm.payloadBindings).toEqual(["who", "n"]);

    const errorArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Error");
    expect(errorArm.payloadBindings).toEqual(["why"]);
  });

  test("§3 multi-named bindings preserve declaration order", () => {
    const arms = parseMatchBlockArms(`
      .Ready(name: nm, count: ct) => { @result = nm }
      .Loading => { @result = "" }
      .Error(r) => { @result = r }
    `);
    const readyArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Ready");
    expect(readyArm.payloadBindings).toEqual(["nm", "ct"]);
  });

  test("§4 mixed positional + named in same arm (SPEC §18.7 partial-named is valid)", () => {
    // SPEC §18.7 explicitly allows partial-named binding. The parser
    // must handle each comma-segment independently.
    const arms = parseMatchBlockArms(`
      .Ready(a, count: n) => { @result = a }
      .Loading => { @result = "" }
      .Error(r) => { @result = r }
    `);
    const readyArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Ready");
    expect(readyArm).toBeDefined();
    // Per-segment: "a" (positional → "a"), "count : n" (named → "n").
    expect(readyArm.payloadBindings).toEqual(["a", "n"]);
  });

  test("§5 discard `_` preserved as binding (codegen elides const line)", () => {
    // Bug 6.5's existing test established that `_` discard semantics
    // emit no `const _ = ...` line. The parser must still EMIT `_` in
    // payloadBindings so downstream knows the position.
    const arms = parseMatchBlockArms(`
      .Ready(_, n) => { @result = "" + n }
      .Loading => { @result = "" }
      .Error(r) => { @result = r }
    `);
    const readyArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Ready");
    expect(readyArm).toBeDefined();
    expect(readyArm.payloadBindings).toEqual(["_", "n"]);
  });

  test("§6 `binding` raw paren-text captured (load-bearing for codegen)", () => {
    const arms = parseMatchBlockArms(`
      .Ready(name: who, count: n) => { @result = who }
      .Loading => { @result = "" }
      .Error(r) => { @result = r }
    `);
    const readyArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Ready");
    expect(readyArm).toBeDefined();
    // The `binding` field is the raw paren contents (whitespace-collapsed
    // tokens joined by space). Used by codegen's parseBindingList.
    expect(typeof readyArm.binding).toBe("string");
    expect(readyArm.binding).toContain("name");
    expect(readyArm.binding).toContain(":");
    expect(readyArm.binding).toContain("who");
    expect(readyArm.binding).toContain("count");
    expect(readyArm.binding).toContain("n");
  });

  test("§7 empty paren list — payloadBindings is empty", () => {
    // Variant with no payload but with an empty paren list (defensive shape).
    const source = `<program>
\${
  type S:enum = { Loading, Ready }
  @state: S = .Loading
  @result = ""
  function run() {
    match @state {
      .Ready => { @result = "" }
      .Loading => { @result = "" }
    }
  }
}
<p>\${@result}</p>
</program>`;
    const { ast } = parse(source);
    const matchNode = findNodeDeep(ast.nodes, n => n.kind === "match-stmt" || n.kind === "match-expr");
    const arms = matchNode?.body ?? [];
    const readyArm = arms.find(a => a.kind === "match-arm-block" && a.variant === "Ready");
    expect(readyArm).toBeDefined();
    expect(readyArm.payloadBindings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §8–§12: end-to-end codegen + typer
// ---------------------------------------------------------------------------

describe("match-arm-block named-binding — codegen + typer E2E (Bug 6.5.1)", () => {
  test("§8 positional binding emits `const local = subject.data.field`", () => {
    const source = `<program>
\${
  type S:enum = { Loading, Ready(name: string, count: int) }
  @state: S = .Loading
  @result = ""
  function run() {
    match @state {
      .Ready(a, b) => { @result = a + " " + b }
      .Loading => { @result = "" }
    }
  }
}
<p>\${@result}</p>
</program>`;
    const { errors, clientJs } = compile(source);
    expect(errors).toEqual([]);
    // Codegen should emit `const a = ...data.name` and `const b = ...data.count`
    // (positional resolution against declared field order).
    expect(clientJs).toMatch(/const a = \w+\.data\.name/);
    expect(clientJs).toMatch(/const b = \w+\.data\.count/);
  });

  test("§9 named binding emits `const local = subject.data.field`", () => {
    const source = `<program>
\${
  type S:enum = { Loading, Ready(name: string, count: int) }
  @state: S = .Loading
  @result = ""
  function run() {
    match @state {
      .Ready(name: who, count: n) => { @result = who + " " + n }
      .Loading => { @result = "" }
    }
  }
}
<p>\${@result}</p>
</program>`;
    const { errors, clientJs } = compile(source);
    expect(errors).toEqual([]);
    // Codegen should emit `const who = ...data.name` (named binding —
    // local name comes from after the colon, field name from before).
    expect(clientJs).toMatch(/const who = \w+\.data\.name/);
    expect(clientJs).toMatch(/const n = \w+\.data\.count/);
    // Body references `who` + `n` — and they must be the declared locals,
    // not the source field names.
    expect(clientJs).toContain("who");
    expect(clientJs).toContain("n");
  });

  test("§10 typer no longer fires E-SCOPE-001 on named-form locals (regression)", () => {
    // The pre-fix bug: typer bound `name`/`count` (field names) into scope,
    // so the body's reference to `who`/`n` (the LOCAL names) fired
    // E-SCOPE-001 "Undeclared identifier".
    const source = `<program>
\${
  type Status:enum = {
    Loading
    Success(name: string, count: int)
    Failed(reason: string)
  }
  @status: Status = .Loading
  @msg = ""
  function handle() {
    match @status {
      .Success(name: who, count: n) => { @msg = who + " found " + n }
      .Failed(reason: why) => { @msg = "Failed: " + why }
      _ => { @msg = "loading" }
    }
  }
}
<p>\${@msg}</p>
</program>`;
    const { errors } = compile(source);
    const scopeErrors = errors.filter(e => e.code === "E-SCOPE-001");
    expect(scopeErrors).toEqual([]);
  });

  test("§11 discard `_` emits no `const` line", () => {
    const source = `<program>
\${
  type S:enum = { Loading, Ready(name: string, count: int) }
  @state: S = .Loading
  @result = ""
  function run() {
    match @state {
      .Ready(_, n) => { @result = "" + n }
      .Loading => { @result = "" }
    }
  }
}
<p>\${@result}</p>
</program>`;
    const { errors, clientJs } = compile(source);
    expect(errors).toEqual([]);
    // No `const _ = ...` line (discard semantics from S22 §1a).
    expect(clientJs).not.toMatch(/const _ = /);
    // But `n` is still bound positionally (second field = count).
    expect(clientJs).toMatch(/const n = \w+\.data\.count/);
  });

  test("§12 Bug 6.5 regression — positional-only block arm still compiles cleanly", () => {
    // Bug 6.5 was the lift-markup-arm-payload bug. The positional-only
    // form (no colon) must continue to work after the named-form fix.
    const source = `<program>
\${
  type Shape:enum = { Circle(r: int), Rect(w: int, h: int) }
  @shape: Shape = .Circle(5)
  @area = 0
  function compute() {
    match @shape {
      .Circle(r) => { @area = r * r * 3 }
      .Rect(w, h) => { @area = w * h }
    }
  }
}
<p>\${@area}</p>
</program>`;
    const { errors, clientJs } = compile(source);
    expect(errors).toEqual([]);
    expect(clientJs).toMatch(/const r = \w+\.data\.r/);
    expect(clientJs).toMatch(/const w = \w+\.data\.w/);
    expect(clientJs).toMatch(/const h = \w+\.data\.h/);
  });
});
