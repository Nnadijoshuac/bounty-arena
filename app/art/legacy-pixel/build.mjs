// Arena plate pipeline.
//
//   npm run art
//
// Reads public-domain painting scans from art/source/ and writes dithered, palette-reduced
// pixel plates to public/art/. When a scan is missing, the plate is painted procedurally in
// code first and then goes through exactly the same steps, so swapping a real scan in is
// just a matter of dropping the file in source/ and running this again.
//
// The steps, after the art direction:
//   1. crop and area-average down to the plate's native pixel size
//   2. stretch the levels, then reduce to a limited palette
//   3. ordered (Bayer) or error-diffusion (Atkinson) dithering
//   4. the page scales the plate up with nearest-neighbour and lights it like a CRT
//
// The agent side of a plate is not recoloured, it is redrawn: a Sobel pass traces the
// painting's edges and lays them down in phosphor cyan on tube black.
//
// Optional per-scan crop override: art/source/<name>.crop.json  { "x": 0.3, "y": 0.2, "w": 0.4, "h": 0.3 }
// (fractions of the source image). Pure JS, no native modules: pngjs and jpeg-js only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "source");
const OUT = path.join(HERE, "..", "public", "art");

// ------------------------------------------------------------------ palettes

const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

const PALETTES = {
  // fresco: plaster, ochre, umber, vermilion, lapis, verdigris and tube black
  fresco: ["#07070a", "#2a1c11", "#5a3d22", "#8c6236", "#c8902e", "#dcb47a", "#efe4cc", "#f8f1df", "#d0452b", "#8e2a1c", "#24408e", "#5f78b8", "#3f8f7a", "#9a8f7c"].map(hex),
  // phosphor ramp, dark to bright, used for agents
  phosphor: ["#07070a", "#0a2226", "#11454a", "#1f8a86", "#5ff2e6", "#d4fff9"].map(hex),
  // leonardo's notebooks: iron-gall ink on parchment
  sepia: ["#2a1c11", "#4a3220", "#7a5a35", "#b0925f", "#dcc89c", "#efe4cc"].map(hex),
  // gilded bronze for the Baptistery panel
  gilt: ["#07070a", "#2a1c11", "#5a3d22", "#8a5e22", "#c8902e", "#e3b85a", "#f6dfa0"].map(hex),
};

// ------------------------------------------------------------------ image basics

/** RGB float image, 0..1 */
function makeImage(w, h, fill = [0, 0, 0]) {
  const data = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 3);
  return { w, h, data };
}

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// small deterministic PRNG so plates are identical on every run
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed) {
  const r = rng(seed);
  const perm = new Float32Array(512);
  for (let i = 0; i < 512; i++) perm[i] = r();
  const at = (x, y) => perm[((x & 255) + ((y * 57) & 255)) & 511];
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
  };
  return (x, y, oct = 4) => {
    let a = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      a += n2(x * f, y * f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return a / norm;
  };
}

// ------------------------------------------------------------------ loading and resizing

function loadSource(name) {
  for (const ext of [".jpg", ".jpeg", ".png"]) {
    const file = path.join(SRC, name + ext);
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    let w, h, rgba;
    if (ext === ".png") {
      const png = PNG.sync.read(buf);
      ({ width: w, height: h } = png);
      rgba = png.data;
    } else {
      const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1500, maxResolutionInMP: 400 });
      ({ width: w, height: h } = img);
      rgba = img.data;
    }
    const data = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      data[i * 3] = rgba[i * 4] / 255;
      data[i * 3 + 1] = rgba[i * 4 + 1] / 255;
      data[i * 3 + 2] = rgba[i * 4 + 2] / 255;
    }
    let crop = null;
    const cropFile = path.join(SRC, name + ".crop.json");
    if (fs.existsSync(cropFile)) crop = JSON.parse(fs.readFileSync(cropFile, "utf8"));
    return { img: { w, h, data }, file: path.basename(file), crop };
  }
  return null;
}

/** Crops a fractional region (expanded to the target aspect) and area-averages it down to w x h. */
function resample(src, w, h, crop = { x: 0, y: 0, w: 1, h: 1 }) {
  let cx = crop.x * src.w, cy = crop.y * src.h, cw = crop.w * src.w, ch = crop.h * src.h;
  // match the target aspect by growing the shorter side around the centre, then clamp to the image
  const aspect = w / h;
  if (cw / ch < aspect) {
    const nw = ch * aspect;
    cx -= (nw - cw) / 2;
    cw = nw;
  } else {
    const nh = cw / aspect;
    cy -= (nh - ch) / 2;
    ch = nh;
  }
  if (cw > src.w) {
    ch *= src.w / cw;
    cw = src.w;
  }
  if (ch > src.h) {
    cw *= src.h / ch;
    ch = src.h;
  }
  cx = clamp(cx, 0, src.w - cw);
  cy = clamp(cy, 0, src.h - ch);

  const out = makeImage(w, h);
  const sx = cw / w, sy = ch / h;
  for (let y = 0; y < h; y++) {
    const y0 = cy + y * sy, y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = cx + x * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        if (wy <= 0 || yy >= src.h) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          if (wx <= 0 || xx >= src.w) continue;
          const k = (yy * src.w + xx) * 3, ww = wx * wy;
          r += src.data[k] * ww;
          g += src.data[k + 1] * ww;
          b += src.data[k + 2] * ww;
          wsum += ww;
        }
      }
      const o = (y * w + x) * 3;
      out.data[o] = r / wsum;
      out.data[o + 1] = g / wsum;
      out.data[o + 2] = b / wsum;
    }
  }
  return out;
}

