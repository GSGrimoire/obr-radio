// =============================================================
// radio.js — everything in the radio that is a RULE rather than a screen.
// -------------------------------------------------------------
// Pure functions only: no SDK, no DOM, no storage. panel.js and bar.js supply
// what only they know (the time, the room, the player) and this decides what it
// means. That split is what lets tests/radio.test.mjs check every rule without a
// room, the same arrangement dnm-obr keeps with dnm.js.
// =============================================================

export const RADIO_VERSION = "0.1";

// The namespace. A key, never a URL — nothing is fetched from it. Changing it
// orphans every room's radio state and every GM's saved playlists, so it needs a
// migration, not a find-and-replace.
export const ID = "com.gsgrimoire.obr-radio";
export const STATE_KEY = `${ID}/state`;     // room metadata: what is playing
export const CHANNEL = `${ID}/events`;      // broadcasts: cues and clock ticks
export const BAR_ID = `${ID}/bar`;          // the docked player popover
export const LIBRARY_KEY = `${ID}/library`; // GM's localStorage: playlists, soundscape
export const PREFS_KEY = `${ID}/prefs`;     // everyone's localStorage: volumes, corner
export const RESUME_KEY = `${ID}/resume`;   // GM's localStorage: music to go back to

// The Dreams & Machines extension's room record. Read-only from here. It is
// written by ONE client, the GM's dnm-obr background page, after that page has
// checked who sent each event — which is why the soundscape watches this record
// rather than listening to D&M broadcasts that any player could forge.
export const DNM_ROOM_KEY = "com.thuknights.dnm-rolls/state";

export const TITLE_MAX = 80;
export const URL_MAX = 600;
export const MAX_TRACKS = 200;
export const MAX_LISTS = 30;

// -------------------------------------------------------------
// Tracks
// -------------------------------------------------------------
// A track is one of three shapes. Short keys because the current one is written to
// room metadata, and that 16 kB is shared with every other extension in the room —
// D&M alone reserves 11 kB of it.
//
//   { k: "yt",  v: "<11-char video id>",  t: title, s: link as pasted }
//   { k: "ytl", l: "<playlist id>",       t, s }   a whole YouTube playlist
//   { k: "a",   u: "https://…mp3",        t, s }   any streamable audio file,
//                                                   which is what a Suno song is
//
// `s` is only kept in the GM's library, so the editor can show a link the way it
// was pasted. It is never needed to PLAY anything and is dropped from room state.

const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{2,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;

export function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

// The one place a URL is accepted as something to play. https only: a page served
// over https cannot load http media anyway, and refusing it here means a hostile
// state cannot smuggle in javascript:, data: or blob: either.
export function safeAudioUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text.length > URL_MAX) return "";
  let url;
  try { url = new URL(text); } catch (err) { return ""; }
  if (url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  return url.href;
}

// Suno serves each song's audio as <uuid>.mp3 from its CDN. That is not a documented
// API — Suno has none — so it is kept to this one function. If Suno moves its files,
// this is the only line that changes, and every other kind of link keeps working.
export function sunoAudioUrl(uuid) {
  return `https://cdn1.suno.ai/${uuid.toLowerCase()}.mp3`;
}

function withScheme(text) {
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text;
}

function bareHost(host) {
  return host.toLowerCase().replace(/^(www|m|music)\./, "");
}

function fileTitle(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return cleanText(decodeURIComponent(last).replace(AUDIO_EXT, "").replace(/[-_]+/g, " "), TITLE_MAX)
      || "Audio";
  } catch (err) {
    return "Audio";
  }
}

