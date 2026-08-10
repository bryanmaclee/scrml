/**
 * CONF-DERIVED-SERVER-ONLY-REACH-artifacts | §6.6.19 · §12.2 Trigger 3 · §14.8
 *
 * THE LEAK, NOT ITS PROXY.
 *
 * `E-DERIVED-SERVER-ONLY-REACH` exists for exactly one reason: to stop a server-only
 * stdlib implementation, and whatever secret is passed to it, from being written into
 * a browser bundle. Every gate the code had before S337 asserted the DIAGNOSTIC CODE
 * and nothing else — three `conformance/cases/derived/*` case dirs plus a unit test,
 * all of them code-only. The artifact facts the code is FOR lived in `rationale`
 * prose, which gates nothing.
 *
 * That is not a stylistic complaint. It is the measured reason a live confidentiality
 * leak shipped green: a code-only suite cannot tell "the check fired" from "the check
 * could not see the cell", and until S337 it could not see a derived cell in a
 * `for`-loop `lift` body at all. This file asserts the emitted artifacts on disk.
 *
 * WHAT IS ASSERTED, and why each one:
 *
 *   §1 LEAK VARIANT (nested) — the S337 reproducer. Compiles to an ERROR. If a future
 *      edit reverts the collector to a field list, this goes red first. §1 also pins a
 *      SEPARATE open gap it exposed: the refusal is a diagnostic, not an emission gate,
 *      so the leaking bundle is still written to disk alongside the error.
 *   §2 CORRECTED VARIANT — the fix the message tells the adopter to make (move the
 *      call into a `function`). Compiles clean, a `.server.js` IS emitted, and no
 *      artifact the emitted HTML actually loads contains `Bun.password`, `argon2id`,
 *      or `hashPassword`. This is the positive half: the language HAS a working answer
 *      for this shape, so the refusal in §1 is not a dead end.
 *   §3 TOP-LEVEL CONTROL — the S331 shape still refuses (non-regression).
 *   §4 CLIENT-SAFE CONTROL — a `scrml:math` member in the SAME nested position still
 *      compiles clean, so §1 is not "any stdlib import in a loop is refused".
 *
 * The greps run over the REAL output directory (`write: true`), not over an in-memory
 * `clientJs` string, because the leak is not confined to `.client.js`: pre-fix, the
 * `Bun.password.hash(password, { algorithm: "argon2id" })` body arrived in the hashed
 * `scrml-runtime.*.js` that the emitted `<script src=…>` loads. Asserting on `clientJs`
 * alone would have missed the actual shipped implementation.
 *
 * `_scrml/*.js` is deliberately NOT asserted absent: it is the server-side stdlib
 * module directory and the emitted HTML does not reference it. The gate is
 * "referenced by the HTML the browser gets", which is the property that matters.
 *
 * Firing site: `compiler/src/route-inference.ts` — `collectDerivedCellDecls` (the
 * structural walk) + Step 3b.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

// PID-scoped: a FIXED path races across concurrent `bun test` runs — routine here, since the
// pre-commit hook runs the full suite while PA/sPA sessions run parallel worktrees. One run's
// rmSync deletes the tree another is mid-read on, surfacing as ENOENT blamed on the compiler
// rather than the harness (S337 review).
const TMP_ROOT = join(tmpdir(), `scrml-derived-server-only-reach-artifacts-${process.pid}`);
const OPEN = "${";
const CLOSE = "}";

const CODE = "E-DERIVED-SERVER-ONLY-REACH";

/** Every file under `dir`, recursively, as absolute paths. */
function walkFiles(dir) {
  // MUST tolerate a missing dir. §1 documents that when the emission gate lands these expectations
  // INVERT rather than being deleted — but at that point nothing is written, so an unguarded
  // readdirSync would throw before any expectation ran and the migration path would be unfollowable.
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

/**
 * Compile `source` into a fresh temp dir and return the diagnostics plus the emitted
 * artifact set, split into "loaded by the emitted HTML" and everything else.
 */
function compileToDisk(name, source) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const entry = join(dir, "case.scrml");
  writeFileSync(entry, source);
  const outDir = join(dir, "dist");

  const result = compileScrml({
    inputFiles: [entry],
    outputDir: outDir,
    write: true,
    log: () => {},
  });

  const files = walkFiles(outDir);
  const html = files.filter((f) => f.endsWith(".html")).map((f) => readFileSync(f, "utf8")).join("\n");
  // `<script src="…">` — the artifacts the browser is actually told to fetch.
  const referenced = new Set([...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]));

  const clientLoaded = files.filter((f) => referenced.has(relative(outDir, f).split("\\").join("/")));

  return {
    dir,
    outDir,
    codes: (result.errors ?? []).map((e) => e.code),
    errorCodes: (result.errors ?? []).filter((e) => (e.severity ?? "error") === "error").map((e) => e.code),
    serverJsFiles: files.filter((f) => f.endsWith(".server.js")),
    clientLoaded,
    clientLoadedText: clientLoaded.map((f) => readFileSync(f, "utf8")).join("\n"),
    allFiles: files,
  };
}

