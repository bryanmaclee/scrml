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

/**
 * Compile N documents into one dist, as multi-input `scrml dev` does. Each dist
 * gets its own subdirectory so scenarios in one test cannot see each other's
 * leftover .html — the "first .html in the serve dir" resolution is order-bearing.
 */
let buildManyN = 0;
function buildMany(files) {
  const tag = `m${buildManyN++}`;
  const inputFiles = Object.entries(files).map(([base, source]) => {
    const input = join(tmpDir, "src", `${tag}-${base}.scrml`);
    writeFileSync(input, source);
    return input;
  });
  const out = join(tmpDir, `out-${tag}`);
  compileScrml({ inputFiles, write: true, outputDir: out, log: () => {} });
  return { out, inputFiles };
}

/**
 * Drive `scrml dev`'s dispatch exactly as the server does: load the compiled routes
 * for THIS dist, then issue an UNAUTHENTICATED request. Reports whether the secret
 * escaped in the body, not merely the status — a gate that 302s is worthless if some
 * other path still returns the markup.
 *
 * `loadServerRoutes` is called HERE rather than left to callers, so the docstring is
 * true by construction instead of by discipline. `registeredProtectedDocs` is
 * module-global and is only reset inside `loadServerRoutes`, so a probe that skipped
 * it would inherit the PREVIOUS test's registry — passing for the wrong reason via a
 * stale guard, in a suite whose entire job is proving a gate fires. Two tests in this
 * file were doing exactly that before this was moved.
 */
