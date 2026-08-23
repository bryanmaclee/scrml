/**
 * `<program headers="strict">` — the compiler's OWN emitted content must satisfy
 * the CSP the compiler itself pins.
 *
 * §39.2.5 pins `Content-Security-Policy: default-src 'self'` on every response
 * when `headers="strict"` is set. Until the §40.3 onion moved to top-level
 * dispatch, that header never reached an HTML document, so the collision below
 * was invisible. Once it did reach one, MEASURED in real Chromium against a
 * built server:
 *
 *   | tree   | window.__scrml_ssr_state | CSP violations |
 *   |--------|--------------------------|----------------|
 *   | before | undefined                | 2              |
 *   | after  | object (populated)       | 0              |
 *
 *     Refused to execute inline script … violates … 'default-src 'self''
 *     Refused to apply inline style  … violates … 'default-src 'self''
 *
 * Two pieces of compiler-emitted content were being refused:
 *   1. the §52.8 SSR state seed, emitted as `<script>window.__scrml_ssr_state=…`
 *   2. the §38 transition keyframes, injected by a runtime `<style>` element
 *
 * §39.2.5's escape hatch ("override the CSP via `handle()`") covers scripts and
 * styles the DEVELOPER loads from external origins. It does not cover content the
 * COMPILER emits, so an adopter could not fix either one. The fix moves both out
 * of inline position: the seed to a non-executable
 * `<script type="application/json">` data block, and the keyframes to the emitted
 * stylesheet.
 *
 * ⚠ ORACLE DISCIPLINE. happy-dom does not enforce CSP, so "0 violations" cannot
 * be asserted here — that measurement is taken in real Chromium (table above).
 * What IS asserted here executes the real emitted artifacts and DISCRIMINATES
 * against the pre-fix shape:
 *
 *   - `runUnderStrictCsp()` executes ONLY the scripts `default-src 'self'` admits
 *     (external `src=`), skipping every inline one exactly as Chromium does. On
 *     the old emission the seed was inline, so nothing ran and the seed stayed
 *     `undefined`; on the new one the runtime PARSES the data block. The assertion
 *     is on the real runtime's real result.
 *   - the transition test counts `<style>` elements the RUNTIME creates. The old
 *     runtime created one at load (the refused one); the new one must create none,
 *     with the keyframes reachable through the emitted stylesheet instead.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runCG } from "../../src/code-generator.js";
import { SCRML_RUNTIME } from "../../src/runtime-template.js";
import { chunkCellKey } from "../helpers/chunk-scope.js";

if (!globalThis.document) GlobalRegistrator.register();

const DOLLAR = "$";

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// A strict-headers app with one server-authority cell — the shape that produces
// an SSR compose route + a state seed.
const SEEDED_APP = `<program headers="strict" db="sqlite:./test.db">
${DOLLAR}{
  < Account authority="server" table="users">
    id: number
    name: string
  </>
  <Account> @accounts
}
<ul><each in=@accounts key=@.id><li>${DOLLAR}{@.name}</li></each></ul>
</program>`;

// A strict-headers app using §38 transition directives.
const TRANSITION_APP = `<program headers="strict">
<visible> = true
<main>
  <p if=@visible transition:fade>Fading content</>
  <p if=@visible in:slide>Slide-in only</>
</main>
</program>`;

// The same app with NO transition directive — its stylesheet must stay free of
// animation CSS (the keyframes are emitted per-file, only for what is used).
const NO_TRANSITION_APP = `<program headers="strict">
<visible> = true
<main><p if=@visible>Plain content</></main>
</program>`;

// ---------------------------------------------------------------------------
// Compile helpers (mirrors ssr-a-terminus-hydration.browser.test.js)
// ---------------------------------------------------------------------------

function compile(source, filePath = "/test/app.scrml") {
  const ast = buildAST(splitBlocks(filePath, source)).ast;
  const result = runCG({
    files: [ast],
    routeMap: { functions: new Map() },
    depGraph: { nodes: new Map(), edges: [] },
    protectAnalysis: { views: new Map() },
  });
  const out = result.outputs.get(filePath);
  return {
    clientJs: out?.clientJs ?? "",
    serverJs: out?.serverJs ?? "",
    html: out?.html ?? "",
    css: out?.css ?? "",
  };
}

// Run the emitted SSR compose handler for its REAL first-paint HTML — the same
// bytes a browser receives, seed tag included. The emitted code is unmodified;
// only its host bindings (Bun.file, Response, the SQL tag) are stubbed.
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
  return await (await mod._scrml_ssr_compose_handler({})).text();
}

// ---------------------------------------------------------------------------
// The `default-src 'self'` execution model
// ---------------------------------------------------------------------------

/**
 * Load `documentHtml` and execute it the way a browser under
 * `Content-Security-Policy: default-src 'self'` does:
 *
 *   - a `<script src="...">` to a same-origin file RUNS  → the runtime + the
 *     emitted client chunk, supplied by the caller;
 *   - an INLINE `<script>` is REFUSED  → never executed here either.
 *
 * Returns the inline scripts it refused (so a test can assert the compiler
 * emitted none that mattered) and every URL the page fetched (so a test can
 * assert the seed actually SAVED the /__serverLoad round trip).
 */
