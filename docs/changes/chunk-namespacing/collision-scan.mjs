// Enumerate the "unit-scoped token" surface of two coexisting chunks and report
// the intersection. Anything in the intersection collides at runtime.
import { readFileSync } from "fs";
import { join } from "path";
import * as acorn from "acorn";

const DIST = process.argv[2];
const A = process.argv[3] ?? "alpha";
const B = process.argv[4] ?? "beta";

const STORE_FNS = new Set([
  "_scrml_reactive_get", "_scrml_reactive_set", "_scrml_init_set", "_scrml_init_get",
  "_scrml_derived_declare", "_scrml_derived_get", "_scrml_replay", "_scrml_error_boundary_log",
]);

function tokensOf(name) {
  const js = readFileSync(join(DIST, `${name}.client.js`), "utf8");
  const html = readFileSync(join(DIST, `${name}.html`), "utf8");
  const out = { topLevel: new Set(), cellKeys: new Set(), registryKeys: new Set(), htmlMarkers: new Set() };

  let ast;
  try {
    ast = acorn.parse(js, { ecmaVersion: 2022, sourceType: "module" });
  } catch (e) {
    ast = acorn.parse(js, { ecmaVersion: 2022, sourceType: "script" });
  }
  for (const n of ast.body) {
    if (n.type === "FunctionDeclaration" && n.id) out.topLevel.add(n.id.name);
    if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") out.topLevel.add(d.id.name);
    if (n.type === "ClassDeclaration" && n.id) out.topLevel.add(n.id.name);
  }
  // cell-store keys + registry keys, textual (all first args are literals — measured)
  for (const m of js.matchAll(/\b(_scrml_[a-z_]+)\s*\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    if (STORE_FNS.has(m[1])) out.cellKeys.add(`${m[2]}`);
  }
  for (const m of js.matchAll(/_scrml_each_renderers\[\s*"([^"]*)"/g)) out.registryKeys.add(m[1]);
  for (const m of js.matchAll(/_scrml_(?:match|if|arm)_?[a-z_]*renderers?\[\s*"([^"]*)"/g)) out.registryKeys.add(m[1]);
  // HTML markers — ONLY inside the outlet region, so shell-composed markers
  // (identical by construction on every page, same compilation unit) don't
  // register as false collisions. `prefetch` is an href, not a generated token.
  const om = /<main[^>]*data-scrml-outlet[^>]*>([\s\S]*)<\/main>/.exec(html);
  const region = om ? om[1] : html;
  for (const m of region.matchAll(/data-scrml-([a-z-]+)="([^"]*)"/g)) {
    if (m[1] === "prefetch") continue;
    out.htmlMarkers.add(`${m[1]}=${m[2]}`);
  }
  for (const m of region.matchAll(/<!--\s*(\/?scrml-[^\s>]*?)\s*-->/g)) out.htmlMarkers.add(`comment:${m[1]}`);
  return out;
}

const ta = tokensOf(A), tb = tokensOf(B);
let bad = 0;
for (const k of Object.keys(ta)) {
  const inter = [...ta[k]].filter((x) => tb[k].has(x));
  console.log(`${k.padEnd(14)} A=${String(ta[k].size).padStart(3)} B=${String(tb[k].size).padStart(3)}  COLLIDING=${inter.length}` + (inter.length ? `  ${JSON.stringify(inter)}` : ""));
  bad += inter.length;
}
console.log(bad === 0 ? "\nVERDICT: no unit-scoped token collisions" : `\nVERDICT: ${bad} COLLIDING unit-scoped tokens`);
