"""How close Demucs gets to the studio's own music-and-effects stem.

SI-SDR (scale-invariant signal-to-distortion ratio, dB) of each background estimate against
input/ref-me.wav; "do nothing" (the original mix) is the baseline. The film's audio and the
studio stems may be offset, so the lag is found by cross-correlation first.
"""
import sys

import numpy as np
import soundfile as sf

RATE = 44100


def mono(path):
    data, rate = sf.read(path, always_2d=True)
    assert rate == RATE, f"{path}: {rate} Hz"
    return data.mean(axis=1)


def lag_of(a, b, max_lag_s=3.0, step=4):
    a, b = a[::step], b[::step]
    n = len(a) + len(b)
    corr = np.fft.irfft(np.fft.rfft(a, n) * np.conj(np.fft.rfft(b, n)), n)
    max_lag = int(max_lag_s * RATE / step)
    lags = np.concatenate([np.arange(0, max_lag), np.arange(-max_lag, 0)])
    values = np.concatenate([corr[:max_lag], corr[-max_lag:]])
    return int(lags[np.argmax(values)]) * step


def shift(x, lag, length):
    out = np.zeros(length)
    if lag >= 0:
        out[lag:] = x[: length - lag]
    else:
        out[: length + lag] = x[-lag:length]
    return out


def si_sdr(reference, estimate):
    reference = reference - reference.mean()
    estimate = estimate - estimate.mean()
    target = (estimate @ reference) / (reference @ reference) * reference
    noise = estimate - target
    return 10 * np.log10((target @ target) / (noise @ noise))


original = mono("input/orig.wav")
length = len(original)
mix = mono("input/ref-mix.wav")[:length]
lag = lag_of(original, mix)
print(f"film audio vs studio mix: lag {lag / RATE * 1000:.1f} ms")
me = shift(mono("input/ref-me.wav")[:length], lag, length)
dialogue = shift(mix, lag, length) - me

print(f"baseline, original mix as background: {si_sdr(me, original):6.2f} dB")
for model in sys.argv[1:]:
    background = mono(f"out/sep/{model}/orig/no_vocals.wav")[:length]
    vocals = mono(f"out/sep/{model}/orig/vocals.wav")[:length]
    print(
        f"{model:12s} background {si_sdr(me, background):6.2f} dB, "
        f"voice {si_sdr(dialogue, vocals):6.2f} dB"
    )
