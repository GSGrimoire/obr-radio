// =============================================================
// ui.test.mjs — the bar and the console, running for real in Chromium.
// -------------------------------------------------------------
// The SDK is swapped for a stub in a staged copy (every page imports "./sdk.js",
// so replacing that one file is enough). Suno's CDN, YouTube's iframe API and
// SoundCloud's widget API are answered by request interception: generated WAV
// files, served with byte ranges as a real CDN does, and fake players that record
// what they were told. Nothing leaves the machine — which also means NOTHING HERE
// PROVES that Suno, YouTube, SoundCloud or Owlbear behave the way the stubs do.
// See the live checks in the README.
//
// Served over http, never file://: Chromium will not load an ES module from disk
// and says so only in the console, so a file:// suite passes against a page whose
// code never ran. (Learned the hard way in dnm-cc; see serve.mjs.)
// =============================================================
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { serve } from "./serve.mjs";
import { STATE_KEY, LIBRARY_KEY, DNM_ROOM_KEY, CHANNEL, SCENE_KEY, PREFS_KEY, RESUME_KEY, RETUNE_KEY } from "../radio.js";
import { parseTrackList } from "../sources.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log("  FAIL:", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A page that died mid-scenario throws out of Playwright; count it and report
// rather than crashing with half a summary.
process.on("unhandledRejection", (err) => {
  console.log("  FAIL: the suite stopped:", String(err && err.message).split("\n")[0]);
  console.log(`ui: ${pass} passed, ${fail + 1} failed`);
  process.exit(1);
});

function findChromium() {
  const root = "/opt/pw-browsers";
  if (!fs.existsSync(root)) return null;
  for (const d of fs.readdirSync(root)) {
    if (!d.startsWith("chromium-")) continue;
    const p = path.join(root, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let browser;
try {
  browser = await chromium.launch(findChromium() ? { executablePath: findChromium() } : {});
} catch (err) {
  console.log("ui: SKIPPED — no browser available:", String(err.message).split("\n")[0]);
  process.exit(0);
}

// -------------------------------------------------------------
// Stage a copy with the SDK stubbed
// -------------------------------------------------------------
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(repo, "out", "stub");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const f of fs.readdirSync(repo)) {
  if (/\.(html|js|css|svg)$/.test(f) && f !== "sdk.js") fs.copyFileSync(path.join(repo, f), path.join(stage, f));
}
fs.writeFileSync(path.join(stage, "sdk.js"), `
// Stub SDK: only what the radio touches. window.__want configures it per page.
const want = window.__want || {};
const subs = { player: [], party: [], meta: [], msg: {}, sceneReady: [], sceneMeta: [] };
const clone = (x) => JSON.parse(JSON.stringify(x));
const st = {
  role: want.role || "GM",
  conn: want.conn || "conn-self",
  players: want.players || [],
  meta: want.meta || {},
  sceneReady: want.sceneReady !== false,
  sceneMeta: want.sceneMeta || {},
  sent: [],
  popover: [],
  action: [],
};
const on = (list) => (cb) => { list.push(cb); return () => {}; };
// "LOCAL" means every frame of this one Owlbear client: here, every page of the
// browser context. Carried on the test's own channel, captured before a page can
// take BroadcastChannel away from the app (see noBC).
const RealBC = window.__RealBC || window.BroadcastChannel;
const local = RealBC ? new RealBC("__stub_local") : null;
if (local) local.onmessage = (ev) => { (subs.msg[ev.data.ch] || []).forEach((cb) => cb({ data: ev.data.data, connectionId: ev.data.conn })); };
function pushMeta() { const snap = clone(st.meta); subs.meta.forEach((cb) => cb(snap)); }
const OBR = {
  isAvailable: true,
  onReady(cb) { queueMicrotask(cb); },
  player: {
    getRole: async () => st.role,
    getConnectionId: async () => st.conn,
    getId: async () => "player-self",
    onChange: on(subs.player),
  },
  party: { getPlayers: async () => st.players, onChange: on(subs.party) },
  room: {
    id: "room-test",
    getMetadata: async () => clone(st.meta),
    setMetadata: async (m) => { Object.assign(st.meta, clone(m)); pushMeta(); },
    onMetadataChange: on(subs.meta),
  },
  scene: {
    isReady: async () => st.sceneReady,
    onReadyChange: on(subs.sceneReady),
    getMetadata: async () => clone(st.sceneMeta),
    setMetadata: async (m) => {
      for (const [k, v] of Object.entries(m)) { if (v === undefined) delete st.sceneMeta[k]; else st.sceneMeta[k] = clone(v); }
      subs.sceneMeta.forEach((cb) => cb(clone(st.sceneMeta)));
    },
    onMetadataChange: on(subs.sceneMeta),
  },
  broadcast: {
    onMessage: (ch, cb) => { (subs.msg[ch] = subs.msg[ch] || []).push(cb); return () => {}; },
    sendMessage: async (ch, data, opts) => {
      st.sent.push({ ch, data: clone(data), dest: opts && opts.destination });
      if (opts && (opts.destination === "ALL" || opts.destination === "LOCAL")) {
        (subs.msg[ch] || []).forEach((cb) => cb({ data: clone(data), connectionId: st.conn }));
      }
      if (opts && opts.destination === "LOCAL" && local) local.postMessage({ ch, data: clone(data), conn: st.conn });
    },
  },
  popover: {
    open: async (o) => { st.popover.push(["open", o]); },
    close: async (id) => { st.popover.push(["close", id]); },
    setHeight: async (id, h) => { st.popover.push(["height", h]); },
    setWidth: async (id, w) => { st.popover.push(["width", w]); },
  },
  action: {
    setWidth: async (w) => { st.action.push(["width", w]); },
    setHeight: async (h) => { st.action.push(["height", h]); },
  },
  viewport: { getWidth: async () => 1600, getHeight: async () => 900 },
};
window.__stub = {
  st,
  patchMeta(m) { Object.assign(st.meta, clone(m)); pushMeta(); },
  deliver(ch, data, connectionId) { (subs.msg[ch] || []).forEach((cb) => cb({ data, connectionId })); },
  sceneReadyChange(ready) { st.sceneReady = ready; subs.sceneReady.forEach((cb) => cb(ready)); },
};
export default OBR;
`);

// -------------------------------------------------------------
// Fake media, a fake YouTube, a fake SoundCloud
// -------------------------------------------------------------
function wav(seconds, freq = 440) {
  const rate = 8000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 3000), 44 + i * 2);
  return buf;
}
const LONG = wav(90);
const SHORT = wav(1.5);
const CLIP = wav(3, 880);
const MID = wav(12, 330);
const U_LONG = "0f6d3c1e-2b8a-4e5f-9a7b-1c2d3e4f5a6b";
const U_SHORT = "11111111-2222-4333-8444-555555555555";
const U_OLD = "99999999-9999-4999-8999-999999999999";   // an old song: .mp3 only, no .mp4
const SUNO = (u) => `https://cdn1.suno.ai/${u}.mp3`;
const FILE = (name) => `https://files.test/${name}.mp3`;

const YT_STUB = `
window.__yts = [];
window.YT = {
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  Player: class {
    constructor(el, opts) {
      this.opts = opts; this.calls = []; this.state = -1; this.t = 0; this.idx = 0; this.list = null; this.vid = "";
      window.__yt = this; window.__yts.push(this);
      setTimeout(() => opts.events.onReady({ target: this }), 10);
    }
    fire(s) { this.state = s; setTimeout(() => this.opts.events.onStateChange({ data: s, target: this }), 5); }
    loadVideoById(o) { this.calls.push(["loadVideoById", o]); this.vid = o.videoId; this.list = null; this.t = o.startSeconds || 0; this.fire(1); }
    loadPlaylist(o) { this.calls.push(["loadPlaylist", o]); this.list = o; this.idx = o.index || 0; this.t = o.startSeconds || 0; this.fire(1); }
    playVideoAt(i) { this.calls.push(["playVideoAt", i]); this.idx = i; this.t = 0; this.fire(1); }
    nextVideo() { this.calls.push(["nextVideo"]); this.idx += 1; this.t = 0; this.fire(1); }
    // What the player does when a person clicks it.
    hand(s) { this.state = s; this.opts.events.onStateChange({ data: s, target: this }); }
    playVideo() { this.calls.push(["playVideo"]); this.fire(1); }
    pauseVideo() { this.calls.push(["pauseVideo"]); this.fire(2); }
    stopVideo() { this.calls.push(["stopVideo"]); this.state = 5; }
    seekTo(t) { this.calls.push(["seekTo", t]); this.t = t; }
    getCurrentTime() { return this.t; }
    getDuration() { return 300; }
    getPlayerState() { return this.state; }
    setVolume(v) { this.vol = v; }
    getPlaylistIndex() { return this.list ? this.idx : -1; }
    getPlaylist() { return this.list ? ["a", "b", "c"] : null; }
    getVideoData() { return { title: "Stub video " + (this.list ? this.idx : this.vid) }; }
    destroy() { this.calls.push(["destroy"]); this.destroyed = true; }
  },
};
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
`;

