/**
 * S97 — rule= value swallowed trailing boolean attribute
 *
 * `<Playing rule=.Idle history>` (rule= followed by a boolean attribute
 * like `history`) pre-fix tokenized the rule value as `.Idle history` —
 * the boolean attribute got absorbed into the rule's captured text.
 * Error path:
 *   E-ENGINE-RULE-INVALID-VARIANT: rule= value `.Idle history` is not
 *   one of the §51.0.F forms (.X / (.A|.B) / *)
 *
 * Workaround was to place `history` BEFORE `rule=`, but per HTML
 * attribute semantics order shouldn't matter.
 *
 * Root cause: engine-statechild-parser.ts:1297 (and 1273 for
 * `internal:rule=`) used a lookahead `(?=\s+\w+\s*=|\s*\/?\s*$)` that
 * only recognized `attr=value` style attrs or tag close as boundaries.
 * Boolean attrs (no `=`) weren't recognized, so the rule-value
 * non-greedy `(.+?)` had to expand to the next attr= or end-of-string —
 * swallowing the boolean attr.
 *
 * Fix: extended both lookaheads to recognize boolean-attr boundaries.
 * New lookahead `(?=\s+\w+(?:\s*=|\s|>|\/|$)|\s*\/?\s*$)` stops at
 * `\s+\w+` followed by `=`, whitespace, `>`, `/`, or end-of-string.
 * Per §51.0.F rule values are limited to `.X`, `*`, or `(...)` and
 * never contain a bare word at depth 0, so the new boundary check
 * doesn't false-trigger.
 *
 * SPEC authority: §51.0.F (rule= target forms); §51.0.N (`history`
 * bare attribute on composite state-children).
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import fs from "fs";
import path from "path";
import os from "os";

function compileSrcToTmp(src, basename = "rule-boundary-test") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-bnd-"));
  const srcPath = path.join(tmpDir, `${basename}.scrml`);
  fs.writeFileSync(srcPath, src);
  try {
    const result = compileScrml({
      inputFiles: [srcPath],
      write: true,
      outputDir: tmpDir,
    });
    return {
      result,
      client: fs.existsSync(path.join(tmpDir, `${basename}.client.js`))
        ? fs.readFileSync(path.join(tmpDir, `${basename}.client.js`), "utf-8")
        : null,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("§1 — rule= value bounded by trailing boolean attr", () => {
  test("§1.1 rule=.X history (history attr AFTER rule=) parses cleanly", () => {
    const src = `type Outer:enum = { Idle, Playing }
type Inner:enum = { Slow, Fast }

<program>
    <engine for=Outer initial=.Idle>
        <Idle rule=.Playing/>
        <Playing rule=.Idle history>
            <engine for=Inner initial=.Slow>
                <Slow rule=.Fast/>
                <Fast rule=.Slow/>
            </>
        </>
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    // Pre-fix: E-ENGINE-RULE-INVALID-VARIANT fired on `.Idle history`
    const errs = (result.errors ?? []).map((e) => e.code);
    expect(errs).not.toContain("E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs).not.toContain("E-HISTORY-NO-INNER-ENGINE");
    expect(() => new Function(client)).not.toThrow();
  });

  test("§1.2 history attr BEFORE rule= still works (regression guard)", () => {
    const src = `type Outer:enum = { Idle, Playing }
type Inner:enum = { Slow, Fast }

<program>
    <engine for=Outer initial=.Idle>
        <Idle rule=.Playing/>
        <Playing history rule=.Idle>
            <engine for=Inner initial=.Slow>
                <Slow rule=.Fast/>
                <Fast rule=.Slow/>
            </>
        </>
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    const errs = (result.errors ?? []).map((e) => e.code);
    expect(errs).not.toContain("E-ENGINE-RULE-INVALID-VARIANT");
    expect(() => new Function(client)).not.toThrow();
  });
});

describe("§2 — regression: pre-existing rule= forms unchanged", () => {
  test("§2.1 rule=.X self-close still parses", () => {
    const src = `type Mode:enum = { A, B }

<program>
    <engine for=Mode initial=.A>
        <A rule=.B/>
        <B rule=.A/>
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    const errs = (result.errors ?? []).map((e) => e.code);
    expect(errs).not.toContain("E-ENGINE-RULE-INVALID-VARIANT");
  });

  test("§2.2 rule=(.A | .B) multi with internal whitespace still parses", () => {
    const src = `type Mode:enum = { A, B, C, D }

<program>
    <engine for=Mode initial=.A>
        <A rule=(.B | .C | .D)/>
        <B rule=.A/>
        <C rule=.A/>
        <D rule=.A/>
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    const errs = (result.errors ?? []).map((e) => e.code);
    expect(errs).not.toContain("E-ENGINE-RULE-INVALID-VARIANT");
  });

  test("§2.3 rule=* wildcard still parses", () => {
    const src = `type Mode:enum = { A, B }

<program>
    <engine for=Mode initial=.A>
        <A rule=*/>
        <B rule=.A/>
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    const errs = (result.errors ?? []).map((e) => e.code);
    expect(errs).not.toContain("E-ENGINE-RULE-INVALID-VARIANT");
  });

  test("§2.4 rule= followed by another attr= (effect=) still parses", () => {
    const src = `type Mode:enum = { A, B }

<program>
    ${"$"}{
        function onTrans() { }
    }
    <engine for=Mode initial=.A>
        <A rule=.B effect=${"$"}{ onTrans() }/>
        <B rule=.A/>
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    const errs = (result.errors ?? []).map((e) => e.code);
    expect(errs).not.toContain("E-ENGINE-RULE-INVALID-VARIANT");
  });
});

describe("§3 — internal:rule= variant gets the same fix", () => {
  test("§3.1 internal:rule=.X history (boolean attr after internal:rule=)", () => {
    const src = `type Outer:enum = { Idle, Playing }
type Inner:enum = { Slow, Fast }

<program>
    <engine for=Outer initial=.Idle>
        <Idle rule=.Playing/>
        <Playing internal:rule=.Idle history>
            <engine for=Inner initial=.Slow>
                <Slow rule=.Fast/>
                <Fast rule=.Slow/>
            </>
        </>
    </>
</program>`;
    const { result, client } = compileSrcToTmp(src);
    expect(client).not.toBeNull();
    const errs = (result.errors ?? []).map((e) => e.code);
    expect(errs).not.toContain("E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs).not.toContain("E-INTERNAL-RULE-NOT-COMPOSITE");
  });
});