/** Stretches levels between the 1st and 99th luminance percentile. Old scans are murky. */
function levels(img, lo = 0.01, hi = 0.99, gamma = 1) {
  const n = img.w * img.h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lum(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
  const sorted = Float32Array.from(L).sort();
  const a = sorted[Math.floor(n * lo)], b = sorted[Math.floor(n * hi)];
  const span = Math.max(b - a, 1e-3);
  for (let i = 0; i < n * 3; i++) img.data[i] = Math.pow(clamp((img.data[i] - a) / span), gamma);
  return img;
}

// ------------------------------------------------------------------ dithering

const BAYER8 = (() => {
  const m = [[0, 2], [3, 1]];
  let cur = m;
  while (cur.length < 8) {
    const n = cur.length, next = [];
    for (let y = 0; y < n * 2; y++) {
      next.push([]);
      for (let x = 0; x < n * 2; x++) next[y].push(4 * cur[y % n][x % n] + m[Math.floor(y / n)][Math.floor(x / n)]);
    }
    cur = next;
  }
  return cur.map((row) => row.map((v) => (v + 0.5) / 64));
})();
const bayer = (x, y) => BAYER8[y & 7][x & 7];

// "redmean" weighted distance, close enough to perceptual for small palettes
function nearest(pal, r, g, b) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pal.length; i++) {
    const [pr, pg, pb] = pal[i];
    const rm = (r + pr) / 2;
    const dr = r - pr, dg = g - pg, db = b - pb;
    const d = (2 + rm) * dr * dr + 4 * dg * dg + (3 - rm) * db * db;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Ordered dither into a palette. Returns an RGB image of palette colours. */
function ditherBayer(img, pal, spread = 0.16) {
  const out = makeImage(img.w, img.h);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const k = (y * img.w + x) * 3, t = (bayer(x, y) - 0.5) * spread;
      out.data.set(pal[nearest(pal, img.data[k] + t, img.data[k + 1] + t, img.data[k + 2] + t)], k);
    }
  return out;
}

/** Atkinson error diffusion, the classic engraved look. Loses a quarter of the error on purpose. */
function ditherAtkinson(img, pal) {
  const w = img.w, h = img.h, buf = Float32Array.from(img.data), out = makeImage(w, h);
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 3;
      const c = pal[nearest(pal, buf[k], buf[k + 1], buf[k + 2])];
      out.data.set(c, k);
      for (let ch = 0; ch < 3; ch++) {
        const err = (buf[k + ch] - c[ch]) / 8;
        for (const [dx, dy] of spread) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= w || yy >= h) continue;
          buf[(yy * w + xx) * 3 + ch] += err;
        }
      }
    }
  return out;
}

/** Maps a 0..1 scalar field onto a 1D palette ramp with ordered dither. */
function rampBayer(field, w, h, ramp) {
  const out = makeImage(w, h), n = ramp.length - 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = clamp(field[i]) * n + (bayer(x, y) - 0.5) * 0.95;
      out.data.set(ramp[clamp(Math.round(v), 0, n)], i * 3);
    }
  return out;
}

// ------------------------------------------------------------------ the agent pass: phosphor wire

/** Traces the edges of an image and returns a 0..1 field: bright wire on a faint scan of the form. */
function wireField(img, { fill = 0.2, gain = 1.15, invertFill = false } = {}) {
  const { w, h } = img, n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lum(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]);
  // light blur so the wire follows forms, not grain
  const B = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += L[yy * w + xx];
          c++;
        }
      B[y * w + x] = s / c;
    }
  const E = new Float32Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = (dx, dy) => B[(y + dy) * w + x + dx];
      const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
      const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
      E[y * w + x] = Math.hypot(gx, gy);
    }
  const sorted = Float32Array.from(E).sort();
  const p96 = Math.max(sorted[Math.floor(n * 0.96)], 1e-3);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = Math.pow(clamp((E[i] / p96) * gain), 0.85);
    const f = (invertFill ? 1 - L[i] : L[i]) * fill;
    out[i] = Math.max(e, f);
  }
  return out;
}

/** Blends two finished plates across x with a dithered seam, so the change reads as pixels. */
function splitX(left, right, at, soft) {
  const out = makeImage(left.w, left.h);
  for (let y = 0; y < left.h; y++)
    for (let x = 0; x < left.w; x++) {
      const k = (y * left.w + x) * 3;
      const m = smooth(at - soft, at + soft, x / left.w);
      out.data.set((m > bayer(x, y) ? right : left).data.subarray(k, k + 3), k);
    }
  return out;
}

// ------------------------------------------------------------------ procedural painting kit

