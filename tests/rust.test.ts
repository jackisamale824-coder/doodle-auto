import test from "node:test";
import assert from "node:assert/strict";
import { generateRust, RUST_SCALE } from "../src/rust.ts";
import { generateLevel } from "../src/levels.ts";
import { Physics, Controller, idleInput } from "../src/physics.ts";
import { Spatial } from "../server/spatial.ts";
test("Rust is the served level and the procedural city remains explicitly available", () => {
  const rust = generateLevel("rust");
  assert.equal(rust.arena?.name, "RUST");
  assert.ok(rust.boxes.length > 100);
  assert.ok(rust.nodes.length > 100);
  assert.equal(generateLevel("city:notebook").buildings.length, 256);
  assert.deepEqual(generateRust("a").boxes, generateRust("b").boxes);
});
test("Rust ladders climb every deck, clear the lip and agree with server collision", async () => {
  const city = generateRust(),
    physics = await Physics.create(city.boxes),
    spatial = new Spatial(city.boxes);
  try {
    assert.equal(city.arena!.ladders.length, 3);
    for (const l of city.arena!.ladders) {
      const p = new Controller(physics, [l.x, l.bottom + 0.05, l.z]);
      p.ladders = city.arena!.ladders;
      let before = p.position.toArray();
      for (let i = 0; i < 700; i++) {
        p.update(1 / 120, { ...idleInput(), forward: 1 });
        if (i % 4 === 3) {
          assert.ok(
            spatial.movement(
              before as any,
              p.position.toArray() as any,
              p.height,
            ),
            "server must accept climbing",
          );
          before = p.position.toArray();
        }
        if (
          p.position.y >= l.top &&
          Math.hypot(p.position.x - l.exit[0], p.position.z - l.exit[2]) < 0.2
        )
          break;
      }
      assert.ok(
        p.position.y >= l.top,
        `stuck ladder ${JSON.stringify(l)} at ${p.position.toArray()}`,
      );
      assert.ok(
        Math.hypot(p.position.x - l.exit[0], p.position.z - l.exit[2]) < 0.25,
        "must exit onto deck",
      );
    }
  } finally {
    physics.dispose();
  }
});
test("Rust model spawns are clear and grounded", async () => {
  const city = generateRust(),
    physics = await Physics.create(city.boxes);
  try {
    for (const s of city.spawns) {
      const p = new Controller(physics, s);
      assert.ok(physics.clear(p.position));
      for (let i = 0; i < 60; i++) p.update(1 / 120, idleInput());
      assert.ok(p.grounded);
    }
  } finally {
    physics.dispose();
  }
});

test("model triangle rays match Rapier and the NPC graph is connected", async () => {
  const c = generateRust(),
    physics = await Physics.create(c.boxes),
    spatial = new Spatial(c.boxes);
  try {
    const seen = new Set([0]);
    for (let i = 0; i < c.nodes.length; i++)
      for (const [a, b] of c.links) {
        if (seen.has(a)) seen.add(b);
        if (seen.has(b)) seen.add(a);
      }
    assert.equal(seen.size, c.nodes.length);
    for (const node of c.nodes.filter((_, i) => i % 13 === 0)) {
      const p = new Controller(physics, node);
      const dir = p.forward;
      const native = physics.ray(p.eye, dir, 100),
        server = spatial.ray(p.eye.toArray(), dir.toArray(), 100);
      assert.equal(!!native, !!server);
      if (native && server)
        assert.ok(
          Math.abs(native.distance - server.distance) < 0.015,
          "server and client must hit the same visible surface",
        );
    }
  } finally {
    physics.dispose();
  }
});

test("Rust public NPCs spawn on the validated mesh floor instead of rejecting its bounding box", async () => {
  const { Npcs } = await import("../server/npcs.ts");
  const c = generateRust(),
    npcs = new Npcs(c, new Spatial(c.boxes));
  assert.equal(npcs.actors.length, 4);
  const physics = await Physics.create(c.boxes);
  try {
    for (const npc of npcs.actors) {
      const p = new Controller(physics, npc.p);
      assert.ok(physics.clear(p.position, 1.85));
    }
  } finally {
    physics.dispose();
  }
});

