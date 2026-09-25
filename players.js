// =============================================================
// players.js — one interface over every kind of source.
// -------------------------------------------------------------
// The bar asks a player to load, play, pause, seek, report its time and length,
// and set its volume. Whether that is an <audio> element, YouTube's player or
// SoundCloud's widget is this file's business and nobody else's — which is what
// lets a playlist mix all three.
//
//   AudioPlayer       an <audio> element. Suno, Dropbox, any audio file.
//   YouTubePlayer     YouTube's IFrame Player API — the supported way to play
//                     YouTube on another site. Visible, 200px square: YouTube's
//                     policies do not allow a hidden or tiny player.
//   SoundCloudPlayer  SoundCloud's Widget API, likewise visible.
//
// Nothing is downloaded, and nothing is played by any route but the source's own.
// =============================================================
import { EMBED_SIZE } from "./radio.js";
import { sunoFallback } from "./sources.js";

const scripts = new Map();
function loadScript(src, ready) {
  if (scripts.has(src)) return scripts.get(src);
  const p = new Promise((resolve, reject) => {
    if (ready()) { resolve(); return; }
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => (ready() ? resolve() : setTimeout(() => (ready() ? resolve() : reject(new Error("did not load"))), 500));
    el.onerror = () => { scripts.delete(src); reject(new Error("did not load")); };
    document.head.append(el);
  });
  scripts.set(src, p);
  return p;
}

// Where media elements and embed tiles live. The audio elements are in the page so
// they can be inspected; they are not shown.
const mediaBox = () => document.getElementById("media");
const embedBox = () => document.getElementById("embeds");

// -------------------------------------------------------------
class AudioPlayer {
  constructor(track, opts) {
    this.track = track;
    this.opts = opts;
    this.embed = false;
    const el = document.createElement("audio");
    el.preload = "auto";
    el.loop = !!opts.loop;
    el.dataset.role = opts.role || "";
    if (opts.layer) el.dataset.layer = opts.layer;
    el.addEventListener("ended", () => opts.onEnded && opts.onEnded());
    el.addEventListener("error", () => {
      if (!el.getAttribute("src")) return;
      // A Suno song gets its other file once before the error is reported: Suno
      // closed the .mp3 addresses in 2026, and a library saved before then holds them.
      const other = !this.triedFallback && sunoFallback(el.getAttribute("src"));
      if (other) {
        this.triedFallback = true;
        const at = this.startAt || 0;
        el.src = other;
        el.currentTime = at;
        if (this.wantPlay) el.play().catch(() => {});
        return;
      }
      opts.onError && opts.onError("That track would not play.");
    });
    el.addEventListener("playing", () => opts.onPlaying && opts.onPlaying());
    // A seek before the length is known is not always honoured, and a correction
    // that arrives mid-seek is skipped: look again the moment either settles.
    for (const ev of ["loadedmetadata", "seeked", "canplay"]) el.addEventListener(ev, () => opts.onSettle && opts.onSettle());
    mediaBox().append(el);
    this.el = el;
  }
  load(start) { this.startAt = Math.max(0, start || 0); this.el.src = this.track.u; this.el.currentTime = this.startAt; }
  play() { this.wantPlay = true; return this.el.play(); }
  pause() { this.el.pause(); }
  seek(t) { this.el.currentTime = t; }
  time() { return this.el.currentTime; }
  duration() { return this.el.duration; }
  ready() { return this.el.readyState >= 1 && !this.el.seeking; }
  playing() { return !this.el.paused; }
  setVolume(v) { this.el.volume = Math.max(0, Math.min(1, v)); }
  dispose() { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); this.el.remove(); }
}

// -------------------------------------------------------------
function tile() {
  const slot = document.createElement("div");
  slot.className = "embed-tile";
  slot.style.width = EMBED_SIZE + "px";
  slot.style.height = EMBED_SIZE + "px";
  const inner = document.createElement("div");
  slot.append(inner);
  embedBox().append(slot);
  return { slot, inner };
}

