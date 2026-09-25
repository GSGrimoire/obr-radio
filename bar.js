// =============================================================
// bar.js — the docked radio bar. Every client runs one; the GM's conducts.
// -------------------------------------------------------------
// WHY A DOCKED POPOVER: sound has to keep playing while people use the map. The
// toolbar panel is Owlbear's to close, and a closed panel is a silent one, so the
// sound lives here — a popover pinned to a corner with disableClickAway, the same
// arrangement the D&M sheet uses to stay beside the map.
//
// WHY "TUNE IN": a browser will not start sound in a page nobody has clicked. One
// press per bar, shown as a button rather than left as a silence nobody can explain.
//
// NOBODY STREAMS TO ANYBODY. Every client plays its own copy of each source and
// seeks to where the room says it should be. The room holds one small record (see
// state.js): the music, up to four ambience layers, when each started in the GM's
// clock.
//
// THE GM'S BAR CONDUCTS, and is the only page that does:
//   · it holds the GM's library, in this frame's storage
//   · it executes the console's commands and writes the room
//   · it moves the music on when a track ends
//   · it fires soundboard presses and scattered sounds as broadcasts
//   · it tells the players the time, so their clocks do not matter
//   · it reacts to Dreams & Machines and to Owlbear scene changes
// =============================================================
import OBR from "./sdk.js";
import {
  STATE_KEY, CHANNEL, BAR_ID, SCENE_KEY, LIBRARY_KEY, PREFS_KEY, RESUME_KEY, DNM_ROOM_KEY,
  CORNERS, RADIO_VERSION, readPrefs, barPopover, barSize,
} from "./radio.js";
import { readTrack, trackKey, isEmbed } from "./sources.js";
import { readLibrary, findSound, findScene, newId } from "./library.js";
import * as S from "./state.js";
import { diffDnm, planReaction, dnmPresent } from "./reactions.js";
import { NS, readCommand, isHello, channelName, GM_ONLY } from "./link.js";
import { createPlayer, playShot, stopShots } from "./players.js";

const el = (id) => document.getElementById(id);
const tuneBtn = el("tune");
const statusEl = el("status");

let role = "PLAYER";
let gmConnections = new Set();
let tuned = false;
let state = S.emptyState();
let clockOffset = 0;        // the GM's clock minus ours; 0 on the GM's own bar
let dnmBaseline;            // undefined until the first reading, which is not news
let dnmSeen = false;
let obrSceneReady = false;
let obrSceneBinding = "";
let lastError = "";
let duck = 1;               // music and ambience level while a sound plays
let embedsShown = -1;
let lastReanchor = 0;
let errorsInARow = 0;

// -------------------------------------------------------------
// Storage. Can be blocked in a third-party frame; everything works without it,
// it just forgets.
// -------------------------------------------------------------
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (err) { return null; }
}
function saveJSON(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}
let prefs = readPrefs(loadJSON(PREFS_KEY));
let lib = readLibrary(loadJSON(LIBRARY_KEY));

const isGM = () => role === "GM";
const gmNow = () => Date.now() + (isGM() ? 0 : clockOffset);
function setStatus(msg) { statusEl.textContent = msg || ""; statusEl.title = msg || ""; }

// -------------------------------------------------------------
// Writing the room (GM only)
// -------------------------------------------------------------
async function freshState() {
  try { return S.readState(await OBR.room.getMetadata(), STATE_KEY); } catch (err) { return state; }
}

// Takes what a state.js operation returned. A refusal is shown, never written.
async function commit(result) {
  if (!isGM() || !result) return result;
  if (result.error) {
    lastError = result.error;
    setStatus(result.error);
    push();
    return result;
  }
  lastError = "";
  try {
    await OBR.room.setMetadata({ [STATE_KEY]: result.state });
    sendTick();
  } catch (err) {
    console.error("[radio] could not write the room", err);
    lastError = "Could not reach the room.";
    setStatus(lastError);
    push();
  }
  return result;
}

// -------------------------------------------------------------
// Playing: bringing this client into line with the room
// -------------------------------------------------------------
// A channel is one thing playing here: the music, or one ambience layer. It fades
// in when it starts and out when it stops, rather than cutting.
let music = null;               // { key, seq, player, fade, target }
const layers = new Map();       // layer id -> { key, player, fade, target, layer }
const dying = new Set();        // channels fading out on their way to disposal
let fadeTimer = 0;

