/**
 * E-MARKUP-001 structural-registry completeness (drift guard) | §4.1 / §4.15 / §65.9
 *
 * The E-MARKUP-001 "unknown HTML element" gate (name-resolver.ts) MUST NOT fire
 * on any registered scrml structural element name. Those names are the
 * authoritative source of truth in ast-builder.js:
 *   - STRUCTURAL_ELEMENT_PLACEMENT  — §4.15 locus-restricted structural elements
 *     (schema/engine/channel/page/auth/errors/onTransition/onTimeout/onIdle/
 *     onchange/theme/defaults)
 *   - RESERVED_CSS_ELEMENT_IDENTIFIERS — §65 theme/defaults
 *
 * name-resolver.ts DERIVES its SCRML_NON_ELEMENT_TAGS exclusion from those two
 * registries, so it cannot drift. This test PINS that invariant: if a future
 * structural element is added to the registry but the derivation breaks (or the
 * lowercase-mirror mapping regresses), this fails loudly.
 *
 * Root cause it guards against (S264 review): `<defaults>` was the one
 * placement key missing from an earlier HAND-MAINTAINED exclusion list — it
 * false-fired E-MARKUP-001 on a base-clean §65.9 file. Deriving + this guard
 * make that class of regression structurally impossible.
 */
import { describe, test, expect } from "bun:test";
import {
  STRUCTURAL_ELEMENT_PLACEMENT,
  RESERVED_CSS_ELEMENT_IDENTIFIERS,
} from "../../src/ast-builder.js";
import { SCRML_NON_ELEMENT_TAGS } from "../../src/name-resolver.ts";

describe("E-MARKUP-001 structural-registry completeness (drift guard)", () => {
  test("every STRUCTURAL_ELEMENT_PLACEMENT key is excluded (lowercased)", () => {
    const missing = Object.keys(STRUCTURAL_ELEMENT_PLACEMENT).filter(
      (k) => !SCRML_NON_ELEMENT_TAGS.has(k.toLowerCase()),
    );
    expect(missing).toEqual([]);
  });

  test("every RESERVED_CSS_ELEMENT_IDENTIFIERS entry is excluded (lowercased)", () => {
    const missing = [...RESERVED_CSS_ELEMENT_IDENTIFIERS].filter(
      (k) => !SCRML_NON_ELEMENT_TAGS.has(k.toLowerCase()),
    );
    expect(missing).toEqual([]);
  });

  test("the S264 regression instance `defaults` is excluded", () => {
    expect(SCRML_NON_ELEMENT_TAGS.has("defaults")).toBe(true);
  });

  test("the completed lowercase mirror `onidle` is excluded", () => {
    expect(SCRML_NON_ELEMENT_TAGS.has("onidle")).toBe(true);
  });
});
