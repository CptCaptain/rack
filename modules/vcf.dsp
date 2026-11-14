import("stdfaust.lib");

cutoff = hslider("[0]Cutoff[unit:Hz][scale:log]", 1200, 30, 12000, 1) : si.smoo;
resonance = hslider("[1]Resonanz", 0.3, 0, 1, 0.01) : si.smoo;
cvAmount = hslider("[2]CV-Anteil", 0.5, -1, 1, 0.01) : si.smoo;

// ve.moogLadder erwartet 0..1 fuer 20 Hz..20 kHz (exponentiell).
octave = log10(2) / 3;
normFreq(cv) = log10(cutoff / 20) / 3 + cv * cvAmount * 5 * octave : max(0) : min(0.96);
q = 0.7072 + resonance * resonance * 22;

process(in, cv) = in : ve.moogLadder(normFreq(cv), q);
