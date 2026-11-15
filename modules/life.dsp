import("stdfaust.lib");

food = hslider("[0]Futter", 0.5, 0, 1, 0.01);
climate = hslider("[1]Klima", 0.5, 0, 1, 0.01);
mutation = hslider("[2]Mutation", 0.3, 0, 1, 0.01);
speed = hslider("[3]Tempo", 0.25, 0, 1, 0.01);
bang = button("[4]Urknall");

// Written by the page, which runs the world (src/life.js).
pitch = nentry("[5]pitch[rack:hidden]", 0, -1, 1, 0.001);
birth = button("[6]birth[rack:hidden]");
death = button("[7]death[rack:hidden]");
population = nentry("[8]pop[rack:hidden]", 0, 0, 1, 0.001) : si.smoo;
gene = nentry("[9]gene[rack:hidden]", 0, -1, 1, 0.001) : si.smoo;

unit = max(0) : min(1);

// Read by the page about 60 times a second: the environment, with the CV inputs added.
// The last one, speed, is also the clock of the world.
process(foodCv, climateCv) = attach(pitch, report), birth, death, population, gene
with {
  report = (food + foodCv : unit : hbargraph("[10]food[rack:hidden]", 0, 1)),
    (climate + climateCv : unit : hbargraph("[11]climate[rack:hidden]", 0, 1)),
    (mutation : hbargraph("[12]mutation[rack:hidden]", 0, 1)),
    (bang : hbargraph("[13]reset[rack:hidden]", 0, 1)),
    (speed : hbargraph("[14]speed[rack:hidden]", 0, 1)) :> _;
};
