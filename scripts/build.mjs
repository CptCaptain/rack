import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}dist`;

if (!existsSync(`${root}vendor/faustwasm/libfaust-wasm.wasm`)) await import("./vendor.mjs");
rmSync(dist, { recursive: true, force: true });
for (const entry of ["index.html", "style.css", "src", "modules", "patches", "vendor"]) cpSync(`${root}${entry}`, `${dist}/${entry}`, { recursive: true });
console.log(`dist/ gebaut`);
