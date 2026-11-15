import { valueFromMidi } from "./controls.js";
import { ModuleLibrary } from "./faust.js";
import { keys } from "./keyboard.js";
import { openMidi } from "./midi.js";
import { releaseMidiOut } from "./midiout.js";
import { hitPad } from "./pads.js";
import { Rack } from "./rack.js";
import { RackView, h } from "./ui.js";

const STORE = "faust-rack.patch";
const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);

let rack;
let view;
let library;

let statusTimer;
function say(text, sticky = false) {
	$("status").textContent = text;
	clearTimeout(statusTimer);
	if (!sticky) statusTimer = setTimeout(() => ($("status").textContent = ""), 5000);
}

// Loading a patch, adding a module and a live module update all await audio
// worklet setup; running them one after another keeps the rack consistent.
let queue = Promise.resolve();
const serial = (job) => (queue = queue.then(job).catch((err) => say(err.message, true)));

const fetchJson = async (path) => {
	const res = await fetch(path, { cache: "no-cache" });
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	return res.json();
};

const openPatch = (data) =>
	serial(async () => {
		try {
			await rack.load(data);
		} finally {
			view.render();
		}
	});

function pick(title, items) {
	const dialog = $("picker");
	let lastGroup = "";
	const entries = items.flatMap(({ name, description, color, group = "", run }) => {
		const button = h("button", { style: `--color:${color ?? "transparent"}` }, h("b", {}, name), h("span", {}, description ?? ""));
		button.addEventListener("click", () => {
			dialog.close();
			run();
		});
		const heading = group === lastGroup ? [] : [h("h3", {}, group)];
		lastGroup = group;
		return [...heading, button];
	});
	dialog.replaceChildren(h("h2", {}, title), ...entries, h("form", { method: "dialog" }, h("button", {}, "Abbrechen")));
	dialog.showModal();
}

function reportFailures(failed) {
	for (const { id, message } of failed) console.error(`Modul ${id}: ${message}`);
	if (failed.length) say(`Fehler in Modul ${failed[0].id}: ${failed[0].message}`, true);
}

async function pollModules() {
	if (document.visibilityState === "visible") {
		try {
			const { changed, failed } = await library.refresh();
			reportFailures(failed);
			if (changed.length) {
				await serial(async () => {
					for (const def of changed) await rack.update(def);
					view.render();
				});
				say(`Modul neu geladen: ${changed.map((def) => def.name).join(", ")}`);
			}
		} catch {
			// The server was unreachable for a moment; the next round tries again.
		}
	}
	setTimeout(pollModules, POLL_MS);
}

// Notes on channel 10 are drum pads, all other notes play the Keyboard modules.
// A controller moves the knob it was bound to; the mod wheel reaches the Keyboard unless it is bound.
function onMidi(event) {
	if (event.type === "note") return event.channel === 10 ? hitPad(event.note, event.velocity) : keys.play(event.note, event.velocity);
	if (event.type === "bend") return keys.bend(event.value);
	const picked = view.learnTarget;
	if (picked) {
		rack.learn(event.cc, picked.id, picked.address);
		view.learnTarget = null;
		view.render();
		say(`Regler ${event.cc} am Gerät steuert jetzt ${picked.id} ${picked.address.split("/").pop()}.`);
	}
	const bound = rack.midi.get(event.cc);
	if (!bound) return event.cc === 1 && keys.mod(event.value / 127);
	const control = rack.modules.get(bound.id).def.controls.find((c) => c.address === bound.address);
	const value = valueFromMidi(control, event.value);
	if (value === null) return;
	rack.setParam(bound.id, bound.address, value);
	view.show(bound.id, bound.address, value);
}

async function connectMidi() {
	if (!navigator.requestMIDIAccess) return say("Dieser Browser kann kein Web MIDI. Chrome und Edge können es.", true);
	try {
		await openMidi(onMidi, (inputs, outputs) => {
			const list = (names) => names.join(", ") || "nichts";
			say(`MIDI an. Eingänge: ${list(inputs)}. Ausgänge: ${list(outputs)}.`);
			$("btn-midi").setAttribute("aria-pressed", "true");
			$("btn-learn").disabled = false;
		});
	} catch (err) {
		say(`MIDI nicht erlaubt: ${err.message}`, true);
	}
}

function drawScope() {
	const canvas = $("scope");
	const g = canvas.getContext("2d");
	const data = new Float32Array(rack.analyser.fftSize);
	const frame = () => {
		requestAnimationFrame(frame);
		rack.analyser.getFloatTimeDomainData(data);
		let start = 1;
		while (start < data.length / 2 && !(data[start - 1] < 0 && data[start] >= 0)) start++;
		g.clearRect(0, 0, canvas.width, canvas.height);
		g.beginPath();
		for (let x = 0; x < canvas.width; x++) {
			const y = (0.5 - data[start + Math.floor((x * data.length) / 2 / canvas.width)] * 0.5) * canvas.height;
			x ? g.lineTo(x, y) : g.moveTo(x, y);
		}
		g.strokeStyle = "#7ee0a1";
		g.stroke();
	};
	frame();
}

