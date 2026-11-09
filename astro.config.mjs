// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://sankalpmukim.dev",
  trailingSlash: "never",
  integrations: [mdx(), sitemap()],
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
