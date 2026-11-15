import { clamp, travel } from "./controls.js";
import { POLY } from "./faust.js";
import { bell } from "./samples.js";

export const FORMAT = "faust-rack/1";
// Muting fades over this long, so cutting a sounding module does not click.
const MUTE_FADE_SECONDS = 0.01;

const isRef = (ref) => Array.isArray(ref) && typeof ref[0] === "string" && Number.isInteger(ref[1]);

export function parsePatch(data, defs) {
	if (data?.format !== FORMAT) throw new Error(`Kein Faust-Rack-Patch (erwartet format "${FORMAT}")`);
	if (!Array.isArray(data.modules) || !Array.isArray(data.cables)) throw new Error("Patch braucht modules und cables");
	const types = new Map();
	const modules = data.modules.map((m) => {
		if (typeof m?.id !== "string" || !/^[\w-]+$/.test(m.id) || types.has(m.id))
			throw new Error(`Ungültige oder doppelte Modul-ID: ${m?.id}`);
		if (!defs.has(m.type)) throw new Error(`Unbekanntes Modul „${m.type}“`);
		types.set(m.id, defs.get(m.type));
		return { id: m.id, type: m.type, params: { ...m.params }, muted: m.muted === true, sample: typeof m.sample === "string" ? m.sample : undefined };
	});
	const cables = data.cables.map((c) => {
		if (!isRef(c?.from) || !isRef(c?.to)) throw new Error("Kabel brauchen from und to als [Modul-ID, Buchsen-Nummer]");
		if (!types.get(c.from[0])?.outputs[c.from[1]] || !types.get(c.to[0])?.inputs[c.to[1]])
			throw new Error(`Kabel ${c.from.join(":")} → ${c.to.join(":")} zeigt auf eine Buchse, die es nicht gibt`);
		return { from: [...c.from], to: [...c.to] };
	});
	const midi = (data.midi ?? []).map((m) => {
		if (!Number.isInteger(m?.cc) || m.cc < 0 || m.cc > 127 || !types.get(m.module)?.controls.some((c) => c.address === m.address))
			throw new Error(`MIDI-Zuordnung zeigt auf einen Regler, den es nicht gibt: ${m?.module} ${m?.address}`);
		return { cc: m.cc, module: m.module, address: m.address };
	});
	const mods = (data.mods ?? []).map((m) => {
		const control = isRef(m?.from) && Array.isArray(m.to) && types.get(m.to[0])?.controls.find((c) => c.address === m.to[1]);
		if (!control || control.hidden || !travel(control) || !types.get(m.from[0])?.outputs[m.from[1]] || !(Math.abs(m.depth) <= 1))
			throw new Error(`Modulation ${m?.from?.join(":")} → ${m?.to?.join(" ")} passt nicht zum Patch`);
		return { from: [...m.from], to: [...m.to], depth: m.depth };
	});
	return { modules, cables, midi, mods };
}

export class Rack {
	#external;
	#taps;

	constructor(ctx, defs, { onChange = () => {}, onOutput = () => {}, onRemove = () => {}, onModulated = () => {}, onRebuilt = () => {}, loadSample = async () => null } = {}) {
		this.ctx = ctx;
		this.defs = defs;
		this.onChange = onChange;
		this.onOutput = onOutput;
		this.onRemove = onRemove;
		this.onModulated = onModulated;
		this.onRebuilt = onRebuilt;
		this.loadSample = loadSample;
		// Resolves when every module has the number of voices its cables call for.
		this.settled = Promise.resolve();
		this.batch = false;
		this.modules = new Map();
		this.cables = [];
		// A modulation moves a knob with a signal: { from: [id, port], to: [id, address], depth, tap, signal }.
		// depth is the share of the knob's travel that a signal of 1 moves it.
		this.mods = [];
		// MIDI controller number -> the one control it moves.
		this.midi = new Map();
		this.analyser = new AnalyserNode(ctx, { fftSize: 2048 });
		this.analyser.connect(ctx.destination);
		// A Faust worklet skips its block while its input has no channels, so every
		// input gets a running source, connected or not.
		this.silence = new ConstantSourceNode(ctx, { offset: 0 });
		this.silence.start();
		// Chromium only runs a worklet that leads to the destination. This muted path keeps
		// every module running, so a MIDI Out or a sequencer works without a cable to Output.
		this.sink = new GainNode(ctx, { gain: 0 });
		this.sink.connect(ctx.destination);
	}

