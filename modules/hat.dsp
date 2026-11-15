import("stdfaust.lib");

tone = hslider("[0]Ton[unit:Hz][scale:log]", 7000, 2000, 12000, 10);
decay = hslider("[1]Decay[unit:s][scale:log]", 0.05, 0.01, 0.6, 0.005);
level = hslider("[2]Pegel", 0.6, 0, 1, 0.01) : si.smoo;

rising(x) = (x > 0.5) <: _, mem : >;

process(gate) = no.noise : fi.highpass(4, tone) : *(en.ar(0.0005, decay, rising(gate)) * level);
