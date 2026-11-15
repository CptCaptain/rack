import("stdfaust.lib");

gain = hslider("[0]Drive[scale:log]", 4, 1, 50, 0.1) : si.smoo;
tone = hslider("[1]Ton[unit:Hz][scale:log]", 6000, 300, 16000, 10) : si.smoo;
level = hslider("[2]Pegel", 0.6, 0, 1, 0.01) : si.smoo;

process = *(gain) : ma.tanh : fi.lowpass(1, tone) : *(level);
