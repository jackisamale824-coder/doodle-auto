/// <reference types="node" />
import process from "node:process";
import { bindings, defineConfig, defineContainer, exports } from "cf/config";

import * as entrypoint from "./src/cloudflare.ts" with { type: "cf-worker" };

const gameContainer = defineContainer({
  name: "doodle-auto-game",
  image: { dockerfile: "./Dockerfile" },
  instanceType: "basic",
  maxInstances: 3,
});

const workerName = process.env.GAME_WORKER_NAME || "doodle-auto";

export default defineConfig({
  accountId:
    process.env.CLOUDFLARE_ACCOUNT_ID || "a667cabeb7494676d4f8e412b2f6ca30",
  worker: {
    name: workerName,
    entrypoint,
    compatibilityDate: "2026-11-23",
    // The existing sully6.com and www bindings are managed in Cloudflare.
    workersDev: false,
    assets: {
      runWorkerFirst: [
        "/", "/index.html", "/play/*",
        "/pool", "/pool/", "/pool/index.html",
        "/drive-mad", "/drive-mad/", "/drive-mad/index.html",
      ],
    },
    env: {
      ASSETS: bindings.assets(),
      GAME: bindings.durableObject({ worker: workerName, exportName: "GameContainer" }),
      GOOGLE_CLIENT_ID: bindings.text(process.env.GOOGLE_CLIENT_ID || ""),
    },
    exports: {
      GameContainer: exports.durableObject({
        storage: "sqlite",
        container: gameContainer,
      }),
    },
  },
  containers: [gameContainer],
});
