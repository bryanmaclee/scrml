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

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { IF_GATE_BYPASS_TAGS } from "../../src/codegen/emit-html.ts";

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
  // `errors` carries EVERY severity (runCG has one diagnostic channel — a CGError
  // with `severity: "error" | "warning" | "info"`), so the info-level
  // I-SSR-EACH-CLIENT-RENDERED lint is in here, not in a separate lint array.
  return {
    clientJs: out?.clientJs ?? "",
    serverJs: out?.serverJs ?? "",
    html: out?.html ?? "",
    errors: result.errors ?? [],
  };
}

/** The I-SSR-EACH-CLIENT-RENDERED diagnostics raised for one compile. */
function clientRenderedLints(errors) {
  return errors.filter((e) => e.code === "I-SSR-EACH-CLIENT-RENDERED");
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
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_[0-9a-z]{8}_\d+\(_scrml_rows\)/);
    // it iterates the rows and builds an HTML string per item
    expect(serverJs).toContain("for (let _scrml_i = 0; _scrml_i < _scrml_rows.length; _scrml_i++)");
    expect(serverJs).toContain("const _scrml_item = _scrml_rows[_scrml_i];");
  });

  test("the compose handler fills the each-mount div with the rendered rows", () => {
    const { serverJs } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    // the mount-fill helper + the per-mount fill call fed from the seed cell
    expect(serverJs).toContain("function _scrml_ssr_fill_mount(html, mountId, rowsHtml)");
    // The mount id is now a chunk-namespaced STRING, and the back-reference is
    // load-bearing: the fill's token MUST equal the render fn's token, which is
    // the same token the HTML fence carries. A divergence here breaks
    // rehydration silently, so pin the agreement rather than the shape alone.
    expect(serverJs).toMatch(
      /_scrml_html = _scrml_ssr_fill_mount\(_scrml_html, "([0-9a-z]{8}_\d+)", _scrml_ssr_render_each_\1\(_scrml_ssr_state\["accounts"\]\)\);/,
    );
  });

  test("the compiled HTML ships the (still-empty) mount div the fill targets", () => {
    const { html } = compileBundles(TIER1, { protectAnalysis: usersProtect() });
    // BEFORE the compose handler runs, the mount is empty (the B-substrate shape).
    expect(html).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+--><!--\/scrml-each:[0-9a-z]{8}_\d+-->/);
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
    expect(serverJs).not.toMatch(/_scrml_ssr_render_each_[0-9a-z]{8}_\d+/);
    expect(serverJs).not.toContain("_scrml_ssr_fill_mount(_scrml_html");
    // the B-substrate seed still runs — only the markup pre-render falls back
    expect(serverJs).toContain('_scrml_ssr_state["accounts"]');
    expect(html).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+--><!--\/scrml-each:[0-9a-z]{8}_\d+-->/);
  });

  test("a user component in the row → the isUserComponentMarkup guard falls back, no crash", () => {
    const { serverJs, html } = compileBundles(COMP_ROW, { protectAnalysis: usersProtect() });
    expect(serverJs).not.toMatch(/_scrml_ssr_render_each_[0-9a-z]{8}_\d+/);
    expect(serverJs).not.toContain("_scrml_ssr_fill_mount(_scrml_html");
    expect(serverJs).toContain('_scrml_ssr_state["accounts"]');
    expect(html).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+--><!--\/scrml-each:[0-9a-z]{8}_\d+-->/);
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
    expect(html).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+--><!--\/scrml-each:[0-9a-z]{8}_\d+-->/);

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
    expect(firstPaint).not.toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+--><!--\/scrml-each:[0-9a-z]{8}_\d+-->/);
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
    const fence = /<!--scrml-each:([0-9a-z]{8}_\d+)-->([\s\S]*?)<!--\/scrml-each:\1-->/.exec(firstPaint);
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
    const seedTag = /<script type="application\/json" id="__scrml_ssr_state">([\s\S]*?)<\/script>/.exec(firstPaint);
    expect(seedTag).not.toBeNull();
    const seed = JSON.parse(seedTag[1]);
    expect(seed.accounts.map((r) => r.name)).toEqual(["a$'b", "c$&d"]);
  });
});

