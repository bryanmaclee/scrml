/**
 * §52.13 — an `auth="required"` scope's own served .html document must be gated.
 *
 * Regression for g-auth-required-does-not-protect-the-served-html-document
 * (S365-bryan, PA-reproduced; fixed S380-peter):
 *
 *   `<program auth="required"><page>…</page></program>` renders its page content
 *   into a static <base>.html. The per-route `_scrml_auth_check` only guards
 *   server FUNCTIONS; the document is served by the build's `_server.js`
 *   static-file dispatch, which had no auth context — so an unauthenticated
 *   GET /<base>.html returned 200 with the rendered markup, against §52.13's
 *   verbatim "every request to this scope SHALL be authenticated; unauthenticated
 *   requests are redirected to loginRedirect".
 *
 * The fix: the auth module exports `_scrml_protected_document = { guard }`
 * (reusing its own `_scrml_auth_check`); `discoverServerRoutes` derives the
 * protected .html path from the module filename; `generateServerEntry` mounts the
 * guard in the static dispatch so an unauthenticated document request 302s to
 * loginRedirect BEFORE the file is served.
 *
 * These assertions are deterministic (no server spawn): the guard is driven
 * directly and the generated entry is inspected. An end-to-end run (real
 * Bun.serve, unauth GET → 302, non-protected asset → 200) was verified by hand at
 * the fix; kept out of CI to avoid a port-binding flake.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { compileScrml } from "../../src/api.js";
import { discoverServerRoutes, generateServerEntry } from "../../src/commands/build.js";

let tmpDir;
beforeEach(() => {
  tmpDir = join(tmpdir(), `scrml-auth-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmpDir, "src"), { recursive: true });
});
afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function build(source, base = "secure") {
  const input = join(tmpDir, "src", `${base}.scrml`);
  writeFileSync(input, source);
  const out = join(tmpDir, "out");
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  const mods = discoverServerRoutes(out);
  const entry = generateServerEntry(mods);
  return { out, base, result: r, mods, entry };
}

describe("§52.13 — auth-required document is gated in the served-document dispatch", () => {
  const SECURE = `<program auth="required">\n  <page><h1>SECRET DASHBOARD</h1></page>\n</program>\n`;

  test("the auth module exports a protected-document guard that 302s an unauthenticated request", async () => {
    const { out } = build(SECURE);
    const serverJs = readFileSync(join(out, "secure.server.js"), "utf8");
    expect(serverJs).toContain("export const _scrml_protected_document");

    const mod = await import(pathToFileURL(join(out, "secure.server.js")).href);
    expect(typeof mod._scrml_protected_document?.guard).toBe("function");

    // Unauthenticated (no session cookie) → redirect to loginRedirect, NOT served.
    const gate = mod._scrml_protected_document.guard(new Request("http://localhost/secure.html", { headers: {} }));
    expect(gate).toBeInstanceOf(Response);
    expect(gate.status).toBe(302);
    expect(gate.headers.get("Location")).toBe("/login");
  });

  test("discoverServerRoutes derives the protected .html path from the module filename", () => {
    const { mods } = build(SECURE);
    const pd = mods.find((m) => m.protectedDocument);
    expect(pd).toBeDefined();
    expect(pd.protectedDocument).toBe("secure.html");
  });

  test("generateServerEntry mounts the guard in the static dispatch for the protected document", () => {
    const { entry } = build(SECURE);
    // The registry maps the served .html to its module's guard...
    expect(entry).toContain("_SCRML_PROTECTED_DOCS = new Map");
    expect(entry).toMatch(/\["secure\.html", _scrml_pd_0\.guard\]/);
    // ...and the static-file branch consults it BEFORE serving (or 304-ing) the file.
    expect(entry).toContain("_SCRML_PROTECTED_DOCS.get(rel.toLowerCase())");
    expect(entry).toContain("if (_scrml_doc_gate) return _scrml_doc_gate;");
  });

  test("the gate matches case-insensitively (no /SECURE.html bypass on a case-insensitive FS)", () => {
    const { entry } = build(SECURE);
    // On a case-insensitive filesystem the OS resolves `GET /SECURE.html` to the
    // `secure.html` file, but `rel` keeps the request casing. A case-exact map
    // would miss and LEAK the document (verified by hand: /SECURE.html + /Secure.HTML
    // returned 200 with the secret before this). Key + lookup are both lowercased.
    expect(entry).toMatch(/\["secure\.html", _scrml_pd_0\.guard\]/); // key already lowercase
    expect(entry).toContain("rel.toLowerCase()");
  });

  test("the guard is NOT leaked into the route registry (discoverServerRoutes excludes it)", () => {
    const { mods } = build(SECURE);
    const mod = mods.find((m) => m.filename.includes("secure"));
    // Regression for the S239 finding: `_scrml_protected_document` must NOT be a
    // route (it is a `{guard}` object, not `{path,method,handler}`) — else it is
    // double-imported and pushed into the `routes` array as a malformed entry.
    expect(mod.routeNames).not.toContain("_scrml_protected_document");
    const { entry } = build(SECURE);
    expect(entry).not.toMatch(/\{ _scrml_protected_document,/); // no bare double-import
  });

  test("`scrml dev` gates the auth-required document too (dev/prod parity)", async () => {
    const { out } = build(SECURE);
    // dev.js keeps module-level route state; import lazily and drive devDispatch.
    const { loadServerRoutes, devDispatch } = await import("../../src/commands/dev.js");
    await loadServerRoutes(out);
    const probe = async (path) => {
      const res = await devDispatch(new Request("http://localhost" + path, { headers: {} }), null, out, {});
      const body = res && res.status === 200 ? await res.clone().text() : "";
      return { status: res ? res.status : 0, leaked: /SECRET DASHBOARD/.test(body) };
    };
    // Unauthenticated document requests (incl. a case variant) redirect, no leak.
    expect(await probe("/secure.html")).toEqual({ status: 302, leaked: false });
    expect(await probe("/SECURE.html")).toEqual({ status: 302, leaked: false });
    // A non-protected sibling asset still serves.
    expect((await probe("/secure.css")).status).toBe(200);
  });

  test("a NON-auth program gets no protected-document wiring (output unchanged)", () => {
    const { mods, entry } = build(`<program>\n  <page><h1>Public</h1></page>\n</program>\n`, "public");
    expect(mods.every((m) => !m.protectedDocument)).toBe(true);
    expect(entry).not.toContain("_SCRML_PROTECTED_DOCS");
    expect(entry).not.toContain("_scrml_protected_document");
  });
});
