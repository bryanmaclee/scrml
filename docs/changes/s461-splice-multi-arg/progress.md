# progress — s461-splice-multi-arg

- 2026-10-09T19:46:59Z WIP(s461-splice-multi-arg): start at /home/user/scrml/.claude/worktrees/agent-abaef28c3d2880a02 — base origin/main d99dad0
- 2026-10-09T19:51:07Z Phase 1 (recon) done.
  - Governing sentence, SPEC §6.5.1: *"The following mutating methods are valid on reactive array variables: … `@arr.splice(start, deleteCount, ...items)` …"*. Each argument is a separate argument; nothing in §6.5 makes them one expression.
  - Reproduced on origin/main d99dad0: `@ls.splice(0, 0, @p)` emits `.splice((0, 0, _scrml_cs_reactive_get("p")))`.
    The same happens for push, unshift and fill with a cell-reading argument. `"a,b"` loses its quotes and becomes `a, b`.
    `@rows.push({ u: "b", n: @m })` fails with E-SCOPE-001 `b` (the sibling gap).
  - Trace: the ast-builder.js statement-position `@name.<method>(` recognisers (parseOneStatement ~:10214 and the
    body loop ~:14286) collect argument tokens with `argParts.push(t.text)` and `join(" ")`, then
    `safeParseExprToNode` parses the WHOLE LIST AS ONE EXPRESSION. That gives a SequenceExpression escape-hatch, or a
    ParseError for a spread. emit-logic.ts `case "reactive-array-mutation"` emits that one node into
    `.<method>(${args})`, and the escape-hatch rewrite renders a sequence in parentheses.
    The root is that the argument list is modelled as one expression. There is a second defect at the same site:
    STRING tokens carry unquoted text, so string arguments lose their delimiters. That closes the sibling gap too.
  - Maps: primary.map.md has no row for this surface; a grep for 'splice' / 'array-mutation' found nothing relevant. Not load-bearing.
