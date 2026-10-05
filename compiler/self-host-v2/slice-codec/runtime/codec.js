// =============================================================================
// self-host-v2 / slice-codec / runtime / codec.js — the §57 wire codec,
// RUNTIME half (arc unit Uc).
//
// s451 (U5): the codec now lives in the bootstrap runtime
// (slice-m1/runtime/runtime.js, section "The §57 wire codec"), because a
// compiled program imports ONE runtime module and `persist=` (§6.14.2 rule 2)
// encodes and decodes with it. This module re-exports that section unchanged,
// so the codec's tests and any server-side consumer keep their import path.
// The documentation (SPEC sentences, result shapes, failure kinds) moved with
// the code.
// =============================================================================

export { ABSENT_KEY, CodecDefect, isAbsenceEnvelope, encode, encodeText, decode, decodeText, decodeError } from "../../slice-m1/runtime/runtime.js";
