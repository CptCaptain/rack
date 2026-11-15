export function parseMidi([status, a = 0, b = 0]) {
	const channel = (status & 15) + 1;
	switch (status >> 4) {
		case 9:
			return { type: "note", channel, note: a, velocity: b / 127 };
		case 8:
			return { type: "note", channel, note: a, velocity: 0 };
		case 11:
			return { type: "cc", channel, cc: a, value: b };
		case 14:
			return { type: "bend", channel, value: ((b << 7) | a) / 8192 - 1 };
		default:
			return null;
	}
}

let access;

export function sendMidi(bytes) {
	for (const output of access?.outputs.values() ?? []) output.send(bytes);
}

// Listens on every MIDI input, also on devices plugged in later.
export async function openMidi(onEvent, onDevices) {
	access = await navigator.requestMIDIAccess();
	const attach = () => {
		for (const input of access.inputs.values())
			input.onmidimessage = (e) => {
				const event = parseMidi(e.data);
				if (event) onEvent(event);
			};
		const names = (ports) => [...ports.values()].map((port) => port.name);
		onDevices(names(access.inputs), names(access.outputs));
	};
	access.onstatechange = attach;
	attach();
}
