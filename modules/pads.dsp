import("stdfaust.lib");

pad(i) = button("[%i]pad%j[rack:hidden]") with { j = i + 1; };

process = par(i, 8, pad(i));
