// Phase 0 probe: per R11 site kind, base (unhandled) vs handled spelling.
// impl#1: compile codes + run against a REAL bun:sqlite (conformance adapter runServer, sqlEngine real)
// with three tables: notes (1 row), empties (0 rows), gone (declared, never created → query fails).
// bootstrap: twinOf (TWIN_RULES) + slice-m2 frontEnd, Error-severity diagnostics.
import { compileScrml } from "../../../compiler/src/api.js";
import { runServer } from "../../../conformance/adapters/impl1-ts.ts";
import { twinOf, loadBootstrapModules, severityOfDiag } from "../../../scripts/bootstrap-conformance.ts";
import { frontEnd } from "../../../compiler/self-host-v2/slice-m2/lowered.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TABLES = ["notes", "empties", "gone"];
type Kind = { id: string; fn: (T: string, h: string) => string; handler: string; top?: boolean };
// h = "" (base) or " !{ … }" (handled)
const K: Kind[] = [
  { id: "stmt-run", handler: "!{ _ :> {} }", fn: (T, h) => `?{\`INSERT INTO ${T} (body) VALUES ('x')\`}.run()${h}\n        return "after"` },
  { id: "stmt-bare", handler: "!{ _ :> [] }", fn: (T, h) => `?{\`DELETE FROM ${T}\`}${h}\n        return "after"` },
  { id: "stmt-bare-obj", handler: "!{ _ :> {} }", fn: (T, h) => `?{\`DELETE FROM ${T}\`}${h}\n        return "after"` },
  { id: "stmt-get", handler: "!{ _ :> not }", fn: (T, h) => `?{\`SELECT body FROM ${T}\`}.get()${h}\n        return "after"` },
  { id: "stmt-in-if", handler: "!{ _ :> {} }", fn: (T, h) => `if (true) {\n            ?{\`INSERT INTO ${T} (body) VALUES ('x')\`}.run()${h}\n        }\n        return "after"` },
  { id: "stmt-in-for", handler: "!{ _ :> {} }", fn: (T, h) => `for (const i of [1]) {\n            ?{\`INSERT INTO ${T} (body) VALUES ('x')\`}.run()${h}\n        }\n        return "after"` },
  { id: "const-get", handler: "!{ _ :> not }", fn: (T, h) => `const row = ?{\`SELECT body FROM ${T}\`}.get()${h}\n        return row is not ? "none" : row.body` },
  { id: "let-get", handler: "!{ _ :> not }", fn: (T, h) => `let row = ?{\`SELECT body FROM ${T}\`}.get()${h}\n        return row is not ? "none" : row.body` },
  { id: "const-all", handler: "!{ _ :> [] }", fn: (T, h) => `const rows = ?{\`SELECT id FROM ${T}\`}.all()${h}\n        return "n=" + rows.length` },
  { id: "let-all", handler: "!{ _ :> [] }", fn: (T, h) => `let rows = ?{\`SELECT id FROM ${T}\`}.all()${h}\n        return "n=" + rows.length` },
  { id: "const-bare", handler: "!{ _ :> [] }", fn: (T, h) => `const rows = ?{\`SELECT id FROM ${T}\`}${h}\n        return "n=" + rows.length` },
  { id: "reassign-get", handler: "!{ _ :> not }", fn: (T, h) => `let row = "x"\n        row = ?{\`SELECT body FROM ${T}\`}.get()${h}\n        return row is not ? "none" : row.body` },
  { id: "return-get", handler: "!{ _ :> not }", fn: (T, h) => `return ?{\`SELECT body FROM ${T}\`}.get()${h}` },
  { id: "return-all", handler: "!{ _ :> [] }", fn: (T, h) => `return ?{\`SELECT id FROM ${T}\`}.all()${h}` },
  { id: "lift-all", handler: "!{ _ :> [] }", fn: (T, h) => `lift ?{\`SELECT id FROM ${T}\`}.all()${h}` },
  { id: "if-cond-get", handler: "!{ _ :> not }", fn: (T, h) => `if (?{\`SELECT body FROM ${T}\`}.get()${h}) { return "yes" }\n        return "no"` },
  { id: "for-of-all", handler: "!{ _ :> [] }", fn: (T, h) => `let n = 0\n        for (const r of ?{\`SELECT id FROM ${T}\`}.all()${h}) { n = n + 1 }\n        return "n=" + n` },
];

