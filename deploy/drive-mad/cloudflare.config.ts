import { defineConfig, triggers } from "cf/config";

export default defineConfig({
  accountId: "da93074d729554cb8b947e4fca904c8b",
  worker: {
    name: "drive-mad",
    compatibilityDate: "2026-11-24",
    workersDev: false,
    triggers: [
      triggers.fetch({ pattern: "drive-mad.sully6.com/*", zone: "sully6.com" }),
    ],
  },
});
