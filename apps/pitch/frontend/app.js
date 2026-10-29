const $ = (id) => document.getElementById(id);
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiName = (m) => { m = Math.round(m); return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); };
const COLORS = { vocals: "#eb5a8a", guitar: "#e0a53a", piano: "#8a5ae0", other: "#5ac08a", bass: "#5a8ae0", drums: "#c76b6b" };
const HEADER_W = 172;

let ctx = null;
const audio = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
const decode = async (url) => audio().decodeAudioData(await (await fetch(url)).arrayBuffer());

// ---------- shared multitrack player ----------
class Player {
  constructor() {
    this.ctx = audio();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.tracks = []; this.duration = 0; this.loop = true;
    this.playing = false; this.startCtx = 0; this.startOff = 0; this.paused = 0;
  }
  add(buffer) { const g = this.ctx.createGain(); g.connect(this.master);
    const t = { buffer, gain: g, src: null, vol: 0.9, mute: false, solo: false }; this.tracks.push(t); return t; }
  pos() { return this.playing ? (this.startOff + this.ctx.currentTime - this.startCtx) % this.duration : this.paused; }
  _stop() { for (const t of this.tracks) { if (t.src) { try { t.src.stop(); } catch (e) {} t.src = null; } } }
  play() { this.ctx.resume(); this._stop(); const off = this.paused % this.duration;
    this.startCtx = this.ctx.currentTime; this.startOff = off;
    for (const t of this.tracks) { if (!t.buffer) continue; const s = this.ctx.createBufferSource();
      s.buffer = t.buffer; s.loop = this.loop; s.connect(t.gain); s.start(0, off); t.src = s; } this.playing = true; }
  pause() { this.paused = this.pos(); this._stop(); this.playing = false; }
  stop() { this._stop(); this.playing = false; this.paused = 0; }
  seek(x) { this.paused = Math.max(0, Math.min(this.duration, x)); if (this.playing) this.play(); }
  dispose() { this._stop(); try { this.master.disconnect(); } catch (e) {} }
}

// ---------- per-mode state (each mode is fully independent) ----------
let mode = "mix";
let loadedUrl = null;
const built = { mix: false, studio: false };
const busy = { mix: false, studio: false };
let mixPlayer = null, studioPlayer = null;
let mixData = null, studioData = null;
let rafOn = false;

// ---------- tabs ----------
$("tab-mix").onclick = () => switchTo("mix");
$("tab-studio").onclick = () => switchTo("studio");

function switchTo(m) {
  if (m === mode) return;
  // pause whatever's playing in the mode we're leaving (audio never bleeds across tabs)
  const leaving = mode === "mix" ? mixPlayer : studioPlayer;
  if (leaving && leaving.playing) { leaving.pause(); setPlayBtn(mode, false); }
  mode = m;
  updateTabs(); render();
  // same song already loaded but this mode isn't built yet -> build it now
  if (loadedUrl && !built[m] && !busy[m]) buildFor(m, loadedUrl);
}

function updateTabs() {
  $("tab-mix").classList.toggle("on", mode === "mix");
  $("tab-studio").classList.toggle("on", mode === "studio");
}

function render() {
  $("mix").classList.toggle("hidden", !(mode === "mix" && built.mix));
  $("studio").classList.toggle("hidden", !(mode === "studio" && built.studio));
  $("status").classList.toggle("hidden", !busy[mode]);
  $("open").disabled = busy[mode];
}

const setPlayBtn = (m, playing) => { $(m === "mix" ? "m-play" : "s-play").textContent = playing ? "⏸" : "▶"; };

// ---------- open / build ----------
$("open").addEventListener("click", () => {
  const url = $("url").value.trim(); if (!url) return;
  loadedUrl = url;
  built.mix = built.studio = false;          // new song: invalidate both modes
  buildFor(mode, url);
});
$("url").addEventListener("keydown", (e) => { if (e.key === "Enter") $("open").click(); });

