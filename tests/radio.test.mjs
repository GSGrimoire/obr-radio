// radio.test.mjs — every rule, without a browser or a room.
//   node tests/radio.test.mjs
import {
  parseLink, parseLine, parseTrackList, formatTrackList, readTrack, trackKey, safeUrl, isEmbed,
} from "../sources.js";
import {
  readLibrary, parseSoundList, formatSoundList, soundPages, MAX_TRACKS, MAX_LAYERS, emptyLibrary,
} from "../library.js";
import {
  emptyState, readState, writeState, musicStart, musicAdvance, musicPause, musicResume, musicStop,
  musicVolume, musicSub, musicPosition, layerPosition, needsSeek, nextIndex, layerAdd, layerRemove,
  layerVolume, sceneApply, sceneFromState, snapshot, restore, embedCount, stateSize, displayTitle,
  MAX_EMBEDS, STATE_BUDGET,
} from "../state.js";
import { diffDnm, planReaction, rollCues, sortCues } from "../reactions.js";
import { readCommand, command, NS, GM_ONLY } from "../link.js";
import { readPrefs, barPopover, barSize, STATE_KEY } from "../radio.js";

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) passed += 1;
  else { failed += 1; console.log("  FAIL: " + name); }
}

const UUID = "0f6d3c1e-2b8a-4e5f-9a7b-1c2d3e4f5a6b";
const GUS = "dd6fccb4-531b-4a6d-ba32-9a181e3c4670";
const A = (name) => ({ k: "a", u: `https://x.test/${name}.mp3`, t: name });
const YT = (v) => ({ k: "yt", v, t: "video " + v });

// -------------------------------------------------------------
// Links, including the exact ones Gus pasted
// -------------------------------------------------------------
{
  const yt = parseLink("https://www.youtube.com/watch?v=_YsP_UGd8Ns&list=PLRy5AGzKZLmE");
  ok("a watch link carrying a playlist means the playlist", yt.track?.k === "ytl" && yt.track.l === "PLRy5AGzKZLmE");
  const share = parseLink("https://youtube.com/playlist?list=PLRy5AGzKZLmE&si=fF0O_ly7XYF6A4zu");
  ok("the share link for the GS playlist parses, tracking parameter ignored",
    share.track?.k === "ytl" && share.track.l === "PLRy5AGzKZLmE");
  ok("a plain watch link is one video", parseLink("https://www.youtube.com/watch?v=_YsP_UGd8Ns").track?.v === "_YsP_UGd8Ns");
  ok("youtu.be", parseLink("youtu.be/_YsP_UGd8Ns").track?.v === "_YsP_UGd8Ns");
  ok("shorts", parseLink("https://youtube.com/shorts/_YsP_UGd8Ns").track?.k === "yt");
  ok("music.youtube.com", parseLink("https://music.youtube.com/watch?v=_YsP_UGd8Ns").track?.k === "yt");
  ok("a mix is not a playlist anyone can share", parseLink("https://www.youtube.com/watch?v=_YsP_UGd8Ns&list=RD_YsP_UGd8Ns").track?.k === "yt");
  ok("a YouTube link with no video is refused", !!parseLink("https://www.youtube.com/feed/library").error);

  const suno = parseLink(`https://suno.com/song/${UUID}`);
  ok("a Suno song becomes its audio file", suno.track?.k === "a" && suno.track.u === `https://cdn1.suno.ai/${UUID}.mp3`);
  ok("a Suno CDN link is accepted as is", parseLink(`https://cdn1.suno.ai/${UUID}.mp3`).track?.u === `https://cdn1.suno.ai/${UUID}.mp3`);
  const short = parseLink("https://suno.com/s/cq8ogDYThAoJj3fo");
  ok("a Suno short link says what to do instead", /suno\.com\/song/.test(short.error || ""));
  ok("a Suno playlist says to paste songs", /one per line/.test(parseLink("https://suno.com/playlist/d827cffa-9998-4ad5-86d4-6701d9a43869").error || ""));

  const mp3 = parseLink("https://example.com/music/Liquid_Banjo_with_a_trumpet_twist.mp3");
  ok("an audio file link plays", mp3.track?.k === "a");
  ok("and is titled from its name", mp3.track?.t === "Liquid Banjo with a trumpet twist");
  ok("http audio is refused", !!parseLink("http://example.com/a.mp3").error);
  ok("javascript: is refused", !!parseLink("javascript:alert(1)").error);
  ok("data: is refused", !!parseLink("data:audio/mp3;base64,AAAA").error);
  ok("a web page is not a track", !!parseLink("https://example.com/about").error);
}

