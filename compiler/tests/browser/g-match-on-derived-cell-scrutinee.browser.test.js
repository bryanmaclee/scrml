/**
 * g-match-on-derived-cell-scrutinee.browser.test.js — S380 dog-food (silent,
 * compile-clean, browser-only) happy-dom acceptance regression.
 *
 * Bug: a `<match on=@cell>` whose scrutinee is a DERIVED cell (`const <lvl> = …`)
 * stayed frozen at its INITIAL arm when the derived cell recomputed — while a
 * sibling `${@lvl}` interpolation and an `if=@derived` on the same page updated
 * correctly. Compiles exit 0, zero diagnostics, wrong DOM.
 *
 * Root: emit-match.ts `resolveOnExpr`'s bare-`@ident` branch routed EVERY cell to
 * Shape A (`_scrml_reactive_subscribe` / `_scrml_reactive_get`), which never fires
 * on a derived cell's recompute (that flows through the derived mechanism). Fix:
 * a derived scrutinee routes through Shape B (effect + `_scrml_derived_get`), which
 * auto-tracks the derived cell exactly as the interpolation's `_scrml_effect` does.
 * A PLAIN cell keeps Shape A.
 *
 * Per R26 (S138): compile exits 0 and the OUTPUT was wrong, so execution — not an
 * emit-string assertion — is the gate. Mounts the SHIPPED pruned runtime.
 * Model: g-match-on-subfield-dispatch.browser.test.js.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-match-derived-scrutinee");

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function mount(source) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(tmpDir, "app.scrml");
  writeFileSync(input, source);
  try {
    const r = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
    const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
    const html = rd("app.html");
    const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
    document.body.innerHTML = body;
    new Function("window", "document",
      `${rd(r.runtimeFilename ?? "scrml-runtime.js")}\n` + captureInsideChunkScope(rd("app.client.js"), ""),
    )(globalThis.window, globalThis.document);
    document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    return {
      errs,
      click: (sel) => document.querySelector(sel)?.dispatchEvent(new window.Event("click", { bubbles: true })),
      text: (sel) => document.querySelector(sel)?.textContent?.trim(),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("g-match-on-derived-cell-scrutinee (S380 dog-food)", () => {
  test("a <match> on a DERIVED cell re-dispatches when the derived cell recomputes", () => {
    const app = mount(`<program>
  type Lvl:enum = .Low | .High
  <count> = 0
  const <lvl>: Lvl = @count >= 3 ? Lvl.High : Lvl.Low
  function inc() { @count = @count + 1 }
  <div>
    <button id="i" onclick=inc()>+</button>
    <span data-interp>\${@lvl}</span>
    <match for=Lvl on=@lvl>
      <Low><span data-arm>LOW</span></Low>
      <High><span data-arm>HIGH</span></High>
    </match>
  </div>
</program>
`);
    expect(app.errs).toEqual([]);
    // Initial arm.
    expect(app.text("[data-arm]")).toBe("LOW");
    // Three increments push the derived cell to High.
    app.click("#i"); app.click("#i"); app.click("#i");
    // The interpolation AND the match arm both reflect the recomputed derived value.
    expect(app.text("[data-interp]")).toBe("High");
    expect(app.text("[data-arm]")).toBe("HIGH");
  });

  test("the INTERPOLATED derived form `on=${@derived}` also re-dispatches (whole bug class)", () => {
    // The `${@lvl}` form reaches resolveOnExpr's member-access branch, not the
    // bare cellRefMatch — it must get the same derived effect wiring, or the class
    // is only half-closed (S239 finding on the first cut).
    const app = mount(`<program>
  type Lvl:enum = .Low | .High
  <count> = 0
  const <lvl>: Lvl = @count >= 3 ? Lvl.High : Lvl.Low
  function inc() { @count = @count + 1 }
  <div>
    <button id="i" onclick=inc()>+</button>
    <match for=Lvl on=\${@lvl}>
      <Low><span data-arm>LOW</span></Low>
      <High><span data-arm>HIGH</span></High>
    </match>
  </div>
</program>
`);
    expect(app.errs).toEqual([]);
    app.click("#i"); app.click("#i"); app.click("#i");
    expect(app.text("[data-arm]")).toBe("HIGH");
  });

  test("an arm-payload <each> on a DERIVED-cell match still binds (no _armCellName regression)", () => {
    // Routing a derived scrutinee must KEEP variantSubscribeName (the _armCellName
    // that stamps arm-payload eaches); an early cut set it null and this each threw
    // `items is not defined` (S239 finding).
    const app = mount(`<program>
  type R:enum = { Loading, Ready(items: string[]) }
  <ok> = true
  <rows>: string[] = ["a", "b", "c"]
  const <st>: R = @ok ? R.Ready(@rows) : R.Loading
  <match for=R on=@st>
    <Loading><span>L</span></Loading>
    <Ready(items)><ul><each in=items as x><li data-x>\${x}</li></each></ul></Ready>
  </match>
</program>
`);
    expect(app.errs).toEqual([]);
    expect([...document.querySelectorAll("[data-x]")].map((e) => e.textContent.trim())).toEqual(["a", "b", "c"]);
  });

  test("a <match> on a PLAIN cell still re-dispatches (Shape A unregressed)", () => {
    const app = mount(`<program>
  type Lvl:enum = .Low | .High
  <lvl>: Lvl = .Low
  function bump() { @lvl = Lvl.High }
  <div>
    <button id="i" onclick=bump()>+</button>
    <match for=Lvl on=@lvl>
      <Low><span data-arm>LOW</span></Low>
      <High><span data-arm>HIGH</span></High>
    </match>
  </div>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.text("[data-arm]")).toBe("LOW");
    app.click("#i");
    expect(app.text("[data-arm]")).toBe("HIGH");
  });
});
