# GS Grimoire Radio

An Owlbear Rodeo extension that plays music to the whole table. It streams
straight from YouTube and Suno links, and nothing is downloaded or re-hosted.
It can also react to the Dreams & Machines extension: its own playlist for
initiative, and a sound for Threat, Momentum, rests and scene changes.

Version **0.2**. Not yet tried in a real room; see *Live checks* below.

## Using it

**Everyone:** open *Radio* in the toolbar and press **Open the radio**. A small bar
docks in a corner of the map. Press **▶ Tune in** once; browsers will not play
sound in a page nobody has clicked. Each player sets their own music and sound
volumes on the bar. ⇲ moves it to the next corner (and asks for Tune in again,
because the moved bar is a new page).

**GM:** keep your own bar open. It is what moves the table to the next track.

- **Playlists.** One link per line, `Title | link` to name it. Mix freely:
  - YouTube videos, `youtu.be/…` or `youtube.com/watch?v=…`
  - whole YouTube playlists, `youtube.com/playlist?list=…`
  - Suno songs, `suno.com/song/<id>`
  - any `https://` link to an .mp3/.ogg/.wav/.m4a file
- **Soundscape.** Pick a playlist for initiative. When initiative ends, the music
  it interrupted comes back where it left off. Give any of the thirteen D&M
  events a sound (Suno or audio-file links). Sounds play for a few seconds,
  fade out, and duck the music under them.
- **Backup.** Playlists live in your browser. Copy the library text somewhere
  safe to move it to another browser.

### Suno links

Any of these works in a playlist:

- **a whole Suno playlist at once:** add the **Copy for Radio** bookmark from
  [the Suno helper page](https://gsgrimoire.github.io/obr-radio/suno.html) (it is
  linked from the panel). On a Suno playlist page, press it and paste what it copies.
- a song's address, `https://suno.com/song/<id>`
- a song's embed code (Share → Embed), pasted whole
- any text with song links in it; every link on a line is taken

Why the bookmark rather than just pasting the playlist link: Suno will not answer
a page on another site, so the radio cannot read a playlist, or follow a short
`suno.com/s/…` share link. A bookmark runs as a suno.com page and can read what is
on the screen. It reads the page and writes to your clipboard, nothing else. Suno
only puts songs on the page as you scroll, so scroll to the end first.

Songs must be public for the table to hear them.

### YouTube

YouTube's rules do not allow a hidden or tiny player, so while a YouTube track
plays the bar grows to show a 320×200 video. Players without YouTube Premium may
get adverts, and each player's adverts are their own; the bar pulls them back in
line when the advert ends.

## How it works

Nobody streams to anybody. Every client plays its own copy of the same link and
seeks to where the room says it should be. The room holds one small record under
`com.gsgrimoire.obr-radio/state`: which track, when it started in the GM's
clock, whether it is paused. Players' clocks are corrected by a tick the GM's bar
broadcasts every ten seconds. Two seconds of drift is tolerated before anyone is
moved, or ordinary buffering would make everyone stutter.

| File | What it is |
|---|---|
| `radio.js` | every rule: link parsing, the room record, timing, playlists, the D&M cues. Pure, no SDK |
| `bar.js` / `bar.html` | the docked player. Every client runs one; the GM's also conducts |
| `panel.js` / `index.html` | the toolbar panel: open the bar, and the GM's playlists and soundscape |
| `suno-collect.js` / `suno.html` | the Copy for Radio bookmark, and the page you install it from |
| `sdk.js` | the Owlbear SDK, vendored (same bundle as `dnm-obr`) |

### Decisions, and why

- **Playlists are in the GM's localStorage, not the room.** Room metadata is 16 kB
  shared with every extension; D&M alone reserves 11 kB. The room only holds the
  track that is playing, without the pasted link.
