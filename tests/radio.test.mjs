// radio.test.mjs — the rules in radio.js, without a browser or a room.
//   node tests/radio.test.mjs
import {
  STATE_KEY, parseLink, parseLine, parseTrackList, formatTrackList, readTrack, readState,
  writeState, positionOf, needsSeek, readLibrary, startList, advance, nextIndex, pauseState,
  resumeState, withSub, diffDnm, pickCue, readPrefs, barPopover, trackKey, displayTitle,
  safeAudioUrl, MAX_TRACKS, emptyState,
} from "../radio.js";

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) passed += 1;
  else { failed += 1; console.log("  FAIL: " + name); }
}

const UUID = "0f6d3c1e-2b8a-4e5f-9a7b-1c2d3e4f5a6b";

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
// Room state is untrusted
// -------------------------------------------------------------
{
  ok("no state reads as nothing playing", readState({}).track === null);
  const hostile = readState({ [STATE_KEY]: {
    seq: "1e99", at: -5, paused: 1e12, i: 9999, sub: -3,
    track: { k: "a", u: "javascript:alert(1)", t: "x" },
    label: "<img src=x onerror=alert(1)>".repeat(20),
  } });
  ok("a javascript: track is dropped", hostile.track === null);
  ok("numbers are clamped", hostile.seq <= 1e9 && hostile.at >= 0 && hostile.paused <= 86400 && hostile.sub >= 0);
  ok("text is clamped", hostile.label.length <= 80);
  ok("an unknown kind is dropped", readTrack({ k: "exe", u: "https://x.test/a.mp3" }) === null);
  ok("a malformed video id is dropped", readTrack({ k: "yt", v: "../../x" }) === null);
  ok("credentials in a URL are refused", safeAudioUrl("https://user:pw@x.test/a.mp3") === "");

  const written = writeState({ ...emptyState(), track: { k: "a", u: "https://x.test/a.mp3", t: "A", s: "pasted link" } });
  ok("the pasted link is not written to the room", !("s" in written.track));
}

// -------------------------------------------------------------
// Timing
// -------------------------------------------------------------
{
  const s = { ...emptyState(), track: { k: "a", u: "https://x.test/a.mp3", t: "A" }, at: 10_000 };
  ok("position counts from the start", positionOf(s, 25_000) === 15);
  ok("never negative", positionOf(s, 0) === 0);
  const p = pauseState(s, 25_000);
  ok("pausing freezes the position", p.paused === 15 && positionOf(p, 99_000) === 15);
  const r = resumeState(p, 50_000);
  ok("resuming carries on from there", positionOf(r, 50_000) === 15 && positionOf(r, 51_000) === 16);
  ok("small drift is left alone", !needsSeek(10, 11.5));
  ok("large drift is corrected", needsSeek(10, 13));
  ok("a video moving on inside a playlist resets the clock", withSub({ ...s, nt: "old" }, 3, 70_000).sub === 3
    && withSub(s, 3, 70_000).at === 70_000 && withSub({ ...s, nt: "old" }, 3, 1).nt === "");
  ok("the video's own title wins over the playlist's", displayTitle({ ...s, nt: "Song" }) === "Song");
  ok("trackKey changes with the video inside a playlist",
    trackKey({ k: "ytl", l: "PL1" }, 1) !== trackKey({ k: "ytl", l: "PL1" }, 2));
}