// ---------------------------------------------------------------------------
// (f) g-ssr-each-under-if-blank-paint — an each whose MOUNT is inert at first
//     paint falls back to client render and says so (S433, ruling limb (a))
// ---------------------------------------------------------------------------
//
// THE DEFECT THIS PINS. `if=` does not hide, it REMOVES: emit-html's
// `emitIfMountGate` lowers it to `<template id=…>` + `<!--scrml-if-marker:…-->`,
// and a `<template>`'s content is not in the document tree. An `<each>` inside
// that subtree was still classified as a TOP-LEVEL server-render mount (`walk`
// threaded only `insideEach`), so the compose handler spliced fully-rendered rows
// into a fence no browser paints: a BLANK first paint on the dominant guarded-list
// shape (`<div if=@loaded>` around a server-authority list), at exit 0, with zero
// diagnostics. Measured on the pre-fix compiler by mounting the composed first
// paint in happy-dom: 0 live rows under `if=`, 2 under a plain `<div>`, 2 under
// `show=`.
//
// THE RULED FIX IS LIMB (a) ONLY — client-render fallback + the existing lint.
// Server-rendering the resolvable branch (so a guarded list DOES paint at first
// paint) is the separate arc and is deliberately NOT asserted here.
//
// THE DISCRIMINATOR IS THE LOWERING, NOT "a conditional attribute": `show=` is a
// display toggle over LIVE DOM and MUST keep its server render. The `show=` case
// below fails if a future edit keys on "the element has a conditional attribute".

const IF_WRAPPED = `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
<div if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></div>
</program>`;

const PLAIN_WRAPPED = `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
<div><ul><each in=@accounts key=@.id><li : @.name></each></ul></div>
</program>`;

const SHOW_WRAPPED = `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
<div show=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></div>
</program>`;

const IF_THREE_LEVELS_UP = `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
<div if=@loaded><section><div><ul><each in=@accounts key=@.id><li : @.name></each></ul></div></section></div>
</program>`;

const IF_ON_THE_EACH = `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
<ul><each in=@accounts key=@.id if=@loaded><li : @.name></each></ul>
</program>`;

const ELSE_BRANCH = `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
<div if=@loaded>loading</div>
<div else><ul><each in=@accounts key=@.id><li : @.name></each></ul></div>
</program>`;