const fadeStep = () => 0.05 / Math.max(0.05, lib.fadeSeconds || 1.5);

function startFades() {
  if (fadeTimer) return;
  fadeTimer = setInterval(() => {
    let moving = false;
    const step = fadeStep();
    for (const ch of [music, ...layers.values(), ...dying]) {
      if (!ch) continue;
      if (ch.fade !== ch.target) {
        ch.fade = ch.fade < ch.target ? Math.min(ch.target, ch.fade + step) : Math.max(ch.target, ch.fade - step);
        moving = true;
      }
    }
    let gone = false;
    for (const ch of [...dying]) {
      if (ch.fade <= 0) { ch.player.dispose(); dying.delete(ch); gone = true; }
    }
    // A video that finished fading has given its tile back; the bar shrinks now,
    // not at the next change in the room.
    if (gone) resizeForEmbeds();
    applyVolumes();
    if (!moving && !dying.size) { clearInterval(fadeTimer); fadeTimer = 0; }
  }, 50);
}

function channel(player, extra) {
  const ch = { player, fade: lib.fadeSeconds > 0 ? 0 : 1, target: 1, ...extra };
  startFades();
  return ch;
}

function retire(ch) {
  if (!ch) return;
  ch.target = 0;
  // A video that fades out still holds its tile until it is gone; a fade of zero
  // seconds removes it at once.
  if (lib.fadeSeconds <= 0) { ch.player.dispose(); return; }
  dying.add(ch);
  startFades();
}

function applyVolumes() {
  const mute = prefs.mute ? 0 : 1;
  if (music) music.player.setVolume((state.music ? state.music.vol : 1) * prefs.music * duck * music.fade * mute);
  for (const ch of layers.values()) ch.player.setVolume(ch.layer.vol * prefs.amb * duck * ch.fade * mute);
  for (const ch of dying) {
    const base = ch.layer ? ch.layer.vol * prefs.amb : prefs.music;
    ch.player.setVolume(base * duck * ch.fade * mute);
  }
}

// A play() that fails is only an autoplay block when the browser says so. A track
// that will not load also rejects play() — and treating that as "not tuned in"
// silenced the listener and threw the player away before its fallback could run.
function blocked(err) {
  if (err && err.name === "NotAllowedError") untuned();
}

function untuned() {
  tuned = false;
  render();
  setStatus("Press Tune in to hear the radio.");
}

// Players are pulled to the room. The GM's own music is not pulled anywhere: it IS
// the room, so when it drifts — buffering, a slow start — it moves the room to
// itself, and the players follow on their next check.
function correctMusic(player, expected) {
  if (!player.ready() || !player.playing()) return;
  const actual = player.time();
  if (!S.needsSeek(actual, expected)) return;
  if (isGM()) {
    if (Date.now() - lastReanchor < 5000) return;
    lastReanchor = Date.now();
    commit(S.musicReanchor(state, Date.now() - actual * 1000));
  } else {
    player.seek(expected);
  }
}

function syncMusic() {
  const m = state.music;
  const key = m ? trackKey(m.track, m.sub) + "#" + m.seq : "";
  if (music && music.key !== key) {
    // A YouTube playlist moving to its next video is the same player, not a new one.
    const same = m && music.seq === m.seq && m.track.k === "ytl" && music.player.track.l === m.track.l;
    if (same) {
      music.key = key;
      music.player.jumpTo(m.sub);
    } else {
      retire(music);
      music = null;
    }
  }
  if (!m) return;
  const expected = S.musicPosition(m, gmNow());
  if (!music) {
    const seq = m.seq;
    const player = createPlayer(m.track, {
      role: "music",
      onEnded: () => musicEnded(seq),
      onError: (why) => musicFailed(seq, why),
      onPlaying: () => { errorsInARow = 0; setStatus(lastError); },
      onSettle: () => sync(),
      onSub: (idx, t) => {
        if (!state.music || state.music.seq !== seq) return;
        if (idx < 0 || idx === state.music.sub) return;
        // The playlist moved on by itself. The GM's player is the truth; a player's
        // that moved on alone is pulled back to where the GM is.
        if (isGM()) commit(S.musicSub(state, idx, Date.now() - t * 1000));
        else music && music.player.jumpTo(state.music.sub);
      },
      onTitle: (title) => {
        if (isGM() && state.music && state.music.seq === seq && title !== state.music.nt) commit(S.musicTitle(state, title));
      },
    });
    music = channel(player, { key, seq });
    applyVolumes();
    Promise.resolve(player.load(expected, m.sub)).then(() => {
      if (m.paused !== null) player.pause();
      else player.play().catch(blocked);
    }).catch(() => {});
    return;
  }
  const p = music.player;
  if (m.paused !== null) { if (p.playing()) p.pause(); return; }
  if (!p.playing() && p.ready()) {
    Promise.resolve(p.play()).catch(blocked);
    if (p.stalled && p.stalled() && music.started && Date.now() - music.started > 4000) {
      setStatus("Press play on the video once.");
    }
    music.started = music.started || Date.now();
  }
  correctMusic(p, expected);
}

