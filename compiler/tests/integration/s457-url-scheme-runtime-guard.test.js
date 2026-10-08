/**
 * S457 ruling (a) — SPEC §5.2 rule 3: every URL-attribute write whose value the compiler cannot prove
 * safe goes through the runtime guard `_scrml_safe_url`. This file drives the REAL pipeline at every
 * emitter that writes an attribute from data (the enumeration lives in
 * docs/changes/s457-url-scheme-runtime-guard/progress.md) and checks:
 *   §1 every data-derived URL write is guarded, at every markup position, in both forms;
 *   §2 proven-safe writes (literal relative path / safe scheme) are byte-identical — no guard;
 *   §3 element scoping — `data=` on a `<div>`, `cite=` on a `<span>`, and a component prop named
 *      `data` are not URLs (PA addendum S457: `<LineChart data=@chartData/>`);
 *   §4 the 'urlguard' runtime chunk ships exactly when a guard is emitted;
 *   §5 the server's first-paint `<each>` rows (§52.8) are guarded too — EXECUTED.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";

const _dirs = [];
afterAll(() => { for (const d of _dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

function compile(name, src) {
  const dir = mkdtempSync(join(tmpdir(), `s457-urlguard-${name}-`));
  _dirs.push(dir);
  const file = join(dir, `${name}.scrml`);
  writeFileSync(file, src);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const result = compileScrml({ inputFiles: [file], write: true, outputDir: dist, log: () => {} });
  const rd = (f) => (existsSync(join(dist, f)) ? readFileSync(join(dist, f), "utf8") : "");
  const errors = (result.errors ?? []).filter((d) => (d.severity ?? "error") === "error");
  // SPEC §2.2.1 (S457 "1a"): a compile that reports an Error writes NO file (no
  // runtime either) — read its client / html from the in-memory outputs.
  if ((result.errors ?? []).length > 0) {
    const output = result.outputs.get(file) ?? {};
    return { result, errors, client: output.clientJs ?? "", html: output.html ?? "", runtime: typeof result.runtimeSource === "function" ? result.runtimeSource() : "" };
  }
  return { result, errors, client: rd(`${name}.client.js`), html: rd(`${name}.html`), runtime: rd(result.runtimeFilename ?? "scrml-runtime.js") };
}

const POS = {
  top: (el) => `<program>\n<u> = "/a"\n${el("@u")}\n</program>\n`,
  componentProp: (el) => `<program>\n<u> = "/a"\nconst Lnk = <span props={ v: string }>${el("v")}</span>\n<Lnk v=@u/>\n</program>\n`,
  componentReactive: (el) => `<program>\n<u> = "/a"\nconst Lnk = <span>${el("@u")}</span>\n<Lnk/>\n</program>\n`,
  slot: (el) => `<program>\n<u> = "/a"\nconst Wrap = <div class="w">\${children}</div>\n<Wrap>${el("@u")}</Wrap>\n</program>\n`,
  each: (el) => `<program>\n<items> = [{ url: "/a" }]\n<ul>\n  <each in=@items as it>\n    <li>${el("it.url")}</li>\n  </each>\n</ul>\n</program>\n`,
  ifMount: (el) => `<program>\n<u> = "/a"\n<on> = true\n<div if=@on>${el("@u")}</div>\n</program>\n`,
  engine: (el) => `\${\n  type Light:enum = { Green, Red }\n}\n<u> = "/a"\n<engine for=Light initial=.Green>\n  <Green rule=.Red>\n    ${el("@u")}\n  </>\n  <Red rule=.Green></>\n</>\n<program>\n<p>\${@light}</p>\n</program>\n`,
  match: (el) => `\${\n  type Phase:enum = { Idle, Ready }\n  <phase>: Phase = .Idle\n  <u> = "/a"\n}\n<match for=Phase on=@phase>\n  <Idle>\n    ${el("@u")}\n  </>\n  <Ready><p>r</p></>\n</match>\n`,
  forLift: (el) => `<program>\n<items> = [{ url: "/a" }]\n<ul>\n\${ for (const it of @items) { lift ${el("it.url")} } }\n</ul>\n</program>\n`,
};

const GUARDED = {
  quotedWhole: [(x) => `<a href="\${${x}}">a</a>`, "href"],
  quotedPartial: [(x) => `<a href="java\${${x}}">a</a>`, "href"],
  expression: [(x) => `<a href=\${${x}}>a</a>`, "href"],
  imgSrc: [(x) => `<img src="\${${x}}"/>`, "src"],
  srcset: [(x) => `<img srcset="\${${x}} 1x"/>`, "srcset"],
  formAction: [(x) => `<form action=\${${x}}><p>f</p></form>`, "action"],
  objectData: [(x) => `<object data=\${${x}}></object>`, "data"],
};

/** Every `setAttribute("<name>", …)` line in the client bundle. */
function writesOf(client, name) {
  return client.split("\n").filter((l) => l.includes(`setAttribute(${JSON.stringify(name)},`));
}

