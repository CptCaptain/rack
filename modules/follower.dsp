import("stdfaust.lib");

gain = hslider("[0]Gain[scale:log]", 2, 0.5, 20, 0.1);
release = hslider("[1]Release[unit:s][scale:log]", 0.2, 0.01, 2, 0.01);
threshold = hslider("[2]Schwelle", 0.3, 0, 1, 0.01);

// Turns how loud a sound is into a control signal, and into a gate while it is above the threshold.
process(in) = level, level > threshold
with {
  level = in * gain : an.amp_follower_ar(0.005, release) : min(1);
};
