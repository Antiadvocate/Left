import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base: "./" makes every asset path relative, so the build works whether it's
// served from a user/org root (user.github.io) OR a project subpath
// (user.github.io/weft/). No config needed per-repo.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", chunkSizeWarningLimit: 1200 },
});