function teardown(name) {
  rmSync(join(TMP_ROOT, name), { recursive: true, force: true });
}

// The leak shape: the derived cell lives in a `for`-loop `lift` body, which is where
// the collector could not reach it. `<pw>` is the secret the pre-fix client bundle
// inlined verbatim as `_scrml_cs_reactive_set("pw", "secret")`.
const NESTED_LEAK = `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
<items> = [1, 2]
<div>${OPEN} for (let it of @items) { lift <div>${OPEN} const <h> = hashPassword(@pw) ${CLOSE}<span>${OPEN}@h${CLOSE}</span></div> } ${CLOSE}</div>
</program>
`;

// The fix the diagnostic message prescribes: the call moves into a `function` (which
// DOES escalate on §12.2 Trigger 3) and its result lands in a plain reactive cell the
// nested markup reads. Same position, same import, same secret.
const NESTED_CORRECTED = `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
<hashed> = ""
<items> = [1, 2]
${OPEN} function computeHash(pw) { return hashPassword(pw) } ${CLOSE}
<button onclick={ @hashed = computeHash(@pw) }>go</button>
<div>${OPEN} for (let it of @items) { lift <div><span>${OPEN}@hashed${CLOSE}</span></div> } ${CLOSE}</div>
</program>
`;

const TOP_LEVEL_LEAK = `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
const <h> = hashPassword(@pw)
<div><span>${OPEN}@h${CLOSE}</span></div>
</program>
`;

const NESTED_CLIENT_SAFE = `<program>
${OPEN} import { round } from 'scrml:math' ${CLOSE}
<n> = 1.5
<items> = [1, 2]
<div>${OPEN} for (let it of @items) { lift <div>${OPEN} const <r> = round(@n) ${CLOSE}<span>${OPEN}@r${CLOSE}</span></div> } ${CLOSE}</div>
</program>
`;

// ---------------------------------------------------------------------------
// §1 — the leak variant is REFUSED
// ---------------------------------------------------------------------------

describe("CONF-DERIVED-SERVER-ONLY-REACH — §1 a derived cell in a `for`-loop `lift` body is refused", () => {
  const NAME = "nested-leak";
  let c;
  beforeEach(() => { c = compileToDisk(NAME, NESTED_LEAK); });
  afterEach(() => teardown(NAME));

  test("fires the code as an ERROR", () => {
    expect(c.errorCodes).toContain(CODE);
  });

  /**
   * !! THIS IS A GAP PIN, NOT A SAFETY CLAIM — READ BEFORE TRUSTING §1. !!
   *
   * The refusal is a DIAGNOSTIC, not an EMISSION GATE. Measured at S337: this source
   * reports `FAILED — 1 error` and the compiler STILL WRITES the leaking bundle. The
   * output directory ends up holding a `case.html` whose two `<script src=…>` tags
   * load artifacts that between them contain `Bun.password`, `argon2id` and
   * `hashPassword`, with ZERO `.server.js` — i.e. exactly the artifact set the code
   * exists to prevent, sitting on disk next to the error that was supposed to prevent
   * it. A CI step that compiles and then deploys `dist/` without checking the exit
   * code ships the leak with a red build.
   *
   * That is a SEPARATE defect from the one this file's §1 gates (which is: does the
   * compiler notice at all), it is out of scope for the S337 fix, and it is recorded
   * here rather than in prose because prose gates nothing — which is the whole lesson
   * of this file.
   *
   * WHEN THE EMISSION GATE LANDS, THIS EXPECTATION MUST INVERT, not be deleted: the
   * greps below should flip to `.not.toContain`, and the flip is the evidence the gap
   * closed.
   */
  test("GAP PIN — the failing compile still writes the leaking artifacts to disk", () => {
    expect(c.errorCodes).toContain(CODE);
    expect(c.serverJsFiles.length).toBe(0);
    expect(c.clientLoaded.length).toBeGreaterThan(0);
    expect(c.clientLoadedText).toContain("Bun.password");
    expect(c.clientLoadedText).toContain("argon2id");
    expect(c.clientLoadedText).toContain("hashPassword");
  });
});