function syncLayers() {
  const wanted = new Map(state.amb.filter((l) => l.mode === "loop").map((l) => [l.id, l]));
  for (const [id, ch] of layers) {
    const l = wanted.get(id);
    if (!l || trackKey(l.track) !== ch.key) { retire(ch); layers.delete(id); }
    else ch.layer = l;
  }
  for (const [id, l] of wanted) {
    let ch = layers.get(id);
    if (!ch) {
      const player = createPlayer(l.track, {
        role: "layer", layer: id, loop: true,
        onSettle: () => sync(),
        onError: (why) => setStatus(`${l.label}: ${why}`),
      });
      ch = channel(player, { key: trackKey(l.track), layer: l });
      layers.set(id, ch);
      applyVolumes();
      const start = S.layerPosition(l, gmNow(), NaN);
      Promise.resolve(player.load(start)).then(() => player.play().catch(blocked)).catch(() => {});
      continue;
    }
    const p = ch.player;
    if (!p.ready()) continue;
    if (!p.playing()) { Promise.resolve(p.play()).catch(blocked); continue; }
    // Everyone, the GM included, is pulled to the layer's clock: a loop has no
    // "truth" worth protecting, only a place everyone should be.
    const dur = p.duration();
    const expected = S.layerPosition(l, gmNow(), dur);
    if (S.needsSeek(p.time(), expected, dur)) p.seek(expected);
  }
}

function resizeForEmbeds() {
  let n = 0;
  if (music && music.player.embed) n += 1;
  for (const ch of layers.values()) if (ch.player.embed) n += 1;
  for (const ch of dying) if (ch.player.embed) n += 1;
  if (n === embedsShown) return;
  embedsShown = n;
  document.body.classList.toggle("video", n > 0);
  const { width, height } = barSize(n);
  OBR.popover.setWidth(BAR_ID, width).catch(() => {});
  OBR.popover.setHeight(BAR_ID, height).catch(() => {});
}

function sync() {
  render();
  if (tuned) {
    syncMusic();
    syncLayers();
  } else {
    if (music) { retire(music); music = null; }
    for (const ch of layers.values()) retire(ch);
    layers.clear();
  }
  resizeForEmbeds();
  applyVolumes();
}

function stopEverything() {
  if (music) { music.player.dispose(); music = null; }
  for (const ch of layers.values()) ch.player.dispose();
  layers.clear();
  for (const ch of dying) ch.player.dispose();
  dying.clear();
  stopShots();
}

// -------------------------------------------------------------
// The conductor: music moving on
// -------------------------------------------------------------
async function musicEnded(seq) {
  if (!isGM()) return;
  const now = await freshState();
  if (!now.music || now.music.seq !== seq) return;
  const next = S.musicAdvance(now, lib, Date.now());
  // A track from a playlist that is gone: stop rather than go round on it.
  await commit(next.error ? S.musicPause(now, Date.now()) : next);
}

// A track that would not play is skipped — but not forever: a playlist where
// nothing plays (a Suno change, a network block) must stop, not spin.
function musicFailed(seq, why) {
  setStatus(why);
  if (!isGM()) return;
  errorsInARow += 1;
  const list = lib.lists.find((l) => state.music && l.id === state.music.list);
  if (errorsInARow > Math.max(1, list ? list.tracks.length : 1)) {
    lastError = "Nothing in this playlist will play. Stopped.";
    setStatus(lastError);
    commit(S.musicStop(state));
    return;
  }
  setTimeout(() => musicEnded(seq), 1500);
}

