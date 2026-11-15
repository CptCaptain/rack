import("stdfaust.lib");

rising(x) = (x > 0.5) <: _, mem : >;
count(tick, reset) = loop ~ _ with { loop(prev) = prev * (1 - reset) + tick; };

process(clock, reset) = every(2), every(3), every(4), every(8)
with {
  n = count(rising(clock), rising(reset)) - 1 : max(0);
  every(k) = (clock > 0.5) * (n % k == 0);
};
