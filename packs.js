// =============================================================
// packs.js — the starter packs, and the credits that go with them.
// -------------------------------------------------------------
// Pure data plus one merge function. A GM adds a pack from the Library tab; it
// lands in their library as ordinary playlists, sounds, scenes and reactions,
// which they can then edit like anything else.
//
// WHERE THE FILES COME FROM, AND WHY THEY ARE HOSTED HERE: every file under
// sounds/ is CC0, CC BY or public domain — never NonCommercial, never
// NoDerivatives — so the packs stay usable if the radio ever becomes a product.
// They are served from this repository's GitHub Pages site so that every player
// at the table can stream them, with byte ranges, from one place that will not
// move. CC BY sounds are credited in CREDITS below, which credits.html shows, and
// every CC BY file was edited only to make it loop (noted per file).
//
// The YouTube entries are not files: they play through YouTube's own embedded
// player, which is what YouTube's terms provide for, and the player itself shows
// the channel. They are listed in the credits all the same.
// =============================================================
import { parseLink, trackKey } from "./sources.js";
import { newId, readLibrary, findSound } from "./library.js";
import { DNM_SOUNDS } from "./packs-dnm.js";

export const PACK_BASE = "https://gsgrimoire.github.io/obr-radio/sounds/";

// -------------------------------------------------------------
// Where each file came from
// -------------------------------------------------------------
const CC0 = { license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/" };
const CCBY = { license: "CC BY", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" };
const PD = { license: "Public domain", licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/" };

const SRC = {
  kenneyImpact: { author: "Kenney", title: "Impact Sounds", url: "https://kenney.nl/assets/impact-sounds", ...CC0 },
  kenneyRpg: { author: "Kenney", title: "RPG Audio", url: "https://kenney.nl/assets/rpg-audio", ...CC0 },
  kenneyJingles: { author: "Kenney", title: "Music Jingles", url: "https://kenney.nl/assets/music-jingles", ...CC0 },
  rpgPack: { author: "artisticdude", title: "RPG Sound Pack", url: "https://opengameart.org/content/rpg-sound-pack", ...CC0 },
  battle: { author: "Ogrebane", title: "Battle Sound Effects", url: "https://opengameart.org/content/battle-sound-effects", ...CC0 },
  steps: { author: "TinyWorlds", title: "Different steps on wood, stone, leaves, gravel and mud", url: "https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud", ...CC0 },
  levelUp: { author: "wobbleboxx", title: "Level up, power up, coin get", url: "https://opengameart.org/content/level-up-power-up-coin-get-13-sounds", ...CC0 },
};

// Ambience loops, each a Freesound or SoundBible recording made to loop by the
// Blanket or AmbientSounds projects, whose own credits these follow.
const LOOP_BLANKET = "Made to loop by Porrumentzio for Blanket (github.com/rafaelmardojai/blanket).";
const LOOP_AMBIENT = "Made to loop by Muges for AmbientSounds (github.com/Muges/ambientsounds).";
const AMB = {
  birds: { author: "kvgarlic", title: "Birds", url: "https://freesound.org/people/kvgarlic/sounds/156826/", changes: LOOP_BLANKET, ...CC0 },
  stream: { author: "gluckose", title: "Stream", url: "https://freesound.org/people/gluckose/sounds/333987/", changes: "", ...CC0 },
  wind: { author: "felix.blume", title: "Wind", url: "https://freesound.org/people/felix.blume/sounds/217506/", changes: LOOP_BLANKET, ...CC0 },
  fireplace: { author: "ezwa", title: "Fireplace", url: "https://soundbible.com/1543-Fireplace.html", changes: "", ...PD },
  crowd: { author: "stephan", title: "Restaurant Ambiance", url: "https://soundbible.com/1664-Restaurant-Ambiance.html", changes: "", ...PD },
  crickets: { author: "Lisa Redfern", title: "Crickets Chirping At Night", url: "https://soundbible.com/2083-Crickets-Chirping-At-Night.html", changes: "", ...PD },
  rain: { author: "alex36917", title: "Rain", url: "https://freesound.org/people/alex36917/sounds/524605/", changes: LOOP_BLANKET, ...CCBY },
  storm: { author: "Digifish music", title: "Storm", url: "https://freesound.org/people/digifishmusic/sounds/41739/", changes: LOOP_BLANKET, ...CCBY },
  waves: { author: "Luftrum", title: "Waves", url: "https://freesound.org/people/Luftrum/sounds/48412/", changes: LOOP_BLANKET, ...CCBY },
  boat: { author: "Falcet", title: "Boat", url: "https://freesound.org/people/Falcet/sounds/439365/", changes: LOOP_BLANKET, ...CC0 },
  city: { author: "gezortenplotz", title: "City", url: "https://freesound.org/people/gezortenplotz/sounds/44796/", changes: LOOP_BLANKET, ...CCBY },
  thunder: { author: "RHumphries", title: "Thunderstorm", url: "https://freesound.org/people/RHumphries/sounds/2523/", changes: LOOP_AMBIENT, ...CCBY },
  forestRain: { author: "Corsica_S", title: "Forest Rain", url: "https://freesound.org/people/Corsica_S/sounds/169031/", changes: LOOP_AMBIENT, ...CCBY },
};

// -------------------------------------------------------------
// The packs
// -------------------------------------------------------------
// A sound is { name, page, file | link, credit, vol? }. A scene's layers name
// sounds from ANY pack; the pack that holds the scene need not hold the sound.
// A layer is [name, volume] for a loop, or [name, volume, { mode: "scatter",
// min, max }] for a sound fired now and then, every min–max seconds.
export const PACKS = [
  {
    id: "adventure",
    name: "Battle & adventure",
    blurb: "Soundboard pages for fights, monsters and the world: steel, arrows, spells, doors, footsteps, coins.",
    sounds: [
      { name: "Draw sword", page: "Combat", file: "sfx/sword-draw.ogg", credit: SRC.rpgPack },
      { name: "Sword swing", page: "Combat", file: "sfx/sword-swing.ogg", credit: SRC.rpgPack },
      { name: "Blade clash", page: "Combat", file: "sfx/blade-clash.ogg", credit: SRC.kenneyImpact },
      { name: "Shield bash", page: "Combat", file: "sfx/shield-bash.ogg", credit: SRC.kenneyImpact },
      { name: "Punch", page: "Combat", file: "sfx/punch.ogg", credit: SRC.kenneyImpact },
      { name: "Bow shot", page: "Combat", file: "sfx/bow-shot.ogg", credit: SRC.battle },
      { name: "Arrow whoosh", page: "Combat", file: "sfx/arrow-whoosh.ogg", credit: SRC.battle },
      { name: "Knife slice", page: "Combat", file: "sfx/knife-slice.ogg", credit: SRC.kenneyRpg },
      { name: "Spell", page: "Combat", file: "sfx/spell.ogg", credit: SRC.rpgPack },
      { name: "Magic", page: "Combat", file: "sfx/magic.ogg", credit: SRC.rpgPack },
      { name: "Body falls", page: "Combat", file: "sfx/body-fall.ogg", credit: SRC.kenneyImpact },
      { name: "Wood smash", page: "Combat", file: "sfx/wood-crash.ogg", credit: SRC.kenneyImpact },
      { name: "Glass shatters", page: "Combat", file: "sfx/glass-shatter.ogg", credit: SRC.kenneyImpact },
      { name: "Ogre", page: "Creatures", file: "sfx/ogre.ogg", credit: SRC.rpgPack },
      { name: "Giant", page: "Creatures", file: "sfx/giant.ogg", credit: SRC.rpgPack },
      { name: "Beast growl", page: "Creatures", file: "sfx/beast-growl.ogg", credit: SRC.rpgPack },
      { name: "Shade", page: "Creatures", file: "sfx/shade.ogg", credit: SRC.rpgPack },
      { name: "Slime", page: "Creatures", file: "sfx/slime.ogg", credit: SRC.rpgPack },
      { name: "Werewolf", page: "Creatures", file: "sfx/werewolf.ogg", credit: SRC.rpgPack },
      { name: "Door opens", page: "World", file: "sfx/door-open.ogg", credit: SRC.kenneyRpg },
      { name: "Door shuts", page: "World", file: "sfx/door-close.ogg", credit: SRC.kenneyRpg },
      { name: "Creak", page: "World", file: "sfx/creak.ogg", credit: SRC.kenneyRpg },
      { name: "Steps: stone", page: "World", file: "sfx/steps-stone.ogg", credit: SRC.steps },
      { name: "Steps: gravel", page: "World", file: "sfx/steps-gravel.ogg", credit: SRC.steps },
      { name: "Steps: leaves", page: "World", file: "sfx/steps-leaves.ogg", credit: SRC.steps },
      { name: "Steps: wood", page: "World", file: "sfx/steps-wood.ogg", credit: SRC.steps },
      { name: "Coins", page: "World", file: "sfx/coins.ogg", credit: SRC.kenneyRpg },
      { name: "Book opens", page: "World", file: "sfx/book-open.ogg", credit: SRC.kenneyRpg },
      { name: "Page turns", page: "World", file: "sfx/page-turn.ogg", credit: SRC.kenneyRpg },
      { name: "Axe chop", page: "World", file: "sfx/axe-chop.ogg", credit: SRC.kenneyRpg },
      { name: "Lock", page: "World", file: "sfx/lock-latch.ogg", credit: SRC.kenneyRpg },
      { name: "Chainmail", page: "World", file: "sfx/chainmail.ogg", credit: SRC.rpgPack },
      { name: "Bell tolls", page: "World", file: "sfx/bell-toll.ogg", credit: SRC.kenneyImpact },
    ],
  },
  {
    id: "places",
    name: "Places & weather",
    blurb: "Ambience to layer under the music — rain, wind, fire, sea, crowds — plus hour-long YouTube beds for taverns, dungeons, caves, battles and machine ruins, and ten scenes built from them.",
    sounds: [
      { name: "Birds", page: "Nature", file: "amb/birds.ogg", credit: AMB.birds, vol: 0.6 },
      { name: "Stream", page: "Nature", file: "amb/stream.ogg", credit: AMB.stream, vol: 0.5 },
      { name: "Wind", page: "Nature", file: "amb/wind.ogg", credit: AMB.wind, vol: 0.5 },
      { name: "Night crickets", page: "Nature", file: "amb/night-crickets.ogg", credit: AMB.crickets, vol: 0.5 },
      { name: "Rain", page: "Weather", file: "amb/rain.ogg", credit: AMB.rain, vol: 0.6 },
      { name: "Forest rain", page: "Weather", file: "amb/forest-rain.ogg", credit: AMB.forestRain, vol: 0.6 },
      { name: "Storm", page: "Weather", file: "amb/storm.ogg", credit: AMB.storm, vol: 0.6 },
      { name: "Thunderstorm", page: "Weather", file: "amb/thunderstorm.ogg", credit: AMB.thunder, vol: 0.6 },
      { name: "Fireplace", page: "Places", file: "amb/fireplace.ogg", credit: AMB.fireplace, vol: 0.5 },
      { name: "Crowded room", page: "Places", file: "amb/crowded-room.ogg", credit: AMB.crowd, vol: 0.5 },
      { name: "City street", page: "Places", file: "amb/city.ogg", credit: AMB.city, vol: 0.4 },
      { name: "Sea waves", page: "Places", file: "amb/waves.ogg", credit: AMB.waves, vol: 0.6 },
      { name: "Ship creaking", page: "Places", file: "amb/ship-creak.ogg", credit: AMB.boat, vol: 0.5 },
      // Hour-long YouTube ambiences. They play in a visible video tile.
      { name: "Tavern hubbub", page: "Video beds", link: "https://youtu.be/_P2O9ZXpKD8", by: "Ambient Universe", vol: 0.7 },
      { name: "Heroes' inn", page: "Video beds", link: "https://youtu.be/uaX-2RMzVvQ", by: "Michael Ghelfi Studios", vol: 0.7 },
      { name: "Dark dungeon", page: "Video beds", link: "https://youtu.be/lY_bmhayPtw", by: "Dynamic Dungeons Animated Maps", vol: 0.7 },
      { name: "Dungeon room", page: "Video beds", link: "https://youtu.be/upmAf3wWKKo", by: "Michael Ghelfi Studios", vol: 0.7 },
      { name: "Humid cave", page: "Video beds", link: "https://youtu.be/H0cF3t01T-w", by: "Michael Ghelfi Studios", vol: 0.7 },
      { name: "Battlefield", page: "Video beds", link: "https://youtu.be/-pSCxok55zw", by: "Michael Ghelfi Studios", vol: 0.6 },
      { name: "Siege", page: "Video beds", link: "https://youtu.be/EspwQ6Phw0g", by: "Michael Ghelfi Studios", vol: 0.6 },
      { name: "War machine factory", page: "Video beds", link: "https://youtu.be/nA6WZCslSiY", by: "Michael Ghelfi Studios", vol: 0.6 },
      { name: "Abandoned factory", page: "Video beds", link: "https://youtu.be/-Ycu6uTPquc", by: "Paraclete", vol: 0.6 },
    ],
    lists: [
      { name: "Tavern music", tracks: [
        "Shady Tavern | https://youtu.be/iQiUgrHqB9w | Bardify",
        "Medieval Fantasy Tavern | https://youtu.be/vyg5jJrZ42s | Daydreaming of Persephone",
      ] },
    ],
    scenes: [
      { name: "Tavern", music: { mode: "list", list: "Tavern music", vol: 0.6 }, amb: [["Crowded room", 0.5], ["Fireplace", 0.4]] },
      { name: "Busy inn", music: { mode: "keep" }, amb: [["Heroes' inn", 0.7]] },
      { name: "Forest", music: { mode: "keep" }, amb: [["Birds", 0.6], ["Stream", 0.4], ["Wind", 0.25]] },
      { name: "Rainy forest", music: { mode: "keep" }, amb: [["Forest rain", 0.7], ["Wind", 0.3]] },
      { name: "Night camp", music: { mode: "keep" }, amb: [["Night crickets", 0.5], ["Fireplace", 0.6]] },
      { name: "Rainy town", music: { mode: "keep" }, amb: [["Rain", 0.6], ["City street", 0.35]] },
      { name: "Storm at sea", music: { mode: "keep" }, amb: [["Sea waves", 0.7], ["Thunderstorm", 0.6], ["Ship creaking", 0.5]] },
      { name: "Dungeon", music: { mode: "stop" }, amb: [["Dark dungeon", 0.7]] },
      { name: "Battle", music: { mode: "keep" }, amb: [["Battlefield", 0.6]] },
      { name: "Machine ruins", music: { mode: "keep" }, amb: [["War machine factory", 0.6], ["Wind", 0.4]] },
    ],
  },
  {
    id: "checks",
    name: "Dice & Dreams and Machines",
    blurb: "Short cues for how a roll lands, and for the pools. Adding it also fills in the matching reactions — only the ones you have not set yourself.",
    sounds: [
      { name: "Success", page: "Checks", file: "sfx/success.ogg", credit: SRC.kenneyJingles },
      { name: "Failure", page: "Checks", file: "sfx/failure.ogg", credit: SRC.kenneyJingles },
      { name: "Critical", page: "Checks", file: "sfx/critical.ogg", credit: SRC.levelUp },
      { name: "Complication", page: "Checks", file: "sfx/complication.ogg", credit: SRC.levelUp },
      { name: "Threat rises", page: "Checks", file: "sfx/bell-toll.ogg", credit: SRC.kenneyImpact, vol: 0.7 },
      { name: "Momentum", page: "Checks", file: "sfx/coin-gain.ogg", credit: SRC.levelUp, vol: 0.7 },
      { name: "Initiative", page: "Checks", file: "sfx/sword-draw.ogg", credit: SRC.rpgPack },
      { name: "Rest", page: "Checks", file: "sfx/rise.ogg", credit: SRC.levelUp, vol: 0.7 },
    ],
    reactions: {
      rollSuccess: "Success",
      rollFail: "Failure",
      rollCrit: "Critical",
      rollComplication: "Complication",
      threatUp: "Threat rises",
      momentumUp: "Momentum",
      combatStart: "Initiative",
      breather: "Rest",
      bed: "Rest",
    },
  },
  {
    id: "dnm",
    name: "Dreams & Machines: ruins",
    blurb: "A post-apocalyptic, machine-haunted world: robot steps, lasers, terminals and dream whispers; wasteland wind, machine hives, Geiger counters and alarms; ten scenes, and GS Grimoire's own music for the waste, the fight and the dream.",
    // Every file here is CC0 or CC BY, each checked on its own page by
    // tools/sounds.py, which also records what was done to it (packs-dnm.js).
    sounds: DNM_SOUNDS,
    lists: [
      { name: "D&M: the waste", tracks: [
      "Echoes in the Void | https://suno.com/song/333674b7-a458-4e9f-96b5-c7071da10531 | GS Grimoire",
      "Liminal Echoes | https://suno.com/song/945a6b8f-6a0a-4385-a5e8-05ad20a2b6f3 | GS Grimoire",
      "Beneath the Static | https://suno.com/song/ebba0f38-bf79-4920-b84a-936b29238ebd | GS Grimoire",
      "Hull Breach Protocol | https://suno.com/song/f3c3a231-689b-4481-9001-82b68583de75 | GS Grimoire",
      "Dead marsh ambient track | https://suno.com/song/bf46732c-541f-4fd4-82ee-86fbe0a48063 | GS Grimoire",
      "The Hollow Requiem - Eerie TTRPG Ambience | https://suno.com/song/0d7d1bc0-3622-421c-9c1c-2d854eebcbae | GS Grimoire",
      "Shadows of the Lost | https://suno.com/song/18e2dc11-c07c-42e2-9938-3866a39ef34b | GS Grimoire",
      "The Light Is Not For You (Edit) | https://suno.com/song/9a411016-fc6a-4932-bc13-4f75fcc6ca65 | GS Grimoire",
      ] },
      { name: "D&M: action", tracks: [
      "Scout Report | https://suno.com/song/9ca5c9c5-c135-4074-bfc3-935254af58f3 | GS Grimoire",
      "Fight Against Time | https://suno.com/song/e16550ee-b0ad-432c-82fe-98b26c3765a1 | GS Grimoire",
      "Storm on the Horizon - TTRPG Combat Ambience | https://suno.com/song/1c1f1355-33e5-444c-b5c4-6a2a379d508f | GS Grimoire",
      "Thunder and Stone 2.5 | https://suno.com/song/44ea3eb8-36dd-443e-ae96-c335c3377b6e | GS Grimoire",
      "Hag's Ethereal Assault | https://suno.com/song/ee2c8bfb-08e5-4e58-8439-7fc6e7087af5 | GS Grimoire",
      ] },
      { name: "D&M: dreams", tracks: [
      "Veilwing | https://suno.com/song/931921c2-b21b-41ce-90cf-1de0a63828d4 | GS Grimoire",
      "Wings of Living Light | https://suno.com/song/43feb13c-0934-4e45-9a50-e0ae058932f0 | GS Grimoire",
      "Magic place | https://suno.com/song/bb4bc5df-8e84-4d8e-8f36-0c13248153bf | GS Grimoire",
      "Liminal Echoes | https://suno.com/song/945a6b8f-6a0a-4385-a5e8-05ad20a2b6f3 | GS Grimoire",
      ] },
    ],
    scenes: [
      { name: "Wasteland", music: { mode: "list", list: "D&M: the waste", vol: 0.5 }, amb: [["Wasteland wind", 0.6], ["Ruined world", 0.35], ["Metal creak", 0.5, { mode: "scatter", min: 25, max: 70 }]] },
      { name: "Sandstorm", music: { mode: "keep" }, amb: [["Sandstorm", 0.7], ["Howling wind", 0.4]] },
      { name: "Ruined city in rain", music: { mode: "keep" }, amb: [["Rain on tin", 0.6], ["Dripping ruin", 0.3], ["Static burst", 0.4, { mode: "scatter", min: 30, max: 90 }]] },
      { name: "Old-world bunker", music: { mode: "keep" }, amb: [["Ventilation", 0.5], ["Flickering light", 0.35], ["Dripping ruin", 0.25]] },
      { name: "Radiation zone", music: { mode: "keep" }, amb: [["Geiger: medium", 0.5], ["Wasteland wind", 0.4]] },
      { name: "Machine hive", music: { mode: "keep" }, amb: [["Industrial drone", 0.5], ["Unknown machine", 0.45], ["Servo", 0.5, { mode: "scatter", min: 12, max: 35 }]] },
      { name: "Machine factory", music: { mode: "keep" }, amb: [["Machine factory", 0.55], ["Live wires", 0.25]] },
      { name: "Lockdown", music: { mode: "list", list: "D&M: action", vol: 0.6 }, amb: [["Alarm", 0.4], ["Machine hum", 0.4]] },
      { name: "Machine attack", music: { mode: "list", list: "D&M: action", vol: 0.7 }, amb: [["Machine hum", 0.35], ["Distant explosion", 0.6, { mode: "scatter", min: 15, max: 40 }], ["Distant gunfire", 0.5, { mode: "scatter", min: 10, max: 30 }]] },
      { name: "Dream-touched", music: { mode: "list", list: "D&M: dreams", vol: 0.5 }, amb: [["Dream drone", 0.5], ["Whispers", 0.3]] },
    ],
  },
  {
    id: "music",
    name: "GS Grimoire music",
    blurb: "GS Grimoire's own music: every public Free Song Sunday track from Suno, the YouTube playlist, and Liquid Banjo.",
    lists: [
      { name: "Free Song Sunday", tracks: [
        "The Hollow Requiem - Eerie TTRPG Ambience | https://suno.com/song/0d7d1bc0-3622-421c-9c1c-2d854eebcbae | GS Grimoire",
        "Hag's Ethereal Assault | https://suno.com/song/ee2c8bfb-08e5-4e58-8439-7fc6e7087af5 | GS Grimoire",
        "Sands of Night | https://suno.com/song/1ef08130-e7b7-4d7e-8170-919858e40d98 | GS Grimoire",
        "Sigh of the Locket - Mysterious TTRPG Ambience | https://suno.com/song/c292dc67-e62c-4938-b26e-db7c698e7b9b | GS Grimoire",
        "The Hero's Last Journey | https://suno.com/song/409d426f-c6e5-44f9-8546-a926be44e9c6 | GS Grimoire",
        "Hearthside Tales | https://suno.com/song/6cf18b66-579c-4d7e-a0b2-41401c2cef8d | GS Grimoire",
        "Dust Shimmers - TTRPG Ambience for a western feel. | https://suno.com/song/162d5b4f-a0e7-4114-9dab-50062d4f5d9d | GS Grimoire",
        "Blades and Glory | https://suno.com/song/95cd321c-f686-4879-b804-dcf214b39935 | GS Grimoire",
        "Blades and Glory UnEpic | https://suno.com/song/63682e3a-8cc5-49ed-a100-1a3241f7d8ed | GS Grimoire",
        "Shadows and Silver | https://suno.com/song/3cff225b-76f9-4a58-99a6-74cb6a449e21 | GS Grimoire",
        "Hull Breach Protocol | https://suno.com/song/f3c3a231-689b-4481-9001-82b68583de75 | GS Grimoire",
        "Never let the mask slip | https://suno.com/song/eae39ca1-fdec-4b41-b9eb-d7ffccda5f6e | GS Grimoire",
        "The Cauldrons Whisper | https://suno.com/song/70017800-b956-4952-bc5b-b063b1ea711d | GS Grimoire",
        "Harbor's Call | https://suno.com/song/d7cf847d-c2e5-4cc6-85fe-183efb3a1444 | GS Grimoire",
        "Thunder and Stone 2.5 | https://suno.com/song/44ea3eb8-36dd-443e-ae96-c335c3377b6e | GS Grimoire",
        "Brewing Alchemy (Free) | https://suno.com/song/68d8563c-8f9b-4305-84b8-a6e7241474b2 | GS Grimoire",
        "What Waits Beneath The Banjo tree | https://suno.com/song/c6a7451a-cc05-4d4b-8e3b-6824d540f2c9 | GS Grimoire",
        "Magic place | https://suno.com/song/bb4bc5df-8e84-4d8e-8f36-0c13248153bf | GS Grimoire",
        "Dead marsh ambient track | https://suno.com/song/bf46732c-541f-4fd4-82ee-86fbe0a48063 | GS Grimoire",
        "Fight Against Time | https://suno.com/song/e16550ee-b0ad-432c-82fe-98b26c3765a1 | GS Grimoire",
        "MISSION IMPOSSIBLE STYLE HEIST TRACK | https://suno.com/song/8b899079-3255-41bc-b162-d89584c83307 | GS Grimoire",
        "Veilwing | https://suno.com/song/931921c2-b21b-41ce-90cf-1de0a63828d4 | GS Grimoire",
        "Sadness | https://suno.com/song/303a3136-6cbf-4d49-b7d7-ba7c4d32429d | GS Grimoire",
        "Brass Thimble - TTRPG fey ambience | https://suno.com/song/2ed42e81-34eb-413d-87b8-5504899e77a5 | GS Grimoire",
        "Wings of Living Light | https://suno.com/song/43feb13c-0934-4e45-9a50-e0ae058932f0 | GS Grimoire",
        "The Light Is Not For You (Edit) | https://suno.com/song/9a411016-fc6a-4932-bc13-4f75fcc6ca65 | GS Grimoire",
        "Dhampir Sermon Emo Version | https://suno.com/song/26b85f3b-ec1c-4f3d-a293-d445a1258e10 | GS Grimoire",
        "On the brink of Adventure - TTRPG Ambience | https://suno.com/song/c452caa9-e019-4e61-abaf-569a6d00bad4 | GS Grimoire",
        "Grave-Sprite Bells | https://suno.com/song/382eaf9e-dbbd-4dbb-a101-7bc3c1b24697 | GS Grimoire",
        "The Quiet Tavern - TTRPG Ambience | https://suno.com/song/7816d768-1e85-4fbc-a667-9354115c4172 | GS Grimoire",
        "Storm on the Horizon - TTRPG Combat Ambience | https://suno.com/song/1c1f1355-33e5-444c-b5c4-6a2a379d508f | GS Grimoire",
        "The Hush of the Deep Woods | https://suno.com/song/a3f0ed90-1aaf-4df7-883a-033c5cc48ee6 | GS Grimoire",
        "Ice Cold Shaman | https://suno.com/song/c98c7c1b-e0e7-400d-ae05-49d475e2578e | GS Grimoire",
        "Echoes in the Void | https://suno.com/song/333674b7-a458-4e9f-96b5-c7071da10531 | GS Grimoire",
        "Shadows of the Lost | https://suno.com/song/18e2dc11-c07c-42e2-9938-3866a39ef34b | GS Grimoire",
        "Liminal Echoes | https://suno.com/song/945a6b8f-6a0a-4385-a5e8-05ad20a2b6f3 | GS Grimoire",
        "Dust and Green Fields - TTRPG Ambience for Dungeons and Dragons | https://suno.com/song/fc9f97bf-711f-4935-bb7a-ed3422b22827 | GS Grimoire",
      ] },
      { name: "GS Grimoire free songs", tracks: [
        "GS Grimoire Free Song Sunday | https://youtube.com/playlist?list=PLRy5AGzKZLmE | GS Grimoire",
        "Liquid Banjo with a trumpet twist | https://suno.com/song/dd6fccb4-531b-4a6d-ba32-9a181e3c4670 | GS Grimoire",
      ] },
    ],
  },
];

// A pack playlist line: "Title | link | channel", title and channel optional.
function splitListLine(line) {
  const parts = line.split("|").map((x) => x.trim());
  if (parts.length === 1) return ["", parts[0], ""];
  return [parts[0], parts[1], parts[2] || ""];
}

// Every file credit, in one list, for credits.html and the tests.
export function credits() {
  const rows = [];
  const seen = new Set();
  for (const pack of PACKS) {
    for (const s of pack.sounds || []) {
      const key = s.file || s.link;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ pack: pack.name, name: s.name, file: s.file || "", link: s.link || "", by: s.by || "", credit: s.credit || null });
    }
    for (const l of pack.lists || []) {
      for (const line of l.tracks) {
        if (seen.has(line)) continue;
        seen.add(line);
        const [title, link, by] = splitListLine(line);
        rows.push({ pack: pack.name, name: title || l.name, file: "", link, by, credit: null });
      }
    }
  }
  return rows;
}

// -------------------------------------------------------------
// Turning a pack into library entries
// -------------------------------------------------------------
function trackFor(sound, base) {
  const found = parseLink(sound.file ? base + sound.file : sound.link);
  if (!found.track) throw new Error(`pack sound "${sound.name}": ${found.error}`);
  return { ...found.track, t: sound.name };
}

const allSounds = () => PACKS.flatMap((p) => p.sounds || []);

function packTracks(l) {
  return l.tracks.map((line) => {
    const [title, link] = splitListLine(line);
    const found = parseLink(link);
    if (!found.track) throw new Error(`pack list "${l.name}": ${found.error}`);
    return title ? { ...found.track, t: title } : found.track;
  });
}

// Adds a pack to a library and returns { lib, added: { sounds, lists, scenes,
// reactions }, skipped }. Nothing the GM already has is replaced:
//   · a sound whose link is already in the library is not added twice
//   · a playlist or scene with the same name is left as it is
//   · a reaction is filled only where the GM has not chosen a sound
export function addPack(lib, packId, { base = PACK_BASE, rand = Math.random } = {}) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return { error: "No such pack." };
  const next = readLibrary(lib);
  const added = { sounds: 0, lists: 0, scenes: 0, reactions: 0 };
  let skipped = 0;
  const idByName = new Map();

  for (const s of pack.sounds || []) {
    const track = trackFor(s, base);
    const existing = next.sounds.find((x) => trackKey(x.track) === trackKey(track));
    if (existing) { idByName.set(s.name, existing.id); skipped += 1; continue; }
    const id = newId("s", rand);
    next.sounds.push({ id, name: s.name, track, vol: s.vol ?? 1, page: s.page });
    idByName.set(s.name, id);
    added.sounds += 1;
  }

  for (const l of pack.lists || []) {
    const tracks = packTracks(l);
    // A playlist of the same name is the GM's: nothing in it is removed or moved.
    // Songs the pack has gained since (a new Free Song Sunday) are added at its end.
    const mine = next.lists.find((x) => x.name === l.name);
    if (mine) {
      const have = new Set(mine.tracks.map((t) => trackKey(t)));
      const missing = tracks.filter((t) => !have.has(trackKey(t)));
      if (!missing.length) { skipped += 1; continue; }
      mine.tracks = [...mine.tracks, ...missing];
      added.tracks = (added.tracks || 0) + missing.length;
      continue;
    }
    next.lists.push({ id: newId("l", rand), name: l.name, tracks });
    added.lists += 1;
  }

  for (const sc of pack.scenes || []) {
    if (next.scenes.some((x) => x.name === sc.name)) { skipped += 1; continue; }
    const amb = sc.amb.map(([name, vol, how]) => {
      const s = allSounds().find((x) => x.name === name);
      if (!s) throw new Error(`pack scene "${sc.name}" names a sound no pack has: ${name}`);
      const scatter = how && how.mode === "scatter" ? { mode: "scatter", min: how.min, max: how.max } : { mode: "loop" };
      return { track: trackFor(s, base), vol, label: s.name, ...scatter };
    });
    const list = sc.music.mode === "list" ? next.lists.find((x) => x.name === sc.music.list) : null;
    const music = list ? { mode: "list", list: list.id, vol: sc.music.vol ?? 1 } : { mode: sc.music.mode === "stop" ? "stop" : "keep", list: "", vol: 1 };
    next.scenes.push({ id: newId("sc", rand), name: sc.name, music, amb });
    added.scenes += 1;
  }

  for (const [cue, name] of Object.entries(pack.reactions || {})) {
    const id = idByName.get(name);
    const current = next.reactions[cue] || { sound: "", scene: "", restore: false };
    if (!id || (current.sound && findSound(next, current.sound))) continue;
    next.reactions[cue] = { ...current, sound: id };
    added.reactions += 1;
  }

  return { lib: readLibrary(next), added, skipped };
}

// Whether everything a pack adds is already in the library, so the button can say so.
export function packInstalled(lib, packId, base = PACK_BASE) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) return false;
  const keys = new Set(lib.sounds.map((s) => trackKey(s.track)));
  const soundsIn = (pack.sounds || []).every((s) => keys.has(trackKey(trackFor(s, base))));
  // A playlist counts as in only when it has every song the pack now has, so a new
  // song brings the Add button back.
  const listsIn = (pack.lists || []).every((l) => {
    const mine = lib.lists.find((x) => x.name === l.name);
    if (!mine) return false;
    const have = new Set(mine.tracks.map((t) => trackKey(t)));
    return packTracks(l).every((t) => have.has(trackKey(t)));
  });
  const scenesIn = (pack.scenes || []).every((sc) => lib.scenes.some((x) => x.name === sc.name));
  return soundsIn && listsIn && scenesIn;
}

export function packCounts(packId) {
  const pack = PACKS.find((p) => p.id === packId);
  return {
    sounds: (pack.sounds || []).length,
    lists: (pack.lists || []).length,
    scenes: (pack.scenes || []).length,
    reactions: Object.keys(pack.reactions || {}).length,
  };
}