// Turns one pasted link into a track, or says in plain words why it cannot.
// Returns { track } or { error }.
export function parseLink(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { error: "Empty link." };
  let url;
  try { url = new URL(withScheme(text)); } catch (err) {
    return { error: "That is not a link." };
  }
  if (!/^https?:$/.test(url.protocol)) return { error: "Only web links can be played." };
  const host = bareHost(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);

  // --- YouTube ---
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    const list = url.searchParams.get("list");
    // A link that carries a playlist means the playlist, even when it also names
    // the video it was copied from — that is what "Share" on a playlist produces.
    // Mixes (RD…) are generated per viewer and cannot be played in sync.
    if (list && !/^RD/.test(list)) {
      if (!YT_LIST.test(list)) return { error: "That YouTube playlist id does not look right." };
      return { track: { k: "ytl", l: list, t: "YouTube playlist", s: text } };
    }
    let id = "";
    if (host === "youtu.be") id = parts[0] || "";
    else if (parts[0] === "watch") id = url.searchParams.get("v") || "";
    else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1] || "";
    if (YT_VIDEO.test(id)) return { track: { k: "yt", v: id, t: "YouTube video", s: text } };
    return { error: "That YouTube link names no video or playlist." };
  }

  // --- Suno ---
  if (host === "suno.com" || host === "app.suno.ai" || host === "suno.ai") {
    if ((parts[0] === "song" || parts[0] === "embed") && UUID.test(parts[1] || "")) {
      return { track: { k: "a", u: sunoAudioUrl(parts[1]), t: "Suno song", s: text } };
    }
    if (parts[0] === "s") {
      // A short share link only becomes a song id by asking suno.com, and suno.com
      // will not answer a page on another site. The browser has to follow it.
      return { error: "Suno short links (suno.com/s/…) cannot be read from here. "
        + "Open it, and paste the address it turns into: suno.com/song/…" };
    }
    if (parts[0] === "playlist") {
      return { error: "Suno playlists cannot be read from here. Paste the songs one per line." };
    }
    return { error: "That Suno link names no song." };
  }
  if (/^cdn\d*\.suno\.ai$/.test(host)) {
    const id = (parts[0] || "").replace(/\.mp3$/i, "");
    if (UUID.test(id)) return { track: { k: "a", u: sunoAudioUrl(id), t: "Suno song", s: text } };
    return { error: "That Suno file link names no song." };
  }

  // --- anything else that is plainly an audio file ---
  if (AUDIO_EXT.test(url.pathname)) {
    const u = safeAudioUrl(url.href);
    if (!u) return { error: "Audio links must start with https://." };
    return { track: { k: "a", u, t: fileTitle(u), s: text } };
  }

  return { error: "Not a YouTube, Suno or audio-file link." };
}

// One editor line: "Title | link", or just the link. The title is whichever side
// is NOT the link, so "link | Title" works too — people paste both ways round.
export function parseLine(line) {
  const text = String(line ?? "").trim();
  if (!text || text.startsWith("#")) return null;
  const bar = text.lastIndexOf("|");
  if (bar < 0) return parseLink(text);
  const left = text.slice(0, bar).trim();
  const right = text.slice(bar + 1).trim();
  let found = parseLink(right);
  let title = left;
  if (found.error) {
    const other = parseLink(left);
    if (other.track) { found = other; title = right; }
  }
  if (found.track && title) found.track.t = cleanText(title, TITLE_MAX);
  return found;
}

// The whole editor box. Every line is accounted for: a track, or an error naming
// the line, so a typo is pointed at rather than silently dropped.
export function parseTrackList(text) {
  const tracks = [];
  const errors = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    const found = parseLine(line);
    if (!found) return;
    if (found.error) errors.push({ line: i + 1, error: found.error });
    else if (tracks.length < MAX_TRACKS) tracks.push(found.track);
  });
  return { tracks, errors };
}

export function trackLink(track) {
  if (!track) return "";
  if (track.s) return track.s;
  if (track.k === "yt") return `https://youtu.be/${track.v}`;
  if (track.k === "ytl") return `https://www.youtube.com/playlist?list=${track.l}`;
  return track.u || "";
}

export function formatTrackList(tracks) {
  return (tracks || []).map((t) => `${t.t} | ${trackLink(t)}`).join("\n");
}

