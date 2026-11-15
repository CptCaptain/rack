import { clamp, travel } from "./controls.js";
import { keyboard } from "./keyboard.js";
import { pads } from "./pads.js";

const WIDGETS = { keyboard, pads };
const SVG = "http://www.w3.org/2000/svg";

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
	io.onValue((next) => button.setAttribute("aria-pressed", String(next === c.max)));
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
	constructor(rack, root) {
		this.rack = rack;
		this.root = root;
		this.modulesEl = h("div", { class: "modules" });
		this.svg = document.createElementNS(SVG, "svg");
		this.svg.setAttribute("class", "cables");
		root.replaceChildren(this.modulesEl, this.svg);
		this.outputs = new Map();
		this.values = new Map();
		// MIDI learn: while learning, a tap picks the control that the next controller move binds.
		this.learning = false;
		this.learnTarget = null;
		rack.onOutput = (id, address, value) => this.outputs.get(`${id} ${address}`)?.(value);
		new ResizeObserver(() => this.draw()).observe(this.modulesEl);
		this.modulesEl.addEventListener("pointerdown", (e) => this.#dragCable(e));
		this.modulesEl.addEventListener("dblclick", (e) => this.#unplug(e));
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
		});
		const close = h("button", { class: "close", title: "Modul entfernen", "aria-label": `${def.name} entfernen` }, "×");
		close.addEventListener("click", () => {
			this.rack.remove(id);
			this.render();
		});
		const controls = def.controls
			.filter((c) => !c.hidden)
			.map((c) => {
				const el = CONTROLS[c.type](c, io(c));
				el.dataset.address = c.address;
				const cc = this.rack.ccOf(id, c.address);
				if (cc !== undefined) el.dataset.cc = cc;
				return el;
			});
		const widget = WIDGETS[def.widget]?.(def, (address, value) => this.rack.poke(id, address, value));
		const jack = (dir) => (port, index) =>
			h("div", { class: `jack ${port.kind}`, "data-module": id, "data-dir": dir, "data-port": index }, h("i"), h("span", {}, port.name));
		return h(
			"section",
			{ class: "module", "data-id": id, style: `--color:${def.color};--cols:${def.columns}` },
			h("header", { title: def.description }, h("b", {}, def.name), close),
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

	#center(ref) {
		const r = this.#jackEl(ref).getBoundingClientRect();
		return this.#point(r.left + r.width / 2, r.top + r.height / 2);
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
		const paths = this.rack.cables.map(({ from, to }) =>
			path(this.#center({ id: from[0], dir: "out", port: from[1] }), this.#center({ id: to[0], dir: "in", port: to[1] }), kindOf(from)),
		);
		if (loose) paths.push(path(this.#center(loose.anchor), this.#point(loose.x, loose.y), "loose"));
		this.svg.replaceChildren(...paths);
	}

	#ref(jackEl) {
		return { id: jackEl.dataset.module, dir: jackEl.dataset.dir, port: Number(jackEl.dataset.port) };
	}

	// Dragging from a plugged input picks that cable up, so dropping it in the
	// open removes it and dropping it on another input moves it.
	#dragCable(down) {
		const jackEl = down.target.closest(".jack");
		if (!jackEl) return;
		down.preventDefault();
		let anchor = this.#ref(jackEl);
		if (anchor.dir === "in") {
			const plugged = this.rack.cables.findLast((c) => c.to[0] === anchor.id && c.to[1] === anchor.port);
			if (plugged) {
				this.rack.disconnect(plugged);
				anchor = { id: plugged.from[0], dir: "out", port: plugged.from[1] };
			}
		}
		jackEl.setPointerCapture(down.pointerId);
		const move = (e) => this.draw({ anchor, x: e.clientX, y: e.clientY });
		const end = (e) => {
			jackEl.removeEventListener("pointermove", move);
			jackEl.removeEventListener("pointerup", end);
			jackEl.removeEventListener("pointercancel", end);
			const target = e.type === "pointerup" && document.elementFromPoint(e.clientX, e.clientY)?.closest(".jack");
			if (target && target.dataset.dir !== anchor.dir) {
				const other = this.#ref(target);
				const [out, input] = anchor.dir === "out" ? [anchor, other] : [other, anchor];
				this.rack.connect([out.id, out.port], [input.id, input.port]);
			}
			this.draw();
		};
		jackEl.addEventListener("pointermove", move);
		jackEl.addEventListener("pointerup", end);
		jackEl.addEventListener("pointercancel", end);
		move(down);
	}

	#unplug(e) {
		const jackEl = e.target.closest(".jack");
		if (!jackEl) return;
		const { id, dir, port } = this.#ref(jackEl);
		const end = dir === "out" ? "from" : "to";
		for (const cable of this.rack.cables.filter((c) => c[end][0] === id && c[end][1] === port)) this.rack.disconnect(cable);
		this.draw();
	}
}