// -------------------------------------------------------------
// One-shots: soundboard presses and scattered sounds
// -------------------------------------------------------------
let ducks = 0;
function duckFor(shotStarted) {
  if (!shotStarted) return;
  ducks += 1;
  duck = 0.35;
  applyVolumes();
}
function unduck() {
  ducks = Math.max(0, ducks - 1);
  if (!ducks) { duck = 1; applyVolumes(); }
}

function playSound(track, vol, { ducking = true, maxSeconds = 0 } = {}) {
  if (!tuned || prefs.mute) return;
  let started = false;
  playShot(track.u, vol, {
    maxSeconds,
    onStart: () => { if (ducking) { started = true; duckFor(true); } },
    onEnd: () => { if (started) unduck(); },
  });
}

const lastFired = new Map();

async function fireSound(soundId) {
  const sound = findSound(lib, soundId);
  if (!sound) return { error: "That sound is gone." };
  if (sound.track.k !== "a") return { error: "Only audio files and Suno songs can be pressed. Videos can be ambience layers." };
  // A double-click is one press.
  if (Date.now() - (lastFired.get(soundId) || 0) < 400) return { ok: true };
  lastFired.set(soundId, Date.now());
  await OBR.broadcast.sendMessage(CHANNEL, {
    type: "sound", track: readTrack(sound.track), vol: sound.vol,
  }, { destination: "ALL" }).catch(() => {});
  return { ok: true };
}

// Scattered layers are fired by the GM's bar, one broadcast per shot, so every
// player hears the gull at the same moment rather than each rolling their own.
const scatterTimers = new Map();
function syncScatter() {
  const wanted = new Map(isGM() ? state.amb.filter((l) => l.mode === "scatter").map((l) => [l.id, l]) : []);
  for (const [id, t] of scatterTimers) {
    if (!wanted.has(id)) { clearTimeout(t); scatterTimers.delete(id); }
  }
  for (const [id, l] of wanted) {
    if (scatterTimers.has(id)) continue;
    const schedule = () => {
      const cur = state.amb.find((x) => x.id === id);
      if (!cur || !isGM()) { scatterTimers.delete(id); return; }
      const wait = (cur.min + Math.random() * (cur.max - cur.min)) * 1000;
      scatterTimers.set(id, setTimeout(() => {
        const now = state.amb.find((x) => x.id === id);
        if (now) {
          OBR.broadcast.sendMessage(CHANNEL, { type: "shot", layer: id, track: readTrack(now.track), vol: now.vol },
            { destination: "ALL" }).catch(() => {});
        }
        schedule();
      }, wait));
    };
    schedule();
  }
}

// -------------------------------------------------------------
// Scenes, and initiative's snapshot
// -------------------------------------------------------------
async function recallScene(id) {
  const now = await freshState();
  return commit(S.sceneApply(now, lib, id, Date.now()));
}

async function react(record) {
  const cues = diffDnm(dnmBaseline, record);
  dnmBaseline = record === undefined ? null : record;
  if (!cues.length || !isGM()) return;
  const plan = planReaction(cues, lib);
  if (plan.sound) fireSound(plan.sound);
  if (plan.scene) {
    const now = await freshState();
    // Initiative's scene remembers what it interrupted, so its end can bring it back.
    if (cues.includes("combatStart")) saveJSON(RESUME_KEY, S.snapshot(now, Date.now()));
    await commit(S.sceneApply(now, lib, plan.scene, Date.now()));
  } else if (plan.restore) {
    const snap = loadJSON(RESUME_KEY);
    saveJSON(RESUME_KEY, null);
    if (snap) await commit(S.restore(await freshState(), snap, Date.now()));
  }
}

// Owlbear scenes. The GM binds a radio scene to an Owlbear scene; the binding is
// kept in that Owlbear scene's own metadata, so it travels with the scene. When
// the GM's scene becomes ready, the bound radio scene is recalled.
async function readObrScene() {
  try {
    obrSceneReady = await OBR.scene.isReady();
    if (!obrSceneReady) { obrSceneBinding = ""; return; }
    const meta = await OBR.scene.getMetadata();
    const b = meta && meta[SCENE_KEY];
    obrSceneBinding = b && typeof b.scene === "string" ? b.scene.slice(0, 40) : "";
  } catch (err) {
    obrSceneReady = false;
    obrSceneBinding = "";
  }
}

