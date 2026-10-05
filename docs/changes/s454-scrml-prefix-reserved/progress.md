# progress — s454-scrml-prefix-reserved (append-only)

- start: base b35593879, worktree verified, bun install + pretest ok.

## Where the check lives (decided)
- NEW `compiler/src/validators/reserved-prefix.ts` `runReservedPrefixCheck(ast)`, called from `api.js` post-TAB
  (after SCOPE-REDECLARE, before MOD) on each file's AUTHOR tree, once. Same shelf as lint-async-user-source.ts
  (also stdlib-exempt, AST-only).
- NOT inside ast-builder.js (beside E-NAME-COLLIDES-RESERVED): buildAST is re-invoked by CE / emit-engine /
  emit-match / emit-logic / implied-lift-desugar on text the compiler SYNTHESIZES, which carries `_scrml_` names.
- NOT type-system.ts: TS runs post-CE and already sees compiler-synthesized names (`_scrml_each_item` default);
  its E-SCOPE walker deliberately exempts `_`-prefixed names, which is how `_scrml_sql` slipped through.
- stdlib exemption: NEW `isStdlibSourceFile` in module-resolver.js beside the canonical `isStdlibFilePath`
  (resolve() + POSIX separators + realpath on both sides). Absolute-root comparison, never substring.
- `tokenizeTemplateInterpolations` + `TemplateSegment` in expression-parser.ts made `export` (no behaviour change).

## Per-position decisions
DECLARATIONS flagged: let/const/lin/tilde, state cells (`<_scrml_x>`), derived cells, function/fn names,
function + lambda params, destructuring binders (obj/arr/rest), for-of vars, `<each as>`, match-expr arm binders,
`<match>` arm payload binders, engine state-child payload binders + message-arm binders, endpoint/onchange arm
binders, catch binders, type names, ENUM VARIANTS and STRUCT FIELDS (type body lexed — a declared member name),
component names, engine names/var names, import + export names, labels, typed attrs/props.
REFERENCES flagged: every `ident` ExprNode (bare + `@`-read), call-ref handler names, variable-ref, markup tag
names (`<_scrml_x>` element = component/state-type reference), DOT-MEMBER property names (`o._scrml_x`,
`o?._scrml_x`) — security: runtime attaches `_scrml_*` props to globalThis / request / elements.
NOT flagged (decided): string literals (incl. template quasi text), comments (//, /* */, <!-- -->), markup prose,
attribute NAMES, CSS, SQL text (its `${}` interpolations ARE checked), OBJECT-LITERAL KEYS (a property of a
value, not a binding; the tree cannot tell `{_scrml_k:1}` from `{"_scrml_k":1}` — undecidable on the tree),
type-annotation expressions (erased; the type NAME is refused at its declaration), `_{}` foreign code
(opaque §23.2.3 — the compiler never tokenizes it). `obj["_scrml_x"]` (string index) is a value, not a name.
TAB-DESUGARED references exempt: `<#w>.send()` -> `_scrml_worker_w`, `<#feed>` -> `_scrml_input_feed_`
(ast-builder preprocessWorkerAndStateRefs / tokenizer ATTR_CALL/ATTR_IDENT write these into the author tree
by text replacement). Exact shapes, reference position only. Limit: an author typing the desugared spelling is
indistinguishable post-TAB (reaches only what `<#name>` reaches).
Raw-captured regions handed to the compiler's own sub-parsers: component-def.raw (parseComponentBody),
html-fragment (same), engine rulesRaw (parseEngineStateChildren: shorthand bodies, effect=, message arms,
onTransition, onTimeout, nested engines via buildAST), match armsRaw (parseMatchArms: binders, attrs, `:` bodies),
each openers, endpoint/onchange arm bodies, param defaults, test asserts, escape-hatch raws, template/SQL
interpolations — logic fragments lexed with tokenizeLogic (STRING/COMMENT tokens are not identifiers).
