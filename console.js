// =============================================================
// console.js — the radio's console: playlists, mixer, soundboard, scenes.
// -------------------------------------------------------------
// A remote control for the radio bar. It holds nothing of its own: the library,
// the room and the sound are the bar's, and this page shows what the bar reports
// and asks the bar to change it (see link.js for why, and for the two ways the
// messages travel).
//
//   Inside Owlbear — the toolbar panel. Talks to the bar over a BroadcastChannel.
//   Popped out     — index.html?popout=1, opened by the bar's ⧉ button, for a
//                    second screen. Talks to the bar through window.opener.
//
// Every piece of library text is untrusted (a backup may be anybody's), so
// nothing here is ever put into the page as HTML: text goes in as text.
// =============================================================
import { NS, command, isFromBar, channelName } from "./link.js";
import { parseTrackList, formatTrackList, parseAny, isEmbed, KINDS } from "./sources.js";
import {
  readLibrary, parseSoundList, formatSoundList, soundPages, newId, findScene, MAX_LAYERS,
} from "./library.js";
import { CUES } from "./reactions.js";
import { displayTitle, MAX_EMBEDS } from "./state.js";
import { barPopover, readPrefs, PREFS_KEY, RADIO_VERSION } from "./radio.js";
import { PACKS, addPack, packInstalled, packCounts } from "./packs.js";

const POPOUT = new URLSearchParams(location.search).has("popout");
const $ = (id) => document.getElementById(id);

let model = null;          // the bar's last report
let lastHeard = 0;
let send = () => {};
let obr = null;            // the SDK, inside Owlbear only
const waiting = new Map(); // command id -> resolve

// -------------------------------------------------------------
// Building the page without HTML strings
// -------------------------------------------------------------
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = !!v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function options(select, items, current) {
  for (const [value, label] of items) select.append(h("option", { value, text: label }));
  select.value = current ?? "";
  return select;
}

// Re-rendering a section while someone is typing in it, or has a menu open,
// throws their work away. Such a section is marked stale and redrawn when they
// leave it.
const stale = new Map();
function section(id, build) {
  const box = $(id);
  if (!box) return;
  const active = document.activeElement;
  if (active && box.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) {
    stale.set(id, build);
    return;
  }
  stale.delete(id);
  // Sections return nested lists (a heading, then a row per item); flatten all the
  // way, or an inner list is turned into the text "[object HTMLDivElement]".
  box.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
}
document.addEventListener("focusout", () => {
  setTimeout(() => {
    for (const [id, build] of [...stale]) section(id, build);
  }, 0);
});

let toastTimer = 0;
function toast(msg, bad = false) {
  const t = $("c-toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.hidden = !msg;
  clearTimeout(toastTimer);
  if (msg) toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 7000 : 3000);
}

// -------------------------------------------------------------
// Talking to the bar
// -------------------------------------------------------------
function call(op, args = {}) {
  const msg = command(op, args);
  return new Promise((resolve) => {
    waiting.set(msg.id, resolve);
    send(msg);
    setTimeout(() => {
      if (waiting.delete(msg.id)) resolve({ error: "The radio bar did not answer. Is it open?" });
    }, 6000);
  }).then((r) => {
    if (r && r.error) toast(r.error, true);
    return r || {};
  });
}

function onBar(data) {
  if (!isFromBar(data)) return;
  lastHeard = Date.now();
  if (data.t === "result") {
    const resolve = waiting.get(data.id);
    if (resolve) { waiting.delete(data.id); resolve(data); }
    return;
  }
  model = {
    ...data,
    lib: data.lib ? readLibrary(data.lib) : null,
    prefs: readPrefs(data.prefs),
  };
  render();
}

const hello = () => send({ ns: NS, t: "hello" });

// The bar reports whenever anything changes, and answers every hello; a console
// that has heard nothing for a while has lost its bar.
function connected() {
  return !!model && Date.now() - lastHeard < 12000;
}

