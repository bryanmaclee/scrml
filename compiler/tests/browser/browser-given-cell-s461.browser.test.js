/**
 * browser-given-cell-s461 — EXECUTES the emitted client JS for `given @cell :>`.
 *
 * Gap: `g-top-level-given-emits-bare-name-s459` (HIGH). Pre-fix the emitted guard
 * was `if (user !== null && user !== undefined)` — `user` is never declared, so the
 * TOP-LEVEL markup guard threw `ReferenceError: user is not defined` the moment the
 * client script loaded (taking the rest of the script with it), the handler guard
 * threw on click, and the markup guard's `<p>` body was dropped from the output.
 *
 * SPEC §42.3.5 worked example: `${ given @user :> { <p>${@user.name}</p> } }`
 * — "OK — narrowed to present inside the guard". §42.2.3: "If any listed
 * variable is `not`, the body is skipped entirely."
 *
 * These assertions drive compile → mount → render → mutate with happy-dom and the
 * PRUNED per-app runtime the build actually ships (`result.runtimeFilename`).
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve(tmpdir(), "scrml-given-cell-s461");

function compileAndMount(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  const html = readFileSync(resolve(outDir, `${baseName}.html`), "utf8");
  const clientJs = readFileSync(resolve(outDir, `${baseName}.client.js`), "utf8");
  const runtimeJs = readFileSync(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js"), "utf8");

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  document.body.innerHTML = bodyHtml;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(
      clientJs,
      `globalThis.__s461_set = _scrml_reactive_set;\nglobalThis.__s461_get = _scrml_reactive_get;\n`,
    ),
  );
  // Pre-fix this line threw `ReferenceError: user is not defined`.
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return { errors, clientJs };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const SRC = `<program>
type User:struct = { name: string }
<user>: User | not = not
<other>: User | not = not
<msg>: string = "none"
\${
  function show() {
    given @user :> { @msg = @user.name }
  }
  function both() {
    given @user, @other :> { @msg = @user.name + "+" + @other.name }
  }
}
<main>
  <button id="go" onclick=show()>go</button>
  <button id="both" onclick=both()>both</button>
  <p id="msg">\${@msg}</p>
  <div id="guard">\${ given @user :> { <p class="who">\${@user.name}</p> } }</div>
  <div id="multi">\${ given @user, @other :> { <i class="pair">\${@other.name}</i> } }</div>
</main>
</program>
`;

describe("given @cell :> — executed (g-top-level-given-emits-bare-name-s459)", () => {
  test("loads without ReferenceError; markup guard renders nothing while the cell is `not`", () => {
    const { errors, clientJs } = compileAndMount(SRC, "given-cell-load");
    expect(errors).toEqual([]);
    expect(clientJs).not.toContain("user !== null");
    expect(document.querySelector("#guard .who")).toBeNull();
    expect(document.querySelector("#multi .pair")).toBeNull();
  });

  test("handler guard: body skipped while `not`, runs once present — no ReferenceError", async () => {
    compileAndMount(SRC, "given-cell-handler");
    document.querySelector("#go").click();
    await flush();
    expect(globalThis.__s461_get("msg")).toBe("none");
    globalThis.__s461_set("user", { name: "a" });
    await flush();
    document.querySelector("#go").click();
    await flush();
    expect(globalThis.__s461_get("msg")).toBe("a");
    expect(document.querySelector("#msg").textContent).toContain("a");
  });

  test("markup guard renders the body when present, re-renders on change, clears on `not` (like if=)", async () => {
    compileAndMount(SRC, "given-cell-markup");
    expect(document.querySelector("#guard .who")).toBeNull();
    globalThis.__s461_set("user", { name: "a" });
    await flush();
    expect(document.querySelector("#guard .who")?.textContent).toBe("a");
    globalThis.__s461_set("user", { name: "b" });
    await flush();
    expect(document.querySelectorAll("#guard .who").length).toBe(1);
    expect(document.querySelector("#guard .who")?.textContent).toBe("b");
    globalThis.__s461_set("user", null);
    await flush();
    expect(document.querySelector("#guard .who")).toBeNull();
  });

  test("multi-variable guards are all-or-nothing (§42.2.3)", async () => {
    compileAndMount(SRC, "given-cell-multi");
    globalThis.__s461_set("user", { name: "a" });
    await flush();
    // one of two present: body skipped in BOTH the handler and the markup guard
    document.querySelector("#both").click();
    await flush();
    expect(globalThis.__s461_get("msg")).toBe("none");
    expect(document.querySelector("#multi .pair")).toBeNull();
    globalThis.__s461_set("other", { name: "z" });
    await flush();
    expect(document.querySelector("#multi .pair")?.textContent).toBe("z");
    document.querySelector("#both").click();
    await flush();
    expect(globalThis.__s461_get("msg")).toBe("a+z");
  });
});
