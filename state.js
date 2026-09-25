// =============================================================
// state.js — what is playing, for everyone. The room's copy.
// -------------------------------------------------------------
// Pure. One small record in room metadata under STATE_KEY:
//
//   { v: 2,
//     music: { seq, track, sub, at, paused, list, i, label, nt, vol } | null,
//     amb:   [ { id, track, at, vol, mode, min, max, label } ]   // up to 4
//     scene: "name of the last scene recalled", for display }
//
//   seq     bumped whenever the music moves to another track. The conductor only
//           advances from the seq it saw end, so two GM windows cannot skip two
//           tracks for one ending.
//   at      when position 0 was, in the GM's clock (ms). A loop layer's position is
//           (now - at) modulo its length, which each player knows once loaded.
//   paused  null while playing; the position in seconds while paused.
//   sub     the video inside a YouTube playlist.
//   list, i which of the GM's playlists and where in it. Ids only — players never
//           need the list itself, and it would not fit.
//   nt      the title of what is actually sounding, when only a player knows it
//           (a video inside a YouTube playlist). The GM's bar fills it in.
//   mode    "loop" plays continuously; "scatter" is fired now and then by the GM's
//           bar as a one-shot, so it carries min/max seconds between shots.
//
// Every operation is a function from a state to { state } or { error }, so the
// rules can be tested without a room — and so a refused change is refused before
// anything is written, rather than written and then regretted.
// =============================================================
import { cleanText, readTrack, isEmbed, TITLE_MAX } from "./sources.js";
import { findList, findScene, readLayerSpec, MAX_LAYERS } from "./library.js";

// Players' screens can show only so many embedded players. YouTube's policies do not
// allow a hidden or tiny one, and each needs a 200px tile in the bar.
export const MAX_EMBEDS = 2;
// The room record's share of the 16 kB room metadata. D&M reserves 11 kB; this
// leaves the rest of the room room to breathe. Checked on every write.
export const STATE_BUDGET = 3500;
// How far a player may drift before being moved. Tighter and ordinary buffering
// makes everyone's music stutter as it is corrected.
export const DRIFT_TOLERANCE = 2;

const clamp = (x, lo, hi, dflt) => {
  const v = Number(x);
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
};

export function emptyState() {
  return { v: 2, music: null, amb: [], scene: "" };
}

function readMusic(raw) {
  if (!raw || typeof raw !== "object") return null;
  const track = readTrack(raw.track);
  if (!track) return null;
  return {
    seq: Math.round(clamp(raw.seq, 0, 1e9, 0)),
    track,
    sub: Math.round(clamp(raw.sub, 0, 5000, 0)),
    at: clamp(raw.at, 0, 8.64e15, 0),
    paused: raw.paused === null || raw.paused === undefined ? null : clamp(raw.paused, 0, 86400, 0),
    list: cleanText(raw.list, 40),
    i: Math.round(clamp(raw.i, 0, 1000, 0)),
    label: cleanText(raw.label, TITLE_MAX),
    nt: cleanText(raw.nt, TITLE_MAX),
    vol: clamp(raw.vol, 0, 1, 1),
  };
}

function readLayer(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = /^[A-Za-z0-9_-]{1,24}$/.test(String(raw.id ?? "")) ? String(raw.id) : "";
  const spec = readLayerSpec(raw);
  if (!id || !spec) return null;
  return { id, ...spec, at: clamp(raw.at, 0, 8.64e15, 0) };
}

// Untrusted on the way out: any client in the room can write room metadata.
// Accepts the 0.1/0.2 shape too — a room left playing across the upgrade keeps
// playing, as music.
export function readState(meta, key) {
  const raw = meta && meta[key];
  if (!raw || typeof raw !== "object") return emptyState();
  if (raw.v !== 2) {
    const music = readMusic(raw);
    return { ...emptyState(), music };
  }
  const seen = new Set();
  const amb = (Array.isArray(raw.amb) ? raw.amb : [])
    .map(readLayer)
    .filter((l) => l && !seen.has(l.id) && seen.add(l.id))
    .slice(0, MAX_LAYERS);
  const state = { v: 2, music: readMusic(raw.music), amb, scene: cleanText(raw.scene, TITLE_MAX) };
  // A hostile record naming more embedded players than the bar can show is cut back
  // to what fits, music first.
  return trimEmbeds(state);
}

function trimEmbeds(state) {
  let count = isEmbed(state.music && state.music.track) ? 1 : 0;
  const amb = state.amb.filter((l) => {
    if (!isEmbed(l.track)) return true;
    count += 1;
    return count <= MAX_EMBEDS;
  });
  return { ...state, amb };
}

