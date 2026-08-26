// ---------------------------------------------------------------------------
// E-STATE-BLOCK-STATEMENT-FORM — a lifecycle STATEMENT in a `<db>`/`<state>`
// body is REFUSED, not linted.
// (change-id db-state-block-locus-2026-08-25, ruling 1 — S375 bryan, limb (b))
// ---------------------------------------------------------------------------
//
// `on mount { loadDashboard() }` written in a `<db>` body compiled at exit 0
// with ZERO diagnostics, shipped into `<body>` as LITERAL PAGE TEXT, and never
// ran. A state-block body is MARKUP context, not a logic locus: §34
// E-WRITE-NOT-IN-LOGIC-CONTEXT states "`<db>` / `<state>` STATE-block bodies are
// NOT default-logic-mode loci", and §4.18.1 scopes the §40.8 `default-logic`
// auto-lift to `<program>` / `<page>` / `<channel>`. So the identical line that
// becomes logic one locus up becomes TEXT here — silently.
//
// Per S368 (logic at a markup locus is REFUSED, not linted) this is conformance
// restoration against a ruling already made.
//
// SCOPE — one named form; the complement is deliberately refused and is
// regression-locked below:
//   COVERED     : `on mount {` / `on dismount {` (mirrors TOPLEVEL_ON_LIFECYCLE_RE)
//   NOT COVERED : bare calls (S368 ruling + measured typestate false-positive),
//                 control flow (already E-CONTROL-FLOW-IN-MARKUP here),
//                 bare writes (sibling W-STATE-BLOCK-BARE-WRITE-DECL's own
//                 deprecation cycle), prose/free text (must keep compiling).

import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compileScrml } from "../../src/api.js";

const TMP = mkdtempSync(join(tmpdir(), "sbsf-"));
function compile(src) {
  const p = join(TMP, `t-${Math.random().toString(36).slice(2)}.scrml`);
  writeFileSync(p, src);
  return compileScrml({ inputFiles: [p], write: false, outputDir: join(TMP, "out") });
}
function stmtFormErrors(r) {
  return (r.errors ?? []).filter(e =>
    (e.code ?? "").includes("E-STATE-BLOCK-STATEMENT-FORM"));
}
function codes(r) {
  return (r.errors ?? []).map(e => e.code ?? "");
}

// Canonical no-space opener — BS-classifies the block as type:"markup".
const CANON_MOUNT =
  `<program db="./app.db">\n` +
  `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
  `<db src="sqlite:./app.db" tables="items">\n` +
  `  on mount { loadDashboard() }\n` +
  `</db>\n` +
  `function loadDashboard() { }\n` +
  `<div>hello</div>\n` +
  `</program>\n`;

describe("E-STATE-BLOCK-STATEMENT-FORM — the reported defect", () => {
  test("`on mount { ... }` in a canonical `<db>` body is an ERROR", () => {
    const r = compile(CANON_MOUNT);
    expect(stmtFormErrors(r).length).toBe(1);
  });

  test("the diagnostic is fatal — it lands in errors, not warnings", () => {
    const r = compile(CANON_MOUNT);
    const inWarnings = (r.warnings ?? []).filter(w =>
      (w.code ?? "").includes("E-STATE-BLOCK-STATEMENT-FORM"));
    expect(inWarnings.length).toBe(0);
    expect(stmtFormErrors(r).length).toBeGreaterThan(0);
  });

  test("the message names the locus, the reason, and the fix", () => {
    const msg = stmtFormErrors(compile(CANON_MOUNT))[0].message;
    expect(msg).toContain("never run");
    expect(msg).toContain("MARKUP context");
    expect(msg).toContain("§40.8");
    expect(msg).toMatch(/Move the lifecycle block OUT/);
  });

  test("the diagnostic points at the offending line", () => {
    const e = stmtFormErrors(compile(CANON_MOUNT))[0];
    // CANON_MOUNT: 1 <program>, 2 <schema>, 3 items, 4 </schema>, 5 <db>, 6 on mount
    expect(e.line).toBe(6);
  });

  test("`on dismount { ... }` is covered symmetrically", () => {
    const r = compile(CANON_MOUNT.replace("on mount", "on dismount"));
    expect(stmtFormErrors(r).length).toBe(1);
  });

  test("the DEPRECATED whitespace `< db>` opener is covered too", () => {
    // The one live corpus member (samples/htmx-debate-dashboard.scrml:14) uses
    // this form; BS classifies it type:"state", a different arm. A markup-only
    // gate would have missed the only real-world instance.
    const src =
      `< db src="./x.db" tables="items">\n` +
      `    \${\n        <items> = []\n    }\n\n` +
      `    on mount { loadDashboard() }\n` +
      `</>\n` +
      `function loadDashboard() { }\n` +
      `<div>hello</div>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });

  test("a `<state>` body is covered, not just `<db>`", () => {
    const src =
      `<program>\n<state>\n  on mount { go() }\n</state>\n` +
      `function go() { }\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });

  test("multiple lifecycle blocks each fire once", () => {
    const src =
      `<program>\n<state>\n  on mount { go() }\n  on dismount { go() }\n</state>\n` +
      `function go() { }\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(2);
  });
});

