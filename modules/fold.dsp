import("stdfaust.lib");

amount = hslider("[0]Falten", 2, 1, 10, 0.01) : si.smoo;
offset = hslider("[1]Schiefe", 0, -1, 1, 0.01) : si.smoo;

// Past its peak the wave folds back on itself, which adds bright overtones.
process(in, cv) = sin((in + offset) * (amount + cv * 4 : max(0)) * 0.5 * ma.PI);
