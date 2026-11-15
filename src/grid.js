// Two module widgets that edit steps. Each stores its steps as bits of a hidden number,
// so a pattern is saved with the patch like any knob.

const bit = (mask, n) => (mask >> n) & 1;

// "grid": one row of 16 steps per hidden number t1, t2, ... The running step is lit.
export function grid(def, io) {
	const el = document.createElement("div");
	el.className = "grid";
	const tracks = def.controls.filter((c) => /^t\d+$/.test(c.label)).map((c) => c.label);
	const cells = tracks.map((label) =>
		Array.from({ length: 16 }, (_, n) => {
			const cell = document.createElement("button");
			cell.classList.toggle("on", bit(io.value(label), n) === 1);
			cell.addEventListener("click", () => {
				io.set(label, io.value(label) ^ (1 << n));
				cell.classList.toggle("on");
			});
			el.append(cell);
			return cell;
		}),
	);
	let lit = -1;
	io.onOutput("step", (value) => {
		const now = Math.round(value);
		if (now === lit) return;
		for (const row of cells) {
			row[lit]?.classList.remove("now");
			row[now].classList.add("now");
		}
		lit = now;
	});
	return el;
}

// "steps": one button per sequencer step that cycles through play, rest and hold.
// A held step does not start a new note: the note before it runs on into it.
export function steps(def, io) {
	const el = document.createElement("div");
	el.className = "steps";
	const LOOK = [["●", "spielt"], ["–", "Pause"], ["~", "hält den Ton davor"]];
	for (let n = 0; n < 8; n++) {
		const button = document.createElement("button");
		const state = () => (bit(io.value("rests"), n) ? 1 : bit(io.value("holds"), n) ? 2 : 0);
		const show = () => {
			[button.textContent, button.title] = LOOK[state()];
			button.setAttribute("aria-label", `Schritt ${n + 1}: ${button.title}`);
		};
		button.addEventListener("click", () => {
			const next = (state() + 1) % 3;
			const put = (label, on) => io.set(label, on ? io.value(label) | (1 << n) : io.value(label) & ~(1 << n));
			put("rests", next === 1);
			put("holds", next === 2);
			show();
		});
		show();
		el.append(button);
	}
	return el;
}
