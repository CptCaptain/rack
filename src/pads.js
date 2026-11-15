const COUNT = 8;
const FIRST_NOTE = 36;

const sets = new Set();

// Hits pad 1 to 8 on every Pads module. MIDI drum notes start at 36 and wrap every 8.
export function hitPad(note, velocity) {
	const index = (((note - FIRST_NOTE) % COUNT) + COUNT) % COUNT;
	for (const set of sets) set.el.isConnected ? set.press(index, velocity > 0) : sets.delete(set);
}

function typed(e, velocity) {
	const index = Number(e.code.replace("Digit", "")) - 1;
	if (!e.code.startsWith("Digit") || index < 0 || index >= COUNT || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, select, dialog")) return;
	hitPad(FIRST_NOTE + index, velocity);
}
addEventListener("keydown", (e) => typed(e, 1));
addEventListener("keyup", (e) => typed(e, 0));

// Module widget "pads": drives the hidden buttons pad1 to pad8.
export function pads(def, poke) {
	const el = document.createElement("div");
	el.className = "pads";
	const buttons = Array.from({ length: COUNT }, (_, index) => {
		const button = document.createElement("button");
		button.textContent = index + 1;
		button.addEventListener("pointerdown", () => set.press(index, true));
		for (const type of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(type, () => set.press(index, false));
		return button;
	});
	el.append(...buttons);
	const set = {
		el,
		press(index, down) {
			poke(def.controls.find((c) => c.label === `pad${index + 1}`).address, down ? 1 : 0);
			buttons[index].classList.toggle("on", down);
		},
	};
	sets.add(set);
	return el;
}
