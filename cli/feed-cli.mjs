#!/usr/bin/env node
// Repeater Nation Feed (command line): streams audio from a sound card, ffmpeg input or stdin
// (for example rtl_fm from an RTL-SDR) into a stream channel. Runs unattended on a Raspberry Pi.
import { spawn } from "node:child_process";
import { createClient } from "@base44/sdk";
import { Room, RoomEvent, AudioSource, AudioFrame, LocalAudioTrack, TrackPublishOptions, TrackSource } from "@livekit/rtc-node";
import { Gate } from "./core/gate.js";
import { Resampler, Framer, PcmBytes, rms16, TARGET_RATE } from "./core/audio.js";

const HELP = `Repeater Nation Feed (command line)

  repeater-nation-feed --channel <name or id> [input] [options]

Input (choose one):
  --stdin --rate 24000      raw 16-bit mono audio on standard input, e.g.
                            rtl_fm -f 162.55M -M fm -s 24000 -l 30 | repeater-nation-feed --channel "NOAA" --stdin --rate 24000
  --ffmpeg-input "-f alsa -i default"   any ffmpeg input (needs ffmpeg), e.g. -f pulse -i default, -f dshow -i audio="Line In"

Options:
  --email / --password      the account to sign in with (or FEED_EMAIL / FEED_PASSWORD)
  --always                  send audio all the time (default: only while there is a signal)
  --threshold 0.03          squelch level, 0 to 1 (watch the printed level to choose)
  --hang 1500               milliseconds to stay open after the signal stops
  --list                    show the channels you can feed, then exit
  --base-url / --app-id     for a different Repeater Nation server
`;

const args = (() => {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith("--")) continue;
    const k = a[i].slice(2);
    const v = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : true;
    o[k] = v;
  }
  return o;
})();
if (args.help || process.argv.length < 3) { console.log(HELP); process.exit(0); }

const APP_URL = args["base-url"] || process.env.FEED_BASE_URL || "https://repeaternation.com";
const APP_ID = args["app-id"] || process.env.FEED_APP_ID || "6a6d787f8e808727b935dd09";
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

const client = createClient({ appId: APP_ID, serverUrl: APP_URL, requiresAuth: false, appBaseUrl: APP_URL });
async function invoke(name, payload) {
  try { const r = await client.functions.invoke(name, payload); return r?.data || r; }
  catch (e) { const d = e?.response?.data || e?.data; throw Object.assign(new Error(String(d?.error || d?.message || e.message)), { status: e?.response?.status ?? e?.status }); }
}

async function signIn() {
  const email = args.email || process.env.FEED_EMAIL, password = args.password || process.env.FEED_PASSWORD;
  if (!email || !password) throw new Error("Give --email and --password (or FEED_EMAIL and FEED_PASSWORD).");
  await client.auth.loginViaEmailPassword(email, password);
  const me = await client.auth.me();
  log(`Signed in as ${me.full_name || me.email}`);
  return me;
}

async function findChannel(me) {
  const [zones, channels] = await Promise.all([client.entities.RadioZone.list("display_order", 200), client.entities.RadioChannel.list("number", 500)]);
  const admin = ["admin", "super_admin"].includes(me.role);
  const mine = admin ? channels : channels.filter((c) => c.feed_owner_user_id === me.id);
  const listenOnly = (c) => c.listen_only === true || zones.find((z) => z.id === c.zone_id)?.listen_only === true;
  if (args.list) {
    for (const c of mine) console.log(`${c.id}  ${c.name}${listenOnly(c) ? "" : "  (not listen only)"}`);
    process.exit(0);
  }
  const want = String(args.channel || "").trim().toLowerCase();
  if (!want) throw new Error("Say which channel with --channel (use --list to see them).");
  const hit = mine.find((c) => c.id === args.channel) || mine.find((c) => String(c.name).toLowerCase() === want) || mine.find((c) => String(c.name).toLowerCase().includes(want));
  if (!hit) throw new Error(`No channel called "${args.channel}" that you can feed. Use --list.`);
  return hit;
}

