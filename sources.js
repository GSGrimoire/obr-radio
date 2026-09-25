// =============================================================
// sources.js — what a pasted link IS, and whether it can be played.
// -------------------------------------------------------------
// Pure: no SDK, no DOM. Every link the radio accepts is turned into a small
// "track" object here, and every track read back from storage or the room is
// checked here again on the way out.
//
// A track is one of four shapes. Keys are short because the live ones are written
// to room metadata, and that 16 kB is shared with every extension in the room —
// Dreams & Machines alone reserves 11 kB of it.
//
//   { k: "a",   u: "https://…",          t }  a streamable audio file. A Suno song
//                                             and a Dropbox file are both this.
//   { k: "yt",  v: "<11-char video id>", t }  one YouTube video
//   { k: "ytl", l: "<playlist id>",      t }  a whole YouTube playlist
//   { k: "sc",  u: "https://soundcloud…",t }  one SoundCloud track
//
// `s` (the link as pasted) is kept only in the GM's library so the editor can show
// it back. Nothing needs it to PLAY, and it never goes into the room.
// =============================================================

export const TITLE_MAX = 80;
export const URL_MAX = 600;

const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{2,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
// SoundCloud paths the widget can play: /user/track, or an API track id.
const SC_PATH = /^\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,200}$/;
const SC_API = /^\/tracks\/\d{1,20}$/;
// Paths under a SoundCloud user that are pages, not tracks.
const SC_NOT_TRACKS = new Set(["sets", "tracks", "albums", "likes", "reposts", "followers",
  "following", "popular-tracks", "comments", "spotlight", "stations"]);

export const KINDS = { a: "Audio file", yt: "YouTube video", ytl: "YouTube playlist", sc: "SoundCloud" };

// Sources that need a visible player on screen. YouTube's developer policies do
// not allow a hidden or tiny embedded player, and SoundCloud's widget is treated
// the same way. The bar has room for a limited number of these at once.
export function isEmbed(track) {
  return !!track && (track.k === "yt" || track.k === "ytl" || track.k === "sc");
}

export function cleanText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, max);
}

// The one gate for a URL that will be handed to a player. https only: a page served
// over https cannot load http media anyway, and refusing everything else here means
// a hostile state cannot smuggle in javascript:, data: or blob:.
export function safeUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text.length > URL_MAX) return "";
  let url;
  try { url = new URL(text); } catch (err) { return ""; }
  if (url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  return url.href;
}

// Where a Suno song can be streamed from another site. Suno has no public API, so
// this is simply what Suno publishes, checked 2026-09-25:
//
//   <uuid>.mp3  on cdn1   CLOSED. The song page now reports its audio_url as
//                         ".../api/forbidden" and the CDN answers 403.
//   <uuid>.m4a  (CloudFront, the page's "media_urls") is SCRAMBLED — no valid audio
//                         header; Suno's own player unscrambles it. Deliberately
//                         protected, so deliberately not used.
//   <uuid>.mp4  on cdn1   OPEN: the song's share video, served to any site
//                         (Access-Control-Allow-Origin: *) with byte ranges. Its
//                         audio track is ordinary AAC, which every browser plays in
//                         an <audio> element.
//
// So the share video it is. It is one function on purpose: when Suno changes this
// again, this is the line that changes. sunoFallback() keeps a library saved with
// the old .mp3 addresses working, and gives newer songs a second chance.
const SUNO_FILE = /^https:\/\/cdn1\.suno\.ai\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(mp3|mp4)$/i;

export function sunoAudioUrl(uuid) {
  return `https://cdn1.suno.ai/${uuid.toLowerCase()}.mp4`;
}

// The other Suno file to try when one will not play, or "" when there is none.
export function sunoFallback(url) {
  const m = SUNO_FILE.exec(String(url || ""));
  if (!m) return "";
  return `https://cdn1.suno.ai/${m[1].toLowerCase()}.${m[2].toLowerCase() === "mp4" ? "mp3" : "mp4"}`;
}

// A Dropbox share link opens a web page (dl=0). The same link with raw=1 is the
// file itself, and Dropbox serves it with byte ranges, so it seeks properly.
export function dropboxRaw(url) {
  const u = new URL(url.href);
  u.searchParams.delete("dl");
  u.searchParams.set("raw", "1");
  return u.href;
}

function withScheme(text) {
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : "https://" + text;
}