// Untrusted on the way OUT, like everything read from the room: any client can
// write room metadata. Returns a clean track or null. `keepSource` is for the
// library, which is the GM's own storage but still clamped — it may have been
// pasted in from somebody else's export.
export function readTrack(raw, { keepSource = false } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const t = cleanText(raw.t, TITLE_MAX);
  const s = keepSource ? cleanText(raw.s, URL_MAX) : "";
  const extra = s ? { s } : {};
  if (raw.k === "yt" && YT_VIDEO.test(raw.v)) return { k: "yt", v: raw.v, t: t || "YouTube video", ...extra };
  if (raw.k === "ytl" && YT_LIST.test(raw.l)) return { k: "ytl", l: raw.l, t: t || "YouTube playlist", ...extra };
  if (raw.k === "a") {
    const u = safeAudioUrl(raw.u);
    if (u) return { k: "a", u, t: t || "Audio", ...extra };
  }
  return null;
}

// What identifies "the same thing playing" — a new key means load, the same key
// means at most seek.
export function trackKey(track, sub = 0) {
  if (!track) return "";
  if (track.k === "yt") return "yt:" + track.v;
  if (track.k === "ytl") return `ytl:${track.l}:${sub}`;
  return "a:" + track.u;
}

// -------------------------------------------------------------
// Room state: what is playing, for everyone
// -------------------------------------------------------------
// { v: 1, seq, track, sub, at, paused, list, i }
//
//   seq     bumped on every change of track. The conductor only advances from the
//           seq it saw end, so two GM windows cannot skip two tracks for one end.
//   sub     the video within a YouTube playlist
//   at      when position 0 was, in the GM's clock (ms)
//   paused  null while playing; the position in seconds while paused
//   list, i which of the GM's playlists and where in it. Ids only — players never
//           need the list itself, and it would not fit.
//   label   the playlist's name, for display
//   nt      the title of what is sounding, when only the player knows it
export function emptyState() {
  return { v: 1, seq: 0, track: null, sub: 0, at: 0, paused: null, list: "", i: 0, label: "", nt: "" };
}

export function readState(meta) {
  const raw = meta && meta[STATE_KEY];
  if (!raw || typeof raw !== "object") return emptyState();
  const num = (x, lo, hi, dflt) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
  };
  return {
    v: 1,
    seq: Math.round(num(raw.seq, 0, 1e9, 0)),
    track: readTrack(raw.track),
    sub: Math.round(num(raw.sub, 0, 5000, 0)),
    at: num(raw.at, 0, 8.64e15, 0),
    paused: raw.paused === null || raw.paused === undefined ? null : num(raw.paused, 0, 86400, 0),
    list: cleanText(raw.list, 40),
    i: Math.round(num(raw.i, 0, MAX_TRACKS, 0)),
    label: cleanText(raw.label, TITLE_MAX),
    // The title of what is actually sounding, when it is known only once it plays —
    // a video inside a YouTube playlist. The GM's bar fills it in.
    nt: cleanText(raw.nt, TITLE_MAX),
  };
}

// What goes into room metadata. The library's pasted link is dropped: it is not
// needed to play and every byte here is shared with the rest of the room.
export function writeState(state) {
  const track = state.track ? readTrack(state.track) : null;
  return { ...readState({ [STATE_KEY]: { ...state, track } }) };
}

// Where playback should be, in seconds, given the GM's clock right now.
export function positionOf(state, gmNow) {
  if (!state || !state.track) return 0;
  if (state.paused !== null && state.paused !== undefined) return state.paused;
  return Math.max(0, (gmNow - state.at) / 1000);
}

// How far out a client may drift before it is pulled back. Tighter than this and
// ordinary buffering makes everyone's music stutter as it is corrected.
export const DRIFT_TOLERANCE = 2;

export function needsSeek(actual, expected) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return Math.abs(actual - expected) > DRIFT_TOLERANCE;
}

// -------------------------------------------------------------
// The GM's library: playlists and the soundscape
// -------------------------------------------------------------
export const CUES = [
  ["combatStart", "Initiative starts"],
  ["combatEnd", "Initiative ends"],
  ["round", "New round"],
  ["threatUp", "Threat goes up"],
  ["threatDown", "Threat is spent"],
  ["momentumUp", "Momentum gained"],
  ["momentumDown", "Momentum spent"],
  ["breather", "Breather"],
  ["break", "Break"],
  ["bed", "Bed"],
  ["scene", "End Scene"],
  ["session", "New Session"],
  ["adventure", "New Adventure"],
];
const CUE_NAMES = CUES.map(([k]) => k);

