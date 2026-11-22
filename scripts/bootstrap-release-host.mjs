#!/usr/bin/env node
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const releaseId = option("release");
const root = path.resolve(
  process.env.CONTROL_ROOT ||
    path.join(os.homedir(), ".local/share/doodlescreed"),
);
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitRoot = path.join(os.homedir(), ".config/systemd/user");
const dry = args.includes("--dry-run");
function systemctl(...command) {
  const result = spawnSync("systemctl", ["--user", ...command], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw Error(`systemctl ${command.join(" ")}: ${result.stderr}`);
  return result.stdout;
}
function removeLegacyDependency(text) {
  return text
    .split("\n")
    .map((line) =>
      /^(Wants|Requires|After)=/.test(line)
        ? line.split("=")[0] +
          "=" +
          line
            .slice(line.indexOf("=") + 1)
            .split(/\s+/)
            .filter((name) => name !== "doodlescreed.service")
            .join(" ")
        : line,
    )
    .join("\n");
}
try {
  if (args.includes("--cutover"))
    throw Error(
      "This script is setup-only. Guarded legacy-to-gateway cutover is a separate operation.",
    );
  if (!releaseId || !/^[a-f0-9]{16,64}$/.test(releaseId))
    throw Error(
      "Usage: bootstrap-release-host.mjs --release RELEASE_ID [--dry-run] [--no-prepare]",
    );
  if (/\s/.test(root))
    throw Error(
      "CONTROL_ROOT must not contain whitespace (gateway configuration path constraint)",
    );
  const artifact = path.join(root, "releases", releaseId);
  const manifest = JSON.parse(
    await readFile(path.join(artifact, "manifest.json"), "utf8"),
  );
  if (manifest.releaseId !== releaseId)
    throw Error("Manifest release identity mismatch");
  const entry = path.join(artifact, "control/index.mjs");
  await access(entry);
  const nginx =
    process.env.NGINX_BIN ||
    path.join(os.homedir(), ".local/lib/doodlescreed-nginx/usr/sbin/nginx");
  await access(nginx);
  const controlPort = Number(process.env.CONTROL_PORT || 4180),
    gatewayPort = Number(process.env.GATEWAY_PORT || 4173);
  if (
    ![controlPort, gatewayPort].every(
      (n) => Number.isInteger(n) && n > 1024 && n < 65536,
    )
  )
    throw Error("Invalid control or gateway port");
  const env = `CONTROL_ENTRY=${entry}\nCONTROL_ROOT=${root}\nRELEASE_ROOT=${root}/releases\nCONTROL_PORT=${controlPort}\nGATEWAY_PORT=${gatewayPort}\nNGINX_BIN=${nginx}\nSUPERVISOR=systemd\n`;
  const active =
    spawnSync("systemctl", [
      "--user",
      "is-active",
      "--quiet",
      "doodlescreed-control.service",
    ]).status === 0;
  let oldEnv;
  try {
    oldEnv = await readFile(path.join(root, "control.env"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (active && oldEnv !== env)
    throw Error(
      "Control is already active with a different environment. Reconcile its immutable entry separately before rerunning setup.",
    );
  const writes = [];
  for (const name of [
    "doodlescreed-worker@.service",
    "doodlescreed-control.service",
    "doodlescreed-gateway.service",
  ]) {
    const text = (await readFile(path.join(source, "deploy", name), "utf8"))
      .replaceAll("%h/.local/share/doodlescreed", root)
      .replaceAll("%h/.local/lib/doodlescreed-nginx/usr/sbin/nginx", nginx);
    writes.push([path.join(unitRoot, name), text]);
  }
  writes.push([path.join(root, "control.env"), env]);
  for (const name of [
    "doodlescreed-tunnel.service",
    "doodlescreed-public.service",
  ]) {
    const file = path.join(unitRoot, name);
    try {
      const original = await readFile(file, "utf8");
      const next = removeLegacyDependency(original);
      if (next !== original) writes.push([file, next]);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (dry) {
    console.log(
      JSON.stringify(
        {
          setupOnly: true,
          releaseId,
          writes: writes.map(([name]) => name),
          actions: [
            "daemon-reload",
            "start control",
            ...(args.includes("--no-prepare") ? [] : ["prepare candidate"]),
          ],
        },
        null,
        2,
      ),
    );
  } else {
    for (const directory of [
      root,
      unitRoot,
      path.join(root, "workers"),
      path.join(root, "gateway"),
    ])
      await mkdir(directory, { recursive: true });
    for (const [file, text] of writes)
      await writeFile(file, text, { mode: 0o600 });
    systemctl("daemon-reload");
    systemctl("start", "doodlescreed-control.service");
    const deadline = Date.now() + 30000;
    let secret, last;
    while (Date.now() < deadline) {
      try {
        secret = (
          await readFile(path.join(root, "control.secret"), "utf8")
        ).trim();
        const response = await fetch(
          `http://127.0.0.1:${controlPort}/internal/status`,
          {
            headers: { Authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(2000),
          },
        );
        if (response.ok) {
          last = await response.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!last) throw Error("Control did not become ready within 30 seconds");
    let prepared = null;
    if (!args.includes("--no-prepare")) {
      const response = await fetch(
        `http://127.0.0.1:${controlPort}/internal/prepare`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ releaseId }),
          signal: AbortSignal.timeout(120000),
        },
      );
      prepared = await response.json();
      if (!response.ok)
        throw Error(
          `Candidate preparation failed: ${JSON.stringify(prepared)}`,
        );
    }
    console.log(
      JSON.stringify(
        {
          setupOnly: true,
          releaseId,
          prepared,
          next: "Legacy and tunnel processes remain running. Gateway has not been started. Perform guarded empty-legacy cutover separately, then public canary and promotion.",
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
