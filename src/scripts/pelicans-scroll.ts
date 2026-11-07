// Pelicans that live in the page: a scroll-progress rider and cameo appearances.
import { registerProps, track } from './analytics';
import { drawPelican, pelicanPalette, ridingPose, type PelicanPalette, type PelicanPose } from './pelican';

const LINES = [
  'Is this the projects page?',
  'I was promised fish.',
  'Rendered by an AI. Please be kind about the legs.',
  'No hands!',
  'Honk.',
  'Scroll faster. I can keep up.',
  'Wrong airport, sorry.',
  'Has anyone seen a runway?',
  'The pouch is load-bearing.',
  'Pedalling is hard without knees.',
  'I am the benchmark.',
  'Do not look at the chain.',
];

const cameoKinds = ['cross', 'peek', 'wheelie', 'tumble', 'drop'] as const;

type Kind = (typeof cameoKinds)[number];

function isKind(value: string | undefined): value is Kind {
  return cameoKinds.some((k) => k === value);
}

type Actor = {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  bubble: HTMLDivElement;
  kind: Kind;
  t: number;
  x: number;
  y: number;
  dir: 1 | -1;
  rot: number;
  dist: number;
  hop: number;
  hopV: number;
  say: string;
  sayAt: number;
  pose: Partial<PelicanPose>;
  done: boolean;
};

const CW = 150;

const CH = 140;

const SCALE = 0.9;

function storeGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}

function storeSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* ignore */ }
}

