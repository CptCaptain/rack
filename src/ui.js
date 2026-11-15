import { clamp, travel } from "./controls.js";
import { keyboard } from "./keyboard.js";
import { midiout } from "./midiout.js";
import { pads } from "./pads.js";

// A widget gets the module definition and { id, poke, value, onOutput }, all keyed by control label.
const WIDGETS = { keyboard, pads, midiout };
const SVG = "http://www.w3.org/2000/svg";
// While a cable is dragged this close to the rack's edge, the rack scrolls.
const EDGE = 50;

export function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
	el.append(...children);
	return el;
}

function format(value, control) {
	const digits = control.step >= 1 ? 0 : control.step >= 0.1 ? 1 : control.step >= 0.01 ? 2 : 3;
	return value.toFixed(digits) + (control.unit ? ` ${control.unit}` : "");
}

function knob(c, io) {
	const { toTurn, fromTurn, snap } = travel(c);
	let value = clamp(io.value, c.min, c.max);
	const dial = h("div", { class: "dial", role: "slider", tabindex: "0", "aria-label": c.label });
	const readout = h("output");
	const show = () => {
		dial.style.setProperty("--turn", toTurn(value));
		dial.setAttribute("aria-valuenow", value);
		readout.textContent = format(value, c);
	};
	const set = (next) => {
		next = snap(next);
		if (next === value) return;
		value = next;
		show();
		io.set(value);
	};
	dial.addEventListener("pointerdown", (down) => {
		down.preventDefault();
		dial.focus();
		dial.setPointerCapture(down.pointerId);
		const start = toTurn(value);
		const move = (e) => {
			const travel = down.clientY - e.clientY + (e.clientX - down.clientX);
			set(fromTurn(clamp(start + travel / (e.shiftKey ? 1200 : 180), 0, 1)));
		};
		const end = () => {
			dial.removeEventListener("pointermove", move);
			dial.removeEventListener("pointerup", end);
			dial.removeEventListener("pointercancel", end);
		};
		dial.addEventListener("pointermove", move);
		dial.addEventListener("pointerup", end);
		dial.addEventListener("pointercancel", end);
	});
	dial.addEventListener("dblclick", () => set(c.init));
	dial.addEventListener("keydown", (e) => {
		const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
		if (!dir) return;
		e.preventDefault();
		set(c.log ? fromTurn(clamp(toTurn(value) + dir / 50, 0, 1)) : value + dir * c.step);
	});
	io.onValue((next) => {
		value = next;
		show();
	});
	// A modulated knob keeps its pointer where the hand left it; a dot shows where the signal has it now.
	io.onModulated((now) => {
		dial.toggleAttribute("data-mod", now !== null);
		if (now !== null) dial.style.setProperty("--mod", toTurn(now));
	});
	show();
	return h("div", { class: "control" }, dial, h("span", {}, c.label), readout);
}

function toggle(c, io) {
	const button = h("button", { class: "toggle", "aria-pressed": String(io.value === c.max) }, c.label);
	button.addEventListener("click", () => {
		const on = button.getAttribute("aria-pressed") !== "true";
		button.setAttribute("aria-pressed", String(on));
		io.set(on ? c.max : c.min);
	});
	const show = (next) => button.setAttribute("aria-pressed", String(next === c.max));
	io.onValue(show);
	io.onModulated((now) => now !== null && show(now));
	return h("div", { class: "control" }, button);
}

function select(c, io) {
	const options = c.options.map((option) => {
		const el = h("option", { value: option.value }, option.label);
		el.selected = option.value === io.value;
		return el;
	});
	const el = h("select", { "aria-label": c.label }, ...options);
	el.addEventListener("change", () => io.set(Number(el.value)));
	io.onValue((next) => (el.value = next));
	io.onModulated((now) => now !== null && (el.value = now));
	return h("div", { class: "control wide" }, h("span", {}, c.label), el);
}

function button(c, io) {
	const el = h("button", { class: "toggle" }, c.label);
	el.addEventListener("pointerdown", () => io.poke(1));
	for (const type of ["pointerup", "pointerleave", "pointercancel"]) el.addEventListener(type, () => io.poke(0));
	return h("div", { class: "control" }, el);
}

