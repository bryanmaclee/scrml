/**
 * §52.8 SSR A-terminus (Dispatch 1) — server-side per-row markup render.
 * Change-id ssr-a-terminus-dispatch1-2026-07-01. Builds on the S233 B-substrate
 * (ssr-b-substrate.test.js), which seeds the redacted server-authority rows into
 * `window.__scrml_ssr_state` but leaves the each-mount divs EMPTY on first paint.
 *
 * This dispatch lifts the per-row render to run SERVER-SIDE at HTML-composition
 * time: for each `<each in=@<seededCell>>` whose per-item template is within the
 * supported subset (static markup / nested elements / `:`-shorthand bodies /
 * simple item-field-read interpolations), the compiler emits a string-building
 * render fn (fed the SAME §14.8.9-redacted rows the seed carries) and the SSR
 * compose handler fills the mount div with the rendered rows — so a view-source
 * of the first paint contains the data, keyed with `data-scrml-key` (the marker
 * the NEXT dispatch's DOM-adoption will match).
 *
 * SCOPE (Dispatch 1): the each STILL rebuilds client-side (transient double
 * render is accepted); DOM-adoption hydration + W-AUTH-002 retirement are
 * SUBSEQUENT A-terminus dispatches. An each the renderer cannot faithfully
 * serialize falls back to the pre-existing client-only render (empty mount, no
 * wrong markup).
 *
 * Coverage:
 *   (a) the compiler emits a per-each server render fn + wires the mount fill
 *   (b) §14.8.9 protected columns are redacted from the rendered rows
 *   (c) data-scrml-key markers ride each rendered row
 *   (d) conservative fallback — an unsupported each keeps its mount empty, no crash
 *   (e) server-only — no render code / protected value in the client bundle
 *   (R26) RUNTIME acceptance — the emitted compose handler is EXECUTED and the
 *         composed first-paint HTML contains the rendered (redacted, keyed) rows
 */

import { describe, test, expect } from "bun:test";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";

// ---------------------------------------------------------------------------
// Harness (mirrors ssr-b-substrate.test.js)
// ---------------------------------------------------------------------------

function makeRouteMap() { return { functions: new Map() }; }
function makeDepGraph() { return { nodes: new Map(), edges: [] }; }
function noProtect() { return { views: new Map() }; }
// `users.passwordHash` protected (PA views shape — buildProtectContext input).
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

function parseAST(source, filePath) {
  return buildAST(splitBlocks(filePath, source)).ast;
}

function compileBundles(source, { protectAnalysis = noProtect(), filePath = "/test/app.scrml" } = {}) {
  const ast = parseAST(source, filePath);
  const result = runCG({
    files: [ast],
    routeMap: makeRouteMap(),
    depGraph: makeDepGraph(),
    protectAnalysis,
  });
  const out = result.outputs.get(filePath);
  return { clientJs: out?.clientJs ?? "", serverJs: out?.serverJs ?? "", html: out?.html ?? "" };
}

// Run the emitted SSR compose handler END-TO-END: the actual emitted per-row
// render fn, the §14.8.9 protect helpers, and the mount-fill, against a stub DB
// (returns `dbRows` — carrying the protected column) and the sibling compiled
// HTML. Returns the composed first-paint HTML (what view-source shows BEFORE the
// client bundle runs). Module framing is neutralized so the handler runs in a
// plain function scope; the emitted code itself is UNMODIFIED.
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

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// Tier-1 server-authority TYPE over a table with a protected column, iterated by
// an each whose row template is within the supported subset (single `<li>` root,
// `:`-shorthand body reading the item field `@.name`, explicit `key=@.id`).
const TIER1 = `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
    passwordHash: string
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><li : @.name></each></ul>
</program>`;

