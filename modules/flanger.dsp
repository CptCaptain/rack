import("stdfaust.lib");

rate = hslider("[0]Rate[unit:Hz][scale:log]", 0.25, 0.02, 5, 0.01);
depth = hslider("[1]Tiefe", 0.7, 0, 1, 0.01) : si.smoo;
feedback = hslider("[2]Feedback", 0.5, 0, 0.9, 0.01) : si.smoo;

sweep = (0.001 + 0.004 * depth * (os.osc(rate) * 0.5 + 0.5)) * ma.SR : min(1000);
wet = (+ : de.fdelay(1024, sweep)) ~ *(feedback);

process = _ <: _, wet :> *(0.5);
