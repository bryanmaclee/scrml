// S451 R11 + R1 population measurement over the corpus, using impl#1's front end
// (block splitter + AST builder). Run from the worktree root.
import { splitBlocks } from "/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aba955268a71af4a4/compiler/src/block-splitter.js";
import { buildAST } from "/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aba955268a71af4a4/compiler/src/ast-builder.js";
import fs from "fs";
import path from "path";

const ROOT = "/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aba955268a71af4a4";
const DIRS = process.env.MDIRS ? process.env.MDIRS.split(",") : ["examples", "samples", "conformance/cases", "stdlib", "docs/readme-snippets", "docs/tutorial-snippets"];

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

const TX = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const res = { files: 0, parseFail: [], r11: { total: 0, inBang: 0, handled: 0, tx: 0, patternC: 0, unhandled: 0 }, r11Files: new Map(), r1: { total: 0, byPos: {} }, r1Files: new Map(), blind: [] };

function sqlText(n) {
  if (typeof n.query === "string") return n.query;
  return "";
}

for (const dir of DIRS) {
  for (const file of listScrml(path.resolve(ROOT, dir))) {
    const rel = path.relative(ROOT, file);
    res.files++;
    let ast;
    try {
      ast = buildAST(splitBlocks(file, fs.readFileSync(file, "utf8")));
    } catch (e) {
      const src = fs.readFileSync(file, "utf8");
      res.parseFail.push(rel + " (" + (src.match(/\?\{/g) || []).length + " ?{)");
      continue;
    }
    const root = ast.ast ?? ast;
    const srcText = fs.readFileSync(file, "utf8").split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
    const rxCount = (srcText.match(/\?\{/g) || []).length;
    const before = res.r11.total;
    // pass 1: same-file server functions (direct: isServer or body has a ?{})
    const serverFns = new Set();
    const seen1 = new WeakSet();
    function hasSql(n) {
      const s = new WeakSet();
      let found = false;
      (function w(x) {
        if (found || !x || typeof x !== "object" || s.has(x)) return;
        s.add(x);
        if (Array.isArray(x)) { x.forEach(w); return; }
        if (x.kind === "sql" || x.kind === "sql-ref") { found = true; return; }
        for (const k of Object.keys(x)) if (k !== "parent" && k !== "span") w(x[k]);
      })(n);
      return found;
    }
    (function w(x) {
      if (!x || typeof x !== "object" || seen1.has(x)) return;
      seen1.add(x);
      if (Array.isArray(x)) { x.forEach(w); return; }
      if (x.kind === "function-decl" && x.name && (x.isServer || hasSql(x.body))) serverFns.add(x.name);
      for (const k of Object.keys(x)) if (k !== "parent" && k !== "span") w(x[k]);
    })(root);

    // pass 2: classify
    const seen = new WeakSet();
    const counted = new Set();
    function callsServer(n) {
      let c = 0;
      const s = new WeakSet();
      (function w(x) {
        if (!x || typeof x !== "object" || s.has(x)) return;
        s.add(x);
        if (Array.isArray(x)) { x.forEach(w); return; }
        if (x.kind === "call" && x.callee && x.callee.kind === "ident" && serverFns.has(x.callee.name)) c++;
        if (x.kind === "call-ref" && serverFns.has(x.name)) c++;
        if (x.kind === "function-decl" || x.kind === "arrow" || x.kind === "lambda") return; // a function value's body is not evaluated here
        for (const k of Object.keys(x)) if (k !== "parent" && k !== "span") w(x[k]);
      })(n);
      return c;
    }
    function r1hit(pos, n) {
      const c = callsServer(n);
      if (!c) return;
      res.r1.total += c;
      res.r1.byPos[pos] = (res.r1.byPos[pos] || 0) + c;
      res.r1Files.set(rel, (res.r1Files.get(rel) || 0) + c);
    }
    function walk(x, anc) {
      if (!x || typeof x !== "object" || seen.has(x)) return;
      seen.add(x);
      if (Array.isArray(x)) { x.forEach(y => walk(y, anc)); return; }
      if (x.kind === "sql" || x.kind === "sql-ref") {
        const key = x.id ?? x.nodeId ?? (x.span && x.span.start);
        if (!counted.has(key)) {
          counted.add(key);
          res.r11.total++;
          let fn = null;
          for (let i = anc.length - 1; i >= 0; i--) if (anc[i].kind === "function-decl") { fn = anc[i]; break; }
          const fnIdx = fn ? anc.indexOf(fn) : -1;
          const handled = anc.slice(fnIdx + 1).some(a => a.kind === "guarded-expr" || a.kind === "match-expr" || a.kind === "match-stmt");
          const inServerDecl = anc.some(a => a.kind === "state-decl" && a.isServer);
          if (fn && fn.canFail) res.r11.inBang++;
          else if (handled) res.r11.handled++;
          else if (TX.test(sqlText(x))) res.r11.tx++;
          else if (inServerDecl) res.r11.patternC++;
          else {
            res.r11.unhandled++;
            res.r11Files.set(rel, (res.r11Files.get(rel) || 0) + 1);
          }
        }
      }
      // R1 value positions (outside function bodies)
      const LIFE = ["request", "effect", "onMount", "timer", "poll", "timeout", "engine"];
      const inFn = anc.some(a => a.kind === "function-decl" || (a.kind === "markup" && LIFE.includes(a.tag)));
      if (!inFn) {
        if (x.kind === "state-decl" && !x.isServer && x.initExpr) r1hit(x.shape === "derived" ? "derived" : "initializer", x.initExpr);
        if (x.kind === "markup" && Array.isArray(x.attrs)) {
          for (const a of x.attrs) {
            if (!a || typeof a.name !== "string") continue;
            if (/^on/i.test(a.name) || a.name.startsWith("bind:")) continue;
            if (a.value && typeof a.value === "object") r1hit("attribute", a.value);
          }
        }
        if (x.kind === "logic" && anc.length) {
          const parent = anc[anc.length - 1];
          const parentMarkup = Array.isArray(parent) ? null : parent;
          const pm = [...anc].reverse().find(a => a.kind === "markup");
          if (pm && !["program", "page", "channel", "request", "effect", "onMount", "timer", "poll", "timeout", "engine"].includes(pm.tag) && parentMarkup && parentMarkup.kind === "markup") {
            r1hit("interpolation", x.body);
          }
        }
      }
      const next = anc.concat([x]);
      for (const k of Object.keys(x)) {
        if (k === "parent" || k === "span") continue;
        if (x.kind === "markup" && k === "attrs") continue;
        if (x.kind === "state-decl" && k === "initExpr") { walk(x[k], next); continue; }
        walk(x[k], next);
      }
    }
    walk(root, []);
    const astCount = res.r11.total - before;
    if (rxCount > astCount) res.blind.push((rxCount - astCount) + "\t" + rel + " (ast " + astCount + ", text " + rxCount + ")");
  }
}

const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({ files: res.files, parseFail: res.parseFail.length, r11: res.r11, r11FileCount: res.r11Files.size, r1: res.r1, r1FileCount: res.r1Files.size }, null, 1));
fs.writeFileSync(process.argv[2] + "/r11-files.txt", top(res.r11Files).map(e => e[1] + "\t" + e[0]).join("\n") + "\n");
fs.writeFileSync(process.argv[2] + "/r1-files.txt", top(res.r1Files).map(e => e[1] + "\t" + e[0]).join("\n") + "\n");
fs.writeFileSync(process.argv[2] + "/ast-blind.txt", res.blind.sort((a, b) => parseInt(b) - parseInt(a)).join("\n") + "\n");
console.log("blind files", res.blind.length, "blind sites", res.blind.reduce((s, l) => s + parseInt(l), 0));
fs.writeFileSync(process.argv[2] + "/parse-fail.txt", res.parseFail.join("\n") + "\n");
