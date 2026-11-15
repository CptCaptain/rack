import("stdfaust.lib");

chance = hslider("[0]Zufall", 1, 0, 1, 0.01);
range = hslider("[1]Bereich", 1, 0, 2, 0.01);
slew = hslider("[2]Weich[unit:s][scale:log]", 0.1, 0.005, 1, 0.005);

rising(x) = (x > 0.5) <: _, mem : >;

// Sample and hold: each clock pulse takes one value from the input plus noise.
process(clock, in) = held, (held : si.smooth(ba.tau2pole(slew)))
with {
  held = (in + no.noise * chance) * range : ba.sAndH(rising(clock));
};