export function initScrollPelicans() {
  const layer = document.getElementById('pelican-layer');

  if (!layer) return;
  const riderWrap = layer.querySelector<HTMLDivElement>('[data-rider]')!;
  const riderCanvas = riderWrap.querySelector('canvas')!;
  const riderBubble = riderWrap.querySelector<HTMLDivElement>('.pelican-bubble')!;
  const toggles = document.querySelectorAll<HTMLButtonElement>('[data-pelican-toggle]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stored = storeGet('pelicans');
  let enabled = stored ? stored === 'on' : !reduced;
  let pal: PelicanPalette = pelicanPalette();
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  function setupCanvas(c: HTMLCanvasElement) {
    c.width = CW * dpr;
    c.height = CH * dpr;
    c.style.width = `${CW}px`;
    c.style.height = `${CH}px`;
    const ctx = c.getContext('2d')!;

    return ctx;
  }

  function paint(ctx: CanvasRenderingContext2D, pose: PelicanPose, dir: number) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    ctx.translate(CW / 2 - 8 * dir, CH - 4);
    ctx.scale(SCALE * dir, SCALE);
    drawPelican(ctx, pose, pal);
  }

  function applyEnabled() {
    document.documentElement.dataset.pelicans = enabled ? 'on' : 'off';
    toggles.forEach((b) => {
      b.setAttribute('aria-pressed', String(enabled));
      b.textContent = enabled ? 'Fewer pelicans' : 'Bring back the pelicans';
    });

    if (!enabled) {
      actors.forEach((a) => a.el.remove());
      actors = [];
    }

    kick();
  }

  // ---- the scroll rider ----
  const riderCtx = setupCanvas(riderCanvas);
  let riderX = 0;
  let riderTarget = 0;
  let riderDist = 0;
  let riderDir: 1 | -1 = 1;
  let riderHop = 0;
  let riderHopV = 0;
  let riderSayT = -1;
  let lastScrollY = scrollY;
  let lastScrollT = performance.now();
  let scrollVel = 0;
  let riderHidden = false;
  let idleFor = 0;

  function progress() {
    const max = document.documentElement.scrollHeight - innerHeight;

    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  }

  function onScroll() {
    const now = performance.now();
    const dy = scrollY - lastScrollY;
    const dt = Math.max(16, now - lastScrollT) / 1000;
    scrollVel = dy / dt;
    lastScrollY = scrollY;
    lastScrollT = now;
    riderTarget = progress() * Math.max(0, innerWidth - CW);

    if (enabled && Math.abs(scrollVel) > 4500 && !actors.some((a) => a.kind === 'drop')) {
      spawn('drop', 'Whoa. Slow down.');
    }

    kick();
  }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { riderTarget = progress() * Math.max(0, innerWidth - CW); kick(); });

  riderCanvas.addEventListener('click', () => {
    riderHopV = 380;
    riderBubble.textContent = 'Honk!';
    riderSayT = 0;
    kick();
  });

  const footerGame = document.querySelector('[data-run-stage]');

  if (footerGame) {
    new IntersectionObserver(([en]) => {
      riderHidden = en.intersectionRatio > 0.3;
      riderWrap.classList.toggle('is-parked', riderHidden);
    }, { threshold: [0, 0.3, 0.6] }).observe(footerGame);
  }

  // ---- cameos ----
  let actors: Actor[] = [];
  let lastSpawn = 0;

  function spawn(kind: Kind, say?: string) {
    if (!enabled || reduced) return;
    const now = performance.now();

    if (actors.length >= 2 || now - lastSpawn < 2500) return;
    lastSpawn = now;
    const el = document.createElement('div');
    el.className = 'pelican-actor';
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const bubble = document.createElement('div');
    bubble.className = 'pelican-bubble';
    el.append(bubble, canvas);
    layer!.append(el);
    const ctx = setupCanvas(canvas);
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;

    const a: Actor = {
      el, canvas, ctx, bubble, kind, t: 0, dir,
      x: dir === 1 ? -CW : innerWidth,
      y: innerHeight * (0.22 + Math.random() * 0.45),
      rot: 0, dist: 0, hop: 0, hopV: 0,
      say: say ?? (kind === 'wheelie' ? 'No hands!' : kind === 'tumble' ? 'I meant to do that.' : LINES[Math.floor(Math.random() * LINES.length)]),
      sayAt: 0.5 + Math.random() * 0.6,
      pose: {},
      done: false,
    };

    if (kind === 'peek') {
      a.dir = -1;
      a.x = innerWidth;
      a.y = innerHeight * (0.3 + Math.random() * 0.4);
      a.sayAt = 0.55;
    }

    if (kind === 'drop') {
      a.x = innerWidth * (0.2 + Math.random() * 0.5);
      a.y = -CH;
      a.sayAt = 0.7;
    }

    canvas.addEventListener('click', () => {
      a.hopV = 420;
      a.bubble.textContent = 'Honk!';
      a.el.classList.add('is-talking');
      a.sayAt = -99;
      setTimeout(() => a.el.classList.remove('is-talking'), 900);
    });
    actors.push(a);
    kick();
  }

  function talk(a: Actor, on: boolean) {
    if (on && !a.el.classList.contains('is-talking')) {
      a.bubble.textContent = a.say;
      a.el.classList.add('is-talking');
    } else if (!on) a.el.classList.remove('is-talking');
  }

  function updateActor(a: Actor, dt: number) {
    a.t += dt;
    a.hopV -= 1500 * dt;
    a.hop = Math.max(0, a.hop + a.hopV * dt);

    if (a.hop === 0) a.hopV = 0;
    let speed = 0;
    const pose: Partial<PelicanPose> = {};

    switch (a.kind) {
      case 'cross':
      case 'wheelie': {
        speed = a.kind === 'wheelie' ? 230 : 300;
        a.x += speed * a.dir * dt;

        if (a.kind === 'wheelie') {
          a.rot = -0.3 * a.dir + Math.sin(a.t * 5) * 0.05;
          pose.noHands = true;
          pose.flap = 0.5 + Math.sin(a.t * 18) * 0.5;
        }

        const mid = a.x > innerWidth * 0.3 && a.x < innerWidth * 0.6;
        talk(a, mid || a.el.classList.contains('is-talking') && a.x > innerWidth * 0.15 && a.x < innerWidth * 0.75);

        if ((a.dir === 1 && a.x > innerWidth + 20) || (a.dir === -1 && a.x < -CW - 20)) a.done = true;
        break;
      }

      case 'peek': {
        // slide in from the right edge, lean, talk, retreat
        const inT = Math.min(1, a.t / 0.6);
        const outT = Math.max(0, (a.t - 2.8) / 0.6);
        const ease = (v: number) => 1 - Math.pow(1 - v, 3);
        a.x = innerWidth - CW * 0.62 * ease(inT) + CW * 0.62 * ease(Math.min(1, outT));
        a.rot = -0.42;
        speed = a.t < 0.6 || outT > 0 ? 120 : 0;
        pose.eye = 'wide';
        talk(a, a.t > a.sayAt && a.t < 2.8);

        if (outT >= 1) a.done = true;
        break;
      }

      case 'tumble': {
        speed = a.t < 1.4 ? 280 : a.t > 2.6 ? 280 : 0;
        a.x += speed * a.dir * dt;

        if (a.t > 1.4 && a.t < 2.6) {
          const k = Math.min(1, (a.t - 1.4) / 0.25);
          const back = a.t > 2.3 ? 1 - (a.t - 2.3) / 0.3 : 1;
          a.rot = -1.4 * a.dir * k * back;
          pose.eye = 'x';
          pose.noHands = true;
          pose.flap = 1;
        } else a.rot = 0;
        talk(a, a.t > 1.6 && a.t < 2.5);

        if ((a.dir === 1 && a.x > innerWidth + 20) || (a.dir === -1 && a.x < -CW - 20)) a.done = true;
        break;
      }

      case 'drop': {
        const floor = innerHeight * 0.62;

        if (a.t < 0.7) {
          a.y = -CH + (floor + CH) * Math.pow(a.t / 0.7, 2);
          pose.noHands = true;
          pose.flap = 0.5 + Math.sin(a.t * 30) * 0.5;
          pose.eye = 'wide';
        } else {
          a.y = floor;

          if (a.t > 0.7 && a.t < 0.72 && a.hop === 0) a.hopV = 260;
          speed = a.t > 2.2 ? 320 : 0;
          a.x += speed * a.dir * dt;
        }

        talk(a, a.t > 0.75 && a.t < 2.2);

        if (a.x > innerWidth + 20 || a.x < -CW - 20) a.done = true;
        break;
      }
    }

    a.dist += speed * dt;
    const p = { ...ridingPose(a.dist, a.t, speed), ...pose };
    paint(a.ctx, p, a.dir);
    a.el.style.transform = `translate(${a.x}px, ${a.y - a.hop}px) rotate(${a.rot}rad)`;
  }

  // section cameos
  const seen = new WeakSet<Element>();
  const kinds: Kind[] = ['cross', 'peek', 'wheelie', 'tumble', 'cross', 'peek'];

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting || seen.has(en.target)) continue;
      seen.add(en.target);

      if (Math.random() > 0.75) continue;
      const el = en.target;

      if (!(el instanceof HTMLElement)) continue;
      const asked = el.dataset.pelican;
      const kind = isKind(asked) ? asked : kinds[Math.floor(Math.random() * kinds.length)];
      spawn(kind, el.dataset.pelicanSays || undefined);
    }
  }, { threshold: 0.35 });

  document.querySelectorAll('[data-pelican]').forEach((el) => io.observe(el));

  // ---- loop ----
  let raf = 0;
  let last = 0;

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;

    // rider eases towards the scroll position; pedals as much as it moves
    const prev = riderX;
    riderX += (riderTarget - riderX) * Math.min(1, dt * 6);
    const moved = riderX - prev;

    if (Math.abs(moved) > 0.3) riderDir = moved > 0 ? 1 : -1;
    riderDist += Math.abs(moved);
    riderHopV -= 1500 * dt;
    riderHop = Math.max(0, riderHop + riderHopV * dt);

    if (riderHop === 0) riderHopV = 0;

    if (riderSayT >= 0) {
      riderSayT += dt;
      riderWrap.classList.toggle('is-talking', riderSayT < 1);

      if (riderSayT > 1) riderSayT = -1;
    }

    const riderSpeed = Math.abs(moved) / Math.max(dt, 0.001);
    const pose = ridingPose(riderDist, now / 1000, riderSpeed);

    if (riderHop > 0) { pose.noHands = true; pose.flap = 0.8; pose.eye = 'wide'; }

    if (riderSpeed > 900) pose.eye = 'wide';
    paint(riderCtx, pose, riderDir);
    riderWrap.style.transform = `translate(${riderX}px, ${-riderHop}px)`;

    actors.forEach((a) => updateActor(a, dt));
    actors = actors.filter((a) => {
      if (a.done) a.el.remove();

      return !a.done;
    });

    const busy = actors.length > 0 || Math.abs(riderTarget - riderX) > 0.5 || riderHop > 0 || riderSayT >= 0;
    idleFor = busy ? 0 : idleFor + dt;
    raf = enabled && !document.hidden && idleFor < 0.4 ? requestAnimationFrame(frame) : 0;
  }

  function kick() {
    if (!raf && enabled) {
      idleFor = 0;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  // occasional wanderers while someone is reading
  setInterval(() => {
    if (!enabled || document.hidden) return;

    if (performance.now() - lastScrollT > 8000) return; // only while the reader is active

    if (Math.random() < 0.35) spawn(kinds[Math.floor(Math.random() * kinds.length)]);
  }, 9000);

  toggles.forEach((b) => b.addEventListener('click', () => {
    enabled = !enabled;
    track('pelican_display_toggled', { is_enabled: enabled });
    registerProps({ pelicans: enabled ? 'on' : 'off' });
    storeSet('pelicans', enabled ? 'on' : 'off');
    applyEnabled();
  }));

  const repaint = () => { pal = pelicanPalette(); kick(); };

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', repaint);
  addEventListener('themechange', repaint);

  riderTarget = progress() * Math.max(0, innerWidth - CW);
  riderX = riderTarget;
  applyEnabled();
  // first paint even if nothing moves
  paint(riderCtx, ridingPose(0, 0, 0), 1);
  riderWrap.style.transform = `translate(${riderX}px, 0px)`;

  // a welcome cameo shortly after landing
  setTimeout(() => spawn('cross', 'Welcome. Mind the planes.'), 2200);
}
