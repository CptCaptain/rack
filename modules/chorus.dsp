import("stdfaust.lib");

rate = hslider("[0]Rate[unit:Hz][scale:log]", 0.6, 0.05, 5, 0.01);
depth = hslider("[1]Tiefe", 0.5, 0, 1, 0.01) : si.smoo;
mix = hslider("[2]Mix", 0.5, 0, 1, 0.01) : si.smoo;

voice(shift) = de.fdelay(2048, (0.012 + 0.005 * depth * os.oscp(rate, shift)) * ma.SR : min(2040));
side(shift) = _ <: *(1 - mix * 0.5), (voice(shift) : *(mix * 0.5)) :> _;

process = _ <: side(0), side(ma.PI / 2);
