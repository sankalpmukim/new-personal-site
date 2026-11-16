// PostHog relay: proxies /relay/* to the PostHog US cloud from a same-origin
// path, so tracker blockers that filter third-party analytics hosts still
// reach PostHog. This replaces the rewrites that vercel.json used to perform.
// Everything else on the site is a static asset and never reaches this Worker:
// wrangler.jsonc only routes /relay/* here (assets.run_worker_first).

const RELAY_PREFIX = "/relay/";

const STATIC_PREFIX = "/relay/static/";

const ARRAY_PREFIX = "/relay/array/";

const API_ORIGIN = "https://us.i.posthog.com";

const ASSETS_ORIGIN = "https://us-assets.i.posthog.com";

// Structural stand-in for Cloudflare's `Fetcher` binding, so this file
// typechecks under the DOM lib without @cloudflare/workers-types.
type AssetsBinding = { fetch(request: Request): Promise<Response> };

// Bindings declared in wrangler.jsonc (assets.binding: "ASSETS").
type Env = { ASSETS: AssetsBinding };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Safety net: anything that is not a relay path falls back to static
    // assets (which applies not_found_handling, e.g. the custom 404 page).
    if (!url.pathname.startsWith(RELAY_PREFIX)) return env.ASSETS.fetch(request);

    // vercel.json used three external rewrites; keep their mapping intact:
    //   /relay/static/* -> https://us-assets.i.posthog.com/static/*
    //   /relay/array/*  -> https://us-assets.i.posthog.com/array/*
    //   /relay/*        -> https://us.i.posthog.com/*
    let origin = API_ORIGIN;

    // "/" + rest: /relay/decide -> https://us.i.posthog.com/decide. Without
    // the leading slash the host would parse as us.i.posthog.comdecide.
    let path = "/" + url.pathname.slice(RELAY_PREFIX.length);

    if (url.pathname.startsWith(STATIC_PREFIX)) {
      origin = ASSETS_ORIGIN;
      path = "/static/" + url.pathname.slice(STATIC_PREFIX.length);
    } else if (url.pathname.startsWith(ARRAY_PREFIX)) {
      origin = ASSETS_ORIGIN;
      path = "/array/" + url.pathname.slice(ARRAY_PREFIX.length);
    }

    // Rebuilding the request preserves method, headers and body (posthog-js
    // POSTs batches and arraybuffer payloads here).
    const target = new URL(origin + path + url.search);

    return fetch(new Request(target, request));
  },
};
