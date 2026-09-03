/**
 * g-bare-expr-in-if-arm-rebinds-tilde-context.test.js — CODEGEN-SHAPE gate for
 * the S395 ruling on if-as-expression arm bodies (SPEC §17.6.2, with the §32.2
 * arm-body carve-out the same ruling added).
 * change-id: s395-tilde-arm-body.
 *
 * THE RULING (bryan, user-voice S395, limb (a)): §17.6.2 governs an
 * if-as-expression arm body, and it is SPECIFIC over §32.2's general accumulator
 * rule. A bare expression statement inside an arm is a SIDE EFFECT — it does not
 * initialize `~`, does not rebind the tilde context, and does not touch the arm's
 * result. Only a `lift`, or the §17.6.10 single-expression sugar, designates the
 * result value.
 *
 * PRE-FIX (g-bare-expr-in-if-arm-rebinds-tilde-context-corrupting-the-result-var,
 * HIGH silent-wrong — exit 0, ZERO diagnostics):
 *
 *   let _scrml_tilde_4 = null;
 *   if (…) {
 *     let _scrml_tilde_5 = _scrml_note_2("a");  // fresh mint AND rebind
 *     _scrml_tilde_5 = "pos";                   // the `lift` wrote the WRONG var
 *   } else {
 *     _scrml_tilde_5 = "neg";                   // NOT IN SCOPE here
 *   }
 *   const label = _scrml_tilde_4;               // ALWAYS null
 *
 * Two defects in one shape: the binding is always `null`, AND the else limb
 * assigns a name block-scoped to the THEN branch. The emitted artifact is a
 * CLASSIC script (no `"use strict"`, no `type="module"`), so that second one is a
 * silent implicit global rather than a ReferenceError — which is why this file
 * asserts scope containment explicitly and not just the result value.
 *
 * The observable-behaviour twin lives in
 * conformance/cases/control-flow/ctrl-025-arm-body-statement-is-side-effect-pos
 * and ctrl-026-arm-body-nested-value-form-decl-pos. §17.6.8 grants the compiler
 * latitude over emitted JavaScript, so the conformance cases assert RESULTS; this
 * file is the shape gate that names the specific regression mechanism.
 */
import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

function compileToOutputs(source, suffix) {
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
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Extract the body of one emitted function by name prefix. The emitted names
 * carry a mangling counter (`_scrml_show_3`), so match on the prefix, then slice
 * by BRACE MATCHING to the function's own closing brace.
 *
 * ⚑ A `clientJs.indexOf("\n}")` scan is NOT good enough here and silently
 * truncated an earlier draft of this file: `emitIfExprDecl` emits its `if (…) {`
 * / `}` / `else {` / `}` at column 0 inside the function, so the first `\n}`
 * closes the THEN LIMB, not the function — every else-limb assertion then read a
 * body that stopped before the `else`. Measured, not assumed.
 */
function fnBody(clientJs, scrmlFnName) {
  const re = new RegExp(`function _scrml_${scrmlFnName}_\\d+\\([^)]*\\) \\{`);
  const m = re.exec(clientJs);
  if (!m) return "";
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < clientJs.length; i++) {
    const c = clientJs[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return clientJs.slice(start, i);
    }
  }
  return clientJs.slice(start);
}

/**
 * The load-bearing structural assertion. In a correct emit EVERY tilde var the
 * arm bodies touch is the one the enclosing declaration reads, so a function body
 * that lowers a single if-as-expression mentions EXACTLY ONE `_scrml_tilde_N`
 * name. The pre-fix emit mentioned two: the outer (declared, never written) and
 * the inner (written by both limbs, block-scoped to the first).
 */
function tildeNames(body) {
  return [...new Set(body.match(/_scrml_tilde_\d+/g) ?? [])];
}

/**
 * Slice the brace-matched block that follows the first match of `opener`.
 * Used to ask "what did the compiler put INSIDE this loop?" — a question a flat
 * string search over the whole function body cannot answer, because the escaped
 * name is textually present either way. Returns "" when the opener is absent.
 */
function blockAfter(body, opener) {
  const m = opener.exec(body);
  if (!m) return "";
  const start = m.index + m[0].length;
  let depth = 1;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i);
    }
  }
  return body.slice(start);
}

/**
 * EXECUTE an emitted function body with the runtime calls stubbed, and return
 * whatever it returns.
 *
 * ⚑ Why this exists rather than one more string assertion: a `let` referenced
 * from OUTSIDE its block is syntactically valid JavaScript. `--validate-emit`
 * parses it happily, `node --check` passes it, and every `toContain` assertion
 * that does not happen to name the escaped variable passes too. Scope is the only
 * thing that catches it, and running the code is the cheapest way to consult
 * scope. The escaped read throws `ReferenceError` in sloppy AND strict mode (only
 * an undeclared ASSIGNMENT is tolerated in sloppy mode), so this is a faithful
 * probe of the shipped classic-script artifact even though it runs under strict.
 */
