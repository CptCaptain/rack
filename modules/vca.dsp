import("stdfaust.lib");

level = hslider("[0]Pegel", 0, 0, 1, 0.01) : si.smoo;

process(in, cv) = in * (level + cv : max(0) : min(1));
