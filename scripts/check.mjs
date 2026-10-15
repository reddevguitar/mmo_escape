// 모든 소스 파일 문법 검사 (node --check)
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "test", "scripts", "server.js"];
const files = [];
function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (/\.m?js$/.test(p)) files.push(p);
}
for (const r of roots) walk(r);
for (const f of files) execFileSync(process.execPath, ["--check", f], { stdio: "inherit" });
console.log(`syntax ok: ${files.length} files`);
