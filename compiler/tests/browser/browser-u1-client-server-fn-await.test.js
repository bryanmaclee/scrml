/**
 * U1 (dpa-020) — CLIENT server-fn call-site auto-await, RUNTIME drive (happy-dom).
 *
 * §13.2 is POSITION-INVARIANT: `await` belongs at EVERY server-call site. Before
 * U1, `emitCall` had no `mode === "client"` branch reading `ctx.serverFnNames`, so
 * the `await` was retrofitted downstream by post-hoc injectors that only ever
 * reached STATEMENT position. Three positions were therefore emitted BARE, each
 * silently binding a pending Promise:
 *
 *   (a) receiver-tail       `@count = loadRows().length`   → `.length` off a Promise
 *   (b) nested argument     `@count = pick(loadRows())`    → a Promise into a client fn
 *   (c) return-typed `function` body — routes through `emitFnShortcutBody`, which
 *       BYPASSES `scheduleStatements` entirely, so the statement-level injector
 *       never saw it at all.
 *
 * Every one is SILENT: exit 0, no diagnostic, a field read off the Promise yields
 * `undefined`.
 *
 * These tests EXECUTE the emitted bundle rather than grepping it. That is
 * deliberate and load-bearing: the standing lesson on this exact surface is
 * "emitted ≠ runs" (S265, S268, ESM-U3, GH #357 all passed `node --check` while
 * being broken at runtime). A `grep` for the string `await` proves nothing about
 * whether the resolved VALUE reaches the cell — which is the property §13.2 is
 * actually about. Each assertion below reads a reactive cell AFTER the server
 * round-trip settles; pre-U1 every one of them reads `undefined`.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { captureInsideChunkScope } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

beforeEach(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  await GlobalRegistrator.register();
});

afterEach(() => {
  delete globalThis.fetch;
});

/** Rows the stubbed server route returns for every RPC in this file. */
const ROWS = [{ id: 1, name: "ada" }, { id: 2, name: "grace" }, { id: 3, name: "edsger" }];

/**
 * Compile `src`, stub `fetch` so the emitted `_scrml_fetch_*` stub resolves to
 * ROWS, mount runtime + client.js in happy-dom, and dispatch DOMContentLoaded.
 * Returns a reactive-cell reader plus a click driver.
 */
function mount(src) {
  const TMP = mkdtempSync(join(tmpdir(), "u1-client-await-"));
  const abs = join(TMP, "u1.scrml");
  writeFileSync(abs, src);
  const result = compileScrml({ inputFiles: [abs], outputDir: join(TMP, "dist"), write: false, log: () => {} });
  const realErrors = (result.errors || []).filter((e) => e && e.severity !== "warning");
  expect(realErrors).toEqual([]);

  const out = [...(result.outputs || new Map()).entries()][0]?.[1];
  const html = out?.html ?? "";
  const clientJs = out?.clientJs ?? "";
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });

  // The server round-trip, stubbed. Resolves on a later microtask tick so an
  // un-awaited call CANNOT accidentally look correct via synchronous luck.
  globalThis.fetch = () =>
    Promise.resolve().then(() => Promise.resolve().then(() => ({
      ok: true,
      status: 200,
      json: () => Promise.resolve(ROWS),
      text: () => Promise.resolve(JSON.stringify(ROWS)),
      headers: { get: () => "application/json" },
    })));

  const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  document.body.innerHTML = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

  const code = `(function() {\n${SCRML_RUNTIME}\n` + captureInsideChunkScope(clientJs,
    `window.__sg = _scrml_reactive_get;\n`) + `\n})();`;
  eval(code);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));

  return {
    get: (n) => window.__sg(n),
    click: (sel) => document.querySelector(sel).dispatchEvent(new Event("click", { bubbles: true })),
  };
}

/** Let the stubbed round-trip + the handler's continuation settle. */
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const RECEIVER_TAIL = `<program db="./u1.db">
<schema>
    ?{\`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)\`}
</schema>
<div>
    \${
        <count>: int = 0

        server function loadRows() {
            return ?{\`SELECT id, name FROM items\`}.all()
        }

        function refresh() {
            @count = loadRows().length
        }
    }
    <button id="go" onclick=refresh()>Refresh</button>
    <p>\${@count}</p>
</div>
</program>
`;

const NESTED_ARG = `<program db="./u1.db">
<schema>
    ?{\`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)\`}
</schema>
<div>
    \${
        <count>: int = 0

        server function loadRows() {
            return ?{\`SELECT id, name FROM items\`}.all()
        }

        function pick(rows) {
            return rows.length
        }

        function refresh() {
            @count = pick(loadRows())
        }
    }
    <button id="go" onclick=refresh()>Refresh</button>
    <p>\${@count}</p>
</div>
</program>
`;

const RETURN_TYPED = `<program db="./u1.db">
<schema>
    ?{\`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)\`}
</schema>
<div>
    \${
        <count>: int = 0

        server function loadRows() {
            return ?{\`SELECT id, name FROM items\`}.all()
        }

        function rowCount(): int {
            const rows = loadRows()
            return rows.length
        }

        function refresh() {
            @count = rowCount()
        }
    }
    <button id="go" onclick=refresh()>Refresh</button>
    <p>\${@count}</p>
</div>
</program>
`;

describe("U1 §13.2 — a CLIENT server-fn call is awaited at its call site (runtime)", () => {
  test("(a) RECEIVER-TAIL `loadRows().length` yields the row count, not undefined", async () => {
    const api = mount(RECEIVER_TAIL);
    api.click("#go");
    await settle();
    // Pre-U1 this read `undefined`: `.length` was taken off the pending Promise.
    expect(api.get("count")).toBe(ROWS.length);
  });

  test("(b) NESTED ARGUMENT `pick(loadRows())` passes the resolved rows", async () => {
    const api = mount(NESTED_ARG);
    api.click("#go");
    await settle();
    // Pre-U1 `pick` received a Promise, so `rows.length` was undefined.
    expect(api.get("count")).toBe(ROWS.length);
  });

  test("(c) RETURN-TYPED `function` body (emitFnShortcutBody path) awaits its RPC", async () => {
    const api = mount(RETURN_TYPED);
    api.click("#go");
    await settle();
    // Pre-U1 this body bypassed scheduleStatements, so the injector never ran.
    expect(api.get("count")).toBe(ROWS.length);
  });
});
