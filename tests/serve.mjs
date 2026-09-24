// A static file server for the browser suites.
//
// WHY THIS EXISTS: Chromium refuses to load an ES module over file:// — "Cross
// origin requests are only supported for protocol schemes: … http, https" — and
// that refusal arrives as a CONSOLE error, not a page error. So a suite that loads
// the extension from disk gets a page whose script never ran, with nothing thrown,
// and every assertion of the form "it starts without throwing" passes vacuously.
//
// That is exactly what happened: layout.test.mjs loaded the roller over file:// from
// 1.3 and its "the roller throws nothing" assertions never once exercised roller.js.
// They measured the stylesheet against hand-built DOM, which was their real job, but
// the claim about errors was empty. Serving over http fixes both suites.
import http from "http";
import fs from "fs";
import path from "path";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png",
};

export async function serve(rootDir) {
  const root = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const file = path.join(root, rel === "/" ? "/index.html" : rel);
    // Refuse anything that climbs out of the staged directory. This only ever
    // serves test scaffolding, but a path traversal in a test is still a bug.
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}
