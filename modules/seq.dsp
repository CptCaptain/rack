import("stdfaust.lib");

N = 8;
steps = hslider("[0]Stufen", N, 1, N, 1) : int;
glide = hslider("[1]Glide[unit:s]", 0, 0, 0.3, 0.01);
note(i) = hslider("[3%i]%j[unit:st]", 0, -12, 24, 1) with { j = i + 1; };

rising(x) = (x > 0.5) <: _, mem : >;
count(tick, reset) = loop ~ _ with { loop(prev) = prev * (1 - reset) + tick; };

process(clock, reset) = attach(pitch, step : hbargraph("[2]Schritt[rack:leds]", 0, N - 1)), clock > 0.5
with {
  step = (count(rising(clock), rising(reset)) - 1 : max(0)) % steps;
  pitch = par(i, N, note(i) * (step == i)) :> /(12) : si.smooth(ba.tau2pole(max(glide, 0.0005)));
};
