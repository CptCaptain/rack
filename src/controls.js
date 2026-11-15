export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Knob travel 0..1 to value and back, linear or logarithmic, snapped to the control's step.
export function travel(c) {
	const span = c.log ? Math.log(c.max / c.min) : c.max - c.min;
	const snap = (v) => clamp(+(Math.round((v - c.min) / c.step) * c.step + c.min).toFixed(6), c.min, c.max);
	return {
		snap,
		toTurn: (v) => (c.log ? Math.log(v / c.min) : v - c.min) / span,
		fromTurn: (t) => snap(c.log ? c.min * Math.exp(t * span) : c.min + t * span),
	};
}

// A MIDI controller value 0..127 as a value of this control, or null if MIDI cannot set it.
export function valueFromMidi(c, value) {
	switch (c.type) {
		case "knob":
			return travel(c).fromTurn(value / 127);
		case "toggle":
			return value >= 64 ? c.max : c.min;
		case "select":
			return c.options[Math.round((value / 127) * (c.options.length - 1))].value;
		default:
			return null;
	}
}
