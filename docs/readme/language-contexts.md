# Language contexts

scrml uses sigil-delimited contexts to separate concerns within a single file:

| Context | Sigil | Purpose |
|---------|-------|---------|
| Program | `<program>` | App root: database, protection, config |
| Markup  | `<tag>` | HTML elements, scrml structural elements (`<engine>`, `<match>`, `<each>`, `<channel>`, `<schema>`, `<errors>`, `<onTimeout>`, `<page>`, …) and state declarations (`<name> = init`) |
| Logic   | `${}` | Expressions, statements and functions |
| SQL     | `?{}` | Database queries (SQLite), with bound parameters |
| CSS     | `#{}` | Scoped styles |
| Error   | `!{}` | Typed error handling (`!{ .V :> ... }` arms) |
| Meta    | `^{}` | Compile-time (or runtime) code generation |
| Test    | `~{}` | Inline tests (compiled out of the output) |
| Foreign | `_{}` | Inline foreign code: the value-returning `_={…}=` form |
