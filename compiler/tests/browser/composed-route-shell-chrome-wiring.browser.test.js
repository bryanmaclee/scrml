/**
 * Composed route documents carry a WORKING shell — the shell chrome's reactive
 * wiring runs in every composed route, not only in the shell's own document.
 * g-composed-route-drops-the-attr-tpl-effect (HIGH) + g-uptoroot-vs-distrel-anchor-mismatch.
 *
 * SPEC §40.8.2: each route page's emitted document SHALL be the shell with that
 * route's body filled into the slot. §20.8.1: the shell (`<nav>`, the client
 * runtime) persists; §20.8.2 step 3: a route's OWN wiring rides its own chunk.
 *
 * MECHANISM (established by execution, S419). Composition re-emits the shell's
 * bundle (`<entry>.client.js`) into every composed document — that bundle is
 * what wires the shell chrome (`_scrml_bind_rewire` for `href="${…}"`, the
 * text/class/if= effects, the delegated onclick). The route's own bundle
 * deliberately carries none of it. The effect was never "dropped": the composed
 * document referenced the shell bundle at the dist ROOT while it is emitted under
 * the shell entry's subdirectory, so the script 404'd and every piece of shell
 * reactivity in the composed route was dead (the SSR placeholder `href=""`
 * shipped as the link). Fixing the reference fixes all of it at the root.
 *
 * This test EXECUTES the emitted documents: each `<script src>` is resolved
 * FROM DISK relative to the document (a missing file does not run, exactly as a
 * 404 in a browser), evaluated in document order at global scope in happy-dom,
 * and the shell chrome is probed before and after a click.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { tmpdir } from "os";

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "composed-route-chrome-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

const shellSrc = (authRel) => `<program>
  import { rolePath } from '${authRel}'
  <role> = "admin"
  <count> = 0
  <open> = true
  <h1 id="title">Shell \${@count}</h1>
  <nav><a id="dash" href="\${rolePath(@role)}">Dash</a></nav>
  <span id="badge" class:active=(@count == 0)>badge</span>
  <b id="heat" class="\${@count > 0 ? 'hot' : 'cold'}">heat</b>
  <button id="inc" onclick=\${ @count = @count + 1 }>inc</button>
  <p id="cond" if=@open>shown</p>
  <outlet/>
</program>
`;
const AUTH = `export function rolePath(role: string) -> string {
  match role {
    "admin" :> "/admin"
    _       :> "/patron"
  }
}
`;
const page = (h) => `<page>\n  <h1>${h}</h1>\n</page>\n`;

function build(name, files) {
  const root = join(TMP, name);
  const inputs = [];
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, src);
    inputs.push(abs);
  }
  const outDir = join(root, "dist");
  const result = compileScrml({ inputFiles: inputs, write: true, outputDir: outDir, log: () => {} });
  const errors = (result.errors || []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  expect(errors).toEqual([]);
  return outDir;
}

const tick = () => new Promise((r) => setTimeout(r, 10));

// Load one emitted document the way a browser would: body markup, then each
// <script src> in order, resolved from disk relative to the document.
async function loadDocument(dist, docRel) {
  const htmlPath = join(dist, docRel);
  const html = readFileSync(htmlPath, "utf8");
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  document.body.innerHTML = (bodyMatch ? bodyMatch[1] : "").replace(/<script[\s\S]*?<\/script>/gi, "");
  const srcs = [...html.matchAll(/<script\b[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  const missing = [];
  for (const src of srcs) {
    const p = resolve(dirname(htmlPath), src);
    if (!existsSync(p)) { missing.push(src); continue; }
    (0, eval)(readFileSync(p, "utf8"));
  }
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await tick();
  return { missing };
}

const probe = () => {
  const q = (s) => document.querySelector(s);
  return {
    href: q("#dash")?.getAttribute("href"),
    title: q("#title")?.textContent?.trim(),
    badgeActive: q("#badge")?.classList.contains("active"),
    heat: q("#heat")?.getAttribute("class"),
    condShown: !!q("#cond") && q("#cond").style.display !== "none",
  };
};

const EXPECT_BEFORE = { href: "/admin", title: "Shell 0", badgeActive: true, heat: "cold", condShown: true };
const EXPECT_AFTER = { href: "/admin", title: "Shell 1", badgeActive: false, heat: "hot", condShown: true };

const LAYOUTS = [
  { name: "shell-at-root", shell: "app.scrml", auth: "./models/auth.scrml", yPath: "pages/deep/y.scrml", shellDoc: "app.html", docs: ["x.html", "deep/y.html"] },
  { name: "shell-one-deep", shell: "shell/app.scrml", auth: "../models/auth.scrml", yPath: "pages/deep/y.scrml", shellDoc: "shell/app.html", docs: ["x.html", "deep/y.html"] },
  { name: "shell-two-deep", shell: "a/b/app.scrml", auth: "../../models/auth.scrml", yPath: "pages/deep/er/y.scrml", shellDoc: "a/b/app.html", docs: ["x.html", "deep/er/y.html"] },
];

describe("composed route documents run the shell chrome's reactive wiring (g-composed-route-drops-the-attr-tpl-effect)", () => {
  beforeEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* not registered */ }
    GlobalRegistrator.register();
  });
  afterEach(async () => {
    try { await GlobalRegistrator.unregister(); } catch (_) { /* nothing */ }
  });

  for (const L of LAYOUTS) {
    const files = () => ({
      [L.shell]: shellSrc(L.auth),
      "models/auth.scrml": AUTH,
      "pages/x.scrml": page("Route X"),
      [L.yPath]: page("Route Y"),
    });
    for (const doc of [L.shellDoc, ...L.docs]) {
      test(`${L.name}: ${doc} — every script loads and the shell chrome is live`, async () => {
        const dist = build(`${L.name}-${doc.replace(/\W+/g, "-")}`, files());
        const { missing } = await loadDocument(dist, doc);
        // One combined assertion so a failure names BOTH the unresolved scripts and
        // the dead chrome. The nav href must be the REAL route path, not the SSR
        // placeholder.
        expect({ missing, chrome: probe() }).toEqual({ missing: [], chrome: EXPECT_BEFORE });
        document.querySelector("#inc").click();
        await tick();
        expect(probe()).toEqual(EXPECT_AFTER);
      });
    }
  }
});
