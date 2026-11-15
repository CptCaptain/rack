import("stdfaust.lib");

octave = hslider("[0]Oktave", 0, -4, 4, 1);
ratio = hslider("[1]Verhältnis", 2, 0.5, 8, 0.5);
index = hslider("[2]Index", 2, 0, 10, 0.01) : si.smoo;

// Two sines. The second one bends the phase of the first: little index sounds soft,
// much index sounds metallic. A whole-number ratio is in tune, a crooked one sounds like a bell.
process(pitch, indexCv) = sin(2 * ma.PI * phase(freq) + sin(2 * ma.PI * phase(freq * ratio)) * max(0, index + indexCv * 5))
with {
  freq = 261.626 * 2 ^ (pitch + octave) : max(0.01) : min(ma.SR * 0.2);
  phase(f) = (+(f / ma.SR) : ma.frac) ~ _;
};
