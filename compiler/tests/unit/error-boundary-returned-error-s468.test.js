/**
 * S468 — g-errorboundary-runtime-does-not-catch-returned-error-value-s467.
 *
 * §19.6.6: "`<errorBoundary>` SHALL catch error variants produced by any `!` function call made
 * while RENDERING its direct or nested markup content (a `${…}` interpolation, for example)."
 * A `!` call RETURNS its error. Before S468 the boundary tested only an interpolation's FINAL
 * value, so a render-time call whose result was bound (`${ const ok = check("wrong") }`), written
 * (`${ @m = check(x) }`) or transformed (`${check(x) + "!"}`, `${check(x) ? a : b}`) was never
 * caught: the error object read as a truthy success ("LOGGED IN").
 *
 * The fix: the type system marks every render-time call the boundary handles; codegen lowers it
 * to `_scrml_error_boundary_check(call)`, which raises the error so the rest of the render stops
 * and the boundary's catch receives the TYPED failure (renders, else fallback — §19.6.5). A
 * statement in the boundary's content runs inside `_scrml_error_boundary_run`, one per enclosing
 * boundary (inner catches first, §19.6.4). A position with no catch site is refused (E-ERROR-002)
 * rather than shipped uncaught.
 *
 * Executed under happy-dom with the FULL runtime + the emitted client.js.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function compile(src) {
  const dir = mkdtempSync(join(tmpdir(), "s468-eb-"));
  const abs = join(dir, "app.scrml");
  writeFileSync(abs, src);
  try {
    const result = compileScrml({ inputFiles: [abs], outputDir: join(dir, "dist"), write: false, log: () => {} });
    const errors = (result.errors || []).filter((e) => e && e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    const out = [...(result.outputs || new Map()).entries()][0]?.[1];
    return { errors, codes: errors.map((e) => e.code), html: out?.html ?? "", clientJs: out?.clientJs ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function mount(src, mutate = "") {
  const r = compile(src);
  if (r.errors.length > 0) throw new Error(`compile errors: ${r.errors.map((e) => `${e.code} ${e.message}`).join(" | ")}`);
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const body = (r.html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || r.html;
  document.body.innerHTML = body.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const logs = [];
  const realErr = console.error;
  console.error = (...a) => { logs.push(a.map(String).join(" ")); };
  let thrown = null;
  try {
    // eslint-disable-next-line no-eval
    (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${mutate}\n${r.clientJs}\n})();`);
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    for (let i = 0; i < 5; i++) await new Promise((res) => setTimeout(res, 0));
  } catch (e) {
    thrown = e;
  } finally {
    console.error = realErr;
  }
  const q = (sel) => document.querySelector(sel);
  return { r, logs, thrown, q, text: (sel) => q(sel)?.textContent ?? null, html: () => document.body.innerHTML };
}

const CHECK = `type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
`;

describe("A — the gap reproducer: a render-time binding of a `!` call", () => {
  const SRC = (pw) => `${CHECK}
<errorBoundary fallback={<div id="fb">FALLBACK</>}>
    \${ const ok = check("${pw}") }
    <p id="out">\${ok ? "LOGGED IN" : "rejected"}</p>
</>
<p id="sib">sibling</p>
`;

  test("a wrong password shows the fallback, never LOGGED IN", async () => {
    const page = await mount(SRC("wrong"));
    expect(page.thrown).toBe(null);
    expect(page.html()).not.toContain("LOGGED IN");
    expect(page.text("#fb")).toBe("FALLBACK");
    expect(page.q("#out")).toBe(null);
    expect(page.text("#sib")).toBe("sibling"); // content outside the boundary survives (§19.6.4)
    expect(page.logs.some((l) => l.includes("errorBoundary") && l.includes("AuthErr::Denied"))).toBe(true); // B5
  });

  test("the right password renders the content (the boundary is transparent on success)", async () => {
    const page = await mount(SRC("secret"));
    expect(page.text("#out")).toBe("LOGGED IN");
    expect(page.q("#fb")).toBe(null);
  });

  test("the emitted call is checked at the call, inside the boundary's run", () => {
    const r = compile(SRC("wrong"));
    expect(r.codes).toEqual([]);
    expect(r.clientJs).toContain("_scrml_error_boundary_check(");
    expect(r.clientJs).toContain("_scrml_error_boundary_run(");
  });
});

describe("B — a `!` call in a value position of an interpolation", () => {
  test("`${check(p) + \"!\"}` and `${check(p) ? a : b}` show the fallback", async () => {
    const page = await mount(`${CHECK}
<errorBoundary fallback={<div class="fb">FALLBACK</>}>
    <p id="a">\${check("wrong") + "!"}</p>
    <p id="b">\${check("wrong") ? "LOGGED IN" : "rejected"}</p>
</>
`);
    expect(page.html()).not.toContain("LOGGED IN");
    expect(page.html()).not.toContain("[object Object]");
    expect(page.html().match(/FALLBACK/g)?.length).toBe(2);
  });

  test("success in a value position renders the value", async () => {
    const page = await mount(`${CHECK}
<errorBoundary fallback={<div class="fb">FALLBACK</>}>
    <p id="b">\${check("secret") ? "LOGGED IN" : "rejected"}</p>
</>
`);
    expect(page.text("#b")).toBe("LOGGED IN");
  });
});

const CODE = `type CodeError:enum = {
    Empty
        renders <p class="err-empty">Enter a code</>
    TooLong
}
<entry> = ""
<m> = "init"
\${
    function checkCode(text: string)! -> CodeError {
        if (text == "") fail CodeError::Empty
        if (text.length > 3) fail CodeError::TooLong
        return text.toUpperCase()
    }
}
`;

describe("C — renders vs fallback priority (§19.6.5)", () => {
  test("a variant WITH renders shows its own markup; one WITHOUT shows the fallback", async () => {
    const page = await mount(`${CODE}
<errorBoundary fallback={<div class="fb1">FALLBACK1</>}>
    \${ const v = checkCode(@entry) }
    <p id="v">\${v}</p>
</>
<errorBoundary fallback={<div class="fb2">FALLBACK2</>}>
    \${ const w = checkCode("toolong") }
    <p id="w">\${w}</p>
</>
`);
    expect(page.q(".err-empty")?.textContent).toBe("Enter a code"); // Empty renders
    expect(page.q(".fb1")).toBe(null);
    expect(page.q(".fb2")?.textContent).toBe("FALLBACK2");          // TooLong -> fallback
    expect(page.q("#v")).toBe(null);
    expect(page.q("#w")).toBe(null);
  });

  test("a failed `@cell = f()` write never reaches the cell", async () => {
    const page = await mount(`${CODE}
<errorBoundary fallback={<div class="fb">FALLBACK</>}>
    \${ @m = checkCode(@entry) }
    <p id="in">\${@m}</p>
</>
<p id="mout">\${@m}</p>
`);
    expect(page.text("#mout")).toBe("init");
    expect(page.html()).not.toContain("[object Object]");
    expect(page.q(".err-empty")?.textContent).toBe("Enter a code");
  });
});

describe("D — nesting: the inner boundary catches first (§19.6.4)", () => {
  test("a statement failure in an inner boundary shows the inner fallback; the outer content survives", async () => {
    const page = await mount(`${CODE}
<errorBoundary fallback={<div class="outerfb">OUTER</>}>
    <p id="head">HEADER</p>
    <errorBoundary fallback={<div class="innerfb">INNER</>}>
        \${ const v = checkCode("toolong") }
        <p id="inner">\${v}</p>
    </>
    <p id="foot">FOOTER</p>
</>
`);
    expect(page.q(".innerfb")?.textContent).toBe("INNER");
    expect(page.q(".outerfb")).toBe(null);
    expect(page.text("#head")).toBe("HEADER");
    expect(page.text("#foot")).toBe("FOOTER");
  });

  test("an inner boundary with no fallback is still E-ERROR-005 for a variant without renders", () => {
    const r = compile(`${CODE}
<errorBoundary fallback={<div>OUTER</>}>
    <errorBoundary>
        \${ const v = checkCode(@entry) }
        <p>\${v}</p>
    </>
</>
`);
    expect(r.codes).toContain("E-ERROR-005");
  });
});

// `boom` makes `check` throw a HOST error (`undefined.length`, a TypeError) — not a `!` error.
const HOST = `type AuthErr:enum = { Denied }
\${
    function check(p)! -> AuthErr {
        if (p == "boom") {
            const parts = p.split(",")
            return parts[5].length
        }
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
`;

describe("E — the §19.6.8 host-throw backstop still works", () => {
  test("a host throw in an interpolation shows the fallback and is logged as non-!", async () => {
    const page = await mount(`${HOST}
<errorBoundary fallback={<div class="fb">FALLBACK</>}>
    <p id="x">\${check("boom") ? "IN" : "OUT"}</p>
</>
<p id="sib">sibling</p>
`);
    expect(page.thrown).toBe(null);
    expect(page.q(".fb")?.textContent).toBe("FALLBACK");
    expect(page.text("#sib")).toBe("sibling");
    expect(page.logs.some((l) => l.includes("errorBoundary") && l.includes("non-!"))).toBe(true);
  });

  test("a host throw in a boundary statement shows the fallback and is logged as non-!", async () => {
    const page = await mount(`${HOST}
<errorBoundary fallback={<div class="fb">FALLBACK</>}>
    \${ const ok = check("boom") }
    <p id="x">\${ok ? "IN" : "OUT"}</p>
</>
<p id="sib">sibling</p>
`);
    expect(page.thrown).toBe(null);
    expect(page.q(".fb")?.textContent).toBe("FALLBACK");
    expect(page.q("#x")).toBe(null);
    expect(page.text("#sib")).toBe("sibling");
    expect(page.logs.some((l) => l.includes("errorBoundary") && l.includes("non-!"))).toBe(true);
  });

  test("an inner boundary with no fallback passes a host throw in a statement to the outer one (§19.6.8 B3)", async () => {
    const page = await mount(`type AuthErr:enum = {
    Denied
        renders <p class="denied">denied</>
}
\${
    function check(p)! -> AuthErr {
        if (p == "boom") {
            const parts = p.split(",")
            return parts[5].length
        }
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<errorBoundary fallback={<div class="outerfb">OUTER</>}>
    <errorBoundary>
        \${ const bad = check("boom") }
        <p id="bad">\${bad}</p>
    </>
</>
`);
    expect(page.thrown).toBe(null);
    expect(page.q(".outerfb")?.textContent).toBe("OUTER");
    expect(page.q("#bad")).toBe(null);
  });
});

describe("F — positions with no boundary catch are refused, not shipped uncaught", () => {
  test("a call in a markup attribute value inside a boundary is E-ERROR-002", () => {
    const r = compile(`${CHECK}
<errorBoundary fallback={<div>FALLBACK</>}>
    <p title=\${check("wrong")}>x</p>
</>
`);
    expect(r.codes).toContain("E-ERROR-002");
  });

  test("a call in an `<each>` row inside a boundary is E-ERROR-002", () => {
    const r = compile(`${CHECK}
<items> = ["a", "b"]
<errorBoundary fallback={<div>FALLBACK</>}>
    <each in=@items as it>
        <p>\${check(it) ? "IN" : "OUT"}</p>
    </each>
</>
`);
    expect(r.codes).toContain("E-ERROR-002");
  });

  test("a call in a handler inside a boundary is still E-ERROR-002 (not render-time, §19.6.6)", () => {
    const r = compile(`${CHECK}
<m> = ""
<errorBoundary fallback={<div>FALLBACK</>}>
    <button onclick=\${@m = check("wrong") ? "IN" : "OUT"}>go</button>
</>
`);
    expect(r.codes).toContain("E-ERROR-002");
  });
});
