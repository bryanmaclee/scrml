/**
 * S457 ruling "6a" — the `string(url)` refinement refuses executable schemes (SPEC §53.6.1).
 *
 * Before: the `url` named shape was "does `new URL()` parse it", so `<u>: string(url) =
 * "javascript:alert(1)"` was statically PROVEN (gap g-string-url-refinement-admits-executable-schemes).
 * Now: a value inhabits `string(url)` only when it parses as an absolute URL AND the scheme the §5.2
 * reader (`compiler/src/runtime-url-guard.js`, the ONE scheme reader) finds is in the §5.2 safe set
 * (`http`, `https`, `ftp`, `mailto`, `tel`, `sms`). `data:` fails in every form (a value type does not
 * know which attribute it will reach). Relative URLs: refused, as before (not part of this ruling).
 *
 * One judge, `_scrml_url_shape_ok`, at every zone:
 *   A  the judge itself (module)
 *   B  static zone — a string literal is judged at compile time (E-CONTRACT-001)
 *   C  runtime zone — the boundary check calls the judge; client runtime chunk + server bundle carry it
 *   D  run it — server-function parameter (400 vs 200) and `bind:value` on `<input type="url">`
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { _scrml_url_shape_ok, _SCRML_SAFE_URL_SCHEMES } from "../../src/runtime-url-guard.js";
import { resolveTypeExpr, checkPredicateLiteral } from "../../src/type-system.js";
import { predicateToJsExpr, needsUrlShapeHelper, SERVER_URL_SHAPE_HELPER } from "../../src/codegen/emit-predicates.ts";
import { URL_GUARD_RUNTIME_SOURCE } from "../../src/runtime-template.js";

// The scheme shapes the S457 runtime URL guard tests use: case, tab / CR / LF inside the scheme,
// leading C0 controls and spaces, and every non-safe scheme family.
const REFUSED = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "java\tscript:alert(1)",
  "java\nscr\ript:alert(1)",
  "   javascript:alert(1)",
  "\u0001\u0002 javascript:alert(1)",
  "vbscript:msgbox(1)",
  "VBScript:msgbox(1)",
  "data:text/html,<script>alert(1)</script>",
  "data:image/png;base64,AAAA", // no data: form inhabits the shape (fail closed)
  "data:image/svg+xml,<svg onload=alert(1)>",
  "blob:https://x/1",
  "file:///etc/passwd",
  "ws://h/socket",
  "chrome-extension://abc/x",
];

const ADMITTED = [
  "https://example.com",
  "HTTPS://Example.com/a?b#c",
  "http://a.b/c",
  "ftp://h/f",
  "mailto:a@b.c",
  "tel:+15550100",
  "sms:+15550100",
  "  https://example.com", // leading space stripped by the parser and by the reader alike
];

// Unchanged by this ruling: a relative URL (or no URL at all) does not inhabit `string(url)`.
const RELATIVE_OR_NOT_A_URL = ["/users/1", "users/1", "?q=1", "#h", "//host/p", "", "not a url"];

function span() {
  return { file: "/test/app.scrml", start: 0, end: 10, line: 1, col: 1 };
}

// ---------------------------------------------------------------------------
// A — the judge
// ---------------------------------------------------------------------------

describe("A — _scrml_url_shape_ok (runtime-url-guard.js)", () => {
  for (const v of REFUSED) {
    test(`refuses ${JSON.stringify(v)}`, () => {
      expect(_scrml_url_shape_ok(v)).toBe(false);
    });
  }
  for (const v of ADMITTED) {
    test(`admits ${JSON.stringify(v)}`, () => {
      expect(_scrml_url_shape_ok(v)).toBe(true);
    });
  }
  for (const v of RELATIVE_OR_NOT_A_URL) {
    test(`still refuses ${JSON.stringify(v)} (relative / not a URL — unchanged)`, () => {
      expect(_scrml_url_shape_ok(v)).toBe(false);
    });
  }
  test("a non-string is not a url", () => {
    expect(_scrml_url_shape_ok(42)).toBe(false);
    expect(_scrml_url_shape_ok({ toString: () => "https://x" })).toBe(false);
  });
  test("the admitted schemes are exactly §5.2's safe set", () => {
    expect([..._SCRML_SAFE_URL_SCHEMES].sort()).toEqual(["ftp", "http", "https", "mailto", "sms", "tel"]);
    for (const s of _SCRML_SAFE_URL_SCHEMES) expect(_scrml_url_shape_ok(`${s}:x`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B — static zone
// ---------------------------------------------------------------------------

describe("B — static zone: a string literal is judged at compile time (§53.4.2 rule 2)", () => {
  const urlType = resolveTypeExpr("string(url)", new Map());

  for (const v of REFUSED) {
    test(`${JSON.stringify(v)} fails the shape → E-CONTRACT-001`, () => {
      const errors = [];
      expect(checkPredicateLiteral(urlType, v, span(), errors)).toBe(false);
      expect(errors.some((e) => e.code === "E-CONTRACT-001")).toBe(true);
    });
  }
  for (const v of ADMITTED) {
    test(`${JSON.stringify(v)} is proven`, () => {
      const errors = [];
      expect(checkPredicateLiteral(urlType, v, span(), errors)).toBe(true);
      expect(errors).toHaveLength(0);
    });
  }
  test("a relative literal still fails (unchanged)", () => {
    const errors = [];
    expect(checkPredicateLiteral(urlType, "/users/1", span(), errors)).toBe(false);
  });
  test("composition: `!url` admits an executable literal; `url && …` refuses it", () => {
    const notUrl = resolveTypeExpr("string(!url)", new Map());
    expect(checkPredicateLiteral(notUrl, "javascript:alert(1)", span(), [])).toBe(true);
    const both = resolveTypeExpr("string(url && .length < 100)", new Map());
    expect(checkPredicateLiteral(both, "javascript:alert(1)", span(), [])).toBe(false);
    expect(checkPredicateLiteral(both, "https://x.y", span(), [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Compile harness
// ---------------------------------------------------------------------------

function compileSource(source, label) {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s457-urlshape-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const files = existsSync(outDir) ? readdirSync(outDir) : [];
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    const runtimeName = files.find((f) => /^scrml-runtime.*\.js$/.test(f));
    return {
      errors: (result.errors ?? []).filter((e) => !/^[WI]-/.test(e.code ?? "") && e.severity !== "warning" && e.severity !== "info"),
      clientJs: read("app.client.js"),
      serverJs: read("app.server.js"),
      html: read("app.html"),
      runtimeJs: runtimeName ? read(runtimeName) : "",
      serverPath: resolve(outDir, "app.server.js"),
      dir,
    };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

const APP = `<program>
  <raw> = "https://example.com"
  <website>: string(url) = @raw

  server function save(link: string(url)) {
    return link
  }

  <div>
    <input type="url" bind:value=@website/>
    <p id="out">\${@website}</p>
    <button onclick=save(@website)>save</button>
  </div>
</program>
`;

describe("B — static zone end to end", () => {
  test("`<u>: string(url) = \"javascript:alert(1)\"` is refused at compile time", () => {
    const out = compileSource(`<program>\n  <u>: string(url) = "javascript:alert(1)"\n  <p>\${@u}</p>\n</program>\n`, "static");
    try {
      expect(out.errors.map((e) => e.code)).toContain("E-CONTRACT-001");
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });
  test("`<u>: string(url) = \"https://example.com\"` still compiles clean", () => {
    const out = compileSource(`<program>\n  <u>: string(url) = "https://example.com"\n  <p>\${@u}</p>\n</program>\n`, "static-ok");
    try {
      expect(out.errors).toHaveLength(0);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// C — runtime zone emission
// ---------------------------------------------------------------------------

describe("C — runtime zone: every boundary check calls the one judge", () => {
  test("predicateToJsExpr lowers the url shape to a judge call", () => {
    expect(predicateToJsExpr({ kind: "named-shape", name: "url" }, "v")).toBe("_scrml_url_shape_ok(v)");
  });

  test("client + server artifacts call the judge and carry its definition exactly once", () => {
    const out = compileSource(APP, "emit");
    try {
      expect(out.errors).toHaveLength(0);
      // client: decl boundary check + bind:value handler
      expect(out.clientJs).toContain("_scrml_url_shape_ok(");
      expect(out.clientJs).toContain("_scrml_url_shape_ok(event.target.value)");
      expect(out.clientJs).not.toContain("new URL(");
      // the shipped runtime carries the 'urlguard' chunk (gated on the call)
      expect((out.runtimeJs.match(/function _scrml_url_shape_ok\(/g) ?? []).length).toBe(1);
      // server: the param check calls it; the bundle inlines the definition once
      expect(out.serverJs).toContain("if (!(_scrml_url_shape_ok(link)))");
      expect((out.serverJs.match(/function _scrml_url_shape_ok\(/g) ?? []).length).toBe(1);
      expect((out.serverJs.match(/function _scrml_read_url_scheme\(/g) ?? []).length).toBe(1);
      // the client does not receive the server-function body
      expect(out.clientJs).not.toContain("return link");
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("a page with no string(url) does not ship the judge", () => {
    const out = compileSource(`<program>\n  <n> = 1\n  <p>\${@n}</p>\n</program>\n`, "none");
    try {
      expect(out.runtimeJs).not.toContain("function _scrml_url_shape_ok(");
      expect(out.serverJs).not.toContain("function _scrml_url_shape_ok(");
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("a bundle that also carries the SSR first-paint URL guard defines the shared source once", () => {
    // Same source as the §5.2 rule 3 first-paint copy: inlining it twice would redeclare its
    // `const` sets (a SyntaxError that kills the whole server bundle).
    const src = `<program db="sqlite:./test.db">
\${
  < Link authority="server" table="links">
    id: number
    url: string
  </>
  <Link> @links
  server function save(link: string(url)) {
    return link
  }
}
<ul><each in=@links key=@.id><li><a href="\${@.url}">x</a></li></each></ul>
<button onclick=save("https://x.y")>save</button>
</program>`;
    const out = compileSource(src, "ssr");
    try {
      expect(out.errors).toHaveLength(0);
      const serverJs = out.serverJs;
      expect(serverJs).toContain("_scrml_safe_url(null, \"href\"");
      expect(serverJs).toContain("_scrml_url_shape_ok(link)");
      expect((serverJs.match(/function _scrml_url_shape_ok\(/g) ?? []).length).toBe(1);
      expect((serverJs.match(/const _SCRML_SAFE_URL_SCHEMES\b/g) ?? []).length).toBe(1);
      // The module text parses (no duplicate declaration). Imports/exports stripped so it can be
      // parsed as a function body without loading the database.
      const runnable = serverJs
        .replace(/^\s*import\s.*$/gm, "")
        .replace(/^export\s+/gm, "")
        .replace(/import\.meta\.url/g, '"file:///x"');
      expect(() => new Function(`return async () => {\n${runnable}\n};`)).not.toThrow();
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("the server helper is the runtime-url-guard.js source; never inlined twice", () => {
    expect(SERVER_URL_SHAPE_HELPER).toContain(URL_GUARD_RUNTIME_SOURCE);
    expect(needsUrlShapeHelper("if (!(_scrml_url_shape_ok(x))) {}")).toBe(true);
    expect(needsUrlShapeHelper(SERVER_URL_SHAPE_HELPER + "\nif (!(_scrml_url_shape_ok(x))) {}")).toBe(false);
    expect(needsUrlShapeHelper("const a = 1;")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D — run it
// ---------------------------------------------------------------------------

describe("D — run it", () => {
  test("server function `save(link: string(url))`: refused schemes → 400, safe schemes → 200", async () => {
    const out = compileSource(APP, "server-run");
    try {
      expect(out.errors).toHaveLength(0);
      const mod = await import(out.serverPath);
      const route = mod.routes.find((r) => r.method === "POST");
      const call = (link) => mod.fetch(new Request("http://localhost" + route.path, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" },
        body: JSON.stringify({ link }),
      }));
      for (const v of REFUSED) {
        const res = await call(v);
        expect([v, res.status]).toEqual([v, 400]);
        expect((await res.json()).error).toContain("E-CONTRACT-001-RT");
      }
      for (const v of ADMITTED) {
        const res = await call(v);
        expect([v, res.status]).toEqual([v, 200]);
      }
      expect((await call("/users/1")).status).toBe(400);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
    }
  });

  test("a nested worker <program> with a refined local: the bundle defines the judge; https replies, javascript: is refused", () => {
    // A worker has no scrml runtime; the boundary check's judge must ride in the worker bundle
    // itself (S457 review N1: it was called but never defined → ReferenceError on every message).
    const src = `<program>
<out> = ""
<program name="wk">
  \${
    function check(u) {
      let q: string(url) = u
      return q
    }
    when message(data) {
      send(check(data))
    }
  }
</program>
<p>\${@out}</p>
</program>
`;
    const uniq = `worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const dir = resolve(tmpdir(), `scrml-s457-urlshape-${uniq}`);
    const input = resolve(dir, "app.scrml");
    const outDir = resolve(dir, "out");
    mkdirSync(dir, { recursive: true });
    writeFileSync(input, src);
    try {
      const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
      const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""));
      expect(errors).toHaveLength(0);
      const workerJs = readFileSync(resolve(outDir, "app-wk.worker.js"), "utf8");
      expect(workerJs).toContain("_scrml_url_shape_ok(");
      expect((workerJs.match(/function _scrml_url_shape_ok\(/g) ?? []).length).toBe(1);
      // Execute the worker script the way a Worker would: a fresh scope with `self`.
      const posted = [];
      const self = { postMessage: (m) => posted.push(m), onmessage: null };
      new Function("self", workerJs)(self);
      expect(typeof self.onmessage).toBe("function");
      self.onmessage({ data: { id: 1, data: "https://scrml.dev/" } });
      self.onmessage({ data: { id: 2, data: "mailto:a@b.c" } });
      expect(posted).toEqual([
        { replyTo: 1, data: "https://scrml.dev/" },
        { replyTo: 2, data: "mailto:a@b.c" },
      ]);
      for (const v of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,x"]) {
        expect(() => self.onmessage({ data: { id: 3, data: v } })).toThrow("E-CONTRACT-001-RT");
      }
      expect(posted).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bind:value on <input type=\"url\">: http(s) still flows; javascript: / data: never reach the cell", async () => {
    const out = compileSource(APP, "bind-run");
    try {
      expect(out.errors).toHaveLength(0);
      expect(out.html).toContain('type="url"');
      if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
      GlobalRegistrator.register();
      const pageErrors = [];
      window.addEventListener("error", (e) => pageErrors.push(String(e.message ?? e.error)));
      const bodyMatch = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      document.body.innerHTML = (bodyMatch ? bodyMatch[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
      // The runtime the compile actually shipped (tree-shaken), not the full template.
      // eslint-disable-next-line no-eval
      (0, eval)(`(function() {\n${out.runtimeJs}\n${out.clientJs}\n})();`);
      document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
      const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
      await settle();
      const input = document.querySelector("input");
      const shown = () => document.querySelector("#out").textContent;
      const type = async (v) => {
        input.value = v;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await settle();
      };
      expect(shown()).toBe("https://example.com");
      await type("https://scrml.dev/docs");
      expect(shown()).toBe("https://scrml.dev/docs");
      await type("http://a.b/c");
      expect(shown()).toBe("http://a.b/c");
      for (const v of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,x", "vbscript:x"]) {
        await type(v);
        expect([v, shown()]).toEqual([v, "http://a.b/c"]);
      }
      expect(pageErrors).toEqual([]);
    } finally {
      rmSync(out.dir, { recursive: true, force: true });
      if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    }
  });
});
