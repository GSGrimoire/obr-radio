# Roadmap: from "a radio" to a table sound system

## Where it stands (1.0)

Phases 1–4 below shipped together as **1.0**, because each was small once the
multi-channel core existed, and a playtest of the core alone would have told us
little. What 1.0 is, and what only a real room can confirm, is in README.md.

One change from the plan, asked for during the build: **the console can live in its
own window** (⧉ on the bar), for the soundboard on a second screen. It is a remote
control for the bar inside Owlbear — see "Decisions" in README.md for why that is
the only arrangement that can work, and why the library had to move into the bar.

**Phase 0 could not be done from the build machine** (it cannot reach Owlbear,
YouTube, Suno or SoundCloud). Its three questions became playtest checks instead:
scene switching, the SoundCloud widget in a docked panel, and — added — whether
Owlbear lets a popped-out window talk back. The budget arithmetic *was* done:
`tests/radio.test.mjs` checks four layers of real links with long titles fit in
3.5 kB, and that an extreme one is refused rather than written.

The open questions were settled by default, and are easy to revisit:
- soundboard pages are unlimited, 120 sounds in all;
- the name stays GS Grimoire Radio.

**1.1 added starter packs** (see README): effects, ambience loops, YouTube
ambiences, scenes and D&M cues, all CC0 / CC BY / public domain with a credits page.

**1.1B** fixed what the first install attempt found: the manifest description was
over Owlbear's 128 characters, Suno had closed its .mp3 addresses (Suno links now
play the song's public share video, falling back to the .mp3 for older songs), and a
track that failed to load wrongly un-tuned the listener.

**1.2** answered the first table (see README, Releases): first-press buttons,
SoundCloud playlists, per-layer pause, scenes that stop when pressed again, a hand
on a video obeyed, reused YouTube players.

**1.3** took Phase 5: crossfading, and pads for players. SoundCloud was already in
(1.0, playlists in 1.2), and the backup already covers the whole library. Spotify
was examined and set aside — its Developer Policy forbids one source playing to
several listeners, overlapping its audio with other audio, and mixing it with other
services, and the radio does all three (see README, Decisions). Patreon has no
player to use.

**Next: the rest of the playtest.** The plan below is now built through Phase 5.

---

The original plan follows, unchanged, so the record of what was intended stays next
to what was done.

Written before coding starts, so it can be argued with before it's built. Each phase
ships as a real, tested, playable release — not a branch that sits unfinished for
three phases. Version numbers follow the project's own rule (see CLAUDE.md): a
whole number for a headline capability, `.x` for a minor change, a letter for
fixing the last release.

## What "blow it out of the water" means here, specifically

Not "recreate Ambient Forge and Hoot's ambience-mixing and call it further along."
Those are mature, MIT-licensed, and better at that job than a first build of ours
would be. What nothing else on the list does, and what this roadmap is actually
for:

1. **One playlist, any source, pasted as-is.** YouTube video or playlist, Suno
   song, SoundCloud track, a bare audio-file link, or an embed code copied whole —
   already true in 0.2, extended here to more sources.
2. **A soundboard**, Sirenscape-style: a grid of one-press stingers, played over
   whatever music and ambience are already running, without interrupting them.
3. **Ambience layers that stack** — rain, tavern crowd, and a distant lute at once,
   each with its own volume, alongside the music track, not instead of it.
4. **Scenes**: save "this is what's playing" as a named preset, recall it in one
   press, and — if Phase 0 confirms it — have it recall itself when the GM
   switches Owlbear scenes.
5. **Reacts to Dreams & Machines when D&M is in the room, and is a complete,
   useful tool when it is not.** Nobody installs this and needs to know D&M
   exists.

## Explicit non-goals, so scope doesn't creep

- Not competing with Ambient Forge on fade-curve sophistication or its CSV
  import/export. If someone wants deep ambience mixing and nothing else, they
  should use Ambient Forge.
