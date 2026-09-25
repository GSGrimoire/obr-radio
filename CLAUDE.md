# obr-radio

Read README.md first: the decisions section records why things are the way they are,
and the live-checks list is what the suites cannot see. ROADMAP.md is the plan.

- Rules are pure modules, tested by `tests/radio.test.mjs` without a browser:
  `sources.js` (links), `library.js` (the GM's collection), `state.js` (the room's
  record), `reactions.js` (D&M), `link.js` (console ↔ bar). `bar.js`, `console.js`
  and `players.js` only supply time, room, sound and DOM.
- The bar is the only writer of the room and the only keeper of the library. The
  console is a remote control for it, inside Owlbear (BroadcastChannel) or popped
  out (postMessage with the window that opened it). Never give the console its
  own copy of the library: the popped-out window has different storage.
- Everything read from room metadata, broadcasts, the library or a backup is
  untrusted: go through `readState` / `readTrack` / `readLibrary`. The console puts
  text in as text — never innerHTML.
- Only `https:` media. Only the GM's connection may tick, fire a sound or a shot.
  Hidden rolls never trigger a reaction.
- This repo READS the Dreams & Machines room record (`com.thuknights.dnm-rolls/state`).
  Its conventions live in GSGrimoire/dnm-cc/.claude/skills/gsgrimoire-dnm-vtt/SKILL.md.
- Versioning follows the same rule as dnm: a number for a feature, `.x` for a minor
  edit, a letter for fixing the last release. Update `RADIO_VERSION` in radio.js,
  `manifest.json` and the Releases list in README together.
- Browser tests are served over http, never file://.
