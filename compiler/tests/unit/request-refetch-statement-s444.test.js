/**
 * request-refetch-statement-s444.test.js — `<#id>.refetch()` written as a STATEMENT is emitted.
 *
 * g-request-refetch-statement-dropped (S444, HIGH). SPEC §6.7.7 lists
 * `<#id>.refetch()` as `() -> void`, "Imperatively re-execute the fetch body", and EC-7's
 * invalidate-after-write idiom writes it as a statement after a write. Two seams dropped it:
 *
 *   1. block-splitter.js — a `<#` in a text run FLUSHED the run, so at a
 *      <program>/<page>/<channel> default-logic body `function again() {⏎ <#hunt>.refetch()⏎ }`
 *      split into two text blocks. The §40.8 lift gates on each block's leading content: the
 *      first lifted as a function with an EMPTY body, the second (`<#hunt>.refetch() }` and
 *      every declaration after it) shipped into <body> as page TEXT.
 *   2. ast-builder.js parseHandlerStatementListCore — the multi-statement handler parse
 *      tokenized the raw value WITHOUT the `<#id>` pre-lowering a `${…}` body gets, so a
 *      later `<#hunt>.refetch()` became an `html-fragment` (emits nothing) and a LEADING one
 *      broke the parse (raw string path, `@x` unrewritten → E-CODEGEN-INVALID-LOGIC).
 *
 * Coverage: §A function bodies · §B inline multi-statement handlers · §C runtime click.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-request-refetch-s444");

function compile(src, baseName) {
  const tmpDir = resolve(tmpRoot, `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: outDir });
    const out = result.outputs.get(tmpInput);
    const fatal = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    return { fatal, clientJs: out ? out.clientJs : "", html: out ? out.html : "" };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** The emitted body of the client function whose mangled name starts `_scrml_<name>_`. */
function fnBody(clientJs, name) {
  const m = clientJs.match(new RegExp(`function _scrml_${name}_\\d+\\(\\) \\{\\n([\\s\\S]*?)\\n\\}`));
  return m ? m[1] : null;
}

const FN_SRC = `<program>
<n> = 0
<request id="rows" url="/api/rows"></>

function again() {
    <#rows>.refetch()
}

function both() {
    @n = @n + 1
    <#rows>.refetch()
    @n = @n + 2
}

<p>\${<#rows>.loading} \${@n}</p>
<button id="a" onclick=again()>a</button>
<button id="b" onclick=both()>b</button>
</program>
`;

const INLINE_SRC = `<program>
<n> = 0
<request id="rows" url="/api/rows"></>
<p>\${<#rows>.loading} \${@n}</p>
<button id="c" onclick=\${ @n = 5; <#rows>.refetch() }>c</button>
<button id="d" onclick=\${ <#rows>.refetch(); @n = 6 }>d</button>
<button id="e" onclick=\${ <#rows>.refetch() }>e</button>
</program>
`;

describe("§A: refetch statement in a program-level function body", () => {
  test("a lone refetch statement is the function's body (was: an EMPTY function)", () => {
    const { fatal, clientJs } = compile(FN_SRC, "fn-lone");
    expect(fatal).toEqual([]);
    expect(fnBody(clientJs, "again")).toBe("  _scrml_request_rows.refetch();");
  });

  test("a refetch between two writes keeps all three statements, in order", () => {
    const { clientJs } = compile(FN_SRC, "fn-both");
    const body = fnBody(clientJs, "both");
    expect(body).not.toBe(null);
    const lines = body.split("\n").map((l) => l.trim());
    expect(lines).toEqual([
      '_scrml_cs_reactive_set("n", _scrml_cs_reactive_get("n") + 1);',
      "_scrml_request_rows.refetch();",
      '_scrml_cs_reactive_set("n", _scrml_cs_reactive_get("n") + 2);',
    ]);
  });

  test("no scrml source leaks into the page as text", () => {
    const { html } = compile(FN_SRC, "fn-html");
    expect(html).not.toContain("refetch");
    expect(html).not.toContain("function both");
  });

  test("a refetch in a function inside a <page> body", () => {
    const src = `<program>
<page>
<request id="rows" url="/api/rows"></>
function again() {
    <#rows>.refetch()
}
<p>\${<#rows>.loading}</p>
<button onclick=again()>a</button>
</page>
</program>
`;
    const { fatal, clientJs, html } = compile(src, "fn-page");
    expect(fatal).toEqual([]);
    expect(fnBody(clientJs, "again")).toBe("  _scrml_request_rows.refetch();");
    expect(html).not.toContain("refetch");
  });

  test("markup prose around a <#id> ref is unchanged (one run, same text)", () => {
    const { fatal, html } = compile(`<program>\${ <n> = 1 }<p>ref: \${@n} and more</p></program>`, "prose");
    expect(fatal).toEqual([]);
    expect(html).toContain("ref:");
  });
});