	// The audio input of the computer as two channels. The browser asks for permission on first use.
	#openExternal() {
		this.#external ??= navigator.mediaDevices
			.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
			.then((mediaStream) => {
				const stereo = new GainNode(this.ctx, { channelCount: 2, channelCountMode: "explicit" });
				new MediaStreamAudioSourceNode(this.ctx, { mediaStream }).connect(stereo);
				return stereo.connect(new ChannelSplitterNode(this.ctx, { numberOfOutputs: 2 }));
			})
			.catch((err) => {
				this.#external = undefined;
				throw new Error(`Kein Zugriff auf den Audio-Eingang: ${err.message}`);
			});
		return this.#external;
	}

	async #node(def, voices, sample) {
		const external = def.microphone ? await this.#openExternal() : null;
		const generator = voices > def.voices ? await def.perVoice() : def.generator;
		// A sampled module gets its own copy of the compiled program with its sample in it.
		const factory = def.sampled ? { ...generator.factory, soundfiles: { sample: sample ?? bell(this.ctx.sampleRate) } } : generator.factory;
		return [await generator.createNode(this.ctx, def.id, factory), external];
	}

	// A module with several voices has each jack once per voice: channel = voice * jacks + jack.
	#wire(def, id, [node, external], voices) {
		const outputs = def.outputs.length * voices;
		// Everything a module sends out passes its mute gain: cables, modulations and the speakers.
		const mute = new GainNode(this.ctx, { channelCount: Math.max(1, def.speakers ? 2 : outputs), channelCountMode: "explicit", channelInterpretation: "discrete" });
		const inst = { id, def, node, external, mute, voices, muted: false, params: {}, merger: null, splitter: null };
		node.connect(mute);
		const inputs = external ? 2 : def.inputs.length * voices;
		if (inputs) {
			inst.merger = new ChannelMergerNode(this.ctx, { numberOfInputs: inputs });
			for (let port = 0; port < inputs; port++) {
				this.silence.connect(inst.merger, 0, port);
				external?.connect(inst.merger, port, port);
			}
			inst.merger.connect(node);
		}
		if (outputs) {
			inst.splitter = new ChannelSplitterNode(this.ctx, { numberOfOutputs: outputs });
			mute.connect(inst.splitter);
		}
		if (def.speakers) mute.connect(this.analyser);
		node.connect(this.sink);
		// One analyser per output for the live displays (displays.js), behind the mute so a muted
		// module shows nothing. They are native nodes: the displays add no code to the audio thread.
		const tap = (source, ports) => {
			const analyser = new AnalyserNode(this.ctx, { fftSize: 1024 });
			for (const port of ports) source.connect(analyser, port);
			return analyser;
		};
		const everyVoice = (port) => Array.from({ length: voices }, (_, voice) => voice * def.outputs.length + port);
		inst.taps = def.speakers ? [tap(mute, [0])] : def.outputs.map((_, port) => tap(inst.splitter, everyVoice(port)));
		node.setOutputParamHandler((address, value) => this.onOutput(id, address, value));
		return inst;
	}

	#unwire(inst) {
		inst.node.disconnect();
		inst.mute.disconnect();
		inst.splitter?.disconnect();
		if (inst.merger) {
			this.silence.disconnect(inst.merger);
			inst.external?.disconnect(inst.merger);
			inst.merger.disconnect();
		}
		inst.node.destroy();
	}

	async add(type, { id, params = {}, muted = false, sample } = {}) {
		const def = this.defs.get(type);
		if (!def) throw new Error(`Unbekanntes Modul „${type}“`);
		const loaded = def.sampled && sample ? await this.loadSample(sample).catch(() => null) : null;
		const node = await this.#node(def, def.voices, loaded);
		if (id === undefined) for (let n = 1; this.modules.has((id = `${type}${n}`)); n++);
		if (this.modules.has(id)) throw new Error(`Modul-ID „${id}“ gibt es schon`);
		this.modules.set(id, this.#wire(def, id, node, def.voices));
		this.modules.get(id).sample = loaded;
		if (muted) this.setMuted(id, true, 0);
		for (const [address, value] of Object.entries(params)) this.setParam(id, address, value);
		this.onChange();
		return this.modules.get(id);
	}

	remove(id) {
		const inst = this.modules.get(id);
		if (!inst) return;
		for (const cable of this.#cablesOf(id)) this.disconnect(cable);
		for (const mod of this.#modsOf(id)) this.unmodulate(mod);
		this.unlearn(id);
		this.#unwire(inst);
		this.modules.delete(id);
		this.onRemove(id);
		this.#resettle();
		this.onChange();
	}

	// Gives a sampled module another sample. The module is built again around it.
	async setSample(id, sample) {
		await this.#rebuild(this.modules.get(id), this.modules.get(id).def, this.modules.get(id).voices, sample);
		this.onChange();
	}

	// A muted module keeps running but sends nothing out of any jack: no sound, no CV, no gate.
	setMuted(id, muted, fade = MUTE_FADE_SECONDS) {
		const inst = this.modules.get(id);
		const gain = inst.mute.gain;
		const now = this.ctx.currentTime;
		inst.muted = muted;
		gain.cancelScheduledValues(now);
		gain.setValueAtTime(fade ? gain.value : Number(!muted), now);
		gain.linearRampToValueAtTime(Number(!muted), now + fade);
		this.onChange();
	}

	// The order of the modules is the order in the rack and in the saved patch.
	move(id, delta) {
		const order = [...this.modules.keys()];
		const from = order.indexOf(id);
		const to = Math.min(order.length - 1, Math.max(0, from + delta));
		if (from < 0 || to === from) return;
		order.splice(to, 0, ...order.splice(from, 1));
		this.modules = new Map(order.map((key) => [key, this.modules.get(key)]));
		this.onChange();
	}

	// Swaps every instance of a recompiled module in place. Knob values and
	// cables survive where the new version still has that knob or jack.
	async update(def) {
		for (const old of [...this.modules.values()].filter((inst) => inst.def.id === def.id)) await this.#rebuild(old, def, def.spreads ? old.voices : def.voices);
		this.#resettle();
		this.onChange();
	}

	// Builds a module again, from another version of its program or with another number of
	// voices, and puts back its knobs, its mute, its cables and its modulations.
	async #rebuild(old, def, voices, sample = old.sample) {
		const node = await this.#node(def, voices, sample);
		if (this.modules.get(old.id) !== old) return node[0].destroy();
		const batch = this.batch;
		this.batch = true;
		try {
			await this.#swap(old, def, voices, node);
			this.modules.get(old.id).sample = sample;
		} finally {
			this.batch = batch;
		}
	}

	async #swap(old, def, voices, node) {
		const cables = this.#cablesOf(old.id);
		for (const cable of cables) this.disconnect(cable);
		const mods = this.#modsOf(old.id);
		for (const mod of mods) this.unmodulate(mod);
		this.#unwire(old);
		this.modules.set(old.id, this.#wire(def, old.id, node, voices));
		if (old.muted) this.setMuted(old.id, true, 0);
		for (const [address, value] of Object.entries(old.params))
			if (def.controls.some((c) => c.address === address)) this.setParam(old.id, address, value);
		for (const { from, to } of cables)
			if (this.modules.get(from[0]).def.outputs[from[1]] && this.modules.get(to[0]).def.inputs[to[1]]) this.connect(from, to);
		for (const [cc, target] of this.midi)
			if (target.id === old.id && !def.controls.some((c) => c.address === target.address)) this.midi.delete(cc);
		for (const { from, to, depth } of mods)
			if (this.modules.get(from[0]).def.outputs[from[1]] && this.#control(to)) await this.modulate(from, to, depth);
	}

	// Polyphony spreads along the cables: a module that can run once per voice does so as soon
	// as a polyphonic module feeds it. Everything else adds the voices up at its input.
	async #settle() {
		const voices = new Map([...this.modules].map(([id, inst]) => [id, inst.def.voices]));
		for (let spread = true; spread; ) {
			spread = false;
			for (const { from, to } of this.cables) {
				if (!this.modules.get(to[0]).def.spreads || voices.get(from[0]) === 1 || voices.get(to[0]) > 1) continue;
				voices.set(to[0], POLY);
				spread = true;
			}
		}
		let rebuilt = false;
		for (const [id, wanted] of voices) {
			const inst = this.modules.get(id);
			if (!inst || inst.voices === wanted) continue;
			await this.#rebuild(inst, inst.def, wanted);
			rebuilt = true;
		}
		if (rebuilt) this.onRebuilt();
	}

	#resettle() {
		if (!this.batch) this.settled = this.settled.then(() => this.#settle()).catch((err) => console.error(err.message));
	}

	connect(from, to) {
		const same = (c) => c.from[0] === from[0] && c.from[1] === from[1] && c.to[0] === to[0] && c.to[1] === to[1];
		const existing = this.cables.find(same);
		if (existing) return existing;
		const src = this.modules.get(from[0]);
		const dst = this.modules.get(to[0]);
		if (!src?.def.outputs[from[1]] || !dst?.def.inputs[to[1]]) throw new Error("Diese Buchse gibt es nicht");
		// Web Audio mutes a loop that has no DelayNode in it.
		const loop = this.#reaches(to[0], from[0]);
		// One link per voice. A single voice feeds every voice of a polyphonic module, and all
		// voices of a polyphonic module add up in a module with one voice.
		const links = Array.from({ length: Math.max(src.voices, dst.voices) }, (_, voice) => {
			const out = Math.min(voice, src.voices - 1) * src.def.outputs.length + from[1];
			const into = Math.min(voice, dst.voices - 1) * dst.def.inputs.length + to[1];
			const delay = loop ? new DelayNode(this.ctx, { maxDelayTime: 1, delayTime: 128 / this.ctx.sampleRate }) : null;
			if (delay) src.splitter.connect(delay, out).connect(dst.merger, 0, into);
			else src.splitter.connect(dst.merger, out, into);
			return { out, into, delay };
		});
		const cable = { from: [...from], to: [...to], loop, links };
		this.cables.push(cable);
		this.#resettle();
		this.onChange();
		return cable;
	}

	disconnect(cable) {
		const index = this.cables.indexOf(cable);
		if (index < 0) return;
		const src = this.modules.get(cable.from[0]);
		const dst = this.modules.get(cable.to[0]);
		for (const { out, into, delay } of cable.links) {
			if (delay) {
				src.splitter.disconnect(delay, out);
				delay.disconnect();
			} else src.splitter.disconnect(dst.merger, out, into);
		}
		this.cables.splice(index, 1);
		this.#resettle();
		this.onChange();
	}

	#control([id, address]) {
		const control = this.modules.get(id)?.def.controls.find((c) => c.address === address);
		return control && !control.hidden && travel(control) ? control : null;
	}

	async modulate(from, to, depth = 0.25) {
		const valid = () => this.modules.get(from[0])?.def.outputs[from[1]] && this.#control(to);
		if (!valid()) throw new Error("Das lässt sich nicht modulieren");
		await (this.#taps ??= this.ctx.audioWorklet.addModule(new URL("./tap-worklet.js", import.meta.url)));
		const existing = this.mods.find((m) => m.from[0] === from[0] && m.from[1] === from[1] && m.to[0] === to[0] && m.to[1] === to[1]);
		if (existing || !valid()) return existing;
		const mod = { from: [...from], to: [...to], depth, tap: new AudioWorkletNode(this.ctx, "tap"), signal: 0 };
		mod.tap.port.onmessage = (e) => {
			mod.signal = e.data;
			this.#apply(...mod.to);
		};
		this.modules.get(from[0]).splitter.connect(mod.tap, from[1]);
		mod.tap.connect(this.sink);
		this.mods.push(mod);
		this.onChange();
		return mod;
	}

	unmodulate(mod) {
		const index = this.mods.indexOf(mod);
		if (index < 0) return;
		this.modules.get(mod.from[0]).splitter.disconnect(mod.tap, mod.from[1]);
		mod.tap.disconnect();
		mod.tap.port.onmessage = null;
		mod.tap.port.postMessage("stop");
		this.mods.splice(index, 1);
		this.#apply(...mod.to);
		this.onChange();
	}

	setDepth(mod, depth) {
		mod.depth = depth;
		this.#apply(...mod.to);
		this.onChange();
	}

	// Sends a control's value to its module: what the knob says, moved by every signal that modulates it.
	#apply(id, address) {
		const inst = this.modules.get(id);
		if (!inst) return;
		const mods = this.mods.filter((m) => m.to[0] === id && m.to[1] === address);
		const control = inst.def.controls.find((c) => c.address === address);
		const base = inst.params[address] ?? control.init;
		const push = mods.reduce((sum, m) => sum + m.signal * m.depth, 0);
		const value = mods.length ? travel(control).fromTurn(clamp(travel(control).toTurn(base) + push, 0, 1)) : base;
		inst.node.setParamValue(address, value);
		this.onModulated(id, address, mods.length ? value : null);
	}

	#modsOf(id) {
		return this.mods.filter((m) => m.from[0] === id || m.to[0] === id);
	}

	#cablesOf(id) {
		return this.cables.filter((c) => c.from[0] === id || c.to[0] === id);
	}

	#reaches(start, goal) {
		const seen = new Set();
		const visit = (id) => {
			if (id === goal) return true;
			if (seen.has(id)) return false;
			seen.add(id);
			return this.cables.some((c) => !c.loop && c.from[0] === id && visit(c.to[0]));
		};
		return visit(start);
	}

	setParam(id, address, value) {
		const inst = this.modules.get(id);
		if (!inst.def.controls.some((c) => c.address === address))
			return console.warn(`Patch: ${id} hat keinen Regler ${address}`);
		inst.params[address] = value;
		this.#apply(id, address);
		this.onChange();
	}

	learn(cc, id, address) {
		this.unlearn(id, address);
		this.midi.set(cc, { id, address });
		this.onChange();
	}

	unlearn(id, address) {
		for (const [cc, target] of this.midi)
			if (target.id === id && (address === undefined || target.address === address)) this.midi.delete(cc);
		this.onChange();
	}

	ccOf(id, address) {
		for (const [cc, target] of this.midi) if (target.id === id && target.address === address) return cc;
	}

	poke(id, address, value) {
		this.modules.get(id)?.node.setParamValue(address, value);
	}

	async load(data) {
		const patch = parsePatch(data, this.defs);
		this.batch = true;
		try {
			for (const id of [...this.modules.keys()]) this.remove(id);
			for (const m of patch.modules) await this.add(m.type, m);
			for (const c of patch.cables) this.connect(c.from, c.to);
			for (const m of patch.midi) this.learn(m.cc, m.module, m.address);
			for (const m of patch.mods) await this.modulate(m.from, m.to, m.depth);
		} finally {
			this.batch = false;
		}
		await this.#settle();
	}

	// Turns the rack into the given patch by changing only what differs. Modules that stay keep
	// running, so undo does not interrupt the sound the way loading a patch does.
	async reconcile(data) {
		const patch = parsePatch(data, this.defs);
		this.batch = true;
		try {
			await this.#reconcile(patch);
		} finally {
			this.batch = false;
		}
		await this.#settle();
		this.onChange();
	}

	async #reconcile(patch) {
		const wanted = new Map(patch.modules.map((m) => [m.id, m]));
		for (const [id, inst] of [...this.modules]) if (wanted.get(id)?.type !== inst.def.id) this.remove(id);
		for (const m of patch.modules) {
			if (!this.modules.has(m.id)) await this.add(m.type, m);
			const inst = this.modules.get(m.id);
			for (const address of Object.keys(inst.params)) {
				if (address in m.params) continue;
				delete inst.params[address];
				this.#apply(m.id, address);
			}
			for (const [address, value] of Object.entries(m.params)) if (inst.params[address] !== value) this.setParam(m.id, address, value);
			if (inst.muted !== m.muted) this.setMuted(m.id, m.muted);
			if ((inst.sample?.name || undefined) !== m.sample) await this.setSample(m.id, m.sample ? await this.loadSample(m.sample).catch(() => null) : null);
		}
		this.modules = new Map(patch.modules.map((m) => [m.id, this.modules.get(m.id)]));
		const same = (a, b) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1];
		for (const cable of [...this.cables]) if (!patch.cables.some((c) => same(c, cable))) this.disconnect(cable);
		for (const c of patch.cables) this.connect(c.from, c.to);
		for (const mod of [...this.mods]) if (!patch.mods.some((m) => same(m, mod))) this.unmodulate(mod);
		for (const m of patch.mods) {
			const mod = await this.modulate(m.from, m.to, m.depth);
			if (mod.depth !== m.depth) this.setDepth(mod, m.depth);
		}
		this.midi.clear();
		for (const m of patch.midi) this.learn(m.cc, m.module, m.address);
	}

	toJSON() {
		return {
			format: FORMAT,
			modules: [...this.modules.values()].map(({ id, def, params, muted, sample }) => ({ id, type: def.id, params, ...(muted && { muted }), ...(sample?.name && { sample: sample.name }) })),
			cables: this.cables.map(({ from, to }) => ({ from, to })),
			midi: [...this.midi].map(([cc, { id, address }]) => ({ cc, module: id, address })),
			mods: this.mods.map(({ from, to, depth }) => ({ from, to, depth })),
		};
	}
}
