import {
	FaustCompiler,
	FaustMonoDspGenerator,
	LibFaust,
	instantiateFaustModuleFromFile,
} from "../vendor/faustwasm/index.js";
import { VERSION } from "../vendor/faustwasm/version.js";
import { table } from "./store.js";

const PORT_KINDS = ["audio", "cv", "gate"];
// How many voices a polyphonic module runs.
export const POLY = 4;

async function fetchText(path) {
	const res = await fetch(path, { cache: "no-cache" });
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	return res.text();
}

function parsePorts(id, list, count, what) {
	if (!Array.isArray(list) || list.length !== count)
		throw new Error(`${id}.json nennt ${list?.length ?? 0} ${what}, ${id}.dsp hat ${count}`);
	return list.map((port) => {
		if (typeof port?.name !== "string" || !PORT_KINDS.includes(port.kind))
			throw new Error(`${id}.json: ${what} brauchen name und kind (${PORT_KINDS.join(", ")})`);
		return { name: port.name, kind: port.kind };
	});
}

// Compiled programs, kept in the browser so the next start needs no compiler.
// Key: a hash of the compiler version and the Faust source. Value: { code, json, used }.
const programs = table("faust-rack-programs", "programs");
const KEEP_DAYS = 30;

async function hash(text) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// The compiled program for this Faust source: from the browser's store if it is there,
// from the compiler if not. getCompiler is only called in the second case.
async function program(getCompiler, id, code) {
	const key = await hash(`${VERSION}\n${id}\n${code}`);
	const generator = new FaustMonoDspGenerator();
	const stored = await programs.get(key).catch(() => null);
	if (stored) {
		generator.name = id;
		generator.factory = { cfactory: 0, code: stored.code, module: await WebAssembly.compile(stored.code), json: stored.json, poly: false, shaKey: key, soundfiles: {} };
		programs.put(key, { ...stored, used: Date.now() }).catch(() => {});
		return generator;
	}
	const compiler = await getCompiler();
	if (!(await generator.compile(compiler, id, code, "-ftz 2"))) throw new Error(compiler.getErrorMessage() || "Faust-Kompilierung fehlgeschlagen");
	programs.put(key, { code: generator.factory.code, json: generator.factory.json, used: Date.now() }).catch(() => {});
	return generator;
}

async function forgetOldPrograms() {
	for (const key of await programs.keys()) if (((await programs.get(key))?.used ?? 0) < Date.now() - KEEP_DAYS * 86400000) await programs.delete(key);
}

const flatten = (items) => items.flatMap((item) => (item.items ? flatten(item.items) : [item]));

function parseControl(item) {
	const meta = Object.assign({}, ...(item.meta ?? []));
	const base = { label: item.label, address: item.address, hidden: meta.rack === "hidden", unit: meta.unit ?? "" };
	switch (item.type) {
		case "hslider":
		case "vslider":
		case "nentry": {
			const { min, max, step, init } = item;
			const menu = /^(?:menu|radio)\{(.*)\}$/.exec(meta.style ?? "");
			if (menu) {
				// Faust's JSON writes the quotes around each name as "-", so drop one character on each side.
				const options = menu[1].split(";").map((entry) => {
					const at = entry.lastIndexOf(":");
					return { label: entry.slice(1, at - 1), value: Number(entry.slice(at + 1)) };
				});
				return { ...base, type: "select", init, options };
			}
			const type = max - min === step ? "toggle" : "knob";
			return { ...base, type, min, max, step, init, log: meta.scale === "log" && min > 0 };
		}
		case "checkbox":
			return { ...base, type: "toggle", min: 0, max: 1, init: 0 };
		case "button":
			return { ...base, type: "button" };
		case "soundfile":
			return { ...base, type: "soundfile", hidden: true };
		case "hbargraph":
		case "vbargraph":
			return { ...base, type: meta.rack === "leds" ? "leds" : "meter", min: item.min, max: item.max };
		default:
			throw new Error(`Bedienelement „${item.type}“ wird nicht unterstützt`);
	}
}