async function onObrSceneReady(ready) {
  await readObrScene();
  push();
  if (!ready || !isGM() || !lib.autoScenes || !obrSceneBinding) return;
  if (!findScene(lib, obrSceneBinding)) return;
  await recallScene(obrSceneBinding);
}

async function bindObrScene(id) {
  if (!(await OBR.scene.isReady())) return { error: "Open a scene in Owlbear first." };
  const value = id && findScene(lib, id) ? { scene: id } : undefined;
  await OBR.scene.setMetadata({ [SCENE_KEY]: value });
  await readObrScene();
  return { ok: true };
}

// -------------------------------------------------------------
// The console link
// -------------------------------------------------------------
let channelBC = null;
let popup = null;
let popupHeard = false;

function snapshotForConsole() {
  return {
    ns: NS, t: "state",
    version: RADIO_VERSION,
    role, tuned, state, prefs,
    lib: isGM() ? lib : null,
    info: {
      dnm: dnmSeen,
      obrScene: { ready: obrSceneReady, bound: obrSceneBinding },
      error: lastError,
      embeds: S.embedCount(state),
      gm: gmConnections.size > 0 || isGM(),
    },
  };
}

function push() {
  const msg = snapshotForConsole();
  try { if (channelBC) channelBC.postMessage(msg); } catch (err) { /* closed */ }
  try { if (popup && !popup.closed) popup.postMessage(msg, location.origin); } catch (err) { /* gone */ }
}

async function runCommand(cmd) {
  const { op, args } = cmd;
  if (GM_ONLY.has(op) && !isGM()) return { error: "Only the GM can do that." };
  const now = Date.now();
  switch (op) {
    case "prefs.set": {
      prefs = readPrefs({ ...prefs, ...args });
      saveJSON(PREFS_KEY, prefs);
      applyVolumes();
      if (prefs.mute) stopShots();
      return { ok: true };
    }
    case "music.play": {
      const list = lib.lists.find((l) => l.id === args.list);
      const i = Number.isInteger(args.i) ? args.i
        : lib.shuffle && list ? Math.floor(Math.random() * list.tracks.length) : 0;
      return commit(S.musicStart(await freshState(), lib, args.list, i, now));
    }
    case "music.toggle": {
      const s = await freshState();
      if (!s.music) {
        const first = lib.lists.find((l) => l.tracks.length);
        return first ? commit(S.musicStart(s, lib, first.id, 0, now)) : { error: "Make a playlist first." };
      }
      return commit(s.music.paused === null ? S.musicPause(s, now) : S.musicResume(s, now));
    }
    case "music.next": return commit(S.musicAdvance(await freshState(), lib, now));
    case "music.prev": return commit(S.musicAdvance(await freshState(), lib, now, Math.random, -1));
    case "music.stop": return commit(S.musicStop(await freshState()));
    case "music.vol": return commit(S.musicVolume(await freshState(), args.v));
    case "layer.add": {
      const sound = args.sound ? findSound(lib, args.sound) : null;
      const track = sound ? sound.track : readTrack(args.track);
      if (!track) return { error: "Pick a sound." };
      return commit(S.layerAdd(await freshState(), {
        track, label: sound ? sound.name : track.t,
        vol: args.vol ?? (sound ? sound.vol : 0.7),
        mode: args.mode, min: args.min, max: args.max,
      }, now));
    }
    case "layer.remove": return commit(S.layerRemove(await freshState(), String(args.id || "")));
    case "layer.vol": return commit(S.layerVolume(await freshState(), String(args.id || ""), args.v));
    case "layer.clear": return commit(S.layersClear(await freshState()));
    case "sound.fire": return fireSound(String(args.id || ""));
    case "sound.stopAll":
      await OBR.broadcast.sendMessage(CHANNEL, { type: "stopSounds" }, { destination: "ALL" }).catch(() => {});
      return { ok: true };
    case "scene.recall": return recallScene(String(args.id || ""));
    case "scene.save": {
      const s = await freshState();
      const existing = args.id ? findScene(lib, args.id) : null;
      const id = existing ? existing.id : newId("sc");
      const scene = S.sceneFromState(s, { id, name: args.name || (existing && existing.name), keepMusic: !!args.keepMusic });
      const scenes = existing ? lib.scenes.map((x) => (x.id === id ? scene : x)) : [...lib.scenes, scene];
      return putLibrary({ ...lib, scenes });
    }
    case "scene.bind": return bindObrScene(String(args.id || ""));
    case "lib.put": return putLibrary(args.lib);
    default: return { error: "Unknown command." };
  }
}

