import { useCallback, useEffect, useRef, useState } from "react";
import { restoreSession, loginWithPassword, clearSession, isAdmin, listZonesAndChannels, feedMine, feedRequest } from "./lib/auth";
import { FeedPublisher } from "./lib/publisher";

const PREFS = "feed-prefs";
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || "{}"); } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* storage unavailable */ } };

function Login({ onDone }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { onDone(await loginWithPassword(email, password)); } catch (x) { setErr(x?.message || "Could not sign in."); }
    setBusy(false);
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h1>Repeater Nation Feed</h1>
      <p>Sign in with your Repeater Nation account. Admins can connect a feed to any listen-only channel; other members ask for a stream channel and connect to it once control approves.</p>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {err && <p className="err">{err}</p>}
      <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

function Requests({ mine, reload }) {
  const [name, setName] = useState(""), [desc, setDesc] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try { await feedRequest(name, desc); setName(""); setDesc(""); await reload(); } catch (x) { setErr(x?.message || "Could not send the request."); }
    setBusy(false);
  };
  return (
    <section className="card">
      <h2>Ask for a stream channel</h2>
      <p className="muted">Control reviews every request. Once it's approved, the channel appears below and you can connect your feed to it.</p>
      <form onSubmit={submit} className="reqform">
        <input placeholder="Channel name (e.g. Sheriff Dispatch scanner)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <input placeholder="What is the audio? (optional)" value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} />
        {err && <p className="err">{err}</p>}
        <button disabled={busy || name.trim().length < 2}>Send request</button>
      </form>
      <ul className="reqlist">{(mine?.requests || []).map((r) => (
        <li key={r.id}><span>{r.name}</span><b className={"st-" + r.status}>{r.status === "pending" ? "Waiting for approval" : r.status === "approved" ? "Approved" : "Turned down"}</b>{r.reason && <small>{r.reason}</small>}</li>
      ))}</ul>
    </section>
  );
}

