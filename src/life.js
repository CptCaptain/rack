import { HEIGHT, MAX_CREATURES, WIDTH, World } from "./life-world.js";

const SCALE = 3;

// Module id -> its world. It lives outside the widget because the rack redraws its panels
// while the world keeps running.
const worlds = new Map();

export function forgetWorld(id) {
	worlds.delete(id);
}

const hue = (warmth) => 220 - warmth * 220;

function draw(canvas, { world, env }) {
	const g = canvas.getContext("2d");
	g.fillStyle = `hsl(${hue(env.climate)} 35% 11%)`;
	g.fillRect(0, 0, canvas.width, canvas.height);
	g.fillStyle = "#9a9eac";
	for (const f of world.food) g.fillRect(f.x * SCALE - 1, f.y * SCALE - 1, 2, 2);
	for (const c of world.creatures) {
		g.fillStyle = `hsl(${hue(c.warmth)} 85% 60%)`;
		g.beginPath();
		g.arc(c.x * SCALE, c.y * SCALE, 2 + c.energy, 0, 2 * Math.PI);
		g.fill();
	}
	g.fillStyle = "#e8e9ee";
	g.font = "11px system-ui, sans-serif";
	g.fillText(`${world.creatures.length} Wesen`, 6, 14);
}

// Module widget "life": runs and draws the world, and turns births and deaths into signals.
// The background shows the climate and a creature's colour shows the climate it is built for.
export function life(def, io) {
	if (!worlds.has(io.id)) worlds.set(io.id, { world: new World(), env: { food: 0.5, climate: 0.5, mutation: 0.3 }, due: 0, ticks: 0, births: [], deaths: 0, high: {}, bang: false });
	const state = worlds.get(io.id);
	const canvas = document.createElement("canvas");
	canvas.className = "life";
	canvas.width = WIDTH * SCALE;
	canvas.height = HEIGHT * SCALE;

	// A gate is high for one tick and low for at least one, so two births in a row stay two pulses.
	const pulse = (label, waiting, onRise = () => {}) => {
		if (state.high[label] || !waiting) {
			if (state.high[label]) io.poke(label, 0);
			state.high[label] = false;
			return false;
		}
		onRise();
		io.poke(label, 1);
		state.high[label] = true;
		return true;
	};

	for (const key of ["food", "climate", "mutation"]) io.onOutput(key, (value) => (state.env[key] = value));
	io.onOutput("reset", (value) => {
		if (value > 0.5 && !state.bang) state.world.populate();
		state.bang = value > 0.5;
	});
	// The module reports its meters about 60 times a second and speed last. That report is the
	// world's clock, so the world keeps its pace when the tab is in the background.
	io.onOutput("speed", (speed) => {
		for (state.due += speed * 2; state.due >= 1; state.due--) {
			const { births, deaths } = state.world.step(state.env);
			state.births.push(...births);
			state.deaths += deaths;
		}
		state.births.splice(0, state.births.length - 8);
		if (pulse("birth", state.births.length, () => io.poke("pitch", state.births[0] * 2 - 1))) state.births.shift();
		if (pulse("death", state.deaths)) state.deaths = Math.min(state.deaths - 1, 8);
		if (++state.ticks % 6 === 0) {
			io.poke("pop", Math.min(1, state.world.creatures.length / (MAX_CREATURES * 0.75)));
			if (state.world.creatures.length) io.poke("gene", state.world.mean("warmth") * 2 - 1);
		}
		if (state.ticks % 2 === 0 && canvas.isConnected) draw(canvas, state);
	});
	return canvas;
}
