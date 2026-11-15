import("stdfaust.lib");

vowel = hslider("[0]Vokal", 0, 0, 4, 0.01) : si.smoo;
q = hslider("[1]Schärfe", 8, 2, 20, 0.1);

// The three strongest resonances of the mouth for A, E, I, O, U, one row per resonance.
formants = waveform{800, 350, 270, 450, 325,  1150, 2000, 2140, 800, 700,  2900, 2800, 2950, 2830, 2700};

// Three band-pass filters stand where the mouth resonates for the chosen vowel. Between two vowels they glide.
process(in, cv) = in <: par(i, 3, fi.resonbp(formant(i), q, 1)) :> *(0.5)
with {
  position = vowel + cv * 4 : max(0) : min(3.999);
  low = int(position);
  blend = position - low;
  formant(i) = (formants, i * 5 + low : rdtable) * (1 - blend) + (formants, i * 5 + low + 1 : rdtable) * blend;
};
