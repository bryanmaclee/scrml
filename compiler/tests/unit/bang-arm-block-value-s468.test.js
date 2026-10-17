/**
 * bang-arm-block-value-s468.test.js — SPEC §19.4.3 / §18.5: a BLOCK `!{}` arm's
 * last expression is the arm's value (g-block-bodied-bang-arm-drops-value-s467).
 *
 * §19.4.3 "Handling in a value position": every arm SHALL "Yield a value of the
 * call's success type: the arm is an expression, or a block whose last expression
 * is that value (§18.5)." impl#1 lowered a multi-statement block arm as side
 * effects only: `const ok = check(p) !{ .Denied :> { @msg = "d"⏎ false } }`
 * emitted `false;` inside the arm, then `var ok = <result>` — the error envelope,
 * which is truthy — so a wrong password logged in. Every value position, both
 * boundaries, and the adjacent arm shapes (a leave, a fall-through, a statement
 * position) are covered, most of them EXECUTED.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function compileSource(source, label = "case") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s468-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    const all = result.errors ?? [];
    const errors = all.filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    return {
      errors,
      codes: errors.map((e) => e.code),
      clientJs: read("app.client.js"),
      serverJs: read("app.server.js"),
      html: read("app.html"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A page whose `login(p)` runs `body`; `body` must leave `ok` holding the verdict. */
const LOGIN = (body, extra = "") => `type AuthErr:enum = { Denied }
<msg> = "init"
<note> = ""
<cellOk> = false
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function no() { return false }
    function plain(x) { return x }
${extra}
    function login(p) {
        ${body}
        if (ok) { @msg = "LOGGED IN" } else { @msg = "rejected" }
    }
}
<button id="wrong" onclick=login("wrong")>go</button>
<button id="right" onclick=login("secret")>go</button>
<p id="out">\${@msg}</p>
<p id="note">\${@note}</p>
`;

async function boot(source) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const out = compileSource(source, "login");
  if (out.errors.length > 0) throw new Error(`compile errors: ${out.codes.join(", ")}\n${out.errors.map((e) => e.message).join("\n")}`);
  const bodyMatch = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  // eslint-disable-next-line no-eval
  (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${out.clientJs}\n})();`);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  await settle();
  return {
    click: async (sel) => { document.querySelector(sel).click(); await settle(); },
    text: (sel) => document.querySelector(sel).textContent,
    clientJs: out.clientJs,
  };
}

/** Wrong password is rejected (and the arm's side effect ran); right one logs in. */
async function expectRejectsWrong(body, extra = "", { noteAfterWrong = "d" } = {}) {
  const page = await boot(LOGIN(body, extra));
  await page.click("#wrong");
  expect(page.text("#out")).toBe("rejected");
  if (noteAfterWrong !== null) expect(page.text("#note")).toBe(noteAfterWrong);
  await page.click("#right");
  expect(page.text("#out")).toBe("LOGGED IN");
  return page;
}

// ---------------------------------------------------------------------------
// A — the security repro and every value position
// ---------------------------------------------------------------------------

describe("A — a block arm's last expression is the value, in every value position", () => {
  test("the gap's repro: `const ok = check(p) !{ .Denied :> { @note = \"d\"⏎ false } }`", async () => {
    const page = await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"
            false } }`);
    // The tail is ASSIGNED to the result slot, not emitted as a bare statement.
    expect(page.clientJs).not.toMatch(/^\s*false;\s*$/m);
  });

  test("`;`-separated block on one line", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"; false } }`);
  });

  test("let initializer", async () => {
    await expectRejectsWrong(`let ok = check(p) !{ .Denied :> { @note = "d"
            false } }`);
  });

  test("assignment to a declared binding", async () => {
    await expectRejectsWrong(`let ok = true
        ok = check(p) !{ .Denied :> { @note = "d"
            false } }`);
  });

  test("cell write: `@cellOk = check(p) !{ … }` lands the arm's value in the cell", async () => {
    await expectRejectsWrong(`@cellOk = check(p) !{ .Denied :> { @note = "d"
            false } }
        const ok = @cellOk`);
  });

  test("return operand: `return check(p) !{ … }`", async () => {
    await expectRejectsWrong(`const ok = verify(p)`, `    function verify(p) {
        return check(p) !{ .Denied :> { @note = "d"
            false } }
    }`);
  });

  // `;` separator: an expression-position handler's arm text reaches codegen
  // token-joined (newlines lost), so a newline-separated block there is refused at
  // compile time (E-CODEGEN-INVALID-LOGIC) on base and here alike — filed separately.
  test("function argument (expression-position handler)", async () => {
    await expectRejectsWrong(`const ok = plain(check(p) !{ .Denied :> { @note = "d"; false } })`);
  });

  test("operand of an operator (expression-position handler)", async () => {
    await expectRejectsWrong(`const ok = (check(p) !{ .Denied :> { @note = "d"; false } }) == true`);
  });

  test("wildcard arm", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ _ :> { @note = "d"
            false } }`);
  });
});

// ---------------------------------------------------------------------------
// B — the shapes of the arm and of its surroundings
// ---------------------------------------------------------------------------

describe("B — arm shapes and enclosing statements", () => {
  test("the tail is a call: its result is the value", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"
            no() } }`);
  });

  test("the tail is an operator expression over a declared local", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> {
            const n = 1
            @note = "d"
            n > 2
        } }`);
  });

  test("the tail is itself a handled call: that handler's value", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"
            check(p) !{ _ :> false } } }`);
  });

  test("a `return` inside the arm leaves; otherwise the tail is the value", async () => {
    const page = await boot(LOGIN(`const ok = check(p) !{ .Denied :> {
            if (p == "wrong") { @note = "left"
                return }
            @note = "d"
            false
        } }`));
    await page.click("#wrong");
    // The arm left the function before the verdict was written.
    expect(page.text("#out")).toBe("init");
    expect(page.text("#note")).toBe("left");
    await page.click("#right");
    expect(page.text("#out")).toBe("LOGGED IN");
  });

  test("inside an `if` body", async () => {
    await expectRejectsWrong(`let ok = false
        if (p != "") {
            ok = check(p) !{ .Denied :> { @note = "d"
                false } }
        }`);
  });

  test("inside a `for` body (a nested block)", async () => {
    await expectRejectsWrong(`let ok = false
        for (const q of [p]) {
            const r = check(q) !{ .Denied :> { @note = "d"
                false } }
            ok = r
        }`);
  });

  test("inside a `match` arm body", async () => {
    await expectRejectsWrong(`let ok = false
        const s: string = p
        match s {
            "" :> { ok = false }
            else :> {
                const r = check(p) !{ .Denied :> { @note = "d"
                    false } }
                ok = r
            }
        }`);
  });

  test("a `log()` in the block's leading statements names the author's file, not a probe", () => {
    const out = compileSource(LOGIN(`const ok = check(p) !{ _ e :> {
            log("denied", e)
            no()
        } }`));
    expect(out.codes).toEqual([]);
    expect(out.clientJs).toMatch(/_scrml_log\("client", "app\.scrml:\d+", "denied", e\)/);
    expect(out.clientJs).not.toContain("defer-probe");
  });

  test("statement position: the arm's side effects run; nothing is read", async () => {
    await expectRejectsWrong(`check(p) !{ .Denied :> { @note = "d"
            false } }
        const ok = p == "secret"`);
  });
});

