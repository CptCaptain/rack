import { valueFromMidi } from "./controls.js";
import { edits } from "./edits.js";
import { breed } from "./evolve.js";
import { ModuleLibrary } from "./faust.js";
import { keys } from "./keyboard.js";
import { forgetWorld } from "./life.js";
import { openMidi } from "./midi.js";
import { releaseMidiOut } from "./midiout.js";
import { hitPad } from "./pads.js";
import { Rack } from "./rack.js";
import { loadSample } from "./samples.js";
import { forgetFeed } from "./web.js";
import { MAX_RECORDING_MINUTES, startRecording } from "./record.js";
import { RackView, h } from "./ui.js";

const STORE = "faust-rack.patch";
const LIBRARY = "faust-rack.patches";
const NAME = "faust-rack.name";
const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);

let rack;
let view;
let modules;

// Undo: every saved state of the patch goes on a stack. Turning a knob saves once it rests.
const history = { past: [], future: [], current: null, restoring: false };

function remember() {
	const now = JSON.stringify(rack);
	localStorage.setItem(STORE, now);
	if (history.restoring || now === history.current) return;
	if (history.current) history.past.push(history.current);
	history.past.splice(0, history.past.length - 100);
	history.future.length = 0;
	history.current = now;
}

const stepHistory = (from, to) =>
	serial(async () => {
		if (!from.length) return;
		to.push(history.current);
		history.current = from.pop();
		history.restoring = true;
		try {
			await rack.reconcile(JSON.parse(history.current));
		} finally {
			// The rack may list the same patch in another order than the stack had it. Taking the
			// rack's own wording keeps the next save from looking like a new change.
			history.current = JSON.stringify(rack);
			history.restoring = false;
			view.render();
		}
	});
const undo = () => stepHistory(history.past, history.future);
const redo = () => stepHistory(history.future, history.past);

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

// The name the patch in the rack was saved under, or "" for one that has none yet.
// Speichern writes to that name without asking.
function namePatch(name) {
	name ? localStorage.setItem(NAME, name) : localStorage.removeItem(NAME);
	$("patch-name").textContent = name;
}

const openPatch = (data, name = "") =>
	serial(async () => {
		try {
			await rack.load(data);
			namePatch(name);
		} finally {
			view.render();
		}
	});

function savePatch(name = localStorage.getItem(NAME)) {
	name ||= prompt("Name für diesen Patch:")?.trim();
	if (!name) return;
	library.set(name, rack.toJSON());
	namePatch(name);
	say(`Gespeichert als „${name}“. Du findest ihn unter Patches.`);
}

// Patches saved under a name, in this browser: { name: patch }.
const library = {
	all: () => JSON.parse(localStorage.getItem(LIBRARY) ?? "{}"),
	set: (name, patch) => localStorage.setItem(LIBRARY, JSON.stringify({ ...library.all(), [name]: patch })),
	remove: (name) => localStorage.setItem(LIBRARY, JSON.stringify(Object.fromEntries(Object.entries(library.all()).filter(([key]) => key !== name)))),
};

