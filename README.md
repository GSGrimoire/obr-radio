# GS Grimoire Radio

An Owlbear Rodeo extension for the whole table's sound: music, ambience layers under
it, and a soundboard over it. Everything streams from where it already lives —
YouTube, Suno, SoundCloud, Dropbox, any audio link — mixed freely in one playlist.
Nothing is downloaded or re-hosted, and players need no accounts.

If the Dreams & Machines extension is in the room, the radio can react to the table:
a scene for initiative (and the music it interrupted, back afterwards), a sting when
Threat rises, a sound for a critical or a complication. Without D&M it is a complete
radio on its own.

Version **1.1B**. Not yet tried in a real room; see *Live checks* below.

**Install:** in Owlbear, add `https://gsgrimoire.github.io/obr-radio/manifest.json`.

## Using it

**Everyone:** open *Radio* in the toolbar and press **Open the radio**. A small bar
docks in a corner of the map. Press **▶ Tune in** once: browsers will not play sound
in a page nobody has clicked. Your own volumes for music, ambience and sounds are in
the Radio panel; 🔊 on the bar mutes the radio for you. ⇲ moves the bar to the next
corner (and asks for Tune in again, because the moved bar is a new page).

**GM:** keep your own bar open. It is what plays the music, moves it on, fires the
soundboard and reacts to the table. The **Radio panel** is its console:

- **Play** — the music (playlist, transport, level), up to four **ambience layers**
  under it (each looped, or "now and then" at random intervals, each with its own
  level), your **scenes** (one press recalls a playlist and its ambience together),
  and the **soundboard**.
- **Library** — playlists and sounds, as text: one link per line, `Title | link`.
  Sounds are grouped into soundboard pages with `## Page` lines, and can carry their
  own level: `Horn | link | 60`.
- **Reactions** — what happens at a D&M table, and what the radio does about it: a
  sound, a scene, or (when initiative ends) going back to what was playing. Also:
  give an Owlbear scene a radio scene, and it plays when you switch to it.
- **Settings** — shuffle, fade length, and a text backup of the whole library.

**⧉ on the bar** opens the same console in its own window, for a second screen. It
is a remote control for the bar inside Owlbear: close it any time and the sound
carries on.

### Starter packs

Library → **Starter packs** adds ready-made material in one press. Adding a pack
never replaces anything you already have: a sound whose link you already have is
not added twice, a playlist or scene with the same name is left alone, and a
reaction is filled in only where you have not chosen a sound.

| Pack | What it adds |
|---|---|
| Battle & adventure | 33 soundboard sounds on three pages: Combat, Creatures, World |
| Places & weather | 13 ambience loops (nature, weather, places), 9 hour-long YouTube ambiences (taverns, dungeons, caves, battles, machine ruins), a tavern-music playlist, and 10 scenes built from them |
| Dice & Dreams and Machines | 8 short cues for success, failure, critical, complication, Threat, Momentum, initiative and rests — and the matching reactions |
| GS Grimoire music | the GS Grimoire free songs playlist, and Liquid Banjo |

