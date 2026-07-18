/**
 * adopter-#82 — content-addressed page bundles + CSS, and the cache-header
 * contract on both serve paths. SPEC §47.9.8.
 *
 * The bug: the shared runtime was content-hashed (`scrml-runtime.<hash>.js`),
 * but per-page bundles (`<base>.client.js`) and CSS (`<base>.css`) were emitted
 * UNHASHED and referenced unhashed, and neither `scrml dev` nor the generated
 * production server sent cache headers — so after a redeploy a browser could
 * silently run a cached stale bundle against a new server.
 *
 * The fix (gated on `contentHashAssets`, which `scrml build` enables):
 *   1. `scrml build` names page bundles `<base>.client.<hash>.js` and CSS
 *      `<base>.<hash>.css`, and rewrites the emitted HTML refs to match.
 *   2. A dependency shared across N pages resolves to the SAME hashed name in
 *      every referrer (the hash is a property of the target bytes).
 *   3. The `_scrml_modules` cross-file registry key stays the LOGICAL unhashed
 *      id — only the `<script src>` URL carries the hash.
 *   4. The default (compile/dev) path is byte-unchanged (unhashed names).
 *   5. Both `scrml dev` (devCacheHeaders) and the generated `_server.js`
 *      (generateServerEntry) attach the cache-header policy.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { generateServerEntry } from "../../src/commands/build.js";
import { devCacheHeaders } from "../../src/commands/dev.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "i82-"));
});
afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

// A flat 2-page app where both pages import a shared dep. `home` also carries a
// `#{}` CSS block so a per-page CSS artifact is emitted.
function writeApp(dir) {
  const root = join(TMP, dir);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "shared.scrml"),
    'export fn greet(name: text) -> text {\n  return "Hi " + name\n}\n');
  writeFileSync(join(root, "home.scrml"),
    'import { greet } from "./shared.scrml"\n<page>\n  <h1 class="title">Home</h1>\n  <p>{greet("home")}</p>\n</page>\n#{\n  .title { color: red; }\n}\n');
  writeFileSync(join(root, "about.scrml"),
    'import { greet } from "./shared.scrml"\n<page>\n  <h1>About</h1>\n  <p>{greet("about")}</p>\n</page>\n');
  return { root, home: join(root, "home.scrml"), about: join(root, "about.scrml") };
}

const HASH = "[0-9a-z]{8}";
function findOne(dir, re) {
  return readdirSync(dir).find((f) => re.test(f));
}

describe("adopter-#82 — content-addressed asset names (build path)", () => {
  test("page bundles + CSS carry a content hash; HTML refs rewritten; no unhashed app-bundle ref remains", () => {
    const app = writeApp("build-a");
    const outDir = join(app.root, "dist");
    const result = compileScrml({
      inputFiles: [app.home, app.about],
      outputDir: outDir,
      write: true,
      contentHashAssets: true,
      log: () => {},
    });
    expect(result.errors).toEqual([]);

    // (a) Hashed artifacts on disk; no unhashed page bundle / CSS.
    const homeClient = findOne(outDir, new RegExp(`^home\\.client\\.${HASH}\\.js$`));
    const aboutClient = findOne(outDir, new RegExp(`^about\\.client\\.${HASH}\\.js$`));
    const sharedClient = findOne(outDir, new RegExp(`^shared\\.client\\.${HASH}\\.js$`));
    const homeCss = findOne(outDir, new RegExp(`^home\\.${HASH}\\.css$`));
    expect(homeClient).toBeTruthy();
    expect(aboutClient).toBeTruthy();
    expect(sharedClient).toBeTruthy();
    expect(homeCss).toBeTruthy();
    expect(existsSync(join(outDir, "home.client.js"))).toBe(false);
    expect(existsSync(join(outDir, "home.css"))).toBe(false);

    // (b) HTML references the hashed names, and NO unhashed app-bundle/CSS ref.
    const homeHtml = readFileSync(join(outDir, "home.html"), "utf8");
    expect(homeHtml).toContain(`src="${homeClient}"`);
    expect(homeHtml).toContain(`src="${sharedClient}"`);
    expect(homeHtml).toContain(`href="${homeCss}"`);
    // No unhashed `.client.js` / `.css` refs survive (the hashed runtime ref
    // `scrml-runtime.<hash>.js` is not a `.client.js`/`.css` tail, so it's fine).
    const unhashedRefs = (homeHtml.match(/(?:src|href)="[^"]*\.(?:client\.js|css)"/g) || [])
      .filter((r) => !new RegExp(`\\.${HASH}\\.(?:js|css)"$`).test(r));
    expect(unhashedRefs).toEqual([]);

    // (c) CRITICAL #2 — the shared dep resolves to the SAME hashed name in both
    //     page HTMLs.
    const aboutHtml = readFileSync(join(outDir, "about.html"), "utf8");
    expect(aboutHtml).toContain(`src="${sharedClient}"`);

    // (d) CRITICAL #1 — the `_scrml_modules` registry key stays the LOGICAL
    //     unhashed id; only the `<script src>` URL carries the hash.
    const sharedJs = readFileSync(join(outDir, sharedClient), "utf8");
    expect(sharedJs).toContain('_scrml_modules["shared.client.js"]');
    expect(sharedJs).not.toContain(sharedClient); // no self-referential hashed key
  });

  test("source-map sibling + embedded sourceMappingURL track the hashed js name", () => {
    const app = writeApp("build-sm");
    const outDir = join(app.root, "dist");
    const result = compileScrml({
      inputFiles: [app.home, app.about],
      outputDir: outDir,
      write: true,
      contentHashAssets: true,
      sourceMap: true,
      log: () => {},
    });
    expect(result.errors).toEqual([]);
    const homeClient = findOne(outDir, new RegExp(`^home\\.client\\.${HASH}\\.js$`));
    const hash = homeClient.match(new RegExp(`^home\\.client\\.(${HASH})\\.js$`))[1];
    expect(existsSync(join(outDir, `home.client.${hash}.js.map`))).toBe(true);
    const js = readFileSync(join(outDir, homeClient), "utf8");
    expect(js).toContain(`sourceMappingURL=home.client.${hash}.js.map`);
    expect(js).not.toContain("sourceMappingURL=home.client.js.map");
  });

  test("default path (no flag) is byte-unchanged — unhashed names, no hashed variant", () => {
    const app = writeApp("compile-b");
    const outDir = join(app.root, "dist");
    const result = compileScrml({
      inputFiles: [app.home, app.about],
      outputDir: outDir,
      write: true,
      log: () => {},
    });
    expect(result.errors).toEqual([]);
    expect(existsSync(join(outDir, "home.client.js"))).toBe(true);
    expect(existsSync(join(outDir, "home.css"))).toBe(true);
    expect(findOne(outDir, new RegExp(`^home\\.client\\.${HASH}\\.js$`))).toBeUndefined();
    const homeHtml = readFileSync(join(outDir, "home.html"), "utf8");
    expect(homeHtml).toContain('src="home.client.js"');
    expect(homeHtml).toContain('href="home.css"');
  });
});

describe("adopter-#82 — hashed refs resolve under a nested pages/ layout (FIX 5d)", () => {
  test("nested page's own hashed client.js + css refs point at real emitted files", () => {
    const root = join(TMP, "nested");
    mkdirSync(join(root, "pages", "a"), { recursive: true });
    mkdirSync(join(root, "pages", "b"), { recursive: true });
    // Two standalone <page>s in distinct nested dirs → dist/a/, dist/b/ (pages/ stripped).
    const pageSrc = (label) =>
      `<page>\n  <h1 class="t">${label}</h1>\n</page>\n#{\n  .t { color: blue; }\n}\n`;
    const a = join(root, "pages", "a", "home.scrml");
    const b = join(root, "pages", "b", "home.scrml");
    writeFileSync(a, pageSrc("A"));
    writeFileSync(b, pageSrc("B"));
    const outDir = join(root, "dist");
    const result = compileScrml({
      inputFiles: [a, b],
      outputDir: outDir,
      write: true,
      contentHashAssets: true,
      log: () => {},
    });
    expect(result.errors).toEqual([]);

    // Nested dist dirs exist (pages/ stripped).
    expect(existsSync(join(outDir, "a", "home.html"))).toBe(true);
    const html = readFileSync(join(outDir, "a", "home.html"), "utf8");
    // Own refs are hashed AND same-dir; each must resolve to a real emitted file.
    const clientRef = html.match(/src="(home\.client\.[0-9a-z]{8}\.js)"/);
    const cssRef = html.match(/href="(home\.[0-9a-z]{8}\.css)"/);
    expect(clientRef).toBeTruthy();
    expect(cssRef).toBeTruthy();
    expect(existsSync(join(outDir, "a", clientRef[1]))).toBe(true);
    expect(existsSync(join(outDir, "a", cssRef[1]))).toBe(true);
  });
});

describe("adopter-#82 — dev cache predicate (precise, no shape guess)", () => {
  const st = { size: 42, mtimeMs: 1_700_000_000_000 };

  test("runtime + per-route chunks are immutable (the only forms dev hashes)", () => {
    for (const p of [
      "scrml-runtime.00q16rig.js",
      "dist/scrml-runtime.00q16rig.js",
      "dashboard/anon.tier1.abcd1234.js",
      "load/driver.initial.00000abc.js",
      "x/y.tierN0.zzzz9999.js",
    ]) {
      expect(devCacheHeaders(p, st)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    }
  });

  test("FIX 1 — a dotted-but-UNHASHED name is NOT frozen (revalidates)", () => {
    // These match the OLD `.<8>.(js|css)` shape guess but are NOT things dev
    // content-hashes → they MUST revalidate, not go immutable.
    for (const p of ["app.settings.js", "blog.defaults.css", "app.client.00q16rig.js", "home.00q16rig.css"]) {
      const h = devCacheHeaders(p, st);
      expect(h["Cache-Control"]).toBe("no-cache");
      expect(h.ETag).toBe('W/"' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + '"');
      expect(h["Last-Modified"]).toBe(new Date(st.mtimeMs).toUTCString());
    }
  });

  test("FIX 4 — validator is a WEAK ETag", () => {
    expect(devCacheHeaders("plain.js", st).ETag.startsWith('W/"')).toBe(true);
  });
});

describe("adopter-#82 — prod immutable by exact set membership (FIX 1)", () => {
  test("compileScrml.hashedAssets is the exact content-addressed set; a same-shaped unhashed name is excluded", () => {
    const app = writeApp("prod-set");
    const outDir = join(app.root, "dist");
    const result = compileScrml({
      inputFiles: [app.home, app.about],
      outputDir: outDir,
      write: true,
      contentHashAssets: true,
      log: () => {},
    });
    expect(result.errors).toEqual([]);
    const set = new Set(result.hashedAssets);
    const homeClient = findOne(outDir, new RegExp(`^home\\.client\\.${HASH}\\.js$`));
    const homeCss = findOne(outDir, new RegExp(`^home\\.${HASH}\\.css$`));
    // Genuinely-hashed artifacts ARE in the set (dist-relative POSIX form)…
    expect(set.has(homeClient)).toBe(true);
    expect(set.has(homeCss)).toBe(true);
    expect(result.hashedAssets.some((p) => /^scrml-runtime\.[0-9a-z]{8}\.js$/.test(p))).toBe(true);
    // …a dotted-but-UNHASHED name is NOT (shape ≠ membership).
    expect(set.has("app.settings.js")).toBe(false);
    // The emitted server bakes the SAME set into `_SCRML_IMMUTABLE`.
    const server = generateServerEntry([], null, 120, result.hashedAssets);
    expect(server).toContain(`_SCRML_IMMUTABLE = new Set(`);
    expect(server).toContain(JSON.stringify(homeClient));
    expect(server).not.toContain('"app.settings.js"');
  });

  test("generated _server.js honors INM + IMS symmetrically (FIX 2/3) with a weak validator (FIX 4)", () => {
    const server = generateServerEntry([], null, 120, ["app.abcd1234.js"]);
    expect(server).toContain("_SCRML_IMMUTABLE");
    expect(server).toContain("public, max-age=31536000, immutable");
    expect(server).toContain('"no-cache"');
    expect(server).toContain('W/"'); // weak ETag
    expect(server).toContain("Last-Modified");
    expect(server).toContain("if-none-match");
    expect(server).toContain("if-modified-since");
    expect(server).toContain("status: 304");
    // No filename-shape immutability guess remains.
    expect(server).not.toContain("[0-9a-z]{8}");
  });
});

describe("adopter-#82 — prod _scrml_cache_headers decisions (FIX 1/2/4, evaluated in-process)", () => {
  // Evaluate the ACTUAL emitted policy (the `_SCRML_IMMUTABLE` set + the two
  // helper fns) directly — deterministic, no subprocess. The live 304
  // round-trip (INM + IMS) is covered by the string-branch assertions above and
  // exercised empirically against a spawned `_server.js`.
  function loadPolicy(hashedAssets) {
    const src = generateServerEntry([], null, 120, hashedAssets);
    const start = src.indexOf("const _SCRML_IMMUTABLE");
    const end = src.indexOf("// Production server", start);
    const snippet = src.slice(start, end);
    return new Function(
      `${snippet}\nreturn { _scrml_cache_headers, _scrml_etag, _SCRML_IMMUTABLE };`,
    )();
  }

  const st = { size: 22, mtimeMs: 1_700_000_000_000 };

  test("immutable IFF the dist-relative path is in the set", () => {
    const pol = loadPolicy(["app.abcd1234.js", "customer/loads.client.deadbeef.js"]);
    expect(pol._scrml_cache_headers("app.abcd1234.js", st)["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(pol._scrml_cache_headers("customer/loads.client.deadbeef.js", st)["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    // Same 8-char-dotted SHAPE but NOT in the set → revalidate, not frozen.
    const dotted = pol._scrml_cache_headers("app.settings.js", st);
    expect(dotted["Cache-Control"]).toBe("no-cache");
    expect(dotted.ETag).toBe('W/"' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + '"');
    expect(dotted["Last-Modified"]).toBe(new Date(st.mtimeMs).toUTCString());
    // A shape-matching name absent from the set is NOT immutable either.
    expect(pol._scrml_cache_headers("vendor.12345678.js", st)["Cache-Control"]).toBe("no-cache");
  });

  test("HTML entry → no-cache; validator is a WEAK ETag", () => {
    const pol = loadPolicy([]);
    expect(pol._scrml_cache_headers("index.html", st)["Cache-Control"]).toBe("no-cache");
    expect(pol._scrml_etag(st).startsWith('W/"')).toBe(true);
  });
});
