import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { build } from "./build.mjs";
const dir = await build();
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = path.resolve(dir, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
    if (!target.startsWith(`${dir}${path.sep}`) || !(await stat(target)).isFile()) throw new Error("Not found");
    res.setHeader("Content-Type", `${types[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
    res.setHeader("Cache-Control", "no-store"); res.end(await readFile(target));
  } catch { res.writeHead(404); res.end("Not found"); }
}).listen(Number(process.env.PORT || 4173), "0.0.0.0", () => console.log("Budget Buddy: http://localhost:4173"));
