// =============================================================
// library.js — the GM's collection: playlists, sounds, scenes, reactions.
// -------------------------------------------------------------
// Pure. The library is kept by the GM's radio bar in that browser's storage and
// nowhere else: the room's shared metadata has no room for it, and the console —
// inside Owlbear or popped out into its own window — edits it through the bar.
//
// Everything in it is untrusted on the way out: it may have been pasted in from
// somebody else's backup. readLibrary() is the only way a library is read.
//
// ONE sound collection serves three uses, so nobody enters a link twice:
//   · a soundboard pad        — press, it plays once for everyone
//   · a looping ambience layer — rain, a crowd, a fire, under the music
//   · a scattered layer       — a gull, a distant bell, at random intervals
// =============================================================
import { cleanText, readTrack, parseAny, trackLink, isEmbed, isSet, TITLE_MAX } from "./sources.js";
import { CUE_NAMES } from "./reactions.js";

export const MAX_TRACKS = 200;
export const MAX_LISTS = 30;
export const MAX_SOUNDS = 120;
export const MAX_SCENES = 40;
export const MAX_LAYERS = 4;     // ambience layers playing at once; see state.js for why
export const NAME_MAX = 40;

// The pads players may press: the sounds on the page the GM opened to them, audio
// only (a video cannot be pressed). Empty when that is switched off.
export function playerPadList(lib) {
  if (!lib.playerPads || !lib.playerPads.on || !lib.playerPads.page) return [];
  return lib.sounds.filter((s) => s.page === lib.playerPads.page && s.track.k === "a")
    .slice(0, MAX_PLAYER_PADS).map((s) => ({ id: s.id, name: s.name }));
}
export const MAX_PLAYER_PADS = 24;

// The same list, as a player's bar reads it from a broadcast: untrusted.
export function readPadList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_PLAYER_PADS)
    .map((p) => p && typeof p === "object" ? { id: cleanId(p.id), name: cleanText(p.name, NAME_MAX) } : null)
    .filter((p) => p && p.id && p.name);
}

export function newId(prefix, rand = Math.random) {
  return prefix + Date.now().toString(36) + Math.floor(rand() * 1e6).toString(36);
}

export function emptyLibrary() {
  return {
    v: 2,
    lists: [],
    sounds: [],
    scenes: [],
    reactions: {},
    shuffle: false,
    autoScenes: true,
    fadeSeconds: 1.5,
    // 1.3: seconds of overlap when one music track gives way to the next (0 = none).
    crossfade: 0,
    // 1.3: one soundboard page the players may press themselves. Off unless the GM
    // turns it on; the GM's bar decides every press, and limits how often.
    playerPads: { on: false, page: "" },
  };
}

export const CROSSFADE_MAX = 12;

const clamp = (x, lo, hi, dflt) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
const cleanId = (x) => (/^[A-Za-z0-9_-]{1,40}$/.test(String(x ?? "")) ? String(x) : "");

// A layer as a scene keeps it: a self-contained copy of the track, so a scene still
// plays after the sound it was made from is deleted or edited.
export function readLayerSpec(raw) {
  if (!raw || typeof raw !== "object") return null;
  const track = readTrack(raw.track);
  if (!track || isSet(track)) return null;
  const mode = raw.mode === "scatter" ? "scatter" : "loop";
  // A scattered sound is a short clip fired now and then; a video cannot be one.
  if (mode === "scatter" && isEmbed(track)) return null;
  const min = clamp(raw.min, 3, 600, 20);
  return {
    track,
    vol: clamp(raw.vol, 0, 1, 0.7),
    mode,
    min,
    max: Math.max(min, clamp(raw.max, 3, 900, 60)),
    label: cleanText(raw.label, TITLE_MAX) || track.t,
  };
}

