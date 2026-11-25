import { defineConfig } from "astro/config";

// Static build, served by the edge worker (worker/index.ts) through Workers static assets.
export default defineConfig({
  site: "https://travel.zachle.info",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  // MapLibre is one lazy chunk (about 210 KB gzipped); the warning is expected.
  vite: { build: { chunkSizeWarningLimit: 900 } },
});