/** A canvas with shaded primitives: tapered capsules (limbs, fingers), ellipsoids and ink strokes. */
class Painter {
  constructor(w, h, bg) {
    this.img = makeImage(w, h, bg);
    this.w = w;
    this.h = h;
    this.light = norm3([-0.55, -0.7, 0.55]);
  }
  get(x, y) {
    const k = (y * this.w + x) * 3;
    return [this.img.data[k], this.img.data[k + 1], this.img.data[k + 2]];
  }
  set(x, y, c, a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const k = (y * this.w + x) * 3;
    for (let i = 0; i < 3; i++) this.img.data[k + i] = lerp(this.img.data[k + i], c[i], a);
  }
  field(fn) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = fn(x, y, this.get(x, y));
        if (c) this.set(x, y, c);
      }
  }
  /**
   * Tapered capsule from a to b, lit like a cylinder, with a painted contour.
   * opts: { color, shadow, rim, line: contour width, lineColor, ink: outline only }
   */
  capsule(ax, ay, bx, by, ra, rb, o) {
    const minx = Math.floor(Math.min(ax - ra, bx - rb)) - 2, maxx = Math.ceil(Math.max(ax + ra, bx + rb)) + 2;
    const miny = Math.floor(Math.min(ay - ra, by - rb)) - 2, maxy = Math.ceil(Math.max(ay + ra, by + rb)) + 2;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const t = clamp(((x - ax) * dx + (y - ay) * dy) / len2);
        const cx = ax + dx * t, cy = ay + dy * t, r = lerp(ra, rb, t);
        const ox = x - cx, oy = y - cy, d = Math.hypot(ox, oy);
        if (d > r + 0.5) continue;
        const a = clamp(r + 0.5 - d);
        this.shadePixel(x, y, ox / r, oy / r, d / r, r, a, o);
      }
  }
  ellipse(cx, cy, rx, ry, rot, o) {
    const R = Math.max(rx, ry) + 2, c = Math.cos(rot), s = Math.sin(rot);
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const px = x - cx, py = y - cy;
        const u = (px * c + py * s) / rx, v = (-px * s + py * c) / ry;
        const d = Math.hypot(u, v);
        if (d > 1 + 0.5 / Math.min(rx, ry)) continue;
        const a = clamp((1 - d) * Math.min(rx, ry) + 0.5);
        // back to screen-space normal
        const nx = u * c - v * s, ny = u * s + v * c;
        this.shadePixel(x, y, nx, ny, d, Math.min(rx, ry), a, o);
      }
  }
  shadePixel(x, y, nx, ny, d, r, a, o) {
    if (o.ink) {
      // outline only: a band at the rim
      const band = (o.line ?? 1.5) / r;
      if (d > 1 - band) this.set(x, y, o.lineColor ?? o.color, a * (o.alpha ?? 1));
      else if (o.wash) this.set(x, y, o.wash, (o.washAlpha ?? 0.25) * (0.4 + 0.6 * (nx * 0.5 + ny * 0.5 + 0.5)));
      return;
    }
    const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, d * d)));
    const n = norm3([nx, ny, nz]);
    const diff = Math.max(0, dot(n, this.light));
    const shade = 0.28 + 0.85 * diff;
    let c = shade > 1 ? mix(o.color, o.rim ?? [1, 0.97, 0.9], (shade - 1) * 1.6) : mix(o.shadow ?? scale(o.color, 0.35), o.color, shade);
    // reflected light on the shadow side keeps forms round, as in fresco modelling
    if (o.bounce) c = mix(c, o.bounce, Math.max(0, -dot(n, this.light)) * 0.25);
    const lw = (o.line ?? 0) / r;
    if (lw > 0 && d > 1 - lw) c = mix(c, o.lineColor ?? [0.2, 0.12, 0.07], 0.85);
    this.set(x, y, c, a * (o.alpha ?? 1));
  }
  line(x0, y0, x1, y1, w, color, alpha = 1) {
    const minx = Math.floor(Math.min(x0, x1) - w - 1), maxx = Math.ceil(Math.max(x0, x1) + w + 1);
    const miny = Math.floor(Math.min(y0, y1) - w - 1), maxy = Math.ceil(Math.max(y0, y1) + w + 1);
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const t = clamp(((x - x0) * dx + (y - y0) * dy) / len2);
        const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
        const a = clamp(w / 2 + 0.5 - d);
        if (a > 0) this.set(x, y, color, a * alpha);
      }
  }
  poly(points, w, color, alpha = 1, closed = false) {
    for (let i = 0; i < points.length - 1; i++) this.line(...points[i], ...points[i + 1], w, color, alpha);
    if (closed) this.line(...points[points.length - 1], ...points[0], w, color, alpha);
  }
  circle(cx, cy, r, w, color, alpha = 1, a0 = 0, a1 = Math.PI * 2) {
    const steps = Math.max(24, Math.ceil(Math.abs(a1 - a0) * r * 0.6));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = lerp(a0, a1, i / steps);
      pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
    this.poly(pts, w, color, alpha);
  }
  disc(cx, cy, r, color, alpha = 1) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const a = clamp(r + 0.5 - Math.hypot(x - cx, y - cy));
        if (a > 0) this.set(x, y, color, a * alpha);
      }
  }
  rect(x0, y0, x1, y1, color, alpha = 1) {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) this.set(x, y, color, alpha);
  }
  /** Leonardo's mirror script: illegible, right-to-left, slanted, never real words. */
  script(x0, y0, width, lines, size, color, seed, alpha = 0.85) {
    const r = rng(seed);
    for (let l = 0; l < lines; l++) {
      let x = x0 + width - r() * size * 2;
      const y = y0 + l * size * 2.1;
      const end = x0 + (l === lines - 1 ? width * (0.3 + r() * 0.5) : 0);
      while (x > end) {
        const letters = 2 + Math.floor(r() * 6);
        for (let k = 0; k < letters && x > end; k++) {
          const g = Math.floor(r() * 5), s = size;
          const sl = s * 0.25; // slant leans left, as mirror writing does
          if (g === 0) this.circle(x - s * 0.35, y, s * 0.35, 1, color, alpha);
          else if (g === 1) this.line(x, y + s * 0.5, x - sl, y - s * 0.9, 1, color, alpha);
          else if (g === 2) this.poly([[x, y + s * 0.4], [x - s * 0.3, y - s * 0.4], [x - s * 0.6, y + s * 0.4]], 1, color, alpha);
          else if (g === 3) this.circle(x - s * 0.3, y, s * 0.3, 1, color, alpha, -Math.PI * 0.2, Math.PI * 1.2);
          else this.line(x, y + s * 0.4, x - s * 0.5, y + s * 0.4, 1, color, alpha);
          x -= s * (0.55 + r() * 0.25);
        }
        x -= size * (0.7 + r() * 0.6);
      }
    }
  }
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (v) => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Plaster: mottled cream with hairline cracks, like a fresco wall. */
function plaster(p, seed, base = hex("#ece0c4"), dark = hex("#b9a37e")) {
  const n = valueNoise(seed);
  p.field((x, y) => mix(base, dark, Math.pow(n(x / 60, y / 60, 5), 1.6) * 0.75));
  const r = rng(seed + 7);
  for (let c = 0; c < 9; c++) {
    let x = r() * p.w, y = r() * p.h, a = r() * Math.PI * 2;
    for (let s = 0; s < 60 + r() * 120; s++) {
      const nx = x + Math.cos(a) * 2, ny = y + Math.sin(a) * 2;
      p.line(x, y, nx, ny, 1, hex("#8c7350"), 0.35);
      x = nx;
      y = ny;
      a += (r() - 0.5) * 0.7;
    }
  }
}

