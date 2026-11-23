import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.RELEASE_ID ? `/releases/${process.env.RELEASE_ID}/` : "/",
  define: { __RELEASE_ID__: JSON.stringify(process.env.RELEASE_ID || "dev") },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          physics: ["@dimforge/rapier3d-compat"],
        },
      },
    },
  },
});
