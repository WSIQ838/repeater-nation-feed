import { Room, RoomEvent, createLocalAudioTrack } from "livekit-client";
import { Gate } from "../../core/gate.js";
import { radioFeedToken } from "./auth";

const REFRESH_MS = 23 * 3600 * 1000; // feed tokens last 24 hours
const TICK_MS = 50;

// Takes audio from one input device and publishes it into a listen-only channel's room. With the
// squelch on, audio is only published while there is a signal (like a radio keying up), so listeners
// see "on air" only when something is actually coming through; "always on" publishes continuously.
export class FeedPublisher {
  constructor({ channel, deviceId, gate, onStatus, onLevel, onAir }) {
    this.channel = channel; this.deviceId = deviceId || "";
    this.gate = new Gate(gate);
    this.onStatus = onStatus || (() => {}); this.onLevel = onLevel || (() => {}); this.onAir = onAir || (() => {});
    this.room = null; this.track = null; this.timer = null; this.refresh = null; this.retry = null;
    this.running = false; this.published = false; this.ctx = null; this.analyser = null; this.buf = null;
  }

  configureGate(g) { this.gate.configure(g); }

  async start() {
    this.running = true;
    this.onStatus("Opening the audio input…");
    this.track = await createLocalAudioTrack({
      deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
    });
    this.ctx = new AudioContext();
    try { await this.ctx.resume(); } catch { /* the first click resumes it */ }
    const src = this.ctx.createMediaStreamSource(new MediaStream([this.track.mediaStreamTrack]));
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    await this.connect();
  }

  async connect() {
    if (!this.running) return;
    clearTimeout(this.retry); clearTimeout(this.refresh);
    this.onStatus("Connecting to the channel…");
    try {
      const f = await radioFeedToken(this.channel.id, this.channel.name);
      if (!f?.token) throw new Error(f?.error || "The server didn't give a feed connection.");
      const room = new Room();
      room.on(RoomEvent.Disconnected, () => {
        if (this.room !== room) return;
        this.room = null; this.published = false; this.onAir(false);
        if (this.running) { this.onStatus("Lost the connection. Reconnecting…"); this.retry = setTimeout(() => this.connect(), 4000); }
      });
      await room.connect(f.url, f.token);
      this.room = room;
      this.gate.reset();
      this.onStatus(this.gate.always ? "Live (always on)" : "Connected. Waiting for a signal.");
      // A new token well before this one runs out.
      this.refresh = setTimeout(async () => { await this.drop(); this.connect(); }, REFRESH_MS);
    } catch (e) {
      // A refusal (not an admin, channel not listen only) won't fix itself; a network failure will.
      const fatal = e?.status === 403 || e?.status === 404 || e?.status === 409;
      this.onStatus(`${e?.message || "Could not connect."}${fatal ? "" : " Trying again…"}`);
      if (fatal) { await this.stop(); this.onStatus(e?.message || "Could not connect."); this.onFatal?.(e); }
      else if (this.running) this.retry = setTimeout(() => this.connect(), 5000);
    }
  }

  level() {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    return Math.sqrt(sum / this.buf.length);
  }

  async tick() {
    if (!this.analyser) return;
    const lvl = this.level();
    this.onLevel(lvl);
    if (!this.room) return;
    const ev = this.gate.update(lvl, performance.now());
    if (ev === "open" || (this.gate.open && !this.published)) await this.publish();
    else if (ev === "close") await this.unpublish();
  }

  async publish() {
    if (this.published || !this.room || !this.track) return;
    this.published = true;
    try { await this.room.localParticipant.publishTrack(this.track, { name: "radio-microphone", dtx: true }); this.onAir(true); this.onStatus("On air"); }
    catch (e) { this.published = false; this.onStatus(`Could not publish audio: ${e?.message || e}`); }
  }

  async unpublish() {
    if (!this.published) return;
    this.published = false; this.onAir(false);
    try { await this.room?.localParticipant.unpublishTrack(this.track, false); } catch { /* already gone */ }
    this.onStatus("Connected. Waiting for a signal.");
  }

  async drop() {
    await this.unpublish();
    const r = this.room; this.room = null;
    try { await r?.disconnect(); } catch { /* already gone */ }
  }

  async stop() {
    this.running = false;
    clearInterval(this.timer); clearTimeout(this.retry); clearTimeout(this.refresh);
    await this.drop();
    try { this.track?.stop(); } catch { /* already stopped */ }
    try { await this.ctx?.close(); } catch { /* already closed */ }
    this.track = null; this.ctx = null; this.analyser = null;
    this.onLevel(0); this.onAir(false); this.onStatus("Stopped.");
  }
}
