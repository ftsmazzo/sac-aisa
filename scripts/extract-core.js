const fs = require("fs");
const html = fs.readFileSync("sac_reclamacoes.html", "utf8");
const start = html.indexOf("/*CORE-START*/");
const end = html.indexOf("/*CORE-END*/");
if (start < 0 || end < 0) throw new Error("core markers not found");
const core = html.slice(start + "/*CORE-START*/".length, end);
fs.mkdirSync("packages/domain/src", { recursive: true });
fs.writeFileSync("packages/domain/src/legacy-core.mjs", core.trim() + "\n");
console.log("core bytes", core.length);
const m = html.match(/const SEED = `([\s\S]*?)`;/);
if (m) {
  fs.writeFileSync("packages/domain/src/seed-produtos.txt", m[1]);
  console.log("seed lines", m[1].split("\n").length);
}