function readScene(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = cleanId(raw.id);
  if (!id) return null;
  const m = raw.music && typeof raw.music === "object" ? raw.music : {};
  const mode = ["keep", "stop", "list"].includes(m.mode) ? m.mode : "keep";
  return {
    id,
    name: cleanText(raw.name, NAME_MAX) || "Scene",
    music: { mode, list: cleanId(m.list), vol: clamp(m.vol, 0, 1, 1) },
    amb: (Array.isArray(raw.amb) ? raw.amb : []).map(readLayerSpec).filter(Boolean).slice(0, MAX_LAYERS),
  };
}

function readSound(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = cleanId(raw.id);
  const track = readTrack(raw.track, { keepSource: true });
  if (!id || !track || isSet(track)) return null;
  return {
    id,
    name: cleanText(raw.name, NAME_MAX) || track.t,
    track,
    vol: clamp(raw.vol, 0, 1, 1),
    page: cleanText(raw.page, NAME_MAX) || "Sounds",
  };
}

export function readLibrary(raw) {
  const lib = emptyLibrary();
  if (!raw || typeof raw !== "object") return lib;
  if (raw.v !== 2 && (raw.cues || raw.combatList !== undefined)) return migrateV1(raw);
  const unique = (items) => {
    const seen = new Set();
    return items.filter((x) => x && !seen.has(x.id) && seen.add(x.id));
  };
  lib.lists = unique((Array.isArray(raw.lists) ? raw.lists : [])
    .filter((l) => l && typeof l === "object")
    .map((l) => ({
      id: cleanId(l.id),
      name: cleanText(l.name, NAME_MAX) || "Playlist",
      tracks: (Array.isArray(l.tracks) ? l.tracks : [])
        .map((t) => readTrack(t, { keepSource: true })).filter(Boolean).slice(0, MAX_TRACKS),
    }))
    .filter((l) => l.id)).slice(0, MAX_LISTS);
  lib.sounds = unique((Array.isArray(raw.sounds) ? raw.sounds : []).map(readSound)).slice(0, MAX_SOUNDS);
  lib.scenes = unique((Array.isArray(raw.scenes) ? raw.scenes : []).map(readScene)).slice(0, MAX_SCENES);
  // A scene naming a playlist that is gone keeps whatever music is playing.
  for (const s of lib.scenes) {
    if (s.music.mode === "list" && !lib.lists.some((l) => l.id === s.music.list)) s.music = { mode: "keep", list: "", vol: 1 };
  }
  const r = raw.reactions && typeof raw.reactions === "object" ? raw.reactions : {};
  for (const cue of CUE_NAMES) {
    const x = r[cue];
    if (!x || typeof x !== "object") continue;
    const sound = lib.sounds.some((s) => s.id === x.sound) ? x.sound : "";
    const scene = lib.scenes.some((s) => s.id === x.scene) ? x.scene : "";
    const restore = cue === "combatEnd" && !!x.restore;
    if (sound || scene || restore) lib.reactions[cue] = { sound, scene, restore };
  }
  lib.shuffle = !!raw.shuffle;
  lib.autoScenes = raw.autoScenes !== false;
  lib.fadeSeconds = clamp(raw.fadeSeconds, 0, 6, 1.5);
  lib.crossfade = clamp(raw.crossfade, 0, CROSSFADE_MAX, 0);
  const pp = raw.playerPads && typeof raw.playerPads === "object" ? raw.playerPads : {};
  lib.playerPads = { on: pp.on === true, page: cleanText(pp.page, NAME_MAX) };
  return lib;
}

