import("stdfaust.lib");

steps = hslider("[0]Schritte", 16, 1, 16, 1) : int;

// One number per track, written by the grid on the module: bit n says whether step n plays.
track1 = nentry("[1]t1[rack:hidden]", 4369, 0, 65535, 1) : int;
track2 = nentry("[2]t2[rack:hidden]", 4112, 0, 65535, 1) : int;
track3 = nentry("[3]t3[rack:hidden]", 21845, 0, 65535, 1) : int;
track4 = nentry("[4]t4[rack:hidden]", 0, 0, 65535, 1) : int;

rising(x) = (x > 0.5) <: _, mem : >;
count(tick, reset) = loop ~ _ with { loop(prev) = prev * (1 - reset) + tick; };

process(clock, reset) = attach(hit(track1), step : hbargraph("[5]step[rack:hidden]", 0, 15)), hit(track2), hit(track3), hit(track4)
with {
  step = (count(rising(clock), rising(reset)) - 1 : max(0)) % steps;
  hit(pattern) = (clock > 0.5) & ((pattern >> step) & 1);
};
