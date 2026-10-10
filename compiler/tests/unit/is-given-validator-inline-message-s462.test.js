/**
 * is-given-validator-inline-message-s462.test.js — S462 fix round F2.
 *
 * §55.1 / §55.10: the presence validator `is given` has catalog arity
 * "0+inline", so it takes the Level-1 inline message exactly as `req` does —
 * `<nick is given("need nick")>` (and the soft-deprecated `is some("…")`). The
 * first S462 cut consumed only the two words, the `(` then failed the opener
 * scan, and the cell silently vanished. Now the scan reads the call arguments
 * with the same collector as `req("…")` (ast-builder.js
 * `collectValidatorCallArgs`), the override is registered under the validator's
 * canonical name, and the runtime resolves `.NotSome` to it.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { RUNTIME_CHUNK_ORDER, assembleRuntime } from "../../src/codegen/runtime-chunks.ts";
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const RUN_DIR = join(tmpdir(), `scrml-is-given-inline-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
function compileSrc(src) {
  rmSync(RUN_DIR, { recursive: true, force: true });
  mkdirSync(join(RUN_DIR, "dist"), { recursive: true });
  const file = join(RUN_DIR, "h.scrml");
  writeFileSync(file, src);
  const result = compileScrml({ inputFiles: [file], outputDir: join(RUN_DIR, "dist"), log: () => {} });
  const p = join(RUN_DIR, "dist", "h.client.js");
  const clientJs = existsSync(p) ? readFileSync(p, "utf8") : "";
  rmSync(RUN_DIR, { recursive: true, force: true });
  return { result, clientJs };
}
const D = "$";
const SRC = (spelling) => [
  "<program>",
  `${D}{`,
  "    <signup>",
  `        <nick ${spelling}("need nick") length(>=3, "too short")> = <input id="nick" type="text"/>`,
  "    </>",
  "}",
  "<signup><nick/></>",
  "<div id=\"all\"><errors of=@signup.nick all/></div>",
  "</program>",
  "",
].join("\n");

describe("S462 F2 — `is given(\"msg\")` reads the inline message like `req(\"msg\")`", () => {
  test("the declaration is read and the override registered under `is given` (both spellings)", () => {
    for (const s of ["is given", "is some"]) {
      const { result, clientJs } = compileSrc(SRC(s));
      expect((result.errors ?? []).map((e) => e.code)).toEqual([]);
      expect(clientJs).toContain('_scrml_validator_fire("is given", value)');
      expect(clientJs).toContain('_scrml_cs_messages_register_inline("signup.nick", "is given", "need nick")');
      expect(clientJs).toContain('_scrml_cs_messages_register_inline("signup.nick", "length", "too short")');
    }
  });

  test("the soft-deprecated `is some(\"…\")` still draws exactly one W-IS-SOME-DEPRECATED, with the validator message", () => {
    const { result } = compileSrc(SRC("is some"));
    const ws = [...(result.errors ?? []), ...(result.warnings ?? [])].filter((d) => d.code === "W-IS-SOME-DEPRECATED");
    expect(ws.length).toBe(1);
    expect(ws[0].message).toContain("validator `is some`");
  });

  test("runtime: a `.NotSome` error resolves to the inline message registered for `is given`", () => {
    const api = new Function(assembleRuntime(new Set(RUNTIME_CHUNK_ORDER)) + `
      return { messageFor: _scrml_message_for, registerInline: _scrml_messages_register_inline };
    `)();
    api.registerInline("signup.nick", "is given", "need nick");
    expect(api.messageFor({ tag: "NotSome" }, "nick", "signup.nick")).toBe("need nick");
  });
});
