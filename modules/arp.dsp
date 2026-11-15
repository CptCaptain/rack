import("stdfaust.lib");

chord = nentry("[0]Akkord[style:menu{'Dur':0;'Moll':1;'Septime':2;'Quinte':3}]", 0, 0, 3, 1) : int;
mode = nentry("[1]Richtung[style:menu{'Auf':0;'Ab':1;'Auf und ab':2;'Zufall':3}]", 0, 0, 3, 1) : int;
octaves = hslider("[2]Oktaven", 2, 1, 4, 1) : int;

// The notes of each chord in semitones, four slots per chord, and how many of them count.
notes = waveform{0, 4, 7, 12,  0, 3, 7, 12,  0, 4, 7, 10,  0, 7, 12, 19};
sizes = waveform{3, 3, 4, 2};

rising(x) = (x > 0.5) <: _, mem : >;
count(tick, reset) = loop ~ _ with { loop(prev) = prev * (1 - reset) + tick; };

// Each clock pulse moves to the next note of the chord above the incoming pitch.
process(pitch, clock, reset) = pitch + semis / 12, clock > 0.5
with {
  size = sizes, chord : rdtable;
  total = size * octaves;
  n = count(rising(clock), rising(reset)) - 1 : max(0);
  swing = max(1, 2 * total - 2);
  upDown = n % swing <: ba.if(_ < total, _, swing - _);
  dice = no.noise * 0.5 + 0.5 : *(total) : int : min(total - 1) : ba.sAndH(rising(clock));
  k = ba.selectn(4, mode, n % total, total - 1 - n % total, upDown, dice) : int;
  semis = (notes, chord * 4 + k % size : rdtable) + 12 * int(k / size);
};
