import("stdfaust.lib");

scale = nentry("[0]Skala[style:menu{'Dur':0;'Moll':1;'Penta Dur':2;'Penta Moll':3;'Chromatisch':4}]", 3, 0, 4, 1) : int;
root = hslider("[1]Grundton[unit:st]", 0, 0, 11, 1);

// One row of 12 per scale: the scale note at or below each semitone.
notes = waveform{
  0, 0, 2, 2, 4, 5, 5, 7, 7, 9, 9, 11,
  0, 0, 2, 3, 3, 5, 5, 7, 8, 8, 10, 10,
  0, 0, 2, 2, 4, 4, 4, 7, 7, 9, 9, 9,
  0, 0, 0, 3, 3, 5, 5, 7, 7, 7, 10, 10,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
};

process(pitch) = (octave * 12 + (notes, int(scale * 12 + step) : rdtable) + root) / 12
with {
  semis = floor(pitch * 12 - root + 0.5);
  octave = floor(semis / 12);
  step = semis - octave * 12;
};
