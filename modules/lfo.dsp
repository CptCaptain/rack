import("stdfaust.lib");

rate = hslider("[0]Rate[unit:Hz][scale:log]", 2, 0.02, 40, 0.01);
depth = hslider("[1]Tiefe", 1, 0, 1, 0.01) : si.smoo;

phase = (+(rate / ma.SR) : ma.frac) ~ _;

process = sin(2 * ma.PI * phase), 1 - 4 * abs(phase - 0.5), (phase < 0.5) * 2 - 1 : par(i, 3, *(depth));
