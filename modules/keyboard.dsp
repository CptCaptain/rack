import("stdfaust.lib");

gate = button("[0]gate[rack:hidden]");
note = nentry("[1]note[rack:hidden]", 60, 0, 127, 1);
octave = hslider("[2]Oktave", 0, -3, 3, 1);
glide = hslider("[3]Glide[unit:s]", 0, 0, 0.5, 0.01);

process = ((note - 60) / 12 + octave : si.smooth(ba.tau2pole(max(glide, 0.0005)))), gate;
