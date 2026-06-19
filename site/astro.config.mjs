import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Served on Cloudflare Pages at the apex domain https://gitdesktop.app/.
// (Previously GitHub Pages at https://thebguy.github.io/GitDesktop/ — if you
// move back, set `site: "https://thebguy.github.io"` and `base: "/GitDesktop/"`.)
// The site pins Vite 7 (Astro 6 requires it; the desktop app runs Vite 8) — see
// site/package.json — which is also why @tailwindcss/vite works here.
export default defineConfig({
  site: "https://gitdesktop.app",
  // import.meta.env.BASE_URL mirrors this, so `${BASE_URL}favicon.svg`
  // resolves to `/favicon.svg` at the domain root.
  base: "/",
  vite: {
    plugins: [tailwindcss()],
  },
});