async function devProbe(out, path, opts = {}) {
  const { loadServerRoutes, devDispatch } = await import("../../src/commands/dev.js");
  await loadServerRoutes(out);
  const res = await devDispatch(new Request("http://localhost" + path, { headers: {} }), null, out, opts);
  const status = res ? res.status : 0;
  // Read the body UNCONDITIONALLY. Gating this on `status === 200` made `leaked`
  // hard-false for every redirect, so `{ status: 302, leaked: false }` asserted only
  // the status half — a regression that 302d while STILL carrying the rendered markup
  // would have passed this entire suite. The whole point of the probe is that the
  // secret did not escape, in EITHER case.
  const body = res ? await res.clone().text() : "";
  return { status, leaked: /SECRET DASHBOARD/.test(body) };
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
    // devProbe loads this dist's routes itself, so no cross-test registry bleed.
    const probe = (path) => devProbe(out, path);
    // Unauthenticated document requests redirect, no leak.
    expect(await probe("/secure.html")).toEqual({ status: 302, leaked: false });
    // The clean-URL, trailing-slash and double-slash forms all resolve to the
    // protected file and are gated by the one decider.
    expect(await probe("/secure")).toEqual({ status: 302, leaked: false });
    expect(await probe("/secure/")).toEqual({ status: 302, leaked: false });
    expect(await probe("//secure.html")).toEqual({ status: 302, leaked: false });
    // A non-protected sibling asset still serves.
    expect((await probe("/secure.css")).status).toBe(200);
  });

  // ⚑ The case variant, in TWO tests on purpose — the security half must stay hard.
  //
  // Splitting the deliberately-red assertion out of the parity test fixed one hazard
  // (`bun test` aborts a test at the first failed expect(), so four assertions after
  // it were dead code that still read as coverage). Marking it `.failing` fixes the
  // other: a permanently-red security suite can never exit zero, so a REAL regression
  // reports "1 fail" and is indistinguishable at a glance from the known red.
  //
  // But `.failing` passes the suite whenever the body fails FOR ANY REASON. If this
  // path ever started leaking, `leaked` would flip true, the test would fail, and
  // `.failing` would swallow it as expected. So the leak assertion lives in its own
  // HARD test below, and only the STATUS — the part that is genuinely unruled — is
  // marked `.failing`.
  test("a case-variant document path never leaks, whatever status it answers with", async () => {
    const { out } = build(SECURE);
    const res = await devProbe(out, "/SECURE.html");
    // Platform-independent and NOT up for debate: 404 here (case-sensitive FS) or 302
    // (case-insensitive), never the markup. This assertion must never be `.failing`.
    expect(res.leaked).toBe(false);
    expect([302, 404]).toContain(res.status);
  });

  // ⚑ SPLIT OUT, EXPECTED RED on a case-SENSITIVE filesystem (S395 ruling).
  //
  // Protection is decided on the RESOLVED file, so `/SECURE.html` finds no file here
  // and 404s (fail-closed) while a case-INSENSITIVE host resolves it and 302s. Gating
  // the raw request path instead would fix this but reintroduces a SECOND decider,
  // which is what this arc removed. The real question — request path vs resolved file
  // — is filed as its own arc. Declining an unruled fix, NOT a regression: the same
  // red it has on `main`.
  //
  // `.failing` so the suite is GREEN while this is knowingly red, and so it flips
  // LOUDLY ("marked as failing but it passed") the moment the behaviour changes —
  // which is exactly the signal the split-out arc will need when someone rules on it.
  test.failing("`scrml dev` gates a CASE-VARIANT document path (RED on a case-sensitive FS)", async () => {
    const { out } = build(SECURE);
    const res = await devProbe(out, "/SECURE.html");
    expect(res).toEqual({ status: 302, leaked: false });
  });

  // -------------------------------------------------------------------------
  // g-dev-root-path-fallback-serves-a-protected-document-unauthenticated
  //
  // The tests above were the S380 regression net, and they were GREEN while the
  // gate stood wide open on `/` — because they probe `/secure.html` and a case
  // variant and NEVER probe the path an adopter actually visits. `scrml dev`
  // prints `http://localhost:<port>` and nothing else; `/` IS the dev entry
  // point. Everything below probes it.
  // -------------------------------------------------------------------------
  describe("the ROOT path `/` is gated for every way dev resolves it", () => {
    test("entry NOT named index: `GET /` 302s instead of serving the document (the leak)", async () => {
      const { out } = build(SECURE); // dist holds secure.html, no index.html
      // Before the fix this returned 200 with SECRET DASHBOARD in the body: `/`
      // missed index.html in the gated loop and fell into a SECOND, ungated root
      // branch that served whatever .html it found.
      expect(await devProbe(out, "/")).toEqual({ status: 302, leaked: false });
      // ...via the single-input entry-candidate path too (opts carries inputFiles,
      // as the real dev server passes them).
      const inputFiles = [join(tmpDir, "src", "secure.scrml")];
      expect(await devProbe(out, "/", { inputFiles })).toEqual({ status: 302, leaked: false });
    });

    test("entry named index: `GET /` 302s — the CONTROL that was always green", async () => {
      const { out } = build(SECURE, "index"); // dist holds index.html
      // This shape was correct before the fix and must stay correct: it is what
      // proved the gate itself works and localised the defect to root resolution.
      expect(await devProbe(out, "/")).toEqual({ status: 302, leaked: false });
      expect(await devProbe(out, "/index.html")).toEqual({ status: 302, leaked: false });
      const inputFiles = [join(tmpDir, "src", "index.scrml")];
      expect(await devProbe(out, "/", { inputFiles })).toEqual({ status: 302, leaked: false });
    });

    test("multi-input, protected doc sorts FIRST: `GET /` 302s (the readdir-scan path)", async () => {
      // Multi-input has no unambiguous entry, so `/` resolved via the sorted
      // "first .html in dist" scan — which picked the PROTECTED document here and
      // served it. A distinct code path from the single-input entry candidate.
      const { out, inputFiles } = buildMany({
        aaa: SECURE,
        zzz: `<program>\n  <page><h1>Public</h1></page>\n</program>\n`,
      });
      expect(await devProbe(out, "/", { inputFiles })).toEqual({ status: 302, leaked: false });
    });

    test("a PUBLIC document is still served at `/` — the gate did not become a 404", async () => {
      // The fix folds root resolution INTO the gated loop rather than deleting it,
      // so which file dev serves at `/` is unchanged for unprotected documents.
      // Without this assertion, "gate `/`" and "break `/`" look identical.
      const { out, inputFiles } = buildMany({ app: `<program>\n  <page><h1>PUBLIC APP</h1></page>\n</program>\n` });
      expect(await devProbe(out, "/", { inputFiles })).toEqual({ status: 200, leaked: false });
    });

    test("a STALE registry key does not hijack a request another file would serve", async () => {
      // `scrml dev` deliberately never cleans its output dir (the BUG-2 rationale in
      // dev.js), so a `<name>.server.js` can outlive its `.html` and keep a key in the
      // protected-doc registry. Gating on the request path alone made that key answer
      // for `GET /` — 302ing a request that resolution would have satisfied with a
      // DIFFERENT, PUBLIC document. Fail-closed, so never a leak, but a behaviour
      // change against a document that is not even on disk.
      const first = join(tmpDir, "src", "index.scrml");
      writeFileSync(first, SECURE);
      const out = join(tmpDir, "out-stale");
      compileScrml({ inputFiles: [first], write: true, outputDir: out, log: () => {} });
      rmSync(join(out, "index.html"), { force: true }); // .html gone, .server.js stays
      const current = join(tmpDir, "src", "req.scrml");
      writeFileSync(current, `<program>\n  <page><h1>PUBLIC APP</h1></page>\n</program>\n`);
      compileScrml({ inputFiles: [current], write: true, outputDir: out, log: () => {} });

      expect(existsSync(join(out, "index.server.js"))).toBe(true); // the stale key exists
      expect(existsSync(join(out, "index.html"))).toBe(false);     // its document does not
      expect(await devProbe(out, "/", { inputFiles: [current] })).toEqual({ status: 200, leaked: false });
    });

    test("the module has exactly ONE site that serves a document from the serve dir", () => {
      // Structural guard for the defect CLASS, stated as the invariant that actually
      // failed. The leak was an ungated SERVING path — a branch returning rendered
      // HTML without consulting the registry at all. Counting registry READ sites
      // cannot catch that: such a branch adds zero reads and sails straight past.
      // What catches it is a second document-serving site existing at all.
      //
      // Scanned MODULE-WIDE, not within devDispatch's text, so it keeps biting when
      // serving is extracted into a helper — the same refactor this arc performed for
      // candidate enumeration would have made a function-scoped scan silently vacuous.
      //
      // Two call sites are expected, and they are not interchangeable:
      //   1. the compile-error page — built in memory, never a serve-dir file, so it
      //      cannot carry a protected document;
      //   2. the gated static loop — the only path that reads a file from the serve
      //      dir and returns it as HTML.
      // A THIRD is the shape of the bug this arc closed (on `main` this count is 4:
      // the two above plus the deleted root branch's two ungated serving paths).
      const src = readFileSync(join(import.meta.dir, "../../src/commands/dev.js"), "utf8");
      // Match the SERVING form specifically — `return new Response(injectHotReloadScript(`
      // — not every mention of the name. A bare name match counts prose: a JSDoc
      // `@see injectHotReloadScript()` would fail this security test with a message
      // about a third serving path that does not exist.
      const callSites = src
        .split("\n")
        .map((l, i) => ({ n: i + 1, l }))
        .filter(({ l }) => /return new Response\(injectHotReloadScript\(/.test(l));
      expect(callSites.map(({ n, l }) => `${n}: ${l.trim()}`)).toHaveLength(2);
    });

    test("the protected-document registry is consulted from exactly ONE function", () => {
      // Narrower claim than the test above, and stated as what it actually checks:
      // it does NOT catch an ungated serving path (that is the test above). It keeps
      // the lookup — key normalisation, the lowercase casing rule, the on-disk
      // check — in one place so those rules cannot drift between call sites.
      const src = readFileSync(join(import.meta.dir, "../../src/commands/dev.js"), "utf8");
      const lines = src.split("\n");
      const start = lines.findIndex((l) => l.startsWith("function gateProtectedDoc"));
      expect(start).toBeGreaterThan(-1);
      const end = start + 1 + lines.slice(start + 1).findIndex((l) => l === "}");
      const readsInGate = [];
      const readsElsewhere = [];
      lines.forEach((l, i) => {
        if (!/registeredProtectedDocs\.(get|size|has)/.test(l)) return;
        (i >= start && i <= end ? readsInGate : readsElsewhere).push(`${i + 1}: ${l.trim()}`);
      });
      expect(readsInGate.length).toBeGreaterThan(0);
      expect(readsElsewhere).toEqual([]);
    });
  });

  test("a NON-auth program gets no protected-document wiring (output unchanged)", () => {
    const { mods, entry } = build(`<program>\n  <page><h1>Public</h1></page>\n</program>\n`, "public");
    expect(mods.every((m) => !m.protectedDocument)).toBe(true);
    expect(entry).not.toContain("_SCRML_PROTECTED_DOCS");
    expect(entry).not.toContain("_scrml_protected_document");
  });
});
