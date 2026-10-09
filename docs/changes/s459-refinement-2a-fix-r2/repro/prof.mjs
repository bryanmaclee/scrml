// usage: bun prof.mjs <outdir> <patch-js-file?>
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
const out = process.argv[2];
const files = readdirSync(out);
let runtime = readFileSync(resolve(out, files.find((f) => /^scrml-runtime\..*\.js$/.test(f))), "utf8");
const client = readFileSync(resolve(out, "app.client.js"), "utf8");
const html = readFileSync(resolve(out, "app.html"), "utf8");
GlobalRegistrator.register({ url: "http://localhost/" });
globalThis.__cnt = {};
runtime = runtime.replace("function _scrml_refine_path(j, raw, path) {", "function _scrml_refine_path(j, raw, path) { __cnt.path = (__cnt.path||0)+1;")
  .replace("function _scrml_refine_adopt_all(v, key, d, seen) {", "function _scrml_refine_adopt_all(v, key, d, seen) { __cnt.adoptAll = (__cnt.adoptAll||0)+1;")
  .replace("function _scrml_refine_adopt(raw, key, d) {", "function _scrml_refine_adopt(raw, key, d) { __cnt.adopt = (__cnt.adopt||0)+1;");
document.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) ?? [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
(0, eval)("(function () {\n" + runtime + "\n" + client + "\n})()");
document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
for (const id of (process.argv[3] ?? "f,s,u").split(",")) {
  const c0 = JSON.stringify(__cnt);
  const t0 = performance.now();
  document.querySelector("#" + id).click();
  console.log(id, (performance.now() - t0).toFixed(1), "ms", JSON.stringify(__cnt));
  for (const k in __cnt) __cnt[k] = 0;
}
