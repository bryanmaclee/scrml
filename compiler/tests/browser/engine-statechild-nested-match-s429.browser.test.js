/**
 * engine-statechild-nested-match-s429.browser.test.js
 *
 * S429 — a block `<match>` inside an `<engine>` state-child body (SPEC §51.0.B:
 * a state-child body is "rendered when the engine is in this variant … nested
 * `<tag>` is markup-as-value"; §4.18 body modes nest).
 *
 * Three defects, each driven here in happy-dom:
 *   1. PARSE — `</>`-closed arms made the state-child un-findable (false
 *      E-ENGINE-STATE-CHILD-MISSING). Fixed in engine-statechild-parser.ts.
 *   2. RE-ENTRY — the engine writes the state-child with innerHTML, so every
 *      entry creates a FRESH, EMPTY match mount, and the match only dispatched
 *      when its scrutinee changed: leave the state-child and come back and the
 *      match rendered NOTHING (reproducible on main with named `</X>` arm
 *      closers, which parsed). Fixed: the engine arm's post-mount re-dispatches
 *      each such match (emit-engine.ts collectEngineArmMatchRedispatches +
 *      emit-match.ts engineArmMatchRedispatchJs).
 *   3. PAYLOAD — a nested match's arm fns and dispatcher live at FILE scope, so
 *      `${x}` in an arm, or `on=x`, where `x` is the `<On(x)>` payload binding,
 *      threw `ReferenceError: x is not defined`. Fixed: the payload is read from
 *      the engine cell (emit-match.ts EngineArmPayloadStamp).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-s429-engine-nested-match");

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

// Unit-variant engine; the match reads a separate cell.
const MATCH_IN_ARM = (wrapOpen = "", wrapClose = "") => `<program>
type Phase:enum = { Off, On }
type Kind:enum = { X, Y }
<k>: Kind = .X
<count> = 0
function bump() { @count = @count + 1 }
<engine for=Phase initial=.On>
  <Off rule=.On>
    <p class="off">off</p>
  </>
  <On rule=.Off>
    ${wrapOpen}
    <match for=Kind on=@k>
      <X><button class="bx" onclick=bump()>X \${@count}</button></>
      <Y><p class="y">Y</p></>
    </match>
    ${wrapClose}
  </>
</>
</program>
`;

// Payload engine; the nested match's ARM reads the payload binding.
const PAYLOAD_READ = `<program>
type Phase:enum = { Off, On(n: number) }
type Kind:enum = { X, Y }
<k>: Kind = .X
<engine for=Phase initial=.Off>
  <Off rule=.On>
    <p class="off">off</p>
  </>
  <On(n) rule=.Off>
    <match for=Kind on=@k>
      <X><p class="x">X \${n}</p></>
      <Y><p class="y">Y</p></>
    </match>
  </>
</>
</program>
`;

// Payload engine; the nested match's SCRUTINEE is the payload binding.
const PAYLOAD_SCRUTINEE = `<program>
type Kind:enum = { X, Y }
type Phase:enum = { Off, On(kind: Kind) }
<engine for=Phase initial=.Off>
  <Off rule=.On>
    <p class="off">off</p>
  </>
  <On(kind) rule=.Off>
    <match for=Kind on=kind>
      <X><p class="x">X</p></>
      <Y><p class="y">Y</p></>
    </match>
  </>
</>
</program>
`;

describe("S429 — block <match> inside an engine state-child", () => {
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
        `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
          `globalThis.__s429_set__ = _scrml_reactive_set;\nglobalThis.__s429_get__ = _scrml_reactive_get;\n`),
      )(window, document);
      document.dispatchEvent(new Event("DOMContentLoaded"));
    } finally {
      console.error = origErr;
    }
    return {
      set: (name, val) => {
        const prev = console.error;
        console.error = (...a) => { consoleErrors.push(a.map(String).join(" ")); };
        try { globalThis.__s429_set__(name, val); } finally { console.error = prev; }
      },
      consoleErrors,
    };
  }

  const armText = () => {
    const m = document.querySelector("[data-scrml-match-mount]");
    return m ? m.textContent.replace(/\s+/g, " ").trim() : null;
  };

  for (const [label, open, close] of [["bare", "", ""], ["div-wrapped", `<div class="w">`, `</div>`]]) {
    test(`${label}: renders the current arm and dispatches on @k while in On`, () => {
      const app = mount(MATCH_IN_ARM(open, close), `m-${label}`);
      expect(armText()).toBe("X 0");
      app.set("k", "Y");
      expect(armText()).toBe("Y");
      app.set("k", "X");
      expect(armText()).toBe("X 0");
      expect(app.consoleErrors).toEqual([]);
    });

    test(`${label}: re-entering On re-dispatches the match (incl. @k changed while Off)`, () => {
      const app = mount(MATCH_IN_ARM(open, close), `r-${label}`);
      app.set("k", "Y");
      app.set("phase", "Off");
      expect(document.querySelector("p.off")).not.toBeNull();
      expect(armText()).toBeNull();
      app.set("k", "X"); // changed while the match mount is absent
      app.set("phase", "On");
      expect(armText()).toBe("X 0");
      // Re-entry with NO scrutinee change in between.
      app.set("phase", "Off");
      app.set("phase", "On");
      expect(armText()).toBe("X 0");
      app.set("k", "Y");
      expect(armText()).toBe("Y");
      expect(app.consoleErrors).toEqual([]);
    });

    test(`${label}: arm event wiring survives re-entry`, () => {
      const app = mount(MATCH_IN_ARM(open, close), `e-${label}`);
      document.querySelector("button.bx").click();
      expect(armText()).toBe("X 1");
      app.set("phase", "Off");
      app.set("phase", "On");
      expect(armText()).toBe("X 1");
      document.querySelector("button.bx").click();
      expect(armText()).toBe("X 2");
      expect(app.consoleErrors).toEqual([]);
    });
  }

  test("payload: a nested arm reading the <On(n)> binding renders the live payload", () => {
    const app = mount(PAYLOAD_READ, "payload-read");
    app.set("phase", { variant: "On", data: { n: 5 } });
    expect(armText()).toBe("X 5");
    app.set("k", "Y");
    expect(armText()).toBe("Y");
    app.set("k", "X");
    expect(armText()).toBe("X 5");
    app.set("phase", "Off");
    app.set("phase", { variant: "On", data: { n: 7 } });
    expect(armText()).toBe("X 7");
    expect(app.consoleErrors).toEqual([]);
  });

  test("payload: a nested match whose on= IS the <On(kind)> binding", () => {
    const app = mount(PAYLOAD_SCRUTINEE, "payload-scrutinee");
    expect(armText()).toBeNull();
    app.set("phase", { variant: "On", data: { kind: "Y" } });
    expect(armText()).toBe("Y");
    app.set("phase", "Off");
    app.set("phase", { variant: "On", data: { kind: "X" } });
    expect(armText()).toBe("X");
    // Same variant, new payload — the match follows it.
    app.set("phase", { variant: "On", data: { kind: "Y" } });
    expect(armText()).toBe("Y");
    expect(app.consoleErrors).toEqual([]);
  });
});
