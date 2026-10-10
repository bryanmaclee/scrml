// Real-browser reproduction (s462-bootstrap-sink-guards): compile ONE §66 source with the PURE
// bootstrap, serve the artifact (page + program.client.js + the bootstrap runtime) over a local
// Bun server, load it in headless Chromium (playwright), and report what EXECUTED:
//   - `window.pwned` after load (a srcdoc payload `<script>parent.pwned = 1</script>` sets it)
//   - any dialog opened after clicking each `--click` target (`javascript:alert(1)` opens one)
//   - every element with an id and its attributes
//
//   bun docs/changes/s462-bootstrap-sink-guards/repro/chrome.ts <file.scrml> [--click=#a,#b]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { loadBootstrapModules } from "../../../../scripts/bootstrap-conformance.ts";
import { frontEnd } from "../../../../compiler/self-host-v2/slice-m2/lowered.js";

const ROOT = resolve(import.meta.dir, "../../../..");
const file = process.argv[2];
const click = (process.argv.find((a) => a.startsWith("--click=")) ?? "--click=").slice(8).split(",").filter(Boolean);

const boot = await loadBootstrapModules();
const fe = frontEnd(boot.mods, [{ path: "app.scrml", src: readFileSync(file, "utf8") }], "app.scrml");
const diags = [...(fe.diags ?? [])]; // fe.diags already holds the parse diagnostics
console.log("DIAGS:", diags.length ? diags.map((d: any) => `${d.code}: ${d.message}`).join("\n       ") : "(none)");
if (!fe.core) { console.log("NO CORE (compile reported an error)"); process.exit(0); }
const out = boot.mods.print.printProgram(fe.core, "program.client.js", "scrml-runtime.js");
if (out.refused?.length) { console.log("PRINT REFUSED:", out.refused); process.exit(0); }

const runtime = readFileSync(join(ROOT, "compiler/self-host-v2/slice-m1/runtime/runtime.js"), "utf8");
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === "/program.client.js") return new Response(out.js, { headers: { "content-type": "text/javascript" } });
    if (p === "/scrml-runtime.js") return new Response(runtime, { headers: { "content-type": "text/javascript" } });
    return new Response(out.html, { headers: { "content-type": "text/html" } });
  },
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const dialogs: string[] = [];
  page.on("dialog", async (d) => { dialogs.push(`${d.type()}(${JSON.stringify(d.message())})`); await d.dismiss(); });
  page.on("console", (m) => console.log(`   console.${m.type()}: ${m.text()}`));
  await page.goto(`http://localhost:${server.port}/`);
  await page.waitForTimeout(300);
  const dump = async (when: string) => {
    console.log(`-- ${when}: window.pwned = ${JSON.stringify(await page.evaluate(() => (window as any).pwned ?? null))}; dialogs = ${JSON.stringify(dialogs)}`);
    const els = await page.evaluate(() => [...document.querySelectorAll("[id]")].map((e) => `#${e.id} <${e.tagName.toLowerCase()}> ${JSON.stringify([...e.attributes].filter((a) => a.name !== "id").map((a) => `${a.name}=${a.value}`))}`));
    for (const e of els) console.log("   " + e);
  };
  await dump("after load");
  for (const sel of click) { await page.click(sel); await page.waitForTimeout(300); }
  if (click.length) await dump(`after click ${click.join(",")}`);
} finally {
  await browser.close();
  server.stop(true);
}
