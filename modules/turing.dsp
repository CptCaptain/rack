import("stdfaust.lib");

chance = hslider("[0]Wandel", 0.3, 0, 1, 0.01);
length = hslider("[1]Schritte", 8, 2, 16, 1) : int;
range = hslider("[2]Bereich", 1, 0, 2, 0.01);

rising(x) = (x > 0.5) <: _, mem : >;
count(tick, reset) = loop ~ _ with { loop(prev) = prev * (1 - reset) + tick; };

// A loop of random values. Each clock pulse moves one step on. With Wandel at 0 the loop
// repeats for ever, at 1 every step is new, in between it changes slowly.
// Slot 16 of the table takes the writes that should not happen.
process(clock) = value * range, (clock > 0.5) & (value > 0)
with {
  tick = rising(clock);
  step = (count(tick, 0) - 1 : max(0)) % length;
  renew = tick & ((no.noises(2, 0) : abs) < chance);
  value = rwtable(17, no.noises(2, 1), ba.if(renew, step, 16), no.noises(2, 1), step);
};
