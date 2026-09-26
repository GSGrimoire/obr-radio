// =============================================================
// link.js — how the console talks to the radio bar.
// -------------------------------------------------------------
// The bar is the only page that holds the Owlbear SDK for the radio's writes, the
// only one that keeps the GM's library, and the only one that conducts. The
// console — the playlists, the mixer, the soundboard — is a remote control for it,
// and can run in two places:
//
//   INSIDE OWLBEAR (the toolbar panel): the console and the bar are two frames in
//   the same Owlbear tab, from the same site, so a BroadcastChannel reaches between
//   them. They share a storage partition, which is what a channel needs.
//
//   IN ITS OWN WINDOW (popped out, for a second screen): a window on its own is a
//   different storage partition from the frames inside Owlbear, so no channel and
//   no shared storage can reach across. Dreams & Machines learned that the hard
//   way (v1.29's popped-out sheet never connected). What DOES reach is postMessage
//   between a window and the window that opened it — so the BAR opens the console
//   window, and the two talk directly. That is also why the library lives with the
//   bar: the popped-out window has its own, empty, storage.
//
// Every message carries ns so a stray same-site message is ignored, and every
// command is re-checked by the bar with the same readers as everything else.
// =============================================================

export const NS = "gsradio";

export const OPS = new Set([
  // everyone
  "prefs.set", "pad.press",
  // GM
  "music.play", "music.toggle", "music.next", "music.prev", "music.stop", "music.vol",
  "layer.add", "layer.remove", "layer.vol", "layer.pause", "layer.clear",
  "sound.fire", "sound.stopAll", "sound.preview",
  "scene.recall", "scene.stop", "scene.save", "scene.bind",
  // lib.put replaces the whole library, for the editors that own a whole part of
  // it. A single setting or reaction is changed with lib.set and react.set, which
  // the bar merges into the library it holds: two quick changes built from the
  // same stale copy would otherwise undo each other.
  "lib.put", "lib.set", "react.set",
]);

export const GM_ONLY = new Set([...OPS].filter((op) => !["prefs.set", "sound.preview", "pad.press"].includes(op)));

export function channelName(roomId) {
  return `${NS}:${String(roomId || "room").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)}`;
}

// A message from the console, or null if it is not one.
export function readCommand(data) {
  if (!data || typeof data !== "object" || data.ns !== NS || data.t !== "cmd") return null;
  if (!OPS.has(data.op)) return null;
  const id = typeof data.id === "string" ? data.id.slice(0, 40) : "";
  const args = data.args && typeof data.args === "object" ? data.args : {};
  return { id, op: data.op, args };
}

export const isHello = (data) => !!data && data.ns === NS && data.t === "hello";
export const isFromBar = (data) => !!data && data.ns === NS && (data.t === "state" || data.t === "result");

export function command(op, args = {}, rand = Math.random) {
  return { ns: NS, t: "cmd", id: Math.floor(rand() * 1e12).toString(36), op, args };
}

// -------------------------------------------------------------
// Two routes inside Owlbear, belt and braces (1.1C)
// -------------------------------------------------------------
// The first install showed a panel that never heard its bar, and nothing here can
// reproduce Owlbear to say why. So inside Owlbear every message goes BOTH ways:
//   · a BroadcastChannel, as before, and
//   · Owlbear's own broadcast, destination "LOCAL" — this client only — which is
//     how the D&M sheet and roller already talk, proven at the table.
// Each message carries an id, and whichever copy arrives second is dropped.
// Owlbear's broadcast has a size limit, and a library with the starter packs is
// larger, so on that route a big message travels in numbered pieces.
export const LINK_OBR_CHANNEL = "com.gsgrimoire.obr-radio/link";
export const PIECE = 30000;

export function stamp(msg, rand = Math.random) {
  return msg.mid ? msg : { ...msg, mid: Math.floor(rand() * 1e15).toString(36) + Date.now().toString(36) };
}

// A message as pieces for Owlbear's route. Small ones go whole.
export function toPieces(msg) {
  const text = JSON.stringify(msg);
  if (text.length <= PIECE) return [msg];
  const n = Math.ceil(text.length / PIECE);
  return Array.from({ length: n }, (_, i) => ({ ns: NS, t: "piece", mid: msg.mid, i, n, part: text.slice(i * PIECE, (i + 1) * PIECE) }));
}

// Puts pieces back together. Returns the whole message when the last piece lands,
// the message itself when it was never cut, and null otherwise. Bounded: a
// message still incomplete after 20 seconds is forgotten.
export function makeAssembler(now = () => Date.now()) {
  const open = new Map();
  return (data) => {
    if (!data || data.ns !== NS) return null;
    if (data.t !== "piece") return data;
    const n = Math.round(Number(data.n));
    const i = Math.round(Number(data.i));
    if (!data.mid || !(n > 0 && n <= 400) || !(i >= 0 && i < n) || typeof data.part !== "string") return null;
    for (const [k, v] of open) if (now() - v.t > 20000) open.delete(k);
    let entry = open.get(data.mid);
    if (!entry) { entry = { t: now(), n, parts: new Array(n) }; open.set(data.mid, entry); }
    entry.parts[i] = data.part;
    if (entry.parts.filter((p) => typeof p === "string").length < entry.n) return null;
    open.delete(data.mid);
    try { return JSON.parse(entry.parts.join("")); } catch (err) { return null; }
  };
}

// Drops the second copy of a message that came both ways.
export function makeDeduper(size = 200) {
  const seen = [];
  const set = new Set();
  return (msg) => {
    if (!msg || !msg.mid) return true;
    if (set.has(msg.mid)) return false;
    set.add(msg.mid);
    seen.push(msg.mid);
    if (seen.length > size) set.delete(seen.shift());
    return true;
  };
}
