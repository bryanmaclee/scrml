export async function run(a){ console.log("CNT", a.get("count")); a.get("items").push("c"); console.log("CNT after push", a.get("count")); a.log("p"); }
