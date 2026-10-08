/**
 * §52.13.2 — an `auth=` on `<program>` / `<page>` that is not exactly `"required"`,
 * `"optional"` or `"none"` is E-AUTH-ATTR-INVALID (S449 ruling item 4 —
 * ruling:user-voice-scrml.md S449 "RULED — 'your recs.'" item 4: "Unrecognized /
 * non-literal `auth=` (incl. `""`) = (a): compile error; amend §52.13.2 (supersedes
 * its W-ATTR-002 + 'no auth gate' SHALL)").
 *
 * Closes g-auth-attr-invalid-or-dynamic-value-compiles-to-no-auth and
 * g-auth-attr-empty-string-is-silent-and-public. Before: an unrecognized literal
 * warned (W-ATTR-002) and a non-literal / `""` said nothing, and the program compiled
 * PUBLIC (measured S449 on 2d6d8cd43: `<program auth="Required">`, anonymous GET
 * /app.html -> 200). History: #1234 (S449, governed half) made the non-literals warn
 * and stopped the login lints treating an unrecognized literal as a gate; this file
 * pinned that and now pins the ruled error.
 *
 * Pinned:
 *   1. every non-legal value on `<program>` / `<page>` — wrong case, padded, `""`,
 *      `"role:admin"`, `"true"`, bare `auth`, `${…}`, `@x` — is ONE E-AUTH-ATTR-INVALID
 *      (severity error) whose message lists the three legal values; no W-ATTR-002 beside it;
 *   2. the login lints still do not treat it as a gate (no W-AUTH-LOGIN-MISSING /
 *      I-AUTH-REDIRECT-UNRESOLVED);
 *   3. a NESTED `<program>`'s `auth=` keeps E-PROGRAM-NESTED-AUTH as its one code;
 *   4. controls: the three legal values compile; `<channel>` keeps W-ATTR-002 (any
 *      `auth=` there gates the upgrade) and a non-literal there stays silent.
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
  const r = compileScrml({ inputFiles: inputs, write: true, outputDir: outDir, log: () => {} });
  const diags = [...(r.errors ?? []), ...(r.warnings ?? [])];
  const serverJs = readdirSync(outDir, { recursive: true })
    .filter((f) => String(f).endsWith(".server.js"))
    .map((f) => readFileSync(join(outDir, String(f)), "utf-8"))
    .join("\n");
  return { diags, codes: diags.map((d) => d.code), errors: r.errors ?? [], serverJs };
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
const LEGAL = '`auth="required"`, `auth="optional"`, `auth="none"`';

function expectOneInvalid(c, fragment) {
  const e = c.errors.filter((d) => d.code === "E-AUTH-ATTR-INVALID");
  expect(e.length).toBe(1);
  expect(e[0].severity).toBe("error");
  expect(e[0].message).toContain(LEGAL);
  if (fragment) expect(e[0].message).toContain(fragment);
  expect(c.codes).not.toContain("W-ATTR-002");
  expect(c.codes).not.toContain("W-AUTH-LOGIN-MISSING");
  expect(c.codes).not.toContain("I-AUTH-REDIRECT-UNRESOLVED");
  return e[0];
}

describe("§52.13.2 — <program auth=…> that is not one of the three literals", () => {
  const cases = [
    ['auth="Required"', program(' auth="Required"'), 'Did you mean `auth="required"`?'],
    ['auth=" required"', program(' auth=" required"'), 'Did you mean `auth="required"`?'],
    ['auth="role:admin"', program(' auth="role:admin"'), "Role-based access"],
    ['auth="true"', program(' auth="true"'), '`"true"`'],
    ['auth=""', program(' auth=""'), "the empty string"],
    ["bare auth", program(" auth"), "it has no value"],
    ["auth=${mode}", program(" auth=${mode}", '${ const mode = "required" }\n'), "`${…}` expression"],
    ["auth=@mode", program(" auth=@mode", "", '<mode> = "required"\n'), "reactive/variable reference"],
  ];
  for (const [label, files, fragment] of cases) {
    test(`${label} → E-AUTH-ATTR-INVALID`, () => {
      const c = compileFiles(files);
      const e = expectOneInvalid(c, fragment);
      expect(e.message).toContain("`<program>`");
    });
  }

  for (const lit of ["required", "optional", "none"]) {
    test(`control: auth="${lit}" compiles without E-AUTH-ATTR-INVALID`, () => {
      const c = compileFiles(program(` auth="${lit}"`));
      expect(c.codes).not.toContain("E-AUTH-ATTR-INVALID");
      expect(c.codes).not.toContain("W-ATTR-002");
      if (lit === "required") {
        expect(c.serverJs).toContain(AUTH_CHECK);
        expect(c.codes).toContain("W-AUTH-LOGIN-MISSING");
      }
    });
  }
});

describe("§52.13.2 — the <page> forms", () => {
  const app = { "app.scrml": "<program><p>home</p></program>\n" };
  const page = (open, prelude = "") => ({
    ...app,
    "pages/secret.scrml": `${prelude}${open}\n<p>secret-marker</p>\n</page>\n`,
  });
  const cases = [
    ['<page auth="Required">', page('<page auth="Required">')],
    ['<page auth="">', page('<page auth="">')],
    ["<page auth>", page("<page auth>")],
    ["<page auth=${mode}>", page("<page auth=${mode}>", '${ const mode = "required" }\n')],
    ['<page auth="role:driver">', page('<page auth="role:driver">')],
  ];
  for (const [label, files] of cases) {
    test(`${label} → E-AUTH-ATTR-INVALID`, () => {
      const c = compileFiles(files);
      const e = expectOneInvalid(c);
      expect(e.message).toContain("`<page>`");
    });
  }
  test('control: <page auth="required"> → no E-AUTH-ATTR-INVALID', () => {
    const c = compileFiles(page('<page auth="required">'));
    expect(c.codes).not.toContain("E-AUTH-ATTR-INVALID");
    expect(c.codes).not.toContain("W-ATTR-002");
  });
});

describe("a nested <program>'s auth= keeps E-PROGRAM-NESTED-AUTH as its only code", () => {
  for (const attr of [' auth="Bogus"', " auth", ' auth="required"']) {
    test(`<program name="w"${attr}> inside <program auth="required">`, () => {
      const c = compileFiles({
        "app.scrml": `<program auth="required">\n<program name="w"${attr}>\n<p>w</p>\n</program>\n<p>home</p>\n</program>\n`,
      });
      expect(c.codes).toContain("E-PROGRAM-NESTED-AUTH");
      expect(c.codes).not.toContain("E-AUTH-ATTR-INVALID");
      expect(c.codes).not.toContain("W-ATTR-002");
    });
  }
});

describe("<channel> is unchanged — any auth= there gates the upgrade", () => {
  test('<channel auth="Bogus"> keeps W-ATTR-002, no E-AUTH-ATTR-INVALID', () => {
    const c = compileFiles({
      "app.scrml": `<program>\n<channel name="c" auth="Bogus">\n</>\n<p>x</p>\n</program>\n`,
    });
    expect(c.codes).toContain("W-ATTR-002");
    expect(c.codes).not.toContain("E-AUTH-ATTR-INVALID");
  });
  test("<channel name=\"c\" auth=${m}> emits nothing new", () => {
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
    expect(c.codes).not.toContain("E-AUTH-ATTR-INVALID");
  });
});
