/// <reference types="node" />
import process from "node:process";
import { bindings, defineConfig, defineContainer, exports } from "cf/config";

import * as entrypoint from "./src/cloudflare.ts" with { type: "cf-worker" };

const gameContainer = defineContainer({
  name: "doodle-auto-game",
  image: { dockerfile: "./Dockerfile" },
  instanceType: "lite",
  maxInstances: 1,
});

const workerName = process.env.GAME_WORKER_NAME || "doodle-auto";

export default defineConfig({
  accountId:
    process.env.CLOUDFLARE_ACCOUNT_ID || "a667cabeb7494676d4f8e412b2f6ca30",
  worker: {
    name: workerName,
    entrypoint,
    compatibilityDate: "2026-11-23",
    domains: ["sully6.com", "www.sully6.com"],
    env: { GAME: bindings.durableObject({ worker: workerName, exportName: "GameContainer" }) },
    exports: {
      GameContainer: exports.durableObject({
        storage: "sqlite",
        container: gameContainer,
      }),
    },
  },
  containers: [gameContainer],
});