// 0.1 and 0.2 kept a combat playlist and one stinger per D&M event. They become a
// scene and a set of sounds, with the reactions that used to be implicit written
// out — so a GM who set up 0.2 finds everything still where it was.
function migrateV1(raw) {
  const lib = emptyLibrary();
  lib.lists = readLibrary({ v: 2, lists: raw.lists }).lists;
  lib.shuffle = !!raw.shuffle;
  const cueSeconds = clamp(raw.cueSeconds, 2, 30, 8);
  void cueSeconds; // 0.2 cut stingers short; sounds now play to their end
  const cues = raw.cues && typeof raw.cues === "object" ? raw.cues : {};
  for (const cue of CUE_NAMES) {
    const track = readTrack(cues[cue], { keepSource: true });
    if (!track || track.k !== "a") continue;
    const id = "s-" + cue;
    lib.sounds.push({ id, name: track.t, track, vol: 1, page: "D&M" });
    lib.reactions[cue] = { sound: id, scene: "", restore: false };
  }
  if (lib.lists.some((l) => l.id === raw.combatList)) {
    lib.scenes.push({ id: "sc-combat", name: "Initiative", music: { mode: "list", list: raw.combatList, vol: 1 }, amb: [] });
    lib.reactions.combatStart = { ...(lib.reactions.combatStart || { sound: "" }), scene: "sc-combat", restore: false };
    lib.reactions.combatEnd = { ...(lib.reactions.combatEnd || { sound: "", scene: "" }), restore: true };
  }
  return readLibrary(lib);
}

export const findList = (lib, id) => (lib && lib.lists.find((l) => l.id === id)) || null;
export const findSound = (lib, id) => (lib && lib.sounds.find((s) => s.id === id)) || null;
export const findScene = (lib, id) => (lib && lib.scenes.find((s) => s.id === id)) || null;

// -------------------------------------------------------------
// The sounds editor: a text box, like the playlists.
// -------------------------------------------------------------
//   ## Combat
//   Sword clash | https://…mp3
//   Warhorn | https://suno.com/song/… | 60
//
// A "## Page" line starts a soundboard page. A number after a second bar is the
// sound's own volume in percent — some clips are simply louder than others.
export function parseSoundList(text, existing = [], rand = Math.random) {
  const sounds = [];
  const errors = [];
  let page = "Sounds";
  // Keep ids for sounds whose link did not change, so reactions and scenes that
  // point at them survive an edit.
  const byLink = new Map(existing.map((s) => [trackLink(s.track), s]));
  const used = new Set();
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const heading = /^##\s*(.+)$/.exec(trimmed);
    if (heading) { page = cleanText(heading[1], NAME_MAX) || "Sounds"; return; }
    if (trimmed.startsWith("#")) return;
    let body = trimmed;
    let vol = 1;
    const volMatch = /\|\s*(\d{1,3})\s*%?\s*$/.exec(body);
    if (volMatch && body.split("|").length >= 3) {
      vol = Math.max(0, Math.min(100, Number(volMatch[1]))) / 100;
      body = body.slice(0, volMatch.index).trim();
    }
    const found = parseAny(body);
    if (!found) return;
    if (found.error) { errors.push({ line: i + 1, error: found.error }); return; }
    for (const track of found.tracks) {
      if (isSet(track)) { errors.push({ line: i + 1, error: "A whole playlist cannot be a sound. Use one video or track." }); continue; }
      if (sounds.length >= MAX_SOUNDS) break;
      const prior = byLink.get(trackLink(track));
      const id = prior && !used.has(prior.id) ? prior.id : newId("s", rand);
      used.add(id);
      sounds.push({ id, name: cleanText(track.t, NAME_MAX), track, vol, page });
    }
  });
  return { sounds, errors };
}

export function formatSoundList(sounds) {
  const out = [];
  let page = null;
  for (const s of sounds || []) {
    if (s.page !== page) {
      if (out.length) out.push("");
      out.push(`## ${s.page}`);
      page = s.page;
    }
    const vol = s.vol < 1 ? ` | ${Math.round(s.vol * 100)}` : "";
    out.push(`${s.name} | ${trackLink(s.track)}${vol}`);
  }
  return out.join("\n");
}

export function soundPages(lib) {
  const pages = [];
  for (const s of lib.sounds) if (!pages.includes(s.page)) pages.push(s.page);
  return pages;
}