class YouTubePlayer {
  constructor(track, opts) {
    this.track = track;
    this.opts = opts;
    this.embed = true;
    this.vol = 1;
    const { slot, inner } = tile();
    this.slot = slot;
    this.readyP = loadScript("https://www.youtube.com/iframe_api", () => !!(window.YT && window.YT.Player))
      .then(() => new Promise((resolve) => {
        this.p = new window.YT.Player(inner, {
          width: EMBED_SIZE,
          height: EMBED_SIZE,
          playerVars: { playsinline: 1, rel: 0, origin: location.origin },
          events: {
            onReady: () => resolve(this.p),
            onStateChange: (ev) => this.onState(ev.data),
            onError: () => opts.onError && opts.onError("YouTube would not play that video."),
          },
        });
      }));
    this.readyP.catch(() => opts.onError && opts.onError("YouTube would not load here."));
  }
  onState(s) {
    const o = this.opts;
    if (s === 1) {
      o.onPlaying && o.onPlaying();
      if (this.track.k === "ytl" && o.onSub) o.onSub(this.p.getPlaylistIndex(), this.p.getCurrentTime());
      if (o.onTitle) {
        const d = this.p.getVideoData && this.p.getVideoData();
        if (d && d.title) o.onTitle(d.title);
      }
      o.onSettle && o.onSettle();
    } else if (s === 0) {
      if (o.loop) { this.p.seekTo(0, true); this.p.playVideo(); return; }
      if (this.track.k === "ytl") {
        const list = this.p.getPlaylist() || [];
        if (this.p.getPlaylistIndex() < list.length - 1) return; // YouTube carries on by itself
      }
      o.onEnded && o.onEnded();
    }
  }
  async load(start, sub = 0) {
    const p = await this.readyP;
    p.setVolume(Math.round(this.vol * 100));
    if (this.track.k === "ytl") p.loadPlaylist({ list: this.track.l, listType: "playlist", index: sub, startSeconds: start });
    else p.loadVideoById({ videoId: this.track.v, startSeconds: start });
  }
  jumpTo(sub) { if (this.p && this.p.getPlaylistIndex() !== sub) this.p.playVideoAt(sub); }
  subIndex() { return this.p && this.p.getPlaylistIndex ? this.p.getPlaylistIndex() : -1; }
  play() { if (this.p) this.p.playVideo(); return Promise.resolve(); }
  pause() { if (this.p) this.p.pauseVideo(); }
  seek(t) { if (this.p) this.p.seekTo(t, true); }
  time() { return this.p ? this.p.getCurrentTime() : NaN; }
  duration() { return this.p && this.p.getDuration ? this.p.getDuration() : NaN; }
  ready() { return !!this.p; }
  playing() { return !!this.p && this.p.getPlayerState() === 1; }
  stalled() { return !!this.p && [-1, 2, 5].includes(this.p.getPlayerState()); }
  setVolume(v) { this.vol = v; if (this.p && this.p.setVolume) this.p.setVolume(Math.round(v * 100)); }
  dispose() {
    try { if (this.p && this.p.destroy) this.p.destroy(); } catch (err) { /* gone */ }
    this.slot.remove();
  }
}

