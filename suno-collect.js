// =============================================================
// suno-collect.js — the "Copy for Radio" bookmark.
// -------------------------------------------------------------
// Suno will not let the radio read a playlist: suno.com answers only its own
// pages. But a bookmark runs AS a suno.com page, so it can read what is on the
// screen. This one finds every song link on the page (a playlist, a profile,
// your library) and copies them as "Title | https://suno.com/song/<id>" lines,
// ready to paste into a Radio playlist.
//
// It reads the page and the clipboard and nothing else. It sends nothing
// anywhere and changes nothing on Suno.
//
// This function is turned into the bookmark by suno.html (via toString), so it
// must stay self-contained: no imports, nothing from outside its own body.
// =============================================================
export function collectSunoSongs() {
  const ID = /\/song\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const found = new Map(); // id -> best title seen
  for (const a of document.querySelectorAll('a[href*="/song/"]')) {
    const m = ID.exec(a.getAttribute("href") || "");
    if (!m) continue;
    const id = m[1].toLowerCase();
    // A song usually has two links, its cover and its title. Keep the one with
    // words in it, and keep it short: a whole card's text is not a title.
    const text = (a.textContent || "").replace(/\s+/g, " ").replace(/\|/g, "/").trim();
    const best = found.get(id) || "";
    if (!found.has(id) || (text.length > best.length && text.length <= 80)) found.set(id, text.length <= 80 ? text : best);
  }
  const lines = [...found].map(([id, title]) => (title ? title + " | " : "") + "https://suno.com/song/" + id);
  if (!lines.length) {
    alert("No songs found on this page. Open a Suno playlist and scroll until the songs you want are shown, then try again.");
    return lines;
  }
  const text = lines.join("\n");
  const done = () => alert(lines.length + " song" + (lines.length === 1 ? "" : "s") + " copied. Paste them into a Radio playlist.");
  const fallback = () => { prompt("Copy these lines, then paste them into a Radio playlist:", text); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
  return lines;
}
