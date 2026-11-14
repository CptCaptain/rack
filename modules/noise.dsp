import("stdfaust.lib");

level = hslider("[0]Pegel", 0.5, 0, 1, 0.01) : si.smoo;

process = no.noise * level, no.pink_noise * level * 4;
