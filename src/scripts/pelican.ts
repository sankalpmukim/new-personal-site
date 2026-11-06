// A pelican riding a bicycle, drawn on canvas in chart-ink style.
// Local units: ~130 wide, ~115 tall. Origin = ground directly under the bottom bracket.
// Facing right. The caller handles translate/scale/flip.

export type PelicanPose = {
  crank: number; // crank angle in radians
  wheel: number; // wheel rotation in radians
  pouch: number; // pouch sag offset, -1..1 wobble
  flap?: number; // 0..1 how far the free wing is raised
  bob?: number; // body bob in px
  eye?: 'normal' | 'wide' | 'x';
  noHands?: boolean;
};

export type PelicanPalette = {
  ink: string;
  body: string;
  shade: string;
  beak: string;
  pouch: string;
  frame: string;
  leg: string;
};

export function pelicanPalette(): PelicanPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    ink: v('--pel-ink', '#142A4C'),
    body: v('--pel-body', '#FFFFFF'),
    shade: v('--pel-shade', '#D9E2EC'),
    beak: v('--beak', '#F2A11F'),
    pouch: v('--pel-pouch', '#F7C35C'),
    frame: v('--magenta', '#A8145F'),
    leg: v('--pel-leg', '#E2731B'),
  };
}

const R_WHEEL = 17;
const REAR = { x: -33, y: -R_WHEEL };
const FRONT = { x: 37, y: -R_WHEEL };
const BB = { x: 0, y: -15 };
const SEAT = { x: -10, y: -50 };
const HEAD = { x: 27, y: -46 };
const BAR = { x: 31, y: -58 };
const CRANK = 7.5;

function wheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, rot: number, p: PelicanPalette) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = p.ink;
  ctx.beginPath();
  ctx.arc(0, 0, R_WHEEL, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = rot + (i * Math.PI) / 3;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * R_WHEEL, Math.sin(a) * R_WHEEL);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function ik(hip: { x: number; y: number }, foot: { x: number; y: number }, l1: number, l2: number) {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, l1 + l2 - 0.01);
  const a = Math.atan2(dy, dx);
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
  // knee forward (towards +x): pick the solution with larger x
  const k1 = { x: hip.x + Math.cos(a - alpha) * l1, y: hip.y + Math.sin(a - alpha) * l1 };
  const k2 = { x: hip.x + Math.cos(a + alpha) * l1, y: hip.y + Math.sin(a + alpha) * l1 };
  return k1.x > k2.x ? k1 : k2;
}

