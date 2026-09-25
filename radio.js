// =============================================================
// radio.js — the names everything shares, and each player's own settings.
// -------------------------------------------------------------
// The rules live in their own modules, all pure and all tested without a browser:
//   sources.js    what a pasted link is, and whether it can be played
//   library.js    the GM's playlists, sounds, scenes and reactions
//   state.js      what is playing, for everyone — the room's record
//   reactions.js  what just happened at a Dreams & Machines table
//   link.js       how the console talks to the radio bar
// =============================================================

export const RADIO_VERSION = "1.0";

// The namespace. A key, never a URL — nothing is fetched from it. Changing it
// orphans every room's radio state and every GM's library, so it needs a migration,
// not a find-and-replace.
export const ID = "com.gsgrimoire.obr-radio";
export const STATE_KEY = `${ID}/state`;     // room metadata: what is playing
export const CHANNEL = `${ID}/events`;      // broadcasts: sounds, shots, clock ticks
export const BAR_ID = `${ID}/bar`;          // the docked player popover
export const SCENE_KEY = `${ID}/scene`;     // Owlbear SCENE metadata: which radio scene goes with it
export const LIBRARY_KEY = `${ID}/library`; // the GM's bar's storage: the library
export const PREFS_KEY = `${ID}/prefs`;     // everyone's bar's storage: volumes, corner
export const RESUME_KEY = `${ID}/resume`;   // the GM's bar's storage: what initiative interrupted

// The Dreams & Machines room record. Read, never written.
export const DNM_ROOM_KEY = "com.thuknights.dnm-rolls/state";

// -------------------------------------------------------------
// Each player's own settings
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
    amb: vol(p.amb, 0.6),
    fx: vol(p.fx, 0.8),
    mute: !!p.mute,
    corner: CORNERS.includes(p.corner) ? p.corner : "bottom-left",
  };
}

// -------------------------------------------------------------
// The docked bar
// -------------------------------------------------------------
// Same approach as the D&M sheet: a popover pinned to a point with disableClickAway,
// so it stays beside the map instead of closing on the first click. Owlbear has no
// setPosition, so moving it means closing and reopening.
export const BAR_WIDTH = 320;
export const BAR_HEIGHT = 96;
export const EMBED_SIZE = 200; // YouTube's policy floor for an embedded player

export function barSize(embeds) {
  const n = Math.max(0, Math.min(4, Math.round(Number(embeds) || 0)));
  return {
    width: Math.max(BAR_WIDTH, n * EMBED_SIZE),
    height: BAR_HEIGHT + (n ? EMBED_SIZE : 0),
  };
}

export function barPopover({ url, corner, viewport, embeds = 0 }) {
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
    ...barSize(embeds),
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
