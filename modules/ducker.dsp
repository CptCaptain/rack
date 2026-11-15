import("stdfaust.lib");

depth = hslider("[0]Tiefe", 0.8, 0, 1, 0.01) : si.smoo;
release = hslider("[1]Release[unit:s][scale:log]", 0.25, 0.02, 2, 0.01);

// Sidechain: the louder the signal at Side, the quieter In gets. A kick at Side makes a pad pump.
process(in, side) = in * (1 - depth * (side * 2 : an.amp_follower_ar(0.003, release) : min(1)));