describe("§1 every data-derived URL write is guarded", () => {
  for (const [pname, mk] of Object.entries(POS)) {
    for (const [sname, [el, attr]] of Object.entries(GUARDED)) {
      test(`${sname} @ ${pname}`, () => {
        const { errors, client } = compile(`${sname}-${pname}`.toLowerCase(), mk(el));
        expect(errors.map((e) => e.code)).toEqual([]);
        const writes = writesOf(client, attr);
        // A QUOTED attribute in a component body reading a prop (`href="${v}"` with `<Lnk v=@u/>`)
        // is substituted with the caller's SOURCE TEXT today — a static `href="@u"`, no data write
        // (open gap g-component-prop-in-quoted-attr-substitutes-source-text-s456). Nothing to guard
        // there; every other position must write, and every write must be guarded.
        const staticSubstitution = pname === "componentProp" && /="/.test(el("v"));
        if (!staticSubstitution) expect(writes.length).toBeGreaterThan(0);
        for (const w of writes) expect(w).toContain(`_scrml_safe_url(`);
      });
    }
  }
});

describe("§2 proven-safe literal prefixes stay byte-identical (no guard)", () => {
  test("relative path / https / mailto / ?query at top level and in a row", () => {
    const { client } = compile("ctl", `<program>
<id> = 7
<items> = [{ id: 1 }]
<a href="/users/\${@id}">r</a>
<a href="https://x.example/\${@id}">h</a>
<a href="mailto:\${@id}">m</a>
<a href="?q=\${@id}">q</a>
<ul><each in=@items as it><li><a href="/i/\${it.id}">i</a></li></each></ul>
</program>
`);
    expect(client).not.toContain("_scrml_safe_url");
    expect(client).toContain('setAttribute("href", `/users/');
    expect(client).toContain('setAttribute("href", `https://x.example/');
    expect(client).toContain('setAttribute("href", `mailto:');
    expect(client).toContain('setAttribute("href", `/i/${it.id}`)');
  });

  test("non-URL attributes are never guarded", () => {
    const { client } = compile("nonurl", `<program>
<u> = "javascript:x"
<b title="\${@u}" class=\${@u}>t</b>
</program>
`);
    expect(client).not.toContain("_scrml_safe_url");
  });
});

describe("§3 element scoping — a name that doubles as a non-URL attribute or a prop is left alone", () => {
  test("`data=` on a <div>, `cite=` on a <span>, `action=` on a custom element: unguarded", () => {
    const { client } = compile("scoped", `<program>
<u> = "a:b"
<div data="\${@u}">d</div>
<span cite=\${@u}>c</span>
<my-form action=\${@u}>f</my-form>
<blockquote cite=\${@u}>q</blockquote>
</program>
`);
    for (const w of writesOf(client, "data")) expect(w).not.toContain("_scrml_safe_url");
    for (const w of writesOf(client, "action")) expect(w).not.toContain("_scrml_safe_url");
    const cites = writesOf(client, "cite");
    expect(cites.some((w) => w.includes("_scrml_safe_url"))).toBe(true); // the <blockquote>
    expect(cites.some((w) => !w.includes("_scrml_safe_url"))).toBe(true); // the <span>
  });

  test("a component prop named `data` is substituted, never guarded (the guard sees DOM elements only)", () => {
    const { client } = compile("propdata", `<program>
<rows> = [1, 2]
const Chart = <ul props={ data: string }><li>\${data}</li></ul>
<Chart data=@rows/>
</program>
`);
    expect(client).not.toContain("_scrml_safe_url");
  });

  test("PA addendum: samples/.../phase1-use-named-012.scrml (`<LineChart data=@chartData/>`) gains no guard", () => {
    const src = readFileSync(resolve(import.meta.dir, "../../../samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-use-named-012.scrml"), "utf8");
    const { client, html, runtime } = compile("phase1-use-named-012", src);
    expect(client).not.toContain("_scrml_safe_url");
    expect(runtime).not.toContain("_scrml_safe_url");
    expect(html).toContain('data="chartData"');
  });
});