export function embedCount(state) {
  let count = isEmbed(state.music && state.music.track) ? 1 : 0;
  for (const l of state.amb) if (isEmbed(l.track)) count += 1;
  return count;
}

// What goes into the room. The pasted links in the library are dropped; everything
// is re-read so nothing unchecked leaves this function.
export function writeState(state) {
  const music = state.music ? { ...state.music, track: readTrack(state.music.track) } : null;
  const amb = state.amb.map((l) => ({ ...l, track: readTrack(l.track) }));
  return readState({ s: { v: 2, music, amb, scene: state.scene } }, "s");
}

export function stateSize(state) {
  return JSON.stringify(writeState(state)).length;
}

// Every operation ends here: the rules that apply to any change at all.
function done(state) {
  if (embedCount(state) > MAX_EMBEDS) {
    return { error: `Only ${MAX_EMBEDS} YouTube or SoundCloud players fit at once. Stop one first.` };
  }
  if (stateSize(state) > STATE_BUDGET) {
    return { error: "That is more than the room can hold. Stop a layer first." };
  }
  return { state: writeState(state) };
}

// -------------------------------------------------------------
// Positions
// -------------------------------------------------------------
export function musicPosition(music, gmNow) {
  if (!music) return 0;
  if (music.paused !== null && music.paused !== undefined) return music.paused;
  return Math.max(0, (gmNow - music.at) / 1000);
}

// A loop layer's position, once its length is known. Before that, the raw elapsed
// time; the player folds it into the loop when the length arrives.
export function layerPosition(layer, gmNow, duration) {
  const elapsed = Math.max(0, (gmNow - layer.at) / 1000);
  return duration > 0 && Number.isFinite(duration) ? elapsed % duration : elapsed;
}

export function needsSeek(actual, expected, duration = 0) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  let gap = Math.abs(actual - expected);
  // In a loop, 0.5s before the end and 0.5s after the start are one second apart.
  if (duration > 0) gap = Math.min(gap, duration - gap);
  return gap > DRIFT_TOLERANCE;
}

export function displayTitle(music) {
  if (!music) return "";
  return music.nt || music.track.t;
}

// -------------------------------------------------------------
// Music
// -------------------------------------------------------------
export function nextIndex(length, i, shuffle, rand = Math.random) {
  if (length <= 1) return 0;
  if (!shuffle) return (i + 1) % length;
  // Never the same track twice running: that is what a shuffle sounds broken by.
  const pick = Math.floor(rand() * (length - 1));
  return pick >= i ? pick + 1 : pick;
}

export function musicStart(state, lib, listId, i, gmNow) {
  const list = findList(lib, listId);
  if (!list || !list.tracks.length) return { error: "That playlist is empty." };
  const at = Math.max(0, Math.min(list.tracks.length - 1, Math.round(i) || 0));
  const prior = state.music;
  return done({
    ...state,
    music: {
      seq: (prior ? prior.seq : 0) + 1,
      track: list.tracks[at],
      sub: 0,
      at: gmNow,
      paused: null,
      list: list.id,
      i: at,
      label: list.name,
      nt: "",
      vol: prior ? prior.vol : 1,
    },
  });
}

// Loops at the end: background music that stops dead mid-scene is worse than
// hearing a track twice.
export function musicAdvance(state, lib, gmNow, rand = Math.random, direction = 1) {
  const m = state.music;
  const list = m && findList(lib, m.list);
  if (!list || !list.tracks.length) return { error: "Nothing to move on to." };
  const len = list.tracks.length;
  const i = direction < 0 ? (m.i - 1 + len) % len : nextIndex(len, m.i, lib.shuffle, rand);
  return musicStart(state, lib, list.id, i, gmNow);
}

export function musicPause(state, gmNow) {
  const m = state.music;
  if (!m || m.paused !== null) return { state };
  return done({ ...state, music: { ...m, paused: musicPosition(m, gmNow) } });
}

export function musicResume(state, gmNow) {
  const m = state.music;
  if (!m || m.paused === null) return { state };
  return done({ ...state, music: { ...m, at: gmNow - m.paused * 1000, paused: null } });
}

export function musicStop(state) {
  return done({ ...state, music: null });
}

export function musicVolume(state, vol) {
  if (!state.music) return { state };
  return done({ ...state, music: { ...state.music, vol: clamp(vol, 0, 1, 1) } });
}

