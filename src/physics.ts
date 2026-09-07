import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { type Box, type V3, worldRay } from "./world.ts";
let initialized: Promise<void> | undefined;
export class Physics {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  collider: RAPIER.Collider;
  private boxHandles = new Map<number, Box>();
  constructor(public boxes: Box[]) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    for (const b of boxes)
      if (b.solid) {
        const c = this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            b.s[0] / 2,
            b.s[1] / 2,
            b.s[2] / 2,
          ).setTranslation(...b.p),
        );
        this.boxHandles.set(c.handle, b);
      }
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.55, 0.33).setTranslation(0, 3, 0),
    );
    this.controller = this.world.createCharacterController(0.018);
    this.controller.enableAutostep(0.36, 0.15, false);
    this.controller.enableSnapToGround(0.22);
    this.controller.setSlideEnabled(true);
    this.world.step();
  }
  static async create(boxes: Box[]) {
    initialized ??= RAPIER.init();
    await initialized;
    return new Physics(boxes);
  }
  move(pos: Vector3, delta: Vector3, height: number) {
    this.collider.setShape(
      new RAPIER.Capsule(Math.max(0.1, height / 2 - 0.33), 0.33),
    );
    this.collider.setTranslation({ x: pos.x, y: pos.y + height / 2, z: pos.z });
    this.controller.computeColliderMovement(
      this.collider,
      delta,
      undefined,
      undefined,
      (c) => c.handle !== this.collider.handle,
    );
    const m = this.controller.computedMovement();
    pos.add(new Vector3(m.x, m.y, m.z));
    let wall: Vector3 | null = null;
    for (let i = 0; i < this.controller.numComputedCollisions(); i++) {
      const c = this.controller.computedCollision(i);
      if (c && Math.abs(c.normal1.y) < 0.4)
        wall = new Vector3(c.normal1.x, c.normal1.y, c.normal1.z);
    }
    return { grounded: this.controller.computedGrounded(), wall, moved: m };
  }
  clear(pos: Vector3, height = 1.76) {
    return !this.boxes.some(
      (b) =>
        b.solid &&
        Math.abs(pos.x - b.p[0]) < b.s[0] / 2 + 0.31 &&
        Math.abs(pos.z - b.p[2]) < b.s[2] / 2 + 0.31 &&
        pos.y + height > b.p[1] - b.s[1] / 2 + 0.03 &&
        pos.y < b.p[1] + b.s[1] / 2 - 0.02,
    );
  }
  ray(o: Vector3, d: Vector3, max = 65) {
    const hit = this.world.castRayAndGetNormal(
      new RAPIER.Ray(o, d),
      max,
      true,
      undefined,
      undefined,
      this.collider,
    );
    if (!hit) return null;
    const box = this.boxHandles.get(hit.collider.handle);
    return box
      ? {
          distance: hit.timeOfImpact,
          box,
          point: o.clone().addScaledVector(d, hit.timeOfImpact).toArray() as V3,
        }
      : null;
  }
  dispose() {
    this.world.free();
  }
}
export interface MovementInput {
  forward: number;
  side: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
  grapple: boolean;
  reel: boolean;
}
export const idleInput = (): MovementInput => ({
  forward: 0,
  side: 0,
  sprint: false,
  crouch: false,
  jump: false,
  grapple: false,
  reel: false,
});
export class Controller {
  position = new Vector3();
  velocity = new Vector3();
  yaw = 0;
  pitch = 0;
  grounded = false;
  height = 1.76;
  action = "AIR";
  anchor: { x: number; y: number; z: number } | null = null;
  ropeLength = 0;
  wall: Vector3 | null = null;
  wallTime = 0;
  airTime = 0;
  actionTime = 0;
  slide = 0;
  coyote = 0;
  stamina = 1;
  travel = 0;
  vaults = 0;
  wallruns = 0;
  hooks = 0;
  private mantle: {
    target: Vector3;
    start: Vector3;
    elapsed: number;
    duration: number;
  } | null = null;
  private grappleWas = false;
  private jumpWas = false;
  private crouchWas = false;
  private wallCooldown = 0;
  constructor(
    public physics: Physics,
    start: V3,
  ) {
    this.position.fromArray(start);
  }
  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }
  get eye() {
    return this.position.clone().add(new Vector3(0, this.height - 0.16, 0));
  }
  get forward() {
    return new Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }
  reset(start: V3) {
    this.position.fromArray(start);
    this.velocity.set(0, 0, 0);
    this.anchor = null;
    this.mantle = null;
    this.slide = 0;
    this.height = 1.76;
    this.stamina = 1;
    this.grounded = false;
    this.action = "AIR";
    this.jumpWas = false;
    this.grappleWas = false;
    this.crouchWas = false;
    this.coyote = 0;
    this.airTime = 0;
    this.wallTime = 0;
    this.wall = null;
    this.wallCooldown = 0;
    this.actionTime = 0;
  }
  releaseGrapple(boost = false) {
    if (!this.anchor) return;
    this.anchor = null;
    if (boost) this.velocity.y = Math.max(this.velocity.y, 5.5);
    this.action = "RELEASE";
    this.actionTime = 0.6;
  }
  private traverse(dir: Vector3) {
    const origin = this.position.clone().add(new Vector3(0, 0.65, 0));
    const hit = this.physics.ray(origin, dir, 1.65);
    if (!hit) return false;
    const top = hit.box.p[1] + hit.box.s[1] / 2,
      dy = top - this.position.y;
    if (dy < 0.45 || dy > 2.5) return false;
    const target = new Vector3(...hit.point).addScaledVector(
      dir,
      Math.min(hit.box.s[0], hit.box.s[2]) + 0.7,
    );
    target.y = top + 0.07;
    if (!this.physics.clear(target)) {
      target.copy(new Vector3(...hit.point).addScaledVector(dir, 0.6));
      target.y = top + 0.07;
      if (!this.physics.clear(target)) return false;
    }
    if (dy < 1.45) {
      this.velocity.addScaledVector(dir, 2.5);
      this.velocity.y = 0;
      this.mantle = {
        target,
        start: this.position.clone(),
        elapsed: 0,
        duration: 0.32,
      };
      this.action = "VAULT";
      this.vaults++;
    } else {
      this.mantle = {
        target,
        start: this.position.clone(),
        elapsed: 0,
        duration: 0.4,
      };
      this.action = "MANTLE";
      this.velocity.y = 0;
    }
    this.grounded = false;
    this.actionTime = 0.6;
    return true;
  }
  update(dt: number, input: MovementInput) {
    dt = Math.min(dt, 1 / 30);
    this.actionTime -= dt;
    this.wallCooldown -= dt;
    const jump = input.jump && !this.jumpWas,
      hook = input.grapple && !this.grappleWas;
    this.jumpWas = input.jump;
    this.grappleWas = input.grapple;
    const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
      right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = forward
      .clone()
      .multiplyScalar(input.forward)
      .addScaledVector(right, input.side);
    if (wish.lengthSq() > 1) wish.normalize();
    const old = this.position.clone();
    if (hook) {
      if (this.anchor) this.releaseGrapple();
      else if (this.stamina > 0.15) {
        const h = this.physics.ray(this.eye, this.forward, 65);
        if (h && h.distance > 2) {
          this.anchor = new Vector3(...h.point);
          this.ropeLength = h.distance;
          this.stamina -= 0.12;
          this.hooks++;
          this.velocity.y = Math.max(3, this.velocity.y);
          this.grounded = false;
        }
      }
    }
    if (this.mantle) {
      const m = this.mantle;
      m.elapsed += dt;
      const t = Math.min(1, m.elapsed / m.duration),
        u = Math.max(0, (t - 0.38) / 0.62);
      const desired = m.start.clone().lerp(m.target, u);
      desired.y =
        m.start.y +
        (m.target.y - m.start.y) * Math.min(1, t / 0.38) +
        Math.sin(t * Math.PI) * 0.15;
      this.physics.move(this.position, desired.sub(this.position), this.height);
      if (t >= 1) this.mantle = null;
      return;
    }
    if (input.crouch && !this.crouchWas && this.grounded && this.speed > 7) {
      this.slide = 1.15;
      this.velocity.multiplyScalar(1.08);
    }
    this.crouchWas = input.crouch;
    this.slide = Math.max(0, this.slide - dt);
    const crouch = input.crouch || this.slide > 0;
    this.height = crouch
      ? 1.08
      : this.physics.clear(this.position, 1.76)
        ? 1.76
        : 1.08;
    if (this.grounded) {
      this.coyote = 0.12;
      this.airTime = 0;
      this.wallTime = 0;
    } else {
      this.coyote -= dt;
      this.airTime += dt;
    }
    if (jump) {
      if (this.anchor) this.releaseGrapple(true);
      else if (input.forward > 0 && this.traverse(forward)) {
      } else if (this.grounded || this.coyote > 0) {
        this.velocity.y = 9.5;
        this.grounded = false;
        this.coyote = 0;
        this.slide = 0;
      } else if (this.wall && this.wallCooldown <= 0) {
        this.velocity.addScaledVector(this.wall, 9);
        this.velocity.y = 9;
        this.wallCooldown = 0.3;
        this.wallTime = 0;
        this.action = "WALL JUMP";
        this.actionTime = 0.55;
      }
    }
    const sp = this.speed;
    if (this.grounded) {
      const friction = this.slide > 0 ? 0.6 : wish.lengthSq() > 0 ? 2.2 : 9;
      this.velocity.x *= Math.max(0, 1 - friction * dt);
      this.velocity.z *= Math.max(0, 1 - friction * dt);
    }
    const max = crouch && this.slide <= 0 ? 4 : input.sprint ? 13.2 : 8;
    if (wish.lengthSq() > 0) {
      const current = this.velocity.dot(wish),
        add = Math.max(
          0,
          Math.min(
            (this.grounded ? max : 10) - current,
            (this.grounded ? 72 : 18) * dt,
          ),
        );
      this.velocity.addScaledVector(wish, add);
    }
    let gravity = 25;
    const wallL = this.physics.ray(this.eye, right, 0.65),
      wallR = this.physics.ray(this.eye, right.clone().negate(), 0.65);
    if (
      !this.grounded &&
      input.forward > 0.1 &&
      sp > 6 &&
      this.airTime > 0.12 &&
      this.wallTime < 1.3 &&
      !this.anchor &&
      (wallL || wallR) &&
      this.wallCooldown <= 0
    ) {
      this.wall = right.clone().multiplyScalar(wallL ? -1 : 1);
      this.wallTime += dt;
      gravity = 3.2;
      this.velocity.y = Math.max(this.velocity.y, -1.2);
      if (this.action !== "WALL RUN") this.wallruns++;
      this.action = "WALL RUN";
    } else if (this.actionTime <= 0)
      this.action = this.anchor
        ? "SWING"
        : this.grounded
          ? this.slide > 0
            ? "SLIDE"
            : sp > 9
              ? "SPRINT"
              : "RUN"
          : "AIR";
    this.velocity.y -= gravity * dt;
    if (this.anchor) {
      this.stamina -= dt * 0.055;
      const anchor = new Vector3(this.anchor.x, this.anchor.y, this.anchor.z),
        to = anchor.sub(this.eye),
        len = to.length(),
        dir = to.normalize();
      if (input.reel) this.ropeLength = Math.max(3, this.ropeLength - dt * 14);
      this.velocity.addScaledVector(dir, dt * (input.reel ? 32 : 8));
      if (len > this.ropeLength) {
        const outward = this.velocity.dot(dir);
        if (outward < 0) this.velocity.addScaledVector(dir, -outward);
        this.velocity.addScaledVector(dir, (len - this.ropeLength) * dt * 75);
      }
      if (this.stamina <= 0) this.releaseGrapple();
    } else
      this.stamina = Math.min(
        1,
        this.stamina + dt * (this.grounded ? 0.35 : 0.15),
      );
    const horizontal = this.speed;
    if (horizontal > 42) {
      this.velocity.x *= 42 / horizontal;
      this.velocity.z *= 42 / horizontal;
    }
    this.velocity.y = Math.max(-45, Math.min(35, this.velocity.y));
    const delta = this.velocity.clone().multiplyScalar(dt);
    const result = this.physics.move(this.position, delta, this.height);
    this.grounded = result.grounded;
    if (result.wall) this.wall = result.wall;
    else if (this.action !== "WALL RUN") this.wall = null;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
    if (delta.y > 0.001 && result.moved.y < delta.y * 0.4)
      this.velocity.y = Math.min(0, this.velocity.y);
    if (Math.abs(result.moved.x) < Math.abs(delta.x) * 0.25)
      this.velocity.x *= 0.35;
    if (Math.abs(result.moved.z) < Math.abs(delta.z) * 0.25)
      this.velocity.z *= 0.35;
    this.travel += old.distanceTo(this.position);
  }
}
