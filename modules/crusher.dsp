import("stdfaust.lib");

bits = hslider("[0]Bits", 6, 1, 16, 1);
rate = hslider("[1]Rate[unit:Hz][scale:log]", 6000, 100, 20000, 1);
mix = hslider("[2]Mix", 1, 0, 1, 0.01) : si.smoo;

phase = (+(rate / ma.SR) : ma.frac) ~ _;
tick = phase < phase';
steps = 2 ^ (bits - 1);
crush = ba.sAndH(tick) : *(steps) : +(0.5) : floor : /(steps);

process = _ <: *(1 - mix), (crush : *(mix)) :> _;
