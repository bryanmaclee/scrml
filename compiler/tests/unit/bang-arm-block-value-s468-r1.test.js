/**
 * bang-arm-block-value-s468-r1.test.js — S468 fix round 1 (S239 review of
 * 684420b36) for g-block-bodied-bang-arm-drops-value-s467.
 *
 * 1. FAIL CLOSED ON THE CLIENT. SPEC §19.4.3: "In a value position, every arm
 *    SHALL do one of two things" — yield a value ("a block whose last expression
 *    is that value (§18.5)") or leave; an arm that does neither "SHALL be a
 *    compile error". When the arm reader (`armBlockStatementsDetailed`) cannot
 *    read a braced arm (a line starting with a number / string / `!` / `[`, a
 *    block-armed `!{}` nested in the arm), the client used to fall back to the
 *    text lowering that drops the arm's value: the guarded value stayed the error
 *    envelope (truthy) and a WRONG PASSWORD LOGGED IN. The server already refused
 *    the same text (E-STMT-UNEXPECTED-TOKEN). Now the client refuses it too.
 *    A statement-position handler (its result is not read) is unchanged.
 * 2. Each statement of a re-read arm block is anchored at its OWN source line
 *    (`log()`'s `file:line`, §20.6), not at the arm's first line.
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
  const dir = resolve(tmpdir(), `scrml-s468r1-${uniq}`);
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
type E2:enum = { Locked, Denied }
<msg> = "init"
<note> = ""
<cellOk> = false
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    function check2(p)! -> E2 {
        if (p != "secret") fail E2::Locked
        return true
    }
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

/** The same handler in a SERVER function (the boundary that already refused). */
const SERVER_LOGIN = (body) => `type AuthErr:enum = { Denied }
<msg> = "init"
\${
    server function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
    server function login(p) {
${body}
        if (ok) { return "LOGGED IN" }
        return "rejected"
    }
    function go() { @msg = login("wrong") }
}
<button onclick=go()>go</button>
<p>\${@msg}</p>
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

/** Wrong password is rejected; right one logs in. */
async function expectRejectsWrong(body, extra = "") {
  const page = await boot(LOGIN(body, extra));
  await page.click("#wrong");
  expect(page.text("#out")).toBe("rejected");
  await page.click("#right");
  expect(page.text("#out")).toBe("LOGGED IN");
  return page;
}

/** The arm is refused: exactly one E-STMT-UNEXPECTED-TOKEN naming the arm and the unreadable text. */
function expectRefused(body, { arm = ".Denied", at = null, extra = "" } = {}) {
  const out = compileSource(LOGIN(body, extra), "refused");
  expect(out.codes).toEqual(["E-STMT-UNEXPECTED-TOKEN"]);
  const msg = out.errors[0].message;
  expect(msg).toContain(`the \`${arm}\` arm of a \`!{ }\` handler whose result is used`);
  expect(msg).toContain("§19.4.3");
  if (at !== null) expect(msg).toContain(`no statement begins at \`${at}\``);
  return out;
}

// ---------------------------------------------------------------------------
// A — every reviewed shape is refused on the client (it used to log a wrong
//     password in: the arm's value was dropped)
// ---------------------------------------------------------------------------