async function buildFor(m, url) {
  busy[m] = true; render();
  if (mode === m) $("phase").textContent = "starting…";
  const ep = m === "mix" ? "daw" : "studio";
  try {
    const { jobId } = await (await fetch(`/api/${ep}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, window: 45 }),
    })).json();
    const es = new EventSource(`/api/jobs/${jobId}/progress`);
    es.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (mode === m) $("phase").textContent = msg.phase;   // only surface the phase you're looking at
      if (msg.status === "done") {
        es.close();
        const data = await (await fetch(`/api/jobs/${jobId}/${ep}`)).json();
        if (m === "mix") await buildMix(data); else await buildStudio(data);
        busy[m] = false; built[m] = true;
        if (!rafOn) { rafOn = true; requestAnimationFrame(tick); }
        render();
        if (m === "mix") mixLayout(); else fitPitch();
      } else if (msg.status === "error") {
        es.close(); busy[m] = false; if (mode === m) $("phase").textContent = "⚠ " + msg.phase; render();
      }
    };
  } catch (e) { busy[m] = false; render(); }
}

// =================== MIX (DAW) ===================
let mLoop = true;
async function buildMix(data) {
  if (mixPlayer) mixPlayer.dispose();
  mixPlayer = new Player(); mixPlayer.duration = data.duration; mixPlayer.loop = mLoop;
  mixData = data;
  const cont = $("tracks"); [...cont.querySelectorAll(".track")].forEach((n) => n.remove());
  for (const t of data.tracks) {
    const row = document.createElement("div"); row.className = "track";
    const head = document.createElement("div"); head.className = "thead";
    const name = document.createElement("div"); name.className = "tname"; name.textContent = t.name;
    const rowc = document.createElement("div"); rowc.className = "trow";
    const mb = document.createElement("button"); mb.className = "ms"; mb.textContent = "M";
    const sb = document.createElement("button"); sb.className = "ms"; sb.textContent = "S";
    const vol = document.createElement("input"); vol.type = "range"; vol.className = "vol";
    vol.min = 0; vol.max = 1; vol.step = 0.01; vol.value = 0.9;
    rowc.append(mb, sb, vol); head.append(name, rowc);
    const lane = document.createElement("canvas"); lane.className = "lane";
    row.append(head, lane); cont.append(row);
    const tr = mixPlayer.add(null); tr.name = t.name; tr.peaks = t.peaks; tr.lane = lane;
    mb.onclick = () => { tr.mute = !tr.mute; mb.classList.toggle("on-m", tr.mute); mixGains(); };
    sb.onclick = () => { tr.solo = !tr.solo; sb.classList.toggle("on-s", tr.solo); mixGains(); };
    vol.oninput = () => { tr.vol = +vol.value; mixGains(); };
    lane.onclick = (e) => { const r = lane.getBoundingClientRect(); mixPlayer.seek((e.clientX - r.left) / r.width * mixPlayer.duration); };
    decode(t.audio).then((b) => { tr.buffer = b; });
  }
  mixGains();
}
function mixGains() { const solo = mixPlayer.tracks.some((t) => t.solo);
  for (const t of mixPlayer.tracks) t.gain.gain.value = solo ? (t.solo ? t.vol : 0) : (t.mute ? 0 : t.vol); }

$("m-play").onclick = () => { if (mixPlayer.playing) { mixPlayer.pause(); setPlayBtn("mix", false); } else { mixPlayer.play(); setPlayBtn("mix", true); } };
$("m-stop").onclick = () => { mixPlayer.stop(); setPlayBtn("mix", false); };
$("m-loop").onclick = () => { mLoop = !mLoop; mixPlayer.loop = mLoop; $("m-loop").classList.toggle("on", mLoop); if (mixPlayer.playing) mixPlayer.play(); };

function mixLayout() { if (!mixData) return; drawRuler(); for (const t of mixPlayer.tracks) drawLane(t); $("m-playhead").style.height = $("tracks").clientHeight + "px"; }
function drawRuler() { const c = $("ruler"), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h); g.fillStyle = "#7d828d"; g.font = "11px ui-monospace, monospace"; g.strokeStyle = "#2a2e37";
  for (let s = 0; s <= mixData.duration; s += 5) { const x = s / mixData.duration * w;
    g.beginPath(); g.moveTo(x, h - 6); g.lineTo(x, h); g.stroke(); g.fillText(s + "s", x + 3, 12); } }
function drawLane(t) { const c = t.lane, dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr; const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h); const col = COLORS[t.name] || "#888", p = t.peaks, n = p.length, mid = h / 2;
  g.fillStyle = col + "88"; g.beginPath(); g.moveTo(0, mid);
  for (let i = 0; i < n; i++) g.lineTo(i / n * w, mid - p[i] * h * 0.46);
  for (let i = n - 1; i >= 0; i--) g.lineTo(i / n * w, mid + p[i] * h * 0.46);
  g.closePath(); g.fill(); }
function mixTick() { const laneW = mixPlayer.tracks[0]?.lane.clientWidth || 1, p = mixPlayer.pos();
  $("m-playhead").style.left = (HEADER_W + p / mixPlayer.duration * laneW) + "px";
  $("m-time").textContent = p.toFixed(1) + " / " + mixPlayer.duration.toFixed(0) + "s"; }

// =================== STUDIO (karaoke) ===================
let sLoop = true, guide = false, viewSec = 8;
async function buildStudio(d) {
  if (studioPlayer) studioPlayer.dispose();
  studioPlayer = new Player(); studioPlayer.duration = d.duration; studioPlayer.loop = sLoop;
  studioData = d;
  const [kb, vb] = await Promise.all([decode(d.karaoke), decode(d.vguide)]);
  studioData.kar = studioPlayer.add(kb); studioData.vg = studioPlayer.add(vb);
  studioGains();
}
function studioGains() { if (!studioData) return; studioData.kar.gain.gain.value = 0.9; studioData.vg.gain.gain.value = guide ? 0.9 : 0; }

$("s-play").onclick = () => { if (studioPlayer.playing) { studioPlayer.pause(); setPlayBtn("studio", false); } else { studioPlayer.play(); setPlayBtn("studio", true); } };
$("s-stop").onclick = () => { studioPlayer.stop(); setPlayBtn("studio", false); };
$("s-loop").onclick = () => { sLoop = !sLoop; studioPlayer.loop = sLoop; $("s-loop").classList.toggle("on", sLoop); if (studioPlayer.playing) studioPlayer.play(); };
$("s-guide").onclick = () => { guide = !guide; $("s-guide").classList.toggle("on", guide); studioGains(); };
$("pcanvas").onclick = (e) => { const r = $("pcanvas").getBoundingClientRect(); const ML = 64, pw = r.width - 80;
  studioPlayer.seek(((e.clientX - r.left - ML) / pw + 0.38) * viewSec + studioPlayer.pos() - viewSec * 0.38); };

window.addEventListener("keydown", (e) => { if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); (mode === "mix" ? $("m-play") : $("s-play")).click(); }
  else if (mode === "studio" && e.key === "ArrowUp") viewSec = Math.max(3, viewSec - 1);
  else if (mode === "studio" && e.key === "ArrowDown") viewSec = Math.min(30, viewSec + 1); });

function fitPitch() { const c = $("pcanvas"), dpr = devicePixelRatio || 1;
  c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0); }
function studioTick() {
  const c = $("pcanvas"), g = c.getContext("2d"), W = c.clientWidth, H = c.clientHeight;
  const d = studioData, head = studioPlayer.pos();
  const ML = 64, MR = 16, MT = 20, MB = 30, pw = W - ML - MR, ph = H - MT - MB;
  const ws = head - viewSec * 0.38, we = ws + viewSec, lo = d.lo, hi = d.hi;
  const X = (t) => ML + (t - ws) / viewSec * pw, Y = (m) => MT + ph - (m - lo) / (hi - lo) * ph;
  g.clearRect(0, 0, W, H); g.font = "12px ui-monospace, monospace"; g.textBaseline = "middle";
  for (let cc = Math.ceil(lo / 12) * 12; cc <= hi; cc += 12) { const y = Y(cc);
    g.strokeStyle = "#2a2e37"; g.beginPath(); g.moveTo(ML, y); g.lineTo(W - MR, y); g.stroke();
    g.fillStyle = "#7d828d"; g.fillText(midiName(cc), 8, y); }
  for (let s = Math.ceil(ws); s <= Math.floor(we); s++) { const x = X(s);
    g.strokeStyle = "#22262e"; g.beginPath(); g.moveTo(x, MT); g.lineTo(x, MT + ph); g.stroke();
    g.fillStyle = "#5b606b"; g.fillText(s + "s", x - 8, H - 12); }
  // bridge brief dropouts (< MAXGAP) so a phrase draws as ONE connected line;
  // only genuine rests/breaths (larger gaps between voiced points) break it.
  const MAXGAP = 0.32;
  const curve = (color, tmax) => {
    g.strokeStyle = color; g.lineWidth = 2.5; g.lineJoin = "round"; g.beginPath();
    let lastT = null;
    for (const [t, m] of d.points) {
      if (m == null || t < ws - 0.5 || t > we + 0.5) continue;
      if (tmax != null && t > tmax) continue;
      const x = X(t), y = Y(m);
      if (lastT == null || (t - lastT) > MAXGAP) g.moveTo(x, y);   // new phrase
      else g.lineTo(x, y);                                         // continue across the small gap
      lastT = t;
    }
    g.stroke();
  };
  curve("#463c4a", null); curve("#eb5a8a", head);
  const hx = ML + 0.38 * pw; g.strokeStyle = "#78c8ff"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(hx, MT); g.lineTo(hx, MT + ph); g.stroke();
  let cur = null, best = 0.15; for (const [t, m] of d.points) if (m != null && Math.abs(t - head) < best) { best = Math.abs(t - head); cur = m; }
  if (cur != null) { g.fillStyle = "#8ef0c0"; g.beginPath(); g.arc(hx, Y(cur), 6, 0, 7); g.fill(); $("s-note").textContent = midiName(cur); }
  else $("s-note").textContent = "–";
  $("s-time").textContent = head.toFixed(1) + " / " + studioPlayer.duration.toFixed(0) + "s";
}

// ---------- shared raf + resize ----------
function tick() {
  if (mode === "mix" && built.mix) mixTick();
  else if (mode === "studio" && built.studio) studioTick();
  requestAnimationFrame(tick);
}
window.addEventListener("resize", () => {
  if (mode === "mix" && built.mix) mixLayout();
  else if (mode === "studio" && built.studio) fitPitch();
});
