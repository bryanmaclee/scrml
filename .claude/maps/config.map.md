# config.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

## Environment Variables

No `.env.example` / `.env.template` in the repo. Env vars referenced in source:

| Key | Required | Description |
|---|---|---|
| `SCRML_PORT` | optional | dev/serve server port (commands/dev.js, serve.js, serve-client.js) |
| `PORT` | optional | fallback server port in build-adapter emit (commands/build.js) |

No secrets, API keys, or credential keys are configured in source.

## Feature Flags (compiler options passed to `compileScrml(options)`)

| Flag | Default | Description |
|---|---|---|
| `parser` | `null` | `"scrml-native"` routes per-file TAB through `nativeParseFile` (C2); any other value uses live BS+TAB path |
| `emitPerRoute` | `false` | per-route artifact splitter (SPEC §40.9.7) |
| `testMode` | `false` | emit `<base>.test.js` from `~{}` blocks (SPEC §19.12.7) |
| `emitMachineTests` | `false` | emit `.machine.test.js` (SPEC §51.13) |
| `debugPerf` | `false` | `--debug-perf` PGO sub-stage instrumentation |
| `sourceMap` | `false` | emit Source Map v3 .map files |
| `convertLegacyCss` | `false` | pre-process `<style>` blocks to `#{…}` |
| `embedRuntime` | `false` | inline runtime instead of separate file |
| `gather` | `true` | auto-gather transitive .scrml import closure (SPEC §21.7) |
| `gatherLimit` | `5000` | GATHER_LIMIT cap; E-IMPORT-007 fires above |
| `mode` | `"browser"` | `"browser"` \| `"library"` |
| `chunkSizeBudgetBytes` | `100000` | `--chunk-size-budget=<bytes>`; W-CG-CHUNK-LARGE |
| `compilerSettings.lintTailwindUnrecognizedClass` | `"warn"` | `"warn"` \| `"off"` |
| `selfHostModules` | `null` | optional self-hosted pipeline-stage overrides |

## Config Files

### bunfig.toml
```
[test] root = "compiler/tests/"
[test] timeout = 10000
```

### package.json (root)
`type: "module"` / `private: true` / `workspaces: ["compiler"]`
`bin.scrml → compiler/bin/scrml.js` / `engines.bun: ">=1.3.13"`

### compiler/package.json
Private sub-package; deps: acorn, astring; devDep: @happy-dom/global-registrator.

## CI / Deployment Config

No `.github/workflows`, `.gitlab-ci.yml`, `Jenkinsfile`, `Dockerfile`, or `docker-compose.*`. Quality gates are local git hooks (see build.map.md).

## Tags
#scrmlts #map #config #compiler-options

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
