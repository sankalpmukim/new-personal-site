// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import fs from "node:fs";
import path from "node:path";

/** Article lastmods from frontmatter; drafts stay out of the sitemap. */
function articleSitemapMeta() {
  const dir = path.join(process.cwd(), "src/content/articles");
  /** @type {Record<string, string>} */
  const lastmod = {};
  /** @type {Set<string>} */
  const drafts = new Set();

  for (const file of fs.readdirSync(dir)) {
    if (!/\.mdx?$/.test(file)) continue;

    const id = file.replace(/\.mdx?$/, "");
    const src = fs.readFileSync(path.join(dir, file), "utf8");

    if (/^draft:\s*true\s*$/m.test(src)) {
      drafts.add(id);
      continue;
    }

    const date = src.match(/^date:\s*["']?(\d{4}-\d{2}-\d{2})/m)?.[1];

    if (date) lastmod[id] = date;
  }

  return { lastmod, drafts };
}

const { lastmod: articleLastmod, drafts: articleDrafts } = articleSitemapMeta();

export default defineConfig({
  site: "https://sankalpmukim.dev",
  trailingSlash: "never",
  integrations: [
    mdx(),
    sitemap({
      // unused namespaces bloat the XML; this site has no news/video/hreflang/image sitemap data
      namespaces: { news: false, xhtml: false, image: false, video: false },
      serialize(item) {
        const slug = item.url.match(/\/articles\/([^/]+)\/?$/)?.[1];

        if (slug && articleDrafts.has(slug)) return undefined;

        if (slug && articleLastmod[slug]) item.lastmod = articleLastmod[slug];

        return item;
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: false,
    },
  },
  // Client bundles are minified. PostHog error tracking fetches these maps from the
  // live site (the source is already public on GitHub) so stack traces unminify.
  vite: {
    build: {
      sourcemap: true,
    },
  },
});