function putLibrary(raw) {
  const next = readLibrary({ ...raw, v: 2 });
  if (!saveJSON(LIBRARY_KEY, next)) return { error: "This browser would not save it. Is site data blocked for owlbear.rodeo?" };
  lib = next;
  syncScatter();
  push();
  return { ok: true };
}

async function onLinkMessage(data, reply) {
  if (isHello(data)) { reply(snapshotForConsole()); return; }
  const cmd = readCommand(data);
  if (!cmd) return;
  let result;
  try { result = await runCommand(cmd); } catch (err) { result = { error: "That did not work." }; console.error("[radio]", err); }
  reply({ ns: NS, t: "result", id: cmd.id, ok: !(result && result.error), error: (result && result.error) || "" });
  push();
}

// The popped-out console. Opened by the bar, from a press on the bar — a window
// opened by any other frame would be blocked as a popup, and would not be linked.
function openPopup() {
  const url = new URL("index.html?popout=1", location.href).href;
  popupHeard = false;
  popup = window.open(url, "gsradio-console", "popup,width=1000,height=780");
  if (!popup) {
    setStatus("The browser blocked the window. Allow pop-ups for owlbear.rodeo, then press ⧉ again.");
    return;
  }
  setTimeout(() => {
    if (!popupHeard) {
      setStatus("The window could not connect. Use the Radio panel in Owlbear's toolbar instead.");
    }
  }, 4000);
}

window.addEventListener("message", (ev) => {
  if (!popup || ev.source !== popup || ev.origin !== location.origin) return;
  popupHeard = true;
  if (statusEl.textContent.startsWith("The window")) setStatus("");
  onLinkMessage(ev.data, (msg) => { try { popup.postMessage(msg, location.origin); } catch (err) { /* gone */ } });
});

// -------------------------------------------------------------
// The clock, and who is GM
// -------------------------------------------------------------
// Players' clocks disagree with the GM's by seconds as often as not. The GM's bar
// says what time it is every ten seconds and whenever the music changes; players
// keep the difference. Delivery takes a fraction of a second, well inside the two
// seconds of drift the sync tolerates.
function sendTick() {
  if (!isGM()) return;
  OBR.broadcast.sendMessage(CHANNEL, { type: "tick", now: Date.now() }, { destination: "REMOTE" }).catch(() => {});
}

async function refreshGMs() {
  try {
    const [players, self] = await Promise.all([OBR.party.getPlayers(), OBR.player.getConnectionId()]);
    const next = new Set(players.filter((p) => p.role === "GM").map((p) => p.connectionId));
    // getPlayers() lists everyone except this client.
    if (isGM() && self) next.add(self);
    gmConnections = next;
  } catch (err) {
    // Keep the last known set: clearing it on a hiccup would refuse the GM's sounds.
  }
}

// The broadcast channel is open to every client in the room. Only the GM's bar may
// set the clock or put a sound on everyone's speakers.
const lastHeard = { sound: 0, shot: 0 };
function onRoomMessage(ev) {
  const data = ev && ev.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "hello") { if (isGM()) sendTick(); return; }
  if (!gmConnections.has(ev.connectionId)) return;
  if (data.type === "tick" && !isGM()) {
    const now = Number(data.now);
    if (Number.isFinite(now)) { clockOffset = now - Date.now(); sync(); }
    return;
  }
  if (data.type === "stopSounds") { stopShots(); return; }
  if (data.type === "sound" || data.type === "shot") {
    const track = readTrack(data.track);
    if (!track || track.k !== "a") return;
    // Two GM windows, one event: heard once. Kept per kind, so a gull landing in
    // the same instant as a soundboard press cannot swallow the press.
    if (Date.now() - lastHeard[data.type] < 60) return;
    lastHeard[data.type] = Date.now();
    const vol = Math.max(0, Math.min(1, Number(data.vol) || 1));
    if (data.type === "sound") playSound(track, vol * prefs.fx, { ducking: true });
    else playSound(track, vol * prefs.amb, { ducking: false });
  }
}

