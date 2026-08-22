/**
 * §4.12.5 + §23.4 — the sidecar has NO carve-out. All four unbuilt §4.12.3
 * execution contexts are refused at the DECLARATION, by one code.
 *
 * ## What this file used to pin, and why that shape is gone (S356 r4)
 *
 * Two codes said the same thing — *this execution context is specified but
 * unbuilt; refuse rather than emit a stub* — and were told apart by WHICH SITE
 * NOTICED: `E-FOREIGN-SIDECAR-NOMINAL` at the `use foreign:name { … }` USE site,
 * `E-NESTED-PROGRAM-CONTEXT-NOMINAL` at the nested-`<program>` DECLARATION. Three
 * rounds tried to draw the line between them and produced three defects, every
 * one of them living in the line itself:
 *
 *   1. An unconditional sidecar carve-out gave a sidecar declared with no
 *      `use foreign:` NO diagnostic at all — exit 0, silent, markup children
 *      deleted. The covering code fires at a use site, and there was none.
 *   2. `<program name="api" route="/api/v1" lang="go">` compiled to exit 0,
 *      silent — `lang=` outranks `route=` in the §4.12.3 precedence, so ADDING
 *      `lang=` LAUNDERED a `route=` server endpoint past the refusal.
 *   3. The CONDITIONAL carve-out that fixed (1) DOUBLE-FIRED on the two ratified
 *      §23.5.4 capability cases, with a message asserting the file contained no
 *      `use foreign:` while line 3 of it did. Neither case listed the co-firing
 *      code in `notCodes`, so 894/894 conformance still passed.
 *
 * The operator ruling: fire at the declaration for all four, sidecar included,
 * and RETIRE `E-FOREIGN-SIDECAR-NOMINAL`. A use-site alias was considered and
 * rejected — the declaration always exists when a sidecar is declared, so a
 * use-site twin could only ever fire IN ADDITION, which is the double fire being
 * removed.
 *
 * ## The invariant this file pins
 *
 *   EXACTLY ONE diagnostic per unbuilt declaration. Never two, never none.
 *
 * Pinned across all four contexts and across claimed / unclaimed / claimed-from-
 * inside-the-subtree, by COUNT rather than by membership: a `toContain` check
 * cannot see a double fire, which is precisely how (3) survived a full
 * conformance run.
 *
 * The `use foreign:` site keeps a diagnostic for its OWN condition — `E-FOREIGN-010`
 * (§23.4, "references a name that matches no nested `<program>`"). That is not
 * Nominal-ness and it outlives the Nominal period.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "sidecar-unclaimed-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

// Hash-safe. Under `contentHashAssets` the bundle is written as
// `<base>.<name>.worker.<hash>.js`, so a bare `.endsWith(".worker.js")` finds
// ZERO and every worker assertion below passes VACUOUSLY. This suite does not
// enable that option today, which is exactly why the wrong predicate would sit
// here undetected until someone did.
const IS_WORKER = /\.worker(\.[a-z0-9]+)?\.js$/;

function build(dir, src) {
  const root = join(TMP, dir);
  mkdirSync(root, { recursive: true });
  const file = join(root, "app.scrml");
  writeFileSync(file, src);
  const outDir = join(root, "dist");
  const result = compileScrml({ inputFiles: [file], outputDir: outDir, write: true, log: () => {} });
  const listed = existsSync(outDir) ? readdirSync(outDir) : [];
  return {
    diagnostics: [...(result.errors ?? []), ...(result.warnings ?? [])],
    workerFilesOnDisk: listed.filter((f) => IS_WORKER.test(f)).sort(),
  };
}

const codesOf = (o) => o.diagnostics.map((d) => d.code);
const countOf = (o, code) => o.diagnostics.filter((d) => d.code === code).length;
const messageFor = (o, code) => (o.diagnostics.find((d) => d.code === code) ?? {}).message ?? "";

/**
 * The count that matters: how many diagnostics refuse this declaration for being
 * an unbuilt execution context. It sums the surviving code AND the retired one,
 * so the assertion stays honest if the retired code is ever resurrected.
 */
const refusalCount = (o) =>
  countOf(o, "E-NESTED-PROGRAM-CONTEXT-NOMINAL") + countOf(o, "E-FOREIGN-SIDECAR-NOMINAL");

const SIDECAR_UNCLAIMED = `<program>
  <program name="ml" lang="go" build="go build ." port="9001" health="/health">
    <span>sidecar body markup</span>
    \${ export function predict(req) -> number }
  </program>
  <button>go</button>
</program>
`;

const SIDECAR_CLAIMED = `<program>
  <program name="ml" lang="go" build="go build ." port="9001" health="/health">
    \${ export function predict(req) -> number }
  </program>
  \${
    use foreign:ml { predict }
  }
  <button>go</button>
</program>
`;

/**
 * The r3 double-fire shape: the `use foreign:` sits INSIDE the sidecar's own
 * subtree. The two ratified §23.5.4 capability conformance cases are written this
 * way deliberately — it is how closest-wins capability inheritance is exercised.
 */
const SIDECAR_CLAIMED_INSIDE = `<program capabilities=[network("api.example.com")]>
  <program name="probe" lang="ts">
    use foreign:probe { run }
  </>
</>
`;

/** `route=` + `lang=` — the laundering shape. */
const ROUTE_PLUS_LANG = `<program>
  <program name="api" route="/api/v1" lang="go">
    \${ export function handle(req) -> number }
  </program>
  <button>go</button>
</program>
`;

/** The control: the same endpoint WITHOUT `lang=`, which was always refused. */
const ROUTE_ONLY = `<program>
  <program name="api" route="/api/v1">
    \${ function handle() { return 1 } }
  </program>
  <button>go</button>
</program>
`;

