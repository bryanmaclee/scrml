/**
 * each-row-interp-whitespace-s450.test.js — whitespace-only text inside an
 * `<each>` row body is content (SPEC §4.18.5), MOUNTED in happy-dom.
 *
 * Adopter report (assetManagement, `docs/scrml-finding-adjacent-interpolation-whitespace.md`):
 * inside an `<each>` row, `<td>${r.f} ${r.l}</td>` rendered `PeterOliver` while the
 * same markup outside `<each>` rendered `Peter Oliver`. Root: emit-each.ts
 * `renderTemplateChildToJs` skipped EVERY whitespace-only text child
 * (`if (!txt.trim()) return;`), so the ` ` between two interpolations, the
 * whitespace between two sibling elements, and the leading/trailing/indentation
 * runs of a per-item element body were never emitted.
 *
 * §4.18.5: "No stage SHALL collapse runs, strip leading or trailing whitespace, or
 * drop the whitespace adjacent to a `${…}` interpolation." / "Whitespace-only text
 * between elements is kept exactly too". A per-item `<li>`/`<td>` is a plain-markup
 * element → free-text body (§4.18.1); `<empty>` is a free-text body (§17.7.4).
 *
 * NOT changed (and pinned here): whitespace DIRECTLY in the `<each>` body (between
 * `<each>` and the per-item root) — §4.18.1 does not classify the `<each>` body, and
 * a top-level text node would become an extra reconcile-tracked item root.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";
import { tmpdir } from "os";

function compileToOutputs(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-s450-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
    const clientPath = resolve(outDir, `${name}.client.js`);
    const htmlPath = resolve(outDir, `${name}.html`);
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Compile, load the emitted HTML + client JS into a FRESH happy-dom window, and RUN it. */
async function compileAndLoad(source, suffix) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const { errors, clientJs, html } = compileToOutputs(source, suffix);
  if (errors.length > 0) {
    throw new Error(`compile errors: ${errors.map((e) => e.code + ": " + e.message).join(", ")}`);
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  const code =
    `(function() {\n${SCRML_RUNTIME}\n` +
    captureInsideChunkScope(clientJs, `window._scrml_reactive_get = _scrml_reactive_get;\n` +
      `window._scrml_reactive_set = _scrml_reactive_set;\n`) +
    `\n})();`;
  // eslint-disable-next-line no-eval
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  return {
    clientJs,
    set: (n, v) => window._scrml_reactive_set(n, v),
    texts: (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent),
    q: (sel) => document.querySelector(sel),
  };
}

const ROWS = `[{ id: 1, f: "Peter", l: "Oliver", on: true }, { id: 2, f: "Ada", l: "Lovelace", on: true }]`;