// -------------------------------------------------------------
// Everyone
// -------------------------------------------------------------
function renderHeader() {
  $("c-version").textContent = "v" + RADIO_VERSION;
  const conn = $("c-conn");
  conn.textContent = connected() ? (model.role === "GM" ? "Connected · GM" : "Connected") : "Not connected";
  conn.classList.toggle("ok", connected());
  $("c-dnm").hidden = !(connected() && model.info.dnm);
  $("c-dnm").title = "The Dreams & Machines extension is in this room: reactions are live.";

  const nobar = $("c-nobar");
  nobar.hidden = connected();
  if (!connected()) {
    $("c-nobar-text").textContent = POPOUT
      ? (window.opener
        ? "Waiting for the radio bar… If this does not connect, press ⧉ on the radio bar in Owlbear again."
        : "This window is not connected. In Owlbear, press ⧉ on the radio bar to open the console from there.")
      : "The radio bar is not open. It is where the sound plays, and it has to be open for this panel to work.";
    $("c-open-bar").hidden = POPOUT || !obr;
  }
  const gm = connected() && model.role === "GM";
  $("c-tabs").hidden = !gm;
  $("c-main").hidden = !connected();
  if (!gm) showTab("play");
  for (const t of document.querySelectorAll(".tab")) {
    if (!gm && t.dataset.panel !== "play") t.hidden = true;
  }
  for (const id of ["c-music", "c-amb", "c-scenes", "c-board"]) $(id).hidden = !gm;
  // Your own volume belongs with the playing, not above the GM's library editors.
  $("c-me").hidden = gm && tab !== "play";
}

function renderMe() {
  if (!connected()) return;
  const s = model.state;
  const m = s.music;
  $("c-now-title").textContent = m ? displayTitle(m) : s.amb.length ? "Ambience" : "Nothing playing";
  const bits = [];
  if (m) bits.push((m.paused !== null ? "Paused · " : "") + (m.label || KINDS[m.track.k] || ""));
  if (s.amb.length) bits.push(s.amb.map((l) => l.label).join(", "));
  if (s.scene) bits.push("Scene: " + s.scene);
  if (!model.tuned) bits.push("Press Tune in on the radio bar to hear it.");
  $("c-now-sub").textContent = bits.join(" · ");
  const p = model.prefs;
  for (const [id, key] of [["c-v-music", "music"], ["c-v-amb", "amb"], ["c-v-fx", "fx"]]) {
    if (document.activeElement !== $(id)) $(id).value = String(Math.round(p[key] * 100));
  }
  $("c-mute").textContent = p.mute ? "Unmute" : "Mute";
  $("c-mute").setAttribute("aria-pressed", String(p.mute));
}

for (const [id, key] of [["c-v-music", "music"], ["c-v-amb", "amb"], ["c-v-fx", "fx"]]) {
  $(id).addEventListener("input", (ev) => call("prefs.set", { [key]: Number(ev.target.value) / 100 }));
}
$("c-mute").addEventListener("click", () => model && call("prefs.set", { mute: !model.prefs.mute }));

// -------------------------------------------------------------
// Play: music
// -------------------------------------------------------------
let pickedList = "";

function renderMusic() {
  const { lib, state } = model;
  const m = state.music;
  if (!pickedList || !lib.lists.some((l) => l.id === pickedList)) pickedList = (m && m.list) || (lib.lists[0] && lib.lists[0].id) || "";
  const pick = options(h("select", { "aria-label": "Playlist", onchange: (ev) => { pickedList = ev.target.value; } }),
    lib.lists.map((l) => [l.id, `${l.name} (${l.tracks.length})`]), pickedList);
  return [
    h("h2", { text: "Music" }),
    h("div", { class: "now-line" },
      h("strong", { text: m ? displayTitle(m) : "Nothing playing" }),
      m ? h("span", { class: "muted", text: " · " + (m.label || "") + (m.paused !== null ? " · paused" : "") }) : null),
    h("div", { class: "row" },
      h("button", { title: "Previous", "aria-label": "Previous", onclick: () => call("music.prev") }, "⏮"),
      h("button", { class: "primary", onclick: () => call("music.toggle") }, m && m.paused === null ? "❚❚ Pause" : "▶ Play"),
      h("button", { title: "Next", "aria-label": "Next", onclick: () => call("music.next") }, "⏭"),
      h("button", { title: "Stop the music", onclick: () => call("music.stop") }, "■"),
      m ? h("label", { class: "inline" }, "Level ",
        h("input", { type: "range", min: 0, max: 100, value: String(Math.round(m.vol * 100)),
          title: "The music's level for everyone", onchange: (ev) => call("music.vol", { v: Number(ev.target.value) / 100 }) })) : null),
    lib.lists.length
      ? h("div", { class: "row" }, pick, h("button", { onclick: () => pickedList && call("music.play", { list: pickedList }) }, "Play this list"))
      : h("p", { class: "muted", text: "No playlists yet. Make one in Library, or add the GS Grimoire music starter pack there." }),
  ];
}

