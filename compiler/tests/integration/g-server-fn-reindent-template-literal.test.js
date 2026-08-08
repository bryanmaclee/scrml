/**
 * g-server-fn-body-reindent-corrupts-multiline-template-literals | §48 (server fn) / codegen
 *
 * The server-fn body emitter prefixed EVERY emitted line with an indent
 * (`lines.push(\`${indent}${line}\`)`). When a template literal spans lines, those
 * characters are string CONTENT, not layout — so the blind re-indent injected leading
 * whitespace into every continuation line, silently changing the literal's COOKED value.
 * Benign in the corpus only because every corpus instance is SQL (whitespace-insignificant);
 * the exposure is any server fn returning a multi-line DATA literal — an email body, a
 * CSV/markdown/YAML blob, a PEM key, an LLM prompt.
 *
 * FIX: `indentServerFnBodyLines` is template-literal-aware — it indents code layout but
 * emits a continuation line that begins inside raw template text VERBATIM.
 *
 * This pins the COOKED VALUE (not the artifact bytes) — the class is invisible to an
 * artifact-only differential, so the test evals the emitted literal directly.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const TMP = join(tmpdir(), "scrml-server-fn-reindent");

function compileServerJs(src) {
  const dir = join(TMP, "case");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "app.scrml");
  writeFileSync(entry, src);
  const result = compileScrml({ inputFiles: [entry], write: false, log: () => {} });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
  let serverJs = null;
  for (const [fp, o] of result.outputs ?? new Map()) {
    if (fp.endsWith(".server.js") && o.serverJs) serverJs = o.serverJs;
    else if (fp.endsWith(".server.js") && typeof o === "string") serverJs = o;
  }
  // Fallback: some shapes carry serverJs on the entry output object.
  if (!serverJs) {
    for (const [, o] of result.outputs ?? new Map()) if (o && o.serverJs) { serverJs = o.serverJs; break; }
  }
  return { errors, serverJs };
}

describe("g-server-fn-body-reindent — a multi-line DATA template literal keeps its cooked value", () => {
  beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
  afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

  // A non-SQL, non-interpolated multi-line literal (an email body): the continuation
  // lines sit at column 0 in the source and MUST stay at column 0 in the cooked value.
  const SRC = `<program>
  server fn mail() -> string {
    const body = \`Dear customer,
Thank you for your order.
See attached.\`
    return body
  }
  <msg> = ""
  <div><button onclick={ @msg = mail() }>send</button><p>\${ @msg }</p></div>
</program>
`;

  test("the emitted server.js template literal evals to the faithful cooked value (no injected indent)", () => {
    const { errors, serverJs } = compileServerJs(SRC);
    expect(errors).toEqual([]);
    expect(serverJs).not.toBeNull();
    // Extract the `const body = \`…\`;` literal and eval it in isolation (no interp).
    const m = serverJs.match(/const body = (`[^`]*`)\s*;/);
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    const cooked = eval(m[1]);
    expect(cooked).toBe("Dear customer,\nThank you for your order.\nSee attached.");
    // And explicitly: no continuation line carries the pre-fix injected leading spaces.
    expect(cooked).not.toMatch(/\n[ \t]+Thank you/);
    expect(cooked).not.toMatch(/\n[ \t]+See attached/);
  });

  test("a nested `${`…`}` interpolation still lowers as code (layout) without corrupting inner raw text", () => {
    const src = `<program>
  server fn tag() -> string {
    const inner = \`a
b\`
    const body = \`start
\${inner}
end\`
    return body
  }
  <msg> = ""
  <div><button onclick={ @msg = tag() }>x</button><p>\${ @msg }</p></div>
</program>
`;
    const { errors, serverJs } = compileServerJs(src);
    expect(errors).toEqual([]);
    // The INNER literal's continuation line stays verbatim.
    const mi = serverJs.match(/const inner = (`[^`]*`)\s*;/);
    expect(mi).not.toBeNull();
    // eslint-disable-next-line no-eval
    expect(eval(mi[1])).toBe("a\nb");
  });
});
