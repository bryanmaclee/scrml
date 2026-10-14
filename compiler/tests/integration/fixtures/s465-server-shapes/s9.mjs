const T = (body) => `let r = "REJECTED"
    ${body}
    return r`;
export const S = {
  fSeqUpd: T(`let n = 0
    for (let i = 0, j = 5; i < 3; i++, j--) { n = n + j }
    if (n == 12 && check(pass, row.pw)) { r = "WELCOME" }`),
  fSeqInit: T(`let n = 0
    let i = 0
    let j = 0
    for (i = 0, j = 5; i < 3; i++) { n = n + j }
    if (n == 15 && check(pass, row.pw)) { r = "WELCOME" }`),
  fMultiDecl: T(`let n = 0
    for (let i = 0, j = 2; i < 3; i++) { n = n + j }
    if (n == 6 && check(pass, row.pw)) { r = "WELCOME" }`),
};