// -------------------------------------------------------------
// Play: ambience
// -------------------------------------------------------------
let layerDraft = { sound: "", link: "", mode: "loop", min: 20, max: 60 };

function soundOptions(lib, filter = () => true) {
  const select = h("select", { "aria-label": "Sound" });
  select.append(h("option", { value: "", text: "Choose a sound…" }));
  for (const page of soundPages(lib)) {
    const group = h("optgroup", { label: page });
    for (const s of lib.sounds.filter((x) => x.page === page && filter(x))) {
      group.append(h("option", { value: s.id, text: s.name + (isEmbed(s.track) ? " (video)" : "") }));
    }
    if (group.children.length) select.append(group);
  }
  return select;
}

function renderAmb() {
  const { lib, state } = model;
  const rows = state.amb.map((l) => h("div", { class: "layer" },
    h("span", { class: "layer-name", text: l.label, title: KINDS[l.track.k] }),
    h("span", { class: "badge", text: l.mode === "scatter" ? `every ${l.min}–${l.max}s` : "loop" }),
    h("input", { type: "range", min: 0, max: 100, value: String(Math.round(l.vol * 100)), "aria-label": l.label + " level",
      onchange: (ev) => call("layer.vol", { id: l.id, v: Number(ev.target.value) / 100 }) }),
    h("button", { class: "ghost", title: "Stop this layer", "aria-label": "Stop " + l.label, onclick: () => call("layer.remove", { id: l.id }) }, "×")));

  const sel = soundOptions(lib, (s) => layerDraft.mode === "loop" || !isEmbed(s.track));
  sel.value = layerDraft.sound;
  sel.addEventListener("change", (ev) => { layerDraft.sound = ev.target.value; });
  const link = h("input", { type: "text", placeholder: "…or paste a link", value: layerDraft.link,
    oninput: (ev) => { layerDraft.link = ev.target.value; } });
  const mode = options(h("select", { "aria-label": "How it plays", onchange: (ev) => { layerDraft.mode = ev.target.value; section("c-amb", renderAmb); } }),
    [["loop", "Loop"], ["scatter", "Now and then"]], layerDraft.mode);
  const interval = layerDraft.mode === "scatter" ? h("span", { class: "inline" }, "every ",
    h("input", { type: "number", min: 3, max: 600, value: String(layerDraft.min), class: "num", "aria-label": "Shortest wait in seconds",
      oninput: (ev) => { layerDraft.min = Number(ev.target.value); } }), "–",
    h("input", { type: "number", min: 3, max: 900, value: String(layerDraft.max), class: "num", "aria-label": "Longest wait in seconds",
      oninput: (ev) => { layerDraft.max = Number(ev.target.value); } }), " s") : null;

  const add = async () => {
    let args = { mode: layerDraft.mode, min: layerDraft.min, max: layerDraft.max };
    if (layerDraft.link.trim()) {
      const found = parseAny(layerDraft.link);
      if (!found || found.error || !found.tracks.length) { toast(found ? found.error : "Paste a link.", true); return; }
      args.track = found.tracks[0];
    } else if (layerDraft.sound) {
      args.sound = layerDraft.sound;
    } else {
      toast("Choose a sound, or paste a link.", true);
      return;
    }
    const r = await call("layer.add", args);
    if (!r.error) { layerDraft = { ...layerDraft, link: "" }; section("c-amb", renderAmb); }
  };

  return [
    h("h2", { text: `Ambience (${state.amb.length}/${MAX_LAYERS})` }),
    rows.length ? h("div", { class: "layers" }, rows) : h("p", { class: "muted", text: "Nothing layered. Rain, a crowd, a fire — they play under the music." }),
    state.amb.length < MAX_LAYERS ? h("div", { class: "row" }, sel, mode) : null,
    state.amb.length < MAX_LAYERS ? h("div", { class: "row" }, link, interval, h("button", { class: "primary", onclick: add }, "Add")) : null,
    state.amb.length ? h("button", { class: "ghost small", onclick: () => call("layer.clear") }, "Stop all ambience") : null,
    model.info.embeds >= MAX_EMBEDS ? h("p", { class: "muted small", text: `${MAX_EMBEDS} video players are showing, which is all the bar holds.` }) : null,
  ];
}

