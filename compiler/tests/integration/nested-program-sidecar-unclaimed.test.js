/**
 * §4.12.5 + §23.4 — the sidecar carve-out is CONDITIONAL, not absolute.
 *
 * `E-NESTED-PROGRAM-CONTEXT-NOMINAL` deliberately excludes the §4.12.5 foreign
 * sidecar, because §23.4 already fails it closed at the `use foreign:name { … }`
 * site with `E-FOREIGN-SIDECAR-NOMINAL`, and two errors on one unbuilt shape is
 * two diagnostics for one mistake.
 *
 * That reasoning holds only when there IS a `use foreign:` to fire at. With none,
 * the carve-out suppressed the ONLY diagnostic. Two defects lived in that gap:
 *
 *   1. A sidecar declared with no `use foreign:` in the parent compiled to
 *      exit 0, silent, with its markup children deleted.
 *   2. `<program name="api" route="/api/v1" lang="go">` compiled to exit 0,
 *      silent — because `lang=` outranks `route=` in the §4.12.3 precedence,
 *      so ADDING `lang=` LAUNDERED a `route=` server endpoint past the refusal
 *      it would otherwise get.
 *
 * ## Scope discipline
 *
 * The reviewer's argument that `E-NESTED-PROGRAM-CONTEXT-NOMINAL` and
 * `E-FOREIGN-SIDECAR-NOMINAL` express ONE concept split by WHERE they fire is
 * with the operator, and is NOT decided here. Neither code is consolidated,
 * retired, or re-scoped. What changed is only the CONDITION each fires on, made
 * precise as ONE-DIAGNOSTIC-PER-MISTAKE:
 *
 *   sidecar WITH    `use foreign:`  ->  E-FOREIGN-SIDECAR-NOMINAL (§23.4), only
 *   sidecar WITHOUT `use foreign:`  ->  E-NESTED-PROGRAM-CONTEXT-NOMINAL, only
 *
 * §4.12.3's normative sentence already reads that way — it names the two
 * diagnostics with an "or", expecting one of them, not both and not neither.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "sidecar-unclaimed-")); });
afterAll(() => { if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true }); });

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
    workerFilesOnDisk: listed.filter((f) => f.endsWith(".worker.js")).sort(),
  };
}

const codesOf = (o) => o.diagnostics.map((d) => d.code);
const messageFor = (o, code) => (o.diagnostics.find((d) => d.code === code) ?? {}).message ?? "";

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

describe("§23.4 — an UNCLAIMED sidecar is refused at its declaration", () => {
  test("a sidecar with no `use foreign:` in the parent fails closed", () => {
    const o = build("unclaimed", SIDECAR_UNCLAIMED);
    // Pre-fix: exit 0, zero diagnostics, body silently discarded.
    expect(codesOf(o)).toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    // And it still emits no worker — the round-2 guarantee is untouched.
    expect(o.workerFilesOnDisk).toEqual([]);
  });

  test("the message names the MISSING `use foreign:`, not a generic context refusal", () => {
    const o = build("unclaimed-msg", SIDECAR_UNCLAIMED);
    const msg = messageFor(o, "E-NESTED-PROGRAM-CONTEXT-NOMINAL");
    expect(msg).toContain("FOREIGN LANGUAGE SIDECAR");
    expect(msg).toContain("use foreign:ml");
  });

  test("a CLAIMED sidecar still fires §23.4's code and ONLY §23.4's code", () => {
    const o = build("claimed", SIDECAR_CLAIMED);
    // The double-fire guard. This is the ratified carve-out and it must survive:
    // two errors on one unbuilt shape is two diagnostics for one mistake.
    const codes = codesOf(o);
    expect(codes).toContain("E-FOREIGN-SIDECAR-NOMINAL");
    expect(codes).not.toContain("E-NESTED-PROGRAM-CONTEXT-NOMINAL");
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
