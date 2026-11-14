import("stdfaust.lib");

volume = hslider("[0]Volume", 0.25, 0, 1, 0.01) : si.smoo;
limiter = hslider("[1]Limiter", 1, 0, 1, 1) > 0.5;

limit = co.limiter_lad_stereo(0.005, 0.7, 0.005, 0.05, 0.2);
protect = _, _ <: limit, _, _ : \(ll, lr, l, r).(select2(limiter, l, ll), select2(limiter, r, lr));
clip = max(-1) : min(1);
meter(l, r) = attach(l, max(abs(l), abs(r)) : an.amp_follower_ar(0.005, 0.3) : hbargraph("[2]Pegel", 0, 1)), r;

process(mono, left, right) = (mono + left) * volume, (mono + right) * volume : protect : clip, clip : meter;
