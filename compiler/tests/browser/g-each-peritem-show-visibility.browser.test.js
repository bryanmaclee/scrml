/**
 * g-each-peritem-show-emits-literal-attribute (S375, dog-food find)
 *
 * A per-row `show=<cond>` on an element INSIDE an `<each>` used to fall through
 * to the generic value-attribute path in emit-each.ts and emit
 * `setAttribute("show", String(cond))` — a no-op HTML attribute. So the element
 * rendered UNCONDITIONALLY: `<span show=t.done>DONE</span>` showed the badge on
 * EVERY row regardless of `t.done`. Silent (exit 0, no diagnostic).
 *
 * Fix (S375): emit-each.ts special-cases `show=` like the sibling `class:` arm —
 * a per-item reactive `elVar.style.display = cond ? "" : "none"`, mirroring the
 * top-level `show=` display wiring. REACTIVE (unlike a nested per-row `if=`,
 * which is create-time-frozen): `show=` only toggles CSS display, so it has none
 * of the `_scrml_group`-staleness barrier that forces `if=` to freeze.
 *
 * BITING: pre-fix every badge's `style.display` is "" (all visible); the emitted
 * client carries `setAttribute("show"` and NO per-item `style.display`.
 *
 * Executes the SHIPPED pruned runtime (result.runtimeFilename), not the full
 * SCRML_RUNTIME — the render bug lives in the emitted client + the shipped chunk.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();
const TMP_ROOT = resolve("/tmp", "scrml-each-peritem-show");

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

const SRC = [
  "<program>",
  "${",
  '  <tasks> = [ { id: 1, title: "A", done: false }, { id: 2, title: "B", done: true }, { id: 3, title: "C", done: false } ]',
  "}",
  '  <p id="ctl">ok</p>',
  "  <ul>",
  "    <each in=@tasks key=@.id as t>",
  '      <li class="row"><span class="badge" show=t.done>DONE</span></li>',
  "    </each>",
  "  </ul>",
  "</program>",
  "",
].join("\n");

function compileSrc() {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const outDir = resolve(TMP_ROOT, `case-${uniq}`, "out");
  mkdirSync(outDir, { recursive: true });
  const input = resolve(TMP_ROOT, `case-${uniq}`, "app.scrml");
  writeFileSync(input, SRC);
  const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
  const rd = (f) => (existsSync(resolve(outDir, f)) ? readFileSync(resolve(outDir, f), "utf8") : "");
  return {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    clientJs: rd("app.client.js"),
    runtimeJs: rd(result.runtimeFilename ?? "scrml-runtime.js"),
    html: rd("app.html"),
  };
}
const bodyOf = (html) => (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1];

function mount() {
  const c = compileSrc();
  expect(c.errors).toEqual([]);
  document.body.innerHTML = bodyOf(c.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  new Function("window", "document",
    `${c.runtimeJs}\n` + captureInsideChunkScope(c.clientJs,
      "globalThis.__g=_scrml_reactive_get;globalThis.__s=_scrml_reactive_set;"),
  )(globalThis.window, globalThis.document);
  document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
  return {
    clientJs: c.clientJs,
    badges: () => [...document.querySelectorAll("span.badge")],
    disp: () => [...document.querySelectorAll("span.badge")].map((b) => b.style.display),
    set: (k, v) => globalThis.__s(k, v),
  };
}

describe("g-each-peritem-show-emits-literal-attribute (§17.2 inside <each>)", () => {
  test("emitted client toggles style.display, not a literal show attribute", () => {
    const { clientJs } = mount();
    // BITING (emit): pre-fix the badge carried setAttribute("show", …) and no display toggle.
    expect(clientJs).not.toMatch(/setAttribute\(\s*["']show["']/);
    expect(clientJs).toMatch(/\.style\.display\s*=\s*\([\s\S]*?\)\s*\?\s*""\s*:\s*"none"/);
  });

  test("initial render: badge hidden on done=false rows, visible on the done=true row", () => {
    const m = mount();
    expect(m.badges().length).toBe(3);
    // BITING: pre-fix all three were "" (visible).
    expect(m.disp()).toEqual(["none", "", "none"]);
  });

  test("reactive: flipping a task's done flag flips its badge visibility", () => {
    const m = mount();
    expect(m.disp()).toEqual(["none", "", "none"]);
    // Make task 1 done and task 2 not-done.
    m.set("tasks", [
      { id: 1, title: "A", done: true },
      { id: 2, title: "B", done: false },
      { id: 3, title: "C", done: false },
    ]);
    expect(m.disp()).toEqual(["", "none", "none"]);
  });
});
