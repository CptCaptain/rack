import("stdfaust.lib");

bpm = hslider("[0]Tempo[unit:BPM]", 110, 30, 240, 1);
width = hslider("[1]Gate", 0.5, 0.05, 0.95, 0.01);
run = hslider("[2]Lauf", 1, 0, 1, 1);

beat = (+(bpm / 60 / ma.SR * run) : ma.frac) ~ _;
pulse(perBeat) = (ma.frac(beat * perBeat) < width) * run;

process = pulse(1), pulse(2), pulse(4);