const SC_STUB = `
window.__scs = [];
window.SC = { Widget: Object.assign(function (frame) {
  const handlers = {};
  const w = {
    frame, calls: [], vol: null,
    bind(ev, cb) { (handlers[ev] = handlers[ev] || []).push(cb); if (ev === "ready") setTimeout(() => cb(), 10); },
    fire(ev, data) { (handlers[ev] || []).forEach((cb) => cb(data)); },
    play() { this.calls.push(["play"]); this.fire("play"); },
    pause() { this.calls.push(["pause"]); this.fire("pause"); },
    seekTo(ms) { this.calls.push(["seekTo", ms]); },
    setVolume(v) { this.vol = v; },
    getDuration(cb) { cb(120000); },
    // A set, when the frame's url names one: three tracks.
    idx: 0,
    isSet() { return /%2Fsets%2F/.test(frame.src); },
    getSounds(cb) { cb(this.isSet() ? [{ title: "One" }, { title: "Two" }, { title: "Three" }] : [{ title: "Only" }]); },
    getCurrentSoundIndex(cb) { cb(this.idx); },
    getCurrentSound(cb) { cb({ title: this.isSet() ? ["One", "Two", "Three"][this.idx] : "Only" }); },
    skip(i) { this.calls.push(["skip", i]); this.idx = i; this.fire("play"); },
    // What the widget does when a person presses its button.
    hand(ev) { this.fire(ev); },
  };
  window.__sc = w; window.__scs.push(w);
  return w;
}, { Events: { READY: "ready", PLAY: "play", PAUSE: "pause", FINISH: "finish", PLAY_PROGRESS: "playProgress", ERROR: "error" } }) };
`;

const site = await serve(stage);

