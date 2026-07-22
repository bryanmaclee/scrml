/**
 * §52.8 SSR A-terminus (Dispatch 2) — DOM-adoption hydration (R26 runtime gate).
 *
 * Change-id ssr-a-terminus-dom-adoption-2026-07-02. Builds on D1 (server-side
 * per-row markup render): the first-paint HTML already contains the
 * server-authority `<each>` rows, each keyed with a `data-scrml-key` ATTRIBUTE
 * inside the `<div data-scrml-each-mount>` slot. D1's client STILL wiped that
 * server DOM and rebuilt from an empty mount (the double-render).
 *
 * This dispatch teaches the client runtime `_scrml_reconcile_list` to ADOPT the
 * server rows (matched by `data-scrml-key`) and UPGRADE them IN PLACE — so the
 * mount is NEVER emptied. The proof is a real happy-dom hydration: inject the
 * server first-paint HTML, seed `window.__scrml_ssr_state` (as B-substrate does),
 * run the emitted client module, and assert:
 *   - the mount is never wiped (no `replaceChildren`; N `replaceChild` upgrades)
 *   - the rows stay present, keyed, and correct (no flash)
 *   - the rows are now INTERACTIVE (a click handler fires; a reactive update lands)
 *   - the §14.8.9 protected column is still absent (D1 redaction floor, no regress)
 *
 * Plus the S215 adversarial gate: post-hydration reconciles (add/remove/reorder/
 * field-mutation), a fallback each (no server rows → normal client render), and a
 * non-SSR each (empty mount, no seed → byte-identical bulk-from-empty). Numeric
 * key-type normalization (server `"1"` string vs client `1` number) is exercised
 * by the happy path itself (`key=@.id` over integer ids).
 *
 * Harness models: each-per-item-reactivity-bug64.browser.test.js (happy-dom
 * client exec) + ssr-a-terminus.test.js (server compose-handler first paint).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// D1 Tier-1 fixture, extended with an interactive row: a per-item onclick sink
// (behavioral — the server renderer drops it, the client re-wires it) + a
// reactive `${@.name}` text body. `key=@.id` over integer ids exercises the
// server-string vs client-number key-type normalization.
const TIER1_INTERACTIVE = `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
    passwordHash: string
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><li onclick=\${ window.__sink(@.name) }>\${@.name}</li></each></ul>
</program>`;

// An each whose row carries an `if=` toggle — D1 CANNOT server-render it, so it
// falls back to an empty mount. Adoption must find nothing and the client must
// render it normally (no crash).
const FALLBACK_SRC = `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
    active: boolean
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><li if=@.active : @.name></each></ul>
</program>`;

// A plain client-only each — no server authority, no SSR, no seed. First render
// hits `oldNodes.size === 0` with an empty mount → the pre-existing
// bulk-from-empty path. This is the #1 regression risk: adoption must be a no-op.
const NONSSR_SRC = `<program>
type Line:struct = { id: number, name: string }
<lines>: Line[] = []
<ul><each in=@lines key=@.id><li>\${@.name}</li></each></ul>
</program>`;

// ---------------------------------------------------------------------------
// Compile helpers (runCG — mirrors ssr-a-terminus.test.js)
// ---------------------------------------------------------------------------

function makeRouteMap() { return { functions: new Map() }; }
function makeDepGraph() { return { nodes: new Map(), edges: [] }; }
function noProtect() { return { views: new Map() }; }
// `users.passwordHash` protected (PA views shape).
function usersProtect() {
  return {
    views: new Map([
      ["db1", {
        tables: new Map([
          ["users", {
            protectedFields: new Set(["passwordHash"]),
            fullSchema: [{ name: "id" }, { name: "name" }, { name: "passwordHash" }],
          }],
        ]),
      }],
    ]),
  };
}

function compile(source, { protectAnalysis = noProtect(), filePath = "/test/app.scrml" } = {}) {
  const ast = buildAST(splitBlocks(filePath, source)).ast;
  const result = runCG({ files: [ast], routeMap: makeRouteMap(), depGraph: makeDepGraph(), protectAnalysis });
  const out = result.outputs.get(filePath);
  return { clientJs: out?.clientJs ?? "", serverJs: out?.serverJs ?? "", html: out?.html ?? "" };
}

// Run the emitted SSR compose handler to get the first-paint HTML (server rows
// filled into the mount + the inline `window.__scrml_ssr_state` seed). Identical
// to ssr-a-terminus.test.js's harness; the emitted code itself is UNMODIFIED.
async function composeFirstPaint(serverJs, html, dbRows) {
  const runnable = serverJs
    .replace(/^\s*import\s+\{\s*SQL\s*\}\s+from\s+"bun";\s*$/m, "")
    .replace(/^\s*const _scrml_sql = new SQL\([^)]*\);\s*$/m, "")
    .replace(/^export\s+/gm, "")
    .replace(/import\.meta\.url/g, JSON.stringify("file:///app.scrml"));
  const _scrml_sql = () => Promise.resolve(dbRows.map((r) => ({ ...r })));
  const BunStub = { file: () => ({ text: async () => html }) };
  class ResponseStub {
    constructor(body, init) { this._body = body; this.status = init?.status; }
    async text() { return this._body; }
  }
  const wrapper = new Function(
    "_scrml_sql", "Bun", "Response",
    `${runnable}\nreturn { _scrml_ssr_compose_handler };`,
  );
  const mod = wrapper(_scrml_sql, BunStub, ResponseStub);
  const resp = await mod._scrml_ssr_compose_handler({});
  return await resp.text();
}

// Pull the inline B-substrate seed value out of a first-paint HTML string.
// `innerHTML=` does NOT execute the `<script>`, so we apply the seed by hand —
// exactly what the seed script would set on `window.__scrml_ssr_state`.
function extractSeed(firstPaint) {
  const m = /window\.__scrml_ssr_state=([\s\S]*?);<\/script>/.exec(firstPaint);
  return m ? JSON.parse(m[1]) : null;
}

// ---------------------------------------------------------------------------
// happy-dom client-exec harness (mirrors bug64.browser)
// ---------------------------------------------------------------------------

// Inject `domHtml` into the DOM, optionally seed `window.__scrml_ssr_state`,
// install call spies on the each-mount, then run the emitted client module. The
// each render fn runs SYNCHRONOUSLY at module-init, so adoption has already
// happened by the time this returns.
function runClient({ domHtml, clientJs, seedState }) {
  document.documentElement.innerHTML = domHtml;
  if (seedState) window.__scrml_ssr_state = seedState;
  else { try { delete window.__scrml_ssr_state; } catch (_) { window.__scrml_ssr_state = null; } }

  // Approach A-unified: the each mounts as a comment fence; rows are siblings in
  // the each's real parent. Adoption upgrades each server row via parent.replaceChild
  // and NEVER wipes the range with replaceChildren — so spy on the fence's PARENT.
  let mount = null;
  {
    const _w = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
    let _n;
    while ((_n = _w.nextNode())) {
      if (String(_n.data || "").trim().indexOf("scrml-each:") === 0) { mount = _n.parentNode; break; }
    }
  }
  const spy = { replaceChildren: 0, replaceChild: 0 };
  if (mount) {
    const origRC = mount.replaceChildren.bind(mount);
    mount.replaceChildren = (...a) => { spy.replaceChildren++; return origRC(...a); };
    const origRCh = mount.replaceChild.bind(mount);
    mount.replaceChild = (a, b) => { spy.replaceChild++; return origRCh(a, b); };
  }

  const exec = new Function(
    "window", "document",
    `${SCRML_RUNTIME}\n${clientJs}\n` +
      // Cell writes store a deep-reactive proxy (mirrors real codegen), so field
      // reads/writes trap and per-item effects re-fire.
      `globalThis.__scrml_set__ = (n, v) => _scrml_reactive_set(n, _scrml_deep_reactive(v));\n` +
      `globalThis.__scrml_get__ = _scrml_reactive_get;\n`,
  );
  exec(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded"));

  const lis = () => [...(mount || document).querySelectorAll("li")];
  return {
    mount, spy, lis,
    text: () => lis().map((n) => n.textContent.trim()),
    keys: () => lis().map((n) => n.getAttribute("data-scrml-key")),
    set: (n, v) => globalThis.__scrml_set__(n, v),
    get: (n) => globalThis.__scrml_get__(n),
  };
}

const DB_ROWS = [
  { id: 1, name: "Alice", passwordHash: "SECRET_HASH_ALICE" },
  { id: 2, name: "Bob",   passwordHash: "SECRET_HASH_BOB" },
];

// ---------------------------------------------------------------------------

describe("ssr-a-terminus D2 — DOM-adoption hydration (R26 runtime gate)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing to do */ }
  });

  test("adopts the server rows in place (no wipe), keeps them interactive, redaction intact", async () => {
    const { serverJs, clientJs, html } = compile(TIER1_INTERACTIVE, { protectAnalysis: usersProtect() });

    // --- BEFORE: server first paint contains the redacted, keyed rows (D1). ---
    const firstPaint = await composeFirstPaint(serverJs, html, DB_ROWS);
    expect(firstPaint).toContain('<li data-scrml-key="1">Alice</li>');
    expect(firstPaint).toContain('<li data-scrml-key="2">Bob</li>');
    expect(firstPaint).not.toContain("SECRET_HASH");
    expect(firstPaint).not.toContain("passwordHash");

    const seed = extractSeed(firstPaint);
    expect(seed).toEqual({ accounts: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });

    // --- HYDRATE: inject the server DOM, seed the cell, run the client. ---
    window.__sink = (v) => (window.__sinkLog ||= []).push(v);
    window.__sinkLog = [];
    const app = runClient({ domHtml: firstPaint, clientJs, seedState: seed });

    // --- ADOPTION PROOF: the mount is NEVER emptied. ---
    // A wipe-then-rebuild would call `replaceChildren()` on the mount; adoption
    // upgrades each server row 1:1 via `replaceChild`.
    expect(app.spy.replaceChildren).toBe(0);
    expect(app.spy.replaceChild).toBe(2);

    // Rows stay present, keyed, correct (content identical → no flash).
    expect(app.lis().length).toBe(2);
    expect(app.text()).toEqual(["Alice", "Bob"]);
    expect(app.keys()).toEqual(["1", "2"]);

    // --- REDACTION FLOOR (D1 §14.8.9): the protected column never appears. ---
    expect(app.mount.innerHTML).not.toContain("SECRET_HASH");
    expect(app.mount.innerHTML).not.toContain("passwordHash");

    // --- INTERACTIVITY 1: the per-item click handler fires on the upgraded row. ---
    app.lis()[0].dispatchEvent(new Event("click"));
    expect(window.__sinkLog).toEqual(["Alice"]);

    // --- INTERACTIVITY 2: a per-item reactive update lands on the upgraded row. ---
    app.set("accounts", [{ id: 1, name: "ALICE2" }, { id: 2, name: "Bob" }]);
    expect(app.text()).toEqual(["ALICE2", "Bob"]);
  });

  test("post-hydration reconciles: add / remove / reorder / field-mutation", async () => {
    const { serverJs, clientJs, html } = compile(TIER1_INTERACTIVE, { protectAnalysis: usersProtect() });
    const firstPaint = await composeFirstPaint(serverJs, html, DB_ROWS);
    const seed = extractSeed(firstPaint);
    window.__sink = () => {};
    const app = runClient({ domHtml: firstPaint, clientJs, seedState: seed });
    expect(app.text()).toEqual(["Alice", "Bob"]);

    // add
    app.set("accounts", [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Carol" }]);
    expect(app.text()).toEqual(["Alice", "Bob", "Carol"]);
    // remove
    app.set("accounts", [{ id: 1, name: "Alice" }, { id: 3, name: "Carol" }]);
    expect(app.text()).toEqual(["Alice", "Carol"]);
    // reorder
    app.set("accounts", [{ id: 3, name: "Carol" }, { id: 1, name: "Alice" }]);
    expect(app.text()).toEqual(["Carol", "Alice"]);
    // in-place field mutation (Fast-path-B2)
    const live = app.get("accounts");
    live[0].name = "CAROL2";
    expect(app.text()).toEqual(["CAROL2", "Alice"]);
  });

  test("fallback each (no server rows) → normal client render, no crash", async () => {
    const { serverJs, clientJs, html } = compile(FALLBACK_SRC, { protectAnalysis: usersProtect() });
    // D1 fell back — the mount ships empty (no data-scrml-key rows to adopt).
    const dbActive = [
      { id: 1, name: "Alice", active: true },
      { id: 2, name: "Bob",   active: true },
    ];
    const firstPaint = await composeFirstPaint(serverJs, html, dbActive);
    // D1 fell back — the mount ships as an empty fence (no data-scrml-key rows to adopt).
    expect(firstPaint).toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);

    const seed = extractSeed(firstPaint);
    const app = runClient({ domHtml: firstPaint, clientJs, seedState: seed });

    // No server nodes → adoption is a no-op → the bulk-from-empty client render
    // runs (build fresh rows, no in-place upgrade). Proof: zero adoption upgrades
    // (replaceChild), and the rows appear; no crash.
    expect(app.spy.replaceChild).toBe(0);
    expect(app.text()).toContain("Alice");
    expect(app.text()).toContain("Bob");
  });

  test("non-SSR each (empty mount, no seed) → byte-identical bulk-from-empty render + reconciles", () => {
    const { clientJs, html } = compile(NONSSR_SRC);
    const app = runClient({ domHtml: html, clientJs, seedState: null });

    // Empty mount, no data-scrml-key nodes, no seed → adoption never fires.
    app.set("lines", [{ id: 1, name: "a" }, { id: 2, name: "b" }]);
    expect(app.text()).toEqual(["a", "b"]);
    // add / remove / reorder all work on the pure client path.
    app.set("lines", [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }]);
    expect(app.text()).toEqual(["a", "b", "c"]);
    app.set("lines", [{ id: 1, name: "a" }, { id: 3, name: "c" }]);
    expect(app.text()).toEqual(["a", "c"]);
    app.set("lines", [{ id: 3, name: "c" }, { id: 1, name: "a" }]);
    expect(app.text()).toEqual(["c", "a"]);
  });

  test("a server row whose key is absent from the client seed is removed on hydrate (orphan + string-key fallback)", async () => {
    const { serverJs, clientJs, html } = compile(TIER1_INTERACTIVE, { protectAnalysis: usersProtect() });
    const firstPaint = await composeFirstPaint(serverJs, html, DB_ROWS);
    // Force a mismatch the real request can't produce (seed + render share one
    // query): splice a GHOST server row (key 99) that the client seed lacks. It
    // never matches _strToClient, keeps its raw string key, and the normal diff
    // removes it — the surviving rows are the adopted, upgraded Alice/Bob.
    const domWithGhost = firstPaint.replace(
      '<li data-scrml-key="1">Alice</li>',
      '<li data-scrml-key="1">Alice</li><li data-scrml-key="99">Ghost</li>',
    );
    const seed = extractSeed(firstPaint);
    window.__sink = () => {};
    const app = runClient({ domHtml: domWithGhost, clientJs, seedState: seed });
    expect(app.text()).toEqual(["Alice", "Bob"]);
    expect(app.spy.replaceChildren).toBe(0); // never wiped
    expect(app.mount.innerHTML).not.toContain("Ghost");
  });

  test("zero-rows SSR (empty seeded list) → empty mount, no crash", async () => {
    const { serverJs, clientJs, html } = compile(TIER1_INTERACTIVE, { protectAnalysis: usersProtect() });
    // The compose handler renders zero rows when the query returns none.
    const firstPaint = await composeFirstPaint(serverJs, html, []);
    const seed = extractSeed(firstPaint);
    expect(seed).toEqual({ accounts: [] });
    window.__sink = () => {};
    const app = runClient({ domHtml: firstPaint, clientJs, seedState: seed });
    expect(app.lis().length).toBe(0);
    // A later populate still renders (adoption did not corrupt the mount state).
    app.set("accounts", [{ id: 7, name: "Zed" }]);
    expect(app.text()).toEqual(["Zed"]);
  });
});
