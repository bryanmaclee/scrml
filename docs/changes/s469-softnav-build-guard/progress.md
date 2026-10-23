# s469-softnav-build-guard — progress

Closes `g-soft-nav-cross-build-handler-id-collision-s469` (HIGH, security limb S435).

## Log
- Branch cut from origin/main 0ff6c93aa; merged origin/s469-browser-suite-health (#1511, queued) early for its harness repairs.
- Baseline (#1511 merged): cross-chunk + soft-nav browser files 28 pass / 1 fail (the known-red seed-apply gap test).

## Design (in progress)
- Build identity: fnv1aHash over the build's emitted client-visible set (runtime + each file's clientJs/html/css, placeholder in place), substituted post-pass. Stamped `<html data-scrml-build>`; each classic chunk opens with `_scrml_build_admit(id)` (refuses a foreign-build chunk before any side effect).
- Soft-nav: `_scrml_nav_apply_html` compares the fetched document's identity with the admitted (running) build id BEFORE seed/head/chunk/swap; mismatch or missing → hard navigation.
- Defence in depth: delegated listeners + `_scrml_nav_rewire` resolve only inside a region stamped with their own build (the swap stamps the outlet with the fetched page's identity).
