// =============================================================
// reactions.js — what just happened at a Dreams & Machines table.
// -------------------------------------------------------------
// Pure. The radio never talks to the D&M extension and needs nothing from it: it
// reads the room record D&M already keeps, compares one reading with the next, and
// names what changed. With no D&M in the room there is no record, nothing ever
// changes, and every reaction simply never fires.
//
// WHY THE RECORD AND NOT D&M's BROADCASTS: any player can send a broadcast. The
// record (com.thuknights.dnm-rolls/state) is written by one client only — the GM's
// D&M background page — after it has checked who sent each event. Reading it means
// a forged event from a player cannot fire a sound on everyone's speakers.
//
// Fields read, and nothing else: threat, momentum, initiative.round, the six epoch
// counters, and the roll log's id / kind / pass / comp / detail[].kind / conceal.
// If dnm-obr reshapes any of those, reactions go quiet — without an error.
// =============================================================

export const CUES = [
  ["combatStart", "Initiative starts"],
  ["combatEnd", "Initiative ends"],
  ["round", "New round"],
  ["rollSuccess", "A roll succeeds"],
  ["rollFail", "A roll fails"],
  ["rollCrit", "A die rolls a critical"],
  ["rollComplication", "A complication is rolled"],
  ["threatUp", "Threat goes up"],
  ["threatDown", "Threat is spent"],
  ["momentumUp", "Momentum gained"],
  ["momentumDown", "Momentum spent"],
  ["breather", "Breather"],
  ["break", "Break"],
  ["bed", "Bed"],
  ["scene", "End Scene"],
  ["session", "New Session"],
  ["adventure", "New Adventure"],
];
export const CUE_NAMES = CUES.map(([k]) => k);
export const CUE_LABELS = Object.fromEntries(CUES);

// When several things land in one write — End Scene also ends initiative; a roll
// also gains Momentum — only the most significant is acted on. Two stingers over
// each other is noise.
export const CUE_PRIORITY = [
  "adventure", "session", "scene", "bed", "break", "breather",
  "combatStart", "combatEnd", "round",
  "rollComplication", "rollCrit", "rollSuccess", "rollFail",
  "threatUp", "threatDown", "momentumUp", "momentumDown",
];

const EPOCHS = ["breather", "break", "bed", "scene", "session", "adventure"];
const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

function readRecord(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const init = s.initiative && typeof s.initiative === "object" ? s.initiative : null;
  const epochs = s.epochs && typeof s.epochs === "object" ? s.epochs : {};
  const log = Array.isArray(s.log) ? s.log.slice(0, 60) : [];
  return {
    threat: n(s.threat),
    momentum: n(s.momentum),
    init: !!init,
    round: init ? n(init.round) : 0,
    epochs: Object.fromEntries(EPOCHS.map((k) => [k, n(epochs[k])])),
    log: log.filter((e) => e && typeof e === "object" && typeof e.id === "string"),
  };
}

// What a single new roll says. A CONCEALED roll says nothing: a complication sting
// on everyone's speakers would announce the result of a roll its roller hid. Secret
// rolls never reach the record at all; hidden ones do, flagged, and stop here.
export function rollCues(entry) {
  if (!entry || entry.kind === "action" || entry.conceal || entry.hidden) return [];
  const cues = [];
  const dice = Array.isArray(entry.detail) ? entry.detail : [];
  if (n(entry.comp) > 0 || dice.some((d) => d && d.kind === "complication")) cues.push("rollComplication");
  if (dice.some((d) => d && d.kind === "crit")) cues.push("rollCrit");
  // Only a roll against a difficulty passes or fails; a bare roll of the dice is neither.
  if (entry.pass === true) cues.push("rollSuccess");
  else if (entry.pass === false && n(entry.diff) > 0) cues.push("rollFail");
  return cues;
}

// Two readings of the D&M record in, the names of what changed out. The first
// reading is a baseline, never news — otherwise opening the radio mid-session would
// replay the whole evening.
export function diffDnm(prev, next) {
  if (prev === undefined) return [];
  const a = readRecord(prev);
  const b = readRecord(next);
  const cues = [];
  if (!a.init && b.init) cues.push("combatStart");
  if (a.init && !b.init) cues.push("combatEnd");
  if (a.init && b.init && b.round > a.round) cues.push("round");
  if (b.threat > a.threat) cues.push("threatUp");
  if (b.threat < a.threat) cues.push("threatDown");
  if (b.momentum > a.momentum) cues.push("momentumUp");
  if (b.momentum < a.momentum) cues.push("momentumDown");
  for (const k of EPOCHS) if (b.epochs[k] > a.epochs[k]) cues.push(k);
  // New rolls: ids in the new log that the old one did not have. At most three,
  // newest first — a GM rejoining a busy room must not get a burst of stingers.
  const seen = new Set(a.log.map((e) => e.id));
  const fresh = b.log.filter((e) => !seen.has(e.id)).slice(0, 3);
  for (const e of fresh) for (const c of rollCues(e)) if (!cues.includes(c)) cues.push(c);
  return cues;
}

export function sortCues(cues) {
  return CUE_PRIORITY.filter((c) => cues.includes(c));
}

// What the library says to do about a set of cues:
//   sound    the one pad to fire, from the most significant cue that has one
//   scene    the one scene to recall, likewise
//   restore  bring back what was playing before initiative (combatEnd only), unless
//            a more significant cue has already chosen a scene
export function planReaction(cues, lib) {
  const plan = { sound: "", scene: "", restore: false, cue: "" };
  const reactions = (lib && lib.reactions) || {};
  for (const cue of sortCues(cues)) {
    const r = reactions[cue];
    if (!r) continue;
    if (!plan.sound && r.sound) { plan.sound = r.sound; plan.cue = plan.cue || cue; }
    if (!plan.scene && !plan.restore && r.scene) { plan.scene = r.scene; plan.cue = plan.cue || cue; }
    if (!plan.scene && !plan.restore && r.restore) { plan.restore = true; plan.cue = plan.cue || cue; }
  }
  return plan;
}

export function dnmPresent(meta, key) {
  return !!(meta && meta[key] && typeof meta[key] === "object");
}
