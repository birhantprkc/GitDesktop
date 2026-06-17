import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// GitHub Pages project site → served at https://thebguy.github.io/GitDesktop/.
// If you later point a custom domain at it, set `base: "/"` and update `site`.
// The site pins Vite 7 (Astro 6 requires it; the desktop app runs Vite 8) — see
// site/package.json — which is also why @tailwindcss/vite works here.
export default defineConfig({
  site: "https://thebguy.github.io",
  // Trailing slash matters: import.meta.env.BASE_URL mirrors this, so
  // `${BASE_URL}favicon.svg` must resolve to `/GitDesktop/favicon.svg`.
  base: "/GitDesktop/",
  vite: {
    plugins: [tailwindcss()],
  },
});
