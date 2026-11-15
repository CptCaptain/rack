import("stdfaust.lib");

glide = hslider("[0]Glätten[unit:s][scale:log]", 2, 0.01, 30, 0.01);

// Written by the page: the last value it fetched, scaled to 0..1 (src/web.js).
value = nentry("[1]value[rack:hidden]", 0, 0, 1, 0.0001);

process = value : si.smooth(ba.tau2pole(glide)) <: _, 2 * _ - 1;