/**
 * Execute a nested2()-shaped body with a WRITABLE cell, and return BOTH observables:
 * the arm's result and the final cell value.
 *
 * ⚑ Two observables, deliberately. The fix-round HIGH returned the RIGHT label with
 * a silently WRONG cell write, so a harness that reports only the return value would
 * have called that emit correct.
 */
function runNested2(body, initial = 5) {
  const src = `
    "use strict";
    let CELL = ${JSON.stringify(initial)};
    const _scrml_cs_reactive_get = () => CELL;
    const _scrml_cs_reactive_set = (k, v) => { CELL = v; };
    const _scrml_reactive_get = () => CELL;
    const _scrml_reactive_set = (k, v) => { CELL = v; };
    ${[...new Set(body.match(/_scrml_step1_\d+/g) ?? [])].map((n) => `function ${n}(v) { return v + 1; }`).join("\n")}
    ${[...new Set(body.match(/_scrml_step2_\d+/g) ?? [])].map((n) => `function ${n}(v) { return v * 2; }`).join("\n")}
    ${body}
  `;
  const label = new Function(src)();
  const cell = new Function(src.replace(/\n\s*return label;/, "\n  return CELL;"))();
  return { label, cell };
}

function runEmittedBody(body, cellValue = 5) {
  const stubs = [...new Set(body.match(/_scrml_(?:note|record|step1)_\d+/g) ?? [])]
    .map((n) => `function ${n}(v) { return v; }`)
    .join("\n");
  return new Function(`
    "use strict";
    const _scrml_cs_reactive_get = () => ${JSON.stringify(cellValue)};
    const _scrml_reactive_get = () => ${JSON.stringify(cellValue)};
    ${stubs}
    ${body}
  `)();
}