test("Rust scales all gameplay geometry by the shared world scale and provides a grounded desert outside the old boundary", async () => {
  const { default: source } =
    await import("../src/generated/rust-collision.json");
  const { default: nav } =
    await import("../src/generated/rust-navigation.json");
  const c = generateRust();
  assert.equal(
    c.boxes[0].mesh!.vertices[0],
    source[0].mesh.vertices[0] * RUST_SCALE,
  );
  assert.deepEqual(
    c.spawns[0],
    nav.spawns[0].map((v) => v * RUST_SCALE),
  );
  assert.equal(c.arena!.ladders[0].top, 9.84 * RUST_SCALE);
  assert.equal(c.bounds, 120);
  const physics = await Physics.create(c.boxes);
  try {
    for (const [x, z] of [
      [50, 0],
      [-50, 0],
      [0, 60],
      [0, -60],
      [110, 110],
      [-110, -110],
    ]) {
      const p = new Controller(physics, [x, 5, z]);
      for (let i = 0; i < 240; i++) p.update(1 / 120, idleInput());
      assert.ok(p.grounded, `no floor at ${x},${z}`);
      assert.ok(p.position.y > -0.6);
    }
  } finally {
    physics.dispose();
  }
});

test("Rust perimeter blocks ground and airborne escape on client and server", async () => {
  const { RUST_PERIMETER } = await import("../src/rust-boundary.ts");
  const city = generateRust(),
    physics = await Physics.create(city.boxes),
    spatial = new Spatial(city.boxes);
  try {
    for (let i = 0; i < RUST_PERIMETER.length; i++) {
      const [x, z] = RUST_PERIMETER[i],
        [ex, ez] = RUST_PERIMETER[(i + 1) % RUST_PERIMETER.length];
      const dx = ex - x,
        dz = ez - z,
        len = Math.hypot(dx, dz);
      const nx = dz / len,
        nz = -dx / len;
      for (const y of [0.5, 12, 70]) {
        const mx = (x + ex) * (RUST_SCALE / 2),
          mz = (z + ez) * (RUST_SCALE / 2);
        const a: [number, number, number] = [mx - nx * 1.2, y, mz - nz * 1.2];
        const b: [number, number, number] = [mx + nx * 1.2, y, mz + nz * 1.2];
        assert.equal(
          spatial.movement(a, b, 1.76),
          false,
          `server boundary ${i} height ${y}`,
        );
        const p = new Controller(physics, a);
        p.yaw = Math.atan2(-nx, -nz);
        if (y === 70)
          assert.equal(
            p.grappleHit(),
            null,
            "invisible walls cannot be grapple targets",
          );
        p.velocity.set(nx * 70, 0, nz * 70);
        for (let tick = 0; tick < 12; tick++) p.update(1 / 120, idleInput());
        const outside = (p.position.x - mx) * nx + (p.position.z - mz) * nz;
        assert.ok(
          outside < 0,
          `client escaped boundary ${i} height ${y}: ${outside}`,
        );
      }
    }
  } finally {
    physics.dispose();
  }
});

test("disabled grappling ignores hook input while the archive retains the ability", async () => {
  const physics = await Physics.create(generateRust().boxes);
  try {
    const p = new Controller(physics, [0, 40, 0]);
    p.pitch = -Math.PI / 2;
    assert.ok(p.grappleHit(), "enabled controller can target geometry");
    p.grappleEnabled = false;
    assert.equal(p.grappleHit(), null);
    for (let i = 0; i < 10; i++)
      p.update(1 / 120, { ...idleInput(), grapple: true, reel: true });
    assert.equal(p.anchor, null);
    assert.equal(p.hooks, 0);
    p.grappleEnabled = true;
    p.update(1 / 120, idleInput());
    p.update(1 / 120, { ...idleInput(), grapple: true });
    assert.ok(p.anchor, "city controller still supports grappling");
  } finally {
    physics.dispose();
  }
});
