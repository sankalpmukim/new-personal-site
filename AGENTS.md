# AGENTS.md

Personal site (sankalpmukim.dev): fully static Astro 7 site, TypeScript, pnpm. No UI framework — all interactivity is vanilla TypeScript drawing on `<canvas>`. Deploys via Vercel (project link lives in gitignored `.vercel/`); there are no CI workflows or tests in this repo. Lint with Oxlint plus the vendored anti-slop plugin. Format with Oxfmt. `CLAUDE.md` carries the same guidance for Claude Code — keep both in sync when changing conventions.

## Commands

- `pnpm install` — setup. Use pnpm, not npm/yarn (lockfile is `pnpm-lock.yaml`).
- `pnpm dev` — dev server.
- `pnpm build` — production build to `dist/`.
- `pnpm check` — `astro check`; typechecks `.astro` and `.ts` files. Run it after every change.
- `pnpm lint` — `oxlint` with the vendored anti-slop plugin (`oxlint.config.ts`). Run it after every change.
- `pnpm fmt` — write Oxfmt output (`oxfmt.config.ts`).
- `pnpm fmt:check` — detect files that are not formatted. Run it after every change.

## Official documentation

No official agent skills exist for the core stack, so consult the makers' docs when unsure about an API instead of improvising: Astro — https://docs.astro.build; TypeScript — https://www.typescriptlang.org/docs/; MDX — https://mdxjs.com; pnpm — https://pnpm.io; Shiki — https://shiki.style; sharp — https://sharp.pixelplumbing.com; Oxlint — https://oxc.rs/docs/guide/usage/linter.html; Oxfmt — https://oxc.rs/docs/guide/usage/formatter.html. (Vercel is covered by the `deploy-to-vercel` and `web-design-guidelines` skills in `.agents/skills/`.)

## Do not "clean up" pnpm-workspace.yaml

It is not a monorepo workspace; it exists only for dependency overrides:

- `@emnapi/runtime` is pinned to 1.11.3 because 2.0 betas crash on Node 26 and break `astro check` (`bridge.deleteEnv is not a function`).
- `minimumReleaseAgeExclude` lists the exact-pinned Astro packages; keep entries in sync when bumping those pins. Dependency versions are pinned exactly on purpose.

## Content model

- `src/data/site.ts` is the single source for all structured content: person, links, nav, projects, certifications, uses page, gallery photos, trek peaks, pelican-game obstacles. Edit data there, not in layouts/components.
- Articles are markdown files in `src/content/articles/`; schema (`title`, `description`, `date`, optional `draft`) is in `src/content.config.ts`. The filename is the slug.
- Draft quirk: `draft: true` hides an article from `/articles` and the RSS feed, but `[slug].astro` does NOT filter drafts, so the page still builds and stays reachable at its URL.
- OG cards are pre-generated PNGs at `public/og/<article-id>.png` with silent fallback to `public/og/default.png` — there is no generator script on the branch. The temporary `og-card.astro` page that rendered them was deleted; recover it from commit `0b6bf88` when a new article needs a card. Per-article assets go in `public/articles/<slug>/`.

## Design system: VFR sectional chart

The whole site imitates an aeronautical sectional chart — new pages and sections should stay in that vocabulary (projects are ATC flight strips, work history is a pilot logbook).

- Colors are CSS custom properties on `:root` in `src/styles/global.css`, redefined under `prefers-color-scheme: dark`. Canvas code reads them at runtime via `readColors()` (terrain.ts) and `pelicanPalette()` (pelican.ts), so a CSS color change also reaches the canvases, and canvases repaint on color-scheme changes.
- One font family: Archivo Variable (self-hosted via Fontsource, imported in `Base.astro`), varied only along its width axis with `font-stretch`. Canvas font strings also name `"Archivo Variable"`.
- Text sitting over a canvas is wrapped in `<span class="halo">` to stay legible against the terrain.

## Canvas scripts (`src/scripts/`)

- `terrain.ts` — shared seeded procedural terrain (`drawTerrain`, `drawPeaks`, `fitCanvas`, `readColors`). `ChartBand.astro` uses it for every inner page's header; its `seed` prop varies the terrain.
- `atc.ts` — the home-page hero game (drag planes to the runway). Started from `index.astro` once fonts are ready or after a 700 ms timeout, whichever comes first. Exposes a read-only `root.__atc` hook (planes, score, mode) for automated checks.
- `pelican.ts` / `pelican-run.ts` / `pelicans-scroll.ts` — the pelican art and the footer game (`Footer.astro`); scroll cameos trigger on any element with `data-pelican="cross|peek|wheelie|tumble|drop"` and optional `data-pelican-says="..."`.
- Patterns every script keeps, and new code must too: honor `prefers-reduced-motion`, wrap every `localStorage` access in try/catch, and read the pelicans off-switch (`localStorage.pelicans === 'off'`, applied as `html[data-pelicans="off"]` by an inline script in `Base.astro` before first paint).

## Analytics (PostHog)

- `src/components/PostHog.astro` holds the official inline snippet and `posthog.init` config, rendered in the `<head>` of `Base.astro`. It covers product and web analytics, session replay (canvas recording on, because most of the site is canvas), heatmaps, dead clicks, web vitals, copy events and exception autocapture. Super properties `color_scheme`, `reduced_motion` and `pelicans` are registered in `loaded`, so they are on every event, including the first `$pageview`.
- Env vars: `PUBLIC_POSTHOG_PROJECT_TOKEN`, `PUBLIC_POSTHOG_HOST` and the optional `PUBLIC_POSTHOG_UI_HOST` (see `.env.example`). With no token the snippet is skipped and nothing is sent. Vercel sets them for **Production only**, so preview deploys do not track.
- `vercel.json` proxies `/relay/*` to PostHog US so tracker blockers leave it alone, and production uses `PUBLIC_POSTHOG_HOST=/relay`. The rewrites use the regex `(.*)` form on purpose: `:path*` does not match the trailing-slash endpoints (`/e/`, `/flags/`, `/s/`) that posthog-js calls.
- Custom events go through `track()` / `registerProps()` / `captureException()` / `addExceptionStep()` in `src/scripts/analytics.ts`, never `window.posthog` directly. The wrappers are no-ops without PostHog and swallow errors. Event names are snake_case `object_verb`: `atc_game_started|stopped|ended`, `pelican_run_started|ended`, `pelican_display_toggled`, `article_finished`, `page_not_found`, and the delegated link events `resume_downloaded`, `contact_link_clicked`, `project_link_clicked`, `outbound_link_clicked`, `rss_link_clicked`. When you add a feature, add its event the same way. Canvas and game boot goes through `runGuarded()` so handled throws still become `$exception` events with a `surface` property. Game starts also call `addExceptionStep()`. Production builds emit JS source maps (`vite.build.sourcemap`) so PostHog can unminify stack traces from the live site.

## Conventions

- Conventional commits (`feat:`, `fix:`, `chore:`, `perf:`) directly on `main`.
- `astro.config.mjs` sets `trailingSlash: 'never'` — link to pages without trailing slashes. RSS is at `/rss.xml` (also `/rss/feed.xml`), sitemap via the sitemap integration.
- Code blocks use Shiki dual themes (github-light/github-dark) configured globally; plain fenced blocks render both modes automatically, don't hand-style syntax highlighting.
