# Peter #18 — Windows import specifiers use `\` → server tier fails to import
change-id peter-18-windows-import-specifier-2026-07-04 · agent a117c9c3b5eb98fdc · base d98fc988 (S112 ff-merge)
api.js embeds Node relative() (OS-sep `\` on Windows) into emitted import SPECIFIER strings → invalid escape → module-not-found. Fix: posix-normalize (toPosixSpecifier) at every specifier-construction site (~219/358/520/529); NOT the fs paths. Test OS-independent (mock sep / assert helper — can't R26 on Linux). Full brief = Agent prompt.
