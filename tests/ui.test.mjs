// =============================================================
// ui.test.mjs — the bar and the panel, running for real in Chromium.
// -------------------------------------------------------------
// The SDK is swapped for a stub in a staged copy (bar.js and panel.js import
// "./sdk.js", so replacing that one file is enough). Suno's CDN and YouTube's
// iframe API are answered by request interception: generated WAV files for the
// audio, and a fake YT.Player that records what it was told. Nothing leaves the
// machine, which also means NOTHING HERE PROVES that Suno or YouTube behave the way
// the stubs do — see the live checks in the README.
//
// Served over http, never file://: Chromium will not load an ES module from disk
// and says so only in the console, so a file:// suite passes against a page whose
// code never ran. (Learned the hard way in dnm-cc; see its serve.mjs.)
// =============================================================
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { serve } from "./serve.mjs";
import { STATE_KEY, LIBRARY_KEY, DNM_ROOM_KEY, CHANNEL } from "../radio.js";

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
for (const f of ["index.html", "bar.html", "panel.js", "bar.js", "radio.js", "style.css"]) {
  fs.copyFileSync(path.join(repo, f), path.join(stage, f));
}
fs.writeFileSync(path.join(stage, "sdk.js"), `
// Stub SDK: only what bar.js and panel.js touch.
const want = window.__want || {};
const subs = { player: [], party: [], meta: [], msg: {} };
const clone = (x) => JSON.parse(JSON.stringify(x));
const st = {
  role: want.role || "GM",
  conn: want.conn || "conn-self",
  players: want.players || [],
  meta: want.meta || {},
  sent: [],
  popover: [],
};
const on = (list) => (cb) => { list.push(cb); return () => {}; };
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
  broadcast: {
    onMessage: (ch, cb) => { (subs.msg[ch] = subs.msg[ch] || []).push(cb); return () => {}; },
    sendMessage: async (ch, data, opts) => {
      st.sent.push({ ch, data: clone(data), dest: opts && opts.destination });
      if (opts && (opts.destination === "ALL" || opts.destination === "LOCAL")) {
        (subs.msg[ch] || []).forEach((cb) => cb({ data: clone(data), connectionId: st.conn }));
      }
    },
  },
  popover: {
    open: async (o) => { st.popover.push(["open", o]); },
    close: async (id) => { st.popover.push(["close", id]); },
    setHeight: async (id, h) => { st.popover.push(["height", h]); },
    setWidth: async () => {},
  },
  viewport: { getWidth: async () => 1600, getHeight: async () => 900 },
};
window.__stub = {
  st,
  patchMeta(m) { Object.assign(st.meta, clone(m)); pushMeta(); },
  deliver(ch, data, connectionId) { (subs.msg[ch] || []).forEach((cb) => cb({ data, connectionId })); },
};
export default OBR;
`);

// -------------------------------------------------------------
// Fake media and a fake YouTube
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
const U_LONG = "0f6d3c1e-2b8a-4e5f-9a7b-1c2d3e4f5a6b";
const U_SHORT = "11111111-2222-4333-8444-555555555555";
const SUNO = (u) => `https://cdn1.suno.ai/${u}.mp3`;

const YT_STUB = `
window.YT = {
  PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  Player: class {
    constructor(id, opts) {
      this.opts = opts; this.calls = []; this.state = -1; this.t = 0; this.idx = 0; this.list = null;
      window.__yt = this;
      setTimeout(() => opts.events.onReady({ target: this }), 10);
    }
    fire(s) { this.state = s; setTimeout(() => this.opts.events.onStateChange({ data: s, target: this }), 5); }
    loadVideoById(o) { this.calls.push(["loadVideoById", o]); this.list = null; this.t = o.startSeconds || 0; this.fire(1); }
    loadPlaylist(o) { this.calls.push(["loadPlaylist", o]); this.list = o; this.idx = o.index || 0; this.t = o.startSeconds || 0; this.fire(1); }
    playVideoAt(i) { this.calls.push(["playVideoAt", i]); this.idx = i; this.t = 0; this.fire(1); }
    playVideo() { this.calls.push(["playVideo"]); this.fire(1); }
    pauseVideo() { this.calls.push(["pauseVideo"]); this.fire(2); }
    stopVideo() { this.calls.push(["stopVideo"]); this.state = 5; }
    seekTo(t) { this.calls.push(["seekTo", t]); this.t = t; }
    getCurrentTime() { return this.t; }
    getPlayerState() { return this.state; }
    setVolume(v) { this.vol = v; }
    getPlaylistIndex() { return this.list ? this.idx : -1; }
    getPlaylist() { return this.list ? ["a", "b", "c"] : null; }
    getVideoData() { return { title: "Stub video " + this.idx }; }
  },
};
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);
`;

