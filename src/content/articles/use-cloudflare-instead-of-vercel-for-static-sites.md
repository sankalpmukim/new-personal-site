---
title: "Use Cloudflare instead of Vercel for static sites"
description: "My fully static site had terrible web vitals on Vercel and great web vitals on Cloudflare. This is the full investigation: PostHog numbers, curl forensics, official docs from both platforms, one bug I shipped and fixed, and a decision framework for which one your project should use."
date: 2026-11-16
---

> A static site has no server, yet my first contentful paint sometimes took **4.3 seconds**, and once **34 seconds**. This is the story of chasing that fishy number through PostHog, curl, Vercel's CDN internals, and Cloudflare's Workers runtime, and why this site now runs on Cloudflare. Spoiler: it was never cold starts. It was the cache.

**The headline:** a 100% prerendered Astro site on Vercel's free tier, served from a CDN, with zero serverless functions, was slow for the first person to visit each page after each deploy. First contentful paint crossed 2.5 seconds on three of nine days. That first person was almost always me. Moving the exact same static files to Cloudflare Workers (also free) fixed the pattern. The interesting part is the reason: it's architectural, not incidental, and it'll help you pick correctly for your own project.

## The setup

I recently rewrote this entire website. It used to be a Next.js project with all the JavaScript that implies. It's now a fully static Astro site: every page prerendered to plain HTML at build time, interactivity done in vanilla TypeScript painting on `<canvas>`. The whole site is styled like an aeronautical sectional chart, and the hero is a little air-traffic-control game. No SSR. No API routes. No framework runtime. `astro build` emits HTML and some hashed `/_astro/*.js` files, and that's it.

Along with the rewrite I wired up PostHog properly, web vitals autocapture included. If you're going to rebuild a site around performance, you should measure it. PostHog records `$web_vitals` events with first contentful paint (FCP), largest contentful paint (LCP), interaction to next paint (INP), and cumulative layout shift (CLS) values. You can pull percentiles straight out of them with SQL.

For nine days, the numbers were unremarkable, with one glaring exception.

## Act 1: the fishy number

Here are the daily p75s from PostHog for the first week and a half of the new site, hosted on Vercel's free (Hobby) tier:

| Date       | LCP p75 | FCP p75     | INP p75 | CLS p75 |
| ---------- | ------- | ----------- | ------- | ------- |
| Nov 7      | 817 ms  | 930 ms      | 48 ms   | 0       |
| Nov 8      | 1039 ms | 1732 ms     | 88 ms   | 0.004   |
| Nov 9      | 896 ms  | 900 ms      | 40 ms   | 0.003   |
| Nov 10     | 838 ms  | 1308 ms     | 88 ms   | 0       |
| Nov 11     | 2455 ms | 1156 ms     | 40 ms   | 0       |
| Nov 12     | 928 ms  | 1228 ms     | 32 ms   | 0.013   |
| **Nov 13** | 761 ms  | **4298 ms** | 116 ms  | no data |
| **Nov 14** | 580 ms  | **2582 ms** | 80 ms   | 0       |
| **Nov 15** | no data | **3177 ms** | no data | no data |

Look at INP and CLS: good, the whole time. The interactive canvas game responds in double-digit milliseconds. Layout never shifts. The rewrite itself was fast.

Now look at FCP starting **November 13**: two and a half to four and a third **seconds** to first paint. On a static site. Drilling into per-page numbers for that day made it worse:

```text
day         path  n   fcp_p50  fcp_p75  fcp_max
2026-11-13  /     7   2288    4298     7211
```

The home page, 15 KB of HTML pointing at a CDN, had a median first paint of 2.3 seconds and a worst case of 7.2. On migration day itself, one `/projects` visit measured **34,030 ms**. Thirty-four seconds to first paint. Once.

Two things made this fishy:

1. **It correlated with deploys.** Commits landed Nov 12 at 14:27 and Nov 13 at 01:31. FCP crossed 2.5 seconds on Nov 13 and stayed high, because the site gets 8 to 66 pageviews a day. Almost every real visit hit a freshly reset cache.
2. **Repeat visits were always fast.** Same pages, same device, same network: second load snappy, first load glacial, page by page.

A static site whose slowness resets per page after a deploy and disappears on the second visit isn't slow because of JavaScript, images, or the framework. It's slow **before the HTML arrives**. So I went looking at the network.

## Act 2: the diagnosis, not cold starts

Everyone's first theory, including mine, was _cold starts_. Right instinct, wrong target. Here's the thing I had to verify first:

```bash
$ vercel inspect sankalpmukim.dev
  Builds
    ╶ .        [0ms]
```

That's the entire production deployment: **zero functions**. No serverless, no edge middleware, no SSR. The deployment API reports `builds: []` and `perimeters: []`. A cold start is your code booting on a server somewhere. There is no code. There is nothing to boot. Static files are served from Vercel's edge network; functions are what cold start, and I didn't have any.

So I curled the site from my own machine (Hyderabad, India, Jio fiber) and read the response headers:

