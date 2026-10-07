/**
 * s456 — adopter flogence (S56): two defects at the `_={ … }=` foreign slice, plus the
 * audit of the codegen class one of them belongs to.
 *
 * ROOT 2 (lexing). The slice's SHAPE (single expression vs statement body, §23.2.4a) and its
 * crossing-shadow check (E-FOREIGN-006) were decided by hand character scanners that did not
 * know regex literals: the `'` in `/['x]/g` opened a "string" that swallowed the rest of the
 * slice and hid its top-level `return`, so a valid slice was refused as "no top-level `;` and
 * no top-level `return`". Both scans now read the slice as tokens from the JS lexer
 * (foreign-seal.ts `scanForeignSliceShape` / `scanForeignSliceTopLevelBindings`).
 *
 * ROOT 1 (lost diagnostic). A codegen refusal (E-FOREIGN-006/007, E-SQL-006) travelled on a
 * channel threaded through emit opts; an `if` / loop body's freshly built opts did not carry it,
 * so a refusal one block deep compiled exit 0 with only a `null /* E-… *\/` placeholder in the
 * artifact. Refusals now go to the run-wide sink drained by runCG
 * (codegen/refused-lowering-errors.ts). The audit found the same fail-open in E-LIFT-002
 * (comment only, never reported) and E-SESSION-VALUE (its sink drained only by the web-app
 * server emitter).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { scanForeignSliceShape, scanForeignSliceTopLevelBindings } from "../../src/codegen/foreign-seal.ts";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const _dirs = [];
afterAll(() => { for (const d of _dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

const errCodes = (r) => (r.errors ?? []).map((d) => d.code);

function compileTo(name, src, { withDb = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `foreign-slice-lexing-${name}-`));
  _dirs.push(dir);
  if (withDb) new Database(join(dir, "app.db")).close();
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dist, log: () => {} });
  return { result, dir, dist, jsPath: join(dist, `${name}.js`) };
}

function runTool(name, src) {
  const c = compileTo(name, src);
  const run = Bun.spawnSync({ cmd: ["bun", c.jsPath], cwd: c.dir, stdout: "pipe", stderr: "pipe" });
  return { ...c, stdout: run.stdout.toString(), stderr: run.stderr.toString(), exitCode: run.exitCode };
}

// ---------------------------------------------------------------------------
// 1. The shape scan reads tokens, not characters.
// ---------------------------------------------------------------------------
describe("scanForeignSliceShape — the slice as JS tokens", () => {
  const shape = (src) => {
    const r = scanForeignSliceShape(src);
    return { ret: r.topLevelReturn, sep: r.topLevelStmtSep, parsed: r.parsed };
  };

  test("a quote inside a regex literal does not open a string (the flogence repro)", () => {
    expect(shape(`const clean = (x) => String(x).replace(/['x]/g, "")\nreturn clean("it's")`))
      .toEqual({ ret: true, sep: false, parsed: true });
  });

  test("a double quote and a backtick inside regex classes", () => {
    expect(shape("const a = /[\"]/g\nconst b = /[`]/g\nreturn a")).toEqual({ ret: true, sep: false, parsed: true });
  });

  test("a `/` inside a regex class, and flags", () => {
    expect(shape("const s = /[/]+/gimsuy\nreturn s")).toEqual({ ret: true, sep: false, parsed: true });
  });

  test("division chains are division, not a regex — a single expression", () => {
    expect(shape("a / b / c")).toEqual({ ret: false, sep: false, parsed: true });
    expect(shape("(x) / 2 / y")).toEqual({ ret: false, sep: false, parsed: true });
  });

  test("a regex after `)` of an `if` is a regex (statement context), not a division", () => {
    expect(shape("if (q) /[;']/.test(s)\nreturn 1")).toEqual({ ret: true, sep: false, parsed: true });
  });

  test("quotes in comments are not strings", () => {
    expect(shape("// it's here\n/* and 'here' */\nreturn 1")).toEqual({ ret: true, sep: false, parsed: true });
  });

  test("a template literal with a nested template in a `${}` hole", () => {
    expect(shape("`<${a ? `${b};` : \"c\"}>`")).toEqual({ ret: false, sep: false, parsed: true });
    expect(shape("const t = `${x}`\nreturn t")).toEqual({ ret: true, sep: false, parsed: true });
  });

  test("`;` and `return` inside strings, nested functions and `for(;;)` are not top level", () => {
    expect(shape(`["a;b", "return"].map((x) => { return x; })`)).toEqual({ ret: false, sep: false, parsed: true });
    expect(shape("for (let i = 0; i < 2; i++) f(i)\nreturn 1")).toEqual({ ret: true, sep: false, parsed: true });
  });

  test("a member named `.return` / `?.return` is not the keyword (g-foreign-value-block-dot-return-misread-as-keyword)", () => {
    expect(shape("g.return(99)")).toEqual({ ret: false, sep: false, parsed: true });
    expect(shape("g?.return(99)")).toEqual({ ret: false, sep: false, parsed: true });
  });

  test("a top-level `;` is a statement separator", () => {
    expect(shape("f(); g()")).toEqual({ ret: false, sep: true, parsed: true });
  });

  test("a slice that parses in neither shape is reported as not parsed (the caller refuses it)", () => {
    expect(shape(`const s = "unterminated\nreturn s`).parsed).toBe(false);
  });

  // s456 review F1 — a standalone lexer reads `await` as an identifier, so the `/` after it
  // lexed as division and the `'` as an unterminated string. The parser, in the slice's real
  // (async function) context, reads a regex.
  test("`await /'/` is a regex operand of `await` — a single expression", () => {
    expect(shape("await /'/.exec(s)")).toEqual({ ret: false, sep: false, parsed: true });
    expect(shape("await\n/'/.exec(s)")).toEqual({ ret: false, sep: false, parsed: true });
  });

  test("an object literal parses only as an expression — a single expression", () => {
    expect(shape("{ a: 1, b: 2 }")).toEqual({ ret: false, sep: false, parsed: true });
  });

  test("text that parses in neither shape is not parsed (`a = b\\n++/'/.exec(s)`)", () => {
    expect(shape("a = b\n++/'/.exec(s)").parsed).toBe(false);
  });
});