describe("ssr-a-terminus (f): an each under an inert `if=` template", () => {
  test("REPRODUCER — the compiled HTML puts the each mount fence INSIDE the `if=` <template>", () => {
    const { html } = compileBundles(IF_WRAPPED);
    // This is WHY a server renderer for this mount can never paint: the fence the
    // fill targets is inside template content, which is not in the document tree.
    const tpl = /<template id="[^"]+">([\s\S]*?)<\/template>/.exec(html);
    expect(tpl).not.toBeNull();
    expect(tpl[1]).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+-->/);
  });

  test("no server renderer and no mount fill are emitted for the if-enclosed each", () => {
    const { serverJs } = compileBundles(IF_WRAPPED);
    expect(serverJs).not.toMatch(/function _scrml_ssr_render_each_/);
    expect(serverJs).not.toContain("_scrml_ssr_fill_mount(_scrml_html");
  });

  test("I-SSR-EACH-CLIENT-RENDERED fires, names the `if=` enclosure, and is info-level", () => {
    const { errors } = compileBundles(IF_WRAPPED);
    const lints = clientRenderedLints(errors);
    expect(lints.length).toBe(1);
    expect(lints[0].severity).toBe("info");
    expect(lints[0].message).toContain("enclosed by a `<div if=…>` element");
    expect(lints[0].message).toContain("inert `<template>`");
    // The advice must NOT be the row-template one — widening the renderable
    // subset would change nothing here, so that tail sends the author the wrong way.
    expect(lints[0].message).not.toContain("Bring the row template into");
    expect(lints[0].message).toContain("use `show=` instead of `if=`");
  });

  test("CONTROL — the same each under a plain <div> still server-renders, silently", () => {
    const { serverJs, errors } = compileBundles(PLAIN_WRAPPED);
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_[0-9a-z]{8}_\d+\(_scrml_rows\)/);
    expect(serverJs).toContain("_scrml_ssr_fill_mount(_scrml_html");
    expect(clientRenderedLints(errors).length).toBe(0);
  });

  test("CONTROL — `show=` keeps the DOM live, so it KEEPS its server render", () => {
    // The gate is the §17.1 template lowering, not "a conditional attribute".
    const { serverJs, errors } = compileBundles(SHOW_WRAPPED);
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_[0-9a-z]{8}_\d+\(_scrml_rows\)/);
    expect(clientRenderedLints(errors).length).toBe(0);
  });

  test("the enclosure is STICKY — `if=` three levels up suppresses it just the same", () => {
    const { serverJs, errors } = compileBundles(IF_THREE_LEVELS_UP);
    expect(serverJs).not.toMatch(/function _scrml_ssr_render_each_/);
    expect(clientRenderedLints(errors).length).toBe(1);
  });

  test("`if=` on the <each> OPENER gates its own mount fence (§17.1.2) and is caught", () => {
    const { serverJs, errors } = compileBundles(IF_ON_THE_EACH);
    expect(serverJs).not.toMatch(/function _scrml_ssr_render_each_/);
    const lints = clientRenderedLints(errors);
    expect(lints.length).toBe(1);
    expect(lints[0].message).toContain("`<each>` opener itself carries `if=`");
  });

  test("an if/else CHAIN branch is mount-deferred too — the each in the `else` is caught", () => {
    const { serverJs, errors } = compileBundles(ELSE_BRANCH);
    expect(serverJs).not.toMatch(/function _scrml_ssr_render_each_/);
    const lints = clientRenderedLints(errors);
    expect(lints.length).toBe(1);
    expect(lints[0].message).toContain("chain branch");
  });

  test("RUNTIME — the composed first paint carries NO rows for the if-enclosed each", async () => {
    const { serverJs, html } = compileBundles(IF_WRAPPED);
    const firstPaint = await composeFirstPaint(serverJs, html, [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ]);
    // Pre-fix this spliced `<li data-scrml-key="1">Alice</li>` INTO the inert
    // <template> — bytes in the document, nothing on the screen. The rows now
    // reach the page exactly once, through the client render after hydration.
    expect(firstPaint).not.toContain("data-scrml-key");
    expect(firstPaint).not.toContain(">Alice</li>");
    // the mount fence is still the empty placeholder the client hydrates into
    expect(firstPaint).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+--><!--\/scrml-each:[0-9a-z]{8}_\d+-->/);
    // the seed itself is unaffected — the data is still shipped for hydration
    const seedTag = /<script type="application\/json" id="__scrml_ssr_state">([\s\S]*?)<\/script>/.exec(firstPaint);
    expect(seedTag).not.toBeNull();
    expect(JSON.parse(seedTag[1]).accounts.map((r) => r.name)).toEqual(["Alice", "Bob"]);
  });
});

