// Usage: node scripts/probe.mjs [dir=dist]
// Renders small test patches offline and checks what each module does to the
// numbers: hit counts, scale notes, tuning, levels. Nobody listens here.
import { readdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";

const patch = (modules, cables) => ({
	format: "faust-rack/1",
	modules: [...modules, "output1 Volume=1 Limiter=0"].map((line) => {
		const [id, ...params] = line.split(" ");
		const type = id.replace(/\d+$/, "");
		return { id, type, params: Object.fromEntries(params.map((p) => [`/${type}/${p.split("=")[0]}`, Number(p.split("=")[1])])) };
	}),
	cables: cables.map((line) => {
		const [from, to] = line.split(" > ").map((ref) => [ref.split(".")[0], Number(ref.split(".")[1])]);
		return { from, to };
	}),
});

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const between = (lo, hi) => (v) => v >= lo && v <= hi;
// Clock at 118 BPM: output 1 gives 16 pulses in the 4 s of a render, with the 17th well outside.
// At 120 BPM the 17th pulse lands on the last samples and makes the counts flaky.
const probes = [
	["kick is audible", patch(["clock1 Tempo=118", "kick1"], ["clock1.0 > kick1.0", "kick1.0 > output1.0"]), (r) => r.peak, between(0.3, 1)],
	["snare is audible", patch(["clock1 Tempo=118", "snare1"], ["clock1.0 > snare1.0", "snare1.0 > output1.0"]), (r) => r.peak, between(0.2, 1)],
	["hat is audible", patch(["clock1 Tempo=118", "hat1"], ["clock1.0 > hat1.0", "hat1.0 > output1.0"]), (r) => r.peak, between(0.1, 1)],
	["kick is silent without a trigger", patch(["kick1"], ["kick1.0 > output1.0"]), (r) => r.peak, between(0, 0.001)],
	["euclid 3 of 8 gives 6 hits in 16 clocks", patch(["clock1 Tempo=118", "euclid1"], ["clock1.1 > euclid1.0", "euclid1.0 > output1.0"]), (r) => r.edges, between(6, 6)],
	["euclid 5 of 8 gives 10 hits in 16 clocks", patch(["clock1 Tempo=118", "euclid1 Treffer=5"], ["clock1.1 > euclid1.0", "euclid1.0 > output1.0"]), (r) => r.edges, between(10, 10)],
	["divider /4 passes 4 of 16 clocks", patch(["clock1 Tempo=118", "divider1"], ["clock1.1 > divider1.0", "divider1.2 > output1.0"]), (r) => r.edges, between(4, 4)],
	["divider /3 passes 6 of 16 clocks", patch(["clock1 Tempo=118", "divider1"], ["clock1.1 > divider1.0", "divider1.1 > output1.0"]), (r) => r.edges, between(6, 6)],
	["beat track 1 plays its default steps 1, 5, 9, 13", patch(["clock1 Tempo=118", "beat1"], ["clock1.1 > beat1.0", "beat1.0 > output1.0"]), (r) => r.edges, between(4, 4)],
	["sequencer with every second step a rest sends 8 of 16 gates", patch(["clock1 Tempo=118", "seq1 rests=170"], ["clock1.1 > seq1.0", "seq1.1 > output1.0"]), (r) => r.edges, between(8, 8)],
	["sequencer with every step held sends one long gate", patch(["clock1 Tempo=118", "seq1 holds=255"], ["clock1.1 > seq1.0", "seq1.1 > output1.0"]), (r) => r.edges, between(1, 1)],
	["two held keys of the Poly Keyboard sound as two pitches, C4 and G4, and no E4", { format: "faust-rack/1", modules: [{ id: "polykeys1", type: "polykeys", params: { "/polykeys/gate1": 1, "/polykeys/gate2": 1, "/polykeys/note2": 67 } }, { id: "vco1", type: "vco", params: {} }, { id: "vca1", type: "vca", params: {} }, { id: "output1", type: "output", params: { "/output/Volume": 0.5, "/output/Limiter": 0 } }], cables: [{ from: ["polykeys1", 0], to: ["vco1", 0] }, { from: ["vco1", 0], to: ["vca1", 0] }, { from: ["polykeys1", 1], to: ["vca1", 1] }, { from: ["vca1", 0], to: ["output1", 0] }] }, (r) => Math.min(r.tones[0], r.tones[2]) / Math.max(r.tones[1], 1e-9), between(100, Infinity)],
	["random holds a new value per clock", patch(["clock1 Tempo=118", "random1 Bereich=0.5"], ["clock1.1 > random1.0", "random1.0 > output1.0"]), (r) => r.levels, between(13, 16)],
	["quantizer in major leaves only major-scale notes", patch(["lfo1 Rate=0.5", "quantizer1 Skala=0"], ["lfo1.0 > quantizer1.0", "quantizer1.0 > output1.0"]), (r) => r.offScale, between(0, 0)],
	["quantizer passes several different notes", patch(["lfo1 Rate=0.5", "quantizer1 Skala=0"], ["lfo1.0 > quantizer1.0", "quantizer1.0 > output1.0"]), (r) => r.levels, between(10, 15)],
	["pluck at pitch 0 sounds at C4 (261.6 Hz)", patch(["clock1 Tempo=118", "pluck1"], ["clock1.0 > pluck1.1", "pluck1.0 > output1.0"]), (r) => r.hertz, between(259, 264.5)],
	["pluck one octave up sounds at C5 (523.3 Hz)", patch(["clock1 Tempo=118", "pluck1 Oktave=1"], ["clock1.0 > pluck1.1", "pluck1.0 > output1.0"]), (r) => r.hertz, between(517, 530)],
	["supersaw fills both channels", patch(["supersaw1"], ["supersaw1.0 > output1.1", "supersaw1.1 > output1.2"]), (r) => Math.min(r.peak, r.peakRight), between(0.2, 1)],
	["drive stays within its level", patch(["vco1", "drive1 Drive=50"], ["vco1.0 > drive1.0", "drive1.0 > output1.0"]), (r) => r.peak, between(0.5, 0.62)],
	["crusher at 2 bits leaves 5 levels (-1, -0.5, 0, 0.5, 1)", patch(["vco1", "crusher1 Bits=2 Rate=20000"], ["vco1.0 > crusher1.0", "crusher1.0 > output1.0"]), (r) => r.levels, between(5, 5)],
	["chorus passes signal on both channels", patch(["vco1", "chorus1"], ["vco1.0 > chorus1.0", "chorus1.0 > output1.1", "chorus1.1 > output1.2"]), (r) => Math.min(r.peak, r.peakRight), between(0.5, 1)],
	["phaser passes signal", patch(["vco1", "phaser1"], ["vco1.1 > phaser1.0", "phaser1.0 > output1.0"]), (r) => r.peak, between(0.3, 1)],
	["ringmod of two sines is audible", patch(["vco1", "vco2 Stimmung=7", "ringmod1"], ["vco1.0 > ringmod1.0", "vco2.0 > ringmod1.1", "ringmod1.0 > output1.0"]), (r) => r.peak, between(0.7, 1)],
	["ringmod is silent with one input open", patch(["vco1", "ringmod1"], ["vco1.0 > ringmod1.0", "ringmod1.0 > output1.0"]), (r) => r.peak, between(0, 0.001)],
	["scale halves a sine", patch(["vco1", "scale1 Faktor=0.5"], ["vco1.0 > scale1.0", "scale1.0 > output1.0"]), (r) => r.peak, between(0.49, 0.51)],
	["limiter holds three loud oscillators at its ceiling of 0.7", { format: "faust-rack/1", modules: [{ id: "vco1", type: "vco", params: {} }, { id: "vco2", type: "vco", params: { "/vco/Stimmung": 7 } }, { id: "vco3", type: "vco", params: { "/vco/Oktave": 1 } }, { id: "output1", type: "output", params: { "/output/Volume": 1 } }], cables: [{ from: ["vco1", 2], to: ["output1", 0] }, { from: ["vco2", 2], to: ["output1", 0] }, { from: ["vco3", 1], to: ["output1", 0] }] }, (r) => r.peak, between(0.6, 0.7001)],
	["limiter leaves a quiet sine alone", { format: "faust-rack/1", modules: [{ id: "vco1", type: "vco", params: {} }, { id: "output1", type: "output", params: { "/output/Volume": 0.5 } }], cables: [{ from: ["vco1", 0], to: ["output1", 0] }] }, (r) => r.peak, between(0.49, 0.51)],
	["scale offset shifts a silent input", patch(["scale1 Offset=0.3"], ["scale1.0 > output1.0"]), (r) => r.peak, between(0.29, 0.31)],
];

const dir = process.argv[2] ?? "dist";
const server = await serve(dir);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium" });
const page = await browser.newPage();
const consoleProblems = [];
page.on("console", (msg) => ["error", "warning"].includes(msg.type()) && consoleProblems.push(msg.text()));
page.on("pageerror", (err) => consoleProblems.push(err.message));
// Every module on disk takes part, so a new one can be probed before index.json lists it.
const onDisk = readdirSync(`${dir}/modules`).filter((file) => file.endsWith(".dsp")).map((file) => file.slice(0, -4));
await page.route("**/modules/index.json", (route) => route.fulfill({ json: onDisk }));
await page.goto(`http://localhost:${server.address().port}/`);
await page.click("#start");
await page.waitForFunction(() => window.faustRack);

const render = (data, major) =>
	page.evaluate(
		async ({ data, major }) => {
			const { Rack } = await import("/src/rack.js");
			const rate = 44100;
			const ctx = new OfflineAudioContext(2, rate * 4, rate);
			await new Rack(ctx, window.faustRack.library.defs).load(data);
			const buffer = await ctx.startRendering();
			const [left, right] = [buffer.getChannelData(0), buffer.getChannelData(1)];
			const settled = left.subarray(rate / 2);
			const peakOf = (samples) => samples.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
			let edges = 0;
			for (let i = 1; i < left.length; i++) if (left[i - 1] <= 0.5 && left[i] > 0.5) edges++;
			const levels = new Set();
			let offScale = 0;
			for (let i = 0; i < settled.length; i += 50) {
				levels.add(Math.round(settled[i] * 1000));
				const semis = settled[i] * 12;
				const near = Math.round(semis);
				if (Math.abs(semis - near) > 0.02 || !major.includes(((near % 12) + 12) % 12)) offScale++;
			}
			// Pitch by autocorrelation, 0.1 s after the trigger at 0.5 s, refined between lags.
			const frame = left.subarray(rate * 0.6, rate * 0.6 + 8192);
			const corr = (lag) => {
				let sum = 0;
				for (let i = 0; i + lag < frame.length; i++) sum += frame[i] * frame[i + lag];
				return sum;
			};
			let best = 40;
			for (let lag = 40; lag < 400; lag++) if (corr(lag) > corr(best)) best = lag;
			const [a, b, c] = [corr(best - 1), corr(best), corr(best + 1)];
			const hertz = rate / (best + (a - c) / (2 * (a - 2 * b + c)));
			// How strongly each of C4, E4 and G4 is in the sound (Goertzel).
			const tones = [261.63, 329.63, 392.0].map((hz) => {
				const k = 2 * Math.cos((2 * Math.PI * hz) / rate);
				let [a, b] = [0, 0];
				for (const v of settled) [a, b] = [v + k * a - b, a];
				return Math.sqrt(a * a + b * b - k * a * b) / settled.length;
			});
			return { tones, peak: peakOf(settled), peakRight: peakOf(right.subarray(rate / 2)), finite: left.every(Number.isFinite), edges, levels: levels.size, offScale, hertz };
		},
		{ data, major },
	);

let failed = 0;
for (const [name, data, pick, ok] of probes) {
	const result = await render(data, MAJOR);
	const value = pick(result);
	const pass = result.finite && ok(value);
	if (!pass) failed++;
	console.log(`${pass ? "ok  " : "FAIL"} ${name}: ${Number(value.toFixed(3))}${result.finite ? "" : " (non-finite samples)"}`);
}
// Mute: a sine at full level is muted half a second into an offline render. A hard cut would
// jump by up to the full level between two samples; a fade must stay near the sine's own slope.
const muteFade = await page.evaluate(async () => {
	const { Rack } = await import("/src/rack.js");
	const rate = 44100;
	const ctx = new OfflineAudioContext(2, rate, rate);
	const rack = new Rack(ctx, window.faustRack.library.defs);
	await rack.load({
		format: "faust-rack/1",
		modules: [{ id: "vco1", type: "vco", params: {} }, { id: "output1", type: "output", params: { "/output/Volume": 1, "/output/Limiter": 0 } }],
		cables: [{ from: ["vco1", 0], to: ["output1", 0] }],
	});
	ctx.suspend(0.5).then(() => {
		rack.setMuted("vco1", true);
		ctx.resume();
	});
	const data = (await ctx.startRendering()).getChannelData(0);
	const at = Math.round(0.5 * rate);
	const jump = (from, to) => {
		let max = 0;
		for (let i = from + 1; i < to; i++) max = Math.max(max, Math.abs(data[i] - data[i - 1]));
		return max;
	};
	let lastSound = at;
	for (let i = at; i < data.length; i++) if (data[i] !== 0) lastSound = i;
	const level = (from, to) => data.subarray(from, to).reduce((max, v) => Math.max(max, Math.abs(v)), 0);
	return { before: level(at - 4410, at), fadeMs: ((lastSound - at) / rate) * 1000, jumpInFade: jump(at - 2, at + 2000), jumpOfSine: jump(at - 4410, at - 2), after: level(at + 2000, data.length) };
});
const fadeOk = muteFade.before > 0.9 && muteFade.fadeMs > 5 && muteFade.fadeMs < 20 && muteFade.jumpInFade < muteFade.jumpOfSine * 1.5 && muteFade.after === 0;
if (!fadeOk) failed++;
console.log(`${fadeOk ? "ok  " : "FAIL"} mute fades a full-level sine to exact silence in ${muteFade.fadeMs.toFixed(1)} ms without a step: largest jump ${muteFade.jumpInFade.toFixed(4)} per sample, the sine alone ${muteFade.jumpOfSine.toFixed(4)}`);

// The Leben module's world, without sound: does selection work, and does it need mutation?
const life = await page.evaluate(async () => {
	const { World } = await import("/src/life-world.js");
	const lag = (mutation, climateAt, steps) => {
		const world = new World(1);
		let off = 0;
		let counted = 0;
		for (let i = 0; i < steps; i++) {
			const climate = climateAt(i);
			world.step({ food: 0.5, climate, mutation });
			if (i < 1000 || !world.creatures.length) continue;
			off += Math.abs(world.mean("warmth") - climate);
			counted++;
		}
		return off / counted;
	};
	const seasons = (i) => 0.5 + 0.3 * Math.sin((i / 6000) * 2 * Math.PI);
	// Starve everything, then let it rain food in a warm climate and watch what comes back.
	const world = new World(1);
	while (world.creatures.length) world.step({ food: 0, climate: 0.1, mutation: 0.3 });
	const foodLeft = world.food.length;
	let reborn;
	for (let i = 0; i < 200 && !world.creatures.length; i++) reborn = world.step({ food: 0, climate: 0.9, mutation: 0.3 });
	const pioneer = { count: world.creatures.length, warmth: world.creatures[0]?.warmth, births: reborn.births.join(), foodKept: world.food.length === foodLeft };
	for (let i = 0; i < 4000; i++) world.step({ food: 0.5, climate: 0.9, mutation: 0.3 });
	return { steady: lag(0.3, () => 0.8, 8000), evolving: lag(0.8, seasons, 12000), frozen: lag(0, seasons, 12000), pioneer, regrown: world.creatures.length };
});
const rebirth = life.pioneer.count === 1 && life.pioneer.warmth === 0.9 && life.pioneer.births === "0.9" && life.pioneer.foodKept && life.regrown > 5;
if (!rebirth) failed++;
console.log(`${rebirth ? "ok  " : "FAIL"} after an extinction one creature is born that fits the climate, and it repopulates the world: ${JSON.stringify(life.pioneer)}, ${life.regrown} creatures 4000 steps later`);
for (const [name, value, ok] of [
	["life in a steady warm climate carries the matching gene (distance)", life.steady, between(0, 0.08)],
	["life with mutation follows slow seasons (distance)", life.evolving, between(0, 0.1)],
	["life without mutation falls behind the same seasons (distance)", life.frozen, between(0.25, 1)],
]) {
	if (!ok(value)) failed++;
	console.log(`${ok(value) ? "ok  " : "FAIL"} ${name}: ${value.toFixed(3)}`);
}
if (consoleProblems.length) {
	failed++;
	console.log(`FAIL console: ${consoleProblems.join(" | ")}`);
}
await browser.close();
server.close();
console.log(failed ? `\n${failed} problem(s)` : "\nall good");
process.exit(failed ? 1 : 0);
