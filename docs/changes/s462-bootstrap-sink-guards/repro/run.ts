// Reproduction runner (s462-bootstrap-sink-guards): compile ONE §66 source with the PURE
// bootstrap (self-host-v2 front end + print.scrml) and EXECUTE the artifact against the
// bootstrap runtime (slice-m1/runtime/runtime.js) in happy-dom. Prints diagnostics, then every
// element with an id and its attributes after load (and after clicking the `--click` targets).
//
//   bun docs/changes/s462-bootstrap-sink-guards/repro/run.ts <file.scrml> [--js] [--click=#a,#b]
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { loadBootstrapModules } from "../../../../scripts/bootstrap-conformance.ts";
import { frontEnd } from "../../../../compiler/self-host-v2/slice-m2/lowered.js";

const ROOT = resolve(import.meta.dir, "../../../..");
const file = process.argv[2];
const showJs = process.argv.includes("--js");
const click = (process.argv.find((a) => a.startsWith("--click=")) ?? "--click=").slice(8).split(",").filter(Boolean);

const boot = await loadBootstrapModules();
const src = readFileSync(file, "utf8");
const fe = frontEnd(boot.mods, [{ path: "app.scrml", src }], "app.scrml");
const diags = [...(fe.parseDiags ?? []), ...(fe.diags ?? []), ...(fe.infos ?? [])];
console.log("DIAGS:", diags.length ? diags.map((d: any) => `${d.code}: ${d.message}`).join("\n       ") : "(none)");
if (!fe.core) { console.log("NO CORE (compile reported an error)"); process.exit(0); }
const out = boot.mods.print.printProgram(fe.core, "program.client.js", "scrml-runtime.js");
if (out.refused?.length) { console.log("PRINT REFUSED:", out.refused); process.exit(0); }
if (showJs) console.log("---- program.client.js ----\n" + out.js + "\n---------------------------");

GlobalRegistrator.register();
const logs: string[] = [];
const origErr = console.error, origWarn = console.warn;
console.error = (...a: any[]) => { logs.push("error: " + a.join(" ")); };
console.warn = (...a: any[]) => { logs.push("warn: " + a.join(" ")); };
const between = (h: string, o: string, c: string) => { const i = h.indexOf(o), j = h.lastIndexOf(c); return i < 0 || j < 0 ? "" : h.slice(i + o.length, j); };
const strip = (s: string) => s.replace(/<script[^>]*><\/script>/g, "");
const doc = (globalThis as any).document;
doc.head.innerHTML = strip(between(out.html, "<head>", "</head>"));
doc.body.innerHTML = strip(between(out.html, "<body>", "</body>")).trim();
const dir = mkdtempSync(join(tmpdir(), "s462-bootrepro-"));
try {
  copyFileSync(join(ROOT, "compiler/self-host-v2/slice-m1/runtime/runtime.js"), join(dir, "scrml-runtime.js"));
  writeFileSync(join(dir, "program.client.js"), out.js);
  await import(join(dir, "scrml-runtime.js"));
  await import(join(dir, "program.client.js"));
  doc.dispatchEvent(new (globalThis as any).Event("DOMContentLoaded", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 5));
  const dump = (when: string) => {
    console.log(`-- ${when}`);
    for (const el of doc.querySelectorAll("[id]")) {
      console.log(`   #${el.id} <${el.tagName.toLowerCase()}> ${JSON.stringify([...el.attributes].filter((a: any) => a.name !== "id").map((a: any) => `${a.name}=${a.value}`))}`);
    }
  };
  dump("after load");
  for (const sel of click) { doc.querySelector(sel)?.click(); await new Promise((r) => setTimeout(r, 5)); }
  if (click.length) dump(`after click ${click.join(",")}`);
} finally {
  console.error = origErr; console.warn = origWarn;
  if (logs.length) console.log("RUNTIME LOG:", logs.join("\n             "));
  rmSync(dir, { recursive: true, force: true });
}