describe("§B: refetch in an inline multi-statement handler", () => {
  test("a TRAILING refetch survives (was: only the write)", () => {
    const { fatal, clientJs } = compile(INLINE_SRC, "inline");
    expect(fatal).toEqual([]);
    expect(clientJs).toContain('function(_scrml_event) { _scrml_cs_reactive_set("n", 5); _scrml_request_rows.refetch(); }');
  });

  test("a LEADING refetch compiles and keeps the write (was: E-CODEGEN-INVALID-LOGIC)", () => {
    const { fatal, clientJs } = compile(INLINE_SRC, "inline-lead");
    expect(fatal).toEqual([]);
    expect(clientJs).toContain('function(_scrml_event) { _scrml_request_rows.refetch(); _scrml_cs_reactive_set("n", 6); }');
  });

  test("the single-expression form is unchanged (control)", () => {
    const { clientJs } = compile(INLINE_SRC, "inline-single");
    expect(clientJs).toContain("function(_scrml_event) { _scrml_request_rows.refetch(); }");
  });

  test("an <each> row handler keeps a trailing refetch", () => {
    const src = `<program>
<n> = 0
<items> = [1, 2, 3]
<request id="rows" url="/api/rows"></>
<p>\${<#rows>.loading}</p>
<ul>
    <each in=@items as it>
        <li><button onclick=\${ @n = it; <#rows>.refetch() }>x</button></li>
    </each>
</ul>
</program>
`;
    const { fatal, clientJs } = compile(src, "each");
    expect(fatal).toEqual([]);
    expect(clientJs).toMatch(/_scrml_cs_reactive_set\("n", it\); _scrml_request_rows\.refetch\(\); \}\);/);
  });
});

// ---------------------------------------------------------------------------
// §C — runtime: clicking re-executes the fetch
// ---------------------------------------------------------------------------

beforeEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
  GlobalRegistrator.register();
});
afterEach(async () => {
  try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
});

const tick = () => new Promise((res) => setTimeout(res, 0));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

function mount(src, baseName) {
  const tmpDir = resolve(tmpRoot, `m-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, src);
  const calls = [];
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
    const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
    const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
    const fetchStub = async (url) => {
      calls.push(url);
      if (calls.length > 20) return new Promise(() => {});
      return { ok: true, status: 200, json: async () => ({ n: calls.length }) };
    };
    const exec = new Function(
      "window", "document", "fetch",
      `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
        `if (typeof _scrml_boot === "function") { _scrml_boot(); }\n` +
        `if (typeof _scrml_run_dom_ready === "function") { _scrml_run_dom_ready(); }\n` +
        `globalThis.__get__ = _scrml_reactive_get;\n`),
    );
    exec(window, document, fetchStub);
    document.dispatchEvent(new window.Event("DOMContentLoaded"));
    return { get: globalThis.__get__, calls };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function click(sel) {
  document.querySelector(sel).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

describe("§C: runtime", () => {
  test("a function-body refetch re-executes the fetch on click", async () => {
    const { get, calls } = mount(FN_SRC, "rt-fn");
    await settle();
    expect(calls.length).toBe(1);
    click("#a");
    await settle();
    expect(calls.length).toBe(2);
    click("#b");
    await settle();
    expect(calls.length).toBe(3);
    expect(get("n")).toBe(3);
  });

  test("inline multi-statement handlers re-execute the fetch on click", async () => {
    const { get, calls } = mount(INLINE_SRC, "rt-inline");
    await settle();
    expect(calls.length).toBe(1);
    click("#c");
    await settle();
    expect(calls.length).toBe(2);
    expect(get("n")).toBe(5);
    click("#d");
    await settle();
    expect(calls.length).toBe(3);
    expect(get("n")).toBe(6);
  });
});