// ---------------------------------------------------------------------------
// §2 — the prescribed fix compiles, and its artifacts are clean
// ---------------------------------------------------------------------------

describe("CONF-DERIVED-SERVER-ONLY-REACH — §2 the prescribed fix emits a .server.js and no client leak", () => {
  const NAME = "nested-corrected";
  let c;
  beforeEach(() => { c = compileToDisk(NAME, NESTED_CORRECTED); });
  afterEach(() => teardown(NAME));

  test("compiles clean — the refusal in §1 is not a dead end", () => {
    expect(c.errorCodes).toEqual([]);
  });

  test("a `.server.js` IS emitted (the call escalated, per §12.2 Trigger 3)", () => {
    expect(c.serverJsFiles.length).toBeGreaterThan(0);
  });

  test("the emitted HTML loads at least one script (the grep below is not vacuous)", () => {
    expect(c.clientLoaded.length).toBeGreaterThan(0);
  });

  /**
   * THE SECURITY ASSERTION. `Bun.password.hash(password, { algorithm: "argon2id" })`
   * is the literal body of `scrml:auth`'s `hashPassword`. Pre-fix it appeared four
   * times in the shipped `scrml-runtime.*.js` for the §1 source; here it must appear
   * nowhere the browser is told to fetch.
   */
  test("no artifact the HTML loads contains `Bun.password`, `argon2id`, or `hashPassword`", () => {
    expect(c.clientLoadedText).not.toContain("Bun.password");
    expect(c.clientLoadedText).not.toContain("argon2id");
    expect(c.clientLoadedText).not.toContain("hashPassword");
  });
});

// ---------------------------------------------------------------------------
// §3 — non-regression: the S331 top-level shape still refuses
// ---------------------------------------------------------------------------

describe("CONF-DERIVED-SERVER-ONLY-REACH — §3 the top-level shape is unchanged", () => {
  const NAME = "top-level-leak";
  let c;
  beforeEach(() => { c = compileToDisk(NAME, TOP_LEVEL_LEAK); });
  afterEach(() => teardown(NAME));

  test("still fires the code as an ERROR", () => {
    expect(c.errorCodes).toContain(CODE);
  });
});

// ---------------------------------------------------------------------------
// §4 — over-fire guard: the structural walk did not widen WHAT is refused
// ---------------------------------------------------------------------------

describe("CONF-DERIVED-SERVER-ONLY-REACH — §4 a client-safe member in the same position compiles", () => {
  const NAME = "nested-client-safe";
  let c;
  beforeEach(() => { c = compileToDisk(NAME, NESTED_CLIENT_SAFE); });
  afterEach(() => teardown(NAME));

  /**
   * The walk now reaches every position, so the over-fire risk is real and worth a
   * gate: the check must still key on the §12.2 Trigger 3 ESCALATION set, never on
   * "is a stdlib import". `scrml:math` is client-safe and stays client-side.
   */
  test("does NOT fire the code, and compiles clean", () => {
    expect(c.errorCodes).not.toContain(CODE);
    expect(c.errorCodes).toEqual([]);
  });
});
