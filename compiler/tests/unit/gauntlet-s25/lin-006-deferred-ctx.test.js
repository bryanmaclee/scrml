/**
 * S25 gauntlet — §35.5 E-LIN-006: lin consumed inside a deferred markup body.
 *
 * `<request>` (§6.7.7) and `<poll>` (§6.7.6) bodies execute on a deferred
 * schedule: after mount, or on interval, or when reactive deps change. The
 * compiler cannot statically prove that a lin declared outside such a body
 * is consumed exactly once — the body may execute zero or many times. So
 * consumption of an outer-declared lin inside a `<request>` or `<poll>`
 * body is E-LIN-006.
 *
 * Narrow interpretation adopted in S25: E-LIN-006 applies ONLY to the two
 * markup scheduling contexts. Closures (arrow / function expressions) are
 * still governed by §35.6 — capture is the synchronous consumption event,
 * regardless of where the closure eventually runs. Treating closures also
 * as deferred ctxs would require API-pattern detection (is this `setTimeout`?
 * is this `arr.map`?) which scrml doesn't do.
 *
 * Deep-dive: scrml-support/docs/deep-dives/lin-discontinuous-scoping-2026-04-13.md
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSrc(source, testName = `s25-lin006-${++tmpCounter}`) {
  const tmpDir = resolve(testDir, `_tmp_${testName}`);
  const tmpInput = resolve(tmpDir, `${testName}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    const errors = result.errors ?? [];
    return {
      errors,
      lin006: errors.filter(e => e.code === "E-LIN-006"),
      lin001: errors.filter(e => e.code === "E-LIN-001"),
      lin002: errors.filter(e => e.code === "E-LIN-002"),
    };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("S25 §35.5 — E-LIN-006 deferred-ctx", () => {
  test("lin declared outside <request>, consumed inside → E-LIN-006", () => {
    const src = `<program>
\${
  lin token = "secret"
  @userId = 1
  function authenticate(x) { return x }
}
<request id="profile">
  \${ @userId = authenticate(token) }
</>
</program>
`;
    const { lin006, lin001 } = compileSrc(src);
    expect(lin006.some(e => /\btoken\b/.test(e.message))).toBe(true);
    // The E-LIN-006 suppresses the would-be cascading E-LIN-001.
    expect(lin001).toEqual([]);
  });

  test("lin declared inside <request> body and consumed inside → no error", () => {
    const src = `<program>
\${
  @userId = 1
  function authenticate(x) { return x }
}
<request id="profile">
  \${
    lin token = "secret"
    @userId = authenticate(token)
  }
</>
</program>
`;
    const { lin006 } = compileSrc(src);
    expect(lin006).toEqual([]);
  });

  test("lin declared outside <poll>, consumed inside → E-LIN-006", () => {
    const src = `<program>
\${
  lin key = "k"
  @ticks = 0
  function addTick(k) { return @ticks + 1 }
}
<poll id="ticker" interval=1000>
  \${ @ticks = addTick(key) }
</>
</program>
`;
    const { lin006 } = compileSrc(src);
    expect(lin006.some(e => e.message.includes("<poll>") && /\bkey\b/.test(e.message))).toBe(true);
  });

  test("error message names the markup ctx", () => {
    const src = `<program>
\${
  lin nonce = "n"
  @userId = 1
  function auth(n) { return n }
}
<request id="profile">
  \${ @userId = auth(nonce) }
</>
</program>
`;
    const { lin006 } = compileSrc(src);
    expect(lin006.length).toBeGreaterThan(0);
    const msg = lin006[0].message;
    expect(msg).toMatch(/nonce/);
    expect(msg).toMatch(/<request>/);
    expect(msg).toMatch(/declared outside/i);
  });

  test("closure that captures outer lin — §35.6 owns this, no E-LIN-006", () => {
    // The closure capture counts as the one consumption under §35.6.
    // E-LIN-006 does NOT additionally fire; interpretation A preserves
    // §35.6 for closures. A post-capture reference then trips E-LIN-002.
    const src = `<program>
\${
  lin token = "abc"
  let useLater = () => token
  useLater
}
<p>x</>
</program>
`;
    const { lin006 } = compileSrc(src);
    expect(lin006).toEqual([]);
  });

  test("lin declared and consumed entirely outside any deferred ctx → no E-LIN-006", () => {
    const src = `<program>
\${
  lin nonce = "n"
  let ticket = nonce
  console.log(ticket)
}
<p>ok</>
</program>
`;
    const { lin006 } = compileSrc(src);
    expect(lin006).toEqual([]);
  });
});