describe("scanForeignSliceTopLevelBindings — the slice as JS tokens", () => {
  const names = new Set(["x", "y", "handler"]);
  test("top-level const / let / var / function / function* / class", () => {
    expect(scanForeignSliceTopLevelBindings("const x = 1", names)).toEqual(["x"]);
    expect(scanForeignSliceTopLevelBindings("let y = 1", names)).toEqual(["y"]);
    expect(scanForeignSliceTopLevelBindings("function* handler() {}", names)).toEqual(["handler"]);
  });
  test("a binding hidden behind a regex quote is still found", () => {
    expect(scanForeignSliceTopLevelBindings("const q = /[']/g\nconst x = 2\nreturn x", names)).toEqual(["x"]);
  });
  test("nested, in-string and property-name occurrences are not top-level bindings", () => {
    expect(scanForeignSliceTopLevelBindings("(() => { const x = 1 })()", names)).toEqual([]);
    expect(scanForeignSliceTopLevelBindings(`"const x = 1"`, names)).toEqual([]);
    expect(scanForeignSliceTopLevelBindings("o.let = 1\no.const = 2", names)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. GAP 2 — the adopter's small repro compiles and runs.
// ---------------------------------------------------------------------------
describe("GAP 2 — a quote inside a regex literal in a slice", () => {
  test("the slice's own `return` is seen; the tool runs", () => {
    const r = runTool("gap2", `<program kind="tool" lang="ts">
function main(args: string[]): number {
  const out = _={ in: { args }
    const clean = (x) => String(x).replace(/['x]/g, "")
    return clean("it's")
  }=
  println("out=" + out)
  return 0
}
</program>
`);
    expect(errCodes(r.result)).toEqual([]);
    expect(r.stdout).toBe("out=its\n");
  });

  test("review F1 — `await /'/.exec(s)` gets its injected `return`; the value crosses", () => {
    const r = runTool("f1await", `<program kind="tool" lang="js">
function main(args: string[]): number {
  const s = "it's"
  const v = _={ in: { s } await /'/.exec(s) }=
  const w = _={ in: { s }
    await
    /'/.exec(s)
  }=
  println("v=" + v[0] + " w=" + w[0])
  return 0
}
</program>
`);
    expect(errCodes(r.result)).toEqual([]);
    expect(r.stdout).toBe("v=' w='\n");
  });

  test("review F1 — text that parses in neither shape is E-FOREIGN-007, never a silent statement body", () => {
    const { result } = compileTo("f1bad", `<program kind="tool" lang="js">
function main(args: string[]): number {
  const s = "x"
  const v = _={ in: { s }
    a = b
    ++/'/.exec(s)
  }=
  println(v)
  return 0
}
</program>
`);
    expect(errCodes(result)).toContain("E-FOREIGN-007");
  });

  test("review F2 — a crossing shadow with a regex quote in the slice is still E-FOREIGN-006", () => {
    const { result } = compileTo("f2shadow", `<program kind="tool" lang="js">
function main(args: string[]): number {
  const s = "x"
  const v = _={ in: { s }
    const s = /'/.source
    return s
  }=
  println(v)
  return 0
}
</program>
`);
    expect(errCodes(result)).toContain("E-FOREIGN-006");
    expect(errCodes(result)).not.toContain("E-FOREIGN-007");
  });
});

// ---------------------------------------------------------------------------
// 3. GAP 1 + the audit — a refusal one block deep fails the compile.
// ---------------------------------------------------------------------------
describe("GAP 1 — codegen refusals reach the compile result wherever the construct sits", () => {
  test("E-FOREIGN-007 inside an `if` in a tool main (exactly one diagnostic, located at the slice)", () => {
    const src = `<program kind="tool" lang="js">
function main(args: string[]): number {
  if (args.length == 0) {
    const plan = _={ in: { args }
      const n = args.length +;
      return n;
    }=
    println(plan)
  }
  return 0
}
</program>
`;
    const { result } = compileTo("gap1", src);
    const e7 = (result.errors ?? []).filter((e) => e.code === "E-FOREIGN-007");
    expect(e7.length).toBe(1);
    expect(e7[0].message).toContain("gap1.scrml:4");
    expect(e7[0].span.line).toBe(4);
  });

  test("E-FOREIGN-006 inside a `for` body names the shadowed binding", () => {
    const { result } = compileTo("shadow", `<program kind="tool" lang="js">
function main(args: string[]): number {
  for (const a of args) {
    const out = _={ in: { a } const a = 1; return a; }=
    println(out)
  }
  return 0
}
</program>
`);
    const e6 = (result.errors ?? []).filter((e) => e.code === "E-FOREIGN-006");
    expect(e6.length).toBe(1);
    expect(e6[0].message).toContain("`a`");
    expect(errCodes(result)).not.toContain("E-FOREIGN-007");
  });

  test("E-SQL-006 inside an `if` in a tool main", () => {
    const { result } = compileTo("prep", `<program kind="tool" lang="js" db="./app.db">
function main(args: string[]): number {
  if (args.length == 0) {
    const s = ?{\`SELECT 1 AS one\`}.prepare()
    println(s)
  }
  return 0
}
</program>
`, { withDb: true });
    expect(errCodes(result).filter((c) => c === "E-SQL-006").length).toBe(1);
  });

  test("E-SQL-006 in a server fn lowered as route handler AND peer callable is reported once", () => {
    const { result } = compileTo("prepdup", `\${
  <items> = []
  function loadUsers() {
    return ?{\`SELECT username FROM users\`}.prepare()
  }
  function both() {
    return loadUsers()
  }
}
<program db="./app.db">
  <button onclick={ @items = both() !{ .Transport(_) :> { return } } }>Load</>
</program>
`, { withDb: true });
    expect(errCodes(result).filter((c) => c === "E-SQL-006").length).toBe(1);
  });

  test("E-LIFT-002 (SPEC §17.6 Example 6) is reported, not only commented", () => {
    const { result } = compileTo("lift2", `<program>
<cond> = true
\${
    const x = if (@cond) {
        lift 1;
        lift 2;
    } else {
        lift 3;
    }
}
<p>\${x}</p>
</program>
`);
    expect(errCodes(result).filter((c) => c === "E-LIFT-002").length).toBe(1);
  });

  test("a single `lift` per arm stays clean", () => {
    const { result } = compileTo("lift1", `<program>
<cond> = true
\${
    const x = if (@cond) {
        lift 1;
    } else {
        lift 3;
    }
}
<p>\${x}</p>
</program>
`);
    expect(errCodes(result)).not.toContain("E-LIFT-002");
  });

  test("§5.2 rule 1 — a QUOTED event attribute in an `<each>` row is a static attribute, as outside one (not a dropped listener)", () => {
    const { result, dist } = compileTo("eachq", `<program>
<items> = [1, 2]
<button onclick="go(0)">top</button>
<ul>
  <each in=@items as it>
    <li><button onclick="go(it)">row</button></li>
  </each>
</ul>
</program>
`);
    expect(errCodes(result)).toEqual([]);
    const client = require("fs").readFileSync(join(dist, "eachq.client.js"), "utf8");
    expect(client).toContain(`.setAttribute("onclick", "go(it)")`);
    expect(client).not.toContain("unsupported event handler shape");
  });

  test("review round 3 — the refusal is case-insensitive (ONCLICK / OnClick / oNcLiCk), and unquoted ONCLICK= / onClick= wire a `click` listener", () => {
    const { result, dist } = compileTo("eachcase", `<program>
<items> = [{ name: "a" }]
\${ function go(n) { log(n) } }
<ul>
  <each in=@items as it>
    <li>
      <button ONCLICK="go('\${it.name}')">a</button>
      <button OnClick="go('\${it.name}')">b</button>
      <button oNcLiCk="go('\${it.name}')">c</button>
      <button ONCLICK=go(it.name)>d</button>
      <button onClick=go(it.name)>e</button>
    </li>
  </each>
</ul>
</program>
`);
    // S456 ruling (SPEC §5.2 rule 6): the refusal is E-ATTR-INTERP-EXECUTABLE (VP-3), one per attribute.
    expect((result.errors ?? []).filter((d) => d.code === "E-ATTR-INTERP-EXECUTABLE").length).toBe(3);
    expect(errCodes(result)).not.toContain("E-CG-003");
    const client = require("fs").readFileSync(join(dist, "eachcase.client.js"), "utf8");
    expect(client).not.toMatch(/_scrml_el_\d+\.setAttribute\("on/i);
    expect((client.match(/_scrml_el_\d+\.addEventListener\("click"/g) ?? []).length).toBe(2);
    expect(client).not.toMatch(/addEventListener\("(CLICK|Click)"/);
  });

  test("review round 2 — a QUOTED event attribute interpolating row data in an `<each>` row is refused (injection sink; E-ATTR-INTERP-EXECUTABLE since S456)", () => {
    const { result, dist } = compileTo("eachinj", `<program>
<items> = [{ name: "a" }, { name: "x');globalThis.__pwn=1;('" }]
<ul>
  <each in=@items as it>
    <li><button onclick="go('\${it.name}')">row</button></li>
  </each>
</ul>
</program>
`);
    const e = (result.errors ?? []).filter((d) => d.code === "E-ATTR-INTERP-EXECUTABLE");
    expect(e.length).toBe(1);
    expect(e[0].message).toContain("JavaScript is never built from interpolated text");
    const client = require("fs").readFileSync(join(dist, "eachinj.client.js"), "utf8");
    expect(client).not.toMatch(/setAttribute\("onclick", `/);
  });

  test("E-SESSION-VALUE in a tool main is reported", () => {
    const { result } = compileTo("sess", `<program kind="tool" lang="js">
function main(args: string[]): number {
  if (args.length == 0) {
    const s = session
    println(s)
  }
  return 0
}
</program>
`);
    expect(errCodes(result)).toContain("E-SESSION-VALUE");
  });
});
