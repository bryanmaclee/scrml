/**
 * BS-layer corpus-friction bug-batch regression tests (S93+).
 *
 * Each test is a minimal repro for a documented bug in
 * `docs/changes/bs-layer-corpus-friction-bugs/SCOPING.md`. Asserts the
 * canonical v0.3 program-as-container shape compiles cleanly without
 * the `${}` workarounds that the S93 canonical-examples-sweep applied.
 *
 * Bug 1 — markup `//` comments cause E-TYPE-026 downstream  (NOT REPRO; doc test)
 * Bug 2 — `const Name = <markup>` at <program> direct-child level
 * Bug 3 — template-literal `${ident}` inside bare function body
 * Bug 3-adj — `${ident}` in `renders <p>` markup-interpolation inside type-decl
 * Bug 4 — HTML <!-- --> comments inside component-def body
 * Bug 6 — non-entry pure-module file E-IMPORT-001 + W-PROGRAM-001
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

function compileSrc(srcName, src) {
  const TMP = mkdtempSync(join(tmpdir(), "bs-bug-"));
  const path = join(TMP, srcName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, src);
  const result = compileScrml({
    inputFiles: [path],
    outputDir: join(TMP, "out"),
    write: false,
    gather: false,
    log: () => {},
  });
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {}
  return result;
}

function diagCodes(result) {
  const codes = [];
  for (const e of result.errors ?? []) codes.push(e.code);
  for (const w of result.warnings ?? []) codes.push(w.code);
  return codes;
}

// ---------------------------------------------------------------------------
// Bug 1 — markup `//` comments
// ---------------------------------------------------------------------------

describe("Bug 1 — markup-context `//` line comments", () => {
  test("`//` inside <div> markup body does NOT trigger E-TYPE-026 downstream", () => {
    // S05 bisect precedent + canonical-examples-sweep LESSON LEARNED #1:
    // pre-S87 BS-comment-skip, markup-context `//` could cause E-TYPE-026
    // on unrelated downstream identifiers. Post-S87, BS strips `//` as a
    // `comment` block at all levels — including markup body. This test
    // pins the canonical shape so a regression is loud.
    const result = compileSrc("bug1.scrml", `<program>
    <count> = 0
    <name> = ""

    <div>
        // dev comment explaining the markup
        <p>\${@count}</p>
        <span>\${@name}</span>
    </div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-TYPE-026");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });

  test("`//` inside markup with multiple identifiers downstream does NOT consume scope", () => {
    const result = compileSrc("bug1b.scrml", `<program>
    type Step:enum = { Info, Preferences, Confirm }
    <currentStep>: Step = .Info
    <firstName> = ""

    <div>
        // dev comment
        <span class:active=(@currentStep == Step::Info)>1. Info</span>
        <span class:active=(@currentStep == Step::Preferences)>2. Preferences</span>
        <span>\${@firstName}</span>
    </div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-TYPE-026");
    expect(diagCodes(result)).not.toContain("E-SCOPE-001");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — const Name = <markup> at <program> direct-child level
// ---------------------------------------------------------------------------

describe("Bug 2 — `const Name = <markup>` auto-lift at <program> direct-child level", () => {
  test("PascalCase const-decl with markup RHS at <program> body lifts as component-def", () => {
    const result = compileSrc("bug2.scrml", `<program>
    <state> = 0

    const TodoRow = <li class="row" props={ item: string }>
        <span>\${item}</span>
    </>

    <div>
        <TodoRow item="hello"/>
    </div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-COMPONENT-020");
    expect(diagCodes(result)).not.toContain("E-COMPONENT-035");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });

  test("`export const Name = <markup>` Form 2 BS-layer lift fires (export-decl registered)", () => {
    // S93 Bug 2 fix synthesizes `${ export const Name = <markup> }` from the
    // text+markup pair at <program> body. The export-decl is then registered
    // normally. The same-file `<TodoRow ...>` use-site reaching back into
    // an `export const Name = <markup>` is a pre-existing component-resolution
    // limitation that is OUT OF SCOPE for the BS-layer fix — cross-file
    // resolution works (see 22-multifile/components.scrml), but same-file
    // is missing the components-registry registration step for the
    // `export const Name = <markup>` form. Filed for follow-up.
    //
    // This test asserts only what Bug 2 fixes: the BS-layer + lift produces
    // a coherent synthetic logic block (no E-PARSE-* / no E-CTX-* / no
    // unrecognized-statement errors). Component-resolution at the same-file
    // use-site is checked separately.
    const result = compileSrc("bug2b.scrml", `<program>
    <state> = 0

    export const TodoRow = <li class="row" props={ item: string }>
        <span>\${item}</span>
    </>

    <div>hello</div>
</program>
`);
    const fatalCodes = ["E-PARSE-001", "E-PARSE-002", "E-CTX-001", "E-CTX-002", "E-CTX-003", "E-SYNTAX-050"];
    for (const code of fatalCodes) {
      expect(diagCodes(result)).not.toContain(code);
    }
  });

  test("multiple component-defs at <program> direct-child level all lift", () => {
    const result = compileSrc("bug2c.scrml", `<program>
    <state> = 0

    const StepA = <div class="step-a"/>
    const StepB = <div class="step-b"/>
    const StepC = <div class="step-c"/>

    <div>
        <StepA/>
        <StepB/>
        <StepC/>
    </div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-COMPONENT-020");
    expect(diagCodes(result)).not.toContain("E-COMPONENT-035");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });

  test("lowercase `const m = <markup>` is regular const-decl (not component-def)", () => {
    // PascalCase discrimination — the regex only fires for [A-Z] names.
    // Lowercase `const m = <main>...</>` falls through to the existing
    // const-decl path (where the markup raw is the init expression).
    // Asserts no spurious E-COMPONENT-* errors fire on this shape.
    const result = compileSrc("bug2d.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = .Idle

const m = <main>\${@phase}</>

render(m)
`);
    expect(diagCodes(result)).not.toContain("E-COMPONENT-020");
    expect(diagCodes(result)).not.toContain("E-COMPONENT-035");
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — template-literal in bare function body
// ---------------------------------------------------------------------------

describe("Bug 3 — template-literal `${ident}` inside bare function body", () => {
  test("`return `${hh}:${mm}`` inside function at <program> body does NOT fire E-SCOPE-001", () => {
    const result = compileSrc("bug3.scrml", `<program>
    <ts> = 0

    function formatTime(ms) {
        const d = new Date(ms)
        const hh = String(d.getHours()).padStart(2, "0")
        const mm = String(d.getMinutes()).padStart(2, "0")
        return \`\${hh}:\${mm}\`
    }

    <div>\${formatTime(@ts)}</div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-SCOPE-001");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });

  test("multiple template-literals in nested calls stay properly scoped", () => {
    const result = compileSrc("bug3b.scrml", `<program>
    <name> = "world"

    function greet(name) {
        const prefix = "hello"
        const upper = name.toUpperCase()
        return \`\${prefix}, \${upper}!\`
    }

    <div>\${greet(@name)}</div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-SCOPE-001");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bug 3-adj — `${ident}` in renders <p> markup-interpolation
// ---------------------------------------------------------------------------

describe("Bug 3-adj — `${ident}` in `renders <p>` markup inside type-decl", () => {
  test("`renders <p>${email}</>` inside type-decl enum body resolves payload binding", () => {
    const result = compileSrc("bug3adj.scrml", `<program>
    <ts> = 0

    type ContactError:enum = {
        InvalidEmail(email: string)
            renders <p class="text-red-600">\${email} is not valid.</>
        EmptyName
            renders <p class="text-red-600">Name is required.</>
    }

    <div>hello</div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-SCOPE-001");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });

  test("multiple variants with payload-binding interpolations all resolve", () => {
    const result = compileSrc("bug3adj-b.scrml", `<program>
    <ts> = 0

    type ContactError:enum = {
        InvalidEmail(email: string)
            renders <p>\${email} is not valid.</>
        SubmitFailed(reason: string)
            renders <div>Submission failed: \${reason}</>
    }

    <div>hello</div>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-SCOPE-001");
    expect((result.errors ?? []).filter(e => e.severity === "error" || !e.severity)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bug 4 — HTML comments inside component-def body
// ---------------------------------------------------------------------------

describe("Bug 4 — `<!-- -->` comments inside component-def body", () => {
  test("HTML comment inside `${ const Card = <div>...<!-- -->...</> }` does NOT prevent registration", () => {
    const result = compileSrc("bug4.scrml", `<program>
    \${
        const Card = <div class="card" props={ title: string }>
            <!-- This comment should be stripped, not break the component -->
            <h2>\${title}</h2>
        </>
    }

    <Card title="Hello"/>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-COMPONENT-020");
    expect(diagCodes(result)).not.toContain("E-COMPONENT-035");
    expect(diagCodes(result)).not.toContain("E-COMPONENT-021");
  });

  test("multiple comments inside component-def body all stripped cleanly", () => {
    const result = compileSrc("bug4b.scrml", `<program>
    \${
        const Card = <div class="card" props={ title: string }>
            <!-- Comment 1: explaining the header -->
            <h2>\${title}</h2>
            <!-- Comment 2: explaining the body -->
            <p>Body content</p>
        </>
    }

    <Card title="Hello"/>
</program>
`);
    expect(diagCodes(result)).not.toContain("E-COMPONENT-020");
    expect(diagCodes(result)).not.toContain("E-COMPONENT-035");
  });
});

// ---------------------------------------------------------------------------
// Bug 6 — non-entry pure-module file
// ---------------------------------------------------------------------------

describe("Bug 6 — non-entry pure-module file diagnostics", () => {
  test("bare `export type` at file-top no longer fires E-IMPORT-001 (Bug 6A)", () => {
    const result = compileSrc("types.scrml", `export type UserRole:enum = {
  Admin
  Moderator
  Member
  Guest
}
`);
    expect(diagCodes(result)).not.toContain("E-IMPORT-001");
  });

  test("bare `export function` at file-top no longer fires E-IMPORT-001 (Bug 6A)", () => {
    const result = compileSrc("utils.scrml", `export function badgeColor(role: string) -> string {
  return "red"
}
`);
    expect(diagCodes(result)).not.toContain("E-IMPORT-001");
  });

  test("bare `export const Name = <markup>` at file-top no longer fires E-IMPORT-001 (Bug 6A)", () => {
    const result = compileSrc("components.scrml", `import { UserRole } from './types.scrml'

export const UserBadge = <span class="badge" props={ name: string, role: UserRole }>
  <span class="badge-name">\${name}</span>
  <span class="badge-role">\${role}</span>
</>
`);
    expect(diagCodes(result)).not.toContain("E-IMPORT-001");
  });

  test("pure-module file (no markup, only exports) does NOT fire W-PROGRAM-001 (Bug 6B)", () => {
    const result = compileSrc("types.scrml", `export type UserRole:enum = {
  Admin
  Moderator
}

export function badgeColor(role: UserRole) -> string {
  return "red"
}
`);
    expect(diagCodes(result)).not.toContain("W-PROGRAM-001");
  });

  test("mixed-content file (no program, but has bare markup) STILL fires W-PROGRAM-001 (Bug 6B inverse)", () => {
    // The Bug 6B fix is conservative — it only suppresses W-PROGRAM-001
    // when there's NO top-level markup. A file with bare `<div>` and no
    // <program> wrapper is malformed (the markup needs a container).
    const result = compileSrc("mixed.scrml", `<div>content</>
`);
    expect(diagCodes(result)).toContain("W-PROGRAM-001");
  });

  test("non-entry file with imports + exports + types + functions compiles clean", () => {
    // Canonical S85 Q2 + SPEC §21.5 pure-module shape — the full mix.
    const result = compileSrc("module.scrml", `import { something } from './other.scrml'

export type Foo:enum = { A, B }

export function helper(x: Foo) -> string {
  return "result"
}

export const PI = 3.14159
`);
    expect(diagCodes(result)).not.toContain("E-IMPORT-001");
    expect(diagCodes(result)).not.toContain("W-PROGRAM-001");
  });
});

// ---------------------------------------------------------------------------
// S98 combined-lint-additions-s98 Item 1 — non-entry `<page>` file
// suppression for W-PROGRAM-001
// ---------------------------------------------------------------------------

describe("S98 Item 1 — non-entry `<page>` file suppresses W-PROGRAM-001", () => {
  // Per SPEC §40.8: multi-page apps declare `<program>` exactly ONCE in the
  // entry file (typically `app.scrml`). Non-entry page files declare a
  // `<page>` element at file scope WITHOUT a wrapping `<program>` — the
  // route's `<page>` sits inside the app's `<program>` declared in the entry
  // file, NOT inside the page file. The W-PROGRAM-001 lint must not fire on
  // these page files.

  test("file with top-level `<page>` opener does NOT fire W-PROGRAM-001 (canonical non-entry shape)", () => {
    const result = compileSrc("home.scrml", `<page>
  <h1>Welcome</h1>
</page>
`);
    expect(diagCodes(result)).not.toContain("W-PROGRAM-001");
  });

  test("`<page>` with per-route attributes (db= auth= csrf= ratelimit=) does NOT fire W-PROGRAM-001", () => {
    // Per SPEC §40.8 + §4.15 the 4 per-route attributes are db/auth/csrf/ratelimit.
    const result = compileSrc("dashboard.scrml", `<page db="./app.db" auth="required" csrf="auto" ratelimit="100/min">
  <h1>Dashboard</h1>
</page>
`);
    expect(diagCodes(result)).not.toContain("W-PROGRAM-001");
  });

  test("`<page>` body with bare logic (default-logic mode) does NOT fire W-PROGRAM-001", () => {
    // §40.8 normative: <page> body parses in default-logic mode.
    const result = compileSrc("counter.scrml", `<page>
  <count> = 0
  <h1>Count: \${@count}</h1>
</page>
`);
    expect(diagCodes(result)).not.toContain("W-PROGRAM-001");
  });

  test("`<page>` with leading line-comment does NOT fire W-PROGRAM-001 (comments precede markup)", () => {
    // Real-world adopter shape (see examples/23-trucking-dispatch/pages/dispatch/billing.scrml
    // and docs/website/pages/articles/index.scrml) — file starts with `//`
    // documentation then `<page>` opens at line N.
    const result = compileSrc("documented.scrml", `// Documented page.
// Multi-line comment.
<page>
  <h1>Hi</h1>
</page>
`);
    expect(diagCodes(result)).not.toContain("W-PROGRAM-001");
  });

  test("orphan file (no `<page>`, no `<program>`, has bare markup) STILL fires W-PROGRAM-001", () => {
    // Inverse case: a file with bare markup but neither `<page>` nor
    // `<program>` is malformed under the v0.3 program-shape rules; the
    // existing W-PROGRAM-001 hint correctly nudges the adopter.
    const result = compileSrc("orphan.scrml", `<div>orphan content</>
`);
    expect(diagCodes(result)).toContain("W-PROGRAM-001");
  });

  test("entry file with `<program>` containing `<page>` siblings does NOT fire W-PROGRAM-001", () => {
    // The entry file's own `<program>` continues to satisfy the lint.
    const result = compileSrc("app.scrml", `<program title="My App">
  <page>
    <h1>Home</h1>
  </page>
</program>
`);
    expect(diagCodes(result)).not.toContain("W-PROGRAM-001");
  });
});
