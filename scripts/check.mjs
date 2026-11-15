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
		const played = data.modules.some((m) => m.type === "keyboard");
		if (played) await page.keyboard.down("d");
		await page.waitForTimeout(800);
		const level = await peak();
		if (played) await page.keyboard.up("d");
		check(level > 0.005 && level <= 1, `patch "${name}" reaches the output, peak ${level.toFixed(3)}`);
	}

	const first = JSON.parse(readFileSync(`${dir}/patches/${examples[0].file}`, "utf8"));
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
