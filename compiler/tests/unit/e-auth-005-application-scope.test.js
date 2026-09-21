/**
 * e-auth-005-application-scope.test.js — §52.11 `E-AUTH-005` is scoped to the
 * APPLICATION, not to the file being checked.
 *
 * ⛔ THE POINT OF THIS FILE IS THAT BOTH DIRECTIONS ARE PINNED. `E-AUTH-005` used
 * to be decided by `hasProgramDbAttr(fileAST)` — "does THIS file carry a
 * `<program db=…>`?" — which under the canonical v0.3 multi-file layout is false
 * for every file but the entry, because §40.8 FORBIDS a `<program>` anywhere else:
 *
 *   §40.8 — "A scrml application SHALL declare its top-level `<program>` element
 *   exactly ONCE, in the application's entry file." / "The `<program>` declaration
 *   SHALL NOT appear in any non-entry file of the same application."
 *   §58.8 — a `<page>` "is not a separate compilation unit — it shares the
 *   application `<program>` scope."
 *
 * So every `<var server>` in every page of every multi-file app was refused, with
 * a remedy ("Add db= to the enclosing <program>") the layout makes unreachable —
 * and since §52.4.2 pt 5 makes `<var server>` the only route to an SSR-prerendered
 * cell, server-rendered page data was structurally unavailable to those apps.
 *
 * The repair is a WIDER UNIT, NOT A WEAKER TEST, and the tests below are arranged
 * to make a weakening visible. An application with no `db=` ANYWHERE still has no
 * server context, and `E-AUTH-005` must still fire in it — at EVERY file shape,
 * including the page file that the first test proves is now accepted. If someone
 * later "fixes" this by suppressing the diagnostic for pages, test 2 fails.
 *
 * DIAGNOSTIC-STREAM PARTITION (memory: feedback_diagnostic_stream_partition):
 * E-AUTH-005 is Error-severity and partitions to `result.errors`. The helper
 * searches BOTH streams anyway, so a partition change surfaces as a real failure
 * rather than a silently-passing `notCodes` assertion.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { fileHasDbStateContext } from "../../src/codegen/collect.ts";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

/**
 * Write `files` ({ relativePath: source }) into a scratch dir and compile the
 * named entries as ONE compilation unit.
 *
 * ⚑ `inputFiles` ORDER IS A PARAMETER ON PURPOSE. The application-scope fact is
 * computed with `files.some(...)` over the whole set, so it must not depend on
 * which file `runTS` happens to visit first. One test below passes the page
 * BEFORE the entry for exactly that reason.
 */
