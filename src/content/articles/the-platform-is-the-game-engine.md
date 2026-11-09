---
title: "The Browser Is the Game Engine: Two Games, Zero Dependencies"
description: "How the approach-control game and Pelican Run on this site are built with plain TypeScript and Canvas — no frameworks, no game engines — and what the modern browser gives you for free if you know where to look."
date: 2026-11-09
---

This site ships two games. The hero of the home page is an air traffic control game where you drag planes onto a runway, and the footer has a pelican on a bicycle jumping over AI company logos. Between them there is also a pelican that rides along the bottom of the page as you scroll, occasionally crashing cameo appearances into sections.

There is no React, no Three.js, no Phaser, no game engine, and no animation library. The whole thing is a few thousand lines of plain TypeScript talking directly to browser APIs, and the total script payload is smaller than most sites' font files. This is how the two games work, and — more interestingly — what the browser gives you for free if you reach past the framework layer.

## The shared foundation

Both games are built on the same three ideas, so they're worth establishing first.

**A canvas has two sizes, and you must manage both.** A `<canvas>` has a CSS layout box measured in logical pixels and a backing store (`canvas.width`/`canvas.height`) measured in device pixels. They default to a 1:1 ratio, which is why naive canvas art looks blurry on Retina screens: one canvas pixel smeared across four physical ones. Every canvas on this site goes through a shared `fitCanvas()` helper:

```ts
export function fitCanvas(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}
```

The backing store is sized in physical pixels for sharpness, then `setTransform` bakes the device pixel ratio into the context's transformation matrix. From that point on, the game code thinks entirely in CSS pixels — hit tests, physics, and drawing — and the matrix does the conversion during rasterization. Note the cap at 2: a 3× display gets no visual benefit but pays 2.25× the fill cost, so it's clamped.

**CSS custom properties are the theming bridge.** Canvas can't use `var(--magenta)`, but `getComputedStyle(document.documentElement).getPropertyValue('--magenta')` resolves any custom property at read time. All chart colors live in CSS with `prefers-color-scheme: dark` overrides doing their normal job, and the canvases re-read the resolved values whenever they repaint their background layers. One source of truth, two rendering worlds. When you flip your OS to dark mode, the games repaint — because `matchMedia('(prefers-color-scheme: dark)')` is a live query you can subscribe to, not just a one-time check.

**Fonts must be loaded before canvas text is measured.** `fillText` and `measureText` render with whatever font exists at call time. If a game draws its chart labels before Archivo arrives, every label box is measured in the fallback face and stays wrong, because the static background layer isn't redrawn. So the home page waits on the CSS Font Loading API before initializing:

```ts
const ready = document.fonts?.ready ?? Promise.resolve();
Promise.race([ready, new Promise((r) => setTimeout(r, 700))]).then(start);
```

`document.fonts.ready` resolves when pending font loads finish; the 700 ms race ensures a stalled font never blocks the hero from appearing.

## Game one: approach control

The premise: planes spawn at the edges of a sectional chart. You drag each one to draw a route, and line it up with one of the runway's approach cones. Land planes, score points; let two get too close, and it's game over.

### Attract mode and the pre-roll

Before you interact, the game plays itself in an "attract" mode — the arcade trick for drawing people in. Planes spawn in auto mode, and `autoRoute()` builds each one a quadratic Bézier from its current position to the approach fix of whichever runway end is nearer, so the demo planes always fly plausible, curved finals instead of beelining.

The neatest detail is the pre-roll. An empty chart that slowly fills with planes looks dead, so on first paint the simulation runs 240 synchronous steps of simulated time:

```ts
for (let i = 0; i < 240; i++) step(1 / 30);
last = performance.now();
loop(last);
```

That's 8 seconds of gameplay executed before the first frame, so the very first paint already shows a busy sky with planes mid-approach. The cost is a few milliseconds of CPU once, on load.

### Waypoint physics

Planes don't have a steering AI in the usual sense. A plane is a short list of waypoints plus a constant speed. Each tick, it consumes its path: walk toward the next waypoint, spend distance, drop waypoints it reaches. Its drawn heading eases toward the direction of travel (`drawHdg += angDiff(hdg, drawHdg) * min(1, dt * 8)`), which is what produces the smooth banked turns — the physics position turns instantly, but the sprite rotation lags on a spring.

When _you_ drag a plane, your pointer appends waypoints to that same list (spaced at least 7 px apart, clamped to the canvas). The drag isn't teleporting the plane; it's authoring the flight plan the plane then flies. That single design decision is what makes the game feel like vectoring traffic instead of dragging sprites.

### Clearances and landings