// -------------------------------------------------------------
// Editor lines
// -------------------------------------------------------------
{
  ok("title | link", parseLine(`Liquid Banjo | https://suno.com/song/${UUID}`).track?.t === "Liquid Banjo");
  ok("link | title", parseLine(`https://suno.com/song/${UUID} | Liquid Banjo`).track?.t === "Liquid Banjo");
  ok("a comment line is skipped", parseLine("# tavern music") === null);
  ok("a blank line is skipped", parseLine("   ") === null);

  const { tracks, errors } = parseTrackList([
    "https://youtube.com/playlist?list=PLRy5AGzKZLmE&si=fF0O_ly7XYF6A4zu",
    "",
    `Liquid Banjo | https://suno.com/song/${UUID}`,
    "https://suno.com/s/cq8ogDYThAoJj3fo",
    "Opening | https://youtu.be/_YsP_UGd8Ns",
  ].join("\n"));
  ok("a mixed list keeps every source", tracks.map((t) => t.k).join() === "ytl,a,yt");
  ok("a bad line is reported with its line number", errors.length === 1 && errors[0].line === 4);

  const round = parseTrackList(formatTrackList(tracks));
  ok("a list survives being written out and read back",
    JSON.stringify(round.tracks.map((t) => [t.k, t.t])) === JSON.stringify(tracks.map((t) => [t.k, t.t])));

  const many = Array.from({ length: MAX_TRACKS + 20 }, () => "https://youtu.be/_YsP_UGd8Ns").join("\n");
  ok(`a list is capped at ${MAX_TRACKS}`, parseTrackList(many).tracks.length === MAX_TRACKS);
}

// -------------------------------------------------------------
// Pasting embed codes and whole paragraphs (0.2)
// -------------------------------------------------------------
{
  const GUS = "dd6fccb4-531b-4a6d-ba32-9a181e3c4670";
  const embed = `<iframe src="https://suno.com/embed/${GUS}" width="760" height="240" frameborder="0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"><a href="https://suno.com/song/${GUS}">Listen on Suno</a></iframe>`;
  const one = parseTrackList(embed);
  ok("Suno's embed code, pasted whole, is one song", one.tracks.length === 1 && one.errors.length === 0);
  ok("and it is the right song", one.tracks[0]?.u === `https://cdn1.suno.ai/${GUS}.mp3`);
  ok("the song page address works too", parseLink(`https://suno.com/song/${GUS}`).track?.u === `https://cdn1.suno.ai/${GUS}.mp3`);

  const para = parseTrackList(`Tonight: https://suno.com/song/${GUS}, then https://youtu.be/_YsP_UGd8Ns.`);
  ok("a sentence with two links gives both", para.tracks.map((t) => t.k).join() === "a,yt");
  ok("trailing punctuation is not part of a link", para.tracks[1]?.v === "_YsP_UGd8Ns");

  const ytEmbed = parseTrackList('<iframe src="https://www.youtube.com/embed/videoseries?si=abc&amp;list=PLRy5AGzKZLmE"></iframe>');
  ok("YouTube's playlist embed code works, &amp; and all", ytEmbed.tracks[0]?.k === "ytl" && ytEmbed.tracks[0].l === "PLRy5AGzKZLmE");
  ok("HTML with no usable link is reported", parseTrackList("<p>hello</p>").errors.length === 1);
  const mixed = parseTrackList(`<a href="https://suno.com/s/cq8ogDYThAoJj3fo">x</a> <a href="https://suno.com/song/${GUS}">y</a>`);
  ok("a line with one bad and one good link keeps the good one", mixed.tracks.length === 1 && mixed.errors.length === 0);
  ok("a pasted embed round-trips through the editor",
    parseTrackList(formatTrackList(one.tracks)).tracks[0]?.u === one.tracks[0].u);
}


