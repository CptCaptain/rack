import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const faust = `${root}node_modules/@grame/faustwasm`;
const out = `${root}vendor/faustwasm`;

mkdirSync(out, { recursive: true });
cpSync(`${faust}/dist/esm/index.js`, `${out}/index.js`);
for (const ext of ["js", "data", "wasm"]) cpSync(`${faust}/libfaust-wasm/libfaust-wasm.${ext}`, `${out}/libfaust-wasm.${ext}`);
console.log(`vendor/faustwasm bereit`);