```http
HTTP/2 200
cache-control: public, max-age=0, must-revalidate
x-vercel-cache: HIT
age: 1710
x-vercel-id: bom1::…
```

Three facts hide in those headers:

1. **`x-vercel-cache`** tells you whether Vercel's CDN served the page from its cache. Hit the same page twice and you can watch `MISS` become `HIT`, permanently, for that page, at that point of presence (PoP), **for that deployment**.
2. **`age: 1710`** means the cached copy was 28.5 minutes old. On pages with single-digit daily traffic, a cache entry that ages out after tens of minutes makes most visits misses, even without deploys.
3. **`x-vercel-id: bom1`** means I'm served from Vercel's Mumbai PoP, the nearest one to me. My cache lives or dies in exactly one region.

Then I timed it. Same command, seconds apart:

| Request                 | Result                                     |
| ----------------------- | ------------------------------------------ |
| `/projects`, first hit  | `x-vercel-cache: MISS`, TTFB **480 ms**    |
| `/projects`, second hit | `x-vercel-cache: HIT`, TTFB **207 ms**     |
| `/gallery`, first hit   | `x-vercel-cache: MISS`, TTFB **604 ms**    |
| `/gallery`, second hit  | `x-vercel-cache: HIT`, TTFB **250 ms**     |
| One bad moment          | TLS handshake alone: **880 ms**            |
| One worst case          | Connection that never completed: **30.1s** |

That last one matches the 34-second PostHog outlier. The occasional total connection stall to `bom1` from my ISP is the tail latency; the steady-state MISS penalty is the median. Vercel's documentation confirms the structural part: Vercel scopes cached responses to the deployment that produced them, so **every deploy re-freezes every page at every PoP**, and the first visitor to each page pays the origin fetch. On a personal site, the first visitor is you.

So: not cold starts. **Cold caches.** Plus a side order of flaky network paths between my ISP and Vercel's single nearby PoP, which no header config can fix.

