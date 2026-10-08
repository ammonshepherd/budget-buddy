import { cp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
export const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "dist");
const publicFiles = ["index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "icons", "controllers", "models", "views"];
export async function build() {
  await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
  for (const file of publicFiles) await cp(path.join(root, file), path.join(out, file), { recursive: true });
  // Do not publish internal documentation as a static app asset.
  await rm(path.join(out, "models/README.md"), { force: true });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (url || key) {
    if (!url || !key) throw new Error("Both SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set.");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) throw new Error("Supabase requires HTTPS.");
    if (key.startsWith("sb_secret_") || (key.includes(".") && JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role !== "anon")) throw new Error("Only a publishable/anon key can be shipped to the browser.");
    await writeFile(path.join(out, "config.js"), `export const config = ${JSON.stringify({ supabaseUrl: url.replace(/\/$/, ""), supabaseKey: key })};\n`);
  }
  const files = [];
  async function walk(dir = "") {
    for (const entry of await readdir(path.join(out, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) await walk(relative); else files.push(relative);
    }
  }
  await walk(); files.sort();
  const hash = createHash("sha256");
  for (const file of files) { hash.update(file); hash.update(await readFile(path.join(out, file))); }
  let sw = await readFile(path.join(root, "sw.js"), "utf8");
  sw = sw.replace(/const CACHE_NAME = .*;/, `const CACHE_NAME = CACHE_PREFIX + "0.1.0-${hash.digest("hex").slice(0, 12)}";`)
    .replace(/const APP_SHELL = \[[\s\S]*?\];/, `const APP_SHELL = ${JSON.stringify(["./", ...files.map((f) => `./${f}`)], null, 2)};`);
  await writeFile(path.join(out, "sw.js"), sw);
  return out;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { await build(); console.log("Built static PWA in dist/"); }
