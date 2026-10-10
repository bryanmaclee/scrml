// bootstrap-url-guard-verbatim.test.js — s462-bootstrap-sink-guards.
//
// SPEC §5.2 rule 3: "The safe sets and the scheme test SHALL be the ones rule 2 uses — one
// definition, not a second list." impl#1's compiler/src/runtime-url-guard.js is that definition.
// The bootstrap runtime (compiler/self-host-v2/slice-m1/runtime/runtime.js) ships as one file, so it
// carries the guard's text verbatim between two marker lines (`export ` stripped — exactly as
// impl#1's own runtime inlines it). This test fails the moment the two drift: edit
// runtime-url-guard.js, then run `bun scripts/sync-bootstrap-url-guard.ts --write`.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BOOT_RUNTIME_PATH,
  currentBlock,
  expectedBlock,
  isInSync,
} from "../../../scripts/sync-bootstrap-url-guard.ts";
import { URL_GUARD_RUNTIME_SOURCE } from "../../src/runtime-template.js";

describe("bootstrap runtime carries impl#1's §5.2 URL guard verbatim", () => {
  test("the block between the markers equals compiler/src/runtime-url-guard.js (`export ` stripped)", () => {
    const runtime = readFileSync(BOOT_RUNTIME_PATH, "utf8");
    expect(currentBlock(runtime).block).toBe(expectedBlock());
    expect(isInSync()).toBe(true);
  });

  test("it is the same text impl#1's client runtime inlines (URL_GUARD_RUNTIME_SOURCE)", () => {
    const want = URL_GUARD_RUNTIME_SOURCE.endsWith("\n") ? URL_GUARD_RUNTIME_SOURCE : URL_GUARD_RUNTIME_SOURCE + "\n";
    expect(expectedBlock()).toBe(want);
  });

  test("the bootstrap's bound-attribute write goes through the guard (no second list in the runtime)", () => {
    const runtime = readFileSync(BOOT_RUNTIME_PATH, "utf8");
    const { before, after } = currentBlock(runtime);
    const outside = before + after;
    // `attr` asks the guard; the only URL-attribute table is the verbatim one.
    expect(outside).toContain("const guard = urlGuardOf(el, name);");
    expect(outside).toContain("_scrml_is_url_attr(tag, lower)");
    expect(outside).not.toMatch(/new Set\(\[\s*"action"/);
    expect(outside).not.toMatch(/"javascript"/);
    // exactly one setAttribute in the runtime — the guarded one
    expect(outside.match(/\.setAttribute\(/g)?.length).toBe(1);
    expect(outside).toContain("el.setAttribute(name, guard === null ? s : guard(s));");
  });
});
