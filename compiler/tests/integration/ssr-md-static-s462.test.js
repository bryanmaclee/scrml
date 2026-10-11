/**
 * SPEC §67 phase 2 (S462) × §52.8 SSR — a static `<md>` in a server-rendered `<each>` row.
 * change-id: s462-md-phase2.
 *
 * The SSR row renderer writes the lowered md elements with their text HTML-escaped and their
 * slots as escaped field reads — the same tree the client builds — and nothing from the body
 * or the row data becomes an element. The harness executes the emitted compose handler
 * (mirrors ssr-raw-content-as-text-s462-q21.test.js).
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { hostView, rebindHostAlias } from "../helpers/host-view.js";

function compileBundles(source, filePath = "/test/app.scrml") {
  const ast = buildAST(splitBlocks(filePath, source)).ast;
  const result = runCG({
    files: [ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
  const out = result.outputs.get(filePath);
  return { serverJs: out?.serverJs ?? "", clientJs: out?.clientJs ?? "", html: out?.html ?? "", errors: result.errors ?? [] };
}

async function composeFirstPaint(serverJs, html, dbRows) {
  const runnable = serverJs
    .replace(/^\s*import\s+\{\s*SQL\s*\}\s+from\s+"bun";\s*$/m, "")
    .replace(/^\s*import\s+\{[^}]*_scrml_db_file_exists[^}]*\}\s+from\s+"node:fs";\s*$/m, "")
    .replace(/^\s*const _scrml_sql = .*;\s*$/m, "")
    .replace(/^export\s+/gm, "")
    .replace(/import\.meta\.url/g, JSON.stringify("file:///app.scrml"));
  const _scrml_sql = () => Promise.resolve(dbRows.map((r) => ({ ...r })));
  const BunStub = { file: () => ({ text: async () => html }) };
  class ResponseStub {
    constructor(body, init) { this._body = body; this.status = init?.status; }
    async text() { return this._body; }
  }
  const wrapper = new Function(
    "_scrml_sql", "Bun", "Response", "__scrml_host__",
    `${rebindHostAlias(runnable)}\nreturn { _scrml_ssr_compose_handler };`,
  );
  const mod = wrapper(_scrml_sql, BunStub, ResponseStub, hostView({ Bun: BunStub, Response: ResponseStub }));
  const resp = await mod._scrml_ssr_compose_handler({});
  return await resp.text();
}

const SRC = `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><li><md>
    **User** \${@.name} wrote <b>this</b> & more
</md></li></each></ul>
</program>`;

describe("SSR row renderer — static <md>", () => {
  test("the server render fn writes the lowered elements, text escaped, the slot a field read", () => {
    const { serverJs, errors } = compileBundles(SRC);
    expect(errors.filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
    expect(serverJs).toContain("_scrml_ssr_render_each_");
    expect(serverJs).toContain(JSON.stringify("<strong"));
    expect(serverJs).toContain(JSON.stringify(" wrote &lt;b&gt;this&lt;/b&gt; &amp; more"));
    expect(serverJs).not.toContain("<md");
  });

  test("the composed first paint shows the row value as text and builds no element from it", async () => {
    const { serverJs, html } = compileBundles(SRC);
    const firstPaint = await composeFirstPaint(serverJs, html, [{ id: 1, name: "<img src=x onerror=alert(1)> **x**" }]);
    expect(firstPaint).toContain(`<strong>User</strong>`);
    expect(firstPaint).toContain(`&lt;img src=x onerror=alert(1)&gt; **x**`);
    expect(firstPaint).toContain(` wrote &lt;b&gt;this&lt;/b&gt; &amp; more`);
    expect(firstPaint).not.toContain(`<img`);
    expect(firstPaint).not.toContain(`<b>`);
  });
});
