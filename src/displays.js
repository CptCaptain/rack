// Live displays: a small picture in every module and a light in every jack.
//
// Nothing here runs on the audio thread. Every module output has a native AnalyserNode
// (rack.js), and one loop for the whole rack reads them at most 30 times a second, only
// for modules that are on screen. An input has no analyser: it shows what its cables carry.

const FRAME_MS = 30;
const WINDOW = 1024;
const HISTORY = 90;
const BACKGROUND = "#0d0e11";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// How brightly a jack glows for a signal of its kind.
const glow = {
	audio: ({ peak }) => Math.sqrt(Math.min(1, peak)),
	cv: ({ last }) => Math.min(1, Math.abs(last)),
	gate: ({ last }) => (last > 0.5 ? 1 : 0),
};

function line(g, points, color) {
	g.beginPath();
	points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
	g.strokeStyle = color;
	g.stroke();
}

// Sound as a standing wave, a control signal as the last three seconds of its value.
function scope({ g, w, h, def, state, read, color, used }) {
	// The output that is in use says most about the module: a VCO patched from Säge shows a saw.
	const first = (test) => def.outputs.findIndex(test);
	const port = Math.max(0, [first((out, i) => used(i) && out.kind === "audio"), first((_, i) => used(i)), first((out) => out.kind === "audio")].find((i) => i >= 0) ?? 0);
	const kind = def.speakers ? "audio" : def.outputs[port].kind;
	state.wave ??= new Float32Array(WINDOW);
	const { last, peak } = read(port, state.wave);
	state.level = peak;
	if (kind === "audio") {
		let start = 1;
		while (start < WINDOW / 2 && !(state.wave[start - 1] < 0 && state.wave[start] >= 0)) start++;
		line(g, Array.from({ length: w }, (_, x) => [x, h / 2 - clamp(state.wave[start + Math.floor((x * WINDOW) / 2 / w)], -1, 1) * (h / 2 - 2)]), color);
		return;
	}
	state.history ??= new Float32Array(HISTORY);
	state.history.copyWithin(0, 1);
	state.history[HISTORY - 1] = last;
	const range = state.history.reduce((max, v) => Math.max(max, Math.abs(v)), 1);
	const low = kind === "gate" ? 0 : -range;
	const y = (v) => h - 3 - ((v - low) / (range - low)) * (h - 6);
	line(g, Array.from(state.history, (v, i) => [[(i * w) / HISTORY, y(v)], [((i + 1) * w) / HISTORY, y(v)]]).flat(), color);
}

// The envelope as its knobs shape it, and a dot where it is right now.
function adsr({ g, w, h, state, param, read, input, color }) {
	const [a, d, s, r] = ["Attack", "Decay", "Sustain", "Release"].map(param);
	const env = read(0).last;
	const gate = input(0) > 0.5;
	// Short times would vanish on a linear axis, so each segment's width grows with the root of its time.
	const widths = [Math.sqrt(a), Math.sqrt(d), 0.6, Math.sqrt(r)];
	const scale = (w - 8) / widths.reduce((sum, v) => sum + v, 0);
	const xa = 4 + widths[0] * scale;
	const xd = xa + widths[1] * scale;
	const xs = xd + widths[2] * scale;
	const xr = xs + widths[3] * scale;
	const y = (v) => h - 4 - v * (h - 8);
	line(g, [[4, y(0)], [xa, y(1)], [xd, y(s)], [xs, y(s)], [xr, y(0)]], color);

	if (gate && !state.gate) state.phase = "attack";
	else if (!gate && state.gate) [state.phase, state.from] = ["release", Math.max(env, 0.001)];
	else if (state.phase === "attack" && (env >= 0.99 || env < state.env)) state.phase = "decay";
	else if (state.phase === "decay" && env <= s + 0.01) state.phase = "sustain";
	else if (state.phase === "release" && env < 0.001) state.phase = "idle";
	[state.gate, state.env] = [gate, env];
	state.phase ??= "idle";
	const x = {
		attack: 4 + (xa - 4) * env,
		decay: xa + (xd - xa) * clamp((1 - env) / (1 - s || 1), 0, 1),
		sustain: (xd + xs) / 2,
		release: xs + (xr - xs) * (1 - clamp(env / state.from, 0, 1)),
	}[state.phase] ?? 4;
	g.fillStyle = "#fff";
	g.beginPath();
	g.arc(x, y(env), 3, 0, 2 * Math.PI);
	g.fill();
}

