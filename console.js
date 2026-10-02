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
import {
  NS, command, isFromBar, channelName, LINK_OBR_CHANNEL, stamp, toPieces, makeAssembler, makeDeduper,
} from "./link.js";
import { parseTrackList, formatTrackList, parseAny, isEmbed, KINDS, trackLink } from "./sources.js";
import {
  readLibrary, parseSoundList, formatSoundList, soundPages, newId, findScene, MAX_LAYERS, CROSSFADE_MAX, readPadList,
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
//
// "When they leave it" is NOT the moment focus leaves: pressing a button moves
// focus off the box being typed in at the press, and a redraw then replaces the
// button between the press and the release — the click is lost, and the button
// has to be pressed twice. So nothing is redrawn while a pointer is down; the
// stale sections wait for the click to land first.
const stale = new Map();
let pointerDown = false;
function section(id, build) {
  const box = $(id);
  if (!box) return;
  const active = document.activeElement;
  if (pointerDown || (active && box.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName))) {
    stale.set(id, build);
    return;
  }
  stale.delete(id);
  // Sections return nested lists (a heading, then a row per item); flatten all the
  // way, or an inner list is turned into the text "[object HTMLDivElement]".
  box.replaceChildren(...[build()].flat(Infinity).filter(Boolean));
}
function flushStale() {
  for (const [id, build] of [...stale]) section(id, build);
}
document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
// The click is dispatched after pointerup in the same turn, so a timeout lands
// after it.
const release = () => { pointerDown = false; setTimeout(flushStale, 0); };
document.addEventListener("pointerup", release, true);
document.addEventListener("pointercancel", release, true);
document.addEventListener("focusout", () => { setTimeout(() => { if (!pointerDown) flushStale(); }, 0); });

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

let lastReport = "";
function onBar(data) {
  if (!isFromBar(data)) return;
  lastHeard = Date.now();
  if (data.t === "result") {
    const resolve = waiting.get(data.id);
    if (resolve) { waiting.delete(data.id); resolve(data); }
    return;
  }
  // The bar answers every hello with a full report. One that says nothing new
  // redraws nothing: a redraw under someone's pointer costs them their click.
  const { mid: _, ...report } = data;
  const text = JSON.stringify(report);
  if (text === lastReport && model) { renderHeader(); return; }
  lastReport = text;
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
    $("c-nobar-text").textContent = noBarText();
    $("c-open-bar").hidden = POPOUT;
  }
  const gm = connected() && model.role === "GM";
  $("c-tabs").hidden = !gm;
  $("c-main").hidden = !connected();
  if (!gm) showTab("play");
  for (const t of document.querySelectorAll(".tab")) {
    if (!gm && t.dataset.panel !== "play") t.hidden = true;
  }
  for (const id of ["c-music", "c-amb", "c-scenes", "c-board", "c-searchbar"]) $(id).hidden = !gm;
  document.body.classList.toggle("gm", gm);
  $("c-ppads").hidden = gm || !connected() || !readPadList(model.info.pads).length;
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
  else if (model.info.click) bits.push("A video on the radio bar is waiting for a click: press ▶ on it once.");
  if (model.info.held) bits.push("You paused a video on your bar. Press play on it to hear it again.");
  $("c-now-sub").textContent = bits.join(" · ");
  const p = model.prefs;
  for (const [id, key] of [["c-v-music", "music"], ["c-v-amb", "amb"], ["c-v-fx", "fx"]]) {
    if (document.activeElement !== $(id)) $(id).value = String(Math.round(p[key] * 100));
    setKnob($(id).parentElement, Number($(id).value) / 100);
    $(id).parentElement.classList.toggle("off", p.mute);
  }
  $("c-mute").setAttribute("aria-pressed", String(p.mute));
  $("c-me-record").classList.toggle("spin", !!(m && m.paused === null && model.tuned && !p.mute));
}

for (const [id, key] of [["c-v-music", "music"], ["c-v-amb", "amb"], ["c-v-fx", "fx"]]) {
  $(id).addEventListener("input", (ev) => call("prefs.set", { [key]: Number(ev.target.value) / 100 }));
}
$("c-mute").addEventListener("click", () => model && call("prefs.set", { mute: !model.prefs.mute }));

