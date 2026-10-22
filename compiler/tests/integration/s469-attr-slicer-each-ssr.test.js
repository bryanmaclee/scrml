/**
 * s469-attr-slicer-each-ssr.test.js — S469 (review of d5f5d3ea1, MEDIUM-1): ONE boundary reader of
 * quoted attribute `${ … }` text. The `<each>` row emitter (`buildEachAttrTemplate`), the `<each>`
 * arm-body sigil rewrite (`rewriteSigilInsideInterpolations`) and the SSR row renderer
 * (`emit-ssr-render.ts` `attrValueParts`) each counted braces (or used `indexOf("}")`) — second
 * readers of text the failable-call check reads with `sliceTemplateText` (acorn's boundaries, under
 * both the script and the module goal). They now all slice with `sliceTemplateText`.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { resolve } from "path";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { sliceTemplateText, templateTextInterpolationNodes } from "../../src/expression-parser.ts";
import { hostView, rebindHostAlias } from "../helpers/host-view.js";

afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

function compileSource(source, label = "case") {
  const uniq = `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = resolve(tmpdir(), `scrml-s469as-${uniq}`);
  const input = resolve(dir, "app.scrml");
  const outDir = resolve(dir, "out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(input, source);
  try {
    const result = compileScrml({ inputFiles: [input], write: true, outputDir: outDir, log: () => {} });
    const read = (name) => {
      const p = resolve(outDir, name);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    };
    const errors = (result.errors ?? []).filter((e) => e.severity !== "warning" && e.severity !== "info" && !/^[WI]-/.test(e.code ?? ""));
    return { codes: errors.map((e) => e.code), clientJs: read("app.client.js"), html: read("app.html") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function mount(out) {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register();
  const m = out.html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = (m ? m[1] : out.html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
  // eslint-disable-next-line no-eval
  (0, eval)(`(function() {\n${SCRML_RUNTIME}\n${out.clientJs}\n})();`);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("<each> row attributes are bounded by the one slicer", () => {
  test("a `}` in a comment and in a string inside an <each> row attribute: compiles and renders", async () => {
    const out = compileSource(`<xs> = ["a"]
<ul><each in=@xs as x><li class="r" data-v="\${ /* } */ 'q}' + x }">r</li></each></ul>
`, "each");
    expect(out.codes).toEqual([]);
    await mount(out);
    expect(document.querySelector("li.r").getAttribute("data-v")).toBe("q}a");
    await GlobalRegistrator.unregister();
  });

  test("a `!` call behind a `}` in a comment inside an <each> row attribute is E-ERROR-002", () => {
    const out = compileSource(`type AuthErr:enum = { Denied }
<xs> = ["wrong"]
\${
    function check(p)! -> AuthErr {
        if (p != "secret") fail AuthErr::Denied
        return true
    }
}
<ul><each in=@xs as x><li data-v="\${ /* } */ check(x) ? 'Y' : 'N' }">r</li></each></ul>
`, "each-f");
    expect(out.codes).toContain("E-ERROR-002");
  });

  test("an escaped `\\${` is literal text for the slicer and for the emitter alike", async () => {
    const out = compileSource(`<xs> = ["a"]
<ul><each in=@xs as x><li class="r" data-v="\\\${x} \${x}">r</li></each></ul>
`, "each-esc");
    expect(out.codes).toEqual([]);
    await mount(out);
    expect(document.querySelector("li.r").getAttribute("data-v")).toBe("\\${x} a");
    await GlobalRegistrator.unregister();
  });

  test("the walker reads the same segments the emitters slice", () => {
    for (const v of ["a ${ /* } */ x } b", "${ 'q}' + x }", "${ (/}/).source }${x}", "n-${ {a:1}.a }"]) {
      const exprs = sliceTemplateText(v, { bare: true }).segments.filter((s) => s.kind === "expr");
      const nodes = templateTextInterpolationNodes(v, "t", 0, undefined, { bare: true });
      expect(nodes.length).toBe(exprs.length);
      expect(nodes.some((n) => n.kind === "escape-hatch")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// SSR (§52.8) — the server-side row renderer
// ---------------------------------------------------------------------------

function compileBundles(source, filePath = "/test/app.scrml") {
  const ast = buildAST(splitBlocks(filePath, source)).ast;
  const result = runCG({ files: [ast], routeMap: { functions: new Map() }, depGraph: { nodes: new Map(), edges: [] }, protectAnalysis: { views: new Map() } });
  const out = result.outputs.get(filePath);
  return { serverJs: out?.serverJs ?? "", html: out?.html ?? "", errors: result.errors ?? [] };
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

const SSR = (attr) => `<program db="sqlite:./test.db">
\${
  < Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><li ${attr} : @.name></each></ul>
</program>`;

describe("SSR row attributes are bounded by the one slicer", () => {
  test("a plain interpolation still server-renders (unchanged)", async () => {
    const { serverJs, html } = compileBundles(SSR('data-v="n-${@.name}"'));
    expect(serverJs).toContain("_scrml_ssr_compose_handler");
    const first = await composeFirstPaint(serverJs, html, [{ id: 1, name: "A" }]);
    expect(first).toContain('data-v="n-A"');
  });

  test("a `}` right after an interpolation is literal text (bounded by the slicer)", async () => {
    const { serverJs, html } = compileBundles(SSR('data-v="${@.name}}"'));
    const first = await composeFirstPaint(serverJs, html, [{ id: 1, name: "A" }]);
    expect(first).toContain('data-v="A}"');
  });

  test("an interpolation holding a `}` in a comment is bounded whole, then declined as a row read", () => {
    // indexOf("}") closed `${ /* } */ @.name }` at the comment's brace (row read ` /* `); the
    // slicer bounds it whole, the renderer does not model the expression, and the each takes
    // the client-render fallback, saying so.
    const { errors } = compileBundles(SSR('data-v="n-${ /* } */ @.name }"'));
    expect(errors.map((e) => e.code)).toContain("I-SSR-EACH-CLIENT-RENDERED");
  });

  test("an interpolation the slicer refuses (an HTML-like comment) is declined, never sliced", () => {
    const { errors } = compileBundles(SSR('data-v="${ @.name <!--x }"'));
    expect(errors.map((e) => e.code)).toContain("I-SSR-EACH-CLIENT-RENDERED");
  });
});
