// =============================================================
// panel.js — the Radio panel in Owlbear's toolbar.
// -------------------------------------------------------------
// Everyone: what is playing, and the button that opens the radio bar, which is
// where the sound actually is. The GM also gets the playlists and the soundscape.
//
// PLAYLISTS LIVE IN THE GM'S BROWSER. Room metadata is 16 kB shared with every
// extension in the room, and D&M alone reserves 11 kB of it; a playlist of links
// would not fit. The room only ever holds the one track that is playing. The cost:
// a GM on a different browser starts with no playlists, which is what Backup is for.
// =============================================================
import OBR from "./sdk.js";
import {
  STATE_KEY, LIBRARY_KEY, PREFS_KEY, CUES,
  readState, writeState, readLibrary, readPrefs, parseTrackList, parseLine,
  formatTrackList, trackLink, startList, newListId, displayTitle, barPopover, findList,
} from "./radio.js";

const el = (id) => document.getElementById(id);
let role = "PLAYER";
let state = readState({});
let currentList = "";

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (err) { return null; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (err) { return false; }
}
const library = () => readLibrary(loadJSON(LIBRARY_KEY));
function saveLibrary(lib) {
  if (!saveJSON(LIBRARY_KEY, readLibrary(lib))) {
    flash("list-msg", "This browser would not save it. Is site data blocked?");
    return false;
  }
  return true;
}

function flash(id, msg) {
  const node = el(id);
  node.textContent = msg;
  clearTimeout(node._t);
  node._t = setTimeout(() => { node.textContent = ""; }, 4000);
}

// -------------------------------------------------------------
// Now playing, for everyone
// -------------------------------------------------------------
function renderNow() {
  const title = displayTitle(state);
  el("now-title").innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = title || "Nothing playing";
  el("now-title").append(strong);
  el("now-label").textContent = state.track
    ? (state.paused !== null ? "Paused · " : "") + (state.label || "")
    : "";
}

el("open-bar").addEventListener("click", async () => {
  const prefs = readPrefs(loadJSON(PREFS_KEY));
  let viewport = null;
  try { viewport = { width: await OBR.viewport.getWidth(), height: await OBR.viewport.getHeight() }; } catch (err) { /* default */ }
  const url = new URL("bar.html", location.href).href;
  await OBR.popover.open(barPopover({ url, corner: prefs.corner, viewport, video: false }));
});

// -------------------------------------------------------------
// Playlists (GM)
// -------------------------------------------------------------
function renderLists() {
  const lib = library();
  if (!findList(lib, currentList)) currentList = lib.lists[0] ? lib.lists[0].id : "";
  const pick = el("list-pick");
  pick.innerHTML = "";
  for (const list of lib.lists) {
    const opt = document.createElement("option");
    opt.value = list.id;
    opt.textContent = `${list.name} (${list.tracks.length})`;
    pick.append(opt);
  }
  pick.value = currentList;
  pick.disabled = !lib.lists.length;
  const list = findList(lib, currentList);
  el("list-text").value = list ? formatTrackList(list.tracks) : "";
  el("list-text").disabled = !list;
  el("list-errors").innerHTML = "";
  el("shuffle").checked = lib.shuffle;
  for (const id of ["list-rename", "list-delete", "list-save", "list-play"]) el(id).disabled = !list;

  const combat = el("combat-list");
  combat.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— keep the music as it is —";
  combat.append(none);
  for (const l of lib.lists) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.name;
    combat.append(opt);
  }
  combat.value = lib.combatList;
}

function showErrors(errors) {
  const box = el("list-errors");
  box.innerHTML = "";
  for (const { line, error } of errors) {
    const p = document.createElement("div");
    p.className = "error";
    p.textContent = `Line ${line}: ${error}`;
    box.append(p);
  }
}

