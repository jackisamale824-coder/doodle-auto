#!/usr/bin/env node
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { buildRelease } from "./build-release.mjs";

const root = path.resolve(
  process.env.CONTROL_ROOT ||
    path.join(os.homedir(), ".local/share/doodlescreed"),
);
const endpoint = process.env.CONTROL_URL || "http://127.0.0.1:4180";
const args = process.argv.slice(2);
const command = args.shift() || "status";
const target = args[0] && !args[0].startsWith("--") ? args.shift() : undefined;
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
async function api(route, body) {
  const secret = (
    await readFile(path.join(root, "control.secret"), "utf8")
  ).trim();
  const response = await fetch(`${endpoint}/internal/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`${route}: ${JSON.stringify(result)}`);
  return result;
}
async function lock() {
  await mkdir(root, { recursive: true });
  const directory = path.join(root, "deployment.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(directory);
      await writeFile(
        path.join(directory, "owner.json"),
        JSON.stringify({ pid: process.pid, started: Date.now() }),
      );
      return async () => rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner;
      try {
        owner = JSON.parse(
          await readFile(path.join(directory, "owner.json"), "utf8"),
        );
      } catch {
        if (Date.now() - (await stat(directory)).mtimeMs < 30000)
          throw Error("Another deployment is acquiring the lock");
      }
      if (owner?.pid) {
        try {
          process.kill(owner.pid, 0);
          throw Error(`Deployment locked by PID ${owner.pid}`);
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
  throw Error("Could not acquire deployment lock");
}
async function canary(releaseId, workerId) {
  const origin = process.env.CANARY_ORIGIN;
  if (
    !origin ||
    (new URL(origin).protocol !== "https:" &&
      !(
        args.includes("--local-test") &&
        new URL(origin).protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)
      ))
  )
    throw Error("Set CANARY_ORIGIN to the HTTPS public canary origin");
  if (!workerId) throw Error("Canary requires --worker <workerId>");
  const admission = await api("allocate", {
    type: "create",
    name: "Release canary",
    requestId: randomUUID(),
    workerId,
  });
  if (admission.releaseId !== releaseId)
    throw Error("Canary allocation returned a different release");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).pathname.startsWith(`/releases/${releaseId}/`)
      )
        failures.push(`Asset ${response.status()}: ${response.url()}`);
    });
    await page.addInitScript((admission) => {
      sessionStorage.setItem("dc.pendingAdmission", JSON.stringify(admission));
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(...args) {
          super(...args);
          window.__canarySocket = this;
          this.addEventListener("message", (e) => {
            try {
              const m = JSON.parse(e.data);
              if (m.type === "welcome") window.__canaryWelcome = m;
            } catch {}
          });
        }
      };
    }, admission);
    await page.goto(new URL(admission.clientUrl, origin).href, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    await page.waitForFunction(
      (id) =>
        window.__canaryWelcome?.releaseId === id &&
        document.querySelector("canvas") &&
        document.querySelector("#loading")?.classList.contains("hidden") &&
        document.body.textContent.includes("MATCH READY"),
      releaseId,
      { timeout: 90000 },
    );
    if (failures.length) throw Error(`Browser errors: ${failures.join("; ")}`);
    await page.evaluate(() => {
      window.__canarySocket?.send(JSON.stringify({ type: "leave" }));
      window.__canarySocket?.close();
    });
    const receipt = {
      releaseId,
      workerId,
      origin,
      checkedAt: Date.now(),
      browserCanary: true,
    };
    await api("validate", {
      releaseId,
      workerId,
      report: {
        checks: [
          "public-browser-load",
          "pinned-admission",
          "world-ready",
          "no-browser-errors",
          "release-assets",
        ],
        ...receipt,
        localTest: args.includes("--local-test"),
      },
    });
    await mkdir(path.join(root, "canaries"), { recursive: true });
    await writeFile(
      path.join(root, "canaries", `${releaseId}.json`),
      JSON.stringify(receipt, null, 2),
    );
    return receipt;
  } finally {
    await browser.close();
  }
}
async function promote(releaseId) {
  const receipt = JSON.parse(
    await readFile(path.join(root, "canaries", `${releaseId}.json`), "utf8"),
  );
  if (
    receipt.releaseId !== releaseId ||
    !receipt.browserCanary ||
    Date.now() - receipt.checkedAt > 30 * 60 * 1000
  )
    throw Error(
      "A passing public browser canary less than 30 minutes old is required",
    );
  const expected = option("expected-current");
  if (expected === undefined)
    throw Error(
      "Specify --expected-current <releaseId|none> for atomic promotion",
    );
  return api("promote", {
    releaseId,
    expectedCurrent: expected === "none" ? null : expected,
    deploymentId: option("deployment-id") || randomUUID(),
  });
}
let unlock;
try {
  if (command !== "status") unlock = await lock();
  let result;
  if (command === "status") result = await api("status");
  else if (command === "prepare") {
    if (!target) throw Error("prepare requires releaseId");
    result = await api("prepare", { releaseId: target });
  } else if (command === "canary")
    result = await canary(target, option("worker"));
  else if (command === "promote" || command === "rollback")
    result = await promote(target);
  else if (command === "retire") {
    if (!target) throw Error("retire requires workerId");
    result = await api("retire", { workerId: target });
  } else if (command === "gc") result = await api("gc", {});
  else if (command === "deploy") {
    if (
      !args.includes("--stage-only") &&
      option("expected-current") === undefined
    )
      throw Error(
        "deploy requires --expected-current <releaseId|none> or --stage-only",
      );
    const manifest = await buildRelease({
      releaseRoot: path.join(root, "releases"),
    });
    const prepared = await api("prepare", { releaseId: manifest.releaseId });
    if (prepared.queued || args.includes("--stage-only")) {
      result = {
        ...prepared,
        releaseId: manifest.releaseId,
        pending: true,
        next: prepared.queued
          ? "Generation capacity reached; retry after occupied workers drain."
          : "Staged only; run canary then promote.",
      };
    } else {
      const workerId =
        prepared.workerId || prepared.worker?.workerId || prepared.worker?.id;
      await canary(manifest.releaseId, workerId);
      result = await promote(manifest.releaseId);
    }
  } else
    throw Error(
      "Commands: status, deploy, prepare <releaseId>, canary <releaseId> --worker <workerId>, promote|rollback <releaseId> --expected-current <releaseId|none>, retire <workerId>, gc",
    );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await unlock?.();
}
