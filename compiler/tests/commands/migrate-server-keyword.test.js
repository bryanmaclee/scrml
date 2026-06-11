/**
 * Tests for `scrml migrate --fix` Migration 4 (server-keyword-eliminate S180).
 *
 * Migration 4 strips the deprecated `server` keyword from `server function
 * NAME(` declarations — but ONLY where it is SAFE: where the function STILL
 * escalates server WITHOUT the keyword. The safety signal is the
 * W-DEPRECATED-SERVER-MODIFIER lint (route-inference.ts Step 5d), which fires
 * iff the keyword is REDUNDANT (a NON-explicit-annotation escalation reason —
 * T1/T2/T3 body content, T5 caller-context, T7 channel cell-write/broadcast,
 * T8 reserved-name handle — is present). So:
 *   - lint FIRES → dropping `server` keeps the fn server → SAFE to strip.
 *   - lint silent on `server fn` (pure pin) → auto-preserved.
 *   - lint silent on a keyword-only-no-trigger `server function` (the pure/stub
 *     CLIENT-FLIP danger) → left untouched (correct).
 * Plus ONE explicit exclusion: never the SSE generator `server function*`
 * (deferred to its own DD; a SQL-bearing SSE WOULD fire the lint, so the
 * `function*` exclusion is required, not belt-and-suspenders).
 *
 * `rewriteServerFunctionKeyword` is diagnostic-driven (it staged-compiles the
 * source IN PLACE to collect the fire-sites), so each test stages a real
 * on-disk file in a tmp dir.
 *
 * Sections:
 *   §1  POSITIVE — SQL-body server function (T1/T3) → STRIPPED.
 *   §2  PRESERVE — `server fn` (pure pin) → UNTOUCHED.
 *   §3  EXCLUDE  — SSE `server function*` (even with SQL) → UNTOUCHED.
 *   §4  DANGER   — keyword-only-no-trigger `server function` → UNTOUCHED.
 *   §5  POSITIVE — channel publisher (T7) → STRIPPED.
 *   §6  POSITIVE — `server function handle(request, resolve)` (T8) → STRIPPED.
 *   §7  IDEMPOTENT — a re-run finds no W-DEPRECATED → no change.
 *   §8  COMPOSITION — a file with `<machine>` + `pure` + `server function`
 *       migrates all of M1/M2/M3 + Migration 4 cleanly via migrateFile --fix.
 *   §9  NO-CLIENT-FLIP — a stripped channel/handle/SQL file still compiles and
 *       the function STAYS server-boundary (no SQL leak into clientJs).
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  rewriteServerFunctionKeyword,
  migrateFile,
} from "../../src/commands/migrate.js";
import { compileScrml } from "../../src/api.js";

// ---------------------------------------------------------------------------
// Tmp helpers — Migration 4 is disk-staged (reads/writes the file in place to
// collect W-DEPRECATED diagnostics), so fixtures must be real on-disk files.
// ---------------------------------------------------------------------------

let tmpDir;

function setupTmp() {
  tmpDir = join(
    tmpdir(),
    `scrml-migrate-serverkw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
}

function teardownTmp() {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Write `source` to `<tmpDir>/<name>` and return its absolute path. */
function stage(name, source) {
  const p = join(tmpDir, name);
  writeFileSync(p, source, "utf8");
  return p;
}

beforeEach(setupTmp);
afterEach(teardownTmp);

// ---------------------------------------------------------------------------
// §1  POSITIVE — SQL-body server function (T1/T3) → STRIPPED
// ---------------------------------------------------------------------------