The files are hosted with the radio (`sounds/`), so every player streams them from
one place. **Every hosted file is CC0, CC BY or public domain — nothing
NonCommercial and nothing NoDerivatives** — so the packs would stay usable even if
the radio became a product. CC BY authors are credited on
[the credits page](https://gsgrimoire.github.io/obr-radio/credits.html), which is
built from the same data as the packs (`packs.js`), so it cannot drift from them.

Where they came from: sound effects from Kenney's packs and CC0 packs on
OpenGameArt (via the CC0-only index `Mcamento8/open-game-sfx-index`); ambience from
Freesound and SoundBible recordings made to loop by the Blanket and AmbientSounds
projects, whose per-sound licences these follow. A sound collection that did not
record each sound's licence was left out rather than guessed at. The YouTube
ambiences are not hosted: they play through YouTube's own player.

### What can go in a playlist

| Source | Paste | Notes |
|---|---|---|
| YouTube | a video, a playlist, or an embed code | a 200px video tile shows while it plays |
| Suno | `suno.com/song/<id>`, or its embed code | a whole Suno playlist: the [Copy for Radio bookmark](https://gsgrimoire.github.io/obr-radio/suno.html) |
| SoundCloud | `soundcloud.com/artist/track`, or its embed code | one track per line; its widget shows while it plays |
| Dropbox | the share link as Dropbox gives it | turned into the file itself |
| Anything else | a link ending in .mp3 .ogg .wav .m4a .opus .flac .webm | add `#audio` to the end of an audio link with no extension |

Not possible, and the radio says why when you try: Suno short links (`suno.com/s/…`)
and SoundCloud short links (open them, paste where they land); Suno and SoundCloud
playlists (paste the tracks, or use the bookmark for Suno); Google Drive (it no
longer lets its files play on other sites).

Soundboard pads and "now and then" sounds must be audio files or Suno songs: a video
cannot fire as a one-shot. Videos can be music, or a looped ambience layer. At most
two YouTube or SoundCloud players show at once, side by side.

## How it works

Nobody streams to anybody. Every client plays its own copy of each source and seeks
to where the room says it should be. The room holds one small record (under
`com.gsgrimoire.obr-radio/state`): the music, up to four ambience layers, and when
each started in the GM's clock. Players' clocks are corrected by a tick the GM's bar
broadcasts; two seconds of drift is tolerated before anyone is moved, or ordinary
buffering would make everyone stutter. Soundboard presses and "now and then" sounds
are one-shot broadcasts from the GM's bar: nothing to sync, nothing to catch up on.

| File | What it is |
|---|---|
| `sources.js` | what a pasted link is, and whether it can be played. Pure |
| `library.js` | the GM's playlists, sounds, scenes and reactions; upgrades a 0.2 library. Pure |
| `state.js` | the room's record and every change to it, each refused before it is written if it breaks a rule. Pure |
| `reactions.js` | what changed at a D&M table, and what the library says to do. Pure |
| `link.js` | the console ↔ bar protocol. Pure |
| `players.js` | one interface over `<audio>`, YouTube's player and SoundCloud's widget |
| `bar.js` / `bar.html` | the docked bar: plays for everyone; the GM's also conducts |
| `console.js` / `index.html` | the console, inside Owlbear or in its own window |
| `packs.js` / `sounds/` / `credits.html` | the starter packs, their files, and their credits |
| `suno-collect.js` / `suno.html` | the Copy for Radio bookmark, and the page you install it from |
| `sdk.js` | the Owlbear SDK, vendored (the same bundle as `dnm-obr`) |

### Decisions, and why

- **The bar is the only writer, and keeps the library.** Room metadata is 16 kB
  shared with every extension (D&M alone reserves 11 kB), so libraries cannot live
  there; they live in the GM's bar's storage. The console asks the bar for
  everything. That is also what lets the popped-out window work: a window outside
  Owlbear has *different storage* from the frames inside it (Chrome partitions
  storage by top-level site), so it could never share a library directly.
- **The popped-out console talks to the bar that opened it, by postMessage.** Not a
  BroadcastChannel and not storage: those cannot cross the partition, which is why
  D&M's v1.29 popped-out sheet never connected. A direct window-to-opener message is
  not storage and does cross. That is why ⧉ is on the *bar*: a window opened by the
  toolbar panel would lose its link when the panel closed. Inside Owlbear, the panel
  and the bar share a partition, so they use a BroadcastChannel.
- **The room's share is budgeted.** Every change is checked against 3.5 kB before it
  is written; with real links, four layers and long titles fit with room to spare.
  A change that would not fit is refused with a reason.
- **Videos are visible, and limited to two.** YouTube's policies do not allow a
  hidden or tiny player; SoundCloud's widget is treated the same way.
- **Reactions read the D&M room record, not D&M's broadcasts.** Any player can send a
  broadcast; the record is written only by the GM's D&M page after it has checked
  the sender. Fields read: `threat`, `momentum`, `initiative.round`, the six `epochs`
  counters, and the roll log's `id`, `kind`, `pass`, `diff`, `comp`,
  `detail[].kind`, `conceal`, `hidden`. **If dnm-obr reshapes those, reactions go
  quiet.** The first reading is a baseline, never news.
- **Hidden rolls never react.** A complication sting on everyone's speakers would
  announce the result of a roll its roller concealed.
- **Only the GM's connection may tick, fire a sound or fire a shot.** The broadcast
  channel is open to the room; the bar checks the sender. Room metadata itself
  cannot be checked that way (any client can write it) — what that allows is a
  player with devtools changing the music, and every URL is clamped to https on
  the way out, so it cannot run script.
- **The console never puts library text into the page as HTML.** A backup may be
  anybody's; names go in as text. Tested with a hostile backup.
- **A layer in two scenes keeps playing** when you move between them: walking from
  the tavern to its back room does not restart the rain.
- **Advancing is guarded by `seq`.** A track ending advances only from the seq that
  ended, so two GM windows cannot skip two tracks for one ending.
- **A Suno link plays the song's public share video** (`cdn1.suno.ai/<id>.mp4`),
  checked 2026-09-25. Suno has no public API and has closed the `.mp3` address
  (its song pages now report the audio URL as "forbidden"). The streaming `.m4a` its
  own player uses is scrambled on purpose, so the radio does not touch it. The share
  video is served to any site, with byte ranges, and its AAC audio plays in any
  browser's `<audio>`. If one Suno file fails, the other format is tried once
  (`sunoFallback()`), which also keeps libraries saved with `.mp3` addresses working.
  It is all in `sunoAudioUrl()` / `sunoFallback()`: when Suno changes again, that is
  where. Suno's embed player has no remote control, so it cannot be synced.
- **A track that will not load does not un-tune anyone.** Only an autoplay refusal
  (`NotAllowedError`) asks for Tune in again; a broken link is skipped, or falls back.
- **No `prompt()` or `confirm()`.** Owlbear frames extensions and a sandboxed frame
  may refuse modals. Deleting asks for a second press instead.

## Testing

```sh
npm install playwright --no-save
node tests/radio.test.mjs     # every rule, every pack and the manifest, no browser (191 checks)
node tests/ui.test.mjs        # the bar, console, pop-out, packs and bookmark in Chromium (117 checks)
```

`ui.test.mjs` swaps the SDK for a stub in a staged copy under `out/`, and answers
Suno's CDN, YouTube's iframe API and SoundCloud's widget API by request
interception: generated WAV files served with byte ranges, and fake players that
record what they were told. It runs two pages side by side for the console and the
bar, and follows a real pop-up for the popped-out window.

### Live checks: what no suite here can see

1. The bar plays sound after one press inside Owlbear, and **keeps playing** while
   the map is used.
2. **The popped-out console connects.** Owlbear's own security headers decide
   whether a window opened from its frames can talk back; if it cannot, the bar
   says so and the Radio panel does the same job.
3. A Suno song plays (try *Liquid Banjo*, `suno.com/song/dd6fccb4-531b-4a6d-ba32-9a181e3c4670`),
   and joining partway lands at the right place. The test browser here has no AAC
   decoder, so the share video's sound is checked only in a real browser.
4. YouTube's real player starts from the Tune in press, or shows "Press play on the
   video once". Try the GS Grimoire playlist.
5. SoundCloud's real widget plays inside the bar and seeks where it is told.
6. Two players stay within a couple of seconds of each other, music and layers.
7. Switching Owlbear scenes recalls the bound radio scene (the suite assumes
   Owlbear reports a scene switch through `onReadyChange`).
8. With D&M in the room: initiative, Threat, a Breather, and an open roll's critical
   each do what the Reactions tab says; a hidden roll does nothing.
9. The Copy for Radio bookmark on a real Suno playlist page finds every song.
10. The starter packs' YouTube ambiences embed (a channel can switch embedding
    off; the radio skips a video that will not play and says so), and the hosted
    loops and effects play from `gsgrimoire.github.io`.

## Releases

- **1.1B**: the manifest description fits Owlbear's 128-character limit (1.1 could
  not be installed); Suno links play the song's share video, as Suno closed its .mp3
  addresses, with a fallback between the two; a track that fails to load no longer
  un-tunes the listener; the YouTube ambiences are verified embeddable and credited
  to their channels.
- **1.1**: starter packs — 33 effects, 13 ambience loops, 9 YouTube ambiences, 10
  scenes, a tavern playlist, cues and reactions for D&M dice, and the GS Grimoire
  music — with a credits page. All hosted files CC0, CC BY or public domain.
- **1.0**: ambience layers under the music (looped or "now and then"); a soundboard
  with pages; scenes that recall music and ambience together, and follow Owlbear
  scene switches; reactions to D&M rolls, pools, initiative and rests; SoundCloud
  and Dropbox sources; the console, in Owlbear or in its own window. A 0.2 library
  is upgraded in place.
- **0.2**: paste Suno embed codes, or any text with links; a Copy for Radio bookmark
  for whole Suno playlists. Fixed a late-joining player waiting up to four seconds
  to catch up.
- **0.1**: first version. Mixed playlists from YouTube and Suno, synced playback, a
  docked bar, and a D&M soundscape.
