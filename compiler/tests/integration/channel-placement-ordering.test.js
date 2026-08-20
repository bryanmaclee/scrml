/**
 * §38.1 / §38.2 — `<channel>` PLACEMENT PRECEDENCE, pinned.
 *
 * This file discharges the test the S353-bryan ruling explicitly owed:
 * gap `g-channel-in-nested-program-inside-page-ordering` said "**Owed by the
 * build:** a test pinning the ordering (none exists today, EITHER WAY) AND the
 * adjacent question this ruling forces — should `E-CHANNEL-OUTSIDE-PROGRAM`'s
 * `fileHasProgram` pre-scan be nested-`<program>`-aware?"
 *
 * ## The ruling
 *
 * **S353-bryan, option (b) — reverse the precedence.** Reset `pageDepth` when
 * descending into a nested `<program>`, treating it as a fresh placement scope.
 * §4.12.1 is the more specific normative sentence and it wins: a nested
 * `<program>` "SHALL be subject to the same grammar rules as a top-level
 * `<program>`" and "SHALL be a separate compilation unit", so the enclosing
 * `<page>` is as invisible to the placement check as the parent's bindings are
 * under §4.12.1 shared-nothing isolation. The FORK RULE genuinely split
 * (limit-over-widen / fail-closed / reversibility all favoured keeping the
 * rejection; root-over-position favoured (b)); root won.
 *
 * ## What the ruling asks for, and what round 1 delivered
 *
 *   shape                                          base                  round 1
 *   <page> -> <program name=w> -> <channel>        E-CHANNEL-INSIDE-PAGE E-CHANNEL-INSIDE-NESTED-PROGRAM
 *   <page> -> <program db=…>   -> <channel>        E-CHANNEL-INSIDE-PAGE unchanged
 *
 * The first row moved only because a NEW, higher-precedence code was ordered
 * ahead of the page check — the `pageDepth` reset the ruling actually names was
 * never written. So the ruled direction was half implemented and the
 * NON-EXTRACTED nested program — the one shape where the ruling has a visible
 * consequence, because it is the one that CAN work — still fired.
 *
 * Completed here. And it was measured before it was taken: on the pre-fix tree
 * `<page>` -> `<program db=>` -> `<channel>` already emitted BOTH halves,
 * client dial `_scrml_ws/page_feed` AND server route
 * `_scrml_route_ws_page_feed`. Only the placement check stood between the
 * author and a working program.
 *
 * ## The adjacent question, answered
 *
 * No change is owed to the `fileHasProgram` pre-scan. It counts every
 * `<program>` element in the file, nested ones included — and it needs no
 * nesting exception, because a nested `<program>` cannot exist without an
 * enclosing one. A file containing a nested `<program>` therefore always
 * contains a top-level `<program>` and is never a PURE-CHANNEL-FILE (§38.12.6).
 * Pinned below rather than argued.
 *
 * These tests pin the PRECEDENCE — which code wins when two conditions hold at
 * once — not merely the outcome, so a future re-ordering of the three placement
 * arms fails here rather than silently changing which diagnostic an author
 * reads.
 */

