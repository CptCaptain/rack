export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A control's travel 0..1 to its value and back. MIDI and modulation both work on the
// travel, so a logarithmic knob, a stepped knob, a switch and a menu all behave sensibly.
// Returns null for a control that nothing but a finger can set.
export function travel(c) {
	if (c.type === "toggle") return { snap: (v) => v, toTurn: (v) => (v === c.max ? 1 : 0), fromTurn: (t) => (t >= 0.5 ? c.max : c.min) };
	if (c.type === "select") {
		const last = c.options.length - 1;
		return {
			snap: (v) => v,
			toTurn: (v) => c.options.findIndex((option) => option.value === v) / last,
			fromTurn: (t) => c.options[Math.round(clamp(t, 0, 1) * last)].value,
		};
	}
	if (c.type !== "knob") return null;
	const span = c.log ? Math.log(c.max / c.min) : c.max - c.min;
	const snap = (v) => clamp(+(Math.round((v - c.min) / c.step) * c.step + c.min).toFixed(6), c.min, c.max);
	return {
		snap,
		toTurn: (v) => (c.log ? Math.log(v / c.min) : v - c.min) / span,
		fromTurn: (t) => snap(c.log ? c.min * Math.exp(t * span) : c.min + t * span),
	};
}

// A MIDI controller value 0..127 as a value of this control, or null if MIDI cannot set it.
export const valueFromMidi = (c, value) => travel(c)?.fromTurn(value / 127) ?? null;
