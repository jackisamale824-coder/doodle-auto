import { CountySupport } from "./county-support.ts";
import type { CountyWreckage } from "./county-wreckage.ts";
import type { Box, PieceState, V3 } from "./world.ts";

const durability = {
  door: 45,
  wall: 100,
  roof: 100,
  floor: 125,
  furniture: 30,
  fixture: 25,
};
type Shape = Pick<Box, "p" | "s">;
type Change = (
  index: number,
  state: PieceState,
  box: Box,
  detached: boolean,
) => void;

export function openedDoor({ p, s }: Shape): Shape {
  return { p: [p[0] - s[0] / 2, p[1], p[2] - s[0] / 2], s: [s[2], s[1], s[0]] };
}

// The same geometry and damage rules run locally for solo play and on the room
// worker for multiplayer. Only changed state travels across the socket.
export class CountyStructures {
  readonly states = new Map<number, PieceState>();
  private health = new Map<number, number>();
  private doors = new Map<number, Shape>();
  private support: CountySupport;
  constructor(
    private boxes: Box[],
    private changed: Change = () => {},
    private wreckage?: CountyWreckage,
  ) {
    this.support = new CountySupport(boxes);
    boxes.forEach((b, i) => {
      if (!b.piece) return;
      if (b.piece === "door") this.doors.set(i, { p: [...b.p], s: [...b.s] });
    });
  }
  set(index: number, state: PieceState, detached = false) {
    const box = this.boxes[index];
    if (!box?.piece || (this.states.get(index) ?? 0) === state) return;
    if (state === 1 && box.piece !== "door") return;
    if (state) this.states.set(index, state);
    else this.states.delete(index);
    const closed = this.doors.get(index);
    if (closed && state !== 2) {
      const shape = state === 1 ? openedDoor(closed) : closed;
      box.p = [...shape.p];
      box.s = [...shape.s];
    }
    box.solid = state !== 2;
    this.changed(index, state, box, detached);
    this.wreckage?.invalidate(index);
  }
  restore(states: Map<number, PieceState>) {
    for (const key of this.states.keys())
      if (!states.has(key)) this.set(key, 0);
    for (const [key, state] of states) this.set(key, state);
  }
  damage(index: number, amount: number) {
    const b = this.boxes[index];
    const fallen = this.wreckage?.owners.has(index);
    if (!b?.piece || (this.states.get(index) === 2 && !fallen)) return;
    const left = (this.health.get(index) ?? durability[b.piece]) - amount;
    if (left > 0) {
      this.health.set(index, left);
      return;
    }
    this.health.delete(index);
    if (fallen) {
      this.wreckage!.remove(index);
      return;
    }
    this.set(index, 2);
    for (const { indices, direction } of this.support.lost(index)) {
      for (const part of indices) this.set(part, 2, true);
      this.wreckage?.detach(indices, direction);
    }
  }
  operate(
    index: number,
    open: boolean,
    eye: V3,
    occupants: { p: V3; height: number }[],
    ray: (origin: V3, direction: V3, reach: number) => { box: Box } | null,
  ) {
    const closed = this.doors.get(index),
      b = this.boxes[index];
    if (!closed || !b.solid || (this.states.get(index) === 1) === open) return;
    const delta = b.p.map((n, i) => n - eye[i]) as V3;
    const range = Math.hypot(...delta);
    if (
      range < 0.001 ||
      range > 3.5 ||
      ray(eye, delta.map((n) => n / range) as V3, range + 0.1)?.box !== b
    )
      return;
    const dest = open ? openedDoor(closed) : closed;
    if (
      occupants.some(
        ({ p, height }) =>
          Math.abs(p[0] - dest.p[0]) < dest.s[0] / 2 + 0.33 &&
          Math.abs(p[2] - dest.p[2]) < dest.s[2] / 2 + 0.33 &&
          p[1] < dest.p[1] + dest.s[1] / 2 &&
          p[1] + height > dest.p[1] - dest.s[1] / 2,
      )
    )
      return;
    this.set(index, open ? 1 : 0);
  }
}