function runUnderStrictCsp(documentHtml, externalScripts) {
  document.documentElement.innerHTML = documentHtml;
  try { delete window.__scrml_ssr_state; } catch (_) { window.__scrml_ssr_state = undefined; }

  // happy-dom cannot resolve a relative URL from about:blank, and the point here
  // is WHETHER the page fetches, not what comes back.
  const fetched = [];
  const realFetch = window.fetch;
  window.fetch = (input, init) => {
    fetched.push(String(input && input.url ? input.url : input));
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({}), text: async () => "{}",
      headers: { get: () => null },
    });
  };

  const refusedInlineScripts = [];
  for (const el of [...document.querySelectorAll("script")]) {
    if (el.getAttribute("src")) continue;               // external — allowed
    const type = (el.getAttribute("type") || "").toLowerCase();
    // A `type` the UA does not recognise as a script language is a DATA block:
    // it is never executed, so the CSP has nothing to refuse.
    const isDataBlock = type !== "" && type !== "text/javascript" && type !== "module";
    if (isDataBlock) continue;
    refusedInlineScripts.push(el.textContent || "");
  }

  try {
    const exec = new Function("window", "document", externalScripts);
    exec(window, document);
    document.dispatchEvent(new Event("DOMContentLoaded"));
  } finally {
    window.fetch = realFetch;
  }

  return { refusedInlineScripts, fetched };
}

const DB_ROWS = [
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
];

// ---------------------------------------------------------------------------
// 1. the §52.8 SSR seed survives `default-src 'self'`
// ---------------------------------------------------------------------------

