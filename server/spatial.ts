import { meshOverlapsBox } from "../src/mesh-collision.ts";
import { worldRay, type Box, type V3 } from "../src/world.ts";
// Shared static broadphase. Each query visits only cells intersecting its XZ bounds.
export class Spatial {
  private cells = new Map<string, Box[]>();
  constructor(boxes: Box[]) {
    for (const b of boxes)
      if (b.solid) {
        for (
          let x = Math.floor((b.p[0] - b.s[0] / 2) / 12);
          x <= Math.floor((b.p[0] + b.s[0] / 2) / 12);
          x++
        )
          for (
            let z = Math.floor((b.p[2] - b.s[2] / 2) / 12);
            z <= Math.floor((b.p[2] + b.s[2] / 2) / 12);
            z++
          ) {
            const k = x + "," + z;
            const list = this.cells.get(k) ?? [];
            list.push(b);
            this.cells.set(k, list);
          }
      }
  }
  query(a: V3, b: V3, pad = 0) {
    const set = new Set<Box>();
    for (
      let x = Math.floor((Math.min(a[0], b[0]) - pad) / 12);
      x <= Math.floor((Math.max(a[0], b[0]) + pad) / 12);
      x++
    )
      for (
        let z = Math.floor((Math.min(a[2], b[2]) - pad) / 12);
        z <= Math.floor((Math.max(a[2], b[2]) + pad) / 12);
        z++
      )
        for (const box of this.cells.get(x + "," + z) ?? []) set.add(box);
    return [...set];
  }
  ray(o: V3, d: V3, max: number) {
    const end = o.map((v, i) => v + d[i] * max) as V3;
    return worldRay(this.query(o, end), o, d, max);
  }
  clear(p: V3, height = 1.85) {
    const center: V3 = [p[0], p[1] + (height + 0.06) / 2, p[2]];
    const half: V3 = [0.33, (height - 0.06) / 2, 0.33];
    return !this.query(p, p, 0.4).some((b) => {
      if (
        !b.solid ||
        half.some((h, i) => Math.abs(center[i] - b.p[i]) >= h + b.s[i] / 2)
      )
        return false;
      return b.mesh ? meshOverlapsBox(b.mesh, center, half) : true;
    });
  }
  movement(a: V3, b: V3, height: number) {
    // Check the swept torso at three lateral offsets. Low steps remain traversable.
    const delta = b.map((v, i) => v - a[i]) as V3,
      len = Math.hypot(...delta);
    if (len < 0.001) return true;
    const dir = delta.map((v) => v / len) as V3,
      horizontal = Math.hypot(dir[0], dir[2]);
    for (const h of [Math.min(0.7, height * 0.5), height - 0.18])
      for (const side of [-0.27, 0, 0.27]) {
        const o: V3 = [
          a[0] + (horizontal ? (dir[2] / horizontal) * side : 0),
          a[1] + h,
          a[2] - (horizontal ? (dir[0] / horizontal) * side : 0),
        ];
        const hit = this.ray(o, dir, len);
        if (hit && hit.distance < len - 0.035) return false;
      }
    return true;
  }
}
