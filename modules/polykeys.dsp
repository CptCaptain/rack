import("stdfaust.lib");

octave = hslider("[0]Oktave", 0, -3, 3, 1);
bendRange = hslider("[1]Bendweite[unit:st]", 2, 0, 12, 1);
bend = nentry("[2]bend[rack:hidden]", 0, -1, 1, 0.001) : si.smoo;

// Four voices. The keyboard on the module hands each key to one of them.
voice(v) = (note - 60) / 12 + octave + bend * bendRange / 12, gate, velocity
with {
  n = v + 1;
  gate = button("[3]gate%n[rack:hidden]");
  note = nentry("[4]note%n[rack:hidden]", 60, 0, 127, 1);
  velocity = nentry("[5]vel%n[rack:hidden]", 0.8, 0, 1, 0.01);
};

process = par(v, 4, voice(v));
