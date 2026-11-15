import("stdfaust.lib");

tune = hslider("[0]Ton[unit:Hz]", 140, 60, 400, 1);
decay = hslider("[1]Decay[unit:s][scale:log]", 0.3, 0.05, 1.5, 0.01);
level = hslider("[2]Pegel", 0.8, 0, 1, 0.01) : si.smoo;

rising(x) = (x > 0.5) <: _, mem : >;

process(gate) = sin(2 * ma.PI * phase) * en.ar(0.001, decay, hit) * level
with {
  hit = rising(gate);
  freq = tune * (1 + en.ar(0.0005, 0.08, hit) * 0.6);
  phase = (+(freq / ma.SR) : ma.frac) ~ *(1 - hit);
};
