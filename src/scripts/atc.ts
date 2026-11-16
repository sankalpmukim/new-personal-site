// Approach control: drag planes onto a runway at VIDP. Lives on the landing page chart.
import { addExceptionStep, secondsSince, track } from "./analytics";
import {
  drawPeaks,
  drawTerrain,
  fitCanvas,
  readColors,
  require2d,
  type ChartColors,
  type Terrain,
} from "./terrain";

type Pt = { x: number; y: number };

type Kind = "prop" | "jet" | "heavy";

type Plane = {
  id: number;
  x: number;
  y: number;
  hdg: number;
  drawHdg: number;
  spd: number;
  kind: Kind;
  path: Pt[];
  cleared: Clearance | null; // runway end it is cleared to land on
  state: "fly" | "land" | "gone";
  landT: number;
  entered: boolean;
  callsign: string;
  auto: boolean;
  warn: boolean;
};

type Pending = { at: number; x: number; y: number; hdg: number; kind: Kind };

type Popup = { x: number; y: number; text: string; t: number };

type Geo = { lat: number; lon: number };

type Runway = {
  id: string;
  designators: [string, string];
  ends: [Pt, Pt];
  mid: Pt;
  dirs: [number, number]; // heading into the runway from each threshold
  length: number;
  width: number;
  openAt: number; // landings needed before it accepts traffic
  flash: number; // clock time it opened, for the pulse
};

type Clearance = { rw: Runway; end: 0 | 1 };

type Building = {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  labelSide: "left" | "right" | "above" | "below";
};

const PREFIX = ["AIC", "IGO", "VTI", "AKJ", "SEJ", "PLC", "IAD", "BDA"];

const STORAGE_KEY = "atc-best";

const M_PER_DEG_LAT = 111132;

const metresPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

// VIDP as it really is: four near-parallel runways. Thresholds come from the
// OurAirports runway table, which agrees with the Wikipedia runway list. 09/27
// is the 1940s original, 10/28 arrived in 2008, 11R/29L in 2008 and the fourth
// runway 11L/29R (south of 11R/29L) in 2023. Runways open up as you land:
// 09/27 at the start, then one at 8, 16 and 25 landings.
const RUNWAY_SPECS: {
  low: [string, Geo];
  high: [string, Geo];
  widthM: number;
  openAt: number;
}[] = [
  {
    low: ["09", { lat: 28.570499, lon: 77.087997 }],
    high: ["27", { lat: 28.569799, lon: 77.116997 }],
    widthM: 45,
    openAt: 0,
  },
  {
    low: ["10", { lat: 28.5672, lon: 77.084801 }],
    high: ["28", { lat: 28.5585, lon: 77.122498 }],
    widthM: 46,
    openAt: 8,
  },
  {
    low: ["11R", { lat: 28.547171, lon: 77.065491 }],
    high: ["29L", { lat: 28.537729, lon: 77.109528 }],
    widthM: 60,
    openAt: 16,
  },
  {
    low: ["11L", { lat: 28.550125, lon: 77.068176 }],
    high: ["29R", { lat: 28.540747, lon: 77.111877 }],
    widthM: 45,
    openAt: 25,
  },
];

// Terminal, cargo and hangar centroids from OpenStreetMap. T1 sits in the
// north-east corner; T2 and T3 are co-located in the south-west; the cargo
// complex is midfield. Labels alternate above and below the boxes because at
// chart scale T2 and T3 are barely twenty pixels apart.
const BUILDING_SPECS: {
  label: string;
  at: Geo;
  wM: number;
  hM: number;
  labelSide: "left" | "right" | "above" | "below";
}[] = [
  { label: "T1", at: { lat: 28.563973, lon: 77.119939 }, wM: 420, hM: 200, labelSide: "right" },
  { label: "T2", at: { lat: 28.55795, lon: 77.0877 }, wM: 260, hM: 150, labelSide: "above" },
  { label: "T3", at: { lat: 28.5556, lon: 77.0828 }, wM: 600, hM: 260, labelSide: "below" },
  {
    label: "CARGO",
    at: { lat: 28.557104, lon: 77.10148 },
    wM: 520,
    hM: 220,
    labelSide: "above",
  },
  { label: "HGR", at: { lat: 28.556522, lon: 77.111049 }, wM: 220, hM: 130, labelSide: "below" },
];

