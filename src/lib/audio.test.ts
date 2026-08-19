import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TARGET_RATE,
  dbfs,
  encodeWav,
  isLowQualityInput,
  linearResample,
  micConstraints,
  normalize,
  peakOf,
} from "./audio.ts";

const tone = (n: number, amp = 1) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((i / 8) * Math.PI));

test("encodeWav writes a valid 16-bit mono PCM header", () => {
  const bytes = encodeWav(tone(100), TARGET_RATE);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, len: number) =>
    String.fromCharCode(...bytes.slice(at, at + len));

  assert.equal(ascii(0, 4), "RIFF");
  assert.equal(ascii(8, 4), "WAVE");
  assert.equal(ascii(12, 4), "fmt ");
  assert.equal(ascii(36, 4), "data");

  assert.equal(view.getUint16(20, true), 1, "format must be PCM");
  assert.equal(view.getUint16(22, true), 1, "must be mono");
  assert.equal(view.getUint32(24, true), TARGET_RATE);
  assert.equal(view.getUint16(34, true), 16, "must be 16-bit");

  // Azure's REST endpoint is sent a Content-Type declaring 16 kHz mono PCM, so
  // these header fields have to agree with that claim.
  assert.equal(view.getUint32(28, true), TARGET_RATE * 2, "byte rate");
  assert.equal(view.getUint16(32, true), 2, "block align");

  assert.equal(bytes.length, 44 + 100 * 2);
  assert.equal(view.getUint32(40, true), 100 * 2, "data chunk size");
});

test("encodeWav clamps out-of-range samples instead of wrapping", () => {
  const bytes = encodeWav(Float32Array.from([2, -2]), TARGET_RATE);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getInt16(44, true), 0x7fff);
  assert.equal(view.getInt16(46, true), -0x8000);
});

test("peakOf and dbfs report level", () => {
  // Float32 cannot represent 0.4 exactly, so compare with tolerance.
  assert.ok(Math.abs(peakOf(Float32Array.from([0.1, -0.4, 0.2])) - 0.4) < 1e-6);
  assert.equal(peakOf(new Float32Array(0)), 0);
  assert.ok(Math.abs(dbfs(1) - 0) < 1e-9);
  assert.ok(Math.abs(dbfs(0.5) - -6.02) < 0.01);
  assert.equal(dbfs(0), -100);
});

test("normalize boosts quiet audio to the target peak", () => {
  const quiet = tone(64, 0.09); // roughly what a laptop mic produced in Phase 0
  const { samples, gain, peak } = normalize(quiet);
  assert.ok(Math.abs(peak - 0.09) < 1e-6);
  assert.ok(gain > 1);
  assert.ok(Math.abs(peakOf(samples) - 0.7) < 1e-6);
});

test("normalize never attenuates already-loud audio", () => {
  const loud = tone(64, 0.95);
  const { samples, gain } = normalize(loud);
  assert.equal(gain, 1);
  assert.equal(samples, loud, "should return the original array untouched");
});

test("normalize survives digital silence without dividing by zero", () => {
  const { samples, gain } = normalize(new Float32Array(32));
  assert.equal(gain, 1);
  assert.ok(samples.every((s) => s === 0));
});

test("linearResample converts rate and length", () => {
  const input = Float32Array.from({ length: 48 }, (_, i) => i / 48);
  const out = linearResample(input, 48_000, 16_000);
  assert.equal(out.length, 16);
  assert.equal(out[0], input[0]);
  assert.equal(out[1], input[3], "should step by the rate ratio");

  assert.equal(linearResample(input, 16_000, 16_000), input, "no-op when rates match");
});

test("micConstraints disables the telephony DSP that gated speech", () => {
  const audio = micConstraints().audio as MediaTrackConstraints;
  // Phase 0 measured these costing ~15-20 dB, which would be read as recogniser
  // error rather than microphone error.
  assert.equal(audio.echoCancellation, false);
  assert.equal(audio.noiseSuppression, false);
  assert.equal(audio.autoGainControl, true);
  assert.equal(audio.channelCount, 1);
  assert.ok(!("deviceId" in audio), "no device pinned unless one is requested");

  const pinned = micConstraints("abc123").audio as MediaTrackConstraints;
  assert.deepEqual(pinned.deviceId, { exact: "abc123" });
});

test("isLowQualityInput flags Bluetooth and HFP sample rates", () => {
  assert.ok(isLowQualityInput("AirPods Pro"));
  assert.ok(isLowQualityInput("WH-1000XM4 (Bluetooth)"));
  assert.ok(isLowQualityInput("Some Headset"));
  assert.ok(isLowQualityInput("Unknown device", 16_000), "HFP rate");

  assert.ok(!isLowQualityInput("MacBook Pro Microphone", 48_000));
  assert.ok(!isLowQualityInput("MacBook Pro Microphone"));
  assert.ok(!isLowQualityInput("Studio Mic", 0), "unknown rate must not trip it");
});
