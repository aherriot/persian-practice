import assert from "node:assert/strict";
import { test } from "node:test";

import { pcmToFloat32 } from "./pcm.ts";

/** Little-endian int16 bytes, the format the speech API returns. */
function int16le(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return bytes;
}

test("decodes little-endian int16 to normalised floats", () => {
  const { samples, carry } = pcmToFloat32(int16le(0, 16384, -16384, 32767, -32768));
  assert.equal(samples.length, 5);
  assert.equal(samples[0], 0);
  assert.ok(Math.abs(samples[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(samples[2] - -0.5) < 1e-6);
  assert.ok(samples[3] > 0.999 && samples[3] <= 1);
  assert.equal(samples[4], -1);
  assert.equal(carry.length, 0);
});

test("carries a split sample across a chunk boundary", () => {
  // The failure this prevents: dropping the odd byte shifts every later sample
  // by one byte and turns the rest of the stream into noise.
  const whole = int16le(1000, -2000, 3000);
  const firstChunk = whole.slice(0, 3); // splits the second sample
  const secondChunk = whole.slice(3);

  const first = pcmToFloat32(firstChunk);
  assert.equal(first.samples.length, 1);
  assert.equal(first.carry.length, 1, "odd byte must be held, not discarded");

  const second = pcmToFloat32(secondChunk, first.carry);
  assert.equal(second.samples.length, 2);
  assert.equal(second.carry.length, 0);

  const rejoined = [...first.samples, ...second.samples];
  const reference = [...pcmToFloat32(whole).samples];
  assert.deepEqual(rejoined, reference, "split decoding must equal whole decoding");
});

test("survives byte-at-a-time delivery", () => {
  const whole = int16le(500, -500, 1500, -1500, 2500);
  const out: number[] = [];
  let carry: Uint8Array | undefined;
  for (const byte of whole) {
    const step = pcmToFloat32(Uint8Array.from([byte]), carry);
    carry = step.carry;
    out.push(...step.samples);
  }
  assert.deepEqual(out, [...pcmToFloat32(whole).samples]);
  assert.equal(carry?.length, 0);
});

test("handles empty input and an empty carry", () => {
  const { samples, carry } = pcmToFloat32(new Uint8Array(0));
  assert.equal(samples.length, 0);
  assert.equal(carry.length, 0);

  const withCarry = pcmToFloat32(new Uint8Array(0), Uint8Array.from([0x10]));
  assert.equal(withCarry.samples.length, 0);
  assert.equal(withCarry.carry.length, 1, "a lone carry byte must survive an empty chunk");
});

test("decodes a view into a larger buffer correctly", () => {
  // Stream readers hand back views over pooled buffers, so byteOffset is rarely
  // zero — reading the whole underlying ArrayBuffer would produce garbage.
  const backing = new Uint8Array(16);
  backing.set(int16le(4096, -4096), 6);
  const view = backing.subarray(6, 10);

  const { samples } = pcmToFloat32(view);
  assert.equal(samples.length, 2);
  assert.ok(Math.abs(samples[0] - 0.125) < 1e-6);
  assert.ok(Math.abs(samples[1] - -0.125) < 1e-6);
});
