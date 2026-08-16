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
 *   §5 TRANSITIVE LIMB (S338) — the reach ONE HOP AWAY, through a local `function`.
 *      Asserts the artifact facts that make this limb a DIFFERENT failure from §1:
 *      confidentiality is INTACT (a `.server.js` IS emitted, no `Bun.password` in
 *      anything the HTML loads) and the defect is instead an `async` fetch stub
 *      wired into a derived recompute that is never awaited. Plus the over-fire
 *      control: a purely-client hop in the same shape compiles clean.
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
 * structural walk) + `computeServerReachingFns` (the placement closure) + Step 5c-ter.
 * (The step was "3b" until S338; it moved because the transitive limb reads a
 * placement result that Steps 5/5b/5c are still mutating at the old position.)
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
    // The diagnostic TEXT for `CODE`, joined. §6.6.19 requires the message to
    // name the HOP CHAIN, and §7's test names promised that fact for three
    // rounds while asserting nothing about it (round 7, F2).
    codeMessages: (result.errors ?? [])
      .filter((e) => e.code === CODE)
      .map((e) => e.message ?? "")
      .join("\n"),
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

// ---------------------------------------------------------------------------
// §5 — TRANSITIVE limb (S338): the same reach ONE HOP AWAY
// ---------------------------------------------------------------------------

// The hop. `doHash` is precisely the fix §2 prescribes for the direct limb — and it
// IS correct as far as it goes: the escalation works, so nothing leaks. What §2 never
// asked is what happens when the RESULT is read from a derived cell instead of a
// plain one. Measured on `main` before S338, at exit 0 with an empty diagnostic set:
//
//   async function _scrml_fetch_doHash_3(p) { … await _scrml_fetch_with_csrf_retry(…) … }
//   _scrml_cs_derived_declare("h", () => _scrml_fetch_doHash_3(_scrml_cs_reactive_get("pw")));
//
// `_scrml_derived_get` calls the thunk with no `await` (a synchronous pull, §6.6.3
// — this cited `§6.6.4` until round 7, which is Diamond Dependency and says
// nothing about `await`; no section states the un-awaited invocation, see
// §6.6.19's cross-reference block), so `@h` held the
// Promise and the markup rendered it.
const TRANSITIVE_LEAK = `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) } ${CLOSE}
const <h> = doHash(@pw)
<div><span>${OPEN}@h${CLOSE}</span></div>
</program>
`;

// The over-fire control: identical SHAPE — a derived cell reading a local function —
// with the server reach taken out. This is the ordinary result of extracting logic
// into a `function`, and it must stay compilable.
const TRANSITIVE_CLIENT_SAFE = `<program>
<name> = "ada"
${OPEN} function shout(s) { return s.toUpperCase() } ${CLOSE}
const <loud> = shout(@name)
<div><span>${OPEN}@loud${CLOSE}</span></div>
</program>
`;