// An each whose row carries an `if=` visibility toggle — conditional content the
// renderer cannot faithfully serialize server-side → falls back (empty mount).
const IF_ROW = `<program db="sqlite:./test.db">
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

// An each whose row is a USER COMPONENT — cannot be serialized server-side
// (exercises the NR-authoritative isUserComponentMarkup guard) → falls back.
const COMP_ROW = `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><UserCard name=@.name /></each></ul>
</program>`;

// ---------------------------------------------------------------------------
// (a) the compiler emits a per-each server render fn + wires the mount fill
// ---------------------------------------------------------------------------

describe("ssr-a-terminus (a): a server-authority each gets a server-side row renderer", () => {
  test("emits a per-each string-building render fn fed the seeded (redacted) rows", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_\d+\(_scrml_rows\)/);
    // it iterates the rows and builds an HTML string per item
    expect(serverJs).toContain("for (let _scrml_i = 0; _scrml_i < _scrml_rows.length; _scrml_i++)");
    expect(serverJs).toContain("const _scrml_item = _scrml_rows[_scrml_i];");
  });

  test("the compose handler fills the each-mount div with the rendered rows", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    // the mount-fill helper + the per-mount fill call fed from the seed cell
    expect(serverJs).toContain("function _scrml_ssr_fill_mount(html, mountId, rowsHtml)");
    expect(serverJs).toMatch(
      /_scrml_html = _scrml_ssr_fill_mount\(_scrml_html, \d+, _scrml_ssr_render_each_\d+\(_scrml_ssr_state\["accounts"\]\)\);/,
    );
  });

  test("the compiled HTML ships the (still-empty) mount div the fill targets", () => {
    const { html } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    // BEFORE the compose handler runs, the mount is empty (the B-substrate shape).
    expect(html).toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);
  });
});

// ---------------------------------------------------------------------------
// (b) §14.8.9 protected columns are redacted from the rendered rows
// ---------------------------------------------------------------------------

describe("ssr-a-terminus (b): protected columns are redacted from the server-rendered rows", () => {
  test("the render fn is fed rows that pass through _scrml_protect_redact (the seed sink)", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    // the seed the render fn reads is tagged + redacted before rendering
    expect(serverJs).toContain('_scrml_protect_tag(await _scrml_sql`SELECT * FROM users`, ["passwordHash"])');
    expect(serverJs).toContain('_scrml_ssr_state["accounts"] = _scrml_protect_redact(_scrml_rows)');
  });

  test("the render fn never emits the protected column name as a literal read", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    const start = serverJs.indexOf("function _scrml_ssr_render_each_");
    const fnRegion = serverJs.slice(start, serverJs.indexOf("_scrml_ssr_compose_handler"));
    // the each renders @.name only — the protected column is not read
    expect(fnRegion).not.toContain("passwordHash");
    expect(fnRegion).toContain('_scrml_esc(_scrml_item?.["name"])');
  });
});

// ---------------------------------------------------------------------------
// (c) data-scrml-key markers ride each rendered row (DOM-adoption anchor)
// ---------------------------------------------------------------------------

describe("ssr-a-terminus (c): each rendered row carries a data-scrml-key marker", () => {
  test("the render fn stamps data-scrml-key from the each's key expression", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    expect(serverJs).toContain('data-scrml-key=\\"');
    // keyed off the explicit key=@.id
    expect(serverJs).toContain('_scrml_esc_attr(String(_scrml_item?.["id"]))');
  });
});

// ---------------------------------------------------------------------------
// (d) conservative fallback — unsupported each keeps its mount empty, no crash
// ---------------------------------------------------------------------------

describe("ssr-a-terminus (d): an unsupported each falls back to the client-only render", () => {
  test("an if= visibility toggle in the row → no server render fn, no fill, mount stays empty", () => {
    const { serverJs, html } = compileBundles(IF_ROW, { protectAnalysis: usersProtect() });
    expect(serverJs).not.toMatch(/_scrml_ssr_render_each_\d+/);
    expect(serverJs).not.toContain("_scrml_ssr_fill_mount(_scrml_html");
    // the B-substrate seed still runs — only the markup pre-render falls back
    expect(serverJs).toContain('_scrml_ssr_state["accounts"]');
    expect(html).toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);
  });

  test("a user component in the row → the isUserComponentMarkup guard falls back, no crash", () => {
    const { serverJs, html } = compileBundles(COMP_ROW, { protectAnalysis: usersProtect() });
    expect(serverJs).not.toMatch(/_scrml_ssr_render_each_\d+/);
    expect(serverJs).not.toContain("_scrml_ssr_fill_mount(_scrml_html");
    expect(serverJs).toContain('_scrml_ssr_state["accounts"]');
    expect(html).toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);
  });
});

// ---------------------------------------------------------------------------
// (e) server-only — no render code / protected value reaches the client bundle
// ---------------------------------------------------------------------------

describe("ssr-a-terminus (e): the server-side render never leaks into the client bundle", () => {
  test("the client bundle carries no SSR render fn and no protected column", () => {
    const { clientJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    expect(clientJs).not.toContain("_scrml_ssr_render_each");
    expect(clientJs).not.toContain("_scrml_ssr_fill_mount");
    expect(clientJs).not.toContain("passwordHash");
  });
});

// ---------------------------------------------------------------------------
// (R26) RUNTIME acceptance — execute the emitted compose handler
// ---------------------------------------------------------------------------

describe("ssr-a-terminus (R26): the composed first-paint HTML contains the rendered rows", () => {
  test("view-source shows the redacted, keyed rows in the mount (not an empty placeholder)", async () => {
    const { serverJs, html } = compileBundles(TIER1, { protectAnalysis: usersProtect() });

    // BEFORE: the mount ships empty (the B-substrate first-paint shape).
    expect(html).toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);

    // The DB returns rows carrying the protected column; the seed pipeline must
    // strip it before the render fn ever sees it.
    const dbRows = [
      { id: 1, name: "Alice", passwordHash: "SECRET_HASH_ALICE" },
      { id: 2, name: "Bob",   passwordHash: "SECRET_HASH_BOB" },
    ];
    const firstPaint = await composeFirstPaint(serverJs, html, dbRows);

    // AFTER: the mount is filled with the server-rendered rows.
    expect(firstPaint).toContain(">Alice</li>");
    expect(firstPaint).toContain(">Bob</li>");
    // each row is keyed for the NEXT dispatch's DOM-adoption
    expect(firstPaint).toContain('data-scrml-key="1"');
    expect(firstPaint).toContain('data-scrml-key="2"');
    // the mount is no longer the empty placeholder
    expect(firstPaint).not.toMatch(/<!--scrml-each:\d+--><!--\/scrml-each:\d+-->/);
    // §14.8.9 — the protected column value is absent from the first paint
    // (both the rendered rows AND the inline seed json)
    expect(firstPaint).not.toContain("SECRET_HASH");
    expect(firstPaint).not.toContain("passwordHash");
  });

  test("a row value containing a $-replacement pattern ($') renders literally in the mount (FIX A)", async () => {
    // _scrml_ssr_fill_mount injects rowsHtml into the page HTML. A STRING
    // replacement in String.prototype.replace honors $&, $`, $', $$ — so a row
    // value containing `$'` would, with a string replacement, expand to "the rest
    // of the document" and corrupt the filled mount. The function replacer must
    // insert the literal bytes. The row renderer escapes & < > but NOT $, so the
    // `$'` reaches rowsHtml verbatim — this is the exact adversarial payload.
    // Scoped to the between-fence mount region so it pins _scrml_ssr_fill_mount
    // precisely (a sibling $-pattern bug in the seed-<script> splice — emit-server.ts,
    // pre-existing, outside this each-mount rework — is intentionally not asserted here).
    const { serverJs, html } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    const dbRows = [
      { id: 1, name: "a$'b", passwordHash: "x" },
      { id: 2, name: "c$&d", passwordHash: "y" },
    ];
    const firstPaint = await composeFirstPaint(serverJs, html, dbRows);
    // Extract exactly the content the fill placed between the fence anchors.
    const fence = /<!--scrml-each:(\d+)-->([\s\S]*?)<!--\/scrml-each:\1-->/.exec(firstPaint);
    expect(fence).not.toBeNull();
    const between = fence[2];
    // The rows are placed verbatim — no $'/$& expansion clobbering the region.
    expect(between).toBe(
      '<li data-scrml-key="1">a$\'b</li><li data-scrml-key="2">c$&amp;d</li>',
    );
  });

  test("a server cell seeded with a $-pattern value composes a document whose tail is NOT duplicated (FIX E)", async () => {
    // The seed-state <script> splice (emit-server.ts _scrml_ssr_compose_handler)
    // embeds the server-authority cell JSON into the page HTML. A STRING
    // replacement 2nd-arg would honor $&/$'/$`/$$ in that seed data → a cell value
    // containing `$'` expands to "the rest of the document" and duplicates the
    // page tail. The function replacer must splice the seed literally.
    const { serverJs, html } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    const dbRows = [
      { id: 1, name: "a$'b", passwordHash: "x" },
      { id: 2, name: "c$&d", passwordHash: "y" },
    ];
    const firstPaint = await composeFirstPaint(serverJs, html, dbRows);
    // No tail duplication — the document is well-formed exactly once.
    expect(firstPaint.match(/<\/html>/g)?.length ?? 0).toBe(1);
    expect(firstPaint.match(/<\/body>/g)?.length ?? 0).toBe(1);
    // The seed round-trips literally: the inline state carries the verbatim value.
    const seedTag = /window\.__scrml_ssr_state=([\s\S]*?);<\/script>/.exec(firstPaint);
    expect(seedTag).not.toBeNull();
    const seed = JSON.parse(seedTag[1]);
    expect(seed.accounts.map((r) => r.name)).toEqual(["a$'b", "c$&d"]);
  });
});
