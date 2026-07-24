// Minimal zero-dependency static file server for local development.
// Avoids relying on `npx serve` (which downloads on first use) since this
// project has no other need for a bundler/dev server.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5500;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const relPath = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = normalize(join(root, relPath));
    // Guard against path traversal. A bare startsWith(root) would also accept
    // a sibling directory like "<root>-evil", so require the resolved path to
    // be root itself or sit strictly inside it (root + separator).
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    const stats = await stat(filePath);
    if (!stats.isFile()) throw new Error("not a file");
    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Serving ${root} at http://localhost:${port}`);
});
