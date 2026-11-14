import("stdfaust.lib");

octave = hslider("[0]Oktave", 0, -4, 4, 1);
tune = hslider("[1]Stimmung[unit:st]", 0, -12, 12, 1);
fine = hslider("[2]Fein[unit:ct]", 0, -100, 100, 1);
fmAmount = hslider("[3]FM", 0, 0, 1, 0.01);

// Pitch 0 = C4, +1 = eine Oktave hoeher (wie 1 V/Oktave).
freq(pitch, fm) = 261.626 * 2 ^ (pitch + fm * fmAmount + (octave + tune / 12 + fine / 1200 : si.smoo))
  : max(0.01) : min(ma.SR * 0.45);

process(pitch, fm) = os.osc(f), os.sawtooth(f), os.square(f)
with {
  f = freq(pitch, fm);
};
