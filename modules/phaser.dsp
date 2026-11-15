import("stdfaust.lib");

rate = hslider("[0]Rate[unit:Hz][scale:log]", 0.4, 0.02, 8, 0.01);
depth = hslider("[1]Tiefe", 0.8, 0, 1, 0.01) : si.smoo;
feedback = hslider("[2]Feedback", 0.5, 0, 0.9, 0.01) : si.smoo;

sweep = 300 * 2 ^ ((os.osc(rate) * 0.5 + 0.5) * depth * 3.5);
coef = (t - 1) / (t + 1) with { t = tan(ma.PI * sweep / ma.SR); };
allpass = fi.tf1(coef, 1, coef);
wet = (+ : seq(i, 4, allpass)) ~ *(feedback);

process = _ <: _, wet :> *(0.5);
