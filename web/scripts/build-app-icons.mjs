/**
 * Rasterises the app icon (src/brand/flya-space-icon.svg) into every size a
 * home-screen install needs. Run it by hand when the mark changes:
 *
 *   node scripts/build-app-icons.mjs
 *
 * Outputs:
 *   public/icons/icon-192.png, icon-512.png — manifest icons (purpose "any")
 *   public/icons/maskable-512.png           — the mark inset to Android's 80%
 *                                             safe zone, on the page colour
 *   src/app/apple-icon.png                  — 180×180, opaque; Next turns the
 *                                             file into the apple-touch-icon
 *                                             link, and iOS rounds the corners
 *   src/app/icon.svg                        — the SVG itself as the favicon
 *
 * Static files rather than `icon.tsx` routes because the manifest needs
 * stable URLs. Needs `sharp`, which ships with Next.js; nothing here runs in
 * the app.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src", "brand", "flya-space-icon.svg");
const ICONS_DIR = path.join(ROOT, "public", "icons");
const APP_DIR = path.join(ROOT, "src", "app");

/** tokens.css --surface: the dark page colour, so the maskable bleed matches. */
const SURFACE = "#020617";

async function main() {
  const svg = await readFile(SOURCE);
  await mkdir(ICONS_DIR, { recursive: true });

  const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 });

  await png(192).toFile(path.join(ICONS_DIR, "icon-192.png"));
  await png(512).toFile(path.join(ICONS_DIR, "icon-512.png"));
  await png(180).flatten({ background: SURFACE }).toFile(path.join(APP_DIR, "apple-icon.png"));

  // Maskable: Android may crop a circle out of the full square, so the glyph
  // (the #mark group) shrinks to the central 80% while the background still
  // bleeds to every edge.
  const maskable = svg
    .toString()
    .replace('<g id="mark">', '<g id="mark" transform="translate(256 256) scale(0.8) translate(-256 -256)">');
  await sharp(Buffer.from(maskable), { density: 384 })
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(path.join(ICONS_DIR, "maskable-512.png"));

  await copyFile(SOURCE, path.join(APP_DIR, "icon.svg"));
  console.log("app icons written to public/icons/ and src/app/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
