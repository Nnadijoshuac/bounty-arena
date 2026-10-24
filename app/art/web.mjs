/**
 * Arena's web plates, made from the public-domain scans in art/source.
 * Full paintings are sized for full-bleed backgrounds. The hero's two hands are keyed off a
 * flat green, so type can sit between the wall and the hands. Leonardo's drawings become
 * pale ink on a transparent sheet.
 *
 *   node art/web.mjs
 */
import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => path.join(here, "source", f);
const out = (f) => path.join(here, "..", "public", "img", f);

/** A soft mask from a per-pixel score: blur, then a smooth ramp between lo and hi. */
function ramp(v, lo, hi) {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Iron-gall ink on paper, lifted onto a transparent sheet and turned to pale ink. */
async function ink(file, name, { width, lo = 40, hi = 120, crop } = {}) {
  let img = sharp(src(file));
  if (crop) img = img.extract(crop);
  img = img.resize({ width }).greyscale();
  // flatten the paper's uneven tone before measuring the ink
  const base = await img.clone().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const paper = await img.clone().blur(24).extractChannel(0).raw().toBuffer();
  const n = base.info.width * base.info.height;
  const px = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const depth = paper[i] - base.data[i]; // how much darker than the paper around it
    const a = ramp(depth, lo, hi);
    px[i * 4] = 236;
    px[i * 4 + 1] = 228;
    px[i * 4 + 2] = 212;
    px[i * 4 + 3] = Math.round(255 * a);
  }
  await sharp(px, { raw: { width: base.info.width, height: base.info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(out(`${name}.png`));
}

async function full(file, name, widths, opts = {}) {
  for (const w of widths) {
    let img = sharp(src(file));
    if (opts.crop) img = img.extract(opts.crop);
    await img.resize({ width: w }).modulate({ saturation: opts.saturation ?? 1 }).webp({ quality: opts.quality ?? 74 }).toFile(out(`${name}-${w}.webp`));
  }
}

/**
 * The hero's two hands, a human one in fresco and an agent's in graphite, generated on a flat
 * chroma green (art/generated). Keyed out by how much greener than red and blue each pixel is,
 * with the green spill pulled out of the edges so nothing glows green against the dark.
 */
async function agentHands(file, name, { top, height, widths }) {
  const img = sharp(path.join(here, "generated", file));
  const meta = await img.metadata();
  const crop = { left: 0, top, width: meta.width, height };
  const { data, info } = await img.clone().extract(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    let r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const spill = g - Math.max(r, b);
    // pure screen green has spill near 140, skin and steel are at or below zero
    const a = 1 - ramp(spill, 18, 70);
    // despill: the edge keeps its own colour, not the screen's
    if (g > Math.max(r, b)) g = Math.max(r, b);
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = Math.round(255 * a);
  }
  // soften the matte by a hair so the cut edge is not jagged
  const alpha = Buffer.alloc(n);
  for (let i = 0; i < n; i++) alpha[i] = rgba[i * 4 + 3];
  const soft = await sharp(alpha, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(0.6).extractChannel(0).raw().toBuffer();
  for (let i = 0; i < n; i++) rgba[i * 4 + 3] = Math.min(rgba[i * 4 + 3], soft[i] + 40 > 255 ? 255 : soft[i] + 40);
  const png = await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  for (const w of widths) await sharp(png).resize({ width: w, kernel: "lanczos3" }).png({ compressionLevel: 9 }).toFile(out(`${name}-${w}.png`));
}

await Promise.all([
  agentHands("hands-v1.jpg", "hands", { top: 170, height: 350, widths: [1200, 2400] }),
  // the cracked plaster sky of the fresco, with no figures in it: the wall behind the hands
  full("creation-of-adam.jpg", "wall", [1600], { crop: { left: 700, top: 10, width: 980, height: 430 }, quality: 70 }),
  full("creation-of-adam.jpg", "adam", [1600, 2800]),
  // God and the angels, for the closing plate
  full("creation-of-adam.jpg", "adam-god", [1400, 2400], { crop: { left: 1700, top: 0, width: 1824, height: 1599 } }),
  full("school-of-athens.jpg", "athens", [1600, 2800]),
  // Plato and Aristotle at the vanishing point
  full("school-of-athens.jpg", "athens-plato", [1200, 2000], { crop: { left: 1500, top: 1050, width: 900, height: 1150 } }),
  ink("vitruvian-man.jpg", "vitruvian-ink", { width: 1600, lo: 18, hi: 70, crop: { left: 120, top: 110, width: 2020, height: 2850 } }),
  ink("leonardo-flying-machine.jpg", "flying-machine-ink", { width: 1400, lo: 22, hi: 80, crop: { left: 0, top: 60, width: 508, height: 340 } }),
]);
console.log("plates written to public/img");
