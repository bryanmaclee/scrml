/**
 * program-role.ts — THE one definition of a `<program>`'s role (§4.12, ruling
 * user-voice-scrml.md S445 option b):
 *
 *   "A `<program>` is top-level if it has no `<program>` or `<page>` ancestor,
 *    whatever markup wraps it. It's nested if it has one. Wrapper `<div>`s never
 *    change a program's role."
 *
 * Driven over REAL parsed ASTs (splitBlocks + buildAST), not synthetic nodes, so
 * the walk is pinned against the tree the compiler actually builds.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import {
  forEachProgramWithRole,
  findTopLevelPrograms,
  findTopLevelProgram,
  hasTopLevelProgram,
} from "../../src/program-role.ts";
import { findTopLevelProgramNode, isToolProgram } from "../../src/tool-program.ts";
import { computeProgramConfig } from "../../src/compute-program-config.ts";
import { classifyFileShape } from "../../src/library-shape.js";

function parse(src) {
  return buildAST(splitBlocks("/virtual/app.scrml", src)).ast;
}

/** [[attr-summary, role], ...] in document order. */
function roles(src) {
  const out = [];
  forEachProgramWithRole(parse(src).nodes, (p, role) => {
    const nameAttr = (p.attrs ?? []).find((a) => a.name === "name");
    out.push([nameAttr ? nameAttr.value.value : "-", role]);
  });
  return out;
}

describe("top-level: no <program>/<page> ancestor, whatever markup wraps it", () => {
  test("a direct file-root <program>", () => {
    expect(roles(`<program>\n<p>x</p>\n</program>\n`)).toEqual([["-", "top-level"]]);
  });

  for (const wrap of ["div", "main", "section", "body", "article"]) {
    test(`a <${wrap}>-wrapped <program>`, () => {
      expect(roles(`<${wrap}>\n<program>\n<p>x</p>\n</program>\n</${wrap}>\n`)).toEqual([["-", "top-level"]]);
    });
  }

  test("deep wrappers (<div><div><section>)", () => {
    expect(roles(`<div><div><section>\n<program>\n<p>x</p>\n</program>\n</section></div></div>\n`))
      .toEqual([["-", "top-level"]]);
  });

  test("two outermost programs, one wrapped — BOTH top-level (E-PROGRAM-002 territory)", () => {
    const src = `<program><p>a</p></program>\n<div><program name="b"><p>b</p></program></div>\n`;
    expect(roles(src)).toEqual([["-", "top-level"], ["b", "top-level"]]);
    expect(findTopLevelPrograms(parse(src).nodes).length).toBe(2);
  });
});

describe("nested: a <program> or <page> ancestor, however much markup sits between", () => {
  test("directly inside a <program>", () => {
    expect(roles(`<program>\n<program name="w">\n<p>w</p>\n</program>\n</program>\n`))
      .toEqual([["-", "top-level"], ["w", "nested"]]);
  });

  test("inside a <program> through a <div> (locality: a <div> may call a sidecar)", () => {
    expect(roles(`<program>\n<div>\n<program name="svc">\n<p>s</p>\n</program>\n</div>\n</program>\n`))
      .toEqual([["-", "top-level"], ["svc", "nested"]]);
  });

  test("inside a <div>-wrapped application program through another <div>", () => {
    expect(roles(`<div>\n<program>\n<div>\n<program name="svc">\n<p>s</p>\n</program>\n</div>\n</program>\n</div>\n`))
      .toEqual([["-", "top-level"], ["svc", "nested"]]);
  });

  test("under a <page>, and under a <page> through a <div>", () => {
    expect(roles(`<page>\n<program name="a">\n<p>a</p>\n</program>\n</page>\n`)).toEqual([["a", "nested"]]);
    expect(roles(`<page>\n<div>\n<program name="b">\n<p>b</p>\n</program>\n</div>\n</page>\n`)).toEqual([["b", "nested"]]);
  });

  test("a <page> wrapped in markup still makes its <program>s nested", () => {
    expect(roles(`<div>\n<page>\n<program name="c">\n<p>c</p>\n</program>\n</page>\n</div>\n`)).toEqual([["c", "nested"]]);
  });
});

describe("findTopLevelProgram / hasTopLevelProgram", () => {
  test("no <program> at all → null / false", () => {
    const nodes = parse(`<div>\n<p>x</p>\n</div>\n`).nodes;
    expect(findTopLevelProgram(nodes)).toBe(null);
    expect(hasTopLevelProgram(nodes)).toBe(false);
  });

  test("only a <page>-nested <program> → no top-level program", () => {
    expect(hasTopLevelProgram(parse(`<page>\n<div>\n<program name="w">\n<p>w</p>\n</program>\n</div>\n</page>\n`).nodes)).toBe(false);
  });

  test("first top-level in document order", () => {
    const nodes = parse(`<div><program title="one"><p>a</p></program></div>\n<program title="two"><p>b</p></program>\n`).nodes;
    const first = findTopLevelProgram(nodes);
    expect(first.attrs.find((a) => a.name === "title").value.value).toBe("one");
  });
});

describe("every consumer reads the same definition", () => {
  const WRAPPED = `<div>\n<program auth="required" log="minimal">\n<p>x</p>\n</program>\n</div>\n`;

  test("the TAB's hasProgramRoot + fileShape: a <div>-wrapped program file is a program file", () => {
    const ast = parse(WRAPPED);
    expect(ast.hasProgramRoot).toBe(true);
    expect(classifyFileShape(ast.nodes, ast.hasProgramRoot)).toBe("program");
  });

  test("computeProgramConfig reads the wrapped program's auth= and middleware", () => {
    const cfg = computeProgramConfig(parse(WRAPPED).nodes);
    expect(cfg.authConfig?.auth).toBe("required");
    expect(cfg.middlewareConfig?.log).toBe("minimal");
  });

  test("computeProgramConfig does NOT read a nested program's auth=", () => {
    const cfg = computeProgramConfig(parse(`<program>\n<div>\n<program name="w" auth="required">\n<p>w</p>\n</program>\n</div>\n</program>\n`).nodes);
    expect(cfg.authConfig).toBe(null);
  });

  test("tool-program's findTopLevelProgramNode / isToolProgram", () => {
    const ast = parse(`<div>\n<program kind="tool">\n\${ function main() { log("x") } }\n</program>\n</div>\n`);
    expect(findTopLevelProgramNode(ast)).not.toBe(null);
    expect(isToolProgram(ast)).toBe(true);
    // a kind="tool" <program> nested in an app program is NOT the file's tool program
    expect(isToolProgram(parse(`<program>\n<div>\n<program kind="tool" name="t">\n<p>t</p>\n</program>\n</div>\n</program>\n`))).toBe(false);
  });
});
