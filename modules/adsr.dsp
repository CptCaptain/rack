import("stdfaust.lib");

attack = hslider("[0]Attack[unit:s][scale:log]", 0.01, 0.001, 4, 0.001);
decay = hslider("[1]Decay[unit:s][scale:log]", 0.2, 0.001, 4, 0.001);
sustain = hslider("[2]Sustain", 0.6, 0, 1, 0.01);
release = hslider("[3]Release[unit:s][scale:log]", 0.3, 0.001, 8, 0.001);

process(gate) = en.adsr(attack, decay, sustain, release, gate > 0.5);