function parchment(p, seed) {
  const n = valueNoise(seed);
  const base = hex("#eadcb8"), stain = hex("#c9ad7c");
  p.field((x, y) => {
    const edge = Math.min(x, y, p.w - x, p.h - y) / Math.min(p.w, p.h);
    const v = n(x / 45, y / 45, 5) * 0.8 + (1 - smooth(0, 0.18, edge)) * 0.6;
    return mix(base, stain, clamp(v - 0.25));
  });
}

// ------------------------------------------------------------------ procedural plates

const SKIN = { color: hex("#e2b088"), shadow: hex("#6b4227"), rim: hex("#fff3dc"), bounce: hex("#d0452b"), line: 1.6, lineColor: hex("#4a2a16") };

function fingers(p, list, o) {
  for (const segs of list) {
    for (let i = 0; i < segs.length - 1; i++) {
      const [x0, y0, r0] = segs[i], [x1, y1, r1] = segs[i + 1];
      p.capsule(x0, y0, x1, y1, r0, r1, o);
    }
  }
}

/** The Creation of Adam, re-staged from geometry: Adam's limp hand reaching in from the left, God's hand from the right. */
function paintCreation(W, H) {
  const S = W / 320; // design in 320 x 150 units
  const p = new Painter(W, H, [0, 0, 0]);
  plaster(p, 11);
  // a cooler sky field behind God's side and a warm halo where the fingers almost meet
  p.field((x, y, c) => {
    const u = x / W, v = y / H;
    let out = mix(c, hex("#cfd6d6"), smooth(0.55, 1, u) * 0.35 * (1 - v));
    const g = Math.exp(-(((u - 0.5) / 0.09) ** 2 + ((v - 0.52) / 0.2) ** 2));
    return mix(out, hex("#fbf4e2"), g * 0.6);
  });
  const P = (pts) => pts.map(([x, y, r]) => [x * S, y * S, r * S]);

  // Adam: forearm rising from the lower left, wrist relaxed, index finger drooping
  p.capsule(-30 * S, 132 * S, 104 * S, 92 * S, 19 * S, 10.5 * S, SKIN);
  p.ellipse(113 * S, 89 * S, 14 * S, 10 * S, -0.25, SKIN);
  fingers(p, [
    P([[118, 98, 3.6], [124, 104, 3.2], [124, 110, 2.8]]), // little, curled under
    P([[121, 95, 3.9], [129, 100, 3.5], [131, 106, 3.0]]), // ring
    P([[123, 91, 4.1], [133, 94, 3.7], [138, 100, 3.2]]), // middle
    P([[123, 86, 4.3], [134, 85, 3.8], [145, 89, 3.2]]), // index, the one that reaches
    P([[107, 83, 4.6], [114, 78, 3.9], [121, 79, 3.3]]), // thumb
  ], SKIN);

  // God: sleeve and robe from the upper right, the arm strong and straight
  p.capsule(345 * S, 40 * S, 262 * S, 62 * S, 28 * S, 21 * S, { color: hex("#c78a9c"), shadow: hex("#3c1f2a"), rim: hex("#f5e3e6"), line: 1.8, lineColor: hex("#2a1520") });
  p.capsule(270 * S, 60 * S, 212 * S, 74 * S, 15 * S, 10 * S, SKIN);
  p.ellipse(203 * S, 76 * S, 13 * S, 10 * S, 0.12, SKIN);
  fingers(p, [
    P([[203, 87, 3.5], [197, 92, 3.1], [194, 95, 2.7]]), // little
    P([[199, 84, 3.8], [191, 88, 3.4], [187, 92, 3.0]]), // ring
    P([[197, 80, 4.0], [188, 82, 3.6], [182, 85, 3.2]]), // middle
    P([[196, 74, 4.3], [186, 73, 3.8], [176, 73.5, 3.3]]), // index, pointing at the gap
    P([[205, 69, 4.6], [197, 66, 3.9], [190, 67, 3.3]]), // thumb
  ], SKIN);
  return p.img;
}

