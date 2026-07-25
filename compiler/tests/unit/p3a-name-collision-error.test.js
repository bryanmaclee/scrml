/**
 * P3.A — E-CHANNEL-008: cross-file `name=` collision (NEW).
 *
 * Per P3 deep-dive OQ-P3-6 = (a).
 *
 * Two cross-file channel imports from DIFFERENT source files that share
 * the same `name=` attribute are a hard error. Mirrors the existing
 * E-CHANNEL-003 (same-file duplicate channel name) extended to the
 * cross-file case.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "p3a-collision-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(rel, src) {
  const abs = join(TMP, rel);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, src);
  return abs;
}

describe("P3.A — E-CHANNEL-008 (cross-file name= collision)", () => {
  test("two source files export channels with the same name; consumer imports both → E-CHANNEL-008", () => {
    fx("a/x.scrml", `export <channel name="chat">
  ${"$"}{ <messages> = [] }
</>
`);
    fx("a/y.scrml", `export <channel name="chat">
  ${"$"}{ <messages> = [] }
</>
`);
    const consumer = fx("a/consumer.scrml", `<program>
${"$"}{
  import { chat as ChatX } from './x.scrml'
  import { chat as ChatY } from './y.scrml'
}
<ChatX/>
<ChatY/>
</program>
`);

    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: join(TMP, "a-out"),
      write: false,
      log: () => {},
    });
    const collision = (result.errors ?? []).find(e => e.code === "E-CHANNEL-008");
    expect(collision).toBeDefined();
    expect(collision.message).toMatch(/chat/);
    expect(collision.message).toMatch(/x\.scrml|y\.scrml/);
  });

  test("two aliases for the SAME imported channel — NOT a collision", () => {
    fx("b/channels.scrml", `export <channel name="chat">
  ${"$"}{ <messages> = [] }
</>
`);
    const consumer = fx("b/consumer.scrml", `<program>
${"$"}{
  import { chat } from './channels.scrml'
  import { chat as alsoChat } from './channels.scrml'
}
<chat/>
<alsoChat/>
</program>
`);

    const result = compileScrml({
      inputFiles: [consumer],
      outputDir: join(TMP, "b-out"),
      write: false,
      log: () => {},
    });
    // No E-CHANNEL-008 — both aliases reference the SAME source file's channel.
    const collision = (result.errors ?? []).find(e => e.code === "E-CHANNEL-008");
    expect(collision).toBeUndefined();
  });
});
