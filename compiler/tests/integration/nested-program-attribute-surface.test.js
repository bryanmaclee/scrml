/**
 * §4.12.2 — the nested-`<program>` attribute surface, and what the compiler is
 * allowed to say about it.
 *
 * ## LOW-7 — a self-contradictory pair of diagnostics on one source line
 *
 * `route=`, `port=`, `health=`, `protect=` and `story=` are all listed
 * "Valid in nested? YES" in §4.12.2's table but were absent from the `<program>`
 * allowlist in `attribute-registry.js`. Each therefore emitted `W-ATTR-001`:
 * "not recognized on `<program>` … forwarded to the rendered HTML as-is and has
 * no compile-time effect."
 *
 * For `route=` that produced a flat contradiction on ONE source line:
 *
 *   W-ATTR-001                        "no compile-time effect"
 *   E-NESTED-PROGRAM-CONTEXT-NOMINAL  "declares the SERVER ENDPOINT execution context"
 *
 * Both cannot be true, and the author has no way to tell which to believe.
 *
 * The brief named three attributes; compiling the §4.12.2 table found FIVE —
 * `protect=` and `story=` are in the same table and were missing the same way.
 *
 * ## LOW-6 — a declaration the author did not make
 *
 * `nested-program-kind.ts` routes ANY `mode=` to `wasm-module`, which is the
 * correct CLASSIFICATION (§4.12.2 defines `mode=` as `"wasm"` for WASM modules,
 * "omitted for sidecar processes" — there is no third spelling). But the message
 * then told the author of `<program name="x" mode="native">` that they "declare
 * the §4.12.3 WASM COMPUTE MODULE execution context", reporting a declaration
 * they did not make and sending them after a WASM problem they do not have.
 *
 * Same code — the condition really is "this declaration has no runtime behind
 * it" — with a message that names the malformed value first.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "nested-attr-surface-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

function build(dir, src) {
  const root = join(TMP, dir);
  mkdirSync(root, { recursive: true });
  const file = join(root, "app.scrml");
  writeFileSync(file, src);
  const result = compileScrml({
    inputFiles: [file],
    outputDir: join(root, "dist"),
    write: false,
    log: () => {},
  });
  return [...(result.errors ?? []), ...(result.warnings ?? [])];
}

const codesOf = (ds) => ds.map((d) => d.code);
const messageFor = (ds, code) => (ds.find((d) => d.code === code) ?? {}).message ?? "";

const ROUTE_ENDPOINT = `<program>
  <program name="api" route="/api/v1">
    \${ function handle() { return 1 } }
  </program>
  <button>go</button>
</program>
`;

const SIDECAR_FULL = `<program>
  <program name="ml" lang="go" build="go build ." port="9001" health="/health">
    \${ export function predict(req) -> number }
  </program>
  <button>go</button>
</program>
`;

/**
 * `protect=` and `story=` are in §4.12.2's table too, and were missing the same
 * way — but they are deliberately NOT registered. See the test below.
 */
const RETIRED_AND_NOMINAL = `<program>
  <program name="ml" lang="go" protect="secret" story="fast">
    \${ export function predict(req) -> number }
  </program>
  <button>go</button>
</program>
`;

const MODE_MALFORMED = `<program>
  <program name="x" mode="native">
    \${ when message(data) { send({ v: data.v }) } }
  </program>
  <button>go</button>
</program>
`;

const MODE_WASM = `<program>
  <program name="calc" lang="rust" mode="wasm">
    \${ export function add(a, b) -> number }
  </program>
  <button>go</button>
</program>
`;

describe("LOW-7 — §4.12.2's attributes are RECOGNIZED, so no self-contradicting pair", () => {
  test("`route=` no longer draws W-ATTR-001 alongside the context refusal", () => {
    const ds = build("route-endpoint", ROUTE_ENDPOINT);
    const codes = codesOf(ds);
    // The refusal is correct and stays — `route=` really does select a Nominal
    // execution context.
    expect(codes).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    // The claim that contradicted it is gone.
    expect(codes).not.toContain("W-ATTR-001");
  });

  test("`port=` and `health=` are recognized on <program>", () => {
    const ds = build("sidecar-full", SIDECAR_FULL);
    // Pre-fix this emitted a W-ATTR-001 per attribute, each asserting the
    // attribute "has no compile-time effect" — while `port=` is a live
    // discriminator in `nested-program-kind.ts` that decides whether a worker
    // bundle is emitted at all.
    expect(codesOf(ds)).not.toContain("W-ATTR-001");
  });

  test("`protect=` and `story=` KEEP their W-ATTR-001 — registering them would be fail-open", () => {
    // The two §4.12.2 rows deliberately left unregistered, for opposite reasons,
    // both landing on "W-ATTR-001 is TRUE here":
    //
    //   protect= — RETIRED from <program> in S80 (§38: the field-level surface
    //     "remains on `<db>` and `<Type>` declarations"). Registering it would
    //     silently reverse a ratified retirement. §4.12.2's table row is STALE
    //     SPEC that outlived S80 — a residual, not a thing to implement.
    //   story=  — §58 is Nominal/spec-ahead and W-STORY-ON-TOP-LEVEL has ZERO
    //     fire sites, so nothing reads the attribute. W-ATTR-001's "no
    //     compile-time effect" is accurate, and it is the only signal the author
    //     gets that their build story is going nowhere.
    const ds = build("retired-and-nominal", RETIRED_AND_NOMINAL);
    const attrWarnings = ds.filter((d) => d.code === "W-ATTR-001").map((d) => d.message);
    expect(attrWarnings.some((m) => m.includes("`protect=`"))).toBe(true);
    expect(attrWarnings.some((m) => m.includes("`story=`"))).toBe(true);
  });
});

describe("LOW-6 — a malformed `mode=` value is NAMED, not reinterpreted", () => {
  test("mode=\"native\" reports the value instead of claiming a WASM declaration", () => {
    const ds = build("mode-malformed", MODE_MALFORMED);
    expect(codesOf(ds)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");

    const msg = messageFor(ds, "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    // Names the offending value, and quotes the rule it violates.
    expect(msg).toContain('mode="native"');
    expect(msg).toContain("not a recognized execution mode");
    // Does NOT report a declaration the author did not make.
    expect(msg).not.toContain("declares the §4.12.3 WASM COMPUTE MODULE execution context");
    // Still offers the shape that IS implemented.
    expect(msg).toContain("§4.12.4 inline worker");
  });

  test("mode=\"wasm\" keeps the original context message — the fix is value-specific", () => {
    const ds = build("mode-wasm", MODE_WASM);
    expect(codesOf(ds)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");

    const msg = messageFor(ds, "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    expect(msg).toContain("WASM COMPUTE MODULE execution context");
    expect(msg).not.toContain("not a recognized execution mode");
  });
});