// The filter's response over 20 Hz to 20 kHz. The line marks the cutoff, CV input included.
function filter({ g, w, h, state, param, input, color }) {
	const cutoff = clamp(param("Cutoff") * 2 ** (input(1) * param("CV-Anteil") * 5), 20, 15000);
	const q = 0.7 + param("Resonanz") ** 2 * 8;
	state.cutoff = cutoff;
	const x = (hz) => (Math.log10(hz / 20) / 3) * w;
	const y = (db) => clamp(h * 0.3 - (db / 48) * h * 0.7, 2, h - 2);
	const curve = Array.from({ length: w }, (_, px) => {
		const ratio = (20 * 10 ** ((px / w) * 3)) / cutoff;
		// A resonant two-pole lowpass, made steeper above the cutoff like the ladder's four poles.
		const gain = 1 / Math.sqrt((1 - ratio ** 2) ** 2 + (ratio / q) ** 2) / Math.sqrt(1 + ratio ** 4);
		return [px, y(20 * Math.log10(gain))];
	});
	line(g, curve, color);
	line(g, [[x(cutoff), 2], [x(cutoff), h - 2]], "#fff");
}

const DISPLAYS = { scope, adsr, filter };

export class Displays {
	constructor(rack, root) {
		this.rack = rack;
		this.items = new Map();
		// What a display remembers between frames, by module id. It outlives a redraw of the panels.
		this.states = new Map();
		this.frames = 0;
		this.spentMs = 0;
		this.scratch = new Float32Array(WINDOW);
		this.samples = new Map();
		this.seen = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				const item = this.items.get(entry.target.dataset.id);
				if (item) item.visible = entry.isIntersecting;
			}
		}, { root });
		let last = 0;
		const loop = (now) => {
			requestAnimationFrame(loop);
			if (now - last < FRAME_MS) return;
			last = now;
			const started = performance.now();
			this.samples.clear();
			for (const item of this.items.values()) if (item.visible) this.#update(item);
			this.frames++;
			this.spentMs += performance.now() - started;
		};
		requestAnimationFrame(loop);
	}

	// Called after the panels were rebuilt.
	reset(sections) {
		this.seen.disconnect();
		this.items.clear();
		for (const section of sections) {
			const inst = this.rack.modules.get(section.dataset.id);
			const canvas = section.querySelector("canvas.display");
			if (canvas) {
				const ratio = Math.min(2, devicePixelRatio);
				canvas.width = canvas.clientWidth * ratio;
				canvas.height = canvas.clientHeight * ratio;
				canvas.getContext("2d").scale(ratio, ratio);
			}
			const lights = (dir) => [...section.querySelectorAll(`.jack[data-dir="${dir}"] i`)];
			this.items.set(inst.id, { inst, canvas, ins: lights("in"), outs: lights("out"), visible: false, drawn: 0 });
			if (!this.states.has(inst.id)) this.states.set(inst.id, {});
			this.seen.observe(section);
		}
		for (const id of this.states.keys()) if (!this.items.has(id)) this.states.delete(id);
	}

	// The newest sample and the peak of one module output, read once per frame however often it is asked for.
	#sample(inst, port, into) {
		const key = `${inst.id} ${port}`;
		if (!into && this.samples.has(key)) return this.samples.get(key);
		const buffer = into ?? this.scratch;
		inst.taps[port].getFloatTimeDomainData(buffer);
		let peak = 0;
		for (let i = 0; i < WINDOW; i++) peak = Math.max(peak, Math.abs(buffer[i]));
		const sample = { last: buffer[WINDOW - 1], peak };
		this.samples.set(key, sample);
		return sample;
	}

	#update(item) {
		const { inst, canvas } = item;
		const { def } = inst;
		const light = (el, level) => {
			const lit = Math.round(level * 8) / 8;
			if (el.lit === lit) return;
			el.lit = lit;
			el.style.setProperty("--lit", lit);
		};
		const arriving = (port) => this.rack.cables.filter((c) => c.to[0] === inst.id && c.to[1] === port).map((c) => this.#sample(this.rack.modules.get(c.from[0]), c.from[1]));
		def.outputs.forEach((out, port) => light(item.outs[port], glow[out.kind](this.#sample(inst, port))));
		def.inputs.forEach((input, port) => light(item.ins[port], Math.max(0, ...arriving(port).map(glow[input.kind]))));
		item.drawn++;
		if (!canvas) return;
		const g = canvas.getContext("2d");
		const [w, h] = [canvas.clientWidth, canvas.clientHeight];
		g.fillStyle = BACKGROUND;
		g.fillRect(0, 0, w, h);
		g.lineWidth = 1.5;
		const address = (label) => def.controls.find((c) => c.label === label)?.address;
		const wanted = DISPLAYS[def.display] ?? scope;
		const needs = { adsr: ["Attack", "Decay", "Sustain", "Release"], filter: ["Cutoff", "Resonanz", "CV-Anteil"] }[def.display] ?? [];
		(needs.every(address) ? wanted : scope)({
			g, w, h, def,
			state: this.states.get(inst.id),
			color: def.color,
			read: (port, into) => this.#sample(inst, port, into),
			// A control's value as the module has it right now, modulation included.
			param: (label) => inst.node.getParamValue(address(label)),
			input: (port) => arriving(port).reduce((sum, sample) => sum + sample.last, 0),
			used: (port) => [...this.rack.cables, ...this.rack.mods].some((c) => c.from[0] === inst.id && c.from[1] === port),
		});
	}
}
