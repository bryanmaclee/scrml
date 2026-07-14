// R25-Bug-42 (S138) — `?{}` SQL lowering inside `server function*` SSE
// generator bodies + top-level `server function`/`server function*` lift +
// synthetic-logic child-recovery.
//
// Pre-fix surface:
//   - `server function getX() { return ?{...}.all() }` at top-level (no `${}`
//     wrap) emitted raw `? { \`...\` } . all ( );` tokens in server.js;
//   - `server function* watch() { while (true) { yield ?{...}.all() } }` at
//     top-level was entirely dropped (BARE_DECL_RE missed `function*` — no
//     server.js handler synthesized); when wrapped in `${}`, the `yield ?{...}`
//     parsed as `yield;` + standalone SQL statement (value discarded).
//
// Three coupled root causes closed:
//   (a) ast-builder.js BARE_DECL_RE required `\s` after `function`/`fn` —
//       generator forms `function*` / `fn*` missed the lift gate.
//   (b) Synthetic logic blocks (children: []) lost their brace-delimited child
//       blocks; `?{...}` inside the wrapped raw tokenized as PUNCT tokens
//       rather than BLOCK_REF sql — sqlNode never attached to return-stmt /
//       state-decl / let-decl.
//   (c) yield was not recognized as a statement leader at parse time, and
//       even if recognized, the surrounding while-body emission dropped
//       opts.boundary so the sqlNode branch fell back to client-mode emission.
//
// Cross-refs SPEC §13 `?{}` query expressions; SPEC §37 SSE `server function*`;
// SPEC §40.8 default-logic mode; docs/known-gaps.md Bug 42.

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { compileScrml } from "../../src/api.js";

const _testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let _tmpCounter = 0;

// Helper — run the compiler over a single .scrml source string and return
// the {client, server, errors} bundle. Uses on-disk fixture path (mirrors
// the pattern in return-sql-chained-call.test.js).
async function compile(source, tag) {
  const _tag = tag ?? `bug42-${++_tmpCounter}`;
  const _tmpDir = resolve(_testDir, `_tmp_bug42_${_tag}`);
  const _tmpInput = resolve(_tmpDir, `${_tag}.scrml`);
  mkdirSync(_tmpDir, { recursive: true });
  writeFileSync(_tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [_tmpInput],
      write: false,
      outputDir: resolve(_tmpDir, "out"),
    });
    let server = "";
    let client = "";
    for (const [fp, output] of (result.outputs ?? new Map())) {
      if (fp.includes(_tag)) {
        if (output && typeof output.serverJs === "string") server = output.serverJs;
        if (output && typeof output.clientJs === "string") client = output.clientJs;
      }
    }
    return { server, client, errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(_tmpInput)) rmSync(_tmpInput);
    if (existsSync(_tmpDir)) rmSync(_tmpDir, { recursive: true });
  }
}

const SCHEMA_PREAMBLE = `<program title="t">
  <schema>
    <db logs src=":memory:" tables="entries">
      id integer primary key
      kind text not null
    </>
  </schema>

  <cursor> = 0

  <page>
    <p>logs ${"${@cursor}"}</p>
  </page>
`;

