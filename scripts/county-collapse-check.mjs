import { enterGuest } from "./guest-session.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against the dev server (the production build omits window.__doodles).
const origin = process.env.COUNTY_TEST_ORIGIN ?? "http://127.0.0.1:4173";
const browser = await chromium.launch(
  process.env.COUNTY_HARDWARE_GL === "1"
    ? {
        channel: "chromium",
        args: [
          "--enable-gpu",
          "--ignore-gpu-blocklist",
          "--use-angle=gl",
          "--ozone-platform=x11",
        ],
      }
    : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  // This offline run measures the loaded build; a dev-server file change
  // must not reload the tab while the physics scene is being sampled.
  await page.routeWebSocket(
    () => true,
    () => {},
  );
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.goto(new URL("/?mode=county", origin).href);
  await enterGuest(page);
  await page.waitForFunction(() => window.__doodles?.state === "menu");
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
  await page.waitForFunction(
    () => ["play", "paused"].includes(window.__doodles?.state),
    null,
    { timeout: 60000 },
  );
  if (await page.locator("#resume").isVisible())
    await page.locator("#resume").click();
  await page.waitForFunction(() => window.__doodles?.state === "play");
  const result = await page.evaluate(async () => {
    const g = window.__doodles;
    const boxes = g.city.boxes;
    const vector = (p) => g.player.position.clone().fromArray(p);
    const frame = () => new Promise(requestAnimationFrame);
    const buildings = new Map();
    for (const box of boxes) {
      if (!box.buildingId) continue;
      const parts = buildings.get(box.buildingId) ?? [];
      parts.push(box);
      buildings.set(box.buildingId, parts);
    }
    // Pick the most detailed generated building, with a deterministic tie-break.
    const [buildingId, parts] = [...buildings].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    )[0];
    const foundation = parts.find((b) => b.kind === "foundation");
    const height = Math.max(...parts.map((b) => b.p[1] + b.s[1] / 2));
    const centre = vector(foundation.p);
    centre.y = height * 0.4;
    const original = new Map(parts.map((b) => [b.pieceId, [...b.p]]));
    const supports = parts
      .filter((b) => b.piece === "wall" && b.p[1] - b.s[1] / 2 < 0.6)
      .sort((a, b) => a.p[0] - b.p[0] || a.pieceId - b.pieceId);
    if (!supports.length) throw Error("No ground-level walls on " + buildingId);
    // Choose a clear observer location on the ground from which the selected
    // building is visible. Player and scene continue their normal game loops.
    let eye;
    for (const scale of [1, 0.72, 1.4, 0.52]) {
      for (let i = 0; i < 24; i++) {
        const angle = (i * Math.PI) / 12;
        const p = centre.clone();
        p.x += Math.cos(angle) * height * scale;
        p.z += Math.sin(angle) * height * scale;
        const ground = g.physics.ray(p.clone().setY(3), vector([0, -1, 0]), 5);
        if (!ground || ground.box.buildingId) continue;
        p.y = ground.point[1] + 0.06;
        if (!g.physics.clear(p)) continue;
        const e = p.clone();
        e.y += 1.6;
        const delta = centre.clone().sub(e);
        const hit = g.physics.ray(
          e,
          delta.clone().normalize(),
          delta.length() + 10,
        );
        if (hit?.box.buildingId !== buildingId) continue;
        eye = e;
        g.player.reset(p.toArray());
        g.player.yaw = Math.atan2(-delta.x, -delta.z);
        g.player.pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
        break;
      }
      if (eye) break;
    }
    if (!eye) throw Error("No unobstructed viewpoint for " + buildingId);

    // Keep the actual drawing buffer at 720p throughout the benchmark.
    g.render.adjustCountyResolution = () => {};
    const renderer = g.render.renderer;
    renderer.setPixelRatio(1);
    g.render.resize();
    for (let i = 0; i < 30; i++) await frame();

    const cpu = { authority: 0, playerWorld: 0 };
    function timeStep(target, key) {
      const step = target.step;
      target.step = function (...args) {
        const start = performance.now();
        try {
          return step.apply(this, args);
        } finally {
          cpu[key] += performance.now() - start;
        }
      };
    }
    timeStep(g.wreckage, "authority");
    timeStep(g.physics.world, "playerWorld");

    const frames = [],
      authorityMs = [],
      playerWorldMs = [];
    let maxTilt = 0,
      maxTravel = 0,
      applied = 0;
    let previous = await frame();
    const stopAt = performance.now() + 45000;
    const ids = new Set();
    const upperIds = new Set();
    let maxDamageMs = 0;
    let finished = false,
      upperStoreysDetached = false;
    while (performance.now() < stopAt) {
      cpu.authority = cpu.playerWorld = 0;
      if (!upperStoreysDetached && applied < supports.length) {
        const started = performance.now();
        g.structures.damage(supports[applied++].pieceId, 200);
        maxDamageMs = Math.max(maxDamageMs, performance.now() - started);
      }
      const now = await frame();
      frames.push(now - previous);
      previous = now;
      authorityMs.push(cpu.authority);
      playerWorldMs.push(cpu.playerWorld);
      let settled = true;
      for (const [id, cluster] of g.rubbleClusters) {
        if (!cluster.indices.some((index) => original.has(index))) continue;
        ids.add(id);
        if (
          !upperIds.has(id) &&
          cluster.indices.some(
            (index) =>
              original.get(index)?.[1] > height * 0.5 &&
              boxes[index].piece === "wall",
          )
        ) {
          upperIds.add(id);
          upperStoreysDetached = true;
        }
        const pose = cluster.pose;
        if (!pose.sleep) settled = false;
        if (!upperIds.has(id)) continue;
        const [qx, , qz] = pose.q;
        // Angle between the original vertical and the body's transformed up axis.
        maxTilt = Math.max(
          maxTilt,
          (Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (qx * qx + qz * qz)))) *
            180) /
            Math.PI,
        );
        maxTravel = Math.max(
          maxTravel,
          vector(pose.p).distanceTo(vector(pose.origin)),
        );
      }
      if (upperStoreysDetached && settled) {
        finished = true;
        break;
      }
    }
    if (!finished)
      throw Error(
        "Collapse failed to settle: " +
          JSON.stringify({
            buildingId,
            applied,
            assemblies: ids.size,
            maxTilt,
            maxTravel,
          }),
      );

    // Sample the rendered instance centers after settling. Match these to
    // physics poses in world coordinates, independently of the rubble renderer.
    const rendered = [];
    const matrix = g.render.camera.matrix.clone();
    g.render.cityGroup.updateMatrixWorld(true);
    g.render.cityGroup.traverseVisible((mesh) => {
      if (
        !mesh.isInstancedMesh ||
        !mesh.visible ||
        !mesh.parent?.name?.startsWith("county-rubble-")
      )
        return;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix);
        if (
          matrix.elements[0] === 0 &&
          matrix.elements[1] === 0 &&
          matrix.elements[2] === 0
        )
          continue;
        matrix.premultiply(mesh.matrixWorld);
        const xyz = vector([0, 0, 0]).setFromMatrixPosition(matrix);
        if (Math.hypot(xyz.x - centre.x, xyz.z - centre.z) < 2.5 * height)
          rendered.push(xyz);
      }
    });
    let visibleMovedPieces = 0,
      colliderHits = 0,
      attached = 0;
    for (const id of upperIds) {
      const { indices, pose } = g.rubbleClusters.get(id);
      const q = g.render.camera.quaternion.clone().fromArray(pose.q);
      attached += indices.length;
      const solidIds = new Set(indices);
      for (const index of indices) {
        if (boxes[index].kind !== "exterior") continue;
        const start = vector(original.get(index));
        const at = start
          .clone()
          .sub(vector(pose.origin))
          .applyQuaternion(q)
          .add(vector(pose.p));
        if (at.distanceTo(start) < 0.5) continue;
        const ndc = at.clone().project(g.render.camera);
        if (
          Math.abs(ndc.x) < 1 &&
          Math.abs(ndc.y) < 1 &&
          ndc.z > -1 &&
          ndc.z < 1 &&
          rendered.some((point) => point.distanceToSquared(at) < 0.04 * 0.04)
        )
          visibleMovedPieces++;
        const n = vector(
          boxes[index].s[0] < boxes[index].s[2] ? [1, 0, 0] : [0, 0, 1],
        ).applyQuaternion(q);
        for (const sign of [-1, 1]) {
          const from = at.clone().addScaledVector(n, sign * 0.45);
          const hit = g.physics.ray(from, n.clone().multiplyScalar(-sign), 0.7);
          if (hit && solidIds.has(hit.box.pieceId)) {
            colliderHits++;
            break;
          }
        }
      }
    }
    const stats = (samples) => {
      const ordered = [...samples].sort((a, b) => a - b);
      return {
        mean: samples.reduce((a, b) => a + b, 0) / samples.length,
        p95: ordered[Math.ceil(0.95 * ordered.length) - 1],
        max: ordered[ordered.length - 1],
      };
    };
    const gl = renderer.getContext(),
      info = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      buildingId,
      buildingParts: parts.length,
      supportsRemoved: applied,
      assemblies: ids.size,
      attached,
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unavailable",
      buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      frames: frames.length,
      seconds: frames.reduce((a, b) => a + b, 0) / 1000,
      meanFPS: 1000 / stats(frames).mean,
      p95FrameMs: stats(frames).p95,
      worstFrameMs: Math.max(...frames),
      maxDamageMs,
      authorityMs: stats(authorityMs),
      playerWorldMs: stats(playerWorldMs),
      maxTiltDegrees: maxTilt,
      maxTravelMetres: maxTravel,
      visibleMovedPieces,
      colliderHits,
    };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(result.buffer, [1280, 720]);
  assert.ok(
    result.attached > 1 &&
      result.maxTiltDegrees > 5 &&
      result.maxTravelMetres > 0.25,
    "The building must physically tip and move",
  );
  assert.ok(
    result.visibleMovedPieces > 0,
    "No moved wall instances visible in the camera frustum",
  );
  assert.ok(
    result.colliderHits > 0,
    "No player-physics collision at the settled transformed walls",
  );
} finally {
  await browser.close();
}
