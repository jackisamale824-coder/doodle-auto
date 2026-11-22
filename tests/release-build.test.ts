import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  rm,
  lstat,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// @ts-expect-error The release packager is a directly executable ES module.
import { buildRelease } from "../scripts/build-release.mjs";

test("release packaging freezes dirty source, dependencies and retains older assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-build-test-"));
  const sourceRoot = path.join(root, "checkout");
  const releaseRoot = path.join(root, "releases");
  const deps = path.join(root, "dependencies");
  const put = async (name: string, data: string) => {
    await mkdir(path.dirname(name), { recursive: true });
    await writeFile(name, data);
  };
  try {
    for (const name of [
      "src/world.ts",
      "server/index.ts",
      "public/audio/test.wav",
      "scripts/build.mjs",
      "index.html",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "vite.config.ts",
    ])
      await put(
        path.join(sourceRoot, name),
        name.endsWith(".json") ? "{}" : "first",
      );
    await put(
      path.join(deps, "vite/bin/vite.js"),
      `const fs = require('fs'); const path = require('path'); const out = process.argv[process.argv.indexOf('--outDir')+1]; fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(path.join(out,'index.html'),process.env.RELEASE_ID); fs.writeFileSync(path.join(out,'world.js'),fs.readFileSync('src/world.ts'));`,
    );
    await put(
      path.join(deps, ".bin/esbuild"),
      `#!/usr/bin/env node\nconst fs=require('fs');const path=require('path');const out=process.argv.find(x=>x.startsWith('--outfile=')).slice(10);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,fs.readFileSync(process.argv[2]));`,
    );
    await chmod(path.join(deps, ".bin/esbuild"), 0o755);
    await symlink(deps, path.join(sourceRoot, "node_modules"));
    const first = await buildRelease({ sourceRoot, releaseRoot });
    const repeat = await buildRelease({ sourceRoot, releaseRoot });
    assert.equal(repeat.releaseId, first.releaseId);
    assert.equal(
      (
        await lstat(path.join(releaseRoot, first.releaseId, "node_modules"))
      ).isSymbolicLink(),
      false,
    );
    await put(path.join(sourceRoot, "src/world.ts"), "second dirty world");
    await put(path.join(deps, "dependency.txt"), "new dependency");
    const second = await buildRelease({ sourceRoot, releaseRoot });
    assert.notEqual(second.releaseId, first.releaseId);
    assert.notEqual(second.worldHash, first.worldHash);
    await put(
      path.join(sourceRoot, "package-lock.json"),
      '{"lockfileVersion":3}',
    );
    const third = await buildRelease({ sourceRoot, releaseRoot });
    assert.notEqual(third.releaseId, second.releaseId);
    assert.notEqual(third.provenance.lockHash, second.provenance.lockHash);
    assert.equal(
      (await lstat(path.join(releaseRoot, first.releaseId, "server/index.mjs")))
        .mode & 0o222,
      0,
    );
    await rm(sourceRoot, { recursive: true });
    await rm(deps, { recursive: true });
    assert.equal(
      await readFile(
        path.join(releaseRoot, first.releaseId, "client/world.js"),
        "utf8",
      ),
      "first",
    );
    assert.equal(
      await readFile(
        path.join(releaseRoot, second.releaseId, "client/world.js"),
        "utf8",
      ),
      "second dirty world",
    );
    assert.equal(
      await readFile(
        path.join(releaseRoot, first.releaseId, "server/index.mjs"),
        "utf8",
      ),
      "first",
    );
    assert.ok(
      await readFile(
        path.join(
          releaseRoot,
          first.releaseId,
          "node_modules/vite/bin/vite.js",
        ),
      ),
    );
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(releaseRoot, first.releaseId, "client/manifest.json"),
          "utf8",
        ),
      ).releaseId,
      first.releaseId,
    );
  } finally {
    const unseal = async (dir: string) => {
      const { readdir } = await import("node:fs/promises");
      await chmod(dir, 0o755);
      for (const entry of await readdir(dir, { withFileTypes: true }))
        if (entry.isDirectory()) await unseal(path.join(dir, entry.name));
    };
    await unseal(root);
    await rm(root, { recursive: true, force: true });
  }
});