import { describe, test, expect } from "bun:test";
import { writeFileSync, rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

function compileSrc(src) {
  const root = mkdtempSync(join(tmpdir(), "chan-order-"));
  const file = join(root, "app.scrml");
  writeFileSync(file, src);
  const outDir = join(root, "dist");
  const result = compileScrml({
    inputFiles: [file],
    outputDir: outDir,
    write: true,
    log: () => {},
  });
  const read = (name) => (existsSync(join(outDir, name)) ? readFileSync(join(outDir, name), "utf8") : null);
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    clientJs: read("app.client.js"),
    serverJs: read("app.server.js"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const PLACEMENT_CODES = [
  "E-CHANNEL-INSIDE-NESTED-PROGRAM",
  "E-CHANNEL-INSIDE-PAGE",
  "E-CHANNEL-OUTSIDE-PROGRAM",
];

/** The placement codes that fired, in the order the compiler reported them. */
const placementCodes = (o) =>
  [...o.errors, ...o.warnings].map((e) => e.code).filter((c) => PLACEMENT_CODES.includes(c));

const clientDials = (o) =>
  [...new Set([...(o.clientJs ?? "").matchAll(/_scrml_ws\/([a-z0-9_]+)/g)].map((m) => m[1]))].sort();
const serverRoutes = (o) =>
  [...new Set([...(o.serverJs ?? "").matchAll(/_scrml_route_ws_([a-z0-9_]+)/g)].map((m) => m[1]))].sort();

// ---------------------------------------------------------------------------

const PAGE_THEN_EXTRACTED_PROGRAM = `<program>

<page>
    <program name="w">
        <channel name="page-feed">
            <items> = []
        </channel>
    </>
</page>

</program>
`;

const PAGE_THEN_SCOPED_DB_PROGRAM = `<program db="sqlite:./primary.db">

<page>
    <program db="sqlite:./metrics.db">
        <channel name="page-feed">
            <items> = []
        </channel>
        <p>n: \${@items.length}</p>
    </>
</page>

</program>
`;

const PAGE_ONLY = `<program>

<page>
    <channel name="page-feed">
        <items> = []
    </channel>
    <p>n: \${@items.length}</p>
</page>

</program>
`;

const PAGE_INSIDE_NESTED_PROGRAM = `<program db="sqlite:./primary.db">

<page>
    <program db="sqlite:./metrics.db">
        <page>
            <channel name="deep-feed">
                <items> = []
            </channel>
            <p>n: \${@items.length}</p>
        </page>
    </>
</page>

</program>
`;

describe("§38.1 precedence — a nested <program> is a FRESH placement scope (S353 ruling (b))", () => {
  test("<page> -> EXTRACTED <program name=w> -> <channel> reports the NESTED-PROGRAM code, not INSIDE-PAGE", () => {
    // The precedence assertion, not just the outcome: BOTH conditions hold
    // (there is a `<page>` ancestor AND an extracted nested `<program>`
    // ancestor), and exactly one code fires — the one that names the reason the
    // declaration cannot be built at all. Sending the author to the `<page>`
    // remedy would send them to the wrong fix: there is no `<page>` to move out
    // of that would help.
    const o = compileSrc(PAGE_THEN_EXTRACTED_PROGRAM);
    try {
      expect(placementCodes(o)).toEqual(["E-CHANNEL-INSIDE-NESTED-PROGRAM"]);
    } finally { o.cleanup(); }
  });

  test("<page> -> NON-EXTRACTED <program db=> -> <channel> fires NOTHING — the ruling's visible half", () => {
    // This is the row round 1 left unmoved. The scoped-DB subtree is not
    // extracted, so the channel survives into server emission and the shape
    // WORKS — verified by the dial/route assertion below, not assumed.
    const o = compileSrc(PAGE_THEN_SCOPED_DB_PROGRAM);
    try {
      expect(placementCodes(o)).toEqual([]);
      expect(o.errors).toEqual([]);
    } finally { o.cleanup(); }
  });

  test("...and that un-refused shape really does emit both halves", () => {
    const o = compileSrc(PAGE_THEN_SCOPED_DB_PROGRAM);
    try {
      expect(clientDials(o)).toEqual(["page_feed"]);
      expect(serverRoutes(o)).toEqual(["page_feed"]);
      expect(clientDials(o)).toEqual(serverRoutes(o));
    } finally { o.cleanup(); }
  });
});

describe("§38.1 precedence — the reset does not over-apply", () => {
  test("<page> -> <channel> with NO nested <program> still fires E-CHANNEL-INSIDE-PAGE", () => {
    // The guard. `pageDepth` must reset only when descending through a nested
    // `<program>`; the ordinary page-nested channel is untouched.
    const o = compileSrc(PAGE_ONLY);
    try {
      expect(placementCodes(o)).toEqual(["E-CHANNEL-INSIDE-PAGE"]);
    } finally { o.cleanup(); }
  });

  test("a <page> INSIDE the nested <program> re-arms the check — a fresh scope, not a disabled one", () => {
    // `<page>` -> `<program db=>` -> `<page>` -> `<channel>`. The reset makes
    // the OUTER `<page>` invisible; the INNER one is inside the nested
    // program's own scope and disqualifies exactly as it would at top level.
    const o = compileSrc(PAGE_INSIDE_NESTED_PROGRAM);
    try {
      expect(placementCodes(o)).toEqual(["E-CHANNEL-INSIDE-PAGE"]);
    } finally { o.cleanup(); }
  });
});

describe("§38.1 — the three placement codes stay MUTUALLY EXCLUSIVE", () => {
  const SHAPES = {
    "page-then-extracted-program": PAGE_THEN_EXTRACTED_PROGRAM,
    "page-then-scoped-db-program": PAGE_THEN_SCOPED_DB_PROGRAM,
    "page-only": PAGE_ONLY,
    "page-inside-nested-program": PAGE_INSIDE_NESTED_PROGRAM,
  };

  test("never more than one placement code per channel declaration", () => {
    for (const [name, src] of Object.entries(SHAPES)) {
      const o = compileSrc(src);
      try {
        // Reported as {shape, codes} so a failure names WHICH shape doubled up.
        const codes = placementCodes(o);
        expect({ shape: name, atMostOne: codes.length <= 1, codes })
          .toEqual({ shape: name, atMostOne: true, codes });
      } finally { o.cleanup(); }
    }
  });
});

describe("§38.2 — the `fileHasProgram` pre-scan needs no nesting exception (the adjacent question)", () => {
  test("a file-top <channel> still fires E-CHANNEL-OUTSIDE-PROGRAM when the file's program has a NESTED program", () => {
    // The pre-scan counts every `<program>` in the file, nested ones included.
    // That is already correct and cannot be otherwise: a nested `<program>`
    // implies an enclosing one, so a file with a nested `<program>` always has
    // a top-level `<program>` and is never a PURE-CHANNEL-FILE.
    const o = compileSrc(`<channel name="loose-feed">
    <items> = []
</channel>

<program>
    <program name="w">
        \${ when message(data) { send({ ok: true }) } }
    </>
    <p>hi</p>
</program>
`);
    try {
      expect(placementCodes(o)).toEqual(["E-CHANNEL-OUTSIDE-PROGRAM"]);
    } finally { o.cleanup(); }
  });

  test("the §38.12.6 PURE-CHANNEL-FILE dispensation is untouched", () => {
    // A module file with NO `<program>` anywhere: file-top `<channel>` is
    // canonical and silent (Insight 30, S87).
    const o = compileSrc(`<channel name="pure-feed">
    <items> = []
</channel>
`);
    try {
      expect(placementCodes(o)).toEqual([]);
    } finally { o.cleanup(); }
  });
});
