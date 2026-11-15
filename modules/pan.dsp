import("stdfaust.lib");

position = hslider("[0]Pan", 0, -1, 1, 0.01) : si.smoo;

process(in, cv) = in * cos(angle), in * sin(angle)
with {
  angle = (position + cv : max(-1) : min(1)) * 0.25 * ma.PI + 0.25 * ma.PI;
};