// A YouTube playlist moved on to its next video by itself. `at` is passed in,
// because the GM's player may already be a second into it.
export function musicSub(state, sub, at) {
  if (!state.music) return { state };
  return done({ ...state, music: { ...state.music, sub: Math.max(0, Math.round(sub) || 0), at, paused: null, nt: "" } });
}

export function musicTitle(state, title) {
  if (!state.music) return { state };
  return done({ ...state, music: { ...state.music, nt: cleanText(title, TITLE_MAX) } });
}

export function musicReanchor(state, at) {
  if (!state.music || state.music.paused !== null) return { state };
  return done({ ...state, music: { ...state.music, at } });
}

// -------------------------------------------------------------
// Ambience
// -------------------------------------------------------------
export function layerAdd(state, spec, gmNow, rand = Math.random) {
  const clean = readLayerSpec(spec);
  if (!clean) return { error: "That sound cannot be a layer." };
  if (state.amb.length >= MAX_LAYERS) return { error: `At most ${MAX_LAYERS} ambience layers at once. Stop one first.` };
  const id = "L" + Math.floor(rand() * 36 ** 6).toString(36);
  return done({ ...state, amb: [...state.amb, { id, ...clean, at: gmNow }] });
}

export function layerRemove(state, id) {
  return done({ ...state, amb: state.amb.filter((l) => l.id !== id) });
}

export function layerVolume(state, id, vol) {
  return done({ ...state, amb: state.amb.map((l) => (l.id === id ? { ...l, vol: clamp(vol, 0, 1, l.vol) } : l)) });
}

export function layersClear(state) {
  return done({ ...state, amb: [] });
}

// -------------------------------------------------------------
// Scenes
// -------------------------------------------------------------
// Recalling a scene replaces the ambience with the scene's, and does to the music
// what the scene says: keep it, stop it, or start a playlist. A layer that is in
// both the old and the new ambience KEEPS PLAYING where it is — walking from the
// tavern to the tavern's back room should not restart the rain.
export function sceneApply(state, lib, sceneId, gmNow, rand = Math.random) {
  const scene = findScene(lib, sceneId);
  if (!scene) return { error: "That scene is gone." };
  let next = { ...state, scene: scene.name };
  const key = (t) => JSON.stringify([t.k, t.u || t.v]);
  const amb = scene.amb.map((spec) => {
    const same = state.amb.find((l) => key(l.track) === key(spec.track) && l.mode === spec.mode);
    return same
      ? { ...same, vol: spec.vol, min: spec.min, max: spec.max, label: spec.label }
      : { id: "L" + Math.floor(rand() * 36 ** 6).toString(36), ...spec, at: gmNow };
  });
  next = { ...next, amb };
  if (scene.music.mode === "stop") next = { ...next, music: null };
  if (scene.music.mode === "list") {
    const already = state.music && state.music.list === scene.music.list && state.music.paused === null;
    if (!already) {
      const list = findList(lib, scene.music.list);
      const first = lib.shuffle && list ? Math.floor(rand() * list.tracks.length) : 0;
      const started = musicStart(next, lib, scene.music.list, first, gmNow);
      if (started.error) return started;
      next = started.state;
    }
    if (next.music) next = { ...next, music: { ...next.music, vol: scene.music.vol } };
  }
  return done(next);
}

// A scene made from whatever is playing now.
export function sceneFromState(state, { id, name, keepMusic = false }) {
  const music = state.music && !keepMusic
    ? { mode: "list", list: state.music.list, vol: state.music.vol }
    : { mode: "keep", list: "", vol: 1 };
  return {
    id,
    name: cleanText(name, 40) || "Scene",
    music,
    amb: state.amb.map((l) => ({ track: l.track, vol: l.vol, mode: l.mode, min: l.min, max: l.max, label: l.label })),
  };
}

// -------------------------------------------------------------
// Initiative: remember what was playing, and bring it back after
// -------------------------------------------------------------
export function snapshot(state, gmNow) {
  return {
    state: writeState(state),
    musicPos: musicPosition(state.music, gmNow),
    t: gmNow,
  };
}

export function restore(current, snap, gmNow) {
  if (!snap || !snap.state) return { error: "Nothing to go back to." };
  const back = readState({ s: snap.state }, "s");
  const pos = Math.max(0, Number(snap.musicPos) || 0);
  const music = back.music
    ? { ...back.music, seq: (current.music ? current.music.seq : back.music.seq) + 1, at: gmNow - pos * 1000, paused: null }
    : null;
  // Loop layers carry their own clock; leaving `at` alone means they come back in
  // step with where they would have been, which for a loop is as good as anywhere.
  return done({ ...back, music });
}
