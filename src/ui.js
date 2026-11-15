import { clamp, travel } from "./controls.js";
import { Displays } from "./displays.js";
import { grid, steps } from "./grid.js";
import { keyboard } from "./keyboard.js";
import { life } from "./life.js";
import { midiout } from "./midiout.js";
import { pads } from "./pads.js";

// A widget gets the module definition and { id, poke, set, value, onOutput, muted }, keyed by control label where they name a control.
const WIDGETS = { keyboard, pads, midiout, life, grid, steps };
const SVG = "http://www.w3.org/2000/svg";
// While a cable is dragged this close to the rack's edge, the rack scrolls.
const EDGE = 50;
// Holding a jack this long opens the list of its cables. A shorter press is a tap.
const LONG_PRESS_MS = 500;

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
		this.held = null;
		this.modulesEl = h("div", { class: "modules" });
		this.svg = document.createElementNS(SVG, "svg");
		this.svg.setAttribute("class", "cables");
		this.displays = new Displays(rack, root);
		this.popover = h("div", { class: "popover", hidden: "" });
		root.replaceChildren(this.modulesEl, this.svg, this.popover);
		this.outputs = new Map();
		this.values = new Map();
		this.modulated = new Map();
		// The open list of cables and modulations, or null: { items, active, jack, x, y }. active is
		// the chosen entry, jack the jack the list belongs to if a long press opened it.
		// paths are the drawn cables, to find one by position.
		this.box = null;
		addEventListener("keydown", (e) => this.#keyInBox(e), true);
		this.modulesEl.addEventListener("contextmenu", (e) => e.target.closest(".jack") && e.preventDefault());
		this.banner = h("div", { class: "banner", hidden: "" }, h("span", {}), h("button", { "aria-label": "Kabel weglegen" }, "×"));
		this.banner.lastChild.addEventListener("click", () => this.#hold(null));
		document.body.append(this.banner);
		// The cable in the hand hangs on the mouse pointer. A finger has no position between taps, so there it dangles.
		this.pointer = null;
		this.holdMs = 12000;
		root.addEventListener("pointermove", (e) => {
			if (!this.held || e.pointerType !== "mouse") return;
			this.pointer = [e.clientX, e.clientY];
			this.draw();
		});
		root.addEventListener("scroll", () => this.held && this.#hold(this.held));
		addEventListener("keydown", (e) => e.key === "Escape" && this.#hold(null));
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
		this.modulesEl.addEventListener("pointerdown", (e) => this.#dragModule(e));
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
		this.displays.reset(this.modulesEl.children);
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
		const mute = h("button", { class: "mute", title: "Modul stummschalten", "aria-label": `${def.name} stummschalten`, "aria-pressed": String(inst.muted) }, "M");
		mute.addEventListener("click", () => {
			const muted = !this.rack.modules.get(id).muted;
			this.rack.setMuted(id, muted);
			mute.setAttribute("aria-pressed", String(muted));
			mute.closest(".module").classList.toggle("muted", muted);
			this.draw();
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
			// Like a knob: the value is part of the patch.
			set: (label, value) => this.rack.setParam(id, address(label), value),
			value: (label) => this.rack.modules.get(id).params[address(label)] ?? def.controls.find((c) => c.label === label).init,
			onOutput: (label, fn) => this.outputs.set(`${id} ${address(label)}`, fn),
			muted: () => this.rack.modules.get(id).muted,
		});
		const jack = (dir) => (port, index) =>
			h("div", { class: `jack ${port.kind}`, "data-module": id, "data-dir": dir, "data-port": index }, h("i"), h("span", {}, port.name));
		return h(
			"section",
			{ class: inst.muted ? "module muted" : "module", "data-id": id, style: `--color:${def.color};--cols:${def.columns}` },
			h("header", { title: def.description }, h("b", {}, def.name), mute, mover("‹", "nach vorn", -1), mover("›", "nach hinten", 1), close),
			...(def.display === "none" || !inst.taps.length ? [] : [h("canvas", { class: "display" })]),
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
		const kindOfLive = (from) => (this.rack.modules.get(from[0]).muted ? `${kindOf(from)} muted` : kindOf(from));
		this.paths = [
			...this.rack.cables.map((cable) => ({ item: cable, el: path(start(cable.from), this.#center({ id: cable.to[0], dir: "in", port: cable.to[1] }), kindOfLive(cable.from)) })),
			...this.rack.mods.map((mod) => ({ item: mod, el: path(start(mod.from), this.#centerOf(this.#controlEl(mod.to).firstChild), `${kindOfLive(mod.from)} mod`) })),
		];
		if (this.box) {
			const before = this.box.items.length;
			this.box.items = this.box.items.filter((item) => this.paths.some((entry) => entry.item === item));
			this.box.active = Math.min(this.box.active, this.box.items.length - 1);
			// The list stays open while it has cables. It closes with its last one.
			if (before && !this.box.items.length) this.box = null;
		}
		this.popover.hidden = !this.box;
		if (this.box) this.#fillBox(this.box);
		for (const { item, el } of this.paths) el.classList.toggle("selected", this.box?.items[this.box.active] === item);
		const paths = this.paths.map(({ el }) => el);
		for (const el of this.modulesEl.querySelectorAll(".jack.held")) el.classList.remove("held");
		const heldEl = this.held && this.#jackEl(this.held);
		if (heldEl) heldEl.parentElement.classList.add("held");
		else this.held = null;
		this.banner.hidden = !this.held;
		if (loose) paths.push(path(this.#center(loose.anchor), this.#point(loose.x, loose.y), "loose"));
		else if (this.held) {
			const [x, y] = this.#center(this.held);
			paths.push(path([x, y], this.pointer ? this.#point(...this.pointer) : [x + 24, y + 56], "loose"));
			const def = this.rack.modules.get(this.held.id).def;
			const name = (this.held.dir === "out" ? def.outputs : def.inputs)[this.held.port].name;
			this.banner.firstChild.textContent = `Kabel von ${def.name} ${name} in der Hand. ${this.held.dir === "out" ? "Einen Eingang oder einen Regler" : "Einen Ausgang"} antippen.`;
		}
		this.svg.replaceChildren(...paths);
	}

	#ref(jackEl) {
		return { id: jackEl.dataset.module, dir: jackEl.dataset.dir, port: Number(jackEl.dataset.port) };
	}

	// Dragging a module by its name moves it to where it is dropped: before the module under
	// the pointer if the pointer is in its first half, after it otherwise.
	#dragModule(down) {
		const handle = down.target.closest(".module header b");
		if (!handle) return;
		const section = handle.closest(".module");
		handle.setPointerCapture(down.pointerId);
		let target = null;
		const mark = (el, before) => {
			for (const other of this.modulesEl.children) other.classList.remove("drop-before", "drop-after");
			target = el && el !== section ? { el, before } : null;
			if (target) el.classList.add(before ? "drop-before" : "drop-after");
		};
		const move = (e) => {
			if (!section.classList.contains("dragging") && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 8) return;
			section.classList.add("dragging");
			const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".module");
			if (!over) return mark(null);
			const box = over.getBoundingClientRect();
			// Side by side, left and right halves decide. Stacked, as on a phone, upper and lower halves do.
			const stacked = box.width > this.modulesEl.clientWidth * 0.6;
			mark(over, stacked ? e.clientY < box.top + box.height / 2 : e.clientX < box.left + box.width / 2);
		};
		const end = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", end);
			handle.removeEventListener("pointercancel", end);
			section.classList.remove("dragging");
			if (!target) return;
			const order = [...this.modulesEl.children].filter((el) => el !== section);
			const index = order.indexOf(target.el) + (target.before ? 0 : 1);
			mark(null);
			this.rack.move(section.dataset.id, index - [...this.rack.modules.keys()].indexOf(section.dataset.id));
			this.render();
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", end);
		handle.addEventListener("pointercancel", end);
	}

	// A jack takes two gestures. A drag pulls a cable to another jack. A tap takes a cable into
	// the hand, and a tap on a jack of the other kind plugs it, with any scrolling in between.
	#pressJack(down) {
		const jackEl = down.target.closest(".jack");
		if (!jackEl) return;
		down.preventDefault();
		jackEl.setPointerCapture(down.pointerId);
		let anchor = null;
		let last = down;
		let listed = false;
		const longPress = setTimeout(() => {
			listed = true;
			this.#listJack(this.#ref(jackEl));
		}, LONG_PRESS_MS);
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
			if (anchor || listed || Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 8) return;
			clearTimeout(longPress);
			this.#hold(null);
			anchor = this.#grab(this.#ref(jackEl));
			follow();
		};
		const end = (e) => {
			jackEl.removeEventListener("pointermove", move);
			jackEl.removeEventListener("pointerup", end);
			jackEl.removeEventListener("pointercancel", end);
			const dragged = anchor;
			anchor = null;
			clearTimeout(longPress);
			if (e.type !== "pointerup" || listed) return this.draw();
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
		const controlEl = this.held?.dir === "out" && e.target.closest(".control[data-address]");
		if (!controlEl) return;
		e.stopPropagation();
		e.preventDefault();
		this.#modulate(this.held, controlEl);
		this.#hold(null);
	}

	// A tap on a cable opens a small box that lists the cables under the finger: one button
	// each to remove exactly that cable, and for a modulation how far it moves the knob.
	// A tap beside everything puts a held cable away.
	#select(e) {
		if (e.target.closest(".popover, .banner, .jack")) return;
		if (this.held) return this.#hold(null);
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
		this.box = near.length ? { items: near.sort((a, b) => a.far - b.far).map((entry) => entry.item), active: 0, jack: null, x, y } : null;
		this.draw();
	}

	// A long press on a jack lists every cable plugged there.
	#listJack(ref) {
		this.#hold(null);
		const end = ref.dir === "out" ? "from" : "to";
		const items = [...this.rack.cables, ...(ref.dir === "out" ? this.rack.mods : [])].filter((c) => c[end][0] === ref.id && c[end][1] === ref.port);
		const [x, y] = this.#center(ref);
		document.activeElement?.blur();
		this.box = { items, active: 0, jack: ref, x, y };
		this.draw();
	}

	#remove(item) {
		item.tap ? this.rack.unmodulate(item) : this.rack.disconnect(item);
		this.draw();
	}

	// With the list open: arrows choose an entry, Delete or Backspace removes its cable.
	// Escape closes the list like it puts a held cable away.
	#keyInBox(e) {
		if (!this.box?.items.length || e.target.closest?.("input, select, textarea")) return;
		const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
		if (!step && e.key !== "Delete" && e.key !== "Backspace") return;
		e.preventDefault();
		e.stopPropagation();
		const count = this.box.items.length;
		if (!step) return this.#remove(this.box.items[this.box.active]);
		this.box.active = (this.box.active + step + count) % count;
		this.draw();
	}

	#fillBox(box) {
		const { items, active, jack, x, y } = box;
		// Drawing the cables runs often. The list is only rebuilt when it changed, so a finger on its slider stays there.
		const shown = `${items.map((item) => this.paths.findIndex((entry) => entry.item === item)).join()} ${active}`;
		if (box.shown === shown) return;
		box.shown = shown;
		const def = (id) => this.rack.modules.get(id).def;
		const rows = items.map((item, index) => {
			const source = `${def(item.from[0]).name} ${def(item.from[0]).outputs[item.from[1]].name}`;
			const target = `${def(item.to[0]).name} ${item.tap ? def(item.to[0]).controls.find((c) => c.address === item.to[1]).label : def(item.to[0]).inputs[item.to[1]].name}`;
			// Seen from a jack, an entry names the other end. Without a jack it names both.
			const label = !jack ? `${source} → ${target}` : jack.dir === "in" ? source : target;
			const remove = h("button", { "aria-label": `Kabel ${label} entfernen`, title: "Kabel entfernen" }, "×");
			remove.addEventListener("click", () => this.#remove(item));
			const swatch = h("i", { class: `swatch ${def(item.from[0]).outputs[item.from[1]].kind}` });
			const row = h("div", { class: index === active ? "row active" : "row" }, swatch, h("span", {}, label), remove);
			const choose = () => {
				if (box.active === index) return;
				box.active = index;
				this.draw();
			};
			// Only a pointer that really moved chooses. When the list is rebuilt under a resting
			// mouse, the browser reports a move at the same spot, and that must not undo an arrow key.
			row.addEventListener("pointermove", (e) => {
				const at = `${e.clientX} ${e.clientY}`;
				if (at !== this.pointerAt) choose();
				this.pointerAt = at;
			});
			row.addEventListener("click", choose);
			if (!item.tap) return row;
			const depth = h("input", { type: "range", min: "-1", max: "1", step: "0.01", "aria-label": "Stärke und Richtung" });
			depth.value = item.depth;
			depth.addEventListener("input", () => this.rack.setDepth(item, Number(depth.value)));
			return h("div", {}, row, h("label", {}, "Stärke und Richtung", depth));
		});
		if (jack) {
			const of = def(jack.id);
			rows.unshift(h("b", {}, `Kabel an ${of.name} ${(jack.dir === "out" ? of.outputs : of.inputs)[jack.port].name}`));
			if (!items.length) rows.push(h("span", {}, "Hier steckt kein Kabel."));
		}
		this.popover.replaceChildren(...rows);
		this.popover.style.left = `${Math.max(4, x - 125)}px`;
		this.popover.style.top = `${y + 16}px`;
	}

	// A tap on a jack takes a cable from it into the hand. The cable is drawn, a bar says so, and
	// it goes back by itself after a while, so a forgotten tap never plugs a cable minutes later.
	#hold(ref) {
		this.held = ref;
		this.box = null;
		clearTimeout(this.holdTimer);
		if (ref) this.holdTimer = setTimeout(() => this.#hold(null), this.holdMs);
		this.draw();
	}

	#tap(ref) {
		const held = this.held;
		const same = held && held.id === ref.id && held.dir === ref.dir && held.port === ref.port;
		if (held && held.dir !== ref.dir) this.#join(held, ref);
		this.#hold(!held || (held.dir === ref.dir && !same) ? ref : null);
	}
}
