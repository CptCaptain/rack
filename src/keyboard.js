const FIRST = 60;
const LAST = 84;
const BLACK = [1, 3, 6, 8, 10];
// Physical key positions, so the layout is the same on QWERTZ and QWERTY.
const CODES = ["KeyA", "KeyW", "KeyS", "KeyE", "KeyD", "KeyF", "KeyT", "KeyG", "KeyY", "KeyH", "KeyU", "KeyJ", "KeyK", "KeyO", "KeyL"];

const boards = new Set();

function typed(e, action) {
	const note = CODES.indexOf(e.code);
	if (note < 0 || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, select, dialog")) return;
	e.preventDefault();
	for (const board of boards) board.el.isConnected ? board[action](FIRST + note) : boards.delete(board);
}
addEventListener("keydown", (e) => typed(e, "down"));
addEventListener("keyup", (e) => typed(e, "up"));

// Module widget "keyboard": drives the hidden controls labelled gate and note.
export function keyboard(def, poke) {
	const address = (label) => def.controls.find((c) => c.label === label)?.address;
	const [gate, note] = [address("gate"), address("note")];
	const el = document.createElement("div");
	el.className = "keys";
	const keys = new Map();
	let whites = 0;
	for (let n = FIRST; n <= LAST; n++) {
		const key = document.createElement("i");
		key.dataset.note = n;
		if (BLACK.includes(n % 12)) {
			key.className = "black";
			key.style.setProperty("--at", whites);
		} else whites++;
		keys.set(n, key);
		el.append(key);
	}
	el.style.setProperty("--whites", whites);

	const held = [];
	const sync = () => {
		if (held.length) poke(note, held.at(-1));
		poke(gate, held.length ? 1 : 0);
		for (const [n, key] of keys) key.classList.toggle("on", held.includes(n));
	};
	const board = {
		el,
		down(n) {
			if (held.includes(n)) return;
			held.push(n);
			sync();
		},
		up(n) {
			const i = held.indexOf(n);
			if (i < 0) return;
			held.splice(i, 1);
			sync();
		},
	};
	boards.add(board);

	const fingers = new Map();
	const touch = (e) => {
		const n = Number(document.elementFromPoint(e.clientX, e.clientY)?.dataset.note);
		if (!keys.has(n) || fingers.get(e.pointerId) === n) return;
		board.up(fingers.get(e.pointerId));
		fingers.set(e.pointerId, n);
		board.down(n);
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
