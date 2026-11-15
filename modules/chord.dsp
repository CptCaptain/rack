import("stdfaust.lib");

kind = nentry("[0]Akkord[style:menu{'Dur':0;'Moll':1;'Sus4':2;'Septime':3;'Moll 7':4}]", 0, 0, 4, 1) : int;

// Semitones above the incoming pitch for each of the four outputs, one row per chord.
notes = waveform{0, 4, 7, 12,  0, 3, 7, 12,  0, 5, 7, 12,  0, 4, 7, 10,  0, 3, 7, 10};

process(pitch) = par(i, 4, pitch + (notes, kind * 4 + i : rdtable) / 12);
