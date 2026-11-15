import("stdfaust.lib");

mix = hslider("[0]Mix", 1, 0, 1, 0.01) : si.smoo;

process(a, b) = a * (1 - mix) + a * b * mix;