function Feed({ member, onSignOut }) {
  const [prefs, setPrefsState] = useState(() => ({ channelId: "", deviceId: "", mode: "squelch", threshold: 0.03, hangMs: 1500, autoStart: false, ...loadPrefs() }));
  const [channels, setChannels] = useState([]);
  const [mine, setMine] = useState(null);
  const admin = isAdmin(member);
  const [zones, setZones] = useState([]);
  const [devices, setDevices] = useState([]);
  const [status, setStatus] = useState("Not running.");
  const [level, setLevel] = useState(0);
  const [air, setAir] = useState(false);
  const [running, setRunning] = useState(false);
  const pub = useRef(null);
  const setPrefs = (p) => { const n = { ...prefs, ...p }; setPrefsState(n); savePrefs(n); pub.current?.configureGate(gateOf(n)); };
  const gateOf = (p) => ({ always: p.mode === "always", threshold: Number(p.threshold), hangMs: Number(p.hangMs) });

  const loadDevices = useCallback(async () => {
    try {
      // The browser only shows device names once the page has been allowed to use the microphone.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop());
    } catch (e) { setStatus(`The audio input is blocked: ${e?.message || e}`); }
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setDevices(all.filter((d) => d.kind === "audioinput"));
  }, []);

  const reloadMine = useCallback(() => feedMine().then(setMine).catch(() => {}), []);
  const reloadChannels = useCallback(() => listZonesAndChannels().then(({ zones: z, channels: c }) => { setZones(z); setChannels(c.filter((x) => x.enabled !== false)); }).catch((e) => setStatus(e?.message || "Could not load channels.")), []);
  useEffect(() => { reloadMine(); const t = setInterval(() => { reloadMine(); reloadChannels(); }, 30000); return () => clearInterval(t); }, [reloadMine, reloadChannels]);
  useEffect(() => {
    listZonesAndChannels().then(({ zones: z, channels: c }) => { setZones(z); setChannels(c.filter((x) => x.enabled !== false)); }).catch((e) => setStatus(e?.message || "Could not load channels."));
    loadDevices();
    return () => { pub.current?.stop(); };
  }, [loadDevices]);

  const channel = channels.find((c) => c.id === prefs.channelId);
  const zoneOf = (c) => zones.find((z) => z.id === c.zone_id);
  const listenOnly = (c) => c?.listen_only === true || zoneOf(c || {})?.listen_only === true;

  const start = useCallback(async () => {
    if (!channel || pub.current) return;
    const p = new FeedPublisher({ channel, deviceId: prefs.deviceId, gate: gateOf(prefs), onStatus: setStatus, onLevel: setLevel, onAir: setAir });
    p.onFatal = () => { pub.current = null; setRunning(false); };
    pub.current = p; setRunning(true);
    try { await p.start(); } catch (e) { setStatus(`Could not start: ${e?.message || e}`); await p.stop(); pub.current = null; setRunning(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, prefs]);
  const stop = async () => { const p = pub.current; pub.current = null; setRunning(false); await p?.stop(); };

  // Unattended: start by itself once the channels have loaded.
  const auto = useRef(false);
  useEffect(() => { if (!auto.current && prefs.autoStart && channel && devices.length) { auto.current = true; start(); } }, [prefs.autoStart, channel, devices.length, start]);

  const ownedIds = new Set((mine?.channels || []).map((c) => c.id));
  const usable = channels.filter((c) => (admin ? listenOnly(c) || c.id === prefs.channelId : ownedIds.has(c.id)));
  const grouped = zones.map((z) => ({ z, list: usable.filter((c) => c.zone_id === z.id) })).filter((g) => g.list.length);
  const pct = Math.min(100, Math.round(level * 400)); // the meter is scaled so ordinary signals reach the middle
  const thr = Math.min(100, Math.round(Number(prefs.threshold) * 400));

  return (
    <div className="shell">
      <header>
        <span className="logo" aria-hidden="true">RN</span>
        <strong>Repeater Nation Feed</strong>
        <span className="user">{member.full_name || member.email}</span>
        <button onClick={async () => { await stop(); await clearSession(); onSignOut(); }}>Sign out</button>
      </header>
      <main>
        {!admin && <Requests mine={mine} reload={() => { reloadMine(); }} />}
        <section className="card">
          <h2>Where it goes</h2>
          <label>Channel
            <select value={prefs.channelId} disabled={running} onChange={(e) => setPrefs({ channelId: e.target.value })}>
              <option value="">{usable.length ? "Choose a channel…" : admin ? "No listen-only channels yet" : "No approved stream channels yet"}</option>
              {grouped.map(({ z, list }) => (
                <optgroup key={z.id} label={z.name}>
                  {list.map((c) => <option key={c.id} value={c.id}>{c.number ? `${c.number} · ` : ""}{c.name}{listenOnly(c) ? " (listen only)" : ""}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {channel && !listenOnly(channel) && <p className="warn">This channel isn't listen only. Set it to listen only in the Control console (Channels tab) first, or the server will refuse the feed.</p>}
        </section>

        <section className="card">
          <h2>Where the audio comes from</h2>
          <label>Audio input
            <select value={prefs.deviceId} disabled={running} onChange={(e) => setPrefs({ deviceId: e.target.value })}>
              <option value="">System default</option>
              {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Input"}</option>)}
            </select>
          </label>
          <button disabled={running} onClick={loadDevices}>Refresh inputs</button>
          <small>Use the line-in, or the audio from SDR software (SDR#, SDR++, SDRangel) sent to a virtual audio cable. Pick that cable here.</small>
          <div className="meter" aria-label="Input level">
            <div className={"bar" + (air ? " on" : "")} style={{ width: pct + "%" }} />
            {prefs.mode === "squelch" && <div className="thr" style={{ left: thr + "%" }} title="Squelch level" />}
          </div>
          <label>Send audio
            <select value={prefs.mode} onChange={(e) => setPrefs({ mode: e.target.value })}>
              <option value="squelch">Only when there is a signal (squelch)</option>
              <option value="always">All the time</option>
            </select>
          </label>
          {prefs.mode === "squelch" && (
            <>
              <label>Squelch level
                <input type="range" min="0.002" max="0.25" step="0.002" value={prefs.threshold} onChange={(e) => setPrefs({ threshold: Number(e.target.value) })} />
              </label>
              <label>Stay open after the signal stops
                <select value={prefs.hangMs} onChange={(e) => setPrefs({ hangMs: Number(e.target.value) })}>
                  {[500, 1000, 1500, 2500, 4000].map((ms) => <option key={ms} value={ms}>{ms / 1000} seconds</option>)}
                </select>
              </label>
            </>
          )}
        </section>

        <section className="card">
          <button className={"go" + (running ? " on" : "")} disabled={!channel && !running} onClick={running ? stop : start}>{running ? "Stop" : "Start the feed"}</button>
          <p className={"status" + (air ? " air" : "")}>{status}</p>
          <label className="check"><input type="checkbox" checked={!!prefs.autoStart} onChange={(e) => setPrefs({ autoStart: e.target.checked })} /> Start by itself when this app opens</label>
          <small>Version {__APP_VERSION__}</small>
        </section>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => { restoreSession().then((s) => setSession(s)).catch(() => setSession(null)); }, []);
  if (session === undefined) return <p className="center">Loading…</p>;
  if (!session) return <Login onDone={setSession} />;
  return <Feed member={session.member} onSignOut={() => setSession(null)} />;
}