Dropping a plane near a runway threshold isn't enough. `tryClear()` walks back through the last ~40 px of the path you drew, measures its overall direction, and only accepts the clearance if it's within about 50° of the actual runway heading:

```ts
if (Math.abs(angDiff(dir, landDir[i])) < 0.85) {
  p.path.push({ x: e.x, y: e.y });
  p.cleared = i;
  return true;
}
```

You must genuinely line the plane up with the dashed extended centerline, like a real approach clearance. The touchdown check later re-verifies alignment before a plane is allowed to land. Runway designators themselves aren't hardcoded either — they're computed from the runway's angle, so the chart says `RWY 10/28` because the geometry says so.

### Separation minima

Scoring is a simple O(n²) pairwise pass every frame: closer than 55 px and both planes get a pulsing warning ring; closer than 15 px and the game ends with a red pulse at the collision point. Difficulty ramps along with score — spawn interval shrinks, speeds multiply up to 2.3×, and the plane cap rises to 12. Simple, but it produces real tension, because the failure mode (loss of separation) is exactly the failure mode of real approach control.

### The background layer

The chart itself — procedurally generated terrain (Perlin noise), contour lines via marching squares, compass rose, airspace rings, airways, the runway — is computationally expensive. So it is rendered exactly **once** per layout into an offscreen canvas that never enters the DOM. Every frame then does one `clearRect` and one `drawImage(bg)`. A same-size canvas blit is essentially a memcpy on the compositor path, versus re-issuing thousands of path commands per frame. The dynamic layer (planes, paths, popups, warnings) is all that's actually redrawn at 60 fps.

## Game two: Pelican Run

Down in the footer, the second game is a runner in the Chrome-dinosaur tradition: space, up arrow, or tap to jump over AI company logos. The interesting parts are the rider and the input plumbing.

### The pelican is a pure function

`drawPelican(ctx, pose, palette)` draws the entire bird-on-bicycle in one call. It has no state, no memory — you pass it a pose:

```ts
export type PelicanPose = {
  crank: number; // crank angle in radians
  wheel: number; // wheel rotation in radians
  pouch: number; // pouch sag, -1..1 wobble
  flap?: number; // 0..1 how far the free wing is raised
  bob?: number; // body bob in px
  eye?: "normal" | "wide" | "x";
  noHands?: boolean;
};
```

Every behavior you've seen — the mid-air wing-flail with wide eyes, the X-eyes crash, the wheelie — is just a pose parameter set by the game state. The same function draws the game rider, the scroll rider, and every cameo.

The legs are worth calling out because they're real inverse kinematics. The pedal positions come from the crank angle; each leg is two bone lengths (23 and 25 units) from hip to pedal, and a two-bone IK solver — the law of cosines — places the knee:

```ts
const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
// two mirror solutions; pick the one with the knee forward
```

A two-bone chain has two valid knee positions; the pelican always picks knee-forward, which is why it pedals like a cyclist instead of a grasshopper. And because the feet are anchored to the pedals, the pedaling animation is _derived_, not authored — rotate the crank and the legs have no choice but to follow.

The pose helper couples everything to distance travelled: `crank = distance / 9` and `wheel = distance / R_WHEEL`, so the wheel rolls without slipping and the pedals turn at a fixed gear ratio. Scroll the page and the same math makes the scroll-rider's legs match its ground speed.

### Runner physics and input

The game loop is classic semi-implicit Euler: gravity 2300 px/s², jump impulse 760 px/s, speed ramping from 330 to 860 px/s, AABB collision against each obstacle with a few pixels of forgiveness. Obstacles get fancier at higher scores — pairs, then "hallucination" clouds you must duck under, labeled `2 + 2 = 5`, because if you're going to have a flying obstacle in a game about jumping AI logos, it should confidently state nonsense.

Input is where the browser knowledge shows. Pointer events unify mouse and touch, and `pointerdown` handles both. The keyboard path guards against the classic bug where pressing space to jump also scrolls the page or activates a focused button:

```ts
addEventListener("keydown", (e) => {
  if (e.code !== "Space" && e.code !== "ArrowUp") return;
  const tgt = e.target;
  if (
    tgt instanceof Element &&
    tgt.closest("input, textarea, select, button, a, [contenteditable]") &&
    tgt !== canvas
  )
    return;
  if (!inView && document.activeElement !== canvas) return;
  e.preventDefault();
  jump("keyboard");
  kick();
});
```

The game only claims the space bar while its canvas is actually in view — scroll past the footer and space goes back to scrolling the page.

## The supporting cast: APIs doing the heavy lifting

Both games stand on a handful of browser APIs that everyday app development rarely touches. Individually they're small; together they're an entire engine.

