import { defineConfig, defineContainer, exports } from "cf/config";

import * as entrypoint from "./src/cloudflare.ts" with { type: "cf-worker" };

const gameContainer = defineContainer({
  name: "doodle-auto-game",
  image: { dockerfile: "./Dockerfile" },
  instanceType: "lite",
  maxInstances: 1,
});

export default defineConfig({
  accountId: "a667cabeb7494676d4f8e412b2f6ca30",
  worker: {
    name: "doodle-auto",
    entrypoint,
    compatibilityDate: "2026-11-23",
    domains: ["sully6.com"],
    exports: {
      GameContainer: exports.durableObject({
        storage: "sqlite",
        container: gameContainer,
      }),
    },
  },
  containers: [gameContainer],
});
