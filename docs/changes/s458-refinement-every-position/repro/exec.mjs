// s458 Phase 0 — EXECUTE the compiled reproducers (run.mjs must have run first).
// Usage: bun docs/changes/s458-refinement-every-position/repro/exec.mjs [outRoot]
// Each line: position · input · observed · (expected per SPEC).
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

const here = dirname(fileURLToPath(import.meta.url));
const wt = resolve(here, "../../../..");
const outRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(wt, ".tmp/s458-out");
const { _scrml_url_shape_ok } = await import(resolve(wt, "compiler/src/runtime-url-guard.js"));
const BAD = "javascript:alert(1)";
const out = (p, f = "app.client.js") => resolve(outRoot, p, "out", f);
const show = (label, observed, expected) => console.log(`${label.padEnd(44)} observed: ${observed.padEnd(46)} expected: ${expected}`);

// --- client: pull one emitted function out of app.client.js and run it with the real url judge ---
function clientFn(probe, fnName) {
  const js = readFileSync(out(probe), "utf8");
  const head = js.match(new RegExp(`function (_scrml_${fnName}_\\d+)\\(([^)]*)\\) \\{`));
  if (!head) throw new Error(`no ${fnName} in ${probe}`);
  // brace-count to the function's close (emitted check blocks put `}` at column 0, so no line regex)
  let i = head.index + head[0].length, depth = 1;
  for (; i < js.length && depth > 0; i++) { if (js[i] === "{") depth++; else if (js[i] === "}") depth--; }
  const text = js.slice(head.index, i);
  const m = [text, head[1]];
  const sets = [];
  const f = new Function("_scrml_url_shape_ok", "_scrml_cs_reactive_set", `${m[0]}; return ${m[1]};`)(
    _scrml_url_shape_ok, (k, v) => sets.push([k, v]));
  return { f, sets };
}
function runClient(label, probe, fnName, args, expected, pick = (r, sets) => JSON.stringify(sets.length ? sets : r)) {
  if (!existsSync(out(probe))) { show(label, "COMPILE ERROR (no artifact)", expected); return; }
  try {
    const { f, sets } = clientFn(probe, fnName);
    const r = f(...args);
    show(label, "ACCEPTED " + pick(r, sets).slice(0, 36), expected);
  } catch (e) {
    show(label, String(e.message).includes("E-CONTRACT-001-RT") ? "REFUSED E-CONTRACT-001-RT" : "THREW " + String(e.message).slice(0, 30), expected);
  }
}