// -------------------------------------------------------------
// Showing
// -------------------------------------------------------------
function render() {
  const m = state.music;
  const title = m ? S.displayTitle(m) : state.amb.length ? state.amb.map((l) => l.label).join(" · ") : "";
  el("title").textContent = title || "Nothing playing";
  const bits = [];
  if (m) bits.push((m.paused !== null ? "Paused · " : "") + (m.label || ""));
  if (state.amb.length && m) bits.push(`+${state.amb.length} ambience`);
  if (state.scene) bits.push(state.scene);
  el("label").textContent = bits.filter(Boolean).join(" · ");
  tuneBtn.hidden = tuned;
  document.body.classList.toggle("tuned", tuned);
  document.body.classList.toggle("gm", isGM());
  el("toggle").textContent = m && m.paused === null ? "❚❚" : "▶";
  el("mute").textContent = prefs.mute ? "🔇" : "🔊";
  el("mute").setAttribute("aria-pressed", String(prefs.mute));
}

// -------------------------------------------------------------
// Controls on the bar itself
// -------------------------------------------------------------
tuneBtn.addEventListener("click", () => {
  // One press is enough for the whole page: the browser remembers it was clicked.
  tuned = true;
  setStatus(lastError);
  sync();
  push();
});

const barCommand = (op, args) => runCommand({ op, args: args || {} }).then(push);
el("toggle").addEventListener("click", () => barCommand("music.toggle"));
el("next").addEventListener("click", () => barCommand("music.next"));
el("prev").addEventListener("click", () => barCommand("music.prev"));
el("mute").addEventListener("click", () => barCommand("prefs.set", { mute: !prefs.mute }).then(render));
el("popout").addEventListener("click", openPopup);

// Moving means closing and reopening: Owlbear has no setPosition. The reopened bar
// is a new page, which the browser treats as never clicked, so it asks to be tuned
// in again.
el("move").addEventListener("click", async () => {
  const at = CORNERS.indexOf(prefs.corner);
  prefs = { ...prefs, corner: CORNERS[(at + 1) % CORNERS.length] };
  saveJSON(PREFS_KEY, prefs);
  let viewport = null;
  try { viewport = { width: await OBR.viewport.getWidth(), height: await OBR.viewport.getHeight() }; } catch (err) { /* default */ }
  await OBR.popover.close(BAR_ID);
  await OBR.popover.open(barPopover({ url: location.href, corner: prefs.corner, viewport, embeds: Math.max(0, embedsShown) }));
});
el("close").addEventListener("click", () => { stopEverything(); OBR.popover.close(BAR_ID); });

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
render();

OBR.onReady(async () => {
  try { role = await OBR.player.getRole(); } catch (err) { role = "PLAYER"; }
  await refreshGMs();
  OBR.party.onChange(refreshGMs);
  OBR.player.onChange(async (p) => {
    if (p && p.role && p.role !== role) { role = p.role; await refreshGMs(); syncScatter(); render(); push(); }
  });
  OBR.broadcast.onMessage(CHANNEL, onRoomMessage);

  try {
    channelBC = new BroadcastChannel(channelName(OBR.room.id));
    channelBC.onmessage = (ev) => onLinkMessage(ev.data, (msg) => channelBC.postMessage(msg));
  } catch (err) {
    console.warn("[radio] no channel to the panel", err);
  }

  const meta = await OBR.room.getMetadata().catch(() => ({}));
  state = S.readState(meta, STATE_KEY);
  dnmSeen = dnmPresent(meta, DNM_ROOM_KEY);
  dnmBaseline = meta[DNM_ROOM_KEY] === undefined ? null : meta[DNM_ROOM_KEY];
  OBR.room.onMetadataChange((next) => {
    const s = S.readState(next, STATE_KEY);
    const changed = JSON.stringify(s) !== JSON.stringify(state);
    state = s;
    dnmSeen = dnmPresent(next, DNM_ROOM_KEY);
    if (changed) { sync(); syncScatter(); push(); }
    react(next[DNM_ROOM_KEY]);
  });

  await readObrScene();
  OBR.scene.onReadyChange((ready) => onObrSceneReady(ready));
  OBR.scene.onMetadataChange(async () => { await readObrScene(); push(); });

  render();
  syncScatter();
  push();
  if (isGM()) setInterval(sendTick, 10000);
  else OBR.broadcast.sendMessage(CHANNEL, { type: "hello" }, { destination: "REMOTE" }).catch(() => {});
  setInterval(sync, 4000);
});
