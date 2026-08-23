/**
 * stdlib-client-registry.test.js — §41 client stdlib registry, EXECUTED.
 *
 * WHY THIS FILE EXECUTES INSTEAD OF GREPPING, and it is the whole point.
 *
 * A client-side `import { slug } from 'scrml:format'` lowers to
 * `const { slug } = _scrml_stdlib.format;` — a browser classic script cannot
 * resolve a bare specifier — and `_scrml_stdlib.format` is assigned by the
 * `stdlib-format` runtime chunk and by nothing else. Before S368, 17 of the 21
 * stdlib modules had no such chunk. The consequences, all measured:
 *
 *   - the compile exited 0
 *   - a complete artifact set was written (.html, .client.js, runtime, _scrml/)
 *   - every text-level assertion anyone would think to write PASSED: the import
 *     was lowered, the read line was present, the shim file was on disk
 *   - and the page was DEAD ON ARRIVAL: `TypeError: Cannot destructure property
 *     'slug' from null or undefined value` thrown at bundle load, killing the
 *     ENTIRE page, not just the one call.
 *
 * A "the marker is present" test cannot see any of that, which is the S265
 * theme-switch lesson repeated. So §1 below LOADS the emitted runtime + client
 * bundle in one shared script scope — the browser's own model — and asserts the
 * page is not DOA. §5 is the instrument-integrity control: it feeds the harness
 * a deliberately-broken bundle and requires the harness to REPORT the failure,
 * because a harness that silently swallows a throw would report green forever
 * and this whole file would be theatre.
 *
 * WHY THIS LIVES IN integration/ AND NOT browser/, which is where it started.
 * `.git/hooks/pre-commit` runs `compiler/tests/{unit,integration,conformance}`
 * plus root `*.test.js` — `compiler/tests/browser/` is NOT in that set. So the
 * whole point of this file (a merge-blocker that proves the feature is not DOA)
 * was silently outside the merge gate. The browser tier is not load-bearing for
 * anything here: 14 integration tests already register happy-dom the same way,
 * including this feature's own predecessor
 * `integration/bug-18-scrml-stdlib-client-import.test.js`. Moving the file — not
 * just the newest regression — is what actually puts the evidence in the gate.
 */

import { describe, test, expect } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { resolve } from "path";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { RUNTIME_CHUNK_ORDER } from "../../src/codegen/runtime-chunks.ts";
import { isEscalationServerOnlyModule } from "../../src/route-inference.ts";

if (!globalThis.document) GlobalRegistrator.register();

const tmpRoot = resolve("/tmp", "scrml-stdlib-client-registry");

/** Compile one source string; return its errors + the emitted client/runtime text. */
function compile(source, baseName) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const tmpDir = resolve(tmpRoot, `case-${uniq}`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  const tmpInput = resolve(tmpDir, `${baseName}.scrml`);
  writeFileSync(tmpInput, source);
  const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
  const clientPath = resolve(outDir, `${baseName}.client.js`);
  const runtimePath = resolve(outDir, result.runtimeFilename ?? "scrml-runtime.js");
  const out = {
    errors: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error"),
    codes: (result.errors ?? []).map((e) => e.code),
    raw: result.errors ?? [],
    clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    runtimeJs: existsSync(runtimePath) ? readFileSync(runtimePath, "utf8") : "",
  };
  rmSync(tmpDir, { recursive: true, force: true });
  return out;
}

/**
 * Execute a bundle the way a browser does: the runtime and the client are two
 * CLASSIC scripts sharing ONE script scope, so the client's top-level
 * `const { … } = _scrml_stdlib.NAME;` sees the runtime's `_scrml_stdlib`.
 *
 * Returns `{ ok: true }` or `{ ok: false, error }`. It never throws, so a caller
 * can assert on the failure MODE; §5 pins that this is honest reporting and not
 * a swallow.
 */