// -------------------------------------------------------------
// Play: scenes
// -------------------------------------------------------------
let sceneDraft = { name: "", keepMusic: false };

function renderScenes() {
  const { lib, state } = model;
  const buttons = lib.scenes.map((s) => h("button", {
    class: "scene" + (state.scene === s.name ? " on" : ""),
    title: sceneSummary(s, lib),
    onclick: () => call("scene.recall", { id: s.id }),
  }, s.name));
  const save = async () => {
    const name = sceneDraft.name.trim();
    if (!name) { toast("Name the scene first.", true); return; }
    const r = await call("scene.save", { name, keepMusic: sceneDraft.keepMusic });
    if (!r.error) { sceneDraft = { name: "", keepMusic: false }; toast(`Saved "${name}".`); }
  };
  return [
    h("h2", { text: "Scenes" }),
    buttons.length ? h("div", { class: "scenes" }, buttons) : h("p", { class: "muted", text: "A scene is a moment's sound: a playlist and its ambience, recalled in one press. Set up what should play, then save it here — or add the Places & weather starter pack for ten ready-made ones." }),
    h("div", { class: "row" },
      h("input", { type: "text", maxlength: 40, placeholder: "Name what is playing now…", value: sceneDraft.name,
        oninput: (ev) => { sceneDraft.name = ev.target.value; }, onkeydown: (ev) => { if (ev.key === "Enter") save(); } }),
      h("label", { class: "inline muted", title: "Without this, recalling the scene leaves the music alone" },
        h("input", { type: "checkbox", checked: !sceneDraft.keepMusic, onchange: (ev) => { sceneDraft.keepMusic = !ev.target.checked; } }), " with its music"),
      h("button", { onclick: save }, "Save as scene")),
  ];
}

function sceneSummary(scene, lib) {
  const bits = [];
  if (scene.music.mode === "list") {
    const l = lib.lists.find((x) => x.id === scene.music.list);
    bits.push("Music: " + (l ? l.name : "?"));
  } else bits.push(scene.music.mode === "stop" ? "Music: stops" : "Music: unchanged");
  if (scene.amb.length) bits.push("Ambience: " + scene.amb.map((a) => a.label).join(", "));
  return bits.join("\n");
}

// -------------------------------------------------------------
// Play: the soundboard
// -------------------------------------------------------------
let boardPage = "";
const HUES = [205, 25, 140, 280, 0, 50, 175, 320];
const hueFor = (page) => HUES[[...page].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];

function renderBoard() {
  const { lib } = model;
  const pages = soundPages(lib);
  if (!pages.includes(boardPage)) boardPage = pages[0] || "";
  const pads = lib.sounds.filter((s) => s.page === boardPage).map((s) => {
    const playable = s.track.k === "a";
    return h("button", {
      class: "pad", style: `--hue:${hueFor(s.page)}`, disabled: !playable,
      title: playable ? `${s.name} — play for everyone` : `${s.name} is a video: add it as an ambience layer instead`,
      onclick: async (ev) => {
        const b = ev.currentTarget;
        b.classList.add("hit");
        setTimeout(() => b.classList.remove("hit"), 250);
        await call("sound.fire", { id: s.id });
      },
    }, s.name);
  });
  return [
    h("div", { class: "board-head" },
      h("h2", { text: "Soundboard" }),
      h("span", { class: "spacer" }),
      h("button", { class: "ghost small", onclick: () => call("sound.stopAll"), title: "Stop every sound that is playing" }, "■ Stop sounds")),
    pages.length > 1 ? h("div", { class: "pages" }, pages.map((p) => h("button", {
      class: "page" + (p === boardPage ? " on" : ""), style: `--hue:${hueFor(p)}`,
      onclick: () => { boardPage = p; section("c-board", renderBoard); },
    }, p))) : null,
    pads.length ? h("div", { class: "pads" }, pads)
      : h("p", { class: "muted", text: "No sounds yet. Add a starter pack in Library, or your own in Library → Sounds: one line each, \"Name | link\"." }),
  ];
}

