const FIRST = 60;
const LAST = 84;
const BLACK = [1, 3, 6, 8, 10];
// Physical key positions, so the layout is the same on QWERTZ and QWERTY.
const CODES = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL"];

const boards = new Set();
const each = (action) => {
	for (const board of boards) board.el.isConnected ? action(board) : boards.delete(board);
};

// Plays every Keyboard module in the rack: from the computer keys here, from MIDI in main.js.
export const keys = {
	play: (note, velocity = 0.8) => each((board) => (velocity > 0 ? board.down(note, velocity) : board.up(note))),
	bend: (value) => each((board) => board.set("bend", value)),
	mod: (value) => each((board) => board.set("mod", value)),
};

function typed(e, velocity) {
	const note = CODES.indexOf(e.code);
	if (note < 0 || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, select, dialog")) return;
	e.preventDefault();
	keys.play(FIRST + note, velocity);
}
addEventListener("keydown", (e) => typed(e, 0.8));
addEventListener("keyup", (e) => typed(e, 0));

// Module widget "keyboard": drives the hidden controls gate, note, vel, bend and mod.
export function keyboard(def, io) {
	const set = io.poke;
	const el = document.createElement("div");
	el.className = "keys";
	const keyEls = new Map();
	let whites = 0;
	for (let n = FIRST; n <= LAST; n++) {
		const key = document.createElement("i");
		key.dataset.note = n;
		if (BLACK.includes(n % 12)) {
			key.className = "black";
			key.style.setProperty("--at", whites);
		} else whites++;
		keyEls.set(n, key);
		el.append(key);
	}

	const held = [];
	const light = (notes) => {
		for (const [n, key] of keyEls) key.classList.toggle("on", notes.includes(n));
	};
	const sync = () => {
		if (held.length) set("note", held.at(-1));
		set("gate", held.length ? 1 : 0);
		light(held);
	};
	// One voice: the newest key sounds, and letting go falls back to a key still held.
	const mono = {
		down(n, velocity) {
			if (held.includes(n)) return;
			held.push(n);
			set("vel", velocity);
			sync();
		},
		up(n) {
			const i = held.indexOf(n);
			if (i < 0) return;
			held.splice(i, 1);
			sync();
		},
	};
	// Several voices (controls gate1, note1, vel1, ...): each key gets the voice that has been
	// free the longest. With every voice busy, a new key takes over the oldest one.
	const voices = def.controls.filter((c) => /^gate\d+$/.test(c.label)).map((_, i) => ({ number: i + 1, note: null, since: 0 }));
	let time = 0;
	const poly = {
		down(n, velocity) {
			if (voices.some((v) => v.note === n)) return;
			const byAge = [...voices].sort((a, b) => a.since - b.since);
			const voice = byAge.find((v) => v.note === null) ?? byAge[0];
			Object.assign(voice, { note: n, since: ++time });
			set(`note${voice.number}`, n);
			set(`vel${voice.number}`, velocity);
			set(`gate${voice.number}`, 1);
			light(voices.map((v) => v.note));
		},
		up(n) {
			const voice = voices.find((v) => v.note === n);
			if (!voice) return;
			Object.assign(voice, { note: null, since: ++time });
			set(`gate${voice.number}`, 0);
			light(voices.map((v) => v.note));
		},
	};
	const board = { el, set, ...(voices.length ? poly : mono) };
	boards.add(board);

	const fingers = new Map();
	const touch = (e) => {
		const n = Number(document.elementFromPoint(e.clientX, e.clientY)?.dataset.note);
		if (!keyEls.has(n) || fingers.get(e.pointerId) === n) return;
		board.up(fingers.get(e.pointerId));
		fingers.set(e.pointerId, n);
		board.down(n, 0.8);
	};
	const lift = (e) => {
		board.up(fingers.get(e.pointerId));
		fingers.delete(e.pointerId);
	};
	el.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		el.setPointerCapture(e.pointerId);
		touch(e);
	});
	el.addEventListener("pointermove", (e) => fingers.has(e.pointerId) && touch(e));
	el.addEventListener("pointerup", lift);
	el.addEventListener("pointercancel", lift);
	return el;
}