function leg(ctx: CanvasRenderingContext2D, hip: { x: number; y: number }, pedal: { x: number; y: number }, p: PelicanPalette, far: boolean) {
  const knee = ik(hip, pedal, 23, 25);
  ctx.save();
  ctx.globalAlpha = far ? 0.55 : 1;
  ctx.strokeStyle = p.leg;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(pedal.x, pedal.y);
  ctx.stroke();
  // webbed foot, slapped on the pedal
  ctx.fillStyle = p.leg;
  ctx.beginPath();
  ctx.moveTo(pedal.x - 3, pedal.y);
  ctx.lineTo(pedal.x + 9, pedal.y - 1.5);
  ctx.lineTo(pedal.x + 8, pedal.y + 3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawPelican(ctx: CanvasRenderingContext2D, pose: PelicanPose, p: PelicanPalette) {
  const bob = pose.bob ?? 0;
  const c = pose.crank;
  const nearPedal = { x: BB.x + Math.cos(c) * CRANK, y: BB.y + Math.sin(c) * CRANK };
  const farPedal = { x: BB.x - Math.cos(c) * CRANK, y: BB.y - Math.sin(c) * CRANK };
  const hip = { x: -6, y: -54 + bob };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // far leg sits behind everything
  leg(ctx, hip, farPedal, p, true);

  wheel(ctx, REAR.x, REAR.y, pose.wheel, p);
  wheel(ctx, FRONT.x, FRONT.y, pose.wheel, p);

  // frame
  ctx.strokeStyle = p.frame;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(REAR.x, REAR.y);
  ctx.lineTo(BB.x, BB.y);
  ctx.lineTo(SEAT.x, SEAT.y);
  ctx.lineTo(REAR.x, REAR.y);
  ctx.moveTo(SEAT.x + 1, SEAT.y + 4);
  ctx.lineTo(HEAD.x, HEAD.y);
  ctx.lineTo(BB.x, BB.y);
  ctx.moveTo(HEAD.x - 1, HEAD.y - 2);
  ctx.lineTo(FRONT.x, FRONT.y);
  ctx.stroke();
  // handlebar stem + bar
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(HEAD.x, HEAD.y);
  ctx.lineTo(BAR.x - 2, BAR.y);
  ctx.quadraticCurveTo(BAR.x + 4, BAR.y - 3, BAR.x + 7, BAR.y + 2);
  ctx.stroke();
  // saddle
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.ellipse(SEAT.x - 1, SEAT.y - 1.5, 7, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // crank
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(farPedal.x, farPedal.y);
  ctx.lineTo(nearPedal.x, nearPedal.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(BB.x, BB.y, 3.4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.translate(0, bob);

  // tail
  ctx.fillStyle = p.body;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-26, -66);
  ctx.lineTo(-42, -62);
  ctx.lineTo(-38, -57);
  ctx.lineTo(-24, -58);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // body: a big, slightly smug teardrop
  ctx.beginPath();
  ctx.ellipse(-6, -66, 23, 15, -0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // neck: an S-curve that is far too long, as is tradition
  const neckSway = Math.sin(c * 0.5) * 1.2;
  ctx.lineWidth = 11;
  ctx.strokeStyle = p.ink;
  ctx.beginPath();
  ctx.moveTo(10, -74);
  ctx.bezierCurveTo(22 + neckSway, -84, 4 + neckSway, -96, 15 + neckSway, -104);
  ctx.stroke();
  ctx.lineWidth = 7.4;
  ctx.strokeStyle = p.body;
  ctx.stroke();

  const hx = 17 + neckSway;
  const hy = -106;

  // pouch (drawn before the beak so the bill sits on top)
  const sag = 13 + pose.pouch * 4;
  ctx.fillStyle = p.pouch;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(hx + 4, hy + 3);
  ctx.bezierCurveTo(hx + 10, hy + 3 + sag * 1.25, hx + 36, hy + 3 + sag, hx + 50, hy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // upper bill with a hooked tip
  ctx.fillStyle = p.beak;
  ctx.beginPath();
  ctx.moveTo(hx + 2, hy - 3);
  ctx.lineTo(hx + 50, hy + 0.5);
  ctx.quadraticCurveTo(hx + 55, hy + 2, hx + 51, hy + 5);
  ctx.lineTo(hx + 3, hy + 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // head
  ctx.fillStyle = p.body;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hx, hy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // crest tuft
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(hx - 5, hy - 6);
  ctx.quadraticCurveTo(hx - 12, hy - 12, hx - 13, hy - 6);
  ctx.moveTo(hx - 3, hy - 7.5);
  ctx.quadraticCurveTo(hx - 8, hy - 15, hx - 11, hy - 11);
  ctx.stroke();

  // eye
  const eye = pose.eye ?? 'normal';
  if (eye === 'x') {
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(hx + 1, hy - 4);
    ctx.lineTo(hx + 6, hy + 1);
    ctx.moveTo(hx + 6, hy - 4);
    ctx.lineTo(hx + 1, hy + 1);
    ctx.stroke();
  } else {
    const r = eye === 'wide' ? 3.6 : 2.8;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(hx + 3.5, hy - 1.5, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(hx + 4.4, hy - 1.2, eye === 'wide' ? 1.1 : 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // wing-arm reaching the handlebar (or flailing if no hands)
  const flap = pose.flap ?? 0;
  ctx.fillStyle = p.shade;
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-18, -70);
  if (pose.noHands || flap > 0) {
    // wing flung up and back, flailing
    const lift = 10 + flap * 16;
    ctx.quadraticCurveTo(-30, -82 - lift * 0.4, -34, -92 - lift);
    ctx.lineTo(-26, -88 - lift * 0.7);
    ctx.lineTo(-24, -94 - lift * 0.8);
    ctx.quadraticCurveTo(-14, -80, -2, -72);
  } else {
    ctx.quadraticCurveTo(6, -76, BAR.x + 4, BAR.y - bob + 1);
    ctx.lineTo(BAR.x - 1, BAR.y - bob + 5);
    ctx.lineTo(BAR.x + 1, BAR.y - bob + 7);
    ctx.quadraticCurveTo(6, -62, -10, -60);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // feather lines
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(-12, -66);
  ctx.lineTo(-4, -68);
  ctx.moveTo(-10, -63);
  ctx.lineTo(0, -65);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.translate(0, -bob);
  // near leg in front of everything
  leg(ctx, hip, nearPedal, p, false);

  ctx.restore();
}

/** Pose helper for a riding pelican at a given travelled distance. */
export function ridingPose(distance: number, t: number, speed: number): PelicanPose {
  const crank = distance / 9;
  return {
    crank,
    wheel: distance / R_WHEEL,
    pouch: Math.sin(t * 9) * Math.min(1, Math.abs(speed) / 120 + 0.25),
    bob: Math.sin(crank * 2) * 1.2,
  };
}

export const PELICAN_BOUNDS = { left: -46, right: 76, top: -124, bottom: 0 };
