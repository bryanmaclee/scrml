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

describe("adopter-#82 — cache-header contract", () => {
  test("generated production _server.js carries the cache-header policy", () => {
    const server = generateServerEntry([]);
    expect(server).toContain("_scrml_cache_headers");
    expect(server).toContain("public, max-age=31536000, immutable");
    expect(server).toContain('"no-cache"');
    // Content-hashed pattern gate + conditional 304 handling.
    expect(server).toContain("[0-9a-z]{8}");
    expect(server).toContain("if-none-match");
    expect(server).toContain("status: 304");
  });

  test("devCacheHeaders — hashed asset is immutable (no validator)", () => {
    const h = devCacheHeaders("app.client.00q16rig.js", { size: 42, mtimeMs: 1_700_000_000_000 });
    expect(h["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(h.ETag).toBeUndefined();
  });

  test("devCacheHeaders — non-hashed static asset revalidates (no-cache + ETag + Last-Modified)", () => {
    const size = 42, mtimeMs = 1_700_000_000_000;
    const h = devCacheHeaders("app.client.js", { size, mtimeMs });
    expect(h["Cache-Control"]).toBe("no-cache");
    expect(h.ETag).toBe('"' + size.toString(16) + "-" + Math.floor(mtimeMs).toString(16) + '"');
    expect(h["Last-Modified"]).toBe(new Date(mtimeMs).toUTCString());
  });
});
