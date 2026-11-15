// Usage: node scripts/check.mjs [dir=dist] [screenshot=check.png]
// Loads the rack in headless Chromium and fails on any console error, any
// module that does not compile, or any example patch without output signal.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { serve } from "./serve.mjs";

const dir = process.argv[2] ?? "dist";
const shot = process.argv[3] ?? "check.png";
const problems = [];
const check = (ok, text) => {
	console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
	if (!ok) problems.push(text);
};

const server = await serve(dir);
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
	// The fake media device is a beeping microphone, for the Audio In module.
	args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const consoleProblems = [];
page.on("console", (msg) => ["error", "warning"].includes(msg.type()) && consoleProblems.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => consoleProblems.push(`pageerror: ${err.message}`));
// Headless Chromium has no MIDI devices, so one fake input stands in. fakeMidi(...) sends its bytes.
await page.addInitScript(() => {
	const input = { name: "Test Keys", onmidimessage: null };
	window.fakeMidi = (...bytes) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
	window.midiSent = [];
	const output = { name: "Test Synth", send: (bytes) => window.midiSent.push([...bytes].join(" ")) };
	Object.defineProperty(navigator, "requestMIDIAccess", { value: async () => ({ inputs: new Map([["in", input]]), outputs: new Map([["out", output]]), onstatechange: null }) });
});

const peak = () =>
	page.evaluate(async () => {
		const { analyser } = window.faustRack.rack;
		const data = new Float32Array(analyser.fftSize);
		let max = 0;
		for (let i = 0; i < 20; i++) {
			analyser.getFloatTimeDomainData(data);
			for (const v of data) max = Math.max(max, Math.abs(v));
			await new Promise((r) => setTimeout(r, 50));
		}
		return max;
	});
const center = async (selector) => {
	const box = await page.locator(selector).boundingBox();
	return [box.x + box.width / 2, box.y + box.height / 2];
};
const drag = async (from, to) => {
	await page.mouse.move(...from);
	await page.mouse.down();
	await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
	await page.mouse.move(...to, { steps: 4 });
	await page.mouse.up();
};
const jack = (id, dir, port) => `.jack[data-module="${id}"][data-dir="${dir}"][data-port="${port}"] i`;