const site = await serve(stage);

async function open(page, { file = "bar.html", role = "PLAYER", conn = "conn-self", players, meta = {}, library = null } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Short, so a page whose script died fails in seconds instead of hanging on
  // Playwright's thirty-second wait for a button that will never work.
  page.setDefaultTimeout(5000);
  await page.route("https://cdn1.suno.ai/**", (route) => {
    const url = route.request().url();
    const body = url.includes(U_SHORT) ? SHORT : url.includes(U_LONG) ? LONG : wav(3, 880);
    // Byte ranges, as a real CDN serves them. Without them Chromium cannot seek past
    // what it has buffered, and a far seek quietly lands back at the start.
    const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || "");
    if (!range) {
      route.fulfill({ status: 200, contentType: "audio/wav", body, headers: { "Accept-Ranges": "bytes" } });
      return;
    }
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    route.fulfill({
      status: 206, contentType: "audio/wav", body: body.subarray(start, end + 1),
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` },
    });
  });
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: YT_STUB }));
  await page.addInitScript(({ want, lib, key }) => {
    window.__want = want;
    if (lib) localStorage.setItem(key, JSON.stringify(lib));
  }, {
    want: { role, conn, meta, players: players || [{ role: "GM", connectionId: "conn-gm" }, { role: "PLAYER", connectionId: "conn-x" }] },
    lib: library, key: LIBRARY_KEY,
  });
  await page.goto(site.origin + "/" + file);
  await page.waitForFunction(() => !!window.__stub);
  await sleep(150);
  return errors;
}

const audioState = (page, id = "music") => page.evaluate((i) => {
  const a = document.getElementById(i);
  return { src: a.getAttribute("src") || "", paused: a.paused, t: a.currentTime, vol: a.volume };
}, id);
const roomState = (page) => page.evaluate((k) => window.__stub.st.meta[k], STATE_KEY);
const sent = (page) => page.evaluate(() => window.__stub.st.sent);

// -------------------------------------------------------------
// 1. A player joining a track already five seconds in
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const running = { v: 1, seq: 1, track: { k: "a", u: SUNO(U_LONG), t: "Liquid Banjo" }, at: Date.now() - 5000, paused: null, label: "Explore" };
  const errors = await open(page, { meta: { [STATE_KEY]: running } });
  ok("player: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  ok("player: the title shows before tuning in", (await page.textContent("#title")) === "Liquid Banjo");
  ok("player: no sound before the press", (await audioState(page)).src === "");
  ok("player: the Tune in button is offered", await page.isVisible("#tune"));
  ok("player: no GM controls", !(await page.isVisible("#next")));
  ok("player: it said hello to get the time", (await sent(page)).some((m) => m.data.type === "hello"));

  await page.click("#tune");
  await page.waitForFunction(() => { const a = document.getElementById("music"); return !a.paused && a.currentTime > 4; }, null, { timeout: 5000 }).catch(() => {});
  let a = await audioState(page);
  ok("player: tuning in plays the Suno file", a.src === SUNO(U_LONG) && !a.paused);
  ok(`player: from where the room is (${a.t.toFixed(1)}s)`, a.t > 4 && a.t < 8);
  ok("player: the button goes away", !(await page.isVisible("#tune")));

  // The GM's clock is a minute ahead of ours.
  await page.evaluate(({ ch }) => window.__stub.deliver(ch, { type: "tick", now: Date.now() + 60000 }, "conn-gm"), { ch: CHANNEL });
  await sleep(600);
  a = await audioState(page);
  ok(`player: a GM tick corrects for the clock (${a.t.toFixed(1)}s)`, a.t > 63 && a.t < 69);

  // A player cannot set everyone's clock.
  await page.evaluate(({ ch }) => window.__stub.deliver(ch, { type: "tick", now: Date.now() - 600000 }, "conn-x"), { ch: CHANNEL });
  await sleep(600);
  a = await audioState(page);
  ok("player: a tick from a player is ignored", a.t > 63);

  // Stingers
  await page.evaluate(({ ch, u }) => window.__stub.deliver(ch, { type: "cue", track: { k: "a", u, t: "x" }, secs: 3 }, "conn-x"), { ch: CHANNEL, u: SUNO("22222222-2222-4222-8222-222222222222") });
  await sleep(300);
  ok("player: a cue from a player is ignored", (await audioState(page, "fx")).src === "");
  await page.evaluate(({ ch }) => window.__stub.deliver(ch, { type: "cue", track: { k: "a", u: "javascript:alert(1)" }, secs: 3 }, "conn-gm"), { ch: CHANNEL });
  await sleep(300);
  ok("player: a hostile cue is ignored", (await audioState(page, "fx")).src === "");
  await page.evaluate(({ ch, u }) => window.__stub.deliver(ch, { type: "cue", track: { k: "a", u, t: "x" }, secs: 3 }, "conn-gm"), { ch: CHANNEL, u: SUNO("33333333-3333-4333-8333-333333333333") });
  await sleep(400);
  const fx = await audioState(page, "fx");
  a = await audioState(page);
  ok("player: the GM's cue plays", fx.src.includes("33333333") && !fx.paused);
  ok(`player: and the music ducks under it (${a.vol.toFixed(2)})`, a.vol < 0.3);
  await sleep(3200);
  a = await audioState(page);
  ok(`player: the music comes back after (${a.vol.toFixed(2)})`, a.vol > 0.5);

  // Pause from the room
  await page.evaluate(({ k }) => window.__stub.patchMeta({ [k]: { ...window.__stub.st.meta[k], paused: 70 } }), { k: STATE_KEY });
  await sleep(300);
  ok("player: the room pausing pauses the music", (await audioState(page)).paused);

  // A hostile state
  await page.evaluate(({ k }) => window.__stub.patchMeta({ [k]: { seq: 9, track: { k: "a", u: "javascript:alert(1)" }, at: 0 } }), { k: STATE_KEY });
  await sleep(300);
  ok("player: a hostile track is not loaded", (await audioState(page)).src === "");
  ok("player: and reads as nothing playing", (await page.textContent("#title")) === "Nothing playing");
  await page.close();
}

// -------------------------------------------------------------
// 2. The GM's bar conducts
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const library = {
    lists: [
      { id: "ex", name: "Explore", tracks: [
        { k: "a", u: SUNO(U_SHORT), t: "Short" },
        { k: "a", u: SUNO(U_LONG), t: "Long" },
      ] },
      { id: "cb", name: "Combat", tracks: [{ k: "yt", v: "_YsP_UGd8Ns", t: "Fight!" }] },
    ],
    combatList: "cb",
    cues: { threatUp: { k: "a", u: SUNO("44444444-4444-4444-8444-444444444444"), t: "sting" } },
    cueSeconds: 3,
  };
  const dnm = { threat: 0, momentum: 2, initiative: null, epochs: { breather: 0, break: 0, bed: 0, scene: 0, session: 0, adventure: 0 } };
  const errors = await open(page, {
    role: "GM", conn: "conn-gm", players: [{ role: "PLAYER", connectionId: "conn-x" }], library,
    meta: {
      [STATE_KEY]: { v: 1, seq: 1, track: library.lists[0].tracks[0], at: Date.now(), paused: null, list: "ex", i: 0, label: "Explore" },
      [DNM_ROOM_KEY]: dnm,
    },
  });
  ok("GM: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  ok("GM: the transport is shown", await page.isVisible("#next"));
  await page.click("#tune");
  await page.waitForFunction((k) => window.__stub.st.meta[k].seq === 2, STATE_KEY, { timeout: 6000 }).catch(() => {});
  let s = await roomState(page);
  ok(`GM: when a track ends the next one starts (seq ${s.seq}, i ${s.i})`, s.seq === 2 && s.i === 1 && s.track.t === "Long");
  ok("GM: and the players are told the time", (await sent(page)).some((m) => m.data.type === "tick" && m.dest === "REMOTE"));
  ok("GM: the pasted link never reaches the room", !("s" in s.track));
  await sleep(1500);

  // Threat goes up at the D&M table
  await page.evaluate(({ k, d }) => window.__stub.patchMeta({ [k]: { ...d, threat: 3 } }), { k: DNM_ROOM_KEY, d: dnm });
  await sleep(400);
  const cue = (await sent(page)).find((m) => m.data.type === "cue");
  ok("GM: Threat going up sends its sound to everyone", !!cue && cue.dest === "ALL" && cue.data.track.u.includes("44444444"));
  ok("GM: and the GM hears it too", (await audioState(page, "fx")).src.includes("44444444"));

  // Initiative starts
  const beforeFight = await audioState(page);
  await page.evaluate(({ k, d }) => window.__stub.patchMeta({ [k]: { ...d, threat: 3, initiative: { round: 1, rows: [] } } }), { k: DNM_ROOM_KEY, d: dnm });
  await page.waitForFunction(() => window.__yt && window.__yt.calls.length > 0, null, { timeout: 4000 }).catch(() => {});
  s = await roomState(page);
  ok("GM: initiative switches to the combat playlist", s.list === "cb" && s.track.k === "yt");
  const yt = await page.evaluate(() => window.__yt && window.__yt.calls);
  ok("GM: the YouTube player is told to play that video", !!yt && yt.some((c) => c[0] === "loadVideoById" && c[1].videoId === "_YsP_UGd8Ns"));
  ok("GM: the bar grows to show the video", (await page.evaluate(() => document.body.classList.contains("video")))
    && (await page.evaluate(() => window.__stub.st.popover)).some((p) => p[0] === "height" && p[1] > 250));
  ok("GM: the music under it stops", (await audioState(page)).paused);
  await sleep(300);
  s = await roomState(page);
  ok("GM: the video's title is shared once it is known", s.nt === "Stub video 0");

  // The fight's video ends: a one-track list loops rather than falling silent.
  const seqBefore = s.seq;
  await page.evaluate(() => window.__yt.fire(0));
  await sleep(400);
  s = await roomState(page);
  ok("GM: a one-track combat list loops", s.seq === seqBefore + 1 && s.list === "cb");

  // Initiative ends: back to the music it interrupted, where it left off.
  await page.evaluate(({ k, d }) => window.__stub.patchMeta({ [k]: { ...d, threat: 3, initiative: null } }), { k: DNM_ROOM_KEY, d: dnm });
  await sleep(700);
  s = await roomState(page);
  ok("GM: initiative ending brings the music back", s.list === "ex" && s.track.t === "Long");
  const back = (Date.now() - s.at) / 1000;
  ok(`GM: from where it left off (${back.toFixed(1)}s, was ${beforeFight.t.toFixed(1)}s)`, Math.abs(back - beforeFight.t) < 3);
  await page.waitForFunction(() => !document.getElementById("music").paused, null, { timeout: 3000 }).catch(() => {});
  ok("GM: and it is playing again", !(await audioState(page)).paused);
  ok("GM: the video is put away", !(await page.evaluate(() => document.body.classList.contains("video"))));

  // Pause and Next
  await page.click("#toggle");
  await sleep(300);
  s = await roomState(page);
  ok("GM: pause writes a paused position", s.paused !== null);
  await page.click("#next");
  await sleep(300);
  const s2 = await roomState(page);
  ok("GM: next moves on", s2.seq === s.seq + 1 && s2.i === 0);
  ok("GM: nothing threw along the way", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  await page.close();
}

// -------------------------------------------------------------
// 3. A YouTube playlist, for a player
// -------------------------------------------------------------
{
  const page = await browser.newPage();
  const errors = await open(page, { meta: { [STATE_KEY]: { v: 1, seq: 3, track: { k: "ytl", l: "PLRy5AGzKZLmE", t: "GS" }, sub: 1, at: Date.now() - 10000, paused: null } } });
  await page.click("#tune");
  await page.waitForFunction(() => window.__yt && window.__yt.calls.length > 0, null, { timeout: 4000 }).catch(() => {});
  const calls = await page.evaluate(() => window.__yt && window.__yt.calls);
  const load = calls && calls.find((c) => c[0] === "loadPlaylist");
  ok("player: a YouTube playlist is loaded at the GM's video", !!load && load[1].list === "PLRy5AGzKZLmE" && load[1].index === 1);
  ok(`player: at the GM's position (${load && load[1].startSeconds.toFixed(1)})`, !!load && load[1].startSeconds > 9 && load[1].startSeconds < 12);
  // The player's YouTube runs on to the next video by itself; it is pulled back.
  await page.evaluate(() => { window.__yt.idx = 2; window.__yt.fire(1); });
  await sleep(200);
  const back = await page.evaluate(() => window.__yt.calls.filter((c) => c[0] === "playVideoAt").map((c) => c[1]));
  ok("player: a playlist that ran ahead is pulled back to the GM's video", back.includes(1));
  ok("player: nothing throws", errors.length === 0);
  await page.close();
}
{
  // The GM's own playlist moves on by itself. The GM tells the room, and must not
  // then restart the video it is already playing.
  const page = await browser.newPage();
  const errors = await open(page, { role: "GM", conn: "conn-gm", players: [],
    meta: { [STATE_KEY]: { v: 1, seq: 3, track: { k: "ytl", l: "PLRy5AGzKZLmE", t: "GS" }, sub: 0, at: Date.now(), paused: null } } });
  await page.click("#tune");
  await page.waitForFunction(() => window.__yt && window.__yt.calls.length > 0, null, { timeout: 4000 }).catch(() => {});
  await sleep(200);
  await page.evaluate(() => { window.__yt.idx = 1; window.__yt.t = 0.5; window.__yt.fire(1); });
  await sleep(400);
  const s = await roomState(page);
  ok("GM: a YouTube playlist moving on is written to the room", s.sub === 1 && s.seq === 3);
  const jumps = await page.evaluate(() => window.__yt.calls.filter((c) => c[0] === "playVideoAt").length);
  ok("GM: and the video it moved to is not restarted", jumps === 0);
  ok("GM: nothing throws", errors.length === 0);
  await page.close();
}

// -------------------------------------------------------------
// 4. The panel
// -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 380, height: 900 } });
  const errors = await open(page, { file: "index.html", role: "GM", conn: "conn-gm", players: [] });
  ok("panel GM: nothing throws", errors.length === 0);
  if (errors.length) console.log("     ", errors[0]);
  ok("panel GM: the GM section shows", await page.isVisible("#gm"));
  await page.fill("#list-name", "Tavern");
  await page.click("#list-new");
  await page.fill("#list-text", [
    "https://youtube.com/playlist?list=PLRy5AGzKZLmE&si=fF0O_ly7XYF6A4zu",
    `Liquid Banjo | https://suno.com/song/${U_LONG}`,
    "https://suno.com/s/cq8ogDYThAoJj3fo",
  ].join("\n"));
  await page.click("#list-save");
  const errs = await page.$$eval("#list-errors .error", (n) => n.map((x) => x.textContent));
  ok("panel GM: the Suno short link is reported on its line", errs.length === 1 && /^Line 3/.test(errs[0]));
  ok("panel GM: the bad line stays in the box to be fixed", (await page.inputValue("#list-text")).includes("suno.com/s/"));
  const lib = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LIBRARY_KEY);
  ok("panel GM: the good lines are saved, sources mixed", lib.lists[0].tracks.map((t) => t.k).join() === "ytl,a");
  await page.click("#list-play");
  await sleep(300);
  const s = await roomState(page);
  ok("panel GM: Play writes the first track to the room", s && s.track.k === "ytl" && s.label === "Tavern");
  ok("panel GM: the now-playing line follows", (await page.textContent("#now-title")).includes("YouTube playlist"));

  await page.fill("#cue-threatUp", "https://youtu.be/_YsP_UGd8Ns");
  await page.fill("#cue-bed", `https://suno.com/song/${U_LONG}`);
  await page.selectOption("#combat-list", lib.lists[0].id);
  await page.click("#cues-save");
  const lib2 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LIBRARY_KEY);
  ok("panel GM: a YouTube sound is refused", !lib2.cues.threatUp && /threatUp/.test(await page.textContent("#cues-msg")));
  ok("panel GM: a Suno sound is kept", lib2.cues.bed && lib2.cues.bed.u === SUNO(U_LONG));
  ok("panel GM: the combat playlist is kept", lib2.combatList === lib.lists[0].id);

  await page.click("#open-bar");
  const pop = (await page.evaluate(() => window.__stub.st.popover)).find((p) => p[0] === "open");
  ok("panel: Open the radio docks the bar", !!pop && pop[1].url.endsWith("/bar.html") && pop[1].disableClickAway === true);

  await page.click("#list-delete");
  ok("panel GM: delete asks for a second press", (await page.textContent("#list-delete")) === "Sure?");
  await page.click("#list-delete");
  const lib3 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LIBRARY_KEY);
  ok("panel GM: and then deletes", lib3.lists.length === 0);
  await page.close();
}
{
  const page = await browser.newPage();
  const errors = await open(page, { file: "index.html", role: "PLAYER", players: [{ role: "PLAYER", connectionId: "conn-x" }] });
  ok("panel player: nothing throws", errors.length === 0);
  ok("panel player: no GM section", !(await page.isVisible("#gm")));
  ok("panel player: warned when there is no GM", await page.isVisible("#no-gm"));
  await page.close();
}

await browser.close();
await site.close();
console.log(`ui: ${pass} passed, ${fail} failed`);
console.log(`  Not covered here — check live in a room:
  · that Owlbear lets the bar play sound after one press, and keeps it playing
  · that Suno serves cdn1.suno.ai/<id>.mp3 to a page on another site
  · that YouTube's real player starts from our press, or needs its own
  · that the D&M extension's room record looks the way diffDnm() reads it`);
process.exit(fail ? 1 : 0);