function program(k: Kind, handled: boolean): string {
  const fns = TABLES.map((T) => `    function f_${T}() {\n        ${k.fn(T, handled ? " " + k.handler : "")}\n    }`).join("\n");
  const cells = TABLES.map((T) => `    <r_${T}> = "init"`).join("\n");
  const btns = TABLES.map((T) => `    <button id="b_${T}" onclick={ @r_${T} = f_${T}() !{ .Transport(_) :> { return } } }>${T}</button>`).join("\n");
  return `<program db="./app.db">
    <schema>
        notes {
            id: integer primary key
            body: text
        }
        empties {
            id: integer primary key
            body: text
        }
        gone {
            id: integer primary key
            body: text
        }
    </schema>
${cells}
${fns}
${btns}
</program>
`;
}

// cell-write kind: `@c = ?{}.get()` inside a function
function programCell(handled: boolean, h = "!{ _ :> not }"): string {
  const fns = TABLES.map((T) => `    function f_${T}() {\n        @r_${T} = ?{\`SELECT body FROM ${T}\`}.get()${handled ? " " + h : ""}\n    }`).join("\n");
  const cells = TABLES.map((T) => `    <r_${T}> = "init"`).join("\n");
  const btns = TABLES.map((T) => `    <button id="b_${T}" onclick={ f_${T}() !{ .Transport(_) :> { return } } }>${T}</button>`).join("\n");
  return program({ id: "x", handler: "", fn: () => "" }, false).replace(/    function[\s\S]*<\/program>/, `${fns}\n${btns}\n</program>`).replace(/(    <r_notes>[\s\S]*?<r_gone> = "init")/, cells);
}

function implCompile(src: string) {
  const dir = mkdtempSync(join(tmpdir(), "r11p0-"));
  const f = join(dir, "case.scrml");
  writeFileSync(f, src);
  try {
    const r: any = compileScrml({ inputFiles: [f], write: false, outputDir: join(dir, "out"), log: () => {} });
    const codes = [...(r.errors ?? []), ...(r.warnings ?? [])].map((d: any) => d.code).filter(Boolean);
    return { errors: (r.errors ?? []).map((d: any) => d.code), codes: [...new Set(codes)].sort() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function implRun(src: string) {
  const r = await runServer(src, {
    serverDb: { notes: [{ id: 7, body: "hello" }], empties: [] },
    sqlEngine: "real",
    input: TABLES.flatMap((T) => [{ click: `#b_${T}` }, { wait: "settle" }]) as any,
  });
  const c = r.state.cells as any;
  return TABLES.map((T) => JSON.stringify(c[`r_${T}`]));
}

const boot = await loadBootstrapModules();
function bootCheck(src: string) {
  src = src.replace(/    <schema>[\s\S]*?<\/schema>\n/, "");
  const tw = twinOf({ source: src, auxFiles: {} });
  if (tw.candidate && !tw.twinned) return "NOT-TWINNED " + tw.blockers.join(" | ").slice(0, 200);
  const r: any = frontEnd(boot.mods, [{ path: "case.scrml", src: tw.source }], "case.scrml");
  const errs = (r.diags as any[]).concat(r.infos ?? []).filter((d) => severityOfDiag(d) !== "warning" && severityOfDiag(d) !== "info");
  return errs.length ? errs.map((d) => d.code + (d.code === "E-BOOTSTRAP-UNSUPPORTED" || d.code.startsWith("E-PARSE") || d.code.startsWith("E-SCOPE") ? "(" + String(d.message).slice(0, 90) + ")" : "")).join(",") : "clean";
}

const only = process.argv[2];
const rows: string[] = [];
const cases: Array<[string, string, string]> = K.filter((k) => !only || k.id === only).map((k) => [k.id, program(k, false), program(k, true)]);
if (!only || only === "cell-get") cases.push(["cell-get", programCell(false), programCell(true)]);
if (only === "dump") { console.log(program(K[0], true)); process.exit(0); }
for (const [id, base, hand] of cases) {
  const cb = implCompile(base), ch = implCompile(hand);
  let rb: string[] | string, rh: string[] | string;
  try { rb = await implRun(base); } catch (e: any) { rb = "THREW " + String(e?.message ?? e).slice(0, 100); }
  try { rh = await implRun(hand); } catch (e: any) { rh = "THREW " + String(e?.message ?? e).slice(0, 100); }
  let bb = "", bh = "";
  try { bb = bootCheck(base); } catch (e: any) { bb = "CRASH " + String(e?.message ?? e).slice(0, 80); }
  try { bh = bootCheck(hand); } catch (e: any) { bh = "CRASH " + String(e?.message ?? e).slice(0, 80); }
  const same = JSON.stringify(rb) === JSON.stringify(rh);
  rows.push(`| ${id} | impl1 base err=[${cb.errors}] codes=[${cb.codes}] · handled err=[${ch.errors}] codes=[${ch.codes}] | base ${JSON.stringify(rb)} | handled ${JSON.stringify(rh)} | ${same ? "SAME" : "DIFF"} | boot base: ${bb} · handled: ${bh} |`);
  console.log(rows[rows.length - 1]);
}
