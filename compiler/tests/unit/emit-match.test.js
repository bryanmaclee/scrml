import { describe, it, expect, beforeEach } from "bun:test";
import { emitMatchExpr } from "../../src/codegen/emit-control-flow.js";
import { rewriteMatchExpr, rewriteEnumVariantAccess, rewriteIsOperator } from "../../src/codegen/rewrite.js";
import { resetVarCounter } from "../../src/codegen/var-counter.ts";

// Reset the var counter before each test so generated variable names are predictable.
// genVar("match") produces _scrml_match_N where N is the counter value after increment.
beforeEach(() => {
  resetVarCounter();
});

// ---------------------------------------------------------------------------
// emitMatchExpr — new scrml-native syntax (.Variant => result)
// ---------------------------------------------------------------------------

describe("emitMatchExpr — .Variant => arms (new scrml-native syntax)", () => {
  it("emits a single .Variant arm as an IIFE with an if branch", () => {
    const node = {
      header: "status",
      body: [
        { kind: "bare-expr", expr: ".Active => true" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Active") return true');
    expect(result).toContain("(function() {");
    expect(result).toContain("})()");
  });

  it("emits multiple .Variant => arms as if / else if chain", () => {
    const node = {
      header: "direction",
      body: [
        { kind: "bare-expr", expr: ".North => 0" },
        { kind: "bare-expr", expr: ".South => 180" },
        { kind: "bare-expr", expr: ".East => 90" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "North") return 0');
    expect(result).toContain('else if (_scrml_match_1 === "South") return 180');
    expect(result).toContain('else if (_scrml_match_1 === "East") return 90');
  });

  it("emits .Variant(binding) => arm — with no variant registry, binding resolves positionally via a warning comment", () => {
    // S22 §1a slice 2: when the match emitter lacks a file-scoped variant
    // registry (unit-test callers here don't populate it), positional bindings
    // cannot resolve their field names. The emitter inserts a comment so the
    // output is still valid JS and unit variants like `.Point` keep working.
    const node = {
      header: "shape",
      body: [
        { kind: "bare-expr", expr: ".Circle(r) => 3.14" },
        { kind: "bare-expr", expr: ".Point => 0" },
      ],
    };
    const result = emitMatchExpr(node);
    // __tag var is introduced because the first arm has a binding.
    expect(result).toContain("const _scrml_tag_");
    // Variant comparison uses the __tag var.
    expect(result).toMatch(/_scrml_tag_\d+ === "Circle"/);
    expect(result).toMatch(/_scrml_tag_\d+ === "Point"/);
    // Positional binding without a registry falls back to a diagnostic comment.
    expect(result).toContain("cannot positionally bind 'r'");
  });

  it("emits .Variant(binding) => arm — with a registry, positional binding destructures from .data.<field>", () => {
    const { buildVariantFieldsRegistry } = require("../../src/codegen/emit-client.ts");
    const { setVariantFieldsForFile } = require("../../src/codegen/emit-control-flow.ts");
    const fileAST = {
      typeDecls: [{
        kind: "type-decl",
        typeKind: "enum",
        name: "Shape",
        variants: [
          { name: "Circle", payload: new Map([["radius", { kind: "number" }]]) },
          { name: "Point", payload: null },
        ],
      }],
    };
    const { fields, collisions } = buildVariantFieldsRegistry(fileAST);
    setVariantFieldsForFile(fields, collisions);
    try {
      const node = {
        header: "shape",
        body: [
          { kind: "bare-expr", expr: ".Circle(r) => r * 3.14" },
          { kind: "bare-expr", expr: ".Point => 0" },
        ],
      };
      const result = emitMatchExpr(node);
      expect(result).toMatch(/const r = _scrml_match_\d+\.data\.radius;\s*return r \* 3\.14;/);
      expect(result).toMatch(/_scrml_tag_\d+ === "Point"\) return 0/);
    } finally {
      setVariantFieldsForFile(null, null);
    }
  });

  it("emits .Variant(field: local) => arm — named binding destructures from .data.<field> regardless of registry", () => {
    // Named bindings resolve unambiguously from the binding itself, so they work
    // without a registry lookup.
    const node = {
      header: "shape",
      body: [
        { kind: "bare-expr", expr: ".Reloading(reason: r) => r" },
        { kind: "bare-expr", expr: ".Idle => 0" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toMatch(/const r = _scrml_match_\d+\.data\.reason;\s*return r;/);
  });
});

describe("emitMatchExpr — else => arm (new scrml-native wildcard)", () => {
  it("emits else arm as a bare else clause", () => {
    const node = {
      header: "@status",
      body: [
        { kind: "bare-expr", expr: '"active" => "Active"' },
        { kind: "bare-expr", expr: 'else => "Unknown"' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else return "Unknown"');
    expect(result).not.toContain('else if (_scrml_match_1 === "else")');
    expect(result).not.toContain('=== "else"');
  });

  it("emits else-only match (degenerate case)", () => {
    const node = {
      header: "x",
      body: [
        { kind: "bare-expr", expr: "else => 42" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain("else return 42");
    expect(result).not.toContain("if (");
  });

  it("emits multiple .Variant arms followed by else", () => {
    const node = {
      header: "@color",
      body: [
        { kind: "bare-expr", expr: '.Red => "#f00"' },
        { kind: "bare-expr", expr: '.Green => "#0f0"' },
        { kind: "bare-expr", expr: '.Blue => "#00f"' },
        { kind: "bare-expr", expr: 'else => "#000"' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Red") return "#f00"');
    expect(result).toContain('else if (_scrml_match_1 === "Green") return "#0f0"');
    expect(result).toContain('else if (_scrml_match_1 === "Blue") return "#00f"');
    expect(result).toContain('else return "#000"');
  });
});

describe("emitMatchExpr — string literal arms with => separator", () => {
  it('emits a single double-quoted string arm with => separator', () => {
    const node = {
      header: "@status",
      body: [
        { kind: "bare-expr", expr: '"active" => "Active"' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain("(function() {");
  });

  it("emits multiple double-quoted string arms as if / else if chain", () => {
    const node = {
      header: "@status",
      body: [
        { kind: "bare-expr", expr: '"active" => "Active"' },
        { kind: "bare-expr", expr: '"pending" => "Pending"' },
        { kind: "bare-expr", expr: '"closed" => "Closed"' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else if (_scrml_match_1 === "pending") return "Pending"');
    expect(result).toContain('else if (_scrml_match_1 === "closed") return "Closed"');
  });

  it("emits a single-quoted string arm correctly", () => {
    const node = {
      header: "role",
      body: [
        { kind: "bare-expr", expr: "'admin' => true" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain("if (_scrml_match_1 === 'admin') return true");
  });

  it("mixes .Variant and string literal arms in the same match", () => {
    const node = {
      header: "@type",
      body: [
        { kind: "bare-expr", expr: '.Loading => "..."' },
        { kind: "bare-expr", expr: '"done" => "Complete"' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Loading") return "..."');
    expect(result).toContain('else if (_scrml_match_1 === "done") return "Complete"');
  });
});

// ---------------------------------------------------------------------------
// emitMatchExpr — legacy syntax still works (backward-compat fallback)
// ---------------------------------------------------------------------------

describe("emitMatchExpr — legacy ::Variant -> syntax (backward-compat fallback)", () => {
  it("emits a single ::Variant arm (legacy syntax still recognized)", () => {
    const node = {
      header: "status",
      body: [
        { kind: "bare-expr", expr: "::Active -> true" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Active") return true');
    expect(result).toContain("(function() {");
    expect(result).toContain("})()");
  });

  it("emits multiple ::Variant -> arms (legacy syntax still recognized)", () => {
    const node = {
      header: "direction",
      body: [
        { kind: "bare-expr", expr: "::North -> 0" },
        { kind: "bare-expr", expr: "::South -> 180" },
        { kind: "bare-expr", expr: "::East -> 90" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "North") return 0');
    expect(result).toContain('else if (_scrml_match_1 === "South") return 180');
    expect(result).toContain('else if (_scrml_match_1 === "East") return 90');
  });

  it("emits legacy wildcard _ -> arm", () => {
    const node = {
      header: "@status",
      body: [
        { kind: "bare-expr", expr: '"active" -> "Active"' },
        { kind: "bare-expr", expr: '_ -> "Unknown"' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else return "Unknown"');
    expect(result).not.toContain('=== "_"');
  });

  it("emits legacy wildcard-only match", () => {
    const node = {
      header: "x",
      body: [
        { kind: "bare-expr", expr: "_ -> 42" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain("else return 42");
    expect(result).not.toContain("if (");
  });
});

describe("emitMatchExpr — no arms fallback", () => {
  it("emits a comment placeholder when no arms are recognized", () => {
    const node = {
      header: "x",
      body: [
        { kind: "bare-expr", expr: "completely unparseable content" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain("/* match expression could not be compiled */");
  });
});

// ---------------------------------------------------------------------------
// emitMatchExpr — BUG-R13-001 regression: single body child with all arms
// ---------------------------------------------------------------------------

describe("emitMatchExpr — single-child body with all arms in one string (BUG-R13-001)", () => {
  it("splits 3 .Variant arms from a single body child string", () => {
    const node = {
      header: "status",
      body: [
        { kind: "bare-expr", expr: ".Todo => Status.InProgress .Done => Status.Todo .InProgress => Status.Done" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Todo") return Status.InProgress');
    expect(result).toContain('else if (_scrml_match_1 === "Done") return Status.Todo');
    expect(result).toContain('else if (_scrml_match_1 === "InProgress") return Status.Done');
    // Must NOT contain raw arm text as part of a result
    expect(result).not.toContain('.Done =>');
    expect(result).not.toContain('.InProgress =>');
  });

  it("splits 2 .Variant arms + else from a single body child string", () => {
    const node = {
      header: "status",
      body: [
        { kind: "bare-expr", expr: '.Todo => Status.InProgress "Done" => Status.Done else => Status.Todo' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Todo") return Status.InProgress');
    expect(result).toContain('else if (_scrml_match_1 === "Done") return Status.Done');
    expect(result).toContain('else return Status.Todo');
    expect(result).not.toContain('"Done" =>');
    expect(result).not.toContain('else =>');
  });

  it("handles 2 string arms + else in a single body child string", () => {
    const node = {
      header: "msg",
      body: [
        { kind: "bare-expr", expr: '"Done" => Status.InProgress else => Status.Todo' },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Done") return Status.InProgress');
    expect(result).toContain('else return Status.Todo');
    expect(result).not.toContain('else =>');
  });

  it("does not split a normal single-arm body child", () => {
    const node = {
      header: "x",
      body: [
        { kind: "bare-expr", expr: ".Active => someObj.Status" },
      ],
    };
    const result = emitMatchExpr(node);
    // someObj.Status should NOT be treated as a second arm (property access, not arm start)
    expect(result).toContain('if (_scrml_match_1 === "Active") return someObj.Status');
    // Should be exactly one arm (one if, no else if)
    expect(result).not.toContain('else if');
  });
});

// ---------------------------------------------------------------------------
// rewriteMatchExpr — inline expression rewriting (new syntax)
// ---------------------------------------------------------------------------

describe("rewriteMatchExpr — new .Variant => syntax in inline expressions", () => {
  it("rewrites inline match with .Variant => arms", () => {
    const input = "match role {\n.Admin => true\n.Guest => false\n}";
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "Admin") return true');
    expect(result).toContain('else if (_scrml_match_1 === "Guest") return false');
  });

  it("rewrites inline match with else => wildcard arm", () => {
    const input = 'return match @status {\n"active" => "Active"\nelse => "Other"\n}';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else return "Other"');
    expect(result).not.toContain('=== "else"');
  });

  it("rewrites inline match with string => arms", () => {
    const input = 'return match @status {\n"active" => "Active"\n"pending" => "Pending"\n}';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else if (_scrml_match_1 === "pending") return "Pending"');
    expect(result).toContain("(function() {");
    expect(result).toContain("})()");
  });
});

describe("rewriteMatchExpr — legacy ::Variant -> syntax in inline form", () => {
  it("still works for legacy ::Variant -> arms", () => {
    const input = "match role {\n::Admin -> true\n::Guest -> false\n}";
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "Admin") return true');
    expect(result).toContain('else if (_scrml_match_1 === "Guest") return false');
  });

  it("still works for legacy string arms with -> separator", () => {
    const input = 'return match @status {\n"active" -> "Active"\n_ -> "Other"\n}';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else return "Other"');
    expect(result).not.toContain('=== "_"');
  });
});

describe("rewriteMatchExpr — edge cases", () => {
  it("returns the original expression unchanged when no match keyword is present", () => {
    const input = "someOtherExpression(x)";
    const result = rewriteMatchExpr(input);
    expect(result).toBe(input);
  });

  it("returns the original expression unchanged when no arms parse", () => {
    // A match block that contains no recognizable arms should fall back to the input
    const input = "match x { garbage }";
    const result = rewriteMatchExpr(input);
    // No arms found — returns the original string unchanged
    expect(result).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// rewriteMatchExpr — BUG-R13-001 regression: arms on one line
// ---------------------------------------------------------------------------

describe("rewriteMatchExpr — arms on one line without newlines (BUG-R13-001)", () => {
  it("rewrites 3 .Variant arms all on one line", () => {
    const input = 'match role { .Admin => "admin" .Mod => "mod" .Guest => "guest" }';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "Admin") return "admin"');
    expect(result).toContain('else if (_scrml_match_1 === "Mod") return "mod"');
    expect(result).toContain('else if (_scrml_match_1 === "Guest") return "guest"');
    // Must NOT contain raw arm text in the output
    expect(result).not.toContain('.Mod =>');
    expect(result).not.toContain('.Guest =>');
  });

  it("rewrites 2 .Variant arms + else on one line", () => {
    const input = 'match role { .Admin => "admin" .Mod => "mod" else => "guest" }';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "Admin") return "admin"');
    expect(result).toContain('else if (_scrml_match_1 === "Mod") return "mod"');
    expect(result).toContain('else return "guest"');
    expect(result).not.toContain('.Mod =>');
  });

  it("rewrites 2 string arms on one line", () => {
    const input = 'match status { "active" => "Active" "pending" => "Pending" }';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else if (_scrml_match_1 === "pending") return "Pending"');
  });

  it("does not split result expressions containing property access", () => {
    // Status.InProgress has .I which looks like a variant arm — must NOT split it
    const input = 'match status { .Todo => Status.InProgress .Done => Status.Done }';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "Todo") return Status.InProgress');
    expect(result).toContain('else if (_scrml_match_1 === "Done") return Status.Done');
    // Status.InProgress should be the full result, not split
    expect(result).not.toContain('"InProgress"');
  });
});

// ---------------------------------------------------------------------------
// rewriteMatchExpr — trailing comma and nested match fixes
// ---------------------------------------------------------------------------

describe("rewriteMatchExpr — trailing comma fix", () => {
  it("single-line arms do not produce trailing commas in returns", () => {
    const input = "match x { .A => 1, .B => 2, else => 0 }";
    const result = rewriteMatchExpr(input);
    expect(result).toContain("return 1;");
    expect(result).toContain("return 2;");
    expect(result).toContain("return 0;");
    expect(result).not.toContain("return 1,");
    expect(result).not.toContain("return 2,");
  });

  it("string arm results do not have trailing commas", () => {
    const input = 'match x { "hello" => greet(), "bye" => farewell(), else => noop() }';
    const result = rewriteMatchExpr(input);
    expect(result).not.toContain("greet(),;");
    expect(result).toContain("return greet();");
  });
});

describe("rewriteMatchExpr — nested match expressions", () => {
  it("nested match in arm result is rewritten to IIFE", () => {
    const input = "match x { .A => match y { .C => 1, else => 2 }, else => 0 }";
    const result = rewriteMatchExpr(input);
    // Outer match IIFE
    expect(result).toContain("(function() {");
    // Inner match should also be an IIFE
    const iifeCount = (result.match(/\(function\(\) \{/g) || []).length;
    expect(iifeCount).toBe(2);
    expect(result).not.toContain("match y");
  });

  it("const assignment with match produces valid IIFE", () => {
    const input = "const y = match x { .A => 1, .B => 2, else => 0 }";
    const result = rewriteMatchExpr(input);
    expect(result).toContain("const y = (function()");
    expect(result).toContain("return 1;");
    expect(result).toContain("return 2;");
    expect(result).toContain("return 0;");
  });
});

// ---------------------------------------------------------------------------
// rewriteEnumVariantAccess — value position enum variant rewriting
// ---------------------------------------------------------------------------

describe("rewriteEnumVariantAccess — new .Variant shorthand in value position", () => {
  it("rewrites .Variant (dot not preceded by identifier) to string literal", () => {
    const result = rewriteEnumVariantAccess('addUser("Alice", .Admin)');
    expect(result).toBe('addUser("Alice", "Admin")');
  });

  it("rewrites .Variant after assignment operator", () => {
    const result = rewriteEnumVariantAccess("let x = .Active");
    expect(result).toBe('let x = "Active"');
  });

  it("does NOT rewrite TypeName.Variant (member access — ambiguous)", () => {
    // Color.Red looks like a JS member access — we don't rewrite it to avoid false positives
    // Users should use .Red (shorthand) or is .Red (operator) instead
    const result = rewriteEnumVariantAccess("Color.Red");
    // Should NOT be rewritten — "Color.Red" is potentially valid JS member access
    expect(result).toBe("Color.Red");
  });

  it("does NOT rewrite Math.PI (correct: uppercase property, not an enum variant)", () => {
    // Math.PI should NOT be rewritten — the dot is preceded by 'h' (alphanumeric)
    const result = rewriteEnumVariantAccess("Math.PI");
    expect(result).toBe("Math.PI");
  });

  it("does NOT rewrite obj.Prop (member access — dot preceded by identifier)", () => {
    const result = rewriteEnumVariantAccess("someObj.MyProp");
    expect(result).toBe("someObj.MyProp");
  });
});

describe("rewriteEnumVariantAccess — legacy :: syntax (backwards compat)", () => {
  it("rewrites TypeName::Variant to string literal", () => {
    const result = rewriteEnumVariantAccess("Color::Red");
    expect(result).toBe('"Red"');
  });

  it("rewrites ::Variant shorthand to string literal", () => {
    const result = rewriteEnumVariantAccess("::Active");
    expect(result).toBe('"Active"');
  });
});

// ---------------------------------------------------------------------------
// rewriteIsOperator — single-variant boolean check
// ---------------------------------------------------------------------------

describe("rewriteIsOperator — x is .Variant → x === 'Variant'", () => {
  it("rewrites 'status is .Active' to equality check", () => {
    const result = rewriteIsOperator("status is .Active");
    expect(result).toBe('status === "Active"');
  });

  it("rewrites 'role is .Admin' in a condition", () => {
    const result = rewriteIsOperator("if (role is .Admin) { doSomething() }");
    expect(result).toBe('if (role === "Admin") { doSomething() }');
  });

  it("rewrites fully qualified 'x is TypeName.Variant' form", () => {
    const result = rewriteIsOperator("status is Status.Active");
    expect(result).toBe('status === "Active"');
  });

  it("rewrites 'role is Priority.High' (fully qualified)", () => {
    const result = rewriteIsOperator("task.priority is Priority.High");
    expect(result).toBe('task.priority === "High"');
  });

  it("leaves non-is expressions unchanged", () => {
    const result = rewriteIsOperator("x === 5");
    expect(result).toBe("x === 5");
  });

  it("handles multiple is checks in same expression", () => {
    const result = rewriteIsOperator("(x is .A) && (y is .B)");
    expect(result).toBe('(x === "A") && (y === "B")');
  });

  it("does not rewrite 'island' or 'isActive' (word boundary respected)", () => {
    const result = rewriteIsOperator("isActive = true; island = 'foo'");
    expect(result).toBe("isActive = true; island = 'foo'");
  });
});

// ---------------------------------------------------------------------------
// emitMatchExpr — nested match in arm result (BUG-NESTED-MATCH-FIX)
// ---------------------------------------------------------------------------

describe("emitMatchExpr — nested match in arm result", () => {
  it("compiles outer match with nested inner match as arm result", () => {
    // Represents the Mario state machine pattern:
    //   match powerUp {
    //     .Mushroom => match mario.state {
    //         .Small => MarioState.Big
    //         else   => mario.state
    //     }
    //     .Flower => MarioState.Fire
    //   }
    // The inner match arrives as newline-separated arm text within the outer arm result.
    const node = {
      header: "powerUp",
      body: [
        {
          kind: "bare-expr",
          expr: ".Mushroom => match mario.state {\n.Small => MarioState.Big\nelse => mario.state\n}",
        },
        { kind: "bare-expr", expr: ".Flower => MarioState.Fire" },
      ],
    };
    const result = emitMatchExpr(node);
    // Outer match compiles to an IIFE
    expect(result).toContain("(function() {");
    expect(result).toContain("})()");
    // Outer arms compile correctly
    expect(result).toContain('if (_scrml_match_1 === "Mushroom")');
    expect(result).toContain('else if (_scrml_match_1 === "Flower") return');
    // Inner match must be compiled — NOT emitted as raw match keyword text
    expect(result).not.toContain("return match mario.state");
    expect(result).not.toContain("return match mario . state");
    // Inner match IIFE result should contain the compiled arms
    expect(result).toContain('"Small"');
    expect(result).toContain("MarioState.Big");
  });

  it("inner match arms are NOT split as top-level outer arms", () => {
    // .Small inside inner match must NOT become a top-level arm of the outer match.
    // This was the root cause: splitInlineArms split on newlines naively, breaking
    // the arm grouping for nested match expressions.
    const node = {
      header: "powerUp",
      body: [
        {
          kind: "bare-expr",
          expr: ".Mushroom => match mario.state {\n.Small => MarioState.Big\nelse => mario.state\n}",
        },
        { kind: "bare-expr", expr: ".Flower => MarioState.Fire" },
      ],
    };
    const result = emitMatchExpr(node);
    // .Small must NOT appear as a top-level _scrml_match_1 check
    expect(result).not.toContain('_scrml_match_1 === "Small"');
    // Outer match has 2 total _scrml_match_1 equality checks (Mushroom if + Flower else if)
    const topLevelChecks = (result.match(/_scrml_match_1 ===/g) || []).length;
    expect(topLevelChecks).toBe(2);
    // Inner match uses _scrml_match_2, not _scrml_match_1
    expect(result).toContain('_scrml_match_2');
  });

  it("inner match result compiles with _scrml_match_2 (fresh var counter)", () => {
    // The inner match IIFE uses a fresh tmpVar (_scrml_match_2) separate from the outer
    const node = {
      header: "x",
      body: [
        {
          kind: "bare-expr",
          expr: ".A => match y {\n.P => 1\n.Q => 2\n}",
        },
        { kind: "bare-expr", expr: ".B => 0" },
      ],
    };
    const result = emitMatchExpr(node);
    // Outer match uses _scrml_match_1
    expect(result).toContain("_scrml_match_1");
    // Inner match (processed via rewriteExpr on arm.result) uses _scrml_match_2
    expect(result).toContain("_scrml_match_2");
    // Inner arms compile correctly
    expect(result).toContain('"P"');
    expect(result).toContain('"Q"');
  });
});

// ---------------------------------------------------------------------------
// rewriteEnumVariantAccess — named args in payload construction
// ---------------------------------------------------------------------------

describe("rewriteEnumVariantAccess — payload construction is call-preserving", () => {
  // S22 §1a: payload construction is now a call to the emitted constructor
  // function (see emit-client.ts:emitEnumVariantObjects). rewriteEnumVariantAccess
  // leaves `EnumType.Variant(args)` alone; at runtime the constructor returns
  // `{ variant: "X", data: { field: value } }` (spec §19.3.2 aligned).
  it("leaves labeled-expression payload construction intact", () => {
    const result = rewriteEnumVariantAccess("HurtResult.Downgrade(to: MarioState.Small)");
    expect(result).toBe("HurtResult.Downgrade(to: MarioState.Small)");
  });

  it("leaves positional payload construction intact", () => {
    const result = rewriteEnumVariantAccess("HurtResult.Downgrade(MarioState.Small)");
    expect(result).toBe("HurtResult.Downgrade(MarioState.Small)");
  });

  it("leaves call-expression payloads intact regardless of inner colon", () => {
    const result = rewriteEnumVariantAccess("Foo.Bar(x: someValue)");
    expect(result).toBe("Foo.Bar(x: someValue)");
  });
});

// ---------------------------------------------------------------------------
// emitMatchExpr — match-arm-block nodes (structured block bodies from AST builder)
// ---------------------------------------------------------------------------

describe("emitMatchExpr — match-arm-block structured body nodes", () => {
  it("emits a single match-arm-block variant arm with reactive assignment body", () => {
    // Simulates: .Info => { @currentStep = Step.Info }
    // After AST builder fix, this produces a match-arm-block node with body array.
    const reactiveAssignNode = {
      kind: "state-decl",
      name: "currentStep",
      init: "Step . Info",
    };
    const node = {
      header: "@status",
      body: [
        {
          kind: "match-arm-block",
          variant: "Info",
          isWildcard: false,
          body: [reactiveAssignNode],
        },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Info")');
    expect(result).toContain("{");
    expect(result).not.toContain("lift < Info");
    expect(result).not.toContain("lift < InfoStep");
    expect(result).toContain("(function() {");
    expect(result).toContain("})()");
  });

  it("emits multiple match-arm-block variant arms as if / else if chain", () => {
    // Simulates: .Active => { @x = 1 }  .Inactive => { @x = 2 }
    const makeReactiveAssign = (name, val) => ({
      kind: "state-decl",
      name,
      init: String(val),
    });
    const node = {
      header: "status",
      body: [
        {
          kind: "match-arm-block",
          variant: "Active",
          isWildcard: false,
          body: [makeReactiveAssign("x", 1)],
        },
        {
          kind: "match-arm-block",
          variant: "Inactive",
          isWildcard: false,
          body: [makeReactiveAssign("x", 2)],
        },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Active")');
    expect(result).toContain('else if (_scrml_match_1 === "Inactive")');
  });

  it("emits empty match-arm-block as empty block {}", () => {
    // Simulates: .Confirm => {}  (empty block body — do nothing)
    const node = {
      header: "step",
      body: [
        {
          kind: "match-arm-block",
          variant: "Confirm",
          isWildcard: false,
          body: [],
        },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Confirm")');
    expect(result).toContain("{}");
  });

  it("emits a wildcard match-arm-block (else branch) correctly", () => {
    // Simulates: .Active => {}  else => { @x = 0 }
    const node = {
      header: "status",
      body: [
        {
          kind: "match-arm-block",
          variant: "Active",
          isWildcard: false,
          body: [],
        },
        {
          kind: "match-arm-block",
          variant: null,
          isWildcard: true,
          body: [{ kind: "state-decl", name: "x", init: "0" }],
        },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Active")');
    expect(result).toContain("else {");
  });

  it("emits a lift-expr inside match-arm-block as _scrml_lift call (not raw text) — P0 fix", () => {
    // THE P0 BUG: lift <InfoStep> inside a match arm block body must NOT
    // produce the literal text "lift < InfoStep >" in the JS output.
    // After the fix, emitLogicBody processes the lift-expr node via emitLiftExpr.
    const liftExprNode = {
      kind: "lift-expr",
      expr: { kind: "expr", expr: "< InfoStep >" },
    };
    const node = {
      header: "@currentStep",
      body: [
        {
          kind: "match-arm-block",
          variant: "Info",
          isWildcard: false,
          body: [liftExprNode],
        },
      ],
    };
    const result = emitMatchExpr(node);
    // Must NOT contain the raw invalid JS text
    expect(result).not.toContain("lift < Info");
    expect(result).not.toContain("lift < InfoStep");
    // Must contain a valid _scrml_lift call (emitLiftExpr output)
    expect(result).toContain("_scrml_lift(");
    // Must contain if branch for the "Info" variant
    expect(result).toContain('if (_scrml_match_1 === "Info")');
  });

  it("mixed: some arms as match-arm-block, some as bare-expr strings — no regression", () => {
    // Real-world case: some arms have block bodies (match-arm-block),
    // some have single-expression results (bare-expr string path).
    const node = {
      header: "@status",
      body: [
        // Block body arm
        {
          kind: "match-arm-block",
          variant: "Active",
          isWildcard: false,
          body: [{ kind: "state-decl", name: "x", init: "1" }],
        },
        // Single expression arm (legacy bare-expr string path — unchanged)
        { kind: "bare-expr", expr: ".Inactive => 0" },
      ],
    };
    const result = emitMatchExpr(node);
    expect(result).toContain('if (_scrml_match_1 === "Active")');
    expect(result).toContain('else if (_scrml_match_1 === "Inactive") return 0');
  });
});


// ---------------------------------------------------------------------------
// rewriteMatchExpr — :> arm separator (alias for =>, per §18)
// ---------------------------------------------------------------------------

describe("rewriteMatchExpr — :> arm separator alias (§18)", () => {
  it("rewrites inline match with .Variant :> arms", () => {
    const input = "match powerUp {\n.Mushroom :> MarioState.Big\n.Flower :> MarioState.Fire\nelse :> mario.state\n}";
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "Mushroom") return MarioState.Big');
    expect(result).toContain('else if (_scrml_match_1 === "Flower") return MarioState.Fire');
    expect(result).toContain("else return mario.state");
  });

  it("rewrites inline match with string :> arms", () => {
    const input = 'match status {\n"active" :> "Active"\n"pending" :> "Pending"\nelse :> "Unknown"\n}';
    const result = rewriteMatchExpr(input);
    expect(result).toContain('if (_scrml_match_1 === "active") return "Active"');
    expect(result).toContain('else if (_scrml_match_1 === "pending") return "Pending"');
    expect(result).toContain('else return "Unknown"');
  });

  it("returns IIFE form for :> arms (same as => arms)", () => {
    const input = "match role {\n.Admin :> true\n.Guest :> false\n}";
    const result = rewriteMatchExpr(input);
    expect(result).toContain("(function() {");
    expect(result).toContain("})()");
    expect(result).toContain('if (_scrml_match_1 === "Admin") return true');
    expect(result).toContain('else if (_scrml_match_1 === "Guest") return false');
  });
});