// When several things happen in one write — End Scene also ends initiative — only
// the most significant gets a sound. Two stingers over each other is noise.
export const CUE_PRIORITY = [
  "adventure", "session", "scene", "bed", "break", "breather",
  "combatStart", "combatEnd", "round",
  "threatUp", "threatDown", "momentumUp", "momentumDown",
];

export function emptyLibrary() {
  return { v: 1, lists: [], combatList: "", cues: {}, cueSeconds: 8, shuffle: false };
}

export function newListId(rand = Math.random) {
  return "l" + Date.now().toString(36) + Math.floor(rand() * 1e6).toString(36);
}

export function readLibrary(raw) {
  const lib = emptyLibrary();
  if (!raw || typeof raw !== "object") return lib;
  const seen = new Set();
  lib.lists = (Array.isArray(raw.lists) ? raw.lists : [])
    .filter((l) => l && typeof l === "object")
    .map((l) => ({
      id: cleanText(l.id, 40),
      name: cleanText(l.name, 40) || "Playlist",
      tracks: (Array.isArray(l.tracks) ? l.tracks : [])
        .map((t) => readTrack(t, { keepSource: true })).filter(Boolean).slice(0, MAX_TRACKS),
    }))
    .filter((l) => l.id && !seen.has(l.id) && seen.add(l.id))
    .slice(0, MAX_LISTS);
  lib.combatList = lib.lists.some((l) => l.id === raw.combatList) ? raw.combatList : "";
  for (const name of CUE_NAMES) {
    const cue = readTrack(raw.cues && raw.cues[name], { keepSource: true });
    // Stingers are audio files only. A YouTube stinger would need a second visible
    // player, and would start with an advert often enough to be pointless.
    if (cue && cue.k === "a") lib.cues[name] = cue;
  }
  lib.cueSeconds = Math.max(2, Math.min(30, Math.round(Number(raw.cueSeconds) || 8)));
  lib.shuffle = !!raw.shuffle;
  return lib;
}

export function findList(lib, id) {
  return (lib && lib.lists.find((l) => l.id === id)) || null;
}

// Start a playlist at index i. Returns the new state, or null when there is
// nothing to play.
export function startList(lib, listId, i, gmNow, prevSeq = 0) {
  const list = findList(lib, listId);
  if (!list || !list.tracks.length) return null;
  const at = Math.max(0, Math.min(list.tracks.length - 1, Math.round(i) || 0));
  return {
    ...emptyState(),
    seq: prevSeq + 1,
    track: list.tracks[at],
    list: list.id,
    i: at,
    label: list.name,
    at: gmNow,
  };
}

// Which index comes after i. Loops at the end: background music that stops dead
// in the middle of a scene is worse than hearing a track twice.
export function nextIndex(length, i, shuffle, rand = Math.random) {
  if (length <= 1) return 0;
  if (!shuffle) return (i + 1) % length;
  // Never the same track twice running, which is what a shuffle sounds broken by.
  const pick = Math.floor(rand() * (length - 1));
  return pick >= i ? pick + 1 : pick;
}

export function advance(state, lib, gmNow, rand = Math.random, direction = 1) {
  const list = findList(lib, state.list);
  if (!list || !list.tracks.length) return null;
  const len = list.tracks.length;
  const i = direction < 0
    ? (state.i - 1 + len) % len
    : nextIndex(len, state.i, lib.shuffle, rand);
  return startList(lib, list.id, i, gmNow, state.seq);
}

export function pauseState(state, gmNow) {
  if (!state.track || state.paused !== null) return state;
  return { ...state, paused: positionOf(state, gmNow) };
}

export function resumeState(state, gmNow) {
  if (!state.track || state.paused === null) return state;
  return { ...state, at: gmNow - state.paused * 1000, paused: null };
}

