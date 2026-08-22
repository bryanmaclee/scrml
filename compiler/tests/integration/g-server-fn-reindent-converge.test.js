/**
 * g-server-fn-reindent — the converged, regex-aware re-indenter (S361) | §48 / codegen
 *
 * Re-indenting an emitted fn body by `split("\n") + prefix` corrupts a multi-line
 * template literal's COOKED value (leading whitespace injected into every continuation
 * line — an email body / CSV / PEM / LLM prompt ships wrong). Three copies of the
 * re-indenter existed: emit-server's template-aware lexer, which DESYNCED on a regex
 * literal (`name.replace(/['"]/g, "")` — the `'` inside opened a phantom string), and
 * two BLIND `split+prefix` loops in emit-tool / emit-library-shared that corrupted a
 * multi-line template unconditionally. S361 converged them onto ONE shared
 * `indentBodyLines` (codegen/utils.ts) and gave it regex-literal handling.
 *
 * These pins are two-level: unit tests of `indentBodyLines` directly (the lexer's
 * adversarial surface — division vs regex, char classes, backtick-in-regex, keyword
 * position) and integration tests that the wiring holds at the server + tool sites
 * (the cooked value survives an end-to-end compile).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { indentBodyLines } from "../../src/codegen/utils.ts";

const j = (code, indent = "  ") => indentBodyLines(code, indent).join("\n");

describe("indentBodyLines — a newline inside raw template text is content, everything else is layout", () => {
  test("plain multi-line template: continuation lines NOT indented (the blind-site bug)", () => {
    expect(j("const body = `line one\nline two\nline three`;"))
      .toBe("  const body = `line one\nline two\nline three`;");
  });

  test("ordinary multi-line code: EVERY line indented", () => {
    expect(j("if (x) {\nconst y = 1;\n}")).toBe("  if (x) {\n  const y = 1;\n  }");
  });

  test("regex with quotes before a template does NOT desync (the emit-server bug)", () => {
    expect(j('const clean = name.replace(/[\'"]/g, "");\nconst body = `Dear,\nThanks.`;'))
      .toBe('  const clean = name.replace(/[\'"]/g, "");\n  const body = `Dear,\nThanks.`;');
  });

  test("division `a / b` is NOT mistaken for a regex", () => {
    expect(j("const r = a / b;\nconst body = `x\ny`;"))
      .toBe("  const r = a / b;\n  const body = `x\ny`;");
  });

  test("regex char class containing a slash `/[/]/`", () => {
    expect(j("const re = /[/]/g;\nconst body = `p\nq`;"))
      .toBe("  const re = /[/]/g;\n  const body = `p\nq`;");
  });

  test("regex containing a backtick `/[`]/`", () => {
    expect(j("const re = /[`]/;\nconst body = `a\nb`;"))
      .toBe("  const re = /[`]/;\n  const body = `a\nb`;");
  });

  test("keyword-preceding regex: `return /a\\/b/`", () => {
    expect(j("if (x) return /a\\/b/.test(s);\nconst body = `m\nn`;"))
      .toBe("  if (x) return /a\\/b/.test(s);\n  const body = `m\nn`;");
  });

  test("template interpolation code is layout (a regex inside `${...}` is handled)", () => {
    expect(j('const body = `x ${ s.replace(/[\'"]/g,"") }\nnext`;'))
      .toBe('  const body = `x ${ s.replace(/[\'"]/g,"") }\nnext`;');
  });

  test("division after a template-close: `` `abc`.length / 2 ``", () => {
    expect(j("const n = `abc`.length / 2;\nconst body = `p\nq`;"))
      .toBe("  const n = `abc`.length / 2;\n  const body = `p\nq`;");
  });

  test("line comment with a slash and a quote does not open a phantom state", () => {
    expect(j("// boundary: 'p' or /x/\nconst body = `a\nb`;"))
      .toBe("  // boundary: 'p' or /x/\n  const body = `a\nb`;");
  });
});

// ---- integration: the cooked value survives an end-to-end compile ----

const TMP = join(tmpdir(), "scrml-reindent-converge");
function compileOut(src, suffix, key) {
  const dir = join(TMP, "case");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "app.scrml");
  writeFileSync(entry, src);
  const result = compileScrml({ inputFiles: [entry], write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  let out = null;
  for (const [fp, o] of result.outputs ?? new Map()) {
    if (fp.endsWith(suffix)) { out = (o && o[key]) || (typeof o === "string" ? o : null); if (out) break; }
  }
  if (!out) for (const [, o] of result.outputs ?? new Map()) if (o && o[key]) { out = o[key]; break; }
  return { errors, out };
}

describe("reindent converge — end-to-end cooked value at the server + tool sites", () => {
  beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  test("SERVER fn: a regex before a multi-line template no longer corrupts the cooked value", () => {
    const src = `<program>
  server fn build(name: string) -> string {
    const clean = name.replace(/['"]/g, "")
    const body = \`Dear customer,
Thank you for your order.
See attached.\`
    return clean + body
  }
  <msg> = ""
  <div><button onclick={ @msg = build("x") }>send</button><p>\${ @msg }</p></div>
</program>
`;
    const { errors, out } = compileOut(src, ".server.js", "serverJs");
    expect(errors).toEqual([]);
    const m = out && out.match(/const body = (`[^`]*`)\s*;/);
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    expect(eval(m[1])).toBe("Dear customer,\nThank you for your order.\nSee attached.");
  });

  test("TOOL main: a multi-line template body keeps its cooked value (blind-sibling fix)", () => {
    const src = `<program kind="tool" lang="ts">
function main(args: string[]) -> number {
  const body = \`line one
line two
line three\`
  println(body)
  return 0
}
</program>
`;
    const { errors, out } = compileOut(src, ".js", "toolJs");
    // tool output key varies; fall back to scanning any emitted string output
    let js = out;
    if (!js) {
      const r = compileScrml({ inputFiles: [(() => { const d = join(TMP, "t"); mkdirSync(d, { recursive: true }); const e = join(d, "app.scrml"); writeFileSync(e, src); return e; })()], write: false, log: () => {} });
      for (const [fp, o] of r.outputs ?? new Map()) if (fp.endsWith(".js") && typeof o === "string") { js = o; break; }
      for (const [, o] of r.outputs ?? new Map()) if (!js && o && typeof o === "object") for (const v of Object.values(o)) if (typeof v === "string" && v.includes("line one")) { js = v; break; }
    }
    expect(errors).toEqual([]);
    expect(js).not.toBeNull();
    const m = js.match(/const body = (`[^`]*`)\s*;?/);
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    expect(eval(m[1])).toBe("line one\nline two\nline three");
  });
});
