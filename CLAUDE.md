# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Package manager is **pnpm**.

- `pnpm dev`: Astro dev server
- `pnpm build`: static build to `dist/`
- `pnpm preview`: serve the built `dist/`
- `pnpm check`: `astro check`, which type-checks `.astro` and `.ts` files with the strict tsconfig
- `pnpm lint`: `oxlint` with the vendored anti-slop plugin (`oxlint.config.ts`)

The repo has no test suite and no formatter. `pnpm check`, `pnpm lint`, plus a build are the verification step. The site deploys to Vercel (`.vercel/` is linked to the `new-personal-site` project).

`pnpm-workspace.yaml` pins `@emnapi/runtime` to 1.11.3 because the 2.0 betas crash `astro check` on Node 26. Leave that override in place when you bump dependencies. Dependency versions are pinned exactly on purpose, and `minimumReleaseAgeExclude` lists the packages that are allowed to bypass pnpm's release-age gate.

## Official documentation

No official agent skills exist for the core stack, so consult the makers' docs when unsure about an API instead of improvising: Astro — https://docs.astro.build; TypeScript — https://www.typescriptlang.org/docs/; MDX — https://mdxjs.com; pnpm — https://pnpm.io; Shiki — https://shiki.style; sharp — https://sharp.pixelplumbing.com; Oxlint — https://oxc.rs/docs/guide/usage/linter.html. (Vercel is covered by the `deploy-to-vercel` and `web-design-guidelines` skills in `.agents/skills/`.)

## Architecture

This is a static Astro 7 site (MDX, RSS and sitemap integrations), deployed at `https://sankalpmukim.dev` with `trailingSlash: 'never'`. It has no UI framework. All interactivity is vanilla TypeScript drawing on `<canvas>`, loaded from `<script>` blocks in `.astro` files.

### Content vs. layout

- **`src/data/site.ts` holds almost all page content**: person and links, nav, the logbook (work history), projects, certifications, uses, photos, the trek `peaks` painted on the charts, and `aiObstacles` for the footer game. To change what the site says, edit this file, not the components.
- **Articles** are Markdown/MDX files in `src/content/articles/`. The schema in `src/content.config.ts` has `title`, `description`, `date` and an optional `draft`. Listings, the home page and RSS filter out `draft: true`, but `src/pages/articles/[slug].astro` does not, so draft articles still get a built page.
- **Article OG images** are static PNGs at `public/og/<article-id>.png`. `[slug].astro` uses that file if it exists and falls back to `/og/default.png` otherwise. They were rendered from a temporary `og-card.astro` page that has since been deleted (it can be recovered from commit `0b6bf88`), so a new article has no generator for its card.
- `src/layouts/Base.astro` owns all SEO metadata: canonical URL, OG/Twitter tags, and a JSON-LD `@graph` with WebSite and Person. Pages pass `title`, `description`, `image`, `type`, `published` and an extra `jsonLd` node.

### Design system: VFR sectional chart

The whole site imitates an aeronautical sectional chart. New pages and sections should stay in that vocabulary.

- Colors are CSS custom properties on `:root` in `src/styles/global.css` (`--paper`, `--tan`, `--ink`, `--magenta`, `--blue`, `--water`, `--beak`, plus the `--pel-*` pelican colors), redefined under `prefers-color-scheme: dark`. **Canvas code reads these at runtime** through `readColors()` in `terrain.ts` and `pelicanPalette()` in `pelican.ts`. A color change in CSS therefore also reaches the canvases, and canvases repaint when the color scheme changes.
- There is one font family, Archivo Variable (self-hosted via Fontsource, imported in `Base.astro`), varied only along its width axis with `font-stretch`. Canvas font strings name `'Archivo Variable'` too.
- Text that sits over a canvas is wrapped in `<span class="halo">` so it stays legible against the terrain.
- Projects render as ATC flight strips (`FlightStrip`, grouped by `StripKind`) and work history renders as a pilot logbook (`Logbook`).

### Canvas scripts (`src/scripts/`)

- `terrain.ts`: shared procedural terrain, built on a seeded `rng`, `drawTerrain`, `drawPeaks` and `fitCanvas`. `ChartBand.astro` uses it for the header band on every inner page (the `seed` prop varies the terrain). The hero game and the OG cards use it as well.
- `atc.ts`: the home-page hero game, where you drag planes to the runway. It is started from `index.astro` once fonts are ready or after a 700 ms timeout, whichever comes first. It exposes a read-only `root.__atc` hook (planes, score, mode and so on) for automated checks.
- `pelican.ts`: draws the pelican on a bicycle and its poses. `pelican-run.ts` (the footer game on every page, via `Footer.astro`) and `pelicans-scroll.ts` both use it.
- `pelicans-scroll.ts`: scroll-progress rider plus cameo appearances. Any element with `data-pelican="cross|peek|wheelie|tumble|drop"` and an optional `data-pelican-says="..."` triggers a cameo when it scrolls into view. Users can turn pelicans off. The choice is stored in `localStorage.pelicans` and applied as `html[data-pelicans="off"]` by an inline script in `Base.astro` before first paint.
- Scripts honor `prefers-reduced-motion`. Every `localStorage` access goes through try/catch wrappers. Keep both patterns.

### Placeholders

Some content is still placeholder, waiting for the owner to fill it in: the trek peak names in `peaks`, the placeholder tiles in `photos`, and the `aiObstacles` logos. Each obstacle has an empty `img`; once an image path is set there, it is drawn instead of the placeholder glyph.
