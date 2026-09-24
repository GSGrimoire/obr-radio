# obr-radio

Read README.md first: the decisions section records why things are the way they are,
and the live-checks list is what the suites cannot see.

- Keep rules in `radio.js` (pure, tested by `tests/radio.test.mjs`); `bar.js` and
  `panel.js` only supply time, room and DOM.
- Everything read from room metadata, broadcasts or the library is untrusted: go
  through `readState` / `readTrack` / `readLibrary`.
- Only `https:` media, only the GM may tick or cue, only the GM writes the room.
- This repo READS the Dreams & Machines room record (`com.thuknights.dnm-rolls/state`).
  Its conventions live in GSGrimoire/dnm-cc/.claude/skills/gsgrimoire-dnm-vtt/SKILL.md.
- Versioning follows the same rule as dnm: a number for a feature, `.x` for a minor
  edit, a letter for fixing the last release. Update `RADIO_VERSION` in radio.js,
  `manifest.json` and the Releases list in README together.
- Serve over http for browser tests, never file://.
