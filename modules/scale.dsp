import("stdfaust.lib");

factor = hslider("[0]Faktor", 1, -2, 2, 0.01) : si.smoo;
offset = hslider("[1]Offset", 0, -2, 2, 0.01) : si.smoo;

process = *(factor) : +(offset);