- Not a general streaming client. No Spotify (no legal streaming SDK for this),
  no ripping, no downloading. A source is in scope only if it has a supported,
  public, no-login embed or file URL.
- Not requiring the GM to run a server. Everything stays static-hosted, the same
  as now.
- Not asking players to sign into anything.

## Constraints the whole plan has to respect (carried over from 0.1/0.2, still true)

- **Only one visible video slot.** YouTube's embed policy forbids a hidden or
  sub-200px player. That means at most one YouTube source playing at a time,
  across music AND ambience combined — a second "YouTube ambience layer" is not
  offered as an option in the UI, full stop, not just discouraged.
- **Room metadata is 16 kB, shared, and D&M alone reserves 11 kB of it.**
  Multi-layer state (music + N ambience layers, each with a track and a position)
  has to fit in what's left. Phase 1 does the real arithmetic; expect ambience
  layers to be capped (4 is the working assumption) and per-layer titles kept out
  of the room the same way playlists already are.
- **Libraries live in the GM's localStorage, not the room** — playlists,
  soundboard pads, and scene presets alike. The room only ever holds what is
  currently live. Backup/restore (already built) extends to cover the new pieces.
- **One-shot sounds don't need positional sync.** A soundboard pad is a
  broadcast-and-play, the same mechanism the D&M stingers already use — not
  written to room state, no seek, no resume for a latecomer. Simpler than the
  music/ambience channels, and it should stay that way.
- **Everything untrusted stays untrusted.** Every new piece of state — ambience
  layers, board pads, scene presets — goes through the same read-and-clamp
  discipline `radio.js` already applies to the music state, with the same kind of
  fuzz/hostile-input tests.

## Phase 0 — Spikes (a day or so, no user-facing change)

Answers that change the plan below if they come back "no," so they're checked
first rather than assumed:

- **Scene identity.** Does `OBR.scene.getMetadata()` give a stable way to know
  "this is the tavern scene" across a reload, and does `onReadyChange` reliably
  fire on a GM's scene switch? If yes, scene auto-recall (Phase 3) is real. If
  not, scenes stay manual-recall only, which is still useful.