// -------------------------------------------------------------
// Playlists
// -------------------------------------------------------------
{
  const lib = readLibrary({ lists: [
    { id: "a", name: "Explore", tracks: parseTrackList("https://youtu.be/_YsP_UGd8Ns\nhttps://youtu.be/aaaaaaaaaaa\nhttps://youtu.be/bbbbbbbbbbb").tracks },
    { id: "c", name: "Combat", tracks: parseTrackList(`https://suno.com/song/${UUID}`).tracks },
    { id: "a", name: "Duplicate id", tracks: [] },
  ], combatList: "c", cues: { threatUp: { k: "yt", v: "_YsP_UGd8Ns" }, bed: { k: "a", u: "https://x.test/bed.mp3" } } });
  ok("duplicate list ids are dropped", lib.lists.length === 2);
  ok("the combat list is kept", lib.combatList === "c");
  ok("a YouTube stinger is refused", !lib.cues.threatUp);
  ok("an audio stinger is kept", lib.cues.bed?.u === "https://x.test/bed.mp3");
  ok("a combat list that does not exist is dropped", readLibrary({ combatList: "nope" }).combatList === "");

  const s0 = startList(lib, "a", 0, 1000, 4);
  ok("starting a list plays its first track", s0.track.v === "_YsP_UGd8Ns" && s0.i === 0 && s0.label === "Explore");
  ok("and bumps the seq", s0.seq === 5);
  const s1 = advance(s0, lib, 2000);
  ok("next moves on", s1.i === 1 && s1.seq === 6 && s1.at === 2000);
  ok("and loops at the end", advance({ ...s1, i: 2 }, lib, 3000).i === 0);
  ok("previous goes back", advance(s0, lib, 3000, Math.random, -1).i === 2);
  ok("an empty list plays nothing", startList(readLibrary({ lists: [{ id: "e", name: "E", tracks: [] }] }), "e", 0, 0) === null);

  let repeats = 0;
  for (let n = 0; n < 500; n++) if (nextIndex(5, 2, true) === 2) repeats += 1;
  ok("shuffle never repeats the track that just played", repeats === 0);
  ok("shuffle stays in range", Array.from({ length: 500 }, () => nextIndex(5, 4, true)).every((i) => i >= 0 && i < 5));
}

// -------------------------------------------------------------
// The soundscape
// -------------------------------------------------------------
{
  const base = { threat: 2, momentum: 3, initiative: null, epochs: { breather: 0, bed: 0, scene: 0 } };
  ok("the first reading is a baseline, not news", diffDnm(undefined, base).length === 0);
  ok("nothing changed, nothing happens", diffDnm(base, { ...base }).length === 0);
  ok("initiative starting", diffDnm(base, { ...base, initiative: { round: 1, rows: [] } }).includes("combatStart"));
  ok("a new round", diffDnm({ ...base, initiative: { round: 1 } }, { ...base, initiative: { round: 2 } }).join() === "round");
  ok("threat up", diffDnm(base, { ...base, threat: 5 }).join() === "threatUp");
  ok("threat spent", diffDnm(base, { ...base, threat: 0 }).join() === "threatDown");
  ok("momentum both ways",
    diffDnm(base, { ...base, momentum: 4 }).join() === "momentumUp" && diffDnm(base, { ...base, momentum: 1 }).join() === "momentumDown");
  ok("a Breather", diffDnm(base, { ...base, epochs: { ...base.epochs, breather: 1 } }).join() === "breather");
  const endScene = diffDnm({ ...base, initiative: { round: 3 } }, { ...base, initiative: null, epochs: { ...base.epochs, scene: 1 } });
  ok("End Scene also ends initiative", endScene.includes("scene") && endScene.includes("combatEnd"));
  ok("D&M not being in the room is not an event", diffDnm(null, undefined).length === 0);
  ok("junk in the D&M record is not an event", diffDnm(base, { ...base, threat: "lots", epochs: "x" }).includes("threatDown"));

  const lib = readLibrary({ cues: {
    scene: { k: "a", u: "https://x.test/scene.mp3" },
    combatEnd: { k: "a", u: "https://x.test/end.mp3" },
    threatUp: { k: "a", u: "https://x.test/threat.mp3" },
  } });
  ok("only the most significant cue sounds", pickCue(endScene, lib)?.name === "scene");
  ok("a cue with no sound is skipped", pickCue(["momentumUp"], lib) === null);
  ok("otherwise it plays", pickCue(["threatUp"], lib)?.track.u === "https://x.test/threat.mp3");
}

// -------------------------------------------------------------
// Settings and the dock
// -------------------------------------------------------------
{
  const p = readPrefs({ music: 7, fx: -1, corner: "middle" });
  ok("volumes are clamped", p.music === 1 && p.fx === 0);
  ok("an unknown corner falls back", p.corner === "bottom-left");
  const bar = barPopover({ url: "x", corner: "bottom-right", viewport: { width: 1600, height: 900 }, video: true });
  ok("the bar stays open on a map click", bar.disableClickAway === true);
  ok("bottom-right is held by its bottom-right corner",
    bar.transformOrigin.horizontal === "RIGHT" && bar.transformOrigin.vertical === "BOTTOM" && bar.anchorPosition.left === 1584);
  ok("the bar grows to hold a video", bar.height > barPopover({ url: "x", video: false }).height);
}

console.log(`radio: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