/** Vitruvian Man: circle, square, a figure in two poses, proportion marks and mirror script. */
function paintVitruvian(W, H) {
  const S = W / 320;
  const p = new Painter(W, H, [0, 0, 0]);
  parchment(p, 23);
  const ink = hex("#3b2614"), faint = hex("#6e5134");
  const o = (extra = {}) => ({ ink: true, line: 2.2 * S, color: ink, lineColor: ink, wash: hex("#c9a878"), washAlpha: 0.35, ...extra });
  const cx = 160 * S, navel = 170 * S, R = 128 * S;
  const sqTop = 58 * S, sqBot = navel + R, side = sqBot - sqTop;
  p.circle(cx, navel, R, 2.2 * S, ink);
  p.poly([[cx - side / 2, sqTop], [cx + side / 2, sqTop], [cx + side / 2, sqBot], [cx - side / 2, sqBot]], 2.2 * S, ink, 1, true);
  // proportion ticks along the base and side, as in the drawing
  for (let i = 0; i <= 8; i++) {
    const x = cx - side / 2 + (side / 8) * i;
    p.line(x, sqBot - 5 * S, x, sqBot, 1.2 * S, faint);
    p.line(cx + side / 2 - 5 * S, sqTop + (side / 8) * i, cx + side / 2, sqTop + (side / 8) * i, 1.2 * S, faint);
  }
  const head = 82 * S;
  // second pose first, lighter: arms raised to the circle, legs spread
  const ghost = o({ alpha: 0.55, wash: null });
  for (const s of [-1, 1]) {
    p.capsule(cx + s * 20 * S, 112 * S, cx + s * 70 * S, 82 * S, 7 * S, 5.5 * S, ghost);
    p.capsule(cx + s * 70 * S, 82 * S, cx + s * 118 * S, 54 * S, 5.5 * S, 4.5 * S, ghost);
    p.capsule(cx + s * 12 * S, 198 * S, cx + s * 44 * S, 248 * S, 9.5 * S, 7 * S, ghost);
    p.capsule(cx + s * 44 * S, 248 * S, cx + s * 74 * S, 292 * S, 7 * S, 5 * S, ghost);
  }
  // the main figure: arms level with the square, feet together
  for (const s of [-1, 1]) {
    p.capsule(cx + s * 22 * S, 110 * S, cx + s * 70 * S, 110 * S, 7.5 * S, 6 * S, o());
    p.capsule(cx + s * 70 * S, 110 * S, cx + s * 120 * S, 110 * S, 6 * S, 4.5 * S, o());
    p.ellipse(cx + s * 124 * S, 110 * S, 6 * S, 4.5 * S, 0, o());
    p.capsule(cx + s * 11 * S, 200 * S, cx + s * 12 * S, 250 * S, 10 * S, 7.5 * S, o());
    p.capsule(cx + s * 12 * S, 250 * S, cx + s * 9 * S, 292 * S, 7.5 * S, 5 * S, o());
    p.ellipse(cx + s * 14 * S, 295 * S, 8 * S, 3.5 * S, 0, o());
  }
  p.capsule(cx, 106 * S, cx, 196 * S, 24 * S, 20 * S, o()); // torso
  p.capsule(cx, 92 * S, cx, 104 * S, 7 * S, 8 * S, o()); // neck
  p.ellipse(cx, head - 4 * S, 15 * S, 19 * S, 0, o()); // head
  // hair, a few curls
  for (let i = 0; i < 9; i++) p.circle(cx - 14 * S + i * 3.5 * S, head - 20 * S + Math.sin(i) * 2 * S, 3 * S, 1.2 * S, ink, 0.8, Math.PI, Math.PI * 2);
  // navel and the anatomy lines Leonardo ruled across the body
  p.disc(cx, navel, 1.8 * S, ink);
  for (const yy of [148, 196, 248]) p.line(cx - 26 * S, yy * S, cx + 26 * S, yy * S, 0.9 * S, faint, 0.7);
  // the text blocks above and below
  p.script(26 * S, 14 * S, 268 * S, 3, 5 * S, ink, 31, 0.8);
  p.script(26 * S, sqBot + 12 * S, 268 * S, 1, 4 * S, ink, 37, 0.7);
  return p.img;
}

