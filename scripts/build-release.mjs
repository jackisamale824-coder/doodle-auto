import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
  chmod,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const hash = (value) => createHash("sha256").update(value).digest("hex");
async function inventory(root, relative = "") {
  const result = [];
  for (const entry of (
    await readdir(path.join(root, relative), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...(await inventory(root, name)));
    else result.push([name, hash(await readFile(path.join(root, name)))]);
  }
  return result;
}
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`${command} failed:\n${result.stdout}\n${result.stderr}`);
}
export async function buildRelease({
  sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  releaseRoot = process.env.RELEASE_ROOT ||
    path.join(os.homedir(), ".local/share/doodlescreed/releases"),
} = {}) {
  releaseRoot = path.resolve(releaseRoot);
  if (
    releaseRoot === sourceRoot ||
    releaseRoot.startsWith(sourceRoot + path.sep)
  )
    throw new Error("Release root must be outside source checkout");
  await mkdir(releaseRoot, { recursive: true });
  const staging = await mkdtemp(path.join(releaseRoot, ".build-"));
  const snapshot = path.join(staging, "source");
  try {
    await mkdir(snapshot);
    // These are all executable/build inputs; docs, tests and checkout metadata are not runtime inputs.
    for (const name of [
      "src",
      "server",
      "public",
      "scripts",
      "index.html",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vite.config.ts",
    ]) {
      try {
        await cp(path.join(sourceRoot, name), path.join(snapshot, name), {
          recursive: true,
          dereference: true,
        });
      } catch (error) {
        if (error.code !== "ENOENT" || !["public"].includes(name)) throw error;
      }
    }
    // Dereference the development worktree's dependency symlink. No artifact points back at the checkout.
    await cp(
      path.join(sourceRoot, "node_modules"),
      path.join(snapshot, "node_modules"),
      { recursive: true, dereference: true },
    );
    const sourceFiles = (await inventory(snapshot)).filter(
      ([name]) => !name.startsWith("node_modules/"),
    );
    const dependencies = await inventory(path.join(snapshot, "node_modules"));
    const sourceHash = hash(JSON.stringify(sourceFiles));
    const dependencyHash = hash(JSON.stringify(dependencies));
    const lockHash = hash(
      await readFile(path.join(snapshot, "package-lock.json")),
    );
    const toolchain = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    };
    const releaseId = hash(
      JSON.stringify({ sourceHash, dependencyHash, lockHash, toolchain }),
    );
    const destination = path.join(releaseRoot, releaseId);
    try {
      await stat(path.join(destination, "manifest.json"));
      return JSON.parse(
        await readFile(path.join(destination, "manifest.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const artifact = path.join(staging, "artifact");
    await mkdir(artifact);
    run(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "build",
        "--outDir",
        path.join(artifact, "client"),
      ],
      snapshot,
      { RELEASE_ID: releaseId },
    );
    for (const [input, output] of [
      ["server/index.ts", "server/index.mjs"],
      ["server/control/index.ts", "control/index.mjs"],
    ]) {
      try {
        await stat(path.join(snapshot, input));
      } catch (error) {
        if (error.code === "ENOENT" && input === "server/control/index.ts")
          continue;
        throw error;
      }
      run(
        path.join(snapshot, "node_modules/.bin/esbuild"),
        [
          input,
          "--bundle",
          "--platform=node",
          "--format=esm",
          "--packages=external",
          `--define:__RELEASE_ID__=${JSON.stringify(releaseId)}`,
          `--outfile=${path.join(artifact, output)}`,
        ],
        snapshot,
      );
    }
    await rename(
      path.join(snapshot, "node_modules"),
      path.join(artifact, "node_modules"),
    );
    await writeFile(
      path.join(artifact, "package.json"),
      JSON.stringify({ type: "module", private: true }),
    );
    // SQLite migrations are data, not importable code.
    try {
      await cp(
        path.join(snapshot, "server/control/schema.sql"),
        path.join(artifact, "control/schema.sql"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const assets = await inventory(path.join(artifact, "client"));
    const manifest = {
      releaseId,
      protocolVersion: 1,
      worldHash: hash(
        JSON.stringify(sourceFiles.filter(([name]) => name.startsWith("src/"))),
      ),
      simulationHash: hash(
        JSON.stringify(
          sourceFiles.filter(
            ([name]) => name.startsWith("src/") || name.startsWith("server/"),
          ),
        ),
      ),
      assetManifestHash: hash(JSON.stringify(assets)),
      assets: Object.fromEntries(assets),
      provenance: { sourceHash, dependencyHash, lockHash, toolchain },
    };
    await writeFile(
      path.join(artifact, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await writeFile(
      path.join(artifact, "client/manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    // Build directories never overwrite an existing content ID. Consumers run these files read-only.
    async function seal(root) {
      for (const item of await readdir(root, { withFileTypes: true })) {
        const p = path.join(root, item.name);
        if (item.isDirectory()) await seal(p);
        else await chmod(p, (await stat(p)).mode & 0o555);
      }
      await chmod(root, 0o555);
    }
    await seal(artifact);
    await chmod(artifact, 0o755);
    await rename(artifact, destination);
    await chmod(destination, 0o555);
    return manifest;
  } finally {
    async function unseal(root) {
      await chmod(root, 0o755);
      for (const item of await readdir(root, { withFileTypes: true }))
        if (item.isDirectory()) await unseal(path.join(root, item.name));
    }
    await unseal(staging);
    await rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(JSON.stringify(await buildRelease(), null, 2));
}
