// Pelican Run: a pelican on a bicycle jumping over AI company logos.
import { drawPelican, pelicanPalette, ridingPose, type PelicanPalette } from './pelican';
import { fitCanvas, readColors, type ChartColors } from './terrain';

type ObstacleDef = { name: string; glyph: string; color: string; img?: string };
type Obstacle = { x: number; w: number; h: number; y: number; def: ObstacleDef; flying: boolean };

const BEST_KEY = 'pelican-run-best';
const K = 0.6; // pelican scale

function storeGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function storeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

const OVER_LINES = [
  '429: too many logos.',
  'Context window exceeded.',
  'The pelican has been deprecated.',
  'Benchmark failed successfully.',
  'Hallucinated a gap that was not there.',
];

export function initPelicanRun(root: HTMLElement, defs: ObstacleDef[]) {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-run-canvas]')!;
  const live = root.querySelector<HTMLElement>('[data-run-live]')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let ctx: CanvasRenderingContext2D;
  let W = 0, H = 0;
  let colors: ChartColors;
  let pal: PelicanPalette;
  const images = new Map<string, HTMLImageElement>();
  for (const d of defs) {
    if (!d.img) continue;
    const im = new Image();
    im.src = d.img;
    images.set(d.name, im);
  }

  let state: 'idle' | 'run' | 'over' = 'idle';
  let speed = 0;
  let dist = 0; // px travelled
  let y = 0; // height above ground
  let vy = 0;
  let t = 0;
  let obstacles: Obstacle[] = [];
  let nextGap = 400;
  let best = Number(storeGet(BEST_KEY) || 0);
  let crashT = 0;
  let overLine = OVER_LINES[0];
  let honkT = -1;
  let inView = false;
  let raf = 0;
  let last = 0;

  const ground = () => H - 30;
  const PX = () => Math.max(60, Math.min(110, W * 0.1));

  function resize() {
    const f = fitCanvas(canvas);
    ctx = f.ctx; W = f.w; H = f.h;
    colors = readColors();
    pal = pelicanPalette();
    if (state !== 'run') draw();
  }

  function reset() {
    state = 'run';
    speed = 330;
    dist = 0;
    y = 0;
    vy = 0;
    obstacles = [];
    nextGap = W * 0.7;
    crashT = 0;
    live.textContent = 'Riding. Press space or tap to jump.';
  }

  function jump() {
    if (state === 'idle' || (state === 'over' && (crashT > 0.5 || reduced))) { reset(); return; }
    if (state === 'run' && y <= 0.5) {
      vy = 760;
      if (Math.random() < 0.25) honkT = 0;
    }
  }

  function spawn() {
    const score = dist / 10;
    const flyingOk = score > 250 && Math.random() < 0.22;
    if (flyingOk) {
      obstacles.push({
        x: W + 20, w: 92, h: 30, y: 98 + Math.random() * 14,
        def: { name: 'Hallucination', glyph: 'cloud', color: '#7B8AA3' }, flying: true,
      });
    } else {
      const n = score > 150 && Math.random() < 0.3 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const def = defs[Math.floor(Math.random() * defs.length)];
        const s = 44 + Math.floor(Math.random() * 3) * 6;
        obstacles.push({ x: W + 20 + i * (s + 4), w: s, h: s, y: 0, def, flying: false });
      }
    }
    nextGap = speed * (0.75 + Math.random() * 0.9) + 120;
  }

  function hit(o: Obstacle) {
    const px = PX();
    const pl = px - 34 * K, pr = px + 52 * K;
    const pb = y + 2, pt = y + 100 * K;
    const ol = o.x + 5, or = o.x + o.w - 5;
    const ob = o.y + 4, ot = o.y + o.h - 4;
    return pr > ol && pl < or && pt > ob && pb < ot;
  }

  function step(dt: number) {
    t += dt;
    if (honkT >= 0) { honkT += dt; if (honkT > 0.9) honkT = -1; }
    if (state === 'over') { crashT += dt; return; }
    if (state !== 'run') return;
    speed = Math.min(860, speed + dt * 9);
    dist += speed * dt;
    vy -= 2300 * dt;
    y = Math.max(0, y + vy * dt);
    if (y === 0) vy = 0;
    nextGap -= speed * dt;
    if (nextGap <= 0) spawn();
    for (const o of obstacles) o.x -= speed * dt;
    obstacles = obstacles.filter((o) => o.x + o.w > -20);
    for (const o of obstacles) {
      if (hit(o)) {
        state = 'over';
        crashT = 0;
        overLine = OVER_LINES[Math.floor(Math.random() * OVER_LINES.length)];
        const sc = Math.floor(dist / 10);
        if (sc > best) { best = sc; storeSet(BEST_KEY, String(best)); }
        live.textContent = `${overLine} Score ${sc}. Press space or tap to ride again.`;
        break;
      }
    }
  }

  function glyph(o: Obstacle, cx: number, cy: number, r: number) {
    const c = ctx;
    c.save();
    c.translate(cx, cy);
    c.strokeStyle = o.def.color;
    c.fillStyle = o.def.color;
    c.lineWidth = 3;
    c.lineCap = 'round';
    switch (o.def.glyph) {
      case 'knot':
        for (let i = 0; i < 6; i++) {
          c.save();
          c.rotate((i * Math.PI) / 3);
          c.beginPath();
          c.ellipse(0, -r * 0.35, r * 0.28, r * 0.55, 0, 0, Math.PI * 2);
          c.lineWidth = 1.8;
          c.stroke();
          c.restore();
        }
        break;
      case 'asterisk':
        c.lineWidth = 4;
        c.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          c.moveTo(0, 0);
          c.lineTo(Math.cos(a) * r * (i % 2 ? 0.7 : 0.95), Math.sin(a) * r * (i % 2 ? 0.7 : 0.95));
        }
        c.stroke();
        break;
      case 'sparkle':
        c.beginPath();
        c.moveTo(0, -r);
        c.quadraticCurveTo(0, 0, r, 0);
        c.quadraticCurveTo(0, 0, 0, r);
        c.quadraticCurveTo(0, 0, -r, 0);
        c.quadraticCurveTo(0, 0, 0, -r);
        c.fill();
        break;
      case 'loop':
        c.beginPath();
        for (let i = 0; i <= 60; i++) {
          const a = (i / 60) * Math.PI * 2;
          const d = 1 + Math.sin(a) ** 2;
          const x = (r * Math.cos(a)) / d;
          const yy = (r * Math.sin(a) * Math.cos(a)) / d * 1.3;
          i ? c.lineTo(x, yy) : c.moveTo(x, yy);
        }
        c.stroke();
        break;
      case 'blocks': {
        const s = r * 0.5;
        for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) c.fillRect(-r + j * s * 1.3, r - (i + 1) * s * 1.3 + s * 0.3, s, s);
        break;
      }
      case 'cross':
        c.lineWidth = 4.5;
        c.beginPath();
        c.moveTo(-r * 0.7, -r * 0.7); c.lineTo(r * 0.7, r * 0.7);
        c.moveTo(r * 0.7, -r * 0.7); c.lineTo(-r * 0.7, r * 0.7);
        c.stroke();
        break;
      case 'wave':
        c.beginPath();
        c.arc(-r * 0.15, 0, r * 0.65, Math.PI * 0.15, Math.PI * 1.85);
        c.quadraticCurveTo(r * 0.8, -r * 0.6, r, -r * 0.2);
        c.stroke();
        c.beginPath();
        c.arc(-r * 0.3, -r * 0.15, 2, 0, Math.PI * 2);
        c.fill();
        break;
      case 'grid':
        c.lineWidth = 2.6;
        c.beginPath();
        c.moveTo(-r * 0.3, -r * 0.8); c.lineTo(-r * 0.3, r * 0.8);
        c.moveTo(r * 0.3, -r * 0.8); c.lineTo(r * 0.3, r * 0.8);
        c.moveTo(-r * 0.8, -r * 0.3); c.lineTo(r * 0.8, -r * 0.3);
        c.moveTo(-r * 0.8, r * 0.3); c.lineTo(r * 0.8, r * 0.3);
        c.stroke();
        break;
      default:
        c.beginPath();
        c.arc(0, 0, r * 0.7, 0, Math.PI * 2);
        c.stroke();
    }
    c.restore();
  }

  function drawObstacle(o: Obstacle) {
    const g = ground();
    const top = g - o.y - o.h;
    ctx.save();
    if (o.flying) {
      // a hallucination: a dashed thought cloud that confidently states nonsense
      ctx.fillStyle = colors.paper;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const bob = Math.sin(t * 4 + o.x * 0.01) * 3;
      for (let i = 0; i < 4; i++) ctx.arc(o.x + 14 + i * 21, top + o.h / 2 + bob + (i % 2 ? -5 : 3), 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors.ink;
      ctx.font = '700 10px Archivo, sans-serif';
      ctx.fontStretch = 'condensed';
      ctx.textAlign = 'center';
      ctx.fillText('2 + 2 = 5', o.x + o.w / 2, top + o.h / 2 + bob + 4);
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(o.x, top, o.w, o.h, 6);
    ctx.fill();
    ctx.stroke();
    const im = images.get(o.def.name);
    if (im && im.complete && im.naturalWidth) {
      const pad = 7;
      ctx.drawImage(im, o.x + pad, top + pad, o.w - pad * 2, o.h - pad * 2 - 9);
    } else {
      glyph(o, o.x + o.w / 2, top + (o.h - 10) / 2 + 1, (o.h - 18) / 2);
    }
    ctx.fillStyle = colors.ink;
    ctx.font = '700 9px Archivo, sans-serif';
    ctx.fontStretch = 'condensed';
    ctx.textAlign = 'center';
    ctx.fillText(o.def.name, o.x + o.w / 2, top + o.h - 5, o.w - 6);
    ctx.restore();
  }

  function draw() {
    const g = ground();
    ctx.clearRect(0, 0, W, H);

    // distant ridgelines, a nod to the treks
    ctx.save();
    for (let layer = 0; layer < 2; layer++) {
      const par = layer ? 0.18 : 0.08;
      ctx.strokeStyle = colors.ink;
      ctx.globalAlpha = layer ? 0.18 : 0.1;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const u = (x + dist * par) * (layer ? 0.006 : 0.004);
        const yy = g - 40 - (layer ? 30 : 60) - Math.sin(u) * 22 - Math.sin(u * 2.7 + 1) * 12 - Math.abs(Math.sin(u * 0.6)) * 20;
        x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();

    // ground line with scrolling chart ticks
    ctx.save();
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(W, g);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    const off = dist % 40;
    ctx.beginPath();
    for (let x = -off; x < W; x += 40) {
      ctx.moveTo(x, g + 6);
      ctx.lineTo(x + 8, g + 6);
      ctx.moveTo(x + 22, g + 12);
      ctx.lineTo(x + 25, g + 12);
    }
    ctx.stroke();
    ctx.restore();

    for (const o of obstacles) drawObstacle(o);

    // the rider
    const px = PX();
    ctx.save();
    if (state === 'over') {
      const c = Math.min(1, crashT * 2.2);
      ctx.translate(px + c * 30, g - y - Math.sin(c * Math.PI) * 40 + c * 2);
      ctx.rotate(c * 1.35);
      ctx.scale(K, K);
      drawPelican(ctx, { crank: 0, wheel: 0, pouch: Math.sin(crashT * 20) * (1 - c), eye: 'x', noHands: true, flap: 1 }, pal);
    } else {
      ctx.translate(px, g - y);
      ctx.scale(K, K);
      const pose = ridingPose(state === 'idle' ? t * 40 : dist, t, state === 'idle' ? 40 : speed);
      if (y > 1) { pose.noHands = true; pose.flap = 0.5 + Math.sin(t * 30) * 0.5; pose.eye = 'wide'; }
      drawPelican(ctx, pose, pal);
    }
    ctx.restore();

    if (honkT >= 0) {
      ctx.save();
      ctx.globalAlpha = 1 - honkT / 0.9;
      ctx.fillStyle = colors.magenta;
      ctx.font = '800 15px Archivo, sans-serif';
      ctx.fontStretch = 'condensed';
      ctx.fillText('HONK', px + 48, g - y - 82 - honkT * 20);
      ctx.restore();
    }

    // HUD
    ctx.save();
    ctx.fillStyle = colors.ink;
    ctx.font = '700 13px Archivo, sans-serif';
    ctx.fontStretch = 'condensed';
    ctx.textAlign = 'right';
    const sc = String(Math.floor(dist / 10)).padStart(5, '0');
    ctx.globalAlpha = 0.55;
    ctx.fillText(`Best ${String(best).padStart(5, '0')}`, W - 92, 24);
    ctx.globalAlpha = 1;
    ctx.fillText(sc, W - 20, 24);
    ctx.textAlign = 'center';
    if (state === 'idle') {
      ctx.font = '700 15px Archivo, sans-serif';
      ctx.fillText('Press space or tap to ride', W / 2, 46);
    }
    if (state === 'over') {
      ctx.font = '800 18px Archivo, sans-serif';
      ctx.fillText(overLine, W / 2, 46);
      ctx.font = '600 13px Archivo, sans-serif';
      ctx.globalAlpha = 0.75;
      ctx.fillText('Press space or tap to ride again', W / 2, 66);
    }
    ctx.restore();
  }

  function loop(now: number) {
    const dt = Math.min(0.04, (now - last) / 1000 || 0);
    last = now;
    step(dt);
    draw();
    const idleStill = reduced && state !== 'run';
    raf = inView && !document.hidden && !idleStill ? requestAnimationFrame(loop) : 0;
  }

  function kick() {
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jump();
    kick();
  });
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
    const tgt = e.target as HTMLElement;
    if (tgt.closest('input, textarea, select, button, a, [contenteditable]') && tgt !== canvas) return;
    if (!inView && document.activeElement !== canvas) return;
    e.preventDefault();
    jump();
    kick();
  });

  new IntersectionObserver(([en]) => {
    inView = en.intersectionRatio > 0.35;
    if (inView) kick();
  }, { threshold: [0, 0.35, 0.6] }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && inView) kick(); });
  new ResizeObserver(() => resize()).observe(canvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', resize);
  addEventListener('themechange', resize);

  resize();
}