function bareHost(host) {
  return host.toLowerCase().replace(/^(www|m|music|mobile)\./, "");
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

function scTitle(path) {
  const last = path.split("/").filter(Boolean).pop() || "";
  return cleanText(last.replace(/[-_]+/g, " "), TITLE_MAX) || "SoundCloud";
}

// Turns one pasted link into a track, or says in plain words why it cannot.
// Returns { track } or { error }.
export function parseLink(raw) {
  let text = String(raw ?? "").trim();
  if (!text) return { error: "Empty link." };
  // "#audio" at the end: "trust me, this is an audio file". For hosts whose file
  // links carry no extension.
  const forced = /#audio$/i.test(text);
  if (forced) text = text.replace(/#audio$/i, "");
  let url;
  try { url = new URL(withScheme(text)); } catch (err) {
    return { error: "That is not a link." };
  }
  if (!/^https?:$/.test(url.protocol)) return { error: "Only web links can be played." };
  const host = bareHost(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);
  const src = String(raw).trim();

  // --- YouTube ---
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "youtu.be") {
    const list = url.searchParams.get("list");
    // A link carrying a playlist means the playlist, even when it also names the
    // video it was copied from — that is what Share on a playlist produces. Mixes
    // (RD…) are generated per viewer and cannot be played in step.
    if (list && !/^RD/.test(list)) {
      if (!YT_LIST.test(list)) return { error: "That YouTube playlist id does not look right." };
      return { track: { k: "ytl", l: list, t: "YouTube playlist", s: src } };
    }
    let id = "";
    if (host === "youtu.be") id = parts[0] || "";
    else if (parts[0] === "watch") id = url.searchParams.get("v") || "";
    else if (["shorts", "embed", "live", "v"].includes(parts[0])) id = parts[1] || "";
    if (YT_VIDEO.test(id)) return { track: { k: "yt", v: id, t: "YouTube video", s: src } };
    return { error: "That YouTube link names no video or playlist." };
  }

  // --- Suno ---
  if (host === "suno.com" || host === "app.suno.ai" || host === "suno.ai") {
    if ((parts[0] === "song" || parts[0] === "embed") && UUID.test(parts[1] || "")) {
      return { track: { k: "a", u: sunoAudioUrl(parts[1]), t: "Suno song", s: src } };
    }
    if (parts[0] === "s") {
      return { error: "Suno short links (suno.com/s/…) cannot be read from here. "
        + "Open it, and paste the address it turns into: suno.com/song/…" };
    }
    if (parts[0] === "playlist") {
      return { error: "Suno playlists cannot be read from here. Use the Copy for Radio bookmark, "
        + "or paste the songs one per line." };
    }
    return { error: "That Suno link names no song." };
  }
  if (/^cdn\d*\.suno\.ai$/.test(host)) {
    const id = (parts[0] || "").replace(/\.(mp3|mp4)$/i, "");
    if (UUID.test(id)) return { track: { k: "a", u: sunoAudioUrl(id), t: "Suno song", s: src } };
    return { error: "That Suno file link names no song." };
  }

  // --- SoundCloud ---
  if (host === "w.soundcloud.com") {
    // An embed code's src: the real link is its url= parameter.
    const inner = url.searchParams.get("url");
    if (inner) {
      const found = parseLink(inner);
      if (found.track) found.track.s = src;
      return found;
    }
    return { error: "That SoundCloud embed names no track." };
  }
  if (host === "on.soundcloud.com") {
    return { error: "SoundCloud short links cannot be read from here. Open it, and paste the "
      + "address it turns into: soundcloud.com/…" };
  }
  if (host === "api.soundcloud.com") {
    if (SC_API.test(url.pathname)) {
      return { track: { k: "sc", u: `https://api.soundcloud.com${url.pathname}`, t: "SoundCloud track", s: src } };
    }
    if (/^\/playlists\//.test(url.pathname)) {
      return { error: "SoundCloud playlists cannot be played in step. Paste the tracks one per line." };
    }
    return { error: "That SoundCloud link names no track." };
  }
  if (host === "soundcloud.com") {
    if (parts[1] === "sets") {
      return { error: "SoundCloud playlists cannot be played in step. Paste the tracks one per line." };
    }
    if (parts.length === 2 && !SC_NOT_TRACKS.has(parts[1]) && SC_PATH.test("/" + parts.join("/"))) {
      const path = "/" + parts.join("/");
      return { track: { k: "sc", u: `https://soundcloud.com${path}`, t: scTitle(path), s: src } };
    }
    return { error: "That SoundCloud link names no track." };
  }

  // --- Google Drive: no longer streamable anywhere, so say so rather than fail later.
  if (host === "drive.google.com" || host === "docs.google.com") {
    return { error: "Google Drive no longer lets its files play on other sites. Try Dropbox." };
  }

  // --- Dropbox ---
  if (host === "dropbox.com" || host === "dl.dropboxusercontent.com") {
    if (!AUDIO_EXT.test(url.pathname) && !forced) {
      return { error: "That Dropbox link is not an audio file (.mp3, .ogg, .wav…)." };
    }
    const u = safeUrl(host === "dropbox.com" ? dropboxRaw(url) : url.href);
    if (!u) return { error: "Audio links must start with https://." };
    return { track: { k: "a", u, t: fileTitle(u), s: src } };
  }

  // --- anything else that is plainly an audio file ---
  if (AUDIO_EXT.test(url.pathname) || forced) {
    const u = safeUrl(url.href);
    if (!u) return { error: "Audio links must start with https://." };
    return { track: { k: "a", u, t: fileTitle(u), s: src } };
  }

  return { error: "Not a link the radio can play. YouTube, Suno, SoundCloud, Dropbox and "
    + "direct audio files work; add #audio to the end if this is an audio file without an extension." };
}

// One editor line: "Title | link", or just the link. The title is whichever side is
// NOT the link, so "link | Title" works too — people paste both ways round.
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

// Every link in a line that is not a plain "Title | link" line: an embed code, a
// paragraph copied from a web page, several links on one row. An embed carries
// the same song twice (src and the fallback href), so repeats collapse to one.
const URL_IN_TEXT = /https?:\/\/[^\s"'<>|]+/gi;

function parseMany(line) {
  const urls = (line.replace(/&amp;/g, "&").match(URL_IN_TEXT) || [])
    .map((u) => u.replace(/[.,;:!?)\]]+$/, ""));
  const tracks = [];
  const seen = new Set();
  let firstError = "";
  for (const u of urls) {
    const found = parseLink(u);
    if (found.error) { firstError = firstError || found.error; continue; }
    const key = trackKey(found.track);
    if (seen.has(key)) continue;
    seen.add(key);
    found.track.s = u;
    tracks.push(found.track);
  }
  return { tracks, error: tracks.length ? "" : firstError || "No link found in this line." };
}

