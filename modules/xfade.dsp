import("stdfaust.lib");

position = hslider("[0]Mix", 0, 0, 1, 0.01) : si.smoo;

process(a, b, cv) = a * (1 - m) + b * m
with {
  m = position + cv : max(0) : min(1);
};