- **`requestAnimationFrame`** drives both loops, synced to the display's vsync and automatically paused in background tabs. Two subtleties: the timestep is clamped (`Math.min(0.05, ...)`) so a tab resuming after minutes doesn't teleport everything across the screen in one giant frame, and both loops _self-cancel_ when there's nothing to do — Pelican Run's loop ends with `raf = inView && !document.hidden && !idleStill ? requestAnimationFrame(loop) : 0`, and a `kick()` helper restarts it on input, scroll, or visibility. An animation loop that stops when nothing animates costs zero.
- **`IntersectionObserver`** does three jobs across the site: pausing the hero game when it's scrolled away, pausing the footer game until 35% visible, and triggering pelican cameos when a section marked `data-pelican` scrolls into view (with a `WeakSet` so each section fires once). Hit-testing "is this visible" is done by the browser, off your main thread.
- **`ResizeObserver`** fires per-element, after layout, before paint — catching resizes from flex rebalancing and font swaps that `window.resize` never sees. The ATC game debounces it by 120 ms because a resize means regenerating terrain and repainting the whole background layer.
- **Pointer Events with `setPointerCapture`**: once a drag is captured, every subsequent pointer event is retargeted to the canvas, even outside the element or the window — without it, dragging off the canvas edge means the plane stays glued to your cursor forever. `touch-action: none` is applied to the canvas only during play, so the page still scrolls normally otherwise, and touch drags in attract mode are ignored entirely so mobile users don't get ambushed by a game while trying to scroll.
- **`matchMedia(...).addEventListener('change')`** — a `MediaQueryList` is a live event target, so the games subscribe to OS-level dark-mode changes and repaint.
- **`localStorage`**, always wrapped in try/catch, because it throws in private mode and blocked-storage contexts. Best scores and the pelican off-switch live there.
- **`performance.now()`** — a monotonic clock for durations, immune to the system clock jumping.

## Making the most of the browser

Stepping back from games, the principles this codebase follows apply to any modern site.

**The platform is a bigger standard library than most developers think.** Before you install a dependency, check what the browser already ships: the observers above, `<dialog>` and the Popover API, `structuredClone`, `Intl` for formatting, view transitions, container queries, `:has()`, Web Animations, `scrollend`. A surprising amount of "we need a library for that" dissolved over the last five years. The games here needed zero.

**Don't run what nobody sees.** The single biggest performance win in any animated page is not _faster_ code, it's _less running_ code. Gate every loop on visibility, cancel rAF chains when idle, stop entirely in hidden tabs. The pelican scroll rider stops 0.4 seconds after it has nothing to do and wakes on the next scroll event — at rest, it costs nothing.

**Respect user settings as inputs, not as edge cases.** `prefers-reduced-motion` isn't a corner case to bolt on at the end — here it decides the whole architecture of motion: the ATC game renders one static frame of planes on final approach and animates nothing until the player opts in; Pelican Run skips its idle animation. The color-scheme query themes the canvases live. And when the pelicans have an off switch, the choice is stored _and applied before first paint_ by an inline script, so a returning visitor who turned them off never sees a flash of pelican. Preferences your code reads after the fact are suggestions; preferences baked into first paint are respect.

**Keep state in one place and the DOM dumb.** Each game is a single closure holding plain variables — no state library, no reactive graph. The DOM elements around the canvas (score, status line, game-over card) are toggled with `hidden` attributes and text updates; the canvas is repainted wholesale. This is heresy to framework-brain and completely correct for a bounded, frame-driven surface: the render loop _is_ the reactivity.

**Accessibility is part of the engine, not a coat of paint.** Each canvas carries `role="img"` and a label describing what it is; score and status changes go through `aria-live` regions so screen readers hear the game state; every game has full keyboard parity with the pointer path; and the space-bar guard means the game never hijacks the keyboard while you're typing elsewhere. Canvas is invisible to assistive tech by default — the surrounding DOM has to say everything the pixels say.

**Measure it like a product.** Both games emit analytics through a thin wrapper — `atc_game_started`, `pelican_run_ended`, with trigger, duration, new-best flags, and which logo finally got the pelican. The wrapper no-ops when analytics is blocked. If you build delightful things and don't instrument them, you'll never know whether anyone found them.

## The punchline

Both games, the procedural terrain, the scroll rider, and the cameo system together weigh a few kilobytes of TypeScript. No framework renders a single pixel of them. The browser has spent the last decade quietly becoming a capable, deterministic, extremely fast game and graphics runtime — the trick is that almost nobody reads its release notes.

The next time a project feels like it needs one more dependency, try the experiment that built this site: open the MDN page instead of the registry, and see how far the platform alone gets you. You might end up with a pelican.
