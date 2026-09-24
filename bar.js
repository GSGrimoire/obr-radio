// =============================================================
// bar.js — the docked player. Every client runs one; the GM's also conducts.
// -------------------------------------------------------------
// WHY A DOCKED POPOVER: music has to keep playing while the player uses the map.
// The action panel is Owlbear's to close, and a closed panel is a silent one, so
// the sound lives here, in a popover pinned to a corner with disableClickAway —
// the same arrangement the D&M sheet uses to stay beside the map.
//
// WHY "TUNE IN": a browser will not start sound in a page nobody has clicked. One
// press per bar is the price, and it is shown as a button rather than left as a
// silence nobody can explain.
//
// NOBODY STREAMS TO ANYBODY. Each client plays its own copy of the same link and
// seeks to where the room says it should be. What the room holds is small: which
// track, and when it started, in the GM's clock.
//
// THE GM'S BAR CONDUCTS. It moves to the next track when one ends, sends a clock
// tick so players can correct for their own clocks, and turns what happens at a
// Dreams & Machines table into cues. It is the only writer of the radio's room
// state, apart from the GM's own presses in the panel.
// =============================================================
import OBR from "./sdk.js";
import {
  STATE_KEY, CHANNEL, BAR_ID, LIBRARY_KEY, PREFS_KEY, RESUME_KEY, DNM_ROOM_KEY,
  BAR_HEIGHT, BAR_VIDEO_HEIGHT, CORNERS,
  readState, writeState, readTrack, readLibrary, readPrefs, trackKey, positionOf,
  needsSeek, advance, startList, withSub, diffDnm, pickCue, displayTitle, barPopover,
  pauseState, resumeState, emptyState,
} from "./radio.js";

const el = (id) => document.getElementById(id);
const audio = el("music");
const fx = el("fx");
const tuneBtn = el("tune");
const statusEl = el("status");

let role = "PLAYER";
let selfConnection = null;
let gmConnections = new Set();
let tuned = false;
let state = emptyState();
let clockOffset = 0;        // GM clock minus ours; 0 on the GM's own client
let loadedKey = "";         // what is loaded, including the seq it was loaded for
let loadedSeq = -1;
let videoShown = false;
let duck = 1;               // music level while a stinger plays
let errorsInARow = 0;
let lastReanchor = 0;
let dnmBaseline;            // undefined until the first reading, which is not news
let lastCueSent = 0;
let lastCueHeard = 0;

// -------------------------------------------------------------
// Storage. localStorage can be blocked in a third-party frame; everything here
// works without it, it just forgets.
// -------------------------------------------------------------
function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (err) { return null; }
}
function saveJSON(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (err) { /* blocked: forget quietly */ }
}
let prefs = readPrefs(loadJSON(PREFS_KEY));
const library = () => readLibrary(loadJSON(LIBRARY_KEY));

const gmNow = () => Date.now() + (role === "GM" ? 0 : clockOffset);
const isGM = () => role === "GM";
const setStatus = (msg) => { statusEl.textContent = msg || ""; };

// -------------------------------------------------------------
// Writing the room (GM only)
// -------------------------------------------------------------
async function writeRoom(next) {
  if (!isGM() || !next) return;
  try {
    await OBR.room.setMetadata({ [STATE_KEY]: writeState(next) });
    sendTick();
  } catch (err) {
    console.error("[radio] could not write the room", err);
    setStatus("Could not reach the room.");
  }
}

async function freshState() {
  try { return readState(await OBR.room.getMetadata()); } catch (err) { return state; }
}

// A track ended. Advances only from the seq that ended, so a second GM window —
// or an 'ended' arriving after the GM already pressed Next — moves nothing.
async function trackEnded(seq) {
  if (!isGM()) return;
  const now = await freshState();
  if (now.seq !== seq || !now.track) return;
  const next = advance(now, library(), Date.now());
  if (next) await writeRoom(next);
  else await writeRoom({ ...now, paused: positionOf(now, Date.now()) });
}

// A track would not play. Skip it — but not forever: a playlist where nothing plays
// (a Suno CDN change, a network block) must stop rather than spin.
function trackFailed(seq, why) {
  setStatus(why);
  if (!isGM()) return;
  errorsInARow += 1;
  const list = library().lists.find((l) => l.id === state.list);
  if (errorsInARow > Math.max(1, list ? list.tracks.length : 1)) {
    setStatus("Nothing in this playlist will play. Stopped.");
    writeRoom({ ...state, paused: 0 });
    return;
  }
  setTimeout(() => trackEnded(seq), 1500);
}

