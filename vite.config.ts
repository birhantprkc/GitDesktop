import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
    babel({ presets: [reactCompilerPreset()] }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Pre-bundle the Shiki diff highlighter and the grammar bundles it imports by
  // subpath, so the dev server resolves them up front (a subpath import added
  // after the server is running otherwise fails until a restart).
  optimizeDeps: {
    include: [
      "@shikijs/langs/astro",
      "@shikijs/langs/gdscript",
      "@shikijs/langs/hcl",
      "@shikijs/langs/json",
      "@shikijs/langs/jsonnet",
      "@shikijs/langs/jsx",
      "@shikijs/langs/prisma",
      "@shikijs/langs/solidity",
      "@shikijs/langs/svelte",
      "@shikijs/langs/terraform",
      "@shikijs/langs/toml",
      "@shikijs/langs/tsx",
      "@shikijs/langs/vue",
      "@shikijs/langs/wgsl",
      "@shikijs/langs/zig",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` & `site` since we don't want to trigger reloads when those files change
      ignored: ["**/src-tauri/**", "**/site/**", "*.md"],
    },
  },
}));