describe("s450 — whitespace-only text in an <each> row body is kept (§4.18.5)", () => {
  test("`${a} ${b}` in a nested <td> and in a direct per-item <li> renders with the space", async () => {
    const api = await compileAndLoad(`\${
  <rows> = ${ROWS}
}
<table><tbody>
  <each in=@rows as r key=r.id>
    <tr class="tr"><td class="c1">\${r.f} \${r.l}</td><td class="c2">Name: \${r.f}</td><td class="c3">\${r.f + " " + r.l}</td></tr>
  </each>
</tbody></table>
<ul><each in=@rows as r key=r.id><li class="li">\${r.f} \${r.l}</li></each></ul>
`, "basic");
    expect(api.texts(".c1")).toEqual(["Peter Oliver", "Ada Lovelace"]);
    expect(api.texts(".li")).toEqual(["Peter Oliver", "Ada Lovelace"]);
    // controls — these rendered correctly before the fix and must not move
    expect(api.texts(".c2")).toEqual(["Name: Peter", "Name: Ada"]);
    expect(api.texts(".c3")).toEqual(["Peter Oliver", "Ada Lovelace"]);
  });

  test("leading, trailing and multiple spaces are kept exactly", async () => {
    const api = await compileAndLoad(`\${
  <rows> = ${ROWS}
}
<ul><each in=@rows as r key=r.id><li class="sp">  \${r.f}   \${r.l}  </li></each></ul>
`, "spaces");
    expect(api.texts(".sp")).toEqual(["  Peter   Oliver  ", "  Ada   Lovelace  "]);
  });

  test("newline + indentation in a multi-line row body is kept verbatim (§4.18.5: the newline and indentation after the opener's `>` and before the closer)", async () => {
    const api = await compileAndLoad(`\${
  <rows> = ${ROWS}
}
<ul id="ml"><each in=@rows as r key=r.id>
    <li class="ml">
      \${r.f}
      \${r.l}
    </li>
  </each></ul>
`, "multiline");
    expect(api.texts(".ml")).toEqual(["\n      Peter\n      Oliver\n    ", "\n      Ada\n      Lovelace\n    "]);
  });

  test("whitespace between two sibling elements in a row is kept", async () => {
    const api = await compileAndLoad(`\${
  <rows> = ${ROWS}
}
<ul><each in=@rows as r key=r.id><li class="nest"><b>\${r.f}</b> <i>\${r.l}</i></li></each></ul>
`, "siblings");
    expect(api.texts(".nest")).toEqual(["Peter Oliver", "Ada Lovelace"]);
  });

  test("an if= branch inside a row keeps its whitespace", async () => {
    const api = await compileAndLoad(`\${
  <rows> = ${ROWS}
}
<ul><each in=@rows as r key=r.id><li><span class="iff" if=r.on>\${r.f} \${r.l}</span></li></each></ul>
`, "iff");
    expect(api.texts(".iff")).toEqual(["Peter Oliver", "Ada Lovelace"]);
  });

  test("the <empty> body (a free-text body, §17.7.4) keeps its whitespace; the empty state still tears down when rows arrive", async () => {
    const api = await compileAndLoad(`\${
  <a> = "hello"
  <rows> = []
}
<ul id="eu"><each in=@rows as r key=r.id><li class="row">\${r.f} \${r.l}</li><empty><span class="em">\${@a} \${@a}</span></empty></each></ul>
`, "empty");
    expect(api.texts(".em")).toEqual(["hello hello"]);
    api.set("rows", [{ id: 1, f: "Peter", l: "Oliver" }]);
    expect(api.texts(".em")).toEqual([]);
    expect(api.texts(".row")).toEqual(["Peter Oliver"]);
    // no stray empty-body whitespace left behind between the fences
    const stray = [...api.q("#eu").childNodes].filter((n) => n.nodeType === 3);
    expect(stray.map((n) => n.data)).toEqual([]);
  });

  test("keyed reconciliation still works after an update: order, identity and text", async () => {
    const api = await compileAndLoad(`\${
  <rows> = ${ROWS}
}
<ul id="u"><each in=@rows as r key=r.id>
    <li class="k">\${r.f} \${r.l}</li>
  </each></ul>
`, "keyed");
    expect(api.texts(".k")).toEqual(["Peter Oliver", "Ada Lovelace"]);
    const peterNode = document.querySelectorAll(".k")[0];
    api.set("rows", [{ id: 2, f: "Ada", l: "Byron" }, { id: 1, f: "Pete", l: "Oliver" }, { id: 3, f: "Grace", l: "Hopper" }]);
    expect(api.texts(".k")).toEqual(["Ada Byron", "Pete Oliver", "Grace Hopper"]);
    // key 1's row node survived the reorder (keyed reconcile, not a rebuild)
    expect(document.querySelectorAll(".k")[1]).toBe(peterNode);
    // each-body TOP-LEVEL whitespace (between <each> and <li>) is still NOT emitted:
    // the <ul> holds exactly the three item roots plus the fence comments — no text nodes.
    const ul = api.q("#u");
    expect([...ul.childNodes].filter((n) => n.nodeType === 3).length).toBe(0);
    expect(ul.children.length).toBe(3);
  });
});

// DOM-global hygiene (#1219): unregister happy-dom so every later file in the same
// `bun test` process sees Bun's natives.
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});
