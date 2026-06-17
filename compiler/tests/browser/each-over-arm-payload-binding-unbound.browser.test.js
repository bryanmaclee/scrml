/**
 * each-over-arm-payload-binding-unbound.browser.test.js
 *
 * Regression for g-each-over-arm-payload-binding-unbound (HIGH, 2026-06-17).
 *
 * Bug: an `<each>` whose iterable is a match-arm OR engine-arm PAYLOAD BINDING
 * (variant `.Loaded(rows)` → arm body `<each in=rows>`) emitted the binding
 * UNBOUND at mount. The arm RENDER fn receives the binding as a param
 * (`_scrml_match_match_N_render_Loaded(rows)` / `_scrml_engine_<var>_render_Loaded(items)`),
 * but the each per-item MOUNT-SETUP is a TOP-LEVEL no-arg render fn
 * (`_scrml_each_render_N()`) that emitted `const _items = rows;` in a scope
 * WITHOUT the binding → `ReferenceError: rows / items is not defined` at the
 * happy-dom mount (the dispatcher calls `_scrml_each_render_N()` via
 * `_scrml_remount_each` / `_scrml_effect_static`). Compile exited 0 and
 * `node --check` passed — the call site is syntactically valid; the binding was
 * simply out of scope.
 *
 * Root cause + fix (ONE shared mechanism for match + engine): after arm-body
 * flattening the each loses its arm association (match: lifted into
 * `matchBlock.bodyChildren`; engine: lives in the state-child markup children),
 * so the post-flatten `collectEachBlocks` walker cannot see the binding. The fix
 * STAMPS the each-block node with `armPayloadBinding` (cell name + variant tag +
 * runtime field name) at LIFT time — emit-match's `buildMatchArms` /
 * emit-engine's `buildEngineArms`, where the arm payload bindings ARE known.
 * emit-each's `emitEachBodyRenderForFile` reads the stamp and resolves the
 * iterable from the reactive cell instead:
 *   `const _items = (v && v.variant === "Loaded" && v.data) ? v.data["rows"] : [];`
 * — which both establishes the dep edge AND binds to the live arm payload.
 *
 * Models: each-runtime-bug-57.test.js (real compile + read result.runtimeFilename
 * + happy-dom mount via new Function).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import {
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "fs";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Repros — minimal single-file each-over-arm-payload-binding shapes.
// ---------------------------------------------------------------------------

// MATCH arm payload binding: `.Loaded(rows)` → arm body `<each in=rows>`.
const MATCH_SRC = `<program>
type Row:struct = { id: string, name: string }
type Phase:enum = {
  Idle
  Loaded(rows: Row[])
}
<phase>: Phase = .Idle
<match for=Phase on=@phase>
  <Idle>
    <p>idle</p>
  </>
  <Loaded rows>
    <ul>
      <each in=rows key=@.id>
        <li>\${@.name}</li>
        <empty>
          <li>none</li>
        </empty>
      </each>
    </ul>
  </>
</match>
</program>
`;

// ENGINE arm payload binding: `.Loaded(items)` → state-child body `<each in=items>`.
const ENGINE_SRC = `<program>
type Item:struct = { id: string, name: string }
type ItemsPhase:enum = {
  Idle
  Loaded(items: Item[])
}
<engine for=ItemsPhase initial=.Idle>
  <Idle rule=.Loaded>
    <p>idle</p>
  </>
  <Loaded items rule=.Idle>
    <ul>
      <each in=items key=@.id>
        <li>\${@.name}</li>
        <empty>
          <li>none</li>
        </empty>
      </each>
    </ul>
  </>
</>
</program>
`;

const tmpRoot = resolve("/tmp", "scrml-each-arm-payload");

function compileToOutputs(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const htmlPath = resolve(outDir, `${baseName}.html`);
    const clientPath = resolve(outDir, `${baseName}.client.js`);
    const runtimePath = resolve(
      outDir,
      result.runtimeFilename ?? "scrml-runtime.js",
    );
    return {
      errors: result.errors ?? [],
      html: existsSync(htmlPath) ? readFileSync(htmlPath, "utf8") : "",
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
      runtimeJs: existsSync(runtimePath)
        ? readFileSync(runtimePath, "utf8")
        : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §1 — Emit-regression: the each render fn does NOT reference the bare binding.
// ---------------------------------------------------------------------------

describe("each-over-arm-payload §1 — each render fn resolves from the reactive cell, not a bare binding", () => {
  test("match arm: compiles with no errors", () => {
    const { errors } = compileToOutputs(MATCH_SRC, "match-arm");
    expect(errors).toEqual([]);
  });

  test("match arm: each render fn reads the cell payload, not the unbound `rows`", () => {
    const { clientJs } = compileToOutputs(MATCH_SRC, "match-arm");
    // The fix resolves the iterable from the discriminant cell `phase`.
    expect(clientJs).toContain('_scrml_reactive_get("phase")');
    // The dangerous pre-fix shape was a bare `const _items = rows;` at top level.
    expect(clientJs).not.toContain("const _items = rows;");
    // The resolved form gates on the variant tag.
    expect(clientJs).toContain('.variant === "Loaded"');
  });

  test("engine arm: compiles with no errors", () => {
    const { errors } = compileToOutputs(ENGINE_SRC, "engine-arm");
    expect(errors).toEqual([]);
  });

  test("engine arm: each render fn reads the engine var payload, not the unbound `items`", () => {
    const { clientJs } = compileToOutputs(ENGINE_SRC, "engine-arm");
    expect(clientJs).toContain('_scrml_reactive_get("itemsPhase")');
    expect(clientJs).not.toContain("const _items = items;");
    expect(clientJs).toContain('.variant === "Loaded"');
  });
});

// ---------------------------------------------------------------------------
// §2 — happy-dom runtime drive: mount + variant transitions render the items.
// ---------------------------------------------------------------------------

describe("each-over-arm-payload §2 — mounts without throwing + renders the arm-payload items", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });

  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  function mount(source, baseName) {
    const { html, clientJs, runtimeJs } = compileToOutputs(source, baseName);
    document.documentElement.innerHTML = html;
    const exec = new Function(
      "window",
      "document",
      `${runtimeJs}\n${clientJs}\n` +
        `globalThis.__scrml_set__ = _scrml_reactive_set;\n` +
        `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
    );
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    return {
      set: (name, val) => globalThis.__scrml_set__(name, val),
      get: (name) => globalThis.__scrml_get__(name),
    };
  }

  test("match arm: mounting does NOT throw `rows is not defined` (the symptom)", () => {
    expect(() => mount(MATCH_SRC, "match-arm")).not.toThrow();
  });

  test("match arm: transitioning to .Loaded(rows) renders one <li> per row", () => {
    const app = mount(MATCH_SRC, "match-arm");
    // Drive the discriminant cell into the payload-carrying variant.
    app.set("phase", { variant: "Loaded", data: { rows: [
      { id: "a", name: "Ada" },
      { id: "b", name: "Babbage" },
    ] } });
    const rows = document.querySelectorAll("li");
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe("Ada");
    expect(rows[1].textContent).toBe("Babbage");
  });

  test("match arm: an empty payload list renders the `<empty>` body", () => {
    const app = mount(MATCH_SRC, "match-arm");
    app.set("phase", { variant: "Loaded", data: { rows: [] } });
    const mountEl = document.querySelector('[data-scrml-each-mount^="each_"]');
    expect(mountEl).not.toBeNull();
    // The empty body is `<li>none</li>` (one li, the placeholder — NOT a data row).
    const lis = mountEl.querySelectorAll("li");
    expect(lis.length).toBe(1);
    expect(lis[0].textContent).toBe("none");
  });

  test("engine arm: mounting does NOT throw `items is not defined` (the symptom)", () => {
    expect(() => mount(ENGINE_SRC, "engine-arm")).not.toThrow();
  });

  test("engine arm: transitioning to .Loaded(items) renders one <li> per item", () => {
    const app = mount(ENGINE_SRC, "engine-arm");
    // Engine var is driven through the same reactive cell the dispatcher reads.
    app.set("itemsPhase", { variant: "Loaded", data: { items: [
      { id: "x", name: "Xavier" },
      { id: "y", name: "Yelena" },
      { id: "z", name: "Zane" },
    ] } });
    const rows = document.querySelectorAll("li");
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toBe("Xavier");
    expect(rows[2].textContent).toBe("Zane");
  });

  test("engine arm: an empty payload list renders the `<empty>` body", () => {
    const app = mount(ENGINE_SRC, "engine-arm");
    app.set("itemsPhase", { variant: "Loaded", data: { items: [] } });
    const mountEl = document.querySelector('[data-scrml-each-mount^="each_"]');
    expect(mountEl).not.toBeNull();
    const lis = mountEl.querySelectorAll("li");
    expect(lis.length).toBe(1);
    expect(lis[0].textContent).toBe("none");
  });
});
