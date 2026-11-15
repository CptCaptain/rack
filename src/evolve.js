import { clamp, travel } from "./controls.js";

// Children of a patch: the same modules and cables, with some knobs nudged along their travel.
// strength 0..1 is how far a nudge may go. The Output's knobs stay as they are, so a child
// is never suddenly loud, and the tempo stays so the children can be compared.
export function breed(patch, defs, strength, count = 4) {
	const nudge = () => (Math.random() + Math.random() + Math.random() - 1.5) * strength;
	return Array.from({ length: count }, () => ({
		...patch,
		modules: patch.modules.map((m) => {
			const def = defs.get(m.type);
			if (def.speakers) return m;
			const params = { ...m.params };
			for (const c of def.controls) {
				if (c.hidden || c.type !== "knob" || c.unit === "BPM" || Math.random() < 0.4) continue;
				const scale = travel(c);
				params[c.address] = scale.fromTurn(clamp(scale.toTurn(m.params[c.address] ?? c.init) + nudge(), 0, 1));
			}
			return { ...m, params };
		}),
	}));
}
