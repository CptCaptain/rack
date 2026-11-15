import("stdfaust.lib");

steps = hslider("[0]Schritte", 8, 1, 16, 1) : int;
hits = hslider("[1]Treffer", 3, 0, 16, 1) : int : min(steps);
turn = hslider("[2]Dreh", 0, 0, 15, 1) : int;

rising(x) = (x > 0.5) <: _, mem : >;
count(tick, reset) = loop ~ _ with { loop(prev) = prev * (1 - reset) + tick; };

// Spreads the hits as evenly as possible over the steps (Euclidean rhythm).
process(clock, reset) = (clock > 0.5) * (((step + turn) * hits) % steps < hits)
with {
  step = (count(rising(clock), rising(reset)) - 1 : max(0)) % steps;
};
