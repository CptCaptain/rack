import("stdfaust.lib");

tune = hslider("[0]Ton[unit:Hz]", 50, 30, 120, 1);
decay = hslider("[1]Decay[unit:s][scale:log]", 0.35, 0.05, 1.5, 0.01);
punch = hslider("[2]Punch", 0.6, 0, 1, 0.01);
level = hslider("[3]Pegel", 0.9, 0, 1, 0.01) : si.smoo;

rising(x) = (x > 0.5) <: _, mem : >;

process(gate) = sin(2 * ma.PI * phase) * en.ar(0.001, decay, hit) * level
with {
  hit = rising(gate);
  freq = tune * (1 + en.ar(0.0005, 0.06, hit) * punch * 6);
  // Restarting the phase on each hit makes every kick start the same way.
  phase = (+(freq / ma.SR) : ma.frac) ~ *(1 - hit);
};
