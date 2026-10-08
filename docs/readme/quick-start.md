# Quick start

scrml is not on npm. You run it from a clone.

```bash
# Install Bun if you don't have it — https://bun.sh
curl -fsSL https://bun.sh/install | bash

# Get the compiler and its dependencies
git clone https://github.com/bryanmaclee/scrml.git
cd scrml
bun install

# Put the `scrml` command on your PATH (one-time, from the repo root)
bun link

# Scaffold a new project, then run it
scrml init my-app
cd my-app
scrml dev src/app.scrml   # compile, watch and serve

# Or use the CLI directly on any .scrml file or directory
scrml compile <file|dir>
scrml build <dir>         # production build
```