// ---------------------------------------------------------------------------
// (g) THE INVERTED DEFECT — mirroring the `if=` GATE PREDICATE is not the same
//     as mirroring emit-html's DISPATCH (S433 fix round)
// ---------------------------------------------------------------------------
//
// `isGateableIfValue` answers "would the mount gate ACCEPT this value". It says
// NOTHING about whether control flow REACHES the gate. Several tags in
// `emitNode`'s markup branch dispatch to their own handler and `return` FIRST —
// for those, `if=` is silently ignored, no `<template>` is emitted, and whatever
// they emit stays in the LIVE first-paint tree.
//
// Keying the SSR suppression on the predicate alone therefore DELETED A SERVER
// FIRST PAINT THAT HAD ALWAYS WORKED, and emitted a lint whose stated reason was
// factually false. Measured on the first cut of this fix: `<errorBoundary if=…>`
// and `<page if=…>` (both of which emit their children transparently) went from
// renderer-emitted / 2 rows painted to renderer-suppressed / 0 rows painted, at
// exit 0. The cost asymmetry is the whole point: a MISSED inert host costs a
// missed diagnosis (the pre-existing blank paint, unchanged), a FALSE one costs
// working output.
//
// `IF_GATE_BYPASS_TAGS` is the dispatch mirror. `outlet` is deliberately NOT in
// it — its dispatch REWRITES the node to `main`/`div` keeping `if=` and re-enters
// `emitNode`, so the gate does fire; the outlet case below guards that.

/** Every bypass tag, in a shape that puts the server-authority each UNDER it. */
const BYPASS_TAG_SOURCES = {
  errorBoundary: `<errorBoundary if=@loaded fallback={<div>bad</>}><ul><each in=@accounts key=@.id><li : @.name></each></ul></errorBoundary>`,
  errorboundary: `<errorboundary if=@loaded fallback={<div>bad</>}><ul><each in=@accounts key=@.id><li : @.name></each></ul></errorboundary>`,
  page: `<page if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></page>`,
  errors: `<errors of=@accounts if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></errors>`,
  render: `<render of=@accounts if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></render>`,
  channel: `<channel name="c" if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></channel>`,
  timer: `<timer if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></timer>`,
  poll: `<poll if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></poll>`,
  keyboard: `<keyboard if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></keyboard>`,
  mouse: `<mouse if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></mouse>`,
  gamepad: `<gamepad if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></gamepad>`,
  request: `<request if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></request>`,
  timeout: `<timeout if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></timeout>`,
};

function seededProgram(markup) {
  return `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
${markup}
</program>`;
}

const AUTHOR_TEMPLATE = seededProgram(
  `<template><ul><each in=@accounts key=@.id><li : @.name></each></ul></template>`,
);
const OUTLET_WRAPPED = seededProgram(
  `<outlet if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></outlet>`,
);