// A YouTube playlist moved on to its next video by itself. `at` is passed in rather
// than taken as now, because the GM's player may already be a second into it.
export function withSub(state, sub, at) {
  return { ...state, sub: Math.max(0, Math.round(sub) || 0), at, paused: null, nt: "" };
}

export function displayTitle(state) {
  if (!state || !state.track) return "";
  return state.nt || state.track.t;
}

// -------------------------------------------------------------
// The soundscape: what happened at the D&M table
// -------------------------------------------------------------
// Compares two readings of the D&M room record and names what changed. Everything
// is read defensively: the record belongs to another extension and its shape is
// that extension's business.
function dnmNumbers(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const init = s.initiative && typeof s.initiative === "object" ? s.initiative : null;
  const epochs = s.epochs && typeof s.epochs === "object" ? s.epochs : {};
  return {
    threat: n(s.threat),
    momentum: n(s.momentum),
    init: !!init,
    round: init ? n(init.round) : 0,
    epochs: Object.fromEntries(
      ["breather", "break", "bed", "scene", "session", "adventure"].map((k) => [k, n(epochs[k])]),
    ),
  };
}

export function diffDnm(prev, next) {
  if (prev === undefined) return []; // first reading is the baseline, not news
  const a = dnmNumbers(prev);
  const b = dnmNumbers(next);
  const cues = [];
  if (!a.init && b.init) cues.push("combatStart");
  if (a.init && !b.init) cues.push("combatEnd");
  if (a.init && b.init && b.round > a.round) cues.push("round");
  if (b.threat > a.threat) cues.push("threatUp");
  if (b.threat < a.threat) cues.push("threatDown");
  if (b.momentum > a.momentum) cues.push("momentumUp");
  if (b.momentum < a.momentum) cues.push("momentumDown");
  for (const k of Object.keys(b.epochs)) if (b.epochs[k] > a.epochs[k]) cues.push(k);
  return cues;
}

// The one stinger to play for a set of cues, or null.
export function pickCue(cues, lib) {
  for (const name of CUE_PRIORITY) {
    if (cues.includes(name) && lib.cues[name]) return { name, track: lib.cues[name] };
  }
  return null;
}

// -------------------------------------------------------------
// Everyone's own settings
// -------------------------------------------------------------
export const CORNERS = ["bottom-left", "bottom-right", "top-right", "top-left"];

export function readPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const vol = (x, d) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d;
  };
  return {
    music: vol(p.music, 0.6),
    fx: vol(p.fx, 0.8),
    corner: CORNERS.includes(p.corner) ? p.corner : "bottom-left",
  };
}

// The docked bar. Same approach as the D&M sheet: a popover pinned to a point with
// disableClickAway, so it stays beside the map instead of closing on the first click.
// Owlbear has no setPosition, so moving it means closing and reopening.
export const BAR_WIDTH = 320;
export const BAR_HEIGHT = 96;
export const BAR_VIDEO_HEIGHT = 200; // YouTube's policy floor for an embedded player

export function barPopover({ url, corner, viewport, video }) {
  const w = Math.max(400, Number(viewport && viewport.width) || 1280);
  const h = Math.max(300, Number(viewport && viewport.height) || 800);
  const c = CORNERS.includes(corner) ? corner : "bottom-left";
  const [v, hz] = c.split("-");
  // Held clear of Owlbear's own toolbars, which sit along the left and top edges.
  const left = hz === "left" ? 64 : w - 16;
  const top = v === "top" ? 72 : h - 16;
  return {
    id: BAR_ID,
    url,
    width: BAR_WIDTH,
    height: BAR_HEIGHT + (video ? BAR_VIDEO_HEIGHT : 0),
    anchorReference: "POSITION",
    anchorPosition: { left, top },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" },
    transformOrigin: {
      horizontal: hz === "left" ? "LEFT" : "RIGHT",
      vertical: v === "top" ? "TOP" : "BOTTOM",
    },
    disableClickAway: true,
    marginThreshold: 0,
  };
}