describe("A — a value-position arm the reader cannot read is a compile error on the client", () => {
  test("`{ @note = \"d\"⏎ !yes }`", () => {
    expectRefused(`const yes = true
        const ok = check(p) !{ .Denied :> { @note = "d"
            !yes } }`, { at: "! yes" });
  });

  test("`{ @note = \"d\"⏎ !true }`", () => {
    expectRefused(`const ok = check(p) !{ .Denied :> { @note = "d"
            !true } }`, { at: "! true" });
  });

  test("an operand of an operator: `true && check(p) !{ … ⏎ !yes }`", () => {
    expectRefused(`const yes = true
        const ok = true && check(p) !{ .Denied :> { @note = "d"
            !yes } }`, { at: "! yes" });
  });

  test("`{ @note = \"d\"⏎ 0 }`", () => {
    expectRefused(`const ok = check(p) !{ .Denied :> { @note = "d"
            0 } }`, { at: "0" });
  });

  test("`{ @note = \"d\"⏎ \"\" }`", () => {
    expectRefused(`const ok = check(p) !{ .Denied :> { @note = "d"
            "" } }`, { at: "\"\"" });
  });

  test("`{ plain(1)⏎ @note = \"d\"⏎ 0 }`", () => {
    expectRefused(`const ok = check(p) !{ .Denied :> { plain(1)
            @note = "d"
            0 } }`, { at: "0" });
  });

  test("`{ plain(1)⏎ !yes }`", () => {
    expectRefused(`const yes = true
        const ok = check(p) !{ .Denied :> { plain(1)
            !yes } }`, { at: "! yes" });
  });

  test("a line starting with `[` (joined to the line above, then refused by the strict reader)", () => {
    expectRefused(`const r = check(p) !{ .Denied :> { @note = "d"
            [] } }
        const ok = r == true`);
  });

  test("the wildcard arm is named `_`", () => {
    expectRefused(`const ok = check(p) !{ _ :> { @note = "d"
            0 } }`, { arm: "_", at: "0" });
  });

  test("the refused artifact never carries the fallback that drops the value", () => {
    const out = expectRefused(`const ok = check(p) !{ .Denied :> { @note = "d"
            0 } }`);
    // (A compile with an Error ships no runnable artifact; if one was written it is the placeholder.)
    if (out.clientJs) expect(out.clientJs).not.toMatch(/^\s*0;\s*$/m);
  });
});

// ---------------------------------------------------------------------------
// A2 — a block-armed `!{}` NESTED in the arm is now READ (the reader judged the
//      nested arm's expression reading of its block, which drops every
//      statement after the first, and refused); it yields its value
// ---------------------------------------------------------------------------

