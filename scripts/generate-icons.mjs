// Regenerates PNG app icons from the SVG sources: `node scripts/generate-icons.mjs`
import sharp from "sharp";

const jobs = [
  ["public/icons/icon.svg", "public/icons/icon-192.png", 192],
  ["public/icons/icon.svg", "public/icons/icon-512.png", 512],
  ["public/icons/maskable.svg", "public/icons/maskable-512.png", 512],
  ["public/icons/maskable.svg", "public/icons/apple-touch-icon.png", 180],
  ["public/icons/icon.svg", "public/icons/badge-96.png", 96],
];

for (const [src, out, size] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(out);
  console.log("wrote", out);
}
