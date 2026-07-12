/**
 * §12.2 Trigger 1 — the server-only `Bun.*` / `process.*` namespace signal set
 * is AST-node-based, NOT string-scanned (g-route-inference-signals-string-blind,
 * S252). A `Bun.serve(` / `process.env` mention inside a STRING LITERAL or a
 * COMMENT must NOT server-escalate a pure-client function (the reported HIGH FP,
 * which cascaded to E-CPS-NONIDEM-NO-STORAGE); a GENUINE member access on the
 * `Bun` / `process` global still escalates and never leaks to the client bundle.
 *
 * Mirrors the §20.7 print-builtin string/comment-safety test (print-builtin-
 * compile.test.js §D2). This is the tokenizer/AST fix that replaces the reverted
 * S244 raw-text literal-scanner (regex-vs-division is undecidable on raw text; on
 * the parsed ExprNode there is no `/`-scan, so the whole class is gone).
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compile(src, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-ns-sig-"));
  const file = join(dir, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], write: false, log: () => {}, ...opts });
  const out = result.outputs ? [...result.outputs.values()][0] : null;
  return { result, out };
}
const errCodes = (r) => (r.errors ?? []).map((e) => e.code);
const escalated = (out) => (out?.serverJs ?? "").includes("__ri_route");

// A pure-client fn: writes only a client cell, no real host resource call.
const clientFn = (bodyLine) => `<program>
  \${ @msg = ""
     function setClient() {
${bodyLine}
       @msg = "done"
     } }
  <div class="app"><button onclick=setClient()>go</button> \${@msg}</div>
</program>`;

// A web fn that DOES touch a host resource.
const webFn = (bodyLine) => `<program>
  <button onclick=doIt()>go</button>
  \${ @msg = ""
     function doIt() {
${bodyLine}
     } }
  <div>\${@msg}</div>
</program>`;

// ---------------------------------------------------------------------------
// §A — false-positive class GONE: a namespace mention inside a literal/comment
// ---------------------------------------------------------------------------

describe("§12.2 — Bun.*/process.* signal is string/comment-safe (no spurious escalation)", () => {
  test("`Bun.serve(` inside a STRING LITERAL does NOT server-escalate (no E-CPS cascade)", () => {
    const { result, out } = compile(clientFn(`       @msg = "docs mention Bun.serve(x)"`));
    expect(errCodes(result)).not.toContain("E-CPS-NONIDEM-NO-STORAGE");
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(escalated(out)).toBe(false);
    expect(out.serverJs ?? "").not.toContain("__ri_route");
  });

  test("`process.cwd(` inside a STRING LITERAL does NOT server-escalate", () => {
    const { result, out } = compile(clientFn(`       @msg = "you can call process.cwd() to get the dir"`));
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(escalated(out)).toBe(false);
  });

  test("`process.env` inside a STRING LITERAL does NOT route-escalate (route-inference specific)", () => {
    // route-inference no longer escalates on the string mention. NOTE: `process.env`
    // (uniquely among the namespace set) ALSO trips a SEPARATE, out-of-scope
    // scanner — the fail-closed acorn-exact egress-field-scan (E-CG-006) — which
    // carries the SAME raw-source string-blindness for `process.env`. That is a
    // sibling gap in codegen/egress-field-scan.ts, NOT route-inference; surfaced
    // as a deferred item. Here we assert only the route-inference outcome.
    const { out } = compile(clientFn(`       @msg = "read process.env.SECRET to configure"`));
    expect(escalated(out)).toBe(false);
  });

  test("`Bun.serve(` inside a // COMMENT does NOT server-escalate", () => {
    const { result, out } = compile(clientFn(`       // later: call Bun.serve( here`));
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(escalated(out)).toBe(false);
  });

  test("`foo.Bun.serve()` (Bun as a PROPERTY of a USER local, not the global) does NOT escalate", () => {
    // The old `\\bBun\\.serve\\(` regex over-fired here; the AST checks the
    // receiver root resolves to the `Bun` global — here it is a user local `foo`.
    const { result, out } = compile(clientFn(
      `       let foo = { Bun: { serve: (x) => "ok" } }\n       @msg = foo.Bun.serve(1)`));
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(escalated(out)).toBe(false);
  });

  test("a string literal containing `globalThis.Bun.serve` does NOT escalate", () => {
    const { result, out } = compile(clientFn(
      `       @msg = "docs: globalThis.Bun.serve is server-only"`));
    expect(errCodes(result).filter((c) => c.startsWith("E-"))).toEqual([]);
    expect(escalated(out)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §A2 — S239-review leak fix: a `globalThis.`/`window.`-rooted access to the
// Bun/process global is the SAME global as the bare ident and MUST escalate.
// (Regression guard for the HIGH client-bundle secret-leak vector where
// `globalThis.Bun.serve({port})` silently shipped to the client because the
// `serve` receiver's object was a member, not the bare ident.)
// ---------------------------------------------------------------------------

describe("§12.2 — globalThis./window.-rooted Bun/process access escalates (leak closed)", () => {
  // Assert the LEAK property directly: the fn escalates (a server route exists)
  // AND no `Bun.`/`process.` host access survives in the client bundle. (Not
  // asserting error-free — an escalated reactive-assign may surface a legitimate
  // CPS diagnostic that also fires for the bare form; that is not the leak.)
  test("`globalThis.Bun.serve({...})` escalates; no client leak", () => {
    const { out } = compile(webFn(`       @msg = String(globalThis.Bun.serve({ port: 3000 }))`));
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("Bun.serve");
  });

  test("`globalThis.Bun.file(\"/etc/passwd\")` escalates; no client leak", () => {
    const { out } = compile(webFn(`       @msg = String(globalThis.Bun.file("/etc/passwd"))`));
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("Bun.file");
  });

  test("`globalThis.process.env.SECRET` escalates; no client leak", () => {
    const { out } = compile(webFn(`       @msg = String(globalThis.process.env.SECRET)`));
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("process.env");
  });

  test("`window.Bun.file(\"/x\")` escalates; no client leak", () => {
    const { out } = compile(webFn(`       @msg = String(window.Bun.file("/x"))`));
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("Bun.file");
  });

  test("`self.process.cwd()` (self alias) escalates", () => {
    const { out } = compile(webFn(`       @msg = String(self.process.cwd())`));
    expect(escalated(out)).toBe(true);
  });

  test("`return globalThis.process.argv` escalates; no client leak", () => {
    const src = `<program>
  <button onclick=doIt()>go</button>
  \${ function doIt() { return globalThis.process.argv } }
</program>`;
    const { out } = compile(src);
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("process.argv");
  });
});

// ---------------------------------------------------------------------------
// §B — true-positive PRESERVED: a genuine namespace access still escalates
// ---------------------------------------------------------------------------

describe("§12.2 — a GENUINE Bun.*/process.* access still server-escalates (no leak)", () => {
  test("CONTROL — `process.env.PORT` in a web fn escalates; no client leak", () => {
    const { result, out } = compile(webFn(`       @msg = String(process.env.PORT)`));
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("process.env");
  });

  test("CONTROL — `Bun.serve({...})` in a web fn escalates; no client leak", () => {
    const { result, out } = compile(webFn(`       @msg = String(Bun.serve({ port: 3000 }))`));
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("Bun.serve");
  });

  test("a `Bun.file(...)` in a let-decl init escalates", () => {
    const { out } = compile(webFn(`       let f = Bun.file("/etc/hosts")\n       @msg = String(f)`));
    expect(escalated(out)).toBe(true);
  });

  test("a `process.argv` in a return-position expr escalates", () => {
    const src = `<program>
  <button onclick=doIt()>go</button>
  \${ function doIt() { return process.argv } }
</program>`;
    const { out } = compile(src);
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("process.argv");
  });

  // The S244 over-mask leak: `x++ / process.env` — a raw-text scanner masked
  // `process.env` as regex interior after the `++`/`/` and let it leak. On the
  // AST the division is a binary node whose right operand is the `process.env`
  // member — detected regardless of the `/`. This must escalate, never leak.
  test("ADVERSARIAL — `x++ / process.env.PORT` escalates (no over-mask leak)", () => {
    const { out } = compile(webFn(
      `       let x = 1\n       @msg = String(x++ / process.env.PORT)`));
    expect(escalated(out)).toBe(true);
    expect(out.clientJs ?? "").not.toContain("process.env");
  });
});
