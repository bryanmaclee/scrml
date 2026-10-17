/**
 * S468 — g-errorboundary-runtime-does-not-catch-returned-error-value-s467, against the runtime
 * that SHIPS.
 *
 * The unit half (`unit/error-boundary-returned-error-s468.test.js`) executes the full
 * `SCRML_RUNTIME`. The browser loads the PRUNED per-app `scrml-runtime.<hash>.js` instead
 * (primary map invariant 67), so this file compiles with `write: true`, loads the written
 * runtime + client.js + HTML into happy-dom, and checks that the boundary helpers the fix emits
 * (`_scrml_error_boundary_check` / `_run` / `_failure` / `_show`) are shipped and work, and that
 * no compiler placeholder reaches an artifact.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function build(src) {
  const dir = mkdtempSync(join(tmpdir(), "s468-eb-int-"));
  const input = join(dir, "app.scrml");
  const outDir = join(dir, "out");
  writeFileSync(input, src);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => e && e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    return {
      errors,
      html: read("app.html"),
      clientJs: read("app.client.js"),
      runtimeJs: read(result.runtimeFilename ?? "scrml-runtime.js"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function boot(b) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const body = (b.html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || b.html;
  document.body.innerHTML = body.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const realErr = console.error;
  const logs = [];
  console.error = (...a) => { logs.push(a.map(String).join(" ")); };
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(`(function() {\n${b.runtimeJs}\n${b.clientJs}\n})();`);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = realErr;
  }
  return { logs, html: () => document.body.innerHTML, q: (s) => document.querySelector(s) };
}

const SRC = (pw) => `type AuthErr:enum = {
    Denied
        renders <p class="denied">Wrong password</>
}
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<errorBoundary fallback={<div class="fb">FALLBACK</>}>
    \${ const ok = check("${pw}") }
    <p id="out">\${ok ? "LOGGED IN" : "rejected"}</p>
</>
<errorBoundary fallback={<div class="fb2">FALLBACK2</>}>
    <p id="v">\${check("${pw}") ? "IN" : "OUT"}</p>
</>
`;

describe("the shipped (pruned) runtime catches a returned error at the call", () => {
  test("a wrong password: both boundaries show the variant's renders, never LOGGED IN / IN", async () => {
    const b = build(SRC("wrong"));
    expect(b.errors).toEqual([]);
    for (const helper of ["_scrml_error_boundary_check", "_scrml_error_boundary_run", "_scrml_error_boundary_failure", "_scrml_error_boundary_show"]) {
      expect(b.runtimeJs).toContain(`function ${helper}(`);
    }
    expect(b.clientJs).not.toMatch(/__scrml_eb_check/); // the placeholder never ships
    const page = await boot(b);
    expect(page.html()).not.toContain("LOGGED IN");
    expect(page.q("#v")?.textContent ?? "").not.toBe("IN");
    expect(page.html().match(/Wrong password/g)?.length).toBe(2);
    expect(page.q("#out")).toBe(null);
  });

  test("the right password renders both contents", async () => {
    const page = await boot(build(SRC("secret")));
    expect(page.q("#out")?.textContent).toBe("LOGGED IN");
    expect(page.q("#v")?.textContent).toBe("IN");
    expect(page.q(".denied")).toBe(null);
  });

  test("a page with no render-time `!` call in a boundary ships none of the new helpers", () => {
    const b = build(`<errorBoundary fallback={<div>FALLBACK</>}>
    <p>static</p>
</>
`);
    expect(b.errors).toEqual([]);
    expect(b.clientJs).not.toContain("_scrml_error_boundary_check");
    expect(b.clientJs).not.toContain("_scrml_error_boundary_run");
    // The helpers live in their own runtime chunk ('boundary'), shipped only when named.
    expect(b.runtimeJs).not.toContain("function _scrml_error_boundary_check(");
    expect(b.runtimeJs).not.toContain("function _scrml_error_boundary_run(");
  });

  test("a boundary interpolation with no `!` call keeps the 'errors' chunk but not the 'boundary' chunk", () => {
    const b = build(`\${ function load(x) { return x } }
<errorBoundary fallback={<div>FALLBACK</>}>
    <p>\${load("a")}</p>
</>
`);
    expect(b.errors).toEqual([]);
    expect(b.runtimeJs).toContain("function _scrml_error_boundary_log(");
    expect(b.runtimeJs).not.toContain("function _scrml_error_boundary_check(");
  });
});