/** §4.12.3 WASM compute module — the third unbuilt context. */
const WASM_MODULE = `<program>
  <program name="calc" lang="rust" mode="wasm" build="cargo build" source="./crates/calc">
    <span>wasm body markup</span>
  </program>
  <button>go</button>
</program>
`;

describe("§23.4 — a sidecar is refused at its DECLARATION, claimed or not", () => {
  test("a sidecar with no `use foreign:` in the parent fails closed", () => {
    const o = build("unclaimed", SIDECAR_UNCLAIMED);
    // Pre-fix: exit 0, zero diagnostics, body silently discarded.
    expect(codesOf(o)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    // And it still emits no worker — the round-2 guarantee is untouched.
    expect(o.workerFilesOnDisk).toEqual([]);
  });

  test("the message names the SIDECAR context and its runtime model", () => {
    const o = build("unclaimed-msg", SIDECAR_UNCLAIMED);
    const msg = messageFor(o, "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    expect(msg).toContain("FOREIGN LANGUAGE SIDECAR");
    expect(msg).toContain("subprocess reached over HTTP/socket");
  });

  test("the message makes NO claim about whether a `use foreign:` exists", () => {
    // r3's wording asserted "NOTHING IN THIS FILE CLAIMS IT: there is no
    // `use foreign:ml { … }` declaration in the parent". On the CLAIMED fixture
    // that sentence is false, and on the claimed-from-inside fixture it is false
    // two lines from the caret. A diagnostic must not make a claim about the file
    // that the reader can disprove from the same screen.
    for (const [dir, src] of [
      ["msg-unclaimed", SIDECAR_UNCLAIMED],
      ["msg-claimed", SIDECAR_CLAIMED],
      ["msg-claimed-inside", SIDECAR_CLAIMED_INSIDE],
    ]) {
      const msg = messageFor(build(dir, src), "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
      expect(msg).not.toContain("NOTHING IN THIS FILE CLAIMS IT");
      expect(msg).not.toContain("there is no `use foreign:");
    }
  });

  test("a CLAIMED sidecar is refused EXACTLY ONCE — the r3 double fire is gone", () => {
    const o = build("claimed", SIDECAR_CLAIMED);
    expect(refusalCount(o)).toBe(1);
    expect(codesOf(o)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
  });

  test("a sidecar claimed from INSIDE its own subtree is refused exactly once", () => {
    // This is the exact shape that double-fired in r3: `fileDeclaresUseForeign`
    // excluded the sidecar's own subtree, so the `use foreign:probe` on line 3 did
    // not count as a claim and the declaration fired a SECOND diagnostic whose
    // text denied that very line.
    const o = build("claimed-inside", SIDECAR_CLAIMED_INSIDE);
    expect(refusalCount(o)).toBe(1);
    expect(countOf(o, "E-FOREIGN-010")).toBe(0);
  });

  test("E-FOREIGN-SIDECAR-NOMINAL is RETIRED — it fires on none of these shapes", () => {
    for (const [dir, src] of [
      ["retired-unclaimed", SIDECAR_UNCLAIMED],
      ["retired-claimed", SIDECAR_CLAIMED],
      ["retired-claimed-inside", SIDECAR_CLAIMED_INSIDE],
    ]) {
      expect(countOf(build(dir, src), "E-FOREIGN-SIDECAR-NOMINAL")).toBe(0);
    }
  });
});

describe("§4.12.3 — `lang=` cannot launder a `route=` endpoint past the refusal", () => {
  test("`route=` + `lang=` is refused", () => {
    const o = build("launder", ROUTE_PLUS_LANG);
    // Pre-fix: exit 0, silent. `lang=` outranks `route=` in the §4.12.3
    // precedence, so the element classified as a sidecar and fell into the
    // unconditional carve-out.
    expect(codesOf(o)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    expect(o.workerFilesOnDisk).toEqual([]);
  });

  test("the message tells the author `route=` is inert here, so the repair is obvious", () => {
    const o = build("launder-msg", ROUTE_PLUS_LANG);
    const msg = messageFor(o, "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    // Without this, an author who added `lang=` to a refused `route=` endpoint
    // and saw the error change wording would reasonably think `route=` still
    // means something on this element.
    expect(msg).toContain("also carries `route=`");
    expect(msg).toContain("inert");
  });

  test("`route=` alone is still refused — the fix widens, it does not move", () => {
    const o = build("route-only", ROUTE_ONLY);
    expect(codesOf(o)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
  });
});

describe("the invariant, across all four unbuilt §4.12.3 contexts", () => {
  // ONE diagnostic per unbuilt declaration — never two, never none — asserted by
  // COUNT. A `toContain` membership check is blind to the two-diagnostic failure
  // mode, which is how the r3 regression passed a full 894-case conformance run.
  const CASES = [
    ["sidecar, unclaimed", SIDECAR_UNCLAIMED],
    ["sidecar, claimed from the parent", SIDECAR_CLAIMED],
    ["sidecar, claimed from inside its own subtree", SIDECAR_CLAIMED_INSIDE],
    ["server endpoint (`route=`)", ROUTE_ONLY],
    ["server endpoint laundered with `lang=`", ROUTE_PLUS_LANG],
    ["WASM compute module (`mode=\"wasm\"`)", WASM_MODULE],
  ];

  for (const [label, src] of CASES) {
    test(`${label} — exactly one refusal, and no worker artifact`, () => {
      const o = build(`inv-${label.replace(/[^a-z0-9]+/gi, "-")}`, src);
      expect(refusalCount(o)).toBe(1);
      expect(o.workerFilesOnDisk).toEqual([]);
    });
  }
});
