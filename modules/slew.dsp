import("stdfaust.lib");

rise = hslider("[0]Auf[unit:s][scale:log]", 0.1, 0.001, 5, 0.001);
fall = hslider("[1]Ab[unit:s][scale:log]", 0.1, 0.001, 5, 0.001);

// Follows its input, but only as fast as the two times allow.
process(x) = follow ~ _
with {
  follow(prev) = prev + (x - prev) * ba.if(x > prev, pace(rise), pace(fall));
  pace(seconds) = 1 - exp(-1 / (seconds * ma.SR));
};