function storeGet(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function storeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

function angDiff(a: number, b: number) {
  let d = a - b;

  while (d > Math.PI) d -= Math.PI * 2;

  while (d < -Math.PI) d += Math.PI * 2;

  return d;
}

export function initAtc(root: HTMLElement, peakNames: { name: string; elevationFt?: number }[]) {
  const canvas = root.querySelector<HTMLCanvasElement>("[data-atc-canvas]")!;
  const scoreEl = root.querySelector<HTMLElement>("[data-atc-score]")!;
  const bestEl = root.querySelector<HTMLElement>("[data-atc-best]")!;
  const statusEl = root.querySelector<HTMLElement>("[data-atc-status]")!;
  const overEl = root.querySelector<HTMLElement>("[data-atc-over]")!;
  const finalEl = root.querySelector<HTMLElement>("[data-atc-final]")!;
  const startBtns = root.querySelectorAll<HTMLButtonElement>("[data-atc-start]");
  const stopBtn = root.querySelector<HTMLButtonElement>("[data-atc-stop]")!;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bg = document.createElement("canvas");
  let ctx: CanvasRenderingContext2D;

  let W = 0,
    H = 0,
    DPR = 1,
    S = 1;

  let colors: ChartColors;

  let terrain: Terrain = { peaks: [] };

  // airfield geometry: the whole field (four runways plus buildings) is fitted
  // into a box rLen * 0.82 wide so the chart keeps its breathing room
  let rc: Pt = { x: 0, y: 0 };

  let rLen = 220;

  let runways: Runway[] = [];

  let buildings: Building[] = [];

  // bounding box of the drawn field, used to hang the data block off it
  let fieldBox = { x0: 0, y0: 0, x1: 0, y1: 0 };

  let mode: "attract" | "play" | "over" = "attract";
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
  let playStartedAt = 0;
  let gamesThisVisit = 0;
  let visible = true;
  let raf = 0;
  let last = 0;
  // wide enough for building labels and eight runway designators
  let dense = true;

  bestEl.textContent = String(best);

  function layout() {
    const fit = fitCanvas(canvas);
    ctx = fit.ctx;
    W = fit.w;
    H = fit.h;
    DPR = fit.dpr;
    S = Math.max(0.75, Math.min(1.25, Math.min(W, H) / 760));
    dense = W >= 700;
    const wide = W > 860;
    rc = wide ? { x: W * 0.68, y: H * 0.47 } : { x: W * 0.5, y: H * 0.3 };
    rLen = Math.max(150, Math.min(300, Math.min(W, H) * 0.34));
    buildField();
    paintBackground();
  }

  // fit the real field into a box a little narrower than the old single runway,
  // so four strips and the buildings stay compact on the chart
  function buildField() {
    const points: Geo[] = [];

    for (const s of RUNWAY_SPECS) points.push(s.low[1], s.high[1]);

    for (const b of BUILDING_SPECS) points.push(b.at);

    const lat0 =
      (Math.min(...points.map((p) => p.lat)) + Math.max(...points.map((p) => p.lat))) / 2;

    const lon0 =
      (Math.min(...points.map((p) => p.lon)) + Math.max(...points.map((p) => p.lon))) / 2;

    const kx = metresPerDegLon(lat0);

    const spanLon = Math.max(...points.map((p) => p.lon)) - Math.min(...points.map((p) => p.lon));

    // phones get a wider field: at 120 px the four strips and the terminal boxes
    // collapse into noise, so the diagram grows inside the same rose
    const pxPerM = (rLen * (dense ? 1.08 : 1.48)) / (spanLon * kx);

    const px = (g: Geo): Pt => ({
      x: rc.x + (g.lon - lon0) * kx * pxPerM,
      y: rc.y - (g.lat - lat0) * M_PER_DEG_LAT * pxPerM,
    });

    runways = RUNWAY_SPECS.map((s): Runway => {
      const a = px(s.low[1]);
      const b = px(s.high[1]);
      const heading = Math.atan2(b.y - a.y, b.x - a.x);

      return {
        id: `${s.low[0]}/${s.high[0]}`,
        designators: [s.low[0], s.high[0]],
        ends: [a, b],
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        dirs: [heading, heading + Math.PI],
        length: Math.hypot(b.x - a.x, b.y - a.y),
        width: Math.max(4.4, s.widthM * pxPerM * 2.4),
        openAt: s.openAt,
        flash: -99,
      };
    });

    buildings = BUILDING_SPECS.map((s) => {
      const p = px(s.at);

      return {
        label: s.label,
        x: p.x,
        y: p.y,
        w: Math.max(9, s.wM * pxPerM),
        h: Math.max(4, s.hM * pxPerM),
        labelSide: s.labelSide,
      };
    });

    const xs = [...runways.flatMap((rw) => rw.ends.map((p) => p.x)), ...buildings.map((b) => b.x)];
    const ys = [...runways.flatMap((rw) => rw.ends.map((p) => p.y)), ...buildings.map((b) => b.y)];

    fieldBox = {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    };
  }

  function paintBackground() {
    colors = readColors();
    bg.width = Math.round(W * DPR);
    bg.height = Math.round(H * DPR);
    const b = require2d(bg);
    b.setTransform(DPR, 0, 0, DPR, 0, 0);
    terrain = drawTerrain(b, W, H, colors, {
      seed: 11,
      valleys: [
        {
          x: rc.x,
          y: rc.y,
          r: Math.max(120, Math.hypot(fieldBox.x1 - fieldBox.x0, fieldBox.y1 - fieldBox.y0) * 0.72),
        },
      ],
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
      { a: -2.4, label: "W33" },
      { a: 2.55, label: "A461" },
      { a: 1.2, label: "G450" },
    ];

    for (const aw of airways) {
      b.beginPath();
      b.moveTo(rc.x + Math.cos(aw.a) * rLen * 1.05, rc.y + Math.sin(aw.a) * rLen * 1.05);
      b.lineTo(rc.x + Math.cos(aw.a) * 2000, rc.y + Math.sin(aw.a) * 2000);
      b.stroke();
      const lx = rc.x + Math.cos(aw.a) * rLen * 1.5;
      const ly = rc.y + Math.sin(aw.a) * rLen * 1.5;
      b.globalAlpha = 0.85;
      b.font = '700 11px "Archivo Variable", Archivo, sans-serif';
      b.fontStretch = "condensed";
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
      const a = ((d - 90) * Math.PI) / 180;
      const len = d % 30 === 0 ? 12 : d % 10 === 0 ? 7 : 4;
      b.beginPath();
      b.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      b.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
      b.stroke();

      if (d % 30 === 0) {
        b.save();
        b.rotate(a + Math.PI / 2);
        b.font = '600 10px "Archivo Variable", Archivo, sans-serif';
        b.textAlign = "center";
        b.fillText(d === 0 ? "N" : String(d / 10), 0, -R + 24);
        b.restore();
      }
    }

    b.restore();
  }

  function runwayOpen(rw: Runway) {
    return mode !== "play" || score >= rw.openAt;
  }

  function openRunways() {
    return runways.filter((rw) => runwayOpen(rw));
  }

  // a plane is down when it reaches an open threshold lined up with the runway,
  // either because it was cleared there or because it was flying free
  function touchdownFor(p: Plane): Clearance | null {
    for (const rw of openRunways()) {
      for (const end of [0, 1] as const) {
        const e = rw.ends[end];

        if (Math.hypot(p.x - e.x, p.y - e.y) >= 10 * S) continue;

        if (Math.abs(angDiff(p.drawHdg, rw.dirs[end])) >= 0.9) continue;

        const clearedHere = p.cleared?.rw === rw && p.cleared.end === end;

        if (clearedHere || p.path.length === 0) return { rw, end };
      }
    }

    return null;
  }

  function drawApproaches(c: CanvasRenderingContext2D) {
    c.save();
    c.strokeStyle = colors.ink;
    c.lineWidth = 1.1;
    c.globalAlpha = 0.3;
    c.setLineDash([3, 7]);

    for (const rw of openRunways()) {
      const ext = Math.max(34, rw.length * 0.22);

      for (const end of [0, 1] as const) {
        const e = rw.ends[end];
        const back = rw.dirs[end] + Math.PI;
        c.beginPath();
        c.moveTo(e.x, e.y);
        c.lineTo(e.x + Math.cos(back) * ext, e.y + Math.sin(back) * ext);
        c.stroke();
      }
    }

    c.restore();
  }

  function drawBuildings(c: CanvasRenderingContext2D) {
    c.save();
    c.font = `600 ${Math.max(8, Math.round(8 * S))}px "Archivo Variable", Archivo, sans-serif`;
    c.fontStretch = "condensed";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.lineWidth = 2.4;

    for (const b of buildings) {
      c.globalAlpha = 0.9;
      c.fillStyle = colors.paper2;
      c.fillRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);
      c.globalAlpha = 0.55;
      c.strokeStyle = colors.ink;
      c.lineWidth = 1;
      c.strokeRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h);

      // on narrow screens the field is too small for labels; the boxes alone
      // keep the terminal cluster readable as texture
      if (!dense) continue;

      c.globalAlpha = 0.8;
      c.fillStyle = colors.ink;
      c.strokeStyle = colors.paper;

      let tx = b.x;
      let ty = b.y;

      if (b.labelSide === "left") {
        tx = b.x - b.w / 2 - 4;
        c.textAlign = "right";
      } else if (b.labelSide === "right") {
        tx = b.x + b.w / 2 + 4;
        c.textAlign = "left";
      } else if (b.labelSide === "above") {
        ty = b.y - b.h / 2 - 7;
        c.textAlign = "center";
      } else {
        ty = b.y + b.h / 2 + 8;
        c.textAlign = "center";
      }

      c.strokeText(b.label, tx, ty);
      c.fillText(b.label, tx, ty);
    }

    c.restore();
  }

  function drawRunway(c: CanvasRenderingContext2D, rw: Runway) {
    const open = runwayOpen(rw);
    const len = rw.length;
    const w = rw.width;

    c.save();
    c.translate(rw.mid.x, rw.mid.y);
    c.rotate(rw.dirs[0]);

    if (!open) {
      // still closed: a dashed outline only, so the pair of southern runways
      // stays readable as two strips at this scale
      c.strokeStyle = colors.ink;
      c.lineWidth = 1;
      c.globalAlpha = 0.42;
      c.setLineDash([5, 4]);
      c.strokeRect(-len / 2, -w / 2, len, w);
    } else {
      c.fillStyle = "#3B4250";
      c.globalAlpha = 1;
      c.fillRect(-len / 2, -w / 2, len, w);
      c.strokeStyle = colors.ink;
      c.lineWidth = 1;
      c.globalAlpha = 0.85;
      c.strokeRect(-len / 2, -w / 2, len, w);

      c.fillStyle = "#F4F6F2";
      c.globalAlpha = 0.85;

      // centreline
      for (let x = -len / 2 + 10; x < len / 2 - 10; x += 9) c.fillRect(x, -0.5, 4, 1);

      // threshold bars
      for (const side of [-1, 1]) {
        const x0 = side * (len / 2 - 2.6);

        c.fillRect(x0 - 1.3, -w / 2 + 1, 2.6, w - 2);
      }
    }

    c.restore();

    // just-opened runways pulse for a moment
    if (open && clock - rw.flash < 1.6) {
      c.save();
      c.strokeStyle = colors.blue;
      c.lineWidth = 2;
      c.globalAlpha = Math.max(0, 0.55 * (1 - (clock - rw.flash) / 1.6));
      c.translate(rw.mid.x, rw.mid.y);
      c.rotate(rw.dirs[0]);
      c.strokeRect(-len / 2 - 3, -w / 2 - 3, len + 6, w + 6);
      c.restore();
    }

    // designators sit just outside each threshold, unrotated so they stay legible.
    // locked runways keep theirs, dimmed, so the field reads as four runways.
    if (!open && !dense) return;

    c.save();
    c.font = `700 ${Math.max(7.5, Math.round(8 * S))}px "Archivo Variable", Archivo, sans-serif`;
    c.fontStretch = "condensed";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.lineWidth = 2.4;
    c.lineJoin = "round";
    c.strokeStyle = colors.paper;

    for (const end of [0, 1] as const) {
      const e = rw.ends[end];
      const dir = rw.dirs[end];
      const out = 6 * S + 2;
      const x = e.x - Math.cos(dir) * out;
      const y = e.y - Math.sin(dir) * out;
      c.globalAlpha = open ? 0.9 : 0.4;
      c.fillStyle = colors.ink;
      c.strokeText(rw.designators[end], x, y);
      c.fillText(rw.designators[end], x, y);
    }

    c.restore();
  }

  // The data block hangs off the field's lower-right corner, right-aligned, so
  // it never fights the compass rose labels or the headline.
  function drawDataBlock(c: CanvasRenderingContext2D) {
    const open = openRunways().length;
    c.save();
    c.fontStretch = "condensed";
    c.fillStyle = colors.blue;
    c.strokeStyle = colors.paper;
    c.lineWidth = 3;
    c.lineJoin = "round";
    c.textAlign = "right";

    const lx = fieldBox.x1;

    const line = (text: string, y: number) => {
      c.strokeText(text, lx, y);
      c.fillText(text, lx, y);
    };

    if (!dense) {
      c.font = '700 10px "Archivo Variable", Archivo, sans-serif';
      c.globalAlpha = 0.85;
      line(`VIDP · 777 ft · RWY ${open}/${runways.length}`, fieldBox.y1 + 19);
      c.restore();

      return;
    }

    const ly = fieldBox.y1 + 27;
    c.font = '800 13px "Archivo Variable", Archivo, sans-serif';
    line("HOME BASE (VIDP)", ly);
    c.font = '600 11px "Archivo Variable", Archivo, sans-serif';
    c.globalAlpha = 0.85;
    line("ELEV 777 ft · 118.10", ly + 15);
    c.globalAlpha = 0.7;
    line(`RWY ${open}/${runways.length} OPEN`, ly + 29);
    c.restore();
  }

  function spawnPoint(kind: Kind): Pending {
    const edge = Math.floor(Math.random() * 4);
    const m = 30;

    let x = 0,
      y = 0;

    if (edge === 0) {
      x = Math.random() * W;
      y = -m;
    }

    if (edge === 1) {
      x = W + m;
      y = Math.random() * H;
    }

    if (edge === 2) {
      x = Math.random() * W;
      y = H + m;
    }

    if (edge === 3) {
      x = -m;
      y = Math.random() * H;
    }

    const tx = W * (0.25 + Math.random() * 0.5);
    const ty = H * (0.25 + Math.random() * 0.5);

    return { at: clock + (mode === "play" ? 1.6 : 0), x, y, hdg: Math.atan2(ty - y, tx - x), kind };
  }

  function difficulty() {
    return Math.min(2.3, 1 + score * 0.045);
  }

  function makePlane(p: Pending): Plane {
    const base = p.kind === "prop" ? 30 : p.kind === "jet" ? 46 : 38;

    const plane: Plane = {
      id: ++idSeq,
      x: p.x,
      y: p.y,
      hdg: p.hdg,
      drawHdg: p.hdg,
      spd: base * S * (mode === "play" ? difficulty() : 1),
      kind: p.kind,
      path: [],
      cleared: null,
      state: "fly",
      landT: 0,
      entered: false,
      callsign: `${PREFIX[Math.floor(Math.random() * PREFIX.length)]}${100 + Math.floor(Math.random() * 899)}`,
      auto: mode === "attract",
      warn: false,
    };

    if (plane.auto) autoRoute(plane);

    return plane;
  }

  function autoRoute(p: Plane) {
    // pick the open threshold whose approach point is closest to the plane
    let pick: Clearance | null = null;
    let bestD = Infinity;

    for (const rw of openRunways()) {
      for (const end of [0, 1] as const) {
        const back = rw.dirs[end] + Math.PI;
        const ax = rw.ends[end].x + Math.cos(back) * rw.length * 0.55;
        const ay = rw.ends[end].y + Math.sin(back) * rw.length * 0.55;
        const d = Math.hypot(ax - p.x, ay - p.y);

        if (d < bestD) {
          bestD = d;
          pick = { rw, end };
        }
      }
    }

    if (!pick) return;

    const e = pick.rw.ends[pick.end];
    const back = pick.rw.dirs[pick.end] + Math.PI;
    const ax = e.x + Math.cos(back) * pick.rw.length * 0.55;
    const ay = e.y + Math.sin(back) * pick.rw.length * 0.55;
    const cx = p.x + Math.cos(p.hdg) * bestD * 0.5;
    const cy = p.y + Math.sin(p.hdg) * bestD * 0.5;
    const pts: Pt[] = [];

    for (let t = 0.05; t <= 1; t += 0.05) {
      const u = 1 - t;
      pts.push({
        x: u * u * p.x + 2 * u * t * cx + t * t * ax,
        y: u * u * p.y + 2 * u * t * cy + t * t * ay,
      });
    }

    pts.push({ x: e.x, y: e.y });
    p.path = pts;
    p.cleared = pick;
  }

  function setMode(m: typeof mode) {
    mode = m;
    root.classList.toggle("is-playing", m === "play");
    root.classList.toggle("is-over", m === "over");
    canvas.style.touchAction = m === "play" ? "none" : "";
    overEl.hidden = m !== "over";
    stopBtn.hidden = m === "attract";
  }

  // how play began: the hero button, the retry button after a crash, or grabbing a plane
  function start(trigger: "button" | "retry" | "drag") {
    gamesThisVisit++;
    playStartedAt = performance.now();
    track("atc_game_started", { trigger, game_number: gamesThisVisit, best_score: best });
    addExceptionStep("atc_game_started");
    planes = [];
    pending = [];
    popups = [];
    crash = null;
    score = 0;
    scoreEl.textContent = "0";
    setMode("play");

    for (const rw of runways) rw.flash = -99;

    statusEl.textContent = `Drag each plane onto a runway, lined up with the dashed approach. ${runwayStatus()}`;
    nextSpawn = clock + 0.3;

    if (!raf) loop(performance.now());
  }

  function stop(method: "button" | "escape") {
    if (mode === "play")
      track("atc_game_stopped", {
        method,
        landed_planes: score,
        duration_s: secondsSince(playStartedAt),
      });

    setMode("attract");
    planes = [];
    pending = [];
    popups = [];
    crash = null;
    active = null;
    statusEl.textContent = "";
    nextSpawn = clock;
  }

  function gameOver(a: Plane, b: Plane) {
    crash = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, t: 0 };
    active = null;

    const isNewBest = score > best;
    const previousBest = best;

    if (isNewBest) {
      best = score;
      storeSet(STORAGE_KEY, String(best));
      bestEl.textContent = String(best);
    }

    track("atc_game_ended", {
      landed_planes: score,
      is_new_best: isNewBest,
      previous_best: previousBest,
      duration_s: secondsSince(playStartedAt),
      planes_in_air: planes.filter((p) => p.state === "fly").length,
      collision: [a.kind, b.kind].sort().join("+"),
    });
    finalEl.textContent = `${a.callsign} and ${b.callsign} got too close. You landed ${score} ${score === 1 ? "plane" : "planes"}.`;
    setMode("over");
    statusEl.textContent = "";
  }

  function nextUnlock() {
    const next = runways.find((rw) => rw.openAt > score);

    return next ? next.openAt : 0;
  }

  function runwayStatus() {
    const open = openRunways().length;

    if (open >= runways.length) return `All ${runways.length} runways open.`;

    return `${open}/${runways.length} runways open · next at ${nextUnlock()}.`;
  }

  function onLanded(p: Plane) {
    if (mode !== "play") return;

    score++;
    scoreEl.textContent = String(score);
    popups.push({ x: p.x, y: p.y - 16, text: `${p.callsign} landed`, t: 0 });

    for (const rw of runways) {
      if (rw.openAt !== score) continue;

      rw.flash = clock;
      popups.push({ x: rw.mid.x, y: rw.mid.y - 20, text: `RWY ${rw.id} open`, t: 0 });
      statusEl.textContent = runwayStatus();
      track("atc_runway_opened", {
        runway: rw.id,
        landed_planes: score,
        runways_open: openRunways().length,
      });
    }
  }

  function step(dt: number) {
    clock += dt;

    // spawning
    const maxPlanes = mode === "play" ? Math.min(12, 3 + Math.floor(score / 3)) : 3;
    const interval = mode === "play" ? Math.max(1.4, 5.2 - score * 0.2) : 3.2;

    if (mode !== "over" && clock >= nextSpawn && planes.length + pending.length < maxPlanes) {
      const r = Math.random();
      const kind: Kind = r < 0.4 ? "prop" : r < 0.8 ? "jet" : "heavy";
      pending.push(spawnPoint(kind));
      nextSpawn = clock + interval * (0.75 + Math.random() * 0.5);
    }

    pending = pending.filter((p) => {
      if (clock >= p.at) {
        planes.push(makePlane(p));

        return false;
      }

      return true;
    });

    if (mode === "over") {
      if (crash) crash.t += dt;

      return;
    }

    for (const p of planes) {
      if (p.state === "land") {
        p.landT += dt / 2.4;

        const clearance = p.cleared;

        if (!clearance) continue;

        const dir = clearance.rw.dirs[clearance.end];
        const e = clearance.rw.ends[clearance.end];
        const dist = clearance.rw.length * 0.72 * (1 - Math.pow(1 - Math.min(1, p.landT), 2));
        p.x = e.x + Math.cos(dir) * dist;
        p.y = e.y + Math.sin(dir) * dist;
        p.hdg = dir;
        p.drawHdg = dir;

        if (p.landT >= 1.25) p.state = "gone";
        continue;
      }

      let move = p.spd * dt;

      while (p.path.length && move > 0) {
        const t = p.path[0];
        const d = Math.hypot(t.x - p.x, t.y - p.y);

        if (d <= move) {
          p.x = t.x;
          p.y = t.y;
          move -= d;
          p.path.shift();

          if (d > 0.01) p.hdg = Math.atan2(t.y - p.y + 0.0001, t.x - p.x + 0.0001) || p.hdg;
        } else {
          p.hdg = Math.atan2(t.y - p.y, t.x - p.x);
          p.x += ((t.x - p.x) / d) * move;
          p.y += ((t.y - p.y) / d) * move;
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

      const td = touchdownFor(p);

      if (td) {
        p.state = "land";
        p.cleared = td;
        p.path = [];
        p.landT = 0;
        onLanded(p);
      }
    }

    planes = planes.filter((p) => p.state !== "gone");

    // separation
    for (const p of planes) p.warn = false;

    if (mode === "play") {
      for (let i = 0; i < planes.length; i++) {
        for (let j = i + 1; j < planes.length; j++) {
          const a = planes[i],
            b = planes[j];

          if (a.state !== "fly" || b.state !== "fly" || !a.entered || !b.entered) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);

          if (d < 15 * S) {
            gameOver(a, b);

            return;
          }

          if (d < 55 * S) {
            a.warn = true;
            b.warn = true;
          }
        }
      }
    }

    popups = popups.filter((pp) => (pp.t += dt) < 1.6);
  }

  function tracePlane(c: CanvasRenderingContext2D, kind: Kind) {
    c.beginPath();

    if (kind === "prop") {
      c.moveTo(10, 0);
      c.lineTo(6, -1.6);
      c.lineTo(3, -1.6);
      c.lineTo(3, -12);
      c.lineTo(-1, -12);
      c.lineTo(-1, -1.6);
      c.lineTo(-8, -1.2);
      c.lineTo(-8, -5);
      c.lineTo(-11, -5);
      c.lineTo(-11, 5);
      c.lineTo(-8, 5);
      c.lineTo(-8, 1.2);
      c.lineTo(-1, 1.6);
      c.lineTo(-1, 12);
      c.lineTo(3, 12);
      c.lineTo(3, 1.6);
      c.lineTo(6, 1.6);
    } else {
      c.moveTo(13, 0);
      c.quadraticCurveTo(11, -2.2, 6, -2.2);
      c.lineTo(2, -2.2);
      c.lineTo(-5, -13);
      c.lineTo(-8, -13);
      c.lineTo(-4, -2.2);
      c.lineTo(-10, -2);
      c.lineTo(-13, -6.5);
      c.lineTo(-15, -6.5);
      c.lineTo(-13.5, 0);
      c.lineTo(-15, 6.5);
      c.lineTo(-13, 6.5);
      c.lineTo(-10, 2);
      c.lineTo(-4, 2.2);
      c.lineTo(-8, 13);
      c.lineTo(-5, 13);
      c.lineTo(2, 2.2);
      c.lineTo(6, 2.2);
      c.quadraticCurveTo(11, 2.2, 13, 0);
    }

    c.closePath();
  }

  function kindColor(k: Kind) {
    return k === "prop"
      ? colors.blue
      : k === "jet"
        ? colors.magenta
        : getComputedStyle(root).getPropertyValue("--beak").trim();
  }

  function drawPlane(p: Plane) {
    const scale =
      S *
      (p.kind === "heavy" ? 1.35 : 1) *
      (p.state === "land" ? 1 - Math.min(0.45, p.landT * 0.45) : 1);

    const alpha = p.state === "land" ? Math.max(0, 1 - Math.max(0, p.landT - 0.85) * 2.5) : 1;
    const accent = kindColor(p.kind);
    ctx.save();
    ctx.globalAlpha = alpha;
    // shadow
    const sh = p.state === "land" ? 7 * (1 - Math.min(1, p.landT)) : 7;
    ctx.save();
    ctx.translate(p.x + sh, p.y + sh * 1.2);
    ctx.rotate(p.drawHdg);
    ctx.scale(scale, scale);
    tracePlane(ctx, p.kind);
    ctx.fillStyle = colors.ink;
    ctx.globalAlpha = 0.18 * alpha;
    ctx.fill();
    ctx.restore();

    ctx.translate(p.x, p.y);
    ctx.rotate(p.drawHdg);
    ctx.scale(scale, scale);
    tracePlane(ctx, p.kind);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.lineWidth = 1.4 / scale;
    ctx.strokeStyle = colors.ink;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillRect(-14, -1.1, 10, 2.2);

    if (p.kind === "heavy") {
      ctx.fillStyle = colors.ink;

      for (const [x, y] of [
        [-1, -6],
        [-3, -9.5],
        [-1, 6],
        [-3, 9.5],
      ])
        ctx.fillRect(x, y - 1, 3, 2);
    }

    if (p.kind === "prop") {
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1;
      const a = clock * 40;
      ctx.beginPath();
      ctx.moveTo(11, Math.sin(a) * 5);
      ctx.lineTo(11, -Math.sin(a) * 5);
      ctx.stroke();
    }

    ctx.restore();

    if (p.state === "fly") {
      if (p.warn) {
        ctx.save();
        ctx.strokeStyle = "#D02A2A";
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.6 + Math.sin(clock * 14) * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 27 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // data block
      ctx.save();
      ctx.font = '700 10px "Archivo Variable", Archivo, sans-serif';
      ctx.fontStretch = "condensed";
      ctx.fillStyle = colors.ink;
      ctx.globalAlpha = 0.85;
      ctx.fillText(p.callsign, p.x + 16 * S, p.y - 12 * S);
      ctx.globalAlpha = 0.55;
      ctx.font = '600 9px "Archivo Variable", Archivo, sans-serif';
      ctx.fillText(`${Math.round(p.spd * 3)} kt`, p.x + 16 * S, p.y - 2 * S);
      ctx.restore();
    }
  }

  function drawPath(p: Plane) {
    if (!p.path.length || p.state !== "fly") return;
    ctx.save();
    ctx.strokeStyle = p.cleared ? colors.blue : colors.ink;
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
    ctx.arc(end.x, end.y, p.cleared ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = p.cleared ? colors.blue : colors.ink;
    ctx.fill();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);

    drawApproaches(ctx);
    drawBuildings(ctx);

    for (const rw of runways) drawRunway(ctx, rw);

    drawDataBlock(ctx);

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
      ctx.moveTo(10, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // threshold highlight while dragging
    if (active) {
      ctx.save();
      ctx.strokeStyle = colors.blue;
      ctx.lineWidth = 2;

      for (const rw of openRunways()) {
        for (const end of rw.ends) {
          ctx.globalAlpha = 0.45 + Math.sin(clock * 8) * 0.25;
          ctx.beginPath();
          ctx.arc(end.x, end.y, 15 * S, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.restore();
    }

    for (const p of planes) drawPath(p);

    for (const p of planes) if (p.state === "land") drawPlane(p);

    for (const p of planes) if (p.state === "fly") drawPlane(p);

    for (const pp of popups) {
      ctx.save();
      ctx.globalAlpha = 1 - pp.t / 1.6;
      ctx.font = '800 13px "Archivo Variable", Archivo, sans-serif';
      ctx.fontStretch = "condensed";
      ctx.fillStyle = colors.blue;
      ctx.fillText(pp.text, pp.x, pp.y - pp.t * 22);
      ctx.restore();
    }

    if (crash) {
      ctx.save();
      const r = 10 + crash.t * 90;
      ctx.strokeStyle = "#D02A2A";
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
    for (const rw of openRunways()) {
      for (const end of [0, 1] as const) {
        const e = rw.ends[end];

        if (Math.hypot(pt.x - e.x, pt.y - e.y) >= 24 * S) continue;

        // direction of the drawn approach over the last ~40px
        let k = p.path.length - 1;
        let from: Pt = { x: p.x, y: p.y };
        let acc = 0;

        while (k > 0) {
          acc += Math.hypot(p.path[k].x - p.path[k - 1].x, p.path[k].y - p.path[k - 1].y);

          if (acc > 40) {
            from = p.path[k - 1];
            break;
          }

          k--;
        }

        if (k <= 0) from = { x: p.x, y: p.y };
        const dir = Math.atan2(e.y - from.y, e.x - from.x);

        if (Math.abs(angDiff(dir, rw.dirs[end])) < 0.85) {
          p.path.push({ x: e.x, y: e.y });
          p.cleared = { rw, end };

          return true;
        }
      }
    }

    return false;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (mode === "over") return;
    const pt = local(e);
    let hit: Plane | null = null;
    let hd = 30 * S;

    for (const p of planes) {
      if (p.state !== "fly") continue;
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);

      if (d < hd) {
        hd = d;
        hit = p;
      }
    }

    if (!hit) return;

    if (mode === "attract") {
      if (e.pointerType !== "mouse") return; // on touch, use the button so the page can still scroll
      start("drag");
      planes = [hit];
      hit.auto = false;
    }

    e.preventDefault();
    active = hit;
    hit.path = [];
    hit.cleared = null;
    hit.auto = false;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    const pt = local(e);

    if (!active) {
      const over =
        mode !== "over" &&
        planes.some((p) => p.state === "fly" && Math.hypot(p.x - pt.x, p.y - pt.y) < 30 * S);

      canvas.style.cursor = over ? "grab" : "";

      return;
    }

    canvas.style.cursor = "grabbing";
    const p = active;

    if (p.state !== "fly" || mode !== "play") {
      active = null;

      return;
    }

    const lastPt = p.path[p.path.length - 1] ?? { x: p.x, y: p.y };

    if (Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y) < 7) return;
    p.path.push({ x: Math.max(4, Math.min(W - 4, pt.x)), y: Math.max(4, Math.min(H - 4, pt.y)) });

    if (tryClear(p, pt)) active = null;
  });

  const endDrag = () => {
    active = null;
    canvas.style.cursor = "";
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  startBtns.forEach((b) =>
    b.addEventListener("click", () => start(mode === "over" ? "retry" : "button")),
  );
  stopBtn.addEventListener("click", () => stop("button"));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && mode !== "attract") stop("escape");
  });

  new IntersectionObserver(
    ([en]) => {
      visible = en.isIntersecting;
    },
    { threshold: 0.05 },
  ).observe(root);

  let resizeT = 0;

  const ro = new ResizeObserver(() => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(() => {
      layout();

      if (!raf) render();
    }, 120);
  });

  ro.observe(canvas);

  const repaint = () => {
    paintBackground();

    if (!raf) render();
  };

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", repaint);
  addEventListener("themechange", repaint);

  // read-only hook for automated checks
  Object.assign(root, {
    __atc: {
      planes: () => planes,
      runways: () =>
        runways.map((rw) => ({
          id: rw.id,
          open: runwayOpen(rw),
          openAt: rw.openAt,
          ends: rw.ends,
          mid: rw.mid,
          length: rw.length,
        })),
      score: () => score,
      mode: () => mode,
    },
  });

  layout();
  setMode("attract");

  if (reduced) {
    // one still frame: a few planes on approach, no motion until the player starts
    for (let i = 0; i < 3; i++) {
      const p = makePlane(spawnPoint(i === 0 ? "jet" : i === 1 ? "prop" : "heavy"));
      const k = Math.floor(p.path.length * (0.45 + i * 0.12));
      const at = p.path[k] ?? { x: W / 2, y: H / 2 };
      const nx = p.path[k + 1] ?? at;
      p.x = at.x;
      p.y = at.y;
      p.hdg = p.drawHdg = Math.atan2(nx.y - at.y, nx.x - at.x);
      p.path = p.path.slice(k);
      planes.push(p);
    }

    render();
  } else {
    // pre-roll so the sky is busy on first paint
    for (let i = 0; i < 2; i++) {
      const pd = spawnPoint(i ? "prop" : "jet");
      const p = makePlane(pd);
      planes.push(p);
    }

    for (let i = 0; i < 240; i++) step(1 / 30);
    last = performance.now();
    loop(last);
  }
}
