import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src/client",
      filename: "sw.ts",
      registerType: "autoUpdate",
      manifest: {
        name: "Checkbox",
        short_name: "Checkbox",
        description: "Personal task manager",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [],
        shortcuts: [
          { name: "Quick Add", short_name: "Add", url: "/?quickadd=1" },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: { outDir: "dist/client", emptyOutDir: true },
  // In dev, `vite` serves the client and proxies API calls to `wrangler dev` (8787).
  server: { proxy: { "/api": "http://localhost:8787" } },
});