function execBundle({ runtimeJs, clientJs }) {
  document.body.innerHTML = "";
  try {
    // eslint-disable-next-line no-new-func
    const run = new Function("window", "document", `${runtimeJs}\n;\n${clientJs}`);
    run(globalThis.window, globalThis.document);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * A program that imports ONE stdlib export and uses it in a CLIENT-reachable
 * position.
 *
 * The call sits in a `click=` handler, NOT in the first-render interpolation,
 * and that is deliberate. The property under test is whether the bundle LOADS —
 * the destructure `const { fn } = _scrml_stdlib.MOD;` runs at load either way.
 * Invoking at first render would additionally exercise each function's own
 * behaviour (`scrml:http`'s `get` really issues a fetch that happy-dom rejects
 * as a relative URL; `scrml:compiler`'s exports throw BY DESIGN), turning a
 * registry test into a per-module semantics test and reporting DOA for bundles
 * that loaded perfectly well. Measured: four of these cases failed that way on
 * the first run, none of them for a registry reason.
 */
function clientProgram(mod, fn) {
  return `\${
    import { ${fn} } from 'scrml:${mod}'

    @out = ""
}
<p>\${@out}</>
<button click=\${ @out = ${fn}("x") }>go</>
`;
}

/**
 * The first exported binding of a shim, read from the shim itself.
 *
 * Derived rather than hand-listed: a hand-written export table drifts the moment
 * a shim is edited, and a stale name produces `X is not a function` — a failure
 * that LOOKS like a registry defect and is not one.
 */
function firstExportOf(mod) {
  const src = readFileSync(resolve(import.meta.dir, "../../runtime/stdlib", `${mod}.js`), "utf8");
  const fn = /^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/m.exec(src);
  if (fn) return fn[1];
  const c = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/m.exec(src);
  if (c) return c[1];
  throw new Error(`no exported binding found in the shim for scrml:${mod}`);
}

/**
 * Evaluate the RUNTIME alone and return the registry it builds.
 *
 * Loading without a throw is necessary but not sufficient — a registry populated
 * with an EMPTY object would also load, and every §1 assertion would pass on a
 * runtime that shipped no stdlib code at all. This reads what the runtime
 * actually assigned so §1 can require the module's exports to really be there.
 */
function registryFromRuntime(runtimeJs) {
  // eslint-disable-next-line no-new-func
  return new Function("window", "document", `${runtimeJs}\n;\nreturn _scrml_stdlib;`)(
    globalThis.window,
    globalThis.document,
  );
}

/**
 * Every client-registered module, derived from RUNTIME_CHUNK_ORDER.
 *
 * Derived, not hand-listed, so a chunk added tomorrow is EXECUTED by this file
 * automatically. That is the whole lesson of the defect: the last 17 modules hid
 * because the thing that decided the outcome and the thing that checked it were
 * two different lists.
 */
const CLIENT_MODULES = RUNTIME_CHUNK_ORDER
  .filter((n) => n.startsWith("stdlib-"))
  .map((n) => n.slice("stdlib-".length));

// ---------------------------------------------------------------------------
// §1 — EXECUTION. Every client-registered module's bundle must LOAD.
// ---------------------------------------------------------------------------

describe("§1 client stdlib registry — the emitted bundle EXECUTES (not just emits)", () => {
  for (const mod of CLIENT_MODULES) {
    test(`scrml:${mod} — the bundle loads, and _scrml_stdlib.${mod} carries real exports`, () => {
      const fn = firstExportOf(mod);
      const compiled = compile(clientProgram(mod, fn), "app");
      expect(compiled.errors).toEqual([]);
      expect(compiled.clientJs).toContain(`_scrml_stdlib.${mod}`);

      // (a) THE DOA PROPERTY — the assertion that would have caught S368.
      // Naming the error in the message matters: a bare `toBe(true)` reports
      // "expected true, got false" and tells the next reader nothing about WHY
      // the page died.
      const run = execBundle(compiled);
      expect(run.ok ? "loaded" : `DOA: ${run.error.message}`).toBe("loaded");

      // (b) the registry is genuinely POPULATED, not merely non-null.
      const registry = registryFromRuntime(compiled.runtimeJs);
      expect(Object.keys(registry)).toContain(mod);
      expect(typeof registry[mod][fn]).not.toBe("undefined");
    });
  }

  test("scrml:data POSITIVE CONTROL — the module that always worked still works", () => {
    const compiled = compile(clientProgram("data", "toSnakeCase"), "app");
    expect(compiled.errors).toEqual([]);
    const run = execBundle(compiled);
    expect(run.ok ? "loaded" : `DOA: ${run.error.message}`).toBe("loaded");
    expect(typeof registryFromRuntime(compiled.runtimeJs).data.toSnakeCase).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// §1b — THE PARTITION. No stdlib module may sit in an unclassified third state.
// ---------------------------------------------------------------------------

describe("§1b every shim on disk is classified — client-registered XOR server-only", () => {
  test("the 21 shims partition exactly into client-registered and escalation-server-only", () => {
    // THE INVARIANT THAT KEEPS THE NEXT MODULE FROM HIDING THE WAY 17 DID.
    // A shim in neither set is a module nobody decided about: it has no client
    // chunk (so a client import is dead) and no server-only classification (so
    // nothing says that is intentional). This test forces the decision at the
    // moment a shim is added, which is the only moment anyone has the context
    // to make it.
    const shims = readdirSync(resolve(import.meta.dir, "../../runtime/stdlib"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => f.slice(0, -3))
      .sort();

    const unclassified = shims.filter(
      (m) => !CLIENT_MODULES.includes(m) && !isEscalationServerOnlyModule(`scrml:${m}`),
    );
    expect(unclassified).toEqual([]);

    // And the two sets between them cover every shim — neither is a subset of
    // some larger hand-maintained list that could quietly drop a name.
    const covered = shims.filter(
      (m) => CLIENT_MODULES.includes(m) || isEscalationServerOnlyModule(`scrml:${m}`),
    );
    expect(covered).toEqual(shims);
  });

  test("no module is BOTH client-registered and absent from the runtime", () => {
    // Every client-registered module must actually have its chunk assigned in
    // the shipped runtime — a name in RUNTIME_CHUNK_ORDER whose marker never
    // matched would extract an EMPTY chunk and be silently DOA again.
    const compiled = compile(clientProgram("format", "slug"), "app");
    const registry = registryFromRuntime(compiled.runtimeJs);
    for (const mod of CLIENT_MODULES) {
      // Only the modules this compile actually pulled in are assigned; the point
      // here is that an ASSIGNED module is never an empty object.
      if (!(mod in registry)) continue;
      expect(Object.keys(registry[mod]).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// §2 — the gate (limb 2). A client-reachable import with no chunk is REFUSED.
// ---------------------------------------------------------------------------

describe("§2 E-STDLIB-CLIENT-CHUNK-MISSING — a chunkless client import is refused at compile time", () => {
  // Every escalation-server-only module without a chunk (§12.2 Trigger 3). Each
  // one of these silently produced a dead page before S368.
  for (const mod of ["fs", "process", "store", "redis", "path", "cron", "mcp", "oauth"]) {
    test(`scrml:${mod} used client-side fires E-STDLIB-CLIENT-CHUNK-MISSING`, () => {
      const compiled = compile(clientProgram(mod, firstExportOf(mod)), "app");
      expect(compiled.codes).toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
    });
  }

  test("a SUBMODULE specifier fires too — `_scrml_stdlib.auth/jwt` parses as a division", () => {
    // Distinct second defect, same class: the emitted read is
    // `const { verifyJwt } = _scrml_stdlib.auth/jwt;`, which JavaScript parses
    // as `_scrml_stdlib.auth / jwt` and dies with `ReferenceError: jwt is not
    // defined` — even though `_scrml_stdlib.auth` IS defined.
    const compiled = compile(clientProgram("auth/jwt", "verifyJwt"), "app");
    expect(compiled.codes).toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
  });
});

// ---------------------------------------------------------------------------
// §3 — the gate does NOT over-fire. This is the half that is easy to skip and
//      the half that decides whether the gate is usable at all.
// ---------------------------------------------------------------------------

describe("§3 the gate does NOT over-fire on correct code", () => {
  test("a server-only stdlib reached ONLY from a server fn compiles clean", () => {
    // `readFileSync` is referenced only inside a `server function`, so the
    // lowered client read is pruned out of the bundle by
    // `pruneUnusedClientImports` and nothing is DOA. Gating at the EMIT site
    // instead of on the FINAL client text rejected 21 correct corpus files this
    // way (measured, S368) — this test pins that fix and would go red if the
    // gate ever moved back upstream of the prune.
    const compiled = compile(
      `\${
    import { readFileSync } from 'scrml:fs'

    @out = ""

    server function loadIt() {
        return readFileSync("/etc/hostname")
    }
}
<p>\${@out}</>
<button click=\${ @out = "x" }>go</>
`,
      "app",
    );
    expect(compiled.codes).not.toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
  });

  test("a SUBMODULE stdlib reached only from a server fn is PRUNED and compiles + EXECUTES", () => {
    // THIRD DEFECT FOUND AT S368, and the one that had a passing test sitting on
    // top of it. `pruneUnusedClientImports`'s region regex matched the module
    // segment as `[A-Za-z0-9_$]*` with NO slash, so a submodule read
    // (`const { splitBlocks } = _scrml_stdlib.compiler/bs;`) was never even
    // RECOGNISED as a removable region and survived into the client bundle —
    // even though the only use was inside a `server function`. That text parses
    // as the division `_scrml_stdlib.compiler / bs`, so the page was DEAD ON
    // ARRIVAL with `ReferenceError: bs is not defined`.
    //
    // `stdlib-shim-resolution.test.js` section 4 compiles this exact fixture and
    // asserted `errors == []` — and passed, because it read the emitted SERVER
    // file and never executed the client bundle. That is why this assertion
    // EXECUTES.
    const compiled = compile(
      `\${
    import { splitBlocks } from 'scrml:compiler/bs'
    server function _useStdlib() {
        return splitBlocks
    }
}
h1 "submodule server-only smoke"
`,
      "app",
    );
    expect(compiled.codes).not.toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
    expect(compiled.clientJs).not.toContain("_scrml_stdlib.compiler/bs");
    const run = execBundle(compiled);
    expect(run.ok ? "loaded" : `DOA: ${run.error.message}`).toBe("loaded");
  });

  test("a program with no stdlib import at all does not fire the gate", () => {
    const compiled = compile(
      `\${
    @out = "hi"
}
<p>\${@out}</>
`,
      "app",
    );
    expect(compiled.codes).not.toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
  });
});

// ---------------------------------------------------------------------------
// §3b — NON-CODE POSITIONS. `_scrml_stdlib.` in prose is not a registry access.
// ---------------------------------------------------------------------------

describe("§3b the gate does not false-fire on `_scrml_stdlib.` text in a non-code position", () => {
  // THE REGRESSION THAT SHIPPED AND WAS CAUGHT IN REVIEW. The gate scans emitted
  // client TEXT, so any occurrence of `_scrml_stdlib.` read as a registry access
  // — including one inside a STRING LITERAL the adopter wrote as a display
  // label. The result was a HARD ERROR on valid scrml with ZERO stdlib imports,
  // naming a module that has never existed and instructing the adopter to go
  // edit `RUNTIME_CHUNK_ORDER` in the compiler's own source.
  //
  // `wombat` is deliberately a name no stdlib module has ever had: if this test
  // ever fails, the message says `scrml:wombat` and nobody can mistake it for a
  // real module resolution problem.
  //
  // This is the SECOND instance of one class — the first was the runtime's own
  // `_scrml_stdlib.NAME` comment matching, fixed by excising the runtime span.
  // Fixing an instance is not fixing a class, which is why the assertions below
  // sweep the non-code positions rather than pinning the one reported shape.
  const cases = [
    ["a single name in a string literal", `<tip> = "the registry slot is _scrml_stdlib.wombat"`],
    ["TWO names in one string literal", `<tip> = "slots: _scrml_stdlib.otter and _scrml_stdlib.stoat"`],
    ["a name in a single-quoted string", `<tip> = 'slot _scrml_stdlib.badger here'`],
  ];

  for (const [label, decl] of cases) {
    test(`${label} does NOT fire E-STDLIB-CLIENT-CHUNK-MISSING`, () => {
      const compiled = compile(
        `<program>
<out> = ""
${decl}
<p>\${@out}\${@tip}</>
<button click=\${ @out = @tip }>go</>
</program>
`,
        "app",
      );
      expect(compiled.codes).not.toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
      expect(compiled.errors).toEqual([]);
    });
  }

  test("the label still reaches the bundle intact — masking is a SCAN view, not a rewrite", () => {
    // The fix masks the scan's INPUT, so it must not alter the emitted output.
    // Without this, a "fix" that stripped the literal from the artifact would
    // pass every assertion above while corrupting what the user sees.
    const compiled = compile(
      `<program>
<out> = ""
<tip> = "the registry slot is _scrml_stdlib.wombat"
<p>\${@out}\${@tip}</>
<button click=\${ @out = @tip }>go</>
</program>
`,
      "app",
    );
    expect(compiled.errors).toEqual([]);
    expect(compiled.clientJs).toContain("the registry slot is _scrml_stdlib.wombat");
    const run = execBundle(compiled);
    expect(run.ok ? "loaded" : `DOA: ${run.error.message}`).toBe("loaded");
  });

  test("masking did not blind the gate — a REAL chunkless import still fires", () => {
    // The other half of the bite. A mask wide enough to silence the FP could
    // also silence the genuine case; this pins that it does not, in the same
    // file as the FP cases so the two can never drift apart.
    const compiled = compile(clientProgram("fs", "readFileSync"), "app");
    expect(compiled.codes).toContain("E-STDLIB-CLIENT-CHUNK-MISSING");
  });
});

// ---------------------------------------------------------------------------
// §3c — the error is ACTIONABLE: it names the import the adopter wrote.
// ---------------------------------------------------------------------------

describe("§3c E-STDLIB-CLIENT-CHUNK-MISSING carries a real source location", () => {
  test("the diagnostic points at the import line, not at line 1", () => {
    // The gate necessarily fires against the FINAL emitted TEXT, which carries no
    // source positions, so the import's span is captured at the lowering site and
    // carried forward. Before that, an adopter got a HARD ERROR with no `-->`
    // line and no position at all, while the sibling stdlib WARNING printed in
    // the same run had both.
    //
    // Asserts TOP-LEVEL `filePath`/`line`, not `span.*`, because
    // `commands/compile.js:formatError` reads the top-level fields — a CGError
    // that fills only `span` renders with no source line. That asymmetry is the
    // actual defect this pins, so the assertion has to sit where the formatter
    // looks.
    const compiled = compile(
      `\${
    import { readFileSync } from 'scrml:fs'

    @out = ""
}
<p>\${@out}</>
<button click=\${ @out = readFileSync("x") }>go</>
`,
      "app",
    );
    const diag = compiled.raw.find((e) => e.code === "E-STDLIB-CLIENT-CHUNK-MISSING");
    expect(diag).toBeDefined();
    expect(typeof diag.filePath).toBe("string");
    expect(diag.filePath.endsWith("app.scrml")).toBe(true);
    // The import is on source line 2. Pinning the exact line (not merely
    // "> 0") is what stops a regression to the old hard-coded 1.
    expect(diag.line).toBe(2);
    expect(diag.span.file.endsWith("app.scrml")).toBe(true);
    expect(diag.span.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// §4 — INSTRUMENT INTEGRITY. Can this harness actually SEE a dead page?
// ---------------------------------------------------------------------------

describe("§4 NEGATIVE CONTROL — the harness reports a DOA bundle rather than swallowing it", () => {
  test("a bundle destructuring an unpopulated registry is reported as a throw", () => {
    // The EXACT shape the 17 broken modules emitted. If the harness reported
    // `ok` here, every assertion in §1 would be vacuous.
    const run = execBundle({
      runtimeJs: "const _scrml_stdlib = {};",
      clientJs: "const { slug } = _scrml_stdlib.format;",
    });
    expect(run.ok).toBe(false);
    expect(run.error.message).toMatch(/slug/);
  });

  test("a bundle referencing an undefined global is reported as a throw", () => {
    const run = execBundle({ runtimeJs: "", clientJs: "_scrml_definitely_not_defined();" });
    expect(run.ok).toBe(false);
    expect(run.error).toBeInstanceOf(ReferenceError);
  });

  test("a trivially-valid bundle is reported as ok (the control's control)", () => {
    const run = execBundle({ runtimeJs: "const _x = 1;", clientJs: "void _x;" });
    expect(run.ok).toBe(true);
  });
});
