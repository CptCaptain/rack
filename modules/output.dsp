import("stdfaust.lib");

volume = hslider("[0]Volume", 0.25, 0, 1, 0.01) : si.smoo;
limiter = hslider("[1]Limiter", 1, 0, 1, 1) > 0.5;

// The limiter is written out here instead of taken from compressors.lib, whose look-ahead
// limiters are GPL-3.0-only. The gain follows the louder channel's peak at once, so the
// output never passes the ceiling, and it recovers over the release time.
ceiling = 0.7;
release = 0.2;
limit(l, r) = l * gain, r * gain
with {
  peak = max(abs(l), abs(r)) : (max ~ *(ba.tau2pole(release)));
  gain = ceiling / max(peak, ceiling);
};
protect = _, _ <: limit, _, _ : \(ll, lr, l, r).(select2(limiter, l, ll), select2(limiter, r, lr));
clip = max(-1) : min(1);
meter(l, r) = attach(l, max(abs(l), abs(r)) : an.amp_follower_ar(0.005, 0.3) : hbargraph("[2]Pegel", 0, 1)), r;

process(mono, left, right) = (mono + left) * volume, (mono + right) * volume : protect : clip, clip : meter;
