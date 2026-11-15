import { cpSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const faust = `${root}node_modules/@grame/faustwasm`;
const out = `${root}vendor/faustwasm`;

mkdirSync(out, { recursive: true });
cpSync(`${faust}/dist/esm/index.js`, `${out}/index.js`);
for (const ext of ["js", "data", "wasm"]) cpSync(`${faust}/libfaust-wasm/libfaust-wasm.${ext}`, `${out}/libfaust-wasm.${ext}`);
// A hosted copy passes these LGPL files on, so their licence travels with them.
cpSync(`${faust}/COPYING.txt`, `${out}/COPYING.txt`);
console.log(`vendor/faustwasm bereit`);