// -------------------------------------------------------------
// Library: starter packs
// -------------------------------------------------------------
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function renderPacks() {
  const { lib } = model;
  const cards = PACKS.map((p) => {
    const c = packCounts(p.id);
    const have = packInstalled(lib, p.id);
    const bits = [c.sounds && plural(c.sounds, "sound", "sounds"), c.lists && plural(c.lists, "playlist", "playlists"),
      c.scenes && plural(c.scenes, "scene", "scenes"), c.reactions && plural(c.reactions, "reaction", "reactions")].filter(Boolean);
    const add = async () => {
      const r = addPack(lib, p.id);
      if (r.error) { toast(r.error, true); return; }
      const res = await call("lib.put", { lib: r.lib });
      if (res.error) return;
      const a = r.added;
      const got = [a.sounds && plural(a.sounds, "sound", "sounds"), a.lists && plural(a.lists, "playlist", "playlists"),
        a.scenes && plural(a.scenes, "scene", "scenes"), a.reactions && plural(a.reactions, "reaction", "reactions")].filter(Boolean);
      toast(got.length ? `Added ${got.join(", ")}.` : "You already had all of it.");
    };
    return h("div", { class: "pack" },
      h("div", { class: "pack-text" },
        h("strong", { text: p.name }),
        h("div", { class: "muted small", text: p.blurb }),
        h("div", { class: "muted small", text: bits.join(" · ") })),
      h("button", { class: have ? "" : "primary", disabled: have, onclick: add }, have ? "Added" : "Add"));
  });
  return [
    h("h2", { text: "Starter packs" }),
    h("p", { class: "muted small", text: "Ready-made sounds, ambience, scenes and playlists to start from. Adding a pack never replaces anything you already have." }),
    cards,
    h("p", { class: "muted small" }, "Free sounds from Kenney, OpenGameArt, Freesound and SoundBible, with thanks. ",
      h("a", { href: "credits.html", target: "_blank", rel: "noopener", text: "Credits" })),
  ];
}

// -------------------------------------------------------------
// Library: playlists
// -------------------------------------------------------------
let editList = "";
let listDirty = false;
let listText = "";
let listErrors = [];

function renderLists() {
  const { lib } = model;
  if (!lib.lists.some((l) => l.id === editList)) { editList = lib.lists[0] ? lib.lists[0].id : ""; listDirty = false; }
  const list = lib.lists.find((l) => l.id === editList);
  if (!listDirty) listText = list ? formatTrackList(list.tracks) : "";
  const name = h("input", { type: "text", maxlength: 40, placeholder: "Playlist name", value: list ? list.name : "" });
  const pick = options(h("select", { "aria-label": "Playlist", onchange: (ev) => { editList = ev.target.value; listDirty = false; listErrors = []; section("c-lists", renderLists); } }),
    lib.lists.map((l) => [l.id, `${l.name} (${l.tracks.length})`]), editList);
  const text = h("textarea", { spellcheck: "false", wrap: "off", rows: 10, disabled: !list,
    placeholder: "https://youtube.com/playlist?list=…\nTavern | https://suno.com/song/…\nhttps://soundcloud.com/artist/track",
    oninput: (ev) => { listText = ev.target.value; listDirty = true; } });
  text.value = listText;

  const save = async () => {
    const { tracks, errors } = parseTrackList(listText);
    const next = { ...lib, lists: lib.lists.map((l) => (l.id === editList ? { ...l, name: name.value.trim() || l.name, tracks } : l)) };
    const r = await call("lib.put", { lib: next });
    if (r.error) return;
    listErrors = errors;
    listDirty = errors.length > 0; // keep a box with broken lines as typed, so they can be fixed
    toast(errors.length ? `Saved ${tracks.length}. ${errors.length} line(s) could not be used.` : `Saved ${tracks.length}.`);
    section("c-lists", renderLists);
  };
  const create = async () => {
    const id = newId("l");
    const r = await call("lib.put", { lib: { ...lib, lists: [...lib.lists, { id, name: "New playlist", tracks: [] }] } });
    if (!r.error) { editList = id; listDirty = false; section("c-lists", renderLists); }
  };
  const del = (ev) => confirmTwice(ev.currentTarget, "Delete", async () => {
    await call("lib.put", { lib: { ...lib, lists: lib.lists.filter((l) => l.id !== editList) } });
    editList = "";
  });

  return [
    h("h2", { text: "Playlists" }),
    h("div", { class: "row" }, pick, h("button", { onclick: create }, "New"), list ? h("button", { onclick: del }, "Delete") : null),
    list ? h("div", { class: "row" }, name) : null,
    h("p", { class: "muted small", text: "One link per line, \"Title | link\" to name it. Mix YouTube videos and playlists, Suno songs, SoundCloud tracks, Dropbox and audio-file links. Embed codes can be pasted whole." }),
    text,
    listErrors.map((e) => h("div", { class: "error", text: `Line ${e.line}: ${e.error}` })),
    list ? h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "Save"),
      h("a", { href: "suno.html", target: "_blank", rel: "noopener", text: "Copy a whole Suno playlist at once" })) : null,
  ];
}

