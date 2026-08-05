/**
 * each-if-in-each-w409.test.js — the W-IF-IN-EACH build warning (GH adopter
 * issue #409, assetManagement; SPEC §17.1).
 *
 * A per-row `if=` on a NESTED (non-item-root) element inside `<each>` is compiled
 * to a CREATE-TIME append gate — evaluated ONCE when the row is built, never
 * re-run on a same-key reconcile. An item-data-driven condition therefore goes
 * silently stale (the element is never re-added/removed), while the sibling
 * class/text bindings on the same row DO re-evaluate. Before #409 the compiler
 * emitted NO build-time signal for this footgun. This suite pins the warning:
 *
 *   §1 — POSITIVE: a nested per-row `if=` whose condition references the item
 *        (`it.note`, `@.note`) emits W-IF-IN-EACH + a create-time-gate comment.
 *   §2 — NEGATIVE (sole root): a per-row `if=` on the each body's SOLE item root
 *        is REACTIVE (`_scrml_ifrow_apply`) and is NOT warned.
 *   §3 — NEGATIVE (outer state): a nested `if=` whose condition references only
 *        OUTER state re-evaluates through the collection effect and is NOT warned.
 *   §4 — NEGATIVE (top-level): an `if=` outside any `<each>` is reactive and is
 *        NOT warned.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToOutputs(source, suffix = "each-if-w409") {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

const codesOf = (warnings) => warnings.map((w) => w.code || w);

// ---------------------------------------------------------------------------
// §1 — POSITIVE: nested item-referencing per-row if= warns loudly
// ---------------------------------------------------------------------------

const NESTED_ITEM_SRC = `<program>
    <items> = [{ id: 1, note: "" }]
    <each in=@items as it key=@.id>
        <div class="row">
            <div class="via-if" if=(it.note != "")>VIA-IF: \${it.note}</div>
        </div>
    </each>
</program>
`;

describe("W-IF-IN-EACH §1 — nested item-referencing if= warns", () => {
  test("emits the W-IF-IN-EACH warning (not silent)", () => {
    const { warnings } = compileToOutputs(NESTED_ITEM_SRC);
    expect(codesOf(warnings)).toContain("W-IF-IN-EACH");
  });

  test("emits the create-time-gate comment, still emits the bare append gate", () => {
    const { clientJs } = compileToOutputs(NESTED_ITEM_SRC);
    expect(clientJs).toContain("create-time gate, NOT reactive (W-IF-IN-EACH, GH #409)");
    // The append gate itself is unchanged (behaviour-preserving — warning only).
    expect(clientJs).toMatch(/if \(\(it\.note != ""\)\)/);
  });

  test("the contextual-sigil form (@.note) also warns", () => {
    const src = NESTED_ITEM_SRC.replace('if=(it.note != "")', 'if=(@.note != "")');
    const { warnings } = compileToOutputs(src);
    expect(codesOf(warnings)).toContain("W-IF-IN-EACH");
  });
});

// ---------------------------------------------------------------------------
// §2 — NEGATIVE: sole-item-root per-row if= is reactive → no warning
// ---------------------------------------------------------------------------

const SOLE_ROOT_SRC = `<program>
    <items> = [{ id: 1, note: "" }]
    <each in=@items as it key=@.id>
        <div class="soleroot" if=(it.note != "")>SOLE: \${it.note}</div>
    </each>
</program>
`;

describe("W-IF-IN-EACH §2 — sole-item-root if= is reactive (no warning)", () => {
  test("does NOT warn and lowers to the reactive structural swap", () => {
    const { warnings, clientJs, errors } = compileToOutputs(SOLE_ROOT_SRC);
    expect(errors).toEqual([]);
    expect(codesOf(warnings)).not.toContain("W-IF-IN-EACH");
    // Reactive path signature: the element⇄comment swap helper.
    expect(clientJs).toContain("_scrml_ifrow_apply");
  });
});

// ---------------------------------------------------------------------------
// §3 — NEGATIVE: nested if= on OUTER state only → no warning
// ---------------------------------------------------------------------------

const OUTER_STATE_SRC = `<program>
    <items> = [{ id: 1, note: "" }]
    <show> = true
    <each in=@items as it key=@.id>
        <div class="row">
            <span if=@show>OUTER-STATE</span>
        </div>
    </each>
</program>
`;

describe("W-IF-IN-EACH §3 — outer-state-only nested if= (no warning)", () => {
  test("does NOT warn when the condition references only outer state", () => {
    const { warnings } = compileToOutputs(OUTER_STATE_SRC);
    expect(codesOf(warnings)).not.toContain("W-IF-IN-EACH");
  });
});

// ---------------------------------------------------------------------------
// §4 — NEGATIVE: top-level if= (outside <each>) → no warning
// ---------------------------------------------------------------------------

const TOPLEVEL_SRC = `<program>
    <show> = true
    <div if=@show>TOP-LEVEL</div>
</program>
`;

describe("W-IF-IN-EACH §4 — top-level if= (no warning)", () => {
  test("does NOT warn for an if= outside any <each>", () => {
    const { warnings, errors } = compileToOutputs(TOPLEVEL_SRC);
    expect(errors).toEqual([]);
    expect(codesOf(warnings)).not.toContain("W-IF-IN-EACH");
  });
});

// ---------------------------------------------------------------------------
// §5 — NEGATIVE (S239 FP-1): the iter-var name as a WORD inside a string literal
// in an OUTER-state condition must NOT false-fire.
// ---------------------------------------------------------------------------

const FP_ITERVAR_IN_STRING_SRC = `<program>
    <items> = [{ id: 1, note: "" }]
    <label> = "hit"
    <each in=@items as it key=@.id>
        <div class="row">
            <span if=(@label == "it works")>OUTER-ONLY, string contains the word it</span>
        </div>
    </each>
</program>
`;

describe("W-IF-IN-EACH §5 — iter-var word inside a string literal (no warning)", () => {
  test("does NOT warn when 'it' appears only inside a quoted string", () => {
    const { warnings } = compileToOutputs(FP_ITERVAR_IN_STRING_SRC);
    expect(codesOf(warnings)).not.toContain("W-IF-IN-EACH");
  });
});

// ---------------------------------------------------------------------------
// §6 — NEGATIVE (S239 FP-2): an `@.` SUBSTRING inside a string literal in an
// OUTER-state condition must NOT false-fire.
// ---------------------------------------------------------------------------

const FP_ATDOT_IN_STRING_SRC = `<program>
    <items> = [{ id: 1, note: "" }]
    <email> = "z"
    <each in=@items as row key=@.id>
        <div class="row">
            <span if=(@email == "user@.example.com")>OUTER-ONLY, string contains @.</span>
        </div>
    </each>
</program>
`;

describe("W-IF-IN-EACH §6 — @. substring inside a string literal (no warning)", () => {
  test("does NOT warn when @. appears only inside a quoted string", () => {
    const { warnings } = compileToOutputs(FP_ATDOT_IN_STRING_SRC);
    expect(codesOf(warnings)).not.toContain("W-IF-IN-EACH");
  });
});

// ---------------------------------------------------------------------------
// §7 — POSITIVE (S239 FN-3): a `as (k, v)` entry destructure whose nested if=
// references a destructure binding is the SAME footgun and MUST warn (the
// synthetic iter var is invisible to source, so the destructure names are the
// only item handle).
// ---------------------------------------------------------------------------

const FN_DESTRUCTURE_SRC = `type Entry:struct = { key: string, value: number }
<pairs>: Entry[] = [{ key: "DAL", value: 4500 }, { key: "HOU", value: 3200 }]
<ul>
    <each in=@pairs as (k, v)>
        <li class="row">
            <span if=(v > 4000)>HIGH: \${k}</span>
        </li>
    </each>
</ul>
`;

describe("W-IF-IN-EACH §7 — as (k, v) destructure references the item (warns)", () => {
  test("warns when a nested if= references a destructure binding", () => {
    const { warnings } = compileToOutputs(FN_DESTRUCTURE_SRC);
    expect(codesOf(warnings)).toContain("W-IF-IN-EACH");
  });
});
