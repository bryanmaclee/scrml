/**
 * given-cell-lowering-s461 — `given @cell :>` lowers the CELL, not a bare JS name.
 *
 * Gap: `g-top-level-given-emits-bare-name-s459` (HIGH). `given @user :> { … }`
 * emitted `if (user !== null && user !== undefined) {` — `user` is never
 * declared, so the guard threw `ReferenceError: user is not defined` at runtime
 * from a bundle that compiled at exit 0. In markup, `${ given @user :> {
 * <p>…</p> } }` also DROPPED the guarded body (nothing rendered).
 *
 * Governing text (compiler/SPEC.md):
 *   §42.2.3 — "Multi-narrowing is all-or-nothing. If any listed variable is `not`,
 *     the body is skipped entirely." · "Inside the body, each named variable is
 *     narrowed … No variable is rebound to a new name; each identifier is narrowed
 *     in place."
 *   §42.3.5 worked example — `${ given @user :> { <p>${@user.name}</p> } } // OK —
 *     narrowed to present inside the guard`.
 *   §42.5 — `given x :> body` → `if (x !== null && x !== undefined) { body }`.
 *   §17.6.10 — "A branch body that is exactly one expression SHALL be equivalent to
 *     `{ lift <expression> }`."
 *
 * Roots fixed:
 *   1. ast-builder.js (both `given` parse sites) stripped the `@` and recorded
 *      nothing, so codegen could not tell `given @x` from `given x`. The parser now
 *      records `variableIsCell` (parallel to `variables`), and emit-logic.ts lowers
 *      a cell head through the SAME expression emitter every other `@cell` read uses.
 *   2. implied-lift-desugar.ts planned only `if-stmt` arms; a `given` body is the
 *      same branch body (§42.5 lowers `given` to an `if`), so it now plans it too.
 *
 * Unchanged by design (pinned below): a LOCAL / parameter head stays a bare name;
 * a SERVER-function body keeps its pre-s461 emission; the diagnostics a `given`
 * markup body got before it rendered (E-STATE-UNDECLARED, E-TYPE-046) still fire;
 * the component-body `given` refusal (E-SCOPE-001) is unchanged.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitLogicNode } from "../../src/codegen/emit-logic.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `given_cell_s461_${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    let clientJs = "";
    let serverJs = "";
    for (const [fp, output] of result.outputs ?? []) {
      if (fp.includes(tag)) {
        clientJs = output.clientJs ?? "";
        serverJs = output.serverJs ?? "";
      }
    }
    const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
    return { errors, clientJs, serverJs };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function findGiven(nodes, out = []) {
  for (const n of nodes ?? []) {
    if (!n || typeof n !== "object") continue;
    if (n.kind === "given-guard") out.push(n);
    for (const k of ["body", "children", "consequent", "alternate", "nodes"]) {
      if (Array.isArray(n[k])) findGiven(n[k], out);
    }
  }
  return out;
}

const HEAD = `type User:struct = { name: string }
<user>: User | not = not
<other>: User | not = not
<msg>: string = ""
`;
const prog = (body) => `<program>\n${HEAD}${body}\n</program>\n`;
const GET = (n) => `_scrml_cs_reactive_get("${n}")`;
const CHECK = (ref) => `${ref} !== null && ${ref} !== undefined`;

// ---------------------------------------------------------------------------
// §1 parse — the cell bit is recorded
// ---------------------------------------------------------------------------

describe("§1 parse: `variableIsCell` records which head names were written `@x`", () => {
  test("logic-context given: `given p, @user` → [false, true]", () => {
    const { ast } = buildAST(splitBlocks("/t/a.scrml", prog(`\${ function f(p) { given p, @user :> { @msg = p } } }`)));
    const [g] = findGiven(ast.nodes);
    expect(g.variables).toEqual(["p", "user"]);
    expect(g.variableIsCell).toEqual([false, true]);
  });

  test("markup-context given: `${ given @user :> {…} }` → [true]", () => {
    const { ast } = buildAST(splitBlocks("/t/a.scrml", prog(`<main>\${ given @user :> { <p>x</p> } }</main>`)));
    const [g] = findGiven(ast.nodes);
    expect(g.variables).toEqual(["user"]);
    expect(g.variableIsCell).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// §2 emitter unit — cell head through the expression emitter; locals bare
// ---------------------------------------------------------------------------

describe("§2 emit-logic given-guard head lowering", () => {
  test("a cell head lowers through the reactive accessor", () => {
    const out = emitLogicNode({ kind: "given-guard", variables: ["user"], variableIsCell: [true], body: [] });
    expect(out).toBe(`if (_scrml_reactive_get("user") !== null && _scrml_reactive_get("user") !== undefined) {\n}`);
  });

  test("a derived cell head lowers through the derived accessor", () => {
    const out = emitLogicNode(
      { kind: "given-guard", variables: ["d"], variableIsCell: [true], body: [] },
      { derivedNames: new Set(["d"]) },
    );
    expect(out).toContain(`_scrml_derived_get("d") !== null && _scrml_derived_get("d") !== undefined`);
  });

  test("a local head is byte-identical to the pre-s461 emission", () => {
    const out = emitLogicNode({ kind: "given-guard", variables: ["x"], variableIsCell: [false], body: [] });
    expect(out).toBe("if (x !== null && x !== undefined) {\n}");
  });

  test("a node with no `variableIsCell` (hand-built / native bridge) keeps the bare name", () => {
    const out = emitLogicNode({ kind: "given-guard", variables: ["x"], body: [] });
    expect(out).toBe("if (x !== null && x !== undefined) {\n}");
  });

  test("SERVER boundary: a cell head keeps the pre-s461 bare name (deliberately unchanged)", () => {
    const out = emitLogicNode(
      { kind: "given-guard", variables: ["user"], variableIsCell: [true], body: [] },
      { boundary: "server" },
    );
    expect(out).toBe("if (user !== null && user !== undefined) {\n}");
  });
});

// ---------------------------------------------------------------------------
// §3 full compile — every logic position
// ---------------------------------------------------------------------------

describe("§3 full compile: logic positions read the cell, never a bare name", () => {
  test("the reported repro: function body + markup guard", () => {
    const { errors, clientJs } = compileSource(prog(
      `\${\n  function show() {\n    given @user :> { @msg = @user.name }\n  }\n}\n` +
      `<main>\n  <button onclick=show()>go</button>\n  \${ given @user :> { <p>\${@user.name}</p> } }\n</main>`,
    ));
    expect(errors).toEqual([]);
    expect(clientJs).not.toContain("user !== null");
    expect(clientJs).not.toMatch(/\buser !== undefined/);
    // Both guards read the cell through the accessor every other read uses.
    expect(clientJs.split(`if (${CHECK(GET("user"))}) {`).length - 1).toBe(2);
    // …and the markup guard's body is no longer dropped.
    expect(clientJs).toContain(`document.createElement("p")`);
    expect(clientJs).toContain(`${GET("user")}.name`);
  });

  test("a function used as an event handler", () => {
    const { errors, clientJs } = compileSource(prog(
      `\${ function h(e) { given @user :> { @msg = "h" } } }\n<main><button onclick=h()>h</button><p>\${@msg}</p></main>`,
    ));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (${CHECK(GET("user"))}) {`);
    expect(clientJs).not.toContain("user !== null");
  });

  test("program top level, inside `${}` (logic body)", () => {
    const { errors, clientJs } = compileSource(prog(
      `\${ given @user :> { @msg = @user.name } }\n<main><p>\${@msg}</p></main>`,
    ));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (${CHECK(GET("user"))}) {`);
    expect(clientJs).not.toContain("user !== null");
  });

  test("multi-variable: `given @user, @other` — all-or-nothing over both cells", () => {
    const { errors, clientJs } = compileSource(prog(
      `\${ function f() { given @user, @other :> { @msg = @other.name } } }\n<main><button onclick=f()>f</button><p>\${@msg}</p></main>`,
    ));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (${CHECK(GET("user"))} && ${CHECK(GET("other"))}) {`);
  });

  test("MIXED local + cell: `given p, @user` — the local stays a bare name", () => {
    const { errors, clientJs } = compileSource(prog(
      `\${ function f(p) { given p, @user :> { @msg = p } } }\n<main><button onclick=f("x")>f</button><p>\${@msg}</p></main>`,
    ));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (${CHECK("p")} && ${CHECK(GET("user"))}) {`);
  });

  test("a plain local / parameter: `given p` emits exactly the pre-s461 guard", () => {
    const { errors, clientJs } = compileSource(prog(
      `\${ function f(p) { given p :> { @msg = p } } }\n<main><button onclick=f("x")>f</button><p>\${@msg}</p></main>`,
    ));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (p !== null && p !== undefined) {`);
  });

  test("deprecated `=>` separator lowers identically (logic)", () => {
    const { errors, clientJs } = compileSource(prog(
      `\${ function f() { given @user => { @msg = "legacy" } } }\n<main><button onclick=f()>f</button><p>\${@msg}</p></main>`,
    ));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (${CHECK(GET("user"))}) {`);
    expect(clientJs).not.toContain("user !== null");
  });
});

// ---------------------------------------------------------------------------
// §4 markup `${ given … }` — the body renders (§17.6.10 implied lift)
// ---------------------------------------------------------------------------

describe("§4 markup given: the guarded body renders, reactively", () => {
  test("the §42.3.5 worked example emits a reactive lift group gated on the cell", () => {
    const { errors, clientJs } = compileSource(prog(`<main>\${ given @user :> { <p>\${@user.name}</p> } }</main>`));
    expect(errors).toEqual([]);
    expect(clientJs).toContain("_scrml_effect(function() {");
    expect(clientJs).toContain(`if (${CHECK(GET("user"))}) {`);
    expect(clientJs).toContain("_scrml_lift(");
    expect(clientJs).toContain(`document.createElement("p")`);
  });

  test("bare-markup body ≡ explicit `lift` body (§17.6.10 equivalence)", () => {
    const norm = (s) => s.replace(/(?<![0-9a-z])0[0-9a-z]{7}(?![0-9a-z])/g, "NS").replace(/_(\d+)\b/g, "_N").replace(/\s+/g, " ");
    const bare = compileSource(prog(`<main>\${ given @user :> { <p>\${@user.name}</p> } }</main>`));
    const lift = compileSource(prog(`<main>\${ given @user :> { lift <p>\${@user.name}</p> } }</main>`));
    expect(bare.errors).toEqual([]);
    expect(lift.errors).toEqual([]);
    expect(norm(bare.clientJs)).toBe(norm(lift.clientJs));
  });

  test("deprecated `=>` separator in markup renders identically", () => {
    const { errors, clientJs } = compileSource(prog(`<main>\${ given @user => { <p>\${@user.name}</p> } }</main>`));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (${CHECK(GET("user"))}) {`);
    expect(clientJs).toContain(`document.createElement("p")`);
  });

  test("multi-variable markup guard", () => {
    const { errors, clientJs } = compileSource(prog(`<main>\${ given @user, @other :> { <p>\${@other.name}</p> } }</main>`));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`if (${CHECK(GET("user"))} && ${CHECK(GET("other"))}) {`);
    expect(clientJs).toContain(`document.createElement("p")`);
  });
});

// ---------------------------------------------------------------------------
// §5 unchanged: diagnostics, component refusal, server functions
// ---------------------------------------------------------------------------

describe("§5 what compiles is unchanged", () => {
  test("E-STATE-UNDECLARED still fires on a read inside a markup given body", () => {
    expect(compileSource(prog(`<main>\${ given @user :> { <p>\${@nope}</p> } }</main>`)).errors).toContain("E-STATE-UNDECLARED");
  });

  test("E-TYPE-046 still fires on an unguarded optional hop inside a markup given body", () => {
    const src = `<obj>: { optField: { x: string } | not, req: string } | not\n` +
      `<main>\${ given @obj :> { <p>\${@obj.optField.x}</p> } }</main>`;
    expect(compileSource(src).errors).toContain("E-TYPE-046");
  });

  test("E-TYPE-046 still fires on a DIFFERENT, un-narrowed cell inside the body", () => {
    expect(compileSource(prog(`<main>\${ given @user :> { <p>\${@other.name}</p> } }</main>`)).errors).toContain("E-TYPE-046");
  });

  test("the narrowed cell itself is still accepted (`@user.name` under `given @user`)", () => {
    expect(compileSource(prog(`<main>\${ given @user :> { <p>\${@user.name}</p> } }</main>`)).errors).toEqual([]);
  });

  test("component-body `given` refusal is unchanged (E-SCOPE-001, g-component-body-given-match-unusable-s459)", () => {
    const src = `<program>\nconst Card = <div props={ onGo?: () => void }><button onclick=\${() => { given onGo :> { onGo() } }}>b</button></div>\n<main><Card/></main>\n</program>\n`;
    expect(compileSource(src).errors).toContain("E-SCOPE-001");
  });

  test("server function: a body read of the cell is still refused (E-REACTIVE-003)", () => {
    const src = prog(`\${ server function save() { given @user :> { return @user.name } return "" }\n function go() { @msg = save() } }\n<main><button onclick=go()>g</button><p>\${@msg}</p></main>`);
    expect(compileSource(src).errors).toContain("E-REACTIVE-003");
  });

  test("server function: a head-only `given @cell` keeps its pre-s461 server emission", () => {
    const src = prog(`\${ server function save() { given @user :> { return "x" } return "" }\n function go() { @msg = save() } }\n<main><button onclick=go()>g</button><p>\${@msg}</p></main>`);
    const { errors, serverJs } = compileSource(src);
    expect(errors).toEqual([]);
    expect(serverJs).toContain("if (user !== null && user !== undefined) {");
    expect(serverJs).not.toContain(`_scrml_body["user"] !== null`);
  });
});

// ---------------------------------------------------------------------------
// §6 fix round (review of 4c1813a): coverage below a given, at ANY depth
// ---------------------------------------------------------------------------
//
// The first cut kept a given body's pre-desugar pieces only when the arm's DIRECT
// parent was the given guard, so an `if` arm nested inside a given body — which
// planIfCascade now reaches — lost E-TYPE-046 / E-STATE-UNDECLARED / E-SCOPE-001
// (and its emitted `.opt.x` threw TypeError at runtime). The fix keeps the pieces
// for every arm the pre-s461 pass would not have desugared
// (implied-lift-desugar.ts `keepPiecesForArmsBaseNeverPlanned`), and both
// checkers expand them wherever they sit.

const NEST = `type In:struct = { x: string }
type O:struct = { opt: In | not }
type U:struct = { name: string }
<o>: O | not = not
<u>: U | not = not
<a>: U | not = not
<b>: U | not = not
<c>: boolean = true
<d>: boolean = false
`;
const nest = (body) => `<program>\n${NEST}<main><div>${body}</div></main>\n</program>\n`;

describe("§6 diagnostics under a given are kept at every nesting depth", () => {
  test("r1 given → if: E-STATE-UNDECLARED on `${@usr.name}`", () => {
    expect(compileSource(nest(`\${ given @u :> { if (@c) { <p>\${@usr.name}</p> } } }`)).errors).toContain("E-STATE-UNDECLARED");
  });

  test("r2 given → if: E-TYPE-046 on `${@o.opt.x}`", () => {
    expect(compileSource(nest(`\${ given @o :> { if (@c) { <p>\${@o.opt.x}</p> } } }`)).errors).toContain("E-TYPE-046");
  });

  test("r3 given → if/else: E-SCOPE-001 on `${nosuch}`", () => {
    expect(compileSource(nest(`\${ given @u :> { if (@c) { <p>\${nosuch}</p> } else { <p>e</p> } } }`)).errors).toContain("E-SCOPE-001");
  });

  test("two levels: given → if → if: E-TYPE-046", () => {
    expect(compileSource(nest(`\${ given @o :> { if (@c) { if (@d) { <p>\${@o.opt.x}</p> } } } }`)).errors).toContain("E-TYPE-046");
  });

  test("two levels: given → if/else → given: E-STATE-UNDECLARED", () => {
    expect(compileSource(nest(`\${ given @o :> { if (@c) { <p>a</p> } else { given @u :> { <p>\${@nope.name}</p> } } } }`)).errors).toContain("E-STATE-UNDECLARED");
  });

  test("given → given: E-STATE-UNDECLARED on `${@bb.name}`", () => {
    expect(compileSource(nest(`\${ given @a :> { given @b :> { <p>\${@bb.name}</p> } } }`)).errors).toContain("E-STATE-UNDECLARED");
  });

  test("if → given: E-STATE-UNDECLARED on `${@aa.name}`", () => {
    expect(compileSource(nest(`\${ if (@c) { given @a :> { <p>\${@aa.name}</p> } } }`)).errors).toContain("E-STATE-UNDECLARED");
  });

  test("the SIBLING arm of an if whose other arm holds a given keeps its check (E-SCOPE-001)", () => {
    expect(compileSource(nest(`\${ if (@c) { given @o :> { <p>a</p> } } else { <p>\${nosuch}</p> } }`)).errors).toContain("E-SCOPE-001");
  });

  test("the narrowed cell is still accepted two levels down (`@o.opt?.x` under given @o → if)", () => {
    expect(compileSource(nest(`\${ given @o :> { if (@c) { <p>\${@o.opt?.x}</p> } } }`)).errors).toEqual([]);
  });

  test("given → if still renders (the lift is emitted)", () => {
    const { errors, clientJs } = compileSource(nest(`\${ given @u :> { if (@c) { <p>\${@u.name}</p> } } }`));
    expect(errors).toEqual([]);
    expect(clientJs).toContain(`document.createElement("p")`);
  });
});
