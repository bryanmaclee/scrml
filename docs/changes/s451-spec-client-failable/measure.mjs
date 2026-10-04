// S451 "your recs on all of them" — corpus measurement with impl#1's front end + route inference.
// Usage: bun docs/changes/s451-spec-client-failable/measure.mjs <outDir> [dir,dir,...]
// For every .scrml file under examples/ samples/ conformance/cases/ (default), compile it alone with
// write:false, capture impl#1's Route Inference result through the stage seam (stageOverrides.RI), and
// walk the component-expanded AST of the input file:
//   1. client call sites to server-placed functions NOT declared `!`, classified by context;
//   2c. manual transaction-control `?{BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE}` and its enclosing function.
// Text scans (no AST): 2a bare-binder arms `| ident :>` in a `!{}`; 2b free-standing `!{` in markup.
import { compileScrml } from "../../../compiler/src/api.js";
import { runRI } from "../../../compiler/src/route-inference.ts";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const OUT = process.argv[2];
const DIRS = process.argv[3] ? process.argv[3].split(",") : ["examples", "samples", "conformance/cases"];
const TX = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END)\b/i;

function listScrml(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
        stack.push(p);
      } else if (e.name.endsWith(".scrml")) out.push(p);
    }
  }
  return out.sort();
}

const R = {
  files: 0, compileFail: [], noRI: [],
  calls: { total: 0, serverSide: 0, request: 0, handled: 0, hydration: 0, declaredBang: 0,
           unhandled: 0, unhandledBy: {} },
  unhandledFiles: new Map(),
  bangHandledFiles: new Map(),
  tx: { total: 0, inBang: 0, inNonBang: 0, outsideFn: 0, list: [] },
  bareBinder: [], freeBang: [],
};
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

