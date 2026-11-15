import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const faust = `${root}node_modules/@grame/faustwasm`;
const out = `${root}vendor/faustwasm`;

mkdirSync(out, { recursive: true });
cpSync(`${faust}/dist/esm/index.js`, `${out}/index.js`);
for (const ext of ["js", "data", "wasm"]) cpSync(`${faust}/libfaust-wasm/libfaust-wasm.${ext}`, `${out}/libfaust-wasm.${ext}`);
// A hosted copy passes these LGPL files on, so their licence travels with them.
cpSync(`${faust}/COPYING.txt`, `${out}/COPYING.txt`);
// The page keeps compiled modules in the browser. The compiler's version is part of each
// entry's key, so a new compiler never serves programs the old one built.
writeFileSync(`${out}/version.js`, `export const VERSION = ${JSON.stringify(JSON.parse(readFileSync(`${faust}/package.json`, "utf8")).version)};\n`);
console.log(`vendor/faustwasm bereit`);