// -------------------------------------------------------------
// Library: sounds
// -------------------------------------------------------------
let soundsDirty = false;
let soundsText = "";
let soundsErrors = [];

function renderSounds() {
  const { lib } = model;
  if (!soundsDirty) soundsText = formatSoundList(lib.sounds);
  const text = h("textarea", { spellcheck: "false", wrap: "off", rows: 12,
    placeholder: "## Combat\nSword clash | https://…/sword.mp3\nWarhorn | https://suno.com/song/… | 60\n\n## Weather\nRain | https://youtu.be/…",
    oninput: (ev) => { soundsText = ev.target.value; soundsDirty = true; } });
  text.value = soundsText;
  const save = async () => {
    const { sounds, errors } = parseSoundList(soundsText, lib.sounds);
    const r = await call("lib.put", { lib: { ...lib, sounds } });
    if (r.error) return;
    soundsErrors = errors;
    soundsDirty = errors.length > 0;
    toast(errors.length ? `Saved ${sounds.length}. ${errors.length} line(s) could not be used.` : `Saved ${sounds.length} sounds.`);
    section("c-sounds", renderSounds);
  };
  return [
    h("h2", { text: `Sounds (${lib.sounds.length})` }),
    h("p", { class: "muted small", text: "One sound per line, \"Name | link\". \"## Page\" starts a soundboard page. A number after a second bar is the sound's own volume: \"Horn | link | 60\". Audio files and Suno songs can be pressed on the soundboard; videos can be ambience layers." }),
    text,
    soundsErrors.map((e) => h("div", { class: "error", text: `Line ${e.line}: ${e.error}` })),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "Save sounds"),
      h("button", { onclick: () => preview(soundsText) }, "Hear the first"),
      soundsDirty ? h("button", { class: "ghost", onclick: () => { soundsDirty = false; soundsErrors = []; section("c-sounds", renderSounds); } }, "Undo changes") : null),
  ];
}

// Hearing a sound before saving it plays HERE, in this page, for you alone.
let previewing = null;
function preview(text) {
  const first = String(text).split(/\r?\n/).map((l) => parseAny(l.replace(/\|\s*\d{1,3}\s*%?\s*$/, ""))).find((f) => f && f.tracks && f.tracks.length);
  const track = first && first.tracks[0];
  if (!track || track.k !== "a") { toast("Only audio files and Suno songs can be heard here.", true); return; }
  if (previewing) previewing.pause();
  previewing = new Audio(track.u);
  previewing.volume = model ? model.prefs.fx : 0.8;
  previewing.play().catch(() => toast("That would not play.", true));
  setTimeout(() => previewing && previewing.pause(), 8000);
}

// -------------------------------------------------------------
// Library: scenes
// -------------------------------------------------------------
function renderSceneList() {
  const { lib } = model;
  const rows = lib.scenes.map((s) => h("div", { class: "scene-row" },
    h("div", {}, h("strong", { text: s.name }), h("div", { class: "muted small pre", text: sceneSummary(s, lib) })),
    h("div", { class: "row" },
      h("button", { onclick: () => call("scene.recall", { id: s.id }) }, "Play"),
      h("button", { title: "Replace this scene with what is playing now", onclick: () => call("scene.save", { id: s.id, keepMusic: s.music.mode === "keep" }).then((r) => !r.error && toast(`Updated "${s.name}".`)) }, "Update from now"),
      h("button", { onclick: (ev) => confirmTwice(ev.currentTarget, "Delete", () => call("lib.put", { lib: { ...lib, scenes: lib.scenes.filter((x) => x.id !== s.id) } })) }, "Delete"))));
  return [
    h("h2", { text: `Scenes (${lib.scenes.length})` }),
    rows.length ? rows : h("p", { class: "muted", text: "Save scenes from the Play tab." }),
  ];
}

