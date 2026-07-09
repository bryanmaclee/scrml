# BRIEF — VS Code TextMate grammar refresh (2026-07-08)

Refresh the scrml VS Code TextMate grammar `editors/vscode/syntaxes/scrml.tmLanguage.json` for the CURRENT language surface. It has not been updated since S83 and is missing large parts of the language. EXTEND the existing 46-rule structure — do NOT rewrite from scratch.

**Owner review:** the PA runs a review before landing. Do NOT push, do NOT merge to main, do NOT self-land.

## What's missing today (grammar-coverage probe — these produce zero matches now)
- **§65 CSS-native model** (landed S246): `<theme>` and `<defaults>` structural elements; the `#{}` scoped-CSS body (property:value pairs, must scope correctly — currently mangled); `style:name=@cond` conditional style attributes; `style=` / `style=[a,b]` style-as-value; the built-in reset. Authority: **SPEC §65** + samples `samples/compilation-tests/css-*.scrml`.
- **Realtime** (`<channel watches=<table>>`, `<onchange>` handler, `RowChange` variants). Authority: **SPEC §38.13**.
- **§52 authority**: `authority=` / `table=` on state collections. Authority: **SPEC §52**.
- **`component` / `snippet`** structural declarations.

## Current keyword surface (authoritative inventory — from lsp/handlers.js SCRML_KEYWORDS; cross-check SPEC)
lift match · is · "is some" · "is not" · enum struct fn pure server const lin type import export from return · if else for of while async await navigate · engine errors onTransition onTimeout onIdle onchange · channel schema program · not req fail pinned reset derived history given partial when transaction test-bind cancelTimer parseVariant reflect broadcast disconnect cleanup flush animationFrame · watches authority theme defaults component snippet

## Current attribute surface (from SCRML_ATTRIBUTES; add the §65/realtime/§52 ones SPEC defines)
protect= tables= src= bind:value bind:checked bind:selected bind:group · if= else-if= else each= key= · for= initial= var= derived= rule= internal:rule= effect= to= from= after= once name= history debounced= throttled= default= pinned · topic= reconnect= auth= csrf= loginRedirect= sessionExpiry= idempotency-store= idempotency-ttl= · interval= running= delay= class: · PLUS (add): watches= authority= table= style:NAME= (conditional style)

## Preserve
- The existing `invalid-equality` (`===`/`!==`) and `invalid-null-undefined` (`null`/`undefined`) rules — KEEP them.
- All existing working rules (logic-block `${}`, sql-block `?{}`, meta-block `^{}`, css-inline-block `#{}`, test-block `~{}`, error-effect-block `!{}`, engine-attribute, match-keyword, etc.). Extend, don't remove.

## Verification
Set up a `vscode-textmate` + `vscode-oniguruma` tokenization harness under editors/vscode/ that loads the grammar and tokenizes representative samples, then ASSERT scopes on the new forms.

## Constraints
- Touch ONLY `editors/vscode/**` (+ this BRIEF and progress.md).
- isolation:worktree; base current main HEAD; commit INCREMENTALLY; do NOT push/merge.

Authority sections read: SPEC §65 (34919-35334), §38.13 (20250-20388), §52.3/§52.4 (30004-30225).