for (const dir of DIRS) {
  for (const file of listScrml(path.resolve(ROOT, dir))) {
    const rel = path.relative(ROOT, file);
    R.files++;
    const src = fs.readFileSync(file, "utf8");

    // ---- text scans -------------------------------------------------------------------
    // 2a: an arm whose WHOLE pattern is a bare identifier, inside a `!{ … }` handler.
    {
      let i = 0;
      while ((i = src.indexOf("!{", i)) !== -1) {
        let depth = 0, j = i + 1;
        for (; j < src.length; j++) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}") { depth--; if (depth === 0) break; }
        }
        const body = src.slice(i + 2, j);
        for (const m of body.matchAll(/(^|\n|\{)\s*\|?\s*([a-z][A-Za-z0-9_]*)\s*(:>|=>|->)/g)) {
          if (m[2] === "else") continue;
          const line = src.slice(0, i).split("\n").length + body.slice(0, m.index).split("\n").length - 1;
          R.bareBinder.push(rel + ":" + line + "  | " + m[2] + " " + m[3]);
        }
        i = j;
      }
    }
    // 2b: a `!{` that opens a line (after optional whitespace) or follows a markup closer `>` —
    // a handler attached to no call. Candidates; reviewed by hand.
    src.split("\n").forEach((l, k) => {
      if (/^\s*!\{/.test(l) || />\s*!\{/.test(l)) R.freeBang.push(rel + ":" + (k + 1) + "  " + l.trim().slice(0, 90));
    });

    // ---- AST + route map ----------------------------------------------------------------
    let cap = null;
    try {
      compileScrml({
        inputFiles: [file], write: false, log: () => {},
        stageOverrides: { RI: (args) => { const res = runRI(args); cap = { args, res }; return res; } },
      });
    } catch (e) {
      if (!cap) { R.compileFail.push(rel + "  " + String(e && e.message).slice(0, 80)); continue; }
    }
    if (!cap) { R.noRI.push(rel); continue; }

    const fnRoute = new Map(); // functionName -> boundary (any file in the compile)
    for (const [, f] of cap.res.routeMap.functions) {
      if (f.functionName) fnRoute.set(f.functionName, f.boundary);
    }
    const files = cap.args.files || [];
    const me = files.find((f) => path.resolve(f.filePath || f.ast?.filePath || "") === path.resolve(file)) || files[0];
    if (!me) continue;
    const root = me.ast ?? me;

    // function name -> canFail, from every file of the compile
    const canFail = new Map();
    const seenD = new WeakSet();
    for (const f of files) (function w(x) {
      if (!x || typeof x !== "object" || seenD.has(x)) return;
      seenD.add(x);
      if (Array.isArray(x)) { x.forEach(w); return; }
      if (x.kind === "function-decl" && x.name) canFail.set(x.name, !!x.canFail);
      for (const k of Object.keys(x)) if (k !== "parent" && k !== "span") w(x[k]);
    })(f.ast ?? f);

    const isServerName = (n) => fnRoute.get(n) === "server" || fnRoute.get(n) === "middleware";
    const seen = new WeakSet();
    const counted = new Set();

    function classify(name, anc, node) {
      const key = node.span ? node.span.start + ":" + name : null;
      if (key) { if (counted.has(key)) return; counted.add(key); }
      R.calls.total++;
      let fnIdx = -1;
      for (let i = anc.length - 1; i >= 0; i--) if (anc[i].kind === "function-decl") { fnIdx = i; break; }
      const encFn = fnIdx >= 0 ? anc[fnIdx] : null;
      if (encFn && encFn.name && isServerName(encFn.name)) { R.calls.serverSide++; return; }
      if (canFail.get(name)) {
        // declared `!`: already governed by E-ERROR-002 today — not newly rejected
        R.calls.declaredBang++;
        return;
      }
      const local = anc.slice(fnIdx + 1);
      if (anc.some((a) => a.kind === "markup" && a.tag === "request")) { R.calls.request++; return; }
      if (local.some((a) => a.kind === "guarded-expr" || a.kind === "match-expr" || a.kind === "match-stmt" || a.kind === "match-block" || a.kind === "propagate-expr")) { R.calls.handled++; return; }
      if (anc.some((a) => a.kind === "state-decl" && a.isServer)) { R.calls.hydration++; return; }
      let pos;
      if (encFn) pos = "client-function-body";
      else if (anc.some((a) => a.__attrHandler)) pos = "event-handler";
      else if (anc.some((a) => a.__attrValue)) pos = "attribute-value (R1 already)";
      else if (anc.some((a) => a.kind === "state-decl")) pos = "initializer (R1 already)";
      else if (anc.some((a) => a.kind === "markup" && ["onMount", "effect", "timer", "poll", "timeout", "engine"].includes(a.tag))) pos = "lifecycle-body";
      else pos = "markup/body-top";
      R.calls.unhandled++;
      R.calls.unhandledBy[pos] = (R.calls.unhandledBy[pos] || 0) + 1;
      bump(R.unhandledFiles, rel);
    }

    function walk(x, anc) {
      if (!x || typeof x !== "object" || seen.has(x)) return;
      seen.add(x);
      if (Array.isArray(x)) { x.forEach((y) => walk(y, anc)); return; }
      if (x.kind === "call" && x.callee && x.callee.kind === "ident" && isServerName(x.callee.name)) classify(x.callee.name, anc, x);
      if (x.kind === "call-ref" && isServerName(x.name)) classify(x.name, anc, x);
      if ((x.kind === "sql" || x.kind === "sql-ref") && typeof x.query === "string" && TX.test(x.query)) {
        R.tx.total++;
        let fn = null;
        for (let i = anc.length - 1; i >= 0; i--) if (anc[i].kind === "function-decl") { fn = anc[i]; break; }
        const where = fn ? (fn.canFail ? "bang" : "non-bang") : "outside-fn";
        if (where === "bang") R.tx.inBang++; else if (where === "non-bang") R.tx.inNonBang++; else R.tx.outsideFn++;
        R.tx.list.push(where + "\t" + rel + "\t" + (fn ? fn.name : "-") + "\t" + x.query.trim().split(/\s+/)[0]);
      }
      const next = anc.concat([x]);
      if (x.kind === "markup" && Array.isArray(x.attrs)) {
        for (const a of x.attrs) {
          if (!a || !a.value || typeof a.value !== "object") continue;
          const isHandler = typeof a.name === "string" && /^on/i.test(a.name);
          const marker = isHandler ? { kind: "attr", __attrHandler: true } : { kind: "attr", __attrValue: true };
          const v = a.value;
          // an attribute `expr` value carries both `exprNode` and (when it has statements) `stmts`;
          // walk the statement form only, so a guarded call is not also seen bare
          if (v.kind === "expr" && v.stmts && (!Array.isArray(v.stmts) || v.stmts.length)) walk(v.stmts, next.concat([marker]));
          else walk(v, next.concat([marker]));
        }
      }
      for (const k of Object.keys(x)) {
        if (k === "parent" || k === "span") continue;
        if (x.kind === "markup" && k === "attrs") continue;
        walk(x[k], next);
      }
    }
    walk(root, []);
  }
}

const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(OUT + "/unhandled-files.txt", top(R.unhandledFiles).map((e) => e[1] + "\t" + e[0]).join("\n") + "\n");
fs.writeFileSync(OUT + "/tx.txt", R.tx.list.join("\n") + "\n");
fs.writeFileSync(OUT + "/bare-binder.txt", R.bareBinder.join("\n") + "\n");
fs.writeFileSync(OUT + "/free-bang.txt", R.freeBang.join("\n") + "\n");
fs.writeFileSync(OUT + "/compile-fail.txt", R.compileFail.concat(R.noRI.map((r) => "noRI " + r)).join("\n") + "\n");
const byDir = {};
for (const [f, n] of R.unhandledFiles) { const d = f.split("/")[0]; byDir[d] = byDir[d] || { files: 0, sites: 0 }; byDir[d].files++; byDir[d].sites += n; }
console.log(JSON.stringify({ files: R.files, compileFail: R.compileFail.length, noRI: R.noRI.length, calls: R.calls,
  unhandledFileCount: R.unhandledFiles.size, byDir, tx: { total: R.tx.total, inBang: R.tx.inBang, inNonBang: R.tx.inNonBang, outsideFn: R.tx.outsideFn },
  bareBinder: R.bareBinder.length, freeBangCandidates: R.freeBang.length }, null, 1));
