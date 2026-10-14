"""
How a word opens, from its waveform: for each wav, the time from the first
sound to half the loudest level, then two rows of 5 ms steps — loudness, and
how noisy the signal is (zero crossings). A stop is a short burst and a fast
rise; a voiced fricative is a long quiet lead-in. Used for FINDINGS §16.

Usage: for f in spike/out/gh/*.mp3; do afconvert -f WAVE -d LEI16@16000 -c 1 "$f" "${f%.mp3}.wav"; done
       python3 spike/gh-onset.py spike/out/gh ghazâ.
"""
import sys, wave, struct, math, glob, os
def load(p):
    w = wave.open(p); n = w.getnframes()
    return struct.unpack("<%dh" % n, w.readframes(n))
F = 80  # 5 ms at 16 kHz
def frames(x):
    out = []
    for i in range(0, len(x) - F, F):
        seg = x[i:i+F]
        rms = math.sqrt(sum(s*s for s in seg) / F)
        zc = sum(1 for a, b in zip(seg, seg[1:]) if (a < 0) != (b < 0))
        out.append((rms, zc))
    return out
for p in sorted(glob.glob(sys.argv[1] + "/*.wav")):
    name = os.path.basename(p)[:-4]
    if not any(k in name for k in sys.argv[2:]): continue
    fr = frames(load(p))
    peak = max(r for r, _ in fr)
    start = next(i for i, (r, _) in enumerate(fr) if r > 0.02 * peak)
    # time from first sound to the vowel at half its peak
    half = next(i for i, (r, _) in enumerate(fr) if r > 0.5 * peak)
    env = "".join(" .:-=+*#%@"[min(9, int(10 * r / peak))] for r, _ in fr[start:start+50])
    zc = "".join(str(min(9, z // 5)) for _, z in fr[start:start+50])
    print(f"{name:34s} rise {5*(half-start):4d}ms  {env}\n{'':46s}{zc}")