async function routes(page) {
  const media = (route) => {
    const url = route.request().url();
    // A faked 403 on a media request never completes in Playwright; a real CDN's 403
    // ends the request and fires the element's error. A failed request does the same.
    if (url.includes(U_OLD) && url.endsWith(".mp4")) { route.abort("failed"); return; }
    const body = url.includes("mid-") ? MID
      : url.includes(U_SHORT) || url.includes("short") ? SHORT
      : url.includes(U_LONG) || url.includes(U_OLD) || url.includes("long") ? LONG : CLIP;
    // Byte ranges, as a real CDN serves them. Without them Chromium cannot seek past
    // what it has buffered, and a far seek quietly lands back at the start.
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "");
    if (!range) {
      route.fulfill({ status: 200, contentType: "audio/wav", body, headers: { "Accept-Ranges": "bytes" } });
      return;
    }
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    route.fulfill({ status: 206, contentType: "audio/wav", body: body.subarray(start, end + 1),
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` } });
  };
  // The starter packs' real files, served from this checkout as GitHub Pages would.
  await page.route("https://gsgrimoire.github.io/obr-radio/sounds/**", (route) => {
    const rel = new URL(route.request().url()).pathname.replace("/obr-radio/", "");
    const file = path.join(repo, rel);
    if (!file.startsWith(path.join(repo, "sounds")) || !fs.existsSync(file)) { route.fulfill({ status: 404 }); return; }
    route.fulfill({ status: 200, contentType: "audio/ogg", body: fs.readFileSync(file), headers: { "Accept-Ranges": "bytes" } });
  });
  await page.route("https://cdn1.suno.ai/**", media);
  await page.route("https://files.test/**", media);
  await page.route("https://www.youtube.com/iframe_api", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: YT_STUB }));
  await page.route("https://w.soundcloud.com/player/api.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: SC_STUB }));
  await page.route("https://w.soundcloud.com/player/?**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><title>sc</title>" }));
}

const GM_ONLY = [{ role: "GM", connectionId: "conn-gm" }, { role: "PLAYER", connectionId: "conn-x" }];

async function open(page, { file = "bar.html", role = "PLAYER", conn = "conn-self", players, meta = {}, library = null,
  prefs = null, sceneMeta, sceneReady, noBC = false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Short, so a page whose script died fails in seconds instead of hanging on
  // Playwright's thirty-second wait for a button that will never work.
  page.setDefaultTimeout(5000);
  await routes(page);
  await page.addInitScript(({ want, lib, libKey, prefs, prefsKey }) => {
    window.__want = want;
    // A frame where BroadcastChannel does not work: only Owlbear's route is left.
    if (want.noBC) { window.__RealBC = window.BroadcastChannel; window.BroadcastChannel = undefined; }
    try {
      if (lib && !localStorage.getItem("__seeded")) { localStorage.setItem(libKey, JSON.stringify(lib)); localStorage.setItem("__seeded", "1"); }
      if (prefs) localStorage.setItem(prefsKey, JSON.stringify(prefs));
    } catch (err) { /* ignore */ }
  }, {
    want: { role, conn, meta, players: players || GM_ONLY, sceneMeta, sceneReady, noBC },
    lib: library, libKey: LIBRARY_KEY, prefs, prefsKey: PREFS_KEY,
  });
  await page.goto(site.origin + "/" + file);
  await page.waitForFunction(() => !!window.__stub);
  await sleep(200);
  return errors;
}

const media = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((a) => ({
  src: a.getAttribute("src") || "", paused: a.paused, t: a.currentTime, vol: a.volume, layer: a.dataset.layer || "",
})), sel);
const musicEl = async (page) => (await media(page, 'audio[data-role="music"]'))[0] || { src: "", paused: true, t: 0, vol: 0 };
const roomState = (page) => page.evaluate((k) => window.__stub.st.meta[k], STATE_KEY);
const sent = (page) => page.evaluate(() => window.__stub.st.sent);
const deliver = (page, data, conn = "conn-gm") => page.evaluate(({ ch, d, c }) => window.__stub.deliver(ch, d, c), { ch: CHANNEL, d: data, c: conn });
const patchMeta = (page, m) => page.evaluate((x) => window.__stub.patchMeta(x), m);
const room = (music, amb = []) => ({ [STATE_KEY]: { v: 2, music, amb, scene: "" } });
const tune = async (page) => { await page.click("#tune"); };

// -------------------------------------------------------------
// 1. A player joining music already five seconds in
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const errors = await open(page, { meta: room({ seq: 1, track: { k: "a", u: SUNO(U_LONG), t: "Liquid Banjo" }, at: Date.now() - 5000, paused: null, label: "Explore", vol: 1 }) });
  ok("player: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  ok("player: the title shows before tuning in", (await page.textContent("#title")) === "Liquid Banjo");
  ok("player: no sound before the press", (await media(page, "audio")).length === 0);
  ok("player: no GM controls, no console window button", !(await page.isVisible("#next")) && !(await page.isVisible("#popout")));
  ok("player: it asked for the time", (await sent(page)).some((m) => m.data.type === "hello"));

  await tune(page);
  await page.waitForFunction(() => { const a = document.querySelector('audio[data-role="music"]'); return a && !a.paused && a.currentTime > 4 && !a.seeking; }, null, { timeout: 5000 }).catch(() => {});
  let a = await musicEl(page);
  ok("player: tuning in plays the Suno file", a.src === SUNO(U_LONG) && !a.paused);
  ok(`player: from where the room is (${a.t.toFixed(1)}s)`, a.t > 4 && a.t < 8);
  await sleep(1700);
  a = await musicEl(page);
  ok(`player: faded in to their music level (${a.vol.toFixed(2)})`, Math.abs(a.vol - 0.6) < 0.02);

  await deliver(page, { type: "tick", now: Date.now() + 60000 });
  await sleep(700);
  a = await musicEl(page);
  ok(`player: a GM tick corrects for the clock (${a.t.toFixed(1)}s)`, a.t > 63 && a.t < 70);
  await deliver(page, { type: "tick", now: Date.now() - 600000 }, "conn-x");
  await sleep(600);
  ok("player: a tick from a player is ignored", (await musicEl(page)).t > 63);

  // A correction landing mid-seek waits for the seek, not for the next check.
  await page.evaluate(({ ch }) => {
    const x = document.querySelector('audio[data-role="music"]');
    Object.defineProperty(x, "seeking", { get: () => true, configurable: true });
    window.__stub.deliver(ch, { type: "tick", now: Date.now() + 20000 }, "conn-gm");
  }, { ch: CHANNEL });
  await sleep(200);
  ok("player: mid-seek, the correction waits", (await musicEl(page)).t > 60);
  await page.evaluate(() => { const x = document.querySelector('audio[data-role="music"]'); delete x.seeking; x.dispatchEvent(new Event("seeked")); });
  await sleep(600);
  a = await musicEl(page);
  ok(`player: the moment the seek lands, it corrects (${a.t.toFixed(1)}s)`, a.t > 23 && a.t < 30);

  await patchMeta(page, room({ seq: 9, track: { k: "a", u: "javascript:alert(1)" }, at: 0 }));
  await sleep(2000);
  ok("player: a hostile track is never loaded", (await media(page, 'audio[data-role="music"]')).length === 0);
  ok("player: and reads as nothing playing", (await page.textContent("#title")) === "Nothing playing");
  ok("player: nothing threw along the way", errors.length === 0);
  await page.close();
}

{
  // Suno closed its .mp3 addresses; a song that only has one of its two files
  // must still play, as music and as a soundboard press.
  const page = await browser.newPage();
  const errors = await open(page, { meta: room({ seq: 1, track: { k: "a", u: `https://cdn1.suno.ai/${U_OLD}.mp4`, t: "Old song" }, at: Date.now() - 3000, paused: null, vol: 1 }) });
  await tune(page);
  // Wait for data to have ARRIVED (readyState 3). "Not paused, past 2 s" is true the
  // instant the player is made — it starts at the room's position with play asked
  // for — so it returned before the first request had even gone out.
  // …and for the room's position to have been reached, which after a fallback comes
  // from the same drift correction as any track (the first seek is not always kept).
  await page.waitForFunction(() => {
    const a = document.querySelector('audio[data-role="music"]');
    return a && a.src.endsWith(".mp3") && a.readyState >= 3 && !a.paused && !a.seeking && a.currentTime > 2;
  }, null, { timeout: 8000 }).catch(() => {});
  const a = await musicEl(page);
  ok(`suno: a song whose .mp4 is missing plays from its .mp3 (${a.src.slice(-4)}, ${a.t.toFixed(1)}s)`, a.src.endsWith(".mp3") && !a.paused && a.t > 2);
  await deliver(page, { type: "sound", track: { k: "a", u: `https://cdn1.suno.ai/${U_OLD}.mp4`, t: "x" }, vol: 1 });
  await page.waitForFunction(() => { const x = document.querySelector('audio[data-role="shot"]'); return x && x.readyState >= 3 && !x.paused; }, null, { timeout: 4000 }).catch(() => {});
  const shot = (await media(page, 'audio[data-role="shot"]'))[0];
  ok("suno: so does a soundboard press", !!shot && shot.src.endsWith(".mp3") && !shot.paused);
  ok("suno: nothing throws", errors.length === 0);
  await page.close();
}

// -------------------------------------------------------------
// 2. Ambience layers under the music
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const now = Date.now();
  const errors = await open(page, { meta: room(
    { seq: 1, track: { k: "a", u: FILE("long-music"), t: "Music" }, at: now, paused: null, vol: 1 },
    [
      { id: "Lrain", track: { k: "a", u: FILE("long-rain"), t: "Rain" }, at: now - 100000, vol: 0.5, mode: "loop", min: 20, max: 60, label: "Rain" },
      { id: "Lfire", track: { k: "a", u: FILE("clip-fire"), t: "Fire" }, at: now, vol: 1, mode: "loop", min: 20, max: 60, label: "Fire" },
      { id: "Lgull", track: { k: "a", u: FILE("clip-gull"), t: "Gull" }, at: now, vol: 1, mode: "scatter", min: 10, max: 20, label: "Gull" },
    ]) });
  await tune(page);
  await sleep(2200);
  const all = await media(page, "audio");
  const rain = all.find((x) => x.layer === "Lrain");
  const fire = all.find((x) => x.layer === "Lfire");
  ok("layers: music and two loops play together", all.filter((x) => !x.paused).length === 3);
  ok("layers: a scattered layer has no player of its own", !all.some((x) => x.layer === "Lgull"));
  ok(`layers: a loop joined late lands inside the loop (${rain && rain.t.toFixed(1)}s of 90)`, !!rain && rain.t > 8 && rain.t < 14);
  ok(`layers: each at its level × the player's ambience level (${rain && rain.vol.toFixed(2)})`, !!rain && Math.abs(rain.vol - 0.3) < 0.02 && Math.abs(fire.vol - 0.6) < 0.02);

  await patchMeta(page, room({ seq: 1, track: { k: "a", u: FILE("long-music"), t: "Music" }, at: now, paused: null, vol: 1 },
    [{ id: "Lfire", track: { k: "a", u: FILE("clip-fire"), t: "Fire" }, at: now, vol: 1, mode: "loop", min: 20, max: 60, label: "Fire" }]));
  await sleep(300);
  const fading = (await media(page, "audio")).find((x) => x.layer === "Lrain");
  ok("layers: a stopped layer fades rather than cuts", !!fading && fading.vol > 0 && fading.vol < 0.3);
  await sleep(1800);
  ok("layers: and is gone once faded", !(await media(page, "audio")).some((x) => x.layer === "Lrain"));
  ok("layers: the others play on", (await media(page, "audio")).filter((x) => !x.paused).length === 2);
  ok("layers: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();
}

// -------------------------------------------------------------
// 3. The soundboard and scattered sounds, as a player hears them
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const errors = await open(page, { meta: room({ seq: 1, track: { k: "a", u: FILE("long-music"), t: "Music" }, at: Date.now(), paused: null, vol: 1 }) });
  await tune(page);
  await sleep(2000);
  await deliver(page, { type: "sound", track: { k: "a", u: FILE("clip-horn"), t: "Horn" }, vol: 1 }, "conn-x");
  await deliver(page, { type: "sound", track: { k: "a", u: "javascript:alert(1)" }, vol: 1 });
  await sleep(300);
  ok("sounds: a player cannot put a sound on everyone's speakers", (await media(page, 'audio[data-role="shot"]')).length === 0);
  await deliver(page, { type: "sound", track: { k: "a", u: FILE("clip-horn"), t: "Horn" }, vol: 0.5 });
  await sleep(400);
  let shots = await media(page, 'audio[data-role="shot"]');
  ok("sounds: the GM's press plays", shots.length === 1 && !shots[0].paused);
  ok(`sounds: at the sound's level × the player's sounds level (${shots[0] && shots[0].vol.toFixed(2)})`, !!shots[0] && Math.abs(shots[0].vol - 0.4) < 0.02);
  ok(`sounds: the music ducks under it (${(await musicEl(page)).vol.toFixed(2)})`, (await musicEl(page)).vol < 0.3);
  await sleep(3300);
  ok("sounds: and comes back after", (await musicEl(page)).vol > 0.5 && (await media(page, 'audio[data-role="shot"]')).length === 0);
  await deliver(page, { type: "shot", track: { k: "a", u: FILE("clip-gull"), t: "Gull" }, vol: 1, layer: "L1" });
  await sleep(400);
  shots = await media(page, 'audio[data-role="shot"]');
  ok("sounds: a scattered gull plays", shots.length === 1);
  ok("sounds: at the ambience level, and without ducking the music", Math.abs(shots[0].vol - 0.6) < 0.02 && (await musicEl(page)).vol > 0.5);
  await deliver(page, { type: "stopSounds" });
  await sleep(200);
  ok("sounds: Stop sounds stops them", (await media(page, 'audio[data-role="shot"]')).length === 0);
  ok("sounds: nothing throws", errors.length === 0);
  await page.close();
}

// -------------------------------------------------------------
// 4. The GM's bar conducts
// -------------------------------------------------------------
const LIB = {
  v: 2,
  lists: [
    { id: "ex", name: "Explore", tracks: [{ k: "a", u: SUNO(U_SHORT), t: "Short" }, { k: "a", u: SUNO(U_LONG), t: "Long" }] },
    { id: "cb", name: "Combat", tracks: [{ k: "yt", v: "_YsP_UGd8Ns", t: "Fight!" }] },
    { id: "sc", name: "Cloud", tracks: [{ k: "sc", u: "https://soundcloud.com/gs/tavern", t: "Tavern" }, { k: "a", u: FILE("long-after"), t: "After" }] },
  ],
  sounds: [
    { id: "s-sting", name: "Sting", track: { k: "a", u: FILE("clip-sting"), t: "Sting" }, vol: 1, page: "D&M" },
    { id: "s-crit", name: "Crit", track: { k: "a", u: FILE("clip-crit"), t: "Crit" }, vol: 0.8, page: "D&M" },
    { id: "s-gull", name: "Gull", track: { k: "a", u: FILE("clip-gull"), t: "Gull" }, vol: 1, page: "Coast" },
    { id: "s-rainvid", name: "Rain video", track: { k: "yt", v: "bbbbbbbbbbb", t: "Rain" }, vol: 1, page: "Coast" },
  ],
  scenes: [
    { id: "fight", name: "Fight", music: { mode: "list", list: "cb" }, amb: [] },
    { id: "coast", name: "Coast", music: { mode: "keep" }, amb: [{ track: { k: "a", u: FILE("long-waves"), t: "Waves" }, vol: 0.5 }] },
  ],
  reactions: {
    threatUp: { sound: "s-sting" },
    combatStart: { scene: "fight" },
    combatEnd: { restore: true },
    rollCrit: { sound: "s-crit" },
    rollComplication: { sound: "s-sting" },
  },
  fadeSeconds: 0.5,
};
const DNM = { threat: 0, momentum: 2, initiative: null, epochs: { breather: 0, break: 0, bed: 0, scene: 0, session: 0, adventure: 0 }, log: [] };

{
  const page = await browser.newPage();
  const errors = await open(page, {
    role: "GM", conn: "conn-gm", players: [{ role: "PLAYER", connectionId: "conn-x" }], library: LIB,
    meta: { ...room({ seq: 1, track: LIB.lists[0].tracks[0], at: Date.now(), paused: null, list: "ex", i: 0, label: "Explore", vol: 1 }), [DNM_ROOM_KEY]: DNM },
  });
  ok("GM: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  ok("GM: the transport and the console window button are shown", (await page.isVisible("#next")) && (await page.isVisible("#popout")));
  await tune(page);
  await page.waitForFunction((k) => window.__stub.st.meta[k].music.seq === 2, STATE_KEY, { timeout: 6000 }).catch(() => {});
  let s = await roomState(page);
  ok(`GM: when a track ends the next starts (seq ${s.music.seq})`, s.music.seq === 2 && s.music.track.t === "Long");
  ok("GM: and the players are told the time", (await sent(page)).some((m) => m.data.type === "tick" && m.dest === "REMOTE"));
  await sleep(1500);

  await patchMeta(page, { [DNM_ROOM_KEY]: { ...DNM, threat: 2 } });
  await sleep(400);
  let snd = (await sent(page)).filter((m) => m.data.type === "sound");
  ok("GM: Threat going up plays its sound for everyone", snd.length === 1 && snd[0].dest === "ALL" && snd[0].data.track.u === FILE("clip-sting"));
  ok("GM: the GM hears it too", (await media(page, 'audio[data-role="shot"]')).some((x) => x.src === FILE("clip-sting")));

  const beforeFight = await musicEl(page);
  await patchMeta(page, { [DNM_ROOM_KEY]: { ...DNM, threat: 2, initiative: { round: 1, rows: [] } } });
  await page.waitForFunction(() => window.__yt && window.__yt.calls.length > 0, null, { timeout: 4000 }).catch(() => {});
  s = await roomState(page);
  ok("GM: initiative recalls its scene", s.music.list === "cb" && s.music.track.k === "yt" && s.scene === "Fight");
  ok("GM: YouTube is told to play the video", !!(await page.evaluate(() => window.__yt && window.__yt.calls.some((c) => c[0] === "loadVideoById" && c[1].videoId === "_YsP_UGd8Ns"))));
  const pops = await page.evaluate(() => window.__stub.st.popover);
  ok("GM: the bar grows to show the video", pops.some((p) => p[0] === "height" && p[1] >= 296));
  ok("GM: what initiative interrupted is remembered", !!(await page.evaluate((k) => localStorage.getItem(k), RESUME_KEY)));
  await sleep(700);
  ok("GM: the music underneath has faded away", (await media(page, 'audio[data-role="music"]')).length === 0);
  s = await roomState(page);
  ok("GM: the video's title is shared", s.music.nt === "Stub video _YsP_UGd8Ns");

  await patchMeta(page, { [DNM_ROOM_KEY]: { ...DNM, threat: 2, initiative: null } });
  await sleep(800);
  s = await roomState(page);
  const pos = (Date.now() - s.music.at) / 1000;
  ok("GM: initiative ending brings the music back", s.music.list === "ex" && s.music.track.t === "Long");
  ok(`GM: where it left off (${pos.toFixed(1)}s, was ${beforeFight.t.toFixed(1)}s)`, Math.abs(pos - beforeFight.t) < 3);
  await sleep(700);
  // Put away = destroyed, or kept stopped and out of sight for the next video.
  ok("GM: the video is put away", (await page.evaluate(() => window.__yts.every((y) => y.destroyed || y.calls.at(-1)[0] === "stopVideo")))
    && (await page.$$eval(".embed-tile", (n) => n.filter((x) => x.style.display !== "none").length)) === 0
    && !(await page.evaluate(() => document.body.classList.contains("video"))));

  const log = [{ id: "r1", pass: false, diff: 2, comp: 2, conceal: "hidden", detail: [{ kind: "complication" }] }];
  const before = (await sent(page)).filter((m) => m.data.type === "sound").length;
  await patchMeta(page, { [DNM_ROOM_KEY]: { ...DNM, threat: 2, log } });
  await sleep(1400);
  ok("GM: a HIDDEN roll's complication plays nothing", (await sent(page)).filter((m) => m.data.type === "sound").length === before);
  await patchMeta(page, { [DNM_ROOM_KEY]: { ...DNM, threat: 2, log: [{ id: "r2", pass: true, diff: 1, detail: [{ kind: "crit" }] }, ...log] } });
  await sleep(400);
  snd = (await sent(page)).filter((m) => m.data.type === "sound");
  ok("GM: an open roll's critical plays its sound", snd.length === before + 1 && snd.at(-1).data.track.u === FILE("clip-crit") && snd.at(-1).data.vol === 0.8);
  ok("GM: nothing threw", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();
}

// -------------------------------------------------------------
// 5. Scattered layers, scenes following Owlbear scenes, the video limit
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const lib = { ...LIB, scenes: [...LIB.scenes, { id: "gulls", name: "Gulls", music: { mode: "keep" }, amb: [{ track: LIB.sounds[2].track, mode: "scatter", min: 3, max: 3, vol: 0.9, label: "Gull" }] }] };
  const errors = await open(page, {
    role: "GM", conn: "conn-gm", players: [], library: lib,
    meta: room(null), sceneMeta: { [SCENE_KEY]: { scene: "coast" } }, sceneReady: false,
  });
  await page.evaluate(() => window.__stub.sceneReadyChange(true));
  await sleep(500);
  let s = await roomState(page);
  ok("scenes: opening an Owlbear scene plays its radio scene", !!s && s.scene === "Coast" && s.amb.length === 1 && s.amb[0].label === "Waves");

  await page.evaluate(() => window.__stub.st.sent.length = 0);
  await page.evaluate((k) => window.__stub.patchMeta({ [k]: { ...window.__stub.st.meta[k], amb: [] } }), STATE_KEY);
  // Recall the scattered scene through the same path the console uses.
  await page.evaluate(() => document.querySelector("#next").click()); // harmless with no music
  await page.evaluate(({ k }) => window.__stub.patchMeta({ [k]: { v: 2, music: null, amb: [
    { id: "Lg", track: { k: "a", u: "https://files.test/clip-gull.mp3", t: "Gull" }, at: Date.now(), vol: 0.9, mode: "scatter", min: 3, max: 3, label: "Gull" }], scene: "Gulls" } }), { k: STATE_KEY });
  await page.waitForFunction(() => window.__stub.st.sent.some((m) => m.data.type === "shot"), null, { timeout: 6000 }).catch(() => {});
  const shot = (await sent(page)).find((m) => m.data.type === "shot");
  ok("scatter: the GM's bar fires the gull for everyone, on its own", !!shot && shot.dest === "ALL" && shot.data.vol === 0.9);

  // The video limit, as the conductor enforces it. Two videos already.
  await page.evaluate(({ k }) => window.__stub.patchMeta({ [k]: { v: 2, music: { seq: 5, track: { k: "yt", v: "aaaaaaaaaaa", t: "A" }, at: Date.now(), paused: null, list: "", i: 0, vol: 1 },
    amb: [{ id: "Lv", track: { k: "yt", v: "bbbbbbbbbbb", t: "B" }, at: Date.now(), vol: 1, mode: "loop", min: 20, max: 60, label: "B" }], scene: "" } }), { k: STATE_KEY });
  await sleep(300);
  await tune(page);
  await page.waitForFunction(() => window.__yts && window.__yts.length === 2, null, { timeout: 4000 }).catch(() => {});
  const pops = await page.evaluate(() => window.__stub.st.popover.filter((p) => p[0] === "width").map((p) => p[1]));
  ok("videos: two video players sit side by side", pops.at(-1) === 400 && (await page.$$(".embed-tile")).length === 2);
  ok("videos: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();
}

// -------------------------------------------------------------
// 6. SoundCloud, as music
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const errors = await open(page, {
    role: "GM", conn: "conn-gm", players: [], library: LIB,
    meta: room({ seq: 3, track: LIB.lists[2].tracks[0], at: Date.now() - 12000, paused: null, list: "sc", i: 0, label: "Cloud", vol: 1 }),
  });
  await tune(page);
  await page.waitForFunction(() => window.__sc && window.__sc.calls.some((c) => c[0] === "play"), null, { timeout: 4000 }).catch(() => {});
  const frame = await page.getAttribute(".embed-tile iframe", "src").catch(() => "");
  ok("SoundCloud: its widget is shown, pointed at the track", /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fgs%2Ftavern/.test(frame || ""));
  const calls = await page.evaluate(() => window.__sc ? window.__sc.calls : []);
  const seek = calls.find((c) => c[0] === "seekTo");
  ok(`SoundCloud: it starts where the room is (${seek && seek[1]}ms)`, !!seek && seek[1] > 11000 && seek[1] < 14000);
  ok("SoundCloud: and plays", calls.some((c) => c[0] === "play"));
  await page.evaluate(() => window.__sc.fire("finish"));
  await sleep(500);
  const s = await roomState(page);
  ok("SoundCloud: when it finishes, the playlist moves on", s.music.seq === 4 && s.music.track.t === "After");
  ok("SoundCloud: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();
}

// -------------------------------------------------------------
// 7. The console inside Owlbear, talking to the GM's bar
// -------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 520, height: 900 } });
  const bar = await ctx.newPage();
  const barErrors = await open(bar, { role: "GM", conn: "conn-gm", players: [], library: { v: 2, lists: [], sounds: [], scenes: [] }, meta: room(null) });
  const con = await ctx.newPage();
  const errors = await open(con, { file: "index.html", role: "GM", conn: "conn-gm", players: [] });
  await con.waitForFunction(() => document.getElementById("c-conn").textContent.includes("GM"), null, { timeout: 5000 }).catch(() => {});
  ok("console: it finds the bar", (await con.textContent("#c-conn")) === "Connected · GM");
  ok("console: nothing throws", errors.length === 0 && barErrors.length === 0);
  if (errors.length || barErrors.length) console.log("     ", errors[0] || barErrors[0]);
  ok("console: it asks Owlbear for room to breathe", (await con.evaluate(() => window.__stub.st.action)).some((a) => a[0] === "width" && a[1] >= 500));

  // A playlist, mixed, with one line that cannot work.
  await con.click('button[data-tab="library"]');
  await con.click("#c-lists button:has-text('New')");
  await sleep(300);
  await con.fill("#c-lists textarea", [
    "Banjo | https://suno.com/song/" + U_LONG,
    "https://youtu.be/_YsP_UGd8Ns",
    "https://soundcloud.com/gs/tavern",
    "https://suno.com/s/cq8ogDYThAoJj3fo",
  ].join("\n"));
  await con.click("#c-lists button:has-text('Save')");
  await sleep(500);
  const errs = await con.$$eval("#c-lists .error", (n) => n.map((x) => x.textContent));
  ok("console: the Suno short link is reported on its line", errs.length === 1 && /^Line 4/.test(errs[0]));
  const stored = await bar.evaluate((k) => JSON.parse(localStorage.getItem(k)), LIBRARY_KEY);
  ok("console: the library is kept by the BAR, sources mixed", stored.lists[0].tracks.map((t) => t.k).join() === "a,yt,sc");
  ok("console: the broken line stays in the box to be fixed", (await con.inputValue("#c-lists textarea")).includes("suno.com/s/"));

  await con.fill("#c-sounds textarea", ["## Combat", "Clash | https://files.test/clip-clash.mp3", "Horn | https://files.test/clip-horn.mp3 | 50", "## Coast", "Waves | https://files.test/long-waves.mp3"].join("\n"));
  await con.click("#c-sounds button:has-text('Save sounds')");
  await sleep(400);
  ok("console: sounds saved with their pages", (await bar.evaluate((k) => JSON.parse(localStorage.getItem(k)).sounds.map((s) => s.page).join(), LIBRARY_KEY)) === "Combat,Combat,Coast");

  await con.click('button[data-tab="play"]');
  await sleep(300);
  await con.click("#c-music button:has-text('Play this list')");
  await sleep(500);
  let s = await roomState(bar);
  ok("console: Play writes the playlist to the room", !!s && s.music && s.music.track.t === "Banjo");
  ok("console: and shows it", (await con.textContent("#c-now-title")) === "Banjo");

  const pads = await con.$$eval("#c-board .pad", (n) => n.map((x) => x.textContent));
  ok("console: the soundboard shows the first page", pads.join() === "Clash,Horn");
  await con.click("#c-board .pad:has-text('Horn')");
  await sleep(300);
  const horn = (await sent(bar)).filter((m) => m.data.type === "sound").at(-1);
  ok("console: a pad press goes to everyone, at the sound's own level", !!horn && horn.dest === "ALL" && horn.data.vol === 0.5);
  await con.click("#c-board .page:has-text('Coast')");
  ok("console: pages switch", (await con.$$eval("#c-board .pad", (n) => n.map((x) => x.textContent))).join() === "Waves");

  await con.selectOption("#c-amb select >> nth=0", { label: "Waves" });
  await con.click("#c-amb button:has-text('Add')");
  await sleep(400);
  s = await roomState(bar);
  ok("console: an ambience layer is added from the library", s.amb.length === 1 && s.amb[0].label === "Waves" && s.amb[0].mode === "loop");

  await con.fill("#c-scenes input[type=text]", "Harbour");
  await con.click("#c-scenes button:has-text('Save as scene')");
  await sleep(400);
  const scenes = await bar.evaluate((k) => JSON.parse(localStorage.getItem(k)).scenes, LIBRARY_KEY);
  ok("console: what is playing is saved as a scene", scenes.length === 1 && scenes[0].name === "Harbour" && scenes[0].amb.length === 1 && scenes[0].music.mode === "list");
  await con.click("#c-amb button[aria-label='Stop Waves']");
  await sleep(300);
  ok("console: a layer stops", (await roomState(bar)).amb.length === 0);
  await con.click("#c-scenes button.scene:has-text('Harbour')");
  await sleep(400);
  s = await roomState(bar);
  ok("console: recalling the scene brings it all back", s.amb.length === 1 && s.scene === "Harbour");

  await con.click('button[data-tab="reactions"]');
  await sleep(300);
  // Saved as it is chosen: no button to press, nothing a redraw can lose.
  await con.selectOption("#c-react select[aria-label='Threat goes up: sound']", { label: "Combat: Clash" });
  await sleep(400);
  const lib = await bar.evaluate((k) => JSON.parse(localStorage.getItem(k)), LIBRARY_KEY);
  ok("console: a reaction is saved", !!lib.reactions.threatUp && lib.reactions.threatUp.sound === lib.sounds[0].id);
  ok("console: without D&M it says the reactions wait for it", /not in this room/.test(await con.textContent("#c-react")));
  await con.selectOption("#c-obrscene select", { label: "Harbour" });
  await sleep(400);
  ok("console: an Owlbear scene can be given a radio scene", (await bar.evaluate((k) => window.__stub.st.sceneMeta[k], SCENE_KEY)).scene === lib.scenes[0].id);

  // XSS: a library pasted from somebody else's backup.
  await con.click('button[data-tab="settings"]');
  await sleep(200);
  const evil = { v: 2, lists: [{ id: "x", name: '<img src=x onerror="window.__pwned=1">', tracks: [{ k: "a", u: "https://files.test/a.mp3", t: '<img src=x onerror="window.__pwned=1">' }] }],
    sounds: [{ id: "e", name: '<img src=x onerror="window.__pwned=1">', track: { k: "a", u: "https://files.test/a.mp3", t: "x" }, page: '<b onmouseover="window.__pwned=1">p</b>' }], scenes: [] };
  await con.fill("#c-backup textarea", JSON.stringify(evil));
  await con.click("#c-backup button:has-text('Load this library')");
  await con.click("#c-backup button:has-text('Sure?')");
  await sleep(400);
  for (const t of ["play", "library", "reactions"]) { await con.click(`button[data-tab="${t}"]`); await sleep(150); }
  ok("console: a hostile backup's names are shown as text, never run", !(await con.evaluate(() => window.__pwned)) && (await con.$$("#c-main img")).length === 0);
  ok("console: no section renders a list as text", !(await con.evaluate(() => document.body.textContent.includes("[object"))));
  ok("console: nothing threw", errors.length === 0 && barErrors.length === 0);
  if (errors.length || barErrors.length) console.log("     ", errors[0] || barErrors[0]);

  // A player's console: now playing and their own volume, nothing else.
  const pbar = await ctx.newPage();
  await open(pbar, { role: "PLAYER", conn: "conn-p", meta: room({ seq: 1, track: { k: "a", u: FILE("long-x"), t: "Song" }, at: Date.now(), paused: null, vol: 1 }) });
  await ctx.close();

  const ctx2 = await browser.newContext();
  const pb = await ctx2.newPage();
  await open(pb, { role: "PLAYER", conn: "conn-p", meta: room({ seq: 1, track: { k: "a", u: FILE("long-x"), t: "Song" }, at: Date.now(), paused: null, vol: 1 }) });
  const pc = await ctx2.newPage();
  const perr = await open(pc, { file: "index.html", role: "PLAYER", conn: "conn-p" });
  await pc.waitForFunction(() => document.getElementById("c-conn").textContent.startsWith("Connected"), null, { timeout: 5000 }).catch(() => {});
  ok("player console: shows what is playing", (await pc.textContent("#c-now-title")) === "Song");
  ok("player console: no tabs, no mixer, no soundboard", !(await pc.isVisible("#c-tabs")) && !(await pc.isVisible("#c-board")) && !(await pc.isVisible("#c-music")));
  await pc.fill("#c-v-amb", "20");
  await pc.dispatchEvent("#c-v-amb", "input");
  await sleep(300);
  ok("player console: their own volume reaches their bar", Math.abs((await pb.evaluate((k) => JSON.parse(localStorage.getItem(k)).amb, PREFS_KEY)) - 0.2) < 0.01);
  ok("player console: nothing throws", perr.length === 0);
  await ctx2.close();
}

// -------------------------------------------------------------
// 8. The console in its own window
// -------------------------------------------------------------
{
  const ctx = await browser.newContext();
  const bar = await ctx.newPage();
  const barErrors = await open(bar, { role: "GM", conn: "conn-gm", players: [], library: LIB, meta: room(null) });
  const popupP = ctx.waitForEvent("page");
  await bar.click("#popout");
  const pop = await popupP;
  const popErrors = [];
  pop.on("pageerror", (e) => popErrors.push(e.message));
  await pop.waitForLoadState();
  await pop.waitForFunction(() => document.getElementById("c-conn").textContent.includes("GM"), null, { timeout: 6000 }).catch(() => {});
  ok("window: the popped-out console connects to the bar that opened it", (await pop.textContent("#c-conn")) === "Connected · GM");
  ok("window: it is the wide layout", await pop.evaluate(() => document.body.classList.contains("popout")));
  ok("window: it shows the bar's library", (await pop.$$eval("#c-music select option", (n) => n.map((x) => x.textContent))).includes("Explore (2)"));
  await pop.click("#c-music button:has-text('Play this list')");
  await sleep(500);
  const s = await roomState(bar);
  ok("window: its commands change the room, through the bar", !!s && s.music && s.music.label === "Explore");
  await pop.click("#c-board .pad:has-text('Sting')");
  await sleep(300);
  ok("window: its soundboard plays for everyone", (await sent(bar)).some((m) => m.data.type === "sound" && m.data.track.u === FILE("clip-sting")));
  ok("window: nothing throws", popErrors.length === 0 && barErrors.length === 0);
  if (popErrors.length || barErrors.length) console.log("     ", popErrors[0] || barErrors[0]);
  await ctx.close();
}
{
  // A blocked pop-up is said, not silent.
  const page = await browser.newPage();
  await open(page, { role: "GM", conn: "conn-gm", players: [], meta: room(null) });
  await page.evaluate(() => { window.open = () => null; });
  await page.click("#popout");
  ok("window: a blocked pop-up says how to allow it", /Allow pop-ups/.test(await page.textContent("#status")));
  await page.close();
}
{
  // The console with no bar open offers to open it.
  const page = await browser.newPage();
  const errors = await open(page, { file: "index.html", role: "PLAYER" });
  await sleep(1500);
  ok("no bar: the console says the bar is not open", await page.isVisible("#c-nobar") && /not open/.test(await page.textContent("#c-nobar")));
  await page.click("#c-open-bar");
  const opened = (await page.evaluate(() => window.__stub.st.popover)).find((p) => p[0] === "open");
  ok("no bar: Open the radio docks the bar", !!opened && opened[1].url.endsWith("/bar.html") && opened[1].disableClickAway === true);
  ok("no bar: nothing throws", errors.length === 0);
  await page.close();
}

// -------------------------------------------------------------
// 10. The starter packs, with their real files
// -------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 520, height: 900 } });
  const bar = await ctx.newPage();
  const barErrors = await open(bar, { role: "GM", conn: "conn-gm", players: [], library: { v: 2, lists: [], sounds: [], scenes: [] }, meta: room(null) });
  const con = await ctx.newPage();
  const errors = await open(con, { file: "index.html", role: "GM", conn: "conn-gm", players: [] });
  await con.waitForFunction(() => document.getElementById("c-conn").textContent.includes("GM"), null, { timeout: 5000 }).catch(() => {});
  await con.click('button[data-tab="library"]');
  await sleep(300);
  const packNames = await con.$$eval("#c-packs .pack strong", (n) => n.map((x) => x.textContent));
  ok(`packs: four starter packs are offered (${packNames.join(", ")})`, packNames.length === 4);
  for (const name of packNames) {
    await con.click(`#c-packs .pack:has(strong:text-is("${name}")) button`);
    await sleep(500);
  }
  const lib = await bar.evaluate((k) => JSON.parse(localStorage.getItem(k)), LIBRARY_KEY);
  ok(`packs: added through the console, kept by the bar (${lib.sounds.length} sounds, ${lib.scenes.length} scenes, ${lib.lists.length} playlists)`,
    lib.sounds.length > 60 && lib.scenes.length === 10 && lib.lists.length === 2);
  ok("packs: every button now says Added", (await con.$$eval("#c-packs .pack button", (n) => n.map((b) => b.textContent))).every((t) => t === "Added"));
  ok("packs: reactions were filled in", !!lib.reactions.rollSuccess && !!lib.reactions.combatStart);

  await con.click('button[data-tab="play"]');
  await sleep(300);
  await tune(bar);
  await con.click("#c-board .pad:has-text('Draw sword')");
  await bar.waitForFunction(() => { const a = document.querySelector('audio[data-role="shot"]'); return a && !a.paused && a.duration > 0; }, null, { timeout: 4000 }).catch(() => {});
  const shot = await bar.evaluate(() => { const a = document.querySelector('audio[data-role="shot"]'); return a ? { src: a.src, dur: a.duration, paused: a.paused } : null; });
  ok("packs: a pad plays the real file, from where GitHub Pages will serve it",
    !!shot && shot.src === "https://gsgrimoire.github.io/obr-radio/sounds/sfx/sword-draw.ogg" && shot.dur > 0.2 && !shot.paused);

  await con.click("#c-scenes button.scene:has-text('Storm at sea')");
  await sleep(2500);
  const layers = await media(bar, 'audio[data-role="layer"]');
  ok(`packs: a scene plays its real loops together (${layers.filter((l) => !l.paused).length} playing)`, layers.length === 3 && layers.every((l) => !l.paused && l.src.includes("/sounds/amb/")));

  // Every file we ship decodes in Chromium.
  const files = [...new Set(lib.sounds.filter((x) => x.track.k === "a").map((x) => x.track.u))];
  const bad = await bar.evaluate(async (urls) => {
    const out = [];
    for (const u of urls) {
      const ok = await new Promise((res) => {
        const a = new Audio();
        a.preload = "metadata";
        a.onloadedmetadata = () => res(a.duration > 0);
        a.onerror = () => res(false);
        a.src = u;
        setTimeout(() => res(false), 5000);
      });
      if (!ok) out.push(u);
    }
    return out;
  }, files);
  ok(`packs: all ${files.length} shipped files decode in the browser`, bad.length === 0);
  if (bad.length) console.log("      ", bad.slice(0, 5).join(" "));
  ok("packs: nothing threw", errors.length === 0 && barErrors.length === 0);
  if (errors.length || barErrors.length) console.log("     ", errors[0] || barErrors[0]);

  const cred = await ctx.newPage();
  const credErrors = [];
  cred.on("pageerror", (e) => credErrors.push(e.message));
  await cred.goto(site.origin + "/credits.html");
  await sleep(400);
  const rowCount = await cred.$$eval("#rows tr", (n) => n.length);
  ok(`credits: the page lists every sound (${rowCount} rows)`, rowCount >= 60 && credErrors.length === 0);
  ok("credits: CC BY authors are named, with a link to the original", /Luftrum/.test(await cred.textContent("#rows")) && (await cred.$$('#rows a[href*="freesound.org/people/Luftrum"]')).length === 1);
  await ctx.close();
}

// -------------------------------------------------------------
// 9. The "Copy for Radio" bookmark, run against a page shaped like a Suno playlist
// -------------------------------------------------------------
{
  const A = "aaaaaaaa-1111-4111-8111-111111111111";
  const B = "bbbbbbbb-2222-4222-8222-222222222222";
  fs.writeFileSync(path.join(stage, "fake-suno.html"), `<!DOCTYPE html><body>
    <div class="card"><a href="/song/${A}"><img alt=""></a><a href="/song/${A}">Liquid Banjo | with a trumpet twist</a></div>
    <div class="card"><a href="/song/${B}"><img alt=""></a><a href="https://suno.com/song/${B}?sh=xyz">Tavern Night</a></div>
    <a href="/playlist/d827cffa-9998-4ad5-86d4-6701d9a43869">A playlist, not a song</a>
    <a href="/@gsgrimoire">A profile</a>
  </body>`);
  fs.writeFileSync(path.join(stage, "empty-suno.html"), "<!DOCTYPE html><body><p>Loading…</p></body>");

  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(site.origin + "/suno.html");
  await page.waitForFunction(() => document.getElementById("bookmarklet").href.startsWith("javascript:"));
  const href = await page.getAttribute("#bookmarklet", "href");
  ok("help page: nothing throws", errors.length === 0);
  ok("help page: the bookmark is built", href.length > 200 && !href.includes("export"));

  const run = async (file) => {
    await page.goto(site.origin + "/" + file);
    await page.evaluate(() => {
      window.__copied = null; window.__alerts = [];
      window.alert = (m) => window.__alerts.push(m);
      window.prompt = () => null;
      Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
    });
    // Exactly what the browser does with a javascript: bookmark.
    await page.evaluate((h) => { (0, eval)(decodeURIComponent(h.slice("javascript:".length))); }, href);
    await sleep(100);
    return page.evaluate(() => ({ copied: window.__copied, alerts: window.__alerts }));
  };

  const got = await run("fake-suno.html");
  const lines = (got.copied || "").split("\n");
  ok(`bookmark: one line per song, not per link (${lines.length})`, lines.length === 2);
  ok("bookmark: the title comes from the title link, not the cover", lines[0] === `Liquid Banjo / with a trumpet twist | https://suno.com/song/${A}`);
  ok("bookmark: tracking parameters are dropped", lines[1] === `Tavern Night | https://suno.com/song/${B}`);
  ok("bookmark: it says how many it copied", /2 songs copied/.test(got.alerts[0] || ""));
  const parsed = parseTrackList(got.copied || "");
  ok("bookmark: what it copies pastes straight into a playlist", parsed.tracks.length === 2 && parsed.errors.length === 0
    && parsed.tracks[0].t === "Liquid Banjo / with a trumpet twist");

  const none = await run("empty-suno.html");
  ok("bookmark: an empty page says to scroll, and copies nothing", none.copied === null && /scroll/.test(none.alerts[0] || ""));
  ok("bookmark: nothing throws", errors.length === 0);
  await page.close();
}


// -------------------------------------------------------------
// 10. From the first table (1.2): what went wrong in the room, each shown fixed
// -------------------------------------------------------------
{
  // Buttons that needed two presses. The panel redrew itself between the press and
  // the release, so the click landed on a button that was no longer there.
  const ctx = await browser.newContext({ viewport: { width: 520, height: 900 } });
  const lib = { ...LIB, lists: [{ id: "ex", name: "Explore", tracks: [{ k: "a", u: FILE("long-m"), t: "M" }] }], fadeSeconds: 0 };
  const bar = await ctx.newPage();
  const barErrors = await open(bar, { role: "GM", conn: "conn-gm", players: [], library: lib, meta: room(null) });
  const con = await ctx.newPage();
  const errors = await open(con, { file: "index.html", role: "GM", conn: "conn-gm", players: [] });
  await con.waitForFunction(() => document.getElementById("c-conn").textContent.includes("GM"), null, { timeout: 5000 }).catch(() => {});

  await con.evaluate(() => { window.__keep = document.querySelector("#c-music button.primary"); });
  await sleep(6500);
  ok("clicks: a report that says nothing new redraws nothing", await con.evaluate(() => window.__keep.isConnected));

  // Typing a link, then pressing Add while the bar reports a change.
  await con.fill("#c-amb input[type=text]", "https://files.test/long-brook.mp3");
  await patchMeta(bar, { [STATE_KEY]: { v: 2, music: null, amb: [], scene: "Somewhere" } });
  await sleep(400);
  const addBox = await con.locator("#c-amb button:has-text('Add')").boundingBox();
  await con.mouse.move(addBox.x + addBox.width / 2, addBox.y + addBox.height / 2);
  await con.mouse.down();
  await patchMeta(bar, { [STATE_KEY]: { v: 2, music: null, amb: [], scene: "Elsewhere" } });
  await sleep(300);
  await con.mouse.up();
  await sleep(600);
  let s = await roomState(bar);
  ok("clicks: Add works on the first press, even mid-redraw", s.amb.length === 1 && s.amb[0].track.u === "https://files.test/long-brook.mp3");

  // Every layer has its own pause.
  await con.click("#c-amb button[aria-label^='Pause']");
  await sleep(500);
  s = await roomState(bar);
  ok("layers: one can be paused for everyone", s.amb[0].off === true);
  ok("layers: and shows as paused", /paused/.test(await con.textContent("#c-amb .layer")));
  await con.click("#c-amb button[aria-label^='Play']");
  await sleep(500);
  ok("layers: and played again", !("off" in (await roomState(bar)).amb[0]));

  // Reactions saved as they are chosen, two in a row, neither lost.
  await con.click('button[data-tab="reactions"]');
  await sleep(300);
  await con.selectOption("#c-react select[aria-label='Threat goes up: sound']", { label: "D&M: Crit" });
  await con.selectOption("#c-react select[aria-label='Momentum gained: sound']", { label: "Coast: Gull" });
  await sleep(600);
  const r = (await bar.evaluate((k) => JSON.parse(localStorage.getItem(k)), LIBRARY_KEY)).reactions;
  ok("reactions: two changes in a row are both kept", r.threatUp.sound === "s-crit" && r.momentumUp && r.momentumUp.sound === "s-gull");
  ok("reactions: and the ones not touched are too", r.rollCrit.sound === "s-crit" && r.combatStart.scene === "fight");

  // A scene pressed again stops.
  await con.click('button[data-tab="play"]');
  await sleep(300);
  await con.click("#c-amb button:has-text('Stop all ambience')");
  await sleep(300);
  await con.click("#c-scenes button.scene:has-text('Coast')");
  await sleep(500);
  s = await roomState(bar);
  ok("scenes: pressing one plays it", s.scene === "Coast" && s.amb.length === 1);
  ok("scenes: it is lit", (await con.getAttribute("#c-scenes button.scene:has-text('Coast')", "aria-pressed")) === "true");
  await con.click("#c-scenes button.scene:has-text('Coast')");
  await sleep(500);
  s = await roomState(bar);
  ok("scenes: pressing it again stops it", s.scene === "" && s.amb.length === 0);
  ok("clicks: nothing threw", errors.length === 0 && barErrors.length === 0);
  if (errors.length || barErrors.length) console.log("     ", errors[0] || barErrors[0]);
  await ctx.close();
}

{
  // A panel whose BroadcastChannel does not work still reaches its bar, through
  // Owlbear's own messages — the whole library included, in pieces.
  const ctx = await browser.newContext();
  const long = (i) => `https://files.test/a-rather-long-file-name-for-sound-number-${i}-from-a-big-library.mp3`;
  const big = { ...LIB,
    lists: [...LIB.lists, { id: "lots", name: "Lots", tracks: Array.from({ length: 150 }, (_, i) => ({ k: "a", u: long(i), t: "Track " + i, s: long(i) })) }],
    sounds: Array.from({ length: 120 }, (_, i) => ({ id: "n" + i, name: "Sound number " + i, page: "Page " + (i % 7), track: { k: "a", u: long(i), t: "x", s: long(i) } })) };
  const bar = await ctx.newPage();
  const barErrors = await open(bar, { role: "GM", conn: "conn-gm", players: [], library: big, meta: room(null), noBC: true });
  const con = await ctx.newPage();
  const errors = await open(con, { file: "index.html", role: "GM", conn: "conn-gm", players: [], noBC: true });
  await con.waitForFunction(() => document.getElementById("c-conn").textContent.includes("GM"), null, { timeout: 6000 }).catch(() => {});
  ok("link: without BroadcastChannel, Owlbear's route connects", (await con.textContent("#c-conn")) === "Connected · GM");
  const pieces = (await sent(bar)).filter((m) => m.data && m.data.t === "piece");
  ok(`link: a large library travels in pieces (${pieces.length})`, pieces.length >= 2);
  await con.click('button[data-tab="library"]');
  await sleep(300);
  ok("link: and arrives whole", /Sounds \(120\)/.test(await con.textContent("#c-sounds")));
  await con.click('button[data-tab="play"]');
  await con.click("#c-music button:has-text('Play this list')");
  await sleep(600);
  ok("link: commands go the same way", !!(await roomState(bar)) && (await roomState(bar)).music.list === "ex");
  ok("link: nothing threw", errors.length === 0 && barErrors.length === 0);
  if (errors.length || barErrors.length) console.log("     ", errors[0] || barErrors[0]);
  await ctx.close();

  // No bar at all: the panel opens one by itself, once, and says so.
  const ctx2 = await browser.newContext();
  const lone = await ctx2.newPage();
  await open(lone, { file: "index.html", role: "GM", conn: "conn-gm", players: [] });
  await sleep(2000);
  const opened = (await lone.evaluate(() => window.__stub.st.popover)).filter((p) => p[0] === "open");
  ok("link: with no bar, the panel opens it", opened.length === 1 && /bar\.html$/.test(opened[0][1].url));
  ok("link: and says what it is doing", /Opening the radio bar/.test(await lone.textContent("#c-nobar-text")));
  ok("link: the Open button is there anyway", await lone.isVisible("#c-open-bar"));
  await ctx2.close();
}

{
  // A hand on a video. The GM pausing it pauses the room; a player pausing it is
  // left paused, not restarted every four seconds.
  const page = await browser.newPage();
  const errors = await open(page, { role: "GM", conn: "conn-gm", players: [], library: LIB,
    meta: room({ seq: 1, track: { k: "yt", v: "_YsP_UGd8Ns", t: "Fight!" }, at: Date.now(), paused: null, list: "cb", i: 0, vol: 1 }) });
  await tune(page);
  await page.waitForFunction(() => window.__yt && window.__yt.state === 1, null, { timeout: 4000 }).catch(() => {});
  await sleep(1200);
  await page.evaluate(() => window.__yt.hand(2));
  await sleep(400);
  let s = await roomState(page);
  ok("hand: the GM pausing the video pauses the room", s.music.paused !== null);
  await sleep(1700);
  await page.evaluate(() => window.__yt.hand(1));
  await sleep(400);
  s = await roomState(page);
  ok("hand: and playing it plays the room", s.music.paused === null);
  ok("hand: nothing threw", errors.length === 0);
  await page.close();

  const pl = await browser.newPage();
  const perr = await open(pl, { role: "PLAYER", conn: "conn-p",
    meta: room({ seq: 1, track: { k: "yt", v: "_YsP_UGd8Ns", t: "Fight!" }, at: Date.now(), paused: null, list: "cb", i: 0, vol: 1 }) });
  await tune(pl);
  await pl.waitForFunction(() => window.__yt && window.__yt.state === 1, null, { timeout: 4000 }).catch(() => {});
  await sleep(1200);
  await pl.evaluate(() => { window.__yt.hand(2); window.__yt.calls.length = 0; });
  await sleep(4800);
  ok("hand: a player's pause is left alone", !(await pl.evaluate(() => window.__yt.calls.some((c) => c[0] === "playVideo"))) && (await pl.evaluate(() => window.__yt.state)) === 2);
  ok("hand: and never reaches the room", (await roomState(pl)).music.paused === null);
  ok("hand: nothing threw for the player", perr.length === 0);
  await pl.close();
}

{
  // A YouTube playlist with a video that will not play skips that video, not the
  // list — and the next video reuses the player, so a click given once still counts.
  const lib = { ...LIB, lists: [...LIB.lists, { id: "fs", name: "Free songs", tracks: [{ k: "ytl", l: "PLRy5AGzKZLmE", t: "Free Song Sunday" }] },
    { id: "two", name: "Two videos", tracks: [{ k: "yt", v: "aaaaaaaaaaa", t: "A" }, { k: "yt", v: "ccccccccccc", t: "C" }] }], fadeSeconds: 0 };
  const page = await browser.newPage();
  const errors = await open(page, { role: "GM", conn: "conn-gm", players: [], library: lib,
    meta: room({ seq: 1, track: { k: "ytl", l: "PLRy5AGzKZLmE", t: "Free Song Sunday" }, at: Date.now(), paused: null, list: "fs", i: 0, vol: 1 }) });
  await tune(page);
  await page.waitForFunction(() => window.__yt && window.__yt.state === 1, null, { timeout: 4000 }).catch(() => {});
  await sleep(300);
  await page.evaluate(() => window.__yt.opts.events.onError({ data: 150 }));
  await sleep(500);
  let s = await roomState(page);
  ok("youtube: a video that will not play is skipped inside its playlist", (await page.evaluate(() => window.__yt.calls.some((c) => c[0] === "nextVideo"))) && s.music.list === "fs" && s.music.sub === 1);

  await page.evaluate(({ k }) => window.__stub.patchMeta({ [k]: { v: 2, music: { seq: 5, track: { k: "yt", v: "aaaaaaaaaaa", t: "A" }, at: Date.now(), paused: null, list: "two", i: 0, vol: 1 }, amb: [], scene: "" } }), { k: STATE_KEY });
  await sleep(800);
  await page.evaluate(({ k }) => window.__stub.patchMeta({ [k]: { v: 2, music: { seq: 6, track: { k: "yt", v: "ccccccccccc", t: "C" }, at: Date.now(), paused: null, list: "two", i: 1, vol: 1 }, amb: [], scene: "" } }), { k: STATE_KEY });
  await sleep(800);
  const yts = await page.evaluate(() => window.__yts.length);
  ok(`youtube: the next video reuses a player (${yts} made for three videos)`, yts <= 2);
  ok("youtube: and plays the new video", await page.evaluate(() => window.__yts.some((y) => y.vid === "ccccccccccc" && y.state === 1)));
  ok("youtube: one tile shows", (await page.$$eval(".embed-tile", (n) => n.filter((x) => x.style.display !== "none").length)) === 1);
  ok("youtube: nothing threw", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();
}

{
  // A SoundCloud playlist, the one Gus pasted.
  const set = { k: "scl", u: "https://soundcloud.com/matthew-hawkins-54089931/sets/fantasy-ambience", t: "fantasy ambience" };
  const lib = { ...LIB, lists: [{ id: "set", name: "Fantasy", tracks: [set, { k: "a", u: FILE("long-after"), t: "After" }] }] };
  const page = await browser.newPage();
  const errors = await open(page, { role: "GM", conn: "conn-gm", players: [], library: lib,
    meta: room({ seq: 1, track: set, at: Date.now(), paused: null, list: "set", i: 0, vol: 1 }) });
  await tune(page);
  await page.waitForFunction(() => window.__sc && window.__sc.calls.some((c) => c[0] === "play"), null, { timeout: 4000 }).catch(() => {});
  ok("soundcloud set: the widget is pointed at the set", /sets%2Ffantasy-ambience/.test(await page.getAttribute(".embed-tile iframe", "src").catch(() => "")));
  await sleep(300);
  let s = await roomState(page);
  ok("soundcloud set: the track's title is shared", s.music.nt === "One");
  await page.evaluate(() => window.__sc.fire("finish"));
  await sleep(400);
  ok("soundcloud set: one track ending is not the end of the set", (await roomState(page)).music.seq === 1);
  await page.evaluate(() => { window.__sc.idx = 1; window.__sc.fire("play"); });
  await sleep(400);
  s = await roomState(page);
  ok("soundcloud set: moving on is told to the room", s.music.sub === 1 && s.music.nt === "Two");
  await page.evaluate(() => { window.__sc.idx = 2; window.__sc.fire("play"); });
  await sleep(300);
  await page.evaluate(() => window.__sc.fire("finish"));
  await sleep(500);
  s = await roomState(page);
  ok("soundcloud set: its last track ending moves the playlist on", s.music.seq === 2 && s.music.track.t === "After");
  ok("soundcloud set: nothing threw", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();

  // A player joining the set on its third track.
  const pl = await browser.newPage();
  const perr = await open(pl, { role: "PLAYER", conn: "conn-p", meta: room({ seq: 1, track: set, sub: 2, at: Date.now() - 5000, paused: null, list: "set", i: 0, vol: 1 }) });
  await tune(pl);
  await pl.waitForFunction(() => window.__sc && window.__sc.calls.some((c) => c[0] === "skip"), null, { timeout: 4000 }).catch(() => {});
  ok("soundcloud set: a player joins on the room's track", await pl.evaluate(() => window.__sc.calls.some((c) => c[0] === "skip" && c[1] === 2)));
  ok("soundcloud set: nothing threw for the player", perr.length === 0);
  await pl.close();
}

{
  // Moving the bar reopens it. It tries to carry on without a second Tune in; a
  // browser that allows that plays on, and one that does not asks again, plainly.
  const run = async (b, allowed) => {
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    const errors = await open(page, { meta: room({ seq: 1, track: { k: "a", u: FILE("long-m"), t: "M" }, at: Date.now(), paused: null, vol: 1 }) });
    await tune(page);
    await sleep(300);
    await page.click("#move");
    await sleep(300);
    const reopened = (await page.evaluate(() => window.__stub.st.popover)).some((p) => p[0] === "open");
    const again = await ctx.newPage();
    const errs2 = await open(again, { meta: room({ seq: 1, track: { k: "a", u: FILE("long-m"), t: "M" }, at: Date.now(), paused: null, vol: 1 }) });
    await sleep(1500);
    const playing = (await media(again, 'audio[data-role="music"]')).some((a) => !a.paused);
    const asks = await again.isVisible("#tune");
    const once = (await again.evaluate((k) => localStorage.getItem(k), RETUNE_KEY)) === null;
    const later = await ctx.newPage();
    await open(later, { meta: room(null) });
    const laterAsks = await later.isVisible("#tune");
    await ctx.close();
    return { reopened, playing, asks, once, laterAsks, errors: [...errors, ...errs2] };
  };
  const free = await chromium.launch({ ...(findChromium() ? { executablePath: findChromium() } : {}), args: ["--autoplay-policy=no-user-gesture-required"] });
  const a = await run(free, true);
  await free.close();
  ok("move: the bar reopens in the next corner", a.reopened);
  ok("move: where the browser allows it, the reopened bar plays on by itself", a.playing && !a.asks);
  ok("move: once only", a.once);
  ok("move: a bar opened any other way still asks", a.laterAsks);
  const b = await run(browser, false);
  ok("move: where the browser refuses, it asks for Tune in again rather than sitting silent", !b.playing && b.asks);
  ok("move: nothing threw", a.errors.length === 0 && b.errors.length === 0);
}


// -------------------------------------------------------------
// 11. 1.3: crossfading, and pads for players
// -------------------------------------------------------------
{
  // Two 12-second tracks and a 3-second crossfade, joined 9.5 s into the first.
  const lib = { v: 2, crossfade: 3, fadeSeconds: 0.5,
    lists: [{ id: "x", name: "Mix", tracks: [{ k: "a", u: FILE("mid-one"), t: "One" }, { k: "a", u: FILE("mid-two"), t: "Two" }] }] };
  const page = await browser.newPage();
  const errors = await open(page, { role: "GM", conn: "conn-gm", players: [], library: lib,
    meta: room({ seq: 1, track: lib.lists[0].tracks[0], at: Date.now() - 9500, paused: null, list: "x", i: 0, label: "Mix", vol: 1 }) });
  await tune(page);
  await page.waitForFunction((k) => { const m = window.__stub.st.meta[k].music; return m && m.seq === 2; }, STATE_KEY, { timeout: 5000 }).catch(() => {});
  const s = await roomState(page);
  ok("crossfade: the next track starts before the last one ends", s.music.seq === 2 && s.music.track.t === "Two" && s.music.xf === 3);
  await sleep(700);
  const both = await media(page, 'audio[data-role="music"]');
  ok(`crossfade: for a moment both play (${both.length})`, both.length === 2 && both.every((a) => !a.paused));
  const out = both.find((a) => a.src.includes("mid-one"));
  const inn = both.find((a) => a.src.includes("mid-two"));
  ok(`crossfade: one falling as the other rises (${out && out.vol.toFixed(2)} / ${inn && inn.vol.toFixed(2)})`, !!out && !!inn && out.vol < 0.9 && inn.vol > 0.05 && inn.vol < 0.9);
  await sleep(3200);
  const after = await media(page, 'audio[data-role="music"]');
  ok("crossfade: then only the new one is left", after.length === 1 && after[0].src.includes("mid-two"));
  ok("crossfade: once, not every check", (await roomState(page)).music.seq === 2);
  ok("crossfade: nothing threw", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();
}

{
  // The GM opens one page to the players; a player presses a pad on it.
  const lib = { ...LIB, playerPads: { on: true, page: "Coast" } };
  const gm = await browser.newPage();
  const gmErrors = await open(gm, { role: "GM", conn: "conn-gm", players: [{ role: "PLAYER", connectionId: "conn-p" }], library: lib, meta: room(null) });
  const offered = (await sent(gm)).filter((m) => m.data.type === "pads").at(-1);
  ok("pads: the GM's bar tells the players which pads they have", !!offered && offered.dest === "REMOTE" && offered.data.pads.map((p) => p.id).join() === "s-gull");

  const ctx = await browser.newContext();
  const pbar = await ctx.newPage();
  const pErrors = await open(pbar, { role: "PLAYER", conn: "conn-p", meta: room(null) });
  const pcon = await ctx.newPage();
  const cErrors = await open(pcon, { file: "index.html", role: "PLAYER", conn: "conn-p" });
  await deliver(pbar, offered.data);
  await pcon.waitForFunction(() => !document.getElementById("c-ppads").hidden, null, { timeout: 5000 }).catch(() => {});
  ok("pads: the player's console shows them", (await pcon.$$eval("#c-ppads .pad", (n) => n.map((x) => x.textContent))).join() === "Gull");
  await pcon.click("#c-ppads .pad:has-text('Gull')");
  await sleep(400);
  const ask = (await sent(pbar)).filter((m) => m.data.type === "padRequest");
  ok("pads: a press asks the GM's bar, and fires nothing itself", ask.length === 1 && ask[0].data.id === "s-gull" && !(await sent(pbar)).some((m) => m.data.type === "sound"));

  const fired = async () => (await sent(gm)).filter((m) => m.data.type === "sound").length;
  const before = await fired();
  await deliver(gm, { type: "padRequest", id: "s-gull" }, "conn-p");
  await sleep(300);
  ok("pads: the GM's bar plays it for everyone", (await fired()) === before + 1 && (await sent(gm)).filter((m) => m.data.type === "sound").at(-1).dest === "ALL");
  await deliver(gm, { type: "padRequest", id: "s-gull" }, "conn-p");
  await sleep(300);
  ok("pads: a second press at once is refused", (await fired()) === before + 1);
  await deliver(gm, { type: "padRequest", id: "s-sting" }, "conn-q");
  await sleep(300);
  ok("pads: a sound on a page not opened is refused", (await fired()) === before + 1);
  await sleep(2400);
  await deliver(gm, { type: "padRequest", id: "s-gull" }, "conn-p");
  await sleep(300);
  ok("pads: after a moment, the player may press again", (await fired()) === before + 2);

  // Switched off: the players' pads go.
  await gm.evaluate(({ k, l }) => { localStorage.setItem(k, JSON.stringify(l)); }, { k: LIBRARY_KEY, l: { ...lib, playerPads: { on: false, page: "Coast" } } });
  await gm.reload();
  await gm.waitForFunction(() => !!window.__stub);
  await sleep(300);
  const closed = (await sent(gm)).filter((m) => m.data.type === "pads").at(-1);
  await deliver(pbar, closed.data);
  await sleep(600);
  ok("pads: switched off, they disappear for players", closed.data.pads.length === 0 && (await pcon.isHidden("#c-ppads")));
  await deliver(gm, { type: "padRequest", id: "s-gull" }, "conn-p");
  await sleep(300);
  ok("pads: and a press is refused", (await sent(gm)).filter((m) => m.data.type === "sound").length === 0);
  await deliver(pbar, { type: "pads", pads: [{ id: "s-sting", name: "Sting" }] }, "conn-x");
  await sleep(300);
  ok("pads: only the GM can open pads to a player", await pcon.isHidden("#c-ppads"));
  ok("pads: nothing threw", gmErrors.length === 0 && pErrors.length === 0 && cErrors.length === 0);
  if (gmErrors.length || pErrors.length || cErrors.length) console.log("     ", gmErrors[0] || pErrors[0] || cErrors[0]);
  await ctx.close();
  await gm.close();
}

await browser.close();
await site.close();
console.log(`ui: ${pass} passed, ${fail} failed`);
console.log(`  Not covered here — check live in a room:
  · that Owlbear lets the bar play sound after one press, and keeps it playing
  · that the popped-out console connects (Owlbear's own headers decide it)
  · that Suno, YouTube and SoundCloud behave the way their stubs here do
  · that Owlbear fires onReadyChange on a GM's scene switch
  · that the D&M extension's record looks the way reactions.js reads it`);
process.exit(fail ? 1 : 0);
