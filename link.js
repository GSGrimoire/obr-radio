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
  "prefs.set",
  // GM
  "music.play", "music.toggle", "music.next", "music.prev", "music.stop", "music.vol",
  "layer.add", "layer.remove", "layer.vol", "layer.clear",
  "sound.fire", "sound.stopAll", "sound.preview",
  "scene.recall", "scene.save", "scene.bind",
  "lib.put",
]);

export const GM_ONLY = new Set([...OPS].filter((op) => op !== "prefs.set" && op !== "sound.preview"));

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
