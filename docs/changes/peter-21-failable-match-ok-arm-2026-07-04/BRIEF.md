# Peter #21 — match over failable ::Ok(v) success arm never matches + v unbound
change-id peter-21-failable-match-ok-arm-2026-07-04 · agent af947242d4adad3d5 · base a7077ae4 · High
Emitted JS: failable success returned BARE (not tagged Ok) → `_scrml_tag_7==="Ok"` never true; `/* cannot positionally bind v */` (emit-control-flow.ts:2367) → v undefined. Fix (verify §19.5.2): success→::Ok(value) match + bind v; error arms by .variant (already work); ? propagation untouched. R26 Peter repro + adversarial + conformance. Full brief = Agent prompt.