const compiled = (async () => {
	library = await ModuleLibrary.create();
	const { failed } = await library.refresh((id, i, total) => {
		$("progress").textContent = `Kompiliere Modul ${i + 1} von ${total}: ${id}`;
	});
	$("progress").textContent = failed.length ? `${failed.length} Modul(e) mit Fehler, siehe Statuszeile.` : "Bereit.";
	$("start").disabled = false;
	return failed;
})();
compiled.catch((err) => ($("progress").textContent = `Start fehlgeschlagen: ${err.message}`));

async function start() {
	const failed = await compiled;
	const ctx = new AudioContext({ latencyHint: "interactive" });
	const save = () => localStorage.setItem(STORE, JSON.stringify(rack));
	let saveTimer;
	rack = new Rack(ctx, library.defs, {
		onRemove: releaseMidiOut,
		onChange: () => {
			clearTimeout(saveTimer);
			saveTimer = setTimeout(save, 300);
		},
	});
	view = new RackView(rack, $("rack"));
	const examples = await fetchJson("patches/index.json");
	const saved = localStorage.getItem(STORE);
	try {
		if (!saved) throw new Error("kein gespeicherter Patch");
		await rack.load(JSON.parse(saved));
	} catch {
		await rack.load(await fetchJson(`patches/${examples[0].file}`));
	}
	view.render();
	reportFailures(failed);
	drawScope();
	setTimeout(pollModules, POLL_MS);
	// Once allowed, MIDI comes back on its own; the first time needs the button because the browser asks.
	navigator.permissions?.query({ name: "midi" }).then((permission) => permission.state === "granted" && connectMidi(), () => {});
	window.faustRack = { rack, view, library, openPatch };
	$("start").textContent = "Weiter";
	$("bar").inert = false;
}

let started;
$("help").addEventListener("cancel", (e) => $("start").disabled && e.preventDefault());
$("help").addEventListener("close", () => (started ??= start().catch((err) => say(`Start fehlgeschlagen: ${err.message}`, true))));
$("help").showModal();

$("btn-help").addEventListener("click", () => $("help").showModal());
$("btn-add").addEventListener("click", () => {
	const defs = [...library.defs.values()];
	const groups = [...new Set(defs.map((def) => def.group))];
	const add = (def) =>
		serial(async () => {
			const inst = await rack.add(def.id);
			view.render();
			document.querySelector(`.module[data-id="${inst.id}"]`).scrollIntoView({ behavior: "smooth", block: "nearest" });
		});
	pick(
		"Modul hinzufügen",
		defs.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group)).map((def) => ({ ...def, run: () => add(def) })),
	);
});
$("btn-patches").addEventListener("click", async () => {
	const examples = await fetchJson("patches/index.json");
	pick("Patch laden", [
		...examples.map((ex) => ({ ...ex, run: async () => openPatch(await fetchJson(`patches/${ex.file}`)) })),
		{ name: "Leeres Rack", description: "Alles entfernen und neu anfangen.", run: () => openPatch({ format: "faust-rack/1", modules: [], cables: [] }) },
	]);
});
$("btn-export").addEventListener("click", () => {
	const url = URL.createObjectURL(new Blob([JSON.stringify(rack, null, "\t")], { type: "application/json" }));
	h("a", { href: url, download: "patch.json" }).click();
	URL.revokeObjectURL(url);
});
$("btn-import").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", async (e) => {
	const [file] = e.target.files;
	e.target.value = "";
	if (!file) return;
	try {
		await openPatch(JSON.parse(await file.text()));
	} catch (err) {
		say(`Import fehlgeschlagen: ${err.message}`, true);
	}
});
$("btn-midi").addEventListener("click", connectMidi);
$("btn-learn").addEventListener("click", () => {
	const on = $("btn-learn").getAttribute("aria-pressed") !== "true";
	$("btn-learn").setAttribute("aria-pressed", String(on));
	view.setLearning(on);
	say(on ? "Lernen: erst einen Regler im Rack antippen, dann den Regler am Gerät bewegen. Doppelklick löst die Zuordnung." : "", on);
});
$("btn-power").addEventListener("click", async () => {
	await (rack.ctx.state === "running" ? rack.ctx.suspend() : rack.ctx.resume());
	$("btn-power").setAttribute("aria-pressed", String(rack.ctx.state === "running"));
});
