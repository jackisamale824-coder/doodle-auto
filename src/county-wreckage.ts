import { CountyRubble, type RubblePose } from "./county-rubble.ts";
import type { Box, V3 } from "./world.ts";

export interface RubbleCluster {
  id: number;
  indices: number[];
  pose: RubblePose;
  openDoors?: number[];
}
export type RubbleMessage =
  | {
      type: "rubble-spawn";
      openDoors?: number[];
      id: number;
      indices: number[];
      direction: V3;
      pose: RubblePose;
    }
  | { type: "rubble-remove"; index: number }
  | { type: "rubble-poses"; poses: RubblePose[] };

// A new break in a fallen assembly can separate a shelf from its wall or split
// two wings. Only rebuild connectivity within the cluster that received the hit.
function fragments(boxes: Box[], indices: number[]) {
  const remaining = new Set(indices),
    result: number[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!;
    const component = [first];
    remaining.delete(first);
    for (let k = 0; k < component.length; k++) {
      const a = boxes[component[k]];
      for (const i of remaining) {
        const b = boxes[i];
        if (
          a.p.every(
            (v, j) => Math.abs(v - b.p[j]) <= (a.s[j] + b.s[j]) / 2 + 0.26,
          )
        ) {
          remaining.delete(i);
          component.push(i);
        }
      }
    }
    result.push(component);
  }
  return result.sort((a, b) => b.length - a.length);
}

export class CountyWreckage {
  readonly clusters = new Map<number, RubbleCluster>();
  readonly owners = new Map<number, number>();
  private serial = 0;
  sim?: CountyRubble;
  constructor(
    private boxes: Box[],
    private notify: (m: RubbleMessage) => void,
  ) {}
  invalidate(index: number) {
    this.sim?.syncStatic(index);
  }
  detach(indices: number[], direction: V3, initialPose?: RubblePose) {
    if (!indices.length) return;
    this.sim ??= new CountyRubble(this.boxes);
    const id = ++this.serial,
      pose = this.sim.spawn(id, indices, direction, initialPose);
    const openDoors = indices.filter(
      (i) =>
        this.boxes[i].piece === "door" &&
        this.boxes[i].s[2] > this.boxes[i].s[0],
    );
    const basis = openDoors.length ? { openDoors } : {};
    this.clusters.set(id, { id, indices, pose, ...basis });
    for (const i of indices) this.owners.set(i, id);
    this.notify({
      type: "rubble-spawn",
      id,
      indices,
      direction,
      pose,
      ...basis,
    });
  }
  remove(index: number) {
    const id = this.owners.get(index);
    if (id === undefined || !this.sim) return;
    const cluster = this.clusters.get(id)!;
    this.sim.removePart(index);
    this.owners.delete(index);
    this.notify({ type: "rubble-remove", index });
    const surviving = cluster.indices.filter((i) => i !== index);
    if (!surviving.length) {
      this.clusters.delete(id);
      return;
    }
    // Contact topology changes on structural breaks. Tiny fittings are leaves
    // of that graph, so removing one does not require a graph traversal.
    const groups = ["wall", "roof", "floor"].includes(this.boxes[index].piece!)
      ? fragments(this.boxes, surviving)
      : [surviving];
    cluster.indices = groups[0];
    if (cluster.openDoors) {
      const retained = new Set(cluster.indices);
      cluster.openDoors = cluster.openDoors.filter((i) => retained.has(i));
    }
    if (groups.length > 1) {
      this.sim.removeParts(groups.slice(1).flat());
      for (const parts of groups.slice(1))
        this.detach(parts, [0, 0, 0], cluster.pose);
    }
  }
  step(dt: number) {
    const poses = this.sim?.step(dt);
    if (!poses?.length) return;
    for (const pose of poses) {
      const cluster = this.clusters.get(pose.id);
      if (cluster) cluster.pose = pose;
    }
    this.notify({ type: "rubble-poses", poses });
  }
  dispose() {
    this.sim?.dispose();
  }
}
