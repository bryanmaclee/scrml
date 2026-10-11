/**
 * §4.17 (S462 Q21) × §52.8 SSR — a raw body in a server-rendered `<each>` row is written
 * with `<` / `>` encoded and `&` kept, exactly as the static HTML writes it.
 * change-id: s462-q21-raw-body-as-text.
 *
 * Pre-ruling the SSR row renderer escaped a raw body's text with the generic text escaper
 * (`&` → `&amp;` too), so an author entity double-encoded (`&lt;b&gt;` displayed as
 * `&lt;b&gt;`), and a nested `<code>` wrapper displayed as text. The harness executes the
 * emitted compose handler (mirrors ssr-a-terminus.test.js).
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
<ul><each in=@accounts key=@.id><li><pre><img src=x onerror="window.pwned=1"></pre><pre><code>&lt;b&gt; a < b</code></pre></li></each></ul>
</program>`;

describe("SSR row renderer — raw content is display text", () => {
  test("the server render fn writes the raw bodies encoded (& kept, the <code> wrapper kept)", () => {
    const { serverJs, errors } = compileBundles(SRC);
    expect(errors.filter((e) => (e.severity ?? "error") === "error").map((e) => e.code)).toEqual([]);
    expect(serverJs).toContain("_scrml_ssr_render_each_");
    expect(serverJs).toContain(JSON.stringify(`&lt;img src=x onerror="window.pwned=1"&gt;`));
    expect(serverJs).toContain(JSON.stringify(`<code>&lt;b&gt; a &lt; b</code>`));
    expect(serverJs).not.toContain(`&amp;lt;b`);
  });

  test("the composed first paint shows the text and builds no element", async () => {
    const { serverJs, html } = compileBundles(SRC);
    const firstPaint = await composeFirstPaint(serverJs, html, [{ id: 1, name: "a" }]);
    expect(firstPaint).toContain(`<pre>&lt;img src=x onerror="window.pwned=1"&gt;</pre>`);
    expect(firstPaint).toContain(`<pre><code>&lt;b&gt; a &lt; b</code></pre>`);
    expect(firstPaint).not.toContain(`<img`);
  });
});
