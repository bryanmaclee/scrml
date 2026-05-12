#!/usr/bin/env bun
/**
 * scrml TodoMVC runtime benchmark — measures state + DOM reconciliation via happy-dom.
 * Outputs JSON to stdout.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!globalThis.document) GlobalRegistrator.register();

// Note: happy-dom provides localStorage, no stub needed

// ---------------------------------------------------------------------------
// Benchmark utilities
// ---------------------------------------------------------------------------

const WARMUP = 3;
const ITERATIONS = 10;

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function buildTitle(i) {
  const adj = ["pretty","large","big","small","tall","short","long","handsome","plain","quaint","clean","elegant","easy","angry","crazy","helpful","mushy","odd","unsightly","adorable","important","inexpensive","cheap","expensive","fancy"];
  const col = ["red","yellow","blue","green","pink","brown","purple","brown","white","black","orange"];
  const noun = ["table","chair","house","bbq","desk","car","pony","cookie","sandwich","burger","pizza","mouse","keyboard"];
  return `${adj[i % adj.length]} ${col[i % col.length]} ${noun[i % noun.length]}`;
}

function p95(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.min(idx, sorted.length - 1)];
}

function bench(name, setup, fn, iters = ITERATIONS) {
  for (let i = 0; i < WARMUP; i++) { setup(); fn(); }
  const times = [];
  for (let i = 0; i < iters; i++) {
    setup();
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return { benchmark: name, median: median(times), mean: mean(times), p95: p95(times), min: Math.min(...times), max: Math.max(...times) };
}

// ---------------------------------------------------------------------------
// Load scrml app
// ---------------------------------------------------------------------------

const DIST = resolve(__dirname, "todomvc/dist");

if (!existsSync(resolve(DIST, "app.html")) || !existsSync(resolve(DIST, "app.client.js"))) {
  console.log(JSON.stringify({ framework: "scrml", error: "dist not found" }));
  process.exit(1);
}

const htmlContent = readFileSync(resolve(DIST, "app.html"), "utf-8");
const runtimeJs = readFileSync(resolve(DIST, "scrml-runtime.js"), "utf-8");
const clientJs = readFileSync(resolve(DIST, "app.client.js"), "utf-8");

const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
const bodyHtml = bodyMatch ? bodyMatch[1] : htmlContent;
const cleanHtml = bodyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, "").trim();

// Combined runtime+client script. Evaluated via indirect-eval so it runs in
// the global scope — this matches how a browser loads both as top-level
// <script> tags, and lets the runtime's internal `let`/`const`-scoped
// closures be reachable by the client script through shared lexical scope.
//
// The previous IIFE-with-explicit-window-export pattern broke against
// v0.2.6+ codegen because the export list could not enumerate every
// internal symbol the client side relies on (see
// docs/changes/wave-3-d3/D3a-CRASH-DIAGNOSIS.md). Indirect eval — the
// `(0, eval)(...)` form — runs the script in the global lexical scope:
//   * `function` declarations hoist to globalThis (so the test harness can
//     call `_scrml_reactive_get`/`_set` directly below).
//   * `let`/`const` declarations stay in script-global scope but remain
//     reachable to other code evaluated in the same script-global scope,
//     including the client.js portion concatenated below.
const combinedScript = runtimeJs + "\n;\n" + clientJs;
const globalEval = (0, eval);

function loadApp() {
  document.body.innerHTML = cleanHtml;
  globalEval(combinedScript);
  document.dispatchEvent(new Event("DOMContentLoaded", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

let nextId = 1;

function resetApp() {
  loadApp();
  nextId = 1;
}

function createRows(n) {
  const existing = _scrml_reactive_get("todos") || [];
  const newTodos = [];
  for (let i = 0; i < n; i++) {
    newTodos.push({ id: nextId++, title: buildTitle(i), completed: false });
  }
  _scrml_reactive_set("todos", [...existing, ...newTodos]);
}

function clearRows() {
  _scrml_reactive_set("todos", []);
}

function deleteEvery10th() {
  const todos = _scrml_reactive_get("todos").filter((_, i) => i % 10 !== 0);
  _scrml_reactive_set("todos", todos);
}

function updateEvery10th() {
  const todos = _scrml_reactive_get("todos").map((t, i) =>
    i % 10 === 0 ? { ...t, title: t.title + " !!!" } : t
  );
  _scrml_reactive_set("todos", todos);
}

function selectRow(idx) {
  const todos = _scrml_reactive_get("todos");
  if (todos[idx]) _scrml_reactive_set("editingId", todos[idx].id);
}

function swapRows(a, b) {
  const todos = [..._scrml_reactive_get("todos")];
  if (todos[a] && todos[b]) {
    const tmp = todos[a]; todos[a] = todos[b]; todos[b] = tmp;
    _scrml_reactive_set("todos", todos);
  }
}

function removeRow(idx) {
  const todos = _scrml_reactive_get("todos");
  if (todos[idx]) _scrml_reactive_set("todos", todos.filter(t => t.id !== todos[idx].id));
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

loadApp();

const results = [];

results.push(bench("initial-render", () => {}, () => resetApp()));
results.push(bench("create-1000", () => resetApp(), () => createRows(1000)));
results.push(bench("replace-1000", () => { resetApp(); createRows(1000); }, () => { clearRows(); createRows(1000); }));
results.push(bench("partial-update", () => { resetApp(); createRows(1000); }, () => updateEvery10th()));
results.push(bench("delete-every-10th", () => { resetApp(); createRows(1000); }, () => deleteEvery10th()));
results.push(bench("clear-all", () => { resetApp(); createRows(1000); }, () => clearRows()));
results.push(bench("select-row", () => { resetApp(); createRows(1000); }, () => selectRow(500)));
results.push(bench("swap-rows", () => { resetApp(); createRows(1000); }, () => swapRows(1, 998)));
results.push(bench("remove-row", () => { resetApp(); createRows(1000); }, () => removeRow(500)));
results.push(bench("create-10000", () => resetApp(), () => createRows(10000), 5));
results.push(bench("append-1000", () => { resetApp(); createRows(1000); }, () => createRows(1000)));

console.log(JSON.stringify({ framework: "scrml", results }));
