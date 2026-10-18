/**
 * failable-imported-s469.test.js — SPEC §19.4.3 / §19.4.4, E-ERROR-002, for an IMPORTED `!` function.
 *
 * §19.4.3: "A call to a `!` function SHALL NOT be ignored." §19.4.4: "An unhandled `!` function call
 * SHALL be a compile error (E-ERROR-002)." Neither sentence is limited to functions declared in the
 * calling file. Before (g-imported-failable-function-never-checked): impl#1 built its failable set
 * from the current file's declarations only, so `import { check } from "./auth.scrml"` then
 * `const ok = check(p)` compiled and a wrong password logged in (executed below).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

/** Compile a project (`files`: name -> source; the entry is `app.scrml`). */
function compileProject(files, label = "case") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s469-imp-${uniq}`);
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(files)) writeFileSync(resolve(dir, name), src);
  try {
    const result = compileScrml({ inputFiles: [resolve(dir, "app.scrml")], write: true, outputDir: outDir, log: () => {} });
    const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    const runtimeName = existsSync(outDir) ? readdirSync(outDir).find((f) => /^scrml-runtime.*\.js$/.test(f)) : undefined;
    return {
      codes: errors.map((e) => e.code),
      messages: errors.map((e) => e.message),
      html: read("app.html"),
      clientJs: read("app.client.js"),
      libClientJs: Object.keys(files).filter((n) => n !== "app.scrml").map((n) => read(n.replace(/\.scrml$/, ".client.js"))),
      runtime: runtimeName ? read(runtimeName) : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const LIB = `\${
    export type AuthErr:enum = { Denied }
    export function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    export function plain(p) { return p == "secret" }
}
`;

/** A login page importing `check` (and `AuthErr`) from ./lib.scrml; `decl` binds `ok`. */
const APP = (decl, importLine = `import { check, plain, AuthErr } from "./lib.scrml"`) => `<msg> = "init"
\${
    ${importLine}
    function login(p) {
        ${decl}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
`;

const codesOf = (decl, importLine, extra = {}) =>
  compileProject({ "lib.scrml": LIB, ...extra, "app.scrml": APP(decl, importLine) }).codes;

async function boot(files) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const out = compileProject(files, "login");
  if (out.codes.length > 0) throw new Error(`compile errors: ${out.codes.join(", ")} — ${out.messages.join(" | ")}`);
  const bodyMatch = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  // eslint-disable-next-line no-eval
  (0, eval)(out.runtime);
  // eslint-disable-next-line no-eval
  for (const js of out.libClientJs) if (js) (0, eval)(js);
  // eslint-disable-next-line no-eval
  (0, eval)(out.clientJs);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  await settle();
  return {
    click: async (sel) => { document.querySelector(sel).click(); await settle(); },
    text: (sel) => document.querySelector(sel).textContent,
  };
}

async function expectRejectsWrong(decl, importLine) {
  const page = await boot({ "lib.scrml": LIB, "app.scrml": APP(decl, importLine) });
  await page.click("#wrong");
  expect(page.text("#out")).toBe("rejected");
  await page.click("#right");
  expect(page.text("#out")).toBe("LOGGED IN");
}

describe("an unhandled call of an imported `!` function is E-ERROR-002", () => {
  const shapes = [
    ["a declaration initializer", "const ok = check(p)"],
    ["an operand", "const ok = p != \"\" && check(p)"],
    ["a whole-statement call", "check(p)\n        const ok = true"],
    ["an alias of the import", "const g = check\n        const ok = g(p)"],
  ];
  for (const [label, decl] of shapes) {
    test(label, () => {
      expect(codesOf(decl)).toContain("E-ERROR-002");
    });
  }

  test("a renamed import (`check as auth`)", () => {
    expect(codesOf("const ok = auth(p)", `import { check as auth, AuthErr } from "./lib.scrml"`)).toContain("E-ERROR-002");
  });

  test("through a re-export", () => {
    const mid = `\${\n    export { check, AuthErr } from "./lib.scrml"\n}\n`;
    expect(codesOf("const ok = check(p)", `import { check, AuthErr } from "./mid.scrml"`, { "mid.scrml": mid })).toContain("E-ERROR-002");
  });

  test("the message names the imported function", () => {
    const r = compileProject({ "lib.scrml": LIB, "app.scrml": APP("const ok = check(p)") });
    expect(r.messages.join("\n")).toMatch(/'check'/);
  });

  test("an imported plain function stays clean", () => {
    expect(codesOf("const ok = plain(p)")).toEqual([]);
  });
});

describe("handled calls of an imported `!` function: executed (wrong password rejected)", () => {
  test("`check(p) !{ .Denied :> false }`", async () => {
    await expectRejectsWrong("const ok = check(p) !{ .Denied :> false }");
  });
  test("`match check(p) { .Denied :> false  _ :> true }`", async () => {
    await expectRejectsWrong("const ok = match check(p) { .Denied :> false  _ :> true }");
  });
  test("the import renamed, matched", async () => {
    await expectRejectsWrong("const ok = match auth(p) { .Denied :> false  _ :> true }",
      `import { check as auth, AuthErr } from "./lib.scrml"`);
  });
});

describe("the error enum not imported (unreadable here): fail closed", () => {
  test("`match check(p)` without importing AuthErr is refused, with the reason", () => {
    const r = compileProject({ "lib.scrml": LIB, "app.scrml": APP("const ok = match check(p) { .Denied :> false  _ :> true }", `import { check } from "./lib.scrml"`) });
    expect(r.codes).toContain("E-ERROR-002");
    expect(r.messages.join("\n")).toMatch(/'check' is imported and its error type is not available/);
  });
  test("a DIFFERENT local enum of the same name does not make it readable", () => {
    const app = APP("const ok = match check(p) { .Denied :> false  _ :> true }", `import { check } from "./lib.scrml"\n    type AuthErr:enum = { Denied, Other }`);
    expect(compileProject({ "lib.scrml": LIB, "app.scrml": app }).codes).toContain("E-ERROR-002");
  });
  test("`check(p) !{ _ :> false }` without importing AuthErr still rejects a wrong password", async () => {
    await expectRejectsWrong("const ok = check(p) !{ _ :> false }", `import { check } from "./lib.scrml"`);
  });
});

describe("an imported SERVER `!` function", () => {
  const SRV_LIB = `\${
    export type AuthErr:enum = { Denied }
    export server function scheck(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
`;
  const SRV_APP = (body) => `<program>
\${
    import { scheck, AuthErr } from "./lib.scrml"
    server function login(p) {
        ${body}
    }
}
<p>x</p>
</program>
`;
  test("an unhandled call in a server function is E-ERROR-002", () => {
    const r = compileProject({ "lib.scrml": SRV_LIB, "app.scrml": SRV_APP("const ok = scheck(p)\n        return ok") });
    expect(r.codes).toContain("E-ERROR-002");
  });
  test("handled with `!{}` it compiles", () => {
    const r = compileProject({ "lib.scrml": SRV_LIB, "app.scrml": SRV_APP("const ok = scheck(p) !{ _ :> false }\n        return ok") });
    expect(r.codes).toEqual([]);
  });
});