// -------------------------------------------------------------
class SoundCloudPlayer {
  constructor(track, opts) {
    this.track = track;
    this.opts = opts;
    this.embed = true;
    this.pos = 0;
    this.dur = NaN;
    this.isPlaying = false;
    this.vol = 1;
    const { slot, inner } = tile();
    this.slot = slot;
    const frame = document.createElement("iframe");
    frame.width = String(EMBED_SIZE);
    frame.height = String(EMBED_SIZE);
    frame.allow = "autoplay";
    frame.title = track.t;
    const params = new URLSearchParams({
      url: track.u, auto_play: "false", visual: "true", hide_related: "true",
      show_comments: "false", show_reposts: "false", show_teaser: "false",
    });
    frame.src = "https://w.soundcloud.com/player/?" + params.toString();
    inner.append(frame);
    this.readyP = loadScript("https://w.soundcloud.com/player/api.js", () => !!(window.SC && window.SC.Widget))
      .then(() => new Promise((resolve) => {
        const w = window.SC.Widget(frame);
        const E = window.SC.Widget.Events;
        w.bind(E.READY, () => {
          this.w = w;
          w.getDuration((ms) => { this.dur = ms / 1000; opts.onSettle && opts.onSettle(); });
          resolve(w);
        });
        w.bind(E.PLAY_PROGRESS, (e) => { this.pos = (e && e.currentPosition || 0) / 1000; });
        w.bind(E.PLAY, () => { this.isPlaying = true; opts.onPlaying && opts.onPlaying(); opts.onSettle && opts.onSettle(); });
        w.bind(E.PAUSE, () => { this.isPlaying = false; });
        w.bind(E.FINISH, () => {
          this.isPlaying = false;
          if (opts.loop) { w.seekTo(0); w.play(); return; }
          opts.onEnded && opts.onEnded();
        });
        w.bind(E.ERROR, () => opts.onError && opts.onError("SoundCloud would not play that track."));
      }));
    this.readyP.catch(() => opts.onError && opts.onError("SoundCloud would not load here."));
  }
  async load(start) {
    const w = await this.readyP;
    w.setVolume(Math.round(this.vol * 100));
    this.pending = start;
    w.seekTo(Math.max(0, start || 0) * 1000);
    this.pos = start || 0;
  }
  play() { if (this.w) this.w.play(); return Promise.resolve(); }
  pause() { if (this.w) this.w.pause(); }
  seek(t) { if (this.w) { this.w.seekTo(t * 1000); this.pos = t; } }
  time() { return this.pos; }
  duration() { return this.dur; }
  ready() { return !!this.w; }
  playing() { return this.isPlaying; }
  stalled() { return !!this.w && !this.isPlaying; }
  setVolume(v) { this.vol = v; if (this.w) this.w.setVolume(Math.round(v * 100)); }
  dispose() { try { if (this.w) this.w.pause(); } catch (err) { /* gone */ } this.slot.remove(); }
}

export function createPlayer(track, opts) {
  if (track.k === "yt" || track.k === "ytl") return new YouTubePlayer(track, opts);
  if (track.k === "sc") return new SoundCloudPlayer(track, opts);
  return new AudioPlayer(track, opts);
}

// A one-shot: a soundboard press or a scattered sound. Fire and forget — no sync,
// no seek, nothing for a latecomer to catch up with. Capped, so a burst of presses
// cannot pile up a hundred elements.
const shots = new Set();
export const MAX_SHOTS = 8;

export function playShot(url, volume, { onStart, onEnd, maxSeconds = 0 } = {}) {
  if (shots.size >= MAX_SHOTS) {
    const oldest = shots.values().next().value;
    oldest.dispose();
  }
  const el = document.createElement("audio");
  el.dataset.role = "shot";
  el.src = url;
  el.volume = Math.max(0, Math.min(1, volume));
  mediaBox().append(el);
  let timer = 0;
  const shot = {
    el,
    dispose() {
      clearTimeout(timer);
      el.pause();
      el.remove();
      if (shots.delete(shot) && onEnd) onEnd();
    },
  };
  shots.add(shot);
  el.addEventListener("ended", () => shot.dispose());
  // A failure BEFORE it started is answered by the play() promise below, which
  // may retry; only a failure after it started ends it here.
  let started = false;
  el.addEventListener("error", () => { if (started) shot.dispose(); });
  if (maxSeconds > 0) timer = setTimeout(() => shot.dispose(), maxSeconds * 1000);
  let retried = false;
  const attempt = () => el.play().then(() => { started = true; if (onStart) onStart(); }, () => {
    // A Suno song gets its other file once (see sunoFallback).
    const other = !retried && sunoFallback(el.getAttribute("src"));
    if (!other) { shot.dispose(); return; }
    retried = true;
    el.src = other;
    attempt();
  });
  attempt();
  return shot;
}

export function stopShots() {
  for (const s of [...shots]) s.dispose();
}

export function shotCount() {
  return shots.size;
}
