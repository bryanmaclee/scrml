# config.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## Environment Variables

| Key | Required | Source | Description |
|-----|----------|--------|-------------|
| SCRML_PORT | optional | compiler/src/serve-client.js, compiler/src/commands/serve.js | Dev/compiler server port (default: 3100 for serve command, configured per invocation) |
| PORT | optional | compiler/src/commands/build.js | Production server port injected into build output (default: 3000) |

No `.env.example` or `.env.template` present. The compiler is a CLI tool — no application secrets are handled by the compiler process itself. User scrml programs may reference database URLs and secrets, but those are in compiled output, not in compiler source.

## Feature Flags

No compile-time feature flags detected in source. Compiler behavior is controlled via CLI arguments.

## Config Files

### bunfig.toml  [project root]
```
[test]
root = "compiler/tests/"
timeout = 10000
```

### compiler/package.json  [workspace]
name: "compiler", version: "0.2.0", dependencies: acorn@^8.16.0, astring@^1.9.0

### Root package.json  [project root]
name: "scrmlts", version: "0.2.0", engines: { bun: ">=1.3.13" }, workspaces: ["compiler"]

## Runtime Compile Options (CLI flags — not environment-based)

| Flag | Type | Description |
|------|------|-------------|
| --output-dir, -o | string | Output directory (default: dist/ next to input) |
| --verbose, -v | boolean | Per-stage timing and counts |
| --convert-legacy-css | boolean | Convert `<style>` blocks to `#{...}` |
| --embed-runtime | boolean | Embed runtime inline instead of separate file |
| --emit-batch-plan | boolean | Print Stage 7.5 BatchPlan as JSON |
| --emit-machine-tests | boolean | Emit .machine.test.js per source (§51.13) |
| --emit-reachability | boolean | Emit `<base>.reachability.json` (Stage 7.6 / SPEC §40.9) [NEW S89 A-2.1] |
| --watch, -w | boolean | Watch for changes (compile command only) |
| --port | number | HTTP port for dev server (default: 3000) |

## Tags
#scrmlts #map #config #environment #cli-flags #s89

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
