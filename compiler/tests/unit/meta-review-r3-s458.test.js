/**
 * meta-review-r3-s458.test.js — S458 differential review, round 3.
 *
 * All findings are one class: the allow-list's idea of what a name is / where a block
 * sits differed from what codegen emits. The boundary moved, not the position:
 *   HIGH-1 the meta-block FINDER (meta-checker.findMetaBlocks) and the compile-time
 *          evaluator (meta-eval.processNodeList) are now TOTAL — they descend every AST
 *          child container, so a `^{}` in an `if` / `else` branch, a match arm, a loop
 *          of any shape, a function body, is checked and (if compile-time) evaluated
 *          wherever it sits. Before: a `^{ meta.emit.constructor(…)() }` in an if-branch
 *          ran in the browser; a compile-time `^{ emit(…) }` in an if-branch was emitted
 *          as a runtime effect (`emit is not defined`).
 *   HIGH-2 (revised) every captured binding in an emitted runtime `^{}` effect body is
 *          read as `_scrml_cap.<name>` through the capture object (author name -> the
 *          real, possibly renamed, binding), and the EMITTED text is then scope-checked:
 *          a free identifier other than a compiler `_scrml_*` name or `undefined`/`NaN`/
 *          `Infinity` is E-META-001. No host-name list exists; a cell is never captured
 *          bare (`@name` / `meta.get` only, §22.5.2).
 *   MED    the enclosing-scope binder covers every binding form: C-style `for`,
 *          destructured for-of, destructured params, match-arm payloads.
 *   LOW    a body-local shadowing an outer decl no longer prepends the outer (parse
 *          error); a decl read by a RUNTIME `^{}` or client code stays in the client.
 *
 * NOTE on the security assertion: `compileScrml` returns a best-effort `outputs` map
 * ALONGSIDE `errors`; it is the CLI / build path that writes NO artifact when a compile
 * errors (S457). So a refusal is asserted as "E-META-001 is among the errors" (a compile
 * that errors writes nothing); an empirical no-artifact CLI check is in the dispatch report.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { compileScrml } from "../../src/api.js";
import * as acorn from "acorn";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/meta-review-r3-s458");
beforeAll(() => { mkdirSync(FIXTURE_DIR, { recursive: true }); });
afterAll(() => { rmSync(FIXTURE_DIR, { recursive: true, force: true }); });

let seq = 0;
function compile(source) {
  const filePath = resolve(join(FIXTURE_DIR, `case-${++seq}.scrml`));
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: join(FIXTURE_DIR, "dist"), write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info");
  const out = [...(result.outputs?.values?.() ?? [])];
  return { codes: errors.map((e) => e.code), messages: errors.map((e) => e.message), clientJs: out.map((o) => o.clientJs ?? "").join("\n"), html: out.map((o) => o.html ?? "").join("\n") };
}

// A ^{} body that reaches the host through a prototype chain, placed in CONTAINER.
const PWN = `meta.emit.constructor("globalThis.__r3 = 1")()`;
const PRE = `<flag> = true\n<n> = 0\n<x> = 0\n`;

describe("S458 r3 HIGH-1 — a ^{} is checked wherever it sits (total descent)", () => {
  const containers = {
    "if branch": `\${ if (@flag) { ^{ meta.get("x"); ${PWN} } } }`,
    "else branch": `\${ if (@flag) { } else { ^{ meta.get("x"); ${PWN} } } }`,
    "else-if branch": `\${ if (@flag) { } else if (@n > 0) { ^{ meta.get("x"); ${PWN} } } }`,
    "for-of body": `\${ for (const i of [1, 2]) { ^{ meta.get("x"); ${PWN} } } }`,
    "C-style for body": `\${ for (let i = 0; i < 2; i = i + 1) { ^{ meta.get("x"); ${PWN} } } }`,
    "while body": `\${ let g = true\n while (g) { g = false\n ^{ meta.get("x"); ${PWN} } } }`,
    "function body": `\${ function go() { ^{ meta.get("x"); ${PWN} } } }`,
  };
  for (const [where, logic] of Object.entries(containers)) {
    test(`refused in an ${where}`, () => {
      const r = compile(`<program>\n${PRE}<div>\n${logic}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
    });
  }

  test("a computed prototype reach (k = \"constr\"+\"uctor\") in an if-branch is refused", () => {
    const r = compile(`<program>\n${PRE}<div>\n\${ if (@flag) { ^{ meta.get("x"); const k = "constr" + "uctor"; const f = meta.get[k][k]; f("1")() } } }\n</div>\n</program>\n`);
    expect(r.codes).toContain("E-META-001");
  });

  test("side bug: a compile-time ^{ emit(…) } in an if-branch is evaluated, not emitted as a runtime effect", () => {
    const r = compile(`<program>\n\${ if (true) { ^{ emit("<p>ct</p>") } } }\n</program>\n`);
    expect(r.clientJs).not.toMatch(/_scrml_meta_effect\([^)]*\bemit\(/);
    expect(r.codes.filter((c) => c === "E-META-EVAL-001")).toEqual([]);
  });

  test("a legitimate runtime ^{} in an if-branch still compiles", () => {
    const r = compile(`<program>\n<flag> = true\n<x> = 0\n<div>\n\${ if (@flag) { ^{ meta.get("x"); meta.emit("<p>ok</p>") } } }\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
  });
});

describe("S458 r3 HIGH-2 — the emitted runtime ^{} body reads captures only through the capture object", () => {
  // Independent reader: the free identifiers of each `_scrml_meta_effect` effect FUNCTION
  // in the emitted client text (a plain acorn scope walk, separate from codegen's).
  function effectFreeIdents(clientJs) {
    const ast = acorn.parse(clientJs, { ecmaVersion: 2025, sourceType: "script" });
    const effects = [];
    const find = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(find); return; }
      if (n.type === "CallExpression" && n.callee?.type === "Identifier" && n.callee.name === "_scrml_meta_effect") effects.push(n.arguments[1]);
      for (const k of Object.keys(n)) if (!["type", "start", "end", "loc"].includes(k)) find(n[k]);
    };
    find(ast);
    const free = new Set();
    const add = (p, s) => {
      if (!p) return;
      if (p.type === "Identifier") s.add(p.name);
      else if (p.type === "ObjectPattern") p.properties.forEach((q) => add(q.value ?? q.argument, s));
      else if (p.type === "ArrayPattern") p.elements.forEach((e) => add(e, s));
      else if (p.type === "AssignmentPattern") add(p.left, s);
      else if (p.type === "RestElement") add(p.argument, s);
    };
    const walk = (n, scope) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach((x) => walk(x, scope)); return; }
      if (typeof n.type !== "string") return;
      if (n.type === "Identifier") { if (!scope.has(n.name)) free.add(n.name); return; }
      if (/Function/.test(n.type)) {
        const s = new Set(scope); n.params.forEach((p) => add(p, s));
        if (n.body.type === "BlockStatement") for (const st of n.body.body) {
          if (st.type === "VariableDeclaration") st.declarations.forEach((d) => add(d.id, s));
          if (st.type === "FunctionDeclaration") s.add(st.id.name);
        }
        walk(n.body, s); return;
      }
      if (n.type === "BlockStatement") {
        const s = new Set(scope);
        for (const st of n.body) if (st.type === "VariableDeclaration") st.declarations.forEach((d) => add(d.id, s));
        n.body.forEach((st) => walk(st, s)); return;
      }
      if (n.type === "MemberExpression") { walk(n.object, scope); if (n.computed) walk(n.property, scope); return; }
      if (n.type === "Property") { if (n.computed) walk(n.key, scope); walk(n.value, scope); return; }
      if (n.type === "VariableDeclarator") { walk(n.init, scope); return; }
      for (const k of Object.keys(n)) if (!["type", "start", "end", "loc"].includes(k)) walk(n[k], scope);
    };
    effects.forEach((e) => walk(e, new Set()));
    return { count: effects.length, free: [...free].filter((x) => !x.startsWith("_scrml_")) };
  }

  const HOST = ["location", "window", "top", "opener", "parent", "XMLHttpRequest", "postMessage"];

  for (const name of HOST) {
    test(`a CELL named \`${name}\` read bare is E-META-001`, () => {
      const r = compile(`<program>\n<${name}> = ""\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  const v = ${name}\n  meta.emit("<p>" + v + "</p>")\n}\n</div>\n</program>\n`);
      expect(r.codes).toContain("E-META-001");
    });

    test(`a FUNCTION named \`${name}\` is reached as _scrml_cap.${name} — no bare host name in the emitted effect`, () => {
      const r = compile(`<program>\n<x> = 0\n\${\n  function ${name}(a) { return a }\n}\n<div>\n^{\n  meta.get("x")\n  ${name}.eval("1")\n  meta.emit("<p>" + ${name}(2) + "</p>")\n}\n</div>\n</program>\n`);
      expect(r.codes).toEqual([]);
      const { count, free } = effectFreeIdents(r.clientJs);
      expect(count).toBe(1);
      expect(free).toEqual([]);
      expect(r.clientJs).toContain(`_scrml_cap.${name}.eval("1")`);
      // The capture object maps the author name to the user's (renamed) function.
      expect(r.clientJs).toMatch(new RegExp(`get ${name}\\(\\) \\{ return _scrml_${name}_\\d+; \\}`));
    });
  }

  test("controls: @location, meta.get, a body-local shadow and a captured const all compile", () => {
    for (const src of [
      `<program>\n<location> = "a"\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  meta.emit("<p>" + @location + "</p>")\n}\n</div>\n</program>\n`,
      `<program>\n<location> = "a"\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  meta.emit("<p>" + meta.get("location") + "</p>")\n}\n</div>\n</program>\n`,
      `<program>\n<x> = 0\n<div>\n^{\n  meta.get("x")\n  const location = "here"\n  meta.emit("<p>" + location + "</p>")\n}\n</div>\n</program>\n`,
      `<program>\n<x> = 0\n\${\n  const label = "hi"\n}\n<div>\n^{\n  meta.get("x")\n  meta.emit("<p>" + label + "</p>")\n}\n</div>\n</program>\n`,
    ]) {
      const r = compile(src);
      expect(r.codes).toEqual([]);
      expect(effectFreeIdents(r.clientJs).free).toEqual([]);
    }
  });

  test("a captured const is read through the capture object as a live getter", () => {
    const r = compile(`<program>\n<x> = 0\n\${\n  const label = "hi"\n}\n<div>\n^{\n  meta.get("x")\n  meta.emit("<p>" + label + "</p>")\n}\n</div>\n</program>\n`);
    expect(r.clientJs).toContain("_scrml_cap.label");
    expect(r.clientJs).toMatch(/get label\(\) \{ return label; \}/);
  });
});

describe("S458 r3 MED — the enclosing binder covers every binding form (no E-META-001)", () => {
  const forms = {
    "C-style for": `\${ for (let i = 0; i < 2; i = i + 1) { ^{ meta.get("x"); meta.emit("<p>" + i + "</p>") } } }`,
    "destructured for-of (array)": `\${ const ps = [[1, 2]]\n for (const [a, b] of ps) { ^{ meta.get("x"); meta.emit("<p>" + a + b + "</p>") } } }`,
    "destructured for-of (object)": `\${ const rs = [{ id: 1 }]\n for (const { id } of rs) { ^{ meta.get("x"); meta.emit("<p>" + id + "</p>") } } }`,
    "destructured param": `\${ function r2({ a, b }) { ^{ meta.get("x"); meta.emit("<p>" + a + b + "</p>") }\n return a } }`,
  };
  for (const [form, logic] of Object.entries(forms)) {
    test(`${form}: the binding is admitted`, () => {
      const r = compile(`<program>\n${PRE}<div>\n${logic}\n</div>\n</program>\n`);
      expect(r.codes).not.toContain("E-META-001");
    });
  }

  test("match-arm payload binding is admitted (no E-META-001)", () => {
    const r = compile(`<program>\n<x> = 0\ntype Shape:union = Circle(number) | Square(number)\n<shape>: Shape = Shape.Circle(3)\n<div>\n\${ match @shape { .Circle(r) :> { ^{ meta.get("x"); meta.emit("<p>" + r + "</p>") } } .Square(s) :> { } } }\n</div>\n</program>\n`);
    expect(r.codes).not.toContain("E-META-001");
  });
});

describe("S458 r3 LOW", () => {
  test("a body-local shadowing an outer decl does not prepend the outer (no parse error)", () => {
    const r = compile(`<program>\n\${ const max = 10 }\n^{\n  const max = 1\n  emit("<p>" + max + "</p>")\n}\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.html).toContain("<p>1</p>");
  });

  test("a decl read by a runtime ^{} stays in the client (not stripped as compile-time-only)", () => {
    const r = compile(`<program>\n<x> = 0\n\${ const pageSize = 25 }\n^{ emit("<p>" + pageSize + "</p>") }\n<div>\n^{ meta.get("x"); meta.emit("<p>" + pageSize + "</p>") }\n</div>\n</program>\n`);
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain("const pageSize = 25");
  });
});
