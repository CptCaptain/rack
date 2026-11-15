import("stdfaust.lib");

tone = hslider("[0]Ton[unit:Hz][scale:log]", 1200, 500, 4000, 10);
decay = hslider("[1]Decay[unit:s][scale:log]", 0.25, 0.05, 1, 0.01);
level = hslider("[2]Pegel", 0.8, 0, 1, 0.01) : si.smoo;

rising(x) = (x > 0.5) <: _, mem : >;

// Three short bursts of noise close together, then a tail: several hands, a moment apart.
process(gate) = no.noise : fi.resonbp(tone, 2, 1) : *(hands * level)
with {
  hit = rising(gate);
  later(ms) = hit : @(int(ms * 0.001 * ma.SR));
  hands = en.ar(0.001, 0.01, hit) + en.ar(0.001, 0.01, later(11)) + en.ar(0.001, 0.01, later(23)) + en.ar(0.001, decay, later(32)) : min(1);
};
