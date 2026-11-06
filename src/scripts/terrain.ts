// Procedural sectional-chart terrain: hypsometric tint, contour lines, water, peaks.

export type ChartColors = {
  paper: string;
  paper2: string;
  tan: string;
  tan2: string;
  ink: string;
  water: string;
  magenta: string;
  blue: string;
};

export function readColors(el: Element = document.documentElement): ChartColors {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    paper: v('--paper'),
    paper2: v('--paper-2'),
    tan: v('--tan'),
    tan2: v('--tan-2'),
    ink: v('--ink'),
    water: v('--water'),
    magenta: v('--magenta'),
    blue: v('--blue'),
  };
}

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function makeNoise(seed: number) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h: number, x: number, y: number) => {
    const a = (h / 256) * Math.PI * 2;
    return Math.cos(a) * x + Math.sin(a) * y;
  };
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

export type TerrainOptions = {
  seed?: number;
  /** points (in css px) where terrain should be flattened into a valley, e.g. an airfield */
  valleys?: { x: number; y: number; r: number }[];
  /** 0..1 how mountainous */
  relief?: number;
  peakNames?: { name: string; elevation: number }[];
  maxPeaks?: number;
  cell?: number;
};

export type Terrain = {
  peaks: { x: number; y: number; h: number; name?: string; elevation?: number }[];
};

/** Draws terrain into ctx (already scaled for DPR) over a w×h css-px area. */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  colors: ChartColors,
  opts: TerrainOptions = {}
): Terrain {
  const seed = opts.seed ?? 7;
  const relief = opts.relief ?? 1;
  const noise = makeNoise(seed);
  const cell = opts.cell ?? Math.max(8, Math.round(Math.min(w, h) / 70));
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const field = new Float32Array(cols * rows);
  const scale = 1 / 260;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cell;
      const y = j * cell;
      let e = 0;
      let amp = 1;
      let f = scale;
      for (let o = 0; o < 5; o++) {
        e += amp * noise(x * f + seed * 3.1, y * f - seed * 1.7);
        amp *= 0.5;
        f *= 2.03;
      }
      // ridged component for mountain feel
      const ridge = 1 - Math.abs(noise(x * scale * 0.7 + 50, y * scale * 0.7 + 20));
      e = e * 0.75 + (ridge * ridge - 0.45) * 0.9 * relief;
      // northern edge is more mountainous (the Himalaya are up there)
      e += (1 - y / h) * 0.35 * relief - 0.1;
      // flatten valleys (e.g. around an airfield) to dry lowland, never water
      for (const v of opts.valleys ?? []) {
        const d = Math.hypot(x - v.x, y - v.y) / v.r;
        if (d < 1.5) {
          const k = Math.min(1, (1.5 - d) / 0.9);
          const s = k * k * (3 - 2 * k);
          e = e * (1 - s) + -0.02 * s;
        }
      }
      field[j * cols + i] = e;
    }
  }

  // hypsometric bands
  const levels = [-0.32, -0.12, 0.05, 0.2, 0.34, 0.48, 0.62, 0.76, 0.9];
  const bandColor = (e: number) => {
    if (e < levels[0]) return colors.water;
    if (e < levels[2]) return colors.paper;
    if (e < levels[4]) return colors.paper2;
    if (e < levels[6]) return colors.tan;
    return colors.tan2;
  };

  ctx.save();
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, w, h);

  // fill bands with marching squares polygons per cell (cheap: draw cell quads by average)
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = field[j * cols + i];
      const b = field[j * cols + i + 1];
      const c = field[(j + 1) * cols + i + 1];
      const d = field[(j + 1) * cols + i];
      const avg = (a + b + c + d) / 4;
      const col = bandColor(avg);
      if (col === colors.paper) continue;
      ctx.fillStyle = col;
      ctx.fillRect(i * cell - 0.5, j * cell - 0.5, cell + 1, cell + 1);
    }
  }

  // contour lines via marching squares
  const lerp = (v0: number, v1: number, t: number) => (t - v0) / (v1 - v0);
  levels.forEach((lv, li) => {
    const index = li % 4 === 2;
    ctx.beginPath();
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = field[j * cols + i];
        const b = field[j * cols + i + 1];
        const c = field[(j + 1) * cols + i + 1];
        const d = field[(j + 1) * cols + i];
        let code = 0;
        if (a > lv) code |= 8;
        if (b > lv) code |= 4;
        if (c > lv) code |= 2;
        if (d > lv) code |= 1;
        if (code === 0 || code === 15) continue;
        const x = i * cell;
        const y = j * cell;
        const top = [x + cell * lerp(a, b, lv), y];
        const right = [x + cell, y + cell * lerp(b, c, lv)];
        const bottom = [x + cell * lerp(d, c, lv), y + cell];
        const left = [x, y + cell * lerp(a, d, lv)];
        const seg = (p: number[], q: number[]) => {
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
        };
        switch (code) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(left, bottom); seg(top, right); break;
        }
      }
    }
    if (li === 0) {
      ctx.strokeStyle = colors.blue;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.2;
    } else {
      ctx.strokeStyle = colors.ink;
      ctx.globalAlpha = index ? 0.32 : 0.16;
      ctx.lineWidth = index ? 1.1 : 0.7;
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // peaks: local maxima above a level
  const candidates: { x: number; y: number; h: number }[] = [];
  const R = 3;
  for (let j = R; j < rows - R; j++) {
    for (let i = R; i < cols - R; i++) {
      const v = field[j * cols + i];
      if (v < levels[5]) continue;
      let isMax = true;
      for (let dj = -R; dj <= R && isMax; dj++)
        for (let di = -R; di <= R; di++)
          if ((di || dj) && field[(j + dj) * cols + i + di] > v) { isMax = false; break; }
      if (isMax) candidates.push({ x: i * cell, y: j * cell, h: v });
    }
  }
  candidates.sort((a, b) => b.h - a.h);
  const peaks: Terrain['peaks'] = [];
  for (const c of candidates) {
    if (peaks.length >= (opts.maxPeaks ?? 6)) break;
    if (c.x < 40 || c.x > w - 120 || c.y < 50 || c.y > h - 30) continue;
    if (peaks.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 180)) continue;
    const named = opts.peakNames?.[peaks.length];
    peaks.push({ ...c, name: named?.name, elevation: named?.elevation });
  }
  ctx.restore();
  return { peaks };
}

export function drawPeaks(ctx: CanvasRenderingContext2D, peaks: Terrain['peaks'], colors: ChartColors) {
  ctx.save();
  for (const p of peaks) {
    ctx.fillStyle = colors.ink;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 5);
    ctx.lineTo(p.x + 4.5, p.y + 3);
    ctx.lineTo(p.x - 4.5, p.y + 3);
    ctx.closePath();
    ctx.fill();
    if (p.name) {
      ctx.font = '600 11px Archivo, sans-serif';
      ctx.fontStretch = 'condensed';
      ctx.globalAlpha = 0.85;
      ctx.fillText(p.name, p.x + 8, p.y + 1);
      ctx.font = '500 10px Archivo, sans-serif';
      ctx.globalAlpha = 0.6;
      ctx.fillText(`${p.elevation?.toLocaleString('en-US')} m`, p.x + 8, p.y + 13);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** Sizes a canvas to its CSS box with DPR; returns css width/height and ctx. */
export function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}