describe("R25-Bug-42 — server function* + ?{} lowering at top-level", () => {
  // -------------------------------------------------------------------------
  // 1. Minimal repro — `server function* watch() { while(true) { yield ?{...}.all() } }`
  //    at top-level (no `${}` wrap). MUST lower SQL + emit `yield await sql...`.
  // -------------------------------------------------------------------------
  test("server function* with yield ?{...}.all() inside while emits yield await _scrml_sql`...`", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* watchActivity() {
    while (true) {
      yield ?{` + "`SELECT * FROM entries`" + `}.all()
    }
  }
</program>`;
    const { server } = await compile(src);
    // SQL lowered correctly
    expect(server).toMatch(/yield\s+await\s+_scrml_sql`SELECT \* FROM entries`/);
    // No raw `? {` PUNCT tokens leak
    expect(server).not.toMatch(/yield\s*\?\s*\{/);
    // No standalone `yield;` followed by SQL (the pre-fix split shape)
    expect(server).not.toMatch(/yield\s*;\s*\n\s*await\s+_scrml_sql/);
  });

  // -------------------------------------------------------------------------
  // 2. Regression-guard — `server function getX() { return ?{...}.all() }` at
  //    top-level (no `${}` wrap). Phase 1 sub-fix: synthetic-logic child
  //    recovery covers non-generator path too.
  // -------------------------------------------------------------------------
  test("server function (non-generator) with return ?{...}.all() at top-level lowers SQL", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function getActivity() {
    return ?{` + "`SELECT * FROM entries`" + `}.all()
  }
</program>`;
    const { server } = await compile(src);
    expect(server).toMatch(/return\s+await\s+_scrml_sql`SELECT \* FROM entries`/);
    expect(server).not.toMatch(/return\s*\?\s*\{/);
  });

  // -------------------------------------------------------------------------
  // 3. Wrapped in `${...}` — must keep working (pre-existing canon path).
  // -------------------------------------------------------------------------
  test("server function* inside ${} wrap still lowers correctly (regression guard)", async () => {
    const src = SCHEMA_PREAMBLE + `
  ${"${"}
    server function* watchActivity() {
      while (true) {
        yield ?{` + "`SELECT * FROM entries`" + `}.all()
      }
    }
  ${"}"}
</program>`;
    const { server } = await compile(src);
    expect(server).toMatch(/yield\s+await\s+_scrml_sql`SELECT \* FROM entries`/);
  });

  // -------------------------------------------------------------------------
  // 4. ?{} with bound param ${@cursor} — server-mode rewrite produces
  //    `_scrml_body["cursor"]`. (Whether GET-SSE actually has _scrml_body
  //    populated is a separate SSE-codegen concern; here we just verify the
  //    server-mode interpolation path is taken, not client-mode.)
  // -------------------------------------------------------------------------
  test("yield ?{...${@cursor}...}.all() emits server-mode @cursor binding", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* watchActivity() {
    while (true) {
      yield ?{` + "`SELECT * FROM entries WHERE id > ${@cursor}`" + `}.all()
    }
  }
</program>`;
    const { server } = await compile(src);
    // Server-mode rewrite — `_scrml_body[...]`, NOT the client-side `_scrml_reactive_get`.
    expect(server).toMatch(/_scrml_body\["cursor"\]/);
    expect(server).not.toMatch(/yield\s+await\s+_scrml_sql`[^`]*_scrml_reactive_get/);
  });

  // -------------------------------------------------------------------------
  // 5. Multi-yield — generator with multiple `?{...}` yields in sequence.
  // -------------------------------------------------------------------------
  test("multi-yield generator with two ?{...} sites both lower", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* multiYield() {
    yield ?{` + "`SELECT * FROM entries`" + `}.all()
    yield ?{` + "`SELECT COUNT(*) FROM entries`" + `}.get()
  }
</program>`;
    const { server } = await compile(src);
    // First yield: tagged template → array via .all() → `await _scrml_sql\`SELECT * ...\``.
    expect(server).toMatch(/yield\s+await\s+_scrml_sql`SELECT \* FROM entries`/);
    // Second yield: .get() lowers to `[0] ?? null`.
    expect(server).toMatch(/yield\s+\(await\s+_scrml_sql`SELECT COUNT\(\*\) FROM entries`\)\[0\] \?\? null/);
  });

  // -------------------------------------------------------------------------
  // 6. .run() / .get() / .all() chain variants — all lower as expected.
  // -------------------------------------------------------------------------
  test(".run() / .get() / .all() chains lower correctly in yield position", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* chainShapes() {
    yield ?{` + "`SELECT * FROM entries`" + `}.all()
    yield ?{` + "`SELECT id FROM entries LIMIT 1`" + `}.get()
    yield ?{` + "`DELETE FROM entries WHERE id < 100`" + `}.run()
  }
</program>`;
    const { server } = await compile(src);
    // .all() → tagged template form, value is the result array.
    expect(server).toMatch(/yield\s+await\s+_scrml_sql`SELECT \* FROM entries`/);
    // .get() → `(await sql`...`)[0] ?? null`.
    expect(server).toMatch(/yield\s+\(await\s+_scrml_sql`SELECT id FROM entries LIMIT 1`\)\[0\] \?\? null/);
    // .run() → just `await sql`...``.
    expect(server).toMatch(/yield\s+await\s+_scrml_sql`DELETE FROM entries WHERE id < 100`/);
  });

  // -------------------------------------------------------------------------
  // 7. Generator with mixed non-SQL yields — `yield 1` / `yield "x"` /
  //    `yield {event:"e", data:1}` must compose with the new yield-stmt path.
  // -------------------------------------------------------------------------
  test("generator with mixed non-SQL yields composes correctly", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* mixed() {
    yield 1
    yield ?{` + "`SELECT * FROM entries`" + `}.all()
    yield 42
  }
</program>`;
    const { server } = await compile(src);
    expect(server).toMatch(/yield\s+1\s*;/);
    expect(server).toMatch(/yield\s+await\s+_scrml_sql`SELECT \* FROM entries`/);
    expect(server).toMatch(/yield\s+42\s*;/);
  });

  // -------------------------------------------------------------------------
  // 8. server function* with no `?{}` body — sanity check generator structure
  //    still emits (no regression from yield-stmt parser addition).
  // -------------------------------------------------------------------------
  test("server function* without ?{} still emits SSE handler structure", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* counter() {
    yield 1
    yield 2
    yield 3
  }
</program>`;
    const { server } = await compile(src);
    // SSE handler structure: text/event-stream, ReadableStream, async function* _scrml_gen.
    expect(server).toMatch(/text\/event-stream/);
    expect(server).toMatch(/async function\* _scrml_gen/);
    // Three plain integer yields make it through.
    expect(server).toMatch(/yield\s+1\s*;/);
    expect(server).toMatch(/yield\s+2\s*;/);
    expect(server).toMatch(/yield\s+3\s*;/);
  });

  // -------------------------------------------------------------------------
  // 9. Bare yield (no value) — `yield;` still emits cleanly.
  // -------------------------------------------------------------------------
  test("bare yield (no value) emits as `yield;`", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* sleeper() {
    yield;
    yield 1
  }
</program>`;
    const { server } = await compile(src);
    expect(server).toMatch(/yield\s*;\s*\n/);
    expect(server).toMatch(/yield\s+1/);
  });

  // -------------------------------------------------------------------------
  // 10. No raw `? {` PUNCT-token leak anywhere — security-equivalent guard.
  //     The pre-fix shape `? { \`...\` } . all ( )` MUST NOT appear in
  //     the emitted server.js for any of the above tests.
  // -------------------------------------------------------------------------
  test("emitted server.js never contains raw PUNCT-form `? {` SQL leak", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function getOne() {
    return ?{` + "`SELECT * FROM entries LIMIT 1`" + `}.get()
  }

  server function* watchAll() {
    while (true) {
      yield ?{` + "`SELECT * FROM entries`" + `}.all()
    }
  }
</program>`;
    const { server } = await compile(src);
    // The pre-fix leak shape was `? { \`...\` } . method ( )` with PUNCT
    // tokens separated by spaces.
    expect(server).not.toMatch(/\?\s+\{\s+`/);
    expect(server).not.toMatch(/\}\s+\.\s+(all|get|run)\s+\(\s*\)/);
  });

  // -------------------------------------------------------------------------
  // 11. Client.js MUST NOT contain `_scrml_sql` references — security
  //     invariant per SPEC §37.8 (server-only resources stay on server).
  // -------------------------------------------------------------------------
  test("client.js contains no _scrml_sql references for server function*", async () => {
    const src = SCHEMA_PREAMBLE + `
  server function* watchActivity() {
    while (true) {
      yield ?{` + "`SELECT * FROM entries`" + `}.all()
    }
  }
</program>`;
    const { client } = await compile(src);
    expect(client).not.toMatch(/_scrml_sql/);
    // But MUST contain the EventSource stub.
    expect(client).toMatch(/new EventSource/);
  });

  // -------------------------------------------------------------------------
  // 12. Non-server generator `function* foo()` — admitted by SPEC §13 (S114
  //     generator carve-out). Per SPEC §37 only `server function*` is the SSE
  //     surface; a bare `function*` is a regular generator. ?{} inside such a
  //     generator on the client boundary correctly fires the defensive
  //     "client cannot evaluate _scrml_sql" guard (Layer 2 yield-stmt arm).
  // -------------------------------------------------------------------------
  test("client-boundary function* with ?{} emits defensive yield-null guard", async () => {
    const src = SCHEMA_PREAMBLE + `
  function* clientGen() {
    yield ?{` + "`SELECT * FROM entries`" + `}.all()
  }
</program>`;
    const { client } = await compile(src);
    // The defensive client-side guard mirrors the return-stmt Layer 2 fix:
    // emit `yield null;` with the E-CG-006 comment so the JS still parses
    // even if RI misclassified the boundary. The diagnostic comment mentions
    // _scrml_sql by name (the diagnostic itself, not a leak).
    expect(client).toMatch(/yield null;\s*\/\/ SQL — client cannot evaluate _scrml_sql/);
    // No EXECUTABLE _scrml_sql reference — only the diagnostic comment text.
    // Strip comments and assert _scrml_sql doesn't appear in the resulting code.
    const codeNoComments = client.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeNoComments).not.toMatch(/_scrml_sql/);
  });
});
