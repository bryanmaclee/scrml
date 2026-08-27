/**
 * g-match-per-item-in-each-reconcile.browser.test.js — S380 dog-food (silent,
 * compile-clean, browser-only) happy-dom acceptance regression.
 *
 * Bug: a per-item `<match on=item.field>` (or `on=@.field`) inside `<each>` stayed
 * FROZEN at its create-time arm when the item's discriminant field changed on a
 * same-key reconcile — while the sibling `${item.field}` interpolation in the same
 * row updated correctly. Compiles exit 0, zero diagnostics, wrong DOM.
 *
 * Root: emit-each.ts emitted the per-item match dispatch as a BARE create-time call
 * (`dispatch(mount, item.field)`), not inside the item-resolve effect the
 * interpolations use. A keyed reconcile REUSES the item node without re-running the
 * factory, so the create-time call never saw the new value. Fix: wrap the dispatch
 * in the same `_scrml_mount_track(_scrml_effect(() => { let it =
 * _scrml_resolve_item(...); dispatch(mount, it.field); }))` — reading the
 * discriminant off the freshly-resolved item tracks it, so the effect re-dispatches.
 *
 * Per R26 (S138): compile exits 0 and the OUTPUT was wrong — execution is the gate.
 * Mounts the SHIPPED pruned runtime.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

const tmpRoot = resolve("/tmp", "scrml-match-per-item-reconcile");

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});
afterEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function mount(source) {
  const tmpDir = resolve(tmpRoot, `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
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
      badges: () => [...document.querySelectorAll("[data-badge]")].map((e) => e.textContent.trim()),
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const HEAD = `type St:enum = .Todo | .Done
  type Task:struct = { id: number, st: St }
  <tasks>: Task[] = [ { id: 1, st: .Todo }, { id: 2, st: .Done } ]
  function flip(id: number) { @tasks = @tasks.map(t => t.id == id ? { ...t, st: t.st == St.Todo ? St.Done : St.Todo } : t) }`;

describe("g-match-per-item-in-each-reconcile (S380 dog-food)", () => {
  test("a KEYED (as-alias) per-item <match on=item.field> re-dispatches on a same-key field change", () => {
    const app = mount(`<program>
  ${HEAD}
  <ul><each in=@tasks key=@.id as t><li>
    <match for=St on=t.st><Todo><span data-badge>TODO</span></Todo><Done><span data-badge>DONE</span></Done></match>
    <button data-flip=t.id onclick=flip(t.id)>f</button>
  </li></each></ul>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.badges()).toEqual(["TODO", "DONE"]);
    app.click('[data-flip="1"]');
    expect(app.badges()).toEqual(["DONE", "DONE"]); // row 1 was frozen at TODO
  });

  test("an UNKEYED per-item <match on=@.field> re-dispatches on a field change too (class)", () => {
    const app = mount(`<program>
  ${HEAD}
  <ul><each in=@tasks as t><li>
    <match for=St on=@.st><Todo><span data-badge>TODO</span></Todo><Done><span data-badge>DONE</span></Done></match>
    <button data-flip=t.id onclick=flip(t.id)>f</button>
  </li></each></ul>
</program>
`);
    expect(app.errs).toEqual([]);
    expect(app.badges()).toEqual(["TODO", "DONE"]);
    app.click('[data-flip="1"]');
    expect(app.badges()).toEqual(["DONE", "DONE"]);
  });
});