function leds(c, io) {
	const dots = Array.from({ length: c.max - c.min + 1 }, () => h("i"));
	io.onOutput((v) => dots.forEach((dot, i) => dot.classList.toggle("on", i === Math.round(v - c.min))));
	return h("div", { class: "leds wide", title: c.label }, ...dots);
}

function meter(c, io) {
	const bar = h("i");
	io.onOutput((v) => (bar.style.width = `${clamp((v - c.min) / (c.max - c.min), 0, 1) * 100}%`));
	return h("div", { class: "meter wide", title: c.label }, bar);
}

const CONTROLS = { knob, toggle, select, button, leds, meter };

export class RackView {
	constructor(rack, root, hint = () => {}) {
		this.rack = rack;
		this.root = root;
		this.hint = hint;
		this.armed = null;
		this.modulesEl = h("div", { class: "modules" });
		this.svg = document.createElementNS(SVG, "svg");
		this.svg.setAttribute("class", "cables");
		this.popover = h("div", { class: "popover", hidden: "" });
		root.replaceChildren(this.modulesEl, this.svg, this.popover);
		this.outputs = new Map();
		this.values = new Map();
		this.modulated = new Map();
		// The open box { items, x, y, jack } with the cables and modulations it lists, or null,
		// and the drawn paths to find a cable by position.
		this.box = null;
		this.banner = h("div", { class: "banner", hidden: "" }, h("span", {}, "Jetzt das Ziel antippen: eine Buchse der anderen Art, oder von einem Ausgang aus auch einen Regler."), h("button", {}, "Abbrechen"));
		this.banner.lastChild.addEventListener("click", () => {
			this.armed = null;
			this.draw();
		});
		document.body.append(this.banner);
		this.paths = [];
		rack.onModulated = (id, address, value) => this.modulated.get(`${id} ${address}`)?.(value);
		root.addEventListener("click", (e) => this.#select(e));
		this.modulesEl.addEventListener("click", (e) => this.#tapControl(e), true);
		// MIDI learn: while learning, a tap picks the control that the next controller move binds.
		this.learning = false;
		this.learnTarget = null;
		rack.onOutput = (id, address, value) => this.outputs.get(`${id} ${address}`)?.(value);
		new ResizeObserver(() => this.draw()).observe(this.modulesEl);
		this.modulesEl.addEventListener("pointerdown", (e) => this.#pressJack(e));
		this.modulesEl.addEventListener("pointerdown", (e) => this.#pickLearnTarget(e), true);
		this.modulesEl.addEventListener("dblclick", (e) => this.#forget(e), true);
	}

	setLearning(on) {
		this.learning = on;
		this.learnTarget = null;
		this.render();
	}

	show(id, address, value) {
		this.values.get(`${id} ${address}`)?.(value);
	}

	#controlAt(e) {
		const el = this.learning && e.target.closest(".control[data-address]");
		return el ? { id: el.closest(".module").dataset.id, address: el.dataset.address } : null;
	}

	#pickLearnTarget(e) {
		const target = this.#controlAt(e);
		if (!target) return;
		this.learnTarget = target;
		for (const el of this.modulesEl.querySelectorAll(".control")) el.classList.toggle("target", el === e.target.closest(".control"));
	}

	#forget(e) {
		const target = this.#controlAt(e);
		if (!target) return;
		e.stopPropagation();
		this.rack.unlearn(target.id, target.address);
		this.render();
	}

	render() {
		this.outputs.clear();
		this.values.clear();
		this.modulated.clear();
		this.box = null;
		this.root.classList.toggle("learning", this.learning);
		this.modulesEl.replaceChildren(...[...this.rack.modules.values()].map((inst) => this.#panel(inst)));
		this.draw();
	}

	#panel(inst) {
		const { def, id } = inst;
		const io = (c) => ({
			value: inst.params[c.address] ?? c.init,
			set: (v) => this.rack.setParam(id, c.address, v),
			poke: (v) => this.rack.poke(id, c.address, v),
			onOutput: (fn) => this.outputs.set(`${id} ${c.address}`, fn),
			onValue: (fn) => this.values.set(`${id} ${c.address}`, fn),
			onModulated: (fn) => this.modulated.set(`${id} ${c.address}`, fn),
		});
		const close = h("button", { class: "close", title: "Modul entfernen", "aria-label": `${def.name} entfernen` }, "×");
		close.addEventListener("click", () => {
			this.rack.remove(id);
			this.render();
		});
		const mover = (label, title, delta) => {
			const button = h("button", { class: "move", title, "aria-label": `${def.name} ${title}` }, label);
			button.addEventListener("click", () => {
				this.rack.move(id, delta);
				this.render();
				this.modulesEl.querySelector(`.module[data-id="${id}"]`).scrollIntoView({ block: "nearest", inline: "nearest" });
			});
			return button;
		};
		const controls = def.controls
			.filter((c) => !c.hidden)
			.map((c) => {
				const el = CONTROLS[c.type](c, io(c));
				el.dataset.address = c.address;
				const cc = this.rack.ccOf(id, c.address);
				if (cc !== undefined) el.dataset.cc = cc;
				return el;
			});
		const address = (label) => def.controls.find((c) => c.label === label)?.address;
		const widget = WIDGETS[def.widget]?.(def, {
			id,
			poke: (label, value) => this.rack.poke(id, address(label), value),
			value: (label) => this.rack.modules.get(id).params[address(label)] ?? def.controls.find((c) => c.label === label).init,
			onOutput: (label, fn) => this.outputs.set(`${id} ${address(label)}`, fn),
		});
		const jack = (dir) => (port, index) =>
			h("div", { class: `jack ${port.kind}`, "data-module": id, "data-dir": dir, "data-port": index }, h("i"), h("span", {}, port.name));
		return h(
			"section",
			{ class: "module", "data-id": id, style: `--color:${def.color};--cols:${def.columns}` },
			h("header", { title: def.description }, h("b", {}, def.name), mover("‹", "nach vorn", -1), mover("›", "nach hinten", 1), close),
			h("div", { class: "controls" }, ...controls),
			...(widget ? [widget] : []),
			h("footer", {}, h("div", { class: "jacks in" }, ...def.inputs.map(jack("in"))), h("div", { class: "jacks out" }, ...def.outputs.map(jack("out")))),
		);
	}

	#jackEl({ id, dir, port }) {
		return this.modulesEl.querySelector(`.jack[data-module="${id}"][data-dir="${dir}"][data-port="${port}"] i`);
	}

	#point(clientX, clientY) {
		const base = this.root.getBoundingClientRect();
		return [clientX - base.left + this.root.scrollLeft, clientY - base.top + this.root.scrollTop];
	}

	#centerOf(el) {
		const r = el.getBoundingClientRect();
		return this.#point(r.left + r.width / 2, r.top + r.height / 2);
	}

