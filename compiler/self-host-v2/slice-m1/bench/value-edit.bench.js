// value-edit.bench.js — dpa-051 §6.1 / R3: the cost of IMMUTABLE runtime values.
//
// Every edit of a reactive sequence makes a new value (copy-on-write with the
// copy moved to the write). This measures, with the slice-M1 runtime's actual
// value representation (plain arrays of plain structs in a Cell — the dev-mode
// deep-freeze was DROPPED at S437; its M1 numbers are in slice-m1/progress.md):
//   append     — rt.append(cell, e): a new array one longer (§66.11.2 end-append)
//   field-write — rt.setIn(cell, [i, "qty"], v): a new array + a new struct at i
//                 (a position write into an array of structs)
// for n = 10 / 1k / 100k, against an in-place mutable baseline (what impl#1
// does today).
//
// Every append is to an n-element array (the cell is put back to the base
// array between ops, O(1)), so the numbers are per-op at size n, not a
// growing-array average.
// Time: median ns per op over repeated batches (performance.now).
// Allocation: heap growth per op with every result RETAINED (so GC cannot hide
// it), measured by process.memoryUsage().heapUsed after Bun.gc(true).
//
// usage: bun compiler/self-host-v2/slice-m1/bench/value-edit.bench.js

import * as rt from "../runtime/runtime.js";

const SIZES = [10, 1000, 100000];

function makeRows(n) {
  const rows = new Array(n);
  for (let i = 0; i < n; i++) rows[i] = { id: i, name: "row" + i, qty: 1 };
  return rows;
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function opsFor(n) {
  if (n <= 10) return 20000;
  if (n <= 1000) return 2000;
  return 40;
}

function timeOps(n, kind) {
  const ops = opsFor(n);
  const samples = [];
  for (let rep = 0; rep < 7; rep++) {
    const cell = rt.cell(makeRows(n));
    const base = cell.peek();
    const t0 = performance.now();
    for (let k = 0; k < ops; k++) {
      if (kind === "append") {
        rt.append(cell, { id: n + k, name: "x", qty: 1 });
        cell.value = base; // back to length n (O(1)), so every op appends to an n-array
      } else {
        rt.setIn(cell, [k % n, "qty"], k);
      }
    }
    samples.push(((performance.now() - t0) * 1e6) / ops);
  }
  return median(samples);
}

function timeMutable(n, kind) {
  const ops = opsFor(n);
  const samples = [];
  for (let rep = 0; rep < 7; rep++) {
    const rows = makeRows(n);
    const t0 = performance.now();
    for (let k = 0; k < ops; k++) {
      if (kind === "append") { rows.push({ id: n + k, name: "x", qty: 1 }); rows.length = n; }
      else rows[k % n].qty = k;
    }
    samples.push(((performance.now() - t0) * 1e6) / ops);
  }
  return median(samples);
}

function bytesPerOp(n, kind) {
  const ops = Math.min(opsFor(n), n >= 100000 ? 20 : 500);
  const cell = rt.cell(makeRows(n));
  const base = cell.peek();
  const kept = [];
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  for (let k = 0; k < ops; k++) {
    if (kind === "append") rt.append(cell, { id: n + k, name: "x", qty: 1 });
    else rt.setIn(cell, [k % n, "qty"], k);
    kept.push(cell.peek());
    if (kind === "append") cell.value = base;
  }
  Bun.gc(true);
  const after = process.memoryUsage().heapUsed;
  if (kept.length !== ops) throw new Error("unreachable");
  return (after - before) / ops;
}

const fmtNs = (ns) => (ns >= 1e6 ? (ns / 1e6).toFixed(2) + " ms" : ns >= 1e3 ? (ns / 1e3).toFixed(2) + " µs" : ns.toFixed(0) + " ns");
const fmtB = (b) => (b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(2) + " MB" : b >= 1024 ? (b / 1024).toFixed(1) + " KB" : b.toFixed(0) + " B");

const lines = [];
lines.push("| edit | n | immutable (copy on write) | mutable in-place | bytes/op immutable |");
lines.push("|---|---|---|---|---|");
for (const kind of ["append", "field-write"]) {
  for (const n of SIZES) {
    const imm = timeOps(n, kind);
    const mut = timeMutable(n, kind);
    const b = bytesPerOp(n, kind);
    lines.push(`| ${kind} | ${n} | ${fmtNs(imm)} | ${fmtNs(mut)} | ${fmtB(b)} |`);
  }
}
console.log(lines.join("\n"));