describe("E-STATE-BLOCK-STATEMENT-FORM — the complement is deliberately NOT covered", () => {
  test("prose mentioning 'on mount' still compiles — no brace, no fire", () => {
    const src =
      `<program>\n<state>\n` +
      `  Notes on mount points and how the on-call rotation works.\n` +
      `  This prose must keep compiling.\n` +
      `</state>\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("a bare call is NOT diagnosed by this code (S368 ruling)", () => {
    const src =
      `<program>\n<state>\n  loadDashboard()\n</state>\n` +
      `function loadDashboard() { }\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("a typestate transition decl does NOT false-positive", () => {
    // `< Draft>` is BS-classified type:"state", so a bare-call gate at this
    // locus would reject 4 live conformance cases. Measured, not hypothetical.
    const src =
      `<program>\n< Submission id(string)>\n    < Draft body(string)>\n` +
      `        validate() => < Validated> { }\n    </>\n` +
      `    < Validated body(string)></>\n</>\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("control flow stays with E-CONTROL-FLOW-IN-MARKUP — no double-fire", () => {
    const src =
      `<program>\n<state>\n  if (1) { }\n</state>\n<div>hi</div>\n</program>\n`;
    const r = compile(src);
    expect(stmtFormErrors(r).length).toBe(0);
    expect(codes(r).some(c => c.includes("E-CONTROL-FLOW-IN-MARKUP"))).toBe(true);
  });

  test("a bare write keeps its Info lint and is NOT promoted by this code", () => {
    const src =
      `<program>\n< db src="./x.db" tables="products">\n  @products = []\n</db>\n` +
      `<p>\${@products}</p>\n</program>\n`;
    const r = compile(src);
    expect(stmtFormErrors(r).length).toBe(0);
    const w = (r.warnings ?? []).filter(x =>
      (x.code ?? "").includes("W-STATE-BLOCK-BARE-WRITE-DECL"));
    expect(w.length).toBeGreaterThan(0);
  });

  test("`on mount` in a `<program>` body still auto-lifts (§40.8) — untouched", () => {
    const src =
      `<program>\nfunction go() { }\non mount { go() }\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("a commented-out lifecycle line does not fire", () => {
    const src =
      `<program>\n<state>\n  // on mount { go() }\n</state>\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("`on mount` inside a `${...}` logic block in the state body is fine", () => {
    const src =
      `<program>\n< db src="./x.db" tables="products">\${\n` +
      `  <products> = []\n  on mount { go() }\n}</db>\n` +
      `function go() { }\n<p>\${@products}</p>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });
});
