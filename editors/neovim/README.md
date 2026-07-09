# scrml Neovim Integration

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- The scrml LSP server dependencies installed: `bun add vscode-languageserver vscode-languageserver-textdocument` (run from the scrml project root)
- [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig) (recommended) or Neovim 0.8+

## Setup

### 1. Filetype Detection

Copy the filetype detection file to your Neovim config:

```bash
mkdir -p ~/.config/nvim/ftdetect
cp editors/neovim/scrml.vim ~/.config/nvim/ftdetect/scrml.vim
```

Or add this to your `init.lua`:

```lua
vim.filetype.add({
  extension = {
    scrml = "scrml",
  },
})
```

### 2. LSP Configuration

#### Option A: With nvim-lspconfig (recommended)

Copy `scrml.lua` to your Neovim Lua path and require it:

```bash
mkdir -p ~/.config/nvim/lua
cp editors/neovim/scrml.lua ~/.config/nvim/lua/scrml.lua
```

In your `init.lua`:

```lua
require("scrml").setup({
  -- Optional: explicit path to the LSP server
  -- server_path = "/path/to/scrml/lsp/server.js",

  -- Optional: runtime (default: "bun")
  -- runtime = "bun",

  -- Optional: pass on_attach and capabilities from your LSP config
  -- on_attach = your_on_attach_function,
  -- capabilities = your_capabilities,
})
```

The setup function will auto-detect the server path if you are working within the scrml project directory.

#### Option B: Without nvim-lspconfig (Neovim 0.8+ built-in LSP)

```lua
require("scrml").setup_manual({
  server_path = "/path/to/scrml/lsp/server.js",
  runtime = "bun",
})
```

#### Option C: Minimal inline config (no external files)

```lua
-- Filetype detection
vim.filetype.add({ extension = { scrml = "scrml" } })

-- LSP setup
vim.api.nvim_create_autocmd("FileType", {
  pattern = "scrml",
  callback = function()
    vim.lsp.start({
      name = "scrml",
      cmd = { "bun", "run", "/path/to/scrml/lsp/server.js", "--stdio" },
      root_dir = vim.fs.dirname(
        vim.fs.find({ "package.json", "SPEC.md", ".git" }, { upward = true })[1]
      ),
    })
  end,
})
```

### 3. Syntax Highlighting

Three ways to highlight `.scrml`, from best to baseline:

#### Option A (recommended): LSP semantic tokens

Neovim 0.9+ applies **context-exact** highlighting from the language server's own
parse (the compiler is the source of truth — no separate grammar to drift). If the
LSP is attached (step 2), semantic-token highlighting works automatically once the
server advertises the `semanticTokens` capability. This is the highest-fidelity
option and needs no local grammar file.

#### Option B: Ship the vim syntax file (baseline / LSP-off fallback)

A region-aware vim syntax grammar ships in this directory. It scopes each scrml
context (`${}` logic · `?{}` sql · `#{}` css · `^{}` meta · `~{}` test · `!{}`
error · markup) so keywords don't bleed into markup text and `>` only highlights
when it closes a tag:

```bash
mkdir -p ~/.config/nvim/syntax
cp editors/neovim/syntax/scrml.vim ~/.config/nvim/syntax/scrml.vim
```

This is a regex approximation — vim syntax cannot fully parse scrml's nested
contexts — but it is the correct baseline and the fallback when the LSP is not
attached. Semantic tokens (Option A) layer on top of it.

#### Option C: TextMate grammar plugin

If you use a plugin that supports TextMate grammars (such as nvim-textmate), point
it at `editors/vscode/syntaxes/scrml.tmLanguage.json`.

> A Tree-sitter highlights query (`queries/scrml/highlights.scm`) also ships here,
> but scrml has no Tree-sitter grammar yet, so it needs an adapter parser to drive
> it. Prefer Option A or B.

## Verification

1. Open a `.scrml` file in Neovim
2. Check that the filetype is detected: `:set ft?` should show `filetype=scrml`
3. Check LSP is attached: `:LspInfo` should show the scrml server
4. Diagnostics should appear if the file has errors
5. Completions should work with your completion plugin (nvim-cmp, etc.)

## Troubleshooting

- If the LSP server does not start, check that `bun` is in your PATH
- Run `bun run lsp/server.js --stdio` manually to verify it starts without errors
- Check `:LspLog` for server error messages
- Ensure the LSP dependencies are installed in the scrml project root
