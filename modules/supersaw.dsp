import("stdfaust.lib");

octave = hslider("[0]Oktave", 0, -4, 4, 1);
detune = hslider("[1]Detune", 0.35, 0, 1, 0.01) : si.smoo;
level = hslider("[2]Pegel", 0.7, 0, 1, 0.01) : si.smoo;

process(pitch) = par(i, 7, voice(i)) : spread
with {
  base = 261.626 * 2 ^ (pitch + (octave : si.smoo)) : max(0.01) : min(ma.SR * 0.4);
  voice(i) = os.sawtooth(base * 2 ^ ((i - 3) / 3 * detune * 0.6 / 12));
  spread(a, b, c, d, e, f, g) = (a + c + e + d * 0.7) * level / 2.2, (b + f + g + d * 0.7) * level / 2.2;
};
