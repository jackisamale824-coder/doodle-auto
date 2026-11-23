import { Quaternion, Vector3, type Group } from "three";
import { openedDoor } from "./county-structures.ts";
import type { Physics } from "./physics.ts";
import type { Box } from "./world.ts";
import type { RubblePose } from "./county-rubble.ts";
import type { RubbleCluster, RubbleMessage } from "./county-wreckage.ts";

export class RubbleRoster {
  readonly clusters = new Map<number, RubbleCluster>();
  private owners = new Map<number, number>();
  reset() {
    this.clusters.clear();
    this.owners.clear();
  }
  remove(index: number) {
    const id = this.owners.get(index);
    if (id === undefined) return;
    const c = this.clusters.get(id)!;
    c.indices = c.indices.filter((i) => i !== index);
    if (c.openDoors) c.openDoors = c.openDoors.filter((i) => i !== index);
    if (!c.indices.length) this.clusters.delete(id);
    this.owners.delete(index);
    return id;
  }
  add(cluster: RubbleCluster) {
    this.clusters.set(cluster.id, {
      ...cluster,
      indices: [...cluster.indices],
    });
    for (const i of cluster.indices) this.owners.set(i, cluster.id);
  }
  accept(m: RubbleMessage) {
    if (m.type === "rubble-spawn") {
      for (const i of m.indices) this.remove(i);
      this.add(m);
    } else if (m.type === "rubble-remove") this.remove(m.index);
    else
      for (const pose of m.poses) {
        const c = this.clusters.get(pose.id);
        if (c) c.pose = pose;
      }
  }
}

export class RubbleView {
  readonly roster = new RubbleRoster();
  private motion = new Map<
    number,
    {
      from: RubblePose;
      target: RubblePose;
      shown: RubblePose;
      time: number;
      duration: number;
    }
  >();
  private pos = new Vector3();
  private rot = new Quaternion();
  private target = new Quaternion();
  constructor(
    private group: Group,
    private boxes: Box[],
    private physics: Physics,
  ) {}
  clear() {
    this.group.userData.rubbleClear?.();
    this.physics.clearRubble();
    this.roster.reset();
    this.motion.clear();
  }
  add(c: RubbleCluster) {
    for (const i of c.indices) this.remove(i);
    this.roster.add(c);
    for (const i of c.openDoors ?? []) {
      const b = this.boxes[i];
      if (b?.piece === "door" && b.s[0] > b.s[2]) {
        const open = openedDoor(b);
        b.p = open.p;
        b.s = open.s;
      }
    }
    this.group.userData.rubbleSpawn(c.id, c.indices, this.boxes);
    this.physics.addRubble(c);
    this.group.userData.rubblePose(c.pose);
  }
  remove(i: number) {
    const id = this.roster.remove(i);
    if (id === undefined) return;
    this.physics.removeRubblePart(i);
    this.group.userData.rubbleRemove(i);
    if (!this.roster.clusters.has(id)) {
      this.motion.delete(id);
      this.group.userData.rubbleDespawn?.(id);
    }
  }
  move(poses: RubblePose[], duration: number) {
    for (const target of poses) {
      const c = this.roster.clusters.get(target.id);
      if (!c) continue;
      const from = this.motion.get(target.id)?.shown ?? c.pose;
      c.pose = target;
      this.motion.set(target.id, {
        from,
        target,
        shown: { ...target, p: [...from.p], q: [...from.q] },
        time: 0,
        duration,
      });
    }
  }
  update(dt: number) {
    for (const [id, m] of this.motion) {
      m.time += dt;
      const t = Math.min(1, m.time / m.duration);
      this.pos
        .fromArray(m.from.p)
        .lerp(this.posTarget.fromArray(m.target.p), t)
        .toArray(m.shown.p);
      this.rot
        .fromArray(m.from.q)
        .slerp(this.target.fromArray(m.target.q), t)
        .toArray(m.shown.q);
      this.group.userData.rubblePose(m.shown);
      this.physics.poseRubble(m.shown);
      if (t === 1) this.motion.delete(id);
    }
  }
  private posTarget = new Vector3();
}