export async function compile(getCompiler, id, info, code) {
	const generator = await program(getCompiler, id, code);
	const dsp = JSON.parse(generator.factory.json);
	const speakers = info.speakers === true;
	const microphone = info.microphone === true;
	// A module with "voices" is polyphonic by itself: its process has every jack once per voice,
	// voice after voice. Its jacks are still named once.
	const voices = Number(info.voices) || 1;
	const controls = flatten(dsp.ui).map(parseControl);
	const inputs = parsePorts(id, microphone ? [] : info.inputs, microphone ? 0 : dsp.inputs / voices, "Eingänge");
	// Fed by a polyphonic module, a plain module runs once per voice too. That needs inputs to
	// tell the voices apart, and nothing that exists only once: no meter, no widget, no speaker.
	const spreads = voices === 1 && info.mono !== true && inputs.length > 0 && !speakers && !microphone && !info.widget && !controls.some((c) => c.type === "meter" || c.type === "leds");
	let perVoice;
	if (speakers && dsp.outputs !== 2) throw new Error(`${id}.dsp braucht für "speakers" genau 2 Ausgänge`);
	if (microphone && dsp.inputs !== 2) throw new Error(`${id}.dsp braucht für "microphone" genau 2 Eingänge`);
	return {
		id,
		name: String(info.name ?? id),
		description: String(info.description ?? ""),
		group: String(info.group ?? ""),
		color: String(info.color ?? "#888"),
		columns: Number(info.columns) || 2,
		widget: info.widget ?? null,
		display: String(info.display ?? "scope"),
		speakers,
		microphone,
		voices,
		spreads,
		// The module plays a sample that the page hands to it.
		sampled: controls.some((c) => c.type === "soundfile"),
		inputs,
		outputs: parsePorts(id, speakers ? [] : info.outputs, speakers ? 0 : dsp.outputs / voices, "Ausgänge"),
		controls,
		generator,
		// The same module once per voice, side by side in one program. Controls with the same
		// name are one control in Faust, so all voices share the knobs.
		perVoice: () =>
			(perVoice ??= program(getCompiler, id, `voice = environment {\n${code}\n}.process;\nprocess = par(i, ${POLY}, voice);\n`)),
	};
}

export class ModuleLibrary {
	constructor() {
		this.defs = new Map();
		this.failures = new Map();
		forgetOldPrograms().catch(() => {});
	}

	// The Faust compiler is 6 MB to load and start. It is fetched the first time a module is
	// not in the browser's store, so a start with nothing new skips it.
	#compiler;
	compiler = () => {
		const url = new URL("vendor/faustwasm/libfaust-wasm.js", document.baseURI).href;
		return (this.#compiler ??= instantiateFaustModuleFromFile(url).then((module) => new FaustCompiler(new LibFaust(module))));
	};

	// Reads modules/ again and compiles what is new or changed. A module that
	// fails keeps its last working version; a module dropped from index.json
	// stays loaded until the page reloads, so a running patch never breaks.
	async refresh(onProgress = () => {}) {
		const ids = JSON.parse(await fetchText("modules/index.json"));
		const changed = [];
		const failed = [];
		for (const [i, id] of ids.entries()) {
			onProgress(id, i, ids.length);
			let signature;
			try {
				const [json, code] = await Promise.all([fetchText(`modules/${id}.json`), fetchText(`modules/${id}.dsp`)]);
				signature = `${json}\n${code}`;
				if (this.defs.get(id)?.signature === signature) {
					this.failures.delete(id);
					continue;
				}
				if (this.failures.get(id)?.signature === signature) continue;
				const def = { ...(await compile(this.compiler, id, JSON.parse(json), code)), signature };
				this.defs.set(id, def);
				this.failures.delete(id);
				changed.push(def);
			} catch (err) {
				if (this.failures.get(id)?.message !== err.message) failed.push({ id, message: err.message });
				this.failures.set(id, { signature, message: err.message });
			}
		}
		return { changed, failed };
	}
}
