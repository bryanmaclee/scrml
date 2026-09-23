export async function run(a){ const first=document.querySelector("li.row"); first.setAttribute("data-mark","1");
 a.get("items").push({id:3,name:"c"}); a.log("push"); console.log("ID same row element kept after push:", document.querySelector("li.row")===first);
 a.set("items",[...a.get("items")].reverse()); a.log("rev"); console.log("ID marked element still present:", !!document.querySelector("[data-mark]"));
 a.set("user","V"); a.log("user"); console.log("ID marked after user change:", !!document.querySelector("[data-mark]")); }
