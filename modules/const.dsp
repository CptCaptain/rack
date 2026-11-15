import("stdfaust.lib");

process = hslider("[0]Wert", 0, -1, 1, 0.01) : si.smoo;
