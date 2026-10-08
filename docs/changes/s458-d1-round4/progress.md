# progress — s458-d1-round4 (D1 declared props: one scope model)

## 2026-10-08 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2dd4a6ac2e78db31`; reset to 540bc7f1e;
  `git merge origin/main` (c4eb2c589) = already up to date (540bc7f1e already contains it).
- Maps: primary.map.md read (Task-Shape Routing is window-stale for this surface; not load-bearing). The
  load-bearing artifact was `docs/changes/s458-declared-props-d1/progress.md`.

### Governing sentences (quoted)
- §15.10.1 Shadowing: "A local `let`, `const`, `tilde`, `lin`, `@`, or function declaration with the same name
  appears earlier in the same lexical scope. From the point of declaration onward in the same scope, the local
  binding shadows the prop." / "A `for-stmt` loop variable, `match-arm` binding, `when message(binding)`
  parameter, or `propagate-expr` binding shadows props within their respective scopes." / "A `lambda` parameter
  with the same name is in scope. Inside the lambda body, the parameter shadows the prop."
- §17 for/lift normative statements (SPEC.md ~16115): "A keywordless loop binder — `x` in `for (x of
  collection)` — is `const` (§50.8.5); a write to it SHALL be E-ASSIGN-004."

## 2026-10-08 — step 1: ONE binding model (F5, F3, F2)
- Reproduced (executed, happy-dom): F5 `@v` ended 77, b2 read 101; F3 out `8,8,7,7,8,7,7,12,8,8` and `@v`
  became 8 (a by-value prop WRITTEN through a destructured param — worse than the brief's E-ASSIGN-004).
- Root cause confirmed: `let-decl.name` / `for-stmt.variable` may be a DestructurePattern (`shadowed.add(obj)`);
  function-decl params are ENTRIES `{ name: string | DestructurePattern, typeAnnotation?, defaultValue? }` (not
  strings as the type says), so `String(p)` = "[object Object]" bound nothing.
- NEW `compiler/src/binding-names.ts`: `boundNamesOf(binding)` — the one answer for every shape (ident, param
  text, scrml DestructurePattern, ESTree pattern, param entry / LambdaParam, lists) + `declareIn`. Its header
  states the scope rules both paths apply. Consumers: component-expander (let/const/tilde/lin decl, function-decl
  params, for-stmt variable, lambda params), component-prop-js-substitute (every pattern), expression-parser
  `convertParams` (a defaulted / rest destructured lambda param used to bind NOTHING — `name: ""`).
- JS-text path now follows the SPEC's "from the point of declaration onward" (was: whole-block pre-declaration,
  which disagreed with the structured walker: `const a = n; let n = …` / `let n = n + 1`). Function / class
  declaration names shadow from the header (own body included) in both paths. `var` keeps function hoisting.
- F2: keywordless `for (n of xs)` is a binder in the JS path too (member head stays a write target);
  `bindingNamesOfForHeader` returns it.
- Destructuring defaults (`let { a = n } = …`, param `defaultValue` text) are substituted in the enclosing scope
  (they were emitted verbatim from `default` text → a bare prop name).
- Found, NOT fixed (pre-existing, outside components too): a keywordless `for (n of xs)` inside a block-bodied
  arrow emits `for ( n of … )` (no `const`) — an implicit-global write / strict-mode ReferenceError.
- Tests: conformance bind-prop-destructured-local-shadows (F5 b1–b4), prop-substitution-destructured-shadows
  (F3 table), prop-substitution-keywordless-loop-binder (F2) — all executed; unit s458-round4-one-scope-model.