describe("§1 SQL-body server function → `server` stripped", () => {
  test("`server function f() { ?{ select ... } }` → `function f()`", () => {
    const source = `<program>
\${
  server function getRows() {
    return ?{ select id from users }.all()
  }
}
<div onclick="getRows()">x</>
</program>`;
    const path = stage("sql.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);

    expect(r.changed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.rewritten).toContain(`function getRows()`);
    expect(r.rewritten).not.toContain(`server function getRows()`);
    // The body (and everything else) is otherwise byte-identical.
    expect(r.rewritten).toContain(`?{ select id from users }.all()`);
  });
});

// ---------------------------------------------------------------------------
// §2  PRESERVE — `server fn` (pure-server pin) → UNTOUCHED
// ---------------------------------------------------------------------------

describe("§2 `server fn` pure-server pin → untouched", () => {
  test("`server fn g() -> int { return 1 }` is NOT stripped", () => {
    const source = `<program>
\${
  server fn pinnedPure() -> int {
    return 1
  }
}
<div>x</>
</program>`;
    const path = stage("serverfn.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);

    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
    expect(r.rewritten).toContain(`server fn pinnedPure()`);
  });
});

// ---------------------------------------------------------------------------
// §3  EXCLUDE — SSE `server function*` (even with SQL) → UNTOUCHED
// ---------------------------------------------------------------------------

describe("§3 SSE `server function*` → untouched (deferred exclusion)", () => {
  test("`server function* sse()` with a SQL body is NOT stripped", () => {
    // A SQL-bearing SSE WOULD fire W-DEPRECATED-SERVER-MODIFIER (the body
    // escalates), so the `function*` exclusion is what protects it — not the
    // lint. This is the load-bearing exclusion: without it, the SSE keyword
    // would be stripped and SSE is deferred to its own DD.
    const source = `<program>
\${
  server function* sseFeed() {
    yield ?{ select id from users }.all()
  }
}
<div>x</>
</program>`;
    const path = stage("sse.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);

    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
    expect(r.rewritten).toContain(`server function* sseFeed()`);
  });
});

// ---------------------------------------------------------------------------
// §4  DANGER — keyword-only-no-trigger `server function` → UNTOUCHED
// ---------------------------------------------------------------------------

describe("§4 keyword-only-no-trigger `server function` → untouched (client-flip danger)", () => {
  test("a pure-body `server function h() { return \"x\" }` is left intact", () => {
    // This is the CLIENT-FLIP DANGER site: the `server` keyword is the ONLY
    // thing pinning the function server (no body trigger, no caller-context).
    // W-DEPRECATED-SERVER-MODIFIER does NOT fire here, so Migration 4 leaves
    // it untouched — stripping it WOULD client-flip the function. Migration 4
    // never touches these; that is the entire point of the diagnostic-driven
    // design (a pure-text regex would client-flip it).
    const source = `<program>
\${
  server function pureStub() {
    return "x"
  }
}
<div>y</>
</program>`;
    const path = stage("stub.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);

    expect(r.changed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.rewritten).toBe(source);
    expect(r.rewritten).toContain(`server function pureStub()`);
  });
});

// ---------------------------------------------------------------------------
// §5  POSITIVE — channel publisher (T7) → STRIPPED
// ---------------------------------------------------------------------------

describe("§5 channel publisher (Trigger 7) → `server` stripped", () => {
  test("`server function` writing a channel cell inside <channel> → `function`", () => {
    // A standalone `function` decl inside a <channel> body that WRITES a
    // channel-declared cell escalates server via Trigger 7 (D2). With the
    // `server` keyword present, that keyword is redundant → W-DEPRECATED fires
    // → Migration 4 strips it.
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function bumpServer() {
      @count = @count + 1
    } }
  </>
</program>`;
    const path = stage("channel.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);

    expect(r.changed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.rewritten).toContain(`function bumpServer()`);
    expect(r.rewritten).not.toContain(`server function bumpServer()`);
    // The channel scaffolding + cell write are untouched.
    expect(r.rewritten).toContain(`<channel name="chat" topic="lobby">`);
    expect(r.rewritten).toContain(`@count = @count + 1`);
  });
});

// ---------------------------------------------------------------------------
// §6  POSITIVE — `server function handle(request, resolve)` (T8) → STRIPPED
// ---------------------------------------------------------------------------

describe("§6 reserved-name handle() (Trigger 8) → `server` stripped", () => {
  test("`server function handle(request, resolve)` → `function handle(request, resolve)`", () => {
    // handle() is recognized by its reserved name + (request, resolve)
    // signature; it escalates middleware-server via Trigger 8 (D2) on its own.
    // The `server` keyword is therefore redundant → W-DEPRECATED fires →
    // Migration 4 strips it. The §39.3.2 amendment (D2) is what makes the
    // keyword-less form legal.
    const source = `<program>
\${ server function handle(request, resolve) {
  return resolve(request)
} }
</program>`;
    const path = stage("handle.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);

    expect(r.changed).toBe(true);
    expect(r.count).toBe(1);
    expect(r.rewritten).toContain(`function handle(request, resolve)`);
    expect(r.rewritten).not.toContain(`server function handle(request, resolve)`);
  });
});

// ---------------------------------------------------------------------------
// §7  IDEMPOTENT — re-run on already-stripped source → no change
// ---------------------------------------------------------------------------

describe("§7 idempotency", () => {
  test("re-running Migration 4 on the stripped output finds no W-DEPRECATED → 0", () => {
    const source = `<program>
\${
  server function getRows() {
    return ?{ select id from users }.all()
  }
}
<div onclick="getRows()">x</>
</program>`;
    const path = stage("idem.scrml", source);

    const first = rewriteServerFunctionKeyword(source, path);
    expect(first.changed).toBe(true);
    expect(first.count).toBe(1);

    // The stripped `function getRows()` is now a plain (body-escalating)
    // function — W-DEPRECATED no longer fires (no keyword to deprecate).
    const second = rewriteServerFunctionKeyword(first.rewritten, path);
    expect(second.changed).toBe(false);
    expect(second.count).toBe(0);
    expect(second.rewritten).toBe(first.rewritten);
  });
});

// ---------------------------------------------------------------------------
// §8  COMPOSITION — `<machine>` (M2) + `pure` (M3) + `server function`
//     (Migration 4) all migrate cleanly via migrateFile --fix
// ---------------------------------------------------------------------------

describe("§8 composition with M1/M2/M3 via migrateFile --fix", () => {
  test("a file with <machine>, a `pure function`, and a SQL `server function` migrates all", () => {
    const source = `<program>
\${
  type FlowState:enum = { Idle, Done }

  pure function double(x) { return x * 2 }

  server function getRows() {
    return ?{ select id from users }.all()
  }
}

<machine name=Flow for=FlowState>
  .Idle => .Done
</>

<div onclick="getRows()">\${double(2)}</>
</program>`;
    const path = stage("compose.scrml", source);
    const r = migrateFile(path, { dryRun: true, check: false, fix: true }, tmpDir);

    expect(r.status).toBe("changed");
    expect(r.migrations).toBeDefined();
    // Migration 2: <machine> → <engine>.
    expect(r.migrations.machine).toBe(1);
    // Migration 3: `pure function` → `fn`.
    expect(r.migrations.pure).toBe(1);
    // Migration 4: `server function getRows` → `function getRows`.
    expect(r.migrations.serverFnKeyword).toBe(1);

    // dry-run does not write — the on-disk source is unchanged.
    expect(readFileSync(path, "utf8")).toBe(source);
  });

  test("in-place --fix run writes a file that strips all three + still compiles", () => {
    const source = `<program>
\${
  type FlowState:enum = { Idle, Done }

  pure function triple(x) { return x * 3 }

  server function loadRows() {
    return ?{ select id from users }.all()
  }
}

<machine name=Flow for=FlowState>
  .Idle => .Done
</>

<div onclick="loadRows()">\${triple(2)}</>
</program>`;
    const path = stage("compose-inplace.scrml", source);
    const r = migrateFile(path, { dryRun: false, check: false, fix: true }, tmpDir);

    expect(r.status).toBe("changed");
    const written = readFileSync(path, "utf8");
    expect(written).toContain(`<engine name=Flow for=FlowState>`);
    expect(written).toContain(`fn triple(x)`);
    expect(written).toContain(`function loadRows()`);
    expect(written).not.toContain(`server function loadRows()`);
    expect(written).not.toContain(`<machine`);

    // migrateFile's sanityCheckParse gate already proved it compiles; assert
    // directly too for the record.
    const compiled = compileScrml({
      inputFiles: [path],
      write: false,
      gather: true,
      log: () => {},
    });
    const fatal = (compiled.errors || []).filter(
      (e) => !e.severity || e.severity === "error",
    );
    expect(fatal).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §9  NO-CLIENT-FLIP — a stripped channel/handle/SQL file still compiles AND
//     the function STAYS server-boundary (no SQL leak into clientJs).
// ---------------------------------------------------------------------------

/** Compile `source` at `path` and return the single output record. */
function compileOutput(source, path) {
  writeFileSync(path, source, "utf8");
  const r = compileScrml({
    inputFiles: [path],
    write: false,
    gather: true,
    log: () => {},
  });
  const fatal = (r.errors || []).filter(
    (e) => !e.severity || e.severity === "error",
  );
  const out = [...(r.outputs || new Map()).values()][0] || {};
  return { fatal, clientJs: out.clientJs || "", serverJs: out.serverJs || "" };
}

describe("§9 no-client-flip — stripped server stays server-side", () => {
  test("stripped SQL server function keeps the SQL in serverJs, NOT clientJs", () => {
    const source = `<program>
\${
  server function getSecret() {
    return ?{ select secretcol from users }.all()
  }
}
<div onclick="getSecret()">x</>
</program>`;
    const path = stage("flip-sql.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);
    expect(r.changed).toBe(true);

    const { fatal, clientJs, serverJs } = compileOutput(r.rewritten, path);
    expect(fatal).toHaveLength(0);
    // The server-only SQL must NOT leak to the client bundle (no client-flip).
    expect(clientJs.includes("secretcol")).toBe(false);
    // It stays in the server bundle.
    expect(serverJs.includes("secretcol")).toBe(true);
  });

  test("stripped channel publisher still compiles + the cell-write stays server", () => {
    const source = `<program>
  <channel name="chat" topic="lobby">
    <count> = 0

    \${ server function bumpServer() {
      @count = @count + 1
    } }
  </>
</program>`;
    const path = stage("flip-channel.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);
    expect(r.changed).toBe(true);
    expect(r.rewritten).toContain(`function bumpServer()`);

    const { fatal } = compileOutput(r.rewritten, path);
    expect(fatal).toHaveLength(0);
  });

  test("stripped handle() still compiles + stays middleware-server", () => {
    const source = `<program>
\${ server function handle(request, resolve) {
  return resolve(request)
} }
</program>`;
    const path = stage("flip-handle.scrml", source);
    const r = rewriteServerFunctionKeyword(source, path);
    expect(r.changed).toBe(true);
    expect(r.rewritten).toContain(`function handle(request, resolve)`);
    expect(r.rewritten).not.toContain(`server function handle(request, resolve)`);

    const { fatal } = compileOutput(r.rewritten, path);
    expect(fatal).toHaveLength(0);
  });
});
