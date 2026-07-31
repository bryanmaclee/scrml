/**
 * §17.1.2 — `if=` on `<engine>` / `<match>` / `<each>`, asserted by EXECUTION.
 *
 * WHY THE DOM, NEVER THE BYTES. The gated content legitimately REMAINS in the
 * emitted HTML — that is the whole point of the §17.1 lowering: it sits inside an
 * inert `<template>`. So a byte-grep for `id="arm-off"` cannot distinguish the fix
 * from the bug; both find it. The only honest assertion is
 * `document.querySelector(…) === null` plus a `scrml-if-marker` count, which is
 * what every test below does.
 *
 * THE PRE-FIX STATE these pin against (measured in real Chrome on the base
 * compiler, 19 of 47 checks failing): `if=` generated ZERO code on all three, so
 * the `<engine>`'s `initial=` arm rendered at boot with the predicate false and
 * stayed in the DOM permanently, JS on and off.
 *
 * ⚠ TABLE CONTEXT IS DELIBERATELY ABSENT FROM THIS FILE. happy-dom mis-parses a
 * `<template>` inside `<tbody>` — it foster-parents the `<tr>` out of its own
 * template content and then reports a phantom leak. The `<each if=…>`-inside-
 * `<tbody>` shape is therefore verified in REAL headless Chrome only (harness:
 * the §17.1.2 dispatch's `chrome-verify.mjs`, 47/47 including that shape). Do not
 * "restore coverage" by adding a table case here; it will fail for a reason that
 * has nothing to do with scrml.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-if-structural");

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
    const files = existsSync(outDir) ? readdirSync(outDir) : [];
    const runtimeName = files.find((f) => f.startsWith("scrml-runtime.")) ?? "";
    return {
      errors: (result.errors ?? []).map((e) => `${e.code}: ${e.message}`),
      html: read(resolve(outDir, `${baseName}.html`)),
      clientJs: read(resolve(outDir, `${baseName}.client.js`)),
      runtimeJs: runtimeName ? read(resolve(outDir, runtimeName)) : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function boot(source, baseName) {
  const { html, clientJs, runtimeJs, errors } = compileToOutputs(source, baseName);
  expect(errors).toEqual([]);
  document.documentElement.innerHTML = html;
  const exec = new Function(
    "window",
    "document",
    `${runtimeJs}\n` + captureInsideChunkScope(clientJs,
      `globalThis.__set__ = _scrml_reactive_set;\nglobalThis.__get__ = _scrml_reactive_get;\n`),
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded"));
  return {
    set: (n, v) => globalThis.__set__(n, v),
    get: (n) => globalThis.__get__(n),
    click: (sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element for ${sel}`);
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    },
    count: (sel) => document.querySelectorAll(sel).length,
    // Comment-node census — the fences and markers are invisible to querySelector.
    comments: (needle) => {
      let n = 0;
      const w = document.createTreeWalker(document.body, 128 /* SHOW_COMMENT */);
      let c;
      while ((c = w.nextNode())) if (String(c.nodeValue || "").trim().includes(needle)) n++;
      return n;
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENGINE_SRC = `\${
    type Mode:enum = { Off, On }
    <shown> = false
    <ticks> = 0
    function toOn() { @mode = .On }
}
<engine for=Mode initial=.Off if=@shown>
    <Off rule=.On>
        <onTransition to=.On>\${ @ticks = @ticks + 1 }</>
        <p id="arm-off">OFF</>
    </>
    <On rule=.Off>
        <p id="arm-on">ON</>
    </>
</>
<program>
<button id="to-on" onclick=toOn()>on</>
<p id="cell">\${@mode}</>
<p id="ticks">\${@ticks}</>
</program>
`;

const MATCH_SRC = `\${
    type Phase:enum = { Loading, Ready }
    <phase>: Phase = .Loading
    <shown> = false
    function ready() { @phase = Phase.Ready }
}
<button id="ready" onclick=ready()>ready</>
<match for=Phase on=@phase if=@shown>
    <Loading>
        <p id="arm-loading">loading</p>
    </>
    <Ready>
        <p id="arm-ready">ready</p>
    </>
</match>
`;

const EACH_SRC = `\${
    <items> = [{ id: 1, label: "one" }, { id: 2, label: "two" }]
    <shown> = false
}
<ul id="list">
    <each in=@items key=@.id as item if=@shown>
        <li class="row">\${item.label}</li>
        <empty>
            <li id="none">none</li>
        </empty>
    </each>
</ul>
`;

