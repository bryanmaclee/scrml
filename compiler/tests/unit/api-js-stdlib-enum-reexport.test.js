/**
 * api.js stdlib enum re-export — Unit Tests
 *
 * Coverage:
 *   §A  Direct re-export resolves: importing file's typeRegistry sees the
 *       re-exported enum as a tEnum (not as unknown).
 *   §B  Multi-hop re-export chain (a → b → c) resolves cleanly.
 *   §C  Match exhaustiveness through a re-export — missing variant fires
 *       E-TYPE-020, proving the type was actually classified as `enum` with
 *       the right variant set.
 *   §D  Circular re-export does NOT infinite-loop — compiler terminates with
 *       a finite (possibly nonzero) error count.
 *   §E  Same-file enum import (no re-export hop) still works (regression
 *       guard for the direct-typeDecl path).
 *
 * Approach: write fixtures to /tmp and run compileScrml end-to-end; the
 * absence/presence of E-TYPE-020 across a `match` exhaustiveness check is
 * the load-bearing signal that the seeder reached the enum's variant set.
 *
 * Why fresh enum names (not ParseError): ParseError is a BUILTIN_TYPES entry
 * (Phase 2, b5caf5d). Using fresh names ensures the test exercises the
 * re-export-chase path, not the builtin-merge path.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const TMP_ROOT = join(tmpdir(), "scrml-reexport-tests");

function setupDir(name) {
  const dir = join(TMP_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function teardownDir(name) {
  rmSync(join(TMP_ROOT, name), { recursive: true, force: true });
}

const OPEN = "${";
const CLOSE = "}";

describe("api.js stdlib enum re-export — seeder", () => {
  // -------------------------------------------------------------------------
  // §A — Direct single-hop re-export
  // -------------------------------------------------------------------------
  describe("§A direct re-export", () => {
    const NAME = "A";
    let dir;
    beforeEach(() => { dir = setupDir(NAME); });
    afterEach(() => { teardownDir(NAME); });

    test("re-exported enum resolves and exhaustive match passes cleanly", () => {
      writeFileSync(join(dir, "source.scrml"), `<program>
${OPEN}
    export type LoadResult:enum = { Success, Empty, Failed }
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "index.scrml"), `<program>
${OPEN}
    export { LoadResult } from './source.scrml'
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "app.scrml"), `<program>
${OPEN}
    import { LoadResult } from './index.scrml'
    @state: LoadResult = LoadResult.Success
    let r: string = match @state { .Success => "ok" .Empty => "empty" .Failed => "no" }
${CLOSE}
<p>${OPEN}r${CLOSE}</p>
</program>
`);
      const r = compileScrml({
        inputFiles: [join(dir, "app.scrml")],
        outputDir: join(dir, "dist"),
        write: false,
      });
      // No E-TYPE-020 — match is exhaustive across the enum's 3 variants.
      const exhaustErr = r.errors.find(e => e.code === "E-TYPE-020");
      expect(exhaustErr).toBeUndefined();
      // Type was not unknown.
      const unknownTypeErr = r.errors.find(e =>
        typeof e.message === "string" && /unknown type.*LoadResult/i.test(e.message)
      );
      expect(unknownTypeErr).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // §B — Multi-hop re-export chain
  // -------------------------------------------------------------------------
  describe("§B multi-hop chain", () => {
    const NAME = "B";
    let dir;
    beforeEach(() => { dir = setupDir(NAME); });
    afterEach(() => { teardownDir(NAME); });

    test("a → b → c chain resolves", () => {
      writeFileSync(join(dir, "c.scrml"), `<program>
${OPEN}
    export type Status:enum = { Active, Inactive }
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "b.scrml"), `<program>
${OPEN}
    export { Status } from './c.scrml'
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "a.scrml"), `<program>
${OPEN}
    export { Status } from './b.scrml'
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "app.scrml"), `<program>
${OPEN}
    import { Status } from './a.scrml'
    @s: Status = Status.Active
    let r: string = match @s { .Active => "on" .Inactive => "off" }
${CLOSE}
<p>${OPEN}r${CLOSE}</p>
</program>
`);
      const r = compileScrml({
        inputFiles: [join(dir, "app.scrml")],
        outputDir: join(dir, "dist"),
        write: false,
      });
      const exhaustErr = r.errors.find(e => e.code === "E-TYPE-020");
      expect(exhaustErr).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // §C — Exhaustiveness fires when the re-exported enum is missing a variant
  // -------------------------------------------------------------------------
  describe("§C exhaustiveness through re-export", () => {
    const NAME = "C";
    let dir;
    beforeEach(() => { dir = setupDir(NAME); });
    afterEach(() => { teardownDir(NAME); });

    test("missing variant fires E-TYPE-020 — proves enum classification flowed", () => {
      writeFileSync(join(dir, "source.scrml"), `<program>
${OPEN}
    export type Color:enum = { Red, Green, Blue }
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "index.scrml"), `<program>
${OPEN}
    export { Color } from './source.scrml'
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "app.scrml"), `<program>
${OPEN}
    import { Color } from './index.scrml'
    @c: Color = Color.Red
    let r: string = match @c { .Red => "r" .Green => "g" }
${CLOSE}
<p>${OPEN}r${CLOSE}</p>
</program>
`);
      const r = compileScrml({
        inputFiles: [join(dir, "app.scrml")],
        outputDir: join(dir, "dist"),
        write: false,
      });
      // Blue is missing — exhaustiveness must fire (E-TYPE-020 is the
      // non-exhaustive-match-over-enum code; firing it proves the type was
      // resolved as an enum with the right variant set).
      const exhaustErr = r.errors.find(e => e.code === "E-TYPE-020");
      expect(exhaustErr).toBeDefined();
      expect(exhaustErr.message).toContain("Blue");
    });
  });

  // -------------------------------------------------------------------------
  // §D — Circular re-export does not infinite-loop
  // -------------------------------------------------------------------------
  describe("§D circular re-export termination", () => {
    const NAME = "D";
    let dir;
    beforeEach(() => { dir = setupDir(NAME); });
    afterEach(() => { teardownDir(NAME); });

    test("a re-exports from b; b re-exports from a — compiler terminates", () => {
      writeFileSync(join(dir, "a.scrml"), `<program>
${OPEN}
    export { Phantom } from './b.scrml'
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "b.scrml"), `<program>
${OPEN}
    export { Phantom } from './a.scrml'
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "app.scrml"), `<program>
${OPEN}
    import { Phantom } from './a.scrml'
${CLOSE}
</program>
`);
      // The seeder's visited-set must break the cycle. We don't care WHAT the
      // result is (it'll likely surface E-IMPORT-002 + E-IMPORT-004); we
      // care only that compileScrml RETURNS in finite time.
      const result = compileScrml({
        inputFiles: [join(dir, "app.scrml")],
        outputDir: join(dir, "dist"),
        write: false,
      });
      // If we reach this line, the seeder did not infinite-loop.
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // §E — Direct same-file enum import (regression — pre-existing path still works)
  // -------------------------------------------------------------------------
  describe("§E direct typeDecl path regression", () => {
    const NAME = "E";
    let dir;
    beforeEach(() => { dir = setupDir(NAME); });
    afterEach(() => { teardownDir(NAME); });

    test("import from a file that declares the enum directly still resolves", () => {
      writeFileSync(join(dir, "types.scrml"), `<program>
${OPEN}
    export type Mode:enum = { On, Off }
${CLOSE}
</program>
`);
      writeFileSync(join(dir, "app.scrml"), `<program>
${OPEN}
    import { Mode } from './types.scrml'
    @m: Mode = Mode.On
    let r: string = match @m { .On => "on" .Off => "off" }
${CLOSE}
<p>${OPEN}r${CLOSE}</p>
</program>
`);
      const r = compileScrml({
        inputFiles: [join(dir, "app.scrml")],
        outputDir: join(dir, "dist"),
        write: false,
      });
      const exhaustErr = r.errors.find(e => e.code === "E-TYPE-020");
      expect(exhaustErr).toBeUndefined();
    });
  });
});