/** The School of Athens: receding vaults, a coffered arch, a tiled floor and two schools on the steps. */
function paintAthens(W, H) {
  const S = W / 320;
  const p = new Painter(W, H, hex("#e6d6b2"));
  plaster(p, 41, hex("#e9dbb9"), hex("#b59c74"));
  const vx = 160 * S, vy = 82 * S;
  const stone = hex("#d8c39a"), stoneDark = hex("#8c6a44"), line = hex("#4a321d");
  // sky through the last arch
  p.field((x, y) => {
    const d = Math.hypot(x - vx, (y - 70 * S) * 1.1);
    if (d < 44 * S && y < 92 * S) return mix(hex("#f3ead4"), hex("#7f97c4"), clamp((92 * S - y) / (60 * S)));
    return null;
  });
  // nested arches receding toward the vanishing point, each a lit band with coffers
  const arches = [
    { r: 150, y: 96, band: 16 },
    { r: 104, y: 92, band: 11 },
    { r: 72, y: 90, band: 8 },
    { r: 48, y: 90, band: 6 },
  ];
  for (const a of arches) {
    const cy = a.y * S, r = a.r * S, band = a.band * S;
    p.field((x, y) => {
      const d = Math.hypot(x - vx, y - cy);
      if (y > cy || d < r - band || d > r) return null;
      const t = (d - (r - band)) / band;
      const ang = Math.atan2(y - cy, x - vx);
      const coffer = Math.abs(Math.sin(ang * (a.r / 6))) > 0.75 && t > 0.2 && t < 0.85;
      const lit = 0.5 + 0.5 * Math.cos(ang + Math.PI * 0.75);
      return coffer ? mix(stoneDark, line, 0.4) : mix(stoneDark, stone, 0.35 + 0.65 * lit);
    });
    p.circle(vx, cy, r, 1.2 * S, line, 0.9, Math.PI, Math.PI * 2);
    p.circle(vx, cy, r - band, 1.2 * S, line, 0.9, Math.PI, Math.PI * 2);
    // piers under each arch
    for (const s of [-1, 1]) {
      const x0 = vx + s * (r - band / 2);
      p.rect(Math.min(x0, x0 + s * band) - band / 2, cy, Math.max(x0, x0 + s * band) - band / 2 + band / 2, (cy + (118 - a.y) * S), mix(stone, stoneDark, 0.25), 0.9);
      p.line(x0 - band / 2, cy, x0 - band / 2, 118 * S, 1 * S, line, 0.7);
      p.line(x0 + band / 2, cy, x0 + band / 2, 118 * S, 1 * S, line, 0.7);
    }
  }
  // side walls with niches and statues: Apollo left, Athena right
  for (const s of [-1, 1]) {
    const nx = vx + s * 128 * S;
    p.rect(nx - 13 * S, 34 * S, nx + 13 * S, 104 * S, hex("#a98b62"), 0.9);
    p.ellipse(nx, 34 * S, 13 * S, 10 * S, 0, { color: hex("#a98b62"), shadow: hex("#5a3d22") });
    p.capsule(nx, 52 * S, nx, 96 * S, 6 * S, 7 * S, { color: hex("#cdbb98"), shadow: hex("#5a4630"), line: 1 * S });
    p.ellipse(nx, 46 * S, 4 * S, 5 * S, 0, { color: hex("#cdbb98"), shadow: hex("#5a4630"), line: 1 * S });
  }
  // the floor: tiles in one-point perspective
  const floorTop = 128 * S;
  p.field((x, y) => {
    if (y < floorTop) return null;
    const depth = (y - vy) / (H - vy);
    const u = (x - vx) / depth / (26 * S), v = 1 / depth * 6;
    const check = (Math.floor(u) + Math.floor(v)) & 1;
    return mix(check ? hex("#b8925e") : hex("#e3d1a8"), hex("#5a3d22"), 0.15 * (1 - depth));
  });
  // the steps
  for (let i = 0; i < 4; i++) {
    const y = (112 + i * 4) * S;
    p.rect(0, y, W, y + 4 * S, i % 2 ? hex("#d9c49c") : hex("#c4a97c"), 1);
    p.line(0, y, W, y, 0.8 * S, line, 0.6);
  }
  // the two schools: robed figures, with Plato and Aristotle at the centre
  const r = rng(53);
  const robes = [hex("#d0452b"), hex("#24408e"), hex("#3f8f7a"), hex("#c8902e"), hex("#efe4cc"), hex("#8e2a1c"), hex("#5f78b8")];
  const figure = (x, foot, h, robe, seated = false) => {
    const o = { color: robe, shadow: scale(robe, 0.3), rim: mix(robe, [1, 1, 0.95], 0.6), line: 1 * S, lineColor: hex("#2a1c11") };
    if (seated) {
      p.capsule(x, foot - h * 0.45, x + 3 * S, foot - h * 0.1, h * 0.17, h * 0.2, o);
      p.capsule(x + 2 * S, foot - h * 0.12, x + h * 0.32, foot - h * 0.08, h * 0.12, h * 0.1, o);
    } else p.capsule(x, foot - h * 0.78, x, foot - h * 0.06, h * 0.13, h * 0.19, o);
    p.ellipse(x, foot - h * (seated ? 0.58 : 0.88), h * 0.075, h * 0.09, 0, { ...SKIN, line: 0.9 * S });
  };
  const backRow = 112 * S, frontRow = 140 * S;
  for (let i = 0; i < 22; i++) {
    const x = (16 + i * 13.5 + r() * 4) * S;
    if (Math.abs(x - vx) < 18 * S) continue;
    figure(x, backRow + r() * 3 * S, (26 + r() * 5) * S, robes[Math.floor(r() * robes.length)]);
  }
  figure(vx - 8 * S, backRow + 1 * S, 34 * S, hex("#d0452b")); // Plato, pointing up
  p.capsule(vx - 10 * S, backRow - 24 * S, vx - 13 * S, backRow - 40 * S, 1.8 * S, 1.3 * S, SKIN);
  figure(vx + 8 * S, backRow + 1 * S, 34 * S, hex("#24408e")); // Aristotle, palm to the earth
  p.capsule(vx + 11 * S, backRow - 22 * S, vx + 20 * S, backRow - 20 * S, 1.8 * S, 1.6 * S, SKIN);
  for (let i = 0; i < 12; i++) {
    const x = (10 + i * 27 + r() * 8) * S;
    figure(x, frontRow + r() * 8 * S, (30 + r() * 6) * S, robes[Math.floor(r() * robes.length)], r() > 0.55);
  }
  return p.img;
}