// -------------------------------------------------------------
// New sources in 1.0: SoundCloud, Dropbox, #audio
// -------------------------------------------------------------
{
  const sc = parseLink("https://soundcloud.com/gsgrimoire/tavern-at-dusk");
  ok("a SoundCloud track", sc.track?.k === "sc" && sc.track.u === "https://soundcloud.com/gsgrimoire/tavern-at-dusk");
  ok("titled from its address", sc.track?.t === "tavern at dusk");
  ok("tracking parameters are dropped", parseLink("https://soundcloud.com/a/b?si=123&utm_source=x").track?.u === "https://soundcloud.com/a/b");
  const emb = parseTrackList('<iframe src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/123456&color=%23ff5500"></iframe>');
  ok("SoundCloud's embed code works", emb.tracks[0]?.k === "sc" && emb.tracks[0].u === "https://api.soundcloud.com/tracks/123456");
  ok("a SoundCloud set says to paste tracks", /one per line/.test(parseLink("https://soundcloud.com/a/sets/b").error || ""));
  ok("a SoundCloud profile page is not a track", !!parseLink("https://soundcloud.com/gsgrimoire/likes").error);
  ok("a SoundCloud short link says what to do", /soundcloud\.com\//.test(parseLink("https://on.soundcloud.com/abc").error || ""));
  ok("SoundCloud needs a visible player", isEmbed(sc.track));

  const db = parseLink("https://www.dropbox.com/scl/fi/abc123/Tavern.mp3?rlkey=xyz&dl=0");
  ok("a Dropbox share link becomes the file", db.track?.k === "a" && /raw=1/.test(db.track.u) && !/dl=0/.test(db.track.u));
  ok("and keeps its key", /rlkey=xyz/.test(db.track?.u || ""));
  ok("a Dropbox link that is not audio is refused", !!parseLink("https://www.dropbox.com/scl/fi/abc/notes.pdf?dl=0").error);
  ok("Google Drive says why not", /Google Drive/.test(parseLink("https://drive.google.com/file/d/abc/view").error || ""));
  ok("#audio forces an extensionless file", parseLink("https://stream.example.com/radio/live#audio").track?.k === "a");
  ok("and the #audio is not part of the address", !/#audio/.test(parseLink("https://stream.example.com/radio/live#audio").track?.u || ""));
  ok("an unknown page explains the options", /#audio/.test(parseLink("https://example.com/page").error || ""));

  ok("a SoundCloud track from a hostile record is checked", readTrack({ k: "sc", u: "https://evil.test/x" }) === null);
  ok("SoundCloud with a query is refused from storage", readTrack({ k: "sc", u: "https://soundcloud.com/a/b?x=1" }) === null);
  ok("credentials in a URL are refused", safeUrl("https://user:pw@x.test/a.mp3") === "");
  ok("javascript: is refused from storage", readTrack({ k: "a", u: "javascript:alert(1)" }) === null);
}

// -------------------------------------------------------------
// The sounds editor
// -------------------------------------------------------------
{
  const text = [
    "## Combat",
    `Sword clash | https://x.test/sword.mp3`,
    `Warhorn | https://suno.com/song/${GUS} | 60`,
    "",
    "## Weather",
    "Rain | https://youtu.be/_YsP_UGd8Ns",
    "Whole list | https://youtube.com/playlist?list=PLRy5AGzKZLmE",
  ].join("\n");
  const { sounds, errors } = parseSoundList(text);
  ok("sounds are read with their pages", sounds.map((s) => s.page).join() === "Combat,Combat,Weather");
  ok("a volume after a second bar", sounds[1]?.vol === 0.6 && sounds[0]?.vol === 1);
  ok("a whole YouTube playlist is not a sound", errors.length === 1 && errors[0].line === 7);
  ok("pages in order", soundPages({ sounds }).join() === "Combat,Weather");
  const again = parseSoundList(formatSoundList(sounds), sounds);
  ok("sounds survive being written out and read back, ids and all",
    JSON.stringify(again.sounds.map((s) => [s.id, s.name, s.page, s.vol])) === JSON.stringify(sounds.map((s) => [s.id, s.name, s.page, s.vol])));
  const renamed = parseSoundList(formatSoundList(sounds).replace("Sword clash", "Steel"), sounds);
  ok("renaming a sound keeps its id, so reactions still find it", renamed.sounds[0].id === sounds[0].id && renamed.sounds[0].name === "Steel");
}

// -------------------------------------------------------------
// The library, and upgrading a 0.2 one
// -------------------------------------------------------------
{
  const v1 = {
    lists: [{ id: "ex", name: "Explore", tracks: [A("one")] }, { id: "cb", name: "Combat", tracks: [YT("_YsP_UGd8Ns")] }],
    combatList: "cb",
    cues: { threatUp: A("threat"), bed: A("bed"), round: YT("_YsP_UGd8Ns") },
    cueSeconds: 8,
    shuffle: true,
  };
  const lib = readLibrary(v1);
  ok("a 0.2 library is upgraded", lib.v === 2 && lib.lists.length === 2 && lib.shuffle);
  ok("its stingers become sounds", lib.sounds.length === 2 && lib.sounds.every((s) => s.page === "D&M"));
  ok("and reactions that fire them", lib.reactions.threatUp?.sound === lib.sounds.find((s) => s.track.u.includes("threat")).id);
  ok("its combat playlist becomes a scene", lib.scenes[0]?.music.mode === "list" && lib.scenes[0].music.list === "cb");
  ok("initiative recalls it, and its end brings the music back",
    lib.reactions.combatStart?.scene === lib.scenes[0].id && lib.reactions.combatEnd?.restore === true);

  const hostile = readLibrary({ v: 2,
    lists: [{ id: "a", name: "x".repeat(300), tracks: [{ k: "a", u: "javascript:1" }] }, { id: "a", name: "dup" }, { id: "../x", name: "bad id" }],
    sounds: [{ id: "s1", track: { k: "ytl", l: "PL123" } }, { id: "s2", track: A("ok"), vol: 9, page: "p".repeat(90) }],
    scenes: [{ id: "z", music: { mode: "list", list: "gone" }, amb: [{ track: YT("_YsP_UGd8Ns"), mode: "scatter" }, { track: A("rain") }] }],
    reactions: { threatUp: { sound: "s-nope" }, bed: { sound: "s2" }, combatStart: { restore: true }, evil: { sound: "s2" } },
  });
  ok("duplicate and malformed ids are dropped", hostile.lists.length === 1 && hostile.lists[0].name.length <= 40);
  ok("bad tracks are dropped", hostile.lists[0].tracks.length === 0);
  ok("a playlist cannot be a sound", hostile.sounds.length === 1 && hostile.sounds[0].id === "s2");
  ok("page names and volumes are clamped", hostile.sounds[0].page.length <= 40 && hostile.sounds[0].vol === 1);
  ok("a scene naming a missing playlist keeps the music instead", hostile.scenes[0].music.mode === "keep");
  ok("a scattered video is refused, a looped file kept", hostile.scenes[0].amb.length === 1 && hostile.scenes[0].amb[0].track.u.includes("rain"));
  ok("a reaction to a missing sound is dropped", !hostile.reactions.threatUp);
  ok("restore only belongs to initiative ending", !hostile.reactions.combatStart);
  ok("unknown cues are dropped", !hostile.reactions.evil && hostile.reactions.bed?.sound === "s2");
}

// -------------------------------------------------------------
// Room state: untrusted, and bounded
// -------------------------------------------------------------
{
  ok("no state reads as silence", readState({}, STATE_KEY).music === null && readState({}, STATE_KEY).amb.length === 0);
  const old = readState({ [STATE_KEY]: { v: 1, seq: 4, track: A("old"), at: 5, paused: null, list: "ex", i: 1, label: "Explore" } }, STATE_KEY);
  ok("a room left playing by 0.2 keeps playing, as music", old.music?.track.t === "old" && old.music.seq === 4);

  const hostile = readState({ [STATE_KEY]: { v: 2,
    music: { seq: "1e99", track: { k: "a", u: "javascript:x" } },
    amb: [
      ...Array.from({ length: 9 }, (_, i) => ({ id: "L" + i, track: A("r" + i), vol: 5 })),
    ],
  } }, STATE_KEY);
  ok("a hostile music track is dropped", hostile.music === null);
  ok(`layers are capped at ${MAX_LAYERS}`, hostile.amb.length === MAX_LAYERS);
  ok("layer volumes are clamped", hostile.amb.every((l) => l.vol <= 1));
  const embeds = readState({ [STATE_KEY]: { v: 2, music: { track: YT("aaaaaaaaaaa") },
    amb: [{ id: "a", track: YT("bbbbbbbbbbb") }, { id: "b", track: YT("ccccccccccc") }, { id: "c", track: A("x") }] } }, STATE_KEY);
  ok(`a record naming too many video players is cut to ${MAX_EMBEDS}`, embedCount(embeds) === MAX_EMBEDS && embeds.amb.length === 2);
  ok("the pasted link never reaches the room",
    !JSON.stringify(writeState({ ...emptyState(), music: { track: { ...A("x"), s: "pasted" }, seq: 1, at: 0, paused: null } })).includes("pasted"));
}

// -------------------------------------------------------------
// Music
// -------------------------------------------------------------
{
  const lib = readLibrary({ v: 2, lists: [{ id: "ex", name: "Explore", tracks: [A("one"), A("two"), A("three")] }] });
  const s0 = musicStart(emptyState(), lib, "ex", 0, 1000).state;
  ok("starting a playlist plays its first track", s0.music.track.t === "one" && s0.music.label === "Explore" && s0.music.seq === 1);
  const s1 = musicAdvance(s0, lib, 2000).state;
  ok("next moves on and bumps seq", s1.music.i === 1 && s1.music.seq === 2 && s1.music.at === 2000);
  ok("and loops at the end", musicAdvance({ ...s1, music: { ...s1.music, i: 2 } }, lib, 3000).state.music.i === 0);
  ok("previous goes back", musicAdvance(s0, lib, 3000, Math.random, -1).state.music.i === 2);
  const p = musicPause(s0, 16000).state;
  ok("pause freezes the position", p.music.paused === 15 && musicPosition(p.music, 99000) === 15);
  const r = musicResume(p, 50000).state;
  ok("resume carries on from there", musicPosition(r.music, 51000) === 16);
  ok("volume is kept across tracks", musicAdvance(musicVolume(s0, 0.4).state, lib, 5000).state.music.vol === 0.4);
  ok("stop is silence", musicStop(s0).state.music === null);
  ok("a video moving on inside a playlist resets the clock and title",
    musicSub({ ...s0, music: { ...s0.music, nt: "old" } }, 3, 7000).state.music.sub === 3
      && musicSub({ ...s0, music: { ...s0.music, nt: "old" } }, 3, 7000).state.music.nt === "");
  ok("the video's own title wins", displayTitle({ ...s0.music, nt: "Song" }) === "Song");
  ok("an empty playlist is refused", !!musicStart(emptyState(), readLibrary({ v: 2, lists: [{ id: "e", name: "E" }] }), "e", 0, 0).error);
  let repeats = 0;
  for (let k = 0; k < 500; k++) if (nextIndex(5, 2, true) === 2) repeats += 1;
  ok("shuffle never repeats the track that just played", repeats === 0);
}

// -------------------------------------------------------------
// Ambience layers
// -------------------------------------------------------------
{
  let s = emptyState();
  s = layerAdd(s, { track: A("rain"), vol: 0.5 }, 1000).state;
  s = layerAdd(s, { track: A("crowd"), vol: 0.3 }, 1000).state;
  ok("layers stack", s.amb.length === 2 && s.amb[0].mode === "loop");
  const gull = layerAdd(s, { track: A("gull"), mode: "scatter", min: 10, max: 40 }, 1000);
  ok("a scattered layer keeps its interval", gull.state.amb[2].mode === "scatter" && gull.state.amb[2].min === 10 && gull.state.amb[2].max === 40);
  ok("a scattered video is refused", !!layerAdd(s, { track: YT("_YsP_UGd8Ns"), mode: "scatter" }, 0).error);
  ok("a whole playlist cannot be a layer", !!layerAdd(s, { track: { k: "ytl", l: "PL1" } }, 0).error);
  let full = s;
  for (let k = 0; k < MAX_LAYERS; k++) full = layerAdd(full, { track: A("x" + k) }, 0).state || full;
  ok(`the ${MAX_LAYERS + 1}th layer is refused`, full.amb.length === MAX_LAYERS && /At most/.test(layerAdd(full, { track: A("more") }, 0).error || ""));
  const id = s.amb[0].id;
  ok("a layer's volume changes alone", layerVolume(s, id, 0.9).state.amb[0].vol === 0.9 && layerVolume(s, id, 0.9).state.amb[1].vol === 0.3);
  ok("a layer stops alone", layerRemove(s, id).state.amb.map((l) => l.track.t).join() === "crowd");

  const withVideo = layerAdd(musicStart(emptyState(), readLibrary({ v: 2, lists: [{ id: "v", name: "V", tracks: [YT("aaaaaaaaaaa")] }] }), "v", 0, 0).state,
    { track: YT("bbbbbbbbbbb") }, 0).state;
  ok("music and one layer may both be videos", embedCount(withVideo) === 2);
  ok(`a third video is refused with a reason`, /Only 2/.test(layerAdd(withVideo, { track: YT("ccccccccccc") }, 0).error || ""));

  ok("a loop's position wraps at its length", layerPosition({ at: 0 }, 250000, 100) === 50);
  ok("before the length is known, it is plain elapsed time", layerPosition({ at: 0 }, 250000, NaN) === 250);
  ok("near the loop point is not drift", !needsSeek(99.5, 0.5, 100));
  ok("real drift in a loop is", needsSeek(40, 50, 100));

  // Budget. Real links are short: a Suno file is 60 characters, a Dropbox link ~150.
  const realistic = (k) => ({ k: "a", u: `https://www.dropbox.com/scl/fi/${"a".repeat(24)}${k}/${"Tavern_ambience_long_name".repeat(2)}.mp3?rlkey=${"r".repeat(25)}&raw=1`, t: "t".repeat(80) });
  const lib = readLibrary({ v: 2, lists: [{ id: "l".repeat(30), name: "n".repeat(40), tracks: [realistic(9)] }] });
  let real = musicStart(emptyState(), lib, "l".repeat(30), 0, 0).state;
  real = { ...real, music: { ...real.music, nt: "n".repeat(80) }, scene: "s".repeat(80) };
  for (let k = 0; k < MAX_LAYERS; k++) real = layerAdd(real, { track: realistic(k), label: "l".repeat(80) }, 0).state || real;
  ok(`four layers of real links, long titles everywhere, fit (${stateSize(real)} of ${STATE_BUDGET} bytes)`,
    real.amb.length === MAX_LAYERS && stateSize(real) <= STATE_BUDGET);
  // The extreme: every link at the 600-character limit. The room must never be
  // asked to hold more than its share — a layer that would not fit is REFUSED,
  // with a reason, rather than written.
  const huge = (k) => ({ k: "a", u: "https://" + "y".repeat(570) + k + ".test/a.mp3", t: "t".repeat(80) });
  let worst = real;
  worst = { ...emptyState(), music: { ...real.music, track: huge(9) }, scene: real.scene };
  let refusal = "";
  for (let k = 0; k < MAX_LAYERS; k++) {
    const r = layerAdd(worst, { track: huge(k), label: "l".repeat(80) }, 0);
    if (r.state) worst = r.state; else refusal = r.error;
  }
  ok(`at the extreme, the room's share is never exceeded (${stateSize(worst)} bytes)`, stateSize(worst) <= STATE_BUDGET);
  ok("and the layer that would not fit is refused with a reason", /more than the room can hold/.test(refusal));
  ok("which leaves D&M its 11 kB of the room's 16", STATE_BUDGET + 11000 < 16000);
}

// -------------------------------------------------------------
// Scenes, and initiative's snapshot
// -------------------------------------------------------------
{
  const lib = readLibrary({ v: 2,
    lists: [{ id: "tav", name: "Tavern", tracks: [A("lute")] }, { id: "cb", name: "Combat", tracks: [A("drums")] }],
    scenes: [
      { id: "s-tav", name: "Tavern", music: { mode: "list", list: "tav" }, amb: [{ track: A("rain"), vol: 0.4 }, { track: A("crowd"), vol: 0.6 }] },
      { id: "s-back", name: "Back room", music: { mode: "keep" }, amb: [{ track: A("rain"), vol: 0.8 }] },
      { id: "s-fight", name: "Fight", music: { mode: "list", list: "cb", vol: 0.9 }, amb: [] },
      { id: "s-hush", name: "Silence", music: { mode: "stop" }, amb: [] },
    ],
  });
  const tav = sceneApply(emptyState(), lib, "s-tav", 1000).state;
  ok("a scene starts its music and its layers", tav.music.label === "Tavern" && tav.amb.length === 2 && tav.scene === "Tavern");
  const back = sceneApply(tav, lib, "s-back", 9000).state;
  ok("a layer in both scenes keeps playing where it was", back.amb.length === 1 && back.amb[0].id === tav.amb[0].id && back.amb[0].at === 1000);
  ok("with the new scene's volume", back.amb[0].vol === 0.8);
  ok("'keep' leaves the music alone", back.music.seq === tav.music.seq);
  ok("the same playlist is not restarted", sceneApply(tav, lib, "s-tav", 5000).state.music.seq === tav.music.seq);
  const fight = sceneApply(tav, lib, "s-fight", 20000).state;
  ok("a scene can change the music, and set its volume", fight.music.label === "Combat" && fight.music.vol === 0.9 && fight.amb.length === 0);
  ok("a scene can stop the music", sceneApply(tav, lib, "s-hush", 0).state.music === null);

  const made = sceneFromState(tav, { id: "new", name: "Mine" });
  ok("a scene can be made from what is playing", made.music.list === "tav" && made.amb.length === 2 && readLibrary({ v: 2, lists: lib.lists, scenes: [made] }).scenes.length === 1);

  const snap = snapshot(tav, 31000); // 30 s into the lute
  const back2 = restore(fight, JSON.parse(JSON.stringify(snap)), 90000).state;
  ok("after initiative, the music comes back", back2.music.label === "Tavern" && back2.amb.length === 2);
  ok("where it left off", musicPosition(back2.music, 90000) === 30);
  ok("as a new track, so every player reloads it", back2.music.seq === fight.music.seq + 1);
  ok("a hostile snapshot is refused", !!restore(fight, null, 0).error);
}

// -------------------------------------------------------------
// Reactions to the D&M table
// -------------------------------------------------------------
{
  const base = { threat: 2, momentum: 3, initiative: null, epochs: { breather: 0, bed: 0, scene: 0 }, log: [{ id: "old" }] };
  ok("the first reading is a baseline, not news", diffDnm(undefined, base).length === 0);
  ok("nothing changed, nothing happens", diffDnm(base, { ...base }).length === 0);
  ok("initiative starting", diffDnm(base, { ...base, initiative: { round: 1 } }).includes("combatStart"));
  ok("a new round", diffDnm({ ...base, initiative: { round: 1 } }, { ...base, initiative: { round: 2 } }).join() === "round");
  ok("threat, both ways", diffDnm(base, { ...base, threat: 5 }).join() === "threatUp" && diffDnm(base, { ...base, threat: 0 }).join() === "threatDown");
  ok("a Breather", diffDnm(base, { ...base, epochs: { ...base.epochs, breather: 1 } }).join() === "breather");
  ok("D&M not in the room is not an event", diffDnm(null, undefined).length === 0);

  const roll = (x) => ({ ...base, log: [{ id: "r1", ...x }, ...base.log] });
  ok("a successful roll", diffDnm(base, roll({ pass: true, diff: 2, detail: [{ kind: "success" }] })).join() === "rollSuccess");
  ok("a failed roll", diffDnm(base, roll({ pass: false, diff: 2, detail: [{ kind: "fail" }] })).join() === "rollFail");
  ok("a roll with no difficulty neither passes nor fails", diffDnm(base, roll({ pass: false, diff: 0 })).length === 0);
  ok("a complication", diffDnm(base, roll({ pass: true, diff: 1, comp: 1, detail: [{ kind: "complication" }] })).includes("rollComplication"));
  ok("a critical", diffDnm(base, roll({ pass: true, diff: 1, detail: [{ kind: "crit" }] })).includes("rollCrit"));
  ok("A HIDDEN ROLL SAYS NOTHING — a sting would give its result away",
    diffDnm(base, roll({ pass: false, diff: 2, comp: 2, conceal: "hidden" })).length === 0);
  ok("nor does the old secret-roll shape", rollCues({ id: "x", pass: true, diff: 1, hidden: true }).length === 0);
  ok("an action in the log is not a roll", rollCues({ id: "x", kind: "action", pass: true, diff: 1 }).length === 0);
  ok("the same roll seen again is not news", diffDnm(roll({ pass: true, diff: 1 }), roll({ pass: true, diff: 1 })).length === 0);
  const burst = { ...base, log: Array.from({ length: 20 }, (_, i) => ({ id: "b" + i, pass: true, diff: 1 })) };
  ok("a burst of new rolls is one cue, not twenty", diffDnm(base, burst).join() === "rollSuccess");

  const endScene = diffDnm({ ...base, initiative: { round: 3 } }, { ...base, initiative: null, epochs: { ...base.epochs, scene: 1 } });
  ok("End Scene also ends initiative", endScene.includes("scene") && endScene.includes("combatEnd"));
  ok("cues are ordered by significance", sortCues(["momentumUp", "rollCrit", "scene"]).join() === "scene,rollCrit,momentumUp");

  const lib = readLibrary({ v: 2,
    sounds: [{ id: "s1", track: A("gong") }, { id: "s2", track: A("clang") }],
    lists: [{ id: "cb", name: "C", tracks: [A("d")] }],
    scenes: [{ id: "calm", name: "Calm", music: { mode: "keep" }, amb: [] }, { id: "fight", name: "Fight", music: { mode: "list", list: "cb" }, amb: [] }],
    reactions: {
      scene: { scene: "calm" },
      combatEnd: { restore: true, sound: "s2" },
      combatStart: { scene: "fight", sound: "s1" },
      rollCrit: { sound: "s1" },
    },
  });
  const plan = planReaction(endScene, lib);
  ok("End Scene's own scene wins over going back to the pre-fight music", plan.scene === "calm" && !plan.restore);
  ok("and the sound comes from the most significant cue that has one", plan.sound === "s2");
  ok("initiative ending alone brings the music back", planReaction(["combatEnd"], lib).restore === true);
  ok("initiative starting recalls its scene with its sound", planReaction(["combatStart"], lib).scene === "fight" && planReaction(["combatStart"], lib).sound === "s1");
  ok("a cue with nothing set does nothing", JSON.stringify(planReaction(["momentumUp"], lib)) === JSON.stringify({ sound: "", scene: "", restore: false, cue: "" }));
  ok("an empty library reacts to nothing", planReaction(["combatStart", "rollCrit"], emptyLibrary()).sound === "");
}

// -------------------------------------------------------------
// The console link
// -------------------------------------------------------------
{
  ok("a command round-trips", readCommand(command("music.next"))?.op === "music.next");
  ok("an unknown op is refused", readCommand({ ns: NS, t: "cmd", op: "eval", args: {} }) === null);
  ok("another site's messages are ignored", readCommand({ t: "cmd", op: "music.next" }) === null);
  ok("players may set their own volume", !GM_ONLY.has("prefs.set"));
  ok("but nothing that changes the room", GM_ONLY.has("music.play") && GM_ONLY.has("sound.fire") && GM_ONLY.has("lib.put"));
}

// -------------------------------------------------------------
// Settings and the dock
// -------------------------------------------------------------
{
  const p = readPrefs({ music: 7, amb: -1, corner: "middle" });
  ok("volumes are clamped", p.music === 1 && p.amb === 0 && p.fx === 0.8);
  ok("an unknown corner falls back", p.corner === "bottom-left");
  const bar = barPopover({ url: "x", corner: "bottom-right", viewport: { width: 1600, height: 900 }, embeds: 2 });
  ok("the bar stays open on a map click", bar.disableClickAway === true);
  ok("two video players fit side by side", bar.width === 400 && bar.height === barSize(0).height + 200);
  ok("bottom-right is held by its bottom-right corner", bar.transformOrigin.horizontal === "RIGHT" && bar.anchorPosition.left === 1584);
}

console.log(`radio: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
