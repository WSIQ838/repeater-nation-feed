// Small helpers for raw 16-bit mono audio, used by the command line version.
export const TARGET_RATE = 48000;
export const FRAME_SAMPLES = 480; // 10 ms at 48 kHz

// RMS level 0..1 of 16-bit samples.
export function rms16(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const v = samples[i] / 32768; sum += v * v; }
  return Math.sqrt(sum / samples.length);
}

// Linear resampler that keeps its position between chunks, so a stream of any rate (rtl_fm's 24 kHz,
// a sound card's 44.1 kHz) arrives at 48 kHz without clicks at the joins.
export class Resampler {
  constructor(from, to = TARGET_RATE) { this.step = from / to; this.pos = 0; this.last = 0; }
  process(input) {
    if (this.step === 1) return Int16Array.from(input);
    // ext[0] is the last sample of the previous chunk, so interpolation across the join is exact.
    const ext = new Int16Array(input.length + 1);
    ext[0] = this.last; ext.set(input, 1);
    const out = [];
    let pos = this.pos;
    while (Math.floor(pos) + 1 < ext.length) {
      const i = Math.floor(pos), f = pos - i;
      out.push(Math.round(ext[i] * (1 - f) + ext[i + 1] * f));
      pos += this.step;
    }
    this.pos = pos - (ext.length - 1);
    this.last = ext[ext.length - 1];
    return Int16Array.from(out);
  }
}

// Collects arbitrary Int16 chunks and hands back exact frames.
export class Framer {
  constructor(size = FRAME_SAMPLES) { this.size = size; this.buf = new Int16Array(0); }
  push(chunk) {
    const merged = new Int16Array(this.buf.length + chunk.length);
    merged.set(this.buf); merged.set(chunk, this.buf.length);
    const frames = [];
    let o = 0;
    while (merged.length - o >= this.size) { frames.push(merged.slice(o, o + this.size)); o += this.size; }
    this.buf = merged.slice(o);
    return frames;
  }
}

// Bytes from a pipe may split a 16-bit sample; this keeps the odd byte for the next chunk.
export class PcmBytes {
  constructor() { this.rest = null; }
  push(bytes) {
    let b = bytes;
    if (this.rest) { b = Buffer.concat([this.rest, bytes]); this.rest = null; }
    if (b.length % 2) { this.rest = b.subarray(b.length - 1); b = b.subarray(0, b.length - 1); }
    return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  }
}
