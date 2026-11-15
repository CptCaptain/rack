import("stdfaust.lib");

time = hslider("[0]Zeit[unit:ms][scale:log]", 300, 10, 1000, 1) : si.smoo;
feedback = hslider("[1]Feedback", 0.5, 0, 0.9, 0.01) : si.smoo;
mix = hslider("[2]Mix", 0.4, 0, 1, 0.01) : si.smoo;

samples = time * 0.001 * ma.SR : min(65530);
tap = de.fdelay(65536, samples);

// The echo jumps from left to right and back: the left delay feeds the right one and the other way round.
process(in) = in * (1 - mix) + left * mix, in * (1 - mix) + right * mix
with {
  left = ((+(in) : tap) ~ (tap : *(feedback)));
  right = left : tap;
};
