// R26-grade premise check: does ES-module scope dissolve the S279 cross-chunk
// collision? Loads the REAL emitted --module-format=esm artifacts in a REAL
// Chromium, then performs exactly the import() a nav-time chunk loader would.
import puppeteer from "puppeteer";
import { readFileSync, existsSync } from "fs";
import { join, normalize } from "path";

const DIST = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === "/") p = "/index.html";
    const f = join(DIST, normalize(p));
    if (!existsSync(f)) return new Response("nf", { status: 404 });
    const ext = f.slice(f.lastIndexOf("."));
    return new Response(readFileSync(f), {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  },
});
const base = `http://localhost:${server.port}`;

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], executablePath: "/home/bryan/.cache/puppeteer/chrome/linux-146.0.7680.153/chrome-linux64/chrome" });
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("response", (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto(`${base}/alpha.html`, { waitUntil: "networkidle0" });

const before = await page.evaluate(() => ({
  rows: [...document.querySelectorAll("li")].map((n) => n.textContent),
  h2: document.querySelector("h2")?.textContent,
}));

// === exactly what a U4 import()-based nav loader does for a cross-chunk target:
// dynamic-import the target route's client chunk into the LIVE document.
const after = await page.evaluate(async () => {
  await import("./beta.client.js");
  await new Promise((r) => setTimeout(r, 50));
  return {
    rows: [...document.querySelectorAll("li")].map((n) => n.textContent),
    h2: document.querySelector("h2")?.textContent,
  };
});

console.log("DIST                :", DIST);
console.log("alpha BEFORE import :", JSON.stringify(before));
console.log("alpha AFTER  import :", JSON.stringify(after));
console.log("console/page events :", logs.length ? logs.join("\n  ") : "(none)");
console.log(
  "\nVERDICT: alpha's rendered rows " +
    (JSON.stringify(before.rows) === JSON.stringify(after.rows)
      ? "SURVIVED (module scope isolated the chunks)"
      : "WERE CLOBBERED by beta's chunk (module scope did NOT isolate)"),
);

await browser.close();
server.stop(true);
