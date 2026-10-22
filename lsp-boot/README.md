# lsp-boot — live diagnostics from the bootstrap compiler

`lsp/server.js` runs impl#1, which does not parse today's language (§66 declarations, tapes with
grants, `single`, `renders`, …), so it reports errors on correct code. `lsp-boot/server.ts` is a
minimal language server whose diagnostics come from the **bootstrap** (`compiler/self-host-v2/`),
the same compile as `scrml-boot compile` (`scripts/scrml-boot.ts` `compileSource`), run on the
**unsaved buffer** as you type.

```
bun run lsp-boot/server.ts --stdio        # or: bun run lsp:boot
```

## What it does, and what it does not

- `textDocument/didOpen`, `didChange` (incremental sync), `didClose`; `shutdown`, `exit`.
- `textDocument/publishDiagnostics`: `severity`, `range` (from the bootstrap's span), `code` (the
  diagnostic code, e.g. `E-SCOPE-001`), `source: "scrml-boot"`.
- Every open buffer overlays the disk, so an unsaved buffer — or an unsaved module it imports —
  is compiled from memory. A file that does not exist on disk yet works too.
- A diagnostic inside an imported file is shown on the importing line (`in b.scrml:3:35: …`) with
  `relatedInformation` pointing at it. Editing a module re-checks the open files that import it.
- **No hover, definition, completion, symbols.** The server does not advertise them.

## Scheduling

| | |
|---|---|
| debounce | each edit restarts a per-document timer; `SCRML_BOOT_LSP_DEBOUNCE_MS` (default 150) |
| one compile at a time | in a Worker (`lsp-boot/worker.ts`), so the server keeps reading edits while a compile runs |
| no stale results | a result is published only if the document is still at the version that was compiled |
| cancellation | a compile an edit has superseded is killed (worker restarted, ~0.15 s) once it has run `SCRML_BOOT_LSP_CANCEL_AFTER_MS` (default 500); shorter ones finish and are dropped |
| hang | a current compile running past `SCRML_BOOT_LSP_TIMEOUT_MS` (default 10000) → one Error, `scrml-boot crashed: the compile did not finish …`; the worker is restarted |
| crash | a bootstrap exception, a worker death, or a bundle that will not load → one Error on line 1, `scrml-boot crashed: …` (code `scrml-boot-crash`). A buffer is never silently clean |

The bootstrap bundle loads once, at `initialize`, from the disk cache (`~/.cache/scrml/boot-bundle`;
see `scripts/scrml-boot.ts`). If the bootstrap or impl#1 sources changed since the last build, the
first start builds it with impl#1 (~10–15 s); diagnostics appear when it is done. **Restart the
server** (`:LspRestart`) after pulling compiler changes. Server logs go to `window/logMessage`
(`:LspLog` in nvim).

## nvim (0.11+)

```lua
-- scrml: live diagnostics from the bootstrap compiler (lsp-boot)
local SCRML = vim.fn.expand("~/scrmlMaster/scrml")  -- the repo checkout

vim.filetype.add({ extension = { scrml = "scrml" } })

vim.lsp.config("scrml_boot", {
  cmd = { "bun", SCRML .. "/lsp-boot/server.ts", "--stdio" },
  filetypes = { "scrml" },
  root_markers = { ".git" },
})
vim.lsp.enable("scrml_boot")
```

For nvim 0.10 or older, the same thing by hand:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "scrml",
  callback = function(ev)
    vim.lsp.start({
      name = "scrml_boot",
      cmd = { "bun", SCRML .. "/lsp-boot/server.ts", "--stdio" },
      root_dir = vim.fs.root(ev.buf, { ".git" }),
    })
  end,
})
```

Run the server file with `bun` directly (not `bun run lsp:boot`): it starts faster and does not
depend on the working directory. If impl#1's `lsp/server.js` is also configured for `scrml`,
disable it, or the buffer shows both servers' diagnostics. `vim.diagnostic.config({ update_in_insert = true })`
shows diagnostics while still in insert mode (nvim defers them to leaving insert by default).

## Tests

`bun test compiler/tests/lsp/boot-lsp.test.ts` drives real server processes over stdio: buffer
vs disk, incremental fix, unsaved imports, debounce, stale-result suppression, cancellation,
crash, hang. The crash/hang/slow cases use a test-only fault hook in the worker, enabled only by
`SCRML_BOOT_LSP_TEST_FAULTS=1` in the server's environment.