// -------------------------------------------------------------
// Reactions
// -------------------------------------------------------------
function renderObrScene() {
  const { lib, info } = model;
  const bound = info.obrScene.bound;
  const pick = options(h("select", { "aria-label": "Radio scene for this Owlbear scene" }),
    [["", "— nothing —"], ...lib.scenes.map((s) => [s.id, s.name])], bound);
  return [
    h("h2", { text: "Owlbear scenes" }),
    info.obrScene.ready
      ? h("p", { text: bound && findScene(lib, bound) ? `This Owlbear scene plays "${findScene(lib, bound).name}" when it opens.` : "This Owlbear scene has no radio scene." })
      : h("p", { class: "muted", text: "Open a scene in Owlbear to give it a radio scene." }),
    h("div", { class: "row" }, pick,
      h("button", { disabled: !info.obrScene.ready, onclick: () => call("scene.bind", { id: pick.value }).then((r) => !r.error && toast("Done.")) }, "Set for this Owlbear scene")),
    h("label", { class: "inline" },
      h("input", { type: "checkbox", checked: lib.autoScenes, onchange: (ev) => call("lib.put", { lib: { ...lib, autoScenes: ev.target.checked } }) }),
      " Play the radio scene when I switch Owlbear scenes"),
  ];
}

function renderReactions() {
  const { lib, info } = model;
  const soundItems = [["", "—"], ...lib.sounds.filter((s) => s.track.k === "a").map((s) => [s.id, `${s.page}: ${s.name}`])];
  const sceneItems = [["", "—"], ...lib.scenes.map((s) => [s.id, s.name])];
  const draft = JSON.parse(JSON.stringify(lib.reactions));
  const rows = CUES.map(([cue, label]) => {
    const r = draft[cue] || { sound: "", scene: "", restore: false };
    draft[cue] = r;
    return h("tr", {},
      h("th", { scope: "row", text: label }),
      h("td", {}, options(h("select", { "aria-label": label + ": sound", onchange: (ev) => { r.sound = ev.target.value; } }), soundItems, r.sound)),
      h("td", {}, options(h("select", { "aria-label": label + ": scene", onchange: (ev) => { r.scene = ev.target.value; } }), sceneItems, r.scene)),
      h("td", {}, cue === "combatEnd" ? h("label", { class: "inline small", title: "Bring back whatever was playing when initiative started" },
        h("input", { type: "checkbox", checked: r.restore, onchange: (ev) => { r.restore = ev.target.checked; } }), " go back") : null));
  });
  return [
    h("h2", { text: "Reactions to Dreams & Machines" }),
    h("p", { class: info.dnm ? "" : "muted", text: info.dnm
      ? "The D&M extension is in this room. What happens at the table can play a sound and change the scene."
      : "The Dreams & Machines extension is not in this room. These do nothing until it is — everything else works without it." }),
    h("p", { class: "muted small", text: "Hidden rolls never trigger anything: a sound would give their result away." }),
    h("table", { class: "react" },
      h("thead", {}, h("tr", {}, h("th", { text: "When" }), h("th", { text: "Sound" }), h("th", { text: "Scene" }), h("th", { text: "" }))),
      h("tbody", {}, rows)),
    h("button", { class: "primary", onclick: () => call("lib.put", { lib: { ...lib, reactions: draft } }).then((r) => !r.error && toast("Reactions saved.")) }, "Save reactions"),
  ];
}

// -------------------------------------------------------------
// Settings
// -------------------------------------------------------------
function renderSettings() {
  const { lib } = model;
  return [
    h("h2", { text: "Settings" }),
    h("label", { class: "inline" }, h("input", { type: "checkbox", checked: lib.shuffle,
      onchange: (ev) => call("lib.put", { lib: { ...lib, shuffle: ev.target.checked } }) }), " Shuffle playlists"),
    h("label", { class: "inline" }, "Fade in and out over ",
      h("input", { type: "number", class: "num", min: 0, max: 6, step: 0.5, value: String(lib.fadeSeconds),
        onchange: (ev) => call("lib.put", { lib: { ...lib, fadeSeconds: Number(ev.target.value) } }) }), " seconds"),
    h("p", { class: "muted small", text: POPOUT
      ? "This window is a remote control for the radio bar in Owlbear. Close it any time; the sound carries on."
      : "Want the soundboard on another screen? Press ⧉ on the radio bar to open this console in its own window." }),
  ];
}

