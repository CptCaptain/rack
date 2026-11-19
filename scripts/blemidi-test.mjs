// Usage: node scripts/blemidi-test.mjs
// Feeds example BLE-MIDI packets to the parser and compares the plain MIDI messages.
import { bleMidiParser } from "../src/blemidi.js";
import { parseMidi } from "../src/midi.js";

let failed = 0;
const check = (name, packets, expected) => {
	const parse = bleMidiParser();
	const got = packets.flatMap((packet) => parse(new Uint8Array(packet)));
	const ok = JSON.stringify(got) === JSON.stringify(expected);
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`}`);
	if (!ok) failed++;
};

// Header 0x80, timestamp 0x80, then the message.
check("one note on", [[0x80, 0x80, 0x90, 60, 100]], [[0x90, 60, 100]]);
check("note on and note off, each with timestamp and status", [[0x80, 0x81, 0x90, 60, 100, 0x82, 0x80, 60, 0]], [[0x90, 60, 100], [0x80, 60, 0]]);
check("running status without timestamp (chord)", [[0x80, 0x81, 0x90, 60, 100, 64, 90, 67, 80]], [[0x90, 60, 100], [0x90, 64, 90], [0x90, 67, 80]]);
check("running status with a new timestamp", [[0xa3, 0x81, 0x90, 60, 100, 0x85, 60, 0]], [[0x90, 60, 100], [0x90, 60, 0]]);
check("running status carried into the next packet", [[0x80, 0x80, 0xb0, 1, 64], [0x81, 0x82, 1, 70]], [[0xb0, 1, 64], [0xb0, 1, 70]]);
check("pitch bend and a controller", [[0x80, 0x80, 0xe0, 0x00, 0x40, 0x80, 0xb0, 74, 127]], [[0xe0, 0, 64], [0xb0, 74, 127]]);
check("program change has one data byte", [[0x80, 0x80, 0xc0, 5, 0x81, 0x90, 60, 100]], [[0xc0, 5], [0x90, 60, 100]]);
check("channel 10 pad", [[0x80, 0x80, 0x99, 36, 127]], [[0x99, 36, 127]]);
check("SysEx in one packet is skipped", [[0x80, 0x80, 0xf0, 0x7e, 0x7f, 0x06, 0x01, 0x81, 0xf7, 0x82, 0x90, 60, 1]], [[0x90, 60, 1]]);
check("SysEx over two packets is skipped", [[0x80, 0x80, 0xf0, 1, 2, 3], [0x80, 4, 5, 0x81, 0xf7], [0x80, 0x80, 0x80, 60, 0]], [[0x80, 60, 0]]);
check("real-time clock between messages keeps running status", [[0x80, 0x80, 0xf8, 0x81, 0x90, 60, 100, 0x82, 0xf8, 0x83, 62, 100]], [[0x90, 60, 100], [0x90, 62, 100]]);
check("system common clears running status", [[0x80, 0x80, 0x90, 60, 100, 0x81, 0xf3, 2, 64, 100]], [[0x90, 60, 100]]);
check("cut-off message is dropped", [[0x80, 0x80, 0x90, 60]], []);
check("empty and broken packets give nothing", [[], [0x80], [0x00, 0x80, 0x90, 60, 100]], []);

const events = [[0x90, 64, 127], [0x90, 64, 0], [0xe0, 0, 64], [0xe0, 0x7f, 0x7f], [0xb0, 1, 127]].map(parseMidi);
const expected = [
	{ type: "note", channel: 1, note: 64, velocity: 1 },
	{ type: "note", channel: 1, note: 64, velocity: 0 },
	{ type: "bend", channel: 1, value: 0 },
	{ type: "bend", channel: 1, value: 16383 / 8192 - 1 },
	{ type: "cc", channel: 1, cc: 1, value: 127 },
];
const same = JSON.stringify(events) === JSON.stringify(expected);
console.log(`${same ? "ok  " : "FAIL"} parsed messages become the rack's note, bend and controller events`);
if (!same) failed++;

console.log(failed ? `\n${failed} problem(s)` : "\nall good");
process.exit(failed ? 1 : 0);