// ---------------------------------------------------------------------------
// C — the arms this change does not touch lower as before
// ---------------------------------------------------------------------------

describe("C — non-value arms are unchanged", () => {
  test("a single-expression arm", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> false }`, "", { noteAfterWrong: "" });
  });

  test("a block that ends in `return` still returns", async () => {
    const page = await boot(LOGIN(`const ok = check(p) !{ .Denied :> { @note = "d"
            return } }`));
    await page.click("#wrong");
    expect(page.text("#out")).toBe("init");
    expect(page.text("#note")).toBe("d");
  });

  test("a block that ends in a write emits no result assignment for the write", () => {
    const out = compileSource(LOGIN(`const ok = check(p) !{ .Denied :> { @note = "d" } }`));
    expect(out.codes).toEqual([]);
    expect(out.clientJs).not.toMatch(/_scrml__scrml_result_\d+\s*=\s*_scrml_cs_reactive_set/);
  });
});

// ---------------------------------------------------------------------------
// D — the server boundary
// ---------------------------------------------------------------------------

describe("D — a server function's block arm yields its value too", () => {
  const SRV = (armBody) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    server function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    server function login(p) {
        let note = ""
        const ok = check(p) !{ .Denied :> ${armBody} }
        if (ok) { return "LOGGED IN" }
        return "rejected"
    }
    function go() { @msg = login("wrong") }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
`;

  test("the tail is assigned to the result slot, never a bare statement", () => {
    const out = compileSource(SRV(`{ note = "d"
            false }`));
    expect(out.codes).toEqual([]);
    expect(out.serverJs).toMatch(/note = "d";\s*\n\s*(_scrml_\w+) = false;/);
    expect(out.serverJs).not.toMatch(/^\s*false;\s*$/m);
    // The arm stays on the server.
    expect(out.clientJs).not.toContain(`note = "d"`);
  });

  test("a tail call on the server is assigned", () => {
    const out = compileSource(SRV(`{ note = "d"
            note.length > 5 }`));
    expect(out.codes).toEqual([]);
    expect(out.serverJs).toMatch(/(_scrml_\w+) = note\s*\.\s*length > 5;/);
  });
});
