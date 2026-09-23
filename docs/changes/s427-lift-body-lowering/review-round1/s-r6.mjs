export async function run(a){ a.set("items", ["c","b","a"]); a.log("rev"); a.get("items").push("d"); a.log("push"); }