- **The soundscape watches the D&M room record, not D&M's broadcasts.** Any player
  can send a broadcast. The room record (`com.thuknights.dnm-rolls/state`) is
  written only by the GM's D&M background page, after it has checked the sender.
  `diffDnm()` compares two readings. It reads `threat`, `momentum`,
  `initiative.round` and the six `epochs` counters, and nothing else. **If
  dnm-obr changes the shape of those, the soundscape goes quiet.** The first
  reading is a baseline, never news.
- **Only the GM's bar may set the clock or fire a sound.** The broadcast channel
  is open to the room, so the bar checks the sender's connection id against the
  room's GMs. The room record itself cannot be checked that way: any client can
  write metadata. What that allows is a player with devtools changing the music.
  Every URL is clamped to https on the way out of storage, so it cannot run
  script.
- **Stingers are audio files only.** A YouTube stinger would need a second visible
  player and would often open with an advert.
- **Only the most significant cue sounds** when several land at once (End Scene
  also ends initiative), and no more than one every 1.2 seconds.
- **Advancing is guarded by `seq`.** A track ending advances only from the seq that
  ended, so two GM windows cannot skip two tracks for one ending.
- **The Suno file address is one function**, `sunoAudioUrl()`. Suno has no public
  API; `cdn1.suno.ai/<id>.mp3` is simply where its songs are. If Suno moves them,
  that is the line to change.
- **A pasted line with HTML or more than one link is read for every link in it.**
  That is what makes a whole embed code work; an iframe names the same song twice
  (`src` and the fallback `href`), so repeats within a line collapse to one.
- **The bookmark is built from the tested function.** `suno.html` turns
  `collectSunoSongs()` into the bookmark with `toString()`, so the button cannot
  drift from what `ui.test.mjs` ran. Keep that function self-contained.
- **A correction is re-checked the moment a seek lands** (`seeked`, `canplay`). A
  clock tick arriving while a player's first seek was still in flight used to be
  skipped and wait four seconds for the next check. The suite caught it failing
  one run in six; logging showed `readyState 1, seeking true` at the tick.
- **No `prompt()` or `confirm()`.** Owlbear frames extensions and a sandboxed frame
  may refuse modals. Deleting asks for a second press instead.

## Testing

```sh
npm install playwright --no-save
node tests/radio.test.mjs     # the rules, 84 checks, no browser
node tests/ui.test.mjs        # the bar, panel and bookmark in Chromium, 74 checks
```

`ui.test.mjs` swaps the SDK for a stub in a staged copy under `out/`, and answers
Suno's CDN and YouTube's iframe API by request interception: generated WAV files,
served with byte ranges as a real CDN does (without ranges, a far seek quietly
lands at the start), and a fake `YT.Player`. Removing the GM check from the bar
fails four checks; a crash in `bar.js` fails the suite in seconds.

### Live checks: what no suite here can see

1. The bar plays sound after one press inside Owlbear, and **keeps playing** while
   the map is used.
2. `cdn1.suno.ai/<id>.mp3` plays for a page on `gsgrimoire.github.io`. Try
   *Liquid Banjo* (`suno.com/song/dd6fccb4-531b-4a6d-ba32-9a181e3c4670`), and check
   that joining partway through lands at the right place (that needs byte ranges).
3. The Copy for Radio bookmark on a real Suno playlist page finds every song, with
   titles. It was tested against a page shaped the way Suno's links are expected
   to be, not against Suno.
4. YouTube's real player starts from our press, or shows "Press play on the
   video once". Try the GS Grimoire playlist.
5. Two players stay within a couple of seconds of each other.
6. Initiative, Threat, Momentum and a Breather from the D&M extension each do what
   the soundscape says.

## Releases

- **0.2**: paste Suno embed codes, or any text with links, straight into a
  playlist; a Copy for Radio bookmark takes a whole Suno playlist at once. Fixed a
  late-joining player waiting up to four seconds to catch up.
- **0.1**: first version. Mixed playlists from YouTube, YouTube playlists, Suno
  and audio links. Synced playback, a docked bar, and a D&M soundscape.