- **SoundCloud widget in an Owlbear popover.** Confirm the oEmbed-generated
  iframe actually plays inside a small docked panel, and check what its minimum
  visible size is (its own version of YouTube's 200px rule).
- **Real budget arithmetic.** Serialize a plausible worst-case state (4 ambience
  layers + 1 music track, real-length titles) and confirm it fits room metadata
  alongside a D&M-sized log.

Deliverable: a short findings note appended to this file, not code.

## Phase 1 — Multi-channel core (the foundation everything else stands on)

Music stays exactly what it is now: one track, playing for everyone. Ambience
becomes a second, independent channel: 0–4 layers, each its own source, each
looping, each with its own volume, running alongside the music rather than
replacing it.

- `radio.js`: room state grows from `{ track, ... }` to `{ music: {...}, ambience:
  [...] }`. Same positional-sync math, generalized to run per-layer.
- `bar.js`: manages N `<audio>` elements plus the one shared YouTube slot, which
  either the music channel or (never both) one ambience layer may claim.
- Panel: a Music section (what's there today) and a new Ambience section — add a
  layer, set its volume, stop it, independent of what music is doing.
- Tests: the state-shape and hostile-input tests extend to ambience first, before
  any UI is built on top of them — same order the 0.1 build followed.

Ships as **1.0** — a whole number, because "layered ambience alongside music" is
the first headline capability past what 0.2 does.

## Phase 2 — The soundboard

- A `board` in the GM's library: named pads, each pointing at a short audio-file
  or Suno-sourced clip (no YouTube pads — nothing to show a video for).
- Firing a pad broadcasts a fire-and-forget event to everyone, generalizing the
  D&M stinger mechanism that already exists. Ducks music and ambience briefly,
  the same way a D&M cue does now.
- A short per-pad cooldown, so a double-click doesn't double-fire.
- Panel gets a Soundboard tab: edit pads, and fire them directly from there.
  Whether the docked bar also gets a compact pad row is a Phase 2 design
  decision, not a Phase 1 one — the panel is the source of truth either way.

Ships as **1.1** if it's the kind of addition the versioning rule calls a `.x`
(unlikely — a soundboard is a headline capability), more likely **2.0**. Call it
when it's built and the rule can be applied honestly rather than guessed now.

## Phase 3 — Scenes

- Save the current music + ambience configuration as a named preset in the GM's
  library. Recall it in one press.
- If Phase 0 confirmed scene identity works: an optional per-Owlbear-scene binding,
  so walking into the tavern scene can recall the tavern preset automatically,
  with a manual override always available (never fight the GM for control of what
  is playing).
- If Phase 0 came back uncertain: ship manual-recall presets only, and leave the
  auto-binding as backlog rather than promise something we can't yet reproduce.

## Phase 4 — D&M reactivity, rebuilt on the new channels

Mostly a refactor, not new capability: the existing soundscape (Threat, Momentum,
initiative, rests) currently talks to a single-track state. It moves to fire
soundboard pads and swap music/ambience presets on the new multi-channel model
instead. The "initiative starts a combat playlist, and the interrupted music comes
back after" behavior already built carries over, now able to also swap ambience
layers (e.g., tavern chatter fades out when a fight starts).

Confirms, the same way 0.1 did: works identically with no D&M in the room.

## Phase 5 — Stretch, backlog, not committed

- SoundCloud as a third streamable source, if Phase 0 confirms it embeds cleanly.
- Crossfade between music tracks (dual audio elements, a gain ramp) — a polish
  item, not a capability gap.
- Extend backup/restore to cover boards and presets alongside playlists (should
  be nearly free once their shapes exist).
- **Spotify tracks and playlists** (asked for 2026-09-25). Spotify's Embed iFrame API
  can load, play, pause and seek an embedded track or playlist, so it could sync the
  way YouTube does. The catch: an embed plays the FULL track only for a listener
  logged in to Spotify in that browser; everyone else hears a 30-second preview. The
  Web Playback SDK is worse for this — every listener would need Premium and to sign
  in to the radio. So: build it as an embed source, and say plainly in the console
  which of your players will hear previews. Check the current terms first.
- **Patreon tracks** (asked for 2026-09-25). Patreon has no embed player or streaming
  API; audio in posts sits behind patron sign-in with addresses that expire, so a
  radio cannot play it for a table. Worth checking again only if Patreon adds a
  player; until then the route is to post the audio somewhere streamable too (Suno,
  YouTube, SoundCloud) and paste that link.
- Player-triggerable pads, opt-in, GM-controlled — genuinely nobody else offers
  this, but it's speculative fun rather than a stated need. Backlog, not planned.

## Open questions for you, before Opus starts

1. **Ambience layer cap.** 4 concurrent layers is my working assumption from the
   metadata budget, not a tested number yet — fine to confirm/adjust after the
   Phase 0 arithmetic comes back.
2. **Soundboard pad count and pages.** Sirenscape-style boards can run into dozens
   of pads. Worth deciding a rough target (one page of ~16? multiple named pages?)
   before the panel layout is built around a guess.
3. **Naming.** Keep it as "GS Grimoire Radio" / `obr-radio`, or does a soundboard
   + ambience system deserve a different product name? Not blocking — easy to
   rename later — but cheaper to settle now than mid-build.

## How to follow along

Each phase lands as its own commit(s) on this branch, with its own test run
(`node tests/radio.test.mjs` and `node tests/ui.test.mjs`, both green) before the
next phase starts, and its own line in README's Releases section. Nothing merges
to `main` without you having seen it working first, same as 0.1 and 0.2.
