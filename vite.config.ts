import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Lia Libras",
        short_name: "Lia",
        description: "Grave sinais de Libras e ajude a treinar um modelo aberto de reconhecimento.",
        lang: "pt-BR",
        display: "standalone",
        start_url: "/",
        background_color: "#eef4f2",
        theme_color: "#0f2e36",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // The service worker must not answer API calls or the Firebase sign-in pages.
        navigateFallbackDenylist: [/^\/api\//, /^\/__\//],
      },
    }),
  ],
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