describe("A2 — a block-armed handler nested in the arm is read and yields its value", () => {
  test("newline form", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"
            const y = check2(p) !{ .Locked :> { @note = "l"
                false }
                .Denied :> false }
            y } }`);
  });

  test("`;` form", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"; const y = check2(p) !{ .Locked :> { @note = "l"; false } .Denied :> false }; y } }`);
  });

  test("`{ const y = check2(p) !{ .Locked :> {…⏎ false }⏎ .Denied :> false }⏎ y }`", async () => {
    const page = await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { const y = check2(p) !{ .Locked :> { @note = "l"
                false }
                .Denied :> false }
            y } }`);
    expect(page.text("#note")).toBe("l");
  });

  test("the nested arm's own unreadable block is still refused", () => {
    expectRefused(`const ok = check(p) !{ .Denied :> { const y = check2(p) !{ .Locked :> { @note = "l"
                0 }
                .Denied :> false }
            y } }`, { at: "0" });
  });

  test("server: the nested form compiles (it was refused) and its tail is assigned", () => {
    const out = compileSource(SERVER_LOGIN(`        let note = ""
        const ok = check(p) !{ .Denied :> { note = "d"
            const y = check(p) !{ .Denied :> { note = "l"
                false } }
            y } }`), "srv-nested");
    expect(out.codes).toEqual([]);
    expect(out.serverJs).not.toMatch(/^\s*y;\s*$/m);
    expect(out.serverJs).not.toMatch(/^\s*false;\s*$/m);
  });
});

// ---------------------------------------------------------------------------
// B — every value position is covered
// ---------------------------------------------------------------------------

describe("B — the refusal covers every value position", () => {
  const ARM = `!{ .Denied :> { @note = "d"
            0 } }`;
  test("`let` initializer", () => { expectRefused(`let ok = check(p) ${ARM}`); });
  test("assignment to a declared binding", () => {
    expectRefused(`let ok = false
        ok = check(p) ${ARM}`);
  });
  test("cell write", () => {
    expectRefused(`@cellOk = check(p) ${ARM}
        const ok = @cellOk`);
  });
  test("`return` operand", () => {
    expectRefused(`const ok = vf(p)`, { extra: `    function vf(p) {
        return check(p) ${ARM}
    }` });
  });
  test("function argument (expression-position handler)", () => {
    expectRefused(`const ok = plain(check(p) ${ARM})`);
  });
});

// ---------------------------------------------------------------------------
// C — what is NOT refused
// ---------------------------------------------------------------------------

describe("C — readable arms, statement positions and the server are unchanged", () => {
  test("the `;`-separated spelling the message suggests compiles and rejects the wrong password", async () => {
    await expectRejectsWrong(`const yes = true
        const ok = check(p) !{ .Denied :> { @note = "d"; !yes } }`);
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { plain(1); @note = "d"; 0 } }`);
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"; "" } }`);
  });

  test("a readable block arm still yields its last expression", async () => {
    await expectRejectsWrong(`const ok = check(p) !{ .Denied :> { @note = "d"
            false } }`);
  });

  test("statement position: the same unreadable arm is not a value, so it is not refused", async () => {
    await expectRejectsWrong(`check(p) !{ .Denied :> { @note = "d"
            0 } }
        const ok = p == "secret"`);
    await expectRejectsWrong(`const yes = true
        check(p) !{ .Denied :> { @note = "d"
            !yes } }
        const ok = p == "secret"`);
  });

  test("the server refuses the same arm exactly once (unchanged)", () => {
    for (const [body, at] of [
      [`        let note = ""
        const ok = check(p) !{ .Denied :> { note = "d"
            0 } }`, "0"],
      [`        let note = ""
        const yes = true
        const ok = check(p) !{ .Denied :> { note = "d"
            !yes } }`, "! yes"],
    ]) {
      const out = compileSource(SERVER_LOGIN(body), "srv");
      expect(out.codes).toEqual(["E-STMT-UNEXPECTED-TOKEN"]);
      expect(out.errors[0].message).toContain(`no statement begins at \`${at}\``);
    }
  });
});

// ---------------------------------------------------------------------------
// D — each statement of a re-read arm block names its own line (§20.6 log)
// ---------------------------------------------------------------------------

describe("D — a re-read arm statement is anchored at its own line", () => {
  test("client: `log()`s on lines 20, 22 (after a blank line) and 23 (inside an `if`)", () => {
    const src = LOGIN(`const ok = check(p) !{ .Denied :> { log("one")

            log("two")
            if (p == "q") { log("three") }
            false } }`);
    const lineOf = (s) => src.split("\n").findIndex((l) => l.includes(s)) + 1;
    const out = compileSource(src, "logs");
    expect(out.codes).toEqual([]);
    expect(out.clientJs).toContain(`_scrml_log("client", "app.scrml:${lineOf('log("one")')}", "one")`);
    expect(out.clientJs).toContain(`_scrml_log("client", "app.scrml:${lineOf('log("two")')}", "two")`);
    expect(out.clientJs).toContain(`_scrml_log("client", "app.scrml:${lineOf('log("three")')}", "three")`);
    expect(lineOf('log("two")')).toBe(lineOf('log("one")') + 2);
  });

  test("server: the same", () => {
    const src = SERVER_LOGIN(`        const ok = check(p) !{ .Denied :> { log("one")

            log("two")
            false } }`);
    const lineOf = (s) => src.split("\n").findIndex((l) => l.includes(s)) + 1;
    const out = compileSource(src, "srvlogs");
    expect(out.codes).toEqual([]);
    expect(out.serverJs).toContain(`_scrml_log("server", "app.scrml:${lineOf('log("one")')}", "one")`);
    expect(out.serverJs).toContain(`_scrml_log("server", "app.scrml:${lineOf('log("two")')}", "two")`);
  });
});