/** A gear wheel in ink, used across the notebook plates. */
function gear(p, cx, cy, r, teeth, ink, w, alpha = 1) {
  p.circle(cx, cy, r * 0.82, w, ink, alpha);
  p.circle(cx, cy, r * 0.25, w, ink, alpha);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, a2 = a + Math.PI / teeth;
    p.poly(
      [
        [cx + Math.cos(a) * r * 0.82, cy + Math.sin(a) * r * 0.82],
        [cx + Math.cos(a) * r, cy + Math.sin(a) * r],
        [cx + Math.cos(a2) * r, cy + Math.sin(a2) * r],
        [cx + Math.cos(a2) * r * 0.82, cy + Math.sin(a2) * r * 0.82],
      ],
      w,
      ink,
      alpha,
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    p.line(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25, cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8, w, ink, alpha);
  }
}

/** A notebook folio: the ornithopter wing, a screw and pages of mirror script. */
function paintFolio(W, H) {
  const S = W / 480;
  const p = new Painter(W, H, [0, 0, 0]);
  parchment(p, 83);
  const ink = hex("#3b2614"), faint = hex("#7a5a35");
  // the wing: ribs fanning from a spar, with membrane hatching
  const root = [250 * S, 120 * S];
  const tips = [];
  for (let i = 0; i < 9; i++) {
    const a = -2.6 + i * 0.16;
    const len = (190 - Math.abs(i - 4) * 14) * S;
    const tip = [root[0] + Math.cos(a) * len, root[1] + Math.sin(a) * len * 0.6];
    tips.push(tip);
    p.line(...root, ...tip, (i === 0 ? 2.6 : 1.6) * S, ink);
  }
  for (let i = 0; i < tips.length - 1; i++) {
    const [ax, ay] = tips[i], [bx, by] = tips[i + 1];
    p.line(ax, ay, bx, by, 1.4 * S, ink);
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      p.line(lerp(root[0], ax, t), lerp(root[1], ay, t), lerp(root[0], bx, t), lerp(root[1], by, t), 0.9 * S, faint, 0.7);
    }
  }
  // the aerial screw
  const sx = 380 * S, sy = 160 * S;
  for (let i = 0; i < 5; i++) p.circle(sx, sy - i * 14 * S, (54 - i * 8) * S, 1.6 * S, ink, 0.9, Math.PI * 0.05, Math.PI * 0.95);
  p.line(sx, sy + 40 * S, sx, sy - 80 * S, 2.2 * S, ink);
  gear(p, sx, sy + 56 * S, 18 * S, 12, ink, 1.6 * S);
  gear(p, 120 * S, 238 * S, 30 * S, 14, ink, 1.8 * S);
  gear(p, 162 * S, 262 * S, 16 * S, 10, ink, 1.6 * S);
  p.script(24 * S, 24 * S, 150 * S, 6, 5.5 * S, ink, 89);
  p.script(250 * S, 236 * S, 210 * S, 7, 5.5 * S, ink, 97, 0.8);
  return p.img;
}

// ------------------------------------------------------------------ output

function writePng(file, img) {
  const png = new PNG({ width: img.w, height: img.h, colorType: 6 });
  for (let i = 0; i < img.w * img.h; i++) {
    png.data[i * 4] = Math.round(clamp(img.data[i * 3]) * 255);
    png.data[i * 4 + 1] = Math.round(clamp(img.data[i * 3 + 1]) * 255);
    png.data[i * 4 + 2] = Math.round(clamp(img.data[i * 3 + 2]) * 255);
    png.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(file, PNG.sync.write(png, { colorType: 6, deflateLevel: 9 }));
}

/** Nearest-neighbour upscale, step 3 of the pipeline, for share images. */
function upscale(img, k) {
  const out = makeImage(img.w * k, img.h * k);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const s = (Math.floor(y / k) * img.w + Math.floor(x / k)) * 3;
      out.data.set(img.data.subarray(s, s + 3), (y * out.w + x) * 3);
    }
  return out;
}

// ------------------------------------------------------------------ the plates

const SUPERSAMPLE = 3;
const human = (img, spread = 0.18) => ditherBayer(levels(img, 0.01, 0.995), PALETTES.fresco, spread);
const wire = (img, o) => rampBayer(wireField(img, o), img.w, img.h, PALETTES.phosphor);
// paper is most of a drawing, so set the white point well below the top and lift the midtones
const ink = (img) => ditherAtkinson(levels(img, 0.004, 0.72, 1.35), PALETTES.sepia);