describe("CONF-DERIVED-SERVER-ONLY-REACH — §5 a hop through a local function is refused", () => {
  const NAME = "transitive-leak";
  let c;
  beforeEach(() => { c = compileToDisk(NAME, TRANSITIVE_LEAK); });
  afterEach(() => teardown(NAME));

  test("fires the code as an ERROR", () => {
    expect(c.errorCodes).toContain(CODE);
  });

  /**
   * THIS LIMB IS NOT §1's FAILURE, AND THE ARTIFACTS ARE HOW YOU TELL.
   *
   * §1's gap pin asserts a leaking bundle on disk: zero `.server.js`, `Bun.password`
   * in a script the HTML loads. Here the OPPOSITE artifact facts hold — the
   * escalation worked. Asserting them is what stops a future reader (or a future
   * message edit) from collapsing the two limbs into "a security error", which would
   * teach adopters to discount §1, the one that IS a leak.
   */
  test("confidentiality is INTACT — a `.server.js` is emitted and nothing leaks to the client", () => {
    expect(c.serverJsFiles.length).toBeGreaterThan(0);
    expect(c.clientLoaded.length).toBeGreaterThan(0);
    expect(c.clientLoadedText).not.toContain("Bun.password");
    expect(c.clientLoadedText).not.toContain("argon2id");
  });

  /**
   * !! GAP PIN, NOT A SAFETY CLAIM — the §1 twin. !!
   *
   * The refusal is a DIAGNOSTIC, not an EMISSION GATE, in this limb too: the compile
   * reports an error and STILL writes the bundle containing the exact defect — an
   * `async` fetch stub wired straight into a derived recompute the runtime never
   * awaits. A CI step that ignores the exit code ships a page that renders
   * `[object Promise]`.
   *
   * WHEN THE EMISSION GATE LANDS, THIS EXPECTATION MUST INVERT, not be deleted.
   */
  test("GAP PIN — the failing compile still writes the Promise-valued derived cell", () => {
    expect(c.errorCodes).toContain(CODE);
    expect(c.clientLoadedText).toMatch(/async function _scrml_fetch_doHash_\d+/);
    expect(c.clientLoadedText).toMatch(
      /_scrml_cs_derived_declare\(\s*"h"\s*,\s*\(\)\s*=>\s*_scrml_fetch_doHash_\d+/,
    );
  });
});

// ---------------------------------------------------------------------------
// §6 — ROUND-4 SHADOW SEMANTICS, VERIFIED BY EXECUTED ARTIFACTS (round 4 — a PA-authored
// review constraint with NO operator ruling; see §6.6.19's transitive-limb Provenance).
//
// The round-4 review proved the RI-only oracle blind: unit pins asserted "clean"
// while the exit-0 bundle bound an `async` fetch stub into the synchronous
// derived recompute (a rendered Promise). These tests re-execute every shadow
// shape END-TO-END and assert the round-4 contract directly:
//
//   for every shadow shape, the compile either REFUSES (E-DERIVED-SERVER-ONLY-
//   REACH) or the emitted client contains NO async stub bound into a derived
//   recompute — and parses (`node --check`).
//
// Under the final semantics every SHAPE IN THIS TABLE takes the first disjunct
// (RI fires on every reference), and the accepted control takes the second.
//
// THAT IS A STATEMENT ABOUT THIS TABLE, NOT A SET RELATION (corrected round 7).
// Earlier generations of this comment said RI's refusal set "CONTAINS every
// shape codegen's scope-blind renaming would rewrite". It does not: `let f =
// doHash` and `function wrap({ x = doHash })` are both rewritten by codegen at
// exit 0 with NO refusal (§6.6.19 residuals 4 and 6, the latter pinned at §9
// below), while `doHash + 1` is refused and rewritten nowhere. The two sets are
// INCOMPARABLE. The §1/§5 gap pins
// still apply: a REFUSED compile still writes artifacts to disk, so the refusal
// (exit disposition), not artifact absence, is the contract — consumers key on
// the exit code, never on artifact presence.
// ---------------------------------------------------------------------------

import { spawnSync } from "child_process";

/**
 * The round-4 disjunction, executed. If the compile did NOT refuse with the
 * code, the client bundle must contain no fetch stub at all (the shapes here
 * have exactly one candidate server fn, so any `_scrml_fetch_` in a client
 * artifact would be a stub reachable from the derived recompute) and every
 * client-loaded artifact must parse under `node --check`.
 */
function assertRefusedOrStubFree(c) {
  if (c.errorCodes.includes(CODE)) return "refused";
  expect(c.clientLoadedText).not.toContain("_scrml_fetch_");
  for (const f of c.clientLoaded) {
    const r = spawnSync("node", ["--check", f], { encoding: "utf8" });
    expect(`${f}: ${r.stderr ?? ""}`.trim()).toBe(`${f}:`);
    expect(r.status).toBe(0);
  }
  return "clean";
}

const SHADOW_PRELUDE = `<program>
${OPEN}
    type Phase:enum = { Idle, Busy }
    import { hashPassword } from 'scrml:auth'
    <phase>: Phase = .Idle
${CLOSE}
<pw> = "secret"

${OPEN} function doHash(p) { return hashPassword(p) } ${CLOSE}
`;

const SHADOW_SHAPES = {
  // finding-00: branch-local const in a hop caller, genuine SIBLING-branch ref.
  "if-sibling": `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function wrap(x) { if (x) { const doHash = (v) => v; return doHash(x) } return doHash(x) } ${CLOSE}
const <computed> = wrap(@pw)
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
  // while-body shadow, genuine reference after the loop.
  "while-shadow": `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function wrap(x) { let acc = x; while (false) { const doHash = (v) => v; acc = doHash(acc) } return doHash(acc) } ${CLOSE}
const <computed> = wrap(@pw)
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
  // finding-01: match-arm const shadow, genuine SIBLING-arm reference.
  "match-arm-sibling": `${SHADOW_PRELUDE}
const <computed> = match @phase { .Idle :> { const doHash = (x) => x; doHash("local") } .Busy :> doHash(@pw) }
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
  // finding-06 (HIGH): the SPEC-blessed RHS-local shadow — RI used to suppress
  // while codegen renamed the shadowed call to the stub anyway.
  "rhs-local-const": `${SHADOW_PRELUDE}
const <computed> = match @phase { .Idle :> { const doHash = (x) => x; doHash("local") } .Busy :> "busy" }
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
  // the `~` (bare-assignment) binder variant of the same shape.
  "rhs-local-tilde": `${SHADOW_PRELUDE}
const <computed> = match @phase { .Idle :> { doHash = (x) => x; doHash("local") } .Busy :> "busy" }
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
  // ROUND 5 — the shape round 4 EXEMPTED and pinned green (§11l "BITE — a hop
  // caller's own PARAM still suppresses"). It belongs in this table precisely
  // because the RI-only oracle called it clean while the emitted client was
  //   async function _scrml_wrap_4(_scrml_fetch_doHash_3, extra) {
  //     return await _scrml_fetch_doHash_3("x") + extra; }
  //   _scrml_cs_derived_declare("computed", () => _scrml_wrap_4(…));
  // — codegen renamed the PARAMETER BINDING itself, because its rename pass is
  // raw text with no notion of parameter scope. The exemption was the one place
  // the round-4 SHADOW discipline still suppressed a name on this limb; round 5
  // removed it (round 6 then found the parameter DEFAULT position outside the
  // scan root altogether — §7 below).
  "hop-param": `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function wrap(doHash, extra) { return doHash("x") + extra } ${CLOSE}
const <computed> = wrap((v) => v, @pw)
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
};

// The accepted side of the disjunction: same shadow SHAPE, no server reach
// anywhere — must compile clean, with a synchronous recompute and a parseable
// bundle (this is what proves the assertion machinery is not vacuous).
const SHADOW_CLIENT_CONTROL = `<program>
${OPEN}
    type Phase:enum = { Idle, Busy }
    <phase>: Phase = .Idle
${CLOSE}
<pw> = "secret"
${OPEN} function fmt(p) { return p.trim() } ${CLOSE}
const <computed> = match @phase { .Idle :> { const fmt = (x) => x; fmt("local") } .Busy :> fmt(@pw) }
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`;

describe("CONF-DERIVED-SERVER-ONLY-REACH — §6 round-4 shadow shapes, executed end-to-end", () => {
  for (const [name, source] of Object.entries(SHADOW_SHAPES)) {
    test(`${name}: refused at compile time (no stub can reach a derived recompute)`, () => {
      const c = compileToDisk(`r4-shadow-${name}`, source);
      try {
        // The disjunction contract…
        const disposition = assertRefusedOrStubFree(c);
        // …AND the specific expected disposition: under the final semantics
        // every transitive shadow shape REFUSES. If one starts compiling clean,
        // that is either the lexical-scoping restoration arc landing (flip this
        // deliberately, citing it — codegen's renamer must be scoped in the SAME
        // change) or a silent regression of the round-4 fix.
        expect(disposition).toBe("refused");
        expect(c.errorCodes).toContain(CODE);
      } finally {
        teardown(`r4-shadow-${name}`);
      }
    });
  }

  /**
   * THE `hop-param` DIFFERENTIAL, AT THE ARTIFACT LEVEL (round 5).
   *
   * Byte-identical to the `hop-param` shape above except the colliding parameter
   * is renamed `fn`. It must compile clean AND emit a SYNCHRONOUS hop — that is
   * what proves the refusal above is caused by the name collision (which codegen
   * turns into a parameter rename + `async` colouring) and not by the hop shape,
   * which is ordinary scrml.
   */
  const HOP_PARAM_CONTROL = `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function wrap(fn, extra) { return fn("x") + extra } ${CLOSE}
const <computed> = wrap((v) => v, @pw)
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`;

  test("CONTROL — `hop-param` with the parameter renamed: clean, and the hop is NOT async", () => {
    const c = compileToDisk("r4-shadow-hop-param-control", HOP_PARAM_CONTROL);
    try {
      // CLEAN means ZERO error-severity codes — not merely "not THIS code". A
      // refused compile still writes the full artifact set (§1/§5), so the three
      // artifact regexes below stay green through a refusal by some OTHER code;
      // `not.toContain(CODE)` alone let this control pass while its own subject
      // program was refused (round-5 review, B4 — verified with two source
      // mutations). `toEqual([])`, like every sibling control in this file.
      expect(c.errorCodes).toEqual([]);
      // The hop is emitted as a plain function — no `async`, no `await`, and no
      // fetch stub bound into the recompute.
      expect(c.clientLoadedText).toMatch(/\bfunction _scrml_wrap_\d+\(fn, extra\)/);
      expect(c.clientLoadedText).not.toMatch(/async function _scrml_wrap_\d+/);
      expect(c.clientLoadedText).toMatch(/_scrml_cs_derived_declare\(\s*"computed"/);
    } finally {
      teardown("r4-shadow-hop-param-control");
    }
  });

  test("CONTROL — same shadow shape, purely client: clean, sync recompute, parses", () => {
    const c = compileToDisk("r4-shadow-control", SHADOW_CLIENT_CONTROL);
    try {
      expect(c.errorCodes).toEqual([]);
      expect(assertRefusedOrStubFree(c)).toBe("clean");
      expect(c.clientLoadedText).toMatch(/_scrml_cs_derived_declare\(\s*"computed"/);
    } finally {
      teardown("r4-shadow-control");
    }
  });
});

describe("CONF-DERIVED-SERVER-ONLY-REACH — §5b a purely-client hop in the same shape compiles", () => {
  const NAME = "transitive-client-safe";
  let c;
  beforeEach(() => { c = compileToDisk(NAME, TRANSITIVE_CLIENT_SAFE); });
  afterEach(() => teardown(NAME));

  /**
   * The over-refusal gate for §5. A derived cell calling a local function is the
   * NORMAL shape; §5 must key on the callee's server PLACEMENT and on nothing that
   * merely looks like it. If this goes red, the transitive limb is refusing
   * `function` extraction itself.
   */
  test("does NOT fire the code, and compiles clean", () => {
    expect(c.errorCodes).not.toContain(CODE);
    expect(c.errorCodes).toEqual([]);
  });

  test("and the emitted recompute is SYNCHRONOUS — no fetch in the derived thunk", () => {
    expect(c.serverJsFiles.length).toBe(0);
    expect(c.clientLoadedText).toMatch(/_scrml_cs_derived_declare\(\s*"loud"/);
    expect(c.clientLoadedText).not.toContain("_scrml_fetch_shout");
  });
});

// ---------------------------------------------------------------------------
// §7 — A HOP CALLER'S PARAMETER DEFAULT, EXECUTED END-TO-END (round 6, B1).
//
// The round-5 review found the transitive limb's scan root was `fnNode.body`
// alone — `fnNode.params` is a SIBLING, and a `function-decl` default is a raw
// source string — so a default reaching a server-placed function produced no
// hop edge at all. Re-measured on the frozen round-5 tree (`bf99a93a`) with
// THESE sources before the fix:
//
//   `function wrap(x = doHash) { return x("k") }`  ->  exit 0, ZERO errors,
//     `function _scrml_wrap_4(x = _scrml_fetch_doHash_3)` in the client: the
//     async fetch stub bound as the default; `wrap()` returns a Promise; the
//     derived cell renders it.
//   `function wrap(x = doHash(@pw)) { return x }` (the review's shape) -> the
//     CALL form was already refused on that tree, but by CODEGEN's
//     `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` backstop (emit-expr / emit-library-
//     shared), not by route inference; RI itself had no edge for it either.
//
// Both now refuse with `E-DERIVED-SERVER-ONLY-REACH`. The CONTROL is the same
// default position with a purely-client callee, and it asserts `toEqual([])`
// (not `not.toContain`) — a refused compile still writes artifacts (§1/§5), so
// only a zero-error assertion proves the control's subject program is accepted.
// ---------------------------------------------------------------------------

const HOP_PARAM_DEFAULT_SHAPES = {
  // bare REFERENCE default — silent on the pre-fix tree (no codegen backstop
  // sees a non-call).
  "default-bare-ref": `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function wrap(x = doHash) { return x("k") } ${CLOSE}
const <computed> = wrap()
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
  // callback REFERENCE default — likewise silent pre-fix.
  "default-callback-ref": `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function wrap(x = [1].map(doHash)) { return x } ${CLOSE}
const <computed> = wrap()
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
  // the review's shape verbatim — a CALL in the default with a `@cell` argument.
  "default-call-review-shape": `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <pw> = "secret"
  function doHash(p) { return hashPassword(p) }
  function wrap(x = doHash(@pw)) { return x }
  const <computed> = wrap()
${CLOSE}
<div id="out">${OPEN}@computed${CLOSE}</div>
</program>
`,
  // a NESTED function-decl's default inside the hop caller (reason 2 alone).
  "default-nested-decl": `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function wrap(v) { function inner(x = doHash) { return x } return inner()(v) } ${CLOSE}
const <computed> = wrap(@pw)
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`,
};

// THE DIFFERENTIAL CONTROL: byte-identical to `default-bare-ref` except the
// default's callee is the purely-client `pure` (the server-placed `doHash` is
// still declared in the file, so its fetch stub legitimately exists in the
// client). Must compile with ZERO errors, bind the default to the plain client
// function, and leave the caller un-coloured. Only the default's callee differs,
// so the refusal above is attributable to the REACH and not to the presence of
// a default.
const HOP_PARAM_DEFAULT_CONTROL = `<program>
${OPEN} import { hashPassword } from 'scrml:auth' ${CLOSE}
<pw> = "secret"
${OPEN} function doHash(p) { return hashPassword(p) }
function pure(p) { return p + "!" }
function wrap(x = pure) { return x("k") } ${CLOSE}
const <computed> = wrap() + @pw
<div><span>${OPEN}@computed${CLOSE}</span></div>
</program>
`;

describe("CONF-DERIVED-SERVER-ONLY-REACH — §7 a hop caller's PARAMETER DEFAULT is refused (round 6)", () => {
  for (const [name, source] of Object.entries(HOP_PARAM_DEFAULT_SHAPES)) {
    test(`${name}: refused with the code, and the chain names the hop`, () => {
      const c = compileToDisk(`r6-param-default-${name}`, source);
      try {
        // ORDER IS THE ASSERTION (round 7, F2 — this block used to assert
        // `toContain(CODE)` FIRST and then `expect(assertRefusedOrStubFree(c))
        // .toBe("refused")`, which is a TAUTOLOGY: the helper returns
        // `"refused"` iff the code is present, which the line above had already
        // established, so the helper's own body — the stub-free grep and the
        // `node --check` parse of every client artifact — was UNREACHABLE and
        // this section gated nothing beyond the code. §6 calls the helper first
        // and does bite; §7 now matches it. Call the helper FIRST so that if one
        // of these shapes ever stops refusing, the disjunction's OTHER branch
        // actually runs and says what is wrong with the artifacts.
        const disposition = assertRefusedOrStubFree(c);
        expect(disposition).toBe("refused");
        expect(c.errorCodes).toContain(CODE);
        // AND THE FACT THE TEST NAME PROMISES, WHICH NOTHING ASSERTED (round 7,
        // F2). §6.6.19 requires the message to name the hop chain from the
        // derived cell through each intermediate function to the server-placed
        // one. Asserting it here is what distinguishes "refused BECAUSE the
        // parameter default produced a hop edge through `wrap`" from "refused
        // for some unrelated reason that happens to carry the same code" — and
        // the chain string is the ONLY observable that moves when the
        // nested-declaration branch is disabled (F1).
        //
        // MEASURED with that branch disabled, `default-nested-decl` still
        // refuses but its chain becomes `const <computed> -> wrap -> inner ->
        // doHash` — which is why the round-6 unit pin that watched only the
        // chain string could not tell a broken branch from a working one: the
        // longer chain arguably reads BETTER. This assertion pins the SHIPPED
        // chain, so a change to it is a decision someone has to make on purpose.
        expect(c.codeMessages).toContain("const <computed> -> wrap -> doHash");
      } finally {
        teardown(`r6-param-default-${name}`);
      }
    });
  }

  test("CONTROL — the same default position with a purely-client callee: ZERO errors, synchronous default, no stub in the default", () => {
    const c = compileToDisk("r6-param-default-control", HOP_PARAM_DEFAULT_CONTROL);
    try {
      expect(c.errorCodes).toEqual([]);
      // The default is bound to the plain client function — not to any fetch
      // stub — and the caller is not coloured async.
      expect(c.clientLoadedText).toMatch(/\bfunction _scrml_wrap_\d+\(x = _scrml_pure_\d+\)/);
      expect(c.clientLoadedText).not.toMatch(/_scrml_wrap_\d+\(x = _scrml_fetch_/);
      expect(c.clientLoadedText).not.toMatch(/async function _scrml_wrap_\d+/);
      expect(c.clientLoadedText).toMatch(/_scrml_cs_derived_declare\(\s*"computed"/);
      // And every client-loaded artifact parses.
      for (const f of c.clientLoaded) {
        const r = spawnSync("node", ["--check", f], { encoding: "utf8" });
        expect(`${f}: ${r.stderr ?? ""}`.trim()).toBe(`${f}:`);
        expect(r.status).toBe(0);
      }
    } finally {
      teardown("r6-param-default-control");
    }
  });
});

// ---------------------------------------------------------------------------
// §8 — §12.2 TRIGGER 3: a PARAMETER DEFAULT escalates the function (round 6, B7).
//
// PRE-EXISTING, not a round-5 regression — refuters measured it IDENTICAL at the
// pre-arc base `23ea2e5c`. Same two root causes as §7 (params are a sibling of
// the body scan root; a `function` declaration's `defaultValue` is a raw source
// string), on the OTHER consumer of the shared scanner: the per-function
// `collectServerOnlyBindingModules`. No derived cell anywhere in these programs;
// this is placement, not the derived refusal.
//
// Measured on the frozen round-5 tree (`bf99a93a`) before the fix, executing
// these sources: `function f(h = hashPassword(@pw))` -> `f` NOT escalated, the
// call left client-side, `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` fired by codegen's
// backstop, and the artifact set still leaked — `const { hashPassword } =
// _scrml_stdlib.auth;` in the client and 4x `Bun.password` + the argon2id body
// in the `scrml-runtime.*.js` the HTML loads. After the fix `f` escalates:
// clean compile, a `.server.js` hosts the call, and no server-only symbol
// reaches anything the HTML loads — Trigger 3's own contract ("a server-only
// stdlib import escalates the function that USES it"; a default IS the function
// using it).
// ---------------------------------------------------------------------------

const TRIGGER3_DEFAULT_CALL = `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <pw> = "secret"
  <out> = ""
  function f(h = hashPassword(@pw)) { return h }
${CLOSE}
<button onclick={ @out = f() }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;

const TRIGGER3_DEFAULT_BARE_REF = `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <out> = ""
  function f(h = hashPassword) { return h("k") }
${CLOSE}
<button onclick={ @out = f() }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;

// CONTROL: the same default position with a CLIENT-SAFE stdlib member. Must
// compile with zero errors, stay client-side (no .server.js at all), and load
// no server-only symbol — proving §8 keys on the module's server-only-ness,
// not on the presence of a default.
const TRIGGER3_DEFAULT_CLIENT_SAFE = `<program>
${OPEN}
  import { round } from 'scrml:math'
  <out> = ""
  function f(h = round(1.5)) { return h }
${CLOSE}
<button onclick={ @out = f() }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;

describe("CONF-DERIVED-SERVER-ONLY-REACH — §8 a §12.2 Trigger 3 reach in a parameter default escalates (round 6)", () => {
  for (const [name, source] of [
    ["t3-default-call", TRIGGER3_DEFAULT_CALL],
    ["t3-default-bare-ref", TRIGGER3_DEFAULT_BARE_REF],
  ]) {
    test(`${name}: clean compile, the call is server-hosted, nothing server-only is client-loaded`, () => {
      const c = compileToDisk(name, source);
      try {
        expect(c.errorCodes).toEqual([]);
        // The function escalated: a .server.js exists and hosts the reach.
        expect(c.serverJsFiles.length).toBeGreaterThan(0);
        const serverText = c.serverJsFiles.map((f) => readFileSync(f, "utf8")).join("\n");
        expect(serverText).toContain("hashPassword");
        // And nothing the HTML loads carries the implementation or the binding.
        expect(c.clientLoadedText).not.toContain("Bun.password");
        expect(c.clientLoadedText).not.toContain("argon2id");
        expect(c.clientLoadedText).not.toContain("_scrml_stdlib.auth");
        // The client calls it through the fetch stub.
        expect(c.clientLoadedText).toMatch(/async function _scrml_fetch_f_\d+/);
      } finally {
        teardown(name);
      }
    });
  }

  test("CONTROL — a client-safe member in the same default position: zero errors, stays client-side", () => {
    const c = compileToDisk("t3-default-client-safe", TRIGGER3_DEFAULT_CLIENT_SAFE);
    try {
      expect(c.errorCodes).toEqual([]);
      expect(c.serverJsFiles.length).toBe(0);
      expect(c.clientLoadedText).not.toContain("_scrml_fetch_f_");
    } finally {
      teardown("t3-default-client-safe");
    }
  });
});

// ---------------------------------------------------------------------------
// §8b — §12.2 TRIGGER 3, THE OTHER DIRECTION: A NAME THAT IS NOT A REFERENCE
// SHALL NOT ESCALATE (round 7, B-1).
//
// WHY THIS SECTION EXISTS AT ALL, AND IT IS THE WHOLE LESSON OF THIS FILE
// APPLIED TO ITSELF. §8 above pins that a parameter default CAN escalate. It
// says nothing about which defaults MAY NOT, and the arc suite was measured
// IDENTICAL — 149 pass / 0 fail — on the tree that over-fired and the tree that
// does not. Nothing caught the over-fire being introduced and nothing would have
// caught it being removed. That is how it shipped.
//
// WHAT WAS MEASURED at `ff0cbdd8`, executing these exact sources: every shape
// below relocated its function to the server at exit 0 with ZERO diagnostics,
// because round 6 routed a `function-decl`'s raw-source default through the
// direct limb's word-boundary TEXT scan, and the limb-(a) name set is ordinary
// English (`scrml:path` exports `join`, `resolve`, `basename`, `dirname`;
// `scrml:process` exports `env`, `cwd`, `exit`, `platform`).
//
// AND THE CONSEQUENCE IS NOT A ROUND TRIP, IT IS A WRONG ANSWER. For
// `string-literal`, the emitted `case.server.js` was
//
//     const _scrml_body = await _scrml_req.json();
//     const msg = _scrml_body["msg"];          // <- the default is GONE
//
// so `greet()` with no argument returned `null` instead of `"please join us"`.
// The escalation deletes the default; no diagnostic says so.
//
// §12.4 IS NORMATIVE AND UNAMENDED (`SPEC.md:7463`): "it SHALL NOT classify a
// function based on the names of identifiers that appear inside string-literal
// contents of its body … matching a server-fn name as a token inside a string
// literal is NOT a reference and SHALL NOT propagate taint."
//
// EACH ASSERTION HERE IS DIRECTIONAL AND BOTH DIRECTIONS ARE COVERED:
//   - §8b goes red if the over-fire RETURNS (`serverJsFiles.length` becomes > 0).
//   - §8 and §8c go red if a genuine catch is LOST (`serverJsFiles.length`
//     becomes 0 and the auth implementation appears in a client-loaded artifact).
// Bite proofs for both directions are recorded in
// `docs/changes/derived-transitive-r7/progress-r7.md`.
// ---------------------------------------------------------------------------

// Every shape below imports a REAL escalation-server-only module (`scrml:path`,
// limb (a) member `join`) and then uses the word `join` in a position that
// §12.4 says is NOT a reference.
const T3_NON_REFERENCE_DEFAULTS = {
  // A STRING LITERAL. §12.4's own worked case.
  "string-literal": `<program>
${OPEN}
  import { join } from 'scrml:path'
  <out> = ""
  function greet(msg = "please join us") { return msg }
${CLOSE}
<button onclick={ @out = greet() }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`,
  // A TEMPLATE literal — the same rule, a different literal node.
  "template-literal": `<program>
${OPEN}
  import { join } from 'scrml:path'
  <out> = ""
  function greet(msg = \`please join us\`) { return msg }
${CLOSE}
<button onclick={ @out = greet() }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`,
  // An OBJECT PROPERTY KEY. A non-computed `Property.key` is not a reference —
  // the same rule `collectRawReferenceNames` already applies to a lowered
  // subtree, now applied to a default.
  "object-property-key": `<program>
${OPEN}
  import { join } from 'scrml:path'
  <out> = ""
  function greet(opts = { join: 1 }) { return opts.join }
${CLOSE}
<button onclick={ @out = greet() }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`,
  // A MEMBER PROPERTY. A non-computed `MemberExpression.property` is not a
  // reference either.
  "member-property": `<program>
${OPEN}
  import { join } from 'scrml:path'
  <opts> = { join: 1 }
  <out> = ""
  function greet(a, msg = a.join) { return msg }
${CLOSE}
<button onclick={ @out = greet(@opts) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`,
  // A NESTED declaration's default escalating the OUTER function. This shape is
  // the reason the fix could not live only in `collectServerOnlyBindingModules`:
  // it fires through the scanner's OWN `function-decl` branch, a SECOND site.
  "nested-decl-string-literal": `<program>
${OPEN}
  import { join } from 'scrml:path'
  <out> = ""
  function outer(v) { function inner(msg = "please join us") { return msg } return inner() }
${CLOSE}
<button onclick={ @out = outer(1) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`,
};

describe("CONF-DERIVED-SERVER-ONLY-REACH — §8b a NON-reference in a parameter default does NOT escalate (round 7)", () => {
  for (const [name, source] of Object.entries(T3_NON_REFERENCE_DEFAULTS)) {
    test(`${name}: compiles clean and stays CLIENT-side (§12.4 SHALL NOT)`, () => {
      const c = compileToDisk(`r7-nonref-default-${name}`, source);
      try {
        expect(c.errorCodes).toEqual([]);
        // THE BITING ASSERTION. A `.server.js` is emitted only when route
        // inference escalated a function; zero means the word inside the literal
        // was not read as a reference. This goes red the moment the over-fire
        // returns.
        expect(c.serverJsFiles.length).toBe(0);
        // …and no fetch stub was minted for the function, i.e. no new public
        // route was created for it.
        expect(c.clientLoadedText).not.toMatch(/_scrml_fetch_(greet|outer)_\d+/);
      } finally {
        teardown(`r7-nonref-default-${name}`);
      }
    });
  }

  /**
   * THE DEFAULT SURVIVES INTO THE EMITTED CLIENT — the consequence assertion.
   *
   * `serverJsFiles.length === 0` says the function was not relocated. This says
   * the thing an adopter would actually notice: the default value is still there
   * and still the string they wrote. Pre-fix the emitted server handler read
   * `msg` from the request body and nothing supplied it, so `greet()` returned
   * `null`.
   */
  test("the parameter default is PRESERVED in the emitted client function", () => {
    const c = compileToDisk("r7-nonref-default-preserved", T3_NON_REFERENCE_DEFAULTS["string-literal"]);
    try {
      expect(c.errorCodes).toEqual([]);
      expect(c.clientLoadedText).toMatch(/\bfunction _scrml_greet_\d+\(msg = "please join us"\)/);
    } finally {
      teardown("r7-nonref-default-preserved");
    }
  });

  /**
   * A COMMENT inside a default, held separately because of a PRE-EXISTING and
   * UNRELATED codegen defect.
   *
   * `function greet(msg = 1 /* join later *␘/)` is rejected by client codegen
   * with `E-CODEGEN-INVALID-LOGIC` — measured round 7 with NO import at all and
   * with a purely client-safe import, so it is not caused by anything in this
   * arc. Round 6's over-fire MASKED it by relocating the function to the server.
   * The property this section owns is placement, so placement is what is
   * asserted; the codegen defect is surfaced as its own item, not folded in.
   */
  test("comment-in-default: not escalated (the pre-existing codegen refusal is NOT this rule's)", () => {
    const src = `<program>
${OPEN}
  import { join } from 'scrml:path'
  <out> = ""
  function greet(msg = 1 /* join later */) { return msg }
${CLOSE}
<button onclick={ @out = greet() }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;
    const c = compileToDisk("r7-nonref-default-comment", src);
    try {
      expect(c.serverJsFiles.length).toBe(0);
      expect(c.clientLoadedText).not.toMatch(/_scrml_fetch_greet_\d+/);
      // Pinned so the day the codegen defect is fixed this line goes red and a
      // reader is sent here rather than quietly widening the expectation.
      expect(c.errorCodes).toEqual(["E-CODEGEN-INVALID-LOGIC"]);
    } finally {
      teardown("r7-nonref-default-comment");
    }
  });
});

// ---------------------------------------------------------------------------
// §8c — THE NESTED-`function-decl` GUARD, PINNED (round 7, F1).
//
// `scanForServerOnlyBindingRefs`'s `kind === "function-decl"` branch scans a
// NESTED declaration's parameter defaults. It is load-bearing for a real
// confidentiality leak and had ZERO coverage: the unit test that claims to
// "isolate reason (2)" only observes the diagnostic's CHAIN STRING, and the
// mutated chain reads like an improvement, so disabling the branch did not go
// red anywhere.
//
// MEASURED with the branch disabled: `function outer(v) { function inner(h =
// hashPassword("k")) { return h } return inner() }` compiles at exit 0 with ZERO
// `.server.js`, `const { hashPassword } = _scrml_stdlib.auth;` in the client and
// a real `Bun.password.hash(…{ algorithm: "argon2id" })` in the runtime the
// emitted HTML loads. The bite proof is in `progress-r7.md`.
//
// This is the §12.2 Trigger 3 (DIRECT/confidentiality) limb, not §7's transitive
// one: no derived cell appears in either source.
// ---------------------------------------------------------------------------

const T3_NESTED_DECL_DEFAULT = {
  // a CALL in the nested default.
  "nested-default-call": `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <out> = ""
  function outer(v) { function inner(h = hashPassword("k")) { return h } return inner() }
${CLOSE}
<button onclick={ @out = outer(1) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`,
  // a BARE REFERENCE in the nested default — the form with no codegen backstop
  // behind it at all.
  "nested-default-bare-ref": `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <out> = ""
  function outer(v) { function inner(h = hashPassword) { return h("k") } return inner() }
${CLOSE}
<button onclick={ @out = outer(1) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`,
};

describe("CONF-DERIVED-SERVER-ONLY-REACH — §8c a NESTED declaration's default escalates the OUTER function (round 7)", () => {
  for (const [name, source] of Object.entries(T3_NESTED_DECL_DEFAULT)) {
    test(`${name}: escalated, and NOTHING server-only reaches the browser`, () => {
      const c = compileToDisk(`r7-nested-decl-${name}`, source);
      try {
        expect(c.errorCodes).toEqual([]);
        // The outer function escalated — the nested default was seen.
        expect(c.serverJsFiles.length).toBeGreaterThan(0);
        const serverText = c.serverJsFiles.map((f) => readFileSync(f, "utf8")).join("\n");
        expect(serverText).toContain("hashPassword");
        // THE SECURITY ASSERTION. Not a proxy for the leak — the leak itself.
        expect(c.clientLoaded.length).toBeGreaterThan(0);
        expect(c.clientLoadedText).not.toContain("Bun.password");
        expect(c.clientLoadedText).not.toContain("argon2id");
        expect(c.clientLoadedText).not.toContain("_scrml_stdlib.auth");
      } finally {
        teardown(`r7-nested-decl-${name}`);
      }
    });
  }

  /**
   * THE OVER-FIRE CONTROL for §8c, so "escalated" above is attributable to the
   * REACH and not to nesting. Identical shape, client-safe `scrml:math` member.
   */
  test("CONTROL — the same nested default with a client-safe member: clean, stays client-side", () => {
    const src = `<program>
${OPEN}
  import { round } from 'scrml:math'
  <out> = ""
  function outer(v) { function inner(h = round(1.5)) { return h } return inner() }
${CLOSE}
<button onclick={ @out = outer(1) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;
    const c = compileToDisk("r7-nested-decl-control", src);
    try {
      expect(c.errorCodes).toEqual([]);
      expect(c.serverJsFiles.length).toBe(0);
    } finally {
      teardown("r7-nested-decl-control");
    }
  });
});

// ---------------------------------------------------------------------------
// §9 — GAP PIN: A DESTRUCTURED PARAMETER DEFAULT IS A LIVE CONFIDENTIALITY LEAK
// (round 7 — MEASURED, PRE-EXISTING ON `main`, NOT FIXED HERE).
//
// !! THIS SECTION ASSERTS A LEAK, NOT SAFETY. READ BEFORE TRUSTING IT. !!
//
// `fnDeclParamDefaultRoots` returns `params[i].defaultValue` only when it is a
// top-level STRING. For a DESTRUCTURED parameter, `ast-builder.js`'s
// `parseParamList` puts the whole pattern in `params[i].name` as a structured
// `DestructurePattern` and the per-property default lives INSIDE it — so
// `function f({ h = hashPassword }) { … }` is on NEITHER tree.
//
// MEASURED at `ff0cbdd8` AND after round 7's B-1 fix, identically, at exit 0
// with ZERO diagnostics:
//     ZERO `.server.js`
//     `const { hashPassword } = _scrml_stdlib.auth;`  in the client
//     `Bun.password` + `argon2id`                     in the runtime the HTML loads
// i.e. §12.2 Trigger 3's own founding symptom, reproduced exactly.
//
// PRE-EXISTING, and provably so: on `origin/main` the scan root of
// `collectServerOnlyBindingModules` is `body` alone (`scanForServerOnlyBindingRefs(body, live)`),
// so NO parameter default of any shape is scanned there. Round 6 added top-level
// string defaults; the destructured position was never covered on either tree.
//
// THE FIX IS KNOWN AND IS NOT TAKEN HERE, deliberately: the NESTED twin already
// escalates correctly (asserted below), because the walk descends a nested
// `function-decl`'s `params` generically and reaches the pattern. Only the
// TOP-LEVEL scan root misses it, since `fnNode.params` is a sibling of `body`.
// Adding `fnNode.params` to that root closes it — but it MOVES PLACEMENT, needs
// its own direction-of-change measurement, and carries a companion over-fire
// (`collectServerOnlyBindingModules`'s shadow set reads `p.name` as a string, so
// a pattern's own bound names neither shadow nor are excluded). That is its own
// change with its own evidence, not a rider on this one.
//
// WHEN IT IS FIXED, THESE EXPECTATIONS MUST INVERT, NOT BE DELETED — the flip is
// the evidence the gap closed. Same convention as §1 and §5.
// ---------------------------------------------------------------------------

const DESTRUCTURED_DEFAULT_LEAK = `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <out> = ""
  function f({ h = hashPassword }) { return h("k") }
${CLOSE}
<button onclick={ @out = f({}) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;

const ARRAY_DESTRUCTURED_DEFAULT_LEAK = `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <out> = ""
  function f([ h = hashPassword ]) { return h("k") }
${CLOSE}
<button onclick={ @out = f([]) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;

// The NESTED twin — identical default position, one level in. This one is
// CORRECT today, and asserting it is what proves the gap is the top-level scan
// ROOT and not the pattern being unreadable.
const DESTRUCTURED_DEFAULT_NESTED_OK = `<program>
${OPEN}
  import { hashPassword } from 'scrml:auth'
  <out> = ""
  function outer(v) { function inner({ h = hashPassword }) { return h("k") } return inner({}) }
${CLOSE}
<button onclick={ @out = outer(1) }>go</button>
<div id="out">${OPEN}@out${CLOSE}</div>
</program>
`;

describe("CONF-DERIVED-SERVER-ONLY-REACH — §9 GAP PIN: a TOP-LEVEL destructured parameter default leaks", () => {
  for (const [name, source] of [
    ["object-pattern", DESTRUCTURED_DEFAULT_LEAK],
    ["array-pattern", ARRAY_DESTRUCTURED_DEFAULT_LEAK],
  ]) {
    test(`${name}: NOT escalated, and the auth implementation IS in the browser bundle`, () => {
      const c = compileToDisk(`r7-destructured-${name}`, source);
      try {
        // Exit 0. Nothing says anything.
        expect(c.errorCodes).toEqual([]);
        // Not escalated.
        expect(c.serverJsFiles.length).toBe(0);
        // THE LEAK. These `toContain`s are the inversion point: when the gap
        // closes they become `not.toContain` and `serverJsFiles.length` becomes
        // `toBeGreaterThan(0)`.
        expect(c.clientLoaded.length).toBeGreaterThan(0);
        expect(c.clientLoadedText).toContain("_scrml_stdlib.auth");
        expect(c.clientLoadedText).toContain("Bun.password");
        expect(c.clientLoadedText).toContain("argon2id");
      } finally {
        teardown(`r7-destructured-${name}`);
      }
    });
  }

  test("the NESTED twin is correct today — so the gap is the top-level scan ROOT, not the pattern", () => {
    const c = compileToDisk("r7-destructured-nested-ok", DESTRUCTURED_DEFAULT_NESTED_OK);
    try {
      expect(c.errorCodes).toEqual([]);
      expect(c.serverJsFiles.length).toBeGreaterThan(0);
      expect(c.clientLoadedText).not.toContain("Bun.password");
      expect(c.clientLoadedText).not.toContain("argon2id");
      expect(c.clientLoadedText).not.toContain("_scrml_stdlib.auth");
    } finally {
      teardown("r7-destructured-nested-ok");
    }
  });
});