try {
	const t0 = Date.now();
	await page.goto(url);
	await page.waitForSelector("#start:not([disabled])", { timeout: 180_000 });
	console.log(`compile time: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
	await page.click("#start");
	await page.waitForFunction(() => window.faustRack, null, { timeout: 60_000 });
	const coldMs = Date.now() - t0;
	const t1 = Date.now();
	await page.reload();
	await page.waitForSelector("#start:not([disabled])", { timeout: 180_000 });
	const warmMs = Date.now() - t1;
	const compilerLoaded = await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("libfaust-wasm")));
	check(!compilerLoaded, `the second start takes its modules from the browser's store and does not load the compiler: ready after ${warmMs} ms, the first start took ${coldMs} ms`);
	await page.click("#start");
	await page.waitForFunction(() => window.faustRack, null, { timeout: 60_000 });

	const ids = JSON.parse(readFileSync(`${dir}/modules/index.json`, "utf8"));
	const state = await page.evaluate(() => ({
		compiled: [...window.faustRack.library.defs.keys()],
		failures: [...window.faustRack.library.failures].map(([id, f]) => `${id}: ${f.message}`),
		controls: Object.fromEntries([...window.faustRack.library.defs].map(([id, def]) => [id, def.controls.map((c) => `${c.address} (${c.type})`)])),
		context: `${window.faustRack.rack.ctx.state}, ${window.faustRack.rack.ctx.sampleRate} Hz, base latency ${(window.faustRack.rack.ctx.baseLatency * 1000).toFixed(1)} ms`,
	}));
	console.log(`audio context: ${state.context}`);
	for (const [id, controls] of Object.entries(state.controls)) console.log(`  ${id}: ${controls.join(", ")}`);
	check(state.failures.length === 0, `no module failed to compile ${state.failures.join(" | ")}`);
	check(ids.every((id) => state.compiled.includes(id)), `all ${ids.length} modules compiled`);

	const examples = JSON.parse(readFileSync(`${dir}/patches/index.json`, "utf8"));
	for (const { file, name } of examples.toReversed()) {
		const data = JSON.parse(readFileSync(`${dir}/patches/${file}`, "utf8"));
		await page.evaluate((patch) => window.faustRack.openPatch(patch), data);
		const played = data.modules.some((m) => m.type === "keyboard" || m.type === "polykeys");
		if (played) await page.keyboard.down("d");
		await page.waitForTimeout(800);
		const level = await peak();
		if (played) await page.keyboard.up("d");
		check(level > 0.005 && level <= 1, `patch "${name}" reaches the output, peak ${level.toFixed(3)}`);
	}

	await page.evaluate((patch) => window.faustRack.openPatch(patch), JSON.parse(readFileSync(`${dir}/patches/leben.json`, "utf8")));
	await page.waitForTimeout(3000);
	const alive = await page.evaluate(() => {
		const pixels = document.querySelector("canvas.life").getContext("2d").getImageData(0, 0, 300, 180).data;
		const colors = new Set();
		for (let i = 0; i < pixels.length; i += 4) colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
		const node = window.faustRack.rack.modules.get("life1").node;
		return { colors: colors.size, pop: node.getParamValue("/life/pop") };
	});
	check(alive.colors > 5 && alive.pop > 0, `the Leben module draws its world and reports a population (${alive.colors} colours, pop ${alive.pop.toFixed(2)})`);

	const first = JSON.parse(readFileSync(`${dir}/patches/${examples[0].file}`, "utf8"));
	await page.evaluate((patch) => window.faustRack.openPatch(patch), first);
	await page.waitForTimeout(800);
	const cables = () => page.evaluate(() => window.faustRack.rack.cables.length);
	await page.screenshot({ path: shot });
	await page.setViewportSize({ width: 390, height: 800 });
	await page.screenshot({ path: shot.replace(/\.png$/, "-mobile.png") });
	await page.setViewportSize({ width: 1500, height: 900 });
	console.log(`screenshots: ${shot} and -mobile.png`);

	const outIn = await center(jack("output1", "in", 0));
	await drag(outIn, [outIn[0], outIn[1] - 200]);
	check((await cables()) === first.cables.length - 1, "dragging a cable off its input removes it");
	await page.waitForTimeout(2500);
	check((await peak()) < 0.001, "output is silent without that cable");
	await drag(await center(jack("delay1", "out", 0)), outIn);
	check((await cables()) === first.cables.length, "dragging from output jack to input jack adds a cable");
	check((await peak()) > 0.005, "signal is back");

	// A tap takes a cable into the hand. It must be visible, easy to put away, and never linger:
	// an invisible, lingering version of this once plugged cables nobody asked for.
	const holding = async () => (await page.locator(".jack.held").count()) + (await page.locator(".cables .loose").count()) + ((await page.locator(".banner").isVisible()) ? 1 : 0);
	await page.click(jack("vco1", "out", 0));
	check((await holding()) === 3, `a tap on a jack shows the cable in the hand: ${await page.textContent(".banner span")}`);
	await page.mouse.click(700, 700);
	await page.click(jack("output1", "in", 1));
	check((await cables()) === first.cables.length && (await holding()) === 3, "a tap beside the modules puts it away, so the next jack starts a new cable");
	await page.keyboard.press("Escape");
	check((await holding()) === 0, "Escape puts it away");
	await page.evaluate(() => (window.faustRack.view.holdMs = 400));
	await page.click(jack("vco1", "out", 2));
	await page.waitForTimeout(700);
	await page.click(jack("vcf1", "in", 1));
	await page.keyboard.press("Escape");
	check((await cables()) === first.cables.length, "a cable left in the hand goes back by itself and plugs nothing later");
	await page.evaluate(() => (window.faustRack.view.holdMs = 12000));
	await page.click(jack("vco1", "out", 0));
	await page.click(jack("output1", "in", 1));
	check((await cables()) === first.cables.length + 1 && (await holding()) === 0, "a tap on a jack of the other kind plugs the held cable");

	// Phone: the rack is taller than the screen, so the two ends of a cable are never both visible.
	await page.setViewportSize({ width: 390, height: 700 });
	const scrollTop = () => page.evaluate(() => document.getElementById("rack").scrollTop);
	await page.evaluate(() => document.getElementById("rack").scrollTo(0, 0));
	await page.click(jack("clock1", "out", 2));
	await page.evaluate(() => document.getElementById("rack").scrollTo(0, 1e6));
	const scrolled = await scrollTop();
	await page.click(jack("output1", "in", 2));
	check(scrolled > 500 && (await cables()) === first.cables.length + 2, `on a phone: tap, scroll ${scrolled} px, tap connects`);
	await page.evaluate(() => document.getElementById("rack").scrollTo(0, 0));
	const from = await center(jack("clock1", "out", 0));
	await page.mouse.move(...from);
	await page.mouse.down();
	await page.mouse.move(from[0] + 30, 690, { steps: 5 });
	await page.waitForTimeout(1200);
	const pulled = await scrollTop();
	await page.mouse.up();
	check(pulled > 200 && (await cables()) === first.cables.length + 2, `on a phone: dragging a cable to the edge scrolls the rack (${pulled} px)`);
	await page.setViewportSize({ width: 1500, height: 900 });

	const order = () => page.evaluate(() => [...document.querySelectorAll(".module")].map((el) => el.dataset.id).join(" "));
	const before = (await order()).split(" ");
	await page.click('.module[data-id="clock1"] .move >> nth=1');
	await page.click('.module[data-id="output1"] .move >> nth=0');
	const expected = [before[1], before[0], ...before.slice(2, -2), before.at(-1), before.at(-2)].join(" ");
	const savedOrder = await page.evaluate(() => window.faustRack.rack.toJSON().modules.map((m) => m.id).join(" "));
	check((await order()) === expected && savedOrder === expected && (await peak()) > 0.005, `the arrows reorder modules and the patch keeps playing: ${expected}`);

	await drag(await center('.module[data-id="clock1"] header b'), await page.evaluate(() => {
		const box = document.querySelector('.module[data-id="adsr1"]').getBoundingClientRect();
		return [box.right - 20, box.top + 60];
	}));
	const dropped = (await order()).split(" ");
	check(dropped.indexOf("clock1") === dropped.indexOf("adsr1") + 1, `dragging a module by its name drops it where the pointer is: ${dropped.join(" ")}`);

	const dial = await center('.module[data-id="output1"] .dial');
	await drag(dial, [dial[0], dial[1] - 60]);
	const volume = await page.evaluate(() => Object.values(window.faustRack.rack.modules.get("output1").params)[0]);
	check(volume > 0.25, `dragging the volume knob raises it (${volume})`);
	await page.evaluate((patch) => window.faustRack.openPatch(patch), first);
	await page.waitForTimeout(700);
	await page.reload();
	await page.click("#start");
	await page.waitForFunction(() => window.faustRack?.rack.modules.size, null, { timeout: 60_000 });
	check((await cables()) === first.cables.length, "patch survives a reload (localStorage)");

	// Modulation: a cable dropped on a knob makes the signal move that knob.
	await page.evaluate((patch) => window.faustRack.openPatch(patch), {
		format: "faust-rack/1",
		modules: [{ id: "lfo1", type: "lfo", params: { "/lfo/Rate": 4 } }, { id: "vco1", type: "vco", params: {} }, { id: "output1", type: "output", params: {} }],
		cables: [{ from: ["vco1", 0], to: ["output1", 0] }, { from: ["vco1", 1], to: ["output1", 0] }],
	});
	const knob = (address) => `.module[data-id="vco1"] .control[data-address="${address}"] .dial`;
	const mods = () => page.evaluate(() => window.faustRack.rack.mods.map((m) => `${m.from.join(":")}>${m.to[1]}@${m.depth}`).join(" "));
	await drag(await center(jack("lfo1", "out", 0)), await center(knob("/vco/Stimmung")));
	await page.waitForFunction(() => window.faustRack.rack.mods.length === 1);
	const moving = await page.evaluate(async () => {
		const { rack } = window.faustRack;
		const seen = new Set();
		for (let i = 0; i < 30; i++) {
			seen.add(rack.modules.get("vco1").node.getParamValue("/vco/Stimmung"));
			await new Promise((r) => setTimeout(r, 30));
		}
		return { values: [...seen].sort((a, b) => a - b), base: rack.modules.get("vco1").params["/vco/Stimmung"] ?? "untouched" };
	});
	const dotted = await page.locator(`${knob("/vco/Stimmung")}[data-mod]`).count();
	check(moving.values.length >= 5 && moving.values.every(Number.isInteger) && moving.values[0] >= -6 && moving.values.at(-1) <= 6 && moving.base === "untouched" && dotted === 1, `a cable dropped on a knob modulates it in whole steps, values ${moving.values.join(" ")}, knob itself ${moving.base}`);
	await page.click(jack("lfo1", "out", 1));
	await page.click(knob("/vco/Fein"));
	await page.waitForFunction(() => window.faustRack.rack.mods.length === 2);
	check(true, `tapping an output and then a knob modulates too: ${await mods()}`);

	// Taps a point on a drawn cable that is off every control. Alone: away from all other cables.
	// With beside: where that other cable runs close, as two cables into one jack do.
	const tapPath = async (index, beside) => {
		const point = await page.evaluate(([index, beside]) => {
			const { view } = window.faustRack;
			const root = document.getElementById("rack").getBoundingClientRect();
			const sample = (el) => Array.from({ length: 81 }, (_, i) => el.getPointAtLength((el.getTotalLength() * i) / 80));
			const others = view.paths.filter((_, i) => i !== index).flatMap(({ el }) => sample(el));
			for (const p of sample(view.paths[index].el)) {
				const [x, y] = [root.left + p.x - document.getElementById("rack").scrollLeft, root.top + p.y - document.getElementById("rack").scrollTop];
				const under = document.elementFromPoint(x, y);
				const apart = (list) => Math.min(...list.map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
				const fits = beside === undefined ? apart(others) > 20 : apart(sample(view.paths[beside].el)) < 6;
				if (under && !under.closest(".jack, .control, button, select") && fits) return [x, y];
			}
			return null;
		}, [index, beside]);
		await page.mouse.click(...point);
	};
	await tapPath(2);
	await page.locator(".popover input").fill("-0.5");
	check(/@-0.5/.test(await mods()) && (await page.locator(".cables .selected").count()) === 1, `tapping a modulation cable opens its strength slider: ${await mods()}`);
	await page.click(".popover .row button");
	// An AudioParam reports a new value only after the audio thread has taken it.
	await page.waitForTimeout(150);
	const stillMod = await mods();
	check(stillMod === "lfo1:1>/vco/Fein@0.25" && (await page.evaluate(() => window.faustRack.rack.modules.get("vco1").node.getParamValue("/vco/Stimmung"))) === 0, `removing it leaves the other and puts the knob back: ${stillMod}`);
	await tapPath(0, 1);
	const listed = await page.locator(".popover .row span").allTextContents();
	await page.click('.popover .row:has-text("Säge") button');
	const left = await page.evaluate(() => window.faustRack.rack.cables.map((c) => `${c.from.join(":")}>${c.to.join(":")}`).join(" "));
	check(listed.length === 2 && left === "vco1:0>output1:0", `a tap where two cables run together lists both (${listed.join(" | ")}); removing one leaves ${left}`);
	const stored = await page.evaluate(() => window.faustRack.rack.toJSON());
	await page.evaluate((patch) => window.faustRack.openPatch(patch), stored);
	check((await mods()) === stillMod, "a patch with a modulation loads again");

	// The play view, breeding and the Web module, on the first patch.
	{
		await page.route("**/wetter-test", (route) => route.fulfill({ json: { current: { temperature_2m: 12.5 } } }));
		await page.evaluate((patch) => window.faustRack.openPatch(patch), { ...first, modules: [...first.modules, { id: "web1", type: "web", params: {}, settings: { url: "/wetter-test", min: "0", max: "25" } }] });
		await page.waitForTimeout(700);
		const fetched = await page.evaluate(() => ({ shown: document.querySelector(".web output").textContent, value: window.faustRack.rack.modules.get("web1").node.getParamValue("/web/value") }));
		check(fetched.shown === "12.5" && Math.abs(fetched.value - 0.5) < 0.001, `the Web module fetches a number and scales it: ${fetched.shown} becomes ${fetched.value}`);

		await page.click("#btn-play");
		await page.click("#btn-pin");
		await page.click('.module[data-id="vcf1"] .control[data-address="/vcf/Cutoff"] .dial');
		await page.click('.module[data-id="clock1"] .control[data-address="/clock/Tempo"] .dial');
		await page.click("#btn-play");
		const big = await page.locator(".stage .picked .dial >> nth=0").boundingBox();
		const dial = await center(".stage .picked .dial >> nth=0");
		await drag(dial, [dial[0], dial[1] - 80]);
		const stage = await page.evaluate(() => ({ knobs: document.querySelectorAll(".stage .picked .control").length, panels: document.querySelectorAll(".modules > .module").length, cutoff: window.faustRack.rack.modules.get("vcf1").params["/vcf/Cutoff"], stored: window.faustRack.rack.toJSON().stage.length }));
		await page.click("#btn-play");
		check(stage.knobs === 2 && stage.panels === 0 && stage.stored === 2 && stage.cutoff > 500 && big.width >= 80 && (await page.locator(".modules > .module").count()) === first.modules.length + 1, `the play view shows the 2 picked knobs at ${big.width} px, turning one moves the real knob (Cutoff ${stage.cutoff}), and the rack comes back`);

		await page.click("#btn-more");
		await page.click('#picker button:has-text("Züchten")');
		// Knob values by address, sorted, so two equal settings compare equal whatever order they were set in.
		const knobs = () => page.evaluate(() => JSON.stringify(window.faustRack.rack.toJSON().modules.map((m) => Object.entries(m.params).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)))));
		const parent = await knobs();
		const volume = () => page.evaluate(() => window.faustRack.rack.modules.get("output1").node.getParamValue("/output/Volume"));
		const quiet = await volume();
		await page.click('#breed [data-child="1"]');
		await page.waitForTimeout(300);
		const child = await knobs();
		await page.click("#breed-parent");
		await page.waitForTimeout(300);
		const back = await knobs();
		await page.click('#breed [data-child="2"]');
		await page.click("#breed-keep");
		await page.click("#breed-done");
		const kept = await knobs();
		const loud = await volume();
		check(child !== parent && back === parent && loud === quiet && kept !== parent && (await page.locator("#breed").isHidden()), `breeding offers children with other knob settings, goes back to the parent, keeps one, and leaves the volume alone (${child !== parent} ${back === parent} ${loud} ${quiet} ${kept !== parent})`);
	}

	// The Editor: change a module's program and it is swapped into the running rack. A new module works too.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), { format: "faust-rack/1", modules: [{ id: "vca1", type: "vca", params: {} }], cables: [] });
		await page.click("#btn-more");
		await page.click('#picker button:has-text("Modul-Editor")');
		const noiseFrom = consoleProblems.length;
		await page.click('#picker button:has(b:text-is("VCA"))');
		const code = await page.inputValue("#editor-dsp");
		await page.fill("#editor-dsp", code.replace('"[0]Pegel"', '"[0]Lautheit"'));
		await page.click("#editor-apply");
		await page.waitForFunction(() => document.getElementById("editor-error").textContent === "Läuft.");
		const renamed = await page.locator('.module[data-id="vca1"] .control span:has-text("Lautheit")').count();
		await page.fill("#editor-dsp", "process = kaputt;");
		await page.click("#editor-apply");
		await page.waitForFunction(() => /kaputt/.test(document.getElementById("editor-error").textContent));
		const stillRuns = await page.locator('.module[data-id="vca1"] .control span:has-text("Lautheit")').count();
		await page.click("#editor-reset");
		await page.waitForFunction(() => document.querySelector('.module[data-id="vca1"] .control span')?.textContent === "Pegel");
		page.once("dialog", (dialog) => dialog.accept("eigenes"));
		await page.click("#btn-more");
		await page.click('#picker button:has-text("Modul-Editor")');
		await page.click('#picker button:has-text("Neues Modul")');
		await page.click("#editor-apply");
		await page.waitForFunction(() => window.faustRack.library.defs.has("eigenes"));
		await page.click("#editor-reset");
		// The broken program on purpose wrote to the console. Those lines are not a fault.
		consoleProblems.splice(noiseFrom);
		check(renamed === 1 && stillRuns === 1, "the Editor swaps a changed module into the rack, shows a Faust error while the old version keeps running, resets, and makes a new module");
	}

	// Every module in the menu can be put into a rack, with its panel and display.
	{
		await page.evaluate(() => window.faustRack.openPatch({ format: "faust-rack/1", modules: [], cables: [] }));
		const added = await page.evaluate(async () => {
			const { rack, view, library } = window.faustRack;
			for (const id of library.defs.keys()) await rack.add(id);
			view.render();
			await new Promise((done) => setTimeout(done, 1500));
			return { modules: rack.modules.size, panels: document.querySelectorAll(".module").length, types: library.defs.size };
		});
		check(added.modules === added.types && added.panels === added.types, `all ${added.types} modules can be added side by side`);
		await page.evaluate(() => window.faustRack.openPatch({ format: "faust-rack/1", modules: [], cables: [] }));
	}

	// Sampler: plays the built-in bell, takes a file, and the patch remembers which.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), {
			format: "faust-rack/1",
			modules: [{ id: "clock1", type: "clock", params: {} }, { id: "sampler1", type: "sampler", params: {} }, { id: "output1", type: "output", params: {} }],
			cables: [{ from: ["clock1", 0], to: ["sampler1", 1] }, { from: ["sampler1", 0], to: ["output1", 0] }],
		});
		await page.waitForTimeout(700);
		const bell = await peak();
		// Half a second of a 440 Hz sine as a WAV file, made here.
		const tone = Buffer.alloc(44 + 22050 * 2);
		tone.write("RIFF", 0); tone.writeUInt32LE(36 + 22050 * 2, 4); tone.write("WAVEfmt ", 8); tone.writeUInt32LE(16, 16); tone.writeUInt16LE(1, 20); tone.writeUInt16LE(1, 22);
		tone.writeUInt32LE(44100, 24); tone.writeUInt32LE(88200, 28); tone.writeUInt16LE(2, 32); tone.writeUInt16LE(16, 34); tone.write("data", 36); tone.writeUInt32LE(22050 * 2, 40);
		for (let i = 0; i < 22050; i++) tone.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 44100) * 20000), 44 + i * 2);
		await page.setInputFiles(".sampler input", { name: "ton.wav", mimeType: "audio/wav", buffer: tone });
		await page.waitForFunction(() => document.querySelector(".sampler span")?.textContent === "ton.wav");
		await page.waitForTimeout(900);
		const own = await peak();
		const stored = await page.evaluate(() => window.faustRack.rack.toJSON().modules.find((m) => m.id === "sampler1").sample);
		await page.reload();
		await page.click("#start");
		await page.waitForFunction(() => window.faustRack?.rack.modules.size, null, { timeout: 60_000 });
		check(bell > 0.02 && own > 0.02 && stored === "ton.wav" && (await page.textContent(".sampler span")) === "ton.wav", `the sampler plays its bell (${bell.toFixed(3)}), then a loaded file (${own.toFixed(3)}), and still has the file after a reload`);
	}

	// Polyphony: a cable from the Poly Keyboard makes the modules behind it run once per voice.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), JSON.parse(readFileSync(`${dir}/patches/akkorde.json`, "utf8")));
		const voices = () => page.evaluate(() => [...window.faustRack.rack.modules.values()].map((m) => `${m.id}:${m.voices}`).join(" "));
		const chord = await voices();
		await page.keyboard.down("a");
		await page.keyboard.down("d");
		await page.keyboard.down("g");
		await page.waitForTimeout(500);
		const lit = await page.locator(".keys i.on").count();
		const loud = await peak();
		for (const key of ["a", "d", "g"]) await page.keyboard.up(key);
		await page.evaluate(() => { const { rack } = window.faustRack; rack.disconnect(rack.cables.find((c) => c.from[0] === "polykeys1" && c.to[0] === "vco1")); });
		await page.evaluate(() => window.faustRack.rack.settled);
		check(chord === "polykeys1:4 vco1:4 adsr1:4 vcf1:4 vca1:4 reverb1:1 output1:1" && lit === 3 && loud > 0.02 && /vco1:1 adsr1:4 vcf1:4/.test(await voices()) && (await page.locator(".module .voices").count()) === 4, `a chord of three keys sounds through four voices (${chord}), and a module goes back to one voice when the cable goes: ${await voices()}`);
	}

	// The Beat grid: a tap on a cell changes the track's pattern, and the patch keeps it.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), JSON.parse(readFileSync(`${dir}/patches/beat.json`, "utf8")));
		await page.waitForTimeout(400);
		await page.click(".grid button >> nth=2");
		const pattern = await page.evaluate(() => window.faustRack.rack.toJSON().modules.find((m) => m.id === "beat1").params["/beat/t1"]);
		check(pattern === 4369 + 4 && (await page.locator(".grid button.on").count()) === 5 + 2 + 8 && (await page.locator(".grid button.now").count()) === 4, `a tap on the Beat grid adds a step to the pattern (${pattern}) and the running step is lit`);
		await page.setViewportSize({ width: 390, height: 700 });
		const cell = await page.locator(".grid button >> nth=0").boundingBox();
		const wide = await page.evaluate(() => document.querySelector('.module[data-id="beat1"]').getBoundingClientRect().width);
		await page.setViewportSize({ width: 1500, height: 900 });
		check(cell.width >= 40 && cell.height >= 40 && wide <= 390, `on a phone a Beat cell is ${cell.width}x${cell.height} px and the module is ${Math.round(wide)} px wide`);
	}

	// Named patches and the share link.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), first);
		await page.waitForTimeout(500);
		page.once("dialog", (dialog) => dialog.accept("Mein Test"));
		await page.click("#btn-save");
		const named = await page.textContent("#patch-name");
		let asked = false;
		const refuse = () => (asked = true);
		page.once("dialog", refuse);
		await page.click('.module[data-id="vcf1"] .mute');
		await page.click("#btn-save");
		page.off("dialog", refuse);
		await page.click('.module[data-id="vcf1"] .mute');
		const overwritten = await page.evaluate(() => JSON.parse(localStorage.getItem("faust-rack.patches"))["Mein Test"].modules.find((m) => m.id === "vcf1").muted === true);
		check(named === "Mein Test" && !asked && overwritten, "Speichern asks for a name once, shows it in the bar, and then saves to that name without asking");
		const link = await page.evaluate(() => window.faustRack.shareLink());
		await page.evaluate(() => window.faustRack.openPatch({ format: "faust-rack/1", modules: [], cables: [] }));
		await page.click("#btn-patches");
		await page.click('#picker button:has-text("Mein Test")');
		await page.waitForFunction((n) => window.faustRack.rack.modules.size === n, first.modules.length);
		await page.evaluate(() => window.faustRack.openPatch({ format: "faust-rack/1", modules: [], cables: [] }));
		await page.waitForTimeout(600);
		await page.goto("about:blank");
		await page.goto(link);
		await page.click("#start");
		await page.waitForFunction(() => window.faustRack?.rack.modules.size, null, { timeout: 60_000 });
		const arrived = await page.evaluate(() => ({ cables: window.faustRack.rack.cables.length, hash: location.hash }));
		check(arrived.cables === first.cables.length && arrived.hash === "", `a patch saved under a name loads again, and a share link of ${link.length} characters brings the patch into a rack that had saved an empty one`);
	}

	// Undo and redo. A module that stays is not rebuilt, so the sound goes on.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), first);
		await page.waitForTimeout(700);
		const state = () => page.evaluate(() => `${window.faustRack.rack.cables.length} cables, ${window.faustRack.rack.modules.size} modules`);
		await page.evaluate(() => (window.keptNode = window.faustRack.rack.modules.get("clock1").node));
		const start = await state();
		await page.click('.module[data-id="vcf1"] .close');
		await page.waitForTimeout(600);
		const without = await state();
		await page.keyboard.press("Control+z");
		await page.waitForTimeout(600);
		const undone = await state();
		const kept = await page.evaluate(() => window.keptNode === window.faustRack.rack.modules.get("clock1").node);
		await page.click("#btn-redo");
		await page.waitForTimeout(600);
		const redone = await state();
		await page.click("#btn-undo");
		await page.waitForTimeout(600);
		check(without !== start && undone === start && kept && redone === without && (await state()) === start, `undo brings a removed module back with its cables and redo removes it again: ${start} -> ${without} -> ${undone} -> ${redone}`);
	}

	// Recording: the button records what plays and hands over a WAV file.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), first);
		await page.waitForTimeout(300);
		await page.click("#btn-record");
		await page.waitForTimeout(1600);
		const label = await page.textContent("#btn-record");
		const [file] = await Promise.all([page.waitForEvent("download"), page.click("#btn-record")]);
		const bytes = readFileSync(await file.path());
		const [channels, rate, bits] = [bytes.readUInt16LE(22), bytes.readUInt32LE(24), bytes.readUInt16LE(34)];
		const seconds = (bytes.length - 44) / (rate * channels * 2);
		let loudest = 0;
		for (let at = 44; at + 1 < bytes.length; at += 2) loudest = Math.max(loudest, Math.abs(bytes.readInt16LE(at)) / 32768);
		check(/^■ 0:01$/.test(label) && bytes.toString("latin1", 0, 4) === "RIFF" && /\.wav$/.test(file.suggestedFilename()) && channels === 2 && bits === 16 && seconds > 1.2 && seconds < 2.6 && loudest > 0.02, `recording gives a WAV file: ${file.suggestedFilename()}, ${channels} channels, ${rate} Hz, ${seconds.toFixed(2)} s, peak ${loudest.toFixed(3)}`);
		check((await page.textContent("#btn-record")) === "Aufnahme", "the record button goes back to idle");
	}

	// Live displays, on the first patch: clock, sequencer, VCO, ADSR, VCF, VCA, delay, output.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), first);
		await page.waitForTimeout(500);
		const watch = (ms) =>
			page.evaluate(async (ms) => {
				const { view } = window.faustRack;
				const lit = (id, dir, port) => Number(document.querySelector(`.jack[data-module="${id}"][data-dir="${dir}"][data-port="${port}"] i`).style.getPropertyValue("--lit") || 0);
				const seen = { clockOut: new Set(), seqClockIn: new Set(), vcoOut: new Set(), phases: new Set(), cutoffs: [] };
				const [frames, spent, start] = [view.displays.frames, view.displays.spentMs, performance.now()];
				while (performance.now() - start < ms) {
					seen.clockOut.add(lit("clock1", "out", 1));
					seen.seqClockIn.add(lit("seq1", "in", 0));
					seen.vcoOut.add(lit("vco1", "out", 1));
					seen.phases.add(view.displays.states.get("adsr1").phase);
					seen.cutoffs.push(view.displays.states.get("vcf1").cutoff);
					await new Promise((r) => setTimeout(r, 15));
				}
				const count = view.displays.frames - frames;
				const drawn = (id) => view.displays.items.get(id).drawn;
				return { fps: (count / ms) * 1000, msPerFrame: (view.displays.spentMs - spent) / count, clockOut: [...seen.clockOut], seqClockIn: [...seen.seqClockIn], vcoOut: Math.min(...seen.vcoOut), phases: [...seen.phases].sort(), cutoffLow: Math.min(...seen.cutoffs), cutoffHigh: Math.max(...seen.cutoffs), vcoLevel: view.displays.states.get("vco1").level, drawnFirst: drawn("clock1"), drawnLast: drawn("output1") };
			}, ms);
		const rows = (id) =>
			page.evaluate((id) => {
				// Reads a copy: reading the display itself over and over makes Chromium warn and slows the display.
				const canvas = document.querySelector(`.module[data-id="${id}"] canvas.display`);
				const copy = Object.assign(document.createElement("canvas"), { width: canvas.width, height: canvas.height }).getContext("2d", { willReadFrequently: true });
				copy.drawImage(canvas, 0, 0);
				const { data, width, height } = copy.getImageData(0, 0, canvas.width, canvas.height);
				let rows = 0;
				for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] + data[(y * width + x) * 4 + 1] > 120) { rows++; break; }
				return rows / height;
			}, id);
		const shown = await watch(2000);
		check(shown.fps > 12 && shown.fps <= 34, `one loop draws all displays at ${shown.fps.toFixed(1)} frames a second, ${shown.msPerFrame.toFixed(2)} ms of work per frame for 8 modules`);
		check(shown.clockOut.includes(0) && shown.clockOut.includes(1) && shown.seqClockIn.includes(0) && shown.seqClockIn.includes(1), `gate jacks blink, the clock's output and the sequencer's input alike (${shown.clockOut.join("/")} and ${shown.seqClockIn.join("/")})`);
		check(shown.vcoOut > 0.9 && (await rows("vco1")) > 0.5, `a sounding output glows and the VCO draws its wave over ${Math.round((await rows("vco1")) * 100)} % of the display's height`);
		check(shown.phases.length >= 3 && shown.phases.includes("release"), `the ADSR display's dot walks the envelope: ${shown.phases.join(", ")}`);
		check(shown.cutoffHigh > shown.cutoffLow * 2, `the filter display's cutoff line moves with the envelope: ${Math.round(shown.cutoffLow)} to ${Math.round(shown.cutoffHigh)} Hz`);
		await page.click('.module[data-id="vco1"] .mute');
		await page.waitForTimeout(300);
		const mutedLook = await watch(300);
		check(mutedLook.vcoOut === 0 && mutedLook.vcoLevel === 0 && (await rows("vco1")) < 0.2, "a muted module's jacks go dark and its display goes flat and dim");
		await page.click('.module[data-id="vco1"] .mute');
		await page.setViewportSize({ width: 390, height: 700 });
		await page.evaluate(() => document.getElementById("rack").scrollTo(0, 0));
		await page.waitForTimeout(400);
		const [a, b] = [await watch(50), await watch(800)];
		check(b.drawnFirst > a.drawnFirst + 5 && b.drawnLast === a.drawnLast, `on a phone a module off screen is not drawn (${b.drawnLast - a.drawnLast} frames) while a visible one is (${b.drawnFirst - a.drawnFirst})`);
		await page.setViewportSize({ width: 1500, height: 900 });
	}

	// Long press on a jack: the list of its cables, with selection, keys and a delete button.
	{
		await page.evaluate((patch) => window.faustRack.openPatch(patch), {
			format: "faust-rack/1",
			modules: [{ id: "lfo1", type: "lfo", params: {} }, { id: "vco1", type: "vco", params: {} }, { id: "output1", type: "output", params: {} }],
			cables: [{ from: ["vco1", 0], to: ["output1", 0] }, { from: ["vco1", 1], to: ["output1", 0] }, { from: ["lfo1", 0], to: ["output1", 0] }, { from: ["vco1", 0], to: ["output1", 1] }],
		});
		await page.waitForTimeout(300);
		const press = async (selector, ms) => {
			await page.mouse.move(...(await center(selector)));
			await page.mouse.down();
			await page.waitForTimeout(ms);
			await page.mouse.up();
		};
		const list = () =>
			page.evaluate(() => {
				const { view, rack } = window.faustRack;
				const name = (c) => `${c.from.join(":")}>${c.to.join(":")}`;
				return {
					open: !document.querySelector(".popover").hidden,
					title: document.querySelector(".popover b")?.textContent,
					rows: [...document.querySelectorAll(".popover .row span")].map((el) => el.textContent),
					colours: [...document.querySelectorAll(".popover .swatch")].map((el) => getComputedStyle(el).backgroundColor),
					active: document.querySelector(".popover .row.active span")?.textContent,
					lit: view.paths.filter((entry) => entry.el.classList.contains("selected")).map((entry) => name(entry.item)).join(" "),
					litColour: getComputedStyle(document.querySelector(".cables .selected") ?? document.body).stroke,
					cables: rack.cables.map(name).join(" "),
				};
			});
		await press(jack("output1", "in", 0), 120);
		check((await holding()) === 3 && !(await list()).open, "a short press on a jack still takes a cable into the hand and opens no list");
		await page.keyboard.press("Escape");
		await press(jack("output1", "in", 0), 650);
		let now = await list();
		check(now.open && (await holding()) === 0 && now.title === "Kabel an Output Mono" && now.rows.join(" | ") === "VCO Sinus | VCO Säge | LFO Sinus" && now.colours[0] === now.colours[1] && now.colours[2] !== now.colours[0], `a long press lists the jack's cables by their other end, coloured by kind: ${now.title}: ${now.rows.join(" | ")}`);
		check(now.active === "VCO Sinus" && now.lit === "vco1:0>output1:0" && now.litColour === "rgb(255, 255, 255)", `the chosen entry's cable is highlighted in the rack: ${now.lit}`);
		await page.hover(".popover .row >> nth=1");
		now = await list();
		check(now.active === "VCO Säge" && now.lit === "vco1:1>output1:0", `hovering an entry chooses it: ${now.lit}`);
		await page.keyboard.press("ArrowDown");
		const down = await list();
		await page.keyboard.press("ArrowDown");
		const wrapped = await list();
		await page.keyboard.press("ArrowUp");
		await page.keyboard.press("ArrowUp");
		now = await list();
		check(down.active === "LFO Sinus" && wrapped.active === "VCO Sinus" && now.active === "VCO Säge" && now.lit === "vco1:1>output1:0", "the arrow keys move the choice and wrap around");
		await page.keyboard.press("Delete");
		await page.waitForTimeout(500);
		now = await list();
		const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("faust-rack.patch")).cables.length);
		check(now.open && now.rows.join(" | ") === "VCO Sinus | LFO Sinus" && now.cables === "vco1:0>output1:0 lfo1:0>output1:0 vco1:0>output1:1" && saved === 3, `Delete removes the chosen cable, the list stays open, the patch is saved: ${now.rows.join(" | ")}`);
		await page.keyboard.press("Backspace");
		now = await list();
		check(now.open && now.rows.join(" | ") === "VCO Sinus" && now.cables === "vco1:0>output1:0 vco1:0>output1:1", `Backspace does the same: ${now.rows.join(" | ")} left`);
		const button = await page.locator(".popover .row button").boundingBox();
		await page.click(".popover .row button");
		now = await list();
		check(button.width >= 40 && button.height >= 40 && !now.open && now.cables === "vco1:0>output1:1", `each entry has a delete button of ${button.width}x${button.height} px, and the list closes with its last cable`);
		await press(jack("vco1", "out", 0), 650);
		now = await list();
		await page.keyboard.press("Escape");
		check(now.title === "Kabel an VCO Sinus" && now.rows.join() === "Output L" && !(await list()).open && (await list()).cables === "vco1:0>output1:1", "an output's list names the inputs it feeds, and Escape closes it without removing anything");
		await press(jack("vco1", "out", 2), 650);
		now = await list();
		check(now.open && now.rows.length === 0, "a long press on a jack without cables says so");
		await page.keyboard.press("Escape");
	}

	// Mute: the button in the module header silences everything the module sends, and the patch keeps it.
	const muteButton = (id) => `.module[data-id="${id}"] .mute`;
	const isMuted = (id) => page.evaluate((id) => ({ shown: document.querySelector(`.module[data-id="${id}"]`).classList.contains("muted"), stored: window.faustRack.rack.toJSON().modules.find((m) => m.id === id).muted === true }), id);
	await page.evaluate((patch) => window.faustRack.openPatch(patch), {
		format: "faust-rack/1",
		modules: [{ id: "clock1", type: "clock", params: { "/clock/Tempo": 200 } }, { id: "kick1", type: "kick", params: {} }, { id: "vco1", type: "vco", params: {} }, { id: "output1", type: "output", params: {} }],
		cables: [{ from: ["clock1", 0], to: ["kick1", 0] }, { from: ["vco1", 0], to: ["output1", 0] }],
	});
	await page.waitForTimeout(400);
	const loud = await peak();
	const size = await page.locator(muteButton("vco1")).boundingBox();
	await page.click(muteButton("vco1"));
	await page.waitForTimeout(200);
	const quiet = await peak();
	const muteState = await isMuted("vco1");
	const dimmed = await page.evaluate(() => getComputedStyle(document.querySelector('.module[data-id="vco1"] .controls')).opacity);
	check(loud > 0.05 && quiet === 0 && muteState.shown && muteState.stored && Number(dimmed) < 0.5 && size.width >= 40 && size.height >= 40, `mute silences a module: peak ${loud.toFixed(3)} then ${quiet}, button ${size.width}x${size.height} px, panel opacity ${dimmed}`);
	await page.click(muteButton("vco1"));
	await page.waitForTimeout(200);
	check((await peak()) > 0.05 && !(await isMuted("vco1")).shown && !(await isMuted("vco1")).stored, "a second press brings it back");

	// Gates are muted too: a muted clock stops triggering the kick.
	await page.click(muteButton("vco1"));
	await page.evaluate(() => window.faustRack.rack.connect(["kick1", 0], ["output1", 0]));
	await page.waitForTimeout(300);
	const kicking = await peak();
	await page.click(muteButton("clock1"));
	await page.waitForTimeout(1500);
	const stopped = await peak();
	check(kicking > 0.05 && stopped < 0.001, `a muted clock sends no gates: kick peak ${kicking.toFixed(3)} then ${stopped.toFixed(4)}`);
	await page.click(muteButton("clock1"));
	await page.waitForTimeout(700);
	await page.reload();
	await page.click("#start");
	await page.waitForFunction(() => window.faustRack?.rack.modules.size, null, { timeout: 60_000 });
	await page.click("#btn-midi");
	await page.waitForTimeout(400);
	const kept = { vco: await isMuted("vco1"), clock: await isMuted("clock1"), pressed: await page.getAttribute(muteButton("vco1"), "aria-pressed") };
	const kickOnly = await peak();
	await page.click(muteButton("kick1"));
	await page.waitForTimeout(200);
	check(kept.vco.shown && kept.vco.stored && !kept.clock.shown && kept.pressed === "true" && kickOnly > 0.05 && (await peak()) === 0, `the mute state survives a reload: vco1 still muted, clock1 not, only the kick sounds (${kickOnly.toFixed(3)})`);

	const tastatur = JSON.parse(readFileSync(`${dir}/patches/tastatur.json`, "utf8"));
	const param = (id, address) => page.evaluate(([id, address]) => window.faustRack.rack.modules.get(id).params[address], [id, address]);
	await page.click("#btn-midi");
	check(/Test Keys/.test(await page.textContent("#status")), "the MIDI button connects and names the device");
	await page.evaluate((patch) => window.faustRack.openPatch(patch), tastatur);
	await page.evaluate(() => window.fakeMidi(0x90, 64, 100));
	await page.waitForTimeout(400);
	check((await peak()) > 0.005 && (await page.locator('.keys i[data-note="64"].on').count()) === 1, "a MIDI note plays the Keyboard module");
	await page.evaluate(() => window.fakeMidi(0x80, 64, 0));
	check((await page.locator(".keys i.on").count()) === 0, "note off releases the key");
	await page.click("#btn-learn");
	await page.click('.module[data-id="vcf1"] .control[data-address="/vcf/Cutoff"] .dial');
	await page.evaluate(() => window.fakeMidi(0xb0, 74, 127));
	const high = await param("vcf1", "/vcf/Cutoff");
	await page.evaluate(() => window.fakeMidi(0xb0, 74, 0));
	const low = await param("vcf1", "/vcf/Cutoff");
	const shown = await page.textContent('.module[data-id="vcf1"] .control[data-address="/vcf/Cutoff"] output');
	const badge = await page.getAttribute('.module[data-id="vcf1"] .control[data-address="/vcf/Cutoff"]', "data-cc");
	check(high === 12000 && low === 30 && shown === "30 Hz" && badge === "74", `a learned controller moves its knob (${high}, ${low}, "${shown}", badge ${badge})`);
	await page.click("#btn-learn");
	const saved = await page.evaluate(() => JSON.stringify(window.faustRack.rack.toJSON().midi));
	check(saved === '[{"cc":74,"module":"vcf1","address":"/vcf/Cutoff"}]', `the patch stores the binding ${saved}`);
	await page.evaluate((patch) => window.faustRack.openPatch(patch), {
		format: "faust-rack/1",
		modules: [{ id: "pads1", type: "pads", params: {} }, { id: "kick1", type: "kick", params: {} }, { id: "output1", type: "output", params: {} }],
		cables: [{ from: ["pads1", 0], to: ["kick1", 0] }, { from: ["kick1", 0], to: ["output1", 0] }],
	});
	await page.waitForTimeout(500);
	check((await peak()) < 0.001, "the Pads patch is silent until a pad is hit");
	await page.evaluate(() => window.fakeMidi(0x99, 36, 127));
	const hit = await peak();
	await page.evaluate(() => window.fakeMidi(0x89, 36, 0));
	check(hit > 0.05, `a MIDI pad note on channel 10 triggers the kick, peak ${hit.toFixed(3)}`);

	// Clock at 240 BPM, sequencer steps 0, 4 and 7 semitones, MIDI Out on channel 2: expect C4, E4, G4 in that order.
	await page.evaluate((patch) => window.faustRack.openPatch(patch), {
		format: "faust-rack/1",
		modules: [
			{ id: "clock1", type: "clock", params: { "/clock/Tempo": 240 } },
			{ id: "seq1", type: "seq", params: { "/seq/Stufen": 3, "/seq/2": 4, "/seq/3": 7 } },
			{ id: "midiout1", type: "midiout", params: { "/midiout/Kanal": 2 } },
		],
		cables: [{ from: ["clock1", 0], to: ["seq1", 0] }, { from: ["seq1", 0], to: ["midiout1", 0] }, { from: ["seq1", 1], to: ["midiout1", 1] }],
	});
	await page.evaluate(() => (window.midiSent.length = 0));
	await page.waitForTimeout(2100);
	const sent = await page.evaluate(() => window.midiSent);
	const ons = sent.filter((m) => m.startsWith("145 ")).map((m) => Number(m.split(" ")[1]));
	const offs = sent.filter((m) => m.startsWith("129 "));
	const cycle = [60, 64, 67];
	const inOrder = ons.every((note, i) => cycle.includes(note) && (i === 0 || note === cycle[(cycle.indexOf(ons[i - 1]) + 1) % 3]));
	check(ons.length >= 7 && ons.length <= 9 && inOrder && Math.abs(ons.length - offs.length) <= 1, `MIDI Out sends the sequence in order on channel 2, notes ${ons.join(" ")}`);
	await page.click('.module[data-id="midiout1"] .mute');
	await page.waitForTimeout(300);
	await page.evaluate(() => (window.midiSent.length = 0));
	await page.waitForTimeout(1000);
	const whileMuted = await page.evaluate(() => window.midiSent.filter((m) => m.startsWith("145 ")).length);
	check(whileMuted === 0, "a muted MIDI Out sends no notes");
	await page.click('.module[data-id="midiout1"] .mute');
	await page.waitForTimeout(600);
	await page.evaluate(() => (window.midiSent.length = 0));
	await page.click('.module[data-id="midiout1"] .close');
	const after = await page.evaluate(() => window.midiSent);
	check(after.filter((m) => m.startsWith("145 ")).length === 0, `removing MIDI Out sends no further notes and releases a held one: ${after.join(", ") || "nothing held"}`);

	await page.evaluate((patch) => window.faustRack.openPatch(patch), {
		format: "faust-rack/1",
		modules: [{ id: "audioin1", type: "audioin", params: {} }, { id: "output1", type: "output", params: {} }],
		cables: [{ from: ["audioin1", 0], to: ["output1", 1] }, { from: ["audioin1", 1], to: ["output1", 2] }],
	});
	await page.waitForTimeout(500);
	const heard = await peak();
	check(heard > 0.005, `Audio In passes the (fake) microphone to the output, peak ${heard.toFixed(3)}`);
	await page.evaluate((patch) => window.faustRack.openPatch(patch), first);

	// Live update: a new module appears, then its changed source replaces the running instance.
	const live = {
		json: JSON.stringify({ name: "Live", color: "#fff", inputs: [], outputs: [{ name: "Out", kind: "audio" }] }),
		dsp: 'import("stdfaust.lib"); process = os.osc(hslider("Freq", 440, 50, 2000, 1)) * 0.2;',
	};
	await page.route("**/modules/index.json", (route) => route.fulfill({ json: [...ids, "livetest"] }));
	await page.route("**/modules/livetest.json", (route) => route.fulfill({ body: live.json }));
	await page.route("**/modules/livetest.dsp", (route) => route.fulfill({ body: live.dsp }));
	await page.waitForFunction(() => window.faustRack.library.defs.has("livetest"), null, { timeout: 30_000 });
	check(true, "a module added to modules/ shows up without reload");
	await page.evaluate(async () => {
		const { rack, view } = window.faustRack;
		await rack.add("livetest", { id: "live1", params: { "/livetest/Freq": 880 } });
		rack.connect(["live1", 0], ["output1", 0]);
		view.render();
	});
	live.dsp = 'import("stdfaust.lib"); process = os.sawtooth(hslider("Freq", 440, 50, 2000, 1)) * hslider("Gain", 0.2, 0, 1, 0.01);';
	await page.waitForFunction(() => window.faustRack.rack.modules.get("live1").def.controls.length === 2, null, { timeout: 30_000 });
	const swapped = await page.evaluate(() => {
		const { rack } = window.faustRack;
		return {
			freq: rack.modules.get("live1").params["/livetest/Freq"],
			cable: rack.cables.some((c) => c.from[0] === "live1" && c.to[0] === "output1"),
			knobs: document.querySelectorAll('.module[data-id="live1"] .dial').length,
		};
	});
	check(swapped.freq === 880 && swapped.cable && swapped.knobs === 2, `changed module is swapped in place, knob value and cable kept ${JSON.stringify(swapped)}`);
	const quietUntil = consoleProblems.length;
	live.dsp = "process = nonsense;";
	await page.waitForFunction(() => window.faustRack.library.failures.has("livetest"), null, { timeout: 30_000 });
	const status = await page.textContent("#status");
	check(/livetest/.test(status) && (await page.evaluate(() => window.faustRack.rack.modules.get("live1").def.controls.length)) === 2, `a broken module keeps the last working version and shows the error: ${status.trim().slice(0, 90)}`);

	live.dsp = 'process = hslider("A", 0, 0, 1, 0.1) * hslider("B", 0, 0, 1, 0.1) * hslider("C", 0, 0, 1, 0.1);';
	await page.waitForFunction(() => window.faustRack.rack.modules.get("live1").def.controls.length === 3, null, { timeout: 30_000 });
	check(true, "the compiler recovers once the module is fixed");

	const unexpected = consoleProblems.slice(0, quietUntil);
	check(consoleProblems.length > quietUntil, "the broken module was reported on the console");
	check(unexpected.length === 0, `no console errors or warnings before the deliberately broken module ${unexpected.join(" | ")}`);
} catch (err) {
	check(false, `check aborted: ${err.message}\n${consoleProblems.join("\n")}`);
} finally {
	await browser.close();
	server.close();
}
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nall good");
process.exit(problems.length ? 1 : 0);