describe("ssr-a-terminus (g): the if=-gate BYPASS tags keep their server render", () => {
  test("IF_GATE_BYPASS_TAGS is exactly the dispatch set (a reorder/addition must be deliberate)", () => {
    // Derived by enumerating every `return` in emitNode's markup branch ABOVE the
    // `if=` mount gate. If you change that dispatch, change this list WITH it —
    // and re-read the branch rather than editing the list to make the test green.
    expect([...IF_GATE_BYPASS_TAGS].sort()).toEqual([
      "channel", "errorBoundary", "errorboundary", "errors", "gamepad", "keyboard",
      "mouse", "page", "poll", "program", "render", "request", "timeout", "timer",
    ]);
    // outlet is NOT a bypass: it rewrites its tag and re-enters the generic path.
    expect(IF_GATE_BYPASS_TAGS.has("outlet")).toBe(false);
  });

  for (const [tag, markup] of Object.entries(BYPASS_TAG_SOURCES)) {
    test(`<${tag} if=…> fires NO I-SSR-EACH-CLIENT-RENDERED (its if= never reaches the gate)`, () => {
      const { errors } = compileBundles(seededProgram(markup));
      // A lint here would state a reason that is false for this tag.
      expect(clientRenderedLints(errors)).toEqual([]);
    });
  }

  test("<errorBoundary if=…> KEEPS its server renderer and paints its rows (the F1 regression)", async () => {
    const { serverJs, html, errors } = compileBundles(seededProgram(BYPASS_TAG_SOURCES.errorBoundary));
    expect(clientRenderedLints(errors)).toEqual([]);
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_[0-9a-z]{8}_\d+\(_scrml_rows\)/);
    // the boundary emits a plain <div> wrapper and walks its children LIVE — no <template>
    expect(html).not.toContain("<template");
    const firstPaint = await composeFirstPaint(serverJs, html, [{ id: 1, name: "Alice" }]);
    expect(firstPaint).toContain(">Alice</li>");
  });

  test("<page if=…> KEEPS its server renderer and paints its rows (the F1 regression)", async () => {
    const { serverJs, html, errors } = compileBundles(seededProgram(BYPASS_TAG_SOURCES.page));
    expect(clientRenderedLints(errors)).toEqual([]);
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_[0-9a-z]{8}_\d+\(_scrml_rows\)/);
    expect(html).not.toContain("<template");
    const firstPaint = await composeFirstPaint(serverJs, html, [{ id: 1, name: "Alice" }]);
    expect(firstPaint).toContain(">Alice</li>");
  });

  test("<outlet if=…> DOES gate (it delegates to the generic path) — so it stays suppressed", () => {
    // The guard against "add every non-HTML tag to the bypass set". outlet rewrites
    // itself to <main>/<div> KEEPING if=, so its subtree really is mount-deferred.
    const { serverJs, html, errors } = compileBundles(OUTLET_WRAPPED);
    const tpl = /<template id="[^"]+">([\s\S]*?)<\/template>/.exec(html);
    expect(tpl).not.toBeNull();
    expect(tpl[1]).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+-->/);
    expect(serverJs).not.toMatch(/function _scrml_ssr_render_each_/);
    expect(clientRenderedLints(errors).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// (h) an AUTHOR-WRITTEN <template> is the same silence by another route (F2)
// ---------------------------------------------------------------------------

describe("ssr-a-terminus (h): an each inside an author-written <template>", () => {
  test("no server renderer is emitted, and the lint gives TEMPLATE advice (not `use show=`)", () => {
    const { serverJs, errors } = compileBundles(AUTHOR_TEMPLATE);
    expect(serverJs).not.toMatch(/function _scrml_ssr_render_each_/);
    const lints = clientRenderedLints(errors);
    expect(lints.length).toBe(1);
    expect(lints[0].severity).toBe("info");
    expect(lints[0].message).toContain("author-written `<template>` element");
    // `show=` is not a remedy for a literal <template> — its content is inert by
    // the HTML standard, not by any scrml lowering.
    expect(lints[0].message).not.toContain("use `show=` instead of `if=`");
    expect(lints[0].message).toContain("inert by the HTML standard");
  });

  test("RUNTIME — the composed first paint carries no rows (they used to ship into the fragment)", async () => {
    const { serverJs, html } = compileBundles(AUTHOR_TEMPLATE);
    const firstPaint = await composeFirstPaint(serverJs, html, [{ id: 1, name: "Alice" }]);
    expect(firstPaint).not.toContain(">Alice</li>");
    expect(firstPaint).not.toContain("data-scrml-key");
  });
});

// ---------------------------------------------------------------------------
// (i) the DYNAMIC bypass — a compound-parent namespace wrapper
// ---------------------------------------------------------------------------
//
// emit-html's compound-parent dispatch ALSO returns before the `if=` gate, but its
// condition is `lookupStateCell(fileScope, tag) === "compound-parent"` — a per-FILE
// declaration fact that no tag set can carry. This case needs the REAL pipeline:
// `fileAST._scope` (the symbol table the test reads) is only populated by the full
// compile, so the raw buildAST harness above would pass it vacuously.
describe("ssr-a-terminus (i): a compound-parent wrapper carrying if= keeps its server render", () => {
  const dirs = [];
  afterAll(() => {
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  });

  test("<signupForm if=…> (a transparent namespace wrapper) still server-renders its each", async () => {
    const { compileScrml } = await import("../../src/api.js");
    // mkdtemp, not a fixed path: a shared fixture directory is a cross-run
    // collision source on this platform.
    const dir = mkdtempSync(join(tmpdir(), "scrml-s433-compound-"));
    dirs.push(dir);
    const inPath = join(dir, "app.scrml");
    writeFileSync(
      inPath,
      `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
  <loaded> = true
}
<signupForm>
  <userName req length(>=2)> = <input type="text"/>
</>
<signupForm if=@loaded><ul><each in=@accounts key=@.id><li : @.name></each></ul></signupForm>
</program>
`,
    );
    const outDir = join(dir, "dist");
    const res = compileScrml({ inputFiles: [inPath], outputDir: outDir, write: true, log: () => {} });
    // Diagnostics span THREE result fields — reading only `.errors` would miss the
    // info-level lint entirely and make this assertion vacuous.
    const codes = [...(res.errors ?? []), ...(res.warnings ?? []), ...(res.lintDiagnostics ?? [])]
      .map((d) => d.code);
    expect(codes).not.toContain("I-SSR-EACH-CLIENT-RENDERED");
    const serverJs = readFileSync(join(outDir, "app.server.js"), "utf8");
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_[0-9a-z]{8}_\d+\(_scrml_rows\)/);
    // the wrapper is transparent: no element, no <template>, the fence stays live
    const htmlOut = readFileSync(join(outDir, "app.html"), "utf8");
    expect(htmlOut).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+-->/);
    expect(htmlOut).not.toContain("<template");
    expect(existsSync(join(outDir, "app.client.js"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // THE ORDER OF THE HOST TESTS IS LOAD-BEARING — a compound-parent cell may be
  // NAMED `template`, and then NO `<template>` ELEMENT IS EMITTED AT ALL.
  // -------------------------------------------------------------------------
  //
  // emit-html's compound-parent wrapper dispatch excludes `channel`,
  // `errorBoundary`/`errorboundary`, `program` and `errors` — but NOT `template`.
  // So `<template>…</template>` in a file declaring a compound-parent cell of that
  // name takes the TRANSPARENT-WRAPPER path and the each's fence lands straight in
  // `<body>`, live. While `inertHostFor` asked "is the tag `template`?" BEFORE the
  // two bypass tests, it returned the author-`<template>` host for that file and
  // deleted a working server first paint on a false reason.
  //
  // Measured three ways: (A) below → 0 rows composed, 1 false lint; (B) the same
  // shape with the wrapper renamed `templateX` → renderer emitted, 2 rows (so the
  // NAME was the only delta); (C) `template` undeclared → correctly inert, covered
  // by describe (h). This case is (A), and it fails if the two bypass tests are
  // ever reordered back above the `template` test.
  test("a compound-parent cell NAMED `template` is a transparent wrapper, not an inert host", async () => {
    const { compileScrml } = await import("../../src/api.js");
    const dir = mkdtempSync(join(tmpdir(), "scrml-s433-tpl-name-"));
    dirs.push(dir);
    const inPath = join(dir, "app.scrml");
    writeFileSync(
      inPath,
      `<program db="sqlite:./test.db">
\${
  <Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
}
<template>
  <userName req length(>=2)> = <input type="text"/>
</>
<template><ul><each in=@accounts key=@.id><li : @.name></each></ul></template>
</program>
`,
    );
    const outDir = join(dir, "dist");
    const res = compileScrml({ inputFiles: [inPath], outputDir: outDir, write: true, log: () => {} });
    const codes = [...(res.errors ?? []), ...(res.warnings ?? []), ...(res.lintDiagnostics ?? [])]
      .map((d) => d.code);
    // No `<template>` element is emitted, so the author-<template> reason is FALSE
    // here and the each must keep its server render.
    const htmlOut = readFileSync(join(outDir, "app.html"), "utf8");
    expect(htmlOut).not.toContain("<template");
    expect(htmlOut).toMatch(/<!--scrml-each:[0-9a-z]{8}_\d+-->/);
    expect(codes).not.toContain("I-SSR-EACH-CLIENT-RENDERED");
    const serverJs = readFileSync(join(outDir, "app.server.js"), "utf8");
    expect(serverJs).toMatch(/function _scrml_ssr_render_each_[0-9a-z]{8}_\d+\(_scrml_rows\)/);
    expect(serverJs).toContain("_scrml_ssr_fill_mount(_scrml_html");
  });
});
