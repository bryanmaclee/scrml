/**
 * §20.7 — print() / println() FULL-COMPILE behaviour:
 *   - tool-inline (`_scrml_print` inlined into a `kind="tool"` module, NOT an
 *     E-TOOL-005 gap) + the real emitted stdout is clean (`hello 42\n`);
 *   - web-`<program>` escalation: a fn calling print is server-placed (§12.2
 *     Trigger 3 — host stdout is server-only), the client bundle carries none;
 *   - E-PRINT-NON-PRIMITIVE on a struct / enum / array / map / markup / `not`;
 *   - W-PRINT-SHADOWED on a user `function print` / `println`;
 *   - production build does NOT strip print (program output, §20.7.4).
 *
 * Landed S241 (SPEC §20.7; forks A(i)/B(i)).
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compile(src, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-print-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {}, ...opts });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out, dir, file };
}
const errCodes = (r) => (r.errors ?? []).map((e) => e.code);
const warnCodes = (r) => (r.warnings ?? []).map((w) => w.code);

const TOOL = (body) => `<program kind="tool" lang="ts">
    function main(args: string[]): number {
${body}
        return 0
    }
</program>`;

// ---------------------------------------------------------------------------
// §A — kind="tool" inline + clean real stdout
// ---------------------------------------------------------------------------

describe("§20.7 — kind=\"tool\" inline + clean stdout", () => {
  test("a tool println/print inlines _scrml_print — NO E-TOOL-005 gap", () => {
    const { result, out } = compile(TOOL(`        println("hello", 42)`));
    expect(errCodes(result)).not.toContain("E-TOOL-005");
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(out.toolJs).toContain("function _scrml_print(");
    expect(out.toolJs).toContain('_scrml_print(("hello") + " " + (42) + "\\n")');
    // NO log-style decoration path.
    expect(out.toolJs).not.toContain("_scrml_log");
  });

  test("the emitted tool, RUN with bun, prints exactly `hello 42\\n` (no decoration)", () => {
    const { out, dir } = compile(TOOL(`        println("hello", 42)`));
    const jsFile = join(dir, "app.js");
    writeFileSync(jsFile, out.toolJs);
    const proc = Bun.spawnSync(["bun", jsFile]);
    const stdout = new TextDecoder().decode(proc.stdout);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    expect(stdout).toBe("hello 42\n");
    // clean: no [server]/[client] tag, no (file:line)
    expect(stdout).not.toContain("[server]");
    expect(stdout).not.toContain("app.scrml");
  });

  test("print (no newline) emits no trailing \\n", () => {
    const { out, dir } = compile(TOOL(`        print("a")\n        print("b")`));
    const jsFile = join(dir, "app.js");
    writeFileSync(jsFile, out.toolJs);
    const proc = Bun.spawnSync(["bun", jsFile]);
    const stdout = new TextDecoder().decode(proc.stdout);
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    expect(stdout).toBe("ab");
  });
});

// ---------------------------------------------------------------------------
// §B — E-PRINT-NON-PRIMITIVE (§20.7.2)
// ---------------------------------------------------------------------------

describe("§20.7.2 — E-PRINT-NON-PRIMITIVE", () => {
  test("an array-literal arg is rejected", () => {
    const { result } = compile(TOOL(`        println([1, 2, 3])`));
    expect(errCodes(result)).toContain("E-PRINT-NON-PRIMITIVE");
  });

  test("an object/struct-literal arg is rejected", () => {
    const { result } = compile(TOOL(`        println({ a: 1 })`));
    expect(errCodes(result)).toContain("E-PRINT-NON-PRIMITIVE");
  });

  test("a struct-typed identifier arg is rejected", () => {
    const src = `<program kind="tool" lang="ts">
    type User = { name: string, age: number }
    function main(args: string[]): number {
        const u: User = { name: "x", age: 3 }
        println(u)
        return 0
    }
</program>`;
    const { result } = compile(src);
    expect(errCodes(result)).toContain("E-PRINT-NON-PRIMITIVE");
  });

  test("a bare `not` arg is rejected", () => {
    const { result } = compile(TOOL(`        println(not)`));
    expect(errCodes(result)).toContain("E-PRINT-NON-PRIMITIVE");
  });

  test("string / number / boolean args are ACCEPTED (no E-PRINT-NON-PRIMITIVE)", () => {
    const { result } = compile(TOOL(`        println("s", 42, true)\n        print("x")`));
    expect(errCodes(result)).not.toContain("E-PRINT-NON-PRIMITIVE");
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
  });

  test("the E-PRINT-NON-PRIMITIVE code carries severity error", () => {
    const { result } = compile(TOOL(`        println([1])`));
    const d = (result.errors ?? []).find((e) => e.code === "E-PRINT-NON-PRIMITIVE");
    expect(d).toBeTruthy();
    expect(d.severity ?? "error").toBe("error");
  });
});

// ---------------------------------------------------------------------------
// §C — W-PRINT-SHADOWED (§20.7.5)
// ---------------------------------------------------------------------------

describe("§20.7.5 — W-PRINT-SHADOWED", () => {
  test("a user `function println` fires W-PRINT-SHADOWED (info) + the builtin steps aside", () => {
    const src = `<program kind="tool" lang="ts">
    function println(x: string): number { return 0 }
    function main(args: string[]): number {
        println("hi")
        return 0
    }
</program>`;
    const { result, out } = compile(src);
    expect(warnCodes(result)).toContain("W-PRINT-SHADOWED");
    const d = (result.warnings ?? []).find((w) => w.code === "W-PRINT-SHADOWED");
    expect(d.severity).toBe("info");
    // the builtin stepped aside — no raw-stdout _scrml_print for the shadowed name
    expect(out.toolJs).not.toContain("_scrml_print(");
  });

  test("no shadow → no W-PRINT-SHADOWED", () => {
    const { result } = compile(TOOL(`        println("hi")`));
    expect(warnCodes(result)).not.toContain("W-PRINT-SHADOWED");
  });
});

// ---------------------------------------------------------------------------
// §D — web-<program> server escalation (§20.7.3 / §12.2 Trigger 3)
// ---------------------------------------------------------------------------

describe("§20.7.3 — web-<program> print server-escalates", () => {
  test("a web fn calling println is server-placed; the client bundle carries none", () => {
    const src = `<program lang="ts">
  <button onclick=doIt()>go</button>
  \${
    function doIt() {
      println("server side")
    }
  }
</program>`;
    const { result, out } = compile(src);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(out.serverJs).toContain("_scrml_print(");
    expect(out.serverJs).toContain("function _scrml_print(");
    expect(out.clientJs ?? "").not.toContain("_scrml_print(");
  });
});

// ---------------------------------------------------------------------------
// §D2 — the print server-only signal is AST-level, NOT string-scanned:
// `print(` inside a STRING / COMMENT must NOT escalate a client fn (the HIGH
// regression). A user-shadowed client `print` must also NOT escalate.
// ---------------------------------------------------------------------------

describe("§20.7.3 — print signal is string/comment-safe (no spurious escalation)", () => {
  // A pure-client fn: writes only a client cell, no real print call.
  const clientFn = (bodyLine) => `<program>
  \${ @msg = ""
     function setClient() {
${bodyLine}
       @msg = "done"
     } }
  <div class="app"><button onclick=setClient()>go</button> \${@msg}</div>
</program>`;

  test("`print(` inside a STRING LITERAL does NOT server-escalate (no route, no E-CPS)", () => {
    const { result, out } = compile(clientFn(`       @msg = "call print(x) in docs"`));
    // the confirmed cascade code from the bug report must NOT appear
    expect(errCodes(result)).not.toContain("E-CPS-NONIDEM-NO-STORAGE");
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    // no server route for the client-only fn; no _scrml_print anywhere
    expect(out.serverJs ?? "").not.toContain("__ri_route");
    expect(out.serverJs ?? "").not.toContain("_scrml_print(");
    expect(out.clientJs ?? "").not.toContain("_scrml_print(");
  });

  test("`println(` inside a // COMMENT does NOT server-escalate", () => {
    const { result, out } = compile(clientFn(`       // TODO: println(debug) here later`));
    expect(errCodes(result)).not.toContain("E-CPS-NONIDEM-NO-STORAGE");
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(out.serverJs ?? "").not.toContain("__ri_route");
    expect(out.clientJs ?? "").not.toContain("_scrml_print(");
  });

  test("a user-shadowed client `println` does NOT server-escalate (shadow edge closed)", () => {
    const src = `<program>
  <button onclick=doIt()>go</button>
  \${ function println(x: string) { return 0 }
      @msg = ""
      function doIt() { println("hi"); @msg = "x" } }
  <div>\${@msg}</div>
</program>`;
    const { result, out } = compile(src);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    // the shadowed println is a client fn call — no server route, no host-stdout helper
    expect(out.serverJs ?? "").not.toContain("_scrml_print(");
    expect(out.clientJs ?? "").not.toContain("_scrml_print(");
  });

  test("CONTROL — a GENUINE println(x) call DOES still server-escalate", () => {
    const src = `<program>
  <button onclick=doIt()>go</button>
  \${ function doIt() { println("real", 1) } }
</program>`;
    const { result, out } = compile(src);
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(out.serverJs).toContain("_scrml_print(");
    expect(out.clientJs ?? "").not.toContain("_scrml_print(");
  });
});

// ---------------------------------------------------------------------------
// §E — production: NOT stripped (§20.7.4)
// ---------------------------------------------------------------------------

describe("§20.7.4 — print survives a production build", () => {
  test("a production build keeps _scrml_print + the output text (unlike log)", () => {
    const { out } = compile(TOOL(`        println("real output")`), { production: true });
    expect(out.toolJs).toContain("_scrml_print(");
    expect(out.toolJs).toContain("real output");
  });
});
