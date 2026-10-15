// escape-hatch (sequence / arrow) arm values: sync, wrong-value probes
const V = (val) => `const k: string = "a"
    const r = match (k) {
      "a" :> ${val}
      else :> "n"
    }
    return r`;
const M = (arm) => `let r = "R"
    const k: string = "a"
    match (k) {
      "a" :> ${arm}
      else :> { r = "n" }
    }
    return r`;
export const S = {
  eSeqTern: V(`(0, name == "zz") ? "A" : "B"`),
  eSeqPlus: V(`(0, "x") + "y"`),
  eSeqStmt: M(`{ r = (0, name == "zz") ? "A" : "B" }`),
  eArrowCall: V(`((x) => x + "!")(name) + "?"`),
  eSeqTop: `const r = (0, name == "zz") ? "A" : "B"
    return r`,
};
