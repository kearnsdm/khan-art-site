import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";

export default defineConfig({
  site: "https://nicholaskhan.com",
  output: "server",
  adapter: netlify(),
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
});
