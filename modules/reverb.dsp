import("stdfaust.lib");

decay = hslider("[0]Dauer[unit:s][scale:log]", 3, 0.3, 12, 0.1);
bright = hslider("[1]Hell[unit:Hz][scale:log]", 6000, 1500, 15000, 10);
mix = hslider("[2]Mix", 0.3, 0, 1, 0.01) : si.smoo;

wet = _ <: re.zita_rev1_stereo(20, 200, bright, decay, decay * 0.7, 48000) : par(i, 2, *(mix));
dry = *(1 - mix) <: _, _;

process = _ <: dry, wet :> _, _;
