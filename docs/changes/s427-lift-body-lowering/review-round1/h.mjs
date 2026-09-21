// usage: bun h.mjs <worktree> <file.scrml> <scenario.mjs>
import { resolve, basename } from "path";
import { readFileSync, mkdirSync, rmSync } from "fs";
const [wt, src, scen] = process.argv.slice(2);
const { GlobalRegistrator } = await import(resolve(wt, "node_modules/@happy-dom/global-registrator/lib/index.js")).catch(async()=>await import(resolve(wt,"node_modules/@happy-dom/global-registrator/cjs/index.cjs")));
GlobalRegistrator.register();
const { compileScrml } = await import(resolve(wt, "compiler/src/api.js"));
const { captureInsideChunkScope } = await import(resolve(wt, "compiler/tests/helpers/chunk-scope.js"));
const base = basename(src, ".scrml");
const out = resolve(process.env.OUTDIR || resolve(wt, "..", "rvh", "out-" + basename(wt) + "-" + base));
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
const result = compileScrml({ inputFiles: [resolve(src)], write: true, outputDir: out, log: () => {} });
const errors = (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error");
if (errors.length) console.log("COMPILE ERRORS", errors.map(e=>e.code+" "+e.message).join("\n"));
const html = readFileSync(resolve(out, `${base}.html`), "utf8");
const clientJs = readFileSync(resolve(out, `${base}.client.js`), "utf8");
const runtimeName = /scrml-runtime\.[A-Za-z0-9]+\.js/.exec(html)?.[0] ?? result.runtimeFilename ?? "scrml-runtime.js";
const runtimeJs = readFileSync(resolve(out, runtimeName), "utf8").replace("function _scrml_resolve_item(", "function _scrml_resolve_item(...a){ globalThis.__rc=(globalThis.__rc||0)+1; return _scrml_resolve_item_real(...a); }\nfunction _scrml_resolve_item_real(");
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
document.body.innerHTML = (bodyMatch ? bodyMatch[1] : html).replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();
const fetches = [];
globalThis.fetch = window.fetch = (u, o) => { fetches.push(String(u)); return Promise.resolve(new Response(JSON.stringify(globalThis.__fetchReply ?? "SRV"), {headers:{"content-type":"application/json"}})); };
const errs = []; const oe = console.error; console.error = (...a) => { errs.push(a.map(String).join(" ")); };
let initError = null;
try {
  new Function("window","document", `${runtimeJs}\n` + captureInsideChunkScope(clientJs, "globalThis.__g = _scrml_reactive_get; globalThis.__s = _scrml_reactive_set; globalThis.__subs = (typeof _scrml_prop_subscribers!=='undefined')?_scrml_prop_subscribers:null;\n"))(window, document);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
} catch (e) { initError = e; }
const dom = () => { const c = document.body.cloneNode(true); c.querySelectorAll("template").forEach(t=>t.remove()); return c.innerHTML.replace(/<!--[^>]*-->/g,"").replace(/\s+/g," ").trim(); };
const log = (tag) => console.log(`[${tag}] ${dom()}`);
console.log("initError:", initError && String(initError));
const app = { get: (n)=>globalThis.__g(n), set: (n,v)=>globalThis.__s(n,v), fetches, errs, dom, log, tick: () => new Promise(r=>setTimeout(r,20)) };
log("init");
if (scen) { const m = await import(resolve(scen)); await m.run(app); }
await app.tick();
console.log("console.error:", JSON.stringify(errs));
console.log("fetches:", JSON.stringify(fetches));
process.exit(0);
