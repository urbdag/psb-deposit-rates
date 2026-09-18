// Rasterize public/og/*.svg -> real PNG (public/og/*.png) using sharp.
// Run in CI (which has internet to install sharp + a rasteriser). If sharp is
// unavailable it exits 0 and leaves the SVG-as-PNG fallback in place, so the
// build never fails on account of OG images.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ogDir = resolve(here, "..", "public/og");

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.log(
    "sharp not installed — leaving SVG fallbacks. (Run in CI to rasterize.)",
  );
  process.exit(0);
}

const files = (await readdir(ogDir)).filter((f) => f.endsWith(".svg"));
let n = 0;
for (const f of files) {
  const svg = await readFile(resolve(ogDir, f));
  const pngName = f.replace(/\.svg$/, ".png");
  const png = await sharp(svg, { density: 144 })
    .resize(1200, 630, { fit: "cover" })
    .png()
    .toBuffer();
  await writeFile(resolve(ogDir, pngName), png);
  n++;
}
console.log(`Rasterized ${n} OG image(s) to PNG.`);