describe("headers=strict — the SSR state seed survives default-src 'self'", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    try { delete window.__scrml_ssr_state; } catch (_) { window.__scrml_ssr_state = undefined; }
  });

  test("the compose route emits the seed as a NON-EXECUTABLE application/json data block", async () => {
    const { serverJs, html } = compile(SEEDED_APP);
    const firstPaint = await composeFirstPaint(serverJs, html, DB_ROWS);

    document.documentElement.innerHTML = firstPaint;
    const el = document.getElementById("__scrml_ssr_state");
    expect(el).not.toBeNull();
    expect(el.tagName.toLowerCase()).toBe("script");
    expect(el.getAttribute("type")).toBe("application/json");
    // The payload is real JSON carrying the server-authoritative rows.
    expect(JSON.parse(el.textContent)).toEqual({ accounts: DB_ROWS });
    // The pre-fix executable form must not come back.
    expect(firstPaint).not.toContain("<script>window.__scrml_ssr_state=");
  });

  test("EXECUTING: the runtime populates window.__scrml_ssr_state with every inline script refused", async () => {
    const { serverJs, html, clientJs } = compile(SEEDED_APP);
    const firstPaint = await composeFirstPaint(serverJs, html, DB_ROWS);

    // THE discriminating assertion. Nothing inline runs — exactly as Chromium
    // behaves under `default-src 'self'`. Pre-fix the seed lived in a refused
    // inline script and this read `undefined`.
    const { refusedInlineScripts } = runUnderStrictCsp(
      firstPaint,
      `${SCRML_RUNTIME}\n${clientJs}\n`,
    );

    expect(window.__scrml_ssr_state).toBeTypeOf("object");
    expect(window.__scrml_ssr_state).not.toBeNull();
    expect(window.__scrml_ssr_state.accounts).toEqual(DB_ROWS);

    // And no refused inline script carried anything load-bearing: whatever the
    // CSP threw away must not have been the seed.
    for (const body of refusedInlineScripts) {
      expect(body).not.toContain("__scrml_ssr_state");
    }
  });

  test("EXECUTING: the seeded rows reach the reactive cell, so the page hydrates without a fetch", async () => {
    const { serverJs, html, clientJs } = compile(SEEDED_APP);
    const firstPaint = await composeFirstPaint(serverJs, html, DB_ROWS);

    runUnderStrictCsp(firstPaint, `${SCRML_RUNTIME}\n${clientJs}\n` +
      `globalThis.__scrml_get__ = _scrml_reactive_get;\n`);

    const cellKey = chunkCellKey(clientJs);
    const accounts = globalThis.__scrml_get__(cellKey("accounts"));
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.map((r) => r.name)).toEqual(["Alice", "Bob"]);
  });

  test("EXECUTING: a row value containing </script> stays INERT inside the data block", async () => {
    // The `<` -> \u003c escape is what keeps revealed string data from closing the
    // block early. It is valid in JSON as well as in JS, so moving the seed to a
    // data block did not weaken it — but a data block is parsed as raw text up to
    // `</script`, so this is the assertion that has to hold.
    const POISON = "</script><script>window.__PWNED = true;</scr" + "ipt>";
    const { serverJs, html, clientJs } = compile(SEEDED_APP);
    const firstPaint = await composeFirstPaint(serverJs, html, [{ id: 1, name: POISON }]);

    // The payload never contains a literal `<`; the escape is in the JSON text.
    const seedTagBody = /id="__scrml_ssr_state">([\s\S]*?)<\/script>/.exec(firstPaint)[1];
    expect(seedTagBody).not.toContain("<");
    expect(seedTagBody).toContain("u003c");

    delete window.__PWNED;
    runUnderStrictCsp(firstPaint, `${SCRML_RUNTIME}\n${clientJs}\n`);

    // Round-trips EXACTLY, and nothing in it executed.
    expect(window.__scrml_ssr_state.accounts[0].name).toBe(POISON);
    expect(window.__PWNED).toBeUndefined();
    // The injected `<script>` did not become a real element: the document carries
    // only the seed block itself (the runtime + client chunks are `src=` tags the
    // emitted first paint references, not inline ones).
    const inlineScripts = [...document.querySelectorAll("script")]
      .filter((el) => !el.getAttribute("src"));
    expect(inlineScripts.length).toBe(1);
    expect(inlineScripts[0].id).toBe("__scrml_ssr_state");
  });

  test("EXECUTING: the seed SAVES the /__serverLoad round trip; no seed still falls back to it", async () => {
    const { serverJs, html, clientJs } = compile(SEEDED_APP);
    const firstPaint = await composeFirstPaint(serverJs, html, DB_ROWS);

    // Seeded document — the client must read the data block and skip the fetch.
    const seeded = runUnderStrictCsp(firstPaint, `${SCRML_RUNTIME}\n${clientJs}\n`);
    expect(seeded.fetched.filter((u) => u.includes("__serverLoad"))).toEqual([]);

    // Static-host shape: the same client chunk, a document the SSR route never
    // composed. Nothing to parse, nothing may throw — and the ordinary fetch
    // path runs unchanged (graceful degradation, §52.8).
    const bare = runUnderStrictCsp(
      "<head></head><body><ul></ul></body>",
      `${SCRML_RUNTIME}\n${clientJs}\n`,
    );
    expect(bare.refusedInlineScripts).toEqual([]);
    expect(window.__scrml_ssr_state == null).toBe(true);
    expect(bare.fetched.some((u) => u.includes("__serverLoad"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. the §38 transition keyframes survive `default-src 'self'`
// ---------------------------------------------------------------------------

describe("headers=strict — §38 transitions ship in the stylesheet, not an inline <style>", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
  });

  test("EXECUTING: loading the runtime creates NO <style> element", () => {
    const { clientJs } = compile(TRANSITION_APP);
    expect(document.querySelectorAll("style").length).toBe(0);
    runUnderStrictCsp("<head></head><body></body>", `${SCRML_RUNTIME}\n${clientJs}\n`);
    // Pre-fix this was 1 — the injected keyframe <style> a strict CSP refuses.
    expect(document.querySelectorAll("style").length).toBe(0);
    expect(SCRML_RUNTIME).not.toContain('createElement("style")');
  });

  test("the emitted stylesheet carries the keyframes for the transitions the file uses", () => {
    const { css } = compile(TRANSITION_APP);
    // fade + slide are used; both halves of each pair must be defined, or the
    // class the runtime applies names an animation that does not exist.
    expect(css).toContain("@keyframes scrml-fade-in");
    expect(css).toContain("@keyframes scrml-fade-out");
    expect(css).toContain(".scrml-enter-fade");
    expect(css).toContain(".scrml-exit-fade");
    expect(css).toContain("@keyframes scrml-slide-in");
    expect(css).toContain(".scrml-enter-slide");
    // `fly` is not used by this file — do not ship it.
    expect(css).not.toContain("scrml-fly-in");
  });

  test("a file with no transition directive gets no animation CSS at all", () => {
    const { css } = compile(NO_TRANSITION_APP);
    expect(css).not.toContain("@keyframes scrml-");
    expect(css).not.toContain(".scrml-enter-");
  });

  test("EXECUTING: the runtime still applies the enter/exit classes the stylesheet defines", () => {
    const { clientJs, html, css } = compile(TRANSITION_APP);
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
    const domHtml = "<head></head><body>" +
      (body ? body[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "") +
      "</body>";
    runUnderStrictCsp(domHtml, `${SCRML_RUNTIME}\n${clientJs}\n` +
      `globalThis.__scrml_set__ = _scrml_reactive_set;\n`);

    const cellKey = chunkCellKey(clientJs);
    // Hide → the exit class lands on the fading element. (The enter class is
    // cleared on `animationend`, which happy-dom never fires, so read TOKENS.)
    globalThis.__scrml_set__(cellKey("visible"), false);
    const applied = [...document.querySelectorAll("main p")]
      .flatMap((p) => [...p.classList])
      .filter((c) => c.startsWith("scrml-enter-") || c.startsWith("scrml-exit-"));
    expect(applied).toContain("scrml-exit-fade");

    // Every class the runtime applies must name an animation the stylesheet
    // defines — otherwise the element carries a class and animates nothing.
    // That is precisely the state a strict CSP left the page in before the fix.
    for (const cls of applied) {
      expect(css).toContain("." + cls + " {");
      const kind = cls.replace("scrml-enter-", "").replace("scrml-exit-", "");
      expect(css).toContain("@keyframes scrml-" + kind + "-");
    }
  });
});