// -------------------------------------------------------------
// Brass and bakelite: icons and knobs, built without HTML strings
// -------------------------------------------------------------
const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) node.append(kid);
  return node;
}
const ICONS = {
  play: () => [svg("path", { d: "M8 5l11 7-11 7z", fill: "currentColor" })],
  pause: () => [svg("rect", { x: 6, y: 5, width: 4, height: 14, rx: 1, fill: "currentColor" }), svg("rect", { x: 14, y: 5, width: 4, height: 14, rx: 1, fill: "currentColor" })],
  prev: () => [svg("path", { d: "M6 5v14M19 6l-9 6 9 6z", fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" })],
  next: () => [svg("path", { d: "M18 5v14M5 6l9 6-9 6z", fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" })],
  stop: () => [svg("rect", { x: 5, y: 5, width: 14, height: 14, rx: 2, fill: "currentColor" })],
  x: () => [svg("path", { d: "M6 6l12 12M18 6L6 18", fill: "none", stroke: "currentColor", "stroke-width": 2.6, "stroke-linecap": "round" })],
  more: () => [5, 12, 19].map((cx) => svg("circle", { cx, cy: 12, r: 2, fill: "currentColor" })),
  chev: () => [svg("path", { d: "M6 15l6-6 6 6", fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" })],
};
function icon(name, size = 14) {
  return svg("svg", { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": "true" }, ICONS[name]());
}

function setKnob(knobEl, v) {
  knobEl.style.setProperty("--a", (-135 + Math.max(0, Math.min(1, v)) * 270) + "deg");
}
// A brass knob over a real, invisible range input (see style.css): drag across it,
// or use the arrow keys. `onchange` fires when it is let go.
function knob(value, { label, size = 44, off = false, onchange, oninput }) {
  const face = svg("svg", { width: size, height: size, viewBox: "0 0 56 56", "aria-hidden": "true" },
    svg("path", { d: "M9.6 46.4 A26 26 0 1 1 46.4 46.4", fill: "none", stroke: "#e8dcbf", "stroke-width": 2, "stroke-dasharray": "1.5 4.2" }),
    svg("circle", { cx: 28, cy: 28, r: 20, fill: "#2a120c", stroke: "#6b4c1c", "stroke-width": 1.5 }),
    svg("circle", { class: "cap", cx: 28, cy: 28, r: 16, fill: "#b8903f", stroke: "#6b4c1c" }),
    svg("circle", { cx: 24, cy: 23, r: 6, fill: "#f2d88f", opacity: ".35" }),
    svg("g", { class: "pointer" }, svg("line", { x1: 28, y1: 27, x2: 28, y2: 14, stroke: "#22110b", "stroke-width": 3.4, "stroke-linecap": "round" })));
  const wrap = h("span", { class: "knob" + (off ? " off" : "") }, face);
  const input = h("input", { type: "range", min: 0, max: 100, value: String(Math.round(value * 100)), "aria-label": label, title: label,
    oninput: (ev) => { setKnob(wrap, Number(ev.target.value) / 100); if (oninput) oninput(Number(ev.target.value) / 100); },
    onchange: (ev) => onchange && onchange(Number(ev.target.value) / 100) });
  wrap.append(input);
  setKnob(wrap, value);
  return wrap;
}
for (const k of document.querySelectorAll("[data-knob]")) {
  const input = k.querySelector("input");
  input.addEventListener("input", () => setKnob(k, Number(input.value) / 100));
}

// -------------------------------------------------------------
// Search: one box over the pads, the layers to add, the shelf and the lists
// -------------------------------------------------------------
let query = "";
const norm = (s) => String(s || "").toLowerCase();
const matches = (...texts) => !query || texts.some((t) => norm(t).includes(query));
$("c-search").addEventListener("input", (ev) => { query = norm(ev.target.value).trim(); renderPlay(); });
$("c-search").addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { ev.target.value = ""; query = ""; renderPlay(); }
  if (ev.key === "Enter") { ev.preventDefault(); firePad(0); }
});
let libQuery = "";
$("c-lib-search").addEventListener("input", (ev) => {
  libQuery = norm(ev.target.value).trim();
  if (model && model.lib) { section("c-sounds", renderSounds); section("c-lists", renderLists); section("c-scene-list", renderSceneList); }
});
// "/" finds, 1–9 fire the pads in view: while nobody is typing, on the Play tab.
document.addEventListener("keydown", (ev) => {
  if (!model || model.role !== "GM" || tab !== "play" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = document.activeElement;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== "range") return;
  if (ev.key === "/") { ev.preventDefault(); $("c-search").focus(); return; }
  if (/^[1-9]$/.test(ev.key)) { ev.preventDefault(); firePad(Number(ev.key) - 1); }
});
let padsInView = [];
function firePad(i) {
  const s = padsInView[i];
  if (!s || s.track.k !== "a") return;
  const b = [...document.querySelectorAll("#c-board .pad")].find((x) => x.dataset.id === s.id);
  if (b) { b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 250); }
  call("sound.fire", { id: s.id });
}
function renderPlay() {
  if (!connected() || model.role !== "GM" || !model.lib) return;
  section("c-music", renderMusic);
  section("c-amb", renderAmb);
  section("c-scenes", renderScenes);
  section("c-board", renderBoard);
}
let drawerOpen = (() => { try { return localStorage.getItem("gsradio.drawer") !== "closed"; } catch (err) { return true; } })();

// -------------------------------------------------------------
// Play: music
// -------------------------------------------------------------
let pickedList = "";

function renderMusic() {
  const { lib, state } = model;
  const m = state.music;
  const lists = lib.lists.filter((l) => matches(l.name, ...l.tracks.map((t) => t.t)));
  if (!pickedList || !lib.lists.some((l) => l.id === pickedList)) pickedList = (m && m.list) || (lib.lists[0] && lib.lists[0].id) || "";
  const shown = lists.some((l) => l.id === pickedList) ? lists : lib.lists.filter((l) => l.id === pickedList).concat(lists);
  const pick = options(h("select", { "aria-label": "Playlist", onchange: (ev) => { pickedList = ev.target.value; } }),
    shown.map((l) => [l.id, `${l.name} (${l.tracks.length})`]), pickedList);
  const playing = !!(m && m.paused === null);
  const sceneName = state.scene || (m ? m.label || "Music" : "Nothing on");
  const line = m ? displayTitle(m) + (m.label && state.scene ? " · " + m.label : "") + (m.paused !== null ? " · paused" : "")
    : state.amb.length ? "Ambience only" : "Press a record on the shelf, or play a list.";
  return [
    h("div", { class: "platter-top" },
      h("div", { class: "record" + (playing && model.tuned ? " spin" : ""), "aria-hidden": "true" }, h("div", { class: "label" })),
      h("div", { class: "platter-now" },
        h("span", { class: "muted small", text: "On the platter" }),
        h("span", { class: "scene-name", text: sceneName }),
        h("span", { class: "track-line", text: line, title: line })),
      m ? knob(m.vol, { label: "The music's level for everyone", size: 46, onchange: (v) => call("music.vol", { v }) }) : null),
    h("div", { class: "list-row" },
      h("div", { class: "transport" },
        h("button", { class: "brass round", title: "Previous", "aria-label": "Previous", onclick: () => call("music.prev") }, icon("prev")),
        h("button", { class: "primary round big", "aria-label": playing ? "Pause the music" : "Play the music", title: playing ? "Pause" : "Play", onclick: () => call("music.toggle") }, icon(playing ? "pause" : "play", 18)),
        h("button", { class: "brass round", title: "Next", "aria-label": "Next", onclick: () => call("music.next") }, icon("next")),
        h("button", { class: "brass round", title: "Stop the music", "aria-label": "Stop the music", onclick: () => call("music.stop") }, icon("stop", 12))),
      lib.lists.length ? pick : h("span", { class: "muted small", text: "No playlists yet: add the GS Grimoire music pack in Library, or make one." }),
      lib.lists.length ? h("button", { onclick: () => pickedList && call("music.play", { list: pickedList }) }, "Play this list") : null),
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
  // Every layer has its own controls: pause, level, stop.
  const rows = state.amb.map((l) => {
    const name = l.label || KINDS[l.track.k] || "Layer";
    return h("div", { class: "layer" + (l.off ? " off" : "") },
      knob(l.vol, { label: name + " level", size: 32, off: l.off, onchange: (v) => call("layer.vol", { id: l.id, v }) }),
      h("span", { class: "layer-name", text: name, title: KINDS[l.track.k] }),
      h("span", { class: "badge", text: l.off ? "paused" : l.mode === "scatter" ? `every ${l.min}–${l.max}s` : "loop" }),
      h("button", { title: l.off ? "Play this layer" : "Pause this layer",
        "aria-label": (l.off ? "Play " : "Pause ") + name, onclick: () => call("layer.pause", { id: l.id, off: !l.off }) }, icon(l.off ? "play" : "pause", 11)),
      h("button", { title: "Stop this layer", "aria-label": "Stop " + name, onclick: () => call("layer.remove", { id: l.id }) }, icon("x", 10)));
  });

  const sel = soundOptions(lib, (s) => (layerDraft.mode === "loop" || !isEmbed(s.track)) && matches(s.name, s.page));
  sel.value = layerDraft.sound;
  sel.addEventListener("change", (ev) => { layerDraft.sound = ev.target.value; });
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
  const link = h("input", { type: "text", placeholder: "…or paste a link", value: layerDraft.link,
    oninput: (ev) => { layerDraft.link = ev.target.value; },
    onkeydown: (ev) => { if (ev.key === "Enter") add(); } });
  const mode = options(h("select", { "aria-label": "How it plays", onchange: (ev) => { layerDraft.mode = ev.target.value; section("c-amb", renderAmb); } }),
    [["loop", "Loop"], ["scatter", "Now and then"]], layerDraft.mode);
  const interval = layerDraft.mode === "scatter" ? h("span", { class: "inline" }, "every ",
    h("input", { type: "number", min: 3, max: 600, value: String(layerDraft.min), class: "num", "aria-label": "Shortest wait in seconds",
      oninput: (ev) => { layerDraft.min = Number(ev.target.value); } }), "–",
    h("input", { type: "number", min: 3, max: 900, value: String(layerDraft.max), class: "num", "aria-label": "Longest wait in seconds",
      oninput: (ev) => { layerDraft.max = Number(ev.target.value); } }), " s") : null;

  return [
    h("div", { class: "drawer-head" },
      h("h2", { class: "sec-title", text: `Layers (${state.amb.length}/${MAX_LAYERS})` }),
      h("span", { class: "spacer" }),
      state.amb.length ? h("button", { class: "ghost small", onclick: () => call("layer.clear") }, "Stop all ambience") : null),
    rows.length ? h("div", { class: "layers" }, rows) : h("p", { class: "muted small", text: "Nothing layered. Rain, a crowd, a machine's hum: they play under the music." }),
    state.amb.length < MAX_LAYERS ? h("div", { class: "add-layer" }, sel, mode, link, interval, h("button", { class: "primary", onclick: add }, "Add")) : null,
    query && state.amb.length < MAX_LAYERS ? h("p", { class: "muted small", text: `The sound list shows what matches "${query}".` }) : null,
    model.info.embeds >= MAX_EMBEDS ? h("p", { class: "muted small", text: `${MAX_EMBEDS} video players are showing, which is all the bar holds.` }) : null,
  ];
}

// -------------------------------------------------------------
// Play: scenes
// -------------------------------------------------------------
let sceneDraft = { name: "", keepMusic: false };

function renderScenes() {
  const { lib, state } = model;
  // Records on a shelf. The one playing has its record half out of the sleeve, and
  // is pressed again to stop it.
  const shown = lib.scenes.filter((s) => {
    const l = lib.lists.find((x) => x.id === s.music.list);
    return matches(s.name, l && l.name, ...s.amb.map((a) => a.label));
  });
  const sleeves = shown.map((s) => {
    const on = state.scene === s.name;
    const sub = s.amb.map((a) => a.label).join(", ") || (s.music.mode === "list" ? "Music" : "");
    return h("button", {
      class: "scene" + (on ? " on" : ""),
      style: `--hue:${hueFor(s.name)}`,
      "aria-pressed": String(on),
      title: (on ? "Playing — press to stop it\n" : "") + sceneSummary(s, lib),
      onclick: () => call(on ? "scene.stop" : "scene.recall", { id: s.id }),
    }, h("span", { class: "sleeve-name", text: s.name }), h("span", { class: "sleeve-sub", text: sub }));
  });
  const save = async () => {
    const name = sceneDraft.name.trim();
    if (!name) { toast("Name the scene first.", true); return; }
    const r = await call("scene.save", { name, keepMusic: sceneDraft.keepMusic });
    if (!r.error) { sceneDraft = { name: "", keepMusic: false }; toast(`Saved "${name}".`); }
  };
  return [
    h("div", { class: "drawer-head" },
      h("h2", { class: "sec-title", text: "The shelf" }),
      h("span", { class: "muted small", text: lib.scenes.length ? "Press a record to play its scene; press it again to stop." : "" })),
    sleeves.length ? h("div", { class: "scenes" }, sleeves)
      : h("p", { class: "muted small", text: lib.scenes.length ? `No scene matches "${query}".` : "A scene is a moment's sound: a playlist and its ambience, recalled in one press. Set up what should play, then save it here, or add a starter pack in Library." }),
    h("div", { class: "save-scene" },
      h("input", { type: "text", maxlength: 40, placeholder: "Name what is playing now…", value: sceneDraft.name,
        oninput: (ev) => { sceneDraft.name = ev.target.value; }, onkeydown: (ev) => { if (ev.key === "Enter") save(); } }),
      h("label", { class: "inline muted small", title: "Without this, recalling the scene leaves the music alone" },
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
  // Searching shows matches from every page; otherwise one page at a time.
  const list = query ? lib.sounds.filter((s) => matches(s.name, s.page)) : lib.sounds.filter((s) => s.page === boardPage);
  padsInView = list;
  const pads = list.map((s, i) => {
    const playable = s.track.k === "a";
    return h("button", {
      class: "pad", disabled: !playable,
      dataset: { id: s.id, sub: query ? s.page : i < 9 ? String(i + 1) : "" },
      title: playable ? `${s.name} — play for everyone` : `${s.name} is a video: add it as a layer instead`,
      onclick: async (ev) => {
        const b = ev.currentTarget;
        b.classList.add("hit");
        setTimeout(() => b.classList.remove("hit"), 250);
        await call("sound.fire", { id: s.id });
      },
    }, s.name);
  });
  const open = drawerOpen || !!query;
  $("c-board").classList.toggle("closed", !open);
  const toggle = () => {
    drawerOpen = !open;
    try { localStorage.setItem("gsradio.drawer", drawerOpen ? "open" : "closed"); } catch (err) { /* forgets */ }
    section("c-board", renderBoard);
    // Opened from the handle pinned at the bottom edge, it opens at the foot of the
    // page: follow it there.
    if (drawerOpen) $("c-board").scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return [
    h("div", { class: "drawer-head" },
      h("button", { class: "toggle", "aria-expanded": String(open), onclick: toggle },
        h("h2", { class: "sec-title", text: "Soundboard" }),
        h("span", { class: "chev" }, icon("chev", 16))),
      h("span", { class: "muted small", text: query ? `${list.length} matching "${query}"` : open ? "Keys 1–9 play the first nine" : `${lib.sounds.length} sounds` }),
      h("span", { class: "spacer" }),
      h("button", { class: "ghost small", onclick: () => call("sound.stopAll"), title: "Stop every sound that is playing" }, "■ Stop sounds")),
    h("div", { class: "drawer-body" },
      !query && pages.length > 1 ? h("div", { class: "pages" }, pages.map((p) => h("button", {
        class: "page" + (p === boardPage ? " on" : ""), "aria-pressed": String(p === boardPage),
        onclick: () => { boardPage = p; section("c-board", renderBoard); },
      }, p))) : null,
      pads.length ? h("div", { class: "pads" }, pads)
        : h("p", { class: "muted", text: query ? `No sound matches "${query}".` : "No sounds yet. Add a starter pack in Library, or your own in Library → Sounds." })),
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
  // The library search narrows the choice to playlists whose name or tracks match.
  const listed = lib.lists.filter((l) => l.id === editList || !libQuery || norm(l.name).includes(libQuery) || l.tracks.some((t) => norm(t.t).includes(libQuery)));
  const pick = options(h("select", { "aria-label": "Playlist", onchange: (ev) => { editList = ev.target.value; listDirty = false; listErrors = []; section("c-lists", renderLists); } }),
    listed.map((l) => [l.id, `${l.name} (${l.tracks.length})`]), editList);
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
    h("p", { class: "muted small", text: "One link per line, \"Title | link\" to name it. Mix YouTube videos and playlists, Suno songs, SoundCloud tracks and playlists, Dropbox and audio-file links. Embed codes can be pasted whole." }),
    text,
    listErrors.map((e) => h("div", { class: "error", text: `Line ${e.line}: ${e.error}` })),
    list ? h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "Save"),
      h("a", { href: "suno.html", target: "_blank", rel: "noopener", text: "Copy a whole Suno playlist at once" })) : null,
  ];
}

// -------------------------------------------------------------
// Library: sounds
// -------------------------------------------------------------
let libPage = "";
let openSound = "";
let adding = false;
let bulkOpen = false;
let newSound = { name: "", link: "", page: "" };
let soundsDirty = false;
let soundsText = "";
let soundsErrors = [];

function renderSounds() {
  const { lib } = model;
  const pages = soundPages(lib);
  if (!pages.includes(libPage)) libPage = pages[0] || "";
  const list = libQuery ? lib.sounds.filter((s) => norm(s.name).includes(libQuery) || norm(s.page).includes(libQuery))
    : lib.sounds.filter((s) => s.page === libPage);
  const pageList = h("datalist", { id: "c-page-names" }, pages.map((p) => h("option", { value: p })));

  const drawers = h("div", { class: "drawers" },
    h("span", { class: "sec-title", text: "Pages" }),
    pages.map((p) => {
      const n = lib.sounds.filter((s) => s.page === p).length;
      return h("button", { class: "drawer-front" + (p === libPage && !libQuery ? " on" : ""), "aria-pressed": String(p === libPage && !libQuery),
        onclick: () => { libPage = p; openSound = ""; section("c-sounds", renderSounds); } },
      h("span", { class: "plate", text: p }), h("span", { class: "count", text: plural(n, "sound", "sounds") }));
    }));

  const cards = list.map((s) => {
    const open = openSound === s.id;
    const kind = s.track.k === "a" && /suno\.ai/.test(s.track.u) ? "Suno song" : KINDS[s.track.k] || "";
    return h("div", { class: "sound-card" },
      h("div", { class: "top" },
        h("input", { type: "text", maxlength: 40, value: s.name, "aria-label": "Name",
          onchange: (ev) => ev.target.value.trim() && call("sound.set", { id: s.id, name: ev.target.value.trim() }) }),
        h("span", { class: "kind", text: libQuery ? `${kind} · ${s.page}` : kind }),
        knob(s.vol, { label: `${s.name}: its own volume`, size: 30, onchange: (v) => call("sound.set", { id: s.id, vol: v }) }),
        h("span", { class: "pct", text: Math.round(s.vol * 100) + "%" }),
        s.track.k === "a" ? h("button", { class: "brass round", style: "width:30px;height:30px;min-height:0", "aria-label": `Hear ${s.name}, just for you`, title: "Hear it, just for you",
          onclick: () => previewTrack(s.track, s.vol) }, icon("play", 11)) : null,
        h("button", { class: "ghost", "aria-expanded": String(open), "aria-label": `More for ${s.name}`,
          onclick: () => { openSound = open ? "" : s.id; section("c-sounds", renderSounds); } }, icon("more", 16))),
      open ? h("div", { class: "more" },
        h("span", { class: "link", text: trackLink(s.track) }),
        h("label", {}, "Page ",
          h("input", { type: "text", list: "c-page-names", maxlength: 40, value: s.page, "aria-label": "Page",
            onchange: (ev) => ev.target.value.trim() && call("sound.set", { id: s.id, page: ev.target.value.trim() }).then((r) => { if (!r.error) { libPage = ev.target.value.trim(); } }) })),
        h("div", { class: "row" }, h("span", { class: "spacer" }),
          h("button", { class: "danger", onclick: (ev) => confirmTwice(ev.currentTarget, "Delete", () => call("sound.set", { id: s.id, remove: true })) }, "Delete"))) : null);
  });

  const addSound = async () => {
    const found = parseAny(newSound.link);
    if (!found || found.error || !found.tracks.length) { toast(found ? found.error : "Paste a link.", true); return; }
    const track = found.tracks[0];
    const name = newSound.name.trim() || track.t;
    const page = newSound.page.trim() || libPage || "Sounds";
    const r = await call("sound.add", { sound: { name, track, page, vol: 1 } });
    if (!r.error) { newSound = { name: "", link: "", page }; libPage = page; adding = false; toast(`Added "${name}".`); section("c-sounds", renderSounds); }
  };
  const addForm = adding ? h("div", { class: "card", style: "margin:6px 0" },
    h("div", { class: "row" },
      h("input", { type: "text", placeholder: "Name", maxlength: 40, value: newSound.name, oninput: (ev) => { newSound.name = ev.target.value; } }),
      h("input", { type: "text", placeholder: "Page", list: "c-page-names", maxlength: 40, value: newSound.page || libPage, oninput: (ev) => { newSound.page = ev.target.value; } })),
    h("div", { class: "row" },
      h("input", { type: "text", placeholder: "Link: audio file, Suno song, YouTube video…", value: newSound.link,
        oninput: (ev) => { newSound.link = ev.target.value; }, onkeydown: (ev) => { if (ev.key === "Enter") addSound(); } }),
      h("button", { class: "primary", onclick: addSound }, "Add"),
      h("button", { class: "ghost", onclick: () => { adding = false; section("c-sounds", renderSounds); } }, "Cancel"))) : null;

  // The whole collection as text, for pasting many at once. Open by itself when
  // there is nothing yet to show as cards.
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
  const bulk = h("details", { class: "bulk", open: !lib.sounds.length || soundsDirty || bulkOpen,
    ontoggle: (ev) => { bulkOpen = ev.target.open; } },
    h("summary", { text: "Paste many… (the whole collection as text)" }),
    h("p", { class: "muted small", text: "One sound per line, \"Name | link\". \"## Page\" starts a soundboard page. A number after a second bar is the sound's own volume: \"Horn | link | 60\". Audio files and Suno songs can be pressed on the soundboard; videos can be layers." }),
    text,
    soundsErrors.map((e) => h("div", { class: "error", text: `Line ${e.line}: ${e.error}` })),
    h("div", { class: "row" }, h("button", { class: "primary", onclick: save }, "Save sounds"),
      h("button", { onclick: () => preview(soundsText) }, "Hear the first"),
      soundsDirty ? h("button", { class: "ghost", onclick: () => { soundsDirty = false; soundsErrors = []; section("c-sounds", renderSounds); } }, "Undo changes") : null));

  return [
    h("h2", { text: `Sounds (${lib.sounds.length})` }),
    pageList,
    lib.sounds.length ? h("div", { class: "catalogue" },
      libQuery ? null : drawers,
      h("div", { class: "cards" },
        h("div", { class: "drawer-head" },
          h("span", { class: "sec-title", style: "margin:0", text: libQuery ? `Matching "${libQuery}"` : libPage }),
          h("span", { class: "spacer" }),
          h("button", { class: "brass", onclick: () => { adding = !adding; section("c-sounds", renderSounds); } }, "Add a sound")),
        addForm,
        cards.length ? cards : h("p", { class: "muted small", text: `Nothing matches "${libQuery}".` }))) : null,
    bulk,
  ];
}

// Hearing a sound before saving it plays HERE, in this page, for you alone.
let previewing = null;
function previewTrack(track, vol = 1) {
  if (previewing) previewing.pause();
  previewing = new Audio(track.u);
  previewing.volume = Math.max(0, Math.min(1, (model ? model.prefs.fx : 0.8) * vol));
  previewing.play().catch(() => toast("That would not play.", true));
  setTimeout(() => previewing && previewing.pause(), 8000);
}
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
  const rows = lib.scenes.filter((s) => !libQuery || norm(s.name).includes(libQuery) || s.amb.some((a) => norm(a.label).includes(libQuery))).map((s) => h("div", { class: "scene-row" },
    h("div", {}, h("strong", { text: s.name }), h("div", { class: "muted small pre", text: sceneSummary(s, lib) })),
    h("div", { class: "row" },
      model.state.scene === s.name
        ? h("button", { onclick: () => call("scene.stop", { id: s.id }) }, "Stop")
        : h("button", { onclick: () => call("scene.recall", { id: s.id }) }, "Play"),
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
  // Takes effect the moment it is picked: no second button to miss.
  const pick = options(h("select", { "aria-label": "Radio scene for this Owlbear scene", disabled: !info.obrScene.ready,
    onchange: (ev) => call("scene.bind", { id: ev.target.value }).then((r) => !r.error && toast("Saved for this Owlbear scene.")) }),
    [["", "— nothing —"], ...lib.scenes.map((s) => [s.id, s.name])], bound);
  return [
    h("h2", { text: "Owlbear scenes" }),
    info.obrScene.ready
      ? h("p", { text: bound && findScene(lib, bound) ? `This Owlbear scene plays "${findScene(lib, bound).name}" when it opens.` : "This Owlbear scene has no radio scene." })
      : h("p", { class: "muted", text: "Open a scene in Owlbear to give it a radio scene." }),
    h("div", { class: "row" }, pick),
    h("label", { class: "inline" },
      h("input", { type: "checkbox", checked: lib.autoScenes, onchange: (ev) => call("lib.set", { key: "autoScenes", value: ev.target.checked }) }),
      " Play the radio scene when I switch Owlbear scenes"),
  ];
}

function renderReactions() {
  const { lib, info } = model;
  const soundItems = [["", "—"], ...lib.sounds.filter((s) => s.track.k === "a").map((s) => [s.id, `${s.page}: ${s.name}`])];
  const sceneItems = [["", "—"], ...lib.scenes.map((s) => [s.id, s.name])];
  // Each change is saved as it is made, one reaction at a time (react.set), so
  // there is no Save to forget and no redraw can lose a choice.
  const rows = CUES.map(([cue, label]) => {
    const r = { sound: "", scene: "", restore: false, ...(lib.reactions[cue] || {}) };
    const set = (patch) => {
      Object.assign(r, patch);
      call("react.set", { cue, ...r }).then((res) => !res.error && toast(`Saved: ${label}.`));
    };
    return h("tr", {},
      h("th", { scope: "row", text: label }),
      h("td", {}, options(h("select", { "aria-label": label + ": sound", onchange: (ev) => set({ sound: ev.target.value }) }), soundItems, r.sound)),
      h("td", {}, options(h("select", { "aria-label": label + ": scene", onchange: (ev) => set({ scene: ev.target.value }) }), sceneItems, r.scene)),
      h("td", {}, cue === "combatEnd" ? h("label", { class: "inline small", title: "Bring back whatever was playing when initiative started" },
        h("input", { type: "checkbox", checked: r.restore, onchange: (ev) => set({ restore: ev.target.checked }) }), " go back") : null));
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
    h("p", { class: "muted small", text: "Changes are saved as you make them." }),
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
      onchange: (ev) => call("lib.set", { key: "shuffle", value: ev.target.checked }) }), " Shuffle playlists"),
    h("label", { class: "inline" }, "Fade in and out over ",
      h("input", { type: "number", class: "num", min: 0, max: 6, step: 0.5, value: String(lib.fadeSeconds),
        onchange: (ev) => call("lib.set", { key: "fadeSeconds", value: Number(ev.target.value) }) }), " seconds"),
    h("label", { class: "inline", title: "The next track starts this long before the last one ends, and they overlap. Audio files and Suno songs only." }, "Crossfade music tracks over ",
      h("input", { type: "number", class: "num", min: 0, max: CROSSFADE_MAX, step: 1, value: String(lib.crossfade),
        onchange: (ev) => call("lib.set", { key: "crossfade", value: Number(ev.target.value) }) }), " seconds (0 = off)"),
    h("h2", { text: "Pads for players" }),
    h("p", { class: "muted small", text: "Let players press one soundboard page themselves — a bell, a spell, a battle cry. Everyone hears it. Each player can press once every few seconds." }),
    h("label", { class: "inline" }, h("input", { type: "checkbox", checked: lib.playerPads.on,
      onchange: (ev) => call("lib.set", { key: "playerPads", value: { ...lib.playerPads, on: ev.target.checked, page: lib.playerPads.page || soundPages(lib)[0] || "" } }) }), " Players may press the page "),
    options(h("select", { "aria-label": "Page players may press",
      onchange: (ev) => call("lib.set", { key: "playerPads", value: { ...lib.playerPads, page: ev.target.value } }) }),
      [["", "— choose —"], ...soundPages(lib).map((p) => [p, p])], lib.playerPads.page),
    h("p", { class: "muted small" }, "The starter packs are made from other people's free sounds: ",
      h("a", { href: "credits.html", target: "_blank", rel: "noopener", text: "see the credits" }), "."),
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

// A player's pads: the page the GM opened to them. The GM's bar decides each press.
function renderPlayerPads() {
  const pads = readPadList(model.info.pads);
  return [
    h("h2", { text: "Soundboard" }),
    h("p", { class: "muted small", text: "The GM has opened these to you. Everyone hears them." }),
    h("div", { class: "pads" }, pads.map((p) => h("button", {
      class: "pad",
      onclick: async (ev) => {
        const b = ev.currentTarget;
        b.classList.add("hit");
        setTimeout(() => b.classList.remove("hit"), 250);
        await call("pad.press", { id: p.id });
      },
    }, p.name))),
  ];
}

function render() {
  renderHeader();
  if (!connected()) return;
  renderMe();
  if (model.role !== "GM" && readPadList(model.info.pads).length) section("c-ppads", renderPlayerPads);
  if (model.role !== "GM" || !model.lib) return;
  if (model.info.error && model.info.error !== shownError) toast(model.info.error, true);
  shownError = model.info.error;
  if (tab === "play") renderPlay();
  else if (tab === "library") {
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
// Where the panel is in reaching the bar, so the message can say what is actually
// wrong instead of one sentence for every case.
const link = { sdk: "loading", sdkSince: Date.now(), openedAt: 0, autoOpened: false };

async function openBar() {
  if (!obr) { toast("Owlbear has not finished loading this panel yet. Try again in a moment.", true); return; }
  let prefs = readPrefs(null);
  try { prefs = readPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || "null")); } catch (err) { /* default */ }
  let viewport = null;
  try { viewport = { width: await obr.viewport.getWidth(), height: await obr.viewport.getHeight() }; } catch (err) { /* default */ }
  link.openedAt = Date.now();
  await obr.popover.open(barPopover({ url: new URL("bar.html", location.href).href, corner: prefs.corner, viewport }));
  hello();
}
$("c-open-bar").addEventListener("click", openBar);

// What to say while there is no bar to talk to.
function noBarText() {
  if (POPOUT) {
    return window.opener
      ? "Waiting for the radio bar… If this does not connect, press ⧉ on the radio bar in Owlbear again."
      : "This window is not connected. In Owlbear, press ⧉ on the radio bar to open the console from there.";
  }
  if (link.sdk === "loading") {
    return Date.now() - link.sdkSince > 8000
      ? "Owlbear has not answered this panel. Reload the room (not just the tab), then open Radio again."
      : "Waiting for Owlbear…";
  }
  if (link.openedAt && Date.now() - link.openedAt < 6000) return "Opening the radio bar at the edge of the map…";
  if (link.openedAt) {
    return "The radio bar is open but not answering. Close it with its × and press Open the radio. "
      + "If it happens again, reload the room.";
  }
  return "The radio bar is not open. It is where the sound plays, and it has to be open for this panel to work.";
}

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
    link.sdk = "ready";
    // Both routes to the bar (see link.js); the second copy of anything is dropped.
    const assemble = makeAssembler();
    const firstCopy = makeDeduper();
    const receive = (data) => {
      const msg = assemble(data);
      if (msg && firstCopy(msg)) onBar(msg);
    };
    let bc = null;
    try {
      bc = new BroadcastChannel(channelName(obr.room.id));
      bc.onmessage = (ev) => receive(ev.data);
    } catch (err) { /* Owlbear's own route still works */ }
    obr.broadcast.onMessage(LINK_OBR_CHANNEL, (ev) => receive(ev && ev.data));
    send = (msg) => {
      const m = stamp(msg);
      try { if (bc) bc.postMessage(m); } catch (err) { /* closed */ }
      for (const piece of toPieces(m)) obr.broadcast.sendMessage(LINK_OBR_CHANNEL, piece, { destination: "LOCAL" }).catch(() => {});
    };
    // Give the GM's console room to breathe; players only need the top card.
    try {
      const role = await obr.player.getRole();
      if (role === "GM") { await obr.action.setWidth(520); await obr.action.setHeight(760); }
    } catch (err) { /* keep the manifest size */ }
    // Nobody should have to find a second button before anything works: when no bar
    // answers, open it. Once per panel — closing the bar is a choice to respect.
    setTimeout(() => {
      if (!connected() && !link.autoOpened) { link.autoOpened = true; openBar(); }
    }, 1500);
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