// -------------------------------------------------------------
// YouTube
// -------------------------------------------------------------
// Loaded only when a YouTube track first plays: a table that only uses Suno never
// fetches anything from YouTube. The player is VISIBLE while it plays — YouTube's
// developer policies do not allow a hidden or tiny player, so the bar grows to hold
// a 200px-high one and shrinks back afterwards.
let ytApi = null;
let ytPlayer = null;
let ytReady = null;
let ytListLoaded = "";
let ytStartCheck = 0;

function loadYouTubeApi() {
  if (ytApi) return ytApi;
  ytApi = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prior) prior(); resolve(window.YT); };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { ytApi = null; reject(new Error("YouTube would not load")); };
    document.head.append(script);
  });
  return ytApi;
}

function ensureYouTube() {
  if (ytReady) return ytReady;
  ytReady = loadYouTubeApi().then((YT) => new Promise((resolve) => {
    ytPlayer = new YT.Player("yt", {
      width: 320,
      height: BAR_VIDEO_HEIGHT,
      playerVars: { playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => resolve(ytPlayer),
        onStateChange: onYouTubeState,
        onError: () => trackFailed(loadedSeq, "YouTube would not play that video."),
      },
    });
  }));
  ytReady.catch(() => { ytReady = null; });
  return ytReady;
}

function onYouTubeState(ev) {
  const YTS = (window.YT && window.YT.PlayerState) || { ENDED: 0, PLAYING: 1 };
  const s = state;
  if (ev.data === YTS.PLAYING) {
    errorsInARow = 0;
    ytStartCheck = 0;
    if (!s.track) return;
    if (s.track.k === "ytl") {
      const idx = ytPlayer.getPlaylistIndex();
      if (idx >= 0 && idx !== s.sub) {
        // The playlist moved on by itself. The GM's player is the truth; a player's
        // that moved on its own is pulled back to where the GM is.
        if (isGM()) {
          writeRoom(withSub(s, idx, Date.now() - ytPlayer.getCurrentTime() * 1000));
        } else {
          ytPlayer.playVideoAt(s.sub);
        }
        return;
      }
    }
    // The title is only known once the video plays, so the GM tells the room.
    if (isGM()) {
      const title = (ytPlayer.getVideoData && ytPlayer.getVideoData().title) || "";
      if (title && title !== s.nt) writeRoom({ ...s, nt: title });
    }
    sync();
    return;
  }
  if (ev.data === YTS.ENDED && isGM() && s.track) {
    if (s.track.k === "ytl") {
      const list = ytPlayer.getPlaylist() || [];
      // Not the last video: YouTube carries on by itself.
      if (ytPlayer.getPlaylistIndex() < list.length - 1) return;
    }
    trackEnded(loadedSeq);
  }
}

function stopYouTube() {
  if (ytPlayer && ytPlayer.stopVideo) { try { ytPlayer.stopVideo(); } catch (err) { /* gone */ } }
  ytListLoaded = "";
}

// -------------------------------------------------------------
// Showing and sizing
// -------------------------------------------------------------
function showVideo(on) {
  if (on === videoShown) return;
  videoShown = on;
  document.body.classList.toggle("video", on);
  OBR.popover.setHeight(BAR_ID, BAR_HEIGHT + (on ? BAR_VIDEO_HEIGHT : 0)).catch(() => {});
}

function render() {
  const title = displayTitle(state);
  el("title").textContent = title || "Nothing playing";
  el("label").textContent = state.track ? (state.paused !== null ? "Paused · " : "") + (state.label || "") : "";
  tuneBtn.hidden = tuned;
  document.body.classList.toggle("tuned", tuned);
  document.body.classList.toggle("gm", isGM());
  el("toggle").textContent = state.track && state.paused === null ? "❚❚" : "▶";
  el("vol-music").value = String(Math.round(prefs.music * 100));
  el("vol-fx").value = String(Math.round(prefs.fx * 100));
}

function applyVolumes() {
  audio.volume = Math.max(0, Math.min(1, prefs.music * duck));
  fx.volume = prefs.fx;
  if (ytPlayer && ytPlayer.setVolume) {
    try { ytPlayer.setVolume(Math.round(prefs.music * duck * 100)); } catch (err) { /* not ready */ }
  }
}

