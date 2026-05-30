# BRIEF — S144 Cluster C-Z (6nz Bug Z, HIGH)
agent: add602239179ead08 · scrml-dev-pipeline · isolation:worktree · model:opus · dispatched S144 2026-05-30 on HEAD 505f4ace.
discipline: standard S126/S99/S88/S83/S90/R26 verbatim per pa.md.

BUG: post-emit identifier-mangler rewrites a declared name's substring INSIDE a string literal → silent content corruption (exit-0, valid JS). `<label>="handleKey(e)"` → `_scrml_reactive_set("label","_scrml_handleKey_3(e)")`. Critical for an editor (6nz) that displays code-as-text. String literals must be OPAQUE to the rename pass.
LEADS: emit-client.ts mangler ~1360-1420 + per-name use-regex ~1574. Prior band-aids: S34 Bug D 27ed6fe `(?<!\.)`; S39 Bug I 6b3e63f `(?<!\.\s*)`. It's a raw-string regex pass with no string-literal awareness. Fix: mask string-literal (+comment) spans before name-replacement (mask-and-restore — mirror maskInterpolations in tailwind-classes.js) OR token/AST-driven rename. Handle escaped quotes + template literals.
SCOPE-FENCE: emit-client.ts + tests only. Don't regress real call-position mangling (onclick=handleKey() must still → _scrml_handleKey_3()).
ACCEPTANCE: emit tests — name in "..", '..', `..` stays verbatim; same name in real call still mangles; interaction shape. R26 repro: string intact + onclick still mangled. Pre-commit gate.
