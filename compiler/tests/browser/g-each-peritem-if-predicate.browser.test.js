/**
 * g-each-peritem-if-predicate.browser.test.js — C2 (each per-item if= conditional).
 *
 * Bug (g-each-peritem-if-predicate-not-lowered, C2): a per-item `<el if=(pred)>`
 * inside an `<each>` was not recognized as a conditional — it fell through to
 * `setAttribute("if", String((x is some)))`, which (a) emits the scrml predicate
 * `x is some` raw (invalid JS, `E-CODEGEN-INVALID-LOGIC`) and (b) wouldn't condition
 * the element anyway.
 *
 * Fix (emit-each.ts): detect `if=` on the per-item element, lower the predicate
 * through the STRUCTURED emitter (`lowerEachExpr` → parseExprToNode →
 * emitExprField, so `is some` → `(v !== null && v !== undefined)`), and GATE the
 * element's append on the lowered condition (the each render-fn re-runs on
 * collection change, so the conditional re-evaluates per render).
 *
 * Reproduces with NO component (general each-render). Models bug-57 harness.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const SRC = `<program>
type Row:struct = { id: string, note: string }
<rows>: Row[] = []
<ul>
    <each in=@rows key=@.id as r>
        <li>
            <em if=(r.note is some)>note: \${r.note}</em>
        </li>
    </each>
</ul>
</program>
`;

// C1 — a §42 predicate in a per-item INTERPOLATION (no component, no if=).
const SRC_C1 = `<program>
<nums>: number[] = []
<ul>
    <each in=@nums as x>
        <li>\${x is some}</li>
    </each>
</ul>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-g-each-if");

function compileCase(src = SRC) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const input = resolve(tmpDir, "if.scrml");
  writeFileSync(input, src);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: result.errors ?? [],
      html: read(resolve(outDir, "if.html")),
      clientJs: read(resolve(outDir, "if.client.js")),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-each-peritem-if §1 — compiles + lowers the predicate (was E-CODEGEN-INVALID-LOGIC)", () => {
  test("compiles with no errors", () => {
    expect(compileCase().errors).toEqual([]);
  });

  test("if= predicate lowers to a null-check (NOT raw `is some`)", () => {
    const { clientJs } = compileCase();
    expect(/!== null && .* !== undefined/.test(clientJs)).toBe(true);
    expect(/setAttribute\("if"/.test(clientJs)).toBe(false);      // not a setAttribute
    expect(/\bis some\b/.test(clientJs)).toBe(false);             // predicate lowered
  });

  test("the element append is GATED on the condition", () => {
    const { clientJs } = compileCase();
    // `if (<cond>) <frag>.appendChild(<el>)` — the conditional mount.
    expect(/if \(.*\)\s*\w+\.appendChild\(/.test(clientJs)).toBe(true);
  });

  test("(C1) a §42 predicate in a per-item INTERPOLATION lowers (was raw `is some`)", () => {
    const { errors, clientJs } = compileCase(SRC_C1);
    expect(errors).toEqual([]);
    expect(/!== null && .* !== undefined/.test(clientJs)).toBe(true);
    expect(/\bis some\b/.test(clientJs)).toBe(false);
  });
});

describe("g-each-peritem-if §2 — conditional renders correctly in happy-dom", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  test("only rows whose predicate holds render the conditional element", () => {
    const { html, clientJs, runtimeJs } = compileCase();
    document.documentElement.innerHTML = html;
    const errs = [];
    const origErr = console.error;
    console.error = (...a) => { errs.push(a.join(" ")); };
    const exec = new Function("window", "document",
      `${runtimeJs}\n${clientJs}\n` +
      `globalThis.__set__ = (typeof _scrml_reactive_set!=='undefined')?_scrml_reactive_set:null;`);
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // one row WITH a note, one withOUT (note absent → `is some` false).
    if (globalThis.__set__) globalThis.__set__("rows", [
      { id: "a", note: "hello" },
      { id: "b", note: not_present() },
    ]);
    console.error = origErr;

    expect(errs.filter((e) => /ReferenceError|not defined|effect error/.test(e))).toEqual([]);
    const ems = document.querySelectorAll("em");
    // Only the row with a present note mounts the <em>.
    expect(ems.length).toBe(1);
    expect(ems[0].textContent).toContain("hello");
    function not_present() { return undefined; }
  });
});
