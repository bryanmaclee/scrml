// S458 2a-fix F2 — the write-origin grid, EXECUTED against what ships: the emitted
// (pruned) `scrml-runtime.<hash>.js` + `app.client.js`, in happy-dom.
// Usage: bun grid.mjs <compilerTreeRoot> [nameFilter]
//   (run once per tree: the base copy, the 2a copy, this worktree)
// Each row: a refined cell, a write from one write-originating feature, the cell's
// value afterwards, and whether an E-CONTRACT-001-RT was reported.
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from "fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
const { SCENARIOS } = await import(resolve(process.env.SC));

const here = dirname(fileURLToPath(import.meta.url));
const tree = resolve(process.argv[2] ?? resolve(here, "../../../.."));
const filter = process.argv[3] ?? "";
const { compileScrml } = await import(resolve(tree, "compiler/src/api.js"));
const scratch = resolve("/home/bryan-maclee/.cache/scrml-agent-tmp/s459-ref2a-r2/out/grid-" + tree.split("/").pop());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOne(sc) {
  const dir = resolve(scratch, sc.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, "app.scrml");
  writeFileSync(input, sc.src);
  const out = resolve(dir, "out");
  const r = compileScrml({ inputFiles: [input], write: true, outputDir: out, log: () => {} });
  const errs = (r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? ""));
  if (errs.length) return { value: "COMPILE ERROR " + [...new Set(errs.map((e) => e.code))].join(","), contract: "" };
  const files = readdirSync(out);
  const rt = files.find((f) => /^scrml-runtime\..*\.js$/.test(f));
  const client = readFileSync(resolve(out, "app.client.js"), "utf8");
  const runtime = rt ? readFileSync(resolve(out, rt), "utf8") : "";
  const html = readFileSync(resolve(out, "app.html"), "utf8");

  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  GlobalRegistrator.register({ url: "http://localhost/" });
  const g = globalThis;
  const reported = [];
  const origErr = console.error;
  console.error = (...a) => { reported.push(a.map((x) => (x && x.message) || String(x)).join(" ")); };
  g.addEventListener("error", (ev) => { reported.push(String((ev.error && ev.error.message) || ev.message)); ev.preventDefault?.(); });
  g.addEventListener("unhandledrejection", (ev) => { reported.push(String(ev.reason && ev.reason.message)); ev.preventDefault?.(); });
  const sockets = [];
  g.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; sockets.push(this); } send() {} close() {} addEventListener(t, f) { this["on" + t] = f; } removeEventListener() {} };
  g.fetch = async (url) => {
    const m = String(url).match(/__ri_route_(.+?)_\d+/);
    const body = m && sc.server && m[1] in sc.server ? sc.server[m[1]] : null;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  if (sc.before) sc.before(g);
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) ?? [, html])[1].replace(/<script[^>]*>[\s\S]*?<\/script>/g, "");
  document.body.innerHTML = body;
  let state;
  try {
    state = (0, eval)("(function () {\n" + runtime + "\n" + client + "\n;return _scrml_state;\n})()");
    document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
    await sleep(5);
    for (const step of sc.steps ?? []) {
      try {
        if (step.click) { const t0 = performance.now(); document.querySelector(step.click).click(); console.log("  click ms", (performance.now() - t0).toFixed(1)); }
        if (step.input) { const el = document.querySelector(step.input); el.value = step.value; el.dispatchEvent(new Event("input", { bubbles: true })); }
        if (step.socket) for (const s of sockets) (s.onmessage)?.({ data: JSON.stringify(step.socket) });
      } catch (e) { reported.push(String(e && e.message)); }
      await sleep(5);
    }
  } catch (e) {
    reported.push("BOOT " + String(e && e.message));
  }
  console.error = origErr;
  const key = Object.keys(state ?? {}).find((k) => k === sc.cell || k.endsWith("$" + sc.cell));
  const v = key ? state[key] : "(no cell)";
  const shown = JSON.stringify(v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);
  if (process.env.GRID_DEBUG) console.log(reported.map(s=>s.slice(0,200)));
  return { value: shown, contract: reported.some((m) => /E-CONTRACT-001-RT/.test(m)) ? "E-CONTRACT-001-RT" : reported.length ? "other: " + reported[0].slice(0, 60) : "" };
}

for (const sc of SCENARIOS) {
  if (filter && !sc.name.includes(filter)) continue;
  let res;
  try { res = await runOne(sc); } catch (e) { res = { value: "HARNESS " + String(e.message).slice(0, 60), contract: "" }; }
  const ok = res.value === JSON.stringify(sc.expect) || res.value === sc.expect;
  console.log(`${ok ? "OK  " : "MISS"} ${sc.name.padEnd(34)} ${String(res.value).padEnd(24)} ${res.contract.padEnd(20)} (expect ${JSON.stringify(sc.expect)})`);
}
if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
