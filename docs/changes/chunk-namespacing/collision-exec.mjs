// EXECUTED cross-chunk collision check — the generalised form of
// docs/changes/esm-chunks/u4-premise-check/premise-check.mjs.
//
// Loads page A in a real Chromium, then pulls page B's client chunk into the
// LIVE document exactly as a soft-nav loader would, and re-reads A's DOM. If
// anything A rendered changed, B clobbered it.
//
//   bun collision-exec.mjs <dist> <pageA> <pageB> <selector> [--classic]
//
// `--classic` appends a <script src> (what a classic loader does); the default
// is `await import()` (the ESM loader shape). A classic chunk is NOT a module,
// so importing it would hand it module scope it never has in production.
import puppeteer from "puppeteer";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, normalize } from "path";

const [DIST, PAGE_A, PAGE_B, SELECTOR] = process.argv.slice(2);
const CLASSIC = process.argv.includes("--classic");

if (!DIST || !PAGE_A || !PAGE_B || !SELECTOR) {
  console.error("usage: bun collision-exec.mjs <dist> <pageA> <pageB> <selector> [--classic]");
  process.exit(2);
}

function resolveChromePath() {
  if (process.env.SCRML_CHROME) return process.env.SCRML_CHROME;
  const cache = join(process.env.HOME ?? "", ".cache/puppeteer/chrome");
  if (!existsSync(cache)) return undefined;
  for (const build of readdirSync(cache).sort()) {
    const exe = join(cache, build, "chrome-linux64", "chrome");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = Bun.serve({
  port: 0,
  fetch(req) {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === "/") p = "/index.html";
    const f = join(DIST, normalize(p));
    if (!existsSync(f)) return new Response("nf", { status: 404 });
    return new Response(readFileSync(f), {
      headers: { "content-type": TYPES[f.slice(f.lastIndexOf("."))] ?? "application/octet-stream" },
    });
  },
});

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
  executablePath: resolveChromePath(),
});
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`http://localhost:${server.port}/${PAGE_A}.html`, { waitUntil: "networkidle0" });

const read = (sel) =>
  page.evaluate((s) => [...document.querySelectorAll(s)].map((n) => n.outerHTML).join(" | "), sel);

const before = await read(SELECTOR);
await page.evaluate(
  async (chunk, classic) => {
    if (classic) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = chunk;
        s.onload = res;
        s.onerror = rej;
        document.head.appendChild(s);
      });
    } else {
      await import(chunk);
    }
    await new Promise((r) => setTimeout(r, 50));
  },
  `./${PAGE_B}.client.js`,
  CLASSIC,
);
const after = await read(SELECTOR);

console.log(`DIST     : ${DIST}   (${CLASSIC ? "classic" : "esm"})`);
console.log(`selector : ${SELECTOR}`);
console.log(`${PAGE_A} BEFORE : ${before}`);
console.log(`${PAGE_A} AFTER  : ${after}`);
console.log(`page events   : ${logs.length ? "\n  " + logs.join("\n  ") : "(none)"}`);

// An UNCHANGED DOM is only evidence of isolation if B's chunk actually RAN.
// A redeclaration `SyntaxError` (the N3/N4 lexical collision) kills the whole
// chunk before its first statement, so the page looks pristine — the trap this
// check exists to avoid. Score a pageerror as INCONCLUSIVE, never as isolated.
const died = logs.some((l) => l.startsWith("[pageerror]"));
const isolated = before === after && !died;
console.log(
  "\nVERDICT: " +
    (died
      ? `INCONCLUSIVE — ${PAGE_B}'s chunk THREW and never evaluated, so ${PAGE_A} ` +
        `looking untouched proves nothing about isolation`
      : before === after
        ? `${PAGE_A} SURVIVED ${PAGE_B}'s chunk (isolated)`
        : `${PAGE_A} WAS CLOBBERED by ${PAGE_B}'s chunk`),
);

await browser.close();
server.stop(true);
process.exit(isolated ? 0 : 1);
