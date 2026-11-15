import("stdfaust.lib");

process(a, b) = x & y, x | y, x xor y, 1 - x
with {
  x = a > 0.5;
  y = b > 0.5;
};