/**
 * Each entry is one crop of a source, written as one or more plates.
 *   source: file stem in art/source (null means always procedural)
 *   crop:   fractional region of the scan, tuned for the full-size public-domain scans.
 *           The first entry for a source can be overridden with art/source/<name>.crop.json
 *   pcrop:  region of the procedural stand-in, used only when the scan is missing
 */
const SOURCES = [
  {
    source: "creation-of-adam",
    title: "The Creation of Adam",
    after: "after Michelangelo, c. 1512",
    w: 320,
    h: 150,
    // the two hands in the full ceiling panel: the gap is at about 38% across, 46% down
    crop: { x: 0.22, y: 0.295, w: 0.32, h: 0.33 },
    paint: paintCreation,
    plates: (img) => {
      const h = human(img);
      return { "creation-of-adam": splitX(h, wire(img, { fill: 0.16, gain: 1.25 }), 0.5, 0.022), "creation-of-adam-fresco": h };
    },
    share: "creation-of-adam",
  },
  {
    source: "vitruvian-man",
    title: "Vitruvian Man",
    after: "after Leonardo da Vinci, c. 1490",
    w: 232,
    h: 240,
    crop: { x: 0.06, y: 0.095, w: 0.87, h: 0.64 },
    paint: paintVitruvian,
    plates: (img) => ({
      "vitruvian-human": ink(img),
      "vitruvian-agent": wire(img, { fill: 0.1, gain: 1.1, invertFill: true }),
    }),
  },
  {
    source: "school-of-athens",
    title: "The School of Athens",
    after: "after Raphael, 1509 to 1511",
    w: 320,
    h: 180,
    crop: { x: 0.06, y: 0.15, w: 0.88, h: 0.64 },
    paint: paintAthens,
    // the seam falls between Plato and Aristotle
    plates: (img) => ({ "school-of-athens": splitX(human(img, 0.2), wire(img, { fill: 0.14, gain: 1.05 }), 0.517, 0.012) }),
  },
  {
    source: "school-of-athens",
    title: "Plato and Aristotle",
    after: "after Raphael, 1509 to 1511",
    w: 150,
    h: 200,
    crop: { x: 0.455, y: 0.405, w: 0.115, h: 0.215 },
    paint: paintAthens,
    pcrop: { x: 0.4, y: 0.25, w: 0.2, h: 0.5 },
    plates: (img) => ({ "athens-plato-aristotle": human(img, 0.16) }),
  },
  {
    source: "school-of-athens",
    title: "Euclid teaching",
    after: "after Raphael, 1509 to 1511",
    w: 200,
    h: 170,
    crop: { x: 0.69, y: 0.6, w: 0.18, h: 0.2 },
    paint: paintAthens,
    pcrop: { x: 0.6, y: 0.5, w: 0.35, h: 0.45 },
    plates: (img) => ({ "athens-euclid": human(img, 0.16), "athens-euclid-wire": wire(img, { fill: 0.14, gain: 1.05 }) }),
  },
  {
    source: "leonardo-flying-machine",
    title: "Design for a flying machine",
    after: "after Leonardo da Vinci, c. 1488",
    w: 240,
    h: 209,
    crop: { x: 0, y: 0, w: 1, h: 1 },
    paint: paintFolio,
    plates: (img) => ({
      "workshop-folio": ink(img),
      "workshop-folio-wire": wire(img, { fill: 0.1, gain: 1.1, invertFill: true }),
    }),
  },
];

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SRC, { recursive: true });
  const scans = new Map();
  const manifest = { generated: new Date().toISOString(), plates: {} };
  for (const s of SOURCES) {
    const t0 = Date.now();
    if (s.source && !scans.has(s.source)) scans.set(s.source, loadSource(s.source));
    const scan = s.source ? scans.get(s.source) : null;
    let img;
    if (scan) img = resample(scan.img, s.w, s.h, (s === SOURCES.find((x) => x.source === s.source) && scan.crop) || s.crop);
    else if (s.pcrop) img = resample(s.paint(960, 540), s.w, s.h, s.pcrop);
    else img = resample(s.paint(s.w * SUPERSAMPLE, s.h * SUPERSAMPLE), s.w, s.h);
    const plates = s.plates(img);
    for (const [name, plate] of Object.entries(plates)) {
      writePng(path.join(OUT, `${name}.png`), plate);
      manifest.plates[name] = {
        file: `/art/${name}.png`,
        w: plate.w,
        h: plate.h,
        title: s.title,
        after: s.after,
        from: scan ? `scan: ${scan.file}` : "procedural study",
      };
    }
    if (s.share) writePng(path.join(OUT, `${s.share}@4x.png`), upscale(plates[s.share], 4));
    const how = scan ? `from ${scan.file}` : s.source ? `procedural (drop ${s.source}.jpg in art/source to use the painting)` : "procedural";
    console.log(`  ${Object.keys(plates).join(", ").padEnd(44)} ${how}, ${Date.now() - t0} ms`);
  }
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`plates written to ${path.relative(process.cwd(), OUT) || OUT}`);
}

main();
