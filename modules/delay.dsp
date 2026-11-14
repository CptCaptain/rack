import("stdfaust.lib");

time = hslider("[0]Zeit[unit:ms][scale:log]", 350, 10, 1500, 1) : si.smoo;
feedback = hslider("[1]Feedback", 0.45, 0, 0.92, 0.01) : si.smoo;
mix = hslider("[2]Mix", 0.35, 0, 1, 0.01) : si.smoo;

MAX = 131072;
samples = time * 0.001 * ma.SR : min(MAX - 2);
echo = (+ : de.fdelay(MAX, samples)) ~ *(feedback);

process = _ <: *(1 - mix), (echo : *(mix)) :> _;
