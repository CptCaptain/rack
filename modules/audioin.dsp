import("stdfaust.lib");

level = hslider("[0]Pegel", 0.5, 0, 2, 0.01) : si.smoo;

meter(l, r) = attach(l, max(abs(l), abs(r)) : an.amp_follower_ar(0.005, 0.3) : hbargraph("[1]Signal", 0, 1)), r;

process = *(level), *(level) : meter;
