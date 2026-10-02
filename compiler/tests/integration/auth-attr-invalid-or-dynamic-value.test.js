/**
 * §52.13 — `auth=` accepts exactly three literal values (S449,
 * g-auth-attr-invalid-or-dynamic-value-compiles-to-no-auth, governed half).
 *
 * Governing:
 *   §52.13   "The `auth=` attribute on `<page>`, `<program>`, and `<channel>` accepts
 *            exactly three literal values".
 *   §52.13.2 "Any literal value not in the recognized set SHALL emit `W-ATTR-002`." …
 *            "On a `<program>`, an unrecognized value applies no auth gate at all — the
 *            program and its pages are public" … "silent acceptance of attribute values
 *            that have no compile-time effect is itself a P0 finding".
 *   §52.13   Login-page requirement: "When `auth="required"` is declared … the compiler
 *            SHALL emit `W-AUTH-LOGIN-MISSING`".
 *
 * Pinned:
 *   1. a NON-literal `auth=` (`${mode}`, `@mode`, bare `auth`) on `<program>` / `<page>`
 *      now emits W-ATTR-002 stating the real effect (before: NO diagnostic at all);
 *   2. an unrecognized literal (`"Required"`, `" required"`) on `<program>` no longer
 *      drives W-AUTH-LOGIN-MISSING / I-AUTH-REDIRECT-UNRESOLVED — those treated it AS
 *      an auth gate while no auth check was emitted;
 *   3. controls: `auth="required"` still emits the auth check AND the login lint;
 *      a non-literal `<channel auth=>` gets no new warning (it already gates).
 *
 * NOT pinned here (RULINGS NEEDED, docs/changes/s449-auth-session-fail-open/progress.md):
 * whether such a value should be a compile ERROR — §52.13.2 currently ratifies the
 * warning + public-program behaviour.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { perRunTmp } from "../helpers/per-run-tmp.js";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const _tmp = perRunTmp(resolve(testDir, "_tmp_auth_attr_invalid_dynamic"));
beforeAll(_tmp.setup);
afterAll(_tmp.teardown);

let n = 0;
function compileFiles(files) {
  const root = join(_tmp.root, `c${++n}`);
  const inputs = [];
  for (const [rel, body] of Object.entries(files)) {
    const p = join(root, "src", rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
    inputs.push(p);
  }
  const outDir = join(root, "dist");
  mkdirSync(outDir, { recursive: true });
  const r = compileScrml({ inputFiles: inputs, write: true, outputDir: outDir });
  const diags = [...(r.errors ?? []), ...(r.warnings ?? [])];
  const serverJs = readdirSync(outDir, { recursive: true })
    .filter((f) => String(f).endsWith(".server.js"))
    .map((f) => readFileSync(join(outDir, String(f)), "utf-8"))
    .join("\n");
  return { diags, codes: diags.map((d) => d.code), serverJs };
}

const program = (attr, prelude = "", cell = "") => ({
  "app.scrml": `${prelude}<program db="./c.db"${attr}>
${cell}<schema>
    notes { id: integer primary key
            body: text }
</>
function add(body) {
    ?{\`INSERT INTO notes (body) VALUES (\${body})\`}.run()
}
<button onclick=add("x")>add</button>
</>
`,
});

const AUTH_CHECK = "_scrml_auth_check(_scrml_req)";

describe("§52.13 — a non-literal <program auth=> is no longer silent", () => {
  const cases = [
    ["auth=${mode}", program(" auth=${mode}", '${ const mode = "required" }\n')],
    ["auth=@mode", program(" auth=@mode", "", '<mode> = "required"\n')],
    ["bare auth", program(" auth")],
  ];
  for (const [label, files] of cases) {
    test(`${label} → W-ATTR-002 naming the real effect; still no auth check (unchanged)`, () => {
      const c = compileFiles(files);
      const w = c.diags.filter((d) => d.code === "W-ATTR-002");
      expect(w.length).toBe(1);
      expect(w[0].message).toContain("not a string literal");
      expect(w[0].message).toContain("applies NO auth gate");
      expect(c.serverJs).not.toContain(AUTH_CHECK);
      expect(c.codes).not.toContain("W-AUTH-LOGIN-MISSING");
    });
  }
});

describe("§52.13.2 — an unrecognized <program auth=> literal is not treated as a gate by the lints", () => {
  for (const lit of ["Required", " required"]) {
    test(`auth="${lit}" → W-ATTR-002 only; no W-AUTH-LOGIN-MISSING / I-AUTH-REDIRECT-UNRESOLVED`, () => {
      const c = compileFiles(program(` auth="${lit}"`));
      expect(c.codes).toContain("W-ATTR-002");
      expect(c.codes).not.toContain("W-AUTH-LOGIN-MISSING");
      expect(c.codes).not.toContain("I-AUTH-REDIRECT-UNRESOLVED");
      expect(c.serverJs).not.toContain(AUTH_CHECK);
    });
  }

  test('control: auth="required" keeps the auth check AND the login lint', () => {
    const c = compileFiles(program(' auth="required"'));
    expect(c.serverJs).toContain(AUTH_CHECK);
    expect(c.codes).toContain("W-AUTH-LOGIN-MISSING");
    expect(c.codes).not.toContain("W-ATTR-002");
  });
});

describe("§52.13 — the <page> forms", () => {
  const app = { "app.scrml": "<program><p>home</p></program>\n" };
  const page = (open, prelude = "") => ({
    ...app,
    "pages/secret.scrml": `${prelude}${open}\n<p>secret-marker</p>\n</page>\n`,
  });
  test("<page auth=${mode}> → W-ATTR-002 (page declares nothing)", () => {
    const c = compileFiles(page("<page auth=${mode}>", '${ const mode = "required" }\n'));
    const w = c.diags.filter((d) => d.code === "W-ATTR-002");
    expect(w.length).toBe(1);
    expect(w[0].message).toContain("not a string literal");
    expect(w[0].message).toContain("not an auth declaration");
  });
  test('control: <page auth="required"> → no W-ATTR-002', () => {
    const c = compileFiles(page('<page auth="required">'));
    expect(c.codes).not.toContain("W-ATTR-002");
  });
});

describe("<channel> — a non-literal auth= gets no new warning (it already gates the upgrade)", () => {
  test("<channel name=\"c\" auth=${m}> emits no W-ATTR-002", () => {
    const c = compileFiles({
      "app.scrml": `\${ const m = "required" }
<program>
<channel name="c" auth=\${m}>
</>
<p>x</p>
</program>
`,
    });
    expect(c.codes).not.toContain("W-ATTR-002");
  });
});