// ---- audio in: stdin or ffmpeg, as 48 kHz mono 16-bit frames ----
function openInput() {
  let stream, rate = TARGET_RATE, child = null;
  if (args.stdin) { stream = process.stdin; rate = Number(args.rate) || 48000; }
  else if (args["ffmpeg-input"]) {
    const inputArgs = String(args["ffmpeg-input"]).match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, ""));
    child = spawn("ffmpeg", ["-loglevel", "error", ...inputArgs, "-ac", "1", "-ar", String(TARGET_RATE), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "inherit"] });
    child.on("error", (e) => { console.error(`Could not run ffmpeg: ${e.message}. Install ffmpeg, or use --stdin.`); process.exit(1); });
    child.on("exit", (code) => { console.error(`ffmpeg stopped (${code}).`); process.exit(1); });
    stream = child.stdout;
  } else throw new Error('Choose an input: --stdin --rate N, or --ffmpeg-input "-f alsa -i default".');
  const bytes = new PcmBytes(), resample = new Resampler(rate), framer = new Framer();
  return { stream, frames: (chunk) => framer.push(resample.process(bytes.push(chunk))) };
}

// ---- publishing ----
const gate = new Gate({ always: !!args.always, threshold: Number(args.threshold) || 0.03, hangMs: Number(args.hang) || 1500 });
let room = null, pub = null, source = null, connecting = false, lastLevelLog = 0, peak = 0;

async function getRoom(channel) {
  const f = await invoke("radio-feed", { action: "token", channel_id: channel.id, label: channel.name });
  if (!f?.token) throw new Error(f?.error || "No feed connection from the server.");
  const r = new Room();
  await r.connect(f.url, f.token, { autoSubscribe: false, dynacast: true });
  r.on(RoomEvent.Disconnected, () => { if (room === r) { room = null; pub = null; source = null; log("Lost the connection."); } });
  return r;
}

async function keepConnected(channel) {
  if (connecting) return; connecting = true;
  for (;;) {
    try { room = await getRoom(channel); log(`Connected to "${channel.name}".`); break; }
    catch (e) {
      if ([403, 404, 409].includes(e.status)) { console.error(e.message); process.exit(1); }
      log(`${e.message} Trying again in 5 seconds…`); await new Promise((r) => setTimeout(r, 5000));
    }
  }
  connecting = false;
  setTimeout(() => { const r = room; room = null; pub = null; source = null; r?.disconnect().catch(() => {}); keepConnected(channel); }, 23 * 3600 * 1000);
}

async function openAir() {
  if (pub || !room) return;
  source = new AudioSource(TARGET_RATE, 1);
  const track = LocalAudioTrack.createAudioTrack("radio-microphone", source);
  pub = await room.localParticipant.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
  log("On air");
}
async function closeAir() {
  if (!pub) return;
  const p = pub; pub = null; source = null;
  try { await room?.localParticipant.unpublishTrack(p.sid); } catch { /* already gone */ }
  log("Off air");
}

async function main() {
  const me = await signIn();
  const channel = await findChannel(me);
  const input = openInput();
  log(`Feeding "${channel.name}" ${gate.always ? "all the time" : `with a squelch at ${gate.threshold} (hang ${gate.hangMs} ms)`}`);
  await keepConnected(channel);
  let busy = Promise.resolve();
  input.stream.on("data", (chunk) => {
    for (const frame of input.frames(chunk)) {
      const level = rms16(frame); peak = Math.max(peak, level);
      const now = Date.now();
      if (now - lastLevelLog > 10000) { log(`input level (last 10 s) ${peak.toFixed(3)}`); peak = 0; lastLevelLog = now; }
      const ev = room ? gate.update(level, now) : null;
      busy = busy.then(async () => {
        if (ev === "open" || (gate.open && !pub)) await openAir();
        else if (ev === "close") await closeAir();
        if (pub && source) await source.captureFrame(new AudioFrame(frame, TARGET_RATE, 1, frame.length));
      }).catch((e) => log(`audio error: ${e.message}`));
    }
  });
  input.stream.on("end", () => { log("The audio input ended."); process.exit(0); });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await closeAir(); await room?.disconnect().catch(() => {}); process.exit(0); });
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
