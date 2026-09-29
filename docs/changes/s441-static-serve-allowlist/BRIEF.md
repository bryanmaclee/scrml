SECURITY FIX (S441, fail-closed, CRITICAL). You are working in an isolated git worktree cut from origin/main. Before any edit, run `pwd && git branch --show-current` and confirm you are in your worktree. Never write to /home/bryan-maclee/scrmlMaster/scrml via an absolute path.

**Bug, reproduced by the PA on main.** The compiled production server (`_server.js`, emitted by `scrml build`) and the dev server (`compiler/src/commands/dev.js`) serve ANY file in the output directory to anyone, anonymously. Reproducer:
- `app.scrml` = `<program db="app.db">${ function secret() { return ?{`SELECT 1 AS x`}.get() } }<n> = 0<button onclick=${ @n = secret().x }>go</button></program>`;
- run `bun compiler/src/cli.js build <src> -o <dist>`, then `cd <dist> && PORT=4799 bun _server.js`;
- `curl localhost:4799/app.db` → 200, the whole SQLite database (protect= columns and password hashes included);
- `curl localhost:4799/app.server.js` → 200, server source (SQL, auth logic);
- `curl localhost:4799/_server.js` → 200.

**Fix it fail-closed: the static file responder must serve an ALLOWLIST, not "whatever exists".**
- **Allowed:** the compiled client artifacts only. That means `.html` documents, `.css`, CLIENT js (`*.client.*.js`, the runtime chunk, any other client chunks the build emits), and declared static assets such as images, fonts, favicon and any `public/`/assets dir the SPEC defines. Determine the exact set from the build's own emit, preferably by having the build record its client outputs in a manifest the server reads, or by a structural rule derived from what the build writes. Don't guess.
- **Denied, with a 404 and no body leak:**
  - `*.server.js`, `_server.js`, and any `*.server.*`;
  - databases: `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite*`;
  - dotfiles and dot-dirs (`.env`, `.git`);
  - source maps of server code;
  - `.scrml` sources;
  - anything outside the dist root. Path traversal must stay blocked; verify `/../`, encoded `%2e%2e`, and backslash variants.
- **Keep dev and prod behaviour identical.** Find every static-serving site: `_server.js` emission (grep for where it is generated, e.g. compiler/src/codegen or commands/build), dev.js, and any `serve`/`preview` command. There is a structural test asserting "exactly 2 serving sites" in dev; keep it true.

**Also:**
- Check the SPEC (compiler/SPEC.md) for any static-serving or deployment section, and add a normative sentence: the server SHALL NOT serve server modules, databases, dotfiles or sources. If none exists, find the nearest section (the §40 program/server or build/deploy section) and add it there.
- Add tests: prod `_server.js` and dev both return 404 for each denied class and 200 for the client artifacts. Where a test needs a real HTTP server, run it in a child process, because in-process runtime tests can silently skip under happy-dom globals.
- File the gap entry as resolved, or add a resolved entry, in docs/known-gaps.md for `g-static-server-serves-db-and-server-source`, then run `bun scripts/state.ts --write` and `bun scripts/facts.ts --write`.
- Sweep examples/ and samples/ for any app relying on serving a non-client file and report it.
- Archive this prompt verbatim to docs/changes/s441-static-serve-allowlist/BRIEF.md and keep a progress.md there.

**Commits.** Commit incrementally with the normal hook; NEVER use `--no-verify`. The hook runs the ~10-minute suite; under load a timing test can flake, so retry. Code and its tests go in one commit. Push your branch to origin (authorized).

**Report.** Give the tip SHA, the files changed, the test counts, and a list of every serving site you changed.
