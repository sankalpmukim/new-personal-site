// Approach control: drag planes onto the runway. Lives on the landing page chart.
import { drawPeaks, drawTerrain, fitCanvas, readColors, type ChartColors, type Terrain } from './terrain';

type Pt = { x: number; y: number };
type Kind = 'prop' | 'jet' | 'heavy';
type Plane = {
  id: number;
  x: number;
  y: number;
  hdg: number;
  drawHdg: number;
  spd: number;
  kind: Kind;
  path: Pt[];
  cleared: -1 | 0 | 1; // runway end it is cleared to land on
  state: 'fly' | 'land' | 'gone';
  landT: number;
  entered: boolean;
  callsign: string;
  auto: boolean;
  warn: boolean;
};
type Pending = { at: number; x: number; y: number; hdg: number; kind: Kind };
type Popup = { x: number; y: number; text: string; t: number };

const PREFIX = ['AIC', 'IGO', 'VTI', 'AKJ', 'SEJ', 'PLC', 'IAD', 'BDA'];
const STORAGE_KEY = 'atc-best';

function storeGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function storeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}

function angDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function initAtc(root: HTMLElement, peakNames: { name: string; elevation: number }[]) {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-atc-canvas]')!;
  const scoreEl = root.querySelector<HTMLElement>('[data-atc-score]')!;
  const bestEl = root.querySelector<HTMLElement>('[data-atc-best]')!;
  const statusEl = root.querySelector<HTMLElement>('[data-atc-status]')!;
  const overEl = root.querySelector<HTMLElement>('[data-atc-over]')!;
  const finalEl = root.querySelector<HTMLElement>('[data-atc-final]')!;
  const startBtns = root.querySelectorAll<HTMLButtonElement>('[data-atc-start]');
  const stopBtn = root.querySelector<HTMLButtonElement>('[data-atc-stop]')!;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bg = document.createElement('canvas');
  let ctx: CanvasRenderingContext2D;
  let W = 0, H = 0, DPR = 1, S = 1;
  let colors: ChartColors;
  let terrain: Terrain = { peaks: [] };

  // runway geometry
  let rc: Pt = { x: 0, y: 0 };
  let rAng = -0.32;
  let rLen = 220;
  let ends: [Pt, Pt] = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  let landDir: [number, number] = [0, 0];
  let designators: [string, string] = ['10', '28'];

  let mode: 'attract' | 'play' | 'over' = 'attract';
  let planes: Plane[] = [];
  let pending: Pending[] = [];
  let popups: Popup[] = [];
  let nextSpawn = 0;
  let clock = 0;
  let score = 0;
  let best = Number(storeGet(STORAGE_KEY) || 0);
  let idSeq = 0;
  let active: Plane | null = null;
  let crash: { x: number; y: number; t: number } | null = null;
  let visible = true;
  let raf = 0;
  let last = 0;

  bestEl.textContent = String(best);

  function layout() {
    const fit = fitCanvas(canvas);
    ctx = fit.ctx; W = fit.w; H = fit.h; DPR = fit.dpr;
    S = Math.max(0.75, Math.min(1.25, Math.min(W, H) / 760));
    const wide = W > 860;
    rc = wide ? { x: W * 0.68, y: H * 0.47 } : { x: W * 0.5, y: H * 0.3 };
    rLen = Math.max(150, Math.min(300, Math.min(W, H) * 0.34));
    rAng = -0.32;
    const dx = Math.cos(rAng) * rLen / 2;
    const dy = Math.sin(rAng) * rLen / 2;
    ends = [{ x: rc.x - dx, y: rc.y - dy }, { x: rc.x + dx, y: rc.y + dy }];
    landDir = [rAng, rAng + Math.PI];
    const hdgOf = (a: number) => ((a * 180) / Math.PI + 90 + 360) % 360;
    const des = (a: number) => String(Math.round(hdgOf(a) / 10) || 36).padStart(2, '0');
    designators = [des(landDir[0]), des(landDir[1])];
    paintBackground();
  }

  function paintBackground() {
    colors = readColors();
    bg.width = Math.round(W * DPR);
    bg.height = Math.round(H * DPR);
    const b = bg.getContext('2d')!;
    b.setTransform(DPR, 0, 0, DPR, 0, 0);
    terrain = drawTerrain(b, W, H, colors, {
      seed: 11,
      valleys: [{ x: rc.x, y: rc.y, r: rLen * 0.9 }],
      peakNames,
      maxPeaks: W > 860 ? 6 : 3,
    });
    drawPeaks(b, terrain.peaks, colors);

    // airways radiating out of the field
    b.save();
    b.strokeStyle = colors.magenta;
    b.fillStyle = colors.magenta;
    b.globalAlpha = 0.4;
    b.lineWidth = 2;
    const airways = [
      { a: -2.4, label: 'W33' },
      { a: 2.55, label: 'A461' },
      { a: 1.2, label: 'G450' },
    ];
    for (const aw of airways) {
      b.beginPath();
      b.moveTo(rc.x + Math.cos(aw.a) * rLen * 1.05, rc.y + Math.sin(aw.a) * rLen * 1.05);
      b.lineTo(rc.x + Math.cos(aw.a) * 2000, rc.y + Math.sin(aw.a) * 2000);
      b.stroke();
      const lx = rc.x + Math.cos(aw.a) * rLen * 1.5;
      const ly = rc.y + Math.sin(aw.a) * rLen * 1.5;
      b.globalAlpha = 0.85;
      b.font = '700 11px Archivo, sans-serif';
      b.fontStretch = 'condensed';
      const tw = b.measureText(aw.label).width;
      b.fillStyle = colors.paper;
      b.fillRect(lx - tw / 2 - 4, ly - 8, tw + 8, 15);
      b.strokeRect(lx - tw / 2 - 4, ly - 8, tw + 8, 15);
      b.fillStyle = colors.magenta;
      b.fillText(aw.label, lx - tw / 2, ly + 3.5);
      b.globalAlpha = 0.4;
    }
    b.restore();

    // airspace rings
    b.save();
    b.strokeStyle = colors.blue;
    b.globalAlpha = 0.5;
    b.lineWidth = 2.5;
    b.beginPath();
    b.arc(rc.x, rc.y, rLen * 1.25, 0, Math.PI * 2);
    b.stroke();
    b.strokeStyle = colors.magenta;
    b.setLineDash([10, 6]);
    b.lineWidth = 1.6;
    b.beginPath();
    b.arc(rc.x, rc.y, rLen * 2.05, 0, Math.PI * 2);
    b.stroke();
    b.restore();

    // compass rose
    b.save();
    b.translate(rc.x, rc.y);
    b.strokeStyle = colors.blue;
    b.fillStyle = colors.blue;
    b.globalAlpha = 0.55;
    const R = rLen * 0.82;
    b.lineWidth = 1;
    b.beginPath();
    b.arc(0, 0, R, 0, Math.PI * 2);
    b.stroke();
    for (let d = 0; d < 360; d += 5) {
      const a = (d - 90) * Math.PI / 180;
      const len = d % 30 === 0 ? 12 : d % 10 === 0 ? 7 : 4;
      b.beginPath();
      b.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      b.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
      b.stroke();
      if (d % 30 === 0) {
        b.save();
        b.rotate(a + Math.PI / 2);
        b.font = '600 10px Archivo, sans-serif';
        b.textAlign = 'center';
        b.fillText(d === 0 ? 'N' : String(d / 10), 0, -R + 24);
        b.restore();
      }
    }
    b.restore();

    // extended centrelines (approach guidance)
    b.save();
    b.strokeStyle = colors.ink;
    b.globalAlpha = 0.35;
    b.setLineDash([3, 7]);
    b.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const e = ends[i];
      const back = landDir[i] + Math.PI;
      b.beginPath();
      b.moveTo(e.x, e.y);
      b.lineTo(e.x + Math.cos(back) * rLen * 0.9, e.y + Math.sin(back) * rLen * 0.9);
      b.stroke();
      // approach cone
      b.setLineDash([]);
      b.globalAlpha = 0.08;
      b.fillStyle = colors.magenta;
      b.beginPath();
      b.moveTo(e.x, e.y);
      b.lineTo(e.x + Math.cos(back - 0.5) * rLen * 0.6, e.y + Math.sin(back - 0.5) * rLen * 0.6);
      b.lineTo(e.x + Math.cos(back + 0.5) * rLen * 0.6, e.y + Math.sin(back + 0.5) * rLen * 0.6);
      b.closePath();
      b.fill();
      b.globalAlpha = 0.35;
      b.setLineDash([3, 7]);
    }
    b.restore();

    // runway
    b.save();
    b.translate(rc.x, rc.y);
    b.rotate(rAng);
    const rw = 16 * S;
    b.fillStyle = '#3B4250';
    b.fillRect(-rLen / 2, -rw / 2, rLen, rw);
    b.strokeStyle = colors.ink;
    b.lineWidth = 1.5;
    b.strokeRect(-rLen / 2, -rw / 2, rLen, rw);
    b.fillStyle = '#F4F6F2';
    // centreline
    for (let x = -rLen / 2 + 30; x < rLen / 2 - 30; x += 16) b.fillRect(x, -0.8, 9, 1.6);
    // piano keys + designators
    for (const side of [-1, 1]) {
      const x0 = side * (rLen / 2 - 4);
      for (let k = -3; k <= 3; k++) {
        if (k === 0) continue;
        b.fillRect(x0 - (side > 0 ? 7 : 0), k * 2 * S - 0.6, 7, 1.2);
      }
      b.save();
      b.translate(side * (rLen / 2 - 20), 0);
      b.rotate(side > 0 ? -Math.PI / 2 : Math.PI / 2);
      b.font = `700 ${Math.round(9 * S)}px Archivo, sans-serif`;
      b.textAlign = 'center';
      b.textBaseline = 'middle';
      b.fillText(side < 0 ? designators[0] : designators[1], 0, 0);
      b.restore();
    }
    b.restore();

    // airport data block
    b.save();
    b.font = '800 13px Archivo, sans-serif';
    b.fontStretch = 'condensed';
    b.fillStyle = colors.blue;
    const lx = rc.x + rLen * 0.32;
    const ly = rc.y + rLen * 0.42;
    b.fillText('HOME BASE (VIDP)', lx, ly);
    b.font = '600 11px Archivo, sans-serif';
    b.globalAlpha = 0.85;
    b.fillText(`118.10  ELEV 777  RWY ${designators[0]}/${designators[1]}`, lx, ly + 15);
    b.restore();
  }

  function spawnPoint(kind: Kind): Pending {
    const edge = Math.floor(Math.random() * 4);
    const m = 30;
    let x = 0, y = 0;
    if (edge === 0) { x = Math.random() * W; y = -m; }
    if (edge === 1) { x = W + m; y = Math.random() * H; }
    if (edge === 2) { x = Math.random() * W; y = H + m; }
    if (edge === 3) { x = -m; y = Math.random() * H; }
    const tx = W * (0.25 + Math.random() * 0.5);
    const ty = H * (0.25 + Math.random() * 0.5);
    return { at: clock + (mode === 'play' ? 1.6 : 0), x, y, hdg: Math.atan2(ty - y, tx - x), kind };
  }

  function difficulty() {
    return Math.min(2.3, 1 + score * 0.045);
  }

  function makePlane(p: Pending): Plane {
    const base = p.kind === 'prop' ? 30 : p.kind === 'jet' ? 46 : 38;
    const plane: Plane = {
      id: ++idSeq,
      x: p.x,
      y: p.y,
      hdg: p.hdg,
      drawHdg: p.hdg,
      spd: base * S * (mode === 'play' ? difficulty() : 1),
      kind: p.kind,
      path: [],
      cleared: -1,
      state: 'fly',
      landT: 0,
      entered: false,
      callsign: `${PREFIX[Math.floor(Math.random() * PREFIX.length)]}${100 + Math.floor(Math.random() * 899)}`,
      auto: mode === 'attract',
      warn: false,
    };
    if (plane.auto) autoRoute(plane);
    return plane;
  }

  function autoRoute(p: Plane) {
    // pick the end whose approach is closest to the plane
    let bestI: 0 | 1 = 0;
    let bestD = Infinity;
    for (const i of [0, 1] as const) {
      const back = landDir[i] + Math.PI;
      const ax = ends[i].x + Math.cos(back) * rLen * 0.55;
      const ay = ends[i].y + Math.sin(back) * rLen * 0.55;
      const d = Math.hypot(ax - p.x, ay - p.y);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    const e = ends[bestI];
    const back = landDir[bestI] + Math.PI;
    const ax = e.x + Math.cos(back) * rLen * 0.55;
    const ay = e.y + Math.sin(back) * rLen * 0.55;
    const cx = p.x + Math.cos(p.hdg) * bestD * 0.5;
    const cy = p.y + Math.sin(p.hdg) * bestD * 0.5;
    const pts: Pt[] = [];
    for (let t = 0.05; t <= 1; t += 0.05) {
      const u = 1 - t;
      pts.push({ x: u * u * p.x + 2 * u * t * cx + t * t * ax, y: u * u * p.y + 2 * u * t * cy + t * t * ay });
    }
    pts.push({ x: e.x, y: e.y });
    p.path = pts;
    p.cleared = bestI;
  }

  function setMode(m: typeof mode) {
    mode = m;
    root.classList.toggle('is-playing', m === 'play');
    root.classList.toggle('is-over', m === 'over');
    canvas.style.touchAction = m === 'play' ? 'none' : '';
    overEl.hidden = m !== 'over';
    stopBtn.hidden = m === 'attract';
  }

  function start() {
    planes = [];
    pending = [];
    popups = [];
    crash = null;
    score = 0;
    scoreEl.textContent = '0';
    setMode('play');
    statusEl.textContent = 'Drag each plane onto the runway, lined up with the dashed approach.';
    nextSpawn = clock + 0.3;
    if (!raf) loop(performance.now());
  }

  function stop() {
    setMode('attract');
    planes = [];
    pending = [];
    statusEl.textContent = '';
    nextSpawn = clock;
  }

  function gameOver(a: Plane, b: Plane) {
    crash = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 0 };
    active = null;
    if (score > best) {
      best = score;
      storeSet(STORAGE_KEY, String(best));
      bestEl.textContent = String(best);
    }
    finalEl.textContent = `${a.callsign} and ${b.callsign} got too close. You landed ${score} ${score === 1 ? 'plane' : 'planes'}.`;
    setMode('over');
    statusEl.textContent = '';
  }

  function onLanded(p: Plane) {
    if (mode === 'play') {
      score++;
      scoreEl.textContent = String(score);
      popups.push({ x: p.x, y: p.y - 16, text: `${p.callsign} landed`, t: 0 });
    }
  }

  function step(dt: number) {
    clock += dt;

    // spawning
    const maxPlanes = mode === 'play' ? Math.min(12, 3 + Math.floor(score / 3)) : 3;
    const interval = mode === 'play' ? Math.max(1.4, 5.2 - score * 0.2) : 3.2;
    if (mode !== 'over' && clock >= nextSpawn && planes.length + pending.length < maxPlanes) {
      const r = Math.random();
      const kind: Kind = r < 0.4 ? 'prop' : r < 0.8 ? 'jet' : 'heavy';
      pending.push(spawnPoint(kind));
      nextSpawn = clock + interval * (0.75 + Math.random() * 0.5);
    }
    pending = pending.filter((p) => {
      if (clock >= p.at) { planes.push(makePlane(p)); return false; }
      return true;
    });

    if (mode === 'over') {
      if (crash) crash.t += dt;
      return;
    }

    for (const p of planes) {
      if (p.state === 'land') {
        p.landT += dt / 2.4;
        const i = p.cleared === -1 ? 0 : p.cleared;
        const dir = landDir[i];
        const e = ends[i];
        const dist = rLen * 0.75 * (1 - Math.pow(1 - Math.min(1, p.landT), 2));
        p.x = e.x + Math.cos(dir) * dist;
        p.y = e.y + Math.sin(dir) * dist;
        p.hdg = dir;
        p.drawHdg = dir;
        if (p.landT >= 1.25) p.state = 'gone';
        continue;
      }
      let move = p.spd * dt;
      while (p.path.length && move > 0) {
        const t = p.path[0];
        const d = Math.hypot(t.x - p.x, t.y - p.y);
        if (d <= move) {
          p.x = t.x; p.y = t.y; move -= d; p.path.shift();
          if (d > 0.01) p.hdg = Math.atan2(t.y - p.y + 0.0001, t.x - p.x + 0.0001) || p.hdg;
        } else {
          p.hdg = Math.atan2(t.y - p.y, t.x - p.x);
          p.x += (t.x - p.x) / d * move;
          p.y += (t.y - p.y) / d * move;
          move = 0;
        }
      }
      if (move > 0) {
        p.x += Math.cos(p.hdg) * move;
        p.y += Math.sin(p.hdg) * move;
      }
      p.drawHdg += angDiff(p.hdg, p.drawHdg) * Math.min(1, dt * 8);

      if (!p.entered && p.x > 10 && p.x < W - 10 && p.y > 10 && p.y < H - 10) p.entered = true;
      if (p.entered && !p.path.length) {
        // bounce off the chart edges with a gentle turn back in
        const m = 14;
        if (p.x < m || p.x > W - m || p.y < m || p.y > H - m) {
          const toC = Math.atan2(H / 2 - p.y, W / 2 - p.x);
          p.hdg += angDiff(toC, p.hdg) * Math.min(1, dt * 3);
        }
      }

      // touchdown check
      for (const i of [0, 1] as const) {
        const e = ends[i];
        if (Math.hypot(p.x - e.x, p.y - e.y) < 10 * S) {
          const aligned = Math.abs(angDiff(p.drawHdg, landDir[i])) < 0.9;
          if (aligned && (p.cleared === i || p.path.length === 0)) {
            p.state = 'land';
            p.cleared = i;
            p.path = [];
            p.landT = 0;
            onLanded(p);
            break;
          }
        }
      }
    }
    planes = planes.filter((p) => p.state !== 'gone');

    // separation
    for (const p of planes) p.warn = false;
    if (mode === 'play') {
      for (let i = 0; i < planes.length; i++) {
        for (let j = i + 1; j < planes.length; j++) {
          const a = planes[i], b = planes[j];
          if (a.state !== 'fly' || b.state !== 'fly' || !a.entered || !b.entered) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 15 * S) { gameOver(a, b); return; }
          if (d < 55 * S) { a.warn = true; b.warn = true; }
        }
      }
    }
    popups = popups.filter((pp) => (pp.t += dt) < 1.6);
  }

  function planeShape(c: CanvasRenderingContext2D, kind: Kind) {
    c.beginPath();
    if (kind === 'prop') {
      c.moveTo(10, 0);
      c.lineTo(6, -1.6); c.lineTo(3, -1.6); c.lineTo(3, -12); c.lineTo(-1, -12); c.lineTo(-1, -1.6);
      c.lineTo(-8, -1.2); c.lineTo(-8, -5); c.lineTo(-11, -5); c.lineTo(-11, 5); c.lineTo(-8, 5); c.lineTo(-8, 1.2);
      c.lineTo(-1, 1.6); c.lineTo(-1, 12); c.lineTo(3, 12); c.lineTo(3, 1.6); c.lineTo(6, 1.6);
    } else {
      c.moveTo(13, 0);
      c.quadraticCurveTo(11, -2.2, 6, -2.2);
      c.lineTo(2, -2.2); c.lineTo(-5, -13); c.lineTo(-8, -13); c.lineTo(-4, -2.2);
      c.lineTo(-10, -2); c.lineTo(-13, -6.5); c.lineTo(-15, -6.5); c.lineTo(-13.5, 0);
      c.lineTo(-15, 6.5); c.lineTo(-13, 6.5); c.lineTo(-10, 2); c.lineTo(-4, 2.2);
      c.lineTo(-8, 13); c.lineTo(-5, 13); c.lineTo(2, 2.2); c.lineTo(6, 2.2);
      c.quadraticCurveTo(11, 2.2, 13, 0);
    }
    c.closePath();
  }

  function kindColor(k: Kind) {
    return k === 'prop' ? colors.blue : k === 'jet' ? colors.magenta : getComputedStyle(root).getPropertyValue('--beak').trim();
  }

  function drawPlane(p: Plane) {
    const scale = S * (p.kind === 'heavy' ? 1.35 : 1) * (p.state === 'land' ? 1 - Math.min(0.45, p.landT * 0.45) : 1);
    const alpha = p.state === 'land' ? Math.max(0, 1 - Math.max(0, p.landT - 0.85) * 2.5) : 1;
    const accent = kindColor(p.kind);
    ctx.save();
    ctx.globalAlpha = alpha;
    // shadow
    const sh = p.state === 'land' ? 7 * (1 - Math.min(1, p.landT)) : 7;
    ctx.save();
    ctx.translate(p.x + sh, p.y + sh * 1.2);
    ctx.rotate(p.drawHdg);
    ctx.scale(scale, scale);
    planeShape(ctx, p.kind);
    ctx.fillStyle = colors.ink;
    ctx.globalAlpha = 0.18 * alpha;
    ctx.fill();
    ctx.restore();

    ctx.translate(p.x, p.y);
    ctx.rotate(p.drawHdg);
    ctx.scale(scale, scale);
    planeShape(ctx, p.kind);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1.4 / scale;
    ctx.strokeStyle = colors.ink;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillRect(-14, -1.1, 10, 2.2);
    if (p.kind === 'heavy') {
      ctx.fillStyle = colors.ink;
      for (const [x, y] of [[-1, -6], [-3, -9.5], [-1, 6], [-3, 9.5]]) ctx.fillRect(x, y - 1, 3, 2);
    }
    if (p.kind === 'prop') {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      const a = clock * 40;
      ctx.beginPath();
      ctx.moveTo(11, Math.sin(a) * 5);
      ctx.lineTo(11, -Math.sin(a) * 5);
      ctx.stroke();
    }
    ctx.restore();

    if (p.state === 'fly') {
      if (p.warn) {
        ctx.save();
        ctx.strokeStyle = '#D02A2A';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6 + Math.sin(clock * 14) * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 27 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // data block
      ctx.save();
      ctx.font = '700 10px Archivo, sans-serif';
      ctx.fontStretch = 'condensed';
      ctx.fillStyle = colors.ink;
      ctx.globalAlpha = 0.85;
      ctx.fillText(p.callsign, p.x + 16 * S, p.y - 12 * S);
      ctx.globalAlpha = 0.55;
      ctx.font = '600 9px Archivo, sans-serif';
      ctx.fillText(`${Math.round(p.spd * 3)} kt`, p.x + 16 * S, p.y - 2 * S);
      ctx.restore();
    }
  }

  function drawPath(p: Plane) {
    if (!p.path.length || p.state !== 'fly') return;
    ctx.save();
    ctx.strokeStyle = p.cleared >= 0 ? colors.blue : colors.ink;
    ctx.globalAlpha = p.auto ? 0.25 : 0.75;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    for (const pt of p.path) ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    const end = p.path[p.path.length - 1];
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(end.x, end.y, p.cleared >= 0 ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = p.cleared >= 0 ? colors.blue : colors.ink;
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);

    // incoming warnings at the border
    for (const pd of pending) {
      const x = Math.max(16, Math.min(W - 16, pd.x));
      const y = Math.max(16, Math.min(H - 16, pd.y));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(pd.hdg);
      ctx.globalAlpha = 0.5 + Math.sin(clock * 12) * 0.4;
      ctx.fillStyle = colors.magenta;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // threshold highlight while dragging
    if (active) {
      for (const i of [0, 1] as const) {
        ctx.save();
        ctx.strokeStyle = colors.blue;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + Math.sin(clock * 8) * 0.3;
        ctx.beginPath();
        ctx.arc(ends[i].x, ends[i].y, 22 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const p of planes) drawPath(p);
    for (const p of planes) if (p.state === 'land') drawPlane(p);
    for (const p of planes) if (p.state === 'fly') drawPlane(p);

    for (const pp of popups) {
      ctx.save();
      ctx.globalAlpha = 1 - pp.t / 1.6;
      ctx.font = '800 13px Archivo, sans-serif';
      ctx.fontStretch = 'condensed';
      ctx.fillStyle = colors.blue;
      ctx.fillText(pp.text, pp.x, pp.y - pp.t * 22);
      ctx.restore();
    }

    if (crash) {
      ctx.save();
      const r = 10 + crash.t * 90;
      ctx.strokeStyle = '#D02A2A';
      ctx.lineWidth = 3;
      ctx.globalAlpha = Math.max(0, 1 - crash.t / 1.2);
      ctx.beginPath();
      ctx.arc(crash.x, crash.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function loop(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (visible && !document.hidden) {
      step(dt);
      render();
    }
    raf = requestAnimationFrame(loop);
  }

  // input
  function local(e: PointerEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function tryClear(p: Plane, pt: Pt): boolean {
    for (const i of [0, 1] as const) {
      const e = ends[i];
      if (Math.hypot(pt.x - e.x, pt.y - e.y) < 24 * S) {
        // direction of the drawn approach over the last ~40px
        let k = p.path.length - 1;
        let from: Pt = { x: p.x, y: p.y };
        let acc = 0;
        while (k > 0) {
          acc += Math.hypot(p.path[k].x - p.path[k - 1].x, p.path[k].y - p.path[k - 1].y);
          if (acc > 40) { from = p.path[k - 1]; break; }
          k--;
        }
        if (k <= 0) from = { x: p.x, y: p.y };
        const dir = Math.atan2(e.y - from.y, e.x - from.x);
        if (Math.abs(angDiff(dir, landDir[i])) < 0.85) {
          p.path.push({ x: e.x, y: e.y });
          p.cleared = i;
          return true;
        }
      }
    }
    return false;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (mode === 'over') return;
    const pt = local(e);
    let hit: Plane | null = null;
    let hd = 30 * S;
    for (const p of planes) {
      if (p.state !== 'fly') continue;
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < hd) { hd = d; hit = p; }
    }
    if (!hit) return;
    if (mode === 'attract') {
      if (e.pointerType !== 'mouse') return; // on touch, use the button so the page can still scroll
      start();
      planes = [hit];
      hit.auto = false;
    }
    e.preventDefault();
    active = hit;
    hit.path = [];
    hit.cleared = -1;
    hit.auto = false;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const pt = local(e);
    if (!active) {
      const over = mode !== 'over' && planes.some((p) => p.state === 'fly' && Math.hypot(p.x - pt.x, p.y - pt.y) < 30 * S);
      canvas.style.cursor = over ? 'grab' : '';
      return;
    }
    canvas.style.cursor = 'grabbing';
    const p = active;
    if (p.state !== 'fly' || mode !== 'play') { active = null; return; }
    const lastPt = p.path[p.path.length - 1] ?? { x: p.x, y: p.y };
    if (Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) < 7) return;
    p.path.push({ x: Math.max(4, Math.min(W - 4, pt.x)), y: Math.max(4, Math.min(H - 4, pt.y)) });
    if (tryClear(p, pt)) active = null;
  });

  const endDrag = () => {
    active = null;
    canvas.style.cursor = '';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  startBtns.forEach((b) => b.addEventListener('click', start));
  stopBtn.addEventListener('click', stop);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode !== 'attract') stop();
  });

  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0.05 }).observe(root);

  let resizeT = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(() => { layout(); if (!raf) render(); }, 120);
  });
  ro.observe(canvas);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paintBackground(); if (!raf) render(); });
  addEventListener('themechange', () => { paintBackground(); if (!raf) render(); });

  layout();
  setMode('attract');
  if (reduced) {
    // one still frame: a few planes on approach, no motion until the player starts
    for (let i = 0; i < 3; i++) {
      const p = makePlane(spawnPoint(i === 0 ? 'jet' : i === 1 ? 'prop' : 'heavy'));
      const k = Math.floor(p.path.length * (0.45 + i * 0.12));
      const at = p.path[k] ?? { x: W / 2, y: H / 2 };
      const nx = p.path[k + 1] ?? at;
      p.x = at.x; p.y = at.y; p.hdg = p.drawHdg = Math.atan2(nx.y - at.y, nx.x - at.x);
      p.path = p.path.slice(k);
      planes.push(p);
    }
    render();
  } else {
    // pre-roll so the sky is busy on first paint
    for (let i = 0; i < 2; i++) {
      const pd = spawnPoint(i ? 'prop' : 'jet');
      const p = makePlane(pd);
      planes.push(p);
    }
    for (let i = 0; i < 240; i++) step(1 / 30);
    last = performance.now();
    loop(last);
  }
}