console.log("== client (function bodies executed with the real _scrml_url_shape_ok) ==");
runClient("c0 control: let q: string(url) = v", "c0-decl-boundary", "pick", [BAD], "refused");
runClient("c1 control: client param take(u: string(url))", "c1-client-param", "take", [BAD], "refused");
runClient("c3 control: client fn -> string(url) return", "c3-client-return", "pick", [BAD], "refused");
runClient("(1a) @u = v  (refined cell)", "p1a-reactive-reassign", "setIt", [BAD], "refused, @u keeps prior");
runClient("(1b) q = v   (refined local)", "p1b-local-reassign", "pick", [BAD], "refused");
runClient("(1c) @u = \"javascript:...\" literal", "p1c-reactive-reassign-literal", "setIt", [], "E-CONTRACT-001 at compile");
runClient("(2a) const l: Link = { u: v, n: k }", "p2a-struct-field-runtime", "mk", [BAD, -5], "refused");
runClient("(2d) l.u = v  (refined struct field)", "p2d-struct-field-mutation", "mk", [BAD], "refused");
runClient("(3b) const q: string(url) = v  (fn-local)", "p3b-fn-local-const", "pick", [BAD], "refused");
runClient("(8a) take(\"javascript:...\") literal arg", "p8a-literal-call-arg", "take", [BAD], "E-CONTRACT-001 at compile");
runClient("(f1) take(n: number.min(0).max(100)) n=-5", "f1-sharedcore-param", "take", [-5], "refused");
runClient("(f2) promote(r: Role oneOf([.Admin,.Editor]))", "f2-enum-subset-param", "promote", ["Viewer"], "refused");
runClient("(f3) let e: string(pattern(/^[^@]+@.../)) = v", "f3-pattern-decl", "pick", ["nope"], "refused");
{
  const js = readFileSync(out("p3a-toplevel-const"), "utf8");
  show("(3a) top-level const X: string(url) = pick()",
    /const X = _scrml_pick_\d+\(\);/.test(js) && !js.includes("E-CONTRACT-001-RT") ? "ACCEPTED (const X = pick(); no check)"
      : /_scrml_url_shape_ok\(_scrml__?scrml_chk_X/.test(js) ? "CHECKED before `const X =` binds" : "?", "refused");
}

// --- (4) parseVariant call (client) ---
{
  const js = readFileSync(out("p4b-parsevariant-call"), "utf8");
  const save = js.match(/case "Save": \{\n\s*if \(!\(([^\n]*)\)\) return/);
  show("(4b) parseVariant(raw, Req) Save(link: url)", save ? `guard is only: ${save[1]}`.slice(0, 46) : "?", "InvalidPayload for javascript:");
}
{
  const js = readFileSync(out("p4c-api-response"), "utf8");
  const found = js.match(/case "Found": \{\n\s*if \(!\(([^\n]*)\)\) return/);
  show("(4c) <api> response Found(link: string(url))", found ? `guard is only: ${found[1]}`.slice(0, 46) : "?", "InvalidPayload → .error");
}

// --- server: import the bundle, call fetch ---
console.log("\n== server (bundle imported, fetch() called) ==");
const csrf = { "Content-Type": "application/json", Cookie: "scrml_csrf=t", "X-CSRF-Token": "t" };
async function post(probe, body, pathMatch) {
  const mod = await import(out(probe, "app.server.js") + "?" + Math.random());
  const route = mod.routes.find((r) => r.method === "POST" && (!pathMatch || r.path === pathMatch));
  let res;
  try {
    res = await mod.fetch(new Request("http://localhost" + route.path, { method: "POST", headers: csrf, body: JSON.stringify(body) }));
  } catch (e) {
    // an uncaught throw out of the handler — the host server answers 500
    return `THROWN (host 500): ${String(e.message).split("\n")[0].slice(0, 22)}`;
  }
  return `${res.status} ${(await res.text()).slice(0, 38)}`;
}
show("c2 control: server param save(link: url)", await post("c2-server-param", { link: BAD }), "400");
show("(4a) <endpoint> Save{link: javascript:}", await post("p4a-endpoint-payload", { tag: "Save", link: BAD }, "/e"), "400 InvalidPayload");
show("(4a) <endpoint> Count{n: -5}", await post("p4a-endpoint-payload", { tag: "Count", n: -5 }, "/e"), "400 InvalidPayload");
show("(6) server fn make(v) -> string(url)", await post("p6a-server-return", { v: BAD }), "refused (not 200 + value)");
show("(2e) server save(l: Link{u: url, n: >0})", await post("p2e-struct-server-param", { l: { u: BAD, n: -1 } }), "400");
{
  const js = readFileSync(out("p10-derived-cell"), "utf8");
  show("(10) const <doubled>: number(>=0) = @count*2", /_scrml_cs_derived_declare\("doubled", \(\) => _scrml_cs_reactive_get\("count"\) \* 2\)/.test(js) && !js.includes("E-CONTRACT-001-RT") ? "no check on recompute (count=-5 -> -10)" : "?", "refused on recompute");
}
show("(f4) server promote(r: Role oneOf(...))", await post("f4-enum-subset-server-param", { r: "Viewer" }), "400");

// --- (7) library module / tool ---
console.log("\n== library / tool / worker ==");
{
  const mod = await import(out("p7a-library-export-param", "app.js") + "?" + Math.random());
  try { show("(7a) library export take(u: string(url))", "ACCEPTED " + JSON.stringify(mod.take(BAD)), "refused"); }
  catch (e) { show("(7a) library export take(u: string(url))", "THREW " + e.message.slice(0, 30), "refused"); }
}
{
  const r = spawnSync("bun", [out("p7b-tool-param", "app.js"), BAD], { encoding: "utf8" });
  show("(7b) tool take(u: string(url)) via argv", `exit ${r.status} stdout ${JSON.stringify(r.stdout.trim())}`.slice(0, 46), "refused");
}
{
  const workerJs = readFileSync(out("p9a-worker-fn-param", "app-wk.worker.js"), "utf8");
  const posted = [];
  const self = { postMessage: (m) => posted.push(m), onmessage: null };
  new Function("self", workerJs)(self);
  try { self.onmessage({ data: { id: 1, data: BAD } }); show("(9) worker fn check(u: string(url))", "ACCEPTED " + JSON.stringify(posted[0]).slice(0, 36), "refused"); }
  catch (e) { show("(9) worker fn check(u: string(url))", "THREW " + e.message.slice(0, 36), "refused"); }
}
