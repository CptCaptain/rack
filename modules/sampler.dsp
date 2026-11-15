import("stdfaust.lib");

octave = hslider("[0]Oktave", 0, -3, 3, 1);
level = hslider("[1]Pegel", 0.8, 0, 1, 0.01) : si.smoo;
loop = hslider("[2]Schleife", 0, 0, 1, 1);

// The sample. The page hands it to the module under the name "sample" (src/sampler.js).
file = soundfile("sample[url:{'sample'}]", 1);
length = 0, 0 : file : _, !, !;
fileRate = 0, 0 : file : !, _, !;
at(i) = 0, i : file : !, !, _;

rising(x) = (x > 0.5) <: _, mem : >;

// A trigger plays the sample from its start, at the speed the pitch asks for. Pitch 0 is the
// sample as recorded. With Schleife on it repeats for as long as the gate is high.
process(pitch, gate) = (at(i) * (1 - f) + at(i + 1) * f) * fade * level
with {
  speed = 2 ^ (pitch + octave) * fileRate / ma.SR;
  // left counts the frames still to play down to 0, so a module that was never triggered is silent.
  left = step ~ _;
  step(prev) = ba.if(rising(gate), length, ba.if(again(prev), prev - speed + length, max(prev - speed, 0)));
  again(prev) = (loop > 0.5) & (gate > 0.5) & (prev - speed <= 0);
  pos = length - left;
  i = int(pos);
  f = pos - i;
  fade = min(1, pos / 64) * min(1, left / 64);
};
