import("stdfaust.lib");

tune = hslider("[0]Ton[unit:Hz]", 190, 100, 400, 1);
snap = hslider("[1]Rauschen", 0.7, 0, 1, 0.01);
decay = hslider("[2]Decay[unit:s][scale:log]", 0.18, 0.03, 0.8, 0.01);
level = hslider("[3]Pegel", 0.8, 0, 1, 0.01) : si.smoo;

rising(x) = (x > 0.5) <: _, mem : >;

process(gate) = (body + rattle) * level
with {
  hit = rising(gate);
  body = os.osc(tune * (1 + en.ar(0.0005, 0.03, hit) * 0.5)) * en.ar(0.001, decay * 0.6, hit) * (1 - snap * 0.5);
  rattle = no.noise : fi.highpass(2, 1200) : *(en.ar(0.001, decay, hit) * snap);
};
