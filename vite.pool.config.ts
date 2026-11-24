import { defineConfig } from "vite";

// The subdomain serves only the pool client. Both sites share the game server.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "output/pool-site",
    rollupOptions: { input: "pool/index.html" },
  },
});