describe("§17.6.2 (S395) — a bare statement in an if-as-expression arm is a side effect", () => {
  test("then-arm statement + `lift`: the call is a plain statement and the lift writes the OUTER result var", () => {
    const src = `<n>: int = 5
function note(s: string) { let _ = s }
function show() {
    const label = if (@n > 0) { note("a") lift "pos" } else { lift "neg" }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-then-lift");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    expect(body).not.toBe("");

    // Exactly one tilde var — the arm result var. Two means the pre-fix shape.
    const names = tildeNames(body);
    expect(names).toHaveLength(1);
    const resultVar = names[0];

    // The side effect is a PLAIN statement: no `let <fresh> = note("a")`.
    expect(body).toMatch(/^\s*_scrml_note_\d+\("a"\);$/m);
    expect(body).not.toMatch(/let _scrml_tilde_\d+ = _scrml_note_\d+\("a"\);/);

    // Both limbs designate through the SAME (outer, in-scope) variable.
    expect(body).toContain(`${resultVar} = "pos";`);
    expect(body).toContain(`${resultVar} = "neg";`);
    expect(body).toContain(`const label = ${resultVar};`);

    // And that variable is declared at the top of the function, OUTSIDE both
    // limbs — the containment check that catches the implicit-global defect.
    expect(body.indexOf(`let ${resultVar} = null;`)).toBeLessThan(body.indexOf("if ("));
  });

  test("else-arm statement + `lift`: the else limb is fixed too, not just the then limb", () => {
    const src = `<n>: int = 5
function note(s: string) { let _ = s }
function show() {
    const label = if (@n < 0) { lift "pos" } else { note("b") lift "neg" }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-else-lift");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    const names = tildeNames(body);
    expect(names).toHaveLength(1);
    expect(body).toMatch(/^\s*_scrml_note_\d+\("b"\);$/m);
    expect(body).toContain(`${names[0]} = "neg";`);
  });

  test("statement + `lift` against a §17.6.10 SUGAR else — both forms write the same var", () => {
    const src = `<n>: int = 5
function note(s: string) { let _ = s }
function show() {
    const label = if (@n > 0) { note("c") lift "pos" } else { "neg" }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-sugar-else");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    const names = tildeNames(body);
    expect(names).toHaveLength(1);
    expect(body).toContain(`${names[0]} = "pos";`);
    expect(body).toContain(`${names[0]} = "neg";`);
  });

  test("`else if` cascade — every limb's statement is a side effect and every limb designates the same var", () => {
    const src = `<n>: int = 5
function note(s: string) { let _ = s }
function show() {
    const label = if (@n > 8) { note("hi") lift "hi" } else if (@n > 3) { note("mid") lift "mid" } else { note("lo") lift "lo" }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-cascade");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    const names = tildeNames(body);
    expect(names).toHaveLength(1);
    for (const v of ["hi", "mid", "lo"]) {
      expect(body).toMatch(new RegExp(`^\\s*_scrml_note_\\d+\\("${v}"\\);$`, "m"));
      expect(body).toContain(`${names[0]} = "${v}";`);
    }
  });

  test("MULTIPLE leading statements — each is a plain statement, none mints a tilde var", () => {
    const src = `<n>: int = 5
function note(s: string) { let _ = s }
function show() {
    const label = if (@n > 0) {
        note("x")
        note("y")
        note("z")
        lift "pos"
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-multi");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    expect(tildeNames(body)).toHaveLength(1);
    for (const v of ["x", "y", "z"]) {
      expect(body).toMatch(new RegExp(`^\\s*_scrml_note_\\d+\\("${v}"\\);$`, "m"));
    }
  });

  test("a nested value-form DECLARATION in an arm does not repoint the enclosing arm's result var", () => {
    // The same silent-wrong pair one nesting level down, through a DIFFERENT
    // site: the parent-context propagation tail shared by emitIfExprDecl /
    // emitForExprDecl / emitMatchExprDecl. Pre-fix, the outer `lift` emitted
    // `<INNER> = inner;` and the outer `else` emitted `<INNER> = "neg";`.
    const src = `<n>: int = 5
function show() {
    const label = if (@n > 0) {
        const inner = if (@n > 3) { lift "deep" } else { lift "shallow" }
        lift inner
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-nested-decl");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    // Two tilde vars here is CORRECT — the outer arm result and the nested
    // declaration's own result. What matters is which one each limb writes.
    const names = tildeNames(body);
    expect(names).toHaveLength(2);
    const outer = names[0];
    const inner = names[1];
    expect(body.indexOf(`let ${outer} = null;`)).toBeLessThan(body.indexOf(`let ${inner} = null;`));

    // The nested declaration reads the INNER var; the outer limbs write the OUTER one.
    expect(body).toContain(`const inner = ${inner};`);
    expect(body).toContain(`${outer} = inner;`);
    expect(body).toContain(`${outer} = "neg";`);
    expect(body).not.toContain(`${inner} = inner;`);
    expect(body).not.toContain(`${inner} = "neg";`);
    expect(body).toContain(`const label = ${outer};`);
  });

  test("a `~` READ inside an arm does NOT reach the enclosing context — BOUNDARY PIN (unruled)", () => {
    // ⚑ THIS PINS A BOUNDARY. IT DOES NOT ENDORSE ONE.
    //
    // S395 shipped the opposite: an in-arm `~` read resolving to the enclosing
    // accumulator. S397 REVERTED that half, because making the read reach outward
    // required `nodeContainsTildeRef` to descend into `ifExpr`/`forExpr`/`matchExpr`
    // — and that predicate does not merely ANSWER a question, it GATES WHETHER A
    // `tildeContext` IS ALLOCATED over the whole enclosing statement sequence
    // (`emitFnShortcutBody`, `emitLogicBody`). Flipping it true therefore switched
    // unrelated SIBLING statements into §32.2 accumulator mode. The measured
    // consequence is the `while` regression test immediately below.
    //
    // ⚠ THE ORPHANING IS CONDITIONAL ON THIS BODY, NOT UNIVERSAL. `show()` has no
    // other `~`, so no enclosing slot is allocated and the in-arm read reaches
    // nothing. Add a `~` anywhere else in the same body and the read DOES reach
    // the enclosing accumulator — the sibling test
    // "an in-arm `~` read DOES reach the enclosing slot…" pins that half. Read the
    // two together; neither alone states the rule.
    //
    // §32.2.1's read clause is Nominal / spec-ahead; the arm-body `~` scope
    // boundary is banked as dpa-040. When it is ruled, THIS TEST IS EXPECTED TO
    // CHANGE — it is written so that the change is loud instead of silent.
    //
    // ⚑ Deliberately NOT `test.failing`: that form passes when the body fails for
    // ANY reason and would mask an unrelated break. This asserts the CURRENT emit
    // positively, so a shift in either direction fails it.
    const src = `<n>: int = 5
function step1(v: int) { return v + 1 }
function record(v: int) { let _ = v }
function show() {
    step1(2)
    const label = if (@n > 0) {
        record(~)
        lift "ok"
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-tilde-read");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");

    // (1) The enclosing statement stays a PLAIN statement. No accumulator is
    // minted for it, because the `~` inside the arm does not activate the
    // enclosing tilde scope. This is the reverted behaviour, asserted directly.
    expect(body).toMatch(/^\s*_scrml_step1_\d+\(2\);/m);
    expect(body).not.toMatch(/let _scrml_tilde_\d+ = _scrml_step1_\d+\(2\);/);

    // (2) The in-arm read therefore lowers to the ORPHAN FALLBACK. That fallback
    // is explicit in the emitted text — a reader of the output can see that `~`
    // resolved to nothing rather than silently reading a stale slot.
    expect(body).toMatch(/_scrml_record_\d+\(null \/\* ~ orphaned/);

    // (3) THE WRITE HALF IS UNAFFECTED AND MUST STAY FIXED. Exactly one tilde
    // name, seeded before the `if`, assigned by BOTH limbs, and read by the
    // declaration — no second var, so no block-scope escape.
    const names = tildeNames(body);
    expect(names).toHaveLength(1);
    const resultVar = names[0];
    expect(body).toContain(`let ${resultVar} = null;`);
    expect(body).toContain(`${resultVar} = "ok";`);
    expect(body).toContain(`${resultVar} = "neg";`);
    expect(body).toContain(`const label = ${resultVar};`);
  });

  test("REGRESSION: an in-arm `~` must not drag a SIBLING loop into accumulator mode", () => {
    // ⚑ THIS IS THE TEST THAT WOULD HAVE CAUGHT THE S395 READ HALF, AND IT IS THE
    // REASON THAT HALF WAS REVERTED RATHER THAN PATCHED.
    //
    // With `nodeContainsTildeRef` descending into `ifExpr`, a `~` appearing ONLY
    // inside the arm made the WHOLE function body a tilde scope. Measured emit at
    // the S395 tip:
    //
    //   let _scrml_tilde_4 = [];                       // DEAD — nothing reads it
    //   while (i < 3) {
    //     let _scrml_tilde_5 = _scrml_note_2(i);       // minted INSIDE the block
    //     i = i + 1;
    //   }
    //   let _scrml_tilde_6 = null;
    //   if (…) {
    //     _scrml_note_2(_scrml_tilde_5);               // ← READ FROM OUTSIDE ITS BLOCK
    //     _scrml_tilde_6 = "pos";
    //   } …
    //
    // `ReferenceError: _scrml_tilde_5 is not defined` at run time, from a compile
    // that exits 0 with zero diagnostics. It is syntactically VALID JavaScript, so
    // `--validate-emit` / `node --check` cannot see it — only scope can, which is
    // why this test asserts scope containment AND executes the result.
    const src = `<n>: int = 5
function note(v: int) { let _ = v }
function whileCase() {
    let i = 0
    while (i < 3) {
        note(i)
        i = i + 1
    }
    const label = if (@n > 0) {
        note(~)
        lift "pos"
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${whileCase()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-tilde-while-escape");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "whileCase");

    // (1) NO tilde var is minted inside the loop, so nothing can escape it.
    const whileBlock = blockAfter(body, /while \([^)]*\) \{/);
    expect(whileBlock).not.toBe("");
    expect(tildeNames(whileBlock)).toEqual([]);

    // (2) NO dead accumulator before the loop. The `let _scrml_tilde_N = [];` that
    // `_emitWhileStmtWithTilde` mints is an allocation nothing ever reads.
    expect(body).not.toMatch(/let _scrml_tilde_\d+ = \[\];/);

    // (3) Exactly ONE tilde name in the whole body — the arm's result var. Two
    // names is the signature of this defect class in both its forms.
    const names = tildeNames(body);
    expect(names).toHaveLength(1);
    const resultVar = names[0];
    expect(body).toContain(`let ${resultVar} = null;`);
    expect(body).toContain(`${resultVar} = "pos";`);
    expect(body).toContain(`${resultVar} = "neg";`);
    expect(body).toContain(`const label = ${resultVar};`);

    // (4) EXECUTED, not inferred. A scope escape is invisible to a parse gate and
    // to every string assertion that does not happen to name the escaped var, so
    // the emitted body is actually run. The S395 emit throws here; this one
    // returns the value the ruling says the arm designates.
    expect(runEmittedBody(body)).toBe("pos");
  });

  test("a bindless `!{}` recovery in an arm does not steal the arm's result var", () => {
    // FIX-ROUND gate (S239 finding 1) — the SIXTH repoint site of this class and
    // the one the first pass missed. Ordinary adopter code: a failable call with
    // `!{}` recovery inside an arm. Pre-fix the guarded-expr's result var was
    // assigned by BOTH limbs and the binding stayed null.
    const src = `<n>: int = 5
<phase>: string = "idle"
type LoadError:enum = {
    NotFound(id: string)
}
function load(id: string)! LoadError {
    if (id == "missing") fail LoadError.NotFound(id)
    return id
}
function show() {
    const label = if (@n > 0) {
        load("ok") !{
            | .NotFound(mid) :> @phase = mid
        }
        lift "found"
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-guarded-expr");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    const resultDecl = /let (_scrml_tilde_\d+) = null;/.exec(body);
    expect(resultDecl).not.toBeNull();
    const resultVar = resultDecl[1];

    // Both limbs designate through the arm's OWN result var.
    expect(body).toContain(`${resultVar} = "found";`);
    expect(body).toContain(`${resultVar} = "neg";`);
    expect(body).toContain(`const label = ${resultVar};`);
    // The guarded-expr's own result var must never be the designation target.
    const guardVar = /let (_scrml__scrml_result_\d+) = _scrml_load_\d+\("ok"\);/.exec(body);
    expect(guardVar).not.toBeNull();
    expect(body).not.toContain(`${guardVar[1]} = "found";`);
    expect(body).not.toContain(`${guardVar[1]} = "neg";`);
  });

  test("a LOOP inside an arm keeps failing LOUD — it must never become a silent last-writer-wins value", () => {
    // ROUND-3 gate (S239 finding 4). Round 2 minted a dead `let _t = [];` and
    // repointed the read slot, so the loop's lifts stopped being pushes and became
    // last-writer-wins assignments: `label` silently became 3 instead of a list,
    // at exit 0 with zero diagnostics. Base crashed loudly on the §17.6.4 `null`
    // seed. On this project trading a loud error for a silent wrong is strictly
    // worse, so this gate pins the LOUDNESS, not a value.
    const src = `<n>: int = 5
function show() {
    const xs = [1, 2, 3]
    const label = if (@n > 0) {
        for (i of xs) {
            lift i
        }
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-loop-loud");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    const resultVar = /let (_scrml_tilde_\d+) = null;/.exec(body)[1];

    // The loop ACCUMULATES into the arm's result var — array mode wins over
    // liftVar, so this is `.push` on the null seed: the same loud TypeError base
    // produced. A bare `<resultVar> = i;` here would be the silent regression.
    expect(body).toMatch(new RegExp(`${resultVar}\\.push\\(i\\);`));
    expect(body).not.toMatch(new RegExp(`^\\s*${resultVar} = i;`, "m"));
    // No dead accumulator allocation.
    expect(body).not.toMatch(/let _scrml_tilde_\d+ = \[\];/);
  });

  test("the carve-out is SCOPED to if-as-expression arms — a for-COMPREHENSION body is UNCHANGED", () => {
    // ROUND-4 scope gate. §32.2.1 carves out §17.6.2 if-as-expression ARM BODIES.
    // It does not mention comprehension bodies, and the S395 ruling was about arm
    // bodies. Whether a bare statement in a comprehension body initializes `~` is a
    // semantic question NO RULING COVERS.
    //
    // An earlier pass applied the carve-out here anyway. It was wrong twice: it
    // decided an unruled semantic by implementation, AND it traded a LOUD failure
    // for a SILENT one — `for (i of xs) { step1(i) lift step2(~) }` went from
    // `_t8.push(...)` on a NUMBER (TypeError) to pushing `step2(null)`, i.e.
    // `[0,0,0]` at exit 0.
    //
    // This gate pins the SCOPE BOUNDARY, so re-widening it has to be a deliberate
    // act with a ruling behind it rather than a quiet side effect of a later fix.
    const src = `function step1(v: int) { return v + 1 }
function step2(v: int) { return v * 2 }
function show() {
    const xs = [1, 2, 3]
    const out = for (i of xs) {
        step1(i)
        lift step2(~)
    }
    return out
}
<p id="e">\${show()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "comprehension-scope");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "show");
    // §32.2 STILL APPLIES in a comprehension body: the bare statement mints an
    // accumulator var and `~` resolves to it. This is the pre-S395 behaviour and it
    // is deliberately preserved.
    const minted = /let (_scrml_tilde_\d+) = _scrml_step1_\d+\(i\);/.exec(body);
    expect(minted).not.toBeNull();
    expect(body).toMatch(new RegExp(`_scrml_step2_\\d+\\(${minted[1]}\\)`));
    // The carve-out's fingerprints must NOT appear here.
    expect(body).not.toContain("~ orphaned");
    expect(body).not.toMatch(/^\s*_scrml_step1_\d+\(i\);$/m);
  });

  test("the carve-out is scoped to DIRECT children — a nested block inside an arm keeps its own `~`", () => {
    // ⚑ REGRESSION GATE FOR THE FIX-ROUND HIGH. `armBody` lives on a SHARED
    // MUTABLE context object, so it propagates into every nested block unless
    // something stops it (`_descendOutOfArmBody`). §32.2.1 scopes the carve-out to
    // a statement appearing "DIRECTLY INSIDE" an arm body — one level, not the
    // whole subtree.
    //
    // Before the fix this over-applied the sentence the SPEC change itself wrote:
    // the mint was suppressed two levels down too, so the nested block's `~` read
    // orphaned and `@n` was silently assigned `step2(null)` === 0. Base got that
    // read RIGHT while getting the arm's result wrong, so the un-fixed version was
    // a TRADE between two silent-wrongs, not a fix.
    //
    // This test goes RED if `armBody` is ever re-widened to transitive.
    const src = `<n>: int = 5
function step1(v: int) { return v + 1 }
function step2(v: int) { return v * 2 }
function nested2() {
    const label = if (@n > 0) {
        if (@n > 3) {
            step1(2)
            @n = step2(~)
        }
        lift "ok"
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${nested2()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-nested-block");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "nested2");

    // (1) The NESTED block runs ordinary §32.2: the bare statement mints, and the
    // `~` read in the same block resolves to that mint — NOT to the orphan fallback.
    const armBlock = blockAfter(body, /if \(.*?\) \{/);
    expect(armBlock).not.toBe("");
    const innerBlock = blockAfter(armBlock, /if \(.*?\) \{/);
    expect(innerBlock).not.toBe("");
    const mint = /let (_scrml_tilde_\d+) = _scrml_step1_\d+\(2\);/.exec(innerBlock);
    expect(mint).not.toBeNull();
    expect(innerBlock).toContain(`_scrml_step2_`);
    expect(innerBlock).toMatch(new RegExp(`_scrml_step2_\\d+\\(${mint[1]}\\)`));
    expect(body).not.toContain("~ orphaned");

    // (2) The nested mint STAYS IN ITS BLOCK. The nested context is a FRESH object,
    // so a rebind cannot escape to the arm level — that would re-open the very
    // block-scope-escape class this arc closed.
    const armResult = /let (_scrml_tilde_\d+) = null;/.exec(body)[1];
    expect(armResult).not.toBe(mint[1]);
    expect(body).toContain(`${armResult} = "ok";`);
    expect(body).toContain(`${armResult} = "neg";`);
    expect(body).toContain(`const label = ${armResult};`);

    // (3) EXECUTED — both observables at once. The un-fixed version returned the
    // right label with a silently wrong cell write, which no label-only assertion
    // can see.
    const out = runNested2(body);
    expect(out.label).toBe("ok");
    expect(out.cell).toBe(6); // step2(step1(2)) === (2+1)*2
  });

  test("an in-arm `~` read DOES reach the enclosing slot when the enclosing body has its own `~`", () => {
    // ⚑ THE READ HALF IS *CONDITIONALLY* IMPLEMENTED, AND THIS TEST IS THE HONEST
    // RECORD OF THE CONDITION. The sibling test above pins the orphan case; do not
    // read either one as "the read half is simply off".
    //
    // `nodeContainsTildeRef` decides whether the ENCLOSING sequence gets a `~` slot
    // at all, and since S397 it does not descend into a bound value-form's arms. So:
    //   · only `~` is inside the arm  -> no slot allocated -> the read ORPHANS;
    //   · some OTHER statement in the same sequence mentions `~` -> a slot exists,
    //     `emitIfExprDecl` inherits it, and the in-arm read REACHES it — which is
    //     what §32.2.1's read clause actually mandates.
    //
    // Here `return step2(~) + label` supplies that independent `~`. Base got this
    // WRONG (it read the arm's own null-seeded result var), so this is a fix, and it
    // is safe because the enclosing mint sits in the SAME block as the `if` — the
    // dangerous version is a mint inside a NESTED block, which is what the reverted
    // S395 widening reached for.
    const src = `<n>: int = 5
function note(v: int) { let _ = v }
function step1(v: int) { return v + 1 }
function step2(v: int) { return v * 2 }
export function f2() {
    step1(2)
    const label = if (@n > 0) {
        note(~)
        lift 7
    } else {
        lift 0
    }
    return step2(~) + label
}
<p id="e">\${f2()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "arm-tilde-read-reaches");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "f2");

    // The enclosing statement mints, because the SIBLING `return` mentions `~`.
    const enclosing = /let (_scrml_tilde_\d+) = _scrml_step1_\d+\(2\);/.exec(body);
    expect(enclosing).not.toBeNull();

    // The in-arm read resolves to THAT slot — not to the orphan fallback, and not
    // to the arm's own result var.
    expect(body).toMatch(new RegExp(`_scrml_note_\\d+\\(${enclosing[1]}\\);`));
    expect(body).not.toContain("~ orphaned");

    const armResult = /let (_scrml_tilde_\d+) = null;/.exec(body)[1];
    expect(armResult).not.toBe(enclosing[1]);
    expect(body).toContain(`${armResult} = 7;`);
    expect(body).toContain(`${armResult} = 0;`);

    // The enclosing mint is at the SAME block depth as the `if`, so naming it from
    // inside the arm is in-scope. That containment is what makes the reach safe.
    expect(blockAfter(body, /if \(.*?\) \{/)).not.toContain(`let ${enclosing[1]}`);
  });

  // ── THE ROOT GATE ───────────────────────────────────────────────────────────
  // ⚑ TABLE-DRIVEN ON PURPOSE. Three consecutive review rounds each found the SAME
  // defect in a block-opening construct the previous round had not enumerated:
  //   R1 -> a nested `if`;  R2 -> a `given` guard;  R3 -> `for` and `while` bodies.
  // The per-construct fix (a "strip the flag on descent" helper, called from one
  // site and needing to be called from all of them) is what generated that
  // sequence, so it was DELETED rather than extended. The carve-out is now keyed on
  // STATEMENT IDENTITY (`armBodyStmts`), which is non-propagating by construction:
  // a nested block's children are different objects and fail the test
  // automatically, for every construct that exists and every one added later.
  //
  // ⚠ THE POINT OF THIS TABLE IS THE CONSTRUCTS THE FIX CONTAINS NO CODE FOR.
  // `emit-logic.ts` has no `given`-specific, `for`-specific or `while`-specific
  // carve-out logic whatsoever — they pass because the mechanism generalises. Adding
  // a row here is one line; if a future construct fails it, the mechanism regressed,
  // not the enumeration.
  //
  // ⚑ `resultForm` EXISTS BECAUSE THIS GATE ONCE REPORTED GREEN ON JS THAT CANNOT
  // RUN. The row assertion used to accept `<armResult>(\.push\(|\s=\s)"neg"` —
  // an alternation — so the two LOOP rows passed on `let _t5 = null; … _t5.push("ok")`,
  // which throws `TypeError: null is not an object` on the first call. A gate whose
  // entire purpose is proving the carve-out generalises was green on a function that
  // dies. That is the measure-the-wrong-artifact class this file's own comments warn
  // about, and it is the fourth time this arc has met it.
  //
  // The cause was CONFLATING TWO INDEPENDENT PROPERTIES in one regex. They are now
  // split, and every row asserts something TRUE about itself:
  //
  //   (1) does `~` reach the enclosing accumulator from inside a nested block?
  //       -> what `armBodyStmts` fixed. TRUE for all four constructs. Asserted for
  //          all four, and it is what this gate is FOR.
  //   (2) does the arm's result get ASSIGNED rather than `.push`ed?
  //       -> a different property, governed by the `mode` flip, and PRE-EXISTING
  //          BROKEN for loop constructs on base as well as here. Asserted only for
  //          the rows where it holds; PINNED as known-broken for the rows where it
  //          does not.
  //
  // An alternation that accepts either shape asserts NEITHER. Do not reintroduce one.
  const NESTED_BLOCK_CONSTRUCTS = [
    { name: "nested if", open: "if (@n > 3) {", close: "}", resultForm: "assign" },
    { name: "given guard", open: "given g :> {", close: "}", resultForm: "assign" },
    // ⛔ KNOWN-BROKEN, PINNED DELIBERATELY — NOT AN ACCEPTED SHAPE. A loop anywhere in
    // an arm flips the shared context to array mode, so BOTH limbs lower their `lift`
    // to `.push` on the §17.6.4 `null` seed and the function throws at first call.
    // Byte-identical class on base (base pushes onto the ESCAPED loop-local; this
    // pushes onto the in-scope arm result — both throw). Out of scope here: it is the
    // `mode` flip plus bryan's unbuilt loop-in-arm ruling, filed as a gap, NOT this
    // arc's carve-out. Pinned so the day it changes, this row says so out loud.
    { name: "for loop", open: "for (i of [1]) {", close: "}", resultForm: "push-known-broken" },
    { name: "while loop", open: "while (j < 1) {", close: "j = j + 1\n        }", resultForm: "push-known-broken" },
  ];

  for (const c of NESTED_BLOCK_CONSTRUCTS) {
    test(`ROOT: the carve-out does NOT reach inside a ${c.name} in an arm`, () => {
      const src = `<n>: int = 5
function step1(v: int) { return v + 1 }
function step2(v: int) { return v * 2 }
function probe() {
    let j = 0
    let g = 1
    const label = if (@n > 0) {
        ${c.open}
            step1(2)
            @n = step2(~)
        ${c.close}
        lift "ok"
    } else {
        lift "neg"
    }
    return label
}
<p id="e">\${probe()}</>`;
      const { errors, clientJs } = compileToOutputs(src, "root-arm-nested");
      expect(errors.filter((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

      const body = fnBody(clientJs, "probe");

      // (1) §32.2 runs normally INSIDE the nested block: the bare statement mints,
      // and the `~` read in the same block resolves to that mint. The orphan
      // fallback appearing anywhere here is the defect all three rounds found.
      const mint = /let (_scrml_tilde_\d+) = _scrml_step1_\d+\(2\);/.exec(body);
      expect(mint).not.toBeNull();
      expect(body).toMatch(new RegExp(`_scrml_step2_\\d+\\(${mint[1]}\\)`));
      expect(body).not.toContain("~ orphaned");

      // (2) The arm's own result is the write half's var: seeded before the `if`,
      // read by the declaration, and a DIFFERENT name from the nested mint. True for
      // every row regardless of how the limbs write it.
      const armResult = /let (_scrml_tilde_\d+) = null;/.exec(body)[1];
      expect(armResult).not.toBe(mint[1]);
      expect(body).toContain(`const label = ${armResult};`);

      // (3) HOW the limbs write that var — asserted per row, never as an alternation.
      if (c.resultForm === "assign") {
        // Both limbs ASSIGN. This is the shape that actually runs.
        expect(body).toContain(`${armResult} = "ok";`);
        expect(body).toContain(`${armResult} = "neg";`);
        // ...and explicitly NOT the throwing form, so a silent slide into `.push`
        // (e.g. a `mode` leak reaching this construct) fails here.
        expect(body).not.toContain(`${armResult}.push(`);
      } else {
        // ⛔ PINNING KNOWN-BROKEN EMISSION. `${armResult}` is seeded `null` and both
        // limbs call `.push` on it, so `probe()` throws `TypeError` at first call.
        // Asserted EXACTLY, not tolerated: this row must fail if the emission moves
        // in EITHER direction, including if it is silently fixed.
        expect(body).toContain(`let ${armResult} = null;`);
        expect(body).toContain(`${armResult}.push("ok");`);
        expect(body).toContain(`${armResult}.push("neg");`);
        expect(body).not.toContain(`${armResult} = "ok";`);
      }
    });
  }

  test("ROOT: there are NO per-construct carve-out strip sites left in emit-logic.ts", () => {
    // ⚑ ARCHITECTURAL GUARD, NOT A BEHAVIOUR ONE — and it is here because the
    // behaviour tests above CANNOT catch the thing that actually went wrong three
    // times. Every round's fix passed its own tests; what failed was the SHAPE, a
    // flag that propagates by default and is correct only where someone remembered
    // to strip it. This test fails if that shape comes back.
    //
    // If you are adding a legitimate exception, you are probably about to re-open
    // this defect class — read `_isDirectArmBodyStmt` first.
    const src = readFileSync(
      resolve(import.meta.dir, "../../src/codegen/emit-logic.ts"),
      "utf8",
    );
    // ⚑ CODE LINES ONLY. The negative assertions below MUST NOT read comment text:
    // the doc comments deliberately QUOTE the old boolean mechanism to explain why
    // it was removed, and a naive substring check flags that prose as a violation.
    // (It did, on the first run of this very test — which is the same
    // measure-the-wrong-artifact class this arc keeps meeting.) Keeping the history
    // readable is worth the four extra lines.
    const codeLines = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");

    // The carve-out must be keyed on statement IDENTITY...
    expect(src).toContain("armBodyStmts");
    expect(src).toContain("function _isDirectArmBodyStmt");
    // ...and NOT on a propagating boolean that needs stripping on descent.
    expect(codeLines).not.toContain("armBody?: boolean");
    expect(codeLines).not.toContain("armBody: true");
    expect(codeLines).not.toContain("_descendOutOfArmBody");
    // No live guard may read a bare `.armBody` flag any more.
    expect(codeLines).not.toMatch(/\.armBody\b/);
  });

  test("§32.2 is UNCHANGED in an ordinary logic body — a bare statement there still initializes `~`", () => {
    // The carve-out is scoped to an arm body. This is the negative control: the
    // general pipeline lowering must be byte-for-byte the behaviour it always had,
    // otherwise the fix widened past the ruling.
    const src = `function step1(v: int) { return v + 1 }
function step2(v: int) { return v * 2 }
function pipeline() {
    step1(2)
    return step2(~)
}
<p id="e">\${pipeline()}</>`;
    const { errors, clientJs } = compileToOutputs(src, "ordinary-body");
    expect(errors.filter(e => e.code === "E-CODEGEN-INVALID-LOGIC")).toHaveLength(0);

    const body = fnBody(clientJs, "pipeline");
    // The bare statement STILL mints the accumulator var, and `~` still lowers to it.
    expect(body).toMatch(/let (_scrml_tilde_\d+) = _scrml_step1_\d+\(2\);/);
    const minted = /let (_scrml_tilde_\d+) = _scrml_step1_\d+\(2\);/.exec(body)[1];
    expect(body).toMatch(new RegExp(`return _scrml_step2_\\d+\\(${minted}\\);`));
    // No literal `~` leaked into the emitted JS (that would be a bitwise-NOT).
    expect(body).not.toMatch(/[^~]~[^~]/);
  });
});