function compileUnit(files, inputs, tag) {
  const t = `${tag}-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_auth005_${t}`);
  try {
    for (const [rel, src] of Object.entries(files)) {
      const abs = resolve(tmpDir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, src);
    }
    const result = compileScrml({
      inputFiles: inputs.map((rel) => resolve(tmpDir, rel)),
      write: false,
      outputDir: resolve(tmpDir, "out"),
      log: () => {},
    });
    const all = [...(result.errors ?? []), ...(result.warnings ?? [])];
    return {
      codes: all.map((d) => d?.code).filter(Boolean),
      errors: result.errors ?? [],
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const fired = (r) => r.codes.includes("E-AUTH-005");

// The entry file of a multi-file app: the ONE `<program>` (§40.8), carrying the
// application's `db=`. No `<var server>` of its own — the cell under test lives
// in the page, which is the whole point.
const ENTRY_WITH_DB = `<program db="./app.db">

<schema>
  notes {
    id:   integer primary key
    body: text not null
  }
</schema>

<h1>Home</h1>
</program>
`;

// The same entry with NO database. The application genuinely has no server
// context, so E-AUTH-005 is CORRECT for every cell in it.
const ENTRY_NO_DB = `<program title="Notes">

<h1>Home</h1>
</program>
`;

// A canonical non-entry route file (§40.8): a `<page>` opener, NO `<program>`.
const PAGE_SERVER_CELL = `<page>
  <notes server> = 0
  <h1>Notes</h1>
  <p>\${@notes}</p>
</page>
`;

describe("E-AUTH-005 — application scope (§52.11 / §40.8 / §58.8)", () => {
  test("multi-file: a `<var server>` in a page does NOT fire when the ENTRY carries db=", () => {
    const r = compileUnit(
      { "app.scrml": ENTRY_WITH_DB, "pages/notes.scrml": PAGE_SERVER_CELL },
      ["app.scrml", "pages/notes.scrml"],
      "entry-db",
    );
    expect(fired(r)).toBe(false);
  });

  test("multi-file: the SAME page DOES fire when NO file in the unit carries db=", () => {
    // The anti-suppression direction. If this ever goes green-by-silence, the
    // fix above has degenerated from "wider unit" into "weaker test".
    const r = compileUnit(
      { "app.scrml": ENTRY_NO_DB, "pages/notes.scrml": PAGE_SERVER_CELL },
      ["app.scrml", "pages/notes.scrml"],
      "entry-nodb",
    );
    expect(fired(r)).toBe(true);
  });

  test("multi-file: the verdict does not depend on input ORDER (page listed first)", () => {
    const r = compileUnit(
      { "app.scrml": ENTRY_WITH_DB, "pages/notes.scrml": PAGE_SERVER_CELL },
      ["pages/notes.scrml", "app.scrml"],
      "order",
    );
    expect(fired(r)).toBe(false);
  });

  test("single file: a `<program>` with no db= still fires (conformance auth-005-pos)", () => {
    const r = compileUnit(
      {
        "app.scrml": `<program title="Dashboard">
<count server> = 0
<p>\${@count}</>
</program>
`,
      },
      ["app.scrml"],
      "single-nodb",
    );
    expect(fired(r)).toBe(true);
  });

  test("single file: a `<program db=>` does not fire (conformance auth-005-neg)", () => {
    const r = compileUnit(
      {
        "app.scrml": `<program db="postgres">
<count server> = 0
<p>\${@count}</>
</program>
`,
      },
      ["app.scrml"],
      "single-db",
    );
    expect(fired(r)).toBe(false);
  });

  test("a page whose OWN `<db src=>` supplies the context does not fire, even alone", () => {
    // The corpus-canonical multi-file page shape — `examples/23-trucking-dispatch`
    // writes `<db src="../../dispatch.db">` in every page file. This is Form 2 of
    // `collectDbScopes`, i.e. a database codegen really connects.
    const r = compileUnit(
      {
        "notes.scrml": `<page>
  <db src="./app.db" tables="notes">
    \${
      <notes server> = 0
    }
  </db>
  <h1>Notes</h1>
  <p>\${@notes}</p>
</page>
`,
      },
      ["notes.scrml"],
      "dbsrc",
    );
    expect(fired(r)).toBe(false);
  });

  test("a lone page with no db anywhere in the unit still fires", () => {
    // Compiled by itself, the page IS the compilation unit and that unit has no
    // server context — so the answer is unchanged from before the fix. This pins
    // that the repair widened the UNIT rather than exempting the `<page>` SHAPE.
    const r = compileUnit(
      { "notes.scrml": PAGE_SERVER_CELL },
      ["notes.scrml"],
      "lone-page",
    );
    expect(fired(r)).toBe(true);
  });
});

/**
 * The two shapes that decide whether Form 1 and Form 2 of
 * `fileEstablishesServerContext` agree with each other. Both were live regressions
 * introduced by the first cut of this change and caught in adversarial review;
 * both fire correctly on the pre-change compiler, so a revert-shaped mistake
 * reintroduces them silently.
 */
describe("E-AUTH-005 — the `<db src=>` half must answer the same question as the `<program db=>` half", () => {
  test("a `<db src=>` reachable ONLY inside a NESTED `<program>` does not supply the outer context", () => {
    // §4.12.1 — a nested `<program>` is a SEPARATE compilation unit, so its
    // database is not in scope for a `<var server>` in the enclosing program.
    // Form 1 always obeyed this (it scans top-level only); Form 2 used to walk
    // straight through and report the worker's db as the outer file's context.
    const r = compileUnit(
      {
        "app.scrml": `<program title="Outer">

<count server> = 0
<p>\${@count}</p>

<program name="worker">
  <db src="./worker.db" tables="jobs">
    \${
      function pick() {
        return ?{\`CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY)\`}.run()
      }
    }
  </db>
</program>
</program>
`,
      },
      ["app.scrml"],
      "nested-program-db",
    );
    expect(fired(r)).toBe(true);
  });

  test("DISCLOSED OVER-FIRE: a `<var server>` INSIDE the nested `<program>` that owns the db fires anyway", () => {
    // ⛔ THIS TEST PINS A KNOWN-WRONG VERDICT ON PURPOSE. It is not an assertion
    // that the behaviour is correct — it is a tripwire so the day someone lands
    // per-`<program>`-scope resolution, this test FAILS and tells them to delete
    // it rather than the behaviour changing silently.
    //
    // Codegen genuinely connects `./worker.db` for this file, so the predicate's
    // own opening invariant ("a file for which codegen emits a live database
    // handle is not a client-only context") says E-AUTH-005 should NOT fire.
    // It fires because `compilationUnitHasServerContext` is ONE boolean per
    // compilation and the fire site applies it to every cell regardless of scope.
    //
    // Direction is over-fire (fail-safe). Blast radius is corpus-zero. The real
    // fix is the build-root-entry-resolver arc. MEASURED: the `<program db=>`
    // spelling of this same shape fires at f95321bf, fc27fbe8 AND here — so this
    // is a pre-existing defect extended to the second spelling, not a new one.
    const r = compileUnit(
      {
        "app.scrml": `<program title="Outer">
<h1>Outer</h1>
<program name="worker">
  <db src="./worker.db" tables="jobs"></db>
  <count server> = 0
  <p>\${@count}</p>
</program>
</program>
`,
      },
      ["app.scrml"],
      "nested-owns-db",
    );
    expect(fired(r)).toBe(true); // known-wrong; see the comment above
  });

  test("a `<db>` with NO `src=` does not supply a server context", () => {
    // `collectDbScopes` registers a scope only for a non-empty `src=`, so a bare
    // `<db tables=…>` connects NOTHING. The predicate used to test only
    // kind/stateType and suppress E-AUTH-005 anyway — sound in practice only
    // because an unrelated code (E-PA-006) happened to reject the shape.
    const r = compileUnit(
      {
        "app.scrml": `<program title="NoSrc">

<db tables="notes">
  \${
    <count server> = 0
  }
</db>
<p>\${@count}</p>
</program>
`,
      },
      ["app.scrml"],
      "db-no-src",
    );
    expect(fired(r)).toBe(true);
  });
});

/**
 * Predicate-level tests. The compile-level cases above prove the OUTCOME; these
 * prove the predicate is sound ON ITS OWN, rather than leaning on whichever other
 * diagnostic happens to reject the same shape. That distinction is the whole
 * finding in the `src=` case — E-PA-006 was doing the work, and nothing said so.
 */
describe("fileHasDbStateContext — direct", () => {
  const db = (attrs) => ({ kind: "state", stateType: "db", attrs, children: [] });
  const strAttr = (name, value) => ({ name, value: { kind: "string-literal", value } });
  const program = (attrs, children) => ({ kind: "markup", tag: "program", attrs, children });

  test("true for a `<db src=…>` with a non-empty src", () => {
    expect(fileHasDbStateContext({ nodes: [db([strAttr("src", "./app.db")])] })).toBe(true);
  });

  test("false for a `<db>` with no src attribute at all", () => {
    expect(fileHasDbStateContext({ nodes: [db([strAttr("tables", "notes")])] })).toBe(false);
  });

  test("false for a `<db src=\"\">` with an EMPTY src", () => {
    // `collectDbScopes` guards `srcVal.length > 0`; an empty string builds no handle.
    expect(fileHasDbStateContext({ nodes: [db([strAttr("src", "")])] })).toBe(false);
  });

  test("true for a `<db src=…>` inside the file's OWN top-level `<program>`", () => {
    const ast = { nodes: [program([], [db([strAttr("src", "./app.db")])])] };
    expect(fileHasDbStateContext(ast)).toBe(true);
  });

  test("false when the only `<db src=…>` is inside a NESTED `<program>`", () => {
    const nested = program([strAttr("name", "worker")], [db([strAttr("src", "./w.db")])]);
    const ast = { nodes: [program([], [nested])] };
    expect(fileHasDbStateContext(ast)).toBe(false);
  });

  test("reads through the `.ast.nodes` wrapper shape as well as bare `.nodes`", () => {
    expect(fileHasDbStateContext({ ast: { nodes: [db([strAttr("src", "./a.db")])] } })).toBe(true);
  });
});