// -------------------------------------------------------------
// Following the room
// -------------------------------------------------------------
function stopAll() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  stopYouTube();
  showVideo(false);
  loadedKey = "";
}

// Brings what this client is playing into line with the room. Called on every room
// change, every tick, and every few seconds, so it must be cheap when nothing moved.
async function sync() {
  render();
  if (!tuned) return;
  const s = state;
  if (!s.track) { stopAll(); return; }
  const key = trackKey(s.track, s.sub) + "#" + s.seq;
  const expected = positionOf(s, gmNow());
  const paused = s.paused !== null;

  if (s.track.k === "a") {
    if (videoShown || ytListLoaded) { stopYouTube(); showVideo(false); }
    if (loadedKey !== key) {
      loadedKey = key;
      loadedSeq = s.seq;
      audio.src = s.track.u;
      audio.currentTime = expected;
    } else if (!paused && audio.readyState >= 1 && !audio.seeking) {
      // readyState 1 is "length known", which is all a seek needs. Waiting for
      // buffered data (3) meant a correction arriving mid-buffer was skipped until
      // the next four-second check — caught by the suite failing one run in three.
      correctDrift(audio.currentTime, expected, (t) => { audio.currentTime = t; });
    }
    applyVolumes();
    if (paused) { if (!audio.paused) audio.pause(); } else if (audio.paused) {
      audio.play().catch(() => { tuned = false; render(); setStatus("Press Tune in to hear the music."); });
    }
    return;
  }

  // YouTube
  audio.pause();
  showVideo(true);
  let player;
  try { player = await ensureYouTube(); } catch (err) {
    setStatus("YouTube would not load here.");
    trackFailed(s.seq, "YouTube would not load here.");
    return;
  }
  if (state !== s) return; // the room moved on while YouTube was loading
  applyVolumes();
  if (loadedKey !== key) {
    loadedKey = key;
    loadedSeq = s.seq;
    if (s.track.k === "yt") {
      ytListLoaded = "";
      player.loadVideoById({ videoId: s.track.v, startSeconds: expected });
    } else if (ytListLoaded === s.track.l + "#" + s.seq) {
      // Already on it — the usual case on the GM's own bar, whose player moved on by
      // itself and told the room. Jumping "to" it would restart it from the top.
      if (player.getPlaylistIndex() !== s.sub) player.playVideoAt(s.sub);
    } else {
      ytListLoaded = s.track.l + "#" + s.seq;
      player.loadPlaylist({ list: s.track.l, listType: "playlist", index: s.sub, startSeconds: expected });
    }
    if (paused) player.pauseVideo();
    ytStartCheck = Date.now();
    return;
  }
  const ps = player.getPlayerState();
  if (paused) { if (ps === 1 || ps === 3) player.pauseVideo(); return; }
  if (ps === 1) correctDrift(player.getCurrentTime(), expected, (t) => player.seekTo(t, true));
  else if (ps === 2 || ps === 5 || ps === -1) player.playVideo();
  // A video that will not start on its own means this frame may not start sound
  // inside YouTube's frame. One press on the video itself fixes it.
  if (ps !== 1 && ytStartCheck && Date.now() - ytStartCheck > 4000) {
    setStatus("Press play on the video once.");
  }
}

// Players are pulled to the room. The GM's own bar is not pulled anywhere: it IS
// the room, so when it drifts — buffering, a slow start — it moves the room to
// itself instead, and the players follow on their next check.
function correctDrift(actual, expected, seek) {
  if (!needsSeek(actual, expected)) return;
  if (isGM()) {
    if (Date.now() - lastReanchor < 5000) return;
    lastReanchor = Date.now();
    writeRoom({ ...state, at: Date.now() - actual * 1000 });
  } else {
    seek(expected);
  }
}

audio.addEventListener("ended", () => trackEnded(loadedSeq));
audio.addEventListener("error", () => {
  if (!audio.getAttribute("src")) return;
  trackFailed(loadedSeq, "That track would not play.");
});
audio.addEventListener("playing", () => { errorsInARow = 0; setStatus(""); });
// A correction that arrives mid-seek — a player joining, then a clock tick landing
// while the first seek is still fetching — is skipped by sync(), and would wait for
// the next four-second check. Look again the moment the seek lands instead.
audio.addEventListener("seeked", () => sync());
audio.addEventListener("canplay", () => sync());
// Seeking before the file has loaded is allowed but not always honoured; once the
// length is known, go where the room says.
audio.addEventListener("loadedmetadata", () => {
  const expected = positionOf(state, gmNow());
  if (needsSeek(audio.currentTime, expected)) audio.currentTime = expected;
});