describe("§4 the 'urlguard' runtime chunk ships exactly when a guard is emitted", () => {
  test("guarded page carries it; an unguarded page does not", () => {
    const g = compile("chunk-on", `<program>\n<u> = "/a"\n<a href=\${@u}>a</a>\n</program>\n`);
    expect(g.client).toContain("_scrml_safe_url(");
    expect(g.runtime).toContain("function _scrml_safe_url(");
    const n = compile("chunk-off", `<program>\n<u> = "/a"\n<a href="/x/\${@u}">a</a>\n</program>\n`);
    expect(n.runtime).not.toContain("_scrml_safe_url");
  });
  test("security: the client bundle carries no server code from the SSR copy", () => {
    const g = compile("chunk-client", `<program>\n<u> = "/a"\n<a href=\${@u}>a</a>\n</program>\n`);
    expect(g.client).not.toContain("_scrml_esc_attr");
  });
});

// ---------------------------------------------------------------------------
// §5 — server first-paint rows (§52.8 A-terminus), EXECUTED (harness of ssr-a-terminus.test.js)
// ---------------------------------------------------------------------------

function compileBundles(source, filePath = "/test/app.scrml") {
  const ast = buildAST(splitBlocks(filePath, source)).ast;
  const result = runCG({
    files: [ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
  const out = result.outputs.get(filePath);
  return { serverJs: out?.serverJs ?? "", clientJs: out?.clientJs ?? "", html: out?.html ?? "" };
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
  const mod = new Function("_scrml_sql", "Bun", "Response", `${runnable}\nreturn { _scrml_ssr_compose_handler };`)(
    _scrml_sql, BunStub, ResponseStub,
  );
  const resp = await mod._scrml_ssr_compose_handler({});
  return await resp.text();
}

const SSR_SRC = (attr) => `<program db="sqlite:./test.db">
\${
  < Link authority="server" table="links">
    id: number
    url: string
  </>
  <Link> @links
}
<ul><each in=@links key=@.id><li><a ${attr}>x</a></li></each></ul>
</program>`;

describe("§5 server-rendered first-paint rows", () => {
  test('`href="${@.url}"`: a javascript: row renders about:blank; a safe row renders unchanged; logged without the value', async () => {
    const { serverJs, html, clientJs } = compileBundles(SSR_SRC('href="${@.url}"'));
    expect(serverJs).toContain("_scrml_safe_url(null, \"href\"");
    expect(serverJs).toContain("function _scrml_safe_url(");
    expect(clientJs).not.toContain("_scrml_esc_attr");
    const logs = [];
    const orig = console.error;
    console.error = (...a) => logs.push(a.map(String).join(" "));
    let page;
    try {
      page = await composeFirstPaint(serverJs, html, [
        { id: 1, url: "javascript:alert(document.cookie)" },
        { id: 2, url: "/safe?a=1&b=2" },
      ]);
    } finally { console.error = orig; }
    expect(page).toContain('href="about:blank"');
    expect(page).toContain('href="/safe?a=1&amp;b=2"');
    // The seed JSON carries the row as DATA (a script of type application/json); the MARKUP must not.
    const markup = page.slice(page.indexOf("<body>"));
    expect(markup).not.toContain("javascript:");
    expect(logs.length).toBe(1);
    expect(logs[0]).not.toContain("document.cookie");
  });

  test('`href="/l/${@.id}"` (proven relative) renders without the guard', () => {
    const { serverJs } = compileBundles(SSR_SRC('href="/l/${@.id}"'));
    expect(serverJs).not.toContain("_scrml_safe_url");
  });
});
