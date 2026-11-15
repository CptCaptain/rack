// Usage: node scripts/modules.mjs [id ...]
// Compiles modules/*.dsp without a browser, with the same checks the rack applies.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FaustCompiler, LibFaust, instantiateFaustModuleFromFile } from "../vendor/faustwasm/index.js";
import { compile } from "../src/faust.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const listed = JSON.parse(readFileSync(`${root}modules/index.json`, "utf8"));
const onDisk = readdirSync(`${root}modules`).filter((file) => file.endsWith(".dsp")).map((file) => file.slice(0, -4));
const ids = process.argv.length > 2 ? process.argv.slice(2) : onDisk;
const compiler = new FaustCompiler(new LibFaust(await instantiateFaustModuleFromFile(`${root}vendor/faustwasm/libfaust-wasm.js`)));

let failed = 0;
for (const id of ids) {
	try {
		const info = JSON.parse(readFileSync(`${root}modules/${id}.json`, "utf8"));
		const def = await compile(() => compiler, id, info, readFileSync(`${root}modules/${id}.dsp`, "utf8"));
		const ports = (list) => list.map((port) => port.name).join(", ") || "-";
		console.log(`ok   ${id}${listed.includes(id) ? "" : " (not in index.json)"}: in ${ports(def.inputs)} | out ${def.speakers ? "speakers" : ports(def.outputs)}`);
		console.log(`     ${def.controls.map((c) => `${c.address} (${c.type})`).join(", ")}`);
	} catch (err) {
		failed++;
		console.log(`FAIL ${id}: ${err.message.trim()}`);
	}
}
for (const id of listed.filter((id) => !onDisk.includes(id))) {
	failed++;
	console.log(`FAIL ${id}: listed in index.json but modules/${id}.dsp is missing`);
}
process.exit(failed ? 1 : 0);