// Saves what is in the box. Lines that do not parse are reported and left in the
// box so they can be fixed — the box is not rewritten while it has errors, or the
// broken lines would vanish the moment the GM pressed Save.
function saveCurrent() {
  const lib = library();
  const list = findList(lib, currentList);
  if (!list) return null;
  const { tracks, errors } = parseTrackList(el("list-text").value);
  list.tracks = tracks;
  if (!saveLibrary(lib)) return null;
  showErrors(errors);
  flash("list-msg", errors.length
    ? `Saved ${tracks.length}. ${errors.length} line${errors.length === 1 ? "" : "s"} could not be used.`
    : `Saved ${tracks.length}.`);
  if (!errors.length) {
    renderLists();
  } else {
    // Refresh the counts without touching the box.
    const opt = [...el("list-pick").options].find((o) => o.value === list.id);
    if (opt) opt.textContent = `${list.name} (${tracks.length})`;
  }
  return lib;
}

el("list-pick").addEventListener("change", (ev) => { currentList = ev.target.value; renderLists(); });
// No prompt() or confirm(): Owlbear frames extensions, and a sandboxed frame may
// refuse modal dialogs outright. A name box and a press-twice button do the same.
function confirmTwice(button, label, action) {
  if (button.dataset.armed) {
    delete button.dataset.armed;
    button.textContent = label;
    action();
    return;
  }
  button.dataset.armed = "1";
  button.textContent = "Sure?";
  setTimeout(() => { delete button.dataset.armed; button.textContent = label; }, 3000);
}

el("list-new").addEventListener("click", () => {
  const name = el("list-name").value.trim();
  if (!name) { flash("list-msg", "Type a name first."); el("list-name").focus(); return; }
  const lib = library();
  const id = newListId();
  lib.lists.push({ id, name: name.slice(0, 40), tracks: [] });
  if (saveLibrary(lib)) { currentList = id; el("list-name").value = ""; renderLists(); }
});
el("list-rename").addEventListener("click", () => {
  const name = el("list-name").value.trim();
  const lib = library();
  const list = findList(lib, currentList);
  if (!list) return;
  if (!name) { flash("list-msg", "Type the new name first."); el("list-name").focus(); return; }
  list.name = name.slice(0, 40);
  if (saveLibrary(lib)) { el("list-name").value = ""; renderLists(); }
});
el("list-delete").addEventListener("click", (ev) => {
  confirmTwice(ev.currentTarget, "Delete", () => {
    const lib = library();
    lib.lists = lib.lists.filter((l) => l.id !== currentList);
    if (lib.combatList === currentList) lib.combatList = "";
    if (saveLibrary(lib)) { currentList = ""; renderLists(); }
  });
});
el("list-save").addEventListener("click", saveCurrent);
el("shuffle").addEventListener("change", (ev) => {
  const lib = library();
  lib.shuffle = ev.target.checked;
  saveLibrary(lib);
});
el("list-play").addEventListener("click", async () => {
  const lib = saveCurrent();
  if (!lib) return;
  const list = findList(lib, currentList);
  if (!list || !list.tracks.length) { flash("list-msg", "This list is empty."); return; }
  const first = lib.shuffle ? Math.floor(Math.random() * list.tracks.length) : 0;
  const fresh = readState(await OBR.room.getMetadata().catch(() => ({})));
  const next = startList(lib, list.id, first, Date.now(), fresh.seq);
  try {
    await OBR.room.setMetadata({ [STATE_KEY]: writeState(next) });
    flash("list-msg", "Playing. Open the radio if you have not.");
  } catch (err) {
    flash("list-msg", "Could not reach the room.");
  }
});

