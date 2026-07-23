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
        theme_color: "#0b1120",
        background_color: "#0b1120",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          { name: "Add task", short_name: "Add", url: "/?quickadd=1" },
          { name: "Today", short_name: "Today", url: "/today" },
        ],
        // Android share sheet -> GET /share?title&text&url -> instant Backlog
        // capture through the NLP parser (SharePage).
        share_target: {
          action: "/share",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: { "@": new URL("./src/client", import.meta.url).pathname },
  },
  build: { outDir: "dist/client", emptyOutDir: true },
  // In dev, `vite` serves the client and proxies API calls to `wrangler dev` (8787).
  server: { proxy: { "/api": "http://localhost:8787" } },
});