let backupText = "";
function renderBackup() {
  const box = h("textarea", { spellcheck: "false", rows: 6, placeholder: "Your library as text appears here.",
    oninput: (ev) => { backupText = ev.target.value; } });
  box.value = backupText;
  return [
    h("h2", { text: "Backup" }),
    h("p", { class: "muted small", text: "Your library lives in this browser, with the radio bar. Copy it somewhere safe, or paste one in to load it — on another computer, or from another GM." }),
    box,
    h("div", { class: "row" },
      h("button", { onclick: () => { backupText = JSON.stringify(model.lib, null, 1); section("c-backup", renderBackup); } }, "Show my library"),
      h("button", { onclick: (ev) => {
        let raw;
        try { raw = JSON.parse(backupText); } catch (err) { toast("That is not a library.", true); return; }
        const lib = readLibrary(raw);
        if (!lib.lists.length && !lib.sounds.length) { toast("Nothing in that to load.", true); return; }
        confirmTwice(ev.currentTarget, "Load this library", () => call("lib.put", { lib }).then((r) => !r.error && toast(`Loaded ${lib.lists.length} playlist(s), ${lib.sounds.length} sound(s), ${lib.scenes.length} scene(s).`)));
      } }, "Load this library")),
  ];
}

// No confirm(): a framed page may refuse modal dialogs. Press twice instead.
function confirmTwice(button, label, action) {
  if (button.dataset.armed) {
    delete button.dataset.armed;
    button.textContent = label;
    action();
    return;
  }
  button.dataset.armed = "1";
  button.textContent = "Sure?";
  setTimeout(() => { if (button.dataset.armed) { delete button.dataset.armed; button.textContent = label; } }, 3000);
}

// -------------------------------------------------------------
// Tabs and rendering
// -------------------------------------------------------------
let tab = "play";
let shownError = "";
function showTab(name) {
  tab = name;
  for (const b of document.querySelectorAll("#c-tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const t of document.querySelectorAll(".tab")) t.hidden = t.dataset.panel !== name;
}
for (const b of document.querySelectorAll("#c-tabs button")) {
  b.addEventListener("click", () => { showTab(b.dataset.tab); render(); });
}

function render() {
  renderHeader();
  if (!connected()) return;
  renderMe();
  if (model.role !== "GM" || !model.lib) return;
  if (model.info.error && model.info.error !== shownError) toast(model.info.error, true);
  shownError = model.info.error;
  if (tab === "play") {
    section("c-music", renderMusic);
    section("c-amb", renderAmb);
    section("c-scenes", renderScenes);
    section("c-board", renderBoard);
  } else if (tab === "library") {
    section("c-packs", renderPacks);
    section("c-lists", renderLists);
    section("c-sounds", renderSounds);
    section("c-scene-list", renderSceneList);
  } else if (tab === "reactions") {
    section("c-obrscene", renderObrScene);
    section("c-react", renderReactions);
  } else {
    section("c-settings", renderSettings);
    section("c-backup", renderBackup);
  }
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function openBar() {
  if (!obr) return;
  let prefs = readPrefs(null);
  try { prefs = readPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null")); } catch (err) { /* default */ }
  let viewport = null;
  try { viewport = { width: await obr.viewport.getWidth(), height: await obr.viewport.getHeight() }; } catch (err) { /* default */ }
  await obr.popover.open(barPopover({ url: new URL("bar.html", location.href).href, corner: prefs.corner, viewport }));
}
$("c-open-bar").addEventListener("click", openBar);

async function start() {
  render();
  if (POPOUT) {
    document.body.classList.add("popout");
    window.addEventListener("message", (ev) => {
      if (!window.opener || ev.source !== window.opener || ev.origin !== location.origin) return;
      onBar(ev.data);
    });
    send = (msg) => { try { if (window.opener) window.opener.postMessage(msg, location.origin); } catch (err) { /* gone */ } };
  } else {
    const mod = await import("./sdk.js");
    obr = mod.default;
    await new Promise((resolve) => obr.onReady(resolve));
    const bc = new BroadcastChannel(channelName(obr.room.id));
    bc.onmessage = (ev) => onBar(ev.data);
    send = (msg) => bc.postMessage(msg);
    // Give the GM's console room to breathe; players only need the top card.
    try {
      const role = await obr.player.getRole();
      if (role === "GM") { await obr.action.setWidth(520); await obr.action.setHeight(760); }
    } catch (err) { /* keep the manifest size */ }
  }
  hello();
  // Ask often while unanswered; otherwise every five seconds, which is how a bar
  // that closed is noticed.
  let beat = 0;
  setInterval(() => {
    beat += 1;
    if (!connected() || beat % 5 === 0) hello();
    renderHeader();
  }, 1000);
}
start();