	#center(ref) {
		return this.#centerOf(this.#jackEl(ref));
	}

	#controlEl([id, address]) {
		return this.modulesEl.querySelector(`.module[data-id="${id}"] .control[data-address="${address}"]`);
	}

	draw(loose) {
		this.svg.setAttribute("width", this.modulesEl.offsetWidth);
		this.svg.setAttribute("height", this.modulesEl.offsetHeight);
		const path = ([x1, y1], [x2, y2], kind) => {
			const sag = 30 + Math.hypot(x2 - x1, y2 - y1) * 0.2;
			const el = document.createElementNS(SVG, "path");
			el.setAttribute("d", `M${x1} ${y1} C${x1} ${y1 + sag} ${x2} ${y2 + sag} ${x2} ${y2}`);
			el.setAttribute("class", kind);
			return el;
		};
		const kindOf = ([id, port]) => this.rack.modules.get(id).def.outputs[port].kind;
		const start = ([id, port]) => this.#center({ id, dir: "out", port });
		this.paths = [
			...this.rack.cables.map((cable) => ({ item: cable, el: path(start(cable.from), this.#center({ id: cable.to[0], dir: "in", port: cable.to[1] }), kindOf(cable.from)) })),
			...this.rack.mods.map((mod) => ({ item: mod, el: path(start(mod.from), this.#centerOf(this.#controlEl(mod.to).firstChild), `${kindOf(mod.from)} mod`) })),
		];
		if (this.box) {
			this.box.items = this.box.items.filter((item) => this.paths.some((entry) => entry.item === item));
			if (!this.box.items.length && !this.box.jack) this.box = null;
		}
		this.popover.hidden = !this.box;
		if (this.box) this.#fillBox(this.box);
		for (const { item, el } of this.paths) el.classList.toggle("selected", !!this.box?.items.includes(item));
		const paths = this.paths.map(({ el }) => el);
		if (loose) paths.push(path(this.#center(loose.anchor), this.#point(loose.x, loose.y), "loose"));
		this.svg.replaceChildren(...paths);
		for (const el of this.modulesEl.querySelectorAll(".jack.armed")) el.classList.remove("armed");
		const armedEl = this.armed && this.#jackEl(this.armed);
		if (armedEl) armedEl.parentElement.classList.add("armed");
		else this.armed = null;
		this.banner.hidden = !this.armed;
	}

	#ref(jackEl) {
		return { id: jackEl.dataset.module, dir: jackEl.dataset.dir, port: Number(jackEl.dataset.port) };
	}

	// A jack takes two gestures. A drag pulls a cable to another jack. A tap arms the jack,
	// and a tap on a jack of the other kind then connects the two, with any scrolling in between.
	#pressJack(down) {
		const jackEl = down.target.closest(".jack");
		if (!jackEl) return;
		down.preventDefault();
		jackEl.setPointerCapture(down.pointerId);
		let anchor = null;
		let last = down;
		const follow = () => {
			if (!anchor) return;
			const box = this.root.getBoundingClientRect();
			const push = (at, lo, hi) => (at < lo + EDGE ? at - lo - EDGE : at > hi - EDGE ? at - hi + EDGE : 0) / 4;
			this.root.scrollBy(push(last.clientX, box.left, box.right), push(last.clientY, box.top, box.bottom));
			this.draw({ anchor, x: last.clientX, y: last.clientY });
			requestAnimationFrame(follow);
		};
		const move = (e) => {
			last = e;
			if (anchor || Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 8) return;
			this.armed = null;
			this.box = null;
			anchor = this.#grab(this.#ref(jackEl));
			follow();
		};
		const end = (e) => {
			jackEl.removeEventListener("pointermove", move);
			jackEl.removeEventListener("pointerup", end);
			jackEl.removeEventListener("pointercancel", end);
			const dragged = anchor;
			anchor = null;
			if (e.type !== "pointerup") return this.draw();
			if (!dragged) return this.#tap(this.#ref(jackEl));
			const under = document.elementFromPoint(e.clientX, e.clientY);
			const target = under?.closest(".jack");
			if (target) this.#join(dragged, this.#ref(target));
			else this.#modulate(dragged, under?.closest(".control[data-address]"));
			this.draw();
		};
		jackEl.addEventListener("pointermove", move);
		jackEl.addEventListener("pointerup", end);
		jackEl.addEventListener("pointercancel", end);
	}

	// Pulling at a plugged input picks that cable up, so dropping it in the open
	// removes it and dropping it on another input moves it.
	#grab(ref) {
		const plugged = ref.dir === "in" && this.rack.cables.findLast((c) => c.to[0] === ref.id && c.to[1] === ref.port);
		if (!plugged) return ref;
		this.rack.disconnect(plugged);
		return { id: plugged.from[0], dir: "out", port: plugged.from[1] };
	}

	#join(a, b) {
		if (a.dir === b.dir) return;
		const [out, input] = a.dir === "out" ? [a, b] : [b, a];
		this.rack.connect([out.id, out.port], [input.id, input.port]);
	}

	// A cable dropped on a knob, switch or menu makes its signal move that control.
	#modulate(out, controlEl) {
		if (!controlEl || out.dir !== "out") return;
		const to = [controlEl.closest(".module").dataset.id, controlEl.dataset.address];
		this.rack.modulate([out.id, out.port], to).then(
			() => this.draw(),
			(err) => this.hint(err.message),
		);
	}

	#tapControl(e) {
		const controlEl = this.armed?.dir === "out" && e.target.closest(".control[data-address]");
		if (!controlEl) return;
		e.stopPropagation();
		e.preventDefault();
		this.#modulate(this.armed, controlEl);
		this.armed = null;
		this.draw();
	}

	// A tap on a cable or on a jack opens a small box that lists the cables there: one button
	// each to remove exactly that cable, and for a modulation how far it moves the knob.
	#select(e) {
		if (e.target.closest(".popover, .banner, .jack")) return;
		const [x, y] = this.#point(e.clientX, e.clientY);
		const reach = (el) => {
			const length = el.getTotalLength();
			let best = Infinity;
			for (let i = 0; i <= 60; i++) {
				const p = el.getPointAtLength((length * i) / 60);
				best = Math.min(best, Math.hypot(p.x - x, p.y - y));
			}
			return best;
		};
		const onControl = e.target.closest(".control, button, select, .keys, .pads");
		const near = onControl ? [] : this.paths.map((entry) => ({ ...entry, far: reach(entry.el) })).filter((entry) => entry.far < 14);
		this.box = near.length ? { items: near.sort((a, b) => a.far - b.far).map((entry) => entry.item), x, y, jack: null } : null;
		this.draw();
	}

	#fillBox({ items, x, y, jack }) {
		const def = (id) => this.rack.modules.get(id).def;
		const rows = items.map((item) => {
			const source = `${def(item.from[0]).name} ${def(item.from[0]).outputs[item.from[1]].name}`;
			const target = item.tap ? def(item.to[0]).controls.find((c) => c.address === item.to[1]).label : def(item.to[0]).inputs[item.to[1]].name;
			const remove = h("button", { "aria-label": "Kabel entfernen", title: "Kabel entfernen" }, "×");
			remove.addEventListener("click", () => {
				item.tap ? this.rack.unmodulate(item) : this.rack.disconnect(item);
				this.draw();
			});
			const row = h("div", { class: "row" }, h("span", {}, `${source} → ${def(item.to[0]).name} ${target}`), remove);
			if (!item.tap) return row;
			const depth = h("input", { type: "range", min: "-1", max: "1", step: "0.01", "aria-label": "Stärke und Richtung" });
			depth.value = item.depth;
			depth.addEventListener("input", () => this.rack.setDepth(item, Number(depth.value)));
			return h("div", {}, row, h("label", {}, "Stärke und Richtung", depth));
		});
		if (jack) {
			// Connecting by taps starts here and nowhere else, so a tap on a jack alone never plugs a cable.
			const connect = h("button", { class: "connect" }, "Von hier verbinden …");
			connect.addEventListener("click", () => {
				this.armed = jack;
				this.box = null;
				this.draw();
			});
			if (!rows.length) rows.push(h("span", {}, "Kein Kabel an dieser Buchse."));
			rows.push(connect);
		}
		this.popover.replaceChildren(...rows);
		this.popover.style.left = `${Math.max(4, x - 110)}px`;
		this.popover.style.top = `${y + 16}px`;
	}

	#tap(ref) {
		const armed = this.armed;
		this.armed = null;
		this.box = null;
		const same = armed && armed.id === ref.id && armed.dir === ref.dir && armed.port === ref.port;
		if (armed && armed.dir !== ref.dir) this.#join(armed, ref);
		else if (!same) {
			const end = ref.dir === "out" ? "from" : "to";
			const items = [...this.rack.cables, ...(ref.dir === "out" ? this.rack.mods : [])].filter((c) => c[end][0] === ref.id && c[end][1] === ref.port);
			const [x, y] = this.#center(ref);
			this.box = { items, x, y, jack: ref };
		}
		this.draw();
	}
}
