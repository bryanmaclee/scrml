#!/usr/bin/env bun
/**
 * type-annotation-census.mjs — measure how much of scrml's type-annotation
 * surface is ENFORCED vs DECORATIVE, BY EXECUTION.
 *
 * change-id: type-annotation-enforcement-census-2026-09-06
 *
 * WHY THIS EXISTS. A diagnostic code appearing in SPEC §34, in a `.ts` file, or
 * in a test is NOT evidence that it fires. This repo has shipped codes with
 * consumers, spec text, and zero producers (E-TILDE-001/002, E-PROGRAM-002,
 * E-UNQUOTED-DISPLAY-TEXT). The only evidence that a check exists is a compile
 * that emits it. So every row below is a program that was actually compiled.
 *
 * METHOD — paired control/violation.
 *
 *   - `control`   — type-CORRECT. Must compile with zero errors. If it does
 *                   not, the fixture's SYNTAX is wrong and the violation result
 *                   is meaningless; the row is marked BROKEN-PROBE and its
 *                   classification is withheld. This is what stops a parse
 *                   error from being misread as enforcement, and a dead
 *                   fixture from being misread as a hole. The first pass of
 *                   this census caught 5 such probes.
 *   - `violation` — MINIMALLY different, type-INCORRECT at exactly one position.
 *
 * Both halves go through `compileScrml()` rather than the CLI, because the CLI
 * collapses warnings to a bare count and prints no codes — a CLI-only probe
 * cannot distinguish WARNED from DECORATIVE.
 *
 * CLASSIFICATION, derived from the observation and never from reading the type
 * checker:
 *
 *   ENFORCED         — violation produces an ERROR the control does not.
 *   RUNTIME-ENFORCED — no compile error, but codegen emits a runtime guard at
 *                      the position (§53.4.3 boundary zone). Verified by
 *                      inspecting the emitted JS, not by assuming. This class
 *                      exists so that a §53 boundary check — which is the
 *                      design working as specified — is not miscounted as a
 *                      hole.
 *   WARNED           — violation produces only a warning/info the control does not.
 *   DECORATIVE       — violation is diagnostically INDISTINGUISHABLE from the
 *                      control AND no runtime guard is emitted. The annotation
 *                      had no effect of any kind.
 *   BROKEN-PROBE     — the control itself errored; classification withheld.
 *
 * SURFACE TAGS. `surface` partitions the rows so the headline fraction answers
 * the actual question ("how much of the ANNOTATION surface is enforced") rather
 * than being diluted by contrast rows:
 *
 *   base       — a base-type annotation position (§7.5 surface). Counted.
 *   refinement — an inline-predicate position (§53 surface). Counted.
 *   contrast   — a non-annotation type-system check, included to prove the
 *                harness can see enforcement when it exists. NOT counted.
 *   by-design  — silence here is correct (`asIs`, §14.7). NOT counted.
 *
 * Run:   bun docs/changes/type-annotation-enforcement-census-2026-09-06/type-annotation-census.mjs
 * Flags: --verbose   print every diagnostic message, not just codes
 *        --only=<id> run a single position (does NOT wipe the fixture set)
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const FIXTURES = join(HERE, 'fixtures');

const { compileScrml } = await import(join(REPO, 'compiler', 'src', 'api.js'));

const L = (...lines) => lines.join('\n') + '\n';

/** Each position: { id, surface, position, spec, control, violation, note? } */
const POSITIONS = [
  // ══════════════════════════════════════════════════════════════════════════
  // BASE-TYPE ANNOTATION SURFACE (§7.5)
  // ══════════════════════════════════════════════════════════════════════════

  // ── fn: the three axes of bryan's twenty lines ────────────────────────────
  {
    id: '01-fn-param-arg',
    surface: 'base',
    position: 'fn parameter — call-site argument type',
    spec: '§7.5.1 pos 3',
    control: L('fn takesNumber(a: number) -> number {', '    return a', '}', 'log(takesNumber(42))'),
    violation: L('fn takesNumber(a: number) -> number {', '    return a', '}', 'log(takesNumber("QQQ"))'),
  },
  {
    id: '02-fn-body-operand',
    surface: 'base',
    position: 'fn body operand — number * string',
    spec: '§7.5.1 pos 5',
    control: L('fn mul(a: number, b: number) -> number {', '    return a * b', '}', 'log(mul(2, 3))'),
    violation: L('fn mul(a: number, b: string) -> number {', '    return a * b', '}', 'log(mul(2, "x"))'),
  },
  {
    id: '03-fn-return',
    surface: 'base',
    position: 'fn declared return type vs returned value',
    spec: '§7.5.1 pos 4',
    control: L('fn answer() -> number {', '    return 42', '}', 'log(answer())'),
    violation: L('fn answer() -> number {', '    return "nope"', '}', 'log(answer())'),
  },

  // ── `function` declaration form — same three axes (§33/§48) ───────────────
  {
    id: '04-function-param-arg',
    surface: 'base',
    position: '`function` parameter — call-site argument type',
    spec: '§7.5.1 pos 3 / §33',
    control: L('${', '    function takesNumber(a: number) -> number {', '        return a', '    }', '    log(takesNumber(42))', '}'),
    violation: L('${', '    function takesNumber(a: number) -> number {', '        return a', '    }', '    log(takesNumber("QQQ"))', '}'),
  },
  {
    id: '05-function-body-operand',
    surface: 'base',
    position: '`function` body operand — number * string',
    spec: '§7.5.1 pos 5 / §33',
    control: L('${', '    function mul(a: number, b: number) -> number {', '        return a * b', '    }', '    log(mul(2, 3))', '}'),
    violation: L('${', '    function mul(a: number, b: string) -> number {', '        return a * b', '    }', '    log(mul(2, "x"))', '}'),
  },
  {
    id: '06-function-return',
    surface: 'base',
    position: '`function` declared return type vs returned value',
    spec: '§7.5.1 pos 4 / §33',
    control: L('${', '    function answer() -> number {', '        return 42', '    }', '    log(answer())', '}'),
    violation: L('${', '    function answer() -> number {', '        return "nope"', '    }', '    log(answer())', '}'),
  },

  // ── state-cell declaration annotation ─────────────────────────────────────
  {
    id: '07-state-decl-number',
    surface: 'base',
    position: 'state-cell annotation `<n>: number`',
    spec: '§7.5.1 pos 2 / §6.1.5',
    control: L('<n>: number = 0', 'log(@n)'),
    violation: L('<n>: number = "not a number"', 'log(@n)'),
  },
  {
    id: '08-state-decl-int',
    surface: 'base',
    position: 'state-cell annotation `<n>: int`',
    spec: '§7.5.1 pos 2 / §6.1.5',
    control: L('<n>: int = 7', 'log(@n)'),
    violation: L('<n>: int = "not an int"', 'log(@n)'),
  },

  // ── annotated let/const — SPEC §7.5.1 position 1, "the ONE checked" ────────
  // The next five rows probe the EDGES of that one checked position. It turns
  // out to be narrower than "annotated declarations are checked".
  {
    id: '09-let-string-literal-to-number',
    surface: 'base',
    position: 'annotated `let` — string literal into `number`',
    spec: '§7.5.1 pos 1',
    control: L('${', '    let x: number = 1', '    log(x)', '}'),
    violation: L('${', '    let x: number = "s"', '    log(x)', '}'),
  },
  {
    id: '10-const-number-literal-to-string',
    surface: 'base',
    position: 'annotated `const` — number literal into `string`',
    spec: '§7.5.1 pos 1',
    control: L('${', '    const x: string = "ok"', '    log(x)', '}'),
    violation: L('${', '    const x: string = 123', '    log(x)', '}'),
  },
  {
    id: '11-let-boolean-literal-to-number',
    surface: 'base',
    position: 'annotated `let` — BOOLEAN literal into `number`',
    spec: '§7.5.1 pos 1',
    note: 'Same shape as 09, boolean instead of string. Asymmetry here means position 1 is not uniformly checked.',
    control: L('${', '    let x: number = 1', '    log(x)', '}'),
    violation: L('${', '    let x: number = true', '    log(x)', '}'),
  },
  {
    id: '12-let-string-literal-to-int',
    surface: 'base',
    position: 'annotated `let` — string literal into `int`',
    spec: '§7.5.1 pos 1 / §14.1.2 (`int` is a built-in)',
    control: L('${', '    let x: int = 1', '    log(x)', '}'),
    violation: L('${', '    let x: int = "s"', '    log(x)', '}'),
  },
  {
    id: '13-let-nonliteral-initializer',
    surface: 'base',
    position: 'annotated `let` — NON-literal initializer of a known wrong type',
    spec: '§7.5.1 pos 1',
    note: 'The callee carries `-> number`, and inference proves it (no W-TYPE-031-UNPROVEN fires). The proven type is still not used for assignability.',
    control: L('${', '    fn src() -> number { return 1 }', '    let x: number = src()', '    log(x)', '}'),
    violation: L('${', '    fn src() -> number { return 1 }', '    let x: string = src()', '    log(x)', '}'),
  },

  // ── composite type positions ──────────────────────────────────────────────
  {
    id: '14-array-element',
    surface: 'base',
    position: 'array element type `string[]`',
    spec: '§7.5 `T[]`',
    control: L('${', '    let xs: string[] = ["a", "b"]', '    log(xs)', '}'),
    violation: L('${', '    let xs: string[] = [1, 2, 3]', '    log(xs)', '}'),
  },
  {
    id: '15-union-member',
    surface: 'base',
    position: 'union type `string | number`',
    spec: '§7.5 unions',
    control: L('${', '    let u: string | number = 5', '    log(u)', '}'),
    violation: L('${', '    let u: string | number = true', '    log(u)', '}'),
  },
  {
    id: '16-struct-field',
    surface: 'base',
    position: 'struct field type at construction',
    spec: '§14.3',
    control: L('${', '    type Point:struct = {', '        n: number,', '        label: string,', '    }', '    let p: Point = { n: 1, label: "ok" }', '    log(p)', '}'),
    violation: L('${', '    type Point:struct = {', '        n: number,', '        label: string,', '    }', '    let p: Point = { n: "not a number", label: "ok" }', '    log(p)', '}'),
  },
  {
    id: '17-enum-payload-type',
    surface: 'base',
    position: 'enum variant payload TYPE at construction',
    spec: '§14.4',
    control: L('${', '    type Note:enum = {', '        Empty |', '        Filled(msg: string)', '    }', '    let a: Note = Note.Filled("hello")', '    log(a)', '}'),
    violation: L('${', '    type Note:enum = {', '        Empty |', '        Filled(msg: string)', '    }', '    let a: Note = Note.Filled(12345)', '    log(a)', '}'),
  },
  {
    id: '18-map-value-type',
    surface: 'base',
    position: 'map VALUE type `[string: number]`',
    spec: '§59.2',
    control: L('<m>: [string: number] = ["a": 1]', 'log(@m)'),
    violation: L('<m>: [string: number] = ["a": "not a number"]', 'log(@m)'),
  },
  {
    id: '19-map-key-type',
    surface: 'base',
    position: 'map KEY type `[string: number]`',
    spec: '§59.2 / §59.4',
    control: L('<m>: [string: number] = ["a": 1]', 'log(@m)'),
    violation: L('<m>: [string: number] = [99: 1]', 'log(@m)'),
  },
  {
    id: '20-component-prop-type',
    surface: 'base',
    position: 'component prop declared type',
    spec: '§15.3 / §15.10',
    control: L('<program>', '${', '    const Badge = <div props={ count: number }>', '        <span>${count}</>', '    </>', '}', '<Badge count={7} />', '</program>'),
    violation: L('<program>', '${', '    const Badge = <div props={ count: number }>', '        <span>${count}</>', '    </>', '}', '<Badge count={"not a number"} />', '</program>'),
  },
  {
    id: '21-snippet-arity',
    surface: 'base',
    position: 'snippet `render` call-site arity',
    spec: '§14.9 / E-TYPE-072',
    control: L('<program>', '${', '    const Row = <div props={ label: string, deco: snippet(t: string) }>', '        <span>${label}</>', '        ${render deco(label)}', '    </>', '}', '<Row label="hi" deco={ (t) => <em>${t}</em> } />', '</program>'),
    violation: L('<program>', '${', '    const Row = <div props={ label: string, deco: snippet(t: string) }>', '        <span>${label}</>', '        ${render deco()}', '    </>', '}', '<Row label="hi" deco={ (t) => <em>${t}</em> } />', '</program>'),
  },
  {
    id: '22-schema-column-type',
    surface: 'base',
    position: 'schema column type vs inserted value (§39 typed-column DSL)',
    spec: '§39.4',
    note: 'Uses the real §39.2 column-declaration DSL, not a raw CREATE TABLE, so the declared `integer` type is genuinely in the compiler\'s hands.',
    control: L(
      '<program db="./census.db">',
      '<schema>',
      '    nums {',
      '        id:  integer primary key',
      '        qty: integer not null',
      '    }',
      '</>',
      '${',
      '    server function addRow() {',
      '        return ?{`INSERT INTO nums (qty) VALUES (5)`}',
      '    }',
      '}',
      '<div>ok</>',
      '</program>',
    ),
    violation: L(
      '<program db="./census.db">',
      '<schema>',
      '    nums {',
      '        id:  integer primary key',
      '        qty: integer not null',
      '    }',
      '</>',
      '${',
      '    server function addRow() {',
      "        return ?{`INSERT INTO nums (qty) VALUES ('not an integer')`}",
      '    }',
      '}',
      '<div>ok</>',
      '</program>',
    ),
  },
  {
    id: '23-fn-call-arity',
    surface: 'base',
    position: 'fn call-site ARITY (too few arguments)',
    spec: '§33',
    control: L('fn two(a: number, b: number) -> number {', '    return a + b', '}', 'log(two(1, 2))'),
    violation: L('fn two(a: number, b: number) -> number {', '    return a + b', '}', 'log(two(1))'),
  },

  // ── absence / optionality annotations (§42, §17.6) ────────────────────────
  {
    id: '24-optional-deref-state-cell',
    surface: 'base',
    position: 'unguarded member access — `T?` REACTIVE CELL receiver',
    spec: '§42.3.5 / E-TYPE-046',
    control: L('${', '    type User:struct = {', '        name: string', '    }', '}', '<u>: User? = not', '${', '    log(@u?.name)', '}'),
    violation: L('${', '    type User:struct = {', '        name: string', '    }', '}', '<u>: User? = not', '${', '    log(@u.name)', '}'),
  },
  {
    id: '25-optional-deref-let',
    surface: 'base',
    position: 'unguarded member access — `T?` LOCAL `let` receiver',
    spec: '§42.3.5 / E-TYPE-046',
    note: 'SPEC says E-TYPE-046 applies to "any receiver whose type admits not". This row tests a non-cell receiver.',
    control: L('${', '    type User:struct = {', '        name: string', '    }', '    let u: User? = not', '    log(u?.name)', '}'),
    violation: L('${', '    type User:struct = {', '        name: string', '    }', '    let u: User? = not', '    log(u.name)', '}'),
  },
  {
    id: '26-optional-deref-fn-param',
    surface: 'base',
    position: 'unguarded member access — `T?` FN PARAMETER receiver',
    spec: '§42.3.5 / E-TYPE-046',
    control: L('${', '    type User:struct = {', '        name: string', '    }', '    fn f(u: User?) -> string {', '        if (u is not) { return "none" }', '        return u.name', '    }', '    log(f(not))', '}'),
    violation: L('${', '    type User:struct = {', '        name: string', '    }', '    fn f(u: User?) -> string {', '        return u.name', '    }', '    log(f(not))', '}'),
  },
  {
    id: '27-return-not-from-nonoptional',
    surface: 'base',
    position: '`return not` from a non-optional declared return type',
    spec: '§17.6 / E-TYPE-043',
    control: L('${', '    fn f() -> string | not {', '        return not', '    }', '    log(f())', '}'),
    violation: L('${', '    fn f() -> string {', '        return not', '    }', '    log(f())', '}'),
  },
  {
    id: '28-struct-access-on-nonstruct',
    surface: 'base',
    position: 'struct field access on a non-struct typed value',
    spec: '§14.3 / E-TYPE-004',
    control: L('<n>: number = 1', '${', '    log(@n)', '}'),
    violation: L('<n>: number = 1', '${', '    log(@n.notAField)', '}'),
  },
  {
    id: '29-lifecycle-not-to-T',
    surface: 'base',
    position: 'lifecycle `(not to T)` pre-transition read',
    spec: '§14.12.6.1 / E-TYPE-001',
    control: L('${', '    type User:struct = {', '        name: string,', '    }', '    fn loadUser() -> (not to User) {', '        return not', '    }', '    fn useIt() -> string {', '        const u = loadUser()', '        if (u is not) { return "absent" }', '        return u.name', '    }', '    log(useIt())', '}'),
    violation: L('${', '    type User:struct = {', '        name: string,', '    }', '    fn loadUser() -> (not to User) {', '        return not', '    }', '    fn useIt() -> string {', '        const u = loadUser()', '        return u.name', '    }', '    log(useIt())', '}'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // REFINEMENT / INLINE-PREDICATE SURFACE (§53)
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: '30-refine-let-static',
    surface: 'refinement',
    position: 'refinement on `let` — static zone, numeric literal',
    spec: '§53.4.2',
    control: L('${', '    let x: number(>0) = 5', '    log(x)', '}'),
    violation: L('${', '    let x: number(>0) = -5', '    log(x)', '}'),
  },
  {
    id: '31-refine-let-named-shape',
    surface: 'refinement',
    position: 'refinement on `let` — named shape `string(email)`',
    spec: '§53.4.2',
    control: L('${', '    let e: string(email) = "user@example.com"', '    log(e)', '}'),
    violation: L('${', '    let e: string(email) = "definitely not an email"', '    log(e)', '}'),
  },
  {
    id: '32-refine-state-cell',
    surface: 'refinement',
    position: 'refinement on a state-cell declaration',
    spec: '§53.3.3',
    note: 'Contrast with row 07: the BARE annotation at this same position is unchecked, the PREDICATED one is a compile error.',
    control: L('<amt>: number(>0 && <10000) = 5', 'log(@amt)'),
    violation: L('<amt>: number(>0 && <10000) = -5', 'log(@amt)'),
  },
  {
    id: '33-refine-fn-param',
    surface: 'refinement',
    position: 'refinement on a fn PARAMETER (boundary zone)',
    spec: '§53.4.3',
    note: 'Contrast with row 01: the BARE annotation at this same position emits nothing; the PREDICATED one emits a runtime guard.',
    control: L('${', '    fn charge(amount: number(>0 && <10000)) -> number {', '        return amount', '    }', '    log(charge(50))', '}'),
    violation: L('${', '    fn charge(amount: number(>0 && <10000)) -> number {', '        return amount', '    }', '    log(charge(-50))', '}'),
  },
  {
    id: '34-refine-fn-return',
    surface: 'refinement',
    position: 'refinement on a fn RETURN type (boundary zone)',
    spec: '§53.4.3',
    control: L('${', '    fn f() -> number(>0) {', '        return 1', '    }', '    log(f())', '}'),
    violation: L('${', '    fn f() -> number(>0) {', '        return -1', '    }', '    log(f())', '}'),
  },
  {
    id: '35-refine-local-boundary',
    surface: 'refinement',
    position: 'refinement on a local from an unconstrained source (boundary zone)',
    spec: '§53.4.3',
    control: L('${', '    fn process(raw: number) -> number {', '        let amount: number(>0 && <10000) = raw', '        return amount', '    }', '    log(process(50))', '}'),
    violation: L('${', '    fn process(raw: number) -> number {', '        let amount: number(>0 && <10000) = raw', '        return amount', '    }', '    log(process(-50))', '}'),
  },
  {
    id: '36-refine-struct-field',
    surface: 'refinement',
    position: 'refinement on a STRUCT FIELD',
    spec: '§53.3.3 / §14.3',
    control: L('${', '    type Order:struct = {', '        qty: number(>0)', '    }', '    let o: Order = { qty: 3 }', '    log(o)', '}'),
    violation: L('${', '    type Order:struct = {', '        qty: number(>0)', '    }', '    let o: Order = { qty: -3 }', '    log(o)', '}'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CONTRAST — non-annotation type-system checks. Not counted in the headline;
  // present to prove the harness SEES enforcement when it exists.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: '37-enum-payload-arity',
    surface: 'contrast',
    position: 'enum variant payload ARITY at construction',
    spec: 'E-TYPE-082',
    control: L('${', '    type Note:enum = {', '        Empty |', '        Filled(msg: string)', '    }', '    let a: Note = Note.Filled("hello")', '    log(a)', '}'),
    violation: L('${', '    type Note:enum = {', '        Empty |', '        Filled(msg: string)', '    }', '    let a: Note = Note.Filled("hello", "extra")', '    log(a)', '}'),
  },
  {
    id: '38-match-exhaustiveness',
    surface: 'contrast',
    position: 'match exhaustiveness over an enum',
    spec: 'E-TYPE-020',
    control: L('${', '    type Color:enum = { Red | Green | Blue }', '    fn name(c: Color) -> string {', '        return match c {', '            .Red :> "r"', '            .Green :> "g"', '            .Blue :> "b"', '        }', '    }', '    log(name(Color.Red))', '}'),
    violation: L('${', '    type Color:enum = { Red | Green | Blue }', '    fn name(c: Color) -> string {', '        return match c {', '            .Red :> "r"', '            .Green :> "g"', '        }', '    }', '    log(name(Color.Red))', '}'),
  },
  {
    id: '39-duplicate-match-arm',
    surface: 'contrast',
    position: 'duplicate match arm for one variant',
    spec: 'E-TYPE-023',
    control: L('${', '    type Color:enum = { Red | Green }', '    fn f(c: Color) -> string {', '        return match c {', '            .Red :> "a"', '            .Green :> "c"', '        }', '    }', '    log(f(Color.Red))', '}'),
    violation: L('${', '    type Color:enum = { Red | Green }', '    fn f(c: Color) -> string {', '        return match c {', '            .Red :> "a"', '            .Red :> "b"', '            .Green :> "c"', '        }', '    }', '    log(f(Color.Red))', '}'),
  },
  {
    id: '40-unknown-type-name',
    surface: 'contrast',
    position: 'unrecognized type NAME in an annotation',
    spec: 'E-TYPE-UNKNOWN-NAME',
    control: L('fn f(a: number) -> number {', '    return a', '}', 'log(f(1))'),
    violation: L('fn f(a: Frobnicate) -> number {', '    return 1', '}', 'log(f(1))'),
  },
  {
    id: '41-any-forbidden',
    surface: 'contrast',
    position: 'the literal `any` type token',
    spec: 'E-TYPE-ANY-FORBIDDEN',
    control: L('fn f(a: asIs) -> number {', '    return 1', '}', 'log(f(1))'),
    violation: L('fn f(a: any) -> number {', '    return 1', '}', 'log(f(1))'),
  },
  {
    id: '42-unknown-variant-bare-on-cell',
    surface: 'contrast',
    position: 'unknown BARE variant `.X` in `is`, state-cell receiver',
    spec: 'E-TYPE-063',
    note: 'A fn-parameter receiver cannot host this probe: the bare `.Red` in the CONTROL fails to resolve (E-VARIANT-AMBIGUOUS) because a `fn` param annotation does not feed bare-variant inference. That is itself a measurement — see row 45.',
    control: L('${', '    type Color:enum = { Red | Green }', '}', '<c>: Color = Color.Red', '${', '    log(@c is .Red)', '}'),
    violation: L('${', '    type Color:enum = { Red | Green }', '}', '<c>: Color = Color.Red', '${', '    log(@c is .Purple)', '}'),
  },
  {
    id: '45-unknown-variant-qualified',
    surface: 'contrast',
    position: 'unknown QUALIFIED variant `Enum.X`',
    spec: 'E-TYPE-063 / §14.5',
    note: 'Same typo as row 42, written qualified instead of bare. The bare form on a cell is caught; the qualified form is not caught anywhere tested.',
    control: L('${', '    type Color:enum = { Red | Green }', '    fn f(c: Color) -> boolean {', '        return c is Color.Red', '    }', '    log(f(Color.Red))', '}'),
    violation: L('${', '    type Color:enum = { Red | Green }', '    fn f(c: Color) -> boolean {', '        return c is Color.Purple', '    }', '    log(f(Color.Red))', '}'),
  },
  {
    id: '46-bare-variant-on-annotated-param',
    surface: 'contrast',
    position: 'bare variant `.X` resolved via a fn PARAMETER annotation',
    spec: '§14.10 bare-variant inference',
    note: 'The control is type-correct scrml. It fails because the `c: Color` parameter annotation is not consulted when resolving the bare variant.',
    control: L('${', '    type Color:enum = { Red | Green }', '    fn f(c: Color) -> boolean {', '        return c is .Red', '    }', '    log(f(Color.Red))', '}'),
    violation: L('${', '    type Color:enum = { Red | Green }', '    fn f(c: Color) -> boolean {', '        return c is .Purple', '    }', '    log(f(Color.Red))', '}'),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BY DESIGN — silence here is CORRECT. Not counted in the headline.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: '43-asis-hatch',
    surface: 'by-design',
    position: '`asIs` escape hatch — silence is the specified behaviour',
    spec: '§14.7',
    note: 'Both halves silent. asIs is a signed, greppable opt-out, NOT a hole. Establishing this is what keeps it out of the decorative count.',
    control: L('${', '    let x: asIs = 1', '    log(x)', '}'),
    violation: L('${', '    let x: asIs = "anything at all"', '    log(x)', '}'),
  },
  {
    id: '44-unproven-inference',
    surface: 'by-design',
    position: 'un-annotated `let`, defeated inference — W-TYPE-031-UNPROVEN',
    spec: '§7.5.2',
    note: 'Not a violation pair. `control` calls an ANNOTATED fn (inference succeeds, silence is correct); `violation` calls an UN-annotated one (inference defeated, the warning is the specified behaviour). This is the third state between enforced and decorative.',
    control: L('${', '    fn src() -> number { return 1 }', '    let v = src()', '    log(v)', '}'),
    violation: L('${', '    fn src() { return 1 }', '    let v = src()', '    log(v)', '}'),
  },
];

// ── runner ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const ONLY = (argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);

const RUNTIME_GUARD_MARKER = 'E-CONTRACT-001-RT';

function codesOf(result) {
  const grab = (arr) => (arr || []).map((d) => d.code || d.rule || '(uncoded)');
  return {
    errors: grab(result.errors),
    warnings: grab(result.warnings),
    lints: grab(result.lintDiagnostics),
  };
}

function messagesOf(result) {
  const grab = (arr, kind) =>
    (arr || []).map((d) => `      [${kind}] ${d.code || d.rule || '(uncoded)'}: ${(d.message || '').split('\n')[0]}`);
  return [...grab(result.errors, 'E'), ...grab(result.warnings, 'W'), ...grab(result.lintDiagnostics, 'L')];
}

/**
 * Did codegen emit a runtime guard at this position? Read from the emitted JS,
 * not inferred. `compileScrml` returns `outputs` even with `write: false`.
 */
function hasRuntimeGuard(result) {
  const outs = result.outputs;
  if (!outs || typeof outs.values !== 'function') return false;
  for (const o of outs.values()) {
    for (const k of ['clientJs', 'serverJs', 'libraryJs']) {
      if (o && typeof o[k] === 'string' && o[k].includes(RUNTIME_GUARD_MARKER)) return true;
    }
  }
  return false;
}

function compileOne(file) {
  try {
    return { ok: true, result: compileScrml({ inputFiles: [file], write: false }) };
  } catch (err) {
    return {
      ok: false,
      result: { errors: [{ code: '(threw)', message: String(err && err.message) }], warnings: [], lintDiagnostics: [] },
    };
  }
}

/** Multiset difference — codes the violation has that the control does not. */
function newCodes(controlCodes, violationCodes) {
  const pool = [...controlCodes];
  const out = [];
  for (const c of violationCodes) {
    const i = pool.indexOf(c);
    if (i >= 0) pool.splice(i, 1);
    else out.push(c);
  }
  return out;
}

function classify(ctl, vio, vioGuard) {
  if (ctl.errors.length > 0) return { cls: 'BROKEN-PROBE', codes: ctl.errors };
  const newErr = newCodes(ctl.errors, vio.errors);
  if (newErr.length > 0) return { cls: 'ENFORCED', codes: newErr };
  if (vioGuard) return { cls: 'RUNTIME-ENFORCED', codes: [RUNTIME_GUARD_MARKER + ' guard in emitted JS'] };
  const newWarn = newCodes([...ctl.warnings, ...ctl.lints], [...vio.warnings, ...vio.lints]);
  if (newWarn.length > 0) return { cls: 'WARNED', codes: newWarn };
  return { cls: 'DECORATIVE', codes: [] };
}

// `--only` must not delete the committed fixture set for the other positions.
if (!ONLY) rmSync(FIXTURES, { recursive: true, force: true });
mkdirSync(FIXTURES, { recursive: true });

const rows = [];
for (const p of ONLY ? POSITIONS.filter((x) => x.id === ONLY) : POSITIONS) {
  const ctlFile = join(FIXTURES, `${p.id}.control.scrml`);
  const vioFile = join(FIXTURES, `${p.id}.violation.scrml`);
  writeFileSync(ctlFile, p.control);
  writeFileSync(vioFile, p.violation);

  const ctlRun = compileOne(ctlFile);
  const vioRun = compileOne(vioFile);
  const ctl = codesOf(ctlRun.result);
  const vio = codesOf(vioRun.result);
  const verdict = classify(ctl, vio, hasRuntimeGuard(vioRun.result));

  rows.push({ ...p, ctl, vio, verdict, ctlRun, vioRun });
}

// ── report ──────────────────────────────────────────────────────────────────

const W_ID = Math.max(...rows.map((r) => r.id.length), 2);
const W_POS = Math.max(...rows.map((r) => r.position.length), 8);
const W_SUR = 10;

console.log('');
console.log('scrml type-annotation enforcement census — EVERY ROW VERIFIED BY EXECUTION');
console.log(`fixtures: ${FIXTURES}`);
console.log('');
console.log(`| ${'id'.padEnd(W_ID)} | ${'surface'.padEnd(W_SUR)} | ${'position'.padEnd(W_POS)} | ${'verdict'.padEnd(16)} | code(s) the violation fired`);
console.log(`|${'-'.repeat(W_ID + 2)}|${'-'.repeat(W_SUR + 2)}|${'-'.repeat(W_POS + 2)}|${'-'.repeat(18)}|${'-'.repeat(36)}`);

for (const r of rows) {
  const codes = r.verdict.codes.length ? r.verdict.codes.join(', ') : '(none — compiles clean)';
  console.log(`| ${r.id.padEnd(W_ID)} | ${r.surface.padEnd(W_SUR)} | ${r.position.padEnd(W_POS)} | ${r.verdict.cls.padEnd(16)} | ${codes}`);
  if (VERBOSE) {
    console.log('    control:');
    const cm = messagesOf(r.ctlRun.result);
    console.log(cm.length ? cm.join('\n') : '      (clean)');
    console.log('    violation:');
    const vm = messagesOf(r.vioRun.result);
    console.log(vm.length ? vm.join('\n') : '      (clean)');
  }
}

const CLASSES = ['ENFORCED', 'RUNTIME-ENFORCED', 'WARNED', 'DECORATIVE', 'BROKEN-PROBE'];
const tallyFor = (pred) =>
  rows.filter(pred).reduce((acc, r) => {
    acc[r.verdict.cls] = (acc[r.verdict.cls] || 0) + 1;
    return acc;
  }, {});

function printTally(label, pred) {
  const t = tallyFor(pred);
  const n = rows.filter(pred).length;
  if (!n) return;
  console.log(`\n── ${label} (${n} positions) ──`);
  for (const k of CLASSES) if (t[k]) console.log(`  ${k.padEnd(17)} ${t[k]}`);
}

const isCounted = (r) => r.surface === 'base' || r.surface === 'refinement';

printTally('BASE-TYPE annotation surface (§7.5)', (r) => r.surface === 'base');
printTally('REFINEMENT surface (§53)', (r) => r.surface === 'refinement');
printTally('CONTRAST — non-annotation checks (not counted)', (r) => r.surface === 'contrast');
printTally('BY DESIGN (not counted)', (r) => r.surface === 'by-design');

const counted = rows.filter(isCounted);
const t = tallyFor(isCounted);
const enf = (t['ENFORCED'] || 0) + (t['RUNTIME-ENFORCED'] || 0);
console.log(`\n══ HEADLINE — the annotation surface (${counted.length} positions) ══`);
console.log(`  enforced (compile)  ${t['ENFORCED'] || 0}`);
console.log(`  enforced (runtime)  ${t['RUNTIME-ENFORCED'] || 0}`);
console.log(`  warned              ${t['WARNED'] || 0}`);
console.log(`  DECORATIVE          ${t['DECORATIVE'] || 0}`);
console.log(`  broken probe        ${t['BROKEN-PROBE'] || 0}`);
console.log(`  ──`);
console.log(`  ENFORCED FRACTION   ${enf}/${counted.length}  (${((enf / counted.length) * 100).toFixed(0)}%)`);
console.log('');

const broken = rows.filter((r) => r.verdict.cls === 'BROKEN-PROBE');
if (broken.length) {
  console.log('BROKEN PROBES — the CONTROL errored, so the violation result is not interpretable:');
  for (const r of broken) {
    for (const d of r.ctlRun.result.errors) console.log(`  ${r.id}  ${d.code}: ${(d.message || '').split('\n')[0]}`);
  }
  console.log('');
}
