// Thin wrapper over the PostHog snippet in components/PostHog.astro. window.posthog is a
// queueing stub until the SDK loads, and it is absent when PostHog is not configured.
// Analytics must never break the page, so every call here is optional and guarded.
import { links } from "../data/site";

export type EventProps = Record<string, string | number | boolean | null>;

type PostHogClient = {
  capture(event: string, properties?: EventProps): void;
  register(properties: EventProps): void;
};

declare global {
  interface Window {
    posthog?: PostHogClient;
  }
}

export function track(event: string, properties?: EventProps) {
  try {
    window.posthog?.capture(event, properties);
  } catch {
    /* never let analytics break the page */
  }
}

// super properties, sent with every later event
export function registerProps(properties: EventProps) {
  try {
    window.posthog?.register(properties);
  } catch {
    /* never let analytics break the page */
  }
}

// seconds since `start` (a performance.now() reading), to one decimal place
export function secondsSince(start: number) {
  return Math.round((performance.now() - start) / 100) / 10;
}

const CONTACT_CHANNELS = new Map([
  [links.email, "email"],
  [links.github, "github"],
  [links.linkedin, "linkedin"],
  [links.twitter, "twitter"],
  [links.instagram, "instagram"],
]);

// where on the page a link sits, so the same destination can be compared across placements
function placementOf(a: Element) {
  if (a.closest(".site-nav")) return "nav";

  if (a.closest(".site-footer")) return "footer";

  if (a.closest(".facts")) return "home_facts";

  if (a.closest(".prose")) return "article_body";

  if (a.closest(".strip")) return "project_strip";

  const section = a.closest("section[aria-labelledby]")?.getAttribute("aria-labelledby");

  return section ? section.replace(/-title$/, "") : "page";
}

function onLinkClick(e: MouseEvent) {
  // auxclick also fires for right clicks; only a middle click opens the link
  if (e.type === "auxclick" && e.button !== 1) return;

  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;

  if (!(a instanceof HTMLAnchorElement)) return;

  const href = a.getAttribute("href") ?? "";
  const placement = placementOf(a);
  const text = (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const channel = CONTACT_CHANNELS.get(href);
  const strip = a.closest<HTMLElement>(".strip");

  if (href === links.resume) {
    track("resume_downloaded", { placement });
  } else if (href === links.rss) {
    track("rss_link_clicked", { placement });
  } else if (channel) {
    track("contact_link_clicked", { channel, placement });
  } else if (strip) {
    track("project_link_clicked", {
      project: strip.dataset.project ?? null,
      project_kind: strip.dataset.kind ?? null,
      link_label: text,
      is_primary_link: a.closest("h3") !== null,
      url: a.href,
    });
  } else if (/^https?:$/.test(a.protocol) && a.host !== location.host) {
    track("outbound_link_clicked", { url: a.href, host: a.host, link_text: text, placement });
  }
}

// named events for links that matter: résumé, contact, projects, outbound. Plain internal
// navigation is already covered by $pageview and autocapture.
export function initLinkTracking() {
  document.addEventListener("click", onLinkClick, { capture: true, passive: true });
  document.addEventListener("auxclick", onLinkClick, { capture: true, passive: true });
}
