import assert from "node:assert/strict";
import { Gate } from "../core/gate.js";
import { Resampler, Framer, PcmBytes, rms16 } from "../core/audio.js";

// Gate: opens after the attack time, stays open through short dips, closes after the hang time.
{
  const g = new Gate({ threshold: 0.1, attackMs: 100, hangMs: 500 });
  let t = 0; const ev = [];
  const run = (level, ms) => { for (let i = 0; i < ms / 10; i++) { const e = g.update(level, t); if (e) ev.push([e, t]); t += 10; } };
  run(0.01, 200);            // quiet: nothing
  run(0.5, 50);              // too short to open
  run(0.01, 100);
  assert.deepEqual(ev, []);
  run(0.5, 300);             // sustained: opens
  assert.equal(ev.length, 1); assert.equal(ev[0][0], "open");
  run(0.01, 300); run(0.5, 100); run(0.01, 300); // dips shorter than the hang time
  assert.equal(ev.length, 1);
  run(0.01, 700);            // long quiet: closes
  assert.equal(ev.length, 2); assert.equal(ev[1][0], "close");
  g.configure({ always: true });
  assert.equal(g.open, true);
}

// Resampler: 24 kHz to 48 kHz doubles the samples; chunk boundaries don't change the result.
{
  const input = Int16Array.from({ length: 2400 }, (_, i) => Math.round(Math.sin(i / 20) * 12000));
  const whole = new Resampler(24000).process(input);
  assert.ok(Math.abs(whole.length - 4800) <= 2);
  const r = new Resampler(24000); const parts = [];
  for (let o = 0; o < input.length; o += 333) parts.push(...r.process(input.slice(o, o + 333)));
  assert.ok(Math.abs(parts.length - whole.length) <= 2);
  for (let i = 5; i < Math.min(parts.length, whole.length) - 5; i++) assert.ok(Math.abs(parts[i] - whole[i]) <= 40, `sample ${i}`);
  const same = new Resampler(48000).process(input.slice(0, 10));
  assert.deepEqual([...same], [...input.slice(0, 10)]);
  const down = new Resampler(96000).process(Int16Array.from({ length: 960 }, (_, i) => i));
  assert.ok(Math.abs(down.length - 480) <= 2);
}

// Framer gives exact 480-sample frames and keeps the remainder.
{
  const f = new Framer(480);
  assert.equal(f.push(new Int16Array(400)).length, 0);
  const frames = f.push(new Int16Array(1000));
  assert.equal(frames.length, 2); assert.equal(frames[0].length, 480);
  assert.equal(f.buf.length, 440);
}

// PcmBytes keeps an odd trailing byte for the next chunk.
{
  const p = new PcmBytes();
  const a = p.push(Buffer.from([1, 0, 2]));
  assert.deepEqual([...a], [1]);
  const b = p.push(Buffer.from([0, 3, 0]));
  assert.deepEqual([...b], [2, 3]);
}

assert.ok(rms16(new Int16Array(100).fill(16384)) > 0.49 && rms16(new Int16Array(100)) === 0);
console.log("feed core checks passed");
