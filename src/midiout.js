import { sendMidi } from "./midi.js";

// Module id -> the note that module is holding on the device, as [channel, note].
// It lives outside the widget because the rack redraws its panels while a note sounds.
const sounding = new Map();

export function releaseMidiOut(id) {
	const held = sounding.get(id);
	if (!held) return;
	sendMidi([0x80 | held[0], held[1], 0]);
	sounding.delete(id);
}

// Module widget "midiout": turns the hidden meters note and gate into MIDI notes.
export function midiout(def, io) {
	let note = 60;
	io.onOutput("note", (value) => (note = Math.round(value)));
	io.onOutput("gate", (value) => {
		if (value <= 0.5 || io.muted()) return releaseMidiOut(io.id);
		if (sounding.has(io.id)) return;
		const channel = io.value("Kanal") - 1;
		sounding.set(io.id, [channel, note]);
		sendMidi([0x90 | channel, note, 100]);
	});
	const el = document.createElement("p");
	el.className = "note";
	el.textContent = "Sendet an alle MIDI-Ausgänge. Erst oben „MIDI“ einschalten.";
	return el;
}
