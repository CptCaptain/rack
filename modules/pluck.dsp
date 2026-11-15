import("stdfaust.lib");

octave = hslider("[0]Oktave", 0, -3, 3, 1);
decay = hslider("[1]Decay[unit:s][scale:log]", 2, 0.2, 8, 0.01);
bright = hslider("[2]Hell", 0.5, 0, 1, 0.01);
level = hslider("[3]Pegel", 0.8, 0, 1, 0.01) : si.smoo;

rising(x) = (x > 0.5) <: _, mem : >;

// Karplus-Strong: a noise burst circles through a delay as long as one period.
process(pitch, gate) = burst : (+ : de.fdelay(4096, period)) ~ damp : *(level)
with {
  freq = 261.626 * 2 ^ (pitch + octave) : max(30) : min(4000);
  burst = no.noise * en.ar(0.0005, 0.004, rising(gate));
  period = ma.SR / freq - 1 - 0.5 * (1 - bright) : max(1);
  damp(x) = (x * (1 + bright) + x' * (1 - bright)) / 2 * 0.001 ^ (1 / (freq * decay));
};