// A patch as a link: the JSON, compressed, in the part of the address after #. That part
// never reaches the server.
const base64url = { "+": "-", "/": "_", "-": "+", _: "/" };
async function shareLink() {
	const packed = new Blob([JSON.stringify(rack)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
	const bytes = new Uint8Array(await new Response(packed).arrayBuffer());
	const code = btoa(String.fromCharCode(...bytes)).replace(/[+/]/g, (c) => base64url[c]).replace(/=+$/, "");
	return `${location.origin}${location.pathname}#p=${code}`;
}

async function sharedPatch() {
	const code = location.hash.match(/^#p=(.+)/)?.[1];
	if (!code) return null;
	window.history.replaceState(null, "", location.pathname);
	const bytes = Uint8Array.from(atob(code.replace(/[-_]/g, (c) => base64url[c])), (c) => c.charCodeAt(0));
	return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
}

function pick(title, items) {
	const dialog = $("picker");
	let lastGroup = "";
	const entries = items.flatMap(({ name, description, color, group = "", run, remove }) => {
		const button = h("button", { style: `--color:${color ?? "transparent"}` }, h("b", {}, name), h("span", {}, description ?? ""));
		button.addEventListener("click", () => {
			dialog.close();
			run();
		});
		const heading = group === lastGroup ? [] : [h("h3", {}, group)];
		lastGroup = group;
		if (!remove) return [...heading, button];
		const erase = h("button", { class: "erase", "aria-label": `${name} löschen`, title: "Löschen" }, "×");
		erase.addEventListener("click", () => {
			remove();
			erase.parentElement.remove();
		});
		return [...heading, h("div", { class: "entry" }, button, erase)];
	});
	dialog.replaceChildren(h("h2", {}, title), ...entries, h("form", { method: "dialog" }, h("button", {}, "Abbrechen")));
	dialog.showModal();
}

function reportFailures(failed) {
	for (const { id, message } of failed) console.error(`Modul ${id}: ${message}`);
	if (failed.length) say(`Fehler in Modul ${failed[0].id}: ${failed[0].message}`, true);
}

// Reads the modules again and swaps every changed one into the running rack.
async function applyModules() {
	const { changed, failed } = await modules.refresh();
	reportFailures(failed);
	if (!changed.length) return;
	await serial(async () => {
		for (const def of changed) await rack.update(def);
		view.render();
	});
	say(`Modul neu geladen: ${changed.map((def) => def.name).join(", ")}`);
}

async function pollModules() {
	// The server may be unreachable for a moment; the next round tries again.
	if (document.visibilityState === "visible") await applyModules().catch(() => {});
	setTimeout(pollModules, POLL_MS);
}

const TEMPLATE = {
	dsp: `import("stdfaust.lib");\n\namount = hslider("[0]Menge", 0.5, 0, 1, 0.01) : si.smoo;\n\nprocess = *(amount);\n`,
	json: `{\n\t"name": "Mein Modul",\n\t"description": "Was es tut.",\n\t"color": "#9bc53d",\n\t"group": "Eigene",\n\t"inputs": [{ "name": "In", "kind": "audio" }],\n\t"outputs": [{ "name": "Out", "kind": "audio" }]\n}\n`,
};

// The Editor: the Faust program and the description of one module, to change and hear at once.
// Anwenden compiles here and swaps the module into the running rack. Nothing reaches the server.
function editModule(id) {
	const dialog = $("editor");
	const source = edits.all()[id] ?? modules.defs.get(id)?.source ?? TEMPLATE;
	$("editor-title").textContent = modules.defs.has(id) ? `Modul ${modules.defs.get(id).name} bearbeiten` : `Neues Modul „${id}“`;
	$("editor-dsp").value = source.dsp;
	$("editor-json").value = source.json;
	$("editor-error").textContent = "";
	$("editor-reset").hidden = !edits.all()[id];
	$("editor-apply").onclick = async () => {
		try {
			JSON.parse($("editor-json").value);
		} catch (err) {
			return void ($("editor-error").textContent = `Die Beschreibung ist kein gültiges JSON: ${err.message}`);
		}
		edits.set(id, { dsp: $("editor-dsp").value, json: $("editor-json").value });
		$("editor-reset").hidden = false;
		await applyModules();
		$("editor-error").textContent = modules.failures.get(id)?.message ?? "Läuft.";
	};
	$("editor-reset").onclick = async () => {
		edits.remove(id);
		dialog.close();
		await applyModules();
	};
	$("editor-download").onclick = () => {
		download(new Blob([$("editor-dsp").value], { type: "text/plain" }), `${id}.dsp`);
		download(new Blob([$("editor-json").value], { type: "application/json" }), `${id}.json`);
	};
	dialog.showModal();
}

function openEditor() {
	const create = () => {
		const id = prompt("Kurzname für das neue Modul (Kleinbuchstaben und Ziffern):")?.trim().toLowerCase();
		if (!id) return;
		if (!/^[a-z][a-z0-9]*$/.test(id) || modules.defs.has(id)) return say("Der Name ist vergeben oder enthält andere Zeichen als Kleinbuchstaben und Ziffern.", true);
		editModule(id);
	};
	pick("Modul-Editor", [
		{ name: "Neues Modul …", description: "Ein eigenes Modul schreiben. Es lebt in diesem Browser.", run: create },
		...[...modules.defs.values()].map((def) => ({ group: def.edited ? "Von dir geändert oder neu" : def.group, name: def.name, description: def.description, color: def.color, run: () => editModule(def.id) })).sort((a, b) => (a.group === "Von dir geändert oder neu" ? -1 : 0) - (b.group === "Von dir geändert oder neu" ? -1 : 0)),
	]);
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
	view.showValue(bound.id, bound.address, value);
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
	modules = new ModuleLibrary();
	const { failed } = await modules.refresh((id, i, total) => {
		$("progress").textContent = `Lade Modul ${i + 1} von ${total}: ${id}`;
	});
	$("progress").textContent = failed.length ? `${failed.length} Modul(e) mit Fehler, siehe Statuszeile.` : "Bereit.";
	$("start").disabled = false;
	return failed;
})();
compiled.catch((err) => ($("progress").textContent = `Start fehlgeschlagen: ${err.message}`));

async function start() {
	const failed = await compiled;
	const ctx = new AudioContext({ latencyHint: "interactive" });
	let saveTimer;
	rack = new Rack(ctx, modules.defs, {
		loadSample,
		onRemove: (id) => {
			releaseMidiOut(id);
			forgetWorld(id);
			forgetFeed(id);
		},
		onChange: () => {
			clearTimeout(saveTimer);
			saveTimer = setTimeout(remember, 300);
		},
	});
	view = new RackView(rack, $("rack"), (text) => say(text, true));
	const examples = await fetchJson("patches/index.json");
	const saved = localStorage.getItem(STORE);
	try {
		const shared = await sharedPatch().catch(() => null);
		namePatch(shared ? "" : (localStorage.getItem(NAME) ?? ""));
		if (!shared && !saved) throw new Error("kein gespeicherter Patch");
		await rack.load(shared ?? JSON.parse(saved));
	} catch {
		await rack.load(await fetchJson(`patches/${examples[0].file}`));
	}
	view.render();
	reportFailures(failed);
	drawScope();
	setTimeout(pollModules, POLL_MS);
	// Once allowed, MIDI comes back on its own; the first time needs the button because the browser asks.
	navigator.permissions?.query({ name: "midi" }).then((permission) => permission.state === "granted" && connectMidi(), () => {});
	window.faustRack = { rack, view, library: modules, openPatch, history, shareLink, editModule };
	$("start").textContent = "Weiter";
	$("bar").inert = false;
}

let started;
$("help").addEventListener("cancel", (e) => $("start").disabled && e.preventDefault());
$("help").addEventListener("close", () => (started ??= start().catch((err) => say(`Start fehlgeschlagen: ${err.message}`, true))));
$("help").showModal();

$("btn-help").addEventListener("click", () => $("help").showModal());
$("btn-add").addEventListener("click", () => {
	const defs = [...modules.defs.values()];
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
	const share = async () => {
		const link = await shareLink();
		try {
			await navigator.clipboard.writeText(link);
			say("Link kopiert. Wer ihn öffnet, bekommt diesen Patch.");
		} catch {
			prompt("Link zum Kopieren:", link);
		}
	};
	pick("Patches", [
		{ name: "Unter neuem Namen speichern …", description: "Legt eine Kopie des Patches unter einem eigenen Namen ab, in diesem Browser.", run: () => savePatch("") },
		{ name: "Link zum Teilen kopieren", description: "Der Link enthält den ganzen Patch.", run: share },
		...Object.entries(library.all()).map(([name, patch]) => ({ group: "Meine Patches", name, description: `${patch.modules.length} Module`, run: () => openPatch(patch, name), remove: () => library.remove(name) })),
		...examples.map((ex) => ({ ...ex, group: "Beispiele", run: async () => openPatch(await fetchJson(`patches/${ex.file}`)) })),
		{ group: "Beispiele", name: "Leeres Rack", description: "Alles entfernen und neu anfangen.", run: () => openPatch({ format: "faust-rack/1", modules: [], cables: [] }) },
	]);
});
function download(blob, name) {
	const url = URL.createObjectURL(blob);
	h("a", { href: url, download: name }).click();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Breeding: four children of the patch with nudged knobs to listen through. Nehmen makes the
// one that plays the parent of four new ones. Listening does not fill the undo stack.
const breeding = { parent: null, children: [] };
async function audition(patch) {
	await serial(async () => {
		history.restoring = true;
		try {
			await rack.reconcile(patch);
		} finally {
			history.restoring = false;
			view.render();
		}
	});
}
function litter() {
	breeding.children = breed(breeding.parent, modules.defs, Number($("breed-strength").value));
	for (const button of document.querySelectorAll("#breed [data-child]")) button.setAttribute("aria-pressed", "false");
}
function startBreeding() {
	breeding.parent = rack.toJSON();
	litter();
	$("breed").hidden = false;
}
$("breed").addEventListener("click", async (e) => {
	const button = e.target.closest("button");
	if (!button) return;
	const pressed = (which) => {
		for (const other of document.querySelectorAll("#breed [data-child], #breed-parent")) other.setAttribute("aria-pressed", String(other === which));
	};
	if (button.dataset.child) {
		pressed(button);
		return audition(breeding.children[Number(button.dataset.child)]);
	}
	if (button.id === "breed-parent") {
		pressed(button);
		return audition(breeding.parent);
	}
	if (button.id === "breed-keep") {
		breeding.parent = rack.toJSON();
		litter();
		return remember();
	}
	$("breed").hidden = true;
	remember();
});

const exportPatch = () => download(new Blob([JSON.stringify(rack, null, "\t")], { type: "application/json" }), "patch.json");
$("btn-more").addEventListener("click", () =>
	pick("Mehr", [
		{ name: "Züchten", description: "Vier Varianten des Patches mit verdrehten Reglern zum Durchhören. Die beste wird Elternteil der nächsten vier.", run: startBreeding },
		{ name: "Modul-Editor", description: "Den Faust-Code eines Moduls ändern und sofort hören, oder ein eigenes Modul schreiben.", run: openEditor },
		{ name: "Patch als Datei speichern", description: "Lädt den Patch als JSON-Datei herunter.", run: exportPatch },
		{ name: "Patch aus Datei laden", description: "Öffnet eine JSON-Datei mit einem Patch.", run: () => $("file").click() },
	]),
);

let recording = null;
$("btn-record").addEventListener("click", async () => {
	const button = $("btn-record");
	if (!recording) {
		const started = Date.now();
		const tick = () => {
			const seconds = Math.floor((Date.now() - started) / 1000);
			button.textContent = `■ ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
			if (seconds >= MAX_RECORDING_MINUTES * 60) button.click();
		};
		recording = { stop: startRecording(rack.ctx, rack.analyser), timer: setInterval(tick, 500) };
		button.setAttribute("aria-pressed", "true");
		return tick();
	}
	const { stop, timer } = recording;
	recording = null;
	clearInterval(timer);
	button.textContent = "Aufnahme";
	button.setAttribute("aria-pressed", "false");
	try {
		const now = new Date();
		const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes()].map((part) => String(part).padStart(2, "0")).join("-");
		download(await stop(), `rack-${stamp}.wav`);
	} catch (err) {
		say(`Aufnahme fehlgeschlagen: ${err.message}`, true);
	}
});
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
$("btn-save").addEventListener("click", () => savePatch());
// Spielen cycles: rack -> play view. On the play view, Regler wählen goes to the rack to pick knobs, and Spielen comes back.
const showView = (mode) => {
	view.show(mode);
	$("btn-play").setAttribute("aria-pressed", String(mode === "play"));
	$("btn-play").textContent = mode === "pin" ? "Fertig" : "Spielen";
	$("btn-pin").hidden = mode !== "play";
	say(mode === "pin" ? "Tippe die Regler an, die auf die Spielfläche sollen. Ein Stern zeigt die gewählten. Dann „Fertig“." : "", mode === "pin");
};
$("btn-play").addEventListener("click", () => showView(view.staged ? "rack" : "play"));
$("btn-pin").addEventListener("click", () => showView("pin"));
$("btn-undo").addEventListener("click", undo);
$("btn-redo").addEventListener("click", redo);
addEventListener("keydown", (e) => {
	if (!(e.ctrlKey || e.metaKey) || e.code !== "KeyZ" || e.target.closest?.("input, textarea, select")) return;
	e.preventDefault();
	e.shiftKey ? redo() : undo();
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