// One line of an editor box, however it was pasted: a list of tracks, or an error.
export function parseAny(line) {
  const text = String(line ?? "").trim();
  if (!text || text.startsWith("#")) return null;
  const links = (text.match(URL_IN_TEXT) || []).length;
  if (/[<>]/.test(text) || links > 1) return parseMany(text);
  const one = parseLine(text);
  return one.error ? { tracks: [], error: one.error } : { tracks: [one.track], error: "" };
}

// A whole editor box. Every line is accounted for: tracks, or an error naming the
// line, so a typo is pointed at rather than silently dropped.
export function parseTrackList(text, max = 200) {
  const tracks = [];
  const errors = [];
  String(text ?? "").split(/\r?\n/).forEach((line, i) => {
    const found = parseAny(line);
    if (!found) return;
    if (found.error) { errors.push({ line: i + 1, error: found.error }); return; }
    for (const t of found.tracks) if (tracks.length < max) tracks.push(t);
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

// Untrusted on the way OUT, like everything read from the room or from a pasted
// backup. Returns a clean track or null. `keepSource` is for the library.
export function readTrack(raw, { keepSource = false } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const t = cleanText(raw.t, TITLE_MAX);
  const s = keepSource ? cleanText(raw.s, URL_MAX) : "";
  const extra = s ? { s } : {};
  if (raw.k === "yt" && YT_VIDEO.test(raw.v)) return { k: "yt", v: raw.v, t: t || "YouTube video", ...extra };
  if (raw.k === "ytl" && YT_LIST.test(raw.l)) return { k: "ytl", l: raw.l, t: t || "YouTube playlist", ...extra };
  if (raw.k === "a") {
    const u = safeUrl(raw.u);
    if (u) return { k: "a", u, t: t || "Audio", ...extra };
  }
  if (raw.k === "sc") {
    const u = safeUrl(raw.u);
    if (u) {
      const url = new URL(u);
      const okHost = url.hostname === "soundcloud.com" ? SC_PATH.test(url.pathname)
        : url.hostname === "api.soundcloud.com" ? SC_API.test(url.pathname) : false;
      if (okHost && !url.search) return { k: "sc", u, t: t || "SoundCloud", ...extra };
    }
  }
  return null;
}

// What identifies "the same thing". A new key means load; the same key means seek
// at most.
export function trackKey(track, sub = 0) {
  if (!track) return "";
  if (track.k === "yt") return "yt:" + track.v;
  if (track.k === "ytl") return `ytl:${track.l}:${sub}`;
  if (track.k === "sc") return "sc:" + track.u;
  return "a:" + track.u;
}

// The room copy of a track: no pasted link, nothing the players do not need.
export function roomTrack(track) {
  return readTrack(track);
}
