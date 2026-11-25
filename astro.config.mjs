import { defineConfig } from "astro/config";

// Static build, served by the edge worker (worker/index.ts) through Workers static assets.
export default defineConfig({
  site: "https://travel.zachle.info",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
});
