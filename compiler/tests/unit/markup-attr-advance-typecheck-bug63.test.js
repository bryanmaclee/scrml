/**
 * markup-attr-advance-typecheck-bug63.test.js — Bug 63 (S156).
 *
 * STATIC TYPE-CHECK gap (NOT codegen — the runtime works). A bare-variant
 * `.advance(.V)` in a markup EVENT-HANDLER ATTRIBUTE
 * (`onclick=@phase.advance(.Bogus)`) was NOT statically variant-checked — a
 * typo'd / invalid variant compiled clean. The same expression in a fn body or
 * `${...}` logic block DID fire E-TYPE-063: the §51.0.G.1 / §14.10 two-plane
 * `inferReactiveSiteBareVariants` check was wired into the bare-expr STATEMENT
 * path only, never the markup-attr handler value.
 *
 * The fix routes markup `on*` handler values (bare `call-ref` form +
 * `${...}` `expr` interpolation form) through the SAME
 * `inferReactiveSiteBareVariants` check in the type-system markup walk.
 *
 * Coverage (all three handler positions + non-regression + message plane):
 *   §1 — plain markup-attr `<button onclick=@phase.advance(.Bogus)>` → E-TYPE-063
 *   §2 — fn-body + markup-attr asymmetry closed (BOTH fire)
 *   §3 — `<each>` Tier-1 per-item handler → E-TYPE-063
 *   §4 — engine state-child body handler → E-TYPE-063
 *   §5 — valid variant (`.Active`) compiles CLEAN (no false positive)
 *   §6 — non-`.advance` handler (plain-cell assign, fn call) unaffected
 *   §7 — message-plane: `accepts=` engine unknown msg → E-ENGINE-MSG-UNKNOWN;
 *        valid msg + valid direct-state variant compile CLEAN
 *   §8 — `${...}` interpolation handler (`onclick=${@phase.advance(.Bogus)}`)
 *        also checked
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";

function compileToDiagnostics(source, suffix = "bug63") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    return { errors: result.errors ?? [], warnings: result.warnings ?? [] };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codes = (errors) => errors.map((e) => e.code);
const msgsFor = (errors, code) =>
  errors.filter((e) => e.code === code).map((e) => e.message);

// ---------------------------------------------------------------------------
// §1 — plain markup-attr `.advance(.Bogus)` fires E-TYPE-063
// ---------------------------------------------------------------------------

describe("bug63 §1 — plain markup-attr .advance(.Bogus) → E-TYPE-063", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<button onclick=@phase.advance(.Bogus)>go</button>
</program>`;

  test("E-TYPE-063 fires naming the bad variant + the enum", () => {
    const { errors } = compileToDiagnostics(src, "bug63-plain");
    expect(codes(errors)).toContain("E-TYPE-063");
    const m = msgsFor(errors, "E-TYPE-063").join("\n");
    expect(m).toContain("`.Bogus`");
    expect(m).toContain("`Phase`");
  });
});

// ---------------------------------------------------------------------------
// §2 — fn-body + markup-attr asymmetry closed (BOTH fire)
// ---------------------------------------------------------------------------

describe("bug63 §2 — fn-body AND markup-attr both fire (asymmetry closed)", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    function go() { @phase.advance(.Bogus2) }
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<button onclick=@phase.advance(.Bogus)>go</button>
</program>`;

  test("TWO E-TYPE-063 — one for the fn-body .Bogus2, one for the markup-attr .Bogus", () => {
    const { errors } = compileToDiagnostics(src, "bug63-asym");
    const typeErrs = errors.filter((e) => e.code === "E-TYPE-063");
    expect(typeErrs.length).toBeGreaterThanOrEqual(2);
    const joined = typeErrs.map((e) => e.message).join("\n");
    expect(joined).toContain("`.Bogus2`");
    expect(joined).toContain("`.Bogus`");
  });
});

// ---------------------------------------------------------------------------
// §3 — <each> Tier-1 per-item handler
// ---------------------------------------------------------------------------

describe("bug63 §3 — <each> per-item handler .advance(.Bogus) → E-TYPE-063", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    <cols>: string[] = ["a", "b"]
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<ul><each in=@cols as col><li onclick=@phase.advance(.Bogus)>${"$"}{col}</li></each></ul>
</program>`;

  test("E-TYPE-063 fires inside the <each> body handler", () => {
    const { errors } = compileToDiagnostics(src, "bug63-each");
    expect(codes(errors)).toContain("E-TYPE-063");
    expect(msgsFor(errors, "E-TYPE-063").join("\n")).toContain("`.Bogus`");
  });
});

// ---------------------------------------------------------------------------
// §4 — engine state-child body handler
// ---------------------------------------------------------------------------

describe("bug63 §4 — engine state-child body handler .advance(.Bogus) → E-TYPE-063", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active><button onclick=@phase.advance(.Bogus)>idle</button></>
    <Active rule=.Idle>"active"</>
</>
</program>`;

  test("E-TYPE-063 fires inside the engine state-child body handler", () => {
    const { errors } = compileToDiagnostics(src, "bug63-statechild");
    expect(codes(errors)).toContain("E-TYPE-063");
    expect(msgsFor(errors, "E-TYPE-063").join("\n")).toContain("`.Bogus`");
  });
});

// ---------------------------------------------------------------------------
// §5 — valid variant compiles CLEAN (no false positive)
// ---------------------------------------------------------------------------

describe("bug63 §5 — valid variant in markup-attr compiles clean", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<button onclick=@phase.advance(.Active)>go</button>
</program>`;

  test("no variant diagnostic for a declared variant", () => {
    const { errors } = compileToDiagnostics(src, "bug63-valid");
    expect(codes(errors)).not.toContain("E-TYPE-063");
    expect(codes(errors)).not.toContain("E-VARIANT-AMBIGUOUS");
    expect(codes(errors)).not.toContain("E-ENGINE-MSG-UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// §6 — non-`.advance` handlers unaffected
// ---------------------------------------------------------------------------

describe("bug63 §6 — non-.advance handlers unaffected", () => {
  const src = `<program>
${"$"}{
    <count>: number = 0
    function bump() { @count = @count + 1 }
}

<button onclick=${"$"}{@count = 5}>plain</button>
<button onclick=bump()>fn</button>
</program>`;

  test("plain-cell assign + fn call produce no variant diagnostics", () => {
    const { errors } = compileToDiagnostics(src, "bug63-nonadvance");
    expect(codes(errors)).not.toContain("E-TYPE-063");
    expect(codes(errors)).not.toContain("E-VARIANT-AMBIGUOUS");
    expect(codes(errors)).not.toContain("E-ENGINE-MSG-UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// §7 — message-plane (accepts= engine)
// ---------------------------------------------------------------------------

describe("bug63 §7 — message-plane markup-attr resolution", () => {
  const bad = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    type Msg:enum = { Go, Stop }
}

<engine for=Phase accepts=Msg initial=.Idle>
    <Idle on=(.Go -> .Active)>"idle"</>
    <Active on=(.Stop -> .Idle)>"active"</>
</>

<button onclick=@phase.advance(.UnknownMsg)>go</button>
</program>`;

  const good = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
    type Msg:enum = { Go, Stop }
}

<engine for=Phase accepts=Msg initial=.Idle>
    <Idle on=(.Go -> .Active)>"idle"</>
    <Active on=(.Stop -> .Idle)>"active"</>
</>

<button onclick=@phase.advance(.Go)>msg-plane</button>
<button onclick=@phase.advance(.Idle)>state-plane</button>
</program>`;

  test("unknown message variant fires E-ENGINE-MSG-UNKNOWN (neither plane)", () => {
    const { errors } = compileToDiagnostics(bad, "bug63-msgbad");
    expect(codes(errors)).toContain("E-ENGINE-MSG-UNKNOWN");
    expect(msgsFor(errors, "E-ENGINE-MSG-UNKNOWN").join("\n")).toContain("`.UnknownMsg`");
  });

  test("valid message variant + valid direct-state variant compile clean", () => {
    const { errors } = compileToDiagnostics(good, "bug63-msggood");
    expect(codes(errors)).not.toContain("E-TYPE-063");
    expect(codes(errors)).not.toContain("E-VARIANT-AMBIGUOUS");
    expect(codes(errors)).not.toContain("E-ENGINE-MSG-UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// §8 — `${...}` interpolation handler is also checked
// ---------------------------------------------------------------------------

describe("bug63 §8 — ${...} interpolation handler .advance(.Bogus) → E-TYPE-063", () => {
  const src = `<program>
${"$"}{
    type Phase:enum = { Idle, Active }
}

<engine for=Phase initial=.Idle>
    <Idle rule=.Active>"idle"</>
    <Active rule=.Idle>"active"</>
</>

<button onclick=${"$"}{@phase.advance(.Bogus)}>go</button>
</program>`;

  test("E-TYPE-063 fires for the interpolation-form handler", () => {
    const { errors } = compileToDiagnostics(src, "bug63-interp");
    expect(codes(errors)).toContain("E-TYPE-063");
    expect(msgsFor(errors, "E-TYPE-063").join("\n")).toContain("`.Bogus`");
  });
});
