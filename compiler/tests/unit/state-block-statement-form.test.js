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

// ---------------------------------------------------------------------------
// db-locus-blockcomment-fp-2026-08-26 — the scan needs COMMENT STATE, not a
// second pattern.
//
// The first cut carved comments out with `if (!/^\s*\/\//.test(line))`, a test
// with no state, so it recognised only a line-comment-LED line. A block-comment
// CONTINUATION line reading `on mount { ... }` matched the lifecycle pattern and
// the compiler REFUSED a legal file at exit 1. A pattern cannot express "am I
// inside a region that began on an EARLIER line"; only carried state can.
//
// These lock BOTH directions. The suppression cases are the reported bug; the
// FIRING cases are the ones a lazier fix (skip any line near an opener) would
// silently break, and each of them is a real statement that really would ship
// into the DOM as page text.
// ---------------------------------------------------------------------------

// One shared frame so each case differs only in the `<db>` body.
function withDbBody(body) {
  return (
    `<program db="./app.db">\n` +
    `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
    `<db src="sqlite:./app.db" tables="items">\n` +
    body +
    `\n</db>\n` +
    `function loadDashboard() { }\n` +
    `function cleanup() { }\n` +
    `<div>hello</div>\n` +
    `</program>\n`
  );
}

describe("E-STATE-BLOCK-STATEMENT-FORM — block comments", () => {
  test("a lifecycle line inside a block comment does NOT fire (the reported defect)", () => {
    const src = withDbBody(`  /* legacy:\non mount { loadDashboard() }\n  */`);
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("an opener on the SAME line as the match suppresses it", () => {
    const src = withDbBody(`  /* on mount { loadDashboard() }\n  */`);
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("a terminator on the same line as a LATER match — the match still fires", () => {
    const src = withDbBody(`  /* legacy note\n  */ on dismount { cleanup() }`);
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });

  test("the span after a terminator points at the statement, not at the terminator", () => {
    // `  */ on dismount { cleanup() }` — `on` starts at index 5, so col 6. The
    // mask replaces comment bytes with SPACES precisely so this stays byte-exact
    // against the ORIGINAL line.
    const src = withDbBody(`  /* legacy note\n  */ on dismount { cleanup() }`);
    const d = stmtFormErrors(compile(src));
    expect(d.length).toBe(1);
    expect(d[0].column).toBe(6);
  });

  test("an opener inside a `//` line opens NOTHING — the next line still fires", () => {
    const src = withDbBody(`  // see /* below\n  on mount { loadDashboard() }`);
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });

  test("block comments do not nest — one terminator closes an opener-inside-an-opener", () => {
    const src = withDbBody(`  /* outer /* inner */\n  on mount { loadDashboard() }`);
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });

  test("a trailing `// ...` after a real lifecycle statement does not suppress it", () => {
    // Regression on the DELETED `^\s*//` carve-out: masking kills only the
    // comment's own bytes, so the statement before it is untouched.
    const src = withDbBody(`  on mount { loadDashboard() } // wire the dashboard`);
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });

  test("an unterminated opener suppresses to the end of ITS state block only", () => {
    // Fail-OPEN inside the block: an unterminated comment is the ambiguous case,
    // and a REFUSE gate must not reject on ambiguity. The SIBLING block gets a
    // fresh state and still fires — the suppression is scoped, not global.
    const src =
      `<program>\n` +
      `<state>\n  /* dangling\n  on mount { go() }\n</state>\n` +
      `<state>\n  on dismount { go() }\n</state>\n` +
      `function go() { }\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FIX ROUND (S376 adversarial pass) — two defects the first cut shipped.
//
// Both are the same species: a claim in the module header that the CODE did not
// actually enforce. The header said `<engine>` / `<machine>` were excluded, and
// one of the two arms of `isStateBlock` did not apply the exclusion; the span
// arithmetic said it was byte-exact, and the column was byte-exact only for a
// statement that happened to start its own line. Every fixture written before
// this round put the statement on its own line and used a `<db>` — so the suite
// agreed with the header rather than with the code.
// ---------------------------------------------------------------------------

describe("E-STATE-BLOCK-STATEMENT-FORM — the `type:\"state\"` arm is name-guarded too", () => {
  // BS calls ANY whitespace-form opener `< Name …>` a `type:"state"` node — it is
  // a SYNTACTIC classification, not a semantic one. Measured over the corpus at
  // the time of this fix: 123 such nodes, only 44 named `db`; the rest are
  // `engine`, typestate transition decls, whitespace-form component definitions
  // and plain HTML. An unguarded arm claimed all of them.
  test("an engine state-child body does NOT draw this code", () => {
    // An engine state-child body is a code-default locus (§4.18.1), so the
    // diagnostic's premise ("ships into the DOM as literal page text") is FALSE
    // here and its remediation ("move it to the `<program>` body") is wrong
    // advice. A fatal refuse gate must not fire at a locus it was never scoped
    // to. The whitespace opener is the one that reached the unguarded arm.
    const src =
      `<program>\ntype Phase:enum = { Idle, Active }\n\n` +
      `<engine for=Phase initial=.Idle>\n` +
      `    < Idle rule=.Active>\n      on mount { go() }\n    </>\n` +
      `    <Active rule=.Idle></>\n</>\n\n` +
      `function go() { }\n<p>\${@phase}</p>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("a whitespace-form COMPONENT definition does NOT draw this code", () => {
    // `< taskItem>` is also `type:"state"` to BS. Same arm, same false claim —
    // and this shape is far more common in the corpus than the engine one.
    const src =
      `<program>\n< taskItem>\n  on mount { go() }\n</>\n` +
      `function go() { }\n<div>hi</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0);
  });

  test("the deprecated `< db>` opener STILL fires — the guard did not blind it", () => {
    // The load-bearing check on the fix. BS records `name:"db"` on the
    // whitespace `< db>` node, so name-guarding the `state` arm keeps the one
    // real corpus instance this module exists for. If `name` were absent there,
    // the guard would have silently switched the module off.
    const src =
      `< db src="./x.db" tables="items">\n` +
      `    \${\n        <items> = []\n    }\n\n` +
      `    on mount { loadDashboard() }\n` +
      `</>\n` +
      `function loadDashboard() { }\n` +
      `<div>hello</div>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(1);
  });
});

describe("E-STATE-BLOCK-STATEMENT-FORM — the reported position", () => {
  test("a statement sharing the opener's line reports the REAL column", () => {
    // `<db src="sqlite:./app.db" tables="items">` is 41 characters, so
    // `on mount` begins at column 42. The text child begins mid-line here, and
    // `colStart` is an offset into that child's first line, not a source column.
    // Emitting `colStart + 1` unconditionally reported column 1 — disagreeing
    // with the byte-exact `span.start` sitting right beside it.
    const src =
      `<program db="./app.db">\n` +
      `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
      `<db src="sqlite:./app.db" tables="items">on mount { go() }</db>\n` +
      `function go() { }\n<div>hello</div>\n</program>\n`;
    const d = stmtFormErrors(compile(src));
    expect(d.length).toBe(1);
    expect(d[0].line).toBe(5);
    expect(d[0].column).toBe(42);
  });

  test("`col` and `span.start` agree — they resolve to the same source byte", () => {
    // The two coordinates are computed separately, so they can drift apart
    // silently. This pins them together: re-deriving line/col from the byte
    // offset must reproduce the reported line/col, whichever fixture shape.
    const src =
      `<program db="./app.db">\n` +
      `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
      `<db src="sqlite:./app.db" tables="items">on mount { go() }</db>\n` +
      `function go() { }\n<div>hello</div>\n</program>\n`;
    const d = stmtFormErrors(compile(src));
    expect(d.length).toBe(1);
    const upto = src.slice(0, d[0].span.start);
    expect(upto.split("\n").length).toBe(d[0].line);
    expect(d[0].span.start - (upto.lastIndexOf("\n") + 1) + 1).toBe(d[0].column);
  });

  test("a statement on its OWN line still reports correctly (no over-correction)", () => {
    // The line arithmetic was never wrong and must not be "fixed": `baseLine` is
    // the line of the child's first character, so `baseLine + li` is already
    // right at li === 0 and beyond. Here the statement is on line 6, column 3.
    const src =
      `<program db="./app.db">\n` +
      `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
      `<db src="sqlite:./app.db" tables="items">\n  on mount { go() }\n</db>\n` +
      `function go() { }\n<div>hello</div>\n</program>\n`;
    const d = stmtFormErrors(compile(src));
    expect(d.length).toBe(1);
    expect(d[0].line).toBe(6);
    expect(d[0].column).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ROUND 3 — KNOWN-OPEN PINS. These assert what the compiler DOES today, and
// what it does today is WRONG. They exist so nobody reads silence as coverage.
//
// A passing test normally means "this behaviour is correct". These two mean the
// opposite: "this behaviour is a recorded hole, and if you close it, this test
// is the thing you delete." If one of them starts failing, that is very likely
// GOOD NEWS — check whether the hole was closed deliberately before restoring it.
//
// Neither is fixed here on purpose. Widening the scan domain changes which loci
// a FATAL gate reaches, which is a scope decision for the operator, not a
// judgement call for whoever is next in this file.
// ---------------------------------------------------------------------------

describe("E-STATE-BLOCK-STATEMENT-FORM — KNOWN OPEN (pinned, not endorsed)", () => {
  test("KNOWN OPEN: a lifecycle statement nested one element deep is MISSED", () => {
    // Verified by compiling and reading the emitted HTML: this ships
    // `on mount { loadDashboard() }` into `<body>` verbatim and the client
    // bundle only DECLARES the function — the hook never runs. Byte-for-byte
    // the defect this gate exists to close, one nesting level deeper.
    //
    // The scan walks only the state block's DIRECT text children, matching the
    // sibling `scanStateBlockBareWriteDecls` node domain so the two scanners
    // cannot drift. That is a defensible first landing, NOT coverage.
    const src =
      `<program db="./app.db">\n` +
      `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
      `<db src="sqlite:./app.db" tables="items">\n` +
      `  <div>\non mount { loadDashboard() }\n  </div>\n</db>\n` +
      `function loadDashboard() { }\n<div>hello</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0); // <- WRONG, and recorded
  });

  test("KNOWN OPEN: an unpaired comment opener in PROSE disarms the rest of the block", () => {
    // No string literal and no code — a GLOB does it. `src/*` opens a block
    // comment that never closes, so every following line in this state block is
    // masked out and the statement below is missed. It ships into the HTML.
    //
    // The fail-OPEN direction is deliberate and correct for a refuse gate (a
    // false positive rejects a legal file, which is the defect this module was
    // written to close). The BREADTH is what is pinned here: it is globs, paths
    // and spaceless division, not exotic source.
    const src =
      `<program db="./app.db">\n` +
      `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
      `<db src="sqlite:./app.db" tables="items">\n` +
      `  note about src/* paths\non mount { loadDashboard() }\n</db>\n` +
      `function loadDashboard() { }\n<div>hello</div>\n</program>\n`;
    expect(stmtFormErrors(compile(src)).length).toBe(0); // <- WRONG, and recorded

    // A URL is NOT the same shape and must not be conflated with it: `//` is a
    // LINE comment, so it disarms only the remainder of its own line. The
    // statement on the NEXT line still fires.
    const withUrl =
      `<program db="./app.db">\n` +
      `<schema>\n  items { id: integer primary key, name: text }\n</schema>\n` +
      `<db src="sqlite:./app.db" tables="items">\n` +
      `  docs at https://example.com/guide\n  on mount { loadDashboard() }\n</db>\n` +
      `function loadDashboard() { }\n<div>hello</div>\n</program>\n`;
    expect(stmtFormErrors(compile(withUrl)).length).toBe(1);
  });
});

describe("E-STATE-BLOCK-STATEMENT-FORM — the message is true at every locus it fires on", () => {
  test("`<schema>` fires, and the message does not claim the statement is rendered", () => {
    // `schema` is in STATE_BLOCK_NAMES, so this is a live locus. Measured by
    // compiling a marker: a `<db>` body's text reaches the HTML (1 occurrence),
    // a `<schema>` body's does NOT (0) — it is consumed as DDL. The refusal is
    // still right (it never runs either way); what must not happen is a FATAL
    // gate asserting a reason that is false at one of its own loci.
    const src =
      `<program db="./app.db">\n` +
      `<schema>\n  items { id: integer primary key, name: text }\n` +
      `  on mount { loadDashboard() }\n</schema>\n` +
      `function loadDashboard() { }\n<div>hello</div>\n</program>\n`;
    const d = stmtFormErrors(compile(src));
    expect(d.length).toBe(1);
    // Names the locus it actually fired on...
    expect(d[0].message).toContain("<schema>");
    // ...and does NOT make the unqualified render claim that is false here.
    expect(d[0].message).not.toContain(
      "does NOT apply here and the statement would ship into the DOM",
    );
    // The claim that IS true at every locus.
    expect(d[0].message).toContain("never run");
  });

  test("the `<db>` locus still gets the page-text explanation", () => {
    // The render limb is TRUE at `<db>` (measured: 1 occurrence in the HTML), so
    // correcting the wording must not have flattened it away.
    const d = stmtFormErrors(compile(CANON_MOUNT));
    expect(d.length).toBe(1);
    expect(d[0].message).toContain("ships into the DOM as literal page text");
    expect(d[0].message).toContain("consumed as DDL");
  });
});
