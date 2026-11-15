export const FORMAT = "faust-rack/1";

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
		return { id: m.id, type: m.type, params: { ...m.params } };
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
	return { modules, cables, midi };
}

export class Rack {
	constructor(ctx, defs, { onChange = () => {}, onOutput = () => {} } = {}) {
		this.ctx = ctx;
		this.defs = defs;
		this.onChange = onChange;
		this.onOutput = onOutput;
		this.modules = new Map();
		this.cables = [];
		// MIDI controller number -> the one control it moves.
		this.midi = new Map();
		this.analyser = new AnalyserNode(ctx, { fftSize: 2048 });
		this.analyser.connect(ctx.destination);
		// A Faust worklet skips its block while its input has no channels, so every
		// input gets a running source, connected or not.
		this.silence = new ConstantSourceNode(ctx, { offset: 0 });
		this.silence.start();
	}

	#wire(def, id, node) {
		const inst = { id, def, node, params: {}, merger: null, splitter: null };
		if (def.inputs.length) {
			inst.merger = new ChannelMergerNode(this.ctx, { numberOfInputs: def.inputs.length });
			def.inputs.forEach((_, port) => this.silence.connect(inst.merger, 0, port));
			inst.merger.connect(node);
		}
		if (def.outputs.length) {
			inst.splitter = new ChannelSplitterNode(this.ctx, { numberOfOutputs: def.outputs.length });
			node.connect(inst.splitter);
		}
		if (def.speakers) node.connect(this.analyser);
		node.setOutputParamHandler((address, value) => this.onOutput(id, address, value));
		return inst;
	}

	#unwire(inst) {
		inst.node.disconnect();
		inst.splitter?.disconnect();
		if (inst.merger) {
			this.silence.disconnect(inst.merger);
			inst.merger.disconnect();
		}
		inst.node.destroy();
	}

	async add(type, { id, params = {} } = {}) {
		const def = this.defs.get(type);
		if (!def) throw new Error(`Unbekanntes Modul „${type}“`);
		const node = await def.generator.createNode(this.ctx, def.id);
		if (id === undefined) for (let n = 1; this.modules.has((id = `${type}${n}`)); n++);
		if (this.modules.has(id)) throw new Error(`Modul-ID „${id}“ gibt es schon`);
		this.modules.set(id, this.#wire(def, id, node));
		for (const [address, value] of Object.entries(params)) this.setParam(id, address, value);
		this.onChange();
		return this.modules.get(id);
	}

	remove(id) {
		const inst = this.modules.get(id);
		if (!inst) return;
		for (const cable of this.#cablesOf(id)) this.disconnect(cable);
		this.unlearn(id);
		this.#unwire(inst);
		this.modules.delete(id);
		this.onChange();
	}

	// Swaps every instance of a recompiled module in place. Knob values and
	// cables survive where the new version still has that knob or jack.
	async update(def) {
		for (const old of [...this.modules.values()].filter((inst) => inst.def.id === def.id)) {
			const node = await def.generator.createNode(this.ctx, def.id);
			if (this.modules.get(old.id) !== old) {
				node.destroy();
				continue;
			}
			const cables = this.#cablesOf(old.id);
			for (const cable of cables) this.disconnect(cable);
			this.#unwire(old);
			this.modules.set(old.id, this.#wire(def, old.id, node));
			for (const [address, value] of Object.entries(old.params))
				if (def.controls.some((c) => c.address === address)) this.setParam(old.id, address, value);
			for (const { from, to } of cables)
				if (this.modules.get(from[0]).def.outputs[from[1]] && this.modules.get(to[0]).def.inputs[to[1]])
					this.connect(from, to);
			for (const [cc, target] of this.midi)
				if (target.id === old.id && !def.controls.some((c) => c.address === target.address)) this.midi.delete(cc);
		}
		this.onChange();
	}

	connect(from, to) {
		const same = (c) => c.from[0] === from[0] && c.from[1] === from[1] && c.to[0] === to[0] && c.to[1] === to[1];
		const existing = this.cables.find(same);
		if (existing) return existing;
		const src = this.modules.get(from[0]);
		const dst = this.modules.get(to[0]);
		if (!src?.def.outputs[from[1]] || !dst?.def.inputs[to[1]]) throw new Error("Diese Buchse gibt es nicht");
		const cable = { from: [...from], to: [...to], delay: null };
		if (this.#reaches(to[0], from[0])) {
			// Web Audio mutes a loop that has no DelayNode in it.
			cable.delay = new DelayNode(this.ctx, { maxDelayTime: 1, delayTime: 128 / this.ctx.sampleRate });
			src.splitter.connect(cable.delay, from[1]);
			cable.delay.connect(dst.merger, 0, to[1]);
		} else {
			src.splitter.connect(dst.merger, from[1], to[1]);
		}
		this.cables.push(cable);
		this.onChange();
		return cable;
	}

	disconnect(cable) {
		const index = this.cables.indexOf(cable);
		if (index < 0) return;
		const src = this.modules.get(cable.from[0]);
		const dst = this.modules.get(cable.to[0]);
		if (cable.delay) {
			src.splitter.disconnect(cable.delay, cable.from[1]);
			cable.delay.disconnect();
		} else {
			src.splitter.disconnect(dst.merger, cable.from[1], cable.to[1]);
		}
		this.cables.splice(index, 1);
		this.onChange();
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
			return this.cables.some((c) => !c.delay && c.from[0] === id && visit(c.to[0]));
		};
		return visit(start);
	}

	setParam(id, address, value) {
		const inst = this.modules.get(id);
		if (!inst.def.controls.some((c) => c.address === address))
			return console.warn(`Patch: ${id} hat keinen Regler ${address}`);
		inst.params[address] = value;
		inst.node.setParamValue(address, value);
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
		for (const id of [...this.modules.keys()]) this.remove(id);
		for (const m of patch.modules) await this.add(m.type, m);
		for (const c of patch.cables) this.connect(c.from, c.to);
		for (const m of patch.midi) this.learn(m.cc, m.module, m.address);
	}

	toJSON() {
		return {
			format: FORMAT,
			modules: [...this.modules.values()].map(({ id, def, params }) => ({ id, type: def.id, params })),
			cables: this.cables.map(({ from, to }) => ({ from, to })),
			midi: [...this.midi].map(([cc, { id, address }]) => ({ cc, module: id, address })),
		};
	}
}
