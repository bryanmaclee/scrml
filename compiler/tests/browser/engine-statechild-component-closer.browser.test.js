/**
 * engine-statechild-component-closer.browser.test.js
 *
 * A component closed with `</>` inside a lowercase element inside an engine
 * state-child (`<On> <div><Card>…</></div> </>`). The engine state-child parser
 * used to let the component's `</>` pop the `<div>`, consuming the state-child's
 * own closer — the program did not compile (false E-ENGINE-STATE-CHILD-MISSING).
 * Fixed in engine-statechild-parser.ts (one open-element stack). Unit-level
 * coverage: compiler/tests/unit/engine-statechild-closer-stack.test.js. This file
 * drives the emitted program in happy-dom: the state-child renders its component,
 * the siblings after it stay outside it, and leaving + re-entering the variant
 * renders it again (not blank), with event wiring inside the component intact.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-engine-sc-component-closer");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir, log: () => {} });
    const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
    return {
      errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
      html: read(resolve(outDir, `${baseName}.html`)),
      clientJs: read(resolve(outDir, `${baseName}.client.js`)),
      runtimeJs: read(resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js")),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const COMPONENT_IN_STATE_CHILD = (depth) => {
  let card = `<Card><button class="bump" onclick=bump()>n=\${@count}</button></>`;
  for (let d = depth; d >= 1; d--) card = `<div class="w${d}">${card}</div>`;
  return `<program>
type Phase:enum = { Off, On }
<count> = 0
function bump() { @count = @count + 1 }
const Card = <section class="card">\${children}</section>
<engine for=Phase initial=.On>
  <Off rule=.On>
    <p class="off">off</p>
  </>
  <On rule=.Off>
    ${card}
    <p class="after">after</p>
  </>
</>
</program>
`;
};

const NESTED_ENGINE = `<program>
type Phase:enum = { Off, On }
type Sub:enum = { A, B }
const Card = <section class="card">\${children}</section>
<engine for=Phase initial=.On>
  <Off rule=.On>
    <p class="off">off</p>
  </>
  <On rule=.Off>
    <engine for=Sub initial=.A>
      <A rule=.B><div class="w1"><Card><p class="inner">A</p></></div><p class="after">after</p></>
      <B rule=.A><p class="b">B</p></>
    </>
  </>
</>
</program>
`;

describe("component closed with `</>` inside a lowercase element in an engine state-child", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  function mount(source, baseName) {
    const { errors, html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    expect(errors.map((e) => e.code)).toEqual([]);
    document.documentElement.innerHTML = html;
    const consoleErrors = [];
    const origErr = console.error;
    console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
    try {
      new Function(
        "window",
        "document",
        `${runtimeJs}\n` + captureInsideChunkScope(clientJs, `globalThis.__sccc_set__ = _scrml_reactive_set;\n`),
      )(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } finally {
      console.error = origErr;
    }
    return {
      set: (name, val) => {
        const prev = console.error;
        console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
        try { globalThis.__sccc_set__(name, val); } finally { console.error = prev; }
      },
      consoleErrors,
    };
  }

  const cardText = () => {
    const c = document.querySelector(".card");
    return c ? c.textContent.replace(/\s+/g, " ").trim() : null;
  };

  function expectShape() {
    expect(document.querySelectorAll(".card").length).toBe(1);
    const after = document.querySelector(".after");
    expect(after).not.toBeNull();
    expect(after.closest(".card")).toBeNull();
    expect(after.closest(".w1")).toBeNull();
  }

  for (const depth of [1, 2, 3]) {
    test(`depth ${depth}: renders, re-entry is not blank, wiring survives`, () => {
      const app = mount(COMPONENT_IN_STATE_CHILD(depth), `cc-${depth}`);
      expectShape();
      expect(cardText()).toBe("n=0");
      document.querySelector("button.bump").click();
      expect(cardText()).toBe("n=1");

      app.set("phase", "Off");
      expect(document.querySelector("p.off")).not.toBeNull();
      expect(document.querySelector(".card")).toBeNull();

      app.set("phase", "On");
      expectShape();
      expect(cardText()).toBe("n=1");
      document.querySelector("button.bump").click();
      expect(cardText()).toBe("n=2");
      expect(app.consoleErrors).toEqual([]);
    });
  }

  test("nested engine: the inner state-child's component renders and survives outer re-entry", () => {
    const app = mount(NESTED_ENGINE, "cc-nested");
    expectShape();
    expect(cardText()).toBe("A");
    app.set("phase", "Off");
    expect(document.querySelector(".card")).toBeNull();
    app.set("phase", "On");
    expectShape();
    expect(cardText()).toBe("A");
    expect(app.consoleErrors).toEqual([]);
  });
});
