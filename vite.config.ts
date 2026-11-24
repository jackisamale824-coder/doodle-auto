import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  base: process.env.RELEASE_ID ? `/releases/${process.env.RELEASE_ID}/` : "/",
  define: { __RELEASE_ID__: JSON.stringify(process.env.RELEASE_ID || "dev") },
  build: {
    rollupOptions: {
      input: { main: "index.html", pool: "pool/index.html" },
      output: {
        manualChunks: {
          three: ["three"],
          physics: ["@dimforge/rapier3d-compat"],
        },
      },
    },
  },
});