// -------------------------------------------------------------
// Stingers
// -------------------------------------------------------------
let cueTimer = 0;
let fadeTimer = 0;

function playCue(track, seconds) {
  clearTimeout(cueTimer);
  clearInterval(fadeTimer);
  fx.src = track.u;
  fx.currentTime = 0;
  fx.volume = prefs.fx;
  duck = 0.3;
  applyVolumes();
  fx.play().catch(() => endCue());
  // Stingers are cut short and faded: a Suno SONG used as a stinger is three minutes
  // long, and what is wanted is its first few seconds.
  cueTimer = setTimeout(() => {
    fadeTimer = setInterval(() => {
      fx.volume = Math.max(0, fx.volume - prefs.fx / 10);
      if (fx.volume <= 0.001) endCue();
    }, 100);
  }, Math.max(1, seconds - 1) * 1000);
}

function endCue() {
  clearTimeout(cueTimer);
  clearInterval(fadeTimer);
  fx.pause();
  duck = 1;
  applyVolumes();
}
fx.addEventListener("ended", endCue);

// -------------------------------------------------------------
// The soundscape (GM only): what just happened at the D&M table
// -------------------------------------------------------------
async function onDnm(record) {
  const cues = diffDnm(dnmBaseline, record);
  dnmBaseline = record === undefined ? null : record;
  if (!cues.length || !isGM()) return;
  const lib = library();

  // Initiative gets its own playlist, and the music it interrupted comes back after.
  if (cues.includes("combatStart") && lib.combatList && state.list !== lib.combatList) {
    const now = await freshState();
    saveJSON(RESUME_KEY, now.track ? { state: now, pos: positionOf(now, Date.now()) } : null);
    const first = lib.shuffle ? Math.floor(Math.random() * (lib.lists.find((l) => l.id === lib.combatList)?.tracks.length || 1)) : 0;
    await writeRoom(startList(lib, lib.combatList, first, Date.now(), now.seq));
  } else if (cues.includes("combatEnd")) {
    const saved = loadJSON(RESUME_KEY);
    saveJSON(RESUME_KEY, null);
    const now = await freshState();
    if (lib.combatList && now.list === lib.combatList) {
      const back = saved ? readState({ [STATE_KEY]: saved.state }) : null;
      const pos = Math.max(0, Number(saved && saved.pos) || 0);
      if (back && back.track) {
        await writeRoom({ ...back, seq: now.seq + 1, at: Date.now() - pos * 1000, paused: null });
      } else {
        await writeRoom({ ...now, paused: positionOf(now, Date.now()) });
      }
    }
  }

  const cue = pickCue(cues, lib);
  if (!cue || Date.now() - lastCueSent < 1200) return;
  lastCueSent = Date.now();
  const track = readTrack(cue.track); // drops the pasted link: the room does not need it
  OBR.broadcast.sendMessage(CHANNEL, { type: "cue", track, secs: lib.cueSeconds }, { destination: "ALL" })
    .catch((err) => console.error("[radio] could not send a cue", err));
}

// -------------------------------------------------------------
// The clock
// -------------------------------------------------------------
// Players' clocks disagree with the GM's by seconds as often as not. The GM's bar
// says what time it is every ten seconds and whenever the music changes; players
// keep the difference. Delivery takes a fraction of a second, which is well inside
// the two seconds of drift the sync tolerates.
function sendTick() {
  if (!isGM()) return;
  OBR.broadcast.sendMessage(CHANNEL, { type: "tick", now: Date.now() }, { destination: "REMOTE" })
    .catch(() => {});
}

// Connection ids, not player ids: a broadcast names its sender by connection.
async function refreshGMs() {
  try {
    const [players, self] = await Promise.all([OBR.party.getPlayers(), OBR.player.getConnectionId()]);
    selfConnection = self;
    const next = new Set(players.filter((p) => p.role === "GM").map((p) => p.connectionId));
    // getPlayers() lists everyone except this client.
    if (isGM() && self) next.add(self);
    gmConnections = next;
  } catch (err) {
    // Keep the last known set: clearing it on a hiccup would refuse the GM's cues.
  }
}