describe("§17.1.2 — `if=` on <engine>/<match>/<each> gates RENDERED OUTPUT", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  // -------------------------------------------------------------- <engine>
  describe("<engine if=@shown>", () => {
    test("false at boot: NOTHING renders — not the initial= arm, not the mount slot", () => {
      const app = boot(ENGINE_SRC, "eng");
      // The pre-fix state: `#arm-off` present and permanent.
      expect(app.count("#arm-off")).toBe(0);
      expect(app.count("#arm-on")).toBe(0);
      expect(app.count("[data-scrml-engine-mount]")).toBe(0);
      // …and it is the §17.1 lowering doing it, not a coincidence.
      expect(app.comments("scrml-if-marker:")).toBe(1);
    });

    test("false: the auto-declared engine cell is still declared and readable (§51.0.C)", () => {
      // §17.1.2.1 — `if=` gates RENDERED OUTPUT, not the declaration. A cross-file
      // `<EngineName/>` mount reads this cell unconditionally (§51.0.D), so tying
      // the declaration to a render predicate would break the §51.0.A singleton.
      const app = boot(ENGINE_SRC, "eng");
      expect(document.querySelector("#cell").textContent.trim()).toBe("Off");
    });

    test("false: a transition STILL occurs and <onTransition> STILL fires", () => {
      // The load-bearing half of §17.1.2.1, and the half an implementation is most
      // tempted to get wrong: gating the engine's lifecycle instead of its render
      // would make `if=` a state-destroying operator.
      const app = boot(ENGINE_SRC, "eng");
      app.click("#to-on");
      expect(document.querySelector("#cell").textContent.trim()).toBe("On");
      expect(document.querySelector("#ticks").textContent.trim()).toBe("1");
      // Still nothing rendered.
      expect(app.count("#arm-off, #arm-on")).toBe(0);
    });

    test("false -> true renders the CURRENT variant, not `initial=`", () => {
      // Direct consequence of render-gating: the engine kept transitioning while
      // hidden, so revealing it must show where it IS (.On), never re-seed .Off.
      const app = boot(ENGINE_SRC, "eng");
      app.click("#to-on");
      app.set("shown", true);
      expect(app.count("#arm-on")).toBe(1);
      expect(app.count("#arm-off")).toBe(0);
    });

    test("true -> false REMOVES from the DOM (§17.1), it does not hide", () => {
      const app = boot(ENGINE_SRC, "eng");
      app.set("shown", true);
      expect(app.count("[data-scrml-engine-mount]")).toBe(1);
      app.set("shown", false);
      expect(app.count("[data-scrml-engine-mount]")).toBe(0);
      expect(app.count("#arm-off, #arm-on")).toBe(0);
      // §17.2 draws the contrast — `show=` hides, `if=` removes. Nothing is
      // display-toggled here; the node is gone.
      expect(document.body.innerHTML).not.toContain("display: none");
    });

    test("four open/close cycles leave exactly one mount, not N", () => {
      const app = boot(ENGINE_SRC, "eng");
      for (let i = 0; i < 4; i++) { app.set("shown", true); app.set("shown", false); }
      app.set("shown", true);
      expect(app.count("[data-scrml-engine-mount]")).toBe(1);
      expect(app.count("#arm-off, #arm-on")).toBe(1);
    });

    test("the boot-only opener `effect=` fires ONCE at module-init and is not re-fired on mount", () => {
      // §17.1.2.1, third bullet, verbatim: the §51.0.H Form 3 opener effect
      // "fires ONCE at module-init as always, and is NOT re-fired when `expr`
      // transitions false->true". Both halves matter: firing it 0 times at boot
      // would mean the gate reached the engine's lifecycle; firing it again on
      // mount would make `if=` a construction trigger.
      const app = boot(`\${
    type Mode:enum = { A, B }
    <gate> = false
    <boots> = 0
}
<engine for=Mode initial=.A if=@gate effect=\${ @boots = @boots + 1 }>
    <A rule=.B><p id="arm-a">a</p></>
    <B rule=.A><p id="arm-b">b</p></>
</>
<program>
<p id="boots">\${@boots}</>
</program>
`, "oe");
      // Fired at module-init even though the gate is false — and nothing rendered.
      expect(document.querySelector("#boots").textContent.trim()).toBe("1");
      expect(app.count("#arm-a, #arm-b")).toBe(0);
      app.set("gate", true);
      expect(app.count("#arm-a")).toBe(1);
      expect(document.querySelector("#boots").textContent.trim()).toBe("1");
      app.set("gate", false);
      app.set("gate", true);
      expect(document.querySelector("#boots").textContent.trim()).toBe("1");
    });
  });

  // --------------------------------------------------------------- <match>
  describe("<match if=@shown>", () => {
    test("false at boot: no arm is dispatched and no mount slot exists", () => {
      const app = boot(MATCH_SRC, "mat");
      expect(app.count("#arm-loading, #arm-ready")).toBe(0);
      expect(app.count("[data-scrml-match-mount]")).toBe(0);
      expect(app.comments("scrml-if-marker:")).toBe(1);
    });

    test("false: the subject cell still changes, and still dispatches nothing", () => {
      const app = boot(MATCH_SRC, "mat");
      app.click("#ready");
      expect(app.count("#arm-loading, #arm-ready")).toBe(0);
    });

    test("false -> true dispatches the CURRENT arm", () => {
      const app = boot(MATCH_SRC, "mat");
      app.click("#ready");
      app.set("shown", true);
      expect(app.count("#arm-ready")).toBe(1);
      expect(app.count("#arm-loading")).toBe(0);
    });

    test("true -> false removes the arm AND the mount slot", () => {
      const app = boot(MATCH_SRC, "mat");
      app.set("shown", true);
      expect(app.count("[data-scrml-match-mount]")).toBe(1);
      app.set("shown", false);
      expect(app.count("[data-scrml-match-mount]")).toBe(0);
      expect(app.count("#arm-loading, #arm-ready")).toBe(0);
    });

    test("four open/close cycles leave exactly one mount slot", () => {
      const app = boot(MATCH_SRC, "mat");
      for (let i = 0; i < 4; i++) { app.set("shown", true); app.set("shown", false); }
      app.set("shown", true);
      expect(app.count("[data-scrml-match-mount]")).toBe(1);
    });
  });

  // ---------------------------------------------------------------- <each>
  describe("<each if=@shown> (inside a <ul> — see the file header re table context)", () => {
    test("false at boot: no rows, no <empty> fallback, and no fence in the document", () => {
      // §17.1.2's table says `if=` on `<each>` gates "the whole iterated list,
      // INCLUDING <empty>" — so an empty collection must not surface its fallback
      // while the gate is false either (asserted separately below).
      const app = boot(EACH_SRC, "eac");
      expect(app.count("#list li.row")).toBe(0);
      expect(app.count("#none")).toBe(0);
      // The fence is a COMMENT PAIR, invisible to querySelector — this is the one
      // host with no element to wrap, and the reason the mount primitive tracks a
      // node RANGE.
      expect(app.comments("scrml-each:")).toBe(0);
      expect(app.comments("scrml-if-marker:")).toBe(1);
    });

    test("false -> true renders the rows", () => {
      const app = boot(EACH_SRC, "eac");
      app.set("shown", true);
      expect(app.count("#list li.row")).toBe(2);
      // start fence + end fence
      expect(app.comments("scrml-each:")).toBe(2);
    });

    test("true -> false removes the ROWS as well as the fences", () => {
      // The defect real Chrome caught: removing only the recorded mount nodes left
      // every row attached, because the renderer inserts rows BETWEEN the fences
      // AFTER the mount. Unmount removes the live span, not the recorded list.
      const app = boot(EACH_SRC, "eac");
      app.set("shown", true);
      expect(app.count("#list li.row")).toBe(2);
      app.set("shown", false);
      expect(app.count("#list li.row")).toBe(0);
      expect(app.comments("scrml-each:")).toBe(0);
    });

    test("four open/close cycles leave exactly 2 rows and exactly 2 fences", () => {
      // Pre-fix this accumulated 12 rows across 4 cycles.
      const app = boot(EACH_SRC, "eac");
      for (let i = 0; i < 4; i++) { app.set("shown", true); app.set("shown", false); }
      app.set("shown", true);
      expect(app.count("#list li.row")).toBe(2);
      expect(app.comments("scrml-each:")).toBe(2);
    });

    test("the <empty> fallback renders when visible+empty and is gated away when hidden", () => {
      const app = boot(EACH_SRC, "eac");
      app.set("shown", true);
      app.set("items", []);
      expect(app.count("#none")).toBe(1);
      app.set("shown", false);
      expect(app.count("#none")).toBe(0);
      expect(app.count("#list li")).toBe(0);
    });

    test("a mutation while gated off renders nothing, and the reopened list is CURRENT", () => {
      const app = boot(EACH_SRC, "eac");
      app.set("shown", false);
      app.set("items", [{ id: 9, label: "nine" }, { id: 10, label: "ten" }, { id: 11, label: "eleven" }]);
      expect(app.count("#list li.row")).toBe(0);
      app.set("shown", true);
      expect(app.count("#list li.row")).toBe(3);
      expect(document.querySelector("#list li.row").textContent.trim()).toBe("nine");
    });
  });

  // ------------------------------------------------------- control (no if=)
  describe("control — the same three elements WITHOUT `if=` are unaffected", () => {
    test("an ungated <engine>/<match>/<each> renders at boot exactly as before", () => {
      const app = boot(`\${
    <items> = [{ id: 1, label: "one" }, { id: 2, label: "two" }]
}
<ul id="list">
    <each in=@items key=@.id as item>
        <li class="row">\${item.label}</li>
    </each>
</ul>
`, "ctl");
      expect(app.count("#list li.row")).toBe(2);
      expect(app.comments("scrml-if-marker:")).toBe(0);
    });
  });
});