// -------------------------------------------------------------
// Soundscape (GM)
// -------------------------------------------------------------
function renderCues() {
  const lib = library();
  const box = el("cues");
  box.innerHTML = "";
  for (const [name, label] of CUES) {
    const row = document.createElement("div");
    row.className = "cue";
    const lab = document.createElement("label");
    lab.textContent = label;
    lab.htmlFor = "cue-" + name;
    const input = document.createElement("input");
    input.type = "text";
    input.id = "cue-" + name;
    input.dataset.cue = name;
    input.placeholder = "none";
    input.value = lib.cues[name] ? trackLink(lib.cues[name]) : "";
    const test = document.createElement("button");
    test.textContent = "▶";
    test.title = "Hear it (only you)";
    test.addEventListener("click", () => testCue(input.value));
    row.append(lab, input, test);
    box.append(row);
  }
  el("cue-seconds").value = String(lib.cueSeconds);
}

let testAudio = null;
function testCue(text) {
  const found = parseLine(text);
  if (!found || found.error || found.track.k !== "a") {
    flash("cues-msg", found && found.error ? found.error : "Sounds must be Suno or audio-file links.");
    return;
  }
  if (testAudio) testAudio.pause();
  testAudio = new Audio(found.track.u);
  testAudio.volume = readPrefs(loadJSON(PREFS_KEY)).fx;
  testAudio.play().catch(() => flash("cues-msg", "That would not play."));
  const secs = Number(el("cue-seconds").value) || 8;
  setTimeout(() => testAudio && testAudio.pause(), secs * 1000);
}

el("cues-save").addEventListener("click", () => {
  const lib = library();
  const problems = [];
  lib.cues = {};
  for (const input of el("cues").querySelectorAll("input[data-cue]")) {
    if (!input.value.trim()) continue;
    const found = parseLine(input.value);
    if (!found || found.error) { problems.push(`${input.dataset.cue}: ${found ? found.error : "empty"}`); continue; }
    if (found.track.k !== "a") { problems.push(`${input.dataset.cue}: sounds must be Suno or audio-file links`); continue; }
    lib.cues[input.dataset.cue] = found.track;
  }
  lib.combatList = el("combat-list").value;
  lib.cueSeconds = Number(el("cue-seconds").value) || 8;
  if (saveLibrary(lib)) flash("cues-msg", problems.length ? "Saved, except: " + problems.join("; ") : "Saved.");
});

// -------------------------------------------------------------
// Backup (GM)
// -------------------------------------------------------------
el("backup-export").addEventListener("click", () => {
  el("backup").value = JSON.stringify(library(), null, 1);
  flash("backup-msg", "Copy it somewhere safe.");
});
el("backup-import").addEventListener("click", () => {
  let raw;
  try { raw = JSON.parse(el("backup").value); } catch (err) {
    flash("backup-msg", "That is not a library.");
    return;
  }
  const lib = readLibrary(raw);
  if (!lib.lists.length) { flash("backup-msg", "No playlists in that."); return; }
  confirmTwice(el("backup-import"), "Load this library", () => {
    if (saveLibrary(lib)) { renderLists(); renderCues(); flash("backup-msg", `Loaded ${lib.lists.length} playlist(s).`); }
  });
});

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function applyRole(next) {
  role = next;
  const gm = role === "GM";
  el("gm").hidden = !gm;
  el("gm-badge").hidden = !gm;
  if (gm) { renderLists(); renderCues(); }
}

async function checkGM() {
  try {
    const players = await OBR.party.getPlayers();
    el("no-gm").hidden = role === "GM" || players.some((p) => p.role === "GM");
  } catch (err) {
    el("no-gm").hidden = true; // fail open: a racing read must not cry wolf
  }
}

renderNow();
OBR.onReady(async () => {
  try { await applyRole(await OBR.player.getRole()); } catch (err) { await applyRole("PLAYER"); }
  OBR.player.onChange((p) => { if (p && p.role && p.role !== role) applyRole(p.role); });
  OBR.party.onChange(checkGM);
  checkGM();
  try { state = readState(await OBR.room.getMetadata()); } catch (err) { /* empty */ }
  renderNow();
  OBR.room.onMetadataChange((meta) => { state = readState(meta); renderNow(); });
});