To be fair to Vercel, I ran their own optimization tooling (`vercel-optimize`, Vercel's official audit skill) against the project. It confirmed zero functions, confirmed the cache behavior, and offered zero platform recommendations. On the free tier there is genuinely no knob for this. Warming the cache from CI doesn't help either: CI runners live in the US, and they'd warm the US PoP's cache, not Mumbai's.

## Act 3: how the two platforms work

What convinced me to move wasn't marketing benchmarks. It was reading both platforms' docs side by side and finding three architectural differences that exactly explain the symptoms.

### Vercel: a deployments model with a per-deployment cache

Vercel's unit of existence is the **deployment**. Every build produces an immutable deployment with its own static storage, and the CDN caches in front of it are keyed to that deployment. The sequence for a static page on a cache miss: PoP checks its cache, misses, then fetches from the deployment's storage. Hits are fast.

The model is built for teams shipping previews and server-side rendering, where every deploy genuinely is a new artifact worth caching separately, and it's good at that job. For a static personal site with a single-region audience, per-deployment scoping plus 28.5-minute eviction plus one nearby PoP means your median visit is a miss.

### Cloudflare: versioned asset manifests on a denser network

Cloudflare Workers static assets work differently. Each deploy is a **Worker version** with an asset manifest mapping paths to files, and assets are cached **per file**. The docs explicitly bless content-hashed filenames: unchanged files keep their cache entries across versions, because the manifest still maps to the same underlying object. My `/_astro/Nav.1TNAq0QN.css` doesn't re-fetch in every city on every deploy because I fixed a typo in an article. Only changed files, which are the same-path HTML pages, take a first fetch per location. Those are backfilled through Cloudflare's tiered cache from a nearby datacenter rather than a single origin region.

Cloudflare's network page lists **348 cities, including 22 in India**: Hyderabad (where I sit), Mumbai, Delhi NCR, Bangalore, Chennai, Kolkata, Pune, and more. Vercel routes me to one of them; Cloudflare anycasts me into whichever is closest.

And the cold-start question, for completeness: Workers that do run compute (I kept one, more below) execute in V8 isolates, which Cloudflare's docs describe as starting "around a hundred times faster than a Node process on a container". Their engineering blog pegs isolate starts at about 5 ms, against 500 ms to 10 s for container-based serverless. My deploy output said it plainly: `Worker Startup Time: 1 ms`. The deeper point stands regardless: on both platforms my pages never touch compute at all. Cloudflare's docs put it best: if a request matches a file in the assets directory, that file is served "without invoking Worker code".

### Free tier, side by side

What actually mattered to me, on $0/month:

|                              | Vercel Hobby                      | Cloudflare Workers Free                 |
| ---------------------------- | --------------------------------- | --------------------------------------- |
| Static page requests         | Free, 100 GB/mo bandwidth         | **Free and unlimited**                  |
| Asset storage                | Free                              | Free, 20,000 files/version, 25 MiB/file |
| Compute (if any)             | Functions cold start (containers) | ~5 ms isolate starts; 100k requests/day |
| PoPs near me                 | 1 (Mumbai)                        | 22 in India, including Hyderabad        |
| Cache invalidation on deploy | **All pages, all PoPs**           | Only changed files                      |
| Per-PoP eviction             | Observed 28.5 minutes             | Tiered cache backfill                   |

For a static site with an Indian audience on $0/month, that table is the decision.

## The migration, and the three gotchas

Moving was small work, since the site was already 100% static: no Astro adapter, no SSR port. Four files:

```jsonc
// wrangler.jsonc
{
  "name": "new-personal-site",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-11-16",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "html_handling": "drop-trailing-slash",
    "run_worker_first": ["/relay/*"],
  },
}
```

Plus a `public/_headers` file (immutable caching for `/_astro/*`), a `public/_redirects` file (the legacy 301s), and a 40-line Worker that proxies `/relay/*` to PostHog US so tracker blockers can't kill my analytics. `run_worker_first` routes `/relay/*` to the Worker, making it the only request path that ever executes code. DNS cutover was two steps: orange-cloud the apex CNAME, attach a Workers route. Rollback is one step: remove the route.

The three gotchas, all documented, none obvious:

1. **Trailing slashes.** Astro's default build emits `dist/about/index.html`, and Cloudflare's default `html_handling` is `auto-trailing-slash`, which would 307 `/about` to `/about/` and quietly break my canonical URLs (`trailingSlash: 'never'`). You need `"html_handling": "drop-trailing-slash"` explicitly.
2. **Immutable caching is not automatic.** Vercel serves hashed build output with a one-year immutable cache header out of the box. Cloudflare's default for static assets is `public, max-age=0, must-revalidate`. Cloudflare's own Vercel-migration guide tells you to add a `_headers` file to restore it. Without that, you'd trade one revalidation problem for another.
3. **I shipped a bug that production testing caught.** My relay Worker built URLs like `origin + path`, and the fallback branch dropped the leading slash: `/relay/decide` became `https://us.i.posthog.comdecide`. Locally that surfaced as an opaque miniflare "internal error". In production it was a Cloudflare 530 page whose title, `Origin DNS error | us.i.posthog.comdecide`, named the bug verbatim. One character. This is why you curl production after every migration step.

One honest disappointment: from my Jio connection, Cloudflare currently routes me to **Singapore**, not Hyderabad. Routing from Indian ISPs to Cloudflare shifts over time. My raw TTFB is now 270 to 520 ms, against Vercel's 200 to 320 ms when its cache was warm. The win isn't a closer PoP for me today. The win is that deploys no longer reset the cache for every page in every city, and unchanged assets stay cached indefinitely. The structural problem is gone even where the network path is mediocre.

## The results

Migration day, same pages, same machine, PostHog FCP medians:

|                       | Before (Vercel, Nov 13–15)               | After (Cloudflare, Nov 16) |
| --------------------- | ---------------------------------------- | -------------------------- |
| `/` FCP               | p50 2,288 ms, p75 4,298 ms, max 7,211 ms | p50 **318 ms**             |
| `/about` FCP          | no data                                  | p50 **430 ms**             |
| `/certifications` FCP | no data                                  | p50 **676 ms**             |
| Worst outlier         | 34,030 ms                                | 1,647 ms                   |

Small samples, one day, your mileage will vary. The first-visit-slow pattern is structurally gone: the cache isn't scoped per deployment anymore, and nothing on the request path can cold start. Every page, first visit or not, is served without invoking Worker code. The deploy pipeline runs `check + lint + fmt + build + wrangler deploy` on push in about 38 seconds, and `wrangler deploy` reports `Worker Startup Time: 1 ms` for the one piece of compute I kept.

## When you should pick which

None of this makes Vercel a bad platform. It makes it the wrong default for this specific shape of project. The decision rule I'd give you:

**Choose Vercel when you're deploying an app, not files.** If you have SSR, ISR, partial prerendering, API routes, auth, or image optimization, or you want per-PR preview deployments with real server compute, Vercel's deployment model is built for exactly that. The Next.js and Astro integrations are superb, and paying nothing for it on Hobby is generous. Per-deployment cache scoping is a non-issue when traffic re-warms caches in seconds or when pages render on demand anyway.

**Choose Cloudflare when you're shipping static files to a global or non-US audience.** Static asset requests are free and unlimited on every plan, the network has PoPs in 348 cities, unchanged assets survive deploys, nothing ever cold starts, and if you do need compute, isolates start in single-digit milliseconds. The trade-offs: caching headers are your job (`_headers`), routing config is your job (`html_handling`, `not_found_handling`), the observability story is thinner than Vercel's, and free-tier `run_worker_first` traffic returns 429s instead of asset fallbacks once you cross 100k requests/day.

For a personal static site, the choice was clear. For your app, it might go the other way. Now you know which questions to ask:

- Does every deploy invalidate every page in every region?
- Does my page-load path ever execute code?
- Where, physically, does my one cache live?

Ask those before the fishy number shows up in your analytics.
