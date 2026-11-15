import("stdfaust.lib");

gate = button("[0]gate[rack:hidden]");
note = nentry("[1]note[rack:hidden]", 60, 0, 127, 1);
velocity = nentry("[2]vel[rack:hidden]", 0.8, 0, 1, 0.01);
bend = nentry("[3]bend[rack:hidden]", 0, -1, 1, 0.001) : si.smoo;
mod = nentry("[4]mod[rack:hidden]", 0, 0, 1, 0.01) : si.smoo;
octave = hslider("[5]Oktave", 0, -3, 3, 1);
glide = hslider("[6]Glide[unit:s]", 0, 0, 0.5, 0.01);
bendRange = hslider("[7]Bendweite[unit:st]", 2, 0, 12, 1);

pitch = (note - 60) / 12 + octave : si.smooth(ba.tau2pole(max(glide, 0.0005)));

process = pitch + bend * bendRange / 12, gate, velocity, mod;