// The broadcast channel is open to every client in the room. Only the GM's bar
// may set the clock or fire a sound on everyone's speakers.
function onMessage(ev) {
  const data = ev && ev.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "hello") {
    // A player's bar just opened and wants the time. Harmless from anyone.
    if (isGM()) sendTick();
    return;
  }
  if (!gmConnections.has(ev.connectionId)) return;
  if (data.type === "tick" && !isGM()) {
    const now = Number(data.now);
    if (Number.isFinite(now)) { clockOffset = now - Date.now(); sync(); }
  } else if (data.type === "cue") {
    const track = readTrack(data.track);
    if (!tuned || !track || track.k !== "a") return;
    if (Date.now() - lastCueHeard < 1000) return; // two GM windows, one event
    lastCueHeard = Date.now();
    playCue(track, Math.max(2, Math.min(30, Number(data.secs) || 8)));
  }
}

// -------------------------------------------------------------
// Controls
// -------------------------------------------------------------
tuneBtn.addEventListener("click", () => {
  // One press is enough for the whole page: the browser remembers that this page
  // was clicked, so stingers and later tracks may start without another.
  tuned = true;
  setStatus("");
  sync();
});

el("toggle").addEventListener("click", async () => {
  if (!isGM()) return;
  const now = await freshState();
  if (!now.track) {
    const lib = library();
    const first = lib.lists.find((l) => l.tracks.length);
    if (first) writeRoom(startList(lib, first.id, 0, Date.now(), now.seq));
    return;
  }
  writeRoom(now.paused === null ? pauseState(now, Date.now()) : resumeState(now, Date.now()));
});
el("next").addEventListener("click", async () => {
  if (!isGM()) return;
  const now = await freshState();
  writeRoom(advance(now, library(), Date.now()));
});
el("prev").addEventListener("click", async () => {
  if (!isGM()) return;
  const now = await freshState();
  writeRoom(advance(now, library(), Date.now(), Math.random, -1));
});

function onVolume(which) {
  return (ev) => {
    prefs = { ...prefs, [which]: Number(ev.target.value) / 100 };
    saveJSON(PREFS_KEY, prefs);
    applyVolumes();
  };
}
el("vol-music").addEventListener("input", onVolume("music"));
el("vol-fx").addEventListener("input", onVolume("fx"));

// The panel changes volumes too. Same origin, so its writes arrive here as events.
window.addEventListener("storage", (ev) => {
  if (ev.key === PREFS_KEY) { prefs = readPrefs(loadJSON(PREFS_KEY)); applyVolumes(); render(); }
});

// Moving means closing and reopening: Owlbear has no setPosition. The reopened bar
// is a new page, which the browser treats as never having been clicked, so it asks
// to be tuned in again.
el("move").addEventListener("click", async () => {
  const at = CORNERS.indexOf(prefs.corner);
  prefs = { ...prefs, corner: CORNERS[(at + 1) % CORNERS.length] };
  saveJSON(PREFS_KEY, prefs);
  let viewport = null;
  try { viewport = { width: await OBR.viewport.getWidth(), height: await OBR.viewport.getHeight() }; } catch (err) { /* default */ }
  await OBR.popover.close(BAR_ID);
  await OBR.popover.open(barPopover({ url: location.href, corner: prefs.corner, viewport, video: videoShown }));
});
el("close").addEventListener("click", () => OBR.popover.close(BAR_ID));

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
render();
applyVolumes();

OBR.onReady(async () => {
  try { role = await OBR.player.getRole(); } catch (err) { role = "PLAYER"; }
  await refreshGMs();
  OBR.party.onChange(refreshGMs);
  OBR.player.onChange(async (p) => {
    if (p && p.role && p.role !== role) { role = p.role; await refreshGMs(); render(); }
  });
  OBR.broadcast.onMessage(CHANNEL, onMessage);

  const meta = await OBR.room.getMetadata().catch(() => ({}));
  state = readState(meta);
  dnmBaseline = meta[DNM_ROOM_KEY] === undefined ? null : meta[DNM_ROOM_KEY];
  OBR.room.onMetadataChange((next) => {
    const s = readState(next);
    if (JSON.stringify(s) !== JSON.stringify(state)) { state = s; sync(); }
    onDnm(next[DNM_ROOM_KEY]);
  });
  render();

  if (isGM()) setInterval(sendTick, 10000);
  else OBR.broadcast.sendMessage(CHANNEL, { type: "hello" }, { destination: "REMOTE" }).catch(() => {});
  setInterval(sync, 4000);
});
