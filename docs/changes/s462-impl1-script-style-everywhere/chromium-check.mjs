// S462 — Chromium check for the three lift forms of the §4.17 hole.
//
// usage: bun docs/changes/s462-impl1-script-style-everywhere/chromium-check.mjs <compiler-root> <scratch-dir>
//   <compiler-root> — a checkout whose compiler/src/api.js is the compiler under test
//                     (a `git archive` of the base commit, or this worktree)
//   <scratch-dir>   — where the three programs and their dist/ are written
//
// For each form: compile; if the compile writes an artifact, serve it and load it in real
// Chromium (Playwright's chromium from node_modules), then report whether the cell data ran
// as JavaScript (`window.pwned`), whether the data-chosen `/evil.js` was requested and ran,
// and whether the cell data was applied as CSS (body background). A refused compile writes
// nothing — that is the fixed outcome.
import fs from "fs";
import path from "path";

const [ROOT, OUT] = process.argv.slice(2);
if (!ROOT || !OUT) { console.error("usage: chromium-check.mjs <compiler-root> <scratch-dir>"); process.exit(2); }
const { compileScrml } = await import(path.resolve(ROOT, "compiler/src/api.js"));
const { chromium } = await import(path.resolve(import.meta.dir, "../../../node_modules/playwright-core/index.mjs"));

const forms = {
  "lift-script-body": `<program>\n<code> = "window.pwned=7"\n<p id="ok">ok</p>\n\${ lift <script>\${@code}</script> }\n</program>\n`,
  "lift-script-src": `<program>\n<u> = "/evil.js"\n<p id="ok">ok</p>\n\${ lift <script src=@u></script> }\n</program>\n`,
  "lift-style-body": `<program>\n<code> = "body{background-color:rgb(1, 2, 3)}"\n<p id="ok">ok</p>\n\${ lift <style>\${@code}</style> }\n</program>\n`,
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const [name, src] of Object.entries(forms)) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "app.scrml");
  fs.writeFileSync(file, src);
  const dist = path.join(dir, "dist");
  const r = compileScrml({ inputFiles: [file], outputDir: dist, write: true, log: () => {} });
  const errs = (r.errors || []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code);
  if (!fs.existsSync(path.join(dist, "app.html"))) {
    console.log(`${name.padEnd(18)} compile-errors=${JSON.stringify(errs)} -> REFUSED at compile time (no artifact)`);
    continue;
  }
  let evilRequested = false;
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/evil.js") {
        evilRequested = true;
        return new Response("window.evilLoaded = 1;", { headers: { "content-type": "text/javascript" } });
      }
      const p = path.join(dist, u.pathname === "/" ? "app.html" : u.pathname.slice(1));
      if (!fs.existsSync(p)) return new Response("not found", { status: 404 });
      const ct = p.endsWith(".js") ? "text/javascript" : p.endsWith(".html") ? "text/html" : p.endsWith(".css") ? "text/css" : "application/octet-stream";
      return new Response(fs.readFileSync(p), { headers: { "content-type": ct } });
    },
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForTimeout(800);
  const res = await page.evaluate(() => ({
    pwned: window.pwned ?? null,
    evilLoaded: window.evilLoaded ?? null,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  console.log(`${name.padEnd(18)} compile-errors=${JSON.stringify(errs)} RAN: pwned=${res.pwned} evilRequested=${evilRequested} evilLoaded=${res.evilLoaded} bodyBg=${res.bg}`);
  await page.close();
  server.stop(true);
}
await browser.close();
