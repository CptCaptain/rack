import("stdfaust.lib");

channel(i) = *(hslider("[%i]In %j", 0.7, 0, 1, 0.01) : si.smoo) with { j = i + 1; };
master = hslider("[9]Summe", 0.7, 0, 1, 0.01) : si.smoo;

process = par(i, 4, channel(i)) :> *(master);
