import("stdfaust.lib");

// attach keeps the knob in the module although no signal uses it; the page reads its value.
channel = hslider("[0]Kanal", 1, 1, 16, 1);

rising(x) = (x > 0.5) <: _, mem : >;

// The page reads note and gate about 60 times a second and sends the notes.
// Both are 4 ms late on purpose: a sequencer moves its pitch a moment after its gate,
// and reading the pitch at the gate edge would send the previous step's note.
// The gate is held for 40 ms so that a short pulse is not missed between two reads.
process(pitch, gate) = attach(attach(attach(gate, channel), note), held)
with {
  late = @(int(0.004 * ma.SR));
  start = rising(gate) : late;
  note = pitch * 12 + 60 : max(0) : min(127) : ba.sAndH(start) : hbargraph("[1]note[rack:hidden]", 0, 127);
  held = ((gate > 0.5) : late) | (ba.countdown(int(0.04 * ma.SR), start) > 0) : hbargraph("[2]gate[rack:hidden]", 0, 1);
};
